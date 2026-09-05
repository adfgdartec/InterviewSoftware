import { defineCloudflareConfig } from '@opennextjs/cloudflare';

/**
 * OpenNext rather than vinext, deliberately.
 *
 * Cloudflare now recommends vinext for Next.js on Workers, and it is the better long-term
 * target. It reimplements the Next.js API surface rather than adapting the output of
 * `next build`, though -- and this app's authentication leans on two of the parts most
 * likely to differ: Server Actions and middleware. OpenNext adapts the real build output,
 * so what runs in production is what `next build` produced.
 *
 * Revisit once vinext has been exercised against Server Actions and middleware here.
 */
export default defineCloudflareConfig();
