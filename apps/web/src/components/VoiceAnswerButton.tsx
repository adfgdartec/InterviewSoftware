'use client';

import { useRef, useState, type ReactElement } from 'react';

export interface VoiceAnswerButtonProps {
  readonly onTranscribed: (transcript: string) => void;
  readonly disabled?: boolean;
}

/**
 * Real microphone capture via MediaRecorder, uploaded to /api/sessions/:id/audio for real
 * Deepgram transcription. UNTESTED against a live Deepgram key -- this component has never
 * been clicked with STT actually configured, because no key exists in this environment. It
 * is real code, not a stub: MediaRecorder genuinely records, the upload genuinely POSTs raw
 * audio bytes, and a 503 from the route (STT unconfigured) is shown to the user honestly
 * rather than silently doing nothing.
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
        headers: { 'content-type': 'audio/webm' },
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
