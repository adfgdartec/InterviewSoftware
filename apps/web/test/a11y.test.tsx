import { describe, expect, it, vi } from 'vitest';

// PrepPage now renders a client component (StartLoopButton) that calls useRouter(). Static
// rendering here has no mounted Next app router to provide it -- the live app does (proven
// by an actual browser click-through of the start flow); this stub is only so the a11y
// audit can render the page shape at all.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, back: () => {}, refresh: () => {} }),
}));
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import axe from 'axe-core';
import type { ReactElement } from 'react';

import { findBannedTokensInText, findClaimViolations } from '@loopcraft/core';
import PrepPage from '../src/app/page.js';
import CalibrationPage from '../src/app/calibration/page.js';
import CompliancePage from '../src/app/compliance/page.js';
import SettingsPage from '../src/app/settings/page.js';
import SignInPage from '../src/app/signin/page.js';
import SignUpPage from '../src/app/signup/page.js';
import ResetPage from '../src/app/auth/reset/page.js';
import ResetConfirmPage from '../src/app/auth/reset/confirm/page.js';
import { Dashboard } from '../src/components/Dashboard.js';
import { AbilityReadout, ScoreWithInterval } from '../src/components/ScoreWithInterval.js';

/**
 * Phase 7 exit criterion: "axe zero critical" on every primary route (acceptance criterion
 * 11). Spec §5.6 targets WCAG 2.2 AA, which is also a hard procurement gate for the public
 * universities that are the best B2B channel.
 *
 * Pages are rendered to static markup and audited in jsdom. This covers the structural rules:
 * heading order, landmarks, form labels, link text, list semantics, language, ARIA validity.
 *
 * TWO LIMITS, stated because a green a11y suite invites over-reading:
 *  1. jsdom has no canvas, so axe cannot sample pixels and files colour-contrast as
 *     INCOMPLETE rather than pass or fail. An incomplete result is not a pass: contrast is
 *     unverified and must be checked in a real browser before launch.
 *  2. Static markup means nothing that only exists after hydration is audited -- focus
 *     management, live regions, and keyboard traps in interactive widgets are all out of
 *     scope until a browser-driven run exists.
 * `records the rules that could not run` below asserts these limits are real rather than
 * letting them be forgotten.
 */

const SKIP_LINK_STYLE = '.skip-link{position:absolute;left:-9999px}.skip-link:focus{left:0}';

/** Wraps a fragment in the document shell the real layout provides. */
function documentFor(node: ReactElement, withLayout = false): string {
  const inner = renderToStaticMarkup(node);
  if (withLayout) return `<!doctype html>${inner}`;
  return `<!doctype html><html lang="en"><head><title>Loopcraft</title><style>${SKIP_LINK_STYLE}</style></head><body><main>${inner}</main></body></html>`;
}

interface AuditOutcome {
  readonly violations: axe.Result[];
  readonly incomplete: axe.Result[];
  readonly inapplicable: axe.Result[];
}

async function auditFull(html: string): Promise<AuditOutcome> {
  const dom = new JSDOM(html, { pretendToBeVisual: true });
  const { window } = dom;
  // axe needs these globals present on the module's view of the world.
  const g = globalThis as unknown as Record<string, unknown>;
  const saved = { window: g['window'], document: g['document'], Node: g['Node'] };
  g['window'] = window;
  g['document'] = window.document;
  g['Node'] = window.Node;
  try {
    const results = await axe.run(window.document.documentElement, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
    });
    return {
      violations: results.violations,
      incomplete: results.incomplete,
      inapplicable: results.inapplicable,
    };
  } finally {
    g['window'] = saved.window;
    g['document'] = saved.document;
    g['Node'] = saved.Node;
    window.close();
  }
}

async function auditHtml(html: string): Promise<axe.Result[]> {
  return (await auditFull(html)).violations;
}

function critical(violations: readonly axe.Result[]): axe.Result[] {
  return violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
}

function describeViolations(violations: readonly axe.Result[]): string {
  return violations.map((v) => `${v.impact}: ${v.id} — ${v.help}`).join('\n');
}

/**
 * The auth pages are async Server Components that await `searchParams`. Rendering them to
 * static markup for the audit means resolving that promise up front; an empty object is the
 * default state of every one of them.
 */
const EMPTY_PARAMS = Promise.resolve({});

