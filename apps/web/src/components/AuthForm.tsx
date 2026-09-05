'use client';

import { useActionState, type ReactElement } from 'react';
import type { FormState } from '../app/auth/actions.js';

/**
 * The shared shell for every auth form.
 *
 * Fields are declared as plain data rather than passed as children. That is not a style
 * choice: this is a Client Component rendered from Server Components, and a function -- a
 * render prop, or JSX built by a callback -- cannot cross that boundary, because the RSC
 * payload has to be serializable. Passing children as a function throws "Functions are not
 * valid as a child of Client Components" at runtime while type-checking cleanly and passing
 * a static-markup accessibility audit perfectly happily. It was caught by loading the page.
 *
 * Declaring fields as data also keeps the restore-after-rejection logic in one place: React
 * resets uncontrolled inputs once a form action runs, so without repopulating them a wrong
 * age band would wipe the email, the name and the consent checkbox too.
 *
 * The form posts to a Server Action, so it works with JavaScript disabled; `useActionState`
 * only upgrades the error display and the pending state.
 */

export type FieldSpec =
  | {
      readonly kind: 'text' | 'email' | 'password';
      readonly id: string;
      readonly label: string;
      readonly autoComplete?: string;
      readonly required?: boolean;
      readonly hint?: string;
      /** Password fields set this false: a password is never echoed back through server state. */
      readonly restore?: boolean;
    }
  | {
      readonly kind: 'select';
      readonly id: string;
      readonly label: string;
      readonly hint?: string;
      readonly options: readonly { readonly value: string; readonly label: string }[];
    }
  | {
      readonly kind: 'checkbox';
      readonly id: string;
      readonly label: string;
    };

export interface AuthFormProps {
  readonly action: (prev: FormState, form: FormData) => Promise<FormState>;
  readonly submitLabel: string;
  readonly pendingLabel: string;
  readonly fields: readonly FieldSpec[];
}

const INITIAL: FormState = { error: null };

const CONTROL_CLASS =
  'mt-2 w-full rounded-lg border border-rule-firm bg-raised px-3 py-2.5 text-base text-neutral-900 focus:border-gold-600 focus:outline-none';

function Hint({ id, hint }: { id: string; hint: string | undefined }): ReactElement | null {
  if (hint === undefined) return null;
  return (
    <p id={`${id}-hint`} className="mt-1.5 text-xs text-neutral-600">
      {hint}
    </p>
  );
}

function renderField(field: FieldSpec, values: Readonly<Record<string, string>>): ReactElement {
  const restored = values[field.id];
  // Remounting on a changed restored value is what makes defaultValue actually apply; React
  // keeps the existing (already reset) DOM node otherwise.
  const key = `${field.id}:${restored ?? ''}`;

  if (field.kind === 'checkbox') {
    return (
      <div key={key} className="flex items-start gap-3">
        <input
          id={field.id}
          name={field.id}
          type="checkbox"
          required
          defaultChecked={restored === 'on'}
          className="mt-1 h-4 w-4 shrink-0 accent-plum-700"
        />
        <label htmlFor={field.id} className="text-sm text-neutral-900">
          {field.label}
        </label>
      </div>
    );
  }

  if (field.kind === 'select') {
    return (
      <div key={key}>
        <label htmlFor={field.id} className="label block text-plum-500">
          {field.label}
        </label>
        <select
          id={field.id}
          name={field.id}
          required
          defaultValue={restored ?? ''}
          aria-describedby={field.hint === undefined ? undefined : `${field.id}-hint`}
          className={CONTROL_CLASS}
        >
          <option value="" disabled>
            Choose one
          </option>
          {field.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <Hint id={field.id} hint={field.hint} />
      </div>
    );
  }

  return (
    <div key={key}>
      <label htmlFor={field.id} className="label block text-plum-500">
        {field.label}
      </label>
      <input
        id={field.id}
        name={field.id}
        type={field.kind}
        autoComplete={field.autoComplete}
        required={field.required}
        defaultValue={field.restore === false ? undefined : restored}
        aria-describedby={field.hint === undefined ? undefined : `${field.id}-hint`}
        className={CONTROL_CLASS}
      />
      <Hint id={field.id} hint={field.hint} />
    </div>
  );
}

export function AuthForm({ action, submitLabel, pendingLabel, fields }: AuthFormProps): ReactElement {
  const [state, formAction, pending] = useActionState(action, INITIAL);
  const values = state.values ?? {};

  return (
    <form action={formAction} className="mt-8 flex flex-col gap-5">
      {fields.map((field) => renderField(field, values))}
      {state.error !== null ? (
        <p
          role="alert"
          className="rounded-lg border-l-2 border-danger bg-sunk px-3 py-2 text-sm font-medium text-danger"
        >
          {state.error}
        </p>
      ) : null}
      <button type="submit" disabled={pending} className="btn btn-primary w-full">
        {pending ? pendingLabel : submitLabel}
      </button>
    </form>
  );
}
