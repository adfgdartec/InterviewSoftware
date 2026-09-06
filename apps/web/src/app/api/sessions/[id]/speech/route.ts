import { getSessionSpeech } from '../../../../../server/routes.js';
import { buildRouteDeps } from '../../../../../server/deps.js';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  return getSessionSpeech(request, id, await buildRouteDeps(request));
}
