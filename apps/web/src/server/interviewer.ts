import { chat, ollamaReachable } from '@loopcraft/providers';
import { lookup } from '@loopcraft/providers';
import type { Rubric } from '@loopcraft/core';
import {
  HINT_RUNGS,
  RUNG_POLICY,
  SILENCE_INTERRUPT_MS,
  nextRung,
  type HintRung,
} from '@loopcraft/sandbox';

/**
 * The real interviewer turn loop. Spec §2.2: "an interviewer agent that behaves like an
 * interviewer: asks for clarification first, withholds the optimal approach, offers a hint
 * ladder ..., interrupts on silence longer than 45 seconds, and asks for complexity analysis
 * and test cases before accepting a solution."
 *
 * None of this existed before: the product was one question, one textarea, one submit. This
 * module is what makes a round an actual conversation instead of a single exchange -- a live
 * model decides, after every candidate turn, whether to accept the answer or continue
 * probing, using packages/sandbox's hint ladder as the one-way ratchet it was designed to be
 * (spec's ordering cannot be skipped -- see hints.ts).
 */

export type InterviewerAction = 'clarify' | 'hint' | 'accept' | 'silence_nudge';

export interface InterviewerDecision {
  readonly action: InterviewerAction;
  readonly message: string;
  readonly hintRung: HintRung | null;
}

export interface RoundTurnState {
  readonly question: string;
  /** Prior candidate answers in this round, oldest first. Empty on the first turn. */
  readonly priorAnswers: readonly string[];
  readonly currentHintRung: HintRung | null;
  readonly turnsSoFar: number;
  readonly maxTurns: number;
}

export class InterviewerUnavailableError extends Error {
  constructor(cause: unknown) {
    super('The interviewer model could not be reached.');
    this.name = 'InterviewerUnavailableError';
    this.cause = cause;
  }
}

function systemPrompt(rubric: Rubric): string {
  const dims = rubric.dimensions.map((d) => `- ${d.name}: ${d.description}`).join('\n');
  return [
    'You are conducting one round of a technical interview rehearsal. Behave like a real',
    'interviewer, not a tutor:',
    '- Do not reveal the optimal approach. If the candidate is close, let them keep going.',
    '- Never comment on how the candidate seems, sounds, or felt. Only respond to what they said.',
    '',
    `Dimensions this round is graded on:\n${dims}`,
    '',
    'DECISION RULE, apply it in this order:',
    '1. If the answer is a single vague sentence with no specific claim, action is "clarify".',
    '2. Otherwise, count how many of the dimensions above the answer already gives concrete,',
    '   checkable evidence for (a number, a named mechanism, a specific trade-off -- not just',
    '   a topic mention). If that count is at least half the dimensions, action is "accept",',
    '   even if the answer could theoretically go deeper. A real interviewer moves on once the',
    '   candidate has demonstrated the skill, not once the answer is exhaustive.',
    '3. Otherwise, action is "clarify", naming the ONE dimension with the least evidence so far.',
    '',
    'Reply with strict JSON only: {"action": "clarify"|"accept", "message": "<one or two',
    'sentences spoken to the candidate>"}.',
  ].join('\n');
}

function transcriptSoFar(question: string, priorAnswers: readonly string[]): string {
  const turns = priorAnswers.map((a, i) => `Candidate (turn ${i + 1}): ${a}`).join('\n');
  return `Interviewer: ${question}\n${turns}`;
}

/**
 * One interviewer decision. When the model is unreachable or the round has exhausted its
 * turn budget, this degrades to "accept" rather than blocking the candidate indefinitely --
 * spec §2.2's back-and-forth is a coaching behaviour, not a gate the product can get stuck on.
 */
