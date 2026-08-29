# Loopcraft — product, architecture, and compliance spec

Version 1.0 · 2026-08-28 · Successor spec to `SlatePath Interview AI` build doc + audit
Status: source of truth for implementation. Supersedes the SlatePath interview-ai spec where they conflict.

---

## 0. Naming decision

You proposed `InterviewSuccess.AI`. Two problems with it as the primary mark:

1. **Trademark strength.** "Interview Success" is descriptive of the service. Descriptive marks are refused registration on the USPTO Principal Register under Lanham Act §2(e)(1) absent acquired distinctiveness, which takes roughly five years of substantially exclusive use. You would spend money on a name you cannot defend against copycats.
2. **Claim surface.** A name that asserts an outcome invites the FTC substantiation question at the level of the brand itself, not just the ad copy. Every marketing sentence then has to work harder.

Recommended primary marks, in order. All are suggestive rather than descriptive, so they are registrable in Class 41 (educational/training services) and Class 42 (SaaS):

| Name | Domain to check | Why |
| --- | --- | --- |
| **Loopcraft** | `loopcraft.ai`, `loopcraft.com` | "Loop" is the industry term for an onsite panel. Signals insider fluency without claiming an outcome. Short, brandable, verbable ("loopcrafted"). |
| **Offerloop** | `offerloop.ai` | Same insider fluency, slightly more aspirational. Suggestive, still registrable. |
| **Debriefly** | `debriefly.ai` | "Debrief" is what the panel does after you leave. The product literally generates a debrief packet. |
| **Panelight** | `panelight.ai` | Panel + light. Distinctive, easy to clear. |
| **Raiseback** | `raiseback.ai` | Evokes bar-raiser culture without using Amazon's term. |

Use `Loopcraft` for the mark and product. Buy `interviewsuccess.ai` as a redirecting marketing domain if you like the phrase for SEO landing pages, but do not make it the brand.

**Before you buy:** check availability at a registrar (availability changes hourly, so verify at purchase time), then screen the name in USPTO TESS for Classes 41 and 42, run a common-law search, and check the EUIPO and UKIPO registers if you intend the global positioning below. Do not skip the trademark screen; renaming after launch costs more than the search.

Everything below uses **Loopcraft**. Rename in one place (`packages/core/src/brand.ts`) if you pick another.

---

## 1. What the product is, stated precisely

Loopcraft is **interview rehearsal and coaching software for candidates**. It simulates the structure of a technical hiring loop, grades responses against published, anchored rubrics, and returns evidence-linked feedback plus a longitudinal skill model.

It is **not**:

- a hiring or screening tool, and is never sold to employers for candidate evaluation;
- a live-interview assistant. No real-time answer feeding during an actual interview, ever. This is a product decision, a ToS prohibition, and a competitive moat: enterprise and university buyers will not touch a vendor that also sells cheating, and the category has already taken reputational damage from tools that do;
- a predictor of hiring outcomes for an individual.

Write these three exclusions into the ToS, the marketing site, and the system prompts. They are what makes the aggressive positioning in §2 legally survivable.

---

## 2. Positioning: why this beats the SlatePath baseline

The audited product asks one question at a time and scores four delivery dimensions. That is a demo. Eleven upgrades turn it into a product a senior engineer would pay for.

### 2.1 Loop simulation, not question-at-a-time

Real loops have structure. Model the session as a **loop** containing **rounds**, each with a type, a persona, a rubric, and a time budget. End the loop with a synthetic **debrief packet**: per-attribute evidence, quotes, gaps, and a calibrated practice signal.

Publicly documented loop shapes to encode as templates (cite the source careers page in the template metadata; do not claim insider knowledge):

- **Google-style:** phone screen → 4–5 round onsite; attributes graded as General Cognitive Ability, Role-Related Knowledge, Leadership, and culture fit; packet goes to a hiring committee rather than the interviewers deciding.
- **Amazon-style:** online assessment → phone screen → 4–6 round loop including a Bar Raiser; every round probes Leadership Principles with STAR narratives and hard metrics.
- **Meta-style:** screen → coding rounds, a design round, and a behavioral round; design expected at senior levels.
- **Microsoft/Apple-style:** team-owned loops, deeper domain specificity, less standardization.
- **Frontier AI lab style:** research depth interview, ML breadth, a pair-programming or take-home round on a real repository, and a systems round.

