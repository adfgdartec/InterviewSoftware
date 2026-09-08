# Where each rate in `rates.json` comes from

`rates.json` carries only prices that were read from a vendor's own pricing page, and
`estimateSessionCost()` throws naming any value that is still null. That is deliberate
(guardrail 8, spec §4): a margin computed from a wrong number is worse than one that refuses
to compute, because the wrong number looks like an answer.

This file exists because "fill in the rates" is not actionable without knowing *which* rate.
Each row names the exact model or service the product actually uses — taken from
`packages/providers/src/registry.ts`, not from a general price list — the page to read it
from, and the plan tier the committed figure came from.

**Everything below was read on 2026-09-07**, the date in `rates.json`'s `asOf`. Vendor pages
move; re-read them before pricing anything that matters and update `asOf` in the same commit.

| Key | What it prices | Read it from | Committed value |
| --- | --- | --- | --- |
| `asrPerMinute` | Deepgram `nova-3`, pre-recorded, per audio minute | deepgram.com/pricing | `0.0043` — Nova-3 monolingual, Pay As You Go. The multilingual tier is `0.0052`; switch if the product ever transcribes a non-English loop. |
| `ttsPerThousandCharacters` | Cartesia `sonic-2`, per 1,000 characters | cartesia.ai/pricing | **null.** The page prices credits and minutes of generated audio, not USD per character, and the credit-to-character rate is behind a docs login. Read it from an account's own plan and commit the arithmetic, not a third-party estimate. |
| `llm.questionGeneration.*` | The `question_generation` model in `registry.ts` (`gpt-4o-mini`) | developers.openai.com/api/docs/pricing | `0.15` in / `0.60` out per million tokens, standard tier. |
| `llm.grading.*` | The `grading` model in `registry.ts` (`gpt-4o`) | developers.openai.com/api/docs/pricing | `2.50` in / `10.00` out per million tokens, standard tier. |
| `codeExecutionPerCpuSecond` | Sandboxed execution, per CPU-second | Your compute host's pricing | **null.** No host has been chosen: `packages/sandbox` shells out to macOS `sandbox-exec` and cannot run on Workers at all, so there is nothing yet to price. |
| `storagePerGigabyteMonth` | Database and object storage | supabase.com/pricing | `0.125` — Pro/Team database-storage overage. File storage is cheaper (`0.0213`); this prices the database, which is where session data lives. |
| `egressPerGigabyte` | Bandwidth out | supabase.com/pricing | `0.09` — Pro/Team standard egress. Cached egress is `0.03`. |
| `payment.*` | Card processing: percentage and fixed fee | stripe.com/pricing | `0.029` and `0.30` — US domestic cards, "2.9% + 30¢ per successful transaction". |

## Three things worth knowing before you change these

**OpenAI is the primary tier, not the fallback.** `registry.ts` now declares OpenAI first and
local Ollama second, and call sites resolve through `selectEntry()`, taking the first provider
that is actually usable. A deployed Worker has a key and no reachable localhost, so it runs on
OpenAI; a developer with no key runs entirely on Ollama at no cost. Price the OpenAI tier —
that is what production spends. (This file previously said the opposite, because the registry
previously listed Ollama first and every deployed request quietly fell through to OpenAI.)

**Grading and question generation are different models now.** Spec §2.6 requires the grader to
be a separate model from the interviewer, and grading is the quality-critical path, so it runs
on `gpt-4o` while generation and the interviewer turn run on `gpt-4o-mini`. That is roughly a
17x difference on input tokens — the two `llm.*` blocks are not interchangeable, and a table
that prices both at the mini rate understates the largest line item badly.

**Grading is three calls, not one.** `GRADER_SAMPLE_COUNT` is 3, and each is a full prompt
containing the rubric anchors and the transcript. A five-round loop is fifteen grading calls
plus five generation calls. The token estimate has to reflect that or the margin will be
optimistic by roughly a factor of three on the largest line item. (They now run concurrently,
which cuts the candidate's wait — it does not cut the bill.)
