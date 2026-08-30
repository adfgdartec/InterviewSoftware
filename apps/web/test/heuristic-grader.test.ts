import { describe, expect, it } from 'vitest';
import { rubricById } from '@loopcraft/core';
import { buildGraderPrompt } from '@loopcraft/scoring';
import { heuristicGraderSampler } from '../src/server/heuristic-grader.js';

const RUBRIC = rubricById('shared.domain.v1')!;

describe('heuristic grader (demo-only, honestly labeled) calibration', () => {
  it('does not max out on an ordinary quantified-and-justified answer', async () => {
    const prompt = buildGraderPrompt(
      RUBRIC,
      'I would shard writes because that cuts volume at 40,000 writes a second.',
    );
    const raw = (await heuristicGraderSampler().sample(prompt, 0.3, 1)) as {
      dimensions: { level: number }[];
    };
    expect(raw.dimensions.every((d) => d.level <= 4)).toBe(true);
  });

  it('reserves 5 for an answer that is quantified, justified, AND substantial', async () => {
    const long = 'I would shard writes across replicas because that cuts write volume roughly 8x at our scale. '.repeat(6);
    const prompt = buildGraderPrompt(RUBRIC, long);
    const raw = (await heuristicGraderSampler().sample(prompt, 0.3, 1)) as {
      dimensions: { level: number }[];
    };
    expect(raw.dimensions[0]?.level).toBe(5);
  });

  it('scores a short, unjustified answer lower', async () => {
    const prompt = buildGraderPrompt(RUBRIC, 'I would use a database.');
    const raw = (await heuristicGraderSampler().sample(prompt, 0.3, 1)) as {
      dimensions: { level: number }[];
    };
    expect(raw.dimensions[0]?.level).toBeLessThanOrEqual(2);
  });

  it('extracts every declared dimension of the rubric', async () => {
    const prompt = buildGraderPrompt(RUBRIC, 'A reasonable answer.');
    const raw = (await heuristicGraderSampler().sample(prompt, 0.3, 1)) as {
      dimensions: { dimension: string }[];
    };
    expect(raw.dimensions.map((d) => d.dimension).sort()).toEqual(
      RUBRIC.dimensions.map((d) => d.id).sort(),
    );
  });

  it('quotes the actual transcript, never a fixed string', async () => {
    const prompt = buildGraderPrompt(
      RUBRIC,
      'The bottleneck was checkpoint writes because they saturated the network.',
    );
    const raw = (await heuristicGraderSampler().sample(prompt, 0.3, 1)) as {
      dimensions: { evidenceQuote: string }[];
    };
    expect(raw.dimensions[0]?.evidenceQuote).toContain('checkpoint writes');
  });

  it("never quotes the interviewer's question as if the candidate had said it", async () => {
    // Real bug found via a live click-through: transcriptForRound formats each turn as
    // "Q: {question}\nA: {answer}", and a weak answer with no reason/number marker fell
    // through to sentences[0] of the COMBINED text -- which is the question.
    const transcript =
      'Q: Tell me about a time you disagreed with a plan because it seemed risky.\nA: I guess it was fine.';
    const prompt = buildGraderPrompt(RUBRIC, transcript);
    const raw = (await heuristicGraderSampler().sample(prompt, 0.3, 1)) as {
      dimensions: { evidenceQuote: string }[];
    };
    const quote = raw.dimensions[0]?.evidenceQuote ?? '';
    expect(quote).not.toContain('Tell me about a time');
    expect(quote.startsWith('Q:')).toBe(false);
  });

  it("does not let a number or reason word IN THE QUESTION inflate the score", async () => {
    // The question below contains both a number and "because"; the answer contains neither
    // and is short. The score must reflect the answer, not the question's own phrasing.
    const transcript =
      'Q: We saw 40,000 requests fail because of a bad deploy. What would you check first?\nA: Logs.';
    const prompt = buildGraderPrompt(RUBRIC, transcript);
    const raw = (await heuristicGraderSampler().sample(prompt, 0.3, 1)) as {
      dimensions: { level: number }[];
    };
    expect(raw.dimensions[0]?.level).toBeLessThanOrEqual(2);
  });

  it('handles an empty answer without throwing', async () => {
    const prompt = buildGraderPrompt(RUBRIC, '');
    const raw = (await heuristicGraderSampler().sample(prompt, 0.3, 1)) as {
      dimensions: { evidenceQuote: string; level: number }[];
    };
    expect(raw.dimensions[0]?.evidenceQuote).toBe('No answer was given.');
    expect(raw.dimensions[0]?.level).toBe(2);
  });
});
