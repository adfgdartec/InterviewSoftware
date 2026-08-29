import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

/**
 * Marketing-claim gate. Spec §5.3 and guardrail 3: no string anywhere may assert hiring
 * probability, a guaranteed offer, or a success rate.
 *
 * The banned-phrase list is parsed out of `docs/claims-policy.md` rather than duplicated
 * here, so the published policy and the enforced check cannot drift. Editing the document
 * changes the gate.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
export const CLAIMS_POLICY_PATH = resolve(HERE, '../../../docs/claims-policy.md');

function extractFencedBlock(markdown: string, language: string): string[] {
  const fence = new RegExp('```' + language + '\\r?\\n([\\s\\S]*?)```', 'm');
  const match = fence.exec(markdown);
  if (match === null) {
    throw new Error(
      `docs/claims-policy.md is missing its \`\`\`${language} block; the claims gate cannot run.`,
    );
  }
  const body = match[1];
  if (body === undefined) throw new Error(`Empty ${language} block in docs/claims-policy.md`);
  return body
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

let cached: { banned: RegExp[]; required: string[] } | null = null;

function loadPolicy(): { banned: RegExp[]; required: string[] } {
  if (cached !== null) return cached;
  const markdown = readFileSync(CLAIMS_POLICY_PATH, 'utf8');
  cached = {
    banned: extractFencedBlock(markdown, 'banned-claims').map((p) => new RegExp(p, 'i')),
    required: extractFencedBlock(markdown, 'required-claims'),
  };
  return cached;
}

/** The compiled banned-claim patterns, sourced from docs/claims-policy.md. */
export function bannedClaimPatterns(): readonly RegExp[] {
  return loadPolicy().banned;
}

/** Disclosures that must be present somewhere in the product. */
export function requiredDisclosures(): readonly string[] {
  return loadPolicy().required;
}

export interface ClaimViolation {
  readonly stringKey: string;
  readonly value: string;
  readonly pattern: string;
}

/**
 * Scans a catalog of user-facing strings. Returns every violation rather than the first,
 * so a failing build reports the whole surface at once.
 */
export function findClaimViolations(catalog: Readonly<Record<string, string>>): ClaimViolation[] {
  const violations: ClaimViolation[] = [];
  for (const pattern of bannedClaimPatterns()) {
    for (const [stringKey, value] of Object.entries(catalog)) {
      if (pattern.test(value)) {
        violations.push({ stringKey, value, pattern: pattern.source });
      }
    }
  }
  return violations;
}

/** Disclosures from the policy that no string in the catalog satisfies. */
export function findMissingDisclosures(catalog: Readonly<Record<string, string>>): string[] {
  const values = Object.values(catalog);
  return requiredDisclosures().filter(
    (disclosure) => !values.some((value) => value.includes(disclosure)),
  );
}
