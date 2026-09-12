/**
 * The nine delivery measurements spec §2.7 permits, ported from the FastAPI worker
 * (apps/worker/loopcraft_worker/app.py) that computed them in Python.
 *
 * The port exists because the worker was never deployed and nothing called it: the metrics
 * were correct, tested, and unreachable. The web app runs on Cloudflare Workers, which cannot
 * host a Python process, so a second service would have had to be stood up and paid for to
 * run what is ultimately arithmetic over a transcript and an array of word timings. In
 * TypeScript it runs in-process on the request that already has both.
 *
 * Spec §5.1 / legacy-audit.md defect #1: every measurement here is mechanical -- a count, a
 * rate, a duration, or a keyword match. None infers an internal state of the candidate, and
 * `no-banned-fields.test.ts` fails the build if a field name ever starts to.
 *
 * Pure: no network, no I/O, no clock. That is what makes it safe to call on every submitted
 * turn, and testable without audio.
 */

export interface WordTiming {
  readonly word: string;
  /** Milliseconds from the start of the recording. */
  readonly startMs: number;
  readonly endMs: number;
}

export interface DeliveryMetricsInput {
  readonly transcript: string;
  readonly words: readonly WordTiming[];
  /**
   * When the interviewer's question audio finished, on the same clock as `words`. Anchors
   * responseLatencyMs.
   */
  readonly promptEndMs: number;
}

export interface DeliveryMetrics {
  readonly wordsPerMinute: number;
  readonly fillerRatio: number;
  readonly pauseLengthP50Ms: number;
  readonly pauseLengthP95Ms: number;
  readonly longestMonologueSeconds: number;
  readonly responseLatencyMs: number;
  readonly hedgingDensity: number;
  readonly quantificationDensity: number;
  readonly starSegmentCoverage: number;
}

const FILLER_WORDS = new Set([
  'um', 'umm', 'uh', 'uhh', 'erm', 'hmm', 'like', 'actually', 'basically', 'literally',
]);

const HEDGE_PHRASES = [
  'i think', 'i guess', 'i suppose', 'i believe', 'kind of', 'sort of', 'maybe',
  'probably', 'possibly', 'not sure', 'might be', 'seems like',
] as const;

const STAR_KEYWORDS: Readonly<Record<string, readonly string[]>> = {
  situation: ['situation', 'context', 'background', 'at the time', 'we were'],
  task: ['task', 'goal', 'objective', 'needed to', 'responsible for', 'my job was'],
  action: ['i did', 'i implemented', 'i built', 'i led', 'i decided', 'i created', 'so i'],
  result: [
    'result', 'outcome', 'impact', 'as a result', 'we achieved', 'led to',
    'which reduced', 'which increased',
  ],
};

const NUMBER_PATTERN = /\b\d+(?:\.\d+)?%?\b/g;

/** Gap between consecutive words, in ms, above which a new monologue segment starts. */
const MONOLOGUE_BREAK_MS = 2_000;

/**
 * Linear-interpolation percentile, matching numpy's default 'linear' method -- which is what
 * the Python worker used, so a ported metric reports the same number for the same audio.
 * Returns 0 for an empty input rather than throwing: no pauses is a real answer.
 */
export function percentile(values: readonly number[], pct: number): number {
  if (values.length === 0) return 0;
  const ordered = [...values].sort((a, b) => a - b);
  if (ordered.length === 1) return ordered[0]!;
  const rank = (pct / 100) * (ordered.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.min(lower + 1, ordered.length - 1);
  const frac = rank - lower;
  return ordered[lower]! + (ordered[upper]! - ordered[lower]!) * frac;
}

/** Whitespace-delimited tokens, the same count Python's `re.findall(r"\S+", text)` gives. */
function wordCount(text: string): number {
  return (text.match(/\S+/g) ?? []).length;
}

/** Non-overlapping occurrences of `needle`, matching Python's `str.count`. */
function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

export function computeDeliveryMetrics(input: DeliveryMetricsInput): DeliveryMetrics {
  const { transcript, words, promptEndMs } = input;
  const transcriptLower = transcript.toLowerCase();
  const totalWords = wordCount(transcript);

  // --- timing-derived metrics ---
  let wordsPerMinute = 0;
  let pauseP50 = 0;
  let pauseP95 = 0;
  let longestMonologueSeconds = 0;
  let responseLatencyMs = 0;

  if (words.length >= 2) {
    const ordered = [...words].sort((a, b) => a.startMs - b.startMs);
    const first = ordered[0]!;
    const last = ordered[ordered.length - 1]!;
    const totalDurationMs = last.endMs - first.startMs;

    const gaps: number[] = [];
    for (let i = 0; i < ordered.length - 1; i += 1) {
      gaps.push(Math.max(0, ordered[i + 1]!.startMs - ordered[i]!.endMs));
    }

    wordsPerMinute = totalDurationMs > 0 ? ordered.length / (totalDurationMs / 60_000) : 0;
    pauseP50 = percentile(gaps, 50);
    pauseP95 = percentile(gaps, 95);

    let longestMonologueMs = 0;
    let segmentStart = first.startMs;
    let segmentEnd = first.endMs;
    for (let i = 0; i < ordered.length - 1; i += 1) {
      const current = ordered[i]!;
      const next = ordered[i + 1]!;
      if (next.startMs - current.endMs > MONOLOGUE_BREAK_MS) {
        longestMonologueMs = Math.max(longestMonologueMs, segmentEnd - segmentStart);
        segmentStart = next.startMs;
      }
      segmentEnd = next.endMs;
    }
    longestMonologueMs = Math.max(longestMonologueMs, segmentEnd - segmentStart);
    longestMonologueSeconds = longestMonologueMs / 1000;

    responseLatencyMs = Math.max(0, first.startMs - promptEndMs);
  } else if (words.length === 1) {
    const only = words[0]!;
    longestMonologueSeconds = Math.max(0, only.endMs - only.startMs) / 1000;
    responseLatencyMs = Math.max(0, only.startMs - promptEndMs);
  }

  // --- text-derived metrics ---
  let fillerRatio = 0;
  let hedgingDensity = 0;
  let quantificationDensity = 0;

  if (totalWords > 0) {
    const tokens = transcriptLower.match(/[a-zA-Z']+/g) ?? [];
    const fillerCount = tokens.filter((t) => FILLER_WORDS.has(t)).length;
    fillerRatio = Math.min(1, fillerCount / totalWords);

    const hedgeCount = HEDGE_PHRASES.reduce(
      (sum, phrase) => sum + countOccurrences(transcriptLower, phrase),
      0,
    );
    hedgingDensity = (hedgeCount / totalWords) * 100;

    const numberCount = (transcript.match(NUMBER_PATTERN) ?? []).length;
    quantificationDensity = (numberCount / totalWords) * 100;
  }

  let starSegmentCoverage = 0;
  if (transcript.trim().length > 0) {
    const componentNames = Object.keys(STAR_KEYWORDS);
    const present = componentNames.filter((name) =>
      STAR_KEYWORDS[name]!.some((keyword) => transcriptLower.includes(keyword)),
    ).length;
    starSegmentCoverage = present / componentNames.length;
  }

  return {
    wordsPerMinute,
    fillerRatio,
    pauseLengthP50Ms: pauseP50,
    pauseLengthP95Ms: pauseP95,
    longestMonologueSeconds,
    responseLatencyMs,
    hedgingDensity,
    quantificationDensity,
    starSegmentCoverage,
  };
}
