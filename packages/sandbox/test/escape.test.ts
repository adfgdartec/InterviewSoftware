import { beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { runInSandbox } from '../src/runner.js';
import { DEFAULT_LIMITS, hardenedRunArgs } from '../src/limits.js';

/**
 * Phase 3 exit criterion: "Sandbox escape suite passes."
 *
 * These are real container executions, not mocks. A mocked escape suite proves nothing --
 * the whole question is whether the flags in hardenedRunArgs actually hold, and only the
 * daemon can answer that. If Docker is unavailable the suite FAILS rather than skipping:
 * an escape suite that silently no-ops is worse than none, because it reports green.
 */

let dockerAvailable = false;

beforeAll(() => {
  try {
    execFileSync('docker', ['info', '--format', '{{.ServerVersion}}'], { stdio: 'pipe' });
    execFileSync('docker', ['image', 'inspect', 'python:3.12-alpine'], { stdio: 'pipe' });
    dockerAvailable = true;
  } catch {
    dockerAvailable = false;
  }
});

it('has a working sandbox to test against', () => {
  expect(
    dockerAvailable,
    'Docker daemon or python:3.12-alpine unavailable. Run `docker pull python:3.12-alpine`. ' +
      'This suite fails rather than skips: a green escape suite that never ran is a lie.',
  ).toBe(true);
});

describe('the container flags are all present', () => {
  const args = hardenedRunArgs(DEFAULT_LIMITS);
  const joined = args.join(' ');

  it.each([
    ['no network', '--network none'],
    ['memory ceiling', `--memory ${DEFAULT_LIMITS.memoryBytes}b`],
    ['swap disabled', `--memory-swap ${DEFAULT_LIMITS.memoryBytes}b`],
    ['pids capped', `--pids-limit ${DEFAULT_LIMITS.pids}`],
    ['read-only rootfs', '--read-only'],
    ['all capabilities dropped', '--cap-drop ALL'],
    ['no privilege escalation', '--security-opt no-new-privileges'],
    ['non-root user', '--user 65534:65534'],
    ['noexec tmpfs', 'noexec'],
  ])('sets %s', (_label, flag) => {
    expect(joined).toContain(flag);
  });

  it('never runs as root and never mounts the host', () => {
    expect(joined).not.toContain('--privileged');
    expect(joined).not.toContain('-v ');
    expect(joined).not.toContain('--volume');
    expect(joined).not.toContain('/var/run/docker.sock');
  });
});

describe('escape attempts (real execution)', () => {
  it('runs ordinary code', async () => {
    const r = await runInSandbox('print("hello", 1 + 1)');
    expect(r.outcome).toBe('ok');
    expect(r.stdout.trim()).toBe('hello 2');
  }, 30_000);

  it('feeds stdin without the submission consuming its own source', async () => {
    const r = await runInSandbox('print(input().upper())', { stdin: 'abc\n' });
    expect(r.outcome).toBe('ok');
    expect(r.stdout.trim()).toBe('ABC');
  }, 30_000);

  it('denies outbound network at the interface level, not by timeout', async () => {
    const r = await runInSandbox(
      'import socket\ns = socket.socket()\ns.settimeout(2)\ns.connect(("1.1.1.1", 80))\nprint("CONNECTED")',
    );
    expect(r.stdout).not.toContain('CONNECTED');
    expect(r.outcome).toBe('nonzero_exit');
    expect(r.stderr).toMatch(/Network( is)? unreachable/i);
  }, 30_000);

  it('denies DNS as well as raw sockets', async () => {
    const r = await runInSandbox(
      'import socket\ntry:\n  print("RESOLVED", socket.gethostbyname("example.com"))\nexcept Exception as e:\n  print("denied", type(e).__name__)',
    );
    expect(r.stdout).not.toContain('RESOLVED');
  }, 30_000);

  it('runs as nobody, never as root', async () => {
    const r = await runInSandbox('import os\nprint("uid", os.getuid(), "gid", os.getgid())');
    expect(r.stdout).toMatch(/uid 65534\b/);
  }, 30_000);

  it('cannot escalate to root', async () => {
    const r = await runInSandbox(
      'import os\ntry:\n  os.setuid(0)\n  print("ROOT")\nexcept Exception as e:\n  print("denied", type(e).__name__)',
    );
    expect(r.stdout).not.toContain('ROOT');
    expect(r.stdout).toContain('denied');
  }, 30_000);

  it('cannot see the host filesystem or the docker socket', async () => {
    const r = await runInSandbox(
      'import os\nprint(os.path.exists("/Users"), os.path.exists("/host"), os.path.exists("/var/run/docker.sock"))',
    );
    expect(r.stdout.trim()).toBe('False False False');
  }, 30_000);

  it('cannot write to the root filesystem', async () => {
    const r = await runInSandbox('open("/pwned", "w").write("x")\nprint("WROTE")');
    expect(r.stdout).not.toContain('WROTE');
    expect(r.stderr).toMatch(/Read-only file system/i);
  }, 30_000);

  it('can write to its own /tmp, which is where legitimate work happens', async () => {
    const r = await runInSandbox('open("/tmp/scratch", "w").write("x")\nprint("ok")');
    expect(r.outcome).toBe('ok');
  }, 30_000);

  it('survives a fork bomb via the pids limit', async () => {
    const r = await runInSandbox('import os\nwhile True:\n    os.fork()');
    expect(r.outcome).toBe('nonzero_exit');
    expect(r.stderr).toMatch(/Resource temporarily unavailable|BlockingIOError/i);
  }, 45_000);

  it('kills a memory bomb at the ceiling', async () => {
    const r = await runInSandbox('x = []\nwhile True:\n    x.append(bytearray(10_000_000))');
    expect(r.outcome).toBe('out_of_memory');
  }, 45_000);

  it('kills an infinite loop at the wall clock', async () => {
    const r = await runInSandbox('while True:\n    pass');
    expect(r.outcome).toBe('timeout');
    expect(r.durationMs).toBeLessThan(DEFAULT_LIMITS.wallClockMs + 3_000);
  }, 30_000);

  it('truncates an unbounded print rather than filling host memory', async () => {
    const r = await runInSandbox('while True:\n    print("A" * 1000)');
    expect(r.outcome).toBe('output_truncated');
    expect(r.stdout.length).toBeLessThanOrEqual(DEFAULT_LIMITS.outputBytes);
  }, 30_000);

  it('reports a candidate crash as data, not as an exception', async () => {
    const r = await runInSandbox('raise ValueError("boom")');
    expect(r.outcome).toBe('nonzero_exit');
    expect(r.stderr).toContain('ValueError');
  }, 30_000);

  it('reports an unavailable sandbox instead of falling back to host execution', async () => {
    const r = await runInSandbox('print(1)', { dockerBinary: '/nonexistent/docker' });
    expect(r.outcome).toBe('sandbox_unavailable');
    expect(r.stdout).toBe('');
  }, 30_000);
});
