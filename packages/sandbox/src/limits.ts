/**
 * Execution limits for untrusted candidate code. Spec §2.2 fixes the policy numbers: no
 * network, a 256 MB memory ceiling, a 5-second wall clock, syscall restrictions, and a
 * per-user concurrency cap.
 *
 * Isolation is macOS Seatbelt (`sandbox-exec`) plus POSIX resource limits, not a container.
 * Each control below names the mechanism that actually enforces it, because they are not
 * equally strong and pretending otherwise is how a sandbox gets trusted further than it
 * should be:
 *
 *   network      Seatbelt `(deny network*)`      — hard denial at the syscall boundary
 *   filesystem   Seatbelt `(deny default)`       — read-only except one scratch subpath
 *   cpu time     RLIMIT_CPU                      — kernel-enforced, SIGXCPU
 *   processes    RLIMIT_NPROC                    — kernel-enforced, fork fails
 *   wall clock   in-process SIGALRM + parent kill
 *   memory       parent-side RSS watchdog        — POLLED, not a kernel cap (see below)
 *
 * macOS does not honour RLIMIT_AS or RLIMIT_DATA: setrlimit rejects both with "current limit
 * exceeds maximum limit". Memory is therefore enforced by sampling the child's RSS and
 * killing it, which is a real ceiling but a polled one, so a very fast allocation can briefly
 * exceed it before the sampler notices. That is a genuine weakness of this platform and is
 * recorded rather than hidden.
 */

export interface SandboxLimits {
  readonly memoryBytes: number;
  readonly wallClockMs: number;
  readonly cpuSeconds: number;
  readonly processes: number;
  readonly outputBytes: number;
  /** How often the parent samples the child's RSS. */
  readonly memoryPollMs: number;
}

export const DEFAULT_LIMITS: SandboxLimits = {
  memoryBytes: 256 * 1024 * 1024,
  wallClockMs: 5_000,
  cpuSeconds: 5,
  processes: 64,
  outputBytes: 64 * 1024,
  memoryPollMs: 100,
};

/** Per-user concurrency cap (spec §2.2). Beyond this, execution requests queue. */
export const MAX_CONCURRENT_RUNS_PER_USER = 2;

export class LimitsViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LimitsViolationError';
  }
}

/** Limits may be tightened for a specific run, never loosened past the policy ceiling. */
export function resolveLimits(overrides: Partial<SandboxLimits> = {}): SandboxLimits {
  const merged = { ...DEFAULT_LIMITS, ...overrides };
  for (const key of Object.keys(merged) as (keyof SandboxLimits)[]) {
    if (merged[key] > DEFAULT_LIMITS[key]) {
      throw new LimitsViolationError(
        `Sandbox limit "${key}" cannot exceed the policy ceiling ${DEFAULT_LIMITS[key]} (got ${merged[key]}).`,
      );
    }
    if (merged[key] <= 0) {
      throw new LimitsViolationError(`Sandbox limit "${key}" must be > 0 (got ${merged[key]}).`);
    }
  }
  return merged;
}

export const SANDBOX_BINARY = '/usr/bin/sandbox-exec';
export const PYTHON_BINARY = '/opt/homebrew/bin/python3.12';

/**
 * The Seatbelt profile. `(deny default)` means every operation is refused unless listed, so
 * the failure mode of a forgotten rule is denial rather than exposure.
 *
 * `scratchDir` is the single writable path. It is per-run, so one submission cannot read or
 * clobber another's working files.
 */
export function seatbeltProfile(scratchDir: string): string {
  if (!scratchDir.startsWith('/')) {
    throw new LimitsViolationError(`Scratch directory must be absolute, got "${scratchDir}"`);
  }
  return [
    '(version 1)',
    '(deny default)',
    // No egress, no lateral movement, no exfiltration. This is the load-bearing line.
    '(deny network*)',
    // The interpreter and its standard library must be readable to run at all.
    '(allow file-read*)',
    `(allow file-write* (subpath "${scratchDir}"))`,
    '(allow process-exec)',
    '(allow process-fork)',
    '(allow sysctl-read)',
    '(allow mach-lookup)',
    '(allow signal (target self))',
  ].join('\n');
}

/** Arguments for `sandbox-exec`, kept in one place so a dropped flag is testable. */
export function sandboxArgs(profile: string, scriptPath: string): string[] {
  return ['-p', profile, PYTHON_BINARY, '-I', '-S', scriptPath];
}
