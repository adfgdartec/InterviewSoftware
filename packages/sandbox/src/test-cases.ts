import { runInSandbox, type RunResult } from './runner.js';
import type { SandboxLimits } from './limits.js';

/**
 * Hidden test cases (spec §2.2). The candidate sees the visible cases; the hidden ones decide
 * correctness, and their inputs are never returned to the client -- only pass/fail counts and
 * the outcome of each, so a candidate cannot reconstruct the bank by submitting probes.
 */

export interface TestCase {
  readonly id: string;
  readonly stdin: string;
  readonly expectedStdout: string;
  /** Visible cases are shown in the editor; hidden ones are not (spec §2.2). */
  readonly visible: boolean;
  /** Boundary cases are reported separately: they are what separates level 3 from level 4. */
  readonly boundary: boolean;
}

export type CaseOutcome = 'passed' | 'wrong_output' | 'crashed' | 'timeout' | 'out_of_memory' | 'sandbox_unavailable';

export interface CaseResult {
  readonly id: string;
  readonly visible: boolean;
  readonly boundary: boolean;
  readonly outcome: CaseOutcome;
  readonly durationMs: number;
  /** Populated for visible cases only; hidden expectations never cross to the client. */
  readonly expected: string | null;
  readonly actual: string | null;
}

export interface SubmissionResult {
  readonly cases: readonly CaseResult[];
  readonly passed: number;
  readonly total: number;
  readonly boundaryPassed: number;
  readonly boundaryTotal: number;
  readonly allPassed: boolean;
}

function classify(run: RunResult, expected: string): CaseOutcome {
  switch (run.outcome) {
    case 'timeout':
      return 'timeout';
    case 'out_of_memory':
      return 'out_of_memory';
    case 'sandbox_unavailable':
      return 'sandbox_unavailable';
    case 'cpu_exhausted':
      return 'timeout';
    case 'nonzero_exit':
    case 'output_truncated':
      return 'crashed';
    case 'ok':
      return normalize(run.stdout) === normalize(expected) ? 'passed' : 'wrong_output';
  }
}

/** Trailing whitespace on the final line is not a correctness signal. */
function normalize(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '').replace(/\n+$/, '');
}

/**
 * Runs a submission against every case. Cases run sequentially rather than in parallel: the
 * per-user concurrency cap in spec §2.2 exists so one candidate cannot saturate the host,
 * and fanning out a submission's own cases would defeat it.
 */
export async function runSubmission(
  code: string,
  cases: readonly TestCase[],
  limits?: Partial<SandboxLimits>,
): Promise<SubmissionResult> {
  if (cases.length === 0) throw new RangeError('A submission needs at least one test case.');

  const results: CaseResult[] = [];
  for (const testCase of cases) {
    const run = await runInSandbox(code, { stdin: testCase.stdin, ...(limits ? { limits } : {}) });
    const outcome = classify(run, testCase.expectedStdout);
    results.push({
      id: testCase.id,
      visible: testCase.visible,
      boundary: testCase.boundary,
      outcome,
      durationMs: run.durationMs,
      expected: testCase.visible ? testCase.expectedStdout : null,
      actual: testCase.visible ? run.stdout : null,
    });
  }

  const passed = results.filter((r) => r.outcome === 'passed').length;
  const boundary = results.filter((r) => r.boundary);
  return {
    cases: results,
    passed,
    total: results.length,
    boundaryPassed: boundary.filter((r) => r.outcome === 'passed').length,
    boundaryTotal: boundary.length,
    allPassed: passed === results.length,
  };
}

/**
 * Maps a submission onto the `correctness` anchors of ml-systems.coding.v1. Boundary cases
 * are what separate "correct on the happy path" from "boundaries handled deliberately",
 * which is why they are tracked separately rather than folded into one pass rate.
 */
export function scoreCorrectness(result: SubmissionResult): 1 | 2 | 3 | 4 | 5 {
  if (result.passed === 0) return 1;
  const nonBoundaryTotal = result.total - result.boundaryTotal;
  const nonBoundaryPassed = result.passed - result.boundaryPassed;
  if (nonBoundaryTotal > 0 && nonBoundaryPassed < nonBoundaryTotal) return 2;
  if (result.boundaryTotal === 0) return result.allPassed ? 3 : 2;
  if (result.boundaryPassed === 0) return 2;
  if (result.boundaryPassed < result.boundaryTotal) return 3;
  return result.allPassed ? 4 : 3;
}
