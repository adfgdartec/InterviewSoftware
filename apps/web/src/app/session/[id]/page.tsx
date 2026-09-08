'use client';

import { use, useEffect, useState, type ReactElement } from 'react';
import { ScoreWithInterval } from '../../../components/ScoreWithInterval.js';
import { VoiceAnswerButton } from '../../../components/VoiceAnswerButton.js';
import { CameraPresence } from '../../../components/CameraPresence.js';
import { QuestionAudio } from '../../../components/QuestionAudio.js';

interface SessionView {
  readonly sessionId: string;
  readonly status: 'in_progress' | 'completed' | 'abandoned' | 'expired';
  readonly trackId: string;
  readonly levelBand: string;
  readonly roundCount: number;
  readonly currentRoundPosition: number;
  readonly currentRoundType: string | null;
  readonly currentRoundId: string | null;
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

interface DebriefPresence {
  readonly sampleCount: number;
  readonly detectedCount: number;
  readonly wellFramedRatio: number;
  readonly driftEvents: number;
  readonly longestWellFramedMs: number;
  readonly roundCount: number;
  readonly notes: readonly string[];
}

interface DebriefPacket {
  readonly overallDisplay: string;
  readonly overall: { median: number; intervalLow: number; intervalHigh: number };
  readonly attributes: readonly DebriefAttribute[];
  readonly gaps: readonly string[];
  readonly practiceFocus: readonly DebriefAttribute[];
  readonly methodNote: string;
  readonly calibrationLink: string;
  /** Null whenever the session was not recorded on camera; the section is then absent. */
  readonly presence: DebriefPresence | null;
}

async function readJson<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

/** "4 min 20 s" from a millisecond duration; whole seconds under a minute. */
function duration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} s`;
  return `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
}

/** Position of a 1-5 score along the gauge track, clamped so 1.0 still shows a mark. */
function pct(value: number): number {
  return Math.min(100, Math.max(0, ((value - 1) / 4) * 100));
}

