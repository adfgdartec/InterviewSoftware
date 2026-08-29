import { describe, expect, it } from 'vitest';
import {
  bannedClaimPatterns,
  findClaimViolations,
  findMissingDisclosures,
  requiredDisclosures,
} from '../src/claims.js';
import { BRAND } from '../src/brand.js';

describe('claims policy (guardrail 3)', () => {
  it('loads its patterns from docs/claims-policy.md', () => {
    expect(bannedClaimPatterns().length).toBeGreaterThan(10);
    expect(requiredDisclosures().length).toBeGreaterThanOrEqual(3);
  });

  it.each([
    'Guaranteed offer at your dream company',
    'We guarantee you a job',
    '87% of our users get hired',
    'Improve your chance of getting hired',
    'See your hiring probability',
    'Real Google interview questions',
    'Leaked interview questions from Meta',
    'Built in partnership with Amazon',
    'Proven to increase callbacks',
  ])('rejects the string %j', (value) => {
    expect(findClaimViolations({ 'ui.test': value })).not.toHaveLength(0);
  });

  it.each([
    'Practice loops modeled on publicly reported interview formats',
    'Rubrics anchored to publicly documented evaluation attributes',
    'Structure: 3.4 ± 0.6 on a 1–5 anchored rubric',
    BRAND.affiliationDisclaimer,
    BRAND.aiDisclosure,
    BRAND.scoreDisclosure,
  ])('accepts the string %j', (value) => {
    expect(findClaimViolations({ 'ui.test': value })).toEqual([]);
  });

  it('reports every violation, not just the first', () => {
    const violations = findClaimViolations({
      'ui.hero': 'Guaranteed offer, backed by data',
      'ui.sub': '92% of our users get hired',
      'ui.ok': 'Anchored rubrics with stated reliability',
    });
    expect(violations.map((v) => v.stringKey).sort()).toEqual(['ui.hero', 'ui.sub']);
  });

  it('detects missing required disclosures', () => {
    expect(findMissingDisclosures({})).toEqual(requiredDisclosures().slice());
    const complete = Object.fromEntries(
      requiredDisclosures().map((d, i) => [`ui.disclosure.${i}`, d]),
    );
    expect(findMissingDisclosures(complete)).toEqual([]);
  });

  it('accepts an empty catalog without throwing on the banned scan', () => {
    expect(findClaimViolations({})).toEqual([]);
  });
});
