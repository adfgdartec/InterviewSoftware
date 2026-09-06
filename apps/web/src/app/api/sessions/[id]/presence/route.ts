import { postPresence } from '../../../../../server/routes.js';
import { buildRouteDeps } from '../../../../../server/deps.js';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  return postPresence(request, id, await buildRouteDeps(request));
}
