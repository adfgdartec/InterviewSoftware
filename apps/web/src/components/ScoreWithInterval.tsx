import type { ReactElement } from 'react';

/**
 * The only component that renders a score. Acceptance criterion 8: "Every score shown to a
 * user carries an uncertainty interval and a link to the method."
 *
 * There is deliberately no prop for rendering a bare number and no variant that hides the
 * interval, so a future page cannot show a false-precision integer by passing a flag. The
 * interval and the calibration link are structural, not decoration.
 */

export interface ScoreWithIntervalProps {
  readonly label: string;
  readonly median: number;
  readonly intervalLow: number;
  readonly intervalHigh: number;
  /** True when the grader's samples disagreed enough that the score is weak evidence. */
  readonly lowInformation?: boolean;
  readonly evidenceQuote?: string;
}

const CALIBRATION_HREF = '/calibration';

function halfWidth(median: number, low: number, high: number): number {
  return Math.round(Math.max(median - low, high - median) * 10) / 10;
}

export function ScoreWithInterval(props: ScoreWithIntervalProps): ReactElement {
  const { label, median, intervalLow, intervalHigh, lowInformation, evidenceQuote } = props;
  const spread = halfWidth(median, intervalLow, intervalHigh);
  const reading = `${median.toFixed(1)} ± ${spread.toFixed(1)}`;

  return (
    <div className="score">
      <div className="score__head">
        <h3 className="score__label">{label}</h3>
        <p className="score__reading">
          {/* The interval is inside the same element as the number, so no layout change can
              separate them and leave the number standing alone. */}
          <span className="score__value">{reading}</span>
          <span className="score__scale"> on a 1–5 anchored rubric</span>
        </p>
      </div>

      <p className="score__method">
        Median of three independent grader samples, shown with the observed spread.{' '}
        <a href={CALIBRATION_HREF}>How this score is produced and how reliable it is</a>.
      </p>

      {lowInformation === true ? (
        <p className="score__caveat" role="note">
          The three samples disagreed. Treat this as weak evidence rather than a measurement.
        </p>
      ) : null}

      {evidenceQuote === undefined || evidenceQuote === '' ? null : (
        <figure className="score__evidence">
          <blockquote>{evidenceQuote}</blockquote>
          <figcaption>Quoted from your answer</figcaption>
        </figure>
      )}
    </div>
  );
}

/**
 * Ability estimate on the IRT scale. Phase 5 exit criterion: "θ and SE surfaced with
 * uncertainty in UI." An unreportable estimate renders as a statement that there is not
 * enough evidence -- never as a number with a very wide interval, which reads as a
 * measurement to anyone skimming.
 */
export interface AbilityReadoutProps {
  readonly dimension: string;
  readonly theta: number;
  readonly standardError: number;
  readonly reportable: boolean;
  readonly targetTheta: number;
}

export function AbilityReadout(props: AbilityReadoutProps): ReactElement {
  const { dimension, theta, standardError, reportable, targetTheta } = props;

  if (!reportable) {
    return (
      <div className="ability ability--unmeasured">
        <h3 className="ability__label">{dimension}</h3>
        <p className="ability__reading">Not enough evidence yet to estimate this.</p>
        <p className="ability__method">
          Practise this dimension a few more times and an estimate will appear here.
        </p>
      </div>
    );
  }

  const gap = theta - targetTheta;
  const direction = gap >= 0 ? 'at or above' : 'below';

  return (
    <div className="ability">
      <h3 className="ability__label">{dimension}</h3>
      <p className="ability__reading">
        <span className="ability__value">
          θ {theta.toFixed(2)} ± {standardError.toFixed(2)}
        </span>
        <span className="ability__target">
          {' '}
          — {direction} your target of {targetTheta.toFixed(2)}
        </span>
      </p>
      <p className="ability__method">
        An ability estimate with its standard error.{' '}
        <a href={CALIBRATION_HREF}>What this means</a>. It is not a prediction of any hiring
        outcome.
      </p>
    </div>
  );
}
