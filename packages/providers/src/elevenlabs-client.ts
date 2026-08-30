import { hasCredential, MissingCredentialError, readCredential } from './secrets.js';

/**
 * Real ElevenLabs TTS integration. UNTESTED against the live API -- no ELEVENLABS_API_KEY
 * exists in this environment. Real code against ElevenLabs' documented text-to-speech
 * endpoint, not a stub.
 */

export class ElevenLabsKeyMissingError extends Error {
  constructor() {
    super('ELEVENLABS_API_KEY is not set. This path is untested against the real API.');
    this.name = 'ElevenLabsKeyMissingError';
  }
}

export class ElevenLabsRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
  ) {
    super(`ElevenLabs request failed: HTTP ${status} ${body}`);
    this.name = 'ElevenLabsRequestError';
  }
}

function apiKey(): string {
  try {
    return readCredential('ELEVENLABS_API_KEY');
  } catch (error) {
    if (error instanceof MissingCredentialError) throw new ElevenLabsKeyMissingError();
    throw error;
  }
}

const ELEVENLABS_BASE = process.env['ELEVENLABS_BASE_URL'] ?? 'https://api.elevenlabs.io/v1';
/** A stock ElevenLabs voice id ("Rachel"), overridable per call. */
export const DEFAULT_VOICE_ID = 'EXAVITQu4vr4xnSDxMaL';

/** Synthesizes speech for one line of interviewer dialogue. Returns raw MP3 bytes. */
export async function synthesize(
  text: string,
  voiceId: string = DEFAULT_VOICE_ID,
  timeoutMs = 20_000,
): Promise<Uint8Array> {
  if (text.trim() === '') throw new RangeError('Cannot synthesize empty text.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${ELEVENLABS_BASE}/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'xi-api-key': apiKey() },
      signal: controller.signal,
      body: JSON.stringify({
        text,
        model_id: 'eleven_turbo_v2_5',
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
    });
    if (!res.ok) throw new ElevenLabsRequestError(res.status, await res.text());
    return new Uint8Array(await res.arrayBuffer());
  } catch (error) {
    if (error instanceof ElevenLabsKeyMissingError || error instanceof ElevenLabsRequestError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`ElevenLabs synthesis timed out after ${timeoutMs}ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export function elevenlabsConfigured(): boolean {
  return hasCredential('ELEVENLABS_API_KEY');
}
