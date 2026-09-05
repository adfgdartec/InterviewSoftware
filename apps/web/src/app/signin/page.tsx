import type { ReactElement } from 'react';
import { signIn, signInWithGoogle } from '../auth/actions.js';
import { AuthForm } from '../../components/AuthForm.js';

export const metadata = { title: 'Sign in' };

export default async function SignInPage(
  { searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> },
): Promise<ReactElement> {
  const params = await searchParams;
  const linkFailed = params['error'] === 'link';
  const oauthFailed = params['error'] === 'oauth';

  return (
    <div className="mx-auto max-w-md">
      <h1 className="display text-plum-900 text-[length:var(--text-display-s)]">Sign in</h1>
      <p className="mt-3 text-neutral-600">
        New here?{' '}
        <a href="/signup" className="font-medium text-plum-700 underline underline-offset-2">
          Create an account
        </a>
        .
      </p>

      {linkFailed ? (
        <p role="alert" className="mt-6 rounded-lg border-l-2 border-warning bg-gold-100 px-3 py-2 text-sm text-warning">
          That link has expired or was already used. Sign in, or request a new reset link.
        </p>
      ) : null}
      {oauthFailed ? (
        <p role="alert" className="mt-6 rounded-lg border-l-2 border-danger bg-sunk px-3 py-2 text-sm text-danger">
          Google sign-in could not be started. Try email and password.
        </p>
      ) : null}

      <AuthForm
        action={signIn}
        submitLabel="Sign in"
        pendingLabel="Signing in…"
        fields={[
          { kind: 'email', id: 'email', label: 'Email', autoComplete: 'email', required: true },
          {
            kind: 'password',
            id: 'password',
            label: 'Password',
            autoComplete: 'current-password',
            required: true,
            restore: false,
          },
        ]}
      />

      <p className="mt-4 text-sm">
        <a href="/auth/reset" className="text-plum-700 underline underline-offset-2">
          Forgotten your password?
        </a>
      </p>

      <div className="mt-8 flex items-center gap-3" aria-hidden="true">
        <span className="h-px flex-1 bg-rule" />
        <span className="label text-neutral-600">or</span>
        <span className="h-px flex-1 bg-rule" />
      </div>

      <form action={signInWithGoogle} className="mt-6">
        <button type="submit" className="btn btn-quiet w-full">
          Continue with Google
        </button>
      </form>
    </div>
  );
}
