import type { ReactElement } from 'react';
import { requestPasswordReset } from '../actions.js';
import { AuthForm } from '../../../components/AuthForm.js';

export const metadata = { title: 'Reset your password' };

export default async function ResetPage(
  { searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> },
): Promise<ReactElement> {
  const params = await searchParams;

  if (params['sent'] === '1') {
    return (
      <div className="mx-auto max-w-md">
        <h1 className="display text-plum-900 text-[length:var(--text-display-s)]">Check your email</h1>
        {/* Deliberately unconditional: saying "no account with that email" here would turn
            this form into an account-existence oracle. */}
        <p className="mt-4 text-neutral-600">
          If that address has an account, a reset link is on its way.
        </p>
        <p className="mt-6"><a href="/signin" className="btn btn-quiet">Back to sign in</a></p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md">
      <h1 className="display text-plum-900 text-[length:var(--text-display-s)]">Reset your password</h1>
      <p className="mt-3 text-neutral-600">We will email you a link to set a new one.</p>
      <AuthForm
        action={requestPasswordReset}
        submitLabel="Send the link"
        pendingLabel="Sending…"
        fields={[
          { kind: 'email', id: 'email', label: 'Email', autoComplete: 'email', required: true },
        ]}
      />
    </div>
  );
}
