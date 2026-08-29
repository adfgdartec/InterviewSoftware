# Loopcraft claims policy

Version 1.0 · 2026-08-28 · Enforced in CI by `packages/core/src/claims.ts` and its test suite.

Loopcraft is interview **rehearsal** software sold to candidates. It is not a hiring tool,
not a live-interview assistant, and not a predictor of hiring outcomes for an individual
(spec §1). Every user-facing string in the product and the marketing site is scanned against
the banned-phrase list below. A match fails the build.

The FTC's position is that objective claims require competent and reliable substantiation
*before* they are made (spec §5.3). We have no completed efficacy study, so we make no
efficacy claim. If one is ever run, it must be preregistered with the denominator defined
before data collection, and published with methodology and sample.

## How enforcement works

`BANNED_CLAIM_PATTERNS` in `packages/core/src/claims.ts` is parsed **from this document** at
test time, so the policy and the check cannot drift apart. Adding a phrase here adds it to
the gate. Each entry is a case-insensitive regular expression matched against the
concatenated user-facing string catalog.

## Banned phrases

```banned-claims
guaranteed? (job|offer|interview|hire|placement)
guarantee you (a|an|the)?\s*(job|offer|interview)
\b\d{1,3}\s*% (of )?(our )?(users|candidates|customers) (get|got|are) (hired|offers?)
\bchance of getting (hired|an offer)
\b(hiring|offer|success) (probability|likelihood|odds)
\bwill get you (hired|an offer|a job)
\blands? you (a|the) (job|offer)
\breal (google|meta|amazon|apple|microsoft|openai|anthropic|netflix) interview questions
\b(insider|leaked|actual|verbatim) (interview )?questions
\bin partnership with\b
\b(endorsed|sponsored|certified|approved) by (google|meta|amazon|apple|microsoft)
\bofficial (google|meta|amazon|apple|microsoft) (interview|prep)
\bguaranteed results
\bproven to (get|land|increase)
\bx% more likely to
```

## Required disclosures

These strings must be present in the product, not merely permitted:

```required-claims
Loopcraft is not affiliated with, endorsed by, or sponsored by any employer named on this site.
You are interacting with an AI system.
Scores are coaching signals, not predictions of hiring outcomes.
```

The second line satisfies EU AI Act Article 50 transparency, which remains effective
2 August 2026 and was not deferred by the Digital Omnibus (spec §5.1).

## Safe phrasings

| Instead of | Say |
| --- | --- |
| "Real Google interview questions" | "Practice loops modeled on publicly reported interview formats" |
| "You scored 72 — exceptional" | "Structure: 3.4 ± 0.6 on a 1–5 anchored rubric ([method](/calibration))" |
| "85% of users get offers" | "Grader agreement with human raters: Krippendorff's α = <measured> ([calibration card](/calibration))" |
| "Guaranteed to improve" | "Your ability estimate for this dimension moved from 2.1 ± 0.5 to 2.8 ± 0.4 over 6 sessions" |

Using an employer's name descriptively to identify the format being emulated is nominative
fair use. Using their logo or trade dress is not, and no employer logo may ship in any asset.
