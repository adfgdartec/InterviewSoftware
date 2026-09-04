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

type Status = 'idle' | 'loading' | 'playing' | 'ready' | 'blocked' | 'unavailable';

/**
 * The interviewer's side of the conversation, spoken aloud. Fetches
 * GET /api/sessions/:id/speech (which returns Cartesia-synthesized MP3 bytes) whenever the
 * question changes, and plays it.
 *
 * The native <audio controls> chrome is deliberately not used: a five-second clip needs a
 * play control, not a scrubber, and the browser's light-grey player is the wrong object in a
 * dark room. The <audio> element is still the thing that plays -- this only replaces its
 * default UI with a single labelled button, which is a complete control for this clip.
 *
 * Audio is an enhancement, never a blocker: the question text is on screen either way, so a
 * 503 (text-to-speech unconfigured) or a network failure renders nothing at all rather than
 * an error the candidate can do nothing about.
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

  async function play(): Promise<void> {
    const audio = audioRef.current;
    if (audio === null) return;
    try {
      audio.currentTime = 0;
      await audio.play();
      setStatus('playing');
    } catch {
      setStatus('unavailable');
    }
  }

  if (status === 'unavailable') return null;

  const label =
    status === 'loading'
      ? 'Loading the question audio'
      : status === 'playing'
        ? 'Speaking…'
        : status === 'blocked'
          ? 'Play the question'
          : 'Play it again';

  return (
    <div className="mt-8 flex items-center gap-3">
      {/* No `controls`: the button below is this element's UI. */}
      <audio
        ref={audioRef}
        onEnded={() => setStatus('ready')}
        onPause={() => setStatus((s) => (s === 'playing' ? 'ready' : s))}
      />
      <button
        type="button"
        onClick={() => void play()}
        disabled={status === 'loading'}
        className="btn btn-quiet"
      >
        <span
          aria-hidden="true"
          className={
            status === 'playing'
              ? 'h-2 w-2 shrink-0 rounded-full bg-gold-600 motion-safe:animate-pulse'
              : 'h-2 w-2 shrink-0 rounded-full bg-current opacity-40'
          }
        />
        {label}
      </button>
    </div>
  );
}
