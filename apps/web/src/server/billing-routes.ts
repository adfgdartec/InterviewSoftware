import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { asUser } from '@loopcraft/db';
import {
  cancelAtPeriodEnd,
  createCheckoutSession,
  entitlementStatusFor,
  isHandledEvent,
  stripeConfigured,
  StripeWebhookVerificationError,
  verifyWebhook,
} from '@loopcraft/billing';
import { guard, toErrorResponse } from './guards.js';
import type { RouteDeps } from './routes.js';

/**
 * Billing routes. Kept out of routes.ts so the money path is one readable file.
 *
 * The division of authority matters more than the code here: STRIPE decides which plan an
 * org is on and whether it is paid up; the `plans` table decides what that plan grants; and
 * `resolveEntitlement` reads the plan. Nothing Stripe sends can invent a limit.
 */

export const checkoutBody = z.object({
  planId: z.string().min(1),
  /** Spec §5.4: California ARL requires separate affirmative consent to the renewal terms. */
  renewalConsentVersion: z.string().min(1),
});

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

interface PlanRow {
  readonly id: string;
  readonly stripe_price_id: string | null;
  readonly auto_renews: boolean;
}

/**
 * POST /api/billing/checkout — starts a Stripe Checkout session.
 *
 * `planId` names a plan; the PRICE comes from that plan's row. A client that sent its own
 * Stripe price id could otherwise buy a $0 price and be granted a paid plan's limits, which
 * is exactly the shape guardrail 5 exists to prevent -- and why `planId` is in
 * CLIENT_FORBIDDEN_FIELDS for every other route.
 */
export async function postCheckout(request: Request, deps: RouteDeps): Promise<Response> {
  const errorId = randomUUID();
  try {
    const { user, body } = await guard(request, deps, {
      schema: checkoutBody,
      mutating: true,
      rateLimitBucket: 'billing.checkout',
    });

    if (!stripeConfigured()) {
      return json(503, { error: 'Billing is not configured.', code: 'billing_unavailable', errorId });
    }

    const rows = await asUser(deps.sql, user.userId, async (tx) => {
      const plans = await tx<PlanRow[]>`
        select id, stripe_price_id, auto_renews from plans
        where id = ${body.planId} and active = true`;
      const org = await tx<{ stripe_customer_id: string | null }[]>`
        select stripe_customer_id from orgs where id = ${user.orgId}`;
      const email = await tx<{ email: string }[]>`
        select email from users where id = ${user.userId}`;
      return { plan: plans[0], customerId: org[0]?.stripe_customer_id ?? null, email: email[0]?.email };
    });

    if (rows.plan === undefined) {
      return json(404, { error: 'Unknown plan.', code: 'not_found', errorId });
    }
    if (rows.plan.stripe_price_id === null) {
      // A plan with no price id cannot be sold. Saying so beats a Stripe error the buyer
      // cannot act on.
      return json(409, { error: 'This plan is not purchasable yet.', code: 'plan_not_sellable', errorId });
    }
    if (rows.email === undefined) {
      return json(404, { error: 'User not found.', code: 'not_found', errorId });
    }

    const origin = new URL(request.url).origin;
    const url = await createCheckoutSession({
      priceId: rows.plan.stripe_price_id,
      orgId: user.orgId,
      userEmail: rows.email,
      customerId: rows.customerId,
      successUrl: `${origin}/settings?checkout=success`,
      cancelUrl: `${origin}/settings?checkout=cancelled`,
      renewalConsentVersion: body.renewalConsentVersion,
    });
    return json(200, { url });
  } catch (error) {
    const { status, body } = toErrorResponse(error, errorId);
    return json(status, body);
  }
}

/**
 * POST /api/billing/cancel — cancels at period end.
 *
 * Spec §5.4 / the ARL: cancellation must take no more clicks than signup and must not be
 * blocked by a retention offer. There is deliberately no "are you sure?" and no interstitial
 * here -- one authenticated request cancels.
 */
export async function postCancel(request: Request, deps: RouteDeps): Promise<Response> {
  const errorId = randomUUID();
  try {
    const { user } = await guard(request, deps, {
      schema: z.object({}),
      mutating: true,
      rateLimitBucket: 'billing.cancel',
    });

    if (!stripeConfigured()) {
      return json(503, { error: 'Billing is not configured.', code: 'billing_unavailable', errorId });
    }

    const subscriptionId = await asUser(deps.sql, user.userId, async (tx) => {
      const rows = await tx<{ stripe_subscription_id: string | null }[]>`
        select stripe_subscription_id from entitlements
        where org_id = ${user.orgId} and stripe_subscription_id is not null
        order by created_at desc limit 1`;
      return rows[0]?.stripe_subscription_id ?? null;
    });

    if (subscriptionId === null) {
      return json(404, { error: 'No subscription to cancel.', code: 'not_found', errorId });
    }

    const endsAt = await cancelAtPeriodEnd(subscriptionId);
    await deps.owner(async (owner) => {
      await owner`update entitlements set cancel_at = ${endsAt}
                  where stripe_subscription_id = ${subscriptionId}`;
    });
    return json(200, { cancelAt: endsAt.toISOString() });
  } catch (error) {
    const { status, body } = toErrorResponse(error, errorId);
    return json(status, body);
  }
}

