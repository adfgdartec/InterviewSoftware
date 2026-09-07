# InterviewSoftware — state of the build

**Read this first in a fresh session.** It is the handoff: what exists, what is verified, what
is deliberately not done, and what to run. Written 2026-09-07 at commit `3826c73`+.

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
  worker/     FastAPI (Python) — nine delivery metrics. NOT deployed; nothing calls it yet
packages/
  core/       brand, rubrics, tracks, templates, item bank, claims gate, retention schedule
  db/         27-table schema, RLS policies, migrations 0000–0010
  providers/  model registry, OpenAI / Deepgram / Cartesia clients, credential handling
  scoring/    n=3 grader contract, aggregation, debrief assembly, IRT, FSRS
  billing/    ARL flows (consent, acknowledgment, reminders, cancellation) + Stripe client
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

309 web tests · 66 providers · 132 scoring · 53 sandbox · 42 design · 29 billing · 18 db ·
17 lint-plugin · 39 accessibility (axe, 8 routes). **9/9 task groups green.**

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

- **Ollama is unreachable from Workers.** `registry.ts` makes a local Ollama model the
  *primary* for every reasoning purpose with OpenAI as fallback. A Worker cannot reach
  `localhost:11434`, so **production runs entirely on the OpenAI fallback tier**. Price that
  tier, not the local one.
- **Grading is three calls per round.** A five-round loop is 15 grading calls plus 5
  generation calls, and takes 2–4 minutes. Parallelising it is an obvious win, not yet done.
- **`packages/sandbox` cannot run on Workers.** It shells out to macOS `sandbox-exec`. The web
  app imports only `@loopcraft/sandbox/hints`, a subpath carrying no `node:child_process`, so
  this blocks the coding round only — not the deploy.
- **`apps/worker` is orphaned.** Nine delivery metrics, fully tested, that nothing calls.
  Either port them to TypeScript or run them in a Container when wiring delivery feedback.
- **The presence summary is persisted but not yet shown in the debrief UI.** The route, the
  table and the tests exist; the debrief does not render it.

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
6. **`rates.json` ships all-null and a test enforces it.** It caught prices written from
   memory. Fill them from the vendor pages named in `packages/core/src/rates-sources.md`.
7. **The ARL constraint trigger** refuses an auto-renewing entitlement without recorded
   renewal consent. New accounts land on `demo-free` (`auto_renews = false`) for that reason.

---

## Before you can charge anyone

Ordered by dependency. `pnpm run preflight` reports the first four and exits non-zero.

1. **Incorporate**, then put the real entity name and a monitored inbox in
   `packages/core/src/brand.ts`. Both legal documents render them.
2. **Vendor rates** into `packages/core/src/rates.json` — see `rates-sources.md`. Until then
   the margin gate fails by design.
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

## Working agreements that produced this

- Every claim in a commit message or a summary is backed by a command that was actually run.
  If something is unverified, it says so.
- Guardrails that fire are treated as correct until proven otherwise. Several findings in this
  build came from a test refusing work that looked right.
- Migrations are append-only once deployed. 0010 was edited in place only because it had not
  left the local machine.
- Live provider tests are gated with `describe.skipIf` so contributors without keys are never
  blocked, and they make **one** real call each.
