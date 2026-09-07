import type { ReactElement } from 'react';
import { signUp, signInWithGoogle } from '../auth/actions.js';
import { AuthForm } from '../../components/AuthForm.js';

export const metadata = { title: 'Create an account' };

const AGE_OPTIONS = [
  { value: 'under_13', label: 'Under 13' },
  { value: '13_to_15', label: '13 to 15' },
  { value: '16_plus', label: '16 or older' },
];

const REGION_OPTIONS = [
  { value: 'eu', label: 'European Union' },
  { value: 'illinois', label: 'Illinois' },
  { value: 'us_other', label: 'Another US state' },
  { value: 'other', label: 'Elsewhere' },
];

export default async function SignUpPage(
  { searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> },
): Promise<ReactElement> {
  const params = await searchParams;

  if (params['check'] === '1') {
    return (
      <div className="mx-auto max-w-md">
        <h1 className="display text-plum-900 text-[length:var(--text-display-s)]">Check your email</h1>
        <p className="mt-4 text-neutral-600">
          We have sent a confirmation link. Your account is not active until you open it.
        </p>
        <p className="mt-6">
          <a href="/signin" className="btn btn-quiet">Back to sign in</a>
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md">
      <h1 className="display text-plum-900 text-[length:var(--text-display-s)]">Create an account</h1>
      <p className="mt-3 text-neutral-600">
        Already have one?{' '}
        <a href="/signin" className="font-medium text-plum-700 underline underline-offset-2">
          Sign in
        </a>
        .
      </p>

      <AuthForm
        action={signUp}
        submitLabel="Create account"
        pendingLabel="Creating…"
        fields={[
          {
            kind: 'text',
            id: 'displayName',
            label: 'Your name',
            autoComplete: 'name',
            hint: 'Optional. Shown only to you.',
          },
          { kind: 'email', id: 'email', label: 'Email', autoComplete: 'email', required: true },
          {
            kind: 'password',
            id: 'password',
            label: 'Password',
            autoComplete: 'new-password',
            required: true,
            hint: 'At least 10 characters.',
            restore: false,
          },
          {
            kind: 'select',
            id: 'ageBand',
            label: 'Your age',
            options: AGE_OPTIONS,
            hint: 'Self-reported. We do not verify it. Accounts are limited to 13 and over, and 16 and over in the EU.',
          },
          {
            kind: 'select',
            id: 'jurisdiction',
            label: 'Where you are',
            options: REGION_OPTIONS,
            hint: 'Sets which features are available to you. The camera framing check is disabled entirely in the EU and Illinois.',
          },
          {
            kind: 'checkbox',
            id: 'accept',
            label: 'I accept the terms of service and the privacy notice (linked in the footer).',
          },
        ]}
      />

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
      <p className="mt-3 text-xs text-neutral-600">
        You will be asked for your age and region before the account is usable.
      </p>
    </div>
  );
}
