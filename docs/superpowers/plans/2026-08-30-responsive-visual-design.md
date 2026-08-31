# InterviewSoftware First Visual Design Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `apps/web`'s 5 existing routes and 4 existing components their first real, responsive-first visual design (currently zero CSS anywhere), per the approved spec.

**Architecture:** Tailwind CSS v4 (CSS-first `@theme` config, no `tailwind.config.ts`) with a custom plum/gold palette, `next/font/google`'s Plus Jakarta Sans, and Tailwind's default spacing/breakpoint scale. Every existing page/component is restyled in place with Tailwind utility classes; no DOM structure, heading order, landmark, or `<details>` usage changes, so the existing axe a11y suite stays the regression gate throughout.

**Tech Stack:** Next.js 15.5.4 App Router, React 19.1.1, Tailwind CSS 4.3.3, `@tailwindcss/postcss` 4.3.3, `postcss` 8.5.26, `next/font/google`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-30-responsive-visual-design-design.md` (committed at `30145e3`).
- No dark mode in this pass (explicit spec non-goal).
- `apps/web/test/a11y.test.tsx` must stay green after every task that touches a file it imports (`PrepPage`, `CalibrationPage`, `CompliancePage`, `Dashboard`, `ScoreWithInterval`/`AbilityReadout`). It is the regression gate.
- No changes to heading order, ARIA landmarks, form labels, or the existing `<details>`/`<summary>` usage — style around the existing semantic structure, never restructure it.
- `ScoreWithInterval` keeps its existing structural guarantee: the reading and its `±` interval stay inside the *same* element (never split across a layout change that could let a bare number stand alone).
- Palette tokens (exact hex values), typography (Plus Jakarta Sans, the modular type scale), and Tailwind's default spacing/breakpoints are as specified in the design doc — copy them verbatim, do not invent new values.
- `prefers-reduced-motion` must be respected wherever motion is added (the voice-button recording pulse).
- Every `pnpm` command below is run from the repo root (`/Users/aditrajaram/Desktop/InterviewSoftware`) unless stated otherwise.

---

### Task 1: Install and configure Tailwind CSS v4

**Files:**
- Modify: `apps/web/package.json`
- Create: `apps/web/postcss.config.mjs`
- Create: `apps/web/src/app/globals.css`

**Interfaces:**
- Produces: the CSS custom properties `--color-plum-900`, `--color-plum-700`, `--color-plum-100`, `--color-gold-600`, `--color-gold-100`, `--color-neutral-900`, `--color-neutral-600`, `--color-neutral-200`, `--color-neutral-50`, `--color-success`, `--color-warning`, `--color-danger`, `--font-sans` (all consumed by every later task via Tailwind utilities like `text-plum-900`, `bg-gold-100`, `font-sans`, `text-danger`).

- [ ] **Step 1: Add the Tailwind dependencies to `apps/web/package.json`**

Edit the `devDependencies` block to add three entries (alphabetical, matching the file's existing style):

```json
  "devDependencies": {
    "@tailwindcss/postcss": "4.3.3",
    "@types/jsdom": "21.1.7",
    "@types/react": "19.1.13",
    "@types/react-dom": "19.1.9",
    "axe-core": "4.10.2",
    "jsdom": "25.0.1",
    "postcss": "8.5.26",
    "tailwindcss": "4.3.3",
    "typescript": "5.9.3",
    "vitest": "3.2.4"
  }
```

- [ ] **Step 2: Install**

Run: `pnpm install`
Expected: lockfile updates, no errors. Confirm with `pnpm --filter @loopcraft/web ls tailwindcss` — expect `tailwindcss 4.3.3`.

- [ ] **Step 3: Create the PostCSS config**

Create `apps/web/postcss.config.mjs`:

```js
export default {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};
```

- [ ] **Step 4: Create the theme + global stylesheet**

Create `apps/web/src/app/globals.css`:

```css
@import "tailwindcss";

@theme {
  --font-sans: var(--font-plus-jakarta), system-ui, -apple-system, sans-serif;

  --color-plum-900: #3b1236;
  --color-plum-700: #6b2c64;
  --color-plum-100: #f3e8f1;

  --color-gold-600: #c9a227;
  --color-gold-100: #fbf3d9;

  --color-neutral-900: #2a2229;
  --color-neutral-600: #6b6169;
  --color-neutral-200: #e8e1e6;
  --color-neutral-50: #faf7f9;

  --color-success: #2e7d4f;
  --color-warning: #b5790a;
  --color-danger: #b0392b;
}

body {
  font-family: var(--font-sans);
}

h1,
h2,
h3 {
  text-wrap: balance;
}

/*
 * The skip-link test stub in apps/web/test/a11y.test.tsx injects its own equivalent style
 * (SKIP_LINK_STYLE) because that suite never imports layout.tsx or this stylesheet -- the two
 * are intentionally decoupled, so this rule only has to be correct for the real browser.
 */
.skip-link {
  position: absolute;
  left: -9999px;
}
.skip-link:focus {
  left: 0.5rem;
  top: 0.5rem;
  z-index: 50;
  border-radius: 0.375rem;
  background: var(--color-plum-900);
  padding: 0.5rem 1rem;
  color: white;
}
```

- [ ] **Step 5: Verify the workspace still builds**

Run: `pnpm --filter @loopcraft/web run typecheck`
Expected: passes (this step adds no `.tsx` changes yet, so this just confirms the new config files didn't break anything).

- [ ] **Step 6: Commit**

```bash
git add apps/web/package.json pnpm-lock.yaml apps/web/postcss.config.mjs apps/web/src/app/globals.css
git commit -m "feat(web): install and configure Tailwind CSS v4 with the plum/gold theme"
```

---

### Task 2: Mobile nav toggle + layout restyle

**Files:**
- Create: `apps/web/src/components/MobileNavToggle.tsx`
- Modify: `apps/web/src/app/layout.tsx`

**Interfaces:**
- Consumes: `--font-sans` and the color tokens from Task 1's `globals.css`.
- Produces: `MobileNavToggle` (a client component taking `children: ReactNode`, rendering a `md:hidden` toggle button plus its children in a `div` whose visibility class is `open ? 'block' : 'hidden md:block'`) — self-contained, consumed only by `layout.tsx` in this task.

- [ ] **Step 1: Create the toggle component**

Create `apps/web/src/components/MobileNavToggle.tsx`:

```tsx
'use client';

import { useState, type ReactElement, type ReactNode } from 'react';

export interface MobileNavToggleProps {
  readonly children: ReactNode;
}

/**
 * Wraps the primary nav list so it collapses to a hamburger toggle below the `md` breakpoint
 * and stays permanently visible above it. The nav landmark and its <ul> stay exactly where
 * they were in the DOM -- this only adds a toggle button and a class that shows/hides them,
 * so the a11y suite's landmark/heading assertions are unaffected.
 */
