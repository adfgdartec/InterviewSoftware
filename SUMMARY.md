# InterviewSoftware — state of the build

**Read this first in a fresh session.** It is the handoff: what exists, what is verified, what
is deliberately not done, and what to run. Written 2026-09-07 at commit `3826c73`+, and
revised the same day after the session described under "What changed in the last session".

---

## What the product is

Interview rehearsal software sold to **candidates**. You pick a loop modelled on a publicly
reported interview format, answer rounds by typing or speaking, and get a debrief scored
against published anchored rubrics — every number with an uncertainty interval and a link to
how it was produced.

It is deliberately **not** a hiring tool, not sold to employers, and never used during a real
interview. That distinction is what keeps it outside the EU AI Act's high-risk classification,
and several guardrails exist to stop it drifting.

---

## Repository shape

```
apps/
  web/        Next.js 15 App Router — the product, and the API both clients call
  mobile/     Expo / React Native — a thin client over the same API
  worker/     FastAPI (Python) — the ORIGINAL nine delivery metrics. Superseded by
              packages/delivery; kept only as the reference the port was verified against
packages/
  core/       brand, rubrics, tracks, templates, item bank, claims gate, retention schedule
  db/         27-table schema, RLS policies, migrations 0000–0010
  providers/  model registry, OpenAI / Deepgram / Cartesia clients, credential handling
  scoring/    n=3 grader contract, aggregation, debrief assembly, IRT, FSRS
  billing/    ARL flows (consent, acknowledgment, reminders, cancellation) + Stripe client
  delivery/   the nine delivery metrics in TypeScript, ported from apps/worker
  sandbox/    macOS-Seatbelt code execution. Cannot run on Workers — see Known limits
  design/     design-round extraction and grading
tooling/
  eslint-plugin-loopcraft/   the no-affect-inference rule that fails the build
```

---

## Commands

| What | Command |
| --- | --- |
| Everything | `pnpm typecheck && pnpm lint && pnpm test` |
| Deployment readiness | `pnpm run preflight` |
| Local database | `pnpm db:start` then `pnpm db:migrate` |
| Web dev server | `pnpm dev:web` (port 3100) |
| Mobile | `pnpm --filter @loopcraft/mobile start` |
| Deploy | `pnpm --filter @loopcraft/web run cf:deploy:{test,staging,production}` |

**Node 22 is required.** The repo's `.nvmrc` says 22.22.3; running the toolchain on Node 18
fails with `ERR_UNKNOWN_FILE_EXTENSION` on `.ts` files.

Live provider tests need `OPENAI_API_KEY`, `DEEPGRAM_API_KEY` and `CARTESIA_API_KEY` exported;
they **skip** rather than fail without them. The interviewer suites need a running Ollama
(`ollama serve`) and **fail** without it, deliberately.

---

## Test counts as of this commit

324 web · 113 core · 136 scoring · 72 providers · 53 sandbox · 52 delivery · 42 design ·
29 billing · 18 db · 17 lint-plugin · 39 accessibility (axe, 8 routes). **895 passing,
9 skipped, 10/10 task groups green** — `pnpm typecheck && pnpm lint && pnpm test` all exit 0.

The 9 skipped are the live-provider tests, which skip without keys. Note that the interviewer
suites still need `ollama serve` running and FAIL without it, deliberately — a fresh machine
that has not started Ollama sees 4 failures and they are not regressions.

---

## What is built and verified

| Area | State |
| --- | --- |
| **Grading** | Real. OpenAI-backed, n=3 independent samples, anchored rubric prompt. Verified live: a substantive answer outscores a vacuous one, dimensions differ, quotes are verbatim. |
| **Question generation** | Real, targeted at the round's own rubric. Verified live: two calls produce different questions. |
| **Auth** | Supabase, server-side only. Email+password, Google OAuth wired, age/region gate at signup, Bearer tokens for mobile. |
| **Voice** | Deepgram STT + Cartesia TTS, both verified against live APIs. |
| **Video** | Continuous geometric framing analysis, entirely client-side. Self-view is mirrored and live. |
| **Deletion** | `DELETE /api/users/me` purges through 15 cascade references. |
| **Legal pages** | Terms, privacy notice, compliance position, calibration card. All axe-audited. |
| **Deployment** | Cloudflare Workers, 3 branch-mapped environments. Build + workerd run verified. |
| **Mobile** | Bundles to a 2.9 MB iOS bundle. Sign up, sign in, catalogue, loop, voice, debrief, settings, deletion. |

