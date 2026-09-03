import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CartesiaKeyMissingError,
  CartesiaRequestError,
  INTERVIEWER_VOICE_ID,
  cartesiaConfigured,
  clearSynthesisCache,
  synthesize,
} from '../src/cartesia-client.js';

const originalFetch = globalThis.fetch;
const originalKey = process.env['CARTESIA_API_KEY'];

beforeEach(() => {
  // The cache is module-level and process-lifetime by design, so it survives between tests.
  // Clearing it here is what keeps "cache hit skips the fetch" an assertion about the cache
  // rather than an accident of test ordering.
  clearSynthesisCache();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env['CARTESIA_API_KEY'];
  else process.env['CARTESIA_API_KEY'] = originalKey;
});

function mp3(byte = 0x41): Response {
  return new Response(new Uint8Array([0xff, 0xfb, 0x90, byte]), {
    status: 200,
    headers: { 'content-type': 'audio/mpeg' },
  });
}

describe('key handling', () => {
  it('refuses to call the API without a key', async () => {
    delete process.env['CARTESIA_API_KEY'];
    let called = false;
    globalThis.fetch = vi.fn(() => {
      called = true;
      return Promise.resolve(mp3());
    }) as unknown as typeof fetch;
    await expect(synthesize('Tell me about a system you designed.')).rejects.toThrow(
      CartesiaKeyMissingError,
    );
    expect(called).toBe(false);
  });

  it('reports configured/unconfigured correctly', () => {
    delete process.env['CARTESIA_API_KEY'];
    expect(cartesiaConfigured()).toBe(false);
    process.env['CARTESIA_API_KEY'] = 'ct-test';
    expect(cartesiaConfigured()).toBe(true);
  });
});

describe('synthesis request shape', () => {
  it('sends the verified model id, voice id, version header and mp3 output format', async () => {
    process.env['CARTESIA_API_KEY'] = 'ct-test';
    let capturedUrl = '';
    let capturedHeaders: Record<string, string> = {};
    let capturedBody: Record<string, unknown> = {};
    globalThis.fetch = vi.fn((url: unknown, init?: RequestInit) => {
      capturedUrl = String(url);
      capturedHeaders = init!.headers as Record<string, string>;
      capturedBody = JSON.parse(String(init!.body)) as Record<string, unknown>;
      return Promise.resolve(mp3());
    }) as unknown as typeof fetch;

    const bytes = await synthesize('Walk me through your approach.');

    expect(capturedUrl).toBe('https://api.cartesia.ai/tts/bytes');
    expect(capturedHeaders['X-API-Key']).toBe('ct-test');
    expect(capturedHeaders['Cartesia-Version']).toBe('2024-06-10');
    expect(capturedHeaders['Content-Type']).toBe('application/json');
    expect(capturedBody['model_id']).toBe('sonic-2');
    expect(capturedBody['transcript']).toBe('Walk me through your approach.');
    expect(capturedBody['voice']).toEqual({ mode: 'id', id: INTERVIEWER_VOICE_ID });
    expect(capturedBody['output_format']).toEqual({
      container: 'mp3',
      sample_rate: 44_100,
      bit_rate: 128_000,
    });
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBe(4);
  });

  it('rejects empty text before spending a request on it', async () => {
    process.env['CARTESIA_API_KEY'] = 'ct-test';
    let called = false;
    globalThis.fetch = vi.fn(() => {
      called = true;
      return Promise.resolve(mp3());
    }) as unknown as typeof fetch;
    await expect(synthesize('   ')).rejects.toThrow(RangeError);
    expect(called).toBe(false);
  });

  it('raises CartesiaRequestError with the status and body on a non-2xx', async () => {
    process.env['CARTESIA_API_KEY'] = 'ct-test';
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(new Response('voice not found', { status: 404 })),
    ) as unknown as typeof fetch;
    await expect(synthesize('Anything.')).rejects.toThrow(CartesiaRequestError);
    await expect(synthesize('Anything.')).rejects.toThrow(/404/);
  });
});

describe('in-memory cache', () => {
  it('serves a repeated transcript without a second request', async () => {
    process.env['CARTESIA_API_KEY'] = 'ct-test';
    let calls = 0;
    globalThis.fetch = vi.fn(() => {
      calls += 1;
      return Promise.resolve(mp3());
    }) as unknown as typeof fetch;

    const first = await synthesize('Describe a tradeoff you made.');
    const second = await synthesize('Describe a tradeoff you made.');

    expect(calls).toBe(1);
    expect(second).toEqual(first);
  });

  it('matches exactly -- near-identical text is synthesized separately', async () => {
    process.env['CARTESIA_API_KEY'] = 'ct-test';
    let calls = 0;
    globalThis.fetch = vi.fn(() => {
      calls += 1;
      return Promise.resolve(mp3(calls));
    }) as unknown as typeof fetch;

    await synthesize('Describe a tradeoff you made.');
    await synthesize('Describe a tradeoff you made');

    expect(calls).toBe(2);
  });

  it('does not cache a failed synthesis', async () => {
    process.env['CARTESIA_API_KEY'] = 'ct-test';
    let calls = 0;
    globalThis.fetch = vi.fn(() => {
      calls += 1;
      return calls === 1
        ? Promise.resolve(new Response('rate limited', { status: 429 }))
        : Promise.resolve(mp3());
    }) as unknown as typeof fetch;

    await expect(synthesize('Retry me.')).rejects.toThrow(CartesiaRequestError);
    const bytes = await synthesize('Retry me.');

    expect(calls).toBe(2);
    expect(bytes.length).toBe(4);
  });
});
