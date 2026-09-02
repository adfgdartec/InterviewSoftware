import { afterEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import SettingsPage from '../src/app/settings/page.js';

/**
 * The video opt-in control is a consent control in a compliance-sensitive product, so the
 * gate that disables it gets a mounted regression test, not just a static markup audit.
 *
 * The a11y suite renders this page to static markup, which only ever reaches the
 * "Loading your settings…" branch -- the profile arrives from a `fetch` in an effect. This
 * suite mounts the page for real against a stubbed `/api/users/me` so the wiring is
 * exercised: that the fetched jurisdiction and age band reach `videoOptInBlock`, and that
 * its answer reaches the checkbox's `disabled` attribute and the help text.
 *
 * `videoOptInBlock` itself is exhaustively unit-tested in video-opt-in.test.ts; this file
 * covers the connection between it and the control, which is the part that was previously
 * wrong -- the page used to offer the checkbox anywhere both fields were merely set, so an
 * EU user could tick a box for a feature the server gate refuses outright.
 */

interface StubProfile {
  displayName: string | null;
  jurisdiction: string;
  ageBand: string;
  videoOptIn: boolean;
  videoEligible: boolean;
}

function profile(overrides: Partial<StubProfile> = {}): StubProfile {
  return {
    displayName: 'Candidate',
    jurisdiction: 'us_other',
    ageBand: '16_plus',
    videoOptIn: false,
    videoEligible: false,
    ...overrides,
  };
}

let root: Root | null = null;

afterEach(() => {
  if (root !== null) act(() => root!.unmount());
  root = null;
  vi.unstubAllGlobals();
});

/** Mounts the page with `/api/users/me` stubbed to return `p`, and returns the document. */
async function mountWith(p: StubProfile): Promise<Document> {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'https://loopcraft.test/settings',
  });
  const doc = dom.window.document;
  // React 19 reads these off the global scope during a client render.
  vi.stubGlobal('window', dom.window);
  vi.stubGlobal('document', doc);
  vi.stubGlobal('navigator', dom.window.navigator);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(p), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })),
  );

  const container = doc.getElementById('root')!;
  await act(async () => {
    root = createRoot(container);
    root.render(<SettingsPage />);
  });
  return doc;
}

function optIn(doc: Document): HTMLInputElement {
  const el = doc.getElementById('videoOptIn');
  expect(el, 'the video opt-in checkbox should be rendered').not.toBeNull();
  return el as HTMLInputElement;
}

function helpText(doc: Document): string {
  return doc.getElementById('videoOptIn')!.closest('div')!.parentElement!.textContent ?? '';
}

describe('the settings page offers the video opt-in exactly where the server gate permits it', () => {
  it('enables the checkbox for an eligible US state at 16+', async () => {
    const doc = await mountWith(profile());
    expect(optIn(doc).disabled).toBe(false);
  });

  it('enables it for jurisdiction "other" at 16+', async () => {
    const doc = await mountWith(profile({ jurisdiction: 'other' }));
    expect(optIn(doc).disabled).toBe(false);
  });

  it('disables it in the EU, where video is prohibited outright', async () => {
    const doc = await mountWith(profile({ jurisdiction: 'eu' }));
    expect(optIn(doc).disabled).toBe(true);
    expect(helpText(doc)).toContain('European Union');
  });

  it('disables it in Illinois', async () => {
    const doc = await mountWith(profile({ jurisdiction: 'illinois' }));
    expect(optIn(doc).disabled).toBe(true);
    expect(helpText(doc)).toContain('Illinois');
  });

  it('disables it below 16, and says so', async () => {
    const doc = await mountWith(profile({ ageBand: '13_to_15' }));
    expect(optIn(doc).disabled).toBe(true);
    expect(helpText(doc)).toContain('16 or older');
  });

  it('disables it while the region is unset, asking for the missing fields', async () => {
    const doc = await mountWith(profile({ jurisdiction: 'unknown' }));
    expect(optIn(doc).disabled).toBe(true);
    expect(helpText(doc)).toContain('set above');
  });

  it('disables it while the age band is unset', async () => {
    const doc = await mountWith(profile({ ageBand: 'unknown' }));
    expect(optIn(doc).disabled).toBe(true);
  });

  it('never renders a checked-and-enabled box for a prohibited region', async () => {
    // The defect this suite exists for: a stored opt-in from before a move to the EU must
    // not read as a live, editable "enabled" state.
    const doc = await mountWith(profile({ jurisdiction: 'eu', videoOptIn: true }));
    expect(optIn(doc).disabled).toBe(true);
  });
});
