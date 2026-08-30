import { spawn } from 'node:child_process';
import { execFile } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  PYTHON_BINARY,
  SANDBOX_BINARY,
  resolveLimits,
  sandboxArgs,
  seatbeltProfile,
  type SandboxLimits,
} from './limits.js';

/**
 * Executes untrusted candidate code under macOS Seatbelt with POSIX resource limits.
 * Spec §2.2: "Never `eval` in the app process." Nothing here evaluates, imports or
 * interprets the submission -- it is written to a scratch file and run by a separate,
 * confined interpreter process.
 *
 * The audited prototype ran LLM-generated code through `exec()` behind an escapable
 * denylist. The isolation here is the kernel's, not string inspection; this module contains
 * no list of forbidden substrings and does not pretend one would help.
 */

export type RunOutcome =
  | 'ok'
  | 'nonzero_exit'
  | 'timeout'
  | 'cpu_exhausted'
  | 'out_of_memory'
  | 'output_truncated'
  | 'sandbox_unavailable';

export interface RunResult {
  readonly outcome: RunOutcome;
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
  readonly durationMs: number;
  readonly peakRssBytes: number;
  readonly limits: SandboxLimits;
}

export interface RunOptions {
  readonly limits?: Partial<SandboxLimits>;
  readonly stdin?: string;
  /** Injected so tests can drive the runner without the real sandbox binary. */
  readonly sandboxBinary?: string;
}

/** Exit status the in-process alarm uses, matching the shell convention for `timeout`. */
export const TIMEOUT_EXIT_CODE = 124;
/** 128 + SIGXCPU(24): the kernel killed the process for exceeding RLIMIT_CPU. */
export const SIGXCPU_EXIT_CODE = 152;

const OOM_SIGNALS = /MemoryError|Cannot allocate memory|out of memory/i;

/**
 * Bootstrap run inside the sandbox. It applies the resource limits the kernel does honour,
 * arms the wall clock, then executes the submission. Limits are set here rather than in the
 * parent because they must apply to the confined process, not to the Node server.
 */
function bootstrapSource(code: string, stdin: string, limits: SandboxLimits): string {
  const stdin64 = Buffer.from(stdin, 'utf8').toString('base64');
  const code64 = Buffer.from(code, 'utf8').toString('base64');
  const seconds = (limits.wallClockMs / 1_000).toFixed(3);
  return [
    'import sys, io, base64, signal, os, resource',
    '',
    '# macOS honours these two. RLIMIT_AS and RLIMIT_DATA are rejected by this kernel, so',
    '# memory is policed by the parent process instead.',
    'for _name, _value in (("RLIMIT_CPU", ' + String(limits.cpuSeconds) + '), ("RLIMIT_NPROC", ' + String(limits.processes) + ')):',
    '    try:',
    '        _r = getattr(resource, _name)',
    '        _soft, _hard = resource.getrlimit(_r)',
    '        resource.setrlimit(_r, (_value, _hard))',
    '    except (ValueError, OSError):',
    '        pass',
    '',
    '# Memory ceiling, layer one: an in-process watchdog. The parent also polls RSS, but a',
    '# tight allocation loop can overshoot a 100ms sampler by hundreds of megabytes, so the',
    '# primary check runs here where it can react in milliseconds.',
    'import threading',
    `_LC_MEM_CAP = ${String(limits.memoryBytes)}`,
    'def _lc_mem_guard():',
    '    while True:',
    '        try:',
    '            _rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss',
    '        except Exception:',
    '            return',
    '        if _rss > _LC_MEM_CAP:',
    '            sys.stderr.write("MemoryError: exceeded memory ceiling\\n")',
    '            sys.stderr.flush()',
    '            os._exit(137)',
    '        _t = threading.Event()',
    '        _t.wait(0.004)',
    '',
    '_lc_guard = threading.Thread(target=_lc_mem_guard, daemon=True)',
    '_lc_guard.start()',
    '',
    'def _lc_timeout(signum, frame):',
    '    sys.stderr.write("TimeoutError: exceeded wall clock\\n")',
    '    sys.stderr.flush()',
    `    os._exit(${TIMEOUT_EXIT_CODE})`,
    '',
    'signal.signal(signal.SIGALRM, _lc_timeout)',
    `signal.setitimer(signal.ITIMER_REAL, ${seconds})`,
    `sys.stdin = io.StringIO(base64.b64decode("${stdin64}").decode("utf-8"))`,
    `_submission = base64.b64decode("${code64}").decode("utf-8")`,
    'exec(compile(_submission, "<submission>", "exec"), {"__name__": "__main__"})',
  ].join('\n');
}

/** Current RSS of a pid in bytes, or 0 when the process is gone. */
function readRss(pid: number): Promise<number> {
  return new Promise((resolve) => {
    execFile('/bin/ps', ['-o', 'rss=', '-p', String(pid)], (error, stdout) => {
      if (error !== null) return resolve(0);
      const kb = Number.parseInt(stdout.trim(), 10);
      resolve(Number.isFinite(kb) ? kb * 1024 : 0);
    });
  });
}

