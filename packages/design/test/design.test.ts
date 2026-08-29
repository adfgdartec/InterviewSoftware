import { describe, expect, it } from 'vitest';
import { rubricById } from '@loopcraft/core';
import {
  DiagramExtractionError,
  analyzeArtifact,
  analyzeJustification,
  applyCeilings,
  ceilingsApplyTo,
  describeArtifact,
  extractDiagram,
  hasClientToStorePath,
  labelTokens,
  orphanNodes,
  sentences,
  structuralCeilings,
  tradeoffCeiling,
} from '../src/index.js';

const GOOD = {
  nodes: [
    { id: 'c', label: 'Mobile client', kind: 'client', x: 0, y: 0 },
    { id: 'g', label: 'API gateway', kind: 'gateway', x: 1, y: 0 },
    { id: 's', label: 'Checkpoint service', kind: 'service', x: 2, y: 0 },
    { id: 'r', label: 'Redis cache', kind: 'cache', x: 2, y: 1 },
    { id: 'd', label: 'Postgres', kind: 'datastore', x: 3, y: 0 },
  ],
  edges: [
    { id: 'e1', from: 'c', to: 'g', label: 'HTTPS', directed: true },
    { id: 'e2', from: 'g', to: 's', label: '', directed: true },
    { id: 'e3', from: 's', to: 'r', label: 'read-through', directed: true },
    { id: 'e4', from: 's', to: 'd', label: 'writes', directed: true },
  ],
  annotations: [{ id: 'a1', text: '40k writes/sec at peak', attachedTo: 's' }],
};

describe('diagram extraction', () => {
  it('accepts a well-formed diagram and applies defaults', () => {
    const d = extractDiagram(GOOD);
    expect(d.nodes).toHaveLength(5);
    expect(d.edges[1]?.label).toBe('');
    expect(d.edges[0]?.directed).toBe(true);
  });

  it('defaults annotations to an empty list', () => {
    const d = extractDiagram({ nodes: [], edges: [] });
    expect(d.annotations).toEqual([]);
  });

  it('rejects an edge pointing at a node that does not exist', () => {
    expect(() =>
      extractDiagram({ ...GOOD, edges: [{ id: 'x', from: 'c', to: 'ghost', label: '', directed: true }] }),
    ).toThrow(/unknown node "ghost"/);
  });

  it('rejects a duplicate node id', () => {
    const dup = { ...GOOD, nodes: [...GOOD.nodes, { ...GOOD.nodes[0]! }] };
    expect(() => extractDiagram(dup)).toThrow(/duplicate node id/);
  });

  it('rejects an annotation attached to a node that does not exist', () => {
    expect(() =>
      extractDiagram({ ...GOOD, annotations: [{ id: 'a', text: 'x', attachedTo: 'ghost' }] }),
    ).toThrow(/unknown node/);
  });

  it('rejects an unknown component kind rather than coercing it', () => {
    const bad = { ...GOOD, nodes: [{ ...GOOD.nodes[0]!, kind: 'blockchain' }] };
    expect(() => extractDiagram(bad)).toThrow(DiagramExtractionError);
  });

  it.each([
    ['not an object', 'a string'],
    ['null', null],
    ['missing nodes', { edges: [] }],
    ['non-finite coordinate', { nodes: [{ id: 'a', label: 'x', kind: 'service', x: Infinity, y: 0 }], edges: [] }],
  ])('rejects %s', (_label, raw) => {
    expect(() => extractDiagram(raw)).toThrow(DiagramExtractionError);
  });

  it('reports every issue at once rather than the first', () => {
    try {
      extractDiagram({ nodes: [], edges: [
        { id: 'e1', from: 'a', to: 'b', label: '', directed: true },
        { id: 'e2', from: 'c', to: 'd', label: '', directed: true },
      ] });
      expect.unreachable();
    } catch (error) {
      expect((error as DiagramExtractionError).issues.length).toBe(4);
    }
  });
});

