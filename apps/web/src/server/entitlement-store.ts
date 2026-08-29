import type { Sql } from '@loopcraft/db';
import { asUser } from '@loopcraft/db';
import type {
  EntitlementRow,
  EntitlementStore,
  PlanRow,
  UsageSnapshot,
} from './entitlements.js';

/**
 * Postgres-backed entitlement store. Guardrail 8: plan rows -- including price and included
 * volume -- are read from the `plans` table, never from a constant in code. Guardrail 5:
 * every query is scoped by the authenticated user through RLS, so an org id the caller is
 * not a member of returns nothing rather than another tenant's subscription.
 */
export function postgresEntitlementStore(sql: Sql, userId: string): EntitlementStore {
  return {
    async activeEntitlement(orgId: string): Promise<EntitlementRow | null> {
      const rows = await asUser(sql, userId, (tx) => tx<Record<string, unknown>[]>`
        select org_id, plan_id, status, current_period_start, current_period_end
        from entitlements
        where org_id = ${orgId}
        order by current_period_end desc
        limit 1`);
      const r = rows[0];
      if (r === undefined) return null;
      return {
        orgId: String(r['org_id']),
        planId: String(r['plan_id']),
        status: String(r['status']) as EntitlementRow['status'],
        currentPeriodStart: new Date(String(r['current_period_start'])),
        currentPeriodEnd: new Date(String(r['current_period_end'])),
      };
    },

    async plan(planId: string): Promise<PlanRow | null> {
      const rows = await asUser(sql, userId, (tx) => tx<Record<string, unknown>[]>`
        select id, name, price_cents, included_sessions, included_asr_minutes,
               allows_loop_simulation, allows_code_execution, allows_video
        from plans where id = ${planId} and active`);
      const r = rows[0];
      if (r === undefined) return null;
      return {
        id: String(r['id']),
        name: String(r['name']),
        priceCents: Number(r['price_cents']),
        includedSessions: Number(r['included_sessions']),
        includedAsrMinutes: Number(r['included_asr_minutes']),
        allowsLoopSimulation: Boolean(r['allows_loop_simulation']),
        allowsCodeExecution: Boolean(r['allows_code_execution']),
        allowsVideo: Boolean(r['allows_video']),
      };
    },

    async usage(orgId: string, since: Date): Promise<UsageSnapshot> {
      const rows = await asUser(sql, userId, (tx) => tx<Record<string, unknown>[]>`
        select meter, coalesce(sum(quantity), 0) as total
        from usage_ledger
        where org_id = ${orgId} and occurred_at >= ${since}
        group by meter`);
      const total = (meter: string): number =>
        Number(rows.find((r) => r['meter'] === meter)?.['total'] ?? 0);
      return {
        sessionsThisPeriod: total('session'),
        asrMinutesThisPeriod: total('asr_minute'),
      };
    },
  };
}
