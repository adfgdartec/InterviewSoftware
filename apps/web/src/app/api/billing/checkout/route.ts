import { postCheckout } from '../../../../server/billing-routes.js';
import { buildRouteDeps } from '../../../../server/deps.js';

export async function POST(request: Request): Promise<Response> {
  return postCheckout(request, await buildRouteDeps());
}
