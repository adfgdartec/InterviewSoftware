import { describe, expect, it, vi } from 'vitest';
import { rubricById, findBannedTokensInText } from '@loopcraft/core';
import {
  GRADER_SAMPLE_COUNT,
  GRADER_TEMPERATURE,
  GraderContractError,
  buildGraderPrompt,
  gradeRound,
  parseSample,
  type GraderSampler,
} from '../src/grader.js';

const RUBRIC = rubricById('shared.domain.v1')!;
const TRANSCRIPT =
  'I would start by pinning down the constraints: request volume, the p99 budget, and ' +
  'whether reads can be stale. Given 40k writes a second the single-node option is out — ' +
  'that is 3.4 billion rows a day at 90 bytes each. The failure I would watch for is a hot ' +
  'shard under key skew, which shows up as rising queue depth with flat throughput.';

function verdicts(levels: readonly number[]): unknown {
  return {
    dimensions: RUBRIC.dimensions.map((d, i) => ({
      dimension: d.id,
      level: levels[i % levels.length],
      evidenceQuote: 'Given 40k writes a second the single-node option is out',
    })),
  };
}

const samplerReturning = (...responses: unknown[]): GraderSampler => ({
  sample: async (_prompt, _temp, index) => responses[(index - 1) % responses.length],
});

describe('the grader prompt (spec §2.6)', () => {
  const prompt = buildGraderPrompt(RUBRIC, TRANSCRIPT);

  it('carries the rubric id, version and every anchor level', () => {
    expect(prompt).toContain(RUBRIC.id);
    expect(prompt).toContain(`version ${RUBRIC.version}`);
    for (const d of RUBRIC.dimensions) {
      expect(prompt).toContain(d.id);
      for (const a of d.anchors) expect(prompt).toContain(a.anchor);
    }
  });

  it('carries the transcript and nothing about the interviewer’s reasoning', () => {
    expect(prompt).toContain(TRANSCRIPT);
    expect(prompt.toLowerCase()).not.toContain('interviewer thought');
    expect(prompt.toLowerCase()).not.toContain('hint given');
  });

  it('contains no affect vocabulary (guardrail 1 covers grader prompts explicitly)', () => {
    const hits = findBannedTokensInText(prompt);
    expect(hits.map((h) => h.token)).toEqual([]);
  });

  it('forbids outcome commentary (spec §5.3)', () => {
    expect(prompt).toMatch(/not comment on hiring outcomes/i);
  });

  it('grades at temperature 0.3 with three samples', () => {
    expect(GRADER_TEMPERATURE).toBe(0.3);
    expect(GRADER_SAMPLE_COUNT).toBe(3);
  });
});

describe('sample validation rejects rather than repairs', () => {
  it('accepts a well-formed sample', () => {
    expect(() => parseSample(verdicts([3]), RUBRIC)).not.toThrow();
  });

  it.each([
    ['a missing dimensions array', {}],
    ['an empty dimensions array', { dimensions: [] }],
    ['a level above the scale', { dimensions: [{ dimension: 'scoping', level: 6, evidenceQuote: 'x' }] }],
    ['a fractional level', { dimensions: [{ dimension: 'scoping', level: 3.5, evidenceQuote: 'x' }] }],
    ['a missing quote', { dimensions: [{ dimension: 'scoping', level: 3 }] }],
    ['not an object', 'a string'],
    ['null', null],
  ])('rejects %s', (_label, raw) => {
    expect(() => parseSample(raw, RUBRIC)).toThrow(GraderContractError);
  });

  it('rejects a dimension the rubric does not declare', () => {
    expect(() =>
      parseSample(
        { dimensions: [{ dimension: 'invented_dimension', level: 4, evidenceQuote: 'x' }] },
        RUBRIC,
      ),
    ).toThrow(/not a dimension of/);
  });

  it('rejects a dimension name that infers an internal state', () => {
    expect(() =>
      parseSample(
        { dimensions: [{ dimension: 'candidateConfidence', level: 4, evidenceQuote: 'x' }] },
        RUBRIC,
      ),
    ).toThrow(GraderContractError);
  });

  it('rejects evidence that paraphrases into affect language instead of quoting', () => {
    expect(() =>
      parseSample(
        {
          dimensions: [
            { dimension: 'scoping', level: 4, evidenceQuote: 'They sounded confident about scale' },
          ],
        },
        RUBRIC,
      ),
    ).toThrow(/internal state rather than quoting/);
  });
});

