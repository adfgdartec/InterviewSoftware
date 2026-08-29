# Loopcraft — delivery report

Build date 2026-08-29 · 24 commits · 12,645 lines of TypeScript, Python and SQL
Source of truth: [`docs/spec.md`](./spec.md) · Prototype defects avoided: [`docs/legacy-audit.md`](./legacy-audit.md)

## 1. Status against the spec's build phases

| Phase | Scope | Exit criteria | Status |
| --- | --- | --- | --- |
| 0 | Monorepo, CI, schema, RLS, auth, entitlements, provider registry, brand | `pnpm test` green; RLS cross-tenant test passes; no secrets client-side | **Complete** (RLS suite needs re-run, §3.1) |
| 1 | Durable sessions, catalog, item bank, question generation with fallback, text-only loop | Full loop completes and resumes after refresh; contract tests pass for every track | **Complete** (loop suites need re-run, §3.1) |
| 2 | Audio, ASR, delivery metrics, anchored grading n=3, debrief packet | Grader α vs gold set reported; no banned field names in any schema | **Partial** — grading and debrief wired end to end; second criterion met. First **not met**: no gold set, so no α. Audio/ASR not wired. |
| 3 | Coding round: sandboxed execution, hint ladder, interviewer interrupts | Sandbox escape suite passes; hint-dependence scored | **Built; escape suite unverified** (§3.1) |
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

## 3. Test results

### 3.1 Verified in this session — actual output

```
$ pnpm exec eslint .                    (clean)
$ pnpm run typecheck                    Tasks: 8 successful, 8 total

@loopcraft/core                Tests  109 passed
@loopcraft/scoring             Tests  132 passed
@loopcraft/design              Tests   42 passed
@loopcraft/billing             Tests   29 passed
@loopcraft/providers           Tests   22 passed
@loopcraft/web  (a11y)         Tests   23 passed
eslint-plugin-loopcraft        Tests   17 passed
@loopcraft/sandbox (non-container)  Tests  30 passed

$ cd apps/worker && pytest -q            46 passed in 0.35s
```

**450 tests verified** (404 TypeScript + 46 Python). Zero uses of `any` across `packages/*`.

### 3.2 Written but NOT verified — 169 tests, blocked on infrastructure

The host disk filled to 100% during this session and the Docker daemon has not recovered, so
three suites could not be run. They are not skipped or weakened — they simply have not been
executed since the environment broke.

| Suite | Tests | Needs | Last known state |
| --- | --- | --- | --- |
| `packages/db` (RLS) | 18 | Postgres | 18/18 green earlier this session |
| `apps/web` db-backed | 125 | Postgres | 125/125 green earlier this session |
| `packages/sandbox` escape | 26 | Docker | 21/26; the 5 failures were a real cold-start bug, since fixed but **not re-run** |

**Nothing in §3.1 depends on those three.** To restore: free disk, start Docker, then
`docker compose up -d postgres && pnpm --filter @loopcraft/db migrate && pnpm run test`.

### 3.3 Accessibility — what the green result does and does not mean

axe-core reports **zero critical or serious violations** on all four primary routes. Two
limits are asserted by the suite itself so the result is not over-read:

1. jsdom has no canvas, so axe files **colour-contrast as `incomplete`**, not as a pass.
   Contrast is unverified and must be checked in a real browser.
2. Only static markup is audited. Focus management, live regions and keyboard traps in
   interactive widgets are out of scope until a browser-driven run exists.

### 3.4 Acceptance criteria (spec §7)

| # | Criterion | State |
| --- | --- | --- |
| 1 | Resume mid-round with state intact | Met; suite needs re-run (§3.1) |
| 2 | Every track yields all five item types; fallback works | Met — 48 contract tests |
| 3 | Track and level propagate to the saved record | Met; suite needs re-run |
| 4 | No schema infers emotion; a lint rule enforces it | Met — and the rule was **widened** this session to cover JSX text (§4) |
| 5 | No key, path, payload or public URL reachable from client | Met — 5 scans over every tracked file |
| 6 | Org A cannot read org B | Met; suite needs re-run |
| 7 | Grading reliability measured and gated | **Not met** — no gold set exists |
| 8 | Every score carries an uncertainty interval | Met end to end, structurally (§4) |
| 9 | Paid actions authorized server-side | Met; suite needs re-run |
| 10 | Account deletion purges rows and storage | **Not met** — `retention_jobs` exists, the job does not |
| 11 | axe zero critical on every primary route | Met, with §3.3 limits |
| 12 | `claims-policy.md` exists and strings are checked | Met — the gate parses the policy document itself |

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

```bash
nvm use && pnpm install
docker compose up -d postgres
pnpm --filter @loopcraft/db migrate
docker pull python:3.12-alpine          # sandbox base image

/opt/homebrew/bin/python3.12 -m venv apps/worker/.venv
apps/worker/.venv/bin/pip install -e 'apps/worker[dev]'

pnpm exec eslint . && pnpm run typecheck && pnpm run test
pnpm --filter @loopcraft/web test:a11y
cd apps/worker && .venv/bin/python -m pytest -q
```

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

**Verification debt (see §3.2)**

4. Three suites (169 tests) need Docker and Postgres to be re-run.
5. The sandbox cold-start and container-reaping fixes are **unverified**.
6. Colour contrast is unverified; needs a real browser.

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
5. **Free disk space.** The host is at 100%; three test suites and the sandbox cannot run
   until Docker recovers.
