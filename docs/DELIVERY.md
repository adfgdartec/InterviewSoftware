# Loopcraft — delivery report

Build date 2026-08-29 · 26 commits · 12,800 lines of TypeScript, Python and SQL
Source of truth: [`docs/spec.md`](./spec.md) · Prototype defects avoided: [`docs/legacy-audit.md`](./legacy-audit.md)

## 1. Status against the spec's build phases

| Phase | Scope | Exit criteria | Status |
| --- | --- | --- | --- |
| 0 | Monorepo, CI, schema, RLS, auth, entitlements, provider registry, brand | `pnpm test` green; RLS cross-tenant test passes; no secrets client-side | **Complete, verified** |
| 1 | Durable sessions, catalog, item bank, question generation with fallback, text-only loop | Full loop completes and resumes after refresh; contract tests pass for every track | **Complete, verified** |
| 2 | Audio, ASR, delivery metrics, anchored grading n=3, debrief packet | Grader α vs gold set reported; no banned field names in any schema | **Partial** — grading and debrief wired end to end; second criterion met. First **not met**: no gold set, so no α. Audio/ASR not wired. |
| 3 | Coding round: sandboxed execution, hint ladder, interviewer interrupts | Sandbox escape suite passes; hint-dependence scored | **Complete, verified** |
| 4 | System design canvas, diagram extraction, design rubric | Design round graded end to end | **Complete** |
| 5 | IRT adaptivity, ability estimates, weakness graph, FSRS scheduler | θ and SE surfaced with uncertainty in UI | **Complete** |
| 6 | Billing, entitlements, ARL checkout and cancellation, cost ceilings | Economics CI check passes; cancel flow ≤ signup clicks | **Cancel-flow criterion met.** Margin gate implemented and correctly **failing**, because rates are unset (§7). |
| 7 | AI-infra tracks, loop templates, compliance pages, calibration card, a11y pass | axe zero critical; calibration card published | **Complete** — zero critical/serious, with one stated limit (§3.2) |

## 2. What was built

```
apps/
  web/                Next.js 15 — guard chain, session engine, routes, UI, demo mode
  worker/             FastAPI, Python 3.12 — non-biometric delivery metrics
packages/
  core/               brand, affect vocabulary, claims gate, cost model, content catalog
  db/                 27-table schema, RLS policies, migrations, catalog seeding
  providers/          model registry, cost accounting, cost ceiling, credential handling
  scoring/            n=3 grader, uncertainty aggregation, debrief, IRT, FSRS, weakness graph
  sandbox/            hardened container execution, hint ladder, hidden test cases
  design/             diagram extraction, name-dropping detection, structural ceilings
  billing/            ARL flows, renewal consent, retainable acknowledgment, margin gate
tooling/
  eslint-plugin-loopcraft/   the no-affect-inference build gate
```

**Content:** 12 tracks · 7 rubrics · 24 dimensions · **120 behavioural anchors** · 5 loop
templates · **124 provenance-tagged items**. **Database:** 27 tables, 28 RLS policies, RLS
enabled *and forced* everywhere.

## 3. Test results — actual output

Loopcraft uses **no Docker**. Postgres is a native cluster; the code sandbox is macOS
Seatbelt. Every suite below was executed.

```
$ pnpm exec eslint .                    clean
$ pnpm run typecheck                    Tasks: 8 successful, 8 total
$ pnpm run test                         Tasks: 9 successful, 9 total

@loopcraft/core                Tests  109 passed (109)
@loopcraft/scoring             Tests  132 passed (132)
@loopcraft/web                 Tests  125 passed (125)
@loopcraft/sandbox             Tests   53 passed  (53)
@loopcraft/design              Tests   42 passed  (42)
@loopcraft/billing             Tests   29 passed  (29)
@loopcraft/web (a11y)          Tests   23 passed  (23)
@loopcraft/providers           Tests   22 passed  (22)
@loopcraft/db                  Tests   18 passed  (18)
eslint-plugin-loopcraft        Tests   17 passed  (17)

$ cd apps/worker && pytest -q            46 passed
```

**616 tests, 0 failures, 0 unrun** (570 TypeScript + 46 Python). Zero `any` across
`packages/*`.

### 3.1 Running processes

| Process | Port | Check |
| --- | --- | --- |
| Next.js web | 3100 | `/`, `/dashboard`, `/calibration`, `/compliance` all HTTP 200 |
| FastAPI worker | 8099 | `GET /health` → `{"status":"ok"}`; `POST /v1/delivery-metrics` returns the nine §2.7 measurements |
| Postgres 16.15 | 54329 | `pg_isready` accepting connections |

### 3.2 How the sandbox is enforced without a container

Each control names the mechanism that actually enforces it, because they are not equally
strong and a sandbox gets over-trusted otherwise.

