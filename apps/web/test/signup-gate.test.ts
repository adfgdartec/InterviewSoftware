import { describe, expect, it } from 'vitest';
import {
  AGE_BANDS,
  JURISDICTIONS,
  signupPermitted,
  signupRefusalReason,
  REFUSAL_MESSAGES,
} from '../src/server/signup-gate.js';

/**
 * Exhaustive: every age band against every jurisdiction, 20 combinations, with the expected
 * answer written out rather than computed by re-implementing the function under test.
 */
describe('signupPermitted, over the whole input space', () => {
  const PERMITTED = new Set([
    '16_plus|unknown',
    '16_plus|eu',
    '16_plus|illinois',
    '16_plus|us_other',
    '16_plus|other',
    '13_to_15|illinois',
    '13_to_15|us_other',
    '13_to_15|other',
  ]);

  for (const ageBand of AGE_BANDS) {
    for (const jurisdiction of JURISDICTIONS) {
      const key = `${ageBand}|${jurisdiction}`;
      const expected = PERMITTED.has(key);
      it(`${expected ? 'admits' : 'refuses'} ${key}`, () => {
        expect(signupPermitted({ ageBand, jurisdiction })).toBe(expected);
      });
    }
  }

  it('admits exactly eight of the twenty combinations', () => {
    const admitted = AGE_BANDS.flatMap((ageBand) =>
      JURISDICTIONS.filter((jurisdiction) => signupPermitted({ ageBand, jurisdiction })),
    );
    expect(admitted).toHaveLength(8);
  });
});

describe('fail-closed guarantees', () => {
  it('never admits an unknown age band, whatever the region', () => {
    for (const jurisdiction of JURISDICTIONS) {
      expect(signupPermitted({ ageBand: 'unknown', jurisdiction })).toBe(false);
    }
  });

  it('never admits under 13, whatever the region', () => {
    for (const jurisdiction of JURISDICTIONS) {
      expect(signupPermitted({ ageBand: 'under_13', jurisdiction })).toBe(false);
    }
  });

  it('refuses 13-15 with an unstated region rather than assuming it is not the EU', () => {
    // The whole point of the rule: absence of a stated region is not evidence of a
    // permitted one. If this ever flips to true, a 13-year-old in Berlin gets an account.
    expect(signupPermitted({ ageBand: '13_to_15', jurisdiction: 'unknown' })).toBe(false);
  });

  it('refuses an age band nobody has taught it about', () => {
    expect(signupPermitted({ ageBand: 'ageless', jurisdiction: 'us_other' })).toBe(false);
  });

  it('refuses a region nobody has taught it about, for the age band the region gates', () => {
    expect(signupPermitted({ ageBand: '13_to_15', jurisdiction: 'mars' })).toBe(false);
    // ...but a 16+ account does not depend on the region at all, so an unknown one is fine.
    expect(signupPermitted({ ageBand: '16_plus', jurisdiction: 'mars' })).toBe(true);
  });
});

describe('refusal reasons', () => {
  it('reports no reason when the signup is permitted', () => {
    expect(signupRefusalReason({ ageBand: '16_plus', jurisdiction: 'us_other' })).toBeNull();
  });

  it('distinguishes an unanswered age from a too-young one from the EU rule', () => {
    expect(signupRefusalReason({ ageBand: 'unknown', jurisdiction: 'us_other' })).toBe('age_required');
    expect(signupRefusalReason({ ageBand: 'under_13', jurisdiction: 'us_other' })).toBe('under_minimum_age');
    expect(signupRefusalReason({ ageBand: '13_to_15', jurisdiction: 'eu' })).toBe('eu_minimum_age');
  });

  it('has a message for every reason it can return', () => {
    for (const ageBand of AGE_BANDS) {
      for (const jurisdiction of JURISDICTIONS) {
        const reason = signupRefusalReason({ ageBand, jurisdiction });
        if (reason !== null) expect(REFUSAL_MESSAGES[reason]).toBeTruthy();
      }
    }
  });

  it('never tells a refused person an account was created', () => {
    for (const message of Object.values(REFUSAL_MESSAGES)) {
      expect(message).not.toMatch(/your account|we have created|signed up/i);
    }
  });
});
