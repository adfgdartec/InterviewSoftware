'use client';

import { useState, type ReactElement } from 'react';
import { useRouter } from 'next/navigation';

export interface StartLoopButtonProps {
  readonly loopTemplateId: string;
  readonly levelBand: string;
}

/**
 * The one interactive control the prep page was missing. Posts to the real
 * /api/sessions route and navigates to the session it creates -- this is what makes the
 * catalog page a product entry point instead of a read-only brochure.
 */
export function StartLoopButton({ loopTemplateId, levelBand }: StartLoopButtonProps): ReactElement {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start(): Promise<void> {
    setPending(true);
    setError(null);
    try {
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
        body: JSON.stringify({ loopTemplateId, levelBand }),
      });
      const body = (await res.json()) as { sessionId?: string; error?: string };
      if (!res.ok || body.sessionId === undefined) {
        setError(body.error ?? `Could not start this loop (HTTP ${res.status}).`);
        setPending(false);
        return;
      }
      router.push(`/session/${body.sessionId}`);
    } catch {
      setError('Could not reach the server. Is it running?');
      setPending(false);
    }
  }

  return (
    <div className="mt-4">
      <button
        type="button"
        onClick={() => void start()}
        disabled={pending}
        className="w-full rounded-md bg-plum-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-plum-900 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
      >
        {pending ? 'Starting…' : 'Start this loop'}
      </button>
      {error !== null ? (
        <p role="alert" className="mt-2 text-sm font-medium text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
