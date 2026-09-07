# InterviewSoftware — native app

An Expo (React Native) client for iOS and Android. It is a **thin client**: it has no backend
of its own, calls the same Next.js API routes the web app does, authenticates against the same
Supabase project, and is gated by the same guard chain and RLS policies.

That is deliberate. Grading, question generation, entitlement resolution and every compliance
rule live server-side, so the two clients cannot drift on any of them. The loop catalogue comes
from `@loopcraft/core`, the same module the web app imports.

## Running it

```sh
cp .env.example .env      # then fill it in
pnpm install
pnpm --filter @loopcraft/mobile start
```

`EXPO_PUBLIC_API_BASE_URL` must be reachable **from the device**. On the iOS simulator
`localhost` is the host machine and works; on a physical phone use your machine's LAN address
or a deployed URL.

## Why the Supabase keys are public here

They ship inside the binary and anyone can extract them. That is expected: the anon key grants
nothing on its own, because every table is behind RLS and every route behind the guard chain.
The **service role** key must never appear in this app.

## What works

Sign up (with the same age and region gate the web form applies), sign in, browse the loop
catalogue, run a full loop, answer by typing **or by voice**, hear the interviewer speak the
question, get a graded debrief, edit your profile, and delete your account.

## Bundling in a pnpm monorepo

`metro.config.js` exists because Metro needed four things that `tsc` resolves natively — so
the app typechecked cleanly while being impossible to bundle. Each was found by running
`expo export`, and each comment in that file says what broke:

1. Workspace packages live outside the app and resolve through symlinks (`watchFolders`).
2. `@loopcraft/core/catalog` is a package-exports subpath, which Metro ignores. Turning on
   `unstable_enablePackageExports` globally fixes it and immediately breaks expo-router, which
   deep-imports its own `build/qualified-entry`; the workspace subpath is resolved explicitly
   instead.
3. `disableHierarchicalLookup` — a hoisted-monorepo flag — makes packages unable to resolve
   themselves under pnpm's nested layout. It is deliberately NOT set.
4. `@babel/runtime` is a direct dependency, because Babel emits helper imports from it and
   pnpm does not hoist it where Metro looks.

## What is still not built

- **The camera framing check.** MediaPipe's WASM detector has no React Native equivalent; this
  needs `react-native-vision-camera` with a frame processor and a native face detector. A real
  port, not a wiring job. Everything else about video eligibility already works: the toggle in
  Settings reads the server's decision and respects the EU/Illinois prohibition.
- **Billing.** App Store rules require in-app purchase for digital goods, so this cannot simply
  open the Stripe Checkout URL. Subscriptions are bought on the web, or through StoreKit.
- **Push notifications.** Needs `expo-notifications` plus APNs and FCM credentials.

## What has NOT been verified

The app **bundles** (`expo export` produces a 2.9 MB iOS bundle containing this code) and
typechecks. It has **not been run in a simulator or on a device** from the environment it was
built in, so no screen has been seen rendering and no request has been observed leaving the
app. The API it calls is covered by 309 server-side tests; the client is not.
