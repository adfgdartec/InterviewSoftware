import type { ReactElement } from 'react';
import { BRAND, RETENTION_SCHEDULE, RETENTION_SCHEDULE_VERSION } from '@loopcraft/core';

export const metadata = { title: 'Privacy notice' };

/**
 * The privacy notice. Required by GDPR Article 13, CCPA/CPRA and the TDPSA before taking
 * money, and the document `/compliance` has been implicitly promising.
 *
 * The retention table is RENDERED from packages/core/src/retention.ts rather than restated
 * here, so the published schedule and the schedule the product actually follows cannot drift
 * -- the same reason the claims gate parses its banned phrases out of the policy document.
 */
export default function PrivacyPage(): ReactElement {
  return (
    <div className="max-w-[70ch]">
      <h1 className="display text-plum-900 text-[length:var(--text-display-s)]">Privacy notice</h1>
      <p className="label mt-3 text-neutral-600">Version {RETENTION_SCHEDULE_VERSION}</p>

      <p className="mt-6 text-neutral-900">
        {BRAND.name} is interview rehearsal software sold to candidates. This notice says what
        it collects, why, how long it keeps it, and what you can make it do. It is written to
        be read, not to be survived.
      </p>

      <section aria-labelledby="controller" className="mt-10">
        <h2 id="controller" className="display text-xl text-plum-900">Who is responsible</h2>
        <p className="mt-2 text-neutral-900">
          {BRAND.legalEntity} is the controller of the data described here. Contact:{' '}
          <a href={`mailto:${BRAND.supportEmail}`} className="font-medium text-plum-700 underline underline-offset-2">
            {BRAND.supportEmail}
          </a>
          .
        </p>
      </section>

      <section aria-labelledby="what" className="mt-10">
        <h2 id="what" className="display text-xl text-plum-900">What is collected, and why</h2>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-neutral-900">
          <li>
            <strong>Your email and password.</strong> To create and secure your account. Legal
            basis: performance of a contract.
          </li>
          <li>
            <strong>Your age range and region.</strong> Self-reported at signup, and not
            verified. They decide whether you may hold an account at all and whether the camera
            feature is available to you. Legal basis: legal obligation.
          </li>
          <li>
            <strong>Your answers, and the scores computed from them.</strong> This is the
            product. Legal basis: performance of a contract.
          </li>
          <li>
            <strong>Audio, when you choose to answer by voice.</strong> Sent to a transcription
            provider and discarded in the same request. Only the resulting text is stored.
          </li>
          <li>
            <strong>Camera framing counts, if you opt in.</strong> Analysed on your device.
            Counts and ratios are stored; no frame, image, video or face measurement is ever
            uploaded, so there is nothing that could reconstruct your appearance.
          </li>
        </ul>
        <p className="mt-4 rounded-lg border-l-2 border-gold-600 bg-gold-100 px-4 py-3 text-sm text-neutral-900">
          No biometric identifier or face template is generated at any point, and no inference
          is ever made about your inner state. Delivery feedback is computed from transcript
          text and audio timing only.
        </p>
      </section>

      <section aria-labelledby="processors" className="mt-10">
        <h2 id="processors" className="display text-xl text-plum-900">Who else processes it</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-rule-firm text-left">
                <th className="label py-2 pr-4 text-neutral-600">Processor</th>
                <th className="label py-2 pr-4 text-neutral-600">For</th>
                <th className="label py-2 text-neutral-600">Receives</th>
              </tr>
            </thead>
            <tbody className="text-neutral-900">
              {[
                ['Supabase', 'Database and sign-in', 'Everything stored, and your email'],
                ['OpenAI', 'Grading and question generation', 'Your answers'],
                ['Deepgram', 'Speech to text', 'Audio you record, when you use voice'],
                ['Cartesia', 'The interviewer’s voice', 'Question text only, never yours'],
                ['Stripe', 'Payments', 'Your email and payment details'],
                ['Cloudflare', 'Hosting', 'Requests in transit'],
              ].map(([who, why, what]) => (
                <tr key={who} className="border-b border-rule">
                  <td className="py-2 pr-4 font-medium">{who}</td>
                  <td className="py-2 pr-4">{why}</td>
                  <td className="py-2">{what}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-sm text-neutral-600">
          These providers are in the United States. Transfers out of the UK or EEA rely on
          Standard Contractual Clauses in our agreement with each of them.
        </p>
      </section>

      <section aria-labelledby="retention" className="mt-10">
        <h2 id="retention" className="display text-xl text-plum-900">How long it is kept</h2>
        <ul className="mt-3 space-y-3">
          {RETENTION_SCHEDULE.map((rule) => (
            <li key={rule.what} className="border-b border-rule pb-3">
              <p className="font-semibold text-neutral-900">
                {rule.what} —{' '}
                <span className="data text-plum-700">
                  {rule.days === null
                    ? 'until you delete your account'
                    : rule.days === 0
                      ? 'not stored'
                      : `${rule.days} days`}
                </span>
              </p>
              <p className="mt-1 text-sm text-neutral-600">{rule.why}</p>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="rights" className="mt-10">
        <h2 id="rights" className="display text-xl text-plum-900">What you can do</h2>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-neutral-900">
          <li>
            <strong>Delete everything.</strong> Settings &rarr; Delete account. It is immediate
            and irreversible, and it purges your sessions, answers and scores, not just your
            login.
          </li>
          <li>
            <strong>Correct what is wrong.</strong> Your name, region and age range are editable
            in Settings.
          </li>
          <li>
            <strong>Ask what is held, or object to processing.</strong> Email{' '}
            <a href={`mailto:${BRAND.supportEmail}`} className="font-medium text-plum-700 underline underline-offset-2">
              {BRAND.supportEmail}
            </a>
            . We answer within 30 days.
          </li>
          <li>
            <strong>Complain.</strong> To your local supervisory authority, if you are in the UK
            or EEA.
          </li>
        </ul>
        <p className="mt-4 text-sm text-neutral-600">
          Your data is never sold or shared for cross-context behavioural advertising, as
          CCPA/CPRA define those terms.
        </p>
      </section>

      <section aria-labelledby="cookies" className="mt-10">
        <h2 id="cookies" className="display text-xl text-plum-900">Cookies</h2>
        <p className="mt-2 text-neutral-900">
          One, holding your sign-in session. It is strictly necessary, so it needs no consent
          banner. There is no analytics, advertising or tracking cookie. If that ever changes,
          this notice changes first and you will be asked.
        </p>
      </section>

      <p className="mt-10 text-sm text-neutral-600">{BRAND.affiliationDisclaimer}</p>
    </div>
  );
}