---

## What is explicitly NOT verified

Be precise about these; do not describe them as working.

1. **No real microphone or camera has ever driven this.** Deepgram is proven against a real
   recorded-speech fixture and MediaPipe's model loads and initialises, but the browser
   capture paths have never been exercised by an actual voice or face.
2. **The mobile app has never been run in a simulator.** It bundles and typechecks. No screen
   has been seen rendering.
3. **Colour contrast is unverified.** jsdom cannot sample pixels. The palette is designed to
   WCAG AA by calculation; a real-browser pass is still owed.
4. **Google OAuth's round trip** needs real Cloud credentials and a public redirect URI.
5. **Email delivery** (confirmation, password reset) needs a verified sending domain.
6. **Stripe** is coded and unit-tested but has never talked to Stripe — no keys exist.

---

## Known limits, and why they are limits

- **Grading is three calls per round.** A five-round loop is still 15 grading calls plus 5
  generation calls. They now run concurrently (3 samples per round, up to 3 rounds at a time),
  so the wall time is minutes shorter — but the *bill* is unchanged. Price 15 calls.
- **`packages/sandbox` cannot run on Workers.** It shells out to macOS `sandbox-exec`. The web
  app imports only `@loopcraft/sandbox/hints`, a subpath carrying no `node:child_process`, so
  this blocks the coding round only — not the deploy.
- **Delivery metrics are ported but not yet wired.** `packages/delivery` computes all nine in
  TypeScript, verified identical to the Python worker (see the parity fixture). Nothing calls
  it yet, and wiring it needs something that does not exist: **word timings are never
  persisted.** `turns` stores `transcript` only, and Deepgram's per-word `startMs`/`endMs` are
  discarded after transcription. Showing delivery feedback therefore needs a migration to
  store timings, not just a call to the new package.

---

## Guardrails — do not weaken these

These are load-bearing. Several have already caught real mistakes during development.

1. **`loopcraft/no-affect-inference`** fails the build on emotion-inference vocabulary in
   source *and* in prompts. It caught a question-generator prompt that spelled out the banned
   words in order to forbid them. Rewrite the wording; do not add an exemption.
2. **`no-client-secrets.test.ts`** refuses any `NEXT_PUBLIC_*KEY` and any credential read
   outside `secrets.ts`. This is why Supabase auth runs entirely server-side rather than using
   the standard browser client.
3. **The claims gate** parses banned phrases *out of* `docs/claims-policy.md`, so policy and
   check cannot drift.
4. **RLS is enabled AND forced on every `public` table**, asserted by a database function.
   Infrastructure tables (rate limits, Stripe events) live in the `loopcraft` schema for that
   reason, not to dodge the rule.
5. **The grader contract rejects evidence it cannot find verbatim** in the candidate's answer.
   It caught the grader passing off rubric anchors as quotes, and caught a test fixture doing
   the same.
6. **`rates.json` carries only prices read from a vendor's own page, and a test enforces it.**
   It caught prices written from memory. Seven of the nine are now filled from the vendor
   pages, each cited with its plan tier and read date in `rates-sources.md`. The two that
   remain null are null on purpose — no vendor page states them in the units the cost model
   needs — and the test pins exactly which two, so filling one from memory still fails.
7. **The ARL constraint trigger** refuses an auto-renewing entitlement without recorded
   renewal consent. New accounts land on `demo-free` (`auto_renews = false`) for that reason.

---

## Before you can charge anyone

Ordered by dependency. `pnpm run preflight` reports the first four and exits non-zero.

1. **Incorporate**, then put the real entity name and a monitored inbox in
   `packages/core/src/brand.ts`. Both legal documents render them.
