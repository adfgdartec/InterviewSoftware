import { getUserProfile, patchUserProfile } from '../../../../server/routes.js';
import { buildRouteDeps } from '../../../../server/deps.js';

export async function GET(request: Request): Promise<Response> {
  return getUserProfile(request, await buildRouteDeps());
}

export async function PATCH(request: Request): Promise<Response> {
  return patchUserProfile(request, await buildRouteDeps());
}