export async function decideNextInterviewerAction(
  rubric: Rubric,
  state: RoundTurnState,
): Promise<InterviewerDecision> {
  if (state.turnsSoFar >= state.maxTurns) {
    return { action: 'accept', message: "Let's move on to the next round.", hintRung: null };
  }
  if (state.priorAnswers.length === 0) {
    return { action: 'clarify', message: '', hintRung: null };
  }

  const reachable = await ollamaReachable();
  if (!reachable) {
    // Same principle as the catalog fallback in question-generation.ts: a candidate mid-loop
    // cannot be blocked by an unreachable provider.
    return { action: 'accept', message: "Let's move on to the next round.", hintRung: null };
  }

  const registryEntry = lookup('interviewer_turn');
  const latestAnswer = state.priorAnswers[state.priorAnswers.length - 1] ?? '';
  const lowEffort = latestAnswer.trim().length < 40;

  try {
    const raw = await chat(
      {
        model: registryEntry.primary.model,
        // Zero, not the message-generation 0.5 used below: this call decides accept vs.
        // clarify, a binary classification, not prose. A CI run on a different host/backend
        // (CPU vs. Metal) flipped this same "Fine." answer from clarify to accept at 0.4 --
        // sampling variance near a decision boundary, not a config bug. Determinism here is
        // a correctness property, not a style choice.
        temperature: 0,
        timeoutMs: registryEntry.primary.timeoutMs,
        json: true,
        messages: [
          { role: 'system', content: systemPrompt(rubric) },
          { role: 'user', content: transcriptSoFar(state.question, state.priorAnswers) },
        ],
      },
      // Never cache a live decision: it depends on the specific candidate's answer.
      false,
    );
    const parsed = JSON.parse(raw) as { action?: string; message?: string };
    const action = parsed.action === 'clarify' ? 'clarify' : 'accept';
    const message = typeof parsed.message === 'string' ? parsed.message : '';

    if (action === 'accept') {
      return { action: 'accept', message: message || 'Thanks, that covers it.', hintRung: null };
    }

    // A model that keeps asking to clarify on a substantive answer would trap the candidate;
    // the hint ladder is the one escape valve, and it only ever advances, never repeats.
    if (lowEffort || state.turnsSoFar >= 2) {
      const rung = nextRung(state.currentHintRung);
      if (rung !== null) {
        const generated = await generateHint(registryEntry.primary.model, rubric, state.question, rung, latestAnswer);
        return { action: 'hint', message: generated, hintRung: rung };
      }
    }
    return { action: 'clarify', message, hintRung: state.currentHintRung };
  } catch {
    // Malformed JSON from the model, or a transport failure: degrade to accept rather than
    // blocking the candidate on a provider hiccup, same principle as the timeout case above.
    return {
      action: 'accept',
      message: "Let's move on to the next round.",
      hintRung: null,
    };
  }
}

/**
 * RUNG_POLICY (packages/sandbox/src/hints.ts) is documented as "the interviewer's
 * instructions, not text shown to the candidate" -- the first version of this function
 * ignored that and printed the policy text itself as the hint, which is exactly the kind of
 * output that looks real but is actually the internal instruction leaking through. This
 * generates an ACTUAL hint, specific to the question and the candidate's answer, using the
 * policy as the constraint on what the hint may reveal.
 */
async function generateHint(
  model: string,
  rubric: Rubric,
  question: string,
  rung: HintRung,
  latestAnswer: string,
): Promise<string> {
  const registryEntry = lookup('interviewer_turn');
  try {
    const raw = await chat(
      {
        model,
        temperature: 0.5,
        timeoutMs: registryEntry.primary.timeoutMs,
        messages: [
          {
            role: 'system',
            content:
              `You are an interviewer giving one hint. Constraint on what you may reveal: ` +
              `${RUNG_POLICY[rung]} Speak one short sentence directly to the candidate. Do ` +
              `not restate this constraint, do not say the word "constraint" or "hint".`,
          },
          {
            role: 'user',
            content:
              `Question: ${question}\nGraded on: ${rubric.dimensions.map((d) => d.name).join(', ')}\n` +
              `Candidate said: ${latestAnswer}`,
          },
        ],
      },
      // Never cache: the hint must respond to this candidate's specific wrong turn.
      false,
    );
    return raw.trim();
  } catch {
    // The rung still advances even if generation fails, so the ladder cannot get stuck --
    // but the message says so plainly rather than emitting the raw policy text as a fallback.
    return "Let's take a step back and reconsider your approach.";
  }
}

export const MAX_TURNS_PER_ROUND = 4;
export { HINT_RUNGS, SILENCE_INTERRUPT_MS };
