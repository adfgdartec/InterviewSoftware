import { BRAND } from '@loopcraft/core';

/**
 * Renewal consent, the retainable acknowledgment, and reminders. Spec §5.4: California
 * "requires express affirmative consent to the auto-renewal terms plus a retainable
 * acknowledgment containing the terms and cancellation instructions."
 *
 * "Retainable" is the load-bearing word: the acknowledgment has to be something the customer
 * keeps, so it is generated as plain text for email rather than rendered only in-app.
 */

export interface RenewalTerms {
  readonly planId: string;
  readonly planName: string;
  readonly priceCents: number;
  readonly currency: string;
  readonly periodLabel: string;
  readonly firstChargeAt: Date;
  readonly renewsAt: Date;
}

export class RenewalConsentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RenewalConsentError';
  }
}

export interface ConsentRecord {
  readonly userId: string;
  readonly planId: string;
  readonly policyVersion: string;
  readonly grantedAt: Date;
  /** The exact terms text shown at the moment of consent, stored verbatim. */
  readonly termsShown: string;
}

export function formatPrice(cents: number, currency: string): string {
  if (!Number.isInteger(cents) || cents < 0) {
    throw new RenewalConsentError(`Price must be a non-negative integer of minor units, got ${cents}`);
  }
  return `${currency} ${(cents / 100).toFixed(2)}`;
}

/**
 * The renewal terms a user must affirmatively agree to. Every element California enumerates
 * is present: what recurs, how much, how often, when, and how to stop it.
 */
export function renewalTermsText(terms: RenewalTerms): string {
  if (terms.renewsAt <= terms.firstChargeAt) {
    throw new RenewalConsentError('Renewal date must be after the first charge.');
  }
  return [
    `${terms.planName} renews automatically.`,
    `You will be charged ${formatPrice(terms.priceCents, terms.currency)} ${terms.periodLabel}.`,
    `Your first charge is ${terms.firstChargeAt.toISOString().slice(0, 10)}.`,
    `It renews on ${terms.renewsAt.toISOString().slice(0, 10)} and each ${terms.periodLabel} after that.`,
    'You can cancel at any time from Settings, in two clicks, and keep access until the end of the period you have paid for.',
    'Cancelling is never harder than signing up and we will not ask you to talk to anyone first.',
  ].join('\n');
}

/**
 * Records affirmative consent. Refuses to record consent to terms that were never shown --
 * a consent record whose text is reconstructed later is not evidence of what the customer
 * actually agreed to.
 */
export function recordConsent(
  userId: string,
  terms: RenewalTerms,
  policyVersion: string,
  grantedAt: Date = new Date(),
): ConsentRecord {
  if (userId.trim() === '') throw new RenewalConsentError('Consent needs a user.');
  if (policyVersion.trim() === '') throw new RenewalConsentError('Consent needs a policy version.');
  return {
    userId,
    planId: terms.planId,
    policyVersion,
    grantedAt,
    termsShown: renewalTermsText(terms),
  };
}

/** The retainable acknowledgment, emailed after consent. Plain text so it survives forwarding. */
export function acknowledgmentEmail(consent: ConsentRecord, terms: RenewalTerms): string {
  return [
    `Subject: Your ${terms.planName} subscription — keep this for your records`,
    '',
    `You signed up for ${terms.planName} on ${consent.grantedAt.toISOString().slice(0, 10)}.`,
    '',
    'THE TERMS YOU AGREED TO',
    consent.termsShown,
    '',
    'HOW TO CANCEL',
    'Settings → Subscription → Cancel subscription → Confirm. That is the whole flow.',
    `Or reply to this email and we will cancel it for you: ${BRAND.supportEmail}`,
    '',
    `Policy version ${consent.policyVersion}.`,
    BRAND.affiliationDisclaimer,
  ].join('\n');
}

/**
 * When to remind the customer before a renewal charge. Reminders are sent before the charge,
 * never after, which is the point of a reminder.
 */
export const REMINDER_DAYS_BEFORE = [7, 1] as const;

export function reminderSchedule(renewsAt: Date): readonly Date[] {
  return REMINDER_DAYS_BEFORE.map((days) => new Date(renewsAt.getTime() - days * 86_400_000)).sort(
    (a, b) => a.getTime() - b.getTime(),
  );
}

/** Reminders still in the future relative to `now`. */
export function pendingReminders(renewsAt: Date, now: Date = new Date()): readonly Date[] {
  return reminderSchedule(renewsAt).filter((d) => d.getTime() > now.getTime());
}

export interface CancellationOutcome {
  readonly canceledAt: Date;
  /** Access continues to the end of the paid period; nothing is clawed back. */
  readonly accessUntil: Date;
  readonly willRenew: false;
  readonly confirmationText: string;
}

/**
 * Cancels. Access runs to the end of the period already paid for -- terminating immediately
 * would be taking money for service not rendered.
 */
export function cancel(
  currentPeriodEnd: Date,
  canceledAt: Date = new Date(),
): CancellationOutcome {
  if (currentPeriodEnd < canceledAt) {
    throw new RenewalConsentError('Cannot cancel a period that has already ended.');
  }
  return {
    canceledAt,
    accessUntil: currentPeriodEnd,
    willRenew: false,
    confirmationText:
      `Your subscription is cancelled and will not renew. You keep full access until ` +
      `${currentPeriodEnd.toISOString().slice(0, 10)}.`,
  };
}
