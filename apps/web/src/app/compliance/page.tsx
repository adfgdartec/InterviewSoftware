import type { ReactElement } from 'react';
import { BRAND } from '@loopcraft/core';

/**
 * The compliance position paper (spec §5.5): "None of these reach a candidate-side rehearsal
 * tool, but write a one-page position paper explaining why, because every enterprise security
 * questionnaire will ask."
 */
export default function CompliancePage(): ReactElement {
  return (
    <>
      <h1 className="text-3xl font-bold text-plum-900">Compliance position</h1>
      <p className="mt-3 max-w-[70ch] text-neutral-900">
        {BRAND.name} is rehearsal software sold to candidates. It is not a hiring tool, it is
        not sold to employers for candidate evaluation, and it never supplies answers during a
        real interview.
      </p>

      <section aria-labelledby="emotion-heading" className="mt-8 max-w-[70ch]">
        <h2 id="emotion-heading" className="text-xl font-semibold text-plum-900">
          Emotion inference
        </h2>
        <p className="mt-2 text-neutral-900">
          The EU AI Act prohibits inferring emotions of a natural person in workplace and
          educational contexts, and the Commission reads &ldquo;workplace&rdquo; broadly enough
          to include recruitment. {BRAND.name} does not perform emotion inference anywhere.
          Delivery feedback is computed from transcript text and audio timing only.
        </p>
        <p className="mt-3 text-neutral-900">
          Video is optional, off by default, produces only mechanical framing advice, and is
          disabled entirely for users in the EU and Illinois.
        </p>
      </section>

      <section aria-labelledby="biometric-heading" className="mt-8 max-w-[70ch]">
        <h2 id="biometric-heading" className="text-xl font-semibold text-plum-900">
          Biometric and privacy law
        </h2>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-neutral-900">
          <li>
            <strong>Illinois BIPA.</strong> No face geometry or biometric template is
            generated at any point, so no biometric identifier is collected.
          </li>
          <li>
            <strong>Illinois AI Video Interview Act.</strong> Binds employers using AI video
            analysis. {BRAND.name} is candidate-side and performs no video analysis.
          </li>
          <li>
            <strong>Texas CUBI and TDPSA.</strong> Apply to us directly as a Texas-based
            operator; no biometric identifiers are processed.
          </li>
          <li>
            <strong>CCPA/CPRA and GDPR.</strong> No biometric data is processed for unique
            identification. Retention periods are published and deletion purges both database
            rows and stored files.
          </li>
          <li>
            <strong>Minors.</strong> Accounts are gated at 13+, and 16+ in the EU. Video is
            never processed for an account flagged as a minor.
          </li>
        </ul>
      </section>

      <section aria-labelledby="employment-heading" className="mt-8 max-w-[70ch]">
        <h2 id="employment-heading" className="text-xl font-semibold text-plum-900">
          Employment-AI laws we do not trigger
        </h2>
        <p className="mt-2 text-neutral-900">
          Colorado SB 26-189, NYC Local Law 144 and Illinois HB 3773 bind developers and
          deployers of systems used to make consequential employment decisions. {BRAND.name}{' '}
          makes no selection decision: a candidate buys it for themselves, and its output is
          never sold to an employer. We preserve that distinction deliberately, because it is
          what keeps the product outside the high-risk classification.
        </p>
      </section>

      <section aria-labelledby="claims-heading" className="mt-8 max-w-[70ch]">
        <h2 id="claims-heading" className="text-xl font-semibold text-plum-900">
          What we will not claim
        </h2>
        <p className="mt-2 text-neutral-900">
          We make no claim about your chance of being hired, no guarantee of any offer, and no
          success rate. We have run no efficacy study, so we assert no efficacy. If we ever
          run one it will be preregistered, with the denominator defined before data
          collection, and published with its methodology.
        </p>
        <p className="mt-3 text-neutral-900">
          We do not use scraped or leaked question banks. Every item is generated against a
          published rubric and records its provenance.
        </p>
      </section>

      <section aria-labelledby="a11y-heading" className="mt-8 max-w-[70ch]">
        <h2 id="a11y-heading" className="text-xl font-semibold text-plum-900">
          Accessibility
        </h2>
        <p className="mt-2 text-neutral-900">
          We target WCAG 2.2 AA: full keyboard operation, captions on generated audio, a
          text-only interview mode, and configurable time limits.
        </p>
      </section>

      <p className="mt-10 max-w-[70ch] text-sm text-neutral-600">{BRAND.affiliationDisclaimer}</p>
    </>
  );
}
