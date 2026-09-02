/**
 * Whether the video framing check may be offered to a user. The self-reported region and age
 * half of the gate lives in `lib/video-opt-in.ts`, shared with the settings page so the
 * control is never offered where this function would refuse; this module adds the two
 * conditions only the server knows: the stored opt-in and the plan entitlement.
 *
 * All conditions are required simultaneously -- there is no path where an unset
 * (`'unknown'`) jurisdiction or age band is treated as eligible until proven otherwise.
 */

import { videoOptInPermitted } from '../lib/video-opt-in.js';

export interface VideoEligibilityInput {
  readonly jurisdiction: string;
  readonly ageBand: string;
  readonly videoOptIn: boolean;
  readonly planAllowsVideo: boolean;
}

export function videoEligible(input: VideoEligibilityInput): boolean {
  return (
    videoOptInPermitted({ jurisdiction: input.jurisdiction, ageBand: input.ageBand }) &&
    input.videoOptIn &&
    input.planAllowsVideo
  );
}
