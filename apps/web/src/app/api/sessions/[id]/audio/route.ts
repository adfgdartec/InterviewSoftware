import { deepgramConfigured, transcribe } from '@loopcraft/providers';

/**
 * POST /api/sessions/:id/audio -- accepts one recorded answer as raw audio, transcribes it
 * via Deepgram, and returns the transcript so the client can populate the answer text (which
 * still goes through the same /turns route and the same validation as a typed answer; this
 * endpoint's only job is turning audio into text).
 *
 * Returns 503, not a fabricated transcript, when no key is configured -- consistent with how
 * postDebrief already handles an unconfigured grader.
 */
export async function POST(request: Request): Promise<Response> {
  if (!deepgramConfigured()) {
    return Response.json(
      { error: 'Speech-to-text is not configured.', code: 'stt_unavailable' },
      { status: 503 },
    );
  }
  const contentType = request.headers.get('content-type') ?? 'audio/webm';
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.length === 0) {
    return Response.json({ error: 'No audio received.', code: 'empty_audio' }, { status: 400 });
  }
  if (bytes.length > 25 * 1024 * 1024) {
    return Response.json({ error: 'Recording too long.', code: 'audio_too_large' }, { status: 413 });
  }
  try {
    const result = await transcribe(bytes, contentType);
    return Response.json({ transcript: result.transcript, words: result.words });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Transcription failed.';
    return Response.json({ error: message, code: 'transcription_failed' }, { status: 502 });
  }
}
