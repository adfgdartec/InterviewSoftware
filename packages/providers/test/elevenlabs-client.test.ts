import { afterEach, describe, expect, it, vi } from 'vitest';
import { ElevenLabsKeyMissingError, elevenlabsConfigured, synthesize } from '../src/elevenlabs-client.js';

const originalFetch = globalThis.fetch;
const originalKey = process.env['ELEVENLABS_API_KEY'];
afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env['ELEVENLABS_API_KEY'];
  else process.env['ELEVENLABS_API_KEY'] = originalKey;
});

describe('key handling', () => {
  it('refuses to call the API without a key', async () => {
    delete process.env['ELEVENLABS_API_KEY'];
    let called = false;
    globalThis.fetch = vi.fn(() => { called = true; return Promise.resolve(new Response('{}')); }) as unknown as typeof fetch;
    await expect(synthesize('hello')).rejects.toThrow(ElevenLabsKeyMissingError);
    expect(called).toBe(false);
  });

  it('reports configured/unconfigured correctly', () => {
    delete process.env['ELEVENLABS_API_KEY'];
    expect(elevenlabsConfigured()).toBe(false);
    process.env['ELEVENLABS_API_KEY'] = 'el-test';
    expect(elevenlabsConfigured()).toBe(true);
  });

  it('refuses to synthesize empty text', async () => {
    process.env['ELEVENLABS_API_KEY'] = 'el-test';
    await expect(synthesize('   ')).rejects.toThrow(RangeError);
  });
});

describe('synthesis request shape', () => {
  it('sends the documented request and returns the raw audio bytes', async () => {
    process.env['ELEVENLABS_API_KEY'] = 'el-test';
    let capturedUrl = '';
    let capturedKeyHeader: string | null = null;
    let capturedBody: unknown;
    const audioBytes = new Uint8Array([1, 2, 3, 4]);
    globalThis.fetch = vi.fn((url: unknown, init?: RequestInit) => {
      capturedUrl = String(url);
      capturedKeyHeader = (init!.headers as Record<string, string>)['xi-api-key'] ?? null;
      capturedBody = JSON.parse(init!.body as string);
      return Promise.resolve(new Response(audioBytes, { status: 200 }));
    }) as unknown as typeof fetch;

    const result = await synthesize('Tell me about a challenging project.');

    expect(capturedUrl).toContain('/text-to-speech/');
    expect(capturedKeyHeader).toBe('el-test');
    expect(capturedBody).toMatchObject({ text: 'Tell me about a challenging project.', model_id: 'eleven_turbo_v2_5' });
    expect(new Uint8Array(result)).toEqual(audioBytes);
  });

  it('surfaces a non-2xx response as ElevenLabsRequestError', async () => {
    process.env['ELEVENLABS_API_KEY'] = 'el-test';
    globalThis.fetch = vi.fn(() => Promise.resolve(new Response('quota exceeded', { status: 429 }))) as unknown as typeof fetch;
    await expect(synthesize('hi')).rejects.toMatchObject({ status: 429 });
  });

  it('aborts on timeout rather than hanging', async () => {
    process.env['ELEVENLABS_API_KEY'] = 'el-test';
    globalThis.fetch = vi.fn((_url: unknown, init?: RequestInit) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        const err = new Error('aborted'); err.name = 'AbortError'; reject(err);
      });
    })) as unknown as typeof fetch;
    await expect(synthesize('hi', undefined, 20)).rejects.toThrow(/timed out after 20ms/);
  }, 2_000);
});
