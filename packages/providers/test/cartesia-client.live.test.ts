import { describe, expect, it } from 'vitest';
import { cartesiaConfigured, clearSynthesisCache, synthesize } from '../src/cartesia-client.js';

/**
 * The one test that actually calls Cartesia. Skipped, not failed, without a key -- same
 * pattern as openai-client.live.test.ts and deepgram-client.live.test.ts:
 *
 *   CARTESIA_API_KEY=... pnpm --filter @loopcraft/providers exec vitest run test/cartesia-client.live.test.ts
 *
 * One real call, billed per character, so the transcript is deliberately short.
 */

/** True for a bare MPEG frame (11 sync bits) or an ID3v2-tagged MP3. Nothing else is one. */
function looksLikeMp3(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false;
  const id3 = bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33;
  const frameSync = bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0;
  return id3 || frameSync;
}

describe.skipIf(!cartesiaConfigured())('Cartesia, live', () => {
  it('synthesizes real MP3 bytes, and serves the repeat from cache', async () => {
    clearSynthesisCache();
    const text = 'Tell me about a system you designed.';

    const bytes = await synthesize(text);
    expect(bytes.length).toBeGreaterThan(1_000);
    expect(looksLikeMp3(bytes)).toBe(true);

    // The second call must not bill a second synthesis. Identity, not deep equality: a cache
    // hit returns the very same buffer, which a fresh network call never would.
    const again = await synthesize(text);
    expect(again).toBe(bytes);
  }, 45_000);
});

if (!cartesiaConfigured()) {
  console.log('[cartesia-client.live.test.ts] SKIPPED: CARTESIA_API_KEY not set. Not verified against the real API.');
}
