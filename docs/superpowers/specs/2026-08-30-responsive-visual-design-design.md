# InterviewSoftware: first visual design, responsive-first

## Context

`apps/web` currently has zero CSS anywhere in the codebase — no stylesheet, no Tailwind, no
CSS-in-JS. Every page renders as bare, unstyled HTML with semantic (largely BEM-style)
class names that point at rules that do not exist. "Make it responsive" is therefore not a
retrofit of an existing design onto new breakpoints; it is building the product's first real
visual design, with responsiveness built in from the start rather than added after the fact.

This spec covers the existing product surface only: the 5 routes and 4 components that exist
today. It adds no new pages or features.

Routes: `/` (prep/catalog), `/dashboard`, `/session/[id]`, `/calibration`, `/compliance`.
Components: `Dashboard`, `ScoreWithInterval` (+ `AbilityReadout`), `StartLoopButton`,
`VoiceAnswerButton`.

## Goals

- A warm, professional, "coaching" visual identity — not a cold utilitarian dashboard, not a
  dev-tool aesthetic.
- Fully responsive, mobile-first, across all 5 existing routes.
- Meet the existing WCAG 2.2 AA target (spec §5.6) and keep the passing axe a11y suite
  (`apps/web/test/a11y.test.tsx`) green — this design styles around the existing semantic
  structure (headings, landmarks, `<details>`, form labels) rather than changing it.
- Every score-bearing surface keeps the existing guardrail: an interval and a calibration
  link travel with every number, never stripped by a layout choice (`ScoreWithInterval`'s
  doc comment is explicit that there is no prop to render a bare number — this design does
  not add one).

## Explicit non-goals (scope boundary)

- **Dark mode.** One polished light theme for this pass. A dark theme is a reasonable
  follow-on but is out of scope here — the user chose light-only to keep this pass focused.
- **New pages or features.** Pure visual/responsive design over the existing 5 routes.
- **The React Native mobile app.** A genuinely separate subsystem (different toolchain,
  different distribution model) — its own spec once this one ships, per the user's stated
  sequencing (responsive web first, then mobile).

## Approach: Tailwind CSS v4

Utility classes wired to a small custom theme (palette, type scale, spacing extensions on
top of Tailwind's defaults). Chosen over hand-rolled CSS (slower to keep ~5 pages visually
consistent, every breakpoint a manual media query) and CSS-in-JS (real friction under Next
15's server-first App Router, no benefit here for a mostly server-rendered app). Tailwind's
utilities are mobile-first by construction, which matches "responsive from the start" rather
than a desktop-first retrofit needing a separate pass.

## Design tokens

### Color

Plum + gold, on warm (slightly plum-tinted, not pure grey) neutrals so the whole palette
reads as one piece. Semantic colors (success/warning/danger) are kept separate from the gold
accent so "good score" and "call to action" never compete for the same visual weight.

| Token | Hex | Use |
|---|---|---|
| `plum-900` | `#3B1236` | Headings, high-emphasis text |
| `plum-700` | `#6B2C64` | Buttons, links, active nav |
| `plum-100` | `#F3E8F1` | Soft tint — cards, hover backgrounds |
| `gold-600` | `#C9A227` | Accent — progress, highlights, focus rings |
| `gold-100` | `#FBF3D9` | Soft tint — badges, callouts |
| `neutral-900` | `#2A2229` | Body text |
| `neutral-600` | `#6B6169` | Secondary/muted text |
| `neutral-200` | `#E8E1E6` | Borders, dividers |
| `neutral-50` | `#FAF7F9` | Page background |
| `success` | `#2E7D4F` | Score bands, positive status |
| `warning` | `#B5790A` | Low-information caveats, non-error notices |
| `danger` | `#B0392B` | Form/request errors |

### Typography

One family throughout (per the user's explicit choice of "clean sans throughout" over a
serif/sans pairing): **Plus Jakarta Sans** (Google Fonts), weights 400–700. Chosen over the
generic Inter/Space Grotesk default for more character while staying professional and highly
legible. Fallback stack: `'Plus Jakarta Sans', system-ui, -apple-system, sans-serif`.

Modular scale (rem, 16px base):

| Role | Size/line-height | Weight |
|---|---|---|
| Display (debrief overall score) | 2.5rem / 3rem | 700 |
| H1 | 2rem / 2.5rem | 700 |
| H2 | 1.5rem / 2rem | 600 |
| H3 | 1.25rem / 1.75rem | 600 |
| Body | 1rem / 1.5rem | 400 |
| Small/caption | 0.875rem / 1.25rem | 400/500 |

Headings get `text-wrap: balance`.

### Spacing & breakpoints

Tailwind's default 4px spacing scale and default breakpoints (`sm` 640 / `md` 768 / `lg`
1024 / `xl` 1280), mobile-first (unprefixed utilities apply to the smallest viewport first).

## Layout & navigation

- Header: wordmark (`BRAND.name`) left; primary nav (Prepare / Progress / How scoring works
  / Compliance) right on `md:` and above. Below `md:`, the nav collapses into a hamburger
  toggle that expands a full-width dropdown.
- The Article 50 AI-disclosure line (`BRAND.aiDisclosure`) stays visible as a slim banner
  directly under the header **at every viewport size** — it is a legal requirement to be
  prominent, so it is never folded into the hamburger.
- Footer: the two disclaimer paragraphs (`BRAND.scoreDisclosure`,
  `BRAND.affiliationDisclaimer`) stack full-width on mobile; on desktop they sit in a
  centered, narrow column — they are compliance text, not navigation, so no multi-column
  footer.
- The existing landmark structure (`header`/`nav`/`main`/`footer`) and skip-link are
  unchanged; this design styles around them.

