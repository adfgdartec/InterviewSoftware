# Authentication: real accounts, replacing the demo cookie

## Context

`apps/web/src/server/deps.ts` wires the guard chain's `authenticate` to `demoIdentity()`.
That function reads an `lc_uid` cookie and, when it is missing, provisions a brand-new row
in `users`, a new `org`, a `membership` and an **active entitlement** — with no email, no
password, no consent step and no age question. Every visitor silently becomes a real,
entitled account. The row-level security underneath is genuine and enforced; only the
"prove who you are" step is a cookie that regenerates when cleared.

This is finding 1 of the sale-readiness review, and it is the blocker under four separate
roadmap items: notifications, email retention, SMS retention and payments all need an
account with a verified contact address and a recorded consent, and none of them can be
built on a regenerating cookie.

Three facts from the existing schema shape this design more than any preference does:

- **`loopcraft.current_user_id()` (migration 0000) already reads `request.jwt.claims ->> 'sub'`**
  before falling back to `app.current_user_id`. The database was written for Supabase Auth
  from the first migration.
- **Auth is already provisioned on the linked project** — `supabase/.temp/gotrue-version`
  exists, so GoTrue is running on the Supabase instance the app already talks to.
- **`users` already carries the columns this needs**: `email text not null unique`,
  `age_band` (whose comment reads "Spec §5.2: gate at 13+, 16+ in the EU"), `jurisdiction`,
  and `deleted_at`. What is missing is entirely application-layer.

The seam is one function. `RouteDeps.authenticate(request): Promise<AuthedUser | null>` is
the whole interface between identity and everything else. The guard chain, `asUser`, every
RLS policy and all 693 existing tests sit below that line and are not touched by this work.

## Goals

- Real accounts: email + password with confirmation, plus Google OAuth as the fast path.
- A verified, deliverable email address on every account — the prerequisite for the
  notification and email-retention work that follows.
- An age and jurisdiction gate enforced server-side at signup, so `/compliance`'s sentence
  "Accounts are gated at 13+, and 16+ in the EU" becomes true rather than aspirational.
- A stored, timestamped, versioned record that each user accepted the terms and privacy
  notice.
- `demoIdentity` made structurally incapable of running in production, rather than merely
  discouraged.
- No provider credential in the browser bundle — the same guardrail 6 posture every other
  client in this repo already holds.

## Explicit non-goals (scope boundary)

- **Account deletion and data purging.** `users.deleted_at` exists; a job that purges rows,
  stored files and provider-side data does not. It is a real obligation (finding 3 and 4 of
  the review) and it is a genuinely separate build — cascade order, provider deletion APIs,
  a retention schedule to publish. Its own spec, immediately after this one.
- **Phone numbers and SMS.** No `phone` column here. It belongs with the SMS consent
  columns in the SMS spec; half of it now would be worse than none of it.
- **Organizations, teams, invitations, roles.** One user still maps to one org, exactly as
  today. The `memberships.role` column keeps its existing values and nothing reads them yet.
- **SSO / SAML.** Enterprise concern; this product is sold to individuals.
- **Branded transactional email templates.** Supabase's default confirmation and reset
  emails are used as-is. Branded templates arrive with the email-retention spec, which is
  where a verified sending domain gets set up anyway.
- **Migrating existing demo rows.** They are anonymous cookie users with
  `@demo.loopcraft.local` addresses. They stay in the database, orphaned. No claim flow.

## Approach: Supabase Auth, driven entirely server-side

Chosen over the alternatives because of the schema, not in spite of it. `current_user_id()`
already speaks Supabase's JWT, so the RLS policies need zero changes. Auth.js or Lucia would
mean minting our own JWTs with a matching `sub` claim purely to arrive where Supabase already
is. Clerk or WorkOS would introduce a second identity source of truth plus per-MAU cost, for
a product that already pays for Supabase.

### No browser Supabase client

The standard Supabase Next.js integration puts `NEXT_PUBLIC_SUPABASE_ANON_KEY` in the browser
bundle. That **fails this repo's own build**: `apps/web/test/no-client-secrets.test.ts`
asserts no source file matches `/NEXT_PUBLIC_[A-Z0-9_]*(KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL)/`,
and Supabase's newer "publishable key" naming still contains `KEY`.

