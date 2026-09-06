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

## What is not built yet

- **Voice answers.** The web client records with `MediaRecorder`; the native equivalent is
  `expo-av`, and the upload route already accepts raw audio with a Bearer token.
- **The camera framing check.** MediaPipe's WASM detector does not run in React Native; this
  needs `react-native-vision-camera` with a frame processor, which is a real port rather than
  a wiring job.
- **Billing.** App Store rules require in-app purchase for digital goods, so this cannot simply
  open the Stripe Checkout URL. Subscriptions must be bought on the web or via StoreKit.
- **Push notifications.** Needs `expo-notifications` plus APNs and FCM credentials.

None of these block signing in, running a loop, or reading a graded debrief.
