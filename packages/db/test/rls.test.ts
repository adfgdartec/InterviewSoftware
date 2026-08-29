import { afterAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { appUrl, ownerUrl } from '../src/env.js';
import { FIXTURE } from '../src/seed-fixtures.js';

/**
 * Acceptance criterion 6: "A user in org A cannot read any row belonging to org B, proven
 * by test." These run on the loopcraft_app role, which is neither superuser nor table owner,
 * so the policies genuinely apply — a superuser connection would bypass RLS and the suite
 * would pass while proving nothing. `asSuperuser` below asserts exactly that.
 */

const app = postgres(appUrl(), { max: 4, onnotice: () => {}, connection: { search_path: 'public' } });
const owner = postgres(ownerUrl(), { max: 2, onnotice: () => {}, connection: { search_path: 'public' } });

afterAll(async () => {
  await Promise.all([app.end({ timeout: 5 }), owner.end({ timeout: 5 })]);
});

/** Runs `fn` inside a transaction acting as `userId`, mirroring the per-request GUC the API sets. */
async function actingAs<T>(userId: string | null, fn: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
  return app.begin(async (tx) => {
    if (userId === null) {
      await tx`select set_config('app.current_user_id', '', true)`;
    } else {
      await tx`select set_config('app.current_user_id', ${userId}, true)`;
    }
    return fn(tx);
  }) as Promise<T>;
}

describe('the test role is actually subject to RLS', () => {
  it('is neither superuser nor bypassrls', async () => {
    const [row] = await app<{ usename: string; usesuper: boolean; usebypassrls: boolean }[]>`
      select usename, usesuper, usebypassrls from pg_user where usename = current_user`;
    expect(row?.usename).toBe('loopcraft_app');
    expect(row?.usesuper).toBe(false);
    expect(row?.usebypassrls).toBe(false);
  });

  it('does not own the tables it queries', async () => {
    const [row] = await owner<{ tableowner: string }[]>`
      select tableowner from pg_tables where schemaname = 'public' and tablename = 'sessions'`;
    expect(row?.tableowner).not.toBe('loopcraft_app');
  });
});

describe('cross-tenant denial (acceptance criterion 6)', () => {
  it('user A reads only org A sessions', async () => {
    const rows = await actingAs(FIXTURE.userA, (tx) => tx`select id, org_id from sessions`);
    expect(rows.map((r) => r['id'])).toEqual([FIXTURE.sessionA]);
  });

  it('user B reads only org B sessions', async () => {
    const rows = await actingAs(FIXTURE.userB, (tx) => tx`select id, org_id from sessions`);
    expect(rows.map((r) => r['id'])).toEqual([FIXTURE.sessionB]);
  });

  it("user A cannot read org B's session even when naming its primary key", async () => {
    const rows = await actingAs(
      FIXTURE.userA,
      (tx) => tx`select id from sessions where id = ${FIXTURE.sessionB}`,
    );
    expect(rows).toHaveLength(0);
  });

  it('user A cannot read org B rows on any tenant table', async () => {
    const tenantTables = await owner<{ table_name: string }[]>`
      select c.relname as table_name
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid and a.attname = 'org_id' and a.attnum > 0
      where n.nspname = 'public' and c.relkind = 'r'
      order by c.relname`;
    expect(tenantTables.length).toBeGreaterThan(10);

    for (const { table_name } of tenantTables) {
      const rows = await actingAs(FIXTURE.userA, (tx) =>
        tx.unsafe(`select count(*)::int as n from ${table_name} where org_id = $1`, [FIXTURE.orgB]),
      );
      expect({ table: table_name, leaked: rows[0]?.['n'] }).toEqual({ table: table_name, leaked: 0 });
    }
  });

  it('user A cannot write a row into org B', async () => {
    await expect(
      actingAs(
        FIXTURE.userA,
        (tx) => tx`
          insert into sessions (org_id, user_id, loop_template_id, track_id, level_band)
          values (${FIXTURE.orgB}, ${FIXTURE.userA}, ${FIXTURE.templateId}, ${FIXTURE.trackId}, 'L5')`,
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('user A cannot update an org B row', async () => {
    const updated = await actingAs(
      FIXTURE.userA,
      (tx) => tx`update sessions set status = 'abandoned' where id = ${FIXTURE.sessionB} returning id`,
    );
    expect(updated).toHaveLength(0);
    const [still] = await owner<{ status: string }[]>`
      select status from sessions where id = ${FIXTURE.sessionB}`;
    expect(still?.status).toBe('in_progress');
  });

  it('user A cannot delete an org B row', async () => {
    const deleted = await actingAs(
      FIXTURE.userA,
      (tx) => tx`delete from sessions where id = ${FIXTURE.sessionB} returning id`,
    );
    expect(deleted).toHaveLength(0);
  });

  it('reads only its own user row', async () => {
    const rows = await actingAs(FIXTURE.userA, (tx) => tx`select id from users`);
    expect(rows.map((r) => r['id'])).toEqual([FIXTURE.userA]);
  });
});

describe('deny by default', () => {
  it('an unauthenticated connection reads nothing from any tenant table', async () => {
    for (const table of ['sessions', 'entitlements', 'scores', 'model_runs', 'consent_events']) {
      const rows = await actingAs(null, (tx) => tx.unsafe(`select count(*)::int as n from ${table}`));
      expect({ table, visible: rows[0]?.['n'] }).toEqual({ table, visible: 0 });
    }
  });

  it('an unknown user id reads nothing', async () => {
    const rows = await actingAs('00000000-0000-4000-8000-00000000dead', (tx) =>
      tx`select count(*)::int as n from sessions`);
    expect(rows[0]?.['n']).toBe(0);
  });

  it('a malformed user id fails closed rather than erroring open', async () => {
    const rows = await actingAs('not-a-uuid', (tx) => tx`select count(*)::int as n from sessions`);
    expect(rows[0]?.['n']).toBe(0);
  });

  it('the global catalog is readable when authenticated and invisible when not', async () => {
    const authed = await actingAs(FIXTURE.userA, (tx) => tx`select count(*)::int as n from plans`);
    expect(authed[0]?.['n']).toBeGreaterThan(0);
    const anon = await actingAs(null, (tx) => tx`select count(*)::int as n from plans`);
    expect(anon[0]?.['n']).toBe(0);
  });

  it('the catalog is not writable by a tenant (guardrail 5)', async () => {
    await expect(
      actingAs(
        FIXTURE.userA,
        (tx) => tx`update plans set price_cents = 1 where id = ${FIXTURE.planId}`,
      ),
    ).rejects.toThrow(/row-level security|permission denied/i);
  });

  it('consent_events cannot be updated or deleted by the application role', async () => {
    await owner`
      insert into consent_events (org_id, user_id, purpose, granted, policy_version)
      values (${FIXTURE.orgA}, ${FIXTURE.userA}, 'terms_of_service', true, 'v1')`;
    await expect(
      actingAs(FIXTURE.userA, (tx) => tx`update consent_events set granted = false`),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      actingAs(FIXTURE.userA, (tx) => tx`delete from consent_events`),
    ).rejects.toThrow(/permission denied/i);
  });
});

describe('RLS coverage invariants', () => {
  it('every table in public has RLS enabled and forced', async () => {
    const rows = await owner`select * from loopcraft.tables_without_rls()`;
    expect(rows).toEqual([]);
  });

  it('every tenant table has at least one policy', async () => {
    const rows = await owner`select * from loopcraft.tenant_tables_without_policy()`;
    expect(rows).toEqual([]);
  });
});
