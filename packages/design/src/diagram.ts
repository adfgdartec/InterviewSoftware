import { z } from 'zod';

/**
 * Structured extraction of a system-design diagram. Spec §2.3: "Extract the diagram to
 * structured JSON (nodes, edges, labels, annotations) and grade the artifact plus the
 * transcript together against a design rubric."
 *
 * The canvas surface is tldraw (named in the spec, so no choice to make). What is stored and
 * graded is this normalized shape, not tldraw's internal document: a vendor's serialization
 * format is not a stable grading substrate, and a rubric anchored to it would break on their
 * next release.
 */

export const NODE_KINDS = [
  'client', 'service', 'datastore', 'cache', 'queue', 'gateway',
  'external', 'compute', 'annotation_only',
] as const;
export type NodeKind = (typeof NODE_KINDS)[number];

export const diagramNode = z.object({
  id: z.string().min(1),
  label: z.string().min(1).max(120),
  kind: z.enum(NODE_KINDS),
  x: z.number().finite(),
  y: z.number().finite(),
});

export const diagramEdge = z.object({
  id: z.string().min(1),
  from: z.string().min(1),
  to: z.string().min(1),
  label: z.string().max(120).default(''),
  directed: z.boolean().default(true),
});

export const diagramAnnotation = z.object({
  id: z.string().min(1),
  text: z.string().min(1).max(600),
  attachedTo: z.string().nullable().default(null),
});

export const diagram = z.object({
  nodes: z.array(diagramNode),
  edges: z.array(diagramEdge),
  annotations: z.array(diagramAnnotation).default([]),
});

export type DiagramNode = z.infer<typeof diagramNode>;
export type DiagramEdge = z.infer<typeof diagramEdge>;
export type DiagramAnnotation = z.infer<typeof diagramAnnotation>;
export type Diagram = z.infer<typeof diagram>;

export class DiagramExtractionError extends Error {
  constructor(public readonly issues: readonly string[]) {
    super(`Diagram could not be extracted: ${issues.join('; ')}`);
    this.name = 'DiagramExtractionError';
  }
}

/**
 * Validates and normalizes a diagram. Referential integrity is checked here rather than
 * during grading: an edge pointing at a node that does not exist is a broken artifact, and
 * grading it would silently score a diagram nobody drew.
 */
export function extractDiagram(raw: unknown): Diagram {
  const parsed = diagram.safeParse(raw);
  if (!parsed.success) {
    throw new DiagramExtractionError(
      parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    );
  }
  const value = parsed.data;
  const issues: string[] = [];

  const ids = new Set<string>();
  for (const node of value.nodes) {
    if (ids.has(node.id)) issues.push(`duplicate node id "${node.id}"`);
    ids.add(node.id);
  }
  for (const edge of value.edges) {
    if (!ids.has(edge.from)) issues.push(`edge "${edge.id}" starts at unknown node "${edge.from}"`);
    if (!ids.has(edge.to)) issues.push(`edge "${edge.id}" ends at unknown node "${edge.to}"`);
  }
  for (const annotation of value.annotations) {
    if (annotation.attachedTo !== null && !ids.has(annotation.attachedTo)) {
      issues.push(`annotation "${annotation.id}" attached to unknown node "${annotation.attachedTo}"`);
    }
  }
  if (issues.length > 0) throw new DiagramExtractionError(issues);
  return value;
}

/** Nodes with no edge in either direction. A component drawn but never connected. */
export function orphanNodes(d: Diagram): readonly DiagramNode[] {
  const connected = new Set<string>();
  for (const edge of d.edges) {
    connected.add(edge.from);
    connected.add(edge.to);
  }
  return d.nodes.filter((n) => n.kind !== 'annotation_only' && !connected.has(n.id));
}

/** True when the graph has at least one path from a client to a datastore. */
export function hasClientToStorePath(d: Diagram): boolean {
  const adjacency = new Map<string, string[]>();
  for (const edge of d.edges) {
    adjacency.set(edge.from, [...(adjacency.get(edge.from) ?? []), edge.to]);
    if (!edge.directed) adjacency.set(edge.to, [...(adjacency.get(edge.to) ?? []), edge.from]);
  }
  const stores = new Set(d.nodes.filter((n) => n.kind === 'datastore').map((n) => n.id));
  if (stores.size === 0) return false;

  for (const start of d.nodes.filter((n) => n.kind === 'client')) {
    const seen = new Set<string>();
    const stack = [start.id];
    while (stack.length > 0) {
      const current = stack.pop();
      if (current === undefined || seen.has(current)) continue;
      seen.add(current);
      if (stores.has(current)) return true;
      stack.push(...(adjacency.get(current) ?? []));
    }
  }
  return false;
}
