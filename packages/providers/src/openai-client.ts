import { CallCoalescer, SemanticCache, gatedCall, type Embedder } from './local-brain.js';
import { hasCredential, MissingCredentialError, readCredential } from './secrets.js';

/**
 * The OpenAI fallback tier (packages/providers/src/registry.ts: used when the local model is
 * unavailable, or the cost ceiling degrades to it). UNTESTED against the real API as of this
 * commit -- there is no OPENAI_API_KEY in this environment. Every function here is real,
 * production code, not a stub: it will work the moment a key is set, and the tests in
 * openai-client.test.ts prove the request/response shape is correct using a mocked fetch.
 * What they cannot prove is that OpenAI's actual API still matches that shape today.
 */

export class OpenAIKeyMissingError extends Error {
  constructor() {
    super(
      'OPENAI_API_KEY is not set. This code path is untested against the real API for exactly ' +
        'that reason -- set the key, then run packages/providers/test/openai-client.live.test.ts.',
    );
    this.name = 'OpenAIKeyMissingError';
  }
}

export class OpenAIRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
  ) {
    super(`OpenAI request failed: HTTP ${status} ${body}`);
    this.name = 'OpenAIRequestError';
  }
}

function apiKey(): string {
  try {
    return readCredential('OPENAI_API_KEY');
  } catch (error) {
    if (error instanceof MissingCredentialError) throw new OpenAIKeyMissingError();
    throw error;
  }
}

const OPENAI_BASE = process.env['OPENAI_BASE_URL'] ?? 'https://api.openai.com/v1';

export interface OpenAIChatMessage {
  readonly role: 'system' | 'user' | 'assistant';
  readonly content: string;
}

export interface OpenAIChatOptions {
  readonly model: string;
  readonly messages: readonly OpenAIChatMessage[];
  readonly temperature: number;
  readonly timeoutMs: number;
  readonly json?: boolean;
}

async function rawChat(options: OpenAIChatOptions): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const res = await fetch(`${OPENAI_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        // The only place this key is read; never returned to a caller, never logged.
        authorization: `Bearer ${apiKey()}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: options.model,
        messages: options.messages,
        temperature: options.temperature,
        ...(options.json === true ? { response_format: { type: 'json_object' } } : {}),
      }),
    });
    if (!res.ok) {
      throw new OpenAIRequestError(res.status, await res.text());
    }
    const data = (await res.json()) as {
      choices?: readonly { message?: { content?: string } }[];
    };
    const content = data.choices?.[0]?.message?.content;
    if (content === undefined) throw new Error('OpenAI response had no choices[0].message.content.');
    return content;
  } catch (error) {
    if (error instanceof OpenAIKeyMissingError || error instanceof OpenAIRequestError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`OpenAI call to ${options.model} timed out after ${options.timeoutMs}ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/** Real embeddings via the OpenAI API, for the second brain when Ollama is unavailable. */
export class OpenAIEmbedder implements Embedder {
  constructor(private readonly model: string = 'text-embedding-3-small') {}

  async embed(text: string): Promise<readonly number[]> {
    const res = await fetch(`${OPENAI_BASE}/embeddings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey()}` },
      body: JSON.stringify({ model: this.model, input: text }),
    });
    if (!res.ok) throw new OpenAIRequestError(res.status, await res.text());
    const data = (await res.json()) as { data?: readonly { embedding?: number[] }[] };
    const embedding = data.data?.[0]?.embedding;
    if (embedding === undefined) throw new Error('OpenAI embeddings response had no data[0].embedding.');
    return embedding;
  }
}

let sharedCache: SemanticCache<string> | null = null;
const sharedCoalescer = new CallCoalescer<string>();

function cache(): SemanticCache<string> {
  sharedCache ??= new SemanticCache<string>(new OpenAIEmbedder(), { similarityThreshold: 0.97 });
  return sharedCache;
}

/** Same second-brain gating as ollama-client.ts's `chat`, over the OpenAI transport. */
export async function chat(options: OpenAIChatOptions, cacheable: boolean): Promise<string> {
  const key = `${options.model}::${JSON.stringify(options.messages)}`;
  return gatedCall(key, sharedCoalescer, cacheable ? cache() : null, () => rawChat(options));
}

export function openaiConfigured(): boolean {
  return hasCredential('OPENAI_API_KEY');
}
