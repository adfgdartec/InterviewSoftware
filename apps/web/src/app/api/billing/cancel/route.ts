import { postCancel } from '../../../../server/billing-routes.js';
import { buildRouteDeps } from '../../../../server/deps.js';

export async function POST(request: Request): Promise<Response> {
  return postCancel(request, await buildRouteDeps());
}
