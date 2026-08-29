import type { Rubric } from '@loopcraft/core';
import { orphanNodes, hasClientToStorePath, type Diagram } from './diagram.js';
import { analyzeJustification, tradeoffCeiling, type JustificationReport } from './justification.js';

/**
 * Design-round grading. Spec §2.3: "grade the artifact plus the transcript together". The
 * diagram alone cannot be graded -- a correct picture drawn without reasoning is exactly the
 * failure mode the rubric exists to catch -- and the transcript alone cannot be graded
 * either, because the artifact is what the candidate committed to.
 */

export interface DesignArtifactFindings {
  readonly justification: JustificationReport;
  readonly orphanNodeLabels: readonly string[];
  readonly hasEndToEndPath: boolean;
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly annotationCount: number;
}

/** Structural facts about the artifact, computed before any model sees it. */
export function analyzeArtifact(d: Diagram, transcript: string): DesignArtifactFindings {
  return {
    justification: analyzeJustification(d, transcript),
    orphanNodeLabels: orphanNodes(d).map((n) => n.label),
    hasEndToEndPath: hasClientToStorePath(d),
    nodeCount: d.nodes.filter((n) => n.kind !== 'annotation_only').length,
    edgeCount: d.edges.length,
    annotationCount: d.annotations.length,
  };
}

/**
 * Renders the artifact for the grader. The grader receives this text, never raw tldraw JSON:
 * a model asked to grade a serialization format grades the format.
 */
export function describeArtifact(d: Diagram, findings: DesignArtifactFindings): string {
  const nodes = d.nodes
    .filter((n) => n.kind !== 'annotation_only')
    .map((n) => `  - ${n.label} (${n.kind})`)
    .join('\n');
  const edges = d.edges
    .map((e) => {
      const from = d.nodes.find((n) => n.id === e.from)?.label ?? e.from;
      const to = d.nodes.find((n) => n.id === e.to)?.label ?? e.to;
      const arrow = e.directed ? '->' : '--';
      return `  - ${from} ${arrow} ${to}${e.label === '' ? '' : ` [${e.label}]`}`;
    })
    .join('\n');
  const notes = d.annotations.map((a) => `  - ${a.text}`).join('\n');

  return [
    `Components (${findings.nodeCount}):`,
    nodes === '' ? '  (none)' : nodes,
    `Connections (${findings.edgeCount}):`,
    edges === '' ? '  (none)' : edges,
    `Annotations (${findings.annotationCount}):`,
    notes === '' ? '  (none)' : notes,
  ].join('\n');
}

export interface DesignDimensionCap {
  readonly dimension: string;
  readonly ceiling: 1 | 2 | 3 | 4 | 5;
  readonly reason: string;
}

/**
 * Structural ceilings derived from the artifact. These bound what the grader may award; they
 * never award anything themselves, and they never subtract. A ceiling states which level's
 * evidence is absent, which is language the published rubric already uses.
 */
export function structuralCeilings(findings: DesignArtifactFindings): readonly DesignDimensionCap[] {
  const caps: DesignDimensionCap[] = [];

  const ceiling = tradeoffCeiling(findings.justification);
  if (ceiling < 5) {
    const unjustified = findings.justification.mentionedUnjustified + findings.justification.neverMentioned;
    caps.push({
      dimension: 'tradeoffs',
      ceiling,
      reason:
        `${unjustified} of ${findings.justification.gradeable} drawn components were not ` +
        'defended with a reason in the transcript.',
    });
  }

  if (findings.orphanNodeLabels.length > 0) {
    caps.push({
      dimension: 'mechanism',
      ceiling: 3,
      reason: `Components drawn but never connected: ${findings.orphanNodeLabels.join(', ')}.`,
    });
  }

  if (!findings.hasEndToEndPath && findings.nodeCount > 0) {
    caps.push({
      dimension: 'mechanism',
      ceiling: 2,
      reason: 'No path from a client to a datastore, so the request path is not expressed.',
    });
  }

  return caps;
}

/** Applies the ceilings to a grader's raw levels. Only ever lowers a level. */
export function applyCeilings(
  levels: Readonly<Record<string, number>>,
  caps: readonly DesignDimensionCap[],
): Record<string, number> {
  const out: Record<string, number> = { ...levels };
  for (const cap of caps) {
    const current = out[cap.dimension];
    if (current === undefined) continue;
    out[cap.dimension] = Math.min(current, cap.ceiling);
  }
  return out;
}

/** Asserts the rubric being used actually declares the dimensions the ceilings target. */
export function ceilingsApplyTo(rubric: Rubric, caps: readonly DesignDimensionCap[]): readonly string[] {
  const declared = new Set(rubric.dimensions.map((d) => d.id));
  return caps.filter((c) => !declared.has(c.dimension)).map((c) => c.dimension);
}
