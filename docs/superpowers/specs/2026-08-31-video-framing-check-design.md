# Video framing check

## Context

`apps/web/src/app/compliance/page.tsx` states, as fact: *"Video is optional, off by default,
produces only mechanical framing advice, and is disabled entirely for users in the EU and
Illinois."* Nothing video-related exists in the codebase. Zero `<video>` elements, zero video
`getUserMedia` calls, anywhere. The compliance page has been describing a feature that was
never built.

The groundwork for gating it was, though, laid earlier in this build and never wired up:

- `packages/db/migrations/0000_tenancy_and_identity.sql` already has `users.age_band` (`unknown`
  / `under_13` / `13_to_15` / `16_plus`) and `users.jurisdiction` (`text`, currently
  unconstrained, default `'unknown'`), with a comment reading "video processing is disabled
  entirely for EU and Illinois users."
- `apps/web/src/server/entitlements.ts` already has a `'video_processing'` `Feature` and
  `PlanRow.allowsVideo`.
- Nothing in application code reads either. No settings page exists to set them.

This spec closes that gap: a real, working, opt-in camera-framing check, gated correctly, and
a settings page for the fields the gate depends on.

## Goals

- A real one-time camera-framing check: opt-in, off by default, purely geometric feedback
  (centered / distance / eye-line), computed entirely client-side.
- Server-side enforcement of eligibility (plan entitlement + jurisdiction + age band), so a
  modified client cannot surface the feature for an ineligible account (guardrail 5).
