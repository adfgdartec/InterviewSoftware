import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { hasCredential, readCredential } from '@loopcraft/providers';

/**
 * Refreshes the Supabase session cookie on every request, and redirects signed-out visitors
 * away from the routes that need an account.
 *
 * `/`, `/calibration` and `/compliance` stay public on purpose: they are the marketing and
 * legal surfaces, and a compliance position paper behind a login is worth nothing to the
 * person evaluating whether to trust the product.
 *
 * API routes are deliberately not redirected -- they already 401 through the guard chain,
 * and turning an API 401 into an HTML redirect would break every client that reads the JSON
 * error body.
 */

const PROTECTED = ['/dashboard', '/session', '/settings'];

/** Signed-in users have no business on these; send them somewhere useful instead. */
const AUTH_ONLY = ['/signin', '/signup'];

function needsAccount(pathname: string): boolean {
  return PROTECTED.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export async function middleware(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });

  const url = process.env['NEXT_PUBLIC_SUPABASE_URL'] ?? process.env['SUPABASE_URL'];
  // Not configured (local demo, CI): behave exactly as the app did before auth existed
  // rather than locking every route behind a redirect loop to a sign-in page that cannot work.
  // The credential goes through secrets.ts, never process.env inline (guardrail 6).
  if (url === undefined || url === '' || !hasCredential('SUPABASE_ANON_KEY')) return response;

  const supabase = createServerClient(url, readCredential('SUPABASE_ANON_KEY'), {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (toSet) => {
        for (const { name, value } of toSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of toSet) response.cookies.set(name, value, options);
      },
    },
  });

  // getUser(), not getSession(): this validates the token rather than trusting the cookie.
  const { data } = await supabase.auth.getUser();
  const signedIn = data.user !== null && data.user !== undefined;
  const { pathname } = request.nextUrl;

  if (!signedIn && needsAccount(pathname)) {
    const to = request.nextUrl.clone();
    to.pathname = '/signin';
    to.search = '';
    return NextResponse.redirect(to);
  }

  if (signedIn && AUTH_ONLY.includes(pathname)) {
    const to = request.nextUrl.clone();
    to.pathname = '/dashboard';
    to.search = '';
    return NextResponse.redirect(to);
  }

  return response;
}

export const config = {
  // Everything except Next's own assets and the icon. API routes are excluded because the
  // guard chain, not a redirect, is what protects them.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg|api/).*)'],
};
