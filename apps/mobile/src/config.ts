/**
 * Where the app talks to, and what it needs to get there.
 *
 * The native app has NO backend of its own: it calls the same Next.js API routes the web app
 * does, authenticates against the same Supabase project, and is gated by the same guard chain
 * and RLS policies. That is the whole reason this is a thin client -- a second backend would
 * be a second place for the entitlement and compliance rules to drift.
 */

const extra = (key: string): string => {
  const value = process.env[key];
  if (value === undefined || value === '') {
    throw new Error(`${key} is not set. Copy .env.example to .env and fill it in.`);
  }
  return value;
};

/** The deployed web app. On a simulator, localhost is the HOST machine, not the device. */
export const API_BASE_URL = extra('EXPO_PUBLIC_API_BASE_URL');

/**
 * The Supabase URL and anon key ARE public in a native app -- they ship inside the binary and
 * anyone can extract them. That is expected and safe: the anon key grants nothing on its own,
 * because every table is behind RLS and every route behind the guard chain. It is the reason
 * the SERVICE ROLE key must never appear here.
 */
export const SUPABASE_URL = extra('EXPO_PUBLIC_SUPABASE_URL');
export const SUPABASE_ANON_KEY = extra('EXPO_PUBLIC_SUPABASE_ANON_KEY');
