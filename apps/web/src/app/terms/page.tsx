import type { ReactElement } from 'react';
import { BRAND } from '@loopcraft/core';
import { TERMS_VERSION } from '../../server/auth.js';

export const metadata = { title: 'Terms of service' };

/**
 * Terms of service. Required before taking money, and the other half of what the signup
 * checkbox has been asking people to accept.
 *
 * The auto-renewal section is written to California's ARL, which is the strictest of the
 * state automatic-renewal laws and is therefore the national default here: the renewal terms
 * are stated in plain language, consent to them is a separate affirmative step at checkout,
 * and cancellation takes no more clicks than signup.
 */
export default function TermsPage(): ReactElement {
  return (
    <div className="max-w-[70ch]">
      <h1 className="display text-plum-900 text-[length:var(--text-display-s)]">Terms of service</h1>
      <p className="label mt-3 text-neutral-600">Version {TERMS_VERSION}</p>

      <p className="mt-6 text-neutral-900">
        These terms are between you and {BRAND.legalEntity}. Using {BRAND.name} means you accept
        them.
      </p>

      <section aria-labelledby="what-this-is" className="mt-10">
        <h2 id="what-this-is" className="display text-xl text-plum-900">What this is, and is not</h2>
        <p className="mt-2 text-neutral-900">
          {BRAND.name} is rehearsal software. You practise interview rounds and receive scores
          against published rubrics.
        </p>
        <p className="mt-3 text-neutral-900">
          It is not a hiring tool, it is not sold to employers to evaluate candidates, and it
          never assists you during a real interview. {BRAND.scoreDisclosure} We make no claim
          about your chance of being hired, no guarantee of any offer, and no success rate. We
          have run no efficacy study, so we assert no efficacy.
        </p>
      </section>

      <section aria-labelledby="eligibility" className="mt-10">
        <h2 id="eligibility" className="display text-xl text-plum-900">Who may use it</h2>
        <p className="mt-2 text-neutral-900">
          You must be at least 13, and at least 16 in the European Union. Age and region are
          self-reported at signup and are not independently verified. An account created with
          an inaccurate age may be closed.
        </p>
      </section>

      <section aria-labelledby="renewal" className="mt-10">
        <h2 id="renewal" className="display text-xl text-plum-900">Subscriptions and renewal</h2>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-neutral-900">
          <li>
            Paid plans <strong>renew automatically</strong> at the price and interval shown at
            checkout, until you cancel.
          </li>
          <li>
            You consent to those renewal terms in a <strong>separate, explicit step</strong>
            {' '}at checkout — not bundled into paying.
          </li>
          <li>
            You receive an <strong>acknowledgment by email</strong> containing the terms, the
            price, the renewal interval and how to cancel. Keep it.
          </li>
          <li>
            <strong>Cancelling takes no more steps than signing up.</strong> Settings &rarr;
            Cancel subscription. There is no retention offer and no phone call. Access
            continues until the end of the period you have already paid for.
          </li>
          <li>
            We email a reminder before each renewal.
          </li>
        </ul>
      </section>

      <section aria-labelledby="acceptable" className="mt-10">
        <h2 id="acceptable" className="display text-xl text-plum-900">What you agree not to do</h2>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-neutral-900">
          <li>Use the product during an actual interview, or to assist anyone who is in one.</li>
          <li>Resell access, or share one account across several people.</li>
          <li>Attempt to extract the question bank or rubrics in bulk.</li>
          <li>Upload content you have no right to, or anyone else&rsquo;s personal data.</li>
        </ul>
      </section>

      <section aria-labelledby="your-content" className="mt-10">
        <h2 id="your-content" className="display text-xl text-plum-900">Your answers stay yours</h2>
        <p className="mt-2 text-neutral-900">
          You keep ownership of everything you write or say. You grant us only the permission
          needed to run the product: to store your answers, send them to the providers listed
          in the{' '}
          <a href="/privacy" className="font-medium text-plum-700 underline underline-offset-2">
            privacy notice
          </a>{' '}
          for grading and transcription, and show the results back to you. We do not use your
          answers to train models.
        </p>
      </section>

      <section aria-labelledby="ending" className="mt-10">
        <h2 id="ending" className="display text-xl text-plum-900">Ending it</h2>
        <p className="mt-2 text-neutral-900">
          You can delete your account at any time from Settings. Deletion is immediate and
          irreversible: it purges your sessions, answers and scores, not just your login. We may
          close an account that breaches these terms, and will say why.
        </p>
      </section>

      <section aria-labelledby="liability" className="mt-10">
        <h2 id="liability" className="display text-xl text-plum-900">Warranties and liability</h2>
        <p className="mt-2 text-neutral-900">
          The product is provided as is. Scores are generated by language models and are
          imprecise by construction, which is why every score is shown with an uncertainty
          interval and a link to{' '}
          <a href="/calibration" className="font-medium text-plum-700 underline underline-offset-2">
            how it was produced
          </a>
          . To the extent the law allows, our total liability is limited to what you paid us in
          the twelve months before the claim. Nothing here limits liability that cannot be
          limited by law.
        </p>
      </section>

      <section aria-labelledby="changes" className="mt-10">
        <h2 id="changes" className="display text-xl text-plum-900">Changes</h2>
        <p className="mt-2 text-neutral-900">
          We may update these terms. Material changes are notified by email before they take
          effect, and continuing to use the product after that is acceptance. Every version is
          numbered, and the version you accepted is recorded against your account.
        </p>
      </section>

      <p className="mt-10 text-sm text-neutral-600">
        Questions:{' '}
        <a href={`mailto:${BRAND.supportEmail}`} className="font-medium text-plum-700 underline underline-offset-2">
          {BRAND.supportEmail}
        </a>
        . {BRAND.affiliationDisclaimer}
      </p>
    </div>
  );
}
