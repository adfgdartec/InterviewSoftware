import { describe, expect, it } from 'vitest';
import { findBannedTokensInText, findClaimViolations, rubricById } from '@loopcraft/core';
import { aggregate } from '../src/aggregate.js';
import type { RoundGrade } from '../src/grader.js';
import {
  CALIBRATION_PATH,
  EmptyDebriefError,
  METHOD_NOTE,
  assembleDebrief,
  type RoundInput,
} from '../src/debrief.js';

const DOMAIN = rubricById('shared.domain.v1')!;
const BEHAVIORAL = rubricById('shared.behavioral.v1')!;

function grade(rubric: typeof DOMAIN, levels: readonly number[]): RoundGrade {
  const dimensions = rubric.dimensions.map((d, i) => ({
    dimension: d.id,
    evidenceQuote: `Quote supporting ${d.id}`,
    ...aggregate([levels[i % levels.length]!]),
  }));
  return {
    rubricId: rubric.id,
    promptVersion: 'anchored-v1',
    overall: aggregate(dimensions.map((d) => d.median)),
    dimensions,
    samplesCollected: 3,
  };
}

function round(position: number, rubric: typeof DOMAIN, levels: readonly number[]): RoundInput {
  return {
    position,
    roundType: rubric.roundType,
    persona: 'Staff engineer',
    rubric,
    grade: grade(rubric, levels),
  };
}

const INPUT = {
  sessionId: 'session-1',
  trackId: 'ml-systems',
  levelBand: 'L5',
  rounds: [round(1, DOMAIN, [4, 3, 4, 2]), round(2, BEHAVIORAL, [3, 2, 4, 3])],
};

describe('debrief packet assembly (spec §2.1)', () => {
  it('carries evidence for every graded attribute', () => {
    const packet = assembleDebrief(INPUT);
    expect(packet.attributes.length).toBeGreaterThan(0);
    for (const a of packet.attributes) {
      expect(a.quote.length).toBeGreaterThan(0);
      expect(a.name.length).toBeGreaterThan(0);
      expect(a.roundPosition).toBeGreaterThan(0);
    }
  });

  it('surfaces the lowest-scoring round when a dimension appears twice', () => {
    // 'structure' appears in the behavioral rubric; 'scoping' and 'tradeoffs' in both.
    const shared = assembleDebrief({
      sessionId: 's', trackId: 't', levelBand: 'L5',
      rounds: [round(1, DOMAIN, [5]), round(2, DOMAIN, [2])],
    });
    for (const a of shared.attributes) {
      expect(a.score.median).toBe(2);
      expect(a.roundPosition).toBe(2);
    }
  });

  it('reports a dimension with no evidence as a gap, never as a zero', () => {
    const partial: RoundInput = {
      ...round(1, DOMAIN, [4]),
      grade: { ...grade(DOMAIN, [4]), dimensions: [grade(DOMAIN, [4]).dimensions[0]!] },
    };
    const packet = assembleDebrief({ ...INPUT, rounds: [partial] });
    expect(packet.gaps.length).toBe(DOMAIN.dimensions.length - 1);
    expect(packet.attributes.every((a) => a.score.median >= 1)).toBe(true);
  });

  it('ranks practice focus by lowest score', () => {
    const packet = assembleDebrief(INPUT);
    const medians = packet.practiceFocus.map((a) => a.score.median);
    expect([...medians].sort((a, b) => a - b)).toEqual(medians);
    expect(packet.practiceFocus.length).toBeLessThanOrEqual(3);
  });

  it('honours a custom practice-focus count, including zero', () => {
    expect(assembleDebrief({ ...INPUT, practiceFocusCount: 1 }).practiceFocus).toHaveLength(1);
    expect(assembleDebrief({ ...INPUT, practiceFocusCount: 0 }).practiceFocus).toHaveLength(0);
  });

  it('refuses to assemble a packet with no graded rounds', () => {
    expect(() => assembleDebrief({ ...INPUT, rounds: [] })).toThrow(EmptyDebriefError);
  });

  it('refuses when rounds exist but nothing was scored', () => {
    const ungraded: RoundInput = {
      ...round(1, DOMAIN, [3]),
      grade: { ...grade(DOMAIN, [3]), dimensions: [] },
    };
    expect(() => assembleDebrief({ ...INPUT, rounds: [ungraded] })).toThrow(EmptyDebriefError);
  });

  it('flags a low-information attribute when the samples disagreed', () => {
    const disputed: RoundInput = {
      ...round(1, DOMAIN, [3]),
      grade: {
        ...grade(DOMAIN, [3]),
        dimensions: [
          { dimension: 'scoping', evidenceQuote: 'q', ...aggregate([1, 3, 5]) },
        ],
      },
    };
    const packet = assembleDebrief({ ...INPUT, rounds: [disputed] });
    expect(packet.attributes[0]?.lowInformation).toBe(true);
  });
});

describe('every score in the packet carries its interval (acceptance criterion 8)', () => {
  const packet = assembleDebrief(INPUT);

  it('renders each attribute as a median with a spread', () => {
    for (const a of packet.attributes) {
      expect(a.display).toMatch(/^\d\.\d ± \d\.\d$/);
      expect(a.score.intervalHigh).toBeGreaterThan(a.score.intervalLow);
    }
  });

  it('renders the loop score the same way', () => {
    expect(packet.overallDisplay).toMatch(/^\d\.\d ± \d\.\d$/);
    expect(packet.overall.intervalHigh).toBeGreaterThan(packet.overall.intervalLow);
  });

  it('links to the calibration card', () => {
    expect(packet.calibrationLink).toBe(CALIBRATION_PATH);
    expect(packet.methodNote).toBe(METHOD_NOTE);
  });
});

describe('the packet says nothing it is not allowed to say', () => {
  const packet = assembleDebrief(INPUT);

  function strings(): Record<string, string> {
    const out: Record<string, string> = {
      methodNote: packet.methodNote,
      overall: packet.overallDisplay,
    };
    for (const a of packet.attributes) {
      out[`attr.${a.dimension}.name`] = a.name;
      out[`attr.${a.dimension}.quote`] = a.quote;
      out[`attr.${a.dimension}.display`] = a.display;
    }
    return out;
  }

  it('asserts no hiring outcome (guardrail 3)', () => {
    expect(findClaimViolations(strings())).toEqual([]);
  });

  it('states explicitly that scores are not outcome predictions', () => {
    expect(packet.methodNote).toMatch(/not predictions of hiring outcomes/i);
  });

  it('records that the grader is separate from the interviewer (spec §2.6)', () => {
    expect(packet.methodNote).toMatch(/separate from the interviewer/i);
  });

  it('contains no affect vocabulary', () => {
    const offenders = Object.entries(strings())
      .filter(([, v]) => findBannedTokensInText(v).length > 0)
      .map(([k]) => k);
    expect(offenders).toEqual([]);
  });
});