describe('gradeRound', () => {
  it('aggregates three samples into a median with an interval', async () => {
    const grade = await gradeRound(
      RUBRIC, TRANSCRIPT, samplerReturning(verdicts([3]), verdicts([4]), verdicts([3])),
    );
    expect(grade.samplesCollected).toBe(3);
    expect(grade.rubricId).toBe(RUBRIC.id);
    expect(grade.dimensions).toHaveLength(RUBRIC.dimensions.length);
    for (const d of grade.dimensions) {
      expect(d.sampleCount).toBe(3);
      expect(d.intervalHigh).toBeGreaterThan(d.intervalLow);
      expect(d.evidenceQuote.length).toBeGreaterThan(0);
    }
    expect(grade.overall.intervalHigh).toBeGreaterThan(grade.overall.intervalLow);
  });

  it('takes the median, so one outlying sample does not move the score', async () => {
    const grade = await gradeRound(
      RUBRIC, TRANSCRIPT, samplerReturning(verdicts([4]), verdicts([4]), verdicts([1])),
    );
    expect(grade.dimensions[0]?.median).toBe(4);
    // ...but the interval widens to show the disagreement rather than hiding it.
    expect(grade.dimensions[0]?.halfWidth).toBeGreaterThan(1);
  });

  it('discards a contract-violating sample and grades on the rest', async () => {
    const grade = await gradeRound(
      RUBRIC, TRANSCRIPT,
      samplerReturning(verdicts([3]), { dimensions: [] }, verdicts([3])),
    );
    expect(grade.samplesCollected).toBe(2);
    expect(grade.dimensions[0]?.median).toBe(3);
  });

  it('throws when no sample satisfies the contract, rather than inventing a score', async () => {
    await expect(
      gradeRound(RUBRIC, TRANSCRIPT, samplerReturning({}, {}, {})),
    ).rejects.toThrow(/No grader sample satisfied/);
  });

  it('refuses to grade an empty transcript', async () => {
    await expect(gradeRound(RUBRIC, '   ', samplerReturning(verdicts([3])))).rejects.toThrow(
      /empty transcript/,
    );
  });

  it('rejects a sample count below one', async () => {
    await expect(
      gradeRound(RUBRIC, TRANSCRIPT, samplerReturning(verdicts([3])), 0),
    ).rejects.toThrow(RangeError);
  });

  it('propagates a transport failure rather than scoring around it', async () => {
    const failing: GraderSampler = {
      sample: async () => {
        throw new TypeError('socket hang up');
      },
    };
    await expect(gradeRound(RUBRIC, TRANSCRIPT, failing)).rejects.toThrow(TypeError);
  });

  it('scores only dimensions that at least one sample covered', async () => {
    const partial = {
      dimensions: [
        { dimension: RUBRIC.dimensions[0]!.id, level: 4, evidenceQuote: 'the p99 budget' },
      ],
    };
    const grade = await gradeRound(RUBRIC, TRANSCRIPT, samplerReturning(partial, partial, partial));
    expect(grade.dimensions).toHaveLength(1);
    expect(grade.dimensions[0]?.dimension).toBe(RUBRIC.dimensions[0]?.id);
  });

  it('widens the round interval when dimensions disagree with each other', async () => {
    const agree = await gradeRound(RUBRIC, TRANSCRIPT, samplerReturning(verdicts([3, 3, 3, 3])));
    const spread = await gradeRound(RUBRIC, TRANSCRIPT, samplerReturning(verdicts([1, 2, 4, 5])));
    expect(spread.overall.halfWidth).toBeGreaterThan(agree.overall.halfWidth);
  });
});

/**
 * The n=3 samples used to run in a `for` loop with an `await` inside, so a round cost three
 * round trips end to end and a five-round loop cost fifteen. These pin the concurrency down
 * so a future edit cannot quietly serialise it again, and pin the discard/rethrow rules that
 * had to survive the change.
 */
describe('grading issues its samples concurrently', () => {
  const RUBRIC = rubricById('ml-systems.design.v1')!;
  const TRANSCRIPT =
    'I would shard checkpoint writes across replicas because a node fails every 90 minutes.';

  function validSample(): unknown {
    return {
      dimensions: RUBRIC.dimensions.map((d) => ({
        dimension: d.id,
        level: 3,
        evidenceQuote: 'I would shard checkpoint writes across replicas',
      })),
    };
  }

  it('starts every sample before any of them resolves', async () => {
    let inFlight = 0;
    let peak = 0;
    const release: (() => void)[] = [];

    const grading = gradeRound(RUBRIC, TRANSCRIPT, {
      async sample() {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise<void>((resolve) => release.push(resolve));
        inFlight -= 1;
        return validSample();
      },
    });

    // Yield until all three have registered, then let them finish.
    await vi.waitFor(() => expect(release).toHaveLength(3));
    for (const resolve of release) resolve();
    await grading;

    expect(peak).toBe(3);
  });

  it('still discards a sample that violates the contract and grades on the survivors', async () => {
    let call = 0;
    const grade = await gradeRound(RUBRIC, TRANSCRIPT, {
      async sample() {
        call += 1;
        // The second sample quotes something the candidate never said.
        return call === 2
          ? {
              dimensions: RUBRIC.dimensions.map((d) => ({
                dimension: d.id,
                level: 5,
                evidenceQuote: 'a sentence that is nowhere in the transcript',
              })),
            }
          : validSample();
      },
    });
    expect(grade.samplesCollected).toBe(2);
  });

  it('propagates a non-contract failure rather than grading on what survived it', async () => {
    await expect(
      gradeRound(RUBRIC, TRANSCRIPT, {
        async sample(_prompt, _temperature, index) {
          if (index === 2) throw new Error('upstream 503');
          return validSample();
        },
      }),
    ).rejects.toThrow('upstream 503');
  });

  it('reports the same failure regardless of which sample loses the race', async () => {
    const grading = gradeRound(RUBRIC, TRANSCRIPT, {
      async sample(_prompt, _temperature, index) {
        // Sample 3 fails first in wall-clock terms; sample 2's failure must still be the
        // one reported, because results are walked in sample order.
        if (index === 3) throw new Error('third');
        if (index === 2) {
          await new Promise((resolve) => setTimeout(resolve, 10));
          throw new Error('second');
        }
        return validSample();
      },
    });
    await expect(grading).rejects.toThrow('second');
  });
});
