#!/usr/bin/env node
/**
 * Deployment preflight: what is configured, what is missing, and what each gap costs.
 *
 * Written because the alternative is discovering a missing key from a 500 in production, or
 * from a bill. Every entry says what BREAKS without it rather than just naming a variable,
 * because "SUPABASE_ANON_KEY is not set" does not tell you that nobody can sign in.
 *
 *   node scripts/preflight.mjs              # reads the current environment
 *   node scripts/preflight.mjs --env-file apps/web/.env.local
 *
 * Exit code 1 if anything REQUIRED for the checked target is missing, so CI can gate on it.
 */

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const repoFile = (relative) => join(REPO_ROOT, relative);

const args = process.argv.slice(2);
const envFileIndex = args.indexOf('--env-file');
if (envFileIndex !== -1) {
  const path = args[envFileIndex + 1];
  try {
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (match !== null && process.env[match[1]] === undefined) {
        process.env[match[1]] = match[2];
      }
    }
  } catch {
    console.error(`Could not read ${path}`);
    process.exit(1);
  }
}

/** `required` means the product is broken without it, not merely degraded. */
const CHECKS = [
  {
    group: 'Database',
    items: [
      ['DATABASE_URL', true, 'Migrations and the owner connection. Nothing works without it.'],
      ['DATABASE_APP_URL', true, 'The RLS-scoped app connection every request uses.'],
    ],
  },
  {
    group: 'Authentication',
    items: [
      ['NEXT_PUBLIC_SUPABASE_URL', true, 'Sign-in, sign-up and session refresh. A URL, not a secret.'],
      ['SUPABASE_ANON_KEY', true, 'Same. Deliberately NOT NEXT_PUBLIC_, so it stays out of the bundle.'],
      ['GOOGLE_OAUTH_CLIENT_ID', false, 'Only the "Continue with Google" button. Password sign-in works without it.'],
      ['GOOGLE_OAUTH_CLIENT_SECRET', false, 'Same.'],
    ],
  },
  {
    group: 'Providers',
    items: [
      ['OPENAI_API_KEY', true, 'Grading AND question generation. Without it every debrief 503s.'],
      ['DEEPGRAM_API_KEY', false, 'Answering by voice. Typing still works; the button reports 503 honestly.'],
      ['CARTESIA_API_KEY', false, 'The interviewer speaking. The question is still on screen.'],
    ],
  },
  {
    group: 'Billing',
    items: [
      ['STRIPE_SECRET_KEY', false, 'Taking money. Checkout 503s without it; the product still runs.'],
      ['STRIPE_WEBHOOK_SECRET', false, 'Verifying webhooks. Without it payments succeed and entitlements NEVER update.'],
    ],
  },
];

/**
 * Configuration that is not an env var but will still stop a launch.
 *
 * These were a hardcoded list of TODOs printed unconditionally, which meant the report went
 * stale the moment any of them was actually done -- it was still reporting "No document
 * exists" for the terms and privacy notice two commits after both shipped. Each one now reads
 * the repository and reports what is true, so a finished item disappears from the list on its
 * own and an unfinished one cannot be forgotten.
 *
 * Each returns { done, detail }. `null` from a check means "cannot tell from here" -- a live
 * database or a Cloudflare account is needed -- which is reported as its own state rather
 * than guessed either way.
 */

/** Placeholders brand.ts ships with. Matching one means nobody has set the real value yet. */
const BRAND_PLACEHOLDERS = ['InterviewSoftware', 'support@interviewsoftware.ai'];

function checkVendorRates() {
  try {
    const rates = JSON.parse(readFileSync(repoFile('packages/core/src/rates.json'), 'utf8'));
    const unpriced = [];
    const walk = (node, path) => {
      for (const [key, val] of Object.entries(node)) {
        if (key.startsWith('$') || key === 'asOf' || key === 'currency') continue;
        const here = path === '' ? key : `${path}.${key}`;
        if (val !== null && typeof val === 'object') walk(val, here);
        else if (val === null) unpriced.push(here);
      }
    };
    walk(rates, '');
    if (unpriced.length === 0) {
      return { done: true, detail: `packages/core/src/rates.json fully priced, read ${rates.asOf}.` };
    }
    return {
      done: false,
      detail:
        `packages/core/src/rates.json — ${unpriced.length} still null (${unpriced.join(', ')}). ` +
        'Any null fails the margin gate by design; see rates-sources.md.',
    };
  } catch (error) {
    return { done: false, detail: `packages/core/src/rates.json could not be read: ${error.message}` };
  }
}

