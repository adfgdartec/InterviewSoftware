import { z } from 'zod';

/**
 * The request contract, mirroring the Pydantic models the FastAPI worker validated with
 * (apps/worker/loopcraft_worker/schemas.py). The limits are carried over deliberately rather
 * than relaxed: they were what stopped a caller handing the metrics an unbounded transcript
 * or a word array large enough to make an O(n log n) sort matter on a request path.
 *
 * `.strict()` is Pydantic's `extra="forbid"`. It is load-bearing, not tidiness: a field this
 * contract does not know about is how an affect-inference input ("sentiment_hint") would
 * arrive, and rejecting the request is the behaviour the worker's test suite pinned down.
 */

export const wordTimingSchema = z
  .object({
    word: z.string().min(1).max(200),
    startMs: z.number().int().min(0),
    endMs: z.number().int().min(0),
  })
  .strict()
  .refine((w) => w.endMs >= w.startMs, {
    message: 'endMs must be greater than or equal to startMs',
  });

export const deliveryMetricsRequestSchema = z
  .object({
    transcript: z.string().max(50_000),
    words: z.array(wordTimingSchema).max(20_000).default([]),
    promptEndMs: z.number().int().min(0).default(0),
  })
  .strict();

export type DeliveryMetricsRequest = z.infer<typeof deliveryMetricsRequestSchema>;
