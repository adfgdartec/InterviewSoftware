# Loopcraft calibration card

Version 0.1 · 2026-08-29 · Status: **method published, reliability not yet measured**

Spec §2.6 requires this page and describes what belongs on it: grading method, gold-set
composition, agreement statistics, and known limitations. This version publishes the method
and states plainly which numbers do not exist yet.

> **No agreement statistic is reported on this page, because none has been measured.**
> There is no gold set in this build. The grader the statistics would describe exists
> (`packages/scoring`, 64 tests) but has never been run against human labels. Any Krippendorff's α, Spearman ρ or
> confusion matrix printed here would be fabricated. When the gold set exists, this document
> is regenerated from measured output and CI gates on it.

## What a Loopcraft score is

A score is a **coaching signal**, not a prediction of a hiring outcome. Loopcraft does not
estimate anyone's probability of receiving an offer, and no string in the product may assert
one — enforced by a test against [`claims-policy.md`](./claims-policy.md).

Every dimension is scored on a **1–5 anchored scale**. Each level carries a written
behavioural anchor plus two worked examples; this build ships 120 anchors across 24
dimensions in 7 rubrics. Scores are never rescaled to 0–100, and there is no "exceptional"
threshold. The audited predecessor did both, along with an arbitrary 15% penalty applied
twice; none of that is reproduced.

## Grading method (implemented in `packages/scoring`; not yet wired to a route)

1. **Grader separation.** The interviewer model never grades. A separate grader receives
   only the transcript, the artifacts, and the rubric — never the interviewer's reasoning.
   `packages/providers/src/registry.ts` enforces distinct models, asserted by test.
2. **Self-consistency.** Grade with **n = 3** independent samples at temperature 0.3. Take
   the **median**. Report inter-sample variance as an uncertainty signal.
3. **Uncertainty is structural.** `scores.interval_low` and `scores.interval_high` are
   `NOT NULL` in the schema, so a score cannot physically be stored without its interval.
   The UI shows `3.4 ± 0.6`, never a false-precision integer.
4. **Evidence linkage.** Every dimension score carries a transcript quote and the turn it
   came from (`score_dimensions.evidence_quote`, `evidence_turn_id`).

## What is graded, and what is not

Graded, from **transcript text and audio timing only**: the rubric dimensions, plus the
mechanical delivery measurements in spec §2.7 — words per minute, filler ratio, pause length
distribution, longest unbroken monologue, response latency, hedging density, quantification
density, and STAR segment coverage.

**Never graded or inferred:** emotion, sentiment, engagement, confidence, enthusiasm, mood,
or personality — from face, voice, or video. This is enforced three ways: an ESLint rule
that fails the build on the vocabulary appearing in a field name, prompt or user-facing
string; a pytest that walks every Pydantic model; and a runtime check on generated question
text before it is displayed. The reason is spec §5.1 — EU AI Act Article 5(1)(f) — and also
measurement: an interviewer can verify "named two failure modes" from a transcript and
cannot verify "seemed unsure". Rubric anchors written with *seemed*, *felt* or *appeared to
be* fail a test for this reason.

## Gold set

**Composition: none.** Spec §2.6 requires 200+ human-labeled responses per major track,
labeled by two raters with adjudication. This is a data-collection programme.

When it exists, this section must state, per track: response count, rater count,
adjudication rule, inter-rater agreement *among the humans* before any model comparison, and
the date of collection.

## Agreement statistics

**Not measured.** When the gold set exists, report and gate on:

- **Krippendorff's α** for model-vs-human agreement, per dimension.
- **Spearman ρ** against human total scores.
- **Per-dimension confusion matrices**, so a grader that is accurate on average while
  systematically confusing levels 3 and 4 is visible.

Regenerate on every grader prompt change and every model change. **Fail CI if α drops more
than 0.05 from baseline** (spec §3.5). That gate is specified and not yet wired, because
there is no baseline to drop from.

## Known limitations

1. **No measured reliability.** The largest limitation. The grader is implemented and
   tested for contract conformance, but conformance is not accuracy: until the gold set
   exists it is an unvalidated instrument.
2. **No IRT calibration.** Item `difficulty_b` and `discrimination_a` are cold-started from
   expert tagging. Spec §2.5 requires recalibration from response data once an item has ≥200
   responses; `item_stats.response_count` is `0` for all 124 items.
3. **English only.** Every anchor and item is written in English; no claim is made about
   grading in another language.
4. **One shared domain rubric.** Spec §2.4 calls for a per-track domain rubric; this build
   grades domain reasoning against a shared rubric with the domain supplied by the item
   bank. This may systematically under-differentiate between tracks.
5. **Anchors are unvalidated.** They were authored against the spec, not tested for whether
   two independent raters assign the same level using them. That test is part of building
   the gold set.
6. **No demographic fairness analysis.** None has been run. Loopcraft is candidate-side and
   makes no selection decision (spec §5.5), but that is a legal argument, not evidence that
   scoring is even-handed.

## How to challenge a score

Any score shown in the product links here. If a score looks wrong, the evidence quote and
the anchor it was matched against are both retrievable, which is the point of storing them.
