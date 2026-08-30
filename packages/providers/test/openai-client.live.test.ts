import { describe, expect, it } from 'vitest';
import { chat, openaiConfigured } from '../src/openai-client.js';

/**
 * The ONE test in this repo that actually calls OpenAI. Skipped, not failed, when no key is
 * present -- unlike the sandbox escape suite or the interviewer suite, requiring a real key
 * here would block every contributor who doesn't have one from ever running the suite. Run
 * it yourself once OPENAI_API_KEY is set:
 *
 *   OPENAI_API_KEY=sk-... pnpm --filter @loopcraft/providers exec vitest run test/openai-client.live.test.ts
 */
describe.skipIf(!openaiConfigured())('OpenAI, live', () => {
  it('actually calls the real API and gets a real completion', async () => {
    const result = await chat(
      { model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'Reply with exactly the word BANANA.' }], temperature: 0, timeoutMs: 15_000 },
      false,
    );
    expect(result.toUpperCase()).toContain('BANANA');
  }, 20_000);
});

if (!openaiConfigured()) {
  // Not a test failure -- a visible note in the run output so it is obvious this suite did
  // not exercise the real API, rather than silently reporting zero tests.
  console.log('[openai-client.live.test.ts] SKIPPED: OPENAI_API_KEY not set. Not verified against the real API.');
}
