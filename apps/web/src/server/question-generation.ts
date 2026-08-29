import type { Item, LevelBand, RoundType } from '@loopcraft/core';
import { findBannedTokensInText } from '@loopcraft/core';

/**
 * Question selection for a round. Spec §6 phase 1 and acceptance criterion 2: "the fallback
 * path returns a catalog item when providers fail."
 *
 * Selection is entirely server-side (guardrail 5). Generated text is validated before it is
 * ever shown: a model that drifts into asking the candidate how they felt would otherwise
 * put affect inference straight into the product through the one path no schema covers.
 */

export type QuestionSource = 'generated' | 'catalog_fallback';

export interface QuestionRequest {
  readonly trackId: string;
  readonly roundType: RoundType;
  readonly levelBand: LevelBand;
  /** Item ids already used in this session, so a loop never repeats a question (spec §2.8). */
  readonly excludeItemIds: readonly string[];
}

export interface SelectedQuestion {
  readonly question: string;
  readonly itemId: string | null;
  readonly source: QuestionSource;
  readonly rubricId: string;
  /** Populated when generation was attempted and rejected, for the model_runs audit trail. */
  readonly fallbackReason: string | null;
}

/** The generation port. Demo mode supplies a deterministic implementation. */
export interface QuestionGenerator {
  generate(request: QuestionRequest, signal: AbortSignal): Promise<string>;
}

/** Read-only view of the item bank, injected so tests and demo mode share one code path. */
export interface ItemSource {
  itemsFor(trackId: string, roundType: RoundType): readonly Item[];
}

export const MIN_QUESTION_LENGTH = 15;
export const MAX_QUESTION_LENGTH = 1_200;

export class NoCatalogItemError extends Error {
  constructor(trackId: string, roundType: RoundType) {
    super(`Item bank has no ${roundType} item for track ${trackId}.`);
    this.name = 'NoCatalogItemError';
  }
}

/**
 * Rejects generated text that is unusable or non-compliant. Returns null when acceptable,
 * otherwise the reason, which is recorded rather than swallowed.
 */
export function rejectionReason(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.length < MIN_QUESTION_LENGTH) return 'too_short';
  if (trimmed.length > MAX_QUESTION_LENGTH) return 'too_long';
  const banned = findBannedTokensInText(trimmed);
  if (banned.length > 0) return `banned_vocabulary:${banned[0]?.token ?? 'unknown'}`;
  // Spec §5.3: never present an item as a real or insider question from a named employer.
  if (/\b(real|actual|insider|leaked)\b[^.?!]{0,40}\bquestions?\b/i.test(trimmed)) {
    return 'provenance_claim';
  }
  return null;
}

/** Picks the catalog item closest to the band, preferring unused and easier items. */
export function chooseCatalogItem(
  items: readonly Item[],
  levelBand: LevelBand,
  excludeItemIds: readonly string[],
): Item | undefined {
  const excluded = new Set(excludeItemIds);
  const unused = items.filter((i) => !excluded.has(i.id));
  const pool = unused.length > 0 ? unused : items;
  const banded = pool.filter((i) => i.levelBands.includes(levelBand));
  const candidates = banded.length > 0 ? banded : pool;
  return [...candidates].sort((a, b) => a.difficultyB - b.difficultyB)[0];
}

export interface SelectOptions {
  readonly timeoutMs: number;
  readonly rubricId: string;
}

/**
 * Attempts generation, then falls back to the catalog. The fallback is unconditional: a
 * provider outage, a timeout, an empty response and a non-compliant response all land in
 * the same place, because a candidate mid-loop cannot be shown an error where a question
 * should be.
 */
export async function selectQuestion(
  request: QuestionRequest,
  generator: QuestionGenerator | null,
  items: ItemSource,
  options: SelectOptions,
): Promise<SelectedQuestion> {
  const catalog = items.itemsFor(request.trackId, request.roundType);
  let fallbackReason: string | null = generator === null ? 'no_generator_configured' : null;

  if (generator !== null) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs);
    try {
      const text = await generator.generate(request, controller.signal);
      const reason = rejectionReason(text);
      if (reason === null) {
        return {
          question: text.trim(),
          itemId: null,
          source: 'generated',
          rubricId: options.rubricId,
          fallbackReason: null,
        };
      }
      fallbackReason = reason;
    } catch (error) {
      fallbackReason = error instanceof Error && error.name === 'AbortError'
        ? 'generation_timeout'
        : 'generation_failed';
    } finally {
      clearTimeout(timer);
    }
  }

  const item = chooseCatalogItem(catalog, request.levelBand, request.excludeItemIds);
  if (item === undefined) throw new NoCatalogItemError(request.trackId, request.roundType);
  return {
    question: item.prompt,
    itemId: item.id,
    source: 'catalog_fallback',
    rubricId: item.rubricId,
    fallbackReason,
  };
}
