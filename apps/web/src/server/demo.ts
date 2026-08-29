import type { Item, RoundType } from '@loopcraft/core';
import type { QuestionGenerator, QuestionRequest } from './question-generation.js';

/**
 * LOOPCRAFT_DEMO=1 runs the entire product against deterministic seeded fixtures with every
 * provider mocked. It is not a separate mock UI: the demo generator is injected at the same
 * seam a real provider occupies, so demo mode exercises the real guard chain, the real
 * session engine, the real RLS policies and the real fallback path.
 */

export const DEMO_ENV_VAR = 'LOOPCRAFT_DEMO';

export function isDemoMode(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[DEMO_ENV_VAR] === '1';
}

/**
 * A small deterministic PRNG. Demo output must be byte-identical across runs so a
 * screenshot, a test assertion and a stakeholder walkthrough all show the same loop.
 */
export function seededIndex(seed: string, modulo: number): number {
  if (modulo < 1) throw new RangeError('modulo must be >= 1');
  let hash = 2_166_136_261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16_777_619) >>> 0;
  }
  return hash % modulo;
}

/**
 * Deterministic question generator. Draws from the seeded item bank rather than inventing
 * text, so every question in a demo run carries real provenance and would survive the same
 * validation a live provider's output faces.
 */
export function demoGenerator(items: readonly Item[]): QuestionGenerator {
  return {
    async generate(request: QuestionRequest): Promise<string> {
      const pool = items.filter(
        (i) => i.trackId === request.trackId && i.roundType === request.roundType,
      );
      if (pool.length === 0) {
        // Fail rather than fabricate: the caller's catalog fallback is the correct next step,
        // and a demo that silently invents a question would not be exercising real code.
        throw new Error(`demo bank has no ${request.roundType} item for ${request.trackId}`);
      }
      const seed = `${request.trackId}:${request.roundType}:${request.excludeItemIds.join(',')}`;
      const chosen = pool[seededIndex(seed, pool.length)];
      if (chosen === undefined) throw new Error('demo selection produced no item');
      return chosen.prompt;
    },
  };
}

/** The candidate the demo loop portrays, per the build brief: a senior ML systems engineer. */
export const DEMO_CANDIDATE = {
  displayName: 'Demo Candidate',
  trackId: 'ml-systems',
  levelBand: 'L5',
  targetRole: 'Senior ML systems engineer',
} as const;

export const DEMO_ROUND_ORDER: readonly RoundType[] = [
  'warmup',
  'domain',
  'coding',
  'design',
  'behavioral',
];
