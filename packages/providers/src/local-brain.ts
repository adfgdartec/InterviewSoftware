/**
 * Local semantic cache + call coalescer -- sits in front of any LLM call to cut outbound
 * reasoning calls without touching correctness.
 *
 *   coalescing:  N concurrent identical requests -> 1 in-flight call, not N.
 *   semantic cache: a request whose embedding is near-duplicate of a cached one is answered
 *                    without calling out again. Embeddings come from a local model (Ollama's
 *                    /api/embeddings by default), so neither path spends provider tokens.
 *
 * Threshold defaults conservative (0.95): this is a cost control, not a correctness
 * shortcut, so a near-miss falls through to a real call rather than risking a wrong answer.
 */

export interface Embedder {
  embed(text: string): Promise<readonly number[]>;
}

const OLLAMA_HOST = process.env['OLLAMA_HOST'] ?? 'http://127.0.0.1:11434';
const EMBED_MODEL = process.env['LOOPCRAFT_EMBED_MODEL'] ?? 'nomic-embed-text';

/** Local, free embeddings via Ollama. Requires `ollama pull nomic-embed-text` once. */
export class OllamaEmbedder implements Embedder {
  async embed(text: string): Promise<readonly number[]> {
    const res = await fetch(`${OLLAMA_HOST}/api/embeddings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: EMBED_MODEL, prompt: text }),
    });
    if (!res.ok) throw new Error(`Ollama embeddings failed: HTTP ${res.status}`);
    const data = (await res.json()) as { embedding: number[] };
    return data.embedding;
  }
}

export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length) throw new RangeError('Embedding dimension mismatch');
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

interface CacheEntry<T> {
  readonly embedding: readonly number[];
  readonly value: T;
  readonly storedAt: number;
}

export interface SemanticCacheOptions {
  readonly similarityThreshold: number;
  readonly maxEntries: number;
  readonly ttlMs: number;
}

const DEFAULT_OPTIONS: SemanticCacheOptions = {
  similarityThreshold: 0.95,
  maxEntries: 500,
  ttlMs: 30 * 60_000,
};

export class SemanticCache<T> {
  private readonly entries: CacheEntry<T>[] = [];
  private readonly options: SemanticCacheOptions;

  constructor(private readonly embedder: Embedder, options: Partial<SemanticCacheOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  async lookup(key: string): Promise<T | null> {
    this.evictExpired();
    if (this.entries.length === 0) return null;
    const embedding = await this.embedder.embed(key);
    let best: CacheEntry<T> | null = null;
    let bestScore = -1;
    for (const entry of this.entries) {
      const score = cosineSimilarity(embedding, entry.embedding);
      if (score > bestScore) {
        bestScore = score;
        best = entry;
      }
    }
    return best !== null && bestScore >= this.options.similarityThreshold ? best.value : null;
  }

  async store(key: string, value: T): Promise<void> {
    const embedding = await this.embedder.embed(key);
    this.entries.push({ embedding, value, storedAt: Date.now() });
    if (this.entries.length > this.options.maxEntries) this.entries.shift();
  }

  get size(): number {
    return this.entries.length;
  }

  private evictExpired(): void {
    const cutoff = Date.now() - this.options.ttlMs;
    while (this.entries.length > 0 && this.entries[0]!.storedAt < cutoff) this.entries.shift();
  }
}

/** Collapses concurrent identical requests into one in-flight call. */
export class CallCoalescer<T> {
  private readonly inFlight = new Map<string, Promise<T>>();

  async run(key: string, fn: () => Promise<T>): Promise<T> {
    const existing = this.inFlight.get(key);
    if (existing !== undefined) return existing;
    const promise = fn().finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, promise);
    return promise;
  }

  get pendingCount(): number {
    return this.inFlight.size;
  }
}

/**
 * Wraps a call with coalescing then semantic cache, real call only on a genuine miss.
 * Coalesce first (free), embed second (one local call), remote LLM call last and least.
 */
export async function gatedCall<T>(
  key: string,
  coalescer: CallCoalescer<T>,
  cache: SemanticCache<T> | null,
  fn: () => Promise<T>,
): Promise<T> {
  return coalescer.run(key, async () => {
    if (cache !== null) {
      const cached = await cache.lookup(key);
      if (cached !== null) return cached;
    }
    const result = await fn();
    if (cache !== null) await cache.store(key, result);
    return result;
  });
}