## Page-by-page

### Prep (`/`)

Loop templates render as a responsive card grid: 1 column below `md:`, 2 columns `md:`–`lg:`,
3 columns `lg:` and above. Each card:
- Template name as H3.
- A compact meta row (track · level · rounds · minutes) as small muted text, not a full
  sentence.
- The modeled-on note as body text.
- The round breakdown stays a native `<details>`/`<summary>` (keeps existing keyboard/a11y
  behavior for free) with the disclosure triangle and spacing styled to look intentional
  rather than default-browser.
- `StartLoopButton` rendered as a solid `plum-700` button, full-width on mobile.
- Source links as a small muted row at the card's bottom.

Tracks section below uses the same card-grid pattern at a simpler density (name + one-line
description).

### Dashboard (`/dashboard`)

- "What to practise next" leads the page in a `gold-100`-tinted callout card — it is the
  single most actionable piece of content on the page.
- Ability estimates render as a responsive grid of stat cards: large `θ ± SE` reading, a
  small bar/marker showing position relative to `targetTheta`, muted method caption with the
  calibration link. The `!reportable` (not-enough-evidence) state renders as a visually
  distinct card (no number, explanatory text only) so it can never be mistaken for a real
  reading at a glance.
- Recent round scores use the shared score-card component (see below) in the same grid
  pattern.
- Due-for-review renders as compact chips rather than a bare list.

### Session (`/session/[id]`) — the interview flow

Highest-stakes page; kept calm and focused rather than dense.
- Question card at a comfortable reading width (max `65ch`), not full-bleed even on wide
  desktop viewports — long question text stays easy to read.
- Textarea: generous padding, visible focus ring in `gold-600`, comfortable line-height.
- Answer controls (Submit + `VoiceAnswerButton`): side-by-side on `md:` and above, stacked
  full-width below `md:`.
- Errors render inline (`role="alert"` preserved) in `danger`-colored text directly under the
  control that produced them.
- On completion, before grading: a calm "Loop complete" state with the answered-round count
  and a single "Get your debrief" button.
- Debrief: overall score leads, large (`Display` scale), in a `plum-900`-on-`gold-100` badge
  treatment; then practice focus as a short highlighted list; then the full per-dimension
  breakdown as stacked score cards, reusing the same shared score-card styling as the
  dashboard for visual consistency between "how you're doing over time" and "how you did
  just now."

### Calibration (`/calibration`) & Compliance (`/compliance`)

Both are long-form policy content. Single readable column, max-width `70ch`, generous
section spacing (these pages are read once carefully, not scanned repeatedly). Calibration's
"reliability has not been measured yet" callout gets a distinct `gold-600`-bordered neutral
box — deliberately not styled as a warning/error, since it is a transparency statement, not a
problem.

## Shared components

### `ScoreWithInterval` / `AbilityReadout` → consistent "score card"

Used on the prep page (indirectly, via templates), dashboard, and debrief — one visual
treatment everywhere it appears:
- Label as a small H3-weight heading.
- The reading (`median ± spread` or `θ ± SE`) large and bold; the `±` spread and "on a 1–5
  anchored rubric" / target-comparison text visibly smaller and muted, in the *same element*
  as the reading (existing structural guarantee — this design does not change that DOM
  relationship, only its typography).
- Method caption: small, muted, with the calibration link visually a normal inline link (not
  de-emphasized to the point of looking disabled — spec's transparency goal means this link
  should be easy to notice, not hidden).
- `lowInformation` caveat: a distinct `warning`-bordered inline note, `role="note"` preserved.
- Evidence quote: rendered as a blockquote with a `gold-600` left border, figcaption in small
  muted text.

### `StartLoopButton`

Solid `plum-700` button; `pending` state shows "Starting…" with a subtle inline spinner;
error renders in `danger` text below the button, `role="alert"` preserved.

### `VoiceAnswerButton`

Idle: outlined button with a mic icon. Recording: filled `plum-700` with a gentle pulse
animation (respecting `prefers-reduced-motion` — falls back to a static filled state).
Transcribing: spinner + "Transcribing…" label. Errors: inline `danger` text below the
button.

## Accessibility & testing

- No changes to the existing semantic structure (headings order, landmarks, form labels,
  `<details>` usage) that `apps/web/test/a11y.test.tsx` already audits — the existing test
  suite is the regression gate for this work and must stay green throughout.
- jsdom's two documented limits stay true here: color contrast cannot be sampled in the axe
  suite (no canvas in jsdom), and nothing hydration-only (focus management, live regions) is
  covered by the static-markup audit. This design's plum-on-neutral and text-on-tint pairings
  are chosen to meet WCAG AA contrast (4.5:1 body text / 3:1 large text) by calculation, but
  **must still be spot-checked in a real browser** before considering this done — the same
  limit the test file already documents, not a new one introduced by this design.
- `prefers-reduced-motion` respected for the voice-button pulse and any other motion added.
- Manual keyboard/focus pass across all 5 routes in a real browser (focus rings visible,
  hamburger menu operable by keyboard, no focus traps) — this is the hydration-only gap the
  static a11y suite cannot cover.

## Implementation notes

- Install `tailwindcss` v4 + its Next.js integration in `apps/web` only (no other package
  needs it).
- Tokens live in a small theme extension (CSS `@theme` block per Tailwind v4's CSS-first
  config), not a `tailwind.config.ts` — v4's default approach.
- Existing BEM-style class names (`.score__label`, `.ability__reading`, etc.) are replaced by
  Tailwind utility classes directly in JSX; no class names are kept "for compatibility" since
  nothing currently depends on them (there is no CSS targeting them today).