Each template stores: round sequence, per-round minutes, rubric ids, difficulty band by level (L3–L7 equivalents), and a `source_urls` array. Templates are user-selectable and clearly labeled as *modeled on publicly reported formats*.

### 2.2 Real coding surface

Monaco editor, sandboxed execution, hidden test cases, and an interviewer agent that behaves like an interviewer: asks for clarification first, withholds the optimal approach, offers a hint ladder (nudge → constraint → structure → partial solution), interrupts on silence longer than 45 seconds, and asks for complexity analysis and test cases before accepting a solution.

Grade the dimensions interviewers actually grade, not "did it pass": requirement clarification, approach articulation before coding, code quality, correctness, complexity reasoning, testing instinct, hint dependence, and communication under pressure. Hint dependence is the single most predictive signal you can compute and nobody else surfaces it.

Execution: run untrusted code in a hardened sandbox with no network, a 256 MB memory ceiling, a 5-second wall clock, seccomp restrictions, and a per-user concurrency cap. Self-hosted Piston or gVisor-isolated containers. Never `eval` in the app process.

### 2.3 System design canvas

Embed a diagramming surface (tldraw). Extract the diagram to structured JSON (nodes, edges, labels, annotations) and grade the artifact plus the transcript together against a design rubric: requirements and scoping, capacity estimation, API surface, data model, scaling path, failure modes, and explicit trade-off articulation. Penalize component name-dropping without justification, which is the most common real failure mode.

### 2.4 AI and AI-infrastructure tracks as first-class products

This is the differentiated wedge. Ship these as their own tracks with their own rubrics and item banks:

| Track id | Covers |
| --- | --- |
| `ml-research` | Paper depth, ablation design, experiment critique, math (attention, optimization, statistics), reproducibility |
| `ml-systems` | Distributed training (data/tensor/pipeline parallel), NCCL failure debugging, checkpointing, throughput analysis, OOM triage |
| `gpu-performance` | CUDA and Triton kernels, memory hierarchy, occupancy, fusion, roofline reasoning, profiling |
| `inference-serving` | KV-cache management, continuous batching, speculative decoding, quantization trade-offs, latency SLOs, autoscaling |
| `llm-application` | RAG architecture and failure analysis, eval design, prompt and context engineering, agent orchestration, cost control |
| `mlops-data` | Feature stores, pipeline reliability, drift detection, lineage, retraining policy |
| `ai-product` | Model-capability-aware product scoping, eval-driven roadmaps, latency/cost/quality trade-offs |
| `ai-safety-policy` | Threat modeling, red-teaming, evaluation methodology, policy reasoning |

Plus the general technical tracks from the baseline (`software-engineering`, `data-ai`, `product-management`, `general`) and the non-tech tracks retained but deprioritized until tech traction exists.

Ship tech first, in this order: `software-engineering` → `ml-systems` → `inference-serving` → `ml-research` → `gpu-performance` → the rest.

### 2.5 Psychometrically defensible adaptivity

Replace "adapt from the last answer" with a two-parameter logistic IRT model. Each item carries a difficulty `b` and discrimination `a`. After each response, update the candidate's ability estimate θ and select the next item that maximizes Fisher information near θ, targeting roughly a 60% success probability. Cold-start `b` from expert tagging, then recalibrate from response data once each item has ≥ 200 responses.

This gives you a defensible ability estimate with a standard error, which is what makes any readiness statement honest.

### 2.6 Scoring calibration as an engineering artifact

The audit found a 15% arbitrary penalty and a "70+ is exceptional" label. Delete both. Replace with:

