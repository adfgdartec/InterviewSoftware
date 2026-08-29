/**
 * Subscription flows modelled as ordered steps, so spec §6's exit criterion -- "cancel flow
 * <= signup clicks" -- is a property the build can assert rather than a claim in a document.
 *
 * Spec §5.4: the Eighth Circuit vacated the FTC's Click-to-Cancel rule in 2025, but state
 * automatic-renewal laws were unaffected. California's is the strictest, so it is the
 * national default here: separate affirmative consent to the renewal terms, a retainable
 * acknowledgment containing the terms and cancellation instructions, renewal reminders, and
 * cancellation in no more clicks than signup with no blocking retention interstitial.
 */

export type StepKind =
  | 'form'
  | 'confirm'
  | 'payment'
  | 'consent'
  | 'informational'
  | 'retention_offer';

export interface FlowStep {
  readonly id: string;
  readonly kind: StepKind;
  readonly label: string;
  /** Interactions a user must perform to advance. Informational steps that auto-advance are 0. */
  readonly clicks: number;
  /** True when the user cannot reach the next step without resolving this one. */
  readonly blocking: boolean;
}

export interface Flow {
  readonly id: string;
  readonly steps: readonly FlowStep[];
}

export class ArlViolationError extends Error {
  constructor(public readonly violations: readonly string[]) {
    super(`Auto-renewal compliance failure: ${violations.join('; ')}`);
    this.name = 'ArlViolationError';
  }
}

export function totalClicks(flow: Flow): number {
  return flow.steps.reduce((sum, s) => sum + s.clicks, 0);
}

/**
 * The signup flow for an auto-renewing plan. Renewal consent is its own step, deliberately
 * separate from the payment step: California requires affirmative consent to the renewal
 * terms specifically, and a checkbox bundled into "agree to terms and pay" is not that.
 */
export const AUTO_RENEW_SIGNUP: Flow = {
  id: 'signup.auto_renew',
  steps: [
    { id: 'choose_plan', kind: 'form', label: 'Choose a plan', clicks: 1, blocking: true },
    {
      id: 'renewal_consent',
      kind: 'consent',
      label: 'Agree to the renewal terms',
      clicks: 1,
      blocking: true,
    },
    { id: 'pay', kind: 'payment', label: 'Pay', clicks: 1, blocking: true },
  ],
};

/** The one-time Sprint pass. No renewal, so no renewal consent and no cancellation flow. */
export const ONE_TIME_SIGNUP: Flow = {
  id: 'signup.one_time',
  steps: [
    { id: 'choose_plan', kind: 'form', label: 'Choose the 14-day pass', clicks: 1, blocking: true },
    { id: 'pay', kind: 'payment', label: 'Pay', clicks: 1, blocking: true },
  ],
};

/**
 * Cancellation. One click to start, one to confirm -- matching signup's two decision points
 * and never exceeding its three. There is no retention offer anywhere in this flow, blocking
 * or otherwise: a "before you go" step is precisely what state ARLs treat as an obstacle.
 */
export const CANCEL_FLOW: Flow = {
  id: 'cancel.auto_renew',
  steps: [
    { id: 'open_cancel', kind: 'form', label: 'Cancel subscription', clicks: 1, blocking: true },
    {
      id: 'confirm_cancel',
      kind: 'confirm',
      label: 'Confirm cancellation',
      clicks: 1,
      blocking: true,
    },
  ],
};

export interface FlowComparison {
  readonly signupClicks: number;
  readonly cancelClicks: number;
  readonly compliant: boolean;
  readonly violations: readonly string[];
}

/**
 * The spec §6 gate. Checks the two things that actually matter: cancellation is not longer
 * than signup, and nothing on the cancellation path blocks the user with a retention offer.
 */
export function compareFlows(signup: Flow, cancel: Flow): FlowComparison {
  const signupClicks = totalClicks(signup);
  const cancelClicks = totalClicks(cancel);
  const violations: string[] = [];

  if (cancelClicks > signupClicks) {
    violations.push(
      `cancellation takes ${cancelClicks} clicks but signup takes ${signupClicks}`,
    );
  }
  for (const step of cancel.steps) {
    if (step.kind === 'retention_offer' && step.blocking) {
      violations.push(`cancellation step "${step.id}" blocks the path with a retention offer`);
    }
  }
  if (cancel.steps.length === 0) {
    violations.push('cancellation flow has no steps, so there is no path to cancel');
  }

  return { signupClicks, cancelClicks, compliant: violations.length === 0, violations };
}

/** Throws when the flows are non-compliant. This is what CI calls. */
export function assertFlowsCompliant(signup: Flow, cancel: Flow): void {
  const result = compareFlows(signup, cancel);
  if (!result.compliant) throw new ArlViolationError(result.violations);
}
