import { NextResponse } from 'next/server';
import { serverClient } from '../../../server/supabase.js';

/**
 * Where Supabase sends the browser back after email confirmation, a password-reset link, or
 * the Google consent screen. Exchanges the one-time code for a session cookie.
 *
 * `next` is validated as a same-origin path before it is used: an unchecked redirect target
 * taken from a query string is an open redirect, and this endpoint is reachable by anyone.
 */
function safeNext(raw: string | null): string {
  if (raw === null || !raw.startsWith('/') || raw.startsWith('//')) return '/dashboard';
  return raw;
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const next = safeNext(url.searchParams.get('next'));

  if (code === null) {
    return NextResponse.redirect(new URL('/signin?error=link', url.origin));
  }

  const supabase = await serverClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error !== null) {
    return NextResponse.redirect(new URL('/signin?error=link', url.origin));
  }
  return NextResponse.redirect(new URL(next, url.origin));
}
