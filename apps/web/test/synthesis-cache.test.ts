import { describe, expect, it } from 'vitest';
import { KVSynthesisCache, resolveKVBinding, type KVLike } from '../src/server/synthesis-cache.js';

/** A KV double that records what was written, so key shape and TTL can be asserted. */
function fakeKV(): KVLike & { readonly writes: Map<string, { ttl?: number; bytes: number }> } {
  const store = new Map<string, ArrayBuffer>();
  const writes = new Map<string, { ttl?: number; bytes: number }>();
  return {
    writes,
    async get(key: string): Promise<ArrayBuffer | null> {
      return store.get(key) ?? null;
    },
    async put(key: string, value: ArrayBuffer, options?: { expirationTtl?: number }) {
      store.set(key, value);
      const entry: { ttl?: number; bytes: number } = { bytes: value.byteLength };
      if (options?.expirationTtl !== undefined) entry.ttl = options.expirationTtl;
      writes.set(key, entry);
    },
  };
}

const QUESTION = 'Tell me about a system you designed.';

describe('KVSynthesisCache', () => {
  it('round-trips audio bytes exactly', async () => {
    const cache = new KVSynthesisCache(fakeKV());
    const audio = new Uint8Array([0xff, 0xfb, 0x90, 0x41, 0x00, 0x7f]);

    expect(await cache.get(QUESTION)).toBeUndefined();
    await cache.set(QUESTION, audio);

    const back = await cache.get(QUESTION);
    expect(back).toBeInstanceOf(Uint8Array);
    expect([...back!]).toEqual([...audio]);
  });

  it('matches exactly -- near-identical text is a separate entry', async () => {
    const cache = new KVSynthesisCache(fakeKV());
    await cache.set(QUESTION, new Uint8Array([1]));
    expect(await cache.get('Tell me about a system you designed')).toBeUndefined();
  });

  it('hashes the key, so long questions neither overflow nor collide on a shared prefix', async () => {
    const kv = fakeKV();
    const cache = new KVSynthesisCache(kv);

    const prefix = 'A'.repeat(2_000);
    await cache.set(`${prefix}one`, new Uint8Array([1]));
    await cache.set(`${prefix}two`, new Uint8Array([2]));

    const keys = [...kv.writes.keys()];
    expect(keys).toHaveLength(2);
    expect(new Set(keys).size).toBe(2);
    for (const key of keys) {
      // KV caps keys at 512 bytes; a raw 2000-character question would be rejected outright.
      expect(key.length).toBeLessThan(512);
      expect(key).toMatch(/^tts:[0-9a-f]{64}$/);
    }
    expect([...(await cache.get(`${prefix}one`))!]).toEqual([1]);
    expect([...(await cache.get(`${prefix}two`))!]).toEqual([2]);
  });

  it('sets a TTL, so audio for a reworded question does not live forever', async () => {
    const kv = fakeKV();
    await new KVSynthesisCache(kv).set(QUESTION, new Uint8Array([1]));
    const [entry] = [...kv.writes.values()];
    expect(entry?.ttl).toBeGreaterThan(0);
  });

  it('stores only the bytes it was given, not the whole backing buffer', async () => {
    // `audio.buffer` on a subarray is the ENTIRE underlying store. Writing that would put
    // megabytes into KV for a few kilobytes of audio, and read back the wrong bytes.
    const kv = fakeKV();
    const backing = new Uint8Array(1_000);
    const view = backing.subarray(10, 14);
    view.set([1, 2, 3, 4]);

    await new KVSynthesisCache(kv).set(QUESTION, view);
    const [entry] = [...kv.writes.values()];
    expect(entry?.bytes).toBe(4);
    expect([...(await new KVSynthesisCache(kv).get(QUESTION))!]).toEqual([1, 2, 3, 4]);
  });
});

describe('resolveKVBinding', () => {
  it('returns null under plain Node, so the in-process default stays in use', async () => {
    // There is no Cloudflare context in vitest. Returning null rather than throwing is what
    // lets one deps.ts serve local development, CI and Workers unchanged.
    expect(await resolveKVBinding()).toBeNull();
  });

  it('returns null for a binding name that does not exist', async () => {
    expect(await resolveKVBinding('NOT_A_REAL_BINDING')).toBeNull();
  });
});
