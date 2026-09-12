import { describe, expect, it } from 'vitest';
import { findClaimViolations, findBannedTokensInText, type RatesShape } from '@loopcraft/core';
import {
  ArlViolationError,
  AUTO_RENEW_SIGNUP,
  CANCEL_FLOW,
  DEFAULT_MARGIN_FLOOR,
  MarginGateError,
  ONE_TIME_SIGNUP,
  REMINDER_DAYS_BEFORE,
  RenewalConsentError,
  acknowledgmentEmail,
  assertFlowsCompliant,
  assertMarginsAcceptable,
  cancel,
  compareFlows,
  evaluateMargins,
  formatPrice,
  pendingReminders,
  recordConsent,
  reminderSchedule,
  renewalTermsText,
  totalClicks,
  type Flow,
  type PlanForMargin,
  type RenewalTerms,
} from '../src/index.js';
import { RATES } from '@loopcraft/core';

const TERMS: RenewalTerms = {
  planId: 'pro-monthly',
  planName: 'Pro (monthly)',
  priceCents: 4_900,
  currency: 'USD',
  periodLabel: 'month',
  firstChargeAt: new Date('2026-09-01T00:00:00Z'),
  renewsAt: new Date('2026-10-01T00:00:00Z'),
};

describe('cancel is never harder than signup (spec §6 exit criterion)', () => {
  it('passes for the shipped flows', () => {
    const c = compareFlows(AUTO_RENEW_SIGNUP, CANCEL_FLOW);
    expect(c.compliant).toBe(true);
    expect(c.cancelClicks).toBeLessThanOrEqual(c.signupClicks);
    expect(() => assertFlowsCompliant(AUTO_RENEW_SIGNUP, CANCEL_FLOW)).not.toThrow();
  });

  it('counts clicks across every step', () => {
    expect(totalClicks(AUTO_RENEW_SIGNUP)).toBe(3);
    expect(totalClicks(CANCEL_FLOW)).toBe(2);
    expect(totalClicks(ONE_TIME_SIGNUP)).toBe(2);
  });

  it('fails when cancellation takes more clicks than signup', () => {
    const longer: Flow = {
      id: 'cancel.bad',
      steps: [
        ...CANCEL_FLOW.steps,
        { id: 'survey', kind: 'form', label: 'Why are you leaving?', clicks: 2, blocking: true },
      ],
    };
    const c = compareFlows(AUTO_RENEW_SIGNUP, longer);
    expect(c.compliant).toBe(false);
    expect(c.violations[0]).toMatch(/cancellation takes 4 clicks but signup takes 3/);
  });

  it('fails when a retention offer blocks the path', () => {
    const withSave: Flow = {
      id: 'cancel.bad',
      steps: [
        CANCEL_FLOW.steps[0]!,
        { id: 'save_offer', kind: 'retention_offer', label: 'Have 50% off', clicks: 0, blocking: true },
        CANCEL_FLOW.steps[1]!,
      ],
    };
    expect(() => assertFlowsCompliant(AUTO_RENEW_SIGNUP, withSave)).toThrow(ArlViolationError);
    expect(compareFlows(AUTO_RENEW_SIGNUP, withSave).violations[0]).toMatch(/retention offer/);
  });

  it('fails when there is no cancellation path at all', () => {
    expect(compareFlows(AUTO_RENEW_SIGNUP, { id: 'none', steps: [] }).violations)
      .toContain('cancellation flow has no steps, so there is no path to cancel');
  });

  it('keeps renewal consent as its own step, not bundled into payment', () => {
    const consentSteps = AUTO_RENEW_SIGNUP.steps.filter((s) => s.kind === 'consent');
    expect(consentSteps).toHaveLength(1);
    const payment = AUTO_RENEW_SIGNUP.steps.find((s) => s.kind === 'payment');
    expect(payment?.id).not.toBe(consentSteps[0]?.id);
  });

  it('asks for no renewal consent on a one-time pass', () => {
    expect(ONE_TIME_SIGNUP.steps.some((s) => s.kind === 'consent')).toBe(false);
  });
});

