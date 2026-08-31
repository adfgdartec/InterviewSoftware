'use client';

import { use, useEffect, useState, type ReactElement } from 'react';
import { ScoreWithInterval } from '../../../components/ScoreWithInterval.js';
import { VoiceAnswerButton } from '../../../components/VoiceAnswerButton.js';
import { CameraFramingCheck } from '../../../components/CameraFramingCheck.js';

interface SessionView {
  readonly sessionId: string;
  readonly status: 'in_progress' | 'completed' | 'abandoned' | 'expired';
  readonly trackId: string;
  readonly levelBand: string;
  readonly roundCount: number;
  readonly currentRoundPosition: number;
  readonly currentRoundType: string | null;
  readonly persona: string | null;
  readonly question: string | null;
  readonly pendingTurnId: string | null;
  readonly answeredTurnCount: number;
  readonly videoEligible: boolean;
}

interface DebriefAttribute {
  readonly dimension: string;
  readonly name: string;
  readonly score: { median: number; intervalLow: number; intervalHigh: number };
  readonly display: string;
  readonly quote: string;
  readonly lowInformation: boolean;
}

interface DebriefPacket {
  readonly overallDisplay: string;
  readonly overall: { median: number; intervalLow: number; intervalHigh: number };
  readonly attributes: readonly DebriefAttribute[];
  readonly gaps: readonly string[];
  readonly practiceFocus: readonly DebriefAttribute[];
  readonly methodNote: string;
  readonly calibrationLink: string;
}

async function readJson<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

const PRIMARY_BUTTON_CLASS =
  'rounded-md bg-plum-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-plum-900 disabled:cursor-not-allowed disabled:opacity-60';

/**
 * The actual loop-taking UI: shows the current question, takes an answer, submits it to the
 * real /turns route, and repeats until the loop is complete -- then fetches and renders the
 * real, graded debrief. This is the page the prep page's Start button had nowhere to send
 * anyone to before this change.
 */