describe('structural facts', () => {
  it('finds a client-to-datastore path', () => {
    expect(hasClientToStorePath(extractDiagram(GOOD))).toBe(true);
  });

  it('reports no path when the graph is disconnected', () => {
    const broken = extractDiagram({ ...GOOD, edges: GOOD.edges.filter((e) => e.id !== 'e2') });
    expect(hasClientToStorePath(broken)).toBe(false);
  });

  it('reports no path when there is no datastore at all', () => {
    const noStore = extractDiagram({
      nodes: GOOD.nodes.filter((n) => n.kind !== 'datastore'),
      edges: GOOD.edges.filter((e) => e.to !== 'd'),
    });
    expect(hasClientToStorePath(noStore)).toBe(false);
  });

  it('traverses an undirected edge in both directions', () => {
    const undirected = extractDiagram({
      nodes: [
        { id: 'c', label: 'Client', kind: 'client', x: 0, y: 0 },
        { id: 'd', label: 'DB', kind: 'datastore', x: 1, y: 0 },
      ],
      edges: [{ id: 'e', from: 'd', to: 'c', label: '', directed: false }],
    });
    expect(hasClientToStorePath(undirected)).toBe(true);
  });

  it('finds components drawn but never connected', () => {
    const withOrphan = extractDiagram({
      ...GOOD,
      nodes: [...GOOD.nodes, { id: 'k', label: 'Kafka', kind: 'queue', x: 9, y: 9 }],
    });
    expect(orphanNodes(withOrphan).map((n) => n.label)).toEqual(['Kafka']);
  });

  it('does not count annotation-only shapes as orphans', () => {
    const withNote = extractDiagram({
      ...GOOD,
      nodes: [...GOOD.nodes, { id: 'n', label: 'note', kind: 'annotation_only', x: 9, y: 9 }],
    });
    expect(orphanNodes(withNote)).toEqual([]);
  });

  it('terminates on a cycle rather than looping forever', () => {
    const cyclic = extractDiagram({
      nodes: [
        { id: 'c', label: 'Client', kind: 'client', x: 0, y: 0 },
        { id: 'a', label: 'A', kind: 'service', x: 1, y: 0 },
        { id: 'b', label: 'B', kind: 'service', x: 2, y: 0 },
      ],
      edges: [
        { id: 'e1', from: 'c', to: 'a', label: '', directed: true },
        { id: 'e2', from: 'a', to: 'b', label: '', directed: true },
        { id: 'e3', from: 'b', to: 'a', label: '', directed: true },
      ],
    });
    expect(hasClientToStorePath(cyclic)).toBe(false);
  });
});

describe('name-dropping detection (spec §2.3)', () => {
  const diagram = extractDiagram(GOOD);

  it('counts a component defended with a reason as justified', () => {
    const t = 'I would put Redis in front of Postgres because reads dominate writes here by about twenty to one.';
    const report = analyzeJustification(diagram, t);
    const redis = report.components.find((c) => c.label === 'Redis cache');
    expect(redis?.status).toBe('justified');
    expect(redis?.evidence).toContain('because');
  });

  it('flags a component named with no reason attached', () => {
    const t = 'We have a Redis cache and a Postgres database and an API gateway.';
    const report = analyzeJustification(diagram, t);
    expect(report.components.filter((c) => c.status === 'mentioned_unjustified').length).toBeGreaterThan(0);
    expect(report.justified).toBe(0);
  });

  it('flags a component drawn but never spoken about at all', () => {
    const report = analyzeJustification(diagram, 'I would start with the client and the gateway.');
    const postgres = report.components.find((c) => c.label === 'Postgres');
    expect(postgres?.status).toBe('never_mentioned');
    expect(postgres?.evidence).toBeNull();
  });

  it('does not require the exact label wording', () => {
    // "cache" alone should justify "Redis cache".
    const t = 'I would add a cache in front so that repeated reads do not hit the database.';
    const report = analyzeJustification(diagram, t);
    expect(report.components.find((c) => c.label === 'Redis cache')?.status).toBe('justified');
  });

  it.each(['because', 'so that', 'in order to', 'to avoid', 'rather than', 'at the cost of'])(
    'recognises "%s" as a reason',
    (marker) => {
      const t = `I would use Postgres ${marker} the access pattern is relational.`;
      const report = analyzeJustification(diagram, t);
      expect(report.components.find((c) => c.label === 'Postgres')?.status).toBe('justified');
    },
  );

  it('requires the reason in the same sentence as the mention', () => {
    const t = 'I would use Postgres. Separately, we chose the gateway because it terminates TLS.';
    const report = analyzeJustification(diagram, t);
    expect(report.components.find((c) => c.label === 'Postgres')?.status).toBe('mentioned_unjustified');
    expect(report.components.find((c) => c.label === 'API gateway')?.status).toBe('justified');
  });

  it('reports a ratio over gradeable components only', () => {
    const withNote = extractDiagram({
      ...GOOD,
      nodes: [...GOOD.nodes, { id: 'n', label: 'sketch', kind: 'annotation_only', x: 9, y: 9 }],
    });
    expect(analyzeJustification(withNote, '').gradeable).toBe(5);
  });

  it('treats an empty diagram as nothing to justify, not as a failure', () => {
    const empty = extractDiagram({ nodes: [], edges: [] });
    const report = analyzeJustification(empty, 'no diagram drawn');
    expect(report.justifiedRatio).toBe(1);
    expect(tradeoffCeiling(report)).toBe(5);
  });

  it('splits sentences on terminators and newlines', () => {
    expect(sentences('One. Two!\nThree?')).toEqual(['One.', 'Two!', 'Three?']);
    expect(sentences('   ')).toEqual([]);
  });

  it('strips generic kind words from label tokens but never yields nothing', () => {
    expect(labelTokens('Redis cache')).toContain('redis');
    expect(labelTokens('the service layer').length).toBeGreaterThan(0);
  });
});

