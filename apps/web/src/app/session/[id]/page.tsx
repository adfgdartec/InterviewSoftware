'use client';

import { use, useEffect, useState, type ReactElement } from 'react';
import { ScoreWithInterval } from '../../../components/ScoreWithInterval.js';
import { VoiceAnswerButton } from '../../../components/VoiceAnswerButton.js';

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
        <h1>Something went wrong</h1>
        <p role="alert">{error}</p>
        <p>
          <a href="/">Back to the loop list</a>
        </p>
      </>
    );
  }

  if (view === null) {
    return <p>Loading your session…</p>;
  }

  return (
    <>
      <h1>{view.trackId} &middot; {view.levelBand}</h1>
      <p className="session-progress">
        Round {view.currentRoundPosition} of {view.roundCount}
        {view.currentRoundType !== null ? ` — ${view.currentRoundType}` : ''}
        {view.persona !== null ? ` (${view.persona})` : ''}
      </p>

      {view.status === 'in_progress' && view.question !== null ? (
        <section aria-labelledby="question-heading">
          <h2 id="question-heading">Question</h2>
          <p className="session-question">{view.question}</p>
          <label htmlFor="answer">Your answer</label>
          <textarea
            id="answer"
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            rows={8}
            disabled={submitting}
          />
          {error !== null ? (
            <p role="alert" className="start-error">
              {error}
            </p>
          ) : null}
          <div className="answer-controls">
            <button type="button" onClick={() => void submitAnswer()} disabled={submitting || answer.trim() === ''}>
              {submitting ? 'Submitting…' : 'Submit answer'}
            </button>
            <VoiceAnswerButton disabled={submitting} onTranscribed={(t) => setAnswer(t)} />
          </div>
        </section>
      ) : null}

      {view.status === 'completed' && debrief === null ? (
        <section>
          <h2>Loop complete</h2>
          <p>{view.answeredTurnCount} rounds answered.</p>
          {gradingError !== null ? (
            <p role="alert" className="start-error">
              {gradingError}
            </p>
          ) : null}
          <button type="button" onClick={() => void fetchDebrief()} disabled={grading}>
            {grading ? 'Grading…' : 'Get your debrief'}
          </button>
        </section>
      ) : null}

      {debrief !== null ? (
        <section aria-labelledby="debrief-heading">
          <h2 id="debrief-heading">Debrief</h2>
          <p>
            Overall: <strong>{debrief.overallDisplay}</strong>
          </p>
          <p className="score__method">{debrief.methodNote}</p>

          {debrief.practiceFocus.length > 0 ? (
            <>
              <h3>Practice focus</h3>
              <ul>
                {debrief.practiceFocus.map((a) => (
                  <li key={a.dimension}>{a.name}</li>
                ))}
              </ul>
            </>
          ) : null}

          <h3>Every dimension</h3>
          <ul className="score-list">
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
            <p className="session-gaps">No evidence collected for: {debrief.gaps.join(', ')}.</p>
          ) : null}
        </section>
      ) : null}
    </>
  );
}