- **Anchored rubrics.** Every dimension has a 1–5 scale where each level has a written behavioral anchor and two worked examples.
- **Grader separation.** The interviewer model never grades. A separate grader model receives only the transcript, artifacts, and rubric.
- **Self-consistency.** Grade with n=3 independent samples at temperature 0.3; take the median; report inter-sample variance as a confidence signal.
- **Gold set.** 200+ human-labeled responses per major track, labeled by two raters with adjudication.
- **Reported reliability.** Krippendorff's α for model-vs-human agreement, Spearman ρ against human total scores, and per-dimension confusion matrices. Regenerate on every grader prompt or model change; fail CI if α drops more than 0.05 from baseline.
- **Public calibration card.** A page describing method, gold-set composition, agreement statistics, and known limitations. This document is your entire defense if the FTC or a state AG asks what your scores mean.
- **Uncertainty in the UI.** Show "3.4 ± 0.6" and never a false-precision integer.

### 2.7 Delivery analytics that stay legal (see §5)

Compute from the transcript and audio timing only: words per minute, filler ratio, pause length distribution, longest unbroken monologue, response latency, hedging density, quantification density (numbers per answer), and STAR segment coverage. These are observable measurements.

Do not infer emotion, confidence, enthusiasm, sentiment, or personality from face or voice. Video is optional, off by default, and when on produces only mechanical framing advice (are you centered, is the camera at eye level, is the room lit). See §5.1 for why this is not optional.

### 2.8 Evidence engine

Ingest resume plus job description. Produce a coverage matrix of the candidate's stories against the target company's attribute set, flag attributes with no supporting story, flag stories with no quantified outcome, and maintain a reusable STAR bank the loop simulator draws from so the same story is not repeated across rounds.

### 2.9 Longitudinal skill model

Per-dimension ability estimates over time, a weakness graph, and an FSRS-based spaced-repetition scheduler that resurfaces weak sub-skills. Readiness is expressed as an ability estimate against a target level with a stated standard error, never as a probability of getting an offer.

### 2.10 Human layer (phase 3)

Peer mock matching and a verified-coach marketplace with revenue share. This is the moat: it generates the consented outcome data that would eventually let you make a substantiated efficacy claim, which no pure-AI competitor can honestly make.

### 2.11 Distribution surfaces

Ship as web first. Then a VS Code extension for coding practice inside the editor, and a CLI (`npx loopcraft`) for the terminal-native audience that overlaps heavily with AI-infra candidates.

---

## 3. Architecture

### 3.1 Repository layout

```
loopcraft/
  apps/
    web/                 Next.js 15 App Router, TS strict, Tailwind, shadcn/ui
    worker/             FastAPI media + analysis worker (Python 3.12)
  packages/
    core/               tracks, rubrics, loop templates, zod schemas, brand
    providers/          LLM/ASR/TTS adapters, model registry, cost accounting
    scoring/            IRT, aggregation, calibration statistics
    evals/              eval harness, gold sets, regression gates
    db/                 drizzle schema, migrations, RLS policies
  docs/
    spec.md  audit.md  calibration-card.md  claims-policy.md  DELIVERY.md
  e2e/                  Playwright
```

pnpm workspaces + Turborepo. TypeScript `strict: true`, no `any` in `packages/*`.

### 3.2 Data model (Postgres, RLS on every table)

```
orgs, users, memberships
plans, entitlements, usage_ledger, idempotency_keys
loop_templates, rounds_spec, tracks, rubrics, rubric_anchors
items, item_stats            -- IRT a/b/c params, response counts
sessions                     -- one loop attempt, durable, resumable
rounds                       -- one round within a session
turns                        -- {round_id, item_id, question, transcript, artifact_ref}
artifacts                    -- code submissions, diagrams, uploads (storage keys only)
scores, score_dimensions, grader_runs
ability_estimates            -- theta + SE per user per dimension over time
consent_events               -- versioned, per-purpose, immutable append-only
retention_jobs, audit_log, model_runs   -- model_runs holds tokens + cost per call
```

Non-negotiables:

- Session state lives in Postgres, not React state. Refresh resumes exactly.
- Every mutating route takes an `Idempotency-Key`.
- RLS denies by default; add a test that asserts a user in org A cannot read org B rows.
- Storage buckets private. Signed URLs only, 15-minute TTL. No public URL path anywhere in the codebase.

