# Live Voice Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the last unbuilt half of the voice conversation. The candidate's side (STT: `VoiceAnswerButton` → `/api/sessions/:id/audio` → Deepgram) is real code that has never been run against a live key; the interviewer's side (TTS) does not exist at all. This plan ships a real Cartesia TTS client, speaks every interviewer turn aloud, and fixes the unauthenticated, unrate-limited STT upload route that a real billable Deepgram key turns into an abuse vector.

**Architecture:** A new `cartesia-client.ts` in `packages/providers` follows `deepgram-client.ts`'s exact shape (key-missing error, `configured()` probe, request-error class, timeout via `AbortController`) plus a process-lifetime in-memory cache keyed on exact transcript text. A new `GET /api/sessions/:id/speech` handler in `routes.ts` runs the standard `guard()` chain, reads the session's *own* current question from Postgres (never client-supplied text), and streams back `audio/mpeg` bytes. `POST /api/sessions/:id/audio`'s logic moves out of the App Router file into a real `postSessionAudio` handler behind the same `guard()` chain. A new `QuestionAudio.tsx` client component fetches and plays the audio whenever the question text changes, degrading to a visible play button when the browser blocks autoplay.

**Tech Stack:** Next.js 15 App Router, Cartesia `sonic-2` REST (`/tts/bytes`), Deepgram `nova-3` REST, zod, vitest.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-31-live-voice-pipeline-design.md`.
- Guardrail 5/6: the Cartesia key never reaches the browser; the client receives audio bytes only, and never chooses what text gets synthesized.
- Request/response only. No WebSocket streaming STT or TTS — see the spec's non-goals.
- No persistent TTS cache. In-memory, process-lifetime only.
- One fixed voice, named only in `registry.ts` (the "nothing outside registry.ts names a model string" convention).
- Live provider tests are gated with `describe.skipIf(...Configured())`, matching `openai-client.live.test.ts` — a contributor without keys must never see a failure.
- Existing suites (`pnpm test`, `pnpm typecheck`, `pnpm lint`) stay green throughout.

---

### Task 1: Cartesia client replaces the unusable ElevenLabs client

**Files:**
- Create: `packages/providers/src/cartesia-client.ts`
- Delete: `packages/providers/src/elevenlabs-client.ts`, `packages/providers/test/elevenlabs-client.test.ts`
- Modify: `packages/providers/src/index.ts`, `packages/providers/src/registry.ts`

**Interfaces:**
- Produces: `synthesize(text, timeoutMs?) => Promise<Uint8Array>`, `cartesiaConfigured()`, `CartesiaKeyMissingError`, `CartesiaRequestError`, `clearSynthesisCache()`. Consumed by Task 3 (`getSessionSpeech`) and Task 2 (tests).

- [x] **Step 1: Write `cartesia-client.ts`** — `POST https://api.cartesia.ai/tts/bytes`, headers `X-API-Key` / `Cartesia-Version: 2024-06-10` / `Content-Type: application/json`, body `{ model_id: 'sonic-2', transcript, voice: { mode: 'id', id: '<Clive>' }, output_format: { container: 'mp3', sample_rate: 44100, bit_rate: 128000 } }`. Exact-match `Map<string, Uint8Array>` cache checked before the fetch, populated after.
- [x] **Step 2: Point `registry.ts`'s `tts` entry at `cartesia`/`sonic-2`.**
- [x] **Step 3: Delete the ElevenLabs client and its test; swap the export in `index.ts`.**
- [x] **Step 4: Verify** — `pnpm typecheck` and `pnpm exec eslint .` clean.

---

### Task 2: Provider tests, contract and live

**Files:**
- Create: `packages/providers/test/cartesia-client.test.ts`, `packages/providers/test/cartesia-client.live.test.ts`, `packages/providers/test/deepgram-client.live.test.ts`
- Modify: `turbo.json`

**Interfaces:**
- Consumes: Task 1's exports. Produces: the first live coverage Deepgram and Cartesia have ever had.

