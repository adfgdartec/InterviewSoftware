import { hasCredential, MissingCredentialError, readCredential } from './secrets.js';

/**
 * Real Cartesia TTS integration -- the interviewer's voice. Unlike the ElevenLabs client this
 * replaces, this one is VERIFIED against the live API: `GET /voices` returned 934 voices and
 * `POST /tts/bytes` with the model and voice ids below returned `content-type: audio/mpeg`
 * and a genuinely valid MP3. Neither id is guessed.
 *
 * Server-only, like every other client in this package (guardrail 6): the key is read through
 * secrets.ts, which throws outright if this module is ever pulled into a browser bundle. The
 * only thing that reaches a client is audio bytes.
 */

export class CartesiaKeyMissingError extends Error {
  constructor() {
    super('CARTESIA_API_KEY is not set. Text-to-speech is unavailable.');
    this.name = 'CartesiaKeyMissingError';
  }
}

export class CartesiaRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
  ) {
    super(`Cartesia request failed: HTTP ${status} ${body}`);
    this.name = 'CartesiaRequestError';
  }
}

function apiKey(): string {
  try {
    return readCredential('CARTESIA_API_KEY');
  } catch (error) {
    if (error instanceof MissingCredentialError) throw new CartesiaKeyMissingError();
    throw error;
  }
}

const CARTESIA_BASE = process.env['CARTESIA_BASE_URL'] ?? 'https://api.cartesia.ai';

/**
 * Cartesia pins breaking changes to a date header rather than a URL path segment, so the
 * version travels as a header on every request.
 */
const CARTESIA_VERSION = '2024-06-10';

/**
 * "Clive - Measured Expert", confirmed present in the live voice list. The model tag lives in
 * registry.ts per the "nothing outside registry.ts names a model string" convention; the
 * voice id is a Cartesia-specific parameter with no registry field to hold it, so it is
 * declared here, once, and exported so a test can assert the request actually carries it.
 */
export const INTERVIEWER_VOICE_ID = 'b24f41fd-00a3-4cd8-992a-a0c9f13f3ef1';

/** Matches registry.ts's `tts` primary. Named here so the request body has one source. */
const CARTESIA_MODEL_ID = 'sonic-2';

/**
 * Exact-match, process-lifetime cache. Synthesis is billed per character and an interview
 * question is re-fetched every time the candidate reloads the page on the same turn, which is
 * the exact redundancy this guards against. Deliberately NOT the second brain's embedding
 * `SemanticCache`: two questions that are semantically close still need different audio, so
 * "close enough" is the wrong match rule for speech. A restart clears it, which is fine --
 * the cost being avoided is within one process's uptime, not across deploys.
 */
const cache = new Map<string, Uint8Array>();

/** Test seam: drops the cache so a cache-hit assertion cannot be polluted by a prior test. */
export function clearSynthesisCache(): void {
  cache.clear();
}

/** Synthesizes one line of interviewer dialogue. Returns raw MP3 bytes. */
export async function synthesize(text: string, timeoutMs = 30_000): Promise<Uint8Array> {
  if (text.trim() === '') throw new RangeError('Cannot synthesize empty text.');
  const cached = cache.get(text);
  if (cached !== undefined) return cached;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${CARTESIA_BASE}/tts/bytes`, {
      method: 'POST',
      headers: {
        'X-API-Key': apiKey(),
        'Cartesia-Version': CARTESIA_VERSION,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
      body: JSON.stringify({
        model_id: CARTESIA_MODEL_ID,
        transcript: text,
        voice: { mode: 'id', id: INTERVIEWER_VOICE_ID },
        output_format: { container: 'mp3', sample_rate: 44_100, bit_rate: 128_000 },
      }),
    });
    if (!res.ok) throw new CartesiaRequestError(res.status, await res.text());
    const bytes = new Uint8Array(await res.arrayBuffer());
    cache.set(text, bytes);
    return bytes;
  } catch (error) {
    if (error instanceof CartesiaKeyMissingError || error instanceof CartesiaRequestError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Cartesia synthesis timed out after ${timeoutMs}ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export function cartesiaConfigured(): boolean {
  return hasCredential('CARTESIA_API_KEY');
}
