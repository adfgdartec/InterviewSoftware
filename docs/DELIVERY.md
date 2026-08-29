# Loopcraft — delivery report

Build date 2026-08-29 · 19 commits · 8,094 lines of TypeScript, Python and SQL
Source of truth: [`docs/spec.md`](./spec.md) · Prototype defects avoided: [`docs/legacy-audit.md`](./legacy-audit.md)

## 1. Status against the spec's build phases

| Phase | Scope | Exit criteria | Status |
| --- | --- | --- | --- |
| 0 | Monorepo, CI, schema, RLS, auth, entitlements, provider registry, brand | `pnpm test` green; RLS cross-tenant test passes; no secrets client-side | **Complete, verified** |
| 1 | Durable sessions, track catalog, item bank, question generation with fallback, text-only loop | Full loop completes and resumes after refresh; contract tests pass for every track | **Complete, verified** |
| 2 | Audio, ASR, delivery metrics, anchored grading n=3, debrief packet | Grader α vs gold set reported; no banned field names in any schema | **Partial** — the anchored n=3 grader and the debrief assembler are built and tested; the second exit condition (no banned field names) holds. The first does **not**: there is no gold set, so no α is reported. Audio capture and ASR ingestion are not wired. See §6. |
| 3–7 | Coding sandbox, design canvas, IRT, billing, AI-infra tracks | — | **Not started.** See §6. |

This build was scoped to phases 0–2 depth-first by explicit decision, rather than a thin
slice through all seven. Phases 0 and 1 meet their exit criteria with the evidence in §3.

## 2. What was built

```
apps/
  web/                Next.js 15, TS strict — guard chain, session engine, routes, demo mode
  worker/             FastAPI, Python 3.12 — non-biometric delivery metrics
packages/
  core/               brand, affect vocabulary, claims gate, cost model, content catalog
  db/                 27-table schema, RLS policies, migrations, catalog seeding
  providers/          model registry, cost accounting, cost ceiling, credential handling
  scoring/            n=3 anchored grader, uncertainty aggregation, debrief assembler
tooling/
  eslint-plugin-loopcraft/   the no-affect-inference build gate
```

**Content catalog:** 12 tracks · 7 rubrics · 24 dimensions · **120 behavioural anchors** ·
5 loop templates · **124 items**, each carrying provenance.

**Database:** 27 tables, 28 RLS policies, RLS enabled *and forced* on every table.

## 3. Test results — actual output

```
$ pnpm run test
@loopcraft/core:test:            Tests  109 passed (109)
@loopcraft/db:test:              Tests   18 passed (18)
@loopcraft/scoring:test:         Tests   64 passed (64)
eslint-plugin-loopcraft:test:    Tests   13 passed (13)
@loopcraft/providers:test:       Tests   22 passed (22)
@loopcraft/web:test:             Tests  118 passed (118)
 Tasks:    6 successful, 6 total

$ cd apps/worker && .venv/bin/python -m pytest -q
46 passed in 0.23s

$ pnpm exec eslint .
(clean)

$ pnpm run typecheck
 Tasks:    4 successful, 4 total
```

**390 tests total** (344 TypeScript, 46 Python). Zero uses of `any` across `packages/*`.

### Acceptance criteria (spec §7)

| # | Criterion | Evidence |
| --- | --- | --- |
| 1 | Resume mid-round with state intact | `session-engine.test.ts` and `demo-loop.e2e.test.ts` discard every pooled connection and open a new client before reloading |
| 2 | Every track yields all five required items; fallback returns a catalog item | `catalog-contract.test.ts` asserts per track, per round type — 48 tests |
| 3 | Track and level propagate to the saved record | `session-engine.test.ts`, `routes.integration.test.ts` |
| 4 | No schema infers emotion; a lint rule enforces it | `no-affect-inference` (13 rule tests) + `test_schemas_have_no_banned_fields.py` |
| 5 | No key, path, payload or public URL reachable from the client | `no-client-secrets.test.ts` (5 scans over every tracked file) |
| 6 | Org A cannot read org B | `rls.test.ts` — 18 tests, incl. a loop over all 20 `org_id` tables |
| 7 | Grading reliability measured and gated | **Not met** — no gold set exists, so no α is measured. The grader it would measure is built. See §6. |
| 8 | Every score carries an uncertainty interval | **Met in the scoring layer.** `scores.interval_low/high` are `NOT NULL`; `formatScore` is the only formatter and always emits `3.4 ± 0.3`; the interval never collapses to zero even on unanimous samples. Not yet surfaced in a UI, because there is no UI. |
| 9 | Paid actions authorized server-side | `guards.test.ts`, `routes.integration.test.ts` (402 on canceled / feature / quota) |
| 10 | Account deletion purges rows and storage | **Not met.** `retention_jobs` table exists; the job does not. |
| 11 | axe zero critical violations | **Not met.** No UI pages yet. |
| 12 | `claims-policy.md` exists and strings are checked | `claims.test.ts` parses the policy document itself as the gate's source |