const SAMPLE_DASHBOARD = (
  <Dashboard
    abilities={[
      { dimension: 'Requirement scoping', theta: 0.42, standardError: 0.31, reportable: true, targetTheta: 1.0 },
      { dimension: 'Failure-mode reasoning', theta: 0, standardError: Number.POSITIVE_INFINITY, reportable: false, targetTheta: 1.0 },
    ]}
    recentScores={[
      {
        label: 'Capacity estimation',
        median: 3,
        intervalLow: 2.5,
        intervalHigh: 3.5,
        lowInformation: false,
        evidenceQuote: 'model state at that scale is on the order of terabytes',
      },
      {
        label: 'Trade-off articulation',
        median: 4,
        intervalLow: 2.5,
        intervalHigh: 5,
        lowInformation: true,
        evidenceQuote: 'checkpoint optimizer state incrementally rather than the full model state',
      },
    ]}
    focusDimension="Capacity estimation"
    dueForReview={['Failure-mode reasoning']}
  />
);

describe('primary routes have zero critical or serious axe violations', () => {
  // Thunks, not elements: the auth pages are async Server Components, and
  // renderToStaticMarkup cannot await one. Calling the function returns the promise its JSX
  // resolves from, which the test body awaits before rendering.
  it.each([
    ['prep', () => <PrepPage />],
    ['calibration', () => <CalibrationPage />],
    ['compliance', () => <CompliancePage />],
    ['settings', () => <SettingsPage />],
    ['dashboard', () => SAMPLE_DASHBOARD],
    ['sign in', () => SignInPage({ searchParams: EMPTY_PARAMS })],
    ['sign up', () => SignUpPage({ searchParams: EMPTY_PARAMS })],
    ['password reset', () => ResetPage({ searchParams: EMPTY_PARAMS })],
    ['password reset confirm', () => ResetConfirmPage()],
  ])('%s', async (_name, render) => {
    const element = await render();
    const violations = await auditHtml(documentFor(element));
    const blocking = critical(violations);
    expect(describeViolations(blocking)).toBe('');
    expect(blocking).toHaveLength(0);
  }, 30_000);

  it('records the rules that could not run, so the gate is not over-read', async () => {
    const outcome = await auditFull(documentFor(<CompliancePage />));
    const ran = [
      ...outcome.violations.map((r) => r.id),
      ...outcome.incomplete.map((r) => r.id),
      ...outcome.inapplicable.map((r) => r.id),
    ];
    // The audit does substantive work: dozens of WCAG rules are evaluated.
    expect(ran.length).toBeGreaterThan(20);
    // Colour contrast is attempted but cannot be DETERMINED: jsdom has no canvas, so axe
    // cannot sample pixels and files the rule as incomplete rather than pass or fail. An
    // incomplete result is not a pass, which is exactly why it is asserted here.
    expect(outcome.incomplete.map((r) => r.id)).toContain('color-contrast');
    expect(outcome.violations.map((r) => r.id)).not.toContain('color-contrast');
  }, 30_000);

  it('the empty dashboard is accessible too', async () => {
    const empty = (
      <Dashboard abilities={[]} recentScores={[]} focusDimension={null} dueForReview={[]} />
    );
    expect(critical(await auditHtml(documentFor(empty)))).toHaveLength(0);
  }, 30_000);
});

describe('score components (acceptance criterion 8)', () => {
  it('renders no score without an interval', () => {
    const html = renderToStaticMarkup(
      <ScoreWithInterval label="Scoping" median={3.4} intervalLow={2.8} intervalHigh={4.0} />,
    );
    expect(html).toContain('3.4 ± 0.6');
    expect(html).toContain('/calibration');
    // The number and the interval are inside one element, so no layout can separate them.
    // Attribute-agnostic on purpose: the guarantee is co-location in one span, not a specific
    // class name or the absence of styling attributes.
    expect(html).toMatch(/<span[^>]*>3\.4 ± 0\.6<\/span>/);
  });

  it('never renders a bare integer', () => {
    const html = renderToStaticMarkup(
      <ScoreWithInterval label="Scoping" median={4} intervalLow={4} intervalHigh={4} />,
    );
    expect(html).toContain('4.0 ± 0.0');
    expect(html).not.toMatch(/>4</);
  });

  it('flags a low-information score as weak evidence', () => {
    const html = renderToStaticMarkup(
      <ScoreWithInterval label="S" median={3} intervalLow={1} intervalHigh={5} lowInformation />,
    );
    expect(html).toMatch(/weak evidence/i);
    expect(html).toContain('role="note"');
  });

  it('quotes the evidence when there is any', () => {
    const html = renderToStaticMarkup(
      <ScoreWithInterval
        label="S" median={3} intervalLow={2} intervalHigh={4}
        evidenceQuote="I would shard the optimizer state first"
      />,
    );
    expect(html).toContain('I would shard the optimizer state first');
    // Attribute-agnostic for the same reason as the score-value assertion above.
    expect(html).toMatch(/<blockquote[^>]*>/);
  });

  it('omits the evidence block entirely rather than rendering an empty quote', () => {
    const html = renderToStaticMarkup(
      <ScoreWithInterval label="S" median={3} intervalLow={2} intervalHigh={4} evidenceQuote="" />,
    );
    expect(html).not.toContain('<blockquote>');
  });
});

