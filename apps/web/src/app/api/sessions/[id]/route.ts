import { getSession } from '../../../../server/routes.js';
import { buildRouteDeps } from '../../../../server/deps.js';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  return getSession(request, id, await buildRouteDeps(request));
}