### 3.3 Request flow

```
Browser (authed)
  → POST /api/sessions            create loop from template, server picks round 1 item
  → POST /api/sessions/:id/turns  submit answer; server selects next item via IRT
  → PUT  signed storage URL       media/artifact upload direct to private bucket
  → queue job → worker            ASR + non-biometric delivery metrics
  → grader                        rubric-anchored scoring, n=3, median
  → POST /api/sessions/:id/debrief  assemble packet
  → dashboard
```

Every route: Supabase auth check → entitlement check → rate limit → zod validation → handler. Entitlements are resolved server-side from the authenticated user and active subscription. Never trust a client-supplied plan id or usage count.

### 3.4 Provider layer

One registry file holds model names, timeouts, retries, and fallbacks. Each call writes a `model_runs` row with token counts and computed cost. A per-session cost ceiling degrades gracefully (drop to a cheaper grader, shorten context) rather than failing.

Kill from the baseline: the duplicate `/analyze-audio-video-upload/` endpoint, the alternate Whisper route, the unrelated education APIs sharing the worker process, and every debug field that returns file paths, raw provider payloads, or masked key suffixes.

### 3.5 Testing gates

| Layer | Tool | Gate |
| --- | --- | --- |
| Unit | Vitest / pytest | ≥ 80% on `packages/core`, `packages/scoring` |
| Contract | Vitest | Every track returns a valid response for every round type |
| Integration | Vitest + mocked providers | Full loop, resume-after-refresh, entitlement denial |
| E2E | Playwright | Prep → loop → debrief → dashboard, with synthetic media fixtures |
| Security | custom | RLS cross-tenant denial, signed-URL expiry, sandbox escape attempts |
| Eval | `packages/evals` | Grader α vs gold set within 0.05 of baseline |
| A11y | axe-core | Zero critical violations, WCAG 2.2 AA |
| Load | k6 | 100 concurrent loops, p95 question latency < 2.5 s |

---

## 4. Pricing and unit economics

Do not hard-code prices. Model them.

Per-session cost drivers: ASR minutes, TTS characters, LLM tokens for question generation, LLM tokens for grading (×3 for self-consistency), code execution CPU-seconds, storage GB-months, egress, and payment fees. Build `packages/core/src/economics.ts` with a `estimateSessionCost(config)` function and a rates file that engineering updates from current vendor pricing. Add a CI check that every plan's included volume × modeled cost stays under a configured gross-margin floor.

Suggested SKU shape, with the numbers left for you to set from the model:

- **Free** — 2 short sessions/month, audio-only, no loop simulation, no code execution. Enough to feel the quality, not enough to prep with.
- **Pro (monthly)** — full loops, coding and design rounds, full analytics, history retention.
- **Sprint (14-day pass, one-time)** — high volume, no renewal. This matches how candidates actually buy: they buy in a panic ten days before an onsite. A one-time SKU converts better than a subscription for that moment and carries no auto-renewal legal exposure.
- **Teams / EDU** — seats, cohort dashboards with aggregate-only defaults, SSO, DPA.

If you sell any auto-renewing plan, see §5.4.

---

## 5. Legal and marketing constraints

I am not a lawyer and this is not legal advice. Have counsel review before launch. The items below are the ones that will actually bite, with current status as of August 2026.

### 5.1 Emotion inference is the biggest single risk in the baseline product

The SlatePath worker runs MediaPipe/OpenCV over interview video and produces "engagement" and "voice" scores. That design is a direct problem in the EU.

<cite index="35-1">EU AI Act Article 5(1)(f) prohibits placing on the market, putting into service, or using AI systems to infer emotions of a natural person in the areas of workplace and educational institutions, applicable from 2 February 2025</cite>. <cite index="31-1">The Commission's guidelines state that "workplace" should be interpreted broadly to include any setting where work is performed, and that it covers recruitment and hiring processes, not only existing employees</cite>. <cite index="34-1">Penalties reach €35 million or 7% of global annual turnover</cite>.

