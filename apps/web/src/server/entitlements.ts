/**
 * Server-side entitlement resolution (spec §3.3, guardrail 5).
 *
 * The client sends no plan id, no usage count and no price. Everything here is derived from
 * the authenticated user id and the rows the database returns for that user's org. The
 * audited prototype accepted a client-supplied session identifier and looked it up in an
 * in-memory dict with no ownership check; this module exists so there is exactly one place
 * that decision is made and one place to test it.
 */

export type Feature =
  | 'loop_simulation'
  | 'code_execution'
  | 'video_processing'
  | 'full_analytics';

export interface PlanRow {
  readonly id: string;
  readonly name: string;
  readonly priceCents: number;
  readonly includedSessions: number;
  readonly includedAsrMinutes: number;
  readonly allowsLoopSimulation: boolean;
  readonly allowsCodeExecution: boolean;
  readonly allowsVideo: boolean;
}

export interface EntitlementRow {
  readonly orgId: string;
  readonly planId: string;
  readonly status: 'trialing' | 'active' | 'past_due' | 'canceled' | 'expired';
  readonly currentPeriodStart: Date;
  readonly currentPeriodEnd: Date;
}

export interface UsageSnapshot {
  readonly sessionsThisPeriod: number;
  readonly asrMinutesThisPeriod: number;
}

/** The data access the resolver needs. Implemented against Postgres in production. */
export interface EntitlementStore {
  activeEntitlement(orgId: string): Promise<EntitlementRow | null>;
  plan(planId: string): Promise<PlanRow | null>;
  usage(orgId: string, since: Date): Promise<UsageSnapshot>;
}

export interface ResolvedEntitlement {
  readonly orgId: string;
  readonly plan: PlanRow;
  readonly status: EntitlementRow['status'];
  readonly sessionsRemaining: number;
  readonly asrMinutesRemaining: number;
}

export class EntitlementDeniedError extends Error {
  readonly httpStatus = 402;
  constructor(
    public readonly code:
      | 'no_active_subscription'
      | 'subscription_not_current'
      | 'session_quota_exhausted'
      | 'asr_quota_exhausted'
      | 'feature_not_in_plan',
    message: string,
  ) {
    super(message);
    this.name = 'EntitlementDeniedError';
  }
}

const ACTIVE_STATUSES = new Set<EntitlementRow['status']>(['trialing', 'active']);

export async function resolveEntitlement(
  store: EntitlementStore,
  orgId: string,
  now: Date = new Date(),
): Promise<ResolvedEntitlement> {
  const row = await store.activeEntitlement(orgId);
  if (row === null) {
    throw new EntitlementDeniedError('no_active_subscription', 'No subscription for this account.');
  }
  if (!ACTIVE_STATUSES.has(row.status)) {
    throw new EntitlementDeniedError(
      'subscription_not_current',
      `Subscription status is ${row.status}.`,
    );
  }
  if (now < row.currentPeriodStart || now >= row.currentPeriodEnd) {
    throw new EntitlementDeniedError(
      'subscription_not_current',
      'Subscription period is not current.',
    );
  }
  const plan = await store.plan(row.planId);
  if (plan === null) {
    throw new EntitlementDeniedError(
      'no_active_subscription',
      `Plan ${row.planId} is not in the catalog.`,
    );
  }
  const used = await store.usage(orgId, row.currentPeriodStart);
  return {
    orgId,
    plan,
    status: row.status,
    sessionsRemaining: Math.max(0, plan.includedSessions - used.sessionsThisPeriod),
    asrMinutesRemaining: Math.max(0, plan.includedAsrMinutes - used.asrMinutesThisPeriod),
  };
}

/** Throws unless the resolved plan grants `feature`. Never consults a client-supplied value. */
export function assertFeature(resolved: ResolvedEntitlement, feature: Feature): void {
  const granted: Record<Feature, boolean> = {
    loop_simulation: resolved.plan.allowsLoopSimulation,
    code_execution: resolved.plan.allowsCodeExecution,
    video_processing: resolved.plan.allowsVideo,
    full_analytics: resolved.plan.allowsLoopSimulation,
  };
  if (!granted[feature]) {
    throw new EntitlementDeniedError(
      'feature_not_in_plan',
      `Plan ${resolved.plan.id} does not include ${feature}.`,
    );
  }
}

/** Throws when starting another session would exceed the plan's included volume. */
export function assertSessionQuota(resolved: ResolvedEntitlement): void {
  if (resolved.sessionsRemaining <= 0) {
    throw new EntitlementDeniedError(
      'session_quota_exhausted',
      `Plan ${resolved.plan.id} includes ${resolved.plan.includedSessions} sessions per period.`,
    );
  }
}