## 4. Architecture decisions and why

**The affect vocabulary lives in one module, consumed by three enforcers.**
`packages/core/src/banned-tokens.ts` feeds the ESLint rule, the runtime string scanner and
the Python worker — and the worker's test parses the TypeScript source at run time to assert
the two copies are identical. Spec §5.1 makes this a build-failing requirement; a rule with
its own private word list drifts from the one the product actually uses.
`confidenceInterval` is exempt as a field name while bare `confidence` is not, so the
statistical and psychological readings of the word stay distinguishable at the call site.

**RLS is enabled *and forced*, and the tests run as a role that cannot bypass it.**
Without `FORCE`, the table owner silently bypasses its own policies. More importantly, two
tests assert the test role is neither superuser nor table owner *before* the denial tests
run — connecting as the container's superuser would have made all 18 pass while proving
nothing.

**The catalog refuses writes rather than filtering them.** A SELECT-only policy made
`update plans` return "0 rows updated" instead of refusing. A silent no-op on a mis-scoped
write is a bug you never see, so migration 0005 revokes the verbs outright.

**Signed URLs sign the full request path, not the object key.** Signing the key alone let a
URL minted for one bucket prefix verify against another, and made verification impossible
whenever the base URL carried a path segment. The minter refuses any TTL beyond the
15-minute policy rather than silently clamping.

**Session state is materialised, never recomputed.** Rounds are written at creation, so a
template edited later cannot change the shape of a loop already in progress. `loadSession`
rebuilds everything from rows; nothing is cached in module memory.

**`SessionNotFoundError` is identical for "absent" and "another tenant's".** A
distinguishable message is an enumeration oracle.

**The question fallback is unconditional.** Provider outage, timeout, empty response and
non-compliant response all land in the same place, because a candidate mid-loop cannot be
shown an error where a question should be. Generated text is validated against the affect
vocabulary *before display* — free text is the one path no response schema covers.

**Demo mode is injected at the provider seam, not built as a parallel UI.**
`LOOPCRAFT_DEMO=1` swaps only the generator; the guard chain, entitlements, RLS, the durable
engine and the fallback are the production ones. The demo generator draws exclusively from
the provenance-tagged bank and throws rather than fabricating.

**Rates are `null`, not zero.** `estimateSessionCost` throws naming each unset dotted path.
A cost model that silently prices an unset driver at zero is worse than one that refuses.

### Open choices the spec left to the implementer

| Choice | Taken | Reason |
| --- | --- | --- |
| Node version | 22.22.3, pinned in `.nvmrc` | v18 is EOL; Next 15 and drizzle-kit assume ≥20 |
| Queue | pg-boss (selected, not yet integrated) | Postgres-backed — no infrastructure beyond the database the spec already requires |
| Local database | Postgres 16 in Docker, port 54329, `tmpfs` | Guardrail 9 forbids migrating a non-local database; `tmpfs` keeps resets fast |
| Diagramming | tldraw | Named in spec §2.3 — no choice to make |

## 5. Setup — exact steps

```bash
nvm use                      # reads .nvmrc → 22.22.3
pnpm install
docker compose up -d postgres
pnpm --filter @loopcraft/db migrate

# Worker (Python 3.12 — the default python3 on this machine is 3.11)
/opt/homebrew/bin/python3.12 -m venv apps/worker/.venv
apps/worker/.venv/bin/pip install -e 'apps/worker[dev]'

# Gates
pnpm exec eslint .
pnpm run typecheck
pnpm run test
pnpm run test:rls
cd apps/worker && .venv/bin/python -m pytest -q
```

No provider keys are required: every test mocks its providers, and demo mode is deterministic.

## 6. Known gaps

Deferred work is recorded here rather than as a `TODO` in a source file.

**Blocking a phase 2 sign-off**