function checkLegalDocuments() {
  const pages = [
    ['terms', 'apps/web/src/app/terms/page.tsx'],
    ['privacy notice', 'apps/web/src/app/privacy/page.tsx'],
  ];
  const missing = pages.filter(([, path]) => !existsSync(repoFile(path))).map(([name]) => name);
  return missing.length === 0
    ? { done: true, detail: 'terms and privacy notice both render (findings 3 and 4).' }
    : { done: false, detail: `No document exists for: ${missing.join(', ')}. Required before taking money.` };
}

function checkBrand() {
  try {
    const source = readFileSync(repoFile('packages/core/src/brand.ts'), 'utf8');
    const held = BRAND_PLACEHOLDERS.filter((placeholder) => source.includes(`'${placeholder}'`));
    return held.length === 0
      ? { done: true, detail: 'packages/core/src/brand.ts names a real entity and inbox.' }
      : {
          done: false,
          detail: `packages/core/src/brand.ts still holds placeholders: ${held.join(', ')}. Both legal documents render them.`,
        };
  } catch (error) {
    return { done: false, detail: `packages/core/src/brand.ts could not be read: ${error.message}` };
  }
}

function checkHyperdrive() {
  try {
    const config = readFileSync(repoFile('apps/web/wrangler.jsonc'), 'utf8');
    // Comment-stripped rather than JSON-parsed: wrangler.jsonc carries comments by design.
    const active = config.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    return /"hyperdrive"\s*:/.test(active)
      ? { done: true, detail: 'apps/web/wrangler.jsonc declares a hyperdrive binding.' }
      : {
          done: false,
          detail: 'apps/web/wrangler.jsonc declares no hyperdrive binding. Workers reach Postgres through it; needs the Workers Paid plan.',
        };
  } catch (error) {
    return { done: false, detail: `apps/web/wrangler.jsonc could not be read: ${error.message}` };
  }
}

const MANUAL = [
  ['Vendor rates', checkVendorRates],
  [
    'Plan prices',
    // Rows in a live database; a static check would have to guess, so it says so instead.
    () => ({
      done: null,
      detail: '`plans.price_cents` and `plans.stripe_price_id`, in the deployed database. A plan with no price id returns plan_not_sellable.',
    }),
  ],
  ['Terms + privacy notice', checkLegalDocuments],
  ['Legal entity + support inbox', checkBrand],
  ['Hyperdrive binding', checkHyperdrive],
];

const value = (name) => {
  const v = process.env[name];
  return v === undefined || v === '' ? null : v;
};

let missingRequired = 0;
let missingOptional = 0;

console.log('\nDeployment preflight\n' + '='.repeat(60));

for (const { group, items } of CHECKS) {
  console.log(`\n${group}`);
  for (const [name, required, why] of items) {
    const present = value(name) !== null;
    if (present) {
      console.log(`  ok        ${name}`);
      continue;
    }
    if (required) {
      missingRequired += 1;
      console.log(`  MISSING   ${name}\n            ${why}`);
    } else {
      missingOptional += 1;
      console.log(`  optional  ${name}\n            ${why}`);
    }
  }
}

// Two mistakes worth failing on rather than warning about, because both are silent.
console.log('\nGuardrails');
const publicSecret = Object.keys(process.env).find(
  (k) => /^NEXT_PUBLIC_/.test(k) && /(KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL)$/.test(k),
);
if (publicSecret !== undefined) {
  missingRequired += 1;
  console.log(`  FAIL      ${publicSecret} would be inlined into the browser bundle.`);
} else {
  console.log('  ok        no credential is exposed through a NEXT_PUBLIC_ variable');
}

if (value('LOOPCRAFT_DEV_IDENTITY') === '1' && process.env['NODE_ENV'] === 'production') {
  missingRequired += 1;
  console.log('  FAIL      LOOPCRAFT_DEV_IDENTITY=1 in production would hand every visitor an account.');
} else {
  console.log('  ok        the demo identity cannot run here');
}

console.log('\nNot environment variables, but still required to sell');
let manualOutstanding = 0;
for (const [what, check] of MANUAL) {
  const { done, detail } = check();
  if (done === true) {
    console.log(`  ok        ${what}\n            ${detail}`);
    continue;
  }
  manualOutstanding += 1;
  console.log(`  ${done === null ? 'check' : 'todo '}     ${what}\n            ${detail}`);
}

console.log('\n' + '='.repeat(60));
console.log(
  `${missingRequired} required missing · ${missingOptional} optional missing · ` +
    `${manualOutstanding} still required to sell\n`,
);
process.exit(missingRequired > 0 ? 1 : 0);
