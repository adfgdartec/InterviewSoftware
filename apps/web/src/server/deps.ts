import { ITEM_BANK, itemsFor, loopTemplateById } from '@loopcraft/core';
import { appClient, ownerClient, DEV_PLAN_ID } from '@loopcraft/db';
import { demoGenerator } from './demo.js';
import { heuristicGraderSampler } from './heuristic-grader.js';
import { llmGraderSampler } from './llm-grader.js';
import { llmQuestionGenerator } from './llm-question-generator.js';
import { PostgresRateLimiter } from './rate-limit.js';
import { demoIdentity, demoIdentityAllowed } from './dev-identity.js';
import { postgresEntitlementStore } from './entitlement-store.js';
import { authenticateWith } from './auth.js';
import { serverClient, supabaseConfigured } from './supabase.js';
import { KVSynthesisCache, resolveKVBinding } from './synthesis-cache.js';
import { setSynthesisCache } from '@loopcraft/providers';
import type { AuthedUser } from './guards.js';
import type { RouteDeps } from './routes.js';

/**
 * Process-wide singletons for the running server. A rate limiter and a database pool that
 * got re-created per request would rate-limit nothing and exhaust connections; both need to
 * outlive a single request.
 */
const sql = appClient();

/**
 * Shared, not per-process. The previous in-memory limiter enforced nothing once the app ran
 * in more than one process -- and on Workers every isolate is another process. This one is
 * the only thing standing between an account and unbounded Deepgram/Cartesia spend, so it
 * has to count across all of them.
 */
const rateLimiter = new PostgresRateLimiter(sql, 120, 60_000);

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

/**
 * Swaps the provider package's in-process synthesis cache for KV, once, when the binding is
 * there. Idempotent and lazy rather than done at module load: the Cloudflare context only
 * exists inside a request, so there is no earlier moment to ask.
 */
let synthesisCacheResolved = false;
async function useSharedSynthesisCache(): Promise<void> {
  if (synthesisCacheResolved) return;
  synthesisCacheResolved = true;
  const kv = await resolveKVBinding();
  if (kv !== null) setSynthesisCache(new KVSynthesisCache(kv));
}

export async function buildRouteDeps(): Promise<RouteDeps> {
  await useSharedSynthesisCache();
  const identity = await authenticate();
  return {
    authenticate: async () => identity,
    // Entitlements are resolved from the authenticated org. With no identity there is
    // nothing to resolve, and the guard chain rejects before it ever asks.
    entitlements: postgresEntitlementStore(sql, identity?.userId ?? ''),
    rateLimiter,
    templates: { byId: loopTemplateById },
    items: { itemsFor },
    // A real model writes the question against the round's own rubric; the deterministic
    // demo generator is the fallback when no provider is configured. `selectQuestion` still
    // validates and still falls back to the curated catalog when generation is rejected.
    generator: llmQuestionGenerator() ?? demoGenerator(ITEM_BANK),
    sql,
    turnsPerRound: 1,
    costCeilingCents: 500,
    generationTimeoutMs: 8_000,
    // Real grading. heuristicGraderSampler scored on string length and whether the answer
    // contained a digit, which is why every debrief read the same number down the page. It
    // stays as the last resort so an unconfigured environment degrades rather than 503s.
    graderSampler: llmGraderSampler() ?? heuristicGraderSampler(),
    interviewerEnabled: true,
  };
}

/** The signed-in user for a page render, or null. Pages use this; routes use the guard chain. */
export async function currentUser(): Promise<AuthedUser | null> {
  return authenticate();
}
