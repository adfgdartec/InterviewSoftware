import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeepgramKeyMissingError, deepgramConfigured, transcribe } from '../src/deepgram-client.js';

const originalFetch = globalThis.fetch;
const originalKey = process.env['DEEPGRAM_API_KEY'];
afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env['DEEPGRAM_API_KEY'];
  else process.env['DEEPGRAM_API_KEY'] = originalKey;
});

describe('key handling', () => {
  it('refuses to call the API without a key', async () => {
    delete process.env['DEEPGRAM_API_KEY'];
    let called = false;
    globalThis.fetch = vi.fn(() => { called = true; return Promise.resolve(new Response('{}')); }) as unknown as typeof fetch;
    await expect(transcribe(new Uint8Array([1, 2, 3]), 'audio/webm')).rejects.toThrow(DeepgramKeyMissingError);
    expect(called).toBe(false);
  });

  it('reports configured/unconfigured correctly', () => {
    delete process.env['DEEPGRAM_API_KEY'];
    expect(deepgramConfigured()).toBe(false);
    process.env['DEEPGRAM_API_KEY'] = 'dg-test';
    expect(deepgramConfigured()).toBe(true);
  });
});

describe('transcription request shape', () => {
  it('sends audio bytes with the right content-type and auth, and converts seconds to ms', async () => {
    process.env['DEEPGRAM_API_KEY'] = 'dg-test';
    let capturedUrl = '';
    let capturedAuth: string | null = null;
    let capturedContentType: string | null = null;
    globalThis.fetch = vi.fn((url: unknown, init?: RequestInit) => {
      capturedUrl = String(url);
      capturedAuth = (init!.headers as Record<string, string>)['authorization'] ?? null;
      capturedContentType = (init!.headers as Record<string, string>)['content-type'] ?? null;
      return Promise.resolve(
        new Response(
          JSON.stringify({
            results: {
              channels: [{
                alternatives: [{
                  transcript: 'hello world',
                  words: [
                    { word: 'hello', start: 0.12, end: 0.45 },
                    { word: 'world', start: 0.50, end: 0.98 },
                  ],
                }],
              }],
            },
            metadata: { duration: 1.2 },
          }),
          { status: 200 },
        ),
      );
    }) as unknown as typeof fetch;

    const result = await transcribe(new Uint8Array([1, 2, 3]), 'audio/webm');

    expect(capturedUrl).toContain('/listen');
    expect(capturedUrl).toContain('model=nova-3');
    expect(capturedAuth).toBe('Token dg-test');
    expect(capturedContentType).toBe('audio/webm');
    expect(result.transcript).toBe('hello world');
    expect(result.words).toEqual([
      { word: 'hello', startMs: 120, endMs: 450 },
      { word: 'world', startMs: 500, endMs: 980 },
    ]);
    expect(result.durationSeconds).toBe(1.2);
  });

  it('surfaces a non-2xx response as DeepgramRequestError', async () => {
    process.env['DEEPGRAM_API_KEY'] = 'dg-test';
    globalThis.fetch = vi.fn(() => Promise.resolve(new Response('bad audio', { status: 400 }))) as unknown as typeof fetch;
    await expect(transcribe(new Uint8Array([1]), 'audio/webm')).rejects.toMatchObject({ status: 400 });
  });

  it('throws a clear error when the response has no transcript', async () => {
    process.env['DEEPGRAM_API_KEY'] = 'dg-test';
    globalThis.fetch = vi.fn(() => Promise.resolve(new Response(JSON.stringify({}), { status: 200 }))) as unknown as typeof fetch;
    await expect(transcribe(new Uint8Array([1]), 'audio/webm')).rejects.toThrow(/no results/);
  });

  it('tolerates a response with no word-level timing rather than throwing', async () => {
    process.env['DEEPGRAM_API_KEY'] = 'dg-test';
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({
        results: { channels: [{ alternatives: [{ transcript: 'hi' }] }] },
      }), { status: 200 })),
    ) as unknown as typeof fetch;
    const result = await transcribe(new Uint8Array([1]), 'audio/webm');
    expect(result.transcript).toBe('hi');
    expect(result.words).toEqual([]);
  });

  it('aborts on timeout rather than hanging', async () => {
    process.env['DEEPGRAM_API_KEY'] = 'dg-test';
    globalThis.fetch = vi.fn((_url: unknown, init?: RequestInit) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        const err = new Error('aborted'); err.name = 'AbortError'; reject(err);
      });
    })) as unknown as typeof fetch;
    await expect(transcribe(new Uint8Array([1]), 'audio/webm', 20)).rejects.toThrow(/timed out after 20ms/);
  }, 2_000);
});
