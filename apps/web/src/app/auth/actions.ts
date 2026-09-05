'use server';

import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { serverClient } from '../../server/supabase.js';
import { PRIVACY_VERSION, TERMS_VERSION } from '../../server/auth.js';
import {
  REFUSAL_MESSAGES,
  signupPermitted,
  signupRefusalReason,
} from '../../server/signup-gate.js';

/**
 * Every auth mutation runs here, on the server. There is no Supabase client in the browser
 * bundle, which is what keeps the key out of it (see server/supabase.ts) and what lets these
 * forms work with JavaScript disabled.
 */

export interface FormState {
  readonly error: string | null;
  /**
   * What the person typed, echoed back so a rejected submission does not wipe the form.
   * React resets uncontrolled inputs after a form action runs, so without this a wrong age
   * band costs you every other field as well.
   *
   * The password is deliberately NOT echoed: re-entering it is a small cost, and round-
   * tripping it through a server response is not a trade worth making.
   */
  readonly values?: Readonly<Record<string, string>>;
}

async function originUrl(): Promise<string> {
  const h = await headers();
  const proto = h.get('x-forwarded-proto') ?? 'http';
  const host = h.get('host') ?? 'localhost:3100';
  return `${proto}://${host}`;
}

function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

export async function signIn(_prev: FormState, form: FormData): Promise<FormState> {
  const email = field(form, 'email');
  const password = field(form, 'password');
  if (email === '' || password === '') {
    return { error: 'Enter your email and password.', values: { email } };
  }

  const supabase = await serverClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error !== null) {
    // Deliberately not "no account with that email": that turns the sign-in form into an
    // account-existence oracle for anyone who wants to enumerate customers.
    return { error: 'That email and password do not match an account.', values: { email } };
  }
  redirect('/dashboard');
}

export async function signUp(_prev: FormState, form: FormData): Promise<FormState> {
  const email = field(form, 'email');
  const password = field(form, 'password');
  const displayName = field(form, 'displayName');
  const ageBand = field(form, 'ageBand');
  const jurisdiction = field(form, 'jurisdiction');
  const accepted = form.get('accept') !== null;

  const kept = { email, displayName, ageBand, jurisdiction, accept: accepted ? 'on' : '' };
  const reject = (error: string): FormState => ({ error, values: kept });

  if (email === '' || password === '') return reject('Enter an email and a password.');
  if (password.length < 10) return reject('Use a password of at least 10 characters.');
  if (!accepted) return reject('You need to accept the terms and privacy notice to continue.');

  // The gate runs BEFORE signUp, so a refused account is never created in Supabase at all --
  // there is nothing to clean up afterwards, and no auth user exists that we would then have
  // to administratively delete.
  if (!signupPermitted({ ageBand, jurisdiction })) {
    const reason = signupRefusalReason({ ageBand, jurisdiction });
    return reject(reason === null ? REFUSAL_MESSAGES.age_required : REFUSAL_MESSAGES[reason]);
  }

  const supabase = await serverClient();
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${await originUrl()}/auth/callback`,
      // Read back by `authenticateWith` when the confirmed identity first provisions its rows.
      data: {
        display_name: displayName === '' ? null : displayName,
        age_band: ageBand,
        jurisdiction,
        terms_version: TERMS_VERSION,
        privacy_version: PRIVACY_VERSION,
      },
    },
  });
  if (error !== null) return reject('Could not create that account. Try a different email.');
  redirect('/signup?check=1');
}

export async function signInWithGoogle(): Promise<void> {
  const supabase = await serverClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: `${await originUrl()}/auth/callback` },
  });
  if (error !== null || data.url === null) redirect('/signin?error=oauth');
  redirect(data.url);
}

export async function signOut(): Promise<void> {
  const supabase = await serverClient();
  await supabase.auth.signOut();
  redirect('/');
}

export async function requestPasswordReset(_prev: FormState, form: FormData): Promise<FormState> {
  const email = field(form, 'email');
  if (email === '') return { error: 'Enter your email.', values: {} };
  const supabase = await serverClient();
  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${await originUrl()}/auth/callback?next=/auth/reset/confirm`,
  });
  // Always the same answer, sent or not: the reset form must not reveal whether an address
  // has an account either.
  redirect('/auth/reset?sent=1');
}

export async function confirmPasswordReset(_prev: FormState, form: FormData): Promise<FormState> {
  const password = field(form, 'password');
  if (password.length < 10) return { error: 'Use a password of at least 10 characters.' };
  const supabase = await serverClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error !== null) {
    return { error: 'That reset link has expired. Request a new one.' };
  }
  redirect('/dashboard');
}
