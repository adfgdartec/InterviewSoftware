# Video Framing Check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the compliance page's video claim true: a real, opt-in, purely client-side camera-framing check, correctly gated by plan entitlement + jurisdiction + age band, plus the minimal settings page those fields need to live somewhere.

**Architecture:** Two pure functions (`videoEligible`, `framingVerdict`) carry all the actual logic and are fully unit-tested without a browser or camera. A thin client component (`CameraFramingCheck`) wires a real `getUserMedia` stream and a real MediaPipe `FaceDetector` (WASM, client-side, one detection pass on demand) into `framingVerdict`. A new `/api/users/me` route (GET/PATCH) and `/settings` page give jurisdiction/age-band/opt-in somewhere to be set; `getSession` computes `videoEligible` server-side and the session page renders the check only when eligible.

**Tech Stack:** Next.js 15 App Router, `@mediapipe/tasks-vision` 1.0.1 (WASM, client-side), Postgres/RLS, zod, vitest.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-31-video-framing-check-design.md` (committed at `ff064d4`).
- No continuous/real-time analysis, no video recording or upload, no identity verification — see the spec's non-goals. One detection pass per "Check my framing" click; camera frame never leaves the browser.
- Fail-closed: `unknown` jurisdiction or age band must never evaluate as eligible. `videoEligible` requires all four of jurisdiction-ok, age-ok, opt-in, and plan-allows-video.
- Server-side enforcement (`videoEligible` computed in the route, not just hidden client-side).
- `apps/web/test/a11y.test.tsx` must stay green throughout; the new `/settings` route gets added to it, not exempted from it.
- Feedback copy from `framingVerdict` must stay strictly geometric ("move back a little," "center yourself") — never describe the person, their expression, or how they seem. This repo's ESLint rule (`loopcraft/no-affect-inference`) scans text for banned vocabulary; running `pnpm exec eslint .` on every task is what proves this file doesn't drift.
- Known verification limit, stated up front rather than glossed over: the actual camera + WASM face-detection pipeline cannot be exercised end-to-end in this environment (no real camera hardware, and the available Playwright MCP tools don't expose the `--use-fake-device-for-media-stream` launch flag needed to fake one). `CameraFramingCheck.tsx` is real, production code, but — like `VoiceAnswerButton.tsx` before it — it is unverified against a live camera in this pass. `framingVerdict`'s actual classification logic, which is where the real risk of a bug lives, gets full unit-test coverage instead; the component is a thin, reviewable wrapper around it.

---

### Task 1: Migration 0007 — video eligibility columns

**Files:**
- Create: `packages/db/migrations/0007_video_eligibility.sql`

**Interfaces:**
- Produces: `users.video_opt_in` (boolean, default false), a check constraint on `users.jurisdiction` restricting it to `('unknown', 'eu', 'illinois', 'us_other', 'other')`. Consumed by Task 2 (`videoEligible`) and Task 4 (`/api/users/me`).

- [x] **Step 1: Write the migration**

Create `packages/db/migrations/0007_video_eligibility.sql`:

```sql
-- 0007 · columns the video framing check's eligibility gate depends on.
--
-- users.age_band and users.jurisdiction already existed (migration 0000) with exactly this
-- feature in mind -- jurisdiction had no constraint yet. No new RLS policy is needed:
-- users already has users_self_read/users_self_update from migration 0002, which cover
-- these new columns automatically since they're not column-specific.

set search_path = public, loopcraft;

alter table users
  add column video_opt_in boolean not null default false;

alter table users
  add constraint users_jurisdiction_check
  check (jurisdiction in ('unknown', 'eu', 'illinois', 'us_other', 'other'));
```

- [x] **Step 2: Apply to local Postgres**

Run: `pnpm --filter @loopcraft/db run migrate`
Expected output includes `APPLIED  0007_video_eligibility.sql`.

- [x] **Step 3: Apply to the real Supabase project the dev server uses**

Run (reads `DATABASE_URL`/`LOOPCRAFT_ALLOW_REMOTE_MIGRATIONS` from `apps/web/.env.local`):

```bash
cd apps/web && set -a && source .env.local && set +a && cd ../../packages/db && \
LOOPCRAFT_ALLOW_REMOTE_MIGRATIONS=1 pnpm exec tsx src/migrate.ts
```

Expected: `APPLIED  0007_video_eligibility.sql` against the `*.supabase.com` hostname.

- [x] **Step 4: Verify with a direct query against both databases**

The local Postgres instance only ever holds `loopcraft_test` (what the automated test suite
uses); the actual running dev server points entirely at the Supabase project from
`apps/web/.env.local`'s `DATABASE_URL` — there is no separate "local dev" database in this
project's setup. Verify both real targets:

```bash
psql postgres://loopcraft:loopcraft_local_dev@localhost:54329/loopcraft_test -c "\d users"
```

```bash
cd apps/web && set -a && source .env.local && set +a && psql "$DATABASE_URL" -c "\d users"
```

Confirm `video_opt_in` and the `users_jurisdiction_check` constraint appear in both.

- [x] **Step 5: Commit**

```bash
git add packages/db/migrations/0007_video_eligibility.sql
git commit -m "feat(db): add video_opt_in and jurisdiction constraint (migration 0007)"
```

---

### Task 2: `videoEligible` — pure eligibility gate

**Files:**
- Create: `apps/web/src/server/video-eligibility.ts`
- Test: `apps/web/test/video-eligibility.test.ts`

**Interfaces:**
- Produces: `videoEligible(input: VideoEligibilityInput): boolean` and the `VideoEligibilityInput` interface (`jurisdiction: string`, `ageBand: string`, `videoOptIn: boolean`, `planAllowsVideo: boolean`). Consumed by Task 4 (`/api/users/me`) and Task 7 (`getSession`).

- [x] **Step 1: Write the failing tests**

Create `apps/web/test/video-eligibility.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { videoEligible, type VideoEligibilityInput } from '../src/server/video-eligibility.js';

function input(overrides: Partial<VideoEligibilityInput> = {}): VideoEligibilityInput {
  return {
    jurisdiction: 'us_other',
    ageBand: '16_plus',
    videoOptIn: true,
    planAllowsVideo: true,
    ...overrides,
  };
}