The right resolution is not an exemption. The whole auth surface runs server-side:

- Sign-in and sign-up are **Server Actions** that call `supabase.auth.signInWithPassword` /
  `signUp` on the server.
- Google OAuth start is a server-generated redirect from `signInWithOAuth`.
- `/auth/callback` is a **route handler** that exchanges the code for a session.

The browser never holds a Supabase client, so no key reaches the bundle, the forms work
without JavaScript, and `no-client-secrets.test.ts` stays a real gate rather than one with a
carve-out. Credentials are read through `packages/providers/src/secrets.ts` like every other
credential in the repo, so the existing "exactly one module reads credentials" test keeps
passing.

New dependencies in `apps/web` only: `@supabase/supabase-js` and `@supabase/ssr`. The latter
supplies `createServerClient` with a cookie adapter over `next/headers`.

### `authenticate()` must verify, not trust

`apps/web/src/server/auth.ts` exports the new `authenticate(request)`. It calls
**`supabase.auth.getUser()`**, which validates the token against the Auth server, and never
`getSession()`, which decodes the cookie without verifying it. Reversing those two is the
standard Supabase SSR vulnerability — a forged cookie authenticates. A test asserts the call
site, because this is a mistake that type-checks and passes every functional test.

On a valid session it maps to `AuthedUser` by reading the user's `memberships` row for the
org id. On a missing, expired or invalid session it returns `null`, and the guard chain's
existing `UnauthorizedError` produces the 401 it already produces today.

If Supabase's copy of the address differs from `public.users.email` (the user changed it),
`authenticate` refreshes our column. One comparison per request, a write essentially never.

## Identity and provisioning

`public.users.id` is set equal to the Supabase auth user id, so `current_user_id()` resolves
through either of its branches. `asUser` continues to set `app.current_user_id` exactly as it
does today; the JWT branch stays unused by this application and is left in place for
Supabase's own PostgREST.

`provisionUser(sql, input)` in `apps/web/src/server/provisioning.ts` performs the same four
inserts `demoIdentity` does today — `users`, `orgs`, `memberships`, `entitlements` — behind a
real identity, plus the age band, jurisdiction and consent record. It runs on the existing
Postgres owner connection (`ownerClient()`), for the same reason `demoIdentity` does: RLS
cannot authorize a brand-new user's own first rows, because there is no membership row to
check against until this function creates one. That is the same boundary a real auth webhook
runs at. Note this is the database owner role, **not** a Supabase service-role key — no such
key is needed anywhere in this spec, because the signup gate runs before `signUp` and so there
is never an auth user to administratively undo.

It is **idempotent**: a second sign-in for an already-provisioned user is a no-op returning
the existing identity, not a duplicate org.

Provisioning deliberately runs in the application rather than as a Postgres trigger on
`auth.users`, which is Supabase's documented pattern. The signup form collects the age band,
jurisdiction and terms acceptance that must be written atomically with the user row, and a
trigger cannot see them without routing them through `raw_user_meta_data` — more indirection,
and untestable in this repo's vitest harness, which is where the rest of the route layer is
proven.

## The signup gate

A pure function, `signupPermitted`, in `apps/web/src/server/signup-gate.ts`, mirroring the
shape of `videoEligible` and `videoOptInPermitted` that already exist:

```ts
export interface SignupGateInput {
  readonly ageBand: string;
  readonly jurisdiction: string;
}

export function signupPermitted(input: SignupGateInput): boolean {
  if (input.ageBand === 'unknown' || input.ageBand === 'under_13') return false;
  if (input.ageBand === '13_to_15') {
    // An unstated jurisdiction cannot be ruled out as the EU, so it is refused rather than
    // assumed non-EU. Only an explicitly non-EU region admits a 13-15 account.
    return input.jurisdiction === 'illinois'
      || input.jurisdiction === 'us_other'
      || input.jurisdiction === 'other';
  }
  return true;
}
```

`under_13` is refused outright: COPPA's verifiable-parental-consent regime is out of scope
for this product and `/compliance` states a 13+ floor. `13_to_15` is admitted only where the
jurisdiction is explicitly non-EU, because the same sentence states a 16+ floor there and an
unstated region is not evidence of being outside it. `unknown` age is refused. The signup form
requires both fields, so neither `unknown` should reach this function in practice — it refuses
them anyway, because the function has to be correct on its own, which is the point of it being
pure and exhaustively table-tested. Fail-closed throughout, the same rule the video gate
already follows.

