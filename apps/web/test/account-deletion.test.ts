import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { DEV_PLAN_ID, appClient, ownerClient, seedDevPlan } from '@loopcraft/db';
import { deleteAccount } from '../src/server/account-deletion.js';
import { provisionUser } from '../src/server/provisioning.js';

/**
 * Deletion is the one operation with no undo, so these tests are about completeness: that
 * everything belonging to the account is gone, and that the record of the deletion is not.
 */

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

const DOOMED = 'd3111111-2222-4333-8444-555555555555';

beforeEach(async () => {
  await withOwner(async (o) => {
    await seedDevPlan(o);
    await o`delete from users where id = ${DOOMED}`;
    await o`delete from orgs where slug like ${'w-' + DOOMED.slice(0, 12) + '%'}`;
    await o`delete from audit_log where subject_id = ${DOOMED}`;
  });
});

async function makeAccount(): Promise<{ userId: string; orgId: string }> {
  return withOwner((o) =>
    provisionUser(o, {
      userId: DOOMED,
      email: 'doomed@example.test',
      displayName: 'Doomed Account',
      ageBand: '16_plus',
      jurisdiction: 'us_other',
      authProvider: 'password',
      termsVersion: 'v1',
      privacyVersion: 'v1',
      planId: DEV_PLAN_ID,
    }),
  );
}

describe('deleteAccount', () => {
  it('removes the user, the org, the membership and the entitlement', async () => {
    const who = await makeAccount();
    await withOwner((o) => deleteAccount(o, who));

    const left = await withOwner(async (o) => ({
      users: await o`select id from users where id = ${who.userId}`,
      orgs: await o`select id from orgs where id = ${who.orgId}`,
      memberships: await o`select id from memberships where user_id = ${who.userId}`,
      entitlements: await o`select id from entitlements where org_id = ${who.orgId}`,
    }));

    expect(left.users).toHaveLength(0);
    expect(left.orgs).toHaveLength(0);
    expect(left.memberships).toHaveLength(0);
    expect(left.entitlements).toHaveLength(0);
  });

  it('cascades to interview content, so nothing survives the org', async () => {
    const who = await makeAccount();

    // A session with a round and a turn: the shape a real account accumulates.
    const sessionId = await withOwner(async (o) => {
      const rows = await o<{ id: string }[]>`
        insert into sessions (org_id, user_id, loop_template_id, track_id, level_band,
                              status, current_round_position, cost_ceiling_cents)
        select ${who.orgId}, ${who.userId}, t.id, t.track_id, 'L5', 'in_progress', 1, 500
        from loop_templates t limit 1
        returning id`;
      const sid = rows[0]!.id;
      const round = await o<{ id: string }[]>`
        insert into rounds (org_id, session_id, position, round_type, persona, rubric_id, minutes)
        select ${who.orgId}, ${sid}, 1, 'warmup', 'Recruiter', r.id, 5 from rubrics r limit 1
        returning id`;
      await o`
        insert into turns (org_id, round_id, position, question, transcript)
        values (${who.orgId}, ${round[0]!.id}, 1, 'A question.', 'An answer.')`;
      return sid;
    });

    await withOwner((o) => deleteAccount(o, who));

    const left = await withOwner(async (o) => ({
      sessions: await o`select id from sessions where id = ${sessionId}`,
      rounds: await o`select id from rounds where session_id = ${sessionId}`,
      turns: await o`select id from turns where org_id = ${who.orgId}`,
    }));
    expect(left.sessions).toHaveLength(0);
    expect(left.rounds).toHaveLength(0);
    expect(left.turns).toHaveLength(0);
  });

  it('reports how much it purged', async () => {
    const who = await makeAccount();
    const outcome = await withOwner((o) => deleteAccount(o, who));
    // user + org membership + entitlement at minimum.
    expect(outcome.rowsPurged).toBeGreaterThanOrEqual(3);
    expect(outcome.storageObjectsPurged).toBe(0);
  });

  it('keeps the audit record, because erasing it would erase the evidence of the erasure', async () => {
    const who = await makeAccount();
    await withOwner((o) => deleteAccount(o, who));

    const audit = await withOwner((o) => o<{ action: string; subject_id: string }[]>`
      select action, subject_id from audit_log where subject_id = ${who.userId}`);
    expect(audit).toHaveLength(1);
    expect(audit[0]?.action).toBe('account_deleted');
  });

  it('reports honestly when the auth record could not be removed', async () => {
    // The email lives in Supabase auth, not in `users`. Without a service-role key it stays,
    // and claiming a complete erasure when the address is still on file would be a lie.
    const who = await makeAccount();
    const outcome = await withOwner((o) => deleteAccount(o, who));
    expect(outcome.authRecordDeleted).toBe(false);
  });

  it('reports the auth record deleted when the deleter succeeds', async () => {
    const who = await makeAccount();
    let asked: string | null = null;
    const outcome = await withOwner((o) =>
      deleteAccount(o, {
        ...who,
        deleteAuthUser: async (id) => {
          asked = id;
        },
      }),
    );
    expect(asked).toBe(who.userId);
    expect(outcome.authRecordDeleted).toBe(true);
  });

  it('still purges the data when deleting the auth record throws', async () => {
    // The purge already happened and is not reversible, so a failure afterwards must not be
    // reported as "nothing was deleted" -- that would invite a retry against nothing.
    const who = await makeAccount();
    const outcome = await withOwner((o) =>
      deleteAccount(o, {
        ...who,
        deleteAuthUser: async () => {
          throw new Error('service role key missing');
        },
      }),
    );
    expect(outcome.authRecordDeleted).toBe(false);
    expect(outcome.rowsPurged).toBeGreaterThan(0);

    const users = await withOwner((o) => o`select id from users where id = ${who.userId}`);
    expect(users).toHaveLength(0);
  });

  it('leaves other accounts untouched', async () => {
    const who = await makeAccount();
    const before = await withOwner((o) => o<{ n: string }[]>`select count(*)::text as n from users`);
    await withOwner((o) => deleteAccount(o, who));
    const after = await withOwner((o) => o<{ n: string }[]>`select count(*)::text as n from users`);
    expect(Number(after[0]!.n)).toBe(Number(before[0]!.n) - 1);
  });
});
