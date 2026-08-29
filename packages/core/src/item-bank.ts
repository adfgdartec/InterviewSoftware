/**
 * The item bank. Guardrail 4 and spec §5.3: items are generated against rubrics, never
 * scraped from question dumps, and every row records its provenance. Nothing here derives
 * from Glassdoor, Blind, a leaked bank, or any employer's confidential material.
 *
 * Item ids are derived deterministically from a seed string rather than randomly generated,
 * so the same item keeps the same id across environments and a seeded demo, a screenshot and
 * a test assertion all refer to the same row.
 */

import type { Item, LevelBand, RoundType } from './catalog-types.js';
import { TRACKS } from './tracks.js';

/** FNV-1a over the seed, expanded to a valid v4-shaped UUID. Stable across processes. */
export function deterministicItemId(seed: string): string {
  const words: string[] = [];
  for (let block = 0; block < 4; block += 1) {
    let hash = 2_166_136_261;
    const input = `${seed}#${block}`;
    for (let i = 0; i < input.length; i += 1) {
      hash ^= input.charCodeAt(i);
      hash = Math.imul(hash, 16_777_619) >>> 0;
    }
    words.push(hash.toString(16).padStart(8, '0'));
  }
  const hex = words.join('');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    `8${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join('-');
}

const MID: readonly LevelBand[] = ['L4', 'L5'];
const SENIOR: readonly LevelBand[] = ['L5', 'L6'];
const BROAD: readonly LevelBand[] = ['L3', 'L4', 'L5', 'L6', 'L7'];

/**
 * Track-specific domain prompts, written against shared.domain.v1's four dimensions
 * (scoping, mechanism, trade-offs, failure modes). Two per track.
 */
const DOMAIN_PROMPTS: Readonly<Record<string, readonly [string, string]>> = {
  'software-engineering': [
    'A service that was comfortably within its latency budget starts missing p99 after a deploy that changed no request-path code. Walk me through how you would localize the cause.',
    'You need to change the primary key of a table that three services write to, with no maintenance window. Describe the migration.',
  ],
  'ml-systems': [
    'A 512-GPU training run stalls roughly forty minutes in, with all ranks alive and GPU utilization at zero. Walk me through your diagnosis.',
    'You must cut the memory footprint of a training job by 40% without reducing batch size. What do you change first, and what does each option cost you?',
  ],
  'inference-serving': [
    'Your serving fleet holds p50 latency but p99 has tripled since enabling continuous batching. Explain what is likely happening and how you would confirm it.',
    'Decide whether to serve a model with speculative decoding or a smaller quantized model, given a fixed latency SLO and a fixed GPU budget. Show your reasoning.',
  ],
  'ml-research': [
    'A reported improvement does not reproduce on your rerun of the authors’ released code. Describe how you would isolate whether the difference is in data, initialization, or evaluation.',
    'Design the ablation set that would establish which component of a proposed method is actually responsible for its reported gain.',
  ],
  'gpu-performance': [
    'A fused kernel runs at 30% of the memory bandwidth roofline. Walk me through how you would find where the bandwidth is going.',
    'You have a kernel with high occupancy but poor throughput. Explain how those can coexist and what you would measure next.',
  ],
  'llm-application': [
    'A retrieval-augmented system answers correctly in evaluation and wrongly in production on the same questions. Describe how you would find the divergence.',
    'Design an evaluation set for a support-answering system where the ground truth changes over time. Explain how you keep it honest.',
  ],
  'mlops-data': [
    'A feature computed in the training pipeline and the serving path has quietly drifted apart. Explain how you would detect this class of skew before it reaches a model.',
    'Design a retraining policy for a model whose input distribution shifts seasonally. State what triggers a retrain and what blocks one.',
  ],
  'ai-product': [
    'You must decide whether a capability is good enough to ship when the model is right about 85% of the time. Describe how you would frame that decision.',
    'Scope a feature whose quality depends on a model that will improve over the next six months. Explain what you build now and what you defer.',
  ],
  'ai-safety-policy': [
    'Design a red-teaming process for a system that will be used by non-experts in an unbounded set of contexts. Explain what coverage means here.',
    'A safety evaluation shows a low but non-zero failure rate on a high-severity category. Walk me through how you would decide whether to ship.',
  ],
  'data-ai': [
    'A dashboard metric moved 12% overnight with no product change. Describe how you would determine whether the metric or the world changed.',
    'Design the data model for an events pipeline where late-arriving records are common. Explain how you keep aggregates correct.',
  ],
  'product-management': [
    'Two teams need the same platform capability on incompatible timelines. Describe how you would resolve it.',
    'You have a feature with strong qualitative demand and flat quantitative signal. Explain how you would decide whether to build it.',
  ],
  general: [
    'Describe a problem you solved where your first approach was wrong. What made you change it?',
    'Take a system you use daily and explain how you would rebuild it for ten times the users.',
  ],
};

/** Cross-cutting prompts. Genuinely track-independent, so they are shared across the bank. */
const CROSS_CUTTING: Readonly<Record<Exclude<RoundType, 'domain' | 'coding' | 'design'>, readonly [string, string]>> = {
  warmup: [
    'Walk me through the project you have owned that you would most want to be judged on, and what your specific contribution was.',
    'Tell me about the piece of work in your background that best predicts how you would do in this role, and why.',
  ],
  behavioral: [
    'Tell me about a time you disagreed with a decision your team had already committed to. What did you do, and what was the outcome?',
    'Describe a time you shipped something that caused a problem you did not anticipate. What happened, and what changed afterwards?',
  ],
  situational: [
    'You inherit a project two weeks from a committed deadline and conclude it cannot be met. Describe your next 48 hours.',
    'A teammate’s work is blocking yours and their stated timeline keeps slipping. Describe how you handle it.',
  ],
  closing: [
    'What would you want to know about this team that you could not learn from the outside?',
    'What is the part of this role you would find hardest, and what would you do about it?',
  ],
};

function item(
  trackId: string,
  roundType: RoundType,
  rubricId: string,
  prompt: string,
  index: number,
  difficultyB: number,
  levelBands: readonly LevelBand[],
): Item {
  return {
    id: deterministicItemId(`${trackId}:${roundType}:${index}`),
    trackId,
    rubricId,
    roundType,
    prompt,
    provenance: 'rubric_generated',
    provenanceNote: `Written against ${rubricId} dimensions. Not derived from any scraped, leaked, or employer-confidential source.`,
    generatorRubricVersion: 1,
    difficultyB,
    discriminationA: 1.1,
    levelBands,
  };
}

function buildBank(): Item[] {
  const items: Item[] = [];
  for (const track of TRACKS) {
    const domain = DOMAIN_PROMPTS[track.id];
    if (domain === undefined) {
      throw new Error(`Track ${track.id} has no domain prompts; the bank would be incomplete.`);
    }
    items.push(item(track.id, 'domain', 'shared.domain.v1', domain[0], 0, -0.3, MID));
    items.push(item(track.id, 'domain', 'shared.domain.v1', domain[1], 1, 0.8, SENIOR));

    for (const roundType of ['warmup', 'behavioral', 'situational', 'closing'] as const) {
      const prompts = CROSS_CUTTING[roundType];
      const rubricId = `shared.${roundType}.v1`;
      items.push(item(track.id, roundType, rubricId, prompts[0], 0, -0.8, BROAD));
      items.push(item(track.id, roundType, rubricId, prompts[1], 1, 0.2, BROAD));
    }
  }

  // Spec's demo loop needs a coding and a design round on ml-systems (spec §2.1, §2.2, §2.3).
  items.push(
    item('ml-systems', 'coding', 'ml-systems.coding.v1',
      'Implement a bounded LRU cache for tokenizer results that is safe to share across worker threads. State your complexity and your test cases before you call it done.',
      0, -0.2, MID),
    item('ml-systems', 'coding', 'ml-systems.coding.v1',
      'Given a stream of per-rank step timings, write a function that flags the ranks that are consistently slow rather than occasionally slow. Define "consistently" before you code.',
      1, 0.9, SENIOR),
    item('ml-systems', 'design', 'ml-systems.design.v1',
      'Design the checkpointing system for a 2,000-GPU training run where a node fails on average every ninety minutes. Size it before you architect it.',
      0, 0.6, SENIOR),
    item('ml-systems', 'design', 'ml-systems.design.v1',
      'Design a system that serves 200 fine-tuned adapters over one base model with a 150ms p99 budget. State what you would measure to know the design is failing.',
      1, 1.1, SENIOR),
  );
  return items;
}

export const ITEM_BANK: readonly Item[] = buildBank();

export function itemsFor(trackId: string, roundType: RoundType): readonly Item[] {
  return ITEM_BANK.filter((i) => i.trackId === trackId && i.roundType === roundType);
}

/** The easiest item for a pair, used when a provider fails (acceptance criterion 2). */
export function fallbackItem(trackId: string, roundType: RoundType): Item | undefined {
  return [...itemsFor(trackId, roundType)].sort((a, b) => a.difficultyB - b.difficultyB)[0];
}
