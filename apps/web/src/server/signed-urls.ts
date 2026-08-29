import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Guardrail 6 / spec §3.2: storage buckets are private, access is by signed URL with a
 * 15-minute TTL, and no public URL is constructed anywhere. The audited prototype served
 * private interview video from a public bucket path that could be guessed from the object
 * key, so this module refuses to emit a URL that carries no signature at all.
 */

export const SIGNED_URL_TTL_SECONDS = 15 * 60;

export class UnsignedUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsignedUrlError';
  }
}

export interface SignedUrl {
  readonly url: string;
  readonly expiresAt: Date;
}

/**
 * The signature covers the full request path, not the bare object key. Signing only the key
 * would let a URL minted for one bucket prefix verify against another, and it made the
 * signature unverifiable whenever the base URL carried a path segment.
 */
function canonical(pathname: string, expiresAtEpoch: number): string {
  return `${pathname}\n${expiresAtEpoch}`;
}

function sign(pathname: string, expiresAtEpoch: number, secret: string): string {
  return createHmac('sha256', secret).update(canonical(pathname, expiresAtEpoch)).digest('hex');
}

/**
 * Mints a time-limited URL for a private object. `ttlSeconds` cannot exceed the policy TTL:
 * a longer-lived link is a silent policy change, so it throws rather than clamping.
 */
export function createSignedUrl(
  baseUrl: string,
  storageKey: string,
  secret: string,
  ttlSeconds: number = SIGNED_URL_TTL_SECONDS,
  now: Date = new Date(),
): SignedUrl {
  if (secret.length < 32) {
    throw new UnsignedUrlError('Signing secret must be at least 32 characters.');
  }
  if (storageKey.length === 0 || storageKey.startsWith('/')) {
    throw new UnsignedUrlError(`Invalid storage key ${JSON.stringify(storageKey)}.`);
  }
  if (ttlSeconds <= 0 || ttlSeconds > SIGNED_URL_TTL_SECONDS) {
    throw new UnsignedUrlError(
      `TTL must be between 1 and ${SIGNED_URL_TTL_SECONDS} seconds, got ${ttlSeconds}.`,
    );
  }
  const expiresAtEpoch = Math.floor(now.getTime() / 1000) + ttlSeconds;
  const url = new URL(`${baseUrl.replace(/\/$/, '')}/${storageKey}`);
  url.searchParams.set('expires', String(expiresAtEpoch));
  url.searchParams.set('signature', sign(url.pathname, expiresAtEpoch, secret));
  return { url: url.toString(), expiresAt: new Date(expiresAtEpoch * 1000) };
}

export type VerifyResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'expired' | 'missing_signature' | 'bad_signature' };

export function verifySignedUrl(rawUrl: string, secret: string, now: Date = new Date()): VerifyResult {
  const url = new URL(rawUrl);
  const expires = url.searchParams.get('expires');
  const signature = url.searchParams.get('signature');
  if (expires === null || signature === null) return { ok: false, reason: 'missing_signature' };

  const expected = sign(url.pathname, Number(expires), secret);
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signature, 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: 'bad_signature' };
  if (Math.floor(now.getTime() / 1000) >= Number(expires)) return { ok: false, reason: 'expired' };
  return { ok: true };
}
