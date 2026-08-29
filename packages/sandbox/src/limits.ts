/**
 * Execution limits for untrusted candidate code. Spec §2.2 fixes these numbers: no network,
 * a 256 MB memory ceiling, a 5-second wall clock, seccomp restrictions, and a per-user
 * concurrency cap.
 *
 * They live in one module because a limit that can be raised at a call site is not a limit.
 * `hardenedRunArgs` is the only place container flags are constructed, and a test asserts
 * every one of them is present -- a dropped `--network none` is invisible until it matters.
 */

export interface SandboxLimits {
  readonly memoryBytes: number;
  readonly wallClockMs: number;
  readonly cpus: number;
  readonly pids: number;
  readonly tmpfsBytes: number;
  readonly outputBytes: number;
}

/**
 * Grace added to the host-side kill timer on top of the candidate's wall clock. Container
 * cold start is roughly 0.6-1.5s and is not the candidate's to spend: charging startup
 * against a 5-second budget fails correct submissions on a loaded host. The candidate's
 * clock is enforced inside the container; this is only the backstop for a container that
 * never reaches Python at all.
 */
export const CONTAINER_STARTUP_GRACE_MS = 15_000;

export const DEFAULT_LIMITS: SandboxLimits = {
  memoryBytes: 256 * 1024 * 1024,
  wallClockMs: 5_000,
  cpus: 1,
  pids: 64,
  tmpfsBytes: 16 * 1024 * 1024,
  outputBytes: 64 * 1024,
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

export const SANDBOX_IMAGE = 'python:3.12-alpine';

/**
 * The complete `docker run` argument list. Every flag here is load-bearing:
 *
 *   --network none              no egress, no lateral movement, no exfiltration
 *   --memory / --memory-swap    equal values disable swap, so the ceiling is real
 *   --pids-limit                fork bombs die instead of exhausting the host
 *   --read-only                 root filesystem is immutable
 *   --tmpfs /tmp                the one writable path, size-capped and noexec
 *   --cap-drop ALL              no capabilities at all
 *   --security-opt no-new-privileges  setuid binaries cannot escalate
 *   --user 65534:65534          nobody; never root, even inside the container
 *   --workdir /tmp              the only writable directory
 */
export function hardenedRunArgs(
  limits: SandboxLimits,
  image: string = SANDBOX_IMAGE,
  containerName?: string,
): string[] {
  return [
    'run',
    '--rm',
    '--interactive',
    // tini as PID 1: reaps orphaned children and forwards signals, so a submission that
    // forks does not leave processes alive inside the namespace after its parent exits.
    '--init',
    ...(containerName === undefined ? [] : ['--name', containerName]),
    '--network', 'none',
    '--memory', `${limits.memoryBytes}b`,
    '--memory-swap', `${limits.memoryBytes}b`,
    '--cpus', String(limits.cpus),
    '--pids-limit', String(limits.pids),
    '--read-only',
    '--tmpfs', `/tmp:rw,noexec,nosuid,size=${limits.tmpfsBytes}`,
    '--cap-drop', 'ALL',
    '--security-opt', 'no-new-privileges',
    '--user', '65534:65534',
    '--workdir', '/tmp',
    '--env', 'HOME=/tmp',
    '--env', 'PYTHONDONTWRITEBYTECODE=1',
    image,
    'python3', '-I', '-S', '-c', 'import sys; exec(compile(sys.stdin.read(), "<submission>", "exec"))',
  ];
}
