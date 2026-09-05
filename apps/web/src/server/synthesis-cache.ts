import type { SynthesisCache } from '@loopcraft/providers';

/**
 * Shared storage for synthesized interviewer audio, backed by Workers KV.
 *
 * The provider package's default cache is a Map inside one process. On Workers that means
 * every isolate starts empty, so a question that has already been synthesized gets
 * synthesized again -- and Cartesia bills per character. KV is shared across isolates and
 * survives a deploy, which is what makes the cache actually a cache.
 *
 * Audio, not rows, so this is KV rather than the Postgres table the rate limiter uses:
 * values are ~80KB of MP3, read far more often than written, and never queried by anything
 * but their exact key.
 */

/** The subset of the KV binding this needs. Declared locally so nothing imports workers-types. */
export interface KVLike {
  get(key: string, type: 'arrayBuffer'): Promise<ArrayBuffer | null>;
  put(key: string, value: ArrayBuffer, options?: { expirationTtl?: number }): Promise<void>;
}

/** Thirty days. Long enough that the catalog stays warm, short enough that a reworded
 *  question's audio does not live forever. */
const TTL_SECONDS = 60 * 60 * 24 * 30;

/**
 * KV keys are limited to 512 bytes and must be valid UTF-8; question text is neither
 * bounded nor guaranteed safe. Hashing gives a fixed-length key and makes the cache
 * exact-match on the full text rather than on a truncation of it, which would collide two
 * questions sharing a long prefix.
 */
async function keyFor(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return `tts:${[...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

export class KVSynthesisCache implements SynthesisCache {
  constructor(private readonly kv: KVLike) {}

  async get(text: string): Promise<Uint8Array | undefined> {
    const found = await this.kv.get(await keyFor(text), 'arrayBuffer');
    return found === null ? undefined : new Uint8Array(found);
  }

  async set(text: string, audio: Uint8Array): Promise<void> {
    // `slice()` produces a plain ArrayBuffer even when the view is a subarray of a larger
    // buffer -- writing `audio.buffer` directly would store the whole backing store.
    await this.kv.put(await keyFor(text), audio.slice().buffer as ArrayBuffer, {
      expirationTtl: TTL_SECONDS,
    });
  }
}

/**
 * Resolves the KV binding if the app is running on Workers with one configured, and returns
 * null everywhere else -- local Node, tests, or a Worker deployed before the namespace was
 * created. Callers keep the in-process default in that case, which is correct there.
 *
 * The import is dynamic because `@opennextjs/cloudflare` is a build-time dependency that is
 * not resolvable when the app runs under plain Node.
 */
export async function resolveKVBinding(bindingName = 'TTS_CACHE'): Promise<KVLike | null> {
  try {
    // Through `unknown`: the real module's context type is generic over generated binding
    // types this app does not have, and the only thing needed from it is one property.
    const mod = (await import('@opennextjs/cloudflare')) as unknown as {
      getCloudflareContext?: () => { env?: Record<string, unknown> };
    };
    const env = mod.getCloudflareContext?.().env;
    const binding = env?.[bindingName];
    if (binding === undefined || binding === null) return null;
    const candidate = binding as Partial<KVLike>;
    return typeof candidate.get === 'function' && typeof candidate.put === 'function'
      ? (binding as KVLike)
      : null;
  } catch {
    return null;
  }
}
