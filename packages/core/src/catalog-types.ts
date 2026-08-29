/**
 * Shapes for the content catalog: tracks, rubrics with behavioural anchors, loop templates,
 * and item-bank rows. Spec §2.1, §2.4 and §2.6. These types are the contract between the
 * authored content and the session engine, so both sides fail to compile on a mismatch.
 */

export const ROUND_TYPES = [
  'warmup',
  'domain',
  'coding',
  'design',
  'behavioral',
  'situational',
  'closing',
] as const;
export type RoundType = (typeof ROUND_TYPES)[number];

/**
 * Acceptance criterion 2: every track must produce a valid item for each of these five.
 * Coding and design are round types a track may or may not offer.
 */
export const REQUIRED_ROUND_TYPES = [
  'warmup',
  'domain',
  'behavioral',
  'situational',
  'closing',
] as const satisfies readonly RoundType[];

export const TRACK_FAMILIES = ['software', 'ai', 'product', 'general', 'non_technical'] as const;
export type TrackFamily = (typeof TRACK_FAMILIES)[number];

export const LEVEL_BANDS = ['L3', 'L4', 'L5', 'L6', 'L7'] as const;
export type LevelBand = (typeof LEVEL_BANDS)[number];

export interface Track {
  readonly id: string;
  readonly name: string;
  readonly family: TrackFamily;
  /** Spec §2.4 ship order: software-engineering first, then ml-systems, inference-serving... */
  readonly shipOrder: number;
  readonly covers: string;
  readonly roundTypes: readonly RoundType[];
}

/** One level of a 1-5 anchored scale. Spec §2.6: a written behavioural anchor plus two worked examples. */
export interface RubricAnchor {
  readonly level: 1 | 2 | 3 | 4 | 5;
  readonly anchor: string;
  readonly workedExampleA: string;
  readonly workedExampleB: string;
}

export interface RubricDimension {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly anchors: readonly RubricAnchor[];
}

export interface Rubric {
  readonly id: string;
  readonly trackId: string;
  readonly roundType: RoundType;
  readonly name: string;
  readonly version: number;
  readonly dimensions: readonly RubricDimension[];
}

/**
 * Guardrail 4 / spec §5.3: every item records where it came from. Nothing is scraped, and
 * "rubric_generated" items name the rubric version they were generated against.
 */
export type Provenance = 'rubric_generated' | 'staff_authored' | 'user_contributed_licensed';

export interface Item {
  readonly id: string;
  readonly trackId: string;
  readonly rubricId: string;
  readonly roundType: RoundType;
  readonly prompt: string;
  readonly provenance: Provenance;
  readonly provenanceNote: string;
  readonly generatorRubricVersion: number;
  /** IRT 2PL parameters, cold-started from expert tagging (spec §2.5). */
  readonly difficultyB: number;
  readonly discriminationA: number;
  readonly levelBands: readonly LevelBand[];
}

export interface RoundSpec {
  readonly position: number;
  readonly roundType: RoundType;
  readonly persona: string;
  readonly rubricId: string;
  readonly minutes: number;
}

/**
 * Spec §2.1: templates are labelled as modelled on publicly reported formats and cite the
 * source page. `sourceUrls` is non-empty by database constraint as well as by type.
 */
export interface LoopTemplate {
  readonly id: string;
  readonly name: string;
  readonly trackId: string;
  readonly levelBand: LevelBand;
  readonly sourceUrls: readonly string[];
  readonly modeledOnNote: string;
  readonly rounds: readonly RoundSpec[];
}
