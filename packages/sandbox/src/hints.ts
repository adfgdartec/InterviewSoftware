/**
 * The hint ladder and its scoring. Spec §2.2: an interviewer agent "offers a hint ladder
 * (nudge -> constraint -> structure -> partial solution)" and "hint dependence is the single
 * most predictive signal you can compute and nobody else surfaces it."
 *
 * The ladder is strictly ordered and cannot be skipped. An interviewer who jumps straight to
 * a partial solution has destroyed the signal: you can no longer tell whether the candidate
 * would have found the structure themselves. `nextRung` therefore only ever advances by one.
 */

export const HINT_RUNGS = ['nudge', 'constraint', 'structure', 'partial_solution'] as const;
export type HintRung = (typeof HINT_RUNGS)[number];

/**
 * What each rung is permitted to reveal. These are the interviewer's instructions, not text
 * shown to the candidate -- the wording is generated per item against these constraints.
 */
export const RUNG_POLICY: Readonly<Record<HintRung, string>> = {
  nudge:
    'Redirect attention to the part of the problem that matters. Reveal no approach, no data ' +
    'structure and no complexity target.',
  constraint:
    'State a constraint the candidate has not yet used, such as an input bound or a required ' +
    'complexity. Still reveal no approach.',
  structure:
    'Name the shape of the solution -- the data structure or the algorithmic family -- without ' +
    'writing any of it.',
  partial_solution:
    'Give the first concrete step or the loop skeleton. This is the last rung; nothing beyond ' +
    'it may be offered.',
};

/** Silence threshold before the interviewer speaks unprompted (spec §2.2). */
export const SILENCE_INTERRUPT_MS = 45_000;

export class HintLadderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HintLadderError';
  }
}

/** The next rung after `current`, or null when the ladder is exhausted. */
export function nextRung(current: HintRung | null): HintRung | null {
  if (current === null) return 'nudge';
  const index = HINT_RUNGS.indexOf(current);
  if (index === -1) throw new HintLadderError(`Unknown hint rung "${current}".`);
  return HINT_RUNGS[index + 1] ?? null;
}

export interface HintEvent {
  readonly rung: HintRung;
  /** Milliseconds from the start of the round, so pacing is auditable. */
  readonly atMs: number;
  /** True when the interviewer offered it after silence rather than the candidate asking. */
  readonly unprompted: boolean;
}

/**
 * Validates a sequence of hints actually offered. Rungs must be strictly ascending with no
 * skips, because a skipped rung means the recorded dependence score is not comparable to
 * anyone else's.
 */
export function assertLadderIntegrity(events: readonly HintEvent[]): void {
  let previous: HintRung | null = null;
  for (const event of events) {
    const expected = nextRung(previous);
    if (expected === null) {
      throw new HintLadderError('A hint was offered after the ladder was exhausted.');
    }
    if (event.rung !== expected) {
      throw new HintLadderError(
        `Hint ladder skipped: expected "${expected}" after ${previous ?? 'no hint'}, got "${event.rung}".`,
      );
    }
    previous = event.rung;
  }
}

export interface SilenceWindow {
  readonly startedMs: number;
  readonly endedMs: number;
}

/** Silences long enough to warrant the interviewer speaking first (spec §2.2). */
export function interruptibleSilences(
  windows: readonly SilenceWindow[],
  thresholdMs: number = SILENCE_INTERRUPT_MS,
): readonly SilenceWindow[] {
  for (const w of windows) {
    if (w.endedMs < w.startedMs) {
      throw new HintLadderError(`Silence window ends (${w.endedMs}) before it starts (${w.startedMs}).`);
    }
  }
  return windows.filter((w) => w.endedMs - w.startedMs >= thresholdMs);
}

export interface HintDependence {
  /** Highest rung reached, or null when the candidate needed no hint. */
  readonly deepestRung: HintRung | null;
  readonly hintCount: number;
  readonly unpromptedCount: number;
  /** 1-5 on the ml-systems.coding.v1 `hint_dependence` anchors. Higher means less dependent. */
  readonly anchorLevel: 1 | 2 | 3 | 4 | 5;
  readonly rationale: string;
}

/**
 * Maps the ladder actually used onto the published `hint_dependence` anchors. The mapping is
 * a pure function of the deepest rung reached, so two candidates who needed the same
 * scaffolding get the same level regardless of who graded them -- which is the whole reason
 * this signal is worth surfacing.
 */
export function scoreHintDependence(events: readonly HintEvent[]): HintDependence {
  assertLadderIntegrity(events);
  const deepestRung = events.length === 0 ? null : (events[events.length - 1]?.rung ?? null);
  const unpromptedCount = events.filter((e) => e.unprompted).length;

  const byRung: Record<string, { level: 1 | 2 | 3 | 4 | 5; why: string }> = {
    partial_solution: { level: 1, why: 'Required a partial solution before progress resumed.' },
    structure: { level: 2, why: 'Required a structural hint to reach the approach.' },
    constraint: { level: 3, why: 'Required a constraint-level nudge.' },
    nudge: { level: 4, why: 'Required only a light nudge, and extended it independently.' },
  };
  const mapped =
    deepestRung === null
      ? { level: 5 as const, why: 'Reached and refined the solution without scaffolding.' }
      : byRung[deepestRung];
  if (mapped === undefined) throw new HintLadderError(`Unscoreable rung "${deepestRung}".`);

  return {
    deepestRung,
    hintCount: events.length,
    unpromptedCount,
    anchorLevel: mapped.level,
    rationale: mapped.why,
  };
}
