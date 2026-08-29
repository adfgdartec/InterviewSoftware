import { describe, expect, it } from 'vitest';
import {
  SIGNED_URL_TTL_SECONDS,
  UnsignedUrlError,
  createSignedUrl,
  verifySignedUrl,
} from '../src/server/signed-urls.js';

const SECRET = 'x'.repeat(48);
const BASE = 'https://storage.loopcraft.test/private';
const KEY = 'org-a/session-1/round-2/audio.webm';
const NOW = new Date('2026-08-29T12:00:00Z');

describe('signed storage URLs (guardrail 6)', () => {
  it('defaults to the 15-minute policy TTL', () => {
    const signed = createSignedUrl(BASE, KEY, SECRET, undefined, NOW);
    expect(SIGNED_URL_TTL_SECONDS).toBe(900);
    expect(signed.expiresAt.getTime() - NOW.getTime()).toBe(900_000);
  });

  it('always carries both an expiry and a signature', () => {
    const url = new URL(createSignedUrl(BASE, KEY, SECRET, undefined, NOW).url);
    expect(url.searchParams.get('signature')).toMatch(/^[0-9a-f]{64}$/);
    expect(url.searchParams.get('expires')).not.toBeNull();
  });

  it('verifies a fresh URL', () => {
    const signed = createSignedUrl(BASE, KEY, SECRET, undefined, NOW);
    expect(verifySignedUrl(signed.url, SECRET, NOW)).toEqual({ ok: true });
  });

  it('rejects the URL one second after it expires', () => {
    const signed = createSignedUrl(BASE, KEY, SECRET, 60, NOW);
    const justAfter = new Date(NOW.getTime() + 61_000);
    expect(verifySignedUrl(signed.url, SECRET, justAfter)).toEqual({ ok: false, reason: 'expired' });
  });

  it('rejects at the exact expiry instant, not one second later', () => {
    const signed = createSignedUrl(BASE, KEY, SECRET, 60, NOW);
    expect(verifySignedUrl(signed.url, SECRET, signed.expiresAt).ok).toBe(false);
  });

  it('rejects a tampered object key', () => {
    const signed = createSignedUrl(BASE, KEY, SECRET, undefined, NOW);
    const tampered = signed.url.replace('session-1', 'session-2');
    expect(verifySignedUrl(tampered, SECRET, NOW)).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('rejects an extended expiry', () => {
    const signed = createSignedUrl(BASE, KEY, SECRET, 60, NOW);
    const url = new URL(signed.url);
    url.searchParams.set('expires', String(Number(url.searchParams.get('expires')) + 86_400));
    expect(verifySignedUrl(url.toString(), SECRET, NOW).ok).toBe(false);
  });

  it('rejects a bare public URL with no signature at all', () => {
    expect(verifySignedUrl(`${BASE}/${KEY}`, SECRET, NOW)).toEqual({
      ok: false,
      reason: 'missing_signature',
    });
  });

  it('rejects a signature made with a different secret', () => {
    const signed = createSignedUrl(BASE, KEY, SECRET, undefined, NOW);
    expect(verifySignedUrl(signed.url, 'y'.repeat(48), NOW).ok).toBe(false);
  });

  it('refuses to mint a URL that outlives the policy TTL', () => {
    expect(() => createSignedUrl(BASE, KEY, SECRET, SIGNED_URL_TTL_SECONDS + 1, NOW)).toThrow(
      UnsignedUrlError,
    );
    expect(() => createSignedUrl(BASE, KEY, SECRET, 0, NOW)).toThrow(UnsignedUrlError);
  });

  it('refuses a weak signing secret', () => {
    expect(() => createSignedUrl(BASE, KEY, 'short', undefined, NOW)).toThrow(UnsignedUrlError);
  });

  it.each(['', '/absolute/key'])('refuses the invalid storage key %j', (key) => {
    expect(() => createSignedUrl(BASE, key, SECRET, undefined, NOW)).toThrow(UnsignedUrlError);
  });
});
