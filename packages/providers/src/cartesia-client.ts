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
 * Where synthesized audio is remembered between requests.
 *
 * Exact-match, never semantic: two questions that are close in meaning still need different
 * audio, so the embedding `SemanticCache` used for completions is the wrong tool here.
 *
 * The default is an in-process Map, which is correct for a single Node process and useless
 * on Workers -- every isolate starts empty, so nearly every request re-synthesizes and
 * re-bills. `setSynthesisCache` lets the deployment supply shared storage (KV) instead. The
 * interface is deliberately the smallest thing KV can satisfy.
 */
export interface SynthesisCache {
  get(text: string): Promise<Uint8Array | undefined>;
  set(text: string, audio: Uint8Array): Promise<void>;
}

class InMemorySynthesisCache implements SynthesisCache {
  private readonly entries = new Map<string, Uint8Array>();
  async get(text: string): Promise<Uint8Array | undefined> {
    return this.entries.get(text);
  }
  async set(text: string, audio: Uint8Array): Promise<void> {
    this.entries.set(text, audio);
  }
  clear(): void {
    this.entries.clear();
  }
}

let cache: SynthesisCache = new InMemorySynthesisCache();

/**
 * Swaps in shared storage. Called once at startup by the deployment; a cache that throws
 * must never take synthesis down with it, so failures are swallowed at the call sites below
 * rather than here.
 */
export function setSynthesisCache(next: SynthesisCache): void {
  cache = next;
}

/** Test seam: drops the cache so a cache-hit assertion cannot be polluted by a prior test. */
export function clearSynthesisCache(): void {
  if (cache instanceof InMemorySynthesisCache) cache.clear();
  else cache = new InMemorySynthesisCache();
}

/** Synthesizes one line of interviewer dialogue. Returns raw MP3 bytes. */
export async function synthesize(text: string, timeoutMs = 30_000): Promise<Uint8Array> {
  if (text.trim() === '') throw new RangeError('Cannot synthesize empty text.');
  // A cache that is down must cost money, not availability: fall through to synthesis.
  const cached = await cache.get(text).catch(() => undefined);
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
    await cache.set(text, bytes).catch(() => {});
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