Two escape hatches exist, and both are narrow. <cite index="30-1">The prohibition distinguishes emotions derived from biometric data from those derived from other analysis, with the latter falling outside its scope</cite>, and <cite index="31-1">the guidelines suggest systems deployed purely for personal training purposes may sit outside the prohibition</cite>. Neither is a foundation to bet a company on.

**Build rule:** derive all delivery feedback from transcript text and audio timing, which are not biometric inferences about emotional state. Never emit a field named sentiment, engagement, confidence, enthusiasm, or emotion. Video processing is opt-in, off by default, produces only mechanical framing advice, and is disabled entirely for EU and Illinois users by geo-configuration. Add a lint rule that fails the build if a banned field name appears in a response schema.

Note also that the August 2026 EU deadline shifted for high-risk systems but not for transparency: <cite index="5-1">Regulation (EU) 2026/1744, the Digital Omnibus on AI, entered into force on 27 July 2026 and pushes Annex III high-risk compliance from 2 August 2026 to 2 December 2027</cite>, while <cite index="12-1">the Article 50 transparency obligations remain effective 2 August 2026 and were not deferred</cite>. <cite index="13-1">New prohibited practices and Article 50(2) transparency for legacy systems apply from 2 December 2026</cite>. Article 50 means you must clearly disclose that the user is interacting with an AI system, which is trivial to satisfy and easy to forget.

The candidate-side framing also matters for high-risk classification: Annex III covers employment systems used for recruitment and selection. A rehearsal tool the candidate buys for themselves is not making a selection decision. Preserve that distinction by never selling evaluation output to an employer.

### 5.2 Biometric and privacy law in the US

- **Illinois BIPA (740 ILCS 14)** requires written release before collecting biometric identifiers or information and a published retention schedule. Face geometry from video is the litigated fact pattern. The safest posture is to generate no face templates at all.
- **Illinois AI Video Interview Act (820 ILCS 42)** binds employers using AI video analysis. It does not bind you as a candidate-side tool, but enterprise and university buyers will ask about it, so answer it in your security questionnaire pack.
- **Texas CUBI (Bus. & Com. Code §503.001)** and the Texas Data Privacy and Security Act apply to you directly as a Texas-based operator.
- **CCPA/CPRA** treats biometric data as sensitive personal information with a right to limit use.
- **GDPR** Article 9 covers biometric data processed for unique identification; you avoid it by not doing identification. Still do a DPIA under Article 35, publish retention periods, and honor DSRs with a working delete endpoint that also purges storage objects.
- **COPPA and minors.** High-school users will sign up. Gate at 13+ (16+ in the EU), and do not process video for accounts flagged as minors.

### 5.3 Marketing claims

The FTC's position is that objective claims need competent and reliable substantiation before they are made. Its recent enforcement sweep targeted exactly the category of AI products making outcome and earnings claims.

**Never say:** guaranteed offer; any hiring-probability percentage for an individual; "X% of our users get hired at [company]" without a completed study; "real Google/Meta interview questions"; "insider questions"; any use of an employer's logo or trade dress; anything implying partnership, affiliation, or endorsement.

**Safe to say:** practice loops modeled on publicly reported interview formats; rubrics anchored to publicly documented evaluation attributes; scores are coaching signals with stated reliability; a footer stating "Loopcraft is not affiliated with, endorsed by, or sponsored by any employer named on this site." Using company names descriptively to identify the format you emulate is nominative fair use; using their logos is not.

**Leaked-question risk.** Do not ingest scraped question dumps from Glassdoor, Blind, or leaked question banks. Those carry NDA-misappropriation and copyright exposure and would destroy the enterprise sales motion. Generate items against rubrics instead, and log provenance for every item.

**If you ever want a real efficacy number:** preregister an opt-in cohort study, define the denominator before collecting data, disclose methodology and sample, and publish it. Testimonials must follow 16 CFR Part 255, and 16 CFR Part 465 (the Rule on the Use of Consumer Reviews and Testimonials) prohibits fabricated or incentivized-undisclosed reviews. Include typicality disclosures next to any individual success story.

### 5.4 Subscriptions

