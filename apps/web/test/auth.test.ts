import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DEV_PLAN_ID, FIXTURE, appClient, ownerClient, seedDevPlan } from '@loopcraft/db';
import { authenticateWith, bearerToken } from '../src/server/auth.js';
import { provisionUser, SignupNotPermittedError } from '../src/server/provisioning.js';
import { demoIdentityAllowed } from '../src/server/dev-identity.js';

const sql = appClient();
afterAll(async () => {
  await sql.end({ timeout: 5 });
});

async function withOwner<T>(fn: (o: ReturnType<typeof ownerClient>) => Promise<T>): Promise<T> {
  const owner = ownerClient();
  try {
    return await fn(owner);
  } finally {
    await owner.end({ timeout: 5 });
  }
}

/** A Supabase auth stub. Only getUser is used -- which is the point of the last test here. */
function supabaseStub(user: unknown, error: unknown = null) {
  return { getUser: async () => ({ data: { user }, error }) } as never;
}

const NEW_ID = '9f1d2c3b-4a5e-4f60-8a71-0b2c3d4e5f60';

/**
 * New accounts must land on a NON-auto-renewing plan. A constraint trigger in migration 0001
 * refuses any entitlement on an auto-renewing plan that has no recorded renewal consent
 * (California ARL, spec 5.4) -- and signup deliberately does not collect renewal consent,
 * because ARL requires that to be its own affirmative step at checkout. `demo-free` has
 * auto_renews = false, which is why it is what deps.ts provisions onto.
 */
beforeAll(async () => {
  await withOwner((o) => seedDevPlan(o));
});

beforeEach(async () => {
  await withOwner(async (o) => {
    await o`delete from memberships where user_id = ${NEW_ID}`;
    await o`delete from users where id = ${NEW_ID}`;
    await o`delete from orgs where slug like ${'w-' + NEW_ID.slice(0, 12) + '%'}`;
  });
});

describe('authenticateWith', () => {
  it('returns null when there is no session', async () => {
    const who = await authenticateWith({
      supabase: supabaseStub(null), sql, owner: ownerClient, planId: DEV_PLAN_ID,
    });
    expect(who).toBeNull();
  });

  it('returns null when the token fails verification', async () => {
    const who = await authenticateWith({
      supabase: supabaseStub(null, { message: 'invalid JWT' }),
      sql,
      owner: ownerClient,
      planId: DEV_PLAN_ID,
    });
    expect(who).toBeNull();
  });

  it('maps an already-provisioned identity to its org without touching the owner connection', async () => {
    const who = await authenticateWith({
      supabase: supabaseStub({ id: FIXTURE.userA, email: 'a@example.test' }),
      sql,
      owner: () => {
        throw new Error('owner connection must not be opened for an existing identity');
      },
      planId: DEV_PLAN_ID,
    });
    expect(who).toEqual({ userId: FIXTURE.userA, orgId: FIXTURE.orgA });
  });

  it('provisions a verified identity that has no rows yet', async () => {
    const who = await authenticateWith({
      supabase: supabaseStub({
        id: NEW_ID,
        email: 'new@example.test',
        app_metadata: { provider: 'email' },
        user_metadata: { display_name: 'New Person', age_band: '16_plus', jurisdiction: 'us_other' },
      }),
      sql,
      owner: ownerClient,
      planId: DEV_PLAN_ID,
    });
    expect(who).not.toBeNull();
    expect(who!.userId).toBe(NEW_ID);

    const rows = await withOwner((o) => o<{ age_band: string; terms_accepted_at: Date | null; auth_provider: string }[]>`
      select age_band, terms_accepted_at, auth_provider from users where id = ${NEW_ID}`);
    expect(rows[0]?.age_band).toBe('16_plus');
    expect(rows[0]?.auth_provider).toBe('password');
    // The consent record is what the terms acceptance is FOR -- a row without it is a user
    // we cannot prove agreed to anything.
    expect(rows[0]?.terms_accepted_at).not.toBeNull();
  });

  it('refuses to provision an identity that fails the age gate, and creates nothing', async () => {
    const who = await authenticateWith({
      supabase: supabaseStub({
        id: NEW_ID,
        email: 'kid@example.test',
        user_metadata: { age_band: 'under_13', jurisdiction: 'us_other' },
      }),
      sql,
      owner: ownerClient,
      planId: DEV_PLAN_ID,
    });
    expect(who).toBeNull();
    const rows = await withOwner((o) => o`select id from users where id = ${NEW_ID}`);
    expect(rows).toHaveLength(0);
  });

  it('refuses a Google identity that never answered the age question', async () => {
    // OAuth carries no age band, so the metadata defaults to `unknown` -- which the gate
    // refuses. This is the fail-closed path that stops OAuth being an age-gate bypass.
    const who = await authenticateWith({
      supabase: supabaseStub({
        id: NEW_ID,
        email: 'g@example.test',
        app_metadata: { provider: 'google' },
        user_metadata: {},
      }),
      sql,
      owner: ownerClient,
      planId: DEV_PLAN_ID,
    });
    expect(who).toBeNull();
  });

  it('verifies the token rather than trusting the cookie', () => {
    // getSession() decodes the cookie WITHOUT validating it, so a forged cookie
    // authenticates. getUser() calls the Auth server. Swapping them type-checks and passes
    // every functional test above, which is exactly why this asserts the call site.
    // `.getSession(` matches a call on an object, not the prose in the comment above that
    // names the method it is warning about.
    const source = readFileSync(join(process.cwd(), 'src/server/auth.ts'), 'utf8');
    expect(source).toContain('.getUser()');
    expect(source).not.toContain('.getSession(');

    const middleware = readFileSync(join(process.cwd(), 'src/middleware.ts'), 'utf8');
    expect(middleware).toContain('.getUser()');
    expect(middleware).not.toContain('.getSession(');
  });
});

