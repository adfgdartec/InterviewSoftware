import { describe, expect, it } from 'vitest';
import {
  entitlementStatusFor,
  isHandledEvent,
  HANDLED_EVENTS,
  stripeConfigured,
} from '@loopcraft/billing';

/**
 * The parts of billing that decide who gets what, tested without touching Stripe.
 *
 * The division of authority is the thing worth protecting: Stripe says which plan an org is
 * on and whether it is paid up; the `plans` row says what that plan grants. These assert the
 * half that lives in code.
 */

describe('entitlementStatusFor', () => {
  it('maps the two paid-and-current statuses to usable ones', () => {
    expect(entitlementStatusFor('active')).toBe('active');
    expect(entitlementStatusFor('trialing')).toBe('trialing');
  });

  it('maps a lapsed subscription to a status the entitlement gate refuses', () => {
    expect(entitlementStatusFor('past_due')).toBe('past_due');
    expect(entitlementStatusFor('canceled')).toBe('canceled');
  });

  it('refuses anything not positively known to be paid', () => {
    // `incomplete` and `unpaid` have a subscription OBJECT but no successful payment. Reading
    // "a subscription exists" as "they may use it" is how people get the product for free.
    for (const status of ['incomplete', 'incomplete_expired', 'unpaid', 'paused']) {
      expect(entitlementStatusFor(status)).toBe('expired');
    }
  });

  it('refuses a status Stripe has not invented yet', () => {
    // Fail closed on the unknown: a future Stripe status must not default to access.
    expect(entitlementStatusFor('something_new_in_2027')).toBe('expired');
    expect(entitlementStatusFor('')).toBe('expired');
  });

  it('never returns a usable status for anything outside the known-paid pair', () => {
    const usable = new Set(['active', 'trialing']);
    const inputs = ['past_due', 'canceled', 'unpaid', 'incomplete', 'paused', 'weird', ''];
    for (const input of inputs) {
      expect(usable.has(entitlementStatusFor(input))).toBe(false);
    }
  });
});

describe('webhook event filtering', () => {
  it('handles exactly the four events that change entitlement state', () => {
    expect([...HANDLED_EVENTS]).toEqual([
      'checkout.session.completed',
      'customer.subscription.updated',
      'customer.subscription.deleted',
      'invoice.payment_failed',
    ]);
  });

  it('ignores events it has no business acting on', () => {
    // Stripe sends dozens of event types. Acting on one nobody designed for is how a
    // `charge.refunded` silently becomes an entitlement change.
    for (const type of ['charge.succeeded', 'customer.created', 'payout.paid', 'ping']) {
      expect(isHandledEvent(type)).toBe(false);
    }
  });
});

describe('stripeConfigured', () => {
  const keys = ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'] as const;
  const original = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  const restore = (): void => {
    for (const k of keys) {
      if (original[k] === undefined) delete process.env[k];
      else process.env[k] = original[k];
    }
  };

  it('requires BOTH the secret key and the webhook secret', () => {
    try {
      // A secret key without a webhook secret means checkout works and the webhook cannot be
      // verified -- so payments would succeed while entitlements silently never updated.
      process.env['STRIPE_SECRET_KEY'] = 'sk_test_x';
      delete process.env['STRIPE_WEBHOOK_SECRET'];
      expect(stripeConfigured()).toBe(false);

      delete process.env['STRIPE_SECRET_KEY'];
      process.env['STRIPE_WEBHOOK_SECRET'] = 'whsec_x';
      expect(stripeConfigured()).toBe(false);

      process.env['STRIPE_SECRET_KEY'] = 'sk_test_x';
      expect(stripeConfigured()).toBe(true);
    } finally {
      restore();
    }
  });
});
