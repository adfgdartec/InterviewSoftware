/**
 * The track catalog. Spec §2.4: the eight AI and AI-infrastructure tracks (the differentiated
 * wedge) plus the four general technical tracks carried over from the baseline product.
 *
 * `shipOrder` follows spec §2.4's stated ship sequence exactly: software-engineering first,
 * then ml-systems, inference-serving, ml-research, gpu-performance, then the remaining eight
 * tracks. `covers` paraphrases the spec's "Covers" column (or, for the four baseline tracks,
 * the paragraph immediately below the table) rather than quoting it verbatim.
 */

import type { RoundType, Track, TrackFamily } from './catalog-types.js';

const REQUIRED: readonly RoundType[] = ['warmup', 'domain', 'behavioral', 'situational', 'closing'];

/**
 * Only `ml-systems` carries `coding` and `design` round types. Spec's frontier-lab demo
 * template requires a five-round ml-systems loop that includes both, and the item bank is
 * required to carry at least two items of each for this track. Every other track ships the
 * five required round types only, so every round type a track declares has a backing rubric
 * and a backing pair of items — nothing here is advertised without content behind it.
 */
const ML_SYSTEMS_ROUNDS: readonly RoundType[] = [
  'warmup',
  'domain',
  'coding',
  'design',
  'behavioral',
  'situational',
  'closing',
];

function track(
  id: string,
  name: string,
  family: TrackFamily,
  shipOrder: number,
  covers: string,
  roundTypes: readonly RoundType[] = REQUIRED,
): Track {
  return { id, name, family, shipOrder, covers, roundTypes };
}

export const TRACKS: readonly Track[] = [
  track(
    'software-engineering',
    'Software Engineering',
    'software',
    1,
    'General-purpose software engineering: algorithms and data structures, system trade-offs, ' +
      'code quality, and the discussion rounds common to most engineering loops.',
  ),
  track(
    'ml-systems',
    'ML Systems',
    'ai',
    2,
    'Distributed training systems: choosing data-, tensor-, and pipeline-parallel strategies, ' +
      'debugging communication-library failures, checkpointing, throughput analysis, and ' +
      'out-of-memory triage.',
    ML_SYSTEMS_ROUNDS,
  ),
  track(
    'inference-serving',
    'Inference Serving',
    'ai',
    3,
    'Serving systems for trained models: key-value cache management, continuous batching, ' +
      'speculative decoding, quantization trade-offs, latency service levels, and autoscaling.',
  ),
  track(
    'ml-research',
    'ML Research',
    'ai',
    4,
    'Research-level depth: reading and critiquing papers, designing ablations, reasoning ' +
      'through the math behind attention, optimization, and statistics, and reproducing ' +
      'published results.',
  ),
  track(
    'gpu-performance',
    'GPU Performance',
    'ai',
    5,
    'Low-level GPU performance: CUDA and Triton kernel authoring, the memory hierarchy, ' +
      'occupancy tuning, kernel fusion, roofline reasoning, and profiler-driven optimization.',
  ),
  track(
    'llm-application',
    'LLM Application Engineering',
    'ai',
    6,
    'Applications built on language models: retrieval-augmented generation architecture and ' +
      'failure analysis, evaluation design, prompt and context engineering, agent ' +
      'orchestration, and cost control.',
  ),
  track(
    'mlops-data',
    'MLOps and Data',
    'ai',
    7,
    'Operating machine learning in production: feature stores, pipeline reliability, drift ' +
      'detection, data lineage, and retraining policy.',
  ),
  track(
    'ai-product',
    'AI Product Management',
    'ai',
    8,
    'Product management for AI-driven features: scoping to what current model capability can ' +
      'reliably deliver, evaluation-driven roadmaps, and latency, cost, and quality trade-offs.',
  ),
  track(
    'ai-safety-policy',
    'AI Safety and Policy',
    'ai',
    9,
    'Safety and policy work for AI systems: threat modeling, red-teaming, evaluation ' +
      'methodology, and policy reasoning.',
  ),
  track(
    'data-ai',
    'Data and AI Generalist',
    'ai',
    10,
    'Applied data and machine learning generalist work: framing a business question as a data ' +
      'question, model and method selection, experiment design, and basic production ' +
      'monitoring.',
  ),
  track(
    'product-management',
    'Product Management',
    'product',
    11,
    'General product management: prioritization frameworks, metric definition, stakeholder ' +
      'trade-offs, and launch and rollout strategy.',
  ),
  track(
    'general',
    'General',
    'general',
    12,
    'A track-agnostic loop for candidates who have not selected a specialization: problem ' +
      'decomposition, evidence-based reasoning, and structured communication.',
  ),
];

export function trackById(id: string): Track | undefined {
  return TRACKS.find((t) => t.id === id);
}
