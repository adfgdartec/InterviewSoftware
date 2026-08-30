import { CallCoalescer, SemanticCache, OllamaEmbedder, gatedCall, type Embedder } from './local-brain.js';

/**
 * The real client for the local-first model path. Every call to `chat` goes THROUGH the
 * second brain (coalesce + semantic cache) before it ever reaches Ollama's HTTP API -- this
 * is what actually uses local-brain.ts, which previously had 15 passing tests and zero
 * callers anywhere in the product.
 */

const OLLAMA_HOST = process.env['OLLAMA_HOST'] ?? 'http://127.0.0.1:11434';

export class OllamaUnavailableError extends Error {
  constructor(cause: unknown) {
    super(`Could not reach Ollama at ${OLLAMA_HOST}. Is \`ollama serve\` running?`);
    this.name = 'OllamaUnavailableError';
    this.cause = cause;
  }
}

export interface ChatMessage {
  readonly role: 'system' | 'user' | 'assistant';
  readonly content: string;
}

export interface ChatOptions {
  readonly model: string;
  readonly messages: readonly ChatMessage[];
  readonly temperature: number;
  readonly timeoutMs: number;
  /** JSON-decoded when true; the caller gets a parsed object, not a raw string. */
  readonly json?: boolean;
}

async function rawChat(options: ChatOptions): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const res = await fetch(`${OLLAMA_HOST}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: options.model,
        messages: options.messages,
        stream: false,
        options: { temperature: options.temperature },
        ...(options.json === true ? { format: 'json' } : {}),
      }),
    });
    if (!res.ok) {
      throw new Error(`Ollama chat failed: HTTP ${res.status} ${await res.text()}`);
    }
    const data = (await res.json()) as { message?: { content?: string } };
    const content = data.message?.content;
    if (content === undefined) throw new Error('Ollama response had no message content.');
    return content;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Ollama call to ${options.model} timed out after ${options.timeoutMs}ms.`);
    }
    throw new OllamaUnavailableError(error);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Process-wide singletons. The cache and coalescer must outlive a single request: coalescing
 * only helps if concurrent requests actually share the same map, and the cache only helps if
 * it accumulates across calls rather than resetting every time.
 */
let sharedEmbedder: Embedder | null = null;
let sharedCache: SemanticCache<string> | null = null;
const sharedCoalescer = new CallCoalescer<string>();

function embedder(): Embedder {
  sharedEmbedder ??= new OllamaEmbedder();
  return sharedEmbedder;
}

function cache(): SemanticCache<string> {
  sharedCache ??= new SemanticCache<string>(embedder(), { similarityThreshold: 0.97 });
  return sharedCache;
}

/**
 * Chat completion gated by the second brain. `cacheable` should be false for anything where
 * a stale-but-similar answer would be wrong (grading a specific transcript, a live
 * conversational turn) and true only for genuinely repeatable prompts (e.g. two candidates
 * asking a near-identical warmup question). Passing the wrong value here is a correctness
 * bug, not a performance one, so callers must choose explicitly rather than getting a default.
 */
export async function chat(options: ChatOptions, cacheable: boolean): Promise<string> {
  const key = `${options.model}::${JSON.stringify(options.messages)}`;
  return gatedCall(key, sharedCoalescer, cacheable ? cache() : null, () => rawChat(options));
}

/** Pings Ollama so a caller can fail fast with a clear message instead of a generic timeout. */
export async function ollamaReachable(): Promise<boolean> {
  try {
    const res = await fetch(`${OLLAMA_HOST}/api/version`, { signal: AbortSignal.timeout(2_000) });
    return res.ok;
  } catch {
    return false;
  }
}
