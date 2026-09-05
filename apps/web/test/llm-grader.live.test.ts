import { describe, expect, it } from 'vitest';
import { RUBRICS } from '@loopcraft/core';
import { openaiConfigured } from '@loopcraft/providers';
import { gradeRound } from '@loopcraft/scoring';
import { llmGraderSampler, parseJsonObject } from '../src/server/llm-grader.js';
import { llmQuestionGenerator, stripWrapping } from '../src/server/llm-question-generator.js';

/**
 * The tests that prove grading is real. Gated on a key like every other live suite, so a
 * contributor without one is skipped rather than failed.
 *
 * What these assert is not "the model returned something". It is that the product's central
 * claim -- a score is evidence-backed and its interval reflects measured disagreement --
 * actually holds. The stub these replace passed every unit test in the repo while scoring
 * everything the same.
 */

const RUBRIC = RUBRICS[0]!;

const STRONG = [
  'Q: Tell me about a system you designed.',
  'A: I led the migration of our feature store from a nightly batch job to a streaming',
  'pipeline. Freshness went from 24 hours to under two minutes while cost stayed flat,',
  'because we moved the expensive joins into a materialised view that only recomputed on',
  'key change rather than recomputing the full table. I measured it with a shadow read',
  'path for two weeks before cutting over, and we kept a rollback switch for a month.',
  'The tradeoff was operational: one more stateful service to run, which we accepted',
  'because the freshness requirement came from a customer-facing SLA.',
].join('\n');

const WEAK = ['Q: Tell me about a system you designed.', 'A: I worked on a pipeline. It went well.'].join('\n');

describe.skipIf(!openaiConfigured())('grading, live', () => {
  it('scores a substantive answer above a vacuous one', async () => {
    const sampler = llmGraderSampler();
    expect(sampler).not.toBeNull();

    const [strong, weak] = await Promise.all([
      gradeRound(RUBRIC, STRONG, sampler!),
      gradeRound(RUBRIC, WEAK, sampler!),
    ]);

    // The whole product rests on this comparison. The stub could not make it: it scored on
    // length and digit-presence, so a long vacuous answer beat a short precise one.
    expect(strong.overall.median).toBeGreaterThan(weak.overall.median);
    expect(weak.overall.median).toBeLessThanOrEqual(3);
  }, 120_000);

  it('quotes the candidate verbatim, not the question and not the rubric', async () => {
    const grade = await gradeRound(RUBRIC, STRONG, llmGraderSampler()!);

    // What the answer actually contains, normalised the same way the contract check does.
    const said = STRONG.split('\n')
      .filter((l) => !l.trimStart().startsWith('Q:'))
      .map((l) => l.replace(/^\s*A:\s*/, ''))
      .join(' ')
      .toLowerCase()
      .replace(/\s+/g, ' ');

    for (const dimension of grade.dimensions) {
      expect(dimension.evidenceQuote.length).toBeGreaterThan(0);
      // A quote from the "Q:" line would credit the candidate with the interviewer's words.
      expect(dimension.evidenceQuote).not.toContain('Tell me about a system you designed');
      // The failure this was written for: the grader returned polished restatements of the
      // RUBRIC ANCHORS, which the debrief then displayed as "Quoted from your answer".
      const quote = dimension.evidenceQuote.toLowerCase().replace(/\s+/g, ' ').trim();
      expect(said).toContain(quote);
    }
  }, 120_000);

  it('scores dimensions differently when the answer is uneven across them', async () => {
    // The symptom that exposed the stub was a debrief reading 4.0 down the page. Asserting
    // that a STRONG answer scores unevenly would be wrong, though -- an answer that is good
    // on every dimension SHOULD score evenly, and an earlier version of this test failed for
    // exactly that reason. The real property is that the grader reads the dimensions
    // separately, so it needs an answer that is deliberately lopsided.
    //
    // This one is well structured and concrete but contains not a single number, so
    // quantification has nothing to evidence while structure has plenty.
    const LOPSIDED = [
      'Q: Tell me about a system you designed.',
      'A: I replaced our nightly batch feature store with a streaming pipeline. First I',
      'shadowed the existing job so I could compare outputs without risk, then I moved the',
      'joins into a materialised view that only recomputed when a key changed, and finally I',
      'cut over behind a flag with a rollback switch. The tradeoff was running one more',
      'stateful service, which we accepted because the freshness requirement came from a',
      'customer commitment. I have no metrics to hand for any of it.',
    ].join('\n');

    const grade = await gradeRound(RUBRIC, LOPSIDED, llmGraderSampler()!);
    const byId = new Map(grade.dimensions.map((d) => [d.dimension, d.median]));
    const structure = byId.get('structure');
    const quantification = byId.get('quantification');

    expect(structure).toBeDefined();
    expect(quantification).toBeDefined();
    expect(quantification!).toBeLessThan(structure!);
  }, 120_000);

  it('collects three genuinely independent samples', async () => {
    // If the coalescer or the semantic cache collapsed the three calls into one, this would
    // still report samplesCollected: 3 while having asked once. Counting distinct calls is
    // what proves independence.
    let calls = 0;
    const sampler = llmGraderSampler();
    const counting = {
      async sample(prompt: string, temperature: number, index: number): Promise<unknown> {
        calls += 1;
        return sampler!.sample(prompt, temperature, index);
      },
    };
    const grade = await gradeRound(RUBRIC, STRONG, counting);

    // Three separate requests actually left the process. This is the assertion that would
    // fail if the coalescer or the semantic cache had collapsed them.
    expect(calls).toBe(3);

    // NOT `toBe(3)`. A sample whose evidence is not a verbatim quote is discarded by the
    // contract, and `samplesCollected` reports how many survived precisely so a degraded
    // grade is visible rather than hidden. Asserting all three always survive would be
    // asserting the contract never fires -- which it does, in the wild, on real answers.
    expect(grade.samplesCollected).toBeGreaterThanOrEqual(1);
    expect(grade.samplesCollected).toBeLessThanOrEqual(3);
  }, 180_000);
});