export function MobileNavToggle({ children }: MobileNavToggleProps): ReactElement {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className="inline-flex items-center justify-center rounded-md p-2 text-plum-900 hover:bg-plum-100 md:hidden"
        aria-expanded={open}
        aria-controls="primary-nav-list"
        onClick={() => setOpen((current) => !current)}
      >
        <span className="sr-only">{open ? 'Close menu' : 'Open menu'}</span>
        <svg
          viewBox="0 0 24 24"
          width="24"
          height="24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden="true"
        >
          {open ? (
            <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
          ) : (
            <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
          )}
        </svg>
      </button>
      <div id="primary-nav-list" className={open ? 'block' : 'hidden md:block'}>
        {children}
      </div>
    </>
  );
}
```

- [ ] **Step 2: Restyle the root layout**

Replace the full contents of `apps/web/src/app/layout.tsx`:

```tsx
import type { ReactElement, ReactNode } from 'react';
import { Plus_Jakarta_Sans } from 'next/font/google';
import { BRAND } from '@loopcraft/core';
import { MobileNavToggle } from '../components/MobileNavToggle.js';
import './globals.css';

/**
 * Root layout. Spec §5.6 requires WCAG 2.2 AA and full keyboard operation; spec §5.1 requires
 * the EU AI Act Article 50 disclosure that the user is interacting with an AI system, which
 * remains effective and was not deferred by the Digital Omnibus.
 */
export const metadata = {
  title: BRAND.name,
  description: BRAND.tagline,
};

const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-plus-jakarta',
  display: 'swap',
});

const NAV_LINKS = [
  { href: '/', label: 'Prepare' },
  { href: '/dashboard', label: 'Progress' },
  { href: '/calibration', label: 'How scoring works' },
  { href: '/compliance', label: 'Compliance' },
] as const;