- [x] **Step 1: Contract tests** — key-missing refusal (no fetch attempted), configured/unconfigured, request-shape assertions (URL, headers, model id, voice id, output format), cache-hit-skips-fetch, non-2xx → `CartesiaRequestError`, empty text rejected.
- [x] **Step 2: Cartesia live test** — `describe.skipIf(!cartesiaConfigured())`, one real call, asserts real MP3 bytes (ID3 header or an `0xFF 0xEx` frame sync).
- [x] **Step 3: Deepgram live test** — `describe.skipIf(!deepgramConfigured())`, self-contained base64 WAV fixture of real speech, asserts a real transcript and real word timings come back.
- [x] **Step 4: Add `CARTESIA_API_KEY`/`DEEPGRAM_API_KEY` to `turbo.json`'s test `env` list** so turbo doesn't cache a skipped run as if it were a real one.
- [x] **Step 5: Verify** — run the provider suite with the real keys exported and confirm the live tests actually ran.

---

### Task 3: `GET /api/sessions/:id/speech`

**Files:**
- Create: `apps/web/src/app/api/sessions/[id]/speech/route.ts`
- Modify: `apps/web/src/server/routes.ts`

**Interfaces:**
- Produces: `getSessionSpeech(request, sessionId, deps)`. Consumed by Task 5 (`QuestionAudio`) and Task 6 (integration tests).

- [x] **Step 1: `getSessionSpeech` in `routes.ts`** — `guard()` (`mutating: false`, bucket `sessions.speech`, empty schema) → `loadSession` under `asUser` → `state.pendingTurn?.question` → 404 when absent → 503 `tts_unavailable` when `!cartesiaConfigured()` → otherwise `synthesize()` and return the bytes as `audio/mpeg`.
- [x] **Step 2: Thin App Router wrapper**, same shape as `sessions/[id]/route.ts`.
- [x] **Step 3: Verify** — `pnpm typecheck`.

---

### Task 4: `POST /api/sessions/:id/audio` gets the guard chain it never had

**Files:**
- Modify: `apps/web/src/server/routes.ts`, `apps/web/src/app/api/sessions/[id]/audio/route.ts`, `apps/web/src/components/VoiceAnswerButton.tsx`

**Interfaces:**
- Produces: `postSessionAudio(request, sessionId, deps)`. The route file becomes a thin wrapper like every other.

- [x] **Step 1: Move the logic into `postSessionAudio`** behind `guard()` (`mutating: true` — it costs money per call — bucket `sessions.audio`). The raw audio body means the guard cannot also parse JSON, so the handler reads `request.clone().arrayBuffer()` after the guard has run.
- [x] **Step 2: Rewrite the App Router file as a wrapper.**
- [x] **Step 3: `VoiceAnswerButton` sends an `Idempotency-Key`** — without it the mutating guard now 400s every real recording.
- [x] **Step 4: Verify** — `pnpm typecheck`, `pnpm exec eslint .`.

---

### Task 5: `QuestionAudio.tsx` — the interviewer actually speaks

**Files:**
- Create: `apps/web/src/components/QuestionAudio.tsx`
- Modify: `apps/web/src/app/session/[id]/page.tsx`

**Interfaces:**
- Consumes: Task 3's route. Rendered inside the question card, keyed on `questionText` so hints and clarify follow-ups are spoken too, with no extra wiring.

- [x] **Step 1: Write the component** — fetch on `questionText` change, `URL.createObjectURL`, `.play()`, catch `NotAllowedError` into a visible "Play question" button, `revokeObjectURL` on cleanup, render nothing on a failed fetch (the text is on screen either way).
- [x] **Step 2: Render it in the question card.**
- [x] **Step 3: Verify** — `pnpm typecheck`, `pnpm exec eslint .`, a11y suite green.

---

### Task 6: Integration tests and full verification

**Files:**
- Modify: `apps/web/test/routes.integration.test.ts`

- [x] **Step 1: `getSessionSpeech` tests** — 401 unauthenticated, 404 with no pending question, 503 when Cartesia is unconfigured, and a gated live case asserting real `audio/mpeg` bytes when the key is present.
- [x] **Step 2: `postSessionAudio` tests** — 401 without auth and 400 without an `Idempotency-Key`, which is the gap this task exists to close, plus 503/400/413 for unconfigured / empty / oversized audio.
- [x] **Step 3: Full verification** — `pnpm typecheck`, `pnpm lint`, `pnpm test` (with the real keys exported so the live paths genuinely run), and a Playwright walkthrough of the session page proving real audio bytes are fetched and the audio element is playable.
