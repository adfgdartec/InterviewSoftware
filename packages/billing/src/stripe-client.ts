import Stripe from 'stripe';
import { hasCredential, MissingCredentialError, readCredential } from '@loopcraft/providers';

/**
 * The Stripe boundary. Everything that talks to Stripe goes through here, for the same
 * reason every provider in this repo has one client module: one place reads the credential,
 * one place knows the API shape, and a test can assert both.
 *
 * What this deliberately does NOT do is decide what a customer is entitled to. Stripe says
 * which PLAN an org is on; `plans` says what that plan grants, and `resolveEntitlement`
 * reads the plan row. So a replayed or forged webhook can at worst move an org between
 * plans that already exist -- it cannot invent a plan with different limits, and it cannot
 * grant sessions the plan does not include.
 */

export class StripeKeyMissingError extends Error {
  constructor() {
    super('STRIPE_SECRET_KEY is not set. Billing is unavailable.');
    this.name = 'StripeKeyMissingError';
  }
}

export class StripeWebhookVerificationError extends Error {
  readonly httpStatus = 400;
  constructor(message: string) {
    super(`Stripe webhook could not be verified: ${message}`);
    this.name = 'StripeWebhookVerificationError';
  }
}

function secretKey(): string {
  try {
    return readCredential('STRIPE_SECRET_KEY');
  } catch (error) {
    if (error instanceof MissingCredentialError) throw new StripeKeyMissingError();
    throw error;
  }
}

export function stripeConfigured(): boolean {
  return hasCredential('STRIPE_SECRET_KEY') && hasCredential('STRIPE_WEBHOOK_SECRET');
}

let client: Stripe | null = null;

/**
 * `httpClient` is pinned to Stripe's fetch implementation rather than the default Node one:
 * Workers has no `http` module, and the default client fails at runtime there in a way that
 * only shows up after deploy.
 */
export function stripeClient(): Stripe {
  if (client !== null) return client;
  client = new Stripe(secretKey(), {
    apiVersion: '2026-08-26.dahlia',
    httpClient: Stripe.createFetchHttpClient(),
  });
  return client;
}

/** Test seam: drops the memoised client so a key change is picked up. */
export function resetStripeClient(): void {
  client = null;
}

export interface CheckoutInput {
  readonly priceId: string;
  readonly orgId: string;
  readonly userEmail: string;
  /** Existing Stripe customer, when the org has bought before. */
  readonly customerId: string | null;
  readonly successUrl: string;
  readonly cancelUrl: string;
  /** Version of the renewal terms the buyer affirmatively consented to (spec §5.4). */
  readonly renewalConsentVersion: string;
}

/**
 * Creates a Checkout Session and returns the URL to send the buyer to.
 *
 * `orgId` travels in metadata rather than in the URL: the webhook needs to know which org
 * this subscription belongs to, and a client-supplied org id would let anyone attach a
 * subscription to someone else's account.
 *
 * The renewal-consent version is recorded on the subscription too, so the acknowledgment the
 * ARL requires can be reconstructed later from Stripe alone if our row is ever lost.
 */
export async function createCheckoutSession(input: CheckoutInput): Promise<string> {
  const stripe = stripeClient();
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price: input.priceId, quantity: 1 }],
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    ...(input.customerId === null
      ? { customer_email: input.userEmail }
      : { customer: input.customerId }),
    client_reference_id: input.orgId,
    metadata: { orgId: input.orgId, renewalConsentVersion: input.renewalConsentVersion },
    subscription_data: {
      metadata: { orgId: input.orgId, renewalConsentVersion: input.renewalConsentVersion },
    },
  });
  if (session.url === null) {
    throw new Error('Stripe returned a checkout session with no URL.');
  }
  return session.url;
}

/**
 * Verifies a webhook payload against its signature.
 *
 * `constructEventAsync`, not `constructEvent`: the synchronous version needs Node's crypto
 * and throws on Workers. Verification is not optional -- an unverified webhook endpoint lets
 * anyone who finds the URL grant themselves a subscription.
 */
export async function verifyWebhook(rawBody: string, signature: string | null): Promise<Stripe.Event> {
  if (signature === null || signature === '') {
    throw new StripeWebhookVerificationError('no stripe-signature header');
  }
  const stripe = stripeClient();
  try {
    return await stripe.webhooks.constructEventAsync(
      rawBody,
      signature,
      readCredential('STRIPE_WEBHOOK_SECRET'),
    );
  } catch (error) {
    throw new StripeWebhookVerificationError(
      error instanceof Error ? error.message : 'unknown error',
    );
  }
}

/**
 * Cancels at period end rather than immediately: the buyer paid for the period, and the ARL
 * requires cancellation be easy, not that it forfeit time already bought.
 */
export async function cancelAtPeriodEnd(subscriptionId: string): Promise<Date> {
  const stripe = stripeClient();
  const updated = await stripe.subscriptions.update(subscriptionId, { cancel_at_period_end: true });
  const endsAt = (updated as unknown as { current_period_end?: number }).current_period_end;
  if (typeof endsAt !== 'number') {
    throw new Error('Stripe returned a subscription with no current_period_end.');
  }
  return new Date(endsAt * 1000);
}

/** The webhook events this product acts on. Anything else is acknowledged and ignored. */
export const HANDLED_EVENTS = [
  'checkout.session.completed',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.payment_failed',
] as const;

export type HandledEvent = (typeof HANDLED_EVENTS)[number];

export function isHandledEvent(type: string): type is HandledEvent {
  return (HANDLED_EVENTS as readonly string[]).includes(type);
}

/**
 * Maps a Stripe subscription status onto this product's entitlement status.
 *
 * Deliberately conservative: anything Stripe does not consider currently paid resolves to a
 * status `resolveEntitlement` refuses. `incomplete` and `unpaid` are NOT treated as active
 * even though a subscription object exists for them.
 */
export function entitlementStatusFor(
  stripeStatus: string,
): 'trialing' | 'active' | 'past_due' | 'canceled' | 'expired' {
  switch (stripeStatus) {
    case 'trialing':
      return 'trialing';
    case 'active':
      return 'active';
    case 'past_due':
      return 'past_due';
    case 'canceled':
      return 'canceled';
    default:
      // incomplete, incomplete_expired, unpaid, paused, and anything Stripe adds later.
      return 'expired';
  }
}
