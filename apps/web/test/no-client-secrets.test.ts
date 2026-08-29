import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Phase 0 exit criterion "no secrets client-side", and acceptance criterion 5: no API key,
 * file path, provider payload or public storage URL is reachable from the client.
 *
 * The audited prototype leaked a masked key suffix and absolute upload paths through debug
 * response fields and served private video from a guessable public bucket path, so these
 * checks scan the committed tree rather than trusting review.
 */

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

function trackedFiles(): string[] {
  return execFileSync('git', ['ls-files'], { cwd: REPO, encoding: 'utf8' })
    .split('\n')
    .filter((f) => f.length > 0);
}

const SOURCE_EXTENSIONS = /\.(ts|tsx|js|jsx|mjs|cjs|py|json|yml|yaml|sql|env|example)$/;

/** This test file necessarily contains the patterns it searches for. */
const SELF = 'apps/web/test/no-client-secrets.test.ts';

function sources(): { path: string; text: string }[] {
  return trackedFiles()
    .filter((f) => SOURCE_EXTENSIONS.test(f) && f !== SELF)
    .map((path) => ({ path, text: readFileSync(join(REPO, path), 'utf8') }));
}

describe('no credentials are committed', () => {
  it('contains no literal provider key', () => {
    const literalKey = /\b(sk-ant-|sk-proj-|sk-live-|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{20,})/;
    const offenders = sources()
      .filter(({ text }) => literalKey.test(text))
      .map(({ path }) => path);
    expect(offenders).toEqual([]);
  });

  it('exposes no credential through a NEXT_PUBLIC_ variable', () => {
    const publicSecret = /NEXT_PUBLIC_[A-Z0-9_]*(KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL)/;
    const offenders = sources()
      .filter(({ text }) => publicSecret.test(text))
      .map(({ path }) => path);
    expect(offenders).toEqual([]);
  });

  it('commits no .env file', () => {
    expect(trackedFiles().filter((f) => /(^|\/)\.env($|\.)/.test(f) && !f.endsWith('.example')))
      .toEqual([]);
  });
});

describe('no public storage URL is constructed anywhere (guardrail 6)', () => {
  it('builds no public object URL', () => {
    // The prototype's pattern: a bucket host concatenated with an object key, no signature.
    const publicBucket =
      /(storage\.googleapis\.com|\.s3\.[a-z0-9-]*\.?amazonaws\.com|\/storage\/v1\/object\/public\/)/;
    const offenders = sources()
      .filter(({ path }) => !path.startsWith('docs/'))
      .filter(({ text }) => publicBucket.test(text))
      .map(({ path }) => path);
    expect(offenders).toEqual([]);
  });

  it('reads provider credentials through exactly one module', () => {
    // Shipped code must not name a credential env var inline; it goes through
    // readCredential, which is the only place that touches process.env for one.
    const inlineReaders = sources()
      .filter(({ path }) => /^(packages|apps\/web\/src)\//.test(path) && !path.includes('/test/'))
      .filter(({ text }) => /process\.env\[?['"`][A-Z0-9_]*(KEY|SECRET|TOKEN)/.test(text))
      .map(({ path }) => path);
    expect(inlineReaders).toEqual([]);

    const secretsModule = sources().find(
      ({ path }) => path === 'packages/providers/src/secrets.ts',
    );
    expect(secretsModule?.text).toMatch(/export function readCredential/);
  });
});