describe.skipIf(!openaiConfigured())('question generation, live', () => {
  it('writes a question targeted at the round, and never the same one twice', async () => {
    const generator = llmQuestionGenerator();
    expect(generator).not.toBeNull();

    const request = {
      trackId: 'ml-systems',
      roundType: 'domain' as const,
      levelBand: 'L5' as const,
      excludeItemIds: [],
    };

    const [a, b] = await Promise.all([
      generator!.generate(request, new AbortController().signal),
      generator!.generate(request, new AbortController().signal),
    ]);

    for (const q of [a, b]) {
      expect(q.length).toBeGreaterThan(15);
      expect(q.split('\n')).toHaveLength(1);
      expect(q).not.toMatch(/^(?:sure|here'?s|here is)\b/i);
    }
    // The static bank asked one fixed question per round forever. This is the difference.
    expect(a).not.toBe(b);
  }, 60_000);
});

describe('parsing, which needs no key', () => {
  it('recovers JSON from a fenced block', () => {
    const parsed = parseJsonObject('```json\n{"dimensions":[]}\n```');
    expect(parsed).toEqual({ dimensions: [] });
  });

  it('recovers JSON after a chatty preamble', () => {
    expect(parseJsonObject('Here is the JSON:\n{"dimensions":[]}')).toEqual({ dimensions: [] });
  });

  it('throws rather than inventing an object when there is no JSON', () => {
    expect(() => parseJsonObject('I could not grade this.')).toThrow(SyntaxError);
  });

  it('strips the wrappers a model adds to a question', () => {
    expect(stripWrapping('Sure! Here is a question: What did you own?')).toBe('What did you own?');
    expect(stripWrapping('"What did you own?"')).toBe('What did you own?');
    expect(stripWrapping('1. What did you own?\n2. Something else')).toBe('What did you own?');
  });
});
