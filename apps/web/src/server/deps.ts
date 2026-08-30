import { ITEM_BANK, itemsFor, loopTemplateById } from '@loopcraft/core';
import { appClient } from '@loopcraft/db';
import { demoGenerator } from './demo.js';
import { heuristicGraderSampler } from './heuristic-grader.js';
import { FixedWindowRateLimiter } from './rate-limit.js';
import { demoIdentity } from './dev-identity.js';
import { postgresEntitlementStore } from './entitlement-store.js';
import type { RouteDeps } from './routes.js';

/**
 * Process-wide singletons for the running dev/demo server. A rate limiter and a database
 * pool that got re-created per request would rate-limit nothing and exhaust connections;
 * both need to outlive a single request.
 */
const sql = appClient();
const rateLimiter = new FixedWindowRateLimiter(120, 60_000);

export async function buildRouteDeps(): Promise<RouteDeps> {
  const identity = await demoIdentity();
  return {
    authenticate: async () => identity,
    entitlements: postgresEntitlementStore(sql, identity.userId),
    rateLimiter,
    templates: { byId: loopTemplateById },
    items: { itemsFor },
    generator: demoGenerator(ITEM_BANK),
    sql,
    turnsPerRound: 1,
    costCeilingCents: 500,
    generationTimeoutMs: 8_000,
    graderSampler: heuristicGraderSampler(),
  };
}
