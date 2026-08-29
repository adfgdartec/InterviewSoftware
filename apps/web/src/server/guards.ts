import type { z } from 'zod';
import {
  EntitlementDeniedError,
  resolveEntitlement,
  type EntitlementStore,
  type ResolvedEntitlement,
} from './entitlements.js';

/**
 * The per-route chain from spec §3.3, in order:
 *   auth check -> entitlement check -> rate limit -> zod validation -> handler
 *
 * The order is load-bearing and asserted by test: validating before authenticating would let
 * an unauthenticated caller probe the schema, and rate limiting before entitlement would
 * spend a caller's quota answering a request they were never entitled to make.
 */

export interface AuthedUser {
  readonly userId: string;
  readonly orgId: string;
}

export class UnauthorizedError extends Error {
  readonly httpStatus = 401;
  constructor(message = 'Authentication required.') {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

export class RateLimitedError extends Error {
  readonly httpStatus = 429;
  constructor(public readonly retryAfterSeconds: number) {
    super('Too many requests.');
    this.name = 'RateLimitedError';
  }
}

export class ValidationError extends Error {
  readonly httpStatus = 400;
  constructor(public readonly issues: readonly string[]) {
    // The issues go in the message too: an error whose text hides its own cause makes both
    // a failing test and a production log entry useless.
    super(`Request body failed validation: ${issues.join('; ')}`);
    this.name = 'ValidationError';
  }
}

export class MissingIdempotencyKeyError extends Error {
  readonly httpStatus = 400;
  constructor() {
    super('Idempotency-Key header is required for mutating requests.');
    this.name = 'MissingIdempotencyKeyError';
  }
}

export interface RateLimiter {
  /** Returns seconds to wait, or null when the request may proceed. */
  check(key: string): Promise<number | null>;
}

export interface GuardPorts {
  authenticate(request: Request): Promise<AuthedUser | null>;
  entitlements: EntitlementStore;
  rateLimiter: RateLimiter;
}

export interface GuardOptions<TSchema extends z.ZodTypeAny> {
  readonly schema: TSchema;
  readonly mutating: boolean;
  readonly rateLimitBucket: string;
}

export interface GuardedRequest<TBody> {
  readonly user: AuthedUser;
  readonly entitlement: ResolvedEntitlement;
  readonly body: TBody;
  readonly idempotencyKey: string | null;
}

/** Names of request fields a client must never be able to influence (guardrail 5). */
export const CLIENT_FORBIDDEN_FIELDS = [
  'planId',
  'plan_id',
  'usageCount',
  'usage_count',
  'score',
  'scores',
  'entitlement',
  'orgId',
  'org_id',
  'itemId',
  'item_id',
  'question',
  'theta',
] as const;

/**
 * Strips server-authoritative fields from a client body before validation. Present so a
 * future route cannot accidentally accept one: the schema would have to opt in explicitly,
 * and `assertNoForbiddenFields` makes the attempt visible in tests.
 */
export function assertNoForbiddenFields(body: unknown): void {
  if (typeof body !== 'object' || body === null) return;
  const present = CLIENT_FORBIDDEN_FIELDS.filter((f) => f in (body as Record<string, unknown>));
  if (present.length > 0) {
    throw new ValidationError(
      present.map((f) => `Field "${f}" is resolved server-side and may not be supplied by a client.`),
    );
  }
}

export async function guard<TSchema extends z.ZodTypeAny>(
  request: Request,
  ports: GuardPorts,
  options: GuardOptions<TSchema>,
  now: Date = new Date(),
): Promise<GuardedRequest<z.infer<TSchema>>> {
  // 1. auth
  const user = await ports.authenticate(request);
  if (user === null) throw new UnauthorizedError();

  // 2. entitlement, resolved from the authenticated org only
  const entitlement = await resolveEntitlement(ports.entitlements, user.orgId, now);

  // 3. rate limit, keyed on the authenticated user rather than anything the client sends
  const wait = await ports.rateLimiter.check(`${options.rateLimitBucket}:${user.userId}`);
  if (wait !== null) throw new RateLimitedError(wait);

  // 4. idempotency for every mutating route (spec §3.2)
  const idempotencyKey = request.headers.get('Idempotency-Key');
  if (options.mutating && (idempotencyKey === null || idempotencyKey.trim() === '')) {
    throw new MissingIdempotencyKeyError();
  }

  // 5. validation
  const raw: unknown = options.mutating ? await request.json().catch(() => null) : {};
  assertNoForbiddenFields(raw);
  const parsed = options.schema.safeParse(raw);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));
  }

  return { user, entitlement, body: parsed.data, idempotencyKey };
}

/**
 * Errors raised by the loop engine. Declared here rather than imported to keep guards.ts
 * free of a dependency on the engine; the engine's classes structurally satisfy this.
 */
export interface HttpStatusError {
  readonly httpStatus: number;
  readonly message: string;
}

function hasHttpStatus(error: unknown): error is HttpStatusError {
  return (
    typeof error === 'object' &&
    error !== null &&
    typeof (error as { httpStatus?: unknown }).httpStatus === 'number'
  );
}

export interface ErrorBody {
  readonly error: string;
  readonly code: string;
  readonly errorId: string;
}

/**
 * Converts a thrown guard error into a response body. Nothing internal escapes: no file
 * path, no provider payload, no stack. The audited prototype returned all three.
 */
export function toErrorResponse(error: unknown, errorId: string): { status: number; body: ErrorBody } {
  if (error instanceof UnauthorizedError) {
    return { status: 401, body: { error: error.message, code: 'unauthorized', errorId } };
  }
  if (error instanceof EntitlementDeniedError) {
    return { status: 402, body: { error: error.message, code: error.code, errorId } };
  }
  if (error instanceof RateLimitedError) {
    return { status: 429, body: { error: error.message, code: 'rate_limited', errorId } };
  }
  if (error instanceof MissingIdempotencyKeyError) {
    return { status: 400, body: { error: error.message, code: 'idempotency_key_required', errorId } };
  }
  if (error instanceof ValidationError) {
    return { status: 400, body: { error: error.issues.join('; '), code: 'invalid_request', errorId } };
  }
  // Engine errors (session not found, loop already complete) carry their own status. They
  // are mapped here rather than falling through to 500, which would both mislead the client
  // and turn a legitimate 404 into a page that looks like an outage.
  if (hasHttpStatus(error)) {
    const status = error.httpStatus;
    const code = status === 404 ? 'not_found' : status === 409 ? 'conflict' : 'request_failed';
    return { status, body: { error: error.message, code, errorId } };
  }
  return {
    status: 500,
    body: { error: 'Internal error.', code: 'internal_error', errorId },
  };
}