<cite index="22-1">The Eighth Circuit vacated the FTC's Click-to-Cancel rule on 8 July 2025 in Custom Communications, Inc. v. FTC</cite>, and <cite index="25-1">the FTC submitted a draft ANPRM on 30 January 2026 to restart the rulemaking, with ROSCA and Section 5 enforcement continuing in the meantime</cite>. State law fills the gap: <cite index="27-1">state automatic renewal laws and state UDAP statutes were unaffected, and several states including New York, California, Connecticut, Massachusetts, Maryland, and Arkansas have recently enacted or amended their ARLs</cite>. <cite index="28-1">California's law requires express affirmative consent to the auto-renewal terms plus a retainable acknowledgment containing the terms and cancellation instructions</cite>.

Build to the California standard as the national default: separate affirmative consent to renewal terms, emailed retainable acknowledgment, renewal reminders, and cancellation in the same number of clicks as signup with no retention interstitial that blocks the path.

### 5.5 Employment-AI laws you do not trigger but will be asked about

<cite index="17-1">Colorado replaced its AI Act with SB 26-189 on 14 May 2026, effective 1 January 2027, imposing notice and disclosure duties on developers and deployers of automated decision-making technology used in consequential decisions including employment</cite>, after <cite index="14-1">the original law's effective date slipped from June 30, 2026</cite>. NYC Local Law 144 and Illinois HB 3773 similarly bind employers. None of these reach a candidate-side rehearsal tool, but write a one-page position paper explaining why, because every enterprise security questionnaire will ask.

### 5.6 Accessibility

WCAG 2.2 AA, full keyboard operation, captions on all generated audio, a text-only interview mode, and configurable time limits. Beyond being right, the DOJ's ADA Title II web rule makes this a hard procurement gate for public universities, which are your best B2B channel.

---

## 6. Build phases

| Phase | Scope | Exit criteria |
| --- | --- | --- |
| 0 | Monorepo, CI, schema, RLS, auth, entitlement middleware, provider registry, brand config | `pnpm test` green; RLS cross-tenant test passes; no secrets client-side |
| 1 | Durable sessions, track catalog, item bank, question generation with fallback, text-only loop | Full loop completes and resumes after refresh; contract tests pass for every track |
| 2 | Audio capture, ASR, non-biometric delivery metrics, anchored grading with n=3, debrief packet | Grader α vs gold set reported; no banned field names in any schema |
| 3 | Coding round: Monaco, sandboxed execution, hint ladder, interviewer interrupts | Sandbox escape suite passes; hint-dependence scored |
| 4 | System design canvas, diagram extraction, design rubric | Design round graded end to end |
| 5 | IRT adaptivity, ability estimates, weakness graph, FSRS scheduler | θ and SE surfaced with uncertainty in UI |
| 6 | Billing, entitlements, ARL-compliant checkout and cancellation, cost ceilings | Economics CI check passes; cancel flow ≤ signup clicks |
| 7 | AI-infra tracks, loop templates, compliance pages, calibration card, a11y pass | axe zero critical; calibration card published |

Each phase is its own commit series with tests. Do not start a phase before the prior phase's exit criteria are green.

---

## 7. Acceptance criteria for the whole build

1. A user completes a multi-round loop, closes the tab mid-round, reopens, and resumes at the same turn with all prior state intact.
2. Every track produces a valid warmup, domain, behavioral, situational, and closing item, and the fallback path returns a catalog item when providers fail.
3. Track and level propagate from prep through every round, the worker, the debrief, and the saved record.
4. No response schema anywhere contains a field inferring emotion, sentiment, engagement, confidence, or personality. A lint rule enforces this.
5. No API key, file path, provider payload, or public storage URL is reachable from the client.
6. A user in org A cannot read any row belonging to org B, proven by test.
7. Grading reliability against the gold set is measured, reported in `docs/calibration-card.md`, and gated in CI.
8. Every score shown to a user carries an uncertainty interval and a link to the method.
9. Every paid action is authorized server-side against the authenticated user and active subscription.
10. Deleting an account purges database rows and storage objects, verified by test.
11. axe reports zero critical violations on every primary route.
12. `docs/claims-policy.md` exists and every marketing string in the app is checked against it by a test.