describe('renewal terms and the retainable acknowledgment (spec §5.4)', () => {
  const text = renewalTermsText(TERMS);

  it('states what recurs, how much, how often, when, and how to stop', () => {
    expect(text).toMatch(/renews automatically/i);
    expect(text).toContain('USD 49.00');
    expect(text).toMatch(/per month|each month|month/i);
    expect(text).toContain('2026-09-01');
    expect(text).toContain('2026-10-01');
    expect(text).toMatch(/cancel at any time/i);
  });

  it('promises cancellation is no harder than signup, matching the modelled flow', () => {
    expect(text).toMatch(/two clicks/i);
    expect(totalClicks(CANCEL_FLOW)).toBe(2);
  });

  it('formats prices from minor units and rejects nonsense', () => {
    expect(formatPrice(4_900, 'USD')).toBe('USD 49.00');
    expect(formatPrice(0, 'USD')).toBe('USD 0.00');
    expect(() => formatPrice(-1, 'USD')).toThrow(RenewalConsentError);
    expect(() => formatPrice(49.5, 'USD')).toThrow(RenewalConsentError);
  });

  it('refuses terms whose renewal precedes the first charge', () => {
    expect(() => renewalTermsText({ ...TERMS, renewsAt: new Date('2026-08-01T00:00:00Z') }))
      .toThrow(RenewalConsentError);
  });

  it('stores the exact terms shown, not a reconstruction', () => {
    const consent = recordConsent('user-1', TERMS, 'arl-v1', new Date('2026-09-01T00:00:00Z'));
    expect(consent.termsShown).toBe(text);
    expect(consent.planId).toBe('pro-monthly');
    expect(consent.policyVersion).toBe('arl-v1');
  });

  it('refuses to record consent without a user or a policy version', () => {
    expect(() => recordConsent('', TERMS, 'arl-v1')).toThrow(RenewalConsentError);
    expect(() => recordConsent('user-1', TERMS, '  ')).toThrow(RenewalConsentError);
  });

  it('emails an acknowledgment containing the terms and the cancellation instructions', () => {
    const consent = recordConsent('user-1', TERMS, 'arl-v1', new Date('2026-09-01T00:00:00Z'));
    const email = acknowledgmentEmail(consent, TERMS);
    expect(email).toContain('THE TERMS YOU AGREED TO');
    expect(email).toContain('HOW TO CANCEL');
    expect(email).toContain(consent.termsShown);
    expect(email).toMatch(/Settings → Subscription → Cancel/);
    expect(email).toContain('not affiliated with');
  });
});

