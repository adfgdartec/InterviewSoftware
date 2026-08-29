/**
 * Single source of truth for the affect-inference vocabulary Loopcraft must never emit.
 *
 * Spec §5.1: EU AI Act Article 5(1)(f) prohibits inferring emotions of a natural person
 * in workplace and educational contexts, and the Commission's guidelines read "workplace"
 * broadly enough to reach recruitment. Loopcraft therefore derives every delivery signal
 * from transcript text and audio timing, and never names a field after an internal state.
 *
 * This module is consumed by:
 *   - tooling/eslint-plugin-loopcraft  (fails the build on a banned schema field or string)
 *   - packages/core/src/claims.ts      (user-facing string scanner)
 *   - apps/worker/tests/test_banned_tokens.py (Python mirror, kept in sync by a test)
 */

/**
 * Base vocabulary. A response-schema field or user-facing string containing any of these
 * as a whole word is a build failure unless it appears in {@link FIELD_NAME_EXEMPTIONS}
 * or matches a {@link STATISTICAL_PHRASE_EXEMPTIONS} entry.
 */
export const EMOTION_TOKENS = [
  'emotion',
  'emotional',
  'sentiment',
  'engagement',
  'engaged',
  'confidence',
  'confident',
  'enthusiasm',
  'enthusiastic',
  'mood',
  'personality',
  'affect',
  'arousal',
  'valence',
  'demeanor',
  'attitude',
  'facial expression',
  'micro expression',
  'microexpression',
  'tone of voice',
  'vocal tone',
  'eye contact',
] as const;

export type EmotionToken = (typeof EMOTION_TOKENS)[number];

/**
 * Exact identifiers permitted as field names. "Confidence" is overloaded: as an inference
 * about a person it is prohibited, as a statistical interval it is required by spec §2.6
 * ("report inter-sample variance as a confidence signal") and acceptance criterion 8
 * ("every score shown to a user carries an uncertainty interval"). We permit only the
 * statistical spellings, so a reviewer can tell the two apart by the identifier alone.
 */
export const FIELD_NAME_EXEMPTIONS = new Set<string>([
  'confidenceInterval',
  'confidence_interval',
  'confidenceIntervalLow',
  'confidenceIntervalHigh',
  'graderConfidenceInterval',
]);

/**
 * Phrases in which a banned token is unambiguously statistical rather than psychological.
 * Applies to prose (docs, UI copy), never to field names — a field named `confidence`
 * is ambiguous at the call site no matter what the surrounding sentence says.
 */
export const STATISTICAL_PHRASE_EXEMPTIONS = [
  'confidence interval',
  'confidence intervals',
  'confidence level',
  'confidence band',
  '95% confidence',
] as const;

const WORD_BOUNDARY_SOURCE = EMOTION_TOKENS.map((t) =>
  t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '[\\s_-]*'),
).join('|');

/** Matches a banned token as a whole word, tolerant of camelCase, snake_case and kebab-case. */
export function bannedTokenPattern(): RegExp {
  return new RegExp(`\\b(${WORD_BOUNDARY_SOURCE})\\b`, 'gi');
}

export interface BannedTokenHit {
  readonly token: string;
  readonly index: number;
}

/** Splits camelCase/PascalCase into space-separated words so `voiceTone` is inspectable. */
function normalize(input: string): string {
  return input
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .toLowerCase();
}

/**
 * Scans free prose (UI copy, docs, prompts). Statistical phrases are masked out first so
 * "3.4 ± 0.6 (95% confidence interval)" does not trip the rule.
 */
export function findBannedTokensInText(text: string): BannedTokenHit[] {
  let haystack = normalize(text);
  for (const phrase of STATISTICAL_PHRASE_EXEMPTIONS) {
    haystack = haystack.replaceAll(phrase, ' '.repeat(phrase.length));
  }
  const hits: BannedTokenHit[] = [];
  const pattern = bannedTokenPattern();
  let match: RegExpExecArray | null = pattern.exec(haystack);
  while (match !== null) {
    hits.push({ token: match[0], index: match.index });
    match = pattern.exec(haystack);
  }
  return hits;
}

/**
 * Scans a schema field name or other identifier. Stricter than {@link findBannedTokensInText}:
 * only the exact identifiers in {@link FIELD_NAME_EXEMPTIONS} are allowed through.
 */
export function findBannedTokensInFieldName(fieldName: string): BannedTokenHit[] {
  if (FIELD_NAME_EXEMPTIONS.has(fieldName)) return [];
  const pattern = bannedTokenPattern();
  const haystack = normalize(fieldName);
  const hits: BannedTokenHit[] = [];
  let match: RegExpExecArray | null = pattern.exec(haystack);
  while (match !== null) {
    hits.push({ token: match[0], index: match.index });
    match = pattern.exec(haystack);
  }
  return hits;
}

/** True when the identifier is safe to use as a response-schema field name. */
export function isFieldNameAllowed(fieldName: string): boolean {
  return findBannedTokensInFieldName(fieldName).length === 0;
}
