/**
 * Single rename point (spec §0: "Rename in one place (packages/core/src/brand.ts)").
 * Every user-visible occurrence of the product name resolves through this module.
 */
export const BRAND = {
  name: 'InterviewSoftware',
  legalEntity: 'InterviewSoftware',
  tagline: 'Interview rehearsal, graded against anchored rubrics.',
  // Assumption: no real domain has been set up for this name yet. Placeholder in the same
  // shape as before -- update once a real support inbox exists.
  supportEmail: 'support@interviewsoftware.ai',
  /**
   * Spec §5.3 requires this exact sentence in the footer wherever an employer name appears.
   * Spec §5.1 requires the AI-interaction disclosure under EU AI Act Article 50.
   */
  affiliationDisclaimer:
    'InterviewSoftware is not affiliated with, endorsed by, or sponsored by any employer named on this site.',
  aiDisclosure: 'You are interacting with an AI system.',
  scoreDisclosure: 'Scores are coaching signals, not predictions of hiring outcomes.',
} as const;

export type Brand = typeof BRAND;