- No frame, image, or video data ever leaves the browser (guardrail 6 — private-by-default
  storage stays trivially true here: there's nothing to store).
- A minimal settings page giving jurisdiction, age band, display name, and the video opt-in
  toggle somewhere to live, since none currently exists.
- The compliance page's video claim becomes true.

## Explicit non-goals (scope boundary)

- **Continuous/real-time framing feedback.** One check, on demand, before recording — not
  live analysis while answering. A continuous version is a materially larger build (model
  performance budget, more edge cases) and is out of scope here.
- **Video recording, upload, or storage of any kind.** The camera stream is used for the
  live preview and the one detection pass, then stopped. Nothing is ever sent to the server.
- **Identity verification for age or jurisdiction.** Both are self-declared on the settings
  page, not independently verified — there is no verification service in this product, and
  none is being added here. This is stated plainly in the settings UI copy.
- **A full account/profile system.** The settings page has exactly four fields (name,
  jurisdiction, age band, video opt-in). No avatar, no password/email management, no
  notification preferences.

## Data model

New migration `0007_video_eligibility.sql`:

```sql
alter table users
  add column video_opt_in boolean not null default false;

alter table users
  add constraint users_jurisdiction_check
  check (jurisdiction in ('unknown', 'eu', 'illinois', 'us_other', 'other'));
```

`jurisdiction` already exists as an unconstrained `text` column defaulting to `'unknown'`;
this only adds the check constraint and the new opt-in column. No default changes: every
existing and new user starts `jurisdiction = 'unknown'`, `age_band = 'unknown'`,
`video_opt_in = false` — fail-closed by construction, not by an application-level check that
could be forgotten.

## Eligibility gating

A pure function, `videoEligible`, in a new `apps/web/src/server/video-eligibility.ts`:

```ts
export interface VideoEligibilityInput {
  readonly jurisdiction: string;
  readonly ageBand: string;
  readonly videoOptIn: boolean;
  readonly planAllowsVideo: boolean;
}

export function videoEligible(input: VideoEligibilityInput): boolean {
  const jurisdictionOk = input.jurisdiction === 'us_other' || input.jurisdiction === 'other';
  const ageOk = input.ageBand === '16_plus';
  return jurisdictionOk && ageOk && input.videoOptIn && input.planAllowsVideo;
}
```

All four conditions are required. `jurisdiction === 'unknown'` and `ageBand === 'unknown'`
both evaluate to `false` — there is no code path where an unset value is treated as
"eligible until proven otherwise."

This function is called from two places, both server-side:
- `GET /api/users/me`, to tell the client whether to render the settings toggle as usable
  and whether to render the framing-check card on the session page.
- Nowhere else needs it, because the framing check itself never touches the server (there is
  no server-side action to gate beyond "should the UI offer this at all").

`planAllowsVideo` comes from the existing `ResolvedEntitlement` (`resolveEntitlement` +
`assertFeature`/the plan row's `allowsVideo`), reusing the entitlement resolution `postSession`
and friends already use — no new entitlement machinery.

## Settings page

New route `/settings` (`apps/web/src/app/settings/page.tsx`), added to the header nav
(`NAV_LINKS` in `layout.tsx`) as a fifth entry. Client component, following the same
fetch-on-mount / PATCH-on-submit pattern as `session/[id]/page.tsx`:

- `GET /api/users/me` returns `{ displayName, jurisdiction, ageBand, videoOptIn,
  videoEligible }` for the authenticated user.
- `PATCH /api/users/me` accepts a partial update of `{ displayName?, jurisdiction?, ageBand?,
  videoOptIn? }`, validated with zod (jurisdiction and ageBand restricted to their known
  enums), and re-resolves `videoEligible` server-side before responding — the response is
  always the authoritative post-update state, never an echo of what the client sent.

Form fields:
- **Display name** — plain text input.
- **Jurisdiction** — a select: "European Union," "Illinois," "Another US state," "Elsewhere,"
  with no default selection forced (starts on whatever `jurisdiction` currently is, including
  `unknown`, rendered as "Not set").
- **Age band** — a select: "Under 13," "13–15," "16 or older," same "Not set" handling. Copy
  directly under the field: "Self-reported. We don't verify this."
- **Video framing check** — a toggle, `disabled` (not hidden — a disabled control with an
  explanation is more honest than a control that vanishes) unless jurisdiction and age band
  are both currently eligible values. Helper text explains why it's disabled when it is:
  "Available once your region and age are set to an eligible value above."

## The framing check itself

### Component boundary

- `apps/web/src/lib/framing-analysis.ts` — pure, framework-free. Takes a detection result
  shape (bounding box + two eye keypoints, normalized 0–1 coordinates, matching MediaPipe's
  `FaceDetectorResult`) and frame dimensions, returns a `FramingVerdict`:

  ```ts
  export interface FramingVerdict {
    readonly centered: boolean;
    readonly distanceOk: boolean;
    readonly eyeLineOk: boolean;
    readonly messages: readonly string[];
  }
  ```

  Three independent geometric checks, each a simple threshold comparison (no ML, no
  inference — arithmetic on coordinates already produced by the detector):
  - **Centered**: bounding-box horizontal center within 15% of frame-width of true center.
  - **Distance**: bounding-box width between 25% and 55% of frame width (too small = too
    far, too large = too close).
  - **Eye-line**: average eye-keypoint vertical position between 30% and 45% of frame height
    (the standard "eyes in the upper third" guideline).

  This file is unit-testable with zero DOM, zero camera, zero WASM — table-driven tests over
  synthetic bounding-box/keypoint inputs.

- `apps/web/src/components/CameraFramingCheck.tsx` — the client component. Owns camera
  permission, the `<video>` preview element, loading the MediaPipe `FaceDetector` (short-range
  model, WASM backend, loaded from `@mediapipe/tasks-vision`'s bundled asset path), running one
  `detect()` call on button press, and feeding the result through `framingVerdict()`. Renders
  the verdict as three labelled rows (✓/✗ per check) plus the `messages`. A "Check again"
  button re-runs detection without re-requesting permission. Camera `MediaStream` tracks are
  stopped (`track.stop()`) when the component unmounts or the user dismisses the card —
  never left running.

### Where it appears

On `session/[id]/page.tsx`, above the question card, only when
`view.videoEligible === true` (added to the existing `SessionView` shape, resolved
server-side in the same route that already builds the view). Collapsed by default behind a
"Check your camera framing" disclosure — it does not appear expanded/intrusive on every
load, matching "optional" in the compliance copy.

## Compliance page

No copy changes needed once this ships — the existing sentence becomes accurate:
"Video is optional, off by default, produces only mechanical framing advice, and is disabled
entirely for users in the EU and Illinois." (Illinois and EU map to `jurisdiction` values
that `videoEligible` excludes; "off by default" is `video_opt_in: false`.)

## Testing

- `apps/web/test/framing-analysis.test.ts` — table-driven unit tests over
  `framingVerdict()`: centered/off-center in both directions, too-close/too-far/correct
  distance, eye-line high/low/correct, and combinations producing multiple simultaneous
  messages.
- `apps/web/test/video-eligibility.test.ts` — unit tests over `videoEligible()`: every
  jurisdiction value × every age band × opt-in on/off × plan allows/disallows, confirming
  `unknown` never passes and all four conditions are independently required.
- `apps/web/test/routes.integration.test.ts` (extended) — `GET`/`PATCH /api/users/me`
  against the real test database: round-trips a settings update, confirms RLS prevents
  reading/writing another user's row (extends the existing cross-tenant-isolation describe
  block), confirms `videoEligible` in the response reflects the just-written values.
- `apps/web/test/a11y.test.tsx` (extended) — the settings page added to the audited-routes
  table, same static-markup axe pass as the other five routes.
- `CameraFramingCheck.tsx` itself is not unit-tested (it's a thin wrapper around browser
  camera APIs and a WASM model — this repo's established pattern, same as
  `VoiceAnswerButton.tsx`, is real code with no test double for browser-only APIs, verified
  through a live Playwright walkthrough instead of a mocked unit test).
