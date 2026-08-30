import type { GraderSampler } from '@loopcraft/scoring';

/**
 * A HEURISTIC grader, used only because this environment has no configured LLM provider
 * (spec's Ollama-first registry needs a running Ollama; nothing here assumes one). It is
 * not a placeholder that returns a fixed number: it reads the actual submitted transcript
 * and scores it on textual signals a real interviewer would also notice -- length, whether
 * a claim is quantified, whether a reason is given for a choice. It is explicitly NOT a
 * substitute for the real grader in packages/scoring/src/grader.ts, which this still calls
 * through the same GraderSampler port -- swap this file out, not the grading pipeline,
 * once a real model is wired.
 */

const QUANTIFICATION = /\b\d/;
const JUSTIFICATION = /\b(because|since|so that|therefore|given that|in order to)\b/i;

/** Dimension ids appear as "  {id} — {name}" lines in buildGraderPrompt's rubric block. */
function extractDimensionIds(prompt: string): string[] {
  const matches = prompt.matchAll(/^ {2}([a-z_]+) — /gm);
  return [...new Set([...matches].map((m) => m[1]!))];
}

function extractTranscript(prompt: string): string {
  const marker = 'Transcript:\n';
  const index = prompt.indexOf(marker);
  return index === -1 ? '' : prompt.slice(index + marker.length).trim();
}

/**
 * transcriptForRound (grading-service.ts) formats each turn as "Q: {question}\nA: {answer}".
 * Scoring or quoting the combined text would let the INTERVIEWER's own phrasing move the
 * score or end up in the "quoted from your answer" evidence -- a question that happens to
 * contain a number or the word "because" must never inflate the candidate's grade, and a
 * weak answer must never surface the question as if the candidate had said it.
 */
function answerOnlyText(transcript: string): string {
  return transcript
    .split('\n')
    .filter((line) => !line.startsWith('Q: '))
    .map((line) => (line.startsWith('A: ') ? line.slice(3) : line))
    .join(' ')
    .trim();
}

function bestEvidenceSentence(transcript: string): string {
  const sentences = transcript.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
  const withReason = sentences.find((s) => JUSTIFICATION.test(s));
  const withNumber = sentences.find((s) => QUANTIFICATION.test(s));
  const chosen = withReason ?? withNumber ?? sentences[0] ?? transcript;
  return chosen.slice(0, 590);
}

/**
 * Any answer with a number and a reason easily clears +2 on its own, which made every round
 * of a real click-through land on 5 -- a debrief where every dimension ties looks broken,
 * and the assembler keeps the FIRST round's evidence on a tie, so later rounds silently
 * never surface. 5 is reserved for answers that clear length as well as content, so a tie
 * across every dimension of every round stops being the default outcome.
 */
function heuristicLevel(transcript: string): 1 | 2 | 3 | 4 | 5 {
  const hasNumber = QUANTIFICATION.test(transcript);
  const hasReason = JUSTIFICATION.test(transcript);
  let level = 3;
  if (transcript.length < 100) level -= 1;
  if (hasNumber) level += 1;
  if (hasReason) level += 1;
  if (!(hasNumber && hasReason && transcript.length > 500)) level = Math.min(level, 4);
  return Math.max(1, Math.min(5, level)) as 1 | 2 | 3 | 4 | 5;
}

export function heuristicGraderSampler(): GraderSampler {
  return {
    async sample(prompt: string): Promise<unknown> {
      const answer = answerOnlyText(extractTranscript(prompt));
      const dimensionIds = extractDimensionIds(prompt);
      const level = heuristicLevel(answer);
      const evidenceQuote = answer === '' ? 'No answer was given.' : bestEvidenceSentence(answer);
      return {
        dimensions: dimensionIds.map((dimension) => ({ dimension, level, evidenceQuote })),
      };
    },
  };
}
