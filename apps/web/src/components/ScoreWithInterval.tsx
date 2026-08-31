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
const LINK_CLASS = 'font-medium text-plum-700 underline hover:text-plum-900';

function halfWidth(median: number, low: number, high: number): number {
  return Math.round(Math.max(median - low, high - median) * 10) / 10;
}

export function ScoreWithInterval(props: ScoreWithIntervalProps): ReactElement {
  const { label, median, intervalLow, intervalHigh, lowInformation, evidenceQuote } = props;
  const spread = halfWidth(median, intervalLow, intervalHigh);
  const reading = `${median.toFixed(1)} ± ${spread.toFixed(1)}`;

  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
      <div>
        <h3 className="text-sm font-semibold text-plum-900">{label}</h3>
        <p className="mt-1">
          {/* The interval is inside the same element as the number, so no layout change can
              separate them and leave the number standing alone. */}
          <span className="text-2xl font-bold text-plum-900">{reading}</span>
          <span className="ml-1 text-sm text-neutral-600"> on a 1–5 anchored rubric</span>
        </p>
      </div>

      <p className="mt-2 text-sm text-neutral-600">
        Median of three independent grader samples, shown with the observed spread.{' '}
        <a href={CALIBRATION_HREF} className={LINK_CLASS}>
          How this score is produced and how reliable it is
        </a>
        .
      </p>

      {lowInformation === true ? (
        <p
          role="note"
          className="mt-3 rounded-md border border-warning bg-gold-100 px-3 py-2 text-sm text-warning"
        >
          The three samples disagreed. Treat this as weak evidence rather than a measurement.
        </p>
      ) : null}

      {evidenceQuote === undefined || evidenceQuote === '' ? null : (
        <figure className="mt-3 border-l-4 border-gold-600 pl-3">
          <blockquote className="text-sm italic text-neutral-900">{evidenceQuote}</blockquote>
          <figcaption className="mt-1 text-xs text-neutral-600">Quoted from your answer</figcaption>
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
      <div className="rounded-lg border border-dashed border-neutral-200 bg-neutral-50 p-4">
        <h3 className="text-sm font-semibold text-plum-900">{dimension}</h3>
        <p className="mt-1 text-sm text-neutral-600">Not enough evidence yet to estimate this.</p>
        <p className="mt-2 text-xs text-neutral-600">
          Practise this dimension a few more times and an estimate will appear here.
        </p>
      </div>
    );
  }

  const gap = theta - targetTheta;
  const direction = gap >= 0 ? 'at or above' : 'below';

  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
      <h3 className="text-sm font-semibold text-plum-900">{dimension}</h3>
      <p className="mt-1">
        <span className="text-2xl font-bold text-plum-900">
          θ {theta.toFixed(2)} ± {standardError.toFixed(2)}
        </span>
        <span className="ml-1 text-sm text-neutral-600">
          {' '}
          — {direction} your target of {targetTheta.toFixed(2)}
        </span>
      </p>
      <p className="mt-2 text-sm text-neutral-600">
        An ability estimate with its standard error.{' '}
        <a href={CALIBRATION_HREF} className={LINK_CLASS}>
          What this means
        </a>
        . It is not a prediction of any hiring outcome.
      </p>
    </div>
  );
}
