import { postStripeWebhook } from '../../../../server/billing-routes.js';
import { buildRouteDeps } from '../../../../server/deps.js';

/**
 * Stripe's signature is this endpoint's authentication, so it runs no auth guard. The raw
 * body must reach the verifier byte-for-byte -- any framework that re-serialises JSON here
 * would break the signature, which is why the handler reads request.text() itself.
 */
export async function POST(request: Request): Promise<Response> {
  return postStripeWebhook(request, await buildRouteDeps(request));
}
