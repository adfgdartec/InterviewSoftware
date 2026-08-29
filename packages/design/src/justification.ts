import type { Diagram, DiagramNode } from './diagram.js';

/**
 * Spec §2.3: "Penalize component name-dropping without justification, which is the most
 * common real failure mode."
 *
 * A component counts as justified when the transcript both mentions it AND gives a reason
 * in the same sentence. That is deliberately a low bar -- the failure mode being caught is a
 * candidate who draws six boxes and names them, not one who reasons imperfectly. Anything
 * stricter would start grading prose style, which the rubric does not ask for.
 */

/** Phrases that introduce a reason. Matched as substrings inside one sentence. */
export const JUSTIFICATION_MARKERS = [
  'because', 'since', 'so that', 'so we', 'so the', 'in order to', 'which lets',
  'which gives', 'which means', 'to avoid', 'to keep', 'to handle', 'to absorb',
  'otherwise', 'that way', 'the reason', 'trade-off', 'tradeoff', 'instead of',
  'rather than', 'given that', 'this means', 'the point is', 'we need', 'lets us',
  'allows us', 'at the cost of', 'in exchange for',
] as const;

export type JustificationStatus = 'justified' | 'mentioned_unjustified' | 'never_mentioned';

export interface ComponentJustification {
  readonly nodeId: string;
  readonly label: string;
  readonly status: JustificationStatus;
  /** The sentence the verdict was drawn from, so the score is auditable. */
  readonly evidence: string | null;
}

export interface JustificationReport {
  readonly components: readonly ComponentJustification[];
  readonly justified: number;
  readonly mentionedUnjustified: number;
  readonly neverMentioned: number;
  readonly gradeable: number;
  /** Fraction of drawn components carrying a reason. 1 when there is nothing to justify. */
  readonly justifiedRatio: number;
}

/** Splits on sentence terminators, keeping enough context that a clause stays with its claim. */
export function sentences(transcript: string): readonly string[] {
  return transcript
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Tokens that identify a component in prose. Generic kind words are stripped: a candidate
 * saying "we need a cache because reads dominate" has justified the cache, and requiring
 * the exact label "Redis cache" would mark it unjustified on a wording technicality.
 */
const GENERIC_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'for', 'to', 'service', 'server', 'layer',
  'cluster', 'node', 'system', 'store',
]);

export function labelTokens(label: string): readonly string[] {
  const tokens = label
    .toLowerCase()
    .split(/[^a-z0-9+]+/)
    .filter((t) => t.length > 1 && !GENERIC_WORDS.has(t));
  // A label made entirely of generic words still has to be findable, so fall back to them.
  if (tokens.length > 0) return tokens;
  return label.toLowerCase().split(/[^a-z0-9+]+/).filter((t) => t.length > 1);
}

function mentions(sentence: string, tokens: readonly string[]): boolean {
  const lower = sentence.toLowerCase();
  return tokens.some((t) => new RegExp(`\\b${t.replace(/[+]/g, '\\+')}\\b`).test(lower));
}

function hasReason(sentence: string): boolean {
  const lower = sentence.toLowerCase();
  return JUSTIFICATION_MARKERS.some((m) => lower.includes(m));
}

/**
 * Classifies every drawn component. Annotation-only shapes are excluded: they are the
 * candidate's own notes, not claims about architecture.
 */
export function analyzeJustification(d: Diagram, transcript: string): JustificationReport {
  const lines = sentences(transcript);
  const gradeableNodes: DiagramNode[] = d.nodes.filter((n) => n.kind !== 'annotation_only');

  const components: ComponentJustification[] = gradeableNodes.map((node) => {
    const tokens = labelTokens(node.label);
    const mentioned = lines.filter((s) => mentions(s, tokens));
    if (mentioned.length === 0) {
      return { nodeId: node.id, label: node.label, status: 'never_mentioned', evidence: null };
    }
    const justifying = mentioned.find((s) => hasReason(s));
    if (justifying !== undefined) {
      return { nodeId: node.id, label: node.label, status: 'justified', evidence: justifying };
    }
    return {
      nodeId: node.id,
      label: node.label,
      status: 'mentioned_unjustified',
      evidence: mentioned[0] ?? null,
    };
  });

  const justified = components.filter((c) => c.status === 'justified').length;
  const mentionedUnjustified = components.filter((c) => c.status === 'mentioned_unjustified').length;
  const neverMentioned = components.filter((c) => c.status === 'never_mentioned').length;
  const gradeable = components.length;

  return {
    components,
    justified,
    mentionedUnjustified,
    neverMentioned,
    gradeable,
    justifiedRatio: gradeable === 0 ? 1 : justified / gradeable,
  };
}

/**
 * Caps the `tradeoffs` dimension when components were drawn but not defended. This is a
 * ceiling, not a subtraction: the audited prototype applied a flat percentage penalty, which
 * is unanchored and compounds. A cap is expressible in the rubric's own language -- "the
 * evidence for level 4 is absent" -- and cannot stack.
 */
export function tradeoffCeiling(report: JustificationReport): 1 | 2 | 3 | 4 | 5 {
  if (report.gradeable === 0) return 5;
  if (report.justifiedRatio >= 0.8) return 5;
  if (report.justifiedRatio >= 0.6) return 4;
  if (report.justifiedRatio >= 0.4) return 3;
  if (report.justifiedRatio > 0) return 2;
  return 1;
}
