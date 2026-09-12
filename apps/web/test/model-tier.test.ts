import { describe, expect, it, vi } from 'vitest';
import { rubricById } from '@loopcraft/core';
import type { ModelEntry } from '@loopcraft/providers';
import { reasoningAvailability, resolveModel } from '../src/server/model-tier.js';
import {
  MAX_TURNS_PER_ROUND,
  decideNextInterviewerAction,
  type InterviewerChat,
  type RoundTurnState,
} from '../src/server/interviewer.js';

const RUBRIC = rubricById('ml-systems.design.v1')!;

function state(overrides: Partial<RoundTurnState> = {}): RoundTurnState {
  return {
    question: 'Design a checkpointing system for a 2,000-GPU training run.',
    priorAnswers: [],
    currentHintRung: null,
    turnsSoFar: 0,
    maxTurns: MAX_TURNS_PER_ROUND,
    ...overrides,
  };
}

/** A substantive answer: long enough that `lowEffort` is false and the model decides. */
const SUBSTANTIVE =
  'I would shard checkpoint writes across data-parallel replicas because a node fails ' +
  'roughly every 90 minutes at this scale, and full-state writes would saturate the network.';

describe('reasoningAvailability', () => {
  it('probes each provider at most once, so three grading samples pay for one probe', async () => {
    const ollama = vi.fn(async () => true);
    const available = reasoningAvailability({ ollamaAvailable: ollama });
    expect(await available('ollama')).toBe(true);
    expect(await available('ollama')).toBe(true);
    expect(await available('ollama')).toBe(true);
    expect(ollama).toHaveBeenCalledTimes(1);
  });

  it('does not share a probe result between operations', async () => {
    const ollama = vi.fn(async () => true);
    await reasoningAvailability({ ollamaAvailable: ollama })('ollama');
    await reasoningAvailability({ ollamaAvailable: ollama })('ollama');
    expect(ollama).toHaveBeenCalledTimes(2);
  });

  it('reports an undeclared provider as unusable rather than throwing', async () => {
    expect(await reasoningAvailability()('anthropic')).toBe(false);
  });

  it('does not probe a local host when the remote tier already answered', async () => {
    const ollama = vi.fn(async () => true);
    const picked = await resolveModel('grading', {
      openaiAvailable: () => true,
      ollamaAvailable: ollama,
    });
    expect(picked?.provider).toBe('openai');
    expect(ollama).not.toHaveBeenCalled();
  });

  it('resolves to the local tier when no key is configured', async () => {
    const picked = await resolveModel('grading', {
      openaiAvailable: () => false,
      ollamaAvailable: async () => true,
    });
    expect(picked?.provider).toBe('ollama');
  });

  it('resolves to nothing when neither tier is usable', async () => {
    const picked = await resolveModel('grading', {
      openaiAvailable: () => false,
      ollamaAvailable: async () => false,
    });
    expect(picked).toBeNull();
  });
});

/**
 * The regression this file exists for. `decideNextInterviewerAction` probed Ollama directly
 * and returned "accept" when it was unreachable. On Workers localhost is never reachable, so
 * EVERY interviewer turn accepted: spec §2.2's back-and-forth did not happen in production,
 * and nothing raised an error to say so -- the round simply always advanced.
 */
describe('the interviewer runs on a remote tier when the local one is unreachable', () => {
  function recordingChat(reply: string): { chat: InterviewerChat; calls: ModelEntry[] } {
    const calls: ModelEntry[] = [];
    return {
      calls,
      chat: async (model) => {
        calls.push(model);
        return reply;
      },
    };
  }

  const workerLike = { openaiAvailable: () => true, ollamaAvailable: async () => false };

  it('still asks the model to decide, instead of short-circuiting to accept', async () => {
    const { chat, calls } = recordingChat(
      JSON.stringify({ action: 'clarify', message: 'Which failure rate are you assuming?' }),
    );
    const d = await decideNextInterviewerAction(
      RUBRIC,
      state({ priorAnswers: [SUBSTANTIVE], turnsSoFar: 1 }),
      { ...workerLike, chat },
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]?.provider).toBe('openai');
    expect(d.action).toBe('clarify');
    expect(d.message).toContain('failure rate');
  });

  it('carries the decision through, so a model that accepts still accepts', async () => {
    const { chat } = recordingChat(JSON.stringify({ action: 'accept', message: 'That covers it.' }));
    const d = await decideNextInterviewerAction(
      RUBRIC,
      state({ priorAnswers: [SUBSTANTIVE], turnsSoFar: 1 }),
      { ...workerLike, chat },
    );
    expect(d.action).toBe('accept');
    expect(d.message).toBe('That covers it.');
  });

  it('generates the hint on the same tier it decided on', async () => {
    const calls: ModelEntry[] = [];
    const chat: InterviewerChat = async (model, options) => {
      calls.push(model);
      return options.json === true
        ? JSON.stringify({ action: 'clarify', message: 'Say more.' })
        : 'What happens when a rank dies mid-write?';
    };
    const d = await decideNextInterviewerAction(
      RUBRIC,
      state({ priorAnswers: ['idk', 'still not sure'], turnsSoFar: 2, currentHintRung: null }),
      { ...workerLike, chat },
    );

    expect(d.action).toBe('hint');
    expect(d.hintRung).toBe('nudge');
    expect(d.message).toBe('What happens when a rank dies mid-write?');
    expect(calls.map((m) => m.provider)).toEqual(['openai', 'openai']);
  });

  it('accepts without calling anything when NO tier is usable', async () => {
    const { chat, calls } = recordingChat('unused');
    const d = await decideNextInterviewerAction(
      RUBRIC,
      state({ priorAnswers: [SUBSTANTIVE], turnsSoFar: 1 }),
      { openaiAvailable: () => false, ollamaAvailable: async () => false, chat },
    );
    expect(calls).toHaveLength(0);
    expect(d.action).toBe('accept');
  });

  it('degrades to accept, not a throw, when the resolved tier errors', async () => {
    const d = await decideNextInterviewerAction(
      RUBRIC,
      state({ priorAnswers: [SUBSTANTIVE], turnsSoFar: 1 }),
      {
        ...workerLike,
        chat: async () => {
          throw new Error('upstream 503');
        },
      },
    );
    expect(d.action).toBe('accept');
  });
});
