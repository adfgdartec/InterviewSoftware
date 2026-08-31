/**
 * Whether the video framing check may be offered to a user. Spec §5.1: video is disabled
 * entirely for EU and Illinois users; spec §5.2 gates it at 16+ regardless of region. All
 * four conditions are required simultaneously -- there is no path where an unset
 * (`'unknown'`) jurisdiction or age band is treated as eligible until proven otherwise.
 */

export interface VideoEligibilityInput {
  readonly jurisdiction: string;
  readonly ageBand: string;
  readonly videoOptIn: boolean;
  readonly planAllowsVideo: boolean;
}

export function videoEligible(input: VideoEligibilityInput): boolean {
  const jurisdictionOk = input.jurisdiction === 'us_other' || input.jurisdiction === 'other';
  const ageOk = input.ageBand === '16_plus';
  return jurisdictionOk && ageOk && input.videoOptIn && input.planAllowsVideo;
}
