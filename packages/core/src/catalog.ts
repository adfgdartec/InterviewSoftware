/**
 * The catalog surface: everything that is pure data or pure functions over it.
 *
 * This exists as a separate entry point because `index.ts` re-exports `claims.ts`, which
 * reads docs/claims-policy.md off disk with `node:fs` at test time. That is correct for a
 * Node process -- parsing the policy from the document is what stops the gate and the policy
 * drifting apart -- and impossible in React Native, which has no filesystem module.
 *
 * So the native app imports `@loopcraft/core/catalog` and gets the tracks, rubrics, templates
 * and brand strings without the Node dependency. The web app keeps importing the barrel.
 * Nothing is duplicated: both read the same modules.
 */
export * from './catalog-types.js';
export * from './brand.js';
export * from './banned-tokens.js';
export * from './economics.js';
export * from './tracks.js';
export * from './rubrics.js';
export * from './loop-templates.js';
export * from './item-bank.js';
