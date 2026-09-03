'use client';

import { useEffect, useRef, useState, type ReactElement } from 'react';

export interface QuestionAudioProps {
  readonly sessionId: string;
  /**
   * The question currently on screen. Only used as a change signal -- the text that actually
   * gets synthesized is read server-side from the session's own pending turn, never sent from
   * here. Because `postTurn` records hints and clarify follow-ups as the new question, this
   * one dependency covers the whole back-and-forth with no extra wiring.
   */
  readonly questionText: string;
}

type Status = 'idle' | 'loading' | 'playing' | 'blocked' | 'unavailable';

/**
 * The interviewer's side of the conversation, spoken aloud. Fetches
 * GET /api/sessions/:id/speech (which returns Cartesia-synthesized MP3 bytes) whenever the
 * question changes, and plays it.
 *
 * Audio is an enhancement, never a blocker: the question text is on screen either way, so a
 * 503 (text-to-speech unconfigured) or a network failure renders nothing at all rather than
 * an error the candidate can do nothing about. The one failure worth surfacing is a browser
 * blocking autoplay before any user gesture, which is both expected on first load and fixable
 * by the candidate -- that one becomes a visible play button.
 */
export function QuestionAudio({ sessionId, questionText }: QuestionAudioProps): ReactElement | null {
  const [status, setStatus] = useState<Status>('idle');
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (questionText.trim() === '') return;
    let cancelled = false;
    let objectUrl: string | null = null;
    setStatus('loading');

    async function speak(): Promise<void> {
      let blob: Blob;
      try {
        const res = await fetch(`/api/sessions/${sessionId}/speech`);
        if (!res.ok) {
          if (!cancelled) setStatus('unavailable');
          return;
        }
        blob = await res.blob();
      } catch {
        if (!cancelled) setStatus('unavailable');
        return;
      }
      if (cancelled) return;

      objectUrl = URL.createObjectURL(blob);
      const audio = audioRef.current;
      if (audio === null) return;
      audio.src = objectUrl;
      try {
        await audio.play();
        if (!cancelled) setStatus('playing');
      } catch (error) {
        // Browsers reject play() with NotAllowedError until the page has seen a user gesture.
        // Clicking the button this renders is itself that gesture, so the same call succeeds
        // from there. Any other rejection means the audio genuinely will not play.
        const blocked = error instanceof DOMException && error.name === 'NotAllowedError';
        if (!cancelled) setStatus(blocked ? 'blocked' : 'unavailable');
      }
    }

    void speak();
    return () => {
      cancelled = true;
      audioRef.current?.pause();
      // Object URLs are per-document and are not collected on their own; a long loop would
      // otherwise leak one per question.
      if (objectUrl !== null) URL.revokeObjectURL(objectUrl);
    };
  }, [sessionId, questionText]);

  async function playFromGesture(): Promise<void> {
    try {
      await audioRef.current?.play();
      setStatus('playing');
    } catch {
      setStatus('unavailable');
    }
  }

  if (status === 'unavailable') return null;

  return (
    <div className="mt-3">
      {/* Controls stay available so the question can be replayed; the element is present in
          every non-unavailable state because play() needs something to play from.
          No <track> element: a caption track with no src is worse than none, and the audio's
          full text alternative is the question itself, rendered verbatim directly above this
          player and always visible. */}
      <audio ref={audioRef} controls aria-label="Listen to the question" className="w-full max-w-sm" />
      {status === 'blocked' ? (
        <button
          type="button"
          onClick={() => void playFromGesture()}
          className="mt-2 inline-flex items-center gap-2 rounded-md border border-plum-700 px-3 py-1.5 text-sm font-semibold text-plum-700 transition hover:bg-plum-100"
        >
          Play question
        </button>
      ) : null}
    </div>
  );
}