2. **Vendor rates** — seven of nine are filled. Two remain: `ttsPerThousandCharacters`
   (Cartesia publishes credits and minutes, not USD per character — read it off your own
   plan) and `codeExecutionPerCpuSecond` (no compute host chosen yet). Until both are set the
   margin gate fails by design. `pnpm run preflight` names them.
3. **Plan prices** — `plans.price_cents` and `plans.stripe_price_id`. A plan with no price id
   returns `plan_not_sellable`.
4. **Stripe keys** — `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`. Both, or payments
   succeed while entitlements never update.
5. **Cloudflare**: `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` as GitHub secrets, and
   **Workers Paid ($5/mo)** for Hyperdrive — without which every database route fails on
   Workers, including the rate limiter.
6. **A domain.** `theprovingroom.com` was free on 2026-09-04 (also `.ai` and `.io`). Attaching
   one is an uncommented `routes` block in `apps/web/wrangler.jsonc`.
7. **Cloudflare Access** in front of production until you are ready to be public.

**App Store note:** Apple requires in-app purchase for digital goods, so the native app cannot
open the Stripe Checkout URL. Subscriptions are bought on the web or through StoreKit — a
business decision (30% cut vs. web-only signup), not a coding one.

---

## What changed in the last session

Five things, each verified by a command that was actually run. Read this before trusting an
older description of the registry or the debrief.

1. **The interviewer did not run in production, and nothing said so.** `interviewer.ts` probed
   Ollama directly and returned `accept` when it was unreachable. A Worker can never reach
   `localhost:11434`, so every interviewer turn accepted: spec §2.2's back-and-forth silently
   did not happen in a deployed environment, and no error was ever raised. It now resolves a
   provider through the registry and only accepts when *no* tier is usable.
2. **The registry is OpenAI-first, and ordering is now the only knob.** Three call sites used
   to probe Ollama and then index `fallbacks[0]` for the remote model, which hardcoded one
   particular ordering — flipping the list would have sent an Ollama model tag to OpenAI's
   API. They now go through `selectEntry()`, which walks the declared order and takes the
   first usable provider. A developer with no `OPENAI_API_KEY` still runs entirely on local
   Ollama at no cost; that is what the interviewer suites do in CI.
3. **Grading runs concurrently.** The n=3 samples were a `for` loop with an `await` inside;
   rounds were sequential too. Samples now issue together and up to three rounds grade at once
   (a ceiling of nine in-flight calls, chosen to stay under provider rate limits). The bill is
   unchanged — only the candidate's wait.
4. **The presence summary reaches the debrief.** `round_presence` rows are combined into one
   session report (ratios re-weighted by the counts they came from, not averaged) and rendered
   as a "Camera framing" section, deliberately outside the scored dimensions and carrying no
   score. No framing data reports as `null`, not as a zeroed report.
5. **The delivery metrics are TypeScript.** `packages/delivery` replaces the never-deployed
   FastAPI worker. It was verified by running both implementations over 17 inputs × 9 metrics
   and diffing: identical to the last decimal. Those outputs are committed as
   `test/python-parity.json`, so the equivalence keeps holding once the Python is gone.

Two supporting fixes fell out of the above:

- **`deps.ts` no longer substitutes the heuristic grader.** It scored on string length and
  whether the answer contained a digit; wired in behind a real grader it would answer an
  unconfigured environment with invented numbers that look like grades. An environment that
  cannot grade now returns 503 `grader_unavailable`.
- **`preflight` checks instead of asserting.** Its "still required to sell" list was hardcoded
  and printed unconditionally — it was still reporting "No document exists" for the terms and
  privacy notice two commits after both shipped. Each item now reads the repository and
  reports what is true.

---

## Working agreements that produced this

- Every claim in a commit message or a summary is backed by a command that was actually run.
  If something is unverified, it says so.
- Guardrails that fire are treated as correct until proven otherwise. Several findings in this
  build came from a test refusing work that looked right.
- Migrations are append-only once deployed. 0010 was edited in place only because it had not
  left the local machine.
- Live provider tests are gated with `describe.skipIf` so contributors without keys are never
  blocked, and they make **one** real call each.