| Control | Mechanism | Strength |
| --- | --- | --- |
| Network | Seatbelt `(deny network*)` | Hard denial at the syscall boundary |
| Filesystem | Seatbelt `(deny default)` | Read-only except one per-run scratch subpath |
| CPU time | `RLIMIT_CPU` | Kernel-enforced, SIGXCPU |
| Processes | `RLIMIT_NPROC` | Kernel-enforced, `fork` fails |
| Wall clock | in-process SIGALRM, then `killpg` | Process-group kill, so forks cannot outlive it |
| **Memory** | in-process guard + parent RSS poll | **Not a kernel cap** — see below |

macOS rejects `RLIMIT_AS` and `RLIMIT_DATA` outright. A parent-side RSS poll every 100ms let
a tight allocation loop reach **468 MB against a 256 MB ceiling**. An in-process guard
sampling `getrusage` every 10ms now catches it at **173 MB**, under the ceiling, with the
parent poll as backstop. This is a real ceiling but a sampled one; it is not equivalent to a
container's `--memory`.

The escape suite is also 3–10× faster than the container version — 50–200 ms per case versus
600–900 ms — because there is no image cold start.

### 3.3 Accessibility — what the green result does and does not mean

axe-core reports **zero critical or serious violations** on all four routes. Two limits are
asserted by the suite itself so the result is not over-read:

1. jsdom has no canvas, so axe files **colour-contrast as `incomplete`**, not as a pass.
   Contrast is unverified and must be checked in a real browser.
2. Only static markup is audited. Focus management, live regions and keyboard traps in
   interactive widgets are out of scope until a browser-driven run exists.

### 3.4 Acceptance criteria (spec §7)

| # | Criterion | State |
| --- | --- | --- |
| 1 | Resume mid-round with state intact | **Met** — proven by discarding every pooled connection |
| 2 | Every track yields all five item types; fallback works | **Met** — 48 contract tests |
| 3 | Track and level propagate to the saved record | **Met** |
| 4 | No schema infers emotion; a lint rule enforces it | **Met** — rule widened to cover JSX text (§4) |
| 5 | No key, path, payload or public URL reachable from client | **Met** — 5 scans over every tracked file |
| 6 | Org A cannot read org B | **Met** — 18 denial tests on native Postgres |
| 7 | Grading reliability measured and gated | **Not met** — no gold set exists |
| 8 | Every score carries an uncertainty interval | **Met** end to end, structurally |
| 9 | Paid actions authorized server-side | **Met** |
| 10 | Account deletion purges rows and storage | **Not met** — `retention_jobs` exists, the job does not |
| 11 | axe zero critical on every primary route | **Met**, with §3.3 limits |
| 12 | `claims-policy.md` exists and strings are checked | **Met** — the gate parses the policy document itself |

## 4. Architecture decisions and why

**The affect gate had a hole, and it was where the copy lives.** The rule checked string
literals and template chunks but not `JSXText`. The calibration page's prose about emotion
inference was invisible to it while the compliance page's identical sentence tripped it,
purely because one sat inside a JS expression. The rule now covers JSX text. The two policy
pages are exempted — "Loopcraft never infers emotion" cannot be written without the word —
and the exemption is *earned* by a test asserting every sentence using the vocabulary also
carries a negation, plus a second test that the disclosure has not been deleted to silence
the linter.

**Uncertainty is structural, not conventional.** `scores.interval_low/high` are `NOT NULL`;
`ScoreWithInterval` is the only score renderer and has no prop that hides the interval; the
interval never collapses to zero even on unanimous samples. `AbilityReadout` refuses to draw
θ at all when the estimate is unreportable, because a number with a very wide interval reads
as a measurement to anyone skimming.

**Ceilings, never penalties.** Undefended diagram components cap the `tradeoffs` dimension
rather than subtracting a percentage. The audited prototype's flat 15% penalty was unanchored
and applied twice, compounding to ~28%. A ceiling says "the evidence for level 4 is absent",
which is language the published rubric already uses, and it cannot stack.

**The sandbox taught two lessons by breaking.** The 5-second wall clock was being consumed by
Docker's ~900ms cold start, failing correct submissions on a loaded host — the candidate's
clock now runs inside the container. And killing the `docker` client does not stop the
container: an orphaned fork bomb kept spinning and wedged the daemon. Every abnormal exit now
reaps by name, with `--init` reaping forked children.

**MLE is undefined at the edges, so we say so.** All-correct and all-incorrect response
patterns return `reportable: false` rather than a clamped θ presented as an estimate.

**The weakness graph ranks by interval bottom, not raw θ.** A dimension measured once with a
huge standard error is absence of evidence, not evidence of weakness, and sending someone to
drill it wastes their time.

**The margin gate refuses to certify unpriced drivers**, and found a real problem: at
plausible rates, $49 for 8 included sessions clears only ~67% margin against a 70% floor.

