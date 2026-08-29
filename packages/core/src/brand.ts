/**
 * Single rename point (spec §0: "Rename in one place (packages/core/src/brand.ts)").
 * Every user-visible occurrence of the product name resolves through this module.
 */
export const BRAND = {
  name: 'Loopcraft',
  legalEntity: 'Loopcraft',
  tagline: 'Interview rehearsal, graded against anchored rubrics.',
  supportEmail: 'support@loopcraft.ai',
  /**
   * Spec §5.3 requires this exact sentence in the footer wherever an employer name appears.
   * Spec §5.1 requires the AI-interaction disclosure under EU AI Act Article 50.
   */
  affiliationDisclaimer:
    'Loopcraft is not affiliated with, endorsed by, or sponsored by any employer named on this site.',
  aiDisclosure: 'You are interacting with an AI system.',
  scoreDisclosure: 'Scores are coaching signals, not predictions of hiring outcomes.',
} as const;

export type Brand = typeof BRAND;
