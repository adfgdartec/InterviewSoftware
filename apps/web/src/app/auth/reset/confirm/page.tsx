import type { ReactElement } from 'react';
import { confirmPasswordReset } from '../../actions.js';
import { AuthForm } from '../../../../components/AuthForm.js';

export const metadata = { title: 'Set a new password' };

export default function ResetConfirmPage(): ReactElement {
  return (
    <div className="mx-auto max-w-md">
      <h1 className="display text-plum-900 text-[length:var(--text-display-s)]">Set a new password</h1>
      <p className="mt-3 text-neutral-600">This link works once.</p>
      <AuthForm
        action={confirmPasswordReset}
        submitLabel="Save the password"
        pendingLabel="Saving…"
        fields={[
          {
            kind: 'password',
            id: 'password',
            label: 'New password',
            autoComplete: 'new-password',
            required: true,
            hint: 'At least 10 characters.',
            restore: false,
          },
        ]}
      />
    </div>
  );
}
