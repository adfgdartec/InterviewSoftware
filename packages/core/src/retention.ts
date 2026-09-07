/**
 * The published retention schedule.
 *
 * `/compliance` has stated that "retention periods are published" since before any were.
 * This is the single source they are published FROM: the privacy notice renders this table
 * rather than restating it in prose, so the document and the policy cannot drift.
 *
 * Every period is short and every justification is concrete, because a retention period
 * without a reason is a retention period nobody can defend.
 */

export interface RetentionRule {
  readonly what: string;
  /** Null means "kept until the account is deleted", which is a period, not an absence of one. */
  readonly days: number | null;
  readonly why: string;
}

export const RETENTION_SCHEDULE: readonly RetentionRule[] = [
  {
    what: 'Your account, sessions, answers and scores',
    days: null,
    why: 'Progress over time is the product. Deleting your account purges all of it immediately.',
  },
  {
    what: 'Audio you record for transcription',
    days: 0,
    why:
      'Never stored. The recording is sent for transcription and discarded in the same request; '
      + 'only the resulting text is kept as your answer.',
  },
  {
    what: 'Camera frames',
    days: 0,
    why:
      'Never uploaded. Framing is analysed on your device; only counts and ratios are stored, '
      + 'and nothing that could reconstruct an image.',
  },
  {
    what: 'Synthesized interviewer audio',
    days: 30,
    why: 'Cached so the same question is not re-synthesized. Contains nothing about you.',
  },
  {
    what: 'Rate-limit counters',
    days: 1,
    why: 'Abuse prevention. A counter older than its window is meaningless and is swept.',
  },
  {
    what: 'Deletion records in the audit log',
    days: null,
    why:
      'Kept after your account is gone, deliberately: it is the evidence your deletion request '
      + 'was honoured. It holds no interview content and no contact details.',
  },
] as const;

/** Versioned so a consent record can name which schedule the person agreed to. */
export const RETENTION_SCHEDULE_VERSION = '2026-09-06';