export default function SessionPage({ params }: { params: Promise<{ id: string }> }): ReactElement {
  const { id } = use(params);
  const [view, setView] = useState<SessionView | null>(null);
  const [answer, setAnswer] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [debrief, setDebrief] = useState<DebriefPacket | null>(null);
  const [gradingError, setGradingError] = useState<string | null>(null);
  const [grading, setGrading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      const res = await fetch(`/api/sessions/${id}`);
      if (cancelled) return;
      if (!res.ok) {
        const body = await readJson<{ error?: string }>(res);
        setError(body.error ?? `Could not load this session (HTTP ${res.status}).`);
        return;
      }
      setView(await readJson<SessionView>(res));
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [id]);

  async function submitAnswer(): Promise<void> {
    if (view === null || view.pendingTurnId === null || answer.trim() === '') return;
    setSubmitting(true);
    setError(null);
    const res = await fetch(`/api/sessions/${id}/turns`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
      body: JSON.stringify({ turnId: view.pendingTurnId, transcript: answer.trim() }),
    });
    if (!res.ok) {
      const body = await readJson<{ error?: string }>(res);
      setError(body.error ?? `Could not submit that answer (HTTP ${res.status}).`);
      setSubmitting(false);
      return;
    }
    setView(await readJson<SessionView>(res));
    setAnswer('');
    setSubmitting(false);
  }

  async function fetchDebrief(): Promise<void> {
    setGrading(true);
    setGradingError(null);
    const res = await fetch(`/api/sessions/${id}/debrief`, {
      method: 'POST',
      headers: { 'idempotency-key': crypto.randomUUID() },
    });
    if (!res.ok) {
      const body = await readJson<{ error?: string }>(res);
      setGradingError(body.error ?? `Could not grade this loop (HTTP ${res.status}).`);
      setGrading(false);
      return;
    }
    setDebrief(await readJson<DebriefPacket>(res));
    setGrading(false);
  }

  if (error !== null && view === null) {
    return (
      <>
        <h1 className="text-2xl font-bold text-plum-900">Something went wrong</h1>
        <p role="alert" className="mt-2 text-sm font-medium text-danger">
          {error}
        </p>
        <p className="mt-4">
          <a href="/" className="font-medium text-plum-700 underline hover:text-plum-900">
            Back to the loop list
          </a>
        </p>
      </>
    );
  }

  if (view === null) {
    return <p className="text-neutral-600">Loading your session…</p>;
  }

  return (
    <>
      <h1 className="text-2xl font-bold text-plum-900">
        {view.trackId} &middot; {view.levelBand}
      </h1>
      <p className="mt-1 text-sm text-neutral-600">
        Round {view.currentRoundPosition} of {view.roundCount}
        {view.currentRoundType !== null ? ` — ${view.currentRoundType}` : ''}
        {view.persona !== null ? ` (${view.persona})` : ''}
      </p>

      {view.status === 'in_progress' && view.question !== null ? (
        <section
          aria-labelledby="question-heading"
          className="mt-6 max-w-[65ch] rounded-lg border border-neutral-200 bg-white p-5 shadow-sm"
        >
          <h2 id="question-heading" className="text-lg font-semibold text-plum-900">
            Question
          </h2>
          <p className="mt-2 text-neutral-900">{view.question}</p>
          <label htmlFor="answer" className="mt-4 block text-sm font-medium text-neutral-900">
            Your answer
          </label>
          <textarea
            id="answer"
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            rows={8}
            disabled={submitting}
            className="mt-2 w-full rounded-md border border-neutral-200 p-3 text-sm text-neutral-900 focus:border-gold-600 focus:outline-none focus:ring-2 focus:ring-gold-600"
          />
          {error !== null ? (
            <p role="alert" className="mt-2 text-sm font-medium text-danger">
              {error}
            </p>
          ) : null}
          <div className="mt-4 flex flex-col gap-3 md:flex-row md:items-center">
            <button
              type="button"
              onClick={() => void submitAnswer()}
              disabled={submitting || answer.trim() === ''}
              className={PRIMARY_BUTTON_CLASS}
            >
              {submitting ? 'Submitting…' : 'Submit answer'}
            </button>
            <VoiceAnswerButton disabled={submitting} onTranscribed={(t) => setAnswer(t)} />
          </div>
        </section>
      ) : null}

      {view.status === 'in_progress' && view.videoEligible ? (
        <div className="max-w-[65ch]">
          <CameraFramingCheck />
        </div>
      ) : null}

      {view.status === 'completed' && debrief === null ? (
        <section className="mt-6 rounded-lg border border-neutral-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-plum-900">Loop complete</h2>
          <p className="mt-2 text-sm text-neutral-600">{view.answeredTurnCount} rounds answered.</p>
          {gradingError !== null ? (
            <p role="alert" className="mt-2 text-sm font-medium text-danger">
              {gradingError}
            </p>
          ) : null}
          <button
            type="button"
            onClick={() => void fetchDebrief()}
            disabled={grading}
            className={`mt-4 ${PRIMARY_BUTTON_CLASS}`}
          >
            {grading ? 'Grading…' : 'Get your debrief'}
          </button>
        </section>
      ) : null}

      {debrief !== null ? (
        <section aria-labelledby="debrief-heading" className="mt-8">
          <h2 id="debrief-heading" className="text-xl font-semibold text-plum-900">
            Debrief
          </h2>
          <p className="mt-3 inline-block rounded-lg bg-gold-100 px-4 py-2">
            <span className="text-sm text-neutral-600">Overall: </span>
            <strong className="text-2xl font-bold text-plum-900">{debrief.overallDisplay}</strong>
          </p>
          <p className="mt-2 text-sm text-neutral-600">{debrief.methodNote}</p>

          {debrief.practiceFocus.length > 0 ? (
            <>
              <h3 className="mt-6 text-lg font-semibold text-plum-900">Practice focus</h3>
              <ul className="mt-2 flex flex-wrap gap-2">
                {debrief.practiceFocus.map((a) => (
                  <li
                    key={a.dimension}
                    className="rounded-full bg-plum-100 px-3 py-1 text-sm font-medium text-plum-900"
                  >
                    {a.name}
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          <h3 className="mt-6 text-lg font-semibold text-plum-900">Every dimension</h3>
          <ul className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {debrief.attributes.map((a) => (
              <li key={a.dimension}>
                <ScoreWithInterval
                  label={a.name}
                  median={a.score.median}
                  intervalLow={a.score.intervalLow}
                  intervalHigh={a.score.intervalHigh}
                  lowInformation={a.lowInformation}
                  evidenceQuote={a.quote}
                />
              </li>
            ))}
          </ul>

          {debrief.gaps.length > 0 ? (
            <p className="mt-4 text-sm text-neutral-600">
              No evidence collected for: {debrief.gaps.join(', ')}.
            </p>
          ) : null}
        </section>
      ) : null}
    </>
  );
}
