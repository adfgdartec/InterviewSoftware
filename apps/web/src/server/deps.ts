import { ITEM_BANK, itemsFor, loopTemplateById } from '@loopcraft/core';
import { appClient, ownerClient, DEV_PLAN_ID } from '@loopcraft/db';
import { demoGenerator } from './demo.js';
import { heuristicGraderSampler } from './heuristic-grader.js';
import { FixedWindowRateLimiter } from './rate-limit.js';
import { demoIdentity, demoIdentityAllowed } from './dev-identity.js';
import { postgresEntitlementStore } from './entitlement-store.js';
import { authenticateWith } from './auth.js';
import { serverClient, supabaseConfigured } from './supabase.js';
import type { AuthedUser } from './guards.js';
import type { RouteDeps } from './routes.js';

/**
 * Process-wide singletons for the running server. A rate limiter and a database pool that
 * got re-created per request would rate-limit nothing and exhaust connections; both need to
 * outlive a single request.
 */
const sql = appClient();
const rateLimiter = new FixedWindowRateLimiter(120, 60_000);

/**
 * Identity resolution, in priority order:
 *   1. Real Supabase auth, whenever it is configured. This is production.
 *   2. The demo cookie, but ONLY when LOOPCRAFT_DEV_IDENTITY=1 and not in production.
 *   3. Nobody -- which the guard chain turns into the 401 it already produced.
 *
 * Case 3 is the important one. Before this, an unconfigured environment silently fell back
 * to handing out entitled accounts; now it refuses, which is the correct answer for a
 * deployment whose auth is misconfigured.
 */
async function authenticate(): Promise<AuthedUser | null> {
  if (supabaseConfigured()) {
    return authenticateWith({
      supabase: (await serverClient()).auth,
      sql,
      owner: ownerClient,
      planId: DEV_PLAN_ID,
    });
  }
  if (demoIdentityAllowed()) return demoIdentity();
  return null;
}

export async function buildRouteDeps(): Promise<RouteDeps> {
  const identity = await authenticate();
  return {
    authenticate: async () => identity,
    // Entitlements are resolved from the authenticated org. With no identity there is
    // nothing to resolve, and the guard chain rejects before it ever asks.
    entitlements: postgresEntitlementStore(sql, identity?.userId ?? ''),
    rateLimiter,
    templates: { byId: loopTemplateById },
    items: { itemsFor },
    generator: demoGenerator(ITEM_BANK),
    sql,
    turnsPerRound: 1,
    costCeilingCents: 500,
    generationTimeoutMs: 8_000,
    graderSampler: heuristicGraderSampler(),
    interviewerEnabled: true,
  };
}

/** The signed-in user for a page render, or null. Pages use this; routes use the guard chain. */
export async function currentUser(): Promise<AuthedUser | null> {
  return authenticate();
}