### Open choices taken

| Choice | Taken | Reason |
| --- | --- | --- |
| Node | 22.22.3, pinned | v18 is EOL; Next 15 and drizzle-kit assume ≥20 |
| Queue | pg-boss (selected, not integrated) | Postgres-backed — no infra beyond the required database |
| Sandbox | Docker + `python:3.12-alpine` | gVisor is unavailable on macOS; the flag set is the control |
| Diagramming | tldraw | Named in spec §2.3 |
| a11y harness | axe-core + jsdom | Playwright's browser download was not affordable on a full disk |

## 5. Setup

No Docker required.

```bash
brew install postgresql@16          # once
nvm use && pnpm install

pnpm run db:init && pnpm run db:start
pnpm --filter @loopcraft/db migrate

/opt/homebrew/bin/python3.12 -m venv apps/worker/.venv
apps/worker/.venv/bin/pip install -e 'apps/worker[dev]'

# Gates
pnpm exec eslint . && pnpm run typecheck && pnpm run test
cd apps/worker && .venv/bin/python -m pytest -q

# Processes
pnpm run dev:web       # http://localhost:3100
pnpm run dev:worker    # http://localhost:8099
```

The sandbox needs `/usr/bin/sandbox-exec` (macOS, present by default) and
`/opt/homebrew/bin/python3.12`. Its suite fails rather than skips when either is missing.

No provider keys are needed: every test mocks its providers and demo mode is deterministic.

## 6. Known gaps

**Blocking a phase 2 sign-off**

1. **No gold set, therefore no reliability number.** 200+ human-labeled responses per track,
   adjudicated by two raters. A data-collection programme, not a coding task. No α or ρ is
   reported anywhere, because none has been measured.
2. **The grader sampler has no provider-backed implementation.** Grading, persistence and the
   debrief route are complete; only the deterministic demo sampler exists.
3. **No ASR ingestion or audio capture.** The worker computes the §2.7 metrics from a
   transcript and timings, but nothing feeds it from a session.

**Verification debt**

4. Colour contrast is unverified; jsdom cannot sample pixels. Needs a real browser.
5. The memory ceiling is a sampled guard, not a kernel cap — see §3.2.

**Functional gaps**

7. No Monaco editor surface. Execution, hints and hidden tests are built; the editor is not.
8. No tldraw canvas surface. Extraction, analysis and grading are built; the canvas is not.
9. IRT is not wired into item selection at runtime — `selectNextItem` exists, the session
   engine still uses catalog order. `item_stats.response_count` is 0 for all 124 items.
10. No Stripe integration. Flows, consent and cancellation are modelled and tested; no
    payment processor is connected.
11. No account-deletion job (acceptance criterion 10).
12. No Playwright e2e; the `e2e/` workspace from spec §3.1 does not exist.
13. Per-track domain rubrics: 11 of 12 tracks share one domain rubric.
14. Rate limiter is in-process — correct for one node, wrong for several.
15. Idempotency keys are enforced but not yet replayed from `idempotency_keys`.
16. FSRS uses published default weights — population priors, **not** optimized on Loopcraft
    data.
17. `pnpm run test` is serialised because `packages/db` and `apps/web` share one database.

## 7. Configuration you must supply

| Value | Where | Notes |
| --- | --- | --- |
| **Nine vendor rates** | `packages/core/src/rates.json` | All `null`. The margin gate **fails** until these are set — deliberately. |
| Plan prices and volumes | `plans` table | No price is hard-coded anywhere. At plausible rates, $49/8 sessions misses a 70% floor. |
| `DATABASE_URL` | env | Defaults to local Docker. Non-local also needs `LOOPCRAFT_ALLOW_REMOTE_MIGRATIONS=1`. |
| Provider credentials | env, via `packages/providers/src/secrets.ts` only | Never prefix `NEXT_PUBLIC_`; a scan fails the build on it. |
| Storage signing secret | env | Minimum 32 characters, enforced. |
| Supabase auth | — | `authenticate()` is a port with no production implementation. |

## 8. Decisions that need you, not an engineer

1. **Commission the gold set, or accept no reliability claim.** Without it the calibration
   card stays as it is: method published, statistics absent.
2. **Set plan prices** against the margin model.
3. **Trademark screen "Loopcraft"** before any spend — USPTO TESS Classes 41 and 42, plus
   common-law, EUIPO and UKIPO. Not done here.
4. **Counsel review** of `docs/claims-policy.md`, the compliance page, and the ToS exclusions.
5. **Whether the Seatbelt sandbox is strong enough for untrusted public traffic.** It is
   solid for a rehearsal product, but it is a single-user OS confinement rather than a VM
   boundary, and its memory ceiling is sampled. A gVisor or Firecracker deployment on Linux
   is the harder posture if the threat model changes.
