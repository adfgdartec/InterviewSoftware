import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  CONTAINER_STARTUP_GRACE_MS,
  hardenedRunArgs,
  resolveLimits,
  type SandboxLimits,
} from './limits.js';

/**
 * Executes untrusted candidate code in a hardened container. Spec §2.2: "Never `eval` in the
 * app process." Nothing in this module evaluates, imports, or otherwise interprets the
 * submission -- it is written to the container's stdin and never touches the host runtime.
 *
 * The audited prototype ran LLM-generated code through `exec()` behind an escapable
 * denylist, on an unauthenticated endpoint. The isolation here is the container boundary,
 * not string inspection: a denylist of forbidden substrings is not a security control and
 * this module does not pretend otherwise.
 */

export type RunOutcome =
  | 'ok'
  | 'nonzero_exit'
  | 'timeout'
  | 'out_of_memory'
  | 'output_truncated'
  | 'sandbox_unavailable';

export interface RunResult {
  readonly outcome: RunOutcome;
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
  readonly durationMs: number;
  readonly limits: SandboxLimits;
}

export interface RunOptions {
  readonly limits?: Partial<SandboxLimits>;
  readonly stdin?: string;
  readonly image?: string;
  /** Injected so tests can drive the runner without a Docker daemon. */
  readonly dockerBinary?: string;
}

const OOM_SIGNALS = /killed|MemoryError|Cannot allocate memory|out of memory/i;

/** Exit status the in-container alarm uses, matching the shell convention for `timeout`. */
export const TIMEOUT_EXIT_CODE = 124;

/**
 * Runs `code` and returns what happened. It never throws for candidate-caused failures --
 * a crash, a timeout and an OOM are all normal interview outcomes and are reported as data.
 * It throws only when the sandbox itself could not be started, which is an operator problem.
 */
export async function runInSandbox(code: string, options: RunOptions = {}): Promise<RunResult> {
  const limits = resolveLimits(options.limits ?? {});
  const containerName = `loopcraft-run-${randomUUID()}`;
  const args = hardenedRunArgs(limits, options.image, containerName);
  const docker = options.dockerBinary ?? 'docker';
  const started = Date.now();

  return new Promise<RunResult>((resolve) => {
    const child = spawn(docker, args, { stdio: ['pipe', 'pipe', 'pipe'] });

    let stdout = '';
    let stderr = '';
    let truncated = false;
    let settled = false;

    /**
     * Killing the `docker` client does NOT stop the container it started: the daemon owns
     * the process. An orphaned fork bomb will keep spinning after the client is gone and
     * can wedge the daemon outright. Every abnormal termination therefore reaps by name.
     */
    const reap = (): void => {
      spawn(docker, ['kill', containerName], { stdio: 'ignore' }).on('error', () => {});
      spawn(docker, ['rm', '-f', containerName], { stdio: 'ignore' }).on('error', () => {});
    };

    const finish = (outcome: RunOutcome, exitCode: number | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (outcome === 'timeout' || outcome === 'output_truncated') reap();
      resolve({
        outcome,
        stdout: stdout.slice(0, limits.outputBytes),
        stderr: stderr.slice(0, limits.outputBytes),
        exitCode,
        durationMs: Date.now() - started,
        limits,
      });
    };

    // The candidate's wall clock is enforced INSIDE the container (see buildProgram), so it
    // measures their code rather than Docker's cold start. This host timer is only the
    // backstop for a container that never reaches Python -- image pull, daemon stall, a
    // hang outside the interpreter -- and so carries the startup grace on top.
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish('timeout', null);
    }, limits.wallClockMs + CONTAINER_STARTUP_GRACE_MS);
    timer.unref?.();

    const capture = (chunk: Buffer, into: 'out' | 'err'): void => {
      const text = chunk.toString('utf8');
      if (into === 'out') {
        if (stdout.length + text.length > limits.outputBytes) truncated = true;
        stdout += text;
      } else {
        if (stderr.length + text.length > limits.outputBytes) truncated = true;
        stderr += text;
      }
      if (stdout.length + stderr.length > limits.outputBytes * 4) {
        // A submission printing without bound would otherwise fill host memory before the
        // wall clock fires, so the runner stops reading and kills it.
        child.kill('SIGKILL');
        finish('output_truncated', null);
      }
    };

    child.stdout.on('data', (c: Buffer) => capture(c, 'out'));
    child.stderr.on('data', (c: Buffer) => capture(c, 'err'));

    child.on('error', () => finish('sandbox_unavailable', null));

    child.on('close', (exitCode) => {
      if (truncated) return finish('output_truncated', exitCode);
      // 124 is the in-container alarm exit code; see buildProgram.
      if (exitCode === TIMEOUT_EXIT_CODE) return finish('timeout', exitCode);
      if (exitCode === 137 || OOM_SIGNALS.test(stderr)) return finish('out_of_memory', exitCode);
      if (exitCode === 0) return finish('ok', 0);
      return finish('nonzero_exit', exitCode);
    });

    child.stdin.on('error', () => {
      /* the container may exit before the whole submission is written; close() reports it */
    });
    child.stdin.end(buildProgram(code, options.stdin ?? '', limits));
  });
}

/**
 * Wraps the submission so its stdin is a fixed string rather than the pipe the code arrives
 * on. Without this a submission calling input() would consume its own source.
 */
function buildProgram(code: string, stdin: string, limits: SandboxLimits): string {
  const stdin64 = Buffer.from(stdin, 'utf8').toString('base64');
  const code64 = Buffer.from(code, 'utf8').toString('base64');
  const seconds = (limits.wallClockMs / 1_000).toFixed(3);
  return [
    'import sys, io, base64, signal, os',
    // The candidate's wall clock starts here -- after the interpreter is up, so container
    // cold start is not charged against it.
    'def __lc_timeout__(signum, frame):',
    '    sys.stderr.write("TimeoutError: exceeded wall clock\\n")',
    `    os._exit(${TIMEOUT_EXIT_CODE})`,
    'signal.signal(signal.SIGALRM, __lc_timeout__)',
    `signal.setitimer(signal.ITIMER_REAL, ${seconds})`,
    `sys.stdin = io.StringIO(base64.b64decode("${stdin64}").decode("utf-8"))`,
    `__submission__ = base64.b64decode("${code64}").decode("utf-8")`,
    'exec(compile(__submission__, "<submission>", "exec"), {"__name__": "__main__"})',
  ].join('\n');
}
