# Deploying

Three environments, one per branch. No domain is required — every environment is live on its
own `*.workers.dev` address until you attach one.

| Branch    | Wrangler env | Worker name                  | Purpose                        |
| --------- | ------------ | ---------------------------- | ------------------------------ |
| `test`    | `test`       | `interviewsoftware-test`     | Throwaway. Safe to break.      |
| `staging` | `staging`    | `interviewsoftware-staging`  | Production-shaped rehearsal.   |
| `main`    | `production` | `interviewsoftware`          | Production.                    |

Pushing to a branch deploys it. `.github/workflows/deploy.yml` resolves the environment from
the branch name; there is no manual environment picker, because the thing that decides where
code lands should be the thing that decides what code it is.

## What is already true

- `apps/web` **builds for Workers** via `@opennextjs/cloudflare`, and the built worker has been
  run under `workerd` locally and served `/`, `/compliance`, `/calibration`, `/signin` and
  `/signup` at 200.
- `apps/web/wrangler.jsonc` declares all three environments.
- `.github/workflows/deploy.yml` builds and deploys on push; `ci.yml` runs the full suite
  (Postgres, Ollama, sandbox, a11y) on all three branches and on every PR.

## What you have to do once

### 1. Cloudflare credentials, as GitHub repository secrets

Create an API token at **Cloudflare dashboard → My Profile → API Tokens**, using the
**Edit Cloudflare Workers** template. Then in **GitHub → Settings → Secrets and variables →
Actions**:

| Name                    | Kind     | Value                                   |
| ----------------------- | -------- | --------------------------------------- |
| `CLOUDFLARE_API_TOKEN`  | Secret   | the token you just created              |
| `CLOUDFLARE_ACCOUNT_ID` | Secret   | dashboard → Workers & Pages → Account ID |
| `NEXT_PUBLIC_SUPABASE_URL` | Variable | `https://<ref>.supabase.co`           |

`NEXT_PUBLIC_SUPABASE_URL` is a **variable**, not a secret: it is a URL, it is read at build
time as well as at runtime, and it is not a credential. Every actual credential is set with
`wrangler secret put` below and never passes through CI.

### 2. Per-environment secrets

Run once per environment. These live in Cloudflare, not in the repo, not in CI:

```sh
cd apps/web
for env in test staging production; do
  pnpm exec wrangler secret put SUPABASE_ANON_KEY --env $env
  pnpm exec wrangler secret put OPENAI_API_KEY    --env $env
  pnpm exec wrangler secret put DEEPGRAM_API_KEY  --env $env
  pnpm exec wrangler secret put CARTESIA_API_KEY  --env $env
done
```

Use **separate Supabase projects** for test/staging and production if you can. Sharing one
means a staging bug can delete production rows, and row-level security will not save you from
code that is legitimately authenticated.

### 3. The database — the one thing that needs a paid plan

The app talks to Postgres over TCP through `postgres.js`. Workers reach Postgres through
**Hyperdrive**, which needs the **Workers Paid plan ($5/month)**.

Until that exists, every environment will serve pages and refuse every database route. That
is a deliberate ordering: you can see the deploy working before you spend anything.

When you are ready:

```sh
pnpm exec wrangler hyperdrive create interviewsoftware-prod \
  --connection-string "postgres://…"    # the Supabase session pooler string
```

Then uncomment the `hyperdrive` binding in each environment in `apps/web/wrangler.jsonc` and
point `appClient()` at `env.HYPERDRIVE.connectionString`.

> **Known characteristic, not a bug.** Hyperdrive's docs advise against wrapping several
> operations in one transaction to hold `SET` state. That is exactly what `asUser()` does on
> every request, and it is not optional — it is how row-level security is enforced. It is
> *correct* (transaction-scoped `SET` is supported, and the `true` flag stops values leaking
> across pooled connections); the cost is that each in-flight request pins a pooled
> connection. Size the Hyperdrive connection limit deliberately and load-test it. Do **not**
> move the `SET` out of the transaction — that trades a throughput characteristic for a
> cross-tenant data leak.

### 4. Attaching a domain, later

One edit. In `apps/web/wrangler.jsonc`, under the environment you want:

```jsonc
"routes": [
  { "pattern": "example.com", "custom_domain": true },
  { "pattern": "www.example.com", "custom_domain": true }
],
"workers_dev": false
```

Set `workers_dev` to `false` at the same time, so the product has exactly one address. Add the
zone to Cloudflare and point the registrar's nameservers at it first.

## Deploying by hand

```sh
pnpm --filter @loopcraft/web run cf:deploy:test
pnpm --filter @loopcraft/web run cf:deploy:staging
pnpm --filter @loopcraft/web run cf:deploy:production
```

`pnpm --filter @loopcraft/web run cf:preview` runs the built worker locally under `workerd`,
which is closer to production than `next dev` and is where Workers-only problems surface.

## Still to resolve before production traffic

- **No authentication is not the problem any more, but exposure still is.** Until you are
  ready for the public, put **Cloudflare Access** in front of the production worker (Zero
  Trust → Access → Applications → Self-hosted, allow your own email). Remove the policy when
  you open up.
- **`apps/worker` (Python) is not deployed.** Nothing calls it yet. When delivery metrics get
  wired, either port its nine pure functions to TypeScript or run it in a Container.
- **`packages/sandbox` cannot run on Workers.** It shells out to macOS `sandbox-exec`. The web
  app now imports only `@loopcraft/sandbox/hints` — a subpath that carries no
  `node:child_process` — so the coding round is the only thing blocked, not the deploy.
- **Ollama is unreachable from a Worker.** `registry.ts` makes it primary for every reasoning
  purpose with OpenAI as fallback, so in production every call falls through to OpenAI. Your
  real unit costs are the fallback tier.
- **The rate limiter and the TTS cache are per-process.** Both are `Map`s, and Workers run
  many isolates, so neither does its job across more than one. Move them to a Durable Object
  and KV before real traffic — the rate limiter is the only thing standing between an account
  and unbounded provider spend.
