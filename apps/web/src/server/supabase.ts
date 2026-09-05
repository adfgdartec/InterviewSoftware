import { createServerClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { hasCredential, readCredential } from '@loopcraft/providers';

/**
 * The Supabase client, server-side only.
 *
 * The standard Next.js integration puts SUPABASE_ANON_KEY in the browser bundle as a
 * NEXT_PUBLIC_ variable. That FAILS this repo's own build: no-client-secrets.test.ts refuses
 * any source matching /NEXT_PUBLIC_[A-Z0-9_]*(KEY|SECRET|TOKEN|...)/, and Supabase's newer
 * "publishable key" naming still contains KEY.
 *
 * The resolution is not an exemption. Every auth call runs on the server -- Server Actions
 * for sign-in and sign-up, a route handler for the OAuth callback -- so the browser never
 * holds a Supabase client and no key reaches the bundle. The credential is read through
 * secrets.ts like every other credential in the repo, which also keeps the "exactly one
 * module reads credentials" test passing.
 */

/** A URL, not a secret: safe to be public, and it does not trip the NEXT_PUBLIC_ gate. */
function supabaseUrl(): string {
  const url = process.env['NEXT_PUBLIC_SUPABASE_URL'] ?? process.env['SUPABASE_URL'];
  if (url === undefined || url === '') {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL is not set. Authentication cannot run.');
  }
  return url;
}

export function supabaseConfigured(): boolean {
  const url = process.env['NEXT_PUBLIC_SUPABASE_URL'] ?? process.env['SUPABASE_URL'];
  // Through hasCredential rather than process.env: guardrail 6's test refuses any shipped
  // source that names a credential env var inline, and a presence probe is still a read.
  return url !== undefined && url !== '' && hasCredential('SUPABASE_ANON_KEY');
}

/**
 * A client bound to the request's cookie jar. Next's `cookies()` is read-only inside Server
 * Components, and writing to it there throws -- so `setAll` swallows that specific case,
 * which is the documented @supabase/ssr pattern: the middleware is what actually refreshes
 * the session cookie, and a Server Component only ever needs to read it.
 */
export async function serverClient(): Promise<SupabaseClient> {
  const jar = await cookies();
  return createServerClient(supabaseUrl(), readCredential('SUPABASE_ANON_KEY'), {
    cookies: {
      getAll: () => jar.getAll(),
      setAll: (toSet) => {
        try {
          for (const { name, value, options } of toSet) jar.set(name, value, options);
        } catch {
          // Called from a Server Component. The middleware refreshes the session instead.
        }
      },
    },
  });
}
