import { postSession } from '../../../server/routes.js';
import { buildRouteDeps } from '../../../server/deps.js';

export async function POST(request: Request): Promise<Response> {
  return postSession(request, await buildRouteDeps());
}
