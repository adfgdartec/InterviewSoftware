/**
 * The self-reported half of the video gate: whether a user's region and age band permit them
 * to opt into the camera framing check at all.
 *
 * This is the single definition of that rule. `videoEligible` (server) applies it alongside
 * the plan entitlement and the stored opt-in; the settings page applies it to decide whether
 * the opt-in control may be offered. Keeping one definition is the point -- a checkbox
 * offered where the server gate refuses would tell a user they had enabled a feature that
 * can never appear for them.
 *
 * Spec §5.1: video is disabled entirely for EU and Illinois users. Spec §5.2 gates it at 16+
 * regardless of region. Both fail closed: anything not explicitly permitted is prohibited.
 */

export interface VideoOptInInput {
  readonly jurisdiction: string;
  readonly ageBand: string;
}

/** Why the opt-in cannot be offered, or `null` when it can. */
export type VideoOptInBlock = 'incomplete' | 'jurisdiction' | 'age';

const PERMITTED_JURISDICTIONS: readonly string[] = ['us_other', 'other'];
const PERMITTED_AGE_BANDS: readonly string[] = ['16_plus'];

export function videoOptInBlock(input: VideoOptInInput): VideoOptInBlock | null {
  // An unset field is reported first: "finish filling this in" is actionable, whereas naming
  // a prohibition the user has not finished declaring would be premature.
  if (input.jurisdiction === 'unknown' || input.ageBand === 'unknown') return 'incomplete';
  if (!PERMITTED_JURISDICTIONS.includes(input.jurisdiction)) return 'jurisdiction';
  if (!PERMITTED_AGE_BANDS.includes(input.ageBand)) return 'age';
  return null;
}

export function videoOptInPermitted(input: VideoOptInInput): boolean {
  return videoOptInBlock(input) === null;
}