describe('provisionUser', () => {
  it('is idempotent -- a second sign-in does not create a second org', async () => {
    const input = {
      userId: NEW_ID,
      email: 'twice@example.test',
      displayName: null,
      ageBand: '16_plus',
      jurisdiction: 'other',
      authProvider: 'password' as const,
      termsVersion: 'v1',
      privacyVersion: 'v1',
      planId: DEV_PLAN_ID,
    };
    const first = await withOwner((o) => provisionUser(o, input));
    const second = await withOwner((o) => provisionUser(o, input));
    expect(second).toEqual(first);

    const orgs = await withOwner((o) => o`select id from memberships where user_id = ${NEW_ID}`);
    expect(orgs).toHaveLength(1);
  });

  it('is refused by the database if it ever tries an auto-renewing plan without consent', async () => {
    // Not a hypothetical: the first version of this code provisioned onto FIXTURE.planId
    // ('pro-monthly', auto_renews = true) and the trigger stopped it. Asserted here so a
    // future change to the default plan cannot quietly put new users on an auto-renewing
    // entitlement they never affirmatively consented to.
    await expect(
      withOwner((o) =>
        provisionUser(o, {
          userId: NEW_ID,
          email: 'renew@example.test',
          displayName: null,
          ageBand: '16_plus',
          jurisdiction: 'other',
          authProvider: 'password',
          termsVersion: 'v1',
          privacyVersion: 'v1',
          planId: FIXTURE.planId,
        }),
      ),
    ).rejects.toThrow(/renewal consent/i);
  });

  it('throws rather than creating a partial account when the gate refuses', async () => {
    await expect(
      withOwner((o) =>
        provisionUser(o, {
          userId: NEW_ID,
          email: 'eu-teen@example.test',
          displayName: null,
          ageBand: '13_to_15',
          jurisdiction: 'eu',
          authProvider: 'password',
          termsVersion: 'v1',
          privacyVersion: 'v1',
          planId: DEV_PLAN_ID,
        }),
      ),
    ).rejects.toThrow(SignupNotPermittedError);

    const rows = await withOwner((o) => o`select id from orgs where slug = ${'w-' + NEW_ID.slice(0, 12)}`);
    expect(rows).toHaveLength(0);
  });
});

