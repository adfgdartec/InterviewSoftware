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

import { readFileSync } from 'node:fs';

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

/** Configuration that is not an env var but will still stop a launch. */
const MANUAL = [
  ['Vendor rates', 'packages/core/src/rates.json — all null fails the margin gate by design.'],
  ['Plan prices', '`plans.price_cents` and `plans.stripe_price_id`. A plan with no price id cannot be sold.'],
  ['Terms + privacy notice', 'No document exists. Required before taking money (findings 3 and 4).'],
  ['Legal entity + support inbox', 'packages/core/src/brand.ts still holds placeholders.'],
  ['Hyperdrive binding', 'Workers reach Postgres through it. Needs the Workers Paid plan.'],
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
for (const [what, detail] of MANUAL) console.log(`  todo      ${what}\n            ${detail}`);

console.log('\n' + '='.repeat(60));
console.log(`${missingRequired} required missing · ${missingOptional} optional missing\n`);
process.exit(missingRequired > 0 ? 1 : 0);
