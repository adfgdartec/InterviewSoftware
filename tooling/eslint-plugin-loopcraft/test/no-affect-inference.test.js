import { RuleTester } from 'eslint';
import tsParser from '@typescript-eslint/parser';
import { describe, it } from 'vitest';
import { noAffectInference } from '../src/no-affect-inference.js';

RuleTester.describe = describe;
RuleTester.it = it;

const ruleTester = new RuleTester({
  languageOptions: {
    parser: tsParser,
    ecmaVersion: 2023,
    sourceType: 'module',
  },
});

ruleTester.run('no-affect-inference', noAffectInference, {
  valid: [
    // Spec §2.7 measurements: observable, not inferred.
    'const metrics = { wordsPerMinute: 142, fillerRatio: 0.04, pauseP95Ms: 820 };',
    'interface Delivery { longestMonologueSeconds: number; hedgingDensity: number }',
    // Statistical confidence survives; psychological confidence does not.
    'const score = { value: 3.4, confidenceInterval: [2.8, 4.0] };',
    'const copy = "Structure: 3.4 ± 0.6 (95% confidence interval)";',
    'const copy = `Reported with a confidence band of ±0.6`;',
    // Unrelated words that merely contain a banned substring.
    'const x = { confidentialityNotice: true };',
  ],
  invalid: [
    {
      code: 'const r = { engagementScore: 0.8 };',
      errors: [{ messageId: 'bannedField', data: { name: 'engagementScore', token: 'engagement' } }],
    },
    {
      code: 'interface Result { candidateSentiment: number }',
      errors: [{ messageId: 'bannedField' }],
    },
    {
      code: 'class Grade { voiceConfidence = 0; }',
      errors: [{ messageId: 'bannedField' }],
    },
    {
      code: 'enum Dim { Enthusiasm = "enthusiasm" }',
      errors: [{ messageId: 'bannedField' }, { messageId: 'bannedString' }],
    },
    {
      code: 'const prompt = "Rate how confident the candidate sounded.";',
      errors: [{ messageId: 'bannedString', data: { token: 'confident' } }],
    },
    {
      code: 'const copy = `Your mood dipped in round 3`;',
      errors: [{ messageId: 'bannedString', data: { token: 'mood' } }],
    },
    {
      code: 'const r = { "facial-expression": 1 };',
      errors: [{ messageId: 'bannedField' }],
    },
  ],
});