describe('ceilings bound the grade rather than subtracting from it', () => {
  const diagram = extractDiagram(GOOD);

  it('caps trade-offs when most components are undefended', () => {
    const findings = analyzeArtifact(diagram, 'We have Redis, Postgres, a gateway and a client.');
    const caps = structuralCeilings(findings);
    const tradeoff = caps.find((c) => c.dimension === 'tradeoffs');
    expect(tradeoff).toBeDefined();
    expect(tradeoff!.ceiling).toBeLessThanOrEqual(2);
    expect(tradeoff!.reason).toMatch(/not defended/);
  });

  it('sets no ceiling when everything is defended', () => {
    const t = [
      'The mobile client talks HTTPS to the API gateway because the gateway terminates TLS.',
      'The checkpoint service owns writes so that the write path has one owner.',
      'Redis sits in front because reads dominate.',
      'Postgres is the store since the access pattern is relational.',
    ].join(' ');
    const findings = analyzeArtifact(diagram, t);
    expect(structuralCeilings(findings).find((c) => c.dimension === 'tradeoffs')).toBeUndefined();
  });

  it('caps mechanism when a component is drawn but unconnected', () => {
    const withOrphan = extractDiagram({
      ...GOOD,
      nodes: [...GOOD.nodes, { id: 'k', label: 'Kafka', kind: 'queue', x: 9, y: 9 }],
    });
    const caps = structuralCeilings(analyzeArtifact(withOrphan, 'Kafka because we need buffering.'));
    expect(caps.find((c) => c.dimension === 'mechanism')?.reason).toMatch(/never connected/);
  });

  it('caps mechanism hard when there is no request path at all', () => {
    const disconnected = extractDiagram({ ...GOOD, edges: [] });
    const caps = structuralCeilings(analyzeArtifact(disconnected, ''));
    const mechanism = caps.filter((c) => c.dimension === 'mechanism');
    expect(Math.min(...mechanism.map((c) => c.ceiling))).toBe(2);
  });

  it('only ever lowers a level, never raises one', () => {
    const caps = [{ dimension: 'tradeoffs', ceiling: 2 as const, reason: 'r' }];
    expect(applyCeilings({ tradeoffs: 5, scoping: 4 }, caps)).toEqual({ tradeoffs: 2, scoping: 4 });
    expect(applyCeilings({ tradeoffs: 1 }, caps)).toEqual({ tradeoffs: 1 });
  });

  it('ignores a ceiling for a dimension the grader did not score', () => {
    expect(applyCeilings({ scoping: 4 }, [{ dimension: 'tradeoffs', ceiling: 1, reason: 'r' }]))
      .toEqual({ scoping: 4 });
  });

  it('names any ceiling that does not correspond to a rubric dimension', () => {
    const rubric = rubricById('ml-systems.design.v1')!;
    const caps = [
      { dimension: 'tradeoffs', ceiling: 3 as const, reason: 'r' },
      { dimension: 'invented', ceiling: 3 as const, reason: 'r' },
    ];
    expect(ceilingsApplyTo(rubric, caps)).toEqual(['invented']);
  });
});

describe('artifact description given to the grader', () => {
  it('renders components, connections and annotations as prose, not JSON', () => {
    const d = extractDiagram(GOOD);
    const text = describeArtifact(d, analyzeArtifact(d, ''));
    expect(text).toContain('Mobile client (client)');
    expect(text).toContain('Checkpoint service -> Postgres [writes]');
    expect(text).toContain('40k writes/sec at peak');
    expect(text).not.toContain('{');
  });

  it('says "(none)" rather than rendering an empty section', () => {
    const d = extractDiagram({ nodes: [], edges: [] });
    expect(describeArtifact(d, analyzeArtifact(d, ''))).toContain('(none)');
  });
});
