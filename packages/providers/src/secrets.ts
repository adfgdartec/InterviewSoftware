/**
 * Guardrail 6: no API key reaches the client. This module is the only place a provider
 * credential is read, and it throws if imported into a bundle that has been marked as
 * client-side. `apps/web` additionally has a test asserting no NEXT_PUBLIC_* variable
 * matches a provider key name.
 */

const SERVER_ONLY_MARKER = 'server-only';

export class ClientSecretAccessError extends Error {
  constructor(name: string) {
    super(
      `Provider credential "${name}" was read outside a server context. Credentials are ` +
        `${SERVER_ONLY_MARKER} and must never be bundled for the browser (guardrail 6).`,
    );
    this.name = 'ClientSecretAccessError';
  }
}

export class MissingCredentialError extends Error {
  constructor(public readonly variable: string) {
    super(`Missing required credential ${variable}. Set it in the server environment.`);
    this.name = 'MissingCredentialError';
  }
}

/**
 * True in Node/Bun/Edge server runtimes, false in a browser bundle. Probed through
 * globalThis rather than the bare `window` identifier so this package needs no DOM lib --
 * a server package that pulls in DOM types invites exactly the client/server confusion
 * guardrail 6 is about.
 */
function isServerRuntime(): boolean {
  return (globalThis as { window?: unknown }).window === undefined;
}

/** Reads a credential, or throws. The value is never logged, echoed, or returned to a route. */
export function readCredential(variable: string): string {
  if (!isServerRuntime()) throw new ClientSecretAccessError(variable);
  const value = process.env[variable];
  if (value === undefined || value === '') throw new MissingCredentialError(variable);
  return value;
}

/**
 * Presence check for a credential, without throwing -- for a caller that wants to degrade
 * gracefully (e.g. skip a live test suite) rather than treat an unset key as an error. Still
 * routed through this one module: a caller checking `process.env[...]` directly for a key
 * name is exactly what guardrail 6's no-client-secrets test forbids.
 */
export function hasCredential(variable: string): boolean {
  if (!isServerRuntime()) return false;
  const value = process.env[variable];
  return value !== undefined && value !== '';
}

/**
 * Redacts anything that looks like a credential from a string bound for a client response.
 * The audited prototype returned masked key suffixes in debug fields; masking is not
 * redaction, so this replaces the whole token rather than preserving its tail.
 */
export function redact(input: string): string {
  return input
    .replace(/\b(sk|pk|rk)-[A-Za-z0-9_-]{8,}/g, '[redacted]')
    .replace(/\bBearer\s+[A-Za-z0-9._-]{8,}/gi, 'Bearer [redacted]')
    .replace(/\b[A-Za-z0-9_-]{0,12}(?:KEY|TOKEN|SECRET)[A-Za-z0-9_-]*\s*[=:]\s*\S+/gi, '[redacted]')
    .replace(/\/(?:Users|home|var|opt|private)\/[^\s"')]+/g, '[path]');
}
