import type { ReactElement } from 'react';

/**
 * The public calibration card (spec §2.6, §7 acceptance criterion 7). This page is the
 * product's answer to a regulator asking what a score means, so it states plainly that no
 * agreement statistic has been measured rather than displaying a placeholder.
 */
export default function CalibrationPage(): ReactElement {
  return (
    <>
      <h1>How Loopcraft scores work</h1>

      <section aria-labelledby="status-heading" className="callout">
        <h2 id="status-heading">Reliability has not been measured yet</h2>
        <p>
          No agreement statistic appears on this page, because none has been measured. There
          is no gold set yet. Any figure shown here today would be fabricated, so none is
          shown.
        </p>
      </section>

      <section aria-labelledby="what-heading">
        <h2 id="what-heading">What a score is</h2>
        <p>
          A score is a coaching signal. It is not a prediction of a hiring outcome, and
          Loopcraft does not estimate anyone&rsquo;s chance of receiving an offer.
        </p>
        <p>
          Every dimension is scored 1&ndash;5 against a written behavioural anchor with two
          worked examples. Scores are never rescaled to 0&ndash;100 and there is no
          &ldquo;exceptional&rdquo; threshold.
        </p>
      </section>

      <section aria-labelledby="method-heading">
        <h2 id="method-heading">Method</h2>
        <ol>
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

      <section aria-labelledby="not-heading">
        <h2 id="not-heading">What is never graded</h2>
        <p>
          Delivery feedback comes only from transcript text and audio timing: speaking rate,
          filler ratio, pause lengths, longest unbroken stretch, response latency, hedging
          density, quantification density, and STAR segment coverage.
        </p>
        <p>
          Loopcraft never infers emotion, sentiment, engagement, enthusiasm, mood or
          personality from your face, your voice, or video. This is enforced by a rule that
          fails our build, not by policy alone.
        </p>
      </section>

      <section aria-labelledby="limits-heading">
        <h2 id="limits-heading">Known limitations</h2>
        <ul>
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