describe('renewal reminders are sent before the charge', () => {
  const renews = new Date('2026-10-01T00:00:00Z');

  it('schedules every configured reminder before the renewal date', () => {
    const schedule = reminderSchedule(renews);
    expect(schedule).toHaveLength(REMINDER_DAYS_BEFORE.length);
    for (const d of schedule) expect(d.getTime()).toBeLessThan(renews.getTime());
  });

  it('orders reminders earliest first', () => {
    const times = reminderSchedule(renews).map((d) => d.getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it('drops reminders whose moment has passed', () => {
    expect(pendingReminders(renews, new Date('2026-09-28T00:00:00Z'))).toHaveLength(1);
    expect(pendingReminders(renews, new Date('2026-10-02T00:00:00Z'))).toHaveLength(0);
  });
});

describe('cancellation does not claw back paid-for access', () => {
  it('keeps access to the end of the paid period', () => {
    const outcome = cancel(new Date('2026-10-01T00:00:00Z'), new Date('2026-09-10T00:00:00Z'));
    expect(outcome.willRenew).toBe(false);
    expect(outcome.accessUntil.toISOString()).toContain('2026-10-01');
    expect(outcome.confirmationText).toMatch(/will not renew/);
    expect(outcome.confirmationText).toMatch(/2026-10-01/);
  });

  it('refuses to cancel a period that already ended', () => {
    expect(() => cancel(new Date('2026-01-01T00:00:00Z'), new Date('2026-09-10T00:00:00Z')))
      .toThrow(RenewalConsentError);
  });
});

describe('the margin gate refuses to certify unpriced drivers (guardrail 8)', () => {
  const PLANS: PlanForMargin[] = [
    { id: 'free', name: 'Free', priceCents: 0, includedSessions: 2, billingPeriod: 'free' },
    { id: 'pro-monthly', name: 'Pro', priceCents: 4_900, includedSessions: 8, billingPeriod: 'monthly' },
  ];

  const FILLED: RatesShape = {
    asOf: '2026-08-29', currency: 'USD',
    asrPerMinute: 0.006, ttsPerThousandCharacters: 0.015,
    llm: {
      questionGeneration: { inputPerMillionTokens: 3, outputPerMillionTokens: 15 },
      grading: { inputPerMillionTokens: 3, outputPerMillionTokens: 15 },
    },
    codeExecutionPerCpuSecond: 0.0001, storagePerGigabyteMonth: 0.021,
    egressPerGigabyte: 0.09, payment: { percentOfTransaction: 0.029, fixedPerTransaction: 0.3 },
  };

  it('reports rates_unset against the committed rates file, and names the gaps', () => {
    // The committed table is now partly priced from the vendors' own pages, so the gate has
    // fewer gaps to name -- but a partial table must still not certify a margin, and the two
    // it names are the two rates-sources.md documents as unobtainable in the needed units.
    const report = evaluateMargins(PLANS, RATES);
    expect(report.verdict).toBe('rates_unset');
    expect(report.message).toMatch(/still null/);
    expect(report.message).toMatch(/ttsPerThousandCharacters/);
    expect(report.message).toMatch(/codeExecutionPerCpuSecond/);
    // A rate that IS priced must not be reported as a gap.
    expect(report.message).not.toMatch(/asrPerMinute/);
    expect(report.plans).toEqual([]);
  });

  it('throws on unpriced rates rather than passing vacuously', () => {
    expect(() => assertMarginsAcceptable(PLANS, RATES)).toThrow(MarginGateError);
  });

  it('flags $49-for-8-sessions as below the floor at these rates', () => {
    // A real finding, not a contrived one: at roughly $1.83 of provider cost per session,
    // eight included sessions plus the payment fee leaves about 67% margin, under the 70%
    // floor. The gate exists to surface exactly this before the price is published.
    const report = evaluateMargins(PLANS, FILLED);
    expect(report.verdict).toBe('breach');
    expect(report.plans[0]?.margin).toBeLessThan(DEFAULT_MARGIN_FLOOR);
    expect(report.plans[0]?.margin).toBeGreaterThan(0.6);
  });

  it('passes once the plan is priced above the floor', () => {
    const priced: PlanForMargin[] = [
      { id: 'pro-59', name: 'Pro', priceCents: 5_900, includedSessions: 8, billingPeriod: 'monthly' },
    ];
    const report = evaluateMargins(priced, FILLED);
    expect(report.verdict).toBe('pass');
    expect(report.plans[0]?.margin).toBeGreaterThanOrEqual(DEFAULT_MARGIN_FLOOR);
    expect(report.breaches).toEqual([]);
  });

  it('passes when included volume is reduced instead of raising the price', () => {
    const leaner: PlanForMargin[] = [
      { id: 'pro-4', name: 'Pro', priceCents: 4_900, includedSessions: 4, billingPeriod: 'monthly' },
    ];
    expect(evaluateMargins(leaner, FILLED).verdict).toBe('pass');
  });

  it('skips free plans, which have no margin to compute', () => {
    expect(evaluateMargins(PLANS, FILLED).plans.map((p) => p.planId)).toEqual(['pro-monthly']);
  });

  it('flags a plan whose included volume outruns its price', () => {
    const generous: PlanForMargin[] = [
      { id: 'too-generous', name: 'Oops', priceCents: 900, includedSessions: 50, billingPeriod: 'monthly' },
    ];
    const report = evaluateMargins(generous, FILLED);
    expect(report.verdict).toBe('breach');
    expect(report.breaches[0]).toMatch(/too-generous.*below floor/);
    expect(() => assertMarginsAcceptable(generous, FILLED)).toThrow(MarginGateError);
  });

  it('rejects a nonsensical floor', () => {
    expect(() => evaluateMargins(PLANS, FILLED, 0)).toThrow(RangeError);
    expect(() => evaluateMargins(PLANS, FILLED, 1)).toThrow(RangeError);
  });

  it('handles a plan with zero included sessions without dividing by zero', () => {
    const zero: PlanForMargin[] = [
      { id: 'z', name: 'Z', priceCents: 4_900, includedSessions: 0, billingPeriod: 'monthly' },
    ];
    expect(Number.isFinite(evaluateMargins(zero, FILLED).plans[0]!.margin)).toBe(true);
  });
});

describe('billing copy says nothing forbidden', () => {
  it('makes no banned marketing claim', () => {
    const consent = recordConsent('u', TERMS, 'arl-v1', new Date('2026-09-01T00:00:00Z'));
    const strings = {
      terms: renewalTermsText(TERMS),
      email: acknowledgmentEmail(consent, TERMS),
      cancel: cancel(new Date('2026-10-01T00:00:00Z'), new Date('2026-09-10T00:00:00Z')).confirmationText,
    };
    expect(findClaimViolations(strings)).toEqual([]);
    for (const [key, value] of Object.entries(strings)) {
      expect({ key, hits: findBannedTokensInText(value).length }).toEqual({ key, hits: 0 });
    }
  });
});