The gate is enforced in the Server Action before `signUp` is called, so a refused account is
never created in `auth.users` at all.

## Schema: migration `0008_auth_identity.sql`

```sql
set search_path = public, loopcraft;

alter table users add column terms_accepted_at timestamptz;
alter table users add column terms_version text;
alter table users add column privacy_version text;
alter table users add column auth_provider text
  check (auth_provider in ('password', 'google'));
```

No new RLS policy is needed: `users_self_read` and `users_self_update` from migration 0002
are not column-specific and cover these automatically. No `not null` defaults, because
existing demo rows predate consent and backfilling a consent timestamp they never gave would
be a fabricated legal record.

## Retiring `demoIdentity`

Not deleted — gated. It runs only when `LOOPCRAFT_DEV_IDENTITY=1`, and throws outright when
`NODE_ENV === 'production'` regardless of that flag. A test asserts both halves, so it cannot
ship enabled by an environment mistake.

Nothing in the test suite depends on it: `routes.integration.test.ts` builds its own
`authenticate: async () => ({ userId, orgId })` in its `deps()` helper. Only the running dev
server uses it.

## Routes and middleware

New pages: `/signin`, `/signup`, `/auth/reset`, `/auth/reset/confirm`. New route handler:
`/auth/callback`. All four pages are added to `apps/web/test/a11y.test.tsx`'s audited-routes
table — added to the gate, not exempted from it.

New `apps/web/src/middleware.ts` refreshes the Supabase session cookie and redirects
unauthenticated requests for `/dashboard`, `/session/*` and `/settings` to `/signin`. `/`,
`/calibration` and `/compliance` stay public: they are the marketing and legal surfaces, and
a compliance position paper behind a login is worth nothing. API routes need no middleware
change — they already 401 through the guard chain.

The header's `NAV_LINKS` gains a sign-in / sign-out affordance. Signed-out visitors see
"Sign in"; signed-in users see their display name and a sign-out action.

## Configuration

| Variable | Notes |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | A URL, not a secret. Does not trip the `NEXT_PUBLIC_` gate. |
| `SUPABASE_ANON_KEY` | Server-side only, read through `secrets.ts`. Deliberately not `NEXT_PUBLIC_`. |
| `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` | From Google Cloud Console, with the callback URI registered both there and in Supabase. |

`turbo.json`'s test `env` list gains these so a cached run is not mistaken for a real one.

## Testing

- `apps/web/test/signup-gate.test.ts` — table-driven over every age band × every
  jurisdiction, asserting `unknown` never passes and that each refusal reason is independent.
- `apps/web/test/auth.test.ts` — `authenticate()` returns `null` for a missing, malformed and
  expired token; maps a valid one to the right `AuthedUser`; and calls `getUser()` rather
  than `getSession()`.
- `apps/web/test/routes.integration.test.ts` (extended) — `provisionUser` creates exactly one
  user, org, membership and entitlement against the real test database; a second call for the
  same identity is a no-op; the provisioned user's own routes then work end to end through
  the real guard chain, and another user still cannot read their session.
- `apps/web/test/a11y.test.tsx` (extended) — the four new pages audited like the other six.
- A test asserting `demoIdentity` throws when `NODE_ENV === 'production'`.

## Verification limits, stated up front

Two paths cannot be honestly verified in this environment, and the plan will say so rather
than claim otherwise:

- **The Google OAuth round trip.** Completing it needs real Google Cloud credentials and a
  publicly reachable redirect URI. What is verifiable here is that the redirect URL is
  correctly generated and that `/auth/callback` handles a code exchange and an error response
  correctly; the actual hop through Google's consent screen is not.
- **Email confirmation and password reset delivery.** Both require a real inbox. The Server
  Actions and the reset pages are verifiable; that Supabase's mail actually arrives is not,
  until a sending domain exists — which is the email-retention spec's first task.

Everything else — the gate, provisioning, `authenticate`, the middleware redirects, and the
production refusal of `demoIdentity` — is verifiable against the real test database and is
covered above.
