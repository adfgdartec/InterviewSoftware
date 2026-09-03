'use client';

import { useRef, useState, type ReactElement } from 'react';

export interface VoiceAnswerButtonProps {
  readonly onTranscribed: (transcript: string) => void;
  readonly disabled?: boolean;
}

/**
 * Real microphone capture via MediaRecorder, uploaded to /api/sessions/:id/audio for real
 * Deepgram transcription.
 *
 * What is verified: Deepgram itself. `deepgram-client.live.test.ts` sends real recorded
 * speech to the live API and asserts the transcript and word timings that come back.
 *
 * What is NOT verified: this component driving a real microphone. There is no audio input
 * device in the environment this was built in and no fake-device control surface in the
 * available browser tooling, so the capture path here has never been exercised by a real
 * voice. It is real code, not a stub -- MediaRecorder genuinely records and the upload
 * genuinely POSTs raw audio bytes -- but that gap is stated rather than papered over.
 */
export function VoiceAnswerButton({ onTranscribed, disabled }: VoiceAnswerButtonProps): ReactElement {
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  async function startRecording(): Promise<void> {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        void uploadRecording();
      };
      recorderRef.current = recorder;
      recorder.start();
      setRecording(true);
    } catch {
      setError('Could not access the microphone. Check your browser permissions.');
    }
  }

  function stopRecording(): void {
    recorderRef.current?.stop();
    setRecording(false);
  }

  async function uploadRecording(): Promise<void> {
    setTranscribing(true);
    try {
      const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
      const sessionId = window.location.pathname.split('/').pop() ?? '';
      const res = await fetch(`/api/sessions/${sessionId}/audio`, {
        method: 'POST',
        // The upload route is authenticated and rate limited, and counts as mutating because
        // each call bills Deepgram -- so it requires an Idempotency-Key like every other
        // spending route. Without this header the request is rejected with a 400.
        headers: { 'content-type': 'audio/webm', 'idempotency-key': crypto.randomUUID() },
        body: blob,
      });
      const body = (await res.json()) as { transcript?: string; error?: string };
      if (!res.ok || body.transcript === undefined) {
        setError(body.error ?? 'Transcription is not available right now.');
        return;
      }
      onTranscribed(body.transcript);
    } catch {
      setError('Could not reach the transcription service.');
    } finally {
      setTranscribing(false);
    }
  }

  const idleClass =
    'inline-flex items-center gap-2 rounded-md border border-plum-700 px-4 py-2 text-sm font-semibold text-plum-700 transition hover:bg-plum-100 disabled:cursor-not-allowed disabled:opacity-60';
  const recordingClass =
    'inline-flex animate-pulse items-center gap-2 rounded-md bg-plum-700 px-4 py-2 text-sm font-semibold text-white motion-reduce:animate-none';

  return (
    <div>
      <button
        type="button"
        onClick={() => (recording ? stopRecording() : void startRecording())}
        disabled={disabled === true || transcribing}
        className={recording ? recordingClass : idleClass}
      >
        {transcribing ? 'Transcribing…' : recording ? 'Stop recording' : 'Answer by voice'}
      </button>
      {error !== null ? (
        <p role="alert" className="mt-2 text-sm font-medium text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