export default function RootLayout({ children }: { children: ReactNode }): ReactElement {
  return (
    <html lang="en" className={plusJakartaSans.variable}>
      <body className="min-h-screen bg-neutral-50 font-sans text-neutral-900 antialiased">
        <a className="skip-link" href="#main">
          Skip to main content
        </a>

        <header className="border-b border-neutral-200 bg-white">
          <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4 sm:px-6">
            <a href="/" className="text-lg font-bold text-plum-900">
              {BRAND.name}
            </a>
            <nav aria-label="Primary">
              <MobileNavToggle>
                <ul className="flex flex-col gap-1 border-t border-neutral-200 px-4 py-2 md:flex-row md:gap-6 md:border-0 md:p-0">
                  {NAV_LINKS.map((link) => (
                    <li key={link.href}>
                      <a
                        href={link.href}
                        className="block rounded-md px-2 py-2 text-sm font-medium text-neutral-600 hover:bg-plum-100 hover:text-plum-900 md:px-1 md:py-1"
                      >
                        {link.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </MobileNavToggle>
            </nav>
          </div>
          {/* Article 50: disclose that this is an AI system, prominently, not in a footnote. */}
          <p className="ai-disclosure bg-plum-900 px-4 py-2 text-center text-xs font-medium text-white sm:px-6">
            {BRAND.aiDisclosure}
          </p>
        </header>

        <main id="main" className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
          {children}
        </main>

        <footer className="border-t border-neutral-200 bg-white px-4 py-8 text-center text-sm text-neutral-600 sm:px-6">
          <p className="mx-auto max-w-[70ch]">{BRAND.scoreDisclosure}</p>
          <p className="mx-auto mt-2 max-w-[70ch]">{BRAND.affiliationDisclaimer}</p>
        </footer>
      </body>
    </html>
  );
}
```

- [ ] **Step 3: Verify**

Run: `pnpm --filter @loopcraft/web run typecheck && pnpm --filter @loopcraft/web run test:a11y`
Expected: both pass. (`layout.tsx` is not imported by the a11y suite, so this mainly confirms Task 1/2's files compile together and nothing else regressed.)

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/MobileNavToggle.tsx apps/web/src/app/layout.tsx
git commit -m "feat(web): responsive header nav with mobile hamburger toggle"
```

---

### Task 3: Shared score-card styling (`ScoreWithInterval` / `AbilityReadout`)

**Files:**
- Modify: `apps/web/src/components/ScoreWithInterval.tsx`

**Interfaces:**
- Consumes: color tokens from Task 1.
- Produces: no signature change — `ScoreWithIntervalProps`, `AbilityReadoutProps`, and both exported function names/shapes are unchanged, only their JSX/className bodies change. Later tasks (`Dashboard.tsx`, `session/[id]/page.tsx`) consume these two components exactly as before.

- [ ] **Step 1: Replace the file contents**

Replace the full contents of `apps/web/src/components/ScoreWithInterval.tsx`:

```tsx
import type { ReactElement } from 'react';

/**
 * The only component that renders a score. Acceptance criterion 8: "Every score shown to a
 * user carries an uncertainty interval and a link to the method."
 *
 * There is deliberately no prop for rendering a bare number and no variant that hides the
 * interval, so a future page cannot show a false-precision integer by passing a flag. The
 * interval and the calibration link are structural, not decoration.
 */

export interface ScoreWithIntervalProps {
  readonly label: string;
  readonly median: number;
  readonly intervalLow: number;
  readonly intervalHigh: number;
  /** True when the grader's samples disagreed enough that the score is weak evidence. */
  readonly lowInformation?: boolean;
  readonly evidenceQuote?: string;
}

const CALIBRATION_HREF = '/calibration';
const LINK_CLASS = 'font-medium text-plum-700 underline hover:text-plum-900';

function halfWidth(median: number, low: number, high: number): number {
  return Math.round(Math.max(median - low, high - median) * 10) / 10;
}

export function ScoreWithInterval(props: ScoreWithIntervalProps): ReactElement {
  const { label, median, intervalLow, intervalHigh, lowInformation, evidenceQuote } = props;
  const spread = halfWidth(median, intervalLow, intervalHigh);
  const reading = `${median.toFixed(1)} ± ${spread.toFixed(1)}`;

  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
      <div>
        <h3 className="text-sm font-semibold text-plum-900">{label}</h3>
        <p className="mt-1">
          {/* The interval is inside the same element as the number, so no layout change can
              separate them and leave the number standing alone. */}
          <span className="text-2xl font-bold text-plum-900">{reading}</span>
          <span className="ml-1 text-sm text-neutral-600"> on a 1–5 anchored rubric</span>
        </p>
      </div>

      <p className="mt-2 text-sm text-neutral-600">
        Median of three independent grader samples, shown with the observed spread.{' '}
        <a href={CALIBRATION_HREF} className={LINK_CLASS}>
          How this score is produced and how reliable it is
        </a>
        .
      </p>

      {lowInformation === true ? (
        <p
          role="note"
          className="mt-3 rounded-md border border-warning bg-gold-100 px-3 py-2 text-sm text-warning"
        >
          The three samples disagreed. Treat this as weak evidence rather than a measurement.
        </p>
      ) : null}

      {evidenceQuote === undefined || evidenceQuote === '' ? null : (
        <figure className="mt-3 border-l-4 border-gold-600 pl-3">
          <blockquote className="text-sm italic text-neutral-900">{evidenceQuote}</blockquote>
          <figcaption className="mt-1 text-xs text-neutral-600">Quoted from your answer</figcaption>
        </figure>
      )}
    </div>
  );
}

/**
 * Ability estimate on the IRT scale. Phase 5 exit criterion: "θ and SE surfaced with
 * uncertainty in UI." An unreportable estimate renders as a statement that there is not
 * enough evidence -- never as a number with a very wide interval, which reads as a
 * measurement to anyone skimming.
 */
export interface AbilityReadoutProps {
  readonly dimension: string;
  readonly theta: number;
  readonly standardError: number;
  readonly reportable: boolean;
  readonly targetTheta: number;
}

export function AbilityReadout(props: AbilityReadoutProps): ReactElement {
  const { dimension, theta, standardError, reportable, targetTheta } = props;

  if (!reportable) {
    return (
      <div className="rounded-lg border border-dashed border-neutral-200 bg-neutral-50 p-4">
        <h3 className="text-sm font-semibold text-plum-900">{dimension}</h3>
        <p className="mt-1 text-sm text-neutral-600">Not enough evidence yet to estimate this.</p>
        <p className="mt-2 text-xs text-neutral-600">
          Practise this dimension a few more times and an estimate will appear here.
        </p>
      </div>
    );
  }

  const gap = theta - targetTheta;
  const direction = gap >= 0 ? 'at or above' : 'below';

  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
      <h3 className="text-sm font-semibold text-plum-900">{dimension}</h3>
      <p className="mt-1">
        <span className="text-2xl font-bold text-plum-900">
          θ {theta.toFixed(2)} ± {standardError.toFixed(2)}
        </span>
        <span className="ml-1 text-sm text-neutral-600">
          {' '}
          — {direction} your target of {targetTheta.toFixed(2)}
        </span>
      </p>
      <p className="mt-2 text-sm text-neutral-600">
        An ability estimate with its standard error.{' '}
        <a href={CALIBRATION_HREF} className={LINK_CLASS}>
          What this means
        </a>
        . It is not a prediction of any hiring outcome.
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Verify**

Run: `pnpm --filter @loopcraft/web run typecheck && pnpm --filter @loopcraft/web run test:a11y`
Expected: both pass — the a11y suite directly imports `ScoreWithInterval`/`AbilityReadout` and must show 0 critical/serious violations, same as before this change.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/ScoreWithInterval.tsx
git commit -m "feat(web): style ScoreWithInterval/AbilityReadout as a shared score card"
```

---

### Task 4: `StartLoopButton` styling

**Files:**
- Modify: `apps/web/src/components/StartLoopButton.tsx`

**Interfaces:**
- Consumes: color tokens from Task 1.
- Produces: no signature change — `StartLoopButtonProps` and the export name are unchanged.

- [ ] **Step 1: Replace the file contents**

Replace the full contents of `apps/web/src/components/StartLoopButton.tsx`:

```tsx
'use client';

import { useState, type ReactElement } from 'react';
import { useRouter } from 'next/navigation';

export interface StartLoopButtonProps {
  readonly loopTemplateId: string;
  readonly levelBand: string;
}

/**
 * The one interactive control the prep page was missing. Posts to the real
 * /api/sessions route and navigates to the session it creates -- this is what makes the
 * catalog page a product entry point instead of a read-only brochure.
 */
export function StartLoopButton({ loopTemplateId, levelBand }: StartLoopButtonProps): ReactElement {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start(): Promise<void> {
    setPending(true);
    setError(null);
    try {
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
        body: JSON.stringify({ loopTemplateId, levelBand }),
      });
      const body = (await res.json()) as { sessionId?: string; error?: string };
      if (!res.ok || body.sessionId === undefined) {
        setError(body.error ?? `Could not start this loop (HTTP ${res.status}).`);
        setPending(false);
        return;
      }
      router.push(`/session/${body.sessionId}`);
    } catch {
      setError('Could not reach the server. Is it running?');
      setPending(false);
    }
  }

  return (
    <div className="mt-4">
      <button
        type="button"
        onClick={() => void start()}
        disabled={pending}
        className="w-full rounded-md bg-plum-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-plum-900 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
      >
        {pending ? 'Starting…' : 'Start this loop'}
      </button>
      {error !== null ? (
        <p role="alert" className="mt-2 text-sm font-medium text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: Verify**

Run: `pnpm --filter @loopcraft/web run typecheck && pnpm --filter @loopcraft/web run test:a11y`
Expected: both pass (`StartLoopButton` renders inside `PrepPage`, which the a11y suite audits).

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/StartLoopButton.tsx
git commit -m "feat(web): style StartLoopButton"
```

---

### Task 5: `VoiceAnswerButton` styling

**Files:**
- Modify: `apps/web/src/components/VoiceAnswerButton.tsx`

**Interfaces:**
- Consumes: color tokens from Task 1.
- Produces: no signature change — `VoiceAnswerButtonProps` and the export name are unchanged. Consumed by Task 8 (`session/[id]/page.tsx`) exactly as before.

- [ ] **Step 1: Replace the file contents**

Replace the full contents of `apps/web/src/components/VoiceAnswerButton.tsx`:

```tsx
'use client';

import { useRef, useState, type ReactElement } from 'react';

export interface VoiceAnswerButtonProps {
  readonly onTranscribed: (transcript: string) => void;
  readonly disabled?: boolean;
}

/**
 * Real microphone capture via MediaRecorder, uploaded to /api/sessions/:id/audio for real
 * Deepgram transcription. UNTESTED against a live Deepgram key -- this component has never
 * been clicked with STT actually configured, because no key exists in this environment. It
 * is real code, not a stub: MediaRecorder genuinely records, the upload genuinely POSTs raw
 * audio bytes, and a 503 from the route (STT unconfigured) is shown to the user honestly
 * rather than silently doing nothing.
 */
export function VoiceAnswerButton({ onTranscribed, disabled }: VoiceAnswerButtonProps): ReactElement {
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  async function startRecording(): Promise<void> {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        void uploadRecording();
      };
      recorderRef.current = recorder;
      recorder.start();
      setRecording(true);
    } catch {
      setError('Could not access the microphone. Check your browser permissions.');
    }
  }

  function stopRecording(): void {
    recorderRef.current?.stop();
    setRecording(false);
  }

  async function uploadRecording(): Promise<void> {
    setTranscribing(true);
    try {
      const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
      const sessionId = window.location.pathname.split('/').pop() ?? '';
      const res = await fetch(`/api/sessions/${sessionId}/audio`, {
        method: 'POST',
        headers: { 'content-type': 'audio/webm' },
        body: blob,
      });
      const body = (await res.json()) as { transcript?: string; error?: string };
      if (!res.ok || body.transcript === undefined) {
        setError(body.error ?? 'Transcription is not available right now.');
        return;
      }
      onTranscribed(body.transcript);
    } catch {
      setError('Could not reach the transcription service.');
    } finally {
      setTranscribing(false);
    }
  }

  const idleClass =
    'inline-flex items-center gap-2 rounded-md border border-plum-700 px-4 py-2 text-sm font-semibold text-plum-700 transition hover:bg-plum-100 disabled:cursor-not-allowed disabled:opacity-60';
  const recordingClass =
    'inline-flex animate-pulse items-center gap-2 rounded-md bg-plum-700 px-4 py-2 text-sm font-semibold text-white motion-reduce:animate-none';

  return (
    <div>
      <button
        type="button"
        onClick={() => (recording ? stopRecording() : void startRecording())}
        disabled={disabled === true || transcribing}
        className={recording ? recordingClass : idleClass}
      >
        {transcribing ? 'Transcribing…' : recording ? 'Stop recording' : 'Answer by voice'}
      </button>
      {error !== null ? (
        <p role="alert" className="mt-2 text-sm font-medium text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: Verify**

Run: `pnpm --filter @loopcraft/web run typecheck`
Expected: passes. (`VoiceAnswerButton` is not imported by the static-markup a11y suite — it is only reachable through `session/[id]/page.tsx`, a client-rendered dynamic route — so this task's real verification is Task 11's Playwright pass.)

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/VoiceAnswerButton.tsx
git commit -m "feat(web): style VoiceAnswerButton with recording/transcribing states"
```

---

### Task 6: Prep page (`/`) styling

**Files:**
- Modify: `apps/web/src/app/page.tsx`

**Interfaces:**
- Consumes: `StartLoopButton` (Task 4), color tokens (Task 1), `LOOP_TEMPLATES`/`TRACKS`/`trackById` from `@loopcraft/core` (unchanged imports).
- Produces: no signature change — default export `PrepPage` unchanged, consumed by `apps/web/test/a11y.test.tsx`.

- [ ] **Step 1: Replace the file contents**

Replace the full contents of `apps/web/src/app/page.tsx`:

```tsx
import type { ReactElement } from 'react';
import { LOOP_TEMPLATES, TRACKS, trackById } from '@loopcraft/core';
import { StartLoopButton } from '../components/StartLoopButton.js';

/**
 * Prep surface. Templates are labelled as modelled on publicly reported formats, and the
 * source pages they were modelled on are linked -- spec §5.3 permits naming a company
 * descriptively but forbids implying affiliation, so the disclaimer travels with the name.
 */
export default function PrepPage(): ReactElement {
  return (
    <>
      <h1 className="text-3xl font-bold text-plum-900">Choose a loop to rehearse</h1>
      <p className="mt-2 max-w-[65ch] text-neutral-600">
        Each loop is modelled on a publicly reported interview format. Rounds are graded
        against published, anchored rubrics.
      </p>

      <section aria-labelledby="templates-heading" className="mt-8">
        <h2 id="templates-heading" className="text-xl font-semibold text-plum-900">
          Loop formats
        </h2>
        <ul className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {LOOP_TEMPLATES.map((template) => {
            const track = trackById(template.trackId);
            return (
              <li
                key={template.id}
                className="flex flex-col rounded-lg border border-neutral-200 bg-white p-5 shadow-sm"
              >
                <h3 className="text-lg font-semibold text-plum-900">{template.name}</h3>
                <p className="mt-1 text-xs font-medium uppercase tracking-wide text-neutral-600">
                  {track?.name ?? template.trackId} · level {template.levelBand} ·{' '}
                  {template.rounds.length} rounds ·{' '}
                  {template.rounds.reduce((sum, r) => sum + r.minutes, 0)} minutes
                </p>
                <p className="mt-3 text-sm text-neutral-900">{template.modeledOnNote}</p>
                <details className="mt-3 text-sm text-neutral-600">
                  <summary className="cursor-pointer font-medium text-plum-700">
                    What the rounds are
                  </summary>
                  <ol className="mt-2 list-decimal space-y-1 pl-5">
                    {template.rounds.map((round) => (
                      <li key={round.position}>
                        <strong className="text-neutral-900">{round.roundType}</strong> —{' '}
                        {round.persona}, {round.minutes} min
                      </li>
                    ))}
                  </ol>
                </details>
                <StartLoopButton loopTemplateId={template.id} levelBand={template.levelBand} />
                <p className="mt-4 text-xs text-neutral-600">
                  Modelled on:{' '}
                  {template.sourceUrls.map((url, index) => (
                    <span key={url}>
                      {index > 0 ? ', ' : ''}
                      <a
                        href={url}
                        rel="noreferrer noopener nofollow"
                        className="underline hover:text-plum-700"
                      >
                        {new URL(url).hostname}
                      </a>
                    </span>
                  ))}
                </p>
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby="tracks-heading" className="mt-10">
        <h2 id="tracks-heading" className="text-xl font-semibold text-plum-900">
          Tracks
        </h2>
        <ul className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[...TRACKS]
            .sort((a, b) => a.shipOrder - b.shipOrder)
            .map((track) => (
              <li
                key={track.id}
                className="rounded-lg border border-neutral-200 bg-white p-5 shadow-sm"
              >
                <h3 className="text-lg font-semibold text-plum-900">{track.name}</h3>
                <p className="mt-1 text-sm text-neutral-600">{track.covers}</p>
              </li>
            ))}
        </ul>
      </section>
    </>
  );
}
```

- [ ] **Step 2: Verify**

Run: `pnpm --filter @loopcraft/web run typecheck && pnpm --filter @loopcraft/web run test:a11y`
Expected: both pass.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/page.tsx
git commit -m "feat(web): responsive card grid for the prep page"
```

---

### Task 7: `Dashboard` component styling

**Files:**
- Modify: `apps/web/src/components/Dashboard.tsx`

**Interfaces:**
- Consumes: `AbilityReadout`/`ScoreWithInterval` (Task 3), color tokens (Task 1).
- Produces: no signature change — `DashboardProps`, `DashboardDimension`, `DashboardRoundScore`, and the `Dashboard` export are unchanged. Consumed by `apps/web/test/a11y.test.tsx` and `apps/web/src/app/dashboard/page.tsx` exactly as before.

- [ ] **Step 1: Replace the file contents**

Replace the full contents of `apps/web/src/components/Dashboard.tsx`:

```tsx
import type { ReactElement } from 'react';
import { AbilityReadout, ScoreWithInterval } from './ScoreWithInterval.js';

/**
 * The longitudinal dashboard. Phase 5 exit criterion: theta and its standard error surfaced
 * with uncertainty. Spec §2.9: readiness is an ability estimate against a target level with a
 * stated standard error, never a probability of getting an offer.
 */

export interface DashboardDimension {
  readonly dimension: string;
  readonly theta: number;
  readonly standardError: number;
  readonly reportable: boolean;
  readonly targetTheta: number;
}

export interface DashboardRoundScore {
  readonly label: string;
  readonly median: number;
  readonly intervalLow: number;
  readonly intervalHigh: number;
  readonly lowInformation: boolean;
  readonly evidenceQuote: string;
}

export interface DashboardProps {
  readonly abilities: readonly DashboardDimension[];
  readonly recentScores: readonly DashboardRoundScore[];
  readonly focusDimension: string | null;
  readonly dueForReview: readonly string[];
}

export function Dashboard(props: DashboardProps): ReactElement {
  const { abilities, recentScores, focusDimension, dueForReview } = props;
  const measured = abilities.filter((a) => a.reportable);

  return (
    <>
      <h1 className="text-3xl font-bold text-plum-900">Your progress</h1>

      <section
        aria-labelledby="focus-heading"
        className="mt-6 rounded-lg border border-gold-600 bg-gold-100 p-5"
      >
        <h2 id="focus-heading" className="text-lg font-semibold text-plum-900">
          What to practise next
        </h2>
        {focusDimension === null ? (
          <p className="mt-2 text-sm text-neutral-900">
            Not enough evidence yet to recommend a focus. Complete a few more rounds and a
            recommendation will appear here.
          </p>
        ) : (
          <p className="mt-2 text-sm text-neutral-900">
            Your weakest well-measured dimension is <strong>{focusDimension}</strong>. That is
            where practice buys the most right now.
          </p>
        )}
      </section>

      <section aria-labelledby="ability-heading" className="mt-8">
        <h2 id="ability-heading" className="text-xl font-semibold text-plum-900">
          Ability estimates
        </h2>
        <p className="mt-1 max-w-[65ch] text-sm text-neutral-600">
          Each estimate is shown with its standard error. A wide interval means we do not know
          yet, not that you are inconsistent.
        </p>
        {abilities.length === 0 ? (
          <p className="mt-4 text-sm text-neutral-600">No dimensions measured yet.</p>
        ) : (
          <ul className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {abilities.map((a) => (
              <li key={a.dimension}>
                <AbilityReadout
                  dimension={a.dimension}
                  theta={a.theta}
                  standardError={a.standardError}
                  reportable={a.reportable}
                  targetTheta={a.targetTheta}
                />
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-neutral-600">
          {measured.length} of {abilities.length} dimensions have enough evidence to report.
        </p>
      </section>

      <section aria-labelledby="recent-heading" className="mt-8">
        <h2 id="recent-heading" className="text-xl font-semibold text-plum-900">
          Most recent round
        </h2>
        {recentScores.length === 0 ? (
          <p className="mt-4 text-sm text-neutral-600">No graded rounds yet.</p>
        ) : (
          <ul className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {recentScores.map((s) => (
              <li key={s.label}>
                <ScoreWithInterval
                  label={s.label}
                  median={s.median}
                  intervalLow={s.intervalLow}
                  intervalHigh={s.intervalHigh}
                  lowInformation={s.lowInformation}
                  evidenceQuote={s.evidenceQuote}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="review-heading" className="mt-8">
        <h2 id="review-heading" className="text-xl font-semibold text-plum-900">
          Due for review
        </h2>
        {dueForReview.length === 0 ? (
          <p className="mt-4 text-sm text-neutral-600">Nothing is due right now.</p>
        ) : (
          <ul className="mt-4 flex flex-wrap gap-2">
            {dueForReview.map((d) => (
              <li
                key={d}
                className="rounded-full bg-plum-100 px-3 py-1 text-sm font-medium text-plum-900"
              >
                {d}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
```

- [ ] **Step 2: Verify**

Run: `pnpm --filter @loopcraft/web run typecheck && pnpm --filter @loopcraft/web run test:a11y`
Expected: both pass.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/Dashboard.tsx
git commit -m "feat(web): responsive stat-card grid for the dashboard"
```

---

### Task 8: Session page (`/session/[id]`) styling

**Files:**
- Modify: `apps/web/src/app/session/[id]/page.tsx`

**Interfaces:**
- Consumes: `ScoreWithInterval` (Task 3), `VoiceAnswerButton` (Task 5), color tokens (Task 1).
- Produces: no signature change — default export `SessionPage` and all internal types (`SessionView`, `DebriefAttribute`, `DebriefPacket`) are unchanged.

- [ ] **Step 1: Replace the file contents**

Replace the full contents of `apps/web/src/app/session/[id]/page.tsx`:

```tsx
'use client';

import { use, useEffect, useState, type ReactElement } from 'react';
import { ScoreWithInterval } from '../../../components/ScoreWithInterval.js';
import { VoiceAnswerButton } from '../../../components/VoiceAnswerButton.js';

interface SessionView {
  readonly sessionId: string;
  readonly status: 'in_progress' | 'completed' | 'abandoned' | 'expired';
  readonly trackId: string;
  readonly levelBand: string;
  readonly roundCount: number;
  readonly currentRoundPosition: number;
  readonly currentRoundType: string | null;
  readonly persona: string | null;
  readonly question: string | null;
  readonly pendingTurnId: string | null;
  readonly answeredTurnCount: number;
}

interface DebriefAttribute {
  readonly dimension: string;
  readonly name: string;
  readonly score: { median: number; intervalLow: number; intervalHigh: number };
  readonly display: string;
  readonly quote: string;
  readonly lowInformation: boolean;
}

interface DebriefPacket {
  readonly overallDisplay: string;
  readonly overall: { median: number; intervalLow: number; intervalHigh: number };
  readonly attributes: readonly DebriefAttribute[];
  readonly gaps: readonly string[];
  readonly practiceFocus: readonly DebriefAttribute[];
  readonly methodNote: string;
  readonly calibrationLink: string;
}

async function readJson<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

const PRIMARY_BUTTON_CLASS =
  'rounded-md bg-plum-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-plum-900 disabled:cursor-not-allowed disabled:opacity-60';

/**
 * The actual loop-taking UI: shows the current question, takes an answer, submits it to the
 * real /turns route, and repeats until the loop is complete -- then fetches and renders the
 * real, graded debrief. This is the page the prep page's Start button had nowhere to send
 * anyone to before this change.
 */
export default function SessionPage({ params }: { params: Promise<{ id: string }> }): ReactElement {
  const { id } = use(params);
  const [view, setView] = useState<SessionView | null>(null);
  const [answer, setAnswer] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [debrief, setDebrief] = useState<DebriefPacket | null>(null);
  const [gradingError, setGradingError] = useState<string | null>(null);
  const [grading, setGrading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      const res = await fetch(`/api/sessions/${id}`);
      if (cancelled) return;
      if (!res.ok) {
        const body = await readJson<{ error?: string }>(res);
        setError(body.error ?? `Could not load this session (HTTP ${res.status}).`);
        return;
      }
      setView(await readJson<SessionView>(res));
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [id]);

  async function submitAnswer(): Promise<void> {
    if (view === null || view.pendingTurnId === null || answer.trim() === '') return;
    setSubmitting(true);
    setError(null);
    const res = await fetch(`/api/sessions/${id}/turns`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
      body: JSON.stringify({ turnId: view.pendingTurnId, transcript: answer.trim() }),
    });
    if (!res.ok) {
      const body = await readJson<{ error?: string }>(res);
      setError(body.error ?? `Could not submit that answer (HTTP ${res.status}).`);
      setSubmitting(false);
      return;
    }
    setView(await readJson<SessionView>(res));
    setAnswer('');
    setSubmitting(false);
  }

  async function fetchDebrief(): Promise<void> {
    setGrading(true);
    setGradingError(null);
    const res = await fetch(`/api/sessions/${id}/debrief`, {
      method: 'POST',
      headers: { 'idempotency-key': crypto.randomUUID() },
    });
    if (!res.ok) {
      const body = await readJson<{ error?: string }>(res);
      setGradingError(body.error ?? `Could not grade this loop (HTTP ${res.status}).`);
      setGrading(false);
      return;
    }
    setDebrief(await readJson<DebriefPacket>(res));
    setGrading(false);
  }

  if (error !== null && view === null) {
    return (
      <>
        <h1 className="text-2xl font-bold text-plum-900">Something went wrong</h1>
        <p role="alert" className="mt-2 text-sm font-medium text-danger">
          {error}
        </p>
        <p className="mt-4">
          <a href="/" className="font-medium text-plum-700 underline hover:text-plum-900">
            Back to the loop list
          </a>
        </p>
      </>
    );
  }

  if (view === null) {
    return <p className="text-neutral-600">Loading your session…</p>;
  }

  return (
    <>
      <h1 className="text-2xl font-bold text-plum-900">
        {view.trackId} &middot; {view.levelBand}
      </h1>
      <p className="mt-1 text-sm text-neutral-600">
        Round {view.currentRoundPosition} of {view.roundCount}
        {view.currentRoundType !== null ? ` — ${view.currentRoundType}` : ''}
        {view.persona !== null ? ` (${view.persona})` : ''}
      </p>

      {view.status === 'in_progress' && view.question !== null ? (
        <section
          aria-labelledby="question-heading"
          className="mt-6 max-w-[65ch] rounded-lg border border-neutral-200 bg-white p-5 shadow-sm"
        >
          <h2 id="question-heading" className="text-lg font-semibold text-plum-900">
            Question
          </h2>
          <p className="mt-2 text-neutral-900">{view.question}</p>
          <label htmlFor="answer" className="mt-4 block text-sm font-medium text-neutral-900">
            Your answer
          </label>
          <textarea
            id="answer"
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            rows={8}
            disabled={submitting}
            className="mt-2 w-full rounded-md border border-neutral-200 p-3 text-sm text-neutral-900 focus:border-gold-600 focus:outline-none focus:ring-2 focus:ring-gold-600"
          />
          {error !== null ? (
            <p role="alert" className="mt-2 text-sm font-medium text-danger">
              {error}
            </p>
          ) : null}
          <div className="mt-4 flex flex-col gap-3 md:flex-row md:items-center">
            <button
              type="button"
              onClick={() => void submitAnswer()}
              disabled={submitting || answer.trim() === ''}
              className={PRIMARY_BUTTON_CLASS}
            >
              {submitting ? 'Submitting…' : 'Submit answer'}
            </button>
            <VoiceAnswerButton disabled={submitting} onTranscribed={(t) => setAnswer(t)} />
          </div>
        </section>
      ) : null}

      {view.status === 'completed' && debrief === null ? (
        <section className="mt-6 rounded-lg border border-neutral-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-plum-900">Loop complete</h2>
          <p className="mt-2 text-sm text-neutral-600">{view.answeredTurnCount} rounds answered.</p>
          {gradingError !== null ? (
            <p role="alert" className="mt-2 text-sm font-medium text-danger">
              {gradingError}
            </p>
          ) : null}
          <button
            type="button"
            onClick={() => void fetchDebrief()}
            disabled={grading}
            className={`mt-4 ${PRIMARY_BUTTON_CLASS}`}
          >
            {grading ? 'Grading…' : 'Get your debrief'}
          </button>
        </section>
      ) : null}

      {debrief !== null ? (
        <section aria-labelledby="debrief-heading" className="mt-8">
          <h2 id="debrief-heading" className="text-xl font-semibold text-plum-900">
            Debrief
          </h2>
          <p className="mt-3 inline-block rounded-lg bg-gold-100 px-4 py-2">
            <span className="text-sm text-neutral-600">Overall: </span>
            <strong className="text-2xl font-bold text-plum-900">{debrief.overallDisplay}</strong>
          </p>
          <p className="mt-2 text-sm text-neutral-600">{debrief.methodNote}</p>

          {debrief.practiceFocus.length > 0 ? (
            <>
              <h3 className="mt-6 text-lg font-semibold text-plum-900">Practice focus</h3>
              <ul className="mt-2 flex flex-wrap gap-2">
                {debrief.practiceFocus.map((a) => (
                  <li
                    key={a.dimension}
                    className="rounded-full bg-plum-100 px-3 py-1 text-sm font-medium text-plum-900"
                  >
                    {a.name}
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          <h3 className="mt-6 text-lg font-semibold text-plum-900">Every dimension</h3>
          <ul className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {debrief.attributes.map((a) => (
              <li key={a.dimension}>
                <ScoreWithInterval
                  label={a.name}
                  median={a.score.median}
                  intervalLow={a.score.intervalLow}
                  intervalHigh={a.score.intervalHigh}
                  lowInformation={a.lowInformation}
                  evidenceQuote={a.quote}
                />
              </li>
            ))}
          </ul>

          {debrief.gaps.length > 0 ? (
            <p className="mt-4 text-sm text-neutral-600">
              No evidence collected for: {debrief.gaps.join(', ')}.
            </p>
          ) : null}
        </section>
      ) : null}
    </>
  );
}
```

- [ ] **Step 2: Verify**

Run: `pnpm --filter @loopcraft/web run typecheck`
Expected: passes. (This route is not covered by the static-markup a11y suite — real verification is Task 11's Playwright pass through a live session.)

- [ ] **Step 3: Commit**

```bash
git add "apps/web/src/app/session/[id]/page.tsx"
git commit -m "feat(web): style the interview session flow and debrief"
```

---

### Task 9: Calibration page styling

**Files:**
- Modify: `apps/web/src/app/calibration/page.tsx`

**Interfaces:**
- Consumes: `BRAND` from `@loopcraft/core` (unchanged import), color tokens (Task 1).
- Produces: no signature change — default export `CalibrationPage` unchanged, consumed by `apps/web/test/a11y.test.tsx`.

- [ ] **Step 1: Replace the file contents**

Replace the full contents of `apps/web/src/app/calibration/page.tsx`:

```tsx
import type { ReactElement } from 'react';
import { BRAND } from '@loopcraft/core';

/**
 * The public calibration card (spec §2.6, §7 acceptance criterion 7). This page is the
 * product's answer to a regulator asking what a score means, so it states plainly that no
 * agreement statistic has been measured rather than displaying a placeholder.
 */
export default function CalibrationPage(): ReactElement {
  return (
    <>
      <h1 className="text-3xl font-bold text-plum-900">How {BRAND.name} scores work</h1>

      <section
        aria-labelledby="status-heading"
        className="mt-6 max-w-[70ch] rounded-lg border border-gold-600 bg-neutral-50 p-5"
      >
        <h2 id="status-heading" className="text-lg font-semibold text-plum-900">
          Reliability has not been measured yet
        </h2>
        <p className="mt-2 text-sm text-neutral-900">
          No agreement statistic appears on this page, because none has been measured. There
          is no gold set yet. Any figure shown here today would be fabricated, so none is
          shown.
        </p>
      </section>

      <section aria-labelledby="what-heading" className="mt-8 max-w-[70ch]">
        <h2 id="what-heading" className="text-xl font-semibold text-plum-900">
          What a score is
        </h2>
        <p className="mt-2 text-neutral-900">
          A score is a coaching signal. It is not a prediction of a hiring outcome, and{' '}
          {BRAND.name} does not estimate anyone&rsquo;s chance of receiving an offer.
        </p>
        <p className="mt-3 text-neutral-900">
          Every dimension is scored 1&ndash;5 against a written behavioural anchor with two
          worked examples. Scores are never rescaled to 0&ndash;100 and there is no
          &ldquo;exceptional&rdquo; threshold.
        </p>
      </section>

      <section aria-labelledby="method-heading" className="mt-8 max-w-[70ch]">
        <h2 id="method-heading" className="text-xl font-semibold text-plum-900">
          Method
        </h2>
        <ol className="mt-3 list-decimal space-y-3 pl-5 text-neutral-900">
          <li>
            <strong>Grader separation.</strong> The model that interviews you never grades
            you. A separate grader sees only the transcript, your artifacts, and the rubric.
          </li>
          <li>
            <strong>Three samples.</strong> Each round is graded three times independently.
            The median is reported, with the spread between samples shown as the interval.
          </li>
          <li>
            <strong>Uncertainty is mandatory.</strong> A score cannot be stored without its
            interval, and the interval never collapses to zero.
          </li>
          <li>
            <strong>Evidence.</strong> Every dimension carries a quote from your answer and
            the turn it came from.
          </li>
        </ol>
      </section>

      <section aria-labelledby="not-heading" className="mt-8 max-w-[70ch]">
        <h2 id="not-heading" className="text-xl font-semibold text-plum-900">
          What is never graded
        </h2>
        <p className="mt-2 text-neutral-900">
          Delivery feedback comes only from transcript text and audio timing: speaking rate,
          filler ratio, pause lengths, longest unbroken stretch, response latency, hedging
          density, quantification density, and STAR segment coverage.
        </p>
        <p className="mt-3 text-neutral-900">
          {BRAND.name} never infers emotion, sentiment, engagement, enthusiasm, mood or
          personality from your face, your voice, or video. This is enforced by a rule that
          fails our build, not by policy alone.
        </p>
      </section>

      <section aria-labelledby="limits-heading" className="mt-8 max-w-[70ch]">
        <h2 id="limits-heading" className="text-xl font-semibold text-plum-900">
          Known limitations
        </h2>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-neutral-900">
          <li>No measured reliability, as stated above.</li>
          <li>
            Item difficulty is cold-started from expert tagging and has not been recalibrated
            from response data.
          </li>
          <li>Every rubric and item is written in English.</li>
          <li>
            Domain reasoning is graded against a shared rubric, which may under-differentiate
            between specialisations.
          </li>
          <li>No demographic fairness analysis has been run.</li>
        </ul>
      </section>
    </>
  );
}
```

- [ ] **Step 2: Verify**

Run: `pnpm --filter @loopcraft/web run typecheck && pnpm --filter @loopcraft/web run test:a11y`
Expected: both pass. Also run `pnpm --filter @loopcraft/web run lint` — this file is exempted from `loopcraft/no-affect-inference` (see `eslint.config.js`), so it must still pass cleanly on every other rule.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/calibration/page.tsx
git commit -m "feat(web): style the calibration page as readable long-form content"
```

---

### Task 10: Compliance page styling

**Files:**
- Modify: `apps/web/src/app/compliance/page.tsx`

**Interfaces:**
- Consumes: `BRAND` from `@loopcraft/core` (unchanged import), color tokens (Task 1).
- Produces: no signature change — default export `CompliancePage` unchanged, consumed by `apps/web/test/a11y.test.tsx`.

- [ ] **Step 1: Replace the file contents**

Replace the full contents of `apps/web/src/app/compliance/page.tsx`:

```tsx
import type { ReactElement } from 'react';
import { BRAND } from '@loopcraft/core';

/**
 * The compliance position paper (spec §5.5): "None of these reach a candidate-side rehearsal
 * tool, but write a one-page position paper explaining why, because every enterprise security
 * questionnaire will ask."
 */
export default function CompliancePage(): ReactElement {
  return (
    <>
      <h1 className="text-3xl font-bold text-plum-900">Compliance position</h1>
      <p className="mt-3 max-w-[70ch] text-neutral-900">
        {BRAND.name} is rehearsal software sold to candidates. It is not a hiring tool, it is
        not sold to employers for candidate evaluation, and it never supplies answers during a
        real interview.
      </p>

      <section aria-labelledby="emotion-heading" className="mt-8 max-w-[70ch]">
        <h2 id="emotion-heading" className="text-xl font-semibold text-plum-900">
          Emotion inference
        </h2>
        <p className="mt-2 text-neutral-900">
          The EU AI Act prohibits inferring emotions of a natural person in workplace and
          educational contexts, and the Commission reads &ldquo;workplace&rdquo; broadly enough
          to include recruitment. {BRAND.name} does not perform emotion inference anywhere.
          Delivery feedback is computed from transcript text and audio timing only.
        </p>
        <p className="mt-3 text-neutral-900">
          Video is optional, off by default, produces only mechanical framing advice, and is
          disabled entirely for users in the EU and Illinois.
        </p>
      </section>

      <section aria-labelledby="biometric-heading" className="mt-8 max-w-[70ch]">
        <h2 id="biometric-heading" className="text-xl font-semibold text-plum-900">
          Biometric and privacy law
        </h2>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-neutral-900">
          <li>
            <strong>Illinois BIPA.</strong> No face geometry or biometric template is
            generated at any point, so no biometric identifier is collected.
          </li>
          <li>
            <strong>Illinois AI Video Interview Act.</strong> Binds employers using AI video
            analysis. {BRAND.name} is candidate-side and performs no video analysis.
          </li>
          <li>
            <strong>Texas CUBI and TDPSA.</strong> Apply to us directly as a Texas-based
            operator; no biometric identifiers are processed.
          </li>
          <li>
            <strong>CCPA/CPRA and GDPR.</strong> No biometric data is processed for unique
            identification. Retention periods are published and deletion purges both database
            rows and stored files.
          </li>
          <li>
            <strong>Minors.</strong> Accounts are gated at 13+, and 16+ in the EU. Video is
            never processed for an account flagged as a minor.
          </li>
        </ul>
      </section>

      <section aria-labelledby="employment-heading" className="mt-8 max-w-[70ch]">
        <h2 id="employment-heading" className="text-xl font-semibold text-plum-900">
          Employment-AI laws we do not trigger
        </h2>
        <p className="mt-2 text-neutral-900">
          Colorado SB 26-189, NYC Local Law 144 and Illinois HB 3773 bind developers and
          deployers of systems used to make consequential employment decisions. {BRAND.name}{' '}
          makes no selection decision: a candidate buys it for themselves, and its output is
          never sold to an employer. We preserve that distinction deliberately, because it is
          what keeps the product outside the high-risk classification.
        </p>
      </section>

      <section aria-labelledby="claims-heading" className="mt-8 max-w-[70ch]">
        <h2 id="claims-heading" className="text-xl font-semibold text-plum-900">
          What we will not claim
        </h2>
        <p className="mt-2 text-neutral-900">
          We make no claim about your chance of being hired, no guarantee of any offer, and no
          success rate. We have run no efficacy study, so we assert no efficacy. If we ever
          run one it will be preregistered, with the denominator defined before data
          collection, and published with its methodology.
        </p>
        <p className="mt-3 text-neutral-900">
          We do not use scraped or leaked question banks. Every item is generated against a
          published rubric and records its provenance.
        </p>
      </section>

      <section aria-labelledby="a11y-heading" className="mt-8 max-w-[70ch]">
        <h2 id="a11y-heading" className="text-xl font-semibold text-plum-900">
          Accessibility
        </h2>
        <p className="mt-2 text-neutral-900">
          We target WCAG 2.2 AA: full keyboard operation, captions on generated audio, a
          text-only interview mode, and configurable time limits.
        </p>
      </section>

      <p className="mt-10 max-w-[70ch] text-sm text-neutral-600">{BRAND.affiliationDisclaimer}</p>
    </>
  );
}
```

- [ ] **Step 2: Verify**

Run: `pnpm --filter @loopcraft/web run typecheck && pnpm --filter @loopcraft/web run test:a11y`
Expected: both pass.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/compliance/page.tsx
git commit -m "feat(web): style the compliance page as readable long-form content"
```

---

### Task 11: Full verification and responsive visual proof

**Files:** none (verification only).

**Interfaces:** none — this task consumes every file from Tasks 1–10 as a whole and produces no new interface.

- [ ] **Step 1: Full workspace test suite**

Run: `pnpm run test`
Expected: `9 successful, 9 total` (same task count as before this plan started), including `@loopcraft/web:test` (143 passed) and the a11y config's 23 passed.

- [ ] **Step 2: Lint and typecheck**

Run: `pnpm exec eslint . && pnpm run typecheck`
Expected: both clean, no errors.

- [ ] **Step 3: Production build**

Run: `pnpm --filter @loopcraft/web run build`
Expected: builds successfully — this is the first real proof Tailwind's CSS pipeline compiles correctly for production, not just in dev mode.

- [ ] **Step 4: Start the dev server**

Run (background): `pnpm --filter @loopcraft/web run dev`
Expected: ready on `http://localhost:3100`.

- [ ] **Step 5: Playwright responsive walkthrough**

Using the `mcp__playwright__*` tools, for each of the 5 routes (`/`, `/dashboard`, `/session/<a real session id created via the Start button>`, `/calibration`, `/compliance`):
1. Resize to a mobile viewport (375×812) and take a screenshot.
2. Resize to a desktop viewport (1280×800) and take a screenshot.
3. On `/`, confirm the hamburger toggle is visible and functional at 375px (click it, confirm the nav list appears; `aria-expanded` flips to `true`) and that the nav renders inline (no hamburger) at 1280px.
4. On `/session/<id>`, exercise the actual answer-submission flow (type an answer, submit) to confirm the textarea/button layout holds up with real interaction, not just static markup.

Expected: all 10 screenshots show the plum/gold palette applied, no unstyled/bare-HTML flash, no horizontal overflow at 375px, and the nav collapses/expands correctly. Any visual defect found here gets fixed in the relevant task's file before this task is considered done — this is the concrete verification for the two things the automated suites cannot check (real responsive layout, and the two files — `VoiceAnswerButton` and the session page — that the static a11y suite never renders).

- [ ] **Step 6: Stop the dev server**

Stop the background dev server process started in Step 4.

- [ ] **Step 7: Final commit (only if Step 5 required fixes)**

If Step 5 required any fixes, stage and commit them with a message describing what the visual walkthrough caught, e.g.:

```bash
git add <fixed files>
git commit -m "fix(web): correct <specific visual defect> found in the responsive walkthrough"
```

If Step 5 required no fixes, this task needs no commit of its own — Tasks 1–10's commits already represent the complete, verified change.