describe('videoEligible (fail-closed on every gate)', () => {
  it('is eligible when all four conditions hold', () => {
    expect(videoEligible(input())).toBe(true);
  });

  it('is eligible for jurisdiction "other" too, not just "us_other"', () => {
    expect(videoEligible(input({ jurisdiction: 'other' }))).toBe(true);
  });

  it('is never eligible for jurisdiction "eu"', () => {
    expect(videoEligible(input({ jurisdiction: 'eu' }))).toBe(false);
  });

  it('is never eligible for jurisdiction "illinois"', () => {
    expect(videoEligible(input({ jurisdiction: 'illinois' }))).toBe(false);
  });

  it('is never eligible for jurisdiction "unknown"', () => {
    expect(videoEligible(input({ jurisdiction: 'unknown' }))).toBe(false);
  });

  it('is never eligible for age band "unknown"', () => {
    expect(videoEligible(input({ ageBand: 'unknown' }))).toBe(false);
  });

  it('is never eligible for age band "under_13"', () => {
    expect(videoEligible(input({ ageBand: 'under_13' }))).toBe(false);
  });

  it('is never eligible for age band "13_to_15"', () => {
    expect(videoEligible(input({ ageBand: '13_to_15' }))).toBe(false);
  });

  it('is not eligible without opting in, even if otherwise eligible', () => {
    expect(videoEligible(input({ videoOptIn: false }))).toBe(false);
  });

  it('is not eligible on a plan that does not allow video, even if otherwise eligible', () => {
    expect(videoEligible(input({ planAllowsVideo: false }))).toBe(false);
  });

  it('requires every condition simultaneously, not just one', () => {
    expect(
      videoEligible({
        jurisdiction: 'eu',
        ageBand: 'under_13',
        videoOptIn: false,
        planAllowsVideo: false,
      }),
    ).toBe(false);
  });
});
```

- [x] **Step 2: Run to verify it fails**

Run: `pnpm --filter @loopcraft/web exec vitest run test/video-eligibility.test.ts`
Expected: FAIL — `Cannot find module '../src/server/video-eligibility.js'`.

- [x] **Step 3: Write the implementation**

Create `apps/web/src/server/video-eligibility.ts`:

```ts
/**
 * Whether the video framing check may be offered to a user. Spec §5.1: video is disabled
 * entirely for EU and Illinois users; spec §5.2 gates it at 16+ regardless of region. All
 * four conditions are required simultaneously -- there is no path where an unset
 * (`'unknown'`) jurisdiction or age band is treated as eligible until proven otherwise.
 */

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

- [x] **Step 4: Run to verify it passes**

Run: `pnpm --filter @loopcraft/web exec vitest run test/video-eligibility.test.ts`
Expected: `Test Files  1 passed (1)`, `Tests  11 passed (11)`.

- [x] **Step 5: Commit**

```bash
git add apps/web/src/server/video-eligibility.ts apps/web/test/video-eligibility.test.ts
git commit -m "feat(web): add videoEligible, the fail-closed video gating function"
```

---

### Task 3: `framingVerdict` — pure geometric analysis

**Files:**
- Create: `apps/web/src/lib/framing-analysis.ts`
- Test: `apps/web/test/framing-analysis.test.ts`

**Interfaces:**
- Produces: `framingVerdict(detection: FaceDetection, frame: FrameSize): FramingVerdict`, plus the `FaceDetection` (`boundingBox: {originX, originY, width, height}`, `eyeKeypoints: readonly [{x, y}, {x, y}]`), `FrameSize` (`width, height`), and `FramingVerdict` (`centered, distanceOk, eyeLineOk: boolean`, `messages: readonly string[]`) interfaces. Consumed by Task 6 (`CameraFramingCheck.tsx`).

- [x] **Step 1: Write the failing tests**

Create `apps/web/test/framing-analysis.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { framingVerdict, type FaceDetection, type FrameSize } from '../src/lib/framing-analysis.js';

const FRAME: FrameSize = { width: 640, height: 480 };

/** A face box centered horizontally, correctly sized, eyes on the guideline. */
function wellFramed(): FaceDetection {
  return {
    boundingBox: { originX: 224, originY: 120, width: 192, height: 192 }, // 30% of 640 wide
    eyeKeypoints: [
      { x: 280, y: 180 }, // ~37.5% of 480 tall
      { x: 360, y: 180 },
    ],
  };
}

describe('framingVerdict (purely geometric, no ML inference)', () => {
  it('passes all three checks for a well-framed face', () => {
    const v = framingVerdict(wellFramed(), FRAME);
    expect(v.centered).toBe(true);
    expect(v.distanceOk).toBe(true);
    expect(v.eyeLineOk).toBe(true);
    expect(v.messages).toHaveLength(0);
  });

  it('flags off-center to the left', () => {
    const d = wellFramed();
    const shifted: FaceDetection = {
      ...d,
      boundingBox: { ...d.boundingBox, originX: 0 },
      eyeKeypoints: [{ x: 56, y: 180 }, { x: 136, y: 180 }],
    };
    const v = framingVerdict(shifted, FRAME);
    expect(v.centered).toBe(false);
    expect(v.messages.some((m) => /center/i.test(m))).toBe(true);
  });

  it('flags too close (bounding box too large)', () => {
    const d = wellFramed();
    const close: FaceDetection = { ...d, boundingBox: { ...d.boundingBox, width: 450, height: 450 } };
    const v = framingVerdict(close, FRAME);
    expect(v.distanceOk).toBe(false);
    expect(v.messages.some((m) => /back/i.test(m))).toBe(true);
  });

  it('flags too far (bounding box too small)', () => {
    const d = wellFramed();
    const far: FaceDetection = { ...d, boundingBox: { ...d.boundingBox, width: 60, height: 60 } };
    const v = framingVerdict(far, FRAME);
    expect(v.distanceOk).toBe(false);
    expect(v.messages.some((m) => /closer/i.test(m))).toBe(true);
  });

  it('flags eyes too high in frame', () => {
    const d = wellFramed();
    const high: FaceDetection = { ...d, eyeKeypoints: [{ x: 280, y: 20 }, { x: 360, y: 20 }] };
    const v = framingVerdict(high, FRAME);
    expect(v.eyeLineOk).toBe(false);
  });

  it('flags eyes too low in frame', () => {
    const d = wellFramed();
    const low: FaceDetection = { ...d, eyeKeypoints: [{ x: 280, y: 400 }, { x: 360, y: 400 }] };
    const v = framingVerdict(low, FRAME);
    expect(v.eyeLineOk).toBe(false);
  });

  it('reports every failing check at once, not just the first', () => {
    const v = framingVerdict(
      {
        boundingBox: { originX: 500, originY: 0, width: 450, height: 450 },
        eyeKeypoints: [{ x: 510, y: 20 }, { x: 520, y: 20 }],
      },
      FRAME,
    );
    expect(v.centered).toBe(false);
    expect(v.distanceOk).toBe(false);
    expect(v.eyeLineOk).toBe(false);
    expect(v.messages.length).toBeGreaterThanOrEqual(3);
  });
});
```

- [x] **Step 2: Run to verify it fails**

Run: `pnpm --filter @loopcraft/web exec vitest run test/framing-analysis.test.ts`
Expected: FAIL — `Cannot find module '../src/lib/framing-analysis.js'`.

- [x] **Step 3: Write the implementation**

Create `apps/web/src/lib/framing-analysis.ts`:

