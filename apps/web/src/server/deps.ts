import { itemsFor, loopTemplateById } from '@loopcraft/core';
import { appClient, ownerClient, provisioningClient, DEV_PLAN_ID } from '@loopcraft/db';
import { llmGraderSampler } from './llm-grader.js';
import { llmQuestionGenerator } from './llm-question-generator.js';
import { PostgresRateLimiter } from './rate-limit.js';
import { demoIdentity, demoIdentityAllowed } from './dev-identity.js';
import { postgresEntitlementStore } from './entitlement-store.js';
import { authenticateWith, bearerToken } from './auth.js';
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
async function authenticate(request?: Request): Promise<AuthedUser | null> {
  if (supabaseConfigured()) {
    return authenticateWith({
      supabase: (await serverClient()).auth,
      // Native clients send a Bearer token; the browser sends a cookie. Same verification.
      accessToken: request === undefined ? null : bearerToken(request),
      sql,
      // One connection, closed immediately after the single provisioning transaction.
      owner: provisioningClient,
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

export async function buildRouteDeps(request?: Request): Promise<RouteDeps> {
  await useSharedSynthesisCache();
  const identity = await authenticate(request);
  return {
    authenticate: async () => identity,
    // Entitlements are resolved from the authenticated org. With no identity there is
    // nothing to resolve, and the guard chain rejects before it ever asks.
    entitlements: postgresEntitlementStore(sql, identity?.userId ?? ''),
    rateLimiter,
    templates: { byId: loopTemplateById },
    items: { itemsFor },
    // A real model writes the question against the round's own rubric, on whichever tier is
    // usable. `selectQuestion` still validates, and still falls back to the curated catalog
    // when generation is rejected or no provider is usable -- so a curated question, not an
    // invented one, is what a candidate sees in that case.
    generator: llmQuestionGenerator(),
    sql,
    turnsPerRound: 1,
    costCeilingCents: 500,
    generationTimeoutMs: 8_000,
    // Real grading, on whichever tier is usable -- OpenAI on Workers, local Ollama on a
    // machine with no key. heuristicGraderSampler is deliberately NOT wired in behind it:
    // it scored on string length and whether the answer contained a digit, so substituting
    // it would answer an unconfigured environment with invented numbers that look like
    // grades. An environment that cannot grade now says so (503 `grader_unavailable`).
    graderSampler: llmGraderSampler(),
    // One connection, opened and closed around the callback. Only the Stripe webhook uses
    // it; every user-facing route goes through asUser and RLS.
    owner: async (fn) => {
      const owner = ownerClient(undefined, 1);
      try {
        return await fn(owner);
      } finally {
        await owner.end({ timeout: 5 });
      }
    },
    interviewerEnabled: true,
  };
}

/** The signed-in user for a page render, or null. Pages use this; routes use the guard chain. */
export async function currentUser(): Promise<AuthedUser | null> {
  return authenticate();
}
