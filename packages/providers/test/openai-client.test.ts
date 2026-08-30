import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  OpenAIEmbedder,
  OpenAIKeyMissingError,
  OpenAIRequestError,
  chat,
  openaiConfigured,
} from '../src/openai-client.js';

/**
 * These tests mock fetch and prove the request/response shape this client sends and parses
 * is correct against OpenAI's documented API contract. They do NOT prove OpenAI's real API
 * still matches that contract today -- only a call against the live endpoint, with a real
 * key, can prove that. See openai-client.ts's module comment.
 */

const originalFetch = globalThis.fetch;
const originalKey = process.env['OPENAI_API_KEY'];

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env['OPENAI_API_KEY'];
  else process.env['OPENAI_API_KEY'] = originalKey;
});

describe('key handling', () => {
  it('reports unconfigured when no key is set', () => {
    delete process.env['OPENAI_API_KEY'];
    expect(openaiConfigured()).toBe(false);
  });

  it('reports configured once a key is set', () => {
    process.env['OPENAI_API_KEY'] = 'sk-test-not-real';
    expect(openaiConfigured()).toBe(true);
  });

  it('refuses to call the API at all without a key, rather than sending an empty auth header', async () => {
    delete process.env['OPENAI_API_KEY'];
    let called = false;
    globalThis.fetch = vi.fn(() => {
      called = true;
      return Promise.resolve(new Response('{}'));
    }) as unknown as typeof fetch;
    await expect(
      chat({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'hi' }], temperature: 0.3, timeoutMs: 5000 }, false),
    ).rejects.toThrow(OpenAIKeyMissingError);
    expect(called).toBe(false);
  });
});

describe('chat request shape', () => {
  it('sends the documented chat/completions request and parses choices[0].message.content', async () => {
    process.env['OPENAI_API_KEY'] = 'sk-test-not-real';
    let capturedBody: unknown;
    let capturedAuth: string | null = null;
    globalThis.fetch = vi.fn((url: unknown, init?: RequestInit) => {
      capturedBody = JSON.parse(init!.body as string);
      capturedAuth = (init!.headers as Record<string, string>)['authorization'] ?? null;
      expect(String(url)).toBe('https://api.openai.com/v1/chat/completions');
      return Promise.resolve(
        new Response(JSON.stringify({ choices: [{ message: { content: 'BANANA' } }] }), { status: 200 }),
      );
    }) as unknown as typeof fetch;

    const result = await chat(
      { model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'Say BANANA' }], temperature: 0.3, timeoutMs: 5000 },
      false,
    );

    expect(result).toBe('BANANA');
    expect(capturedAuth).toBe('Bearer sk-test-not-real');
    expect(capturedBody).toMatchObject({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'Say BANANA' }],
      temperature: 0.3,
    });
  });

  it('requests JSON mode via response_format when json: true', async () => {
    process.env['OPENAI_API_KEY'] = 'sk-test-not-real';
    let capturedBody: unknown;
    globalThis.fetch = vi.fn((_url: unknown, init?: RequestInit) => {
      capturedBody = JSON.parse(init!.body as string);
      return Promise.resolve(
        new Response(JSON.stringify({ choices: [{ message: { content: '{}' } }] }), { status: 200 }),
      );
    }) as unknown as typeof fetch;

    await chat(
      { model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'x' }], temperature: 0.3, timeoutMs: 5000, json: true },
      false,
    );
    expect(capturedBody).toMatchObject({ response_format: { type: 'json_object' } });
  });

  it('surfaces a non-2xx response as OpenAIRequestError with the real status and body', async () => {
    process.env['OPENAI_API_KEY'] = 'sk-test-not-real';
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(new Response('{"error":"rate limited"}', { status: 429 })),
    ) as unknown as typeof fetch;

    await expect(
      chat({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'x' }], temperature: 0.3, timeoutMs: 5000 }, false),
    ).rejects.toMatchObject({ status: 429 });
  });

  it('throws a clear error when the response has no choices', async () => {
    process.env['OPENAI_API_KEY'] = 'sk-test-not-real';
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({ choices: [] }), { status: 200 })),
    ) as unknown as typeof fetch;

    await expect(
      chat({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'x' }], temperature: 0.3, timeoutMs: 5000 }, false),
    ).rejects.toThrow(/no choices/);
  });

  it('aborts and reports a clear timeout message rather than hanging', async () => {
    process.env['OPENAI_API_KEY'] = 'sk-test-not-real';
    globalThis.fetch = vi.fn(
      (_url: unknown, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const err = new Error('aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }),
    ) as unknown as typeof fetch;

    await expect(
      chat({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'x' }], temperature: 0.3, timeoutMs: 20 }, false),
    ).rejects.toThrow(/timed out after 20ms/);
  }, 2_000);

  it('coalesces concurrent identical calls into one real fetch', async () => {
    process.env['OPENAI_API_KEY'] = 'sk-test-not-real';
    let calls = 0;
    globalThis.fetch = vi.fn(() => {
      calls += 1;
      return Promise.resolve(
        new Response(JSON.stringify({ choices: [{ message: { content: 'X' } }] }), { status: 200 }),
      );
    }) as unknown as typeof fetch;

    const opts = { model: 'gpt-4o-mini', messages: [{ role: 'user' as const, content: 'same' }], temperature: 0.3, timeoutMs: 5000 };
    await Promise.all([chat(opts, false), chat(opts, false), chat(opts, false)]);
    expect(calls).toBe(1);
  });
});

describe('embeddings request shape', () => {
  it('sends the documented embeddings request and parses data[0].embedding', async () => {
    process.env['OPENAI_API_KEY'] = 'sk-test-not-real';
    globalThis.fetch = vi.fn((url: unknown) => {
      expect(String(url)).toBe('https://api.openai.com/v1/embeddings');
      return Promise.resolve(
        new Response(JSON.stringify({ data: [{ embedding: [0.1, 0.2, 0.3] }] }), { status: 200 }),
      );
    }) as unknown as typeof fetch;

    const embedding = await new OpenAIEmbedder().embed('hash table');
    expect(embedding).toEqual([0.1, 0.2, 0.3]);
  });

  it('surfaces embeddings failures as OpenAIRequestError', async () => {
    process.env['OPENAI_API_KEY'] = 'sk-test-not-real';
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(new Response('bad key', { status: 401 })),
    ) as unknown as typeof fetch;

    await expect(new OpenAIEmbedder().embed('x')).rejects.toThrow(OpenAIRequestError);
  });
});