interface Subscriptionish {
  readonly id: string;
  readonly status: string;
  readonly customer: string | { id: string };
  readonly metadata?: Record<string, string> | null;
  readonly items?: { data?: { price?: { id?: string } }[] };
  readonly current_period_start?: number;
  readonly current_period_end?: number;
  readonly cancel_at?: number | null;
}

/**
 * POST /api/billing/webhook — the only writer of subscription state.
 *
 * Runs NO auth guard, deliberately: Stripe cannot authenticate as a user. Its signature IS
 * the authentication, verified before the body is trusted for anything. An unverified
 * webhook endpoint is a "grant yourself a subscription" endpoint.
 *
 * Idempotent on Stripe's event id, because Stripe redelivers aggressively and processing one
 * event twice would extend a period or re-open a cancelled subscription.
 */
export async function postStripeWebhook(request: Request, deps: RouteDeps): Promise<Response> {
  const errorId = randomUUID();
  try {
    if (!stripeConfigured()) {
      return json(503, { error: 'Billing is not configured.', code: 'billing_unavailable', errorId });
    }

    const raw = await request.text();
    const event = await verifyWebhook(raw, request.headers.get('stripe-signature'));

    if (!isHandledEvent(event.type)) {
      // Acknowledged, not an error: Stripe retries anything non-2xx, and retrying an event
      // we will never act on forever is worse than ignoring it once.
      return json(200, { received: true, handled: false });
    }

    const applied = await deps.owner(async (owner) => {
      const claimed = await owner<{ event_id: string }[]>`
        insert into loopcraft.stripe_events (event_id, event_type)
        values (${event.id}, ${event.type})
        on conflict (event_id) do nothing
        returning event_id`;
      // Another delivery of the same event already did this work.
      if (claimed.length === 0) return false;

      const object = event.data.object as unknown as Record<string, unknown>;

      if (event.type === 'checkout.session.completed') {
        const orgId = (object['metadata'] as Record<string, string> | null)?.['orgId']
          ?? (object['client_reference_id'] as string | null);
        const customer = object['customer'];
        if (typeof orgId === 'string' && typeof customer === 'string') {
          await owner`update orgs set stripe_customer_id = ${customer} where id = ${orgId}`;
        }
        // The subscription's own event carries the authoritative period and status, so the
        // entitlement row is written there rather than twice with different shapes.
        return true;
      }

      const sub = object as unknown as Subscriptionish;
      const orgId = sub.metadata?.['orgId'];
      if (typeof orgId !== 'string') return true;

      const priceId = sub.items?.data?.[0]?.price?.id ?? null;
      const planRows = priceId === null
        ? []
        : await owner<{ id: string }[]>`select id from plans where stripe_price_id = ${priceId}`;
      const planId = planRows[0]?.id ?? null;

      const status = event.type === 'customer.subscription.deleted'
        ? 'canceled'
        : event.type === 'invoice.payment_failed'
          ? 'past_due'
          : entitlementStatusFor(sub.status);

      const periodStart = sub.current_period_start !== undefined
        ? new Date(sub.current_period_start * 1000)
        : new Date();
      const periodEnd = sub.current_period_end !== undefined
        ? new Date(sub.current_period_end * 1000)
        : new Date(Date.now() + 30 * 86_400_000);
      const consentVersion = sub.metadata?.['renewalConsentVersion'] ?? null;

      // The plan row stays authoritative for LIMITS; Stripe only says which plan and whether
      // it is paid. A price we do not recognise leaves the plan alone rather than guessing.
      await owner`
        insert into entitlements (
          org_id, plan_id, status, current_period_start, current_period_end,
          stripe_subscription_id, renewal_consent_at, renewal_consent_version
        )
        values (
          ${orgId},
          ${planId ?? owner`(select plan_id from entitlements where org_id = ${orgId}
                             order by created_at desc limit 1)`},
          ${status}, ${periodStart}, ${periodEnd}, ${sub.id},
          ${consentVersion === null ? null : new Date()}, ${consentVersion}
        )
        on conflict (stripe_subscription_id) do update set
          status = excluded.status,
          current_period_start = excluded.current_period_start,
          current_period_end = excluded.current_period_end,
          plan_id = coalesce(${planId}, entitlements.plan_id)`;
      return true;
    });

    return json(200, { received: true, handled: applied });
  } catch (error) {
    if (error instanceof StripeWebhookVerificationError) {
      // 400, so Stripe stops retrying a payload that will never verify.
      console.error(`[${errorId}] ${(error as Error).message}`);
      return json(400, { error: 'Invalid signature.', code: 'invalid_signature', errorId });
    }
    const { status, body } = toErrorResponse(error, errorId);
    return json(status, body);
  }
}

