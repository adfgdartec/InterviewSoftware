import { describe, expect, it } from 'vitest';
import { rubricById } from '@loopcraft/core';
import {
  MAX_TURNS_PER_ROUND,
  decideNextInterviewerAction,
  type RoundTurnState,
} from '../src/server/interviewer.js';

/**
 * Real Ollama calls -- this suite requires `ollama serve` running with the models named in
 * packages/providers/src/registry.ts (llama3.2:latest at minimum). It fails rather than
 * mocking, for the same reason the sandbox escape suite refuses to skip: an interviewer
 * suite that never talked to a model would prove nothing about whether it interviews.
 */

const RUBRIC = rubricById('ml-systems.design.v1')!;
const QUESTION = 'Design a checkpointing system for a 2,000-GPU training run.';

function state(overrides: Partial<RoundTurnState> = {}): RoundTurnState {
  return {
    question: QUESTION,
    priorAnswers: [],
    currentHintRung: null,
    turnsSoFar: 0,
    maxTurns: MAX_TURNS_PER_ROUND,
    ...overrides,
  };
}

describe('the interviewer decision engine (spec §2.2 back-and-forth)', () => {
  it('never decides before any answer exists', async () => {
    const d = await decideNextInterviewerAction(RUBRIC, state());
    expect(d.action).toBe('clarify');
  }, 15_000);

  it('asks a real clarifying question on a vague, low-effort answer', async () => {
    const d = await decideNextInterviewerAction(
      RUBRIC,
      state({ priorAnswers: ['I would just save checkpoints regularly.'], turnsSoFar: 1 }),
    );
    expect(d.action).not.toBe('hint'); // low-effort on turn 1 asks first, hints later
    expect(d.message.length).toBeGreaterThan(10);
    expect(d.message.toLowerCase()).not.toContain('checkpoints regularly');
  }, 20_000);

  it('accepts a specific, evidenced answer instead of demanding exhaustiveness', async () => {
    const strong =
      'I would shard checkpoint writes across data-parallel replicas because a node fails ' +
      'roughly every 90 minutes at this scale, and full-state writes would saturate the ' +
      'network. I would checkpoint optimizer state incrementally, detect a stuck write via a ' +
      'duration metric with a hard timeout, and test recovery by killing a rank mid-write.';
    const d = await decideNextInterviewerAction(
      RUBRIC,
      state({ priorAnswers: [strong], turnsSoFar: 1 }),
    );
    expect(d.action).toBe('accept');
  }, 20_000);

  it('escalates to a hint after repeated low-effort turns, never skipping a rung', async () => {
    const d = await decideNextInterviewerAction(
      RUBRIC,
      state({
        priorAnswers: ['idk', 'not sure', 'maybe shard it'],
        turnsSoFar: 3,
        currentHintRung: null,
      }),
    );
    expect(['hint', 'clarify']).toContain(d.action);
    if (d.action === 'hint') expect(d.hintRung).toBe('nudge'); // the ladder's first rung
  }, 20_000);

  it('never advances the hint ladder by more than one rung at a time', async () => {
    const d = await decideNextInterviewerAction(
      RUBRIC,
      state({
        priorAnswers: ['idk', 'still not sure'],
        turnsSoFar: 2,
        currentHintRung: 'nudge',
      }),
    );
    if (d.action === 'hint') expect(d.hintRung).toBe('constraint');
  }, 20_000);

  it('forces acceptance once the round hits its turn budget, never blocking indefinitely', async () => {
    const d = await decideNextInterviewerAction(
      RUBRIC,
      state({ priorAnswers: ['idk', 'idk', 'idk', 'idk'], turnsSoFar: 4, maxTurns: 4 }),
    );
    expect(d.action).toBe('accept');
  });

  it('degrades to accept, not a hang, when pointed at an unreachable model host', async () => {
    const originalHost = process.env['OLLAMA_HOST'];
    process.env['OLLAMA_HOST'] = 'http://127.0.0.1:1';
    try {
      const d = await decideNextInterviewerAction(
        RUBRIC,
        state({ priorAnswers: ['a reasonable answer'], turnsSoFar: 1 }),
      );
      expect(d.action).toBe('accept');
    } finally {
      if (originalHost === undefined) delete process.env['OLLAMA_HOST'];
      else process.env['OLLAMA_HOST'] = originalHost;
    }
  }, 10_000);
});
