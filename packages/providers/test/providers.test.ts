import { describe, expect, it } from 'vitest';
import {
  ClientSecretAccessError,
  DEGRADE_AT,
  InMemoryModelRunSink,
  MissingCredentialError,
  REGISTRY,
  costMicros,
  decide,
  graderIsSeparateFromInterviewer,
  lookup,
  readCredential,
  redact,
} from '../src/index.js';

describe('model registry (spec §3.4)', () => {
  it('declares an entry for every purpose used by the request flow', () => {
    for (const purpose of ['question_generation', 'interviewer_turn', 'grading', 'asr', 'tts', 'debrief'] as const) {
      expect(() => lookup(purpose)).not.toThrow();
    }
  });

  it('throws on an unknown purpose rather than returning a default', () => {
    // @ts-expect-error deliberately out of contract
    expect(() => lookup('sentiment_analysis')).toThrow(/No registry entry/);
  });

  it('keeps the grader separate from the interviewer (spec §2.6)', () => {
    expect(graderIsSeparateFromInterviewer()).toBe(true);
  });

  it('gives every entry a finite timeout and a bounded retry count', () => {
    for (const r of REGISTRY) {
      for (const m of [r.primary, ...r.fallbacks]) {
        expect(m.timeoutMs).toBeGreaterThan(0);
        expect(m.timeoutMs).toBeLessThanOrEqual(180_000);
        expect(m.maxRetries).toBeGreaterThanOrEqual(0);
        expect(m.maxRetries).toBeLessThanOrEqual(3);
      }
    }
  });
});

describe('cost accounting', () => {
  const pricing = { inputPerMillionTokens: 3, outputPerMillionTokens: 15 };

  it('converts tokens to integer micros', () => {
    expect(costMicros(1_000_000, 0, pricing)).toBe(3_000_000);
    expect(costMicros(0, 1_000_000, pricing)).toBe(15_000_000);
    expect(costMicros(0, 0, pricing)).toBe(0);
  });

  it('rounds rather than truncating, so long sessions do not drift low', () => {
    expect(costMicros(1, 0, pricing)).toBe(3);
    expect(costMicros(1, 1, pricing)).toBe(18);
  });

  it('rejects negative token counts', () => {
    expect(() => costMicros(-1, 0, pricing)).toThrow(RangeError);
  });

  it('sums only the runs belonging to the session asked for', async () => {
    const sink = new InMemoryModelRunSink();
    const base = {
      orgId: 'org', purpose: 'grading', provider: 'anthropic', model: 'm',
      inputTokens: 0, outputTokens: 0, durationMs: 1, fellBack: false,
    } as const;
    await sink.record({ ...base, sessionId: 's1', costMicros: 100 });
    await sink.record({ ...base, sessionId: 's1', costMicros: 250 });
    await sink.record({ ...base, sessionId: 's2', costMicros: 999 });
    expect(sink.totalMicros('s1')).toBe(350);
    expect(sink.totalMicros('missing')).toBe(0);
  });
});

describe('cost ceiling degrades instead of failing (spec §3.4)', () => {
  const ceiling = 1_000_000;

  it('is normal below the degrade threshold', () => {
    const d = decide('grading', ceiling * (DEGRADE_AT - 0.1), ceiling);
    expect(d.posture).toBe('normal');
    expect(d.model).toBe(lookup('grading').primary.model);
    expect(d.contextScale).toBe(1);
  });

  it('drops to a cheaper grader at 80%', () => {
    const d = decide('grading', ceiling * 0.85, ceiling);
    expect(d.posture).toBe('degraded');
    expect(d.model).toBe(lookup('grading').primary.degradeTo);
    expect(d.contextScale).toBeLessThan(1);
    expect(d.reason).toMatch(/cost ceiling/);
  });

  it('never throws when the ceiling is exceeded — it still returns a usable call plan', () => {
    const d = decide('grading', ceiling * 3, ceiling);
    expect(d.posture).toBe('exhausted');
    expect(d.maxRetries).toBe(0);
    expect(d.model).toBeTruthy();
  });

  it('is continuous at the exact thresholds', () => {
    expect(decide('grading', ceiling * DEGRADE_AT, ceiling).posture).toBe('degraded');
    expect(decide('grading', ceiling, ceiling).posture).toBe('exhausted');
    expect(decide('grading', 0, ceiling).posture).toBe('normal');
  });

  it('rejects a nonsensical budget rather than guessing', () => {
    expect(() => decide('grading', -1, ceiling)).toThrow(RangeError);
    expect(() => decide('grading', 0, 0)).toThrow(RangeError);
  });
});

describe('credentials never reach the client (guardrail 6)', () => {
  it('throws when read from a browser-like runtime', () => {
    const g = globalThis as { window?: unknown };
    g.window = {};
    try {
      expect(() => readCredential('ANTHROPIC_API_KEY')).toThrow(ClientSecretAccessError);
    } finally {
      delete g.window;
    }
  });

  it('throws a named error when the variable is unset', () => {
    expect(() => readCredential('LOOPCRAFT_DEFINITELY_UNSET_KEY')).toThrow(MissingCredentialError);
  });

  it('returns the value on the server', () => {
    process.env['LOOPCRAFT_TEST_KEY'] = 'sk-test-value-1234567890';
    try {
      expect(readCredential('LOOPCRAFT_TEST_KEY')).toBe('sk-test-value-1234567890');
    } finally {
      delete process.env['LOOPCRAFT_TEST_KEY'];
    }
  });
});

describe('redaction removes, rather than masks, what the prototype leaked', () => {
  it.each([
    ['sk-abcdef1234567890', '[redacted]'],
    ['Authorization: Bearer eyJhbGciOi.JIUzI1NiJ9.abc', 'Bearer [redacted]'],
    ['ANTHROPIC_API_KEY=sk-fixture-9999999999', '[redacted]'],
  ])('redacts %j', (input, expected) => {
    expect(redact(input)).toContain(expected);
  });

  it('strips absolute file paths, which the audited prototype returned in debug fields', () => {
    const out = redact('failed reading /Users/someone/uploads/interview.webm');
    expect(out).not.toContain('/Users/someone');
    expect(out).toContain('[path]');
  });

  it('leaves ordinary prose untouched', () => {
    const prose = 'Grading failed after 2 retries.';
    expect(redact(prose)).toBe(prose);
  });

  it('does not preserve a key suffix (masking is not redaction)', () => {
    expect(redact('key sk-fixture-abcdefgh12345678')).not.toMatch(/5678/);
  });
});
