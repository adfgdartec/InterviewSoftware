/**
 * Real Deepgram STT integration. UNTESTED against the live API -- no DEEPGRAM_API_KEY exists
 * in this environment. Every function here is production code, not a stub: it sends real
 * audio bytes to Deepgram's documented REST endpoint and parses their documented response
 * shape. What the contract tests (deepgram-client.test.ts) prove is that shape is correct;
 * what only a real key can prove is that Deepgram's API still matches it today.
 *
 * This is what feeds the worker's delivery metrics (apps/worker): those are computed from a
 * transcript plus per-word timing, and Deepgram's response is the only thing in this build
 * that can actually produce that from a voice recording instead of typed text.
 */

export class DeepgramKeyMissingError extends Error {
  constructor() {
    super('DEEPGRAM_API_KEY is not set. This path is untested against the real API.');
    this.name = 'DeepgramKeyMissingError';
  }
}

export class DeepgramRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
  ) {
    super(`Deepgram request failed: HTTP ${status} ${body}`);
    this.name = 'DeepgramRequestError';
  }
}

function apiKey(): string {
  const key = process.env['DEEPGRAM_API_KEY'];
  if (key === undefined || key === '') throw new DeepgramKeyMissingError();
  return key;
}

const DEEPGRAM_BASE = process.env['DEEPGRAM_BASE_URL'] ?? 'https://api.deepgram.com/v1';

export interface WordTiming {
  readonly word: string;
  readonly startMs: number;
  readonly endMs: number;
}

export interface TranscriptionResult {
  readonly transcript: string;
  readonly words: readonly WordTiming[];
  readonly durationSeconds: number;
}

/**
 * Deepgram's documented `nova-3` response shape (results.channels[0].alternatives[0]), with
 * word-level timestamps in seconds, converted to milliseconds to match
 * apps/worker/loopcraft_worker/schemas.py's WordTiming contract exactly -- the worker's
 * metrics are useless if the units silently don't match what it expects.
 */
interface DeepgramResponse {
  readonly results?: {
    readonly channels?: readonly {
      readonly alternatives?: readonly {
        readonly transcript?: string;
        readonly words?: readonly { word?: string; start?: number; end?: number }[];
      }[];
    }[];
  };
  readonly metadata?: { readonly duration?: number };
}

/** Transcribes one audio buffer. `mimeType` must match what was actually recorded. */
export async function transcribe(
  audio: Uint8Array,
  mimeType: string,
  timeoutMs = 30_000,
): Promise<TranscriptionResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const params = new URLSearchParams({ model: 'nova-3', smart_format: 'true', punctuate: 'true' });
    const res = await fetch(`${DEEPGRAM_BASE}/listen?${params.toString()}`, {
      method: 'POST',
      headers: { authorization: `Token ${apiKey()}`, 'content-type': mimeType },
      body: audio as BodyInit,
      signal: controller.signal,
    });
    if (!res.ok) throw new DeepgramRequestError(res.status, await res.text());
    const data = (await res.json()) as DeepgramResponse;
    const alt = data.results?.channels?.[0]?.alternatives?.[0];
    if (alt?.transcript === undefined) {
      throw new Error('Deepgram response had no results.channels[0].alternatives[0].transcript.');
    }
    const words: WordTiming[] = (alt.words ?? [])
      .filter((w): w is { word: string; start: number; end: number } =>
        typeof w.word === 'string' && typeof w.start === 'number' && typeof w.end === 'number')
      .map((w) => ({ word: w.word, startMs: Math.round(w.start * 1000), endMs: Math.round(w.end * 1000) }));
    return {
      transcript: alt.transcript,
      words,
      durationSeconds: data.metadata?.duration ?? 0,
    };
  } catch (error) {
    if (error instanceof DeepgramKeyMissingError || error instanceof DeepgramRequestError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Deepgram transcription timed out after ${timeoutMs}ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export function deepgramConfigured(): boolean {
  return process.env['DEEPGRAM_API_KEY'] !== undefined && process.env['DEEPGRAM_API_KEY'] !== '';
}