/**
 * The loop-taking UI. While a loop is in progress the page becomes a room: dark, one
 * question at a time, the surrounding product out of the way. When the loop completes the
 * room is left behind and the debrief renders on paper -- a report is a different kind of
 * document from an interview, and it should not be read in the dark.
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
      // A throwing fetch (server restarting, connection dropped) used to reject unhandled,
      // which left the page on "Loading your session..." permanently with no way out. Any
      // failure has to end in a visible, actionable state.
      let res: Response;
      try {
        res = await fetch(`/api/sessions/${id}`);
      } catch {
        if (!cancelled) setError('Could not reach the server. Check your connection and reload.');
        return;
      }
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
        <h1 className="display text-plum-900 text-[length:var(--text-display-s)]">
          Something went wrong
        </h1>
        <p role="alert" className="mt-3 text-sm font-medium text-danger">
          {error}
        </p>
        <p className="mt-6">
          <a href="/" className="btn btn-quiet">
            Back to the loop list
          </a>
        </p>
      </>
    );
  }

  if (view === null) {
    return <p className="label text-neutral-600">Loading your session…</p>;
  }

  const inProgress = view.status === 'in_progress' && view.question !== null;

  return (
    <>
      <h1 className="sr-only">
        {view.trackId} {view.levelBand} rehearsal loop
      </h1>

      {inProgress ? (
        <div className="room overflow-hidden rounded-2xl border border-room-rule shadow-2xl shadow-plum-900/10">
          {/* Where you are, and how much is left. Ticks rather than a percentage: five
              rounds is countable, and a progress bar would imply a smoother scale. */}
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-room-rule px-5 py-4 sm:px-8">
            <div className="min-w-0">
              <p className="label text-room-ink-2">
                {view.trackId} &middot; {view.levelBand}
              </p>
              <p className="mt-1 truncate text-sm text-room-ink">
                {view.currentRoundType}
                {view.persona !== null ? (
                  <span className="text-room-ink-2"> — {view.persona}</span>
                ) : null}
              </p>
            </div>
            <div className="flex flex-col items-start gap-2 sm:items-end">
              <div className="ticks" aria-hidden="true">
                {Array.from({ length: view.roundCount }, (_, i) => (
                  <i
                    key={i}
                    data-done={i + 1 < view.currentRoundPosition}
                    data-current={i + 1 === view.currentRoundPosition}
                  />
                ))}
              </div>
              <p className="label data text-room-ink-2">
                Round {view.currentRoundPosition} of {view.roundCount}
              </p>
            </div>
          </div>

          {/* The stage. The heading stays a real h2 for the landmark relationship; the
              question itself is the thing that gets the size. */}
          <section aria-labelledby="question-heading" className="room-stage px-5 py-12 sm:px-8 sm:py-16">
            <h2 id="question-heading" className="label text-gold-600">
              Question
            </h2>
            <p className="display mt-5 max-w-[26ch] text-balance text-[length:var(--text-display-s)] text-room-ink sm:max-w-[34ch]">
              {view.question}
            </p>
            <QuestionAudio sessionId={id} questionText={view.question ?? ''} />
          </section>

          <div className="border-t border-room-rule px-5 py-6 sm:px-8">
            <label htmlFor="answer" className="label block text-room-ink-2">
              Your answer
            </label>
            <textarea
              id="answer"
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              rows={7}
              disabled={submitting}
              placeholder="Speak it, or type it here."
              className="mt-2 w-full resize-y rounded-lg border border-room-rule bg-room-floor p-4 text-base leading-relaxed text-room-ink placeholder:text-room-ink-2/60 focus:border-gold-600 focus:outline-none"
            />
            {error !== null ? (
              <p role="alert" className="mt-2 text-sm font-medium text-danger">
                {error}
              </p>
            ) : null}
            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <VoiceAnswerButton disabled={submitting} onTranscribed={(t) => setAnswer(t)} />
              <button
                type="button"
                onClick={() => void submitAnswer()}
                disabled={submitting || answer.trim() === ''}
                className="btn btn-primary w-full sm:w-auto"
              >
                {submitting ? 'Submitting…' : 'Submit answer'}
              </button>
            </div>
          </div>

          {view.videoEligible ? (
            <div className="border-t border-room-rule px-5 py-4 sm:px-8">
              {/* Keyed on the round so each round is measured separately -- blending two
                  rounds' samples would report a framing habit that never happened. */}
              <CameraPresence
                roundKey={`${view.sessionId}:${view.currentRoundPosition}`}
                onSummary={(summary) => {
                  // Nine numbers, computed in the browser. Fire-and-forget: framing advice
                  // must never be able to block or fail an interview answer.
                  if (view.currentRoundId === null) return;
                  void fetch(`/api/sessions/${id}/presence`, {
                    method: 'POST',
                    headers: {
                      'content-type': 'application/json',
                      'idempotency-key': crypto.randomUUID(),
                    },
                    body: JSON.stringify({ roundId: view.currentRoundId, ...summary }),
                  }).catch(() => {});
                }}
              />
            </div>
          ) : null}
        </div>
      ) : null}

      {view.status === 'completed' && debrief === null ? (
        <section className="mx-auto max-w-xl py-10 text-center">
          <p className="label text-plum-500">Loop complete</p>
          <h2 className="display mt-3 text-plum-900 text-[length:var(--text-display-s)]">
            {view.answeredTurnCount} rounds answered
          </h2>
          <p className="mt-4 text-neutral-600">
            Grading runs three independent samples per dimension, so this takes a moment.
          </p>
          {gradingError !== null ? (
            <p role="alert" className="mt-3 text-sm font-medium text-danger">
              {gradingError}
            </p>
          ) : null}
          <button
            type="button"
            onClick={() => void fetchDebrief()}
            disabled={grading}
            className="btn btn-primary mt-7"
          >
            {grading ? 'Grading…' : 'Get your debrief'}
          </button>
        </section>
      ) : null}

      {debrief !== null ? (
        <section aria-labelledby="debrief-heading" className="mx-auto max-w-4xl">
          <div className="border-b border-rule-firm pb-3">
            <h2 id="debrief-heading" className="display text-2xl text-plum-900">
              Debrief
            </h2>
          </div>

          {/* The headline reading, typeset as a figure. The interval sits with the number in
              the same element -- there is no layout here that can strip it off. */}
          <div className="mt-8 grid gap-8 sm:grid-cols-[auto_1fr] sm:items-center">
            <p className="data text-[3.5rem] leading-none text-plum-900">
              {debrief.overallDisplay}
            </p>
            <div className="min-w-0">
              <p className="label text-plum-500">Overall, across every dimension</p>
              <div className="gauge mt-3 max-w-sm">
                <span
                  className="gauge-band"
                  style={{
                    left: `${pct(debrief.overall.intervalLow)}%`,
                    right: `${100 - pct(debrief.overall.intervalHigh)}%`,
                  }}
                />
                <span className="gauge-mark" style={{ left: `${pct(debrief.overall.median)}%` }} />
              </div>
              <p className="mt-3 max-w-[62ch] text-sm text-neutral-600">{debrief.methodNote}</p>
            </div>
          </div>

          {debrief.practiceFocus.length > 0 ? (
            <div className="mt-10 rounded-xl border border-gold-600/40 bg-gold-100 p-5">
              <h3 className="label text-plum-900">Practise these next</h3>
              <ul className="mt-3 flex flex-wrap gap-2">
                {debrief.practiceFocus.map((a) => (
                  <li
                    key={a.dimension}
                    className="rounded-full bg-raised px-3 py-1 text-sm font-medium text-plum-900 shadow-sm"
                  >
                    {a.name}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <h3 className="display mt-12 border-b border-rule pb-2 text-xl text-plum-900">
            Every dimension
          </h3>
          <ul className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
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
            <p className="mt-6 border-l-2 border-rule-firm pl-4 text-sm text-neutral-600">
              No evidence was collected for {debrief.gaps.join(', ')} — reported as a gap rather
              than scored as zero.
            </p>
          ) : null}

          {/*
            Camera framing. Deliberately outside "Every dimension" and carrying no score: it is
            not graded, it does not move the overall number, and presenting it beside the
            rubric scores would imply it did. The wording stays on the camera and the position
            in frame, never on the candidate.
          */}
          {debrief.presence !== null ? (
            <section aria-labelledby="framing-heading" className="mt-12">
              <h3
                id="framing-heading"
                className="display border-b border-rule pb-2 text-xl text-plum-900"
              >
                Camera framing
              </h3>
              <p className="mt-3 max-w-[62ch] text-sm text-neutral-600">
                Measured on your device across{' '}
                {debrief.presence.roundCount === 1
                  ? '1 round'
                  : `${debrief.presence.roundCount} rounds`}
                . No video left your machine, and this is not scored — it is setup advice.
              </p>

              <dl className="mt-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
                <div className="rounded-xl border border-rule bg-raised p-4">
                  <dt className="label text-neutral-600">Well framed</dt>
                  <dd className="display mt-1 text-2xl text-plum-900">
                    {Math.round(debrief.presence.wellFramedRatio * 100)}%
                  </dd>
                </div>
                <div className="rounded-xl border border-rule bg-raised p-4">
                  <dt className="label text-neutral-600">Longest steady stretch</dt>
                  <dd className="display mt-1 text-2xl text-plum-900">
                    {duration(debrief.presence.longestWellFramedMs)}
                  </dd>
                </div>
                <div className="rounded-xl border border-rule bg-raised p-4">
                  <dt className="label text-neutral-600">Framing shifts</dt>
                  <dd className="display mt-1 text-2xl text-plum-900">
                    {debrief.presence.driftEvents}
                  </dd>
                </div>
                <div className="rounded-xl border border-rule bg-raised p-4">
                  <dt className="label text-neutral-600">In frame</dt>
                  <dd className="display mt-1 text-2xl text-plum-900">
                    {debrief.presence.sampleCount === 0
                      ? '—'
                      : `${Math.round(
                          (debrief.presence.detectedCount / debrief.presence.sampleCount) * 100,
                        )}%`}
                  </dd>
                </div>
              </dl>

              {debrief.presence.notes.length > 0 ? (
                <ul className="mt-5 space-y-2">
                  {debrief.presence.notes.map((note) => (
                    <li
                      key={note}
                      className="border-l-2 border-rule-firm pl-4 text-sm text-neutral-600"
                    >
                      {note}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-5 border-l-2 border-rule-firm pl-4 text-sm text-neutral-600">
                  Too few samples to say anything useful about your setup.
                </p>
              )}
            </section>
          ) : null}

          <p className="mt-10">
            <a href="/" className="btn btn-quiet">
              Rehearse another loop
            </a>
          </p>
        </section>
      ) : null}
    </>
  );
}