```ts
/**
 * Purely geometric framing analysis. Every input here is a coordinate a face-detection model
 * already produced (a bounding box, two eye positions) -- nothing in this file performs
 * detection itself, and nothing here reads expression, identity, or any signal beyond pixel
 * position. That boundary is what keeps this "mechanical framing advice" (compliance page's
 * words) rather than anything the no-affect-inference guardrail would need to catch.
 */

export interface FaceDetection {
  readonly boundingBox: {
    readonly originX: number;
    readonly originY: number;
    readonly width: number;
    readonly height: number;
  };
  /** [rightEye, leftEye] in frame pixel coordinates, matching MediaPipe's keypoint order. */
  readonly eyeKeypoints: readonly [{ x: number; y: number }, { x: number; y: number }];
}

export interface FrameSize {
  readonly width: number;
  readonly height: number;
}

export interface FramingVerdict {
  readonly centered: boolean;
  readonly distanceOk: boolean;
  readonly eyeLineOk: boolean;
  readonly messages: readonly string[];
}

const CENTER_TOLERANCE = 0.15; // fraction of frame width
const MIN_FACE_WIDTH_FRACTION = 0.25; // below this, too far away
const MAX_FACE_WIDTH_FRACTION = 0.55; // above this, too close
const EYE_LINE_MIN_FRACTION = 0.3; // fraction of frame height
const EYE_LINE_MAX_FRACTION = 0.45;

export function framingVerdict(detection: FaceDetection, frame: FrameSize): FramingVerdict {
  const messages: string[] = [];

  const boxCenterX = detection.boundingBox.originX + detection.boundingBox.width / 2;
  const frameCenterX = frame.width / 2;
  const centered = Math.abs(boxCenterX - frameCenterX) <= CENTER_TOLERANCE * frame.width;
  if (!centered) messages.push('Center yourself in the frame.');

  const faceWidthFraction = detection.boundingBox.width / frame.width;
  const distanceOk =
    faceWidthFraction >= MIN_FACE_WIDTH_FRACTION && faceWidthFraction <= MAX_FACE_WIDTH_FRACTION;
  if (faceWidthFraction > MAX_FACE_WIDTH_FRACTION) messages.push('Move back a little.');
  else if (faceWidthFraction < MIN_FACE_WIDTH_FRACTION) messages.push('Move closer to the camera.');

  const [rightEye, leftEye] = detection.eyeKeypoints;
  const eyeY = (rightEye.y + leftEye.y) / 2;
  const eyeYFraction = eyeY / frame.height;
  const eyeLineOk = eyeYFraction >= EYE_LINE_MIN_FRACTION && eyeYFraction <= EYE_LINE_MAX_FRACTION;
  if (eyeYFraction < EYE_LINE_MIN_FRACTION) messages.push('Raise your camera, or sit up a little.');
  else if (eyeYFraction > EYE_LINE_MAX_FRACTION) messages.push('Lower your camera slightly.');

  return { centered, distanceOk, eyeLineOk, messages };
}
```

- [x] **Step 4: Run to verify it passes**

Run: `pnpm --filter @loopcraft/web exec vitest run test/framing-analysis.test.ts`
Expected: `Test Files  1 passed (1)`, `Tests  7 passed (7)`.

- [x] **Step 5: Lint check for the no-affect-inference rule**

