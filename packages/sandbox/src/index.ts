/**
 * The full package surface, for Node consumers (tests, the local runner).
 *
 * `runner.js` imports node:child_process, which Cloudflare Workers do not provide even with
 * nodejs_compat. `apps/web` needs only the hint ladder, so it imports
 * `@loopcraft/sandbox/hints` directly rather than this barrel -- an explicit boundary
 * instead of a bet on the bundler tree-shaking the runner away.
 */
export * from './limits.js';
export * from './runner.js';
export * from './hints.js';
export * from './test-cases.js';
