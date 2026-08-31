import type { ReactElement } from 'react';
import { BRAND } from '@loopcraft/core';

/**
 * The public calibration card (spec §2.6, §7 acceptance criterion 7). This page is the
 * product's answer to a regulator asking what a score means, so it states plainly that no
 * agreement statistic has been measured rather than displaying a placeholder.
 */
export default function CalibrationPage(): ReactElement {
  return (
    <>
      <h1 className="text-3xl font-bold text-plum-900">How {BRAND.name} scores work</h1>

      <section
        aria-labelledby="status-heading"
        className="mt-6 max-w-[70ch] rounded-lg border border-gold-600 bg-neutral-50 p-5"
      >
        <h2 id="status-heading" className="text-lg font-semibold text-plum-900">
          Reliability has not been measured yet
        </h2>
        <p className="mt-2 text-sm text-neutral-900">
          No agreement statistic appears on this page, because none has been measured. There
          is no gold set yet. Any figure shown here today would be fabricated, so none is
          shown.
        </p>
      </section>

      <section aria-labelledby="what-heading" className="mt-8 max-w-[70ch]">
        <h2 id="what-heading" className="text-xl font-semibold text-plum-900">
          What a score is
        </h2>
        <p className="mt-2 text-neutral-900">
          A score is a coaching signal. It is not a prediction of a hiring outcome, and{' '}
          {BRAND.name} does not estimate anyone&rsquo;s chance of receiving an offer.
        </p>
        <p className="mt-3 text-neutral-900">
          Every dimension is scored 1&ndash;5 against a written behavioural anchor with two
          worked examples. Scores are never rescaled to 0&ndash;100 and there is no
          &ldquo;exceptional&rdquo; threshold.
        </p>
      </section>

      <section aria-labelledby="method-heading" className="mt-8 max-w-[70ch]">
        <h2 id="method-heading" className="text-xl font-semibold text-plum-900">
          Method
        </h2>
        <ol className="mt-3 list-decimal space-y-3 pl-5 text-neutral-900">
          <li>
            <strong>Grader separation.</strong> The model that interviews you never grades
            you. A separate grader sees only the transcript, your artifacts, and the rubric.
          </li>
          <li>
            <strong>Three samples.</strong> Each round is graded three times independently.
            The median is reported, with the spread between samples shown as the interval.
          </li>
          <li>
            <strong>Uncertainty is mandatory.</strong> A score cannot be stored without its
            interval, and the interval never collapses to zero.
          </li>
          <li>
            <strong>Evidence.</strong> Every dimension carries a quote from your answer and
            the turn it came from.
          </li>
        </ol>
      </section>

      <section aria-labelledby="not-heading" className="mt-8 max-w-[70ch]">
        <h2 id="not-heading" className="text-xl font-semibold text-plum-900">
          What is never graded
        </h2>
        <p className="mt-2 text-neutral-900">
          Delivery feedback comes only from transcript text and audio timing: speaking rate,
          filler ratio, pause lengths, longest unbroken stretch, response latency, hedging
          density, quantification density, and STAR segment coverage.
        </p>
        <p className="mt-3 text-neutral-900">
          {BRAND.name} never infers emotion, sentiment, engagement, enthusiasm, mood or
          personality from your face, your voice, or video. This is enforced by a rule that
          fails our build, not by policy alone.
        </p>
      </section>

      <section aria-labelledby="limits-heading" className="mt-8 max-w-[70ch]">
        <h2 id="limits-heading" className="text-xl font-semibold text-plum-900">
          Known limitations
        </h2>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-neutral-900">
          <li>No measured reliability, as stated above.</li>
          <li>
            Item difficulty is cold-started from expert tagging and has not been recalibrated
            from response data.
          </li>
          <li>Every rubric and item is written in English.</li>
          <li>
            Domain reasoning is graded against a shared rubric, which may under-differentiate
            between specialisations.
          </li>
          <li>No demographic fairness analysis has been run.</li>
        </ul>
      </section>
    </>
  );
}
