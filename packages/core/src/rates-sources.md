# Where each rate in `rates.json` comes from

`rates.json` ships with every value `null`, and `estimateSessionCost()` throws naming any null
it needs. That is deliberate (guardrail 8, spec §4): a margin computed from a wrong number is
worse than one that refuses to compute, because the wrong number looks like an answer.

This file exists because "fill in the rates" is not actionable without knowing *which* rate.
Each row names the exact model or service the product actually uses — taken from
`packages/providers/src/registry.ts`, not from a general price list — and the page to read it
from.

| Key | What it prices | Read it from |
| --- | --- | --- |
| `asrPerMinute` | Deepgram `nova-3`, pre-recorded transcription, per audio minute | deepgram.com/pricing |
| `ttsPerThousandCharacters` | Cartesia `sonic-2`, per 1,000 characters synthesized | cartesia.ai/pricing |
| `llm.questionGeneration.*` | The `question_generation` fallback model in `registry.ts` | openai.com/api/pricing |
| `llm.grading.*` | The `grading` fallback model in `registry.ts` | openai.com/api/pricing |
| `codeExecutionPerCpuSecond` | Sandboxed execution, per CPU-second | Your compute host's pricing |
| `storagePerGigabyteMonth` | Database and object storage | supabase.com/pricing |
| `egressPerGigabyte` | Bandwidth out | supabase.com/pricing, cloudflare.com/plans |
| `payment.*` | Card processing: percentage and fixed fee per transaction | stripe.com/pricing |

## Two things worth knowing before you fill these in

**Ollama is not free in production.** `registry.ts` makes a local Ollama model the *primary*
for every reasoning purpose, with OpenAI as the fallback. A Worker cannot reach `localhost`,
so in a deployed environment every call falls through to OpenAI. Price the **fallback** tier;
pricing the local one would model a cost you never pay.

**Grading is three calls, not one.** `GRADER_SAMPLE_COUNT` is 3, and each is a full prompt
containing the rubric anchors and the transcript. A five-round loop is fifteen grading calls
plus five generation calls. The token estimate has to reflect that or the margin will be
optimistic by roughly a factor of three on the largest line item.