describe('ability readout (phase 5 exit criterion)', () => {
  it('shows theta with its standard error', () => {
    const html = renderToStaticMarkup(
      <AbilityReadout dimension="Scoping" theta={0.42} standardError={0.31} reportable targetTheta={1} />,
    );
    expect(html).toContain('θ 0.42 ± 0.31');
    expect(html).toContain('below your target of 1.00');
  });

  it('says at or above target when the estimate clears it', () => {
    const html = renderToStaticMarkup(
      <AbilityReadout dimension="S" theta={1.5} standardError={0.2} reportable targetTheta={1} />,
    );
    expect(html).toContain('at or above');
  });

  it('refuses to draw a number when the estimate is not reportable', () => {
    const html = renderToStaticMarkup(
      <AbilityReadout
        dimension="S" theta={0} standardError={Number.POSITIVE_INFINITY}
        reportable={false} targetTheta={1}
      />,
    );
    expect(html).toMatch(/Not enough evidence yet/);
    expect(html).not.toContain('θ');
    expect(html).not.toContain('Infinity');
  });

  it('never implies a hiring outcome', () => {
    const html = renderToStaticMarkup(
      <AbilityReadout dimension="S" theta={1.5} standardError={0.2} reportable targetTheta={1} />,
    );
    expect(html).toMatch(/not a prediction of any hiring outcome/i);
  });
});


describe('the two pages exempt from the affect lint rule earn that exemption', () => {
  /**
   * compliance/page.tsx and calibration/page.tsx are excluded from no-affect-inference
   * because they exist to STATE the prohibition -- "Loopcraft never infers emotion" cannot
   * be written without the word. This test is what makes that exemption safe: every sentence
   * using the vocabulary must also carry a negation, so the pages can describe the rule but
   * never report an inference.
   */
  const NEGATIONS = [
    'never', 'not ', 'no ', 'without', 'prohibit', 'forbid', 'does not', 'do not',
    'cannot', 'nor ', 'outside',
  ];

  function textOf(element: ReactElement): string {
    return renderToStaticMarkup(element)
      .replace(/<[^>]+>/g, ' ')
      .replace(/&[a-z]+;/g, ' ')
      .replace(/\s+/g, ' ');
  }

  function sentencesOf(text: string): string[] {
    return text.split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter((x) => x.length > 0);
  }

  it.each([
    ['compliance', <CompliancePage key="c" />],
    ['calibration', <CalibrationPage key="k" />],
  ])('%s uses the vocabulary only in the negative', (_name, element) => {
    const offending = sentencesOf(textOf(element))
      .filter((sentence) => findBannedTokensInText(sentence).length > 0)
      .filter((sentence) => {
        const lower = sentence.toLowerCase();
        return !NEGATIONS.some((n) => lower.includes(n));
      });
    expect(offending).toEqual([]);
  });

  it.each([
    ['compliance', <CompliancePage key="c" />],
    ['calibration', <CalibrationPage key="k" />],
  ])('%s actually does state the prohibition, rather than staying silent', (_name, element) => {
    // The exemption would be pointless if the pages never used the words at all; this guards
    // against someone "fixing" the lint error by deleting the disclosure.
    expect(findBannedTokensInText(textOf(element)).length).toBeGreaterThan(0);
  });

  it.each([
    ['prep', <PrepPage key="p" />],
    ['compliance', <CompliancePage key="c" />],
    ['calibration', <CalibrationPage key="k" />],
    ['settings', <SettingsPage key="s" />],
    ['dashboard', SAMPLE_DASHBOARD],
  ])('%s makes no banned marketing claim', (name, element) => {
    expect(findClaimViolations({ [name]: textOf(element) })).toEqual([]);
  });
});
