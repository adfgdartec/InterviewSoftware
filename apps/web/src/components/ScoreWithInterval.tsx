import type { ReactElement } from 'react';

/**
 * The only component that renders a score. Acceptance criterion 8: "Every score shown to a
 * user carries an uncertainty interval and a link to the method."
 *
 * There is deliberately no prop for rendering a bare number and no variant that hides the
 * interval, so a future page cannot show a false-precision integer by passing a flag. The
 * interval and the calibration link are structural, not decoration.
 *
 * The gauge added in the redesign draws the same interval the text states: the band is the
 * interval, the mark is the median. It is a second rendering of data already present, never
 * a substitute for it -- remove the gauge and the reading is still complete.
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
const LINK_CLASS =
  'font-medium text-plum-700 underline decoration-plum-700/30 underline-offset-2 hover:decoration-plum-700';

function halfWidth(median: number, low: number, high: number): number {
  return Math.round(Math.max(median - low, high - median) * 10) / 10;
}

/** Position of a 1-5 score along the gauge track. */
function pct(value: number): number {
  return Math.min(100, Math.max(0, ((value - 1) / 4) * 100));
}

export function ScoreWithInterval(props: ScoreWithIntervalProps): ReactElement {
  const { label, median, intervalLow, intervalHigh, lowInformation, evidenceQuote } = props;
  const spread = halfWidth(median, intervalLow, intervalHigh);
  const reading = `${median.toFixed(1)} ± ${spread.toFixed(1)}`;

  return (
    <div className="flex h-full flex-col rounded-xl border border-rule bg-raised p-5">
      <h3 className="label text-plum-500">{label}</h3>

      <p className="mt-2 flex flex-wrap items-baseline gap-x-2">
        {/* The interval is inside the same element as the number, so no layout change can
            separate them and leave the number standing alone. */}
        <span className="data text-3xl text-plum-900">{reading}</span>
        <span className="text-xs text-neutral-600"> on a 1–5 anchored rubric</span>
      </p>

      <div className="gauge mt-3" aria-hidden="true">
        <span
          className="gauge-band"
          style={{ left: `${pct(intervalLow)}%`, right: `${100 - pct(intervalHigh)}%` }}
        />
        <span className="gauge-mark" style={{ left: `${pct(median)}%` }} />
      </div>

      <p className="mt-3 text-xs leading-relaxed text-neutral-600">
        Median of three independent grader samples, shown with the observed spread.{' '}
        <a href={CALIBRATION_HREF} className={LINK_CLASS}>
          How this score is produced and how reliable it is
        </a>
        .
      </p>

      {lowInformation === true ? (
        <p
          role="note"
          className="mt-3 rounded-lg border-l-2 border-warning bg-gold-100 px-3 py-2 text-xs text-warning"
        >
          The three samples disagreed. Treat this as weak evidence rather than a measurement.
        </p>
      ) : null}

      {evidenceQuote === undefined || evidenceQuote === '' ? null : (
        <figure className="mt-auto pt-4">
          <blockquote className="border-l-2 border-gold-600 pl-3 text-sm leading-relaxed text-neutral-900">
            {evidenceQuote}
          </blockquote>
          <figcaption className="label mt-2 pl-3 text-neutral-600">Quoted from your answer</figcaption>
        </figure>
      )}
    </div>
  );
}

/**
 * Ability estimate on the IRT scale. Phase 5 exit criterion: "θ and SE surfaced with
 * uncertainty in UI." An unreportable estimate renders as a statement that there is not
 * enough evidence -- never as a number with a very wide interval, which reads as a
 * measurement to anyone skimming. The two states are given deliberately different textures
 * so they cannot be confused at a glance.
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
      <div className="flex h-full flex-col rounded-xl border border-dashed border-rule-firm bg-sunk p-5">
        <h3 className="label text-neutral-600">{dimension}</h3>
        <p className="mt-2 text-sm font-medium text-neutral-900">
          Not enough evidence yet to estimate this.
        </p>
        <p className="mt-2 text-xs text-neutral-600">
          Practise this dimension a few more times and an estimate will appear here.
        </p>
      </div>
    );
  }

  const gap = theta - targetTheta;
  const direction = gap >= 0 ? 'at or above' : 'below';

  return (
    <div className="flex h-full flex-col rounded-xl border border-rule bg-raised p-5">
      <h3 className="label text-plum-500">{dimension}</h3>
      <p className="mt-2">
        <span className="data text-3xl text-plum-900">
          θ {theta.toFixed(2)} ± {standardError.toFixed(2)}
        </span>
        {/* Kept as one contiguous text node on purpose: the a11y suite asserts the exact
            string "below your target of 1.00", and splitting the number into its own span
            for tabular figures would silently break that guarantee. */}
        <span className="mt-1 block text-xs text-neutral-600">
          {direction} your target of {targetTheta.toFixed(2)}
        </span>
      </p>
      <p className="mt-3 text-xs leading-relaxed text-neutral-600">
        An ability estimate with its standard error.{' '}
        <a href={CALIBRATION_HREF} className={LINK_CLASS}>
          What this means
        </a>
        . It is not a prediction of any hiring outcome.
      </p>
    </div>
  );
}
