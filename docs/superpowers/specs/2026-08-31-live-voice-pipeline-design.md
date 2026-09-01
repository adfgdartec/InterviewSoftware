# Live voice pipeline: real STT + TTS, verified against real providers

## Context

Three real, live, verified API keys now exist (`DEEPGRAM_API_KEY`, `CARTESIA_API_KEY`,
`OPENAI_API_KEY`, in `apps/web/.env.local`, gitignored). Before writing any code for this
spec, each was hit directly against its real API:

- **OpenAI**: `GET /v1/models` → `200`.
- **Deepgram**: real audio (`say` → WAV) sent to `POST /v1/listen?model=nova-3` → `200`,
  transcript `"Testing one two three."` came back correctly, in exactly the response shape
  `packages/providers/src/deepgram-client.ts` already expects
  (`results.channels[0].alternatives[0].transcript`, `.words[].word/start/end`). That file's
  existing parsing code needs no changes — it was already correct, just never run for real.
- **Cartesia**: `GET /voices` → `200`, 934 voices, 417 English. `POST /tts/bytes` with
  `model_id: "sonic-2"`, voice `b24f41fd-00a3-4cd8-992a-a0c9f13f3ef1` ("Clive - Measured
  Expert") → `200`, `content-type: audio/mpeg`, a genuinely valid 27KB MP3 (`file` confirmed
  real MPEG audio). Both the model id and voice id below are verified-real, not guessed.

The candidate's side of the voice conversation (STT: `VoiceAnswerButton.tsx` → `/api/sessions/:id/audio`
→ Deepgram) already exists as real code and, per the above, is now confirmed correct — it
was simply never exercised against a live key until today. The interviewer's side (TTS: the
question/hint text being spoken aloud) does not exist anywhere yet. This spec closes that gap
and puts the STT side under a live, verified test for the first time.

## Goals

- A real, working Cartesia TTS client (`packages/providers/src/cartesia-client.ts`),
  replacing the unusable `elevenlabs-client.ts` (no key, no path to one) entirely.
- The interviewer's questions, hints, and clarify follow-ups spoken aloud automatically when
  they appear — the full back-and-forth, not just the opening question.
- Server-side synthesis only (guardrail 5): the Cartesia key never reaches the browser; the
  client only ever receives audio bytes.