describe('the demo identity cannot ship enabled', () => {
  // NODE_ENV is typed readonly, which is correct for application code and unhelpful for a
  // test whose whole job is to prove the production branch. One narrow, named escape hatch.
  const env = process.env as Record<string, string | undefined>;
  const original = { node: env['NODE_ENV'], flag: env['LOOPCRAFT_DEV_IDENTITY'] };
  const restore = (key: string, value: string | undefined): void => {
    if (value === undefined) delete env[key];
    else env[key] = value;
  };
  afterAll(() => {
    restore('NODE_ENV', original.node);
    restore('LOOPCRAFT_DEV_IDENTITY', original.flag);
  });

  it('is refused in production even with the flag set', () => {
    env['NODE_ENV'] = 'production';
    env['LOOPCRAFT_DEV_IDENTITY'] = '1';
    expect(demoIdentityAllowed()).toBe(false);
  });

  it('is refused outside production without the flag', () => {
    env['NODE_ENV'] = 'development';
    delete env['LOOPCRAFT_DEV_IDENTITY'];
    expect(demoIdentityAllowed()).toBe(false);
  });

  it('is allowed only in development with the flag explicitly set', () => {
    env['NODE_ENV'] = 'development';
    env['LOOPCRAFT_DEV_IDENTITY'] = '1';
    expect(demoIdentityAllowed()).toBe(true);
  });
});

/**
 * Native clients cannot carry a browser cookie, so they send the Supabase access token in an
 * Authorization header. The token is still VERIFIED by getUser(), never merely decoded --
 * the same guarantee the cookie path has.
 */
describe('bearerToken', () => {
  const withHeader = (value: string | null): Request =>
    new Request('https://loopcraft.test/api/sessions', {
      headers: value === null ? {} : { authorization: value },
    });

  it('extracts a token from a well-formed header', () => {
    expect(bearerToken(withHeader('Bearer abc.def.ghi'))).toBe('abc.def.ghi');
  });

  it('is case-insensitive on the scheme, as RFC 7235 requires', () => {
    expect(bearerToken(withHeader('bearer abc.def.ghi'))).toBe('abc.def.ghi');
    expect(bearerToken(withHeader('BEARER abc.def.ghi'))).toBe('abc.def.ghi');
  });

  it('returns null when there is no header at all', () => {
    expect(bearerToken(withHeader(null))).toBeNull();
  });

  it('returns null for a scheme that is not Bearer', () => {
    // Basic auth must not be silently accepted as a token; it would reach getUser() and
    // produce a confusing verification failure rather than an honest "not signed in".
    expect(bearerToken(withHeader('Basic dXNlcjpwYXNz'))).toBeNull();
  });

  it('returns null for an empty or whitespace-only token', () => {
    expect(bearerToken(withHeader('Bearer '))).toBeNull();
    expect(bearerToken(withHeader('Bearer    '))).toBeNull();
  });

  it('passes the token to getUser rather than validating it itself', async () => {
    // The point of the header path: what arrives is handed to Supabase to VERIFY. A version
    // that decoded the JWT locally would accept a forged one.
    let received: string | undefined = 'not-called';
    const who = await authenticateWith({
      supabase: {
        getUser: async (token?: string) => {
          received = token;
          return { data: { user: { id: FIXTURE.userA, email: 'a@example.test' } }, error: null };
        },
      } as never,
      accessToken: 'token-from-the-native-app',
      sql,
      owner: ownerClient,
      planId: DEV_PLAN_ID,
    });
    expect(received).toBe('token-from-the-native-app');
    expect(who).toEqual({ userId: FIXTURE.userA, orgId: FIXTURE.orgA });
  });

  it('falls back to the cookie session when no token is supplied', async () => {
    let received: string | undefined = 'not-called';
    await authenticateWith({
      supabase: {
        getUser: async (token?: string) => {
          received = token;
          return { data: { user: null }, error: null };
        },
      } as never,
      accessToken: null,
      sql,
      owner: ownerClient,
      planId: DEV_PLAN_ID,
    });
    // undefined, not a token: getUser() with no argument is the cookie path.
    expect(received).toBeUndefined();
  });
});
