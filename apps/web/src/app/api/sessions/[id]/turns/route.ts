import { postTurn } from '../../../../../server/routes.js';
import { buildRouteDeps } from '../../../../../server/deps.js';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  return postTurn(request, id, await buildRouteDeps());
}