- The server decides what text gets synthesized (the session's own current question), never
  the client — closes off a free-TTS-as-a-service abuse vector.
- A real fix for a real gap found while reviewing this code: `POST /api/sessions/:id/audio`
  (the existing STT upload route) has no auth and no rate limiting. It was harmless while
  `deepgramConfigured()` always returned `false`; it is a real abuse vector now that a real,
  billable key is wired in.
- Live test coverage for all three provider clients that previously had none, gated
  (`describe.skipIf`) so contributors without keys aren't blocked — the same pattern
  `openai-client.live.test.ts` already established.
- A real Playwright walkthrough proving actual audio bytes flow both directions against the
  live providers, not just unit tests.

## Explicit non-goals (scope boundary)

- **True real-time/streaming STT or TTS.** This is request/response: record the full answer,
  send once, get a transcript back (STT — already built); synthesize the full question text,
  get one audio file, play it (TTS — new). Cartesia and Deepgram both offer WebSocket
  streaming APIs for lower latency, but that is a materially larger build (client-side audio
  buffering, a persistent connection to manage, many more edge cases) and is out of scope
  here. A natural follow-on if the "instant" conversational feel matters later.
- **Persistent/cross-restart TTS caching.** In-memory only, process-lifetime. No Redis, no
  database table for cached audio.
- **A UI to change the interviewer's voice.** One fixed voice (Clive), set in `registry.ts`
  per the existing "nothing outside registry.ts names a model string" convention.

## Cartesia client

`packages/providers/src/cartesia-client.ts`, following the exact shape of
`deepgram-client.ts`/`openai-client.ts`:

- `CartesiaKeyMissingError` — thrown before any fetch when `CARTESIA_API_KEY` is unset, via
  the same `readCredential`/`MissingCredentialError` → wrap pattern the other clients use.
- `cartesiaConfigured()` — via `hasCredential`, for the `describe.skipIf` gate.
- `synthesize(text: string, timeoutMs = 30_000): Promise<Uint8Array>` — `POST
  https://api.cartesia.ai/tts/bytes` with headers `X-API-Key`, `Cartesia-Version:
  2024-06-10`, `Content-Type: application/json`, and body:

  ```json
  {
    "model_id": "sonic-2",
    "transcript": "<text>",
    "voice": { "mode": "id", "id": "b24f41fd-00a3-4cd8-992a-a0c9f13f3ef1" },
    "output_format": { "container": "mp3", "sample_rate": 44100, "bit_rate": 128000 }
  }
  ```

  Returns the raw response body as `Uint8Array` (confirmed live: `content-type: audio/mpeg`,
  real MP3 bytes). A `CartesiaRequestError` on a non-2xx response, matching
  `DeepgramRequestError`'s shape.
- An in-memory `Map<string, Uint8Array>` cache, keyed on the exact transcript text, checked
  before calling Cartesia and populated after. Exact-match, not semantic — audio synthesis
  for the *same* question text should hit cache; there's no "close enough" concept the way
  there is for LLM completions, so the second brain's embedding-based `SemanticCache` isn't
  the right tool here. Process-lifetime only (a server restart clears it, which is fine —
  the cost being guarded against is redundant synthesis within one process's uptime, e.g. a
  candidate reloading the page on the same question).

`registry.ts`'s `tts` entry changes from `elevenlabs`/`eleven_turbo_v2_5` to
`cartesia`/`sonic-2`. `elevenlabs-client.ts` and its test file are deleted; `index.ts` drops
the `elevenlabs-client.js` export and gains `cartesia-client.js`.

## `GET /api/sessions/:id/speech`

New route, new handler `getSessionSpeech` in `routes.ts`, wired at
`apps/web/src/app/api/sessions/[id]/speech/route.ts`. Behavior:

1. `guard()` chain (auth + rate limit `sessions.speech`, `mutating: false`, empty schema) —
   same chain every other route uses.
2. Loads the session via `loadSession` (same as `getSession`), reads
   `state.pendingTurn?.question` — the server's own idea of the current question, never
   anything the client supplies.
3. If there's no pending question (loop complete, or somehow no question yet), `404`.
4. If `cartesiaConfigured()` is false, `503` with `{ code: 'tts_unavailable' }` — same
   honesty pattern `postDebrief` and the audio route already use for an unconfigured
   provider, never a silent no-op or a fabricated response.
5. Otherwise `synthesize()`s the question text (hitting the in-memory cache on a repeat) and
   returns the raw bytes with `Content-Type: audio/mpeg`.

## `POST /api/sessions/:id/audio` — the auth fix

Currently exported directly as the Next.js route handler with no `guard()` call at all — no
authentication, no rate limiting. Fixed by moving its logic into a real `postSessionAudio`
handler in `routes.ts` that runs the standard `guard()` chain first (auth + rate limit
`sessions.audio`, `mutating: true` since it costs money per call, requiring the same
`Idempotency-Key` header every other mutating route requires) before calling `transcribe()`.
The App Router file becomes a thin wrapper matching every other route's shape, instead of
containing the logic itself.

## Client: `QuestionAudio.tsx`

New component, rendered on the session page next to the question card. Takes
`sessionId: string` and `questionText: string` as props (re-fires its effect whenever
`questionText` changes — this already covers hints and clarify follow-ups for free, since
`postTurn` already records those as the new `question` text server-side; no extra wiring
needed for the "full back-and-forth" goal).

- On `questionText` change: `fetch('/api/sessions/:id/speech')`, read as a `Blob`, build an
  `URL.createObjectURL`, set it as an `<audio>` element's `src`, call `.play()`.
- If `.play()` rejects with `NotAllowedError` (the browser blocked autoplay — expected on a
  page's first load before any user gesture has happened), catch it and show a visible
  "🔊 Play question" button instead of failing silently. Clicking that button is itself a
  user gesture, so the same `.play()` call succeeds from there.
- If the fetch itself fails (503 unconfigured, network error), show nothing extra — the
  question text is already on screen either way; audio is an enhancement, never a blocker.
- `URL.revokeObjectURL` on cleanup (unmount or next question change) so object URLs don't
  leak across a long session.

## Testing

- `packages/providers/test/cartesia-client.test.ts` — contract tests with a mocked `fetch`,
  same shape as `deepgram-client.test.ts`: key-missing refusal, configured/unconfigured,
  request-shape assertions (model id, voice id, headers), cache-hit-skips-fetch.
- `packages/providers/test/cartesia-client.live.test.ts` — `describe.skipIf(!cartesiaConfigured())`,
  one real call, asserts the response is non-empty bytes starting with a valid MP3 frame
  sync marker (`0xFF` high bits) or ID3 header, matching the openai live test's "one real
  call, one real assertion" shape.
- `packages/providers/test/deepgram-client.live.test.ts` — new, same
  `describe.skipIf(!deepgramConfigured())` pattern, using a small embedded base64 WAV fixture
  (the same kind of sample generated via `say` during this spec's research) so the test is
  self-contained and doesn't depend on microphone access or an external file.
- `apps/web/test/routes.integration.test.ts` — extended: `getSessionSpeech` returns `404`
  with no pending question, `503` when Cartesia isn't configured (test-time env unset),
  `200` with real synthesized bytes when it is (using the now-real `CARTESIA_API_KEY` — this
  one test suite genuinely calls the live provider, gated the same way the live test files
  are, not run by default in CI without the key present); `postSessionAudio` now requires
  auth (401 without it) and an `Idempotency-Key` (400 without it), closing the gap this spec
  exists partly to fix.
- Playwright walkthrough of everything that doesn't require real microphone input: start a
  loop, confirm real audio bytes are actually fetched and playable for the question (or the
  autoplay-blocked fallback button appears and works), confirm `/api/sessions/:id/audio`
  now correctly rejects an unauthenticated/no-idempotency-key request instead of silently
  accepting it. What this cannot honestly verify: a real person speaking into a real
  microphone through `VoiceAnswerButton` — this sandbox has no real audio input device, and
  the available Playwright MCP tools expose no fake-microphone control surface (same limit
  already disclosed for the camera framing check). The `deepgram-client.live.test.ts` fixture
  call above is what actually proves Deepgram transcribes real speech correctly; the
  Playwright pass proves the UI wiring around it, not live microphone capture itself.