Run: `pnpm exec eslint apps/web/src/lib/framing-analysis.ts apps/web/test/framing-analysis.test.ts`
Expected: clean (this step exists specifically to prove the geometric-only boundary holds under the project's own automated check, not just by inspection).

- [x] **Step 6: Commit**

```bash
git add apps/web/src/lib/framing-analysis.ts apps/web/test/framing-analysis.test.ts
git commit -m "feat(web): add framingVerdict, purely geometric camera-framing analysis"
```

---

### Task 4: `/api/users/me` — GET and PATCH

**Files:**
- Modify: `apps/web/src/server/routes.ts`
- Create: `apps/web/src/app/api/users/me/route.ts`
- Modify: `packages/db/src/seed-fixtures.ts`
- Modify: `apps/web/test/routes.integration.test.ts`

**Interfaces:**
- Consumes: `videoEligible` (Task 2), the existing `guard`/`toErrorResponse` chain, `ResolvedEntitlement.plan.allowsVideo` (existing).
- Produces: `getUserProfile(request, deps)` and `patchUserProfile(request, deps)` route handlers, an exported `UserProfileView` interface (`displayName: string | null`, `jurisdiction: string`, `ageBand: string`, `videoOptIn: boolean`, `videoEligible: boolean`), and the `patchUserProfileBody` zod schema. Consumed by Task 5 (settings page) and the app-router file in this task.

- [x] **Step 1: Add the fixture plan's `allows_video`, so the fully-eligible case is testable**

In `packages/db/src/seed-fixtures.ts`, find the plan insert (currently omits `allows_video`, so it defaults to `false`):

```ts
  await sql`
    insert into plans (id, name, price_cents, billing_period, included_sessions,
                       included_asr_minutes, allows_loop_simulation, allows_code_execution,
                       auto_renews)
      values (${FIXTURE.planId}, 'Pro (monthly)', 4900, 'monthly', 8, 400, true, true, true)
      on conflict (id) do nothing`;
```

Replace with (adds `allows_video` to the column list and `true` to the values, in the same
position as the `allows_video` column sits in the table):

```ts
  await sql`
    insert into plans (id, name, price_cents, billing_period, included_sessions,
                       included_asr_minutes, allows_loop_simulation, allows_code_execution,
                       allows_video, auto_renews)
      values (${FIXTURE.planId}, 'Pro (monthly)', 4900, 'monthly', 8, 400, true, true, true, true)
      on conflict (id) do nothing`;
```

- [x] **Step 2: Write the failing integration tests**

Add to `apps/web/test/routes.integration.test.ts` (new imports at the top, alongside the
existing ones from `../src/server/routes.js`):

```ts
import { getUserProfile, patchUserProfile } from '../src/server/routes.js';
```

Then append a new describe block at the end of the file:

```ts
describe('GET/PATCH /api/users/me (video eligibility settings)', () => {
  beforeEach(async () => {
    await withOwner(async (o) => {
      await o`update plans set allows_video = true where id = ${FIXTURE.planId}`;
      await o`update users set jurisdiction = 'unknown', age_band = 'unknown',
              video_opt_in = false, display_name = 'Candidate A' where id = ${FIXTURE.userA}`;
    });
  });

  const getReq2 = (): Request => new Request('https://loopcraft.test/api/users/me');
  const patchReq = (body: unknown): Request =>
    new Request('https://loopcraft.test/api/users/me', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'k-profile-1' },
      body: JSON.stringify(body),
    });

  it('starts not eligible for video (unknown jurisdiction, unknown age band, opted out)', async () => {
    const res = await getUserProfile(getReq2(), deps());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.jurisdiction).toBe('unknown');
    expect(body.ageBand).toBe('unknown');
    expect(body.videoOptIn).toBe(false);
    expect(body.videoEligible).toBe(false);
  });

  it('becomes eligible once jurisdiction, age band, and opt-in are all set', async () => {
    const patchRes = await patchUserProfile(
      patchReq({ jurisdiction: 'us_other', ageBand: '16_plus', videoOptIn: true }),
      deps(),
    );
    expect(patchRes.status).toBe(200);
    const body = await patchRes.json();
    expect(body.videoEligible).toBe(true);

    const getRes = await getUserProfile(getReq2(), deps());
    const getBody = await getRes.json();
    expect(getBody.videoEligible).toBe(true);
  });

  it('stays ineligible if jurisdiction is eu even with everything else set', async () => {
    const res = await patchUserProfile(
      patchReq({ jurisdiction: 'eu', ageBand: '16_plus', videoOptIn: true }),
      deps(),
    );
    const body = await res.json();
    expect(body.videoEligible).toBe(false);
  });

  it('rejects an unknown jurisdiction value', async () => {
    const res = await patchUserProfile(patchReq({ jurisdiction: 'mars' }), deps());
    expect(res.status).toBe(400);
  });

  it("user B cannot read or write user A's profile", async () => {
    await patchUserProfile(
      patchReq({ jurisdiction: 'us_other', ageBand: '16_plus', videoOptIn: true }),
      deps(),
    );
    const bRes = await getUserProfile(getReq2(), deps(FIXTURE.userB, FIXTURE.orgB));
    const bBody = await bRes.json();
    // RLS scopes the query to the caller's own row -- user B reads user B's row, which was
    // never touched by the PATCH above, not a 403/404. This asserts the isolation is real:
    // user B's own row stays at its own unrelated defaults, never user A's values.
    expect(bBody.jurisdiction).not.toBe('us_other');
  });
});
```

- [x] **Step 3: Run to verify the new tests fail**

Run: `pnpm --filter @loopcraft/web exec vitest run test/routes.integration.test.ts -t "video eligibility settings"`
Expected: FAIL — `getUserProfile`/`patchUserProfile` are not exported from `routes.js`.

- [x] **Step 4: Add the route handlers to `routes.ts`**

Add this import near the top of `apps/web/src/server/routes.ts`, alongside the existing
`assertFeature, assertSessionQuota` import:

```ts
import { videoEligible } from './video-eligibility.js';
```

Add this schema near `createSessionBody`/`submitTurnBody`:

```ts
export const patchUserProfileBody = z.object({
  displayName: z.string().min(1).max(200).optional(),
  jurisdiction: z.enum(['unknown', 'eu', 'illinois', 'us_other', 'other']).optional(),
  ageBand: z.enum(['unknown', 'under_13', '13_to_15', '16_plus']).optional(),
  videoOptIn: z.boolean().optional(),
});
```

Add this interface near `SessionView`:

```ts
export interface UserProfileView {
  readonly displayName: string | null;
  readonly jurisdiction: string;
  readonly ageBand: string;
  readonly videoOptIn: boolean;
  readonly videoEligible: boolean;
}

interface UserRow {
  readonly display_name: string | null;
  readonly jurisdiction: string;
  readonly age_band: string;
  readonly video_opt_in: boolean;
}

function toProfileView(row: UserRow, planAllowsVideo: boolean): UserProfileView {
  return {
    displayName: row.display_name,
    jurisdiction: row.jurisdiction,
    ageBand: row.age_band,
    videoOptIn: row.video_opt_in,
    videoEligible: videoEligible({
      jurisdiction: row.jurisdiction,
      ageBand: row.age_band,
      videoOptIn: row.video_opt_in,
      planAllowsVideo,
    }),
  };
}
```

Add these two route handlers after `getSession` (same file):

```ts
/** GET /api/users/me — the authenticated user's own profile, with computed video eligibility. */
export async function getUserProfile(request: Request, deps: RouteDeps): Promise<Response> {
  const errorId = randomUUID();
  try {
    const { user, entitlement } = await guard(request, deps, {
      schema: z.object({}),
      mutating: false,
      rateLimitBucket: 'users.read',
    });
    const row = await asUser(deps.sql, user.userId, async (tx) => {
      const rows = await tx<UserRow[]>`
        select display_name, jurisdiction, age_band, video_opt_in
        from users where id = ${user.userId}`;
      return rows[0];
    });
    if (row === undefined) {
      return json(404, { error: 'User not found.', code: 'not_found', errorId });
    }
    return json(200, toProfileView(row, entitlement.plan.allowsVideo));
  } catch (error) {
    const { status, body } = toErrorResponse(error, errorId);
    return json(status, body);
  }
}

/** PATCH /api/users/me — partial update; the response is always the post-update state. */
export async function patchUserProfile(request: Request, deps: RouteDeps): Promise<Response> {
  const errorId = randomUUID();
  try {
    const { user, entitlement, body } = await guard(request, deps, {
      schema: patchUserProfileBody,
      mutating: true,
      rateLimitBucket: 'users.update',
    });
    const row = await asUser(deps.sql, user.userId, async (tx) => {
      const rows = await tx<UserRow[]>`
        update users set
          display_name = coalesce(${body.displayName ?? null}, display_name),
          jurisdiction = coalesce(${body.jurisdiction ?? null}, jurisdiction),
          age_band = coalesce(${body.ageBand ?? null}, age_band),
          video_opt_in = coalesce(${body.videoOptIn ?? null}, video_opt_in)
        where id = ${user.userId}
        returning display_name, jurisdiction, age_band, video_opt_in`;
      return rows[0];
    });
    if (row === undefined) {
      return json(404, { error: 'User not found.', code: 'not_found', errorId });
    }
    return json(200, toProfileView(row, entitlement.plan.allowsVideo));
  } catch (error) {
    const { status, body } = toErrorResponse(error, errorId);
    return json(status, body);
  }
}
```

- [x] **Step 5: Wire the App Router file**

Create `apps/web/src/app/api/users/me/route.ts`:

```ts
import { getUserProfile, patchUserProfile } from '../../../../server/routes.js';
import { buildRouteDeps } from '../../../../server/deps.js';

export async function GET(request: Request): Promise<Response> {
  return getUserProfile(request, await buildRouteDeps());
}

export async function PATCH(request: Request): Promise<Response> {
  return patchUserProfile(request, await buildRouteDeps());
}
```

- [x] **Step 6: Run the new tests, and the full file, to verify they pass**

Run: `pnpm --filter @loopcraft/web exec vitest run test/routes.integration.test.ts`
Expected: every test in the file passes, including the 5 new ones (no regressions in the
existing tests from the fixture plan change in Step 1).

- [x] **Step 7: Typecheck and lint**

Run: `pnpm --filter @loopcraft/web run typecheck && pnpm exec eslint apps/web/src/server/routes.ts apps/web/src/app/api/users/me/route.ts apps/web/test/routes.integration.test.ts packages/db/src/seed-fixtures.ts`
Expected: both clean.

- [x] **Step 8: Commit**

```bash
git add apps/web/src/server/routes.ts apps/web/src/app/api/users/me/route.ts \
  packages/db/src/seed-fixtures.ts apps/web/test/routes.integration.test.ts
git commit -m "feat(web): add GET/PATCH /api/users/me with computed video eligibility"
```

---

### Task 5: Settings page

**Files:**
- Create: `apps/web/src/app/settings/page.tsx`
- Modify: `apps/web/src/app/layout.tsx`
- Modify: `apps/web/test/a11y.test.tsx`

**Interfaces:**
- Consumes: `GET`/`PATCH /api/users/me` (Task 4).
- Produces: default export `SettingsPage`, consumed by Task 8's Playwright walkthrough and by the a11y suite added in this task.

- [x] **Step 1: Add "Settings" to the header nav**

In `apps/web/src/app/layout.tsx`, find:

```ts
const NAV_LINKS = [
  { href: '/', label: 'Prepare' },
  { href: '/dashboard', label: 'Progress' },
  { href: '/calibration', label: 'How scoring works' },
  { href: '/compliance', label: 'Compliance' },
] as const;
```

Replace with:

```ts
const NAV_LINKS = [
  { href: '/', label: 'Prepare' },
  { href: '/dashboard', label: 'Progress' },
  { href: '/calibration', label: 'How scoring works' },
  { href: '/compliance', label: 'Compliance' },
  { href: '/settings', label: 'Settings' },
] as const;
```

- [x] **Step 2: Write the settings page**

Create `apps/web/src/app/settings/page.tsx`:

```tsx
'use client';

import { useEffect, useState, type ReactElement } from 'react';

interface Profile {
  displayName: string | null;
  jurisdiction: string;
  ageBand: string;
  videoOptIn: boolean;
  videoEligible: boolean;
}

const JURISDICTIONS: readonly { value: string; label: string }[] = [
  { value: 'unknown', label: 'Not set' },
  { value: 'eu', label: 'European Union' },
  { value: 'illinois', label: 'Illinois' },
  { value: 'us_other', label: 'Another US state' },
  { value: 'other', label: 'Elsewhere' },
];

const AGE_BANDS: readonly { value: string; label: string }[] = [
  { value: 'unknown', label: 'Not set' },
  { value: 'under_13', label: 'Under 13' },
  { value: '13_to_15', label: '13–15' },
  { value: '16_plus', label: '16 or older' },
];

const INPUT_CLASS =
  'mt-2 w-full rounded-md border border-neutral-200 p-2 text-sm text-neutral-900 focus:border-gold-600 focus:outline-none focus:ring-2 focus:ring-gold-600';

async function readJson<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

/**
 * Jurisdiction and age band are self-reported, not verified -- there is no identity
 * verification service in this product. The video opt-in toggle is disabled until both are
 * set to an eligible value: a disabled control with an explanation is more honest than one
 * that silently vanishes.
 */
export default function SettingsPage(): ReactElement {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      const res = await fetch('/api/users/me');
      if (cancelled) return;
      if (!res.ok) {
        setError('Could not load your settings.');
        return;
      }
      setProfile(await readJson<Profile>(res));
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function save(next: Partial<Profile>): Promise<void> {
    if (profile === null) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    const res = await fetch('/api/users/me', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
      body: JSON.stringify(next),
    });
    if (!res.ok) {
      const body = await readJson<{ error?: string }>(res);
      setError(body.error ?? `Could not save (HTTP ${res.status}).`);
      setSaving(false);
      return;
    }
    setProfile(await readJson<Profile>(res));
    setSaving(false);
    setSaved(true);
  }

  if (profile === null && error === null) {
    return <p className="text-neutral-600">Loading your settings…</p>;
  }

  const eligibleForOptIn =
    profile !== null && profile.jurisdiction !== 'unknown' && profile.ageBand !== 'unknown';

  return (
    <>
      <h1 className="text-3xl font-bold text-plum-900">Settings</h1>
      <p className="mt-2 max-w-[65ch] text-neutral-600">
        Your region and age band are self-reported — we don&rsquo;t verify them. They control
        whether the optional camera framing check is available to you.
      </p>

      {error !== null ? (
        <p role="alert" className="mt-4 text-sm font-medium text-danger">
          {error}
        </p>
      ) : null}

      {profile !== null ? (
        <div className="mt-6 max-w-[480px] rounded-lg border border-neutral-200 bg-white p-5 shadow-sm">
          <label htmlFor="displayName" className="block text-sm font-medium text-neutral-900">
            Display name
          </label>
          <input
            id="displayName"
            type="text"
            defaultValue={profile.displayName ?? ''}
            disabled={saving}
            className={INPUT_CLASS}
            onBlur={(e) => void save({ displayName: e.target.value })}
          />

          <label htmlFor="jurisdiction" className="mt-5 block text-sm font-medium text-neutral-900">
            Region
          </label>
          <select
            id="jurisdiction"
            value={profile.jurisdiction}
            disabled={saving}
            className={INPUT_CLASS}
            onChange={(e) => void save({ jurisdiction: e.target.value })}
          >
            {JURISDICTIONS.map((j) => (
              <option key={j.value} value={j.value}>
                {j.label}
              </option>
            ))}
          </select>

          <label htmlFor="ageBand" className="mt-5 block text-sm font-medium text-neutral-900">
            Age
          </label>
          <select
            id="ageBand"
            value={profile.ageBand}
            disabled={saving}
            className={INPUT_CLASS}
            onChange={(e) => void save({ ageBand: e.target.value })}
          >
            {AGE_BANDS.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-neutral-600">Self-reported. We don&rsquo;t verify this.</p>

          <div className="mt-6 flex items-start gap-3 border-t border-neutral-200 pt-5">
            <input
              id="videoOptIn"
              type="checkbox"
              checked={profile.videoOptIn}
              disabled={saving || !eligibleForOptIn}
              onChange={(e) => void save({ videoOptIn: e.target.checked })}
              className="mt-1"
            />
            <div>
              <label htmlFor="videoOptIn" className="text-sm font-medium text-neutral-900">
                Enable the camera framing check
              </label>
              <p className="mt-1 text-xs text-neutral-600">
                {eligibleForOptIn
                  ? 'Optional. Off by default. Checks how you’re framed in your camera before recording an answer — nothing is ever uploaded or stored.'
                  : 'Available once your region and age are set to an eligible value above.'}
              </p>
            </div>
          </div>

          {saved ? <p className="mt-4 text-sm text-neutral-600">Saved.</p> : null}
        </div>
      ) : null}
    </>
  );
}
```

- [x] **Step 3: Add the settings page to the a11y suite**

In `apps/web/test/a11y.test.tsx`, add the import alongside the existing page imports:

```ts
import SettingsPage from '../src/app/settings/page.js';
```

`SettingsPage` renders `null`-state markup (`profile === null`, no `error`) when statically
rendered outside a browser (its `useEffect` never fires under `renderToStaticMarkup`), so it
audits the loading state — add it to the routes table the same way `PrepPage` is audited.
Find:

```ts
    ['calibration', <CalibrationPage key="c" />],
    ['compliance', <CompliancePage key="x" />],
```

Replace with:

```ts
    ['calibration', <CalibrationPage key="c" />],
    ['compliance', <CompliancePage key="x" />],
    ['settings', <SettingsPage key="s" />],
```

There are two places this array literal appears in the file (the axe-violation table and the
banned-token/claims tables) — add the `SettingsPage` row to all of them, following the exact
pattern the existing three pages already use in each.

- [x] **Step 4: Run the a11y suite**

Run: `pnpm --filter @loopcraft/web run test:a11y`
Expected: all pass, including the new settings-page rows.

- [x] **Step 5: Typecheck and lint**

Run: `pnpm --filter @loopcraft/web run typecheck && pnpm exec eslint apps/web/src/app/settings/page.tsx apps/web/src/app/layout.tsx apps/web/test/a11y.test.tsx`
Expected: both clean.

- [x] **Step 6: Commit**

```bash
git add apps/web/src/app/settings/page.tsx apps/web/src/app/layout.tsx apps/web/test/a11y.test.tsx
git commit -m "feat(web): add the settings page (jurisdiction, age band, video opt-in)"
```

---

### Task 6: `CameraFramingCheck` component

**Files:**
- Modify: `apps/web/package.json`
- Create: `apps/web/src/components/CameraFramingCheck.tsx`

**Interfaces:**
- Consumes: `framingVerdict` (Task 3), `@mediapipe/tasks-vision`'s `FaceDetector`/`FilesetResolver`.
- Produces: `CameraFramingCheck` (no props — self-contained), consumed by Task 7 (session page).

- [x] **Step 1: Add the dependency**

In `apps/web/package.json`, add to `dependencies` (it runs in the browser bundle, not just
dev tooling, so it belongs in `dependencies` alongside `react`/`next`, not `devDependencies`):

```json
    "@mediapipe/tasks-vision": "1.0.1",
```

- [x] **Step 2: Install**

Run: `pnpm install`
Expected: lockfile updates, no errors.

- [x] **Step 3: Write the component**

Create `apps/web/src/components/CameraFramingCheck.tsx`:

```tsx
'use client';

import { useEffect, useRef, useState, type ReactElement } from 'react';
// Type-only import: erased entirely at compile time, so this costs nothing in the bundle --
// the WASM loader itself is only pulled in by the dynamic `import()` inside startCamera(),
// which is what actually keeps it out of every page that doesn't render this component.
import type { FaceDetector } from '@mediapipe/tasks-vision';
import { framingVerdict, type FramingVerdict } from '../lib/framing-analysis.js';

// A short-range, ~200KB model: bounding box + sparse keypoints only, no expression or
// identity output. Loaded from the same hosts the @mediapipe/tasks-vision docs use --
// this component is not an Artifact, so it is not subject to the Artifact CDN allowlist.
const WASM_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.task';

type Status = 'idle' | 'starting' | 'ready' | 'checked' | 'error';

/**
 * A one-time, opt-in camera framing check. No frame is ever uploaded: detection runs
 * entirely client-side (MediaPipe's WASM FaceDetector), and framingVerdict -- the only part
 * that decides what to tell the candidate -- is pure geometry over a bounding box and two
 * eye positions. The camera stream is stopped immediately when this component unmounts or
 * the check is dismissed; it is never left running in the background.
 */
export function CameraFramingCheck(): ReactElement {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [verdict, setVerdict] = useState<FramingVerdict | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<FaceDetector | null>(null);

  function stopCamera(): void {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }

  useEffect(() => stopCamera, []);

  async function startCamera(): Promise<void> {
    setStatus('starting');
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      streamRef.current = stream;
      if (videoRef.current !== null) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      const { FaceDetector, FilesetResolver } = await import('@mediapipe/tasks-vision');
      const vision = await FilesetResolver.forVisionTasks(WASM_BASE);
      detectorRef.current = await FaceDetector.createFromOptions(vision, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate: 'CPU' },
        runningMode: 'VIDEO',
      });
      setStatus('ready');
    } catch {
      setError('Could not access the camera. Check your browser permissions.');
      setStatus('error');
      stopCamera();
    }
  }

  function checkFraming(): void {
    if (videoRef.current === null || detectorRef.current === null) return;
    const result = detectorRef.current.detectForVideo(videoRef.current, performance.now());
    const detection = result.detections[0];
    const keypoints = detection?.keypoints;
    if (detection === undefined || keypoints === undefined || keypoints.length < 2) {
      setError('No face detected. Make sure you’re visible in the camera.');
      return;
    }
    setError(null);
    const box = detection.boundingBox;
    if (box === undefined) {
      setError('No face detected. Make sure you’re visible in the camera.');
      return;
    }
    const frame = { width: videoRef.current.videoWidth, height: videoRef.current.videoHeight };
    // boundingBox is already in pixel coordinates, but keypoints are normalized (0-1)
    // relative to the frame -- MediaPipe's FaceDetector uses different coordinate spaces
    // for the two, and framingVerdict expects both in pixels. Converting here, once, at the
    // one place raw detector output enters this codebase, is what keeps that inconsistency
    // from becoming a silent bug in the geometry itself.
    const toPixels = (p: { x: number; y: number }): { x: number; y: number } => ({
      x: p.x * frame.width,
      y: p.y * frame.height,
    });
    setVerdict(
      framingVerdict(
        {
          boundingBox: { originX: box.originX, originY: box.originY, width: box.width, height: box.height },
          eyeKeypoints: [toPixels(keypoints[0]!), toPixels(keypoints[1]!)],
        },
        frame,
      ),
    );
    setStatus('checked');
  }

  function dismiss(): void {
    stopCamera();
    setOpen(false);
    setStatus('idle');
    setVerdict(null);
    setError(null);
  }

  return (
    <details
      className="mt-4 rounded-lg border border-neutral-200 bg-white p-4"
      open={open}
      onToggle={(e) => {
        const isOpen = (e.target as HTMLDetailsElement).open;
        setOpen(isOpen);
        if (!isOpen) dismiss();
      }}
    >
      <summary className="cursor-pointer text-sm font-medium text-plum-700">
        Check your camera framing
      </summary>

      <div className="mt-3">
        {status === 'idle' ? (
          <button
            type="button"
            onClick={() => void startCamera()}
            className="rounded-md border border-plum-700 px-3 py-1.5 text-sm font-medium text-plum-700 hover:bg-plum-100"
          >
            Start camera check
          </button>
        ) : null}

        {status === 'starting' ? <p className="text-sm text-neutral-600">Starting camera…</p> : null}

        <video
          ref={videoRef}
          muted
          playsInline
          className={status === 'ready' || status === 'checked' ? 'mt-2 w-full max-w-xs rounded-md' : 'hidden'}
        />

        {status === 'ready' || status === 'checked' ? (
          <button
            type="button"
            onClick={checkFraming}
            className="mt-3 rounded-md bg-plum-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-plum-900"
          >
            {status === 'checked' ? 'Check again' : 'Check my framing'}
          </button>
        ) : null}

        {error !== null ? (
          <p role="alert" className="mt-2 text-sm font-medium text-danger">
            {error}
          </p>
        ) : null}

        {verdict !== null ? (
          <ul className="mt-3 space-y-1 text-sm">
            <li className={verdict.centered ? 'text-success' : 'text-neutral-900'}>
              {verdict.centered ? '✓ Centered' : '✗ Not centered'}
            </li>
            <li className={verdict.distanceOk ? 'text-success' : 'text-neutral-900'}>
              {verdict.distanceOk ? '✓ Good distance' : '✗ Distance needs adjusting'}
            </li>
            <li className={verdict.eyeLineOk ? 'text-success' : 'text-neutral-900'}>
              {verdict.eyeLineOk ? '✓ Eye line looks right' : '✗ Eye line needs adjusting'}
            </li>
          </ul>
        ) : null}
        {verdict !== null && verdict.messages.length > 0 ? (
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-neutral-600">
            {verdict.messages.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </details>
  );
}
```

- [x] **Step 4: Typecheck and lint**

Run: `pnpm --filter @loopcraft/web run typecheck && pnpm exec eslint apps/web/src/components/CameraFramingCheck.tsx`
Expected: both clean.

- [x] **Step 5: Commit**

```bash
git add apps/web/package.json pnpm-lock.yaml apps/web/src/components/CameraFramingCheck.tsx
git commit -m "feat(web): add CameraFramingCheck, the client-side one-shot framing check"
```

---

### Task 7: Wire eligibility into the session page

**Files:**
- Modify: `apps/web/src/server/routes.ts`
- Modify: `apps/web/src/app/session/[id]/page.tsx`
- Modify: `apps/web/test/routes.integration.test.ts`

**Interfaces:**
- Consumes: `videoEligible` (Task 2), `CameraFramingCheck` (Task 6).
- Produces: `SessionView.videoEligible: boolean` (new field), consumed by the session page's render logic.

- [x] **Step 1: Write the failing test**

Add to `apps/web/test/routes.integration.test.ts`, inside (or near) the existing session-flow
describe block — this asserts the field exists and reflects real eligibility state:

```ts
describe('session view carries video eligibility', () => {
  it('reflects the caller\'s current eligibility on the session view', async () => {
    await withOwner(async (o) => {
      await o`update plans set allows_video = true where id = ${FIXTURE.planId}`;
      await o`update users set jurisdiction = 'us_other', age_band = '16_plus',
              video_opt_in = true where id = ${FIXTURE.userA}`;
    });
    const { sessionId } = await startLoop(deps());
    const res = await getSession(getReq(), sessionId, deps());
    const body = await res.json();
    expect(body.videoEligible).toBe(true);
  });

  it('is false when the caller has not opted in, even if otherwise eligible', async () => {
    await withOwner(async (o) => {
      await o`update plans set allows_video = true where id = ${FIXTURE.planId}`;
      await o`update users set jurisdiction = 'us_other', age_band = '16_plus',
              video_opt_in = false where id = ${FIXTURE.userA}`;
    });
    const { sessionId } = await startLoop(deps());
    const res = await getSession(getReq(), sessionId, deps());
    const body = await res.json();
    expect(body.videoEligible).toBe(false);
  });
});
```

(`getReq` and `startLoop` already exist earlier in this file — reuse them, do not redefine.)

- [x] **Step 2: Run to verify it fails**

Run: `pnpm --filter @loopcraft/web exec vitest run test/routes.integration.test.ts -t "video eligibility"`
Expected: FAIL — `body.videoEligible` is `undefined`.

- [x] **Step 3: Add `videoEligible` to `SessionView` and `getSession`**

In `apps/web/src/server/routes.ts`, find the `SessionView` interface and add one field at
the end:

```ts
export interface SessionView {
  readonly sessionId: string;
  readonly status: SessionState['session']['status'];
  readonly trackId: string;
  readonly levelBand: string;
  readonly roundCount: number;
  readonly currentRoundPosition: number;
  readonly currentRoundType: string | null;
  readonly persona: string | null;
  readonly question: string | null;
  readonly pendingTurnId: string | null;
  readonly answeredTurnCount: number;
  readonly videoEligible: boolean;
}
```

`toView()` builds a `SessionView` from a `SessionState` alone, which has no access to the
user row or entitlement — rather than thread those through every `toView()` caller (most of
which don't need this field), change only `getSession`, the one caller that renders a client
view and has both available. Replace `toView()`'s return type usage there: find

```ts
export async function getSession(
  request: Request,
  sessionId: string,
  deps: RouteDeps,
): Promise<Response> {
  const errorId = randomUUID();
  try {
    const { user } = await guard(request, deps, {
      schema: z.object({}),
      mutating: false,
      rateLimitBucket: 'sessions.read',
    });
    const view = await asUser(deps.sql, user.userId, async (tx) =>
      toView(await loadSession(tx, sessionId)));
    return json(200, view);
  } catch (error) {
    const { status, body } = toErrorResponse(error, errorId);
    return json(status, body);
  }
}
```

Replace with:

```ts
export async function getSession(
  request: Request,
  sessionId: string,
  deps: RouteDeps,
): Promise<Response> {
  const errorId = randomUUID();
  try {
    const { user, entitlement } = await guard(request, deps, {
      schema: z.object({}),
      mutating: false,
      rateLimitBucket: 'sessions.read',
    });
    const view = await asUser(deps.sql, user.userId, async (tx) => {
      const state = await loadSession(tx, sessionId);
      const rows = await tx<UserRow[]>`
        select display_name, jurisdiction, age_band, video_opt_in
        from users where id = ${user.userId}`;
      const row = rows[0];
      const eligible = row === undefined
        ? false
        : videoEligible({
            jurisdiction: row.jurisdiction,
            ageBand: row.age_band,
            videoOptIn: row.video_opt_in,
            planAllowsVideo: entitlement.plan.allowsVideo,
          });
      return { ...toView(state), videoEligible: eligible };
    });
    return json(200, view);
  } catch (error) {
    const { status, body } = toErrorResponse(error, errorId);
    return json(status, body);
  }
}
```

(`UserRow` and `videoEligible` were already added in Task 4 — no new import needed beyond
what Task 4 introduced.)

- [x] **Step 4: Run to verify it passes**

Run: `pnpm --filter @loopcraft/web exec vitest run test/routes.integration.test.ts`
Expected: every test in the file passes, including the 2 new ones.

- [x] **Step 5: Render `CameraFramingCheck` on the session page**

In `apps/web/src/app/session/[id]/page.tsx`, add the import:

```ts
import { CameraFramingCheck } from '../../../components/CameraFramingCheck.js';
```

Add `videoEligible: boolean;` to the local `SessionView` interface in this file (it has its
own copy, separate from the server one, matching this file's existing pattern of declaring
its own view types rather than importing server types into a client component):

```ts
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
  readonly videoEligible: boolean;
}
```

Find the question-card section:

```tsx
      {view.status === 'in_progress' && view.question !== null ? (
        <section
          aria-labelledby="question-heading"
          className="mt-6 max-w-[65ch] rounded-lg border border-neutral-200 bg-white p-5 shadow-sm"
        >
          <h2 id="question-heading" className="text-lg font-semibold text-plum-900">
            Question
          </h2>
          <p className="mt-2 text-neutral-900">{view.question}</p>
```

Add the framing check right after the closing `</section>` of that block (i.e., as a sibling,
not nested inside the question card, since it isn't part of answering — it's a pre-check),
conditioned on eligibility:

```tsx
      {view.status === 'in_progress' && view.videoEligible ? (
        <div className="max-w-[65ch]">
          <CameraFramingCheck />
        </div>
      ) : null}
```

- [x] **Step 6: Typecheck and lint**

Run: `pnpm --filter @loopcraft/web run typecheck && pnpm exec eslint apps/web/src/server/routes.ts "apps/web/src/app/session/[id]/page.tsx" apps/web/test/routes.integration.test.ts`
Expected: both clean.

- [x] **Step 7: Commit**

```bash
git add apps/web/src/server/routes.ts "apps/web/src/app/session/[id]/page.tsx" apps/web/test/routes.integration.test.ts
git commit -m "feat(web): surface the camera framing check on eligible sessions"
```

---

### Task 8: Full verification and manual walkthrough

**Files:** none (verification only).

**Interfaces:** none — consumes every file from Tasks 1–7 as a whole.

- [x] **Step 1: Full workspace test suite**

Run: `pnpm run test`
Expected: every package's tests pass, including the new `video-eligibility.test.ts` (11),
`framing-analysis.test.ts` (7), and the extended `routes.integration.test.ts` and
`a11y.test.tsx`.

- [x] **Step 2: Lint, typecheck, build**

Run: `pnpm exec eslint . && pnpm run typecheck && pnpm --filter @loopcraft/web run build`
Expected: all three clean — the build step is what proves `@mediapipe/tasks-vision`'s dynamic
`import()` in `CameraFramingCheck.tsx` doesn't break Next's production bundling.

- [x] **Step 3: Fix the live demo plan, or the walkthrough's last step cannot pass**

`packages/db/src/seed-dev.ts` seeds `demo-free` — the plan every real browser session
actually runs on via `dev-identity.ts`'s auto-provisioning — with `allows_video: false`, and
its `on conflict (id) do update set` clause only refreshes `included_sessions` and
`allows_loop_simulation`, so simply changing the seed `VALUES` and re-running would not
update the row that already exists in the live Supabase database. Without this step, item 5
of Step 4's walkthrough below cannot show the framing check appearing no matter what is set
on `/settings`, because
`videoEligible` also requires `planAllowsVideo`, and the live demo account would still be on
a plan that reports `false` for it.

Edit `packages/db/src/seed-dev.ts`:

```ts
import type { Sql } from './client.js';

/**
 * Dev-only plan row. Test fixtures (seed-fixtures.ts) seed 'pro-monthly'; this seeds a
 * zero-price, generous-limit plan so a fresh dev database can serve real traffic without
 * anyone having to fill in billing numbers first. Auto-renews is false, so it never trips
 * the renewal-consent constraint trigger (spec §5.4).
 */
export const DEV_PLAN_ID = 'demo-free';

export async function seedDevPlan(sql: Sql): Promise<void> {
  await sql`
    insert into plans (id, name, price_cents, billing_period, included_sessions,
                       included_asr_minutes, allows_loop_simulation, allows_code_execution,
                       allows_video, auto_renews)
    values (${DEV_PLAN_ID}, 'Demo', 0, 'free', 100, 400, true, false, true, false)
    on conflict (id) do update set
      included_sessions = excluded.included_sessions,
      allows_loop_simulation = excluded.allows_loop_simulation,
      allows_video = excluded.allows_video`;
}
```

The code fix above is what makes a *fresh* database seed correctly from now on. The row in
the live Supabase database already exists, so it needs a direct one-time update too (reads
`DATABASE_URL` from `apps/web/.env.local`, same sourcing pattern as Task 1 Step 3):

```bash
cd apps/web && set -a && source .env.local && set +a && \
psql "$DATABASE_URL" -c "update plans set allows_video = true where id = 'demo-free'"
```

Verify: `psql "$DATABASE_URL" -c "select id, allows_video from plans where id = 'demo-free'"`
Expected: `allows_video` is `t`.

Commit:

```bash
git add packages/db/src/seed-dev.ts
git commit -m "fix(db): make the live demo plan allow video, and let re-seeding update it"
```

- [x] **Step 4: Playwright walkthrough of the settings flow (real, verifiable)**

Start the dev server, then using the `mcp__playwright__*` tools:
1. Navigate to `/settings`. Confirm the video-opt-in checkbox renders `disabled` (jurisdiction
   and age band both start `unknown` for a fresh account).
2. Set jurisdiction to "European Union," confirm the checkbox stays disabled.
3. Set jurisdiction to "Another US state" and age band to "16 or older." Confirm the
   checkbox becomes enabled, with helper text changing accordingly.
4. Check the box. Reload `/settings`. Confirm the checkbox is still checked (proves the
   PATCH persisted, not just client state).
5. Navigate to `/`, start a loop, confirm the "Check your camera framing" disclosure now
   appears on the session page. Before doing this step, confirm the "before" state was
   really ineligible and this isn't just always-on: query
   `select jurisdiction, age_band, video_opt_in from users where id = '<the demo cookie's
   user id>'` directly (find the id from the `lc_uid` cookie in the browser, or from
   `select id from users order by created_at desc limit 1` against the live database) and
   confirm it reads `unknown` / `unknown` / `false` before step 1 of this walkthrough.
6. Set jurisdiction back to "European Union" on `/settings`. Return to a session page.
   Confirm the disclosure no longer appears — proves the gate is live, not cached.

- [x] **Step 5: Document the camera/WASM verification limit honestly**

Do not click "Start camera check" in Step 4's walkthrough and claim the live detection was
verified — this environment cannot grant real or faked camera access through the available
Playwright MCP tools (no `--use-fake-device-for-media-stream` control surface). Confirm the
disclosure element and its "Start camera check" button render and are keyboard-reachable,
which is what static/DOM verification can honestly prove; state plainly in the final report
that the actual `getUserMedia` → MediaPipe → `framingVerdict` pipeline is real code, unit-
tested at the `framingVerdict` boundary, but not exercised end-to-end against a live camera
in this pass — same disclosure standard already applied to `VoiceAnswerButton.tsx` earlier
in this build.

- [x] **Step 6: Commit any fixes found during the walkthrough**

If Step 4 surfaces a defect, fix it in the relevant task's file and commit with a message
describing what the walkthrough caught. If nothing is found, no commit is needed here —
Tasks 1–7's commits already represent the complete, verified change.

---

## Completion record — 2026-09-02

Task 8 was the outstanding task. Executed in full against the live Supabase database the dev
server uses; every state transition below was confirmed both in the browser and by a direct
`psql` query, so none of it rests on client-side appearance alone.

**Steps 1–2, automated gates**

| Gate | Result |
| --- | --- |
| `pnpm run test` | 9 successful, 9 total — 677 tests, 0 failures, 1 skipped |
| `pnpm exec eslint .` | clean |
| `pnpm run typecheck` | 8 successful, 8 total |
| `pnpm --filter @loopcraft/web run build` | compiled successfully; `@mediapipe/tasks-vision`'s dynamic `import()` does not break production bundling |

**Step 4 found a real defect before the walkthrough could pass.** Item 2 requires the opt-in
checkbox to *stay disabled* when the region is the European Union. It did not: the settings
page gated the control on `jurisdiction !== 'unknown' && ageBand !== 'unknown'`, while
`videoEligible` permits only `us_other`/`other` at `16_plus`. An EU, Illinois or under-16 user
could therefore tick "Enable the camera framing check", have it persist, and never see the
feature — consent UI reporting a state the product will not honour, in precisely the area
where spec §5.1 and §5.2 are strictest.

Fixed in `fix(web): stop offering the video opt-in where the gate prohibits it`:

- `lib/video-opt-in.ts` is now the single definition of the self-reported half of the gate;
  `videoEligible` delegates to it, so page and server cannot drift apart again.
- The disabled state names its specific reason rather than giving one vague sentence.
- `PATCH /api/users/me` clears a stored opt-in when an update leaves the user in a prohibited
  region or age band, so a recorded consent cannot outlive the eligibility that justified
  collecting it.
- `test/settings-gate.test.tsx` mounts the page against a stubbed profile to cover the wiring
  the static a11y audit never reaches — it only ever renders the loading branch. The suite was
  confirmed to fail (4 of 8) against the previous gate.

**Step 4 walkthrough, after the fix.** Before state confirmed by direct query:
`jurisdiction=unknown, age_band=unknown, video_opt_in=false`.

| # | Action | Observed |
| --- | --- | --- |
| 1 | Load `/settings` fresh | checkbox `disabled`, "Available once your region and age are set above." |
| 2 | Region → European Union, age → 16+ | checkbox **stays** `disabled`, "Not available in your region…" |
| 3 | Region → Another US state | checkbox becomes enabled, helper text switches to the opt-in description |
| 4 | Tick the box, reload | still checked; `psql` confirms `us_other / 16_plus / t` |
| 5 | Start a loop | "Check your camera framing" disclosure appears on the session page |
| 6 | Region → European Union, return to the session | disclosure gone; `psql` confirms `video_opt_in` went `t → f` |

Item 6 exercises the new consent-clearing behaviour as well as the gate, and proves the gate
is live rather than cached.

**Step 5 — the camera/WASM verification limit, stated plainly.** "Start camera check" was
never clicked. This environment cannot grant real or faked camera access through the available
Playwright MCP tools, so a click would prove nothing and claiming otherwise would be false.
What was verified is what DOM inspection can honestly establish: the `<details>` disclosure
renders, its summary reads "Check your camera framing", and its "Start camera check" button is
present, enabled, and keyboard-reachable (`tabIndex 0`).

The `getUserMedia` → MediaPipe → `framingVerdict` pipeline is real code and is unit-tested at
the `framingVerdict` boundary (7 tests), but it has **not** been exercised end to end against a
live camera in this pass. That is the same disclosure standard already applied to
`VoiceAnswerButton.tsx` earlier in this build, and it remains the one part of this feature
that a browser-driven run with a fake media device still needs to cover.