1. **The grader is not persisted or wired to a route.** `packages/scoring` grades a round
   from a transcript and assembles a debrief packet, both fully tested, but nothing writes
   `grader_runs` / `scores` / `score_dimensions`, and no route calls it. The sampler port
   has no provider-backed implementation.
2. **No gold set, therefore no reliability number.** Spec §2.6 requires 200+ human-labeled
   responses per major track, adjudicated by two raters. That is a data-collection
   programme, not a coding task. **No Krippendorff's α or Spearman ρ is reported anywhere
   in this build, because none has been measured.** `docs/calibration-card.md` states this
   explicitly rather than printing a placeholder statistic.
3. **No ASR ingestion.** The worker computes the spec §2.7 metrics from a transcript and
   audio timing, but nothing captures audio, calls an ASR provider, or feeds the result into
   a session or a debrief.

**Deferred by scope (phases 3–7)**

4. Coding round: no Monaco surface, no sandboxed execution, no hint ladder. Docker is
   available on this machine, so the sandbox is feasible; it is simply not built.
5. No system design canvas or diagram extraction.
6. No IRT adaptivity. Items carry `difficulty_b` / `discrimination_a` and `item_stats`
   exists, but nothing updates θ.
7. No billing, checkout, or ARL cancellation flow. The `entitlements` constraint trigger
   already refuses an auto-renewing plan without recorded consent.
8. No UI pages, therefore no axe run and no Playwright e2e. The `e2e/` workspace folder from
   spec §3.1 is not yet created.
9. No account-deletion job (acceptance criterion 10).

**Smaller, known, and cheap to fix**

10. **Per-track domain rubrics.** Spec §2.4 calls for a domain rubric per track; this build
    ships one shared domain rubric (grading reasoning quality, with the domain supplied by
    the item bank) plus track-specific coding and design rubrics for `ml-systems`. Eleven
    per-track domain rubrics remain.
11. **Rate limiter is in-process.** Correct for one node, wrong for several. Must move to
    the Postgres-backed implementation before it is load-bearing.
12. **`pnpm run test` is serialised** (`--concurrency=1`) because `packages/db` and
    `apps/web` reset the same database. Give each package its own database to restore
    parallelism.
13. **Idempotency keys are required but not yet replayed.** The header is enforced on every
    mutating route and the `idempotency_keys` table exists, but a repeated key is not yet
    served from the stored response.
14. **No `.env.example`** was committed; §7 lists what it must contain.
15. **The item bank's cross-cutting prompts are shared across tracks.** Warmup, behavioral,
    situational and closing prompts are genuinely track-independent, but a richer bank would
    vary them.

## 7. Configuration you must supply

Nothing below is required to run the tests or demo mode. All of it is required to run
against real providers.

| Value | Where | Notes |
| --- | --- | --- |
| **Nine vendor rates** | `packages/core/src/rates.json` | Every value ships `null`. `estimateSessionCost` throws naming each unset path. Required before the §4 margin gate can run. Also set `asOf`. |
| `DATABASE_URL` | environment | Defaults to the local Docker instance. Guardrail 9: migrating a non-local host additionally requires `LOOPCRAFT_ALLOW_REMOTE_MIGRATIONS=1`. |
| `DATABASE_APP_URL` | environment | The non-superuser role. Derived from `DATABASE_URL` if unset. |
| Provider credentials | environment, read only via `packages/providers/src/secrets.ts` | Registry names `anthropic`, `deepgram`, `elevenlabs`, `openai`. Never prefix with `NEXT_PUBLIC_` — a committed-secret scan fails the build on it. |
| Storage signing secret | environment | Minimum 32 characters, enforced. |
| Supabase project + auth | — | `authenticate()` is a port with no production implementation wired. |

## 8. Decisions that need you, not an engineer

1. **Plan prices and included volumes.** No price is hard-coded anywhere; `plans` rows are
   the only source. The margin gate cannot run until both the rates file and the plan rows
   are populated.
2. **Whether to commission the gold set.** Without it there is no substantiated reliability
   number, and spec §2.6 makes the calibration card the product's defense if a regulator
   asks what a score means.
3. **Trademark screen on "Loopcraft"** before any spend — spec §0 recommends USPTO TESS
   Classes 41 and 42, plus common-law, EUIPO and UKIPO. Not done here.
4. **Counsel review** of `docs/claims-policy.md` and the ToS exclusions in spec §1.