/**
 * Runs `code` and reports what happened. Candidate-caused failures -- a crash, a timeout, an
 * OOM -- are normal interview outcomes and are returned as data. It reports
 * `sandbox_unavailable` rather than throwing when the confinement tool is missing, and never
 * falls back to running the code unconfined.
 */
export async function runInSandbox(code: string, options: RunOptions = {}): Promise<RunResult> {
  const limits = resolveLimits(options.limits ?? {});
  const sandboxBinary = options.sandboxBinary ?? SANDBOX_BINARY;
  // realpath matters: on macOS tmpdir() is /var/... which resolves to /private/var/...,
  // and Seatbelt matches subpaths against the RESOLVED path. Without this the profile's one
  // writable rule silently never matches and every legitimate write is denied.
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'loopcraft-sbx-')));
  const scriptPath = join(scratch, 'submission.py');
  writeFileSync(scriptPath, bootstrapSource(code, options.stdin ?? '', limits), 'utf8');

  const profile = seatbeltProfile(scratch);
  const started = Date.now();

  return new Promise<RunResult>((resolve) => {
    // start_new_session equivalent: its own process group, so a submission that forks cannot
    // outlive the kill. Killing only the leader is the mistake that lets orphans survive.
    const child = spawn(sandboxBinary, sandboxArgs(profile, scriptPath), {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
      // The scratch directory is the working directory, so a submission that writes a
      // relative file lands in the one place it is allowed to write. Without this the only
      // writable path would be undiscoverable from inside the sandbox.
      cwd: scratch,
      // NODE_ENV is present only to satisfy @types/node's ProcessEnv shape when this file is
      // typechecked from a consumer with a different @types/node resolution (apps/web); it
      // has no effect on the confined process, which is Python, not Node.
      env: { PATH: '/usr/bin:/bin', HOME: scratch, TMPDIR: scratch, NODE_ENV: process.env['NODE_ENV'] ?? 'development' },
    });

    let stdout = '';
    let stderr = '';
    let truncated = false;
    let settled = false;
    let peakRss = 0;

    const killGroup = (): void => {
      try {
        if (child.pid !== undefined) process.kill(-child.pid, 'SIGKILL');
      } catch {
        /* already gone */
      }
      try {
        child.kill('SIGKILL');
      } catch {
        /* already gone */
      }
    };

    const finish = (outcome: RunOutcome, exitCode: number | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(wallTimer);
      clearInterval(rssTimer);
      if (outcome !== 'ok' && outcome !== 'nonzero_exit') killGroup();
      try {
        rmSync(scratch, { recursive: true, force: true });
      } catch {
        /* best effort */
      }
      resolve({
        outcome,
        stdout: stdout.slice(0, limits.outputBytes),
        stderr: stderr.slice(0, limits.outputBytes),
        exitCode,
        durationMs: Date.now() - started,
        peakRssBytes: peakRss,
        limits,
      });
    };

    const wallTimer = setTimeout(() => {
      killGroup();
      finish('timeout', null);
    }, limits.wallClockMs + 2_000);
    wallTimer.unref?.();

    // The memory ceiling. Polled, because this kernel will not enforce an address-space cap.
    const rssTimer = setInterval(() => {
      if (child.pid === undefined) return;
      void readRss(child.pid).then((rss) => {
        if (rss > peakRss) peakRss = rss;
        if (rss > limits.memoryBytes) {
          killGroup();
          finish('out_of_memory', null);
        }
      });
    }, limits.memoryPollMs);
    rssTimer.unref?.();

    const capture = (chunk: Buffer, into: 'out' | 'err'): void => {
      const text = chunk.toString('utf8');
      if (into === 'out') stdout += text;
      else stderr += text;
      if (stdout.length + stderr.length > limits.outputBytes) {
        truncated = true;
        killGroup();
        finish('output_truncated', null);
      }
    };

    child.stdout.on('data', (c: Buffer) => capture(c, 'out'));
    child.stderr.on('data', (c: Buffer) => capture(c, 'err'));
    child.on('error', () => finish('sandbox_unavailable', null));

    child.on('close', (exitCode, signal) => {
      if (truncated) return finish('output_truncated', exitCode);
      if (exitCode === TIMEOUT_EXIT_CODE) return finish('timeout', exitCode);
      if (exitCode === SIGXCPU_EXIT_CODE || signal === 'SIGXCPU') {
        return finish('cpu_exhausted', exitCode);
      }
      // 137 is the in-process memory guard's exit code (128 + SIGKILL, by convention).
      if (exitCode === 137 || OOM_SIGNALS.test(stderr)) return finish('out_of_memory', exitCode);
      if (exitCode === 0) return finish('ok', 0);
      return finish('nonzero_exit', exitCode);
    });
  });
}

export { PYTHON_BINARY, SANDBOX_BINARY };
