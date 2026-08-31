import type { ReactElement } from 'react';
import { AbilityReadout, ScoreWithInterval } from './ScoreWithInterval.js';

/**
 * The longitudinal dashboard. Phase 5 exit criterion: theta and its standard error surfaced
 * with uncertainty. Spec §2.9: readiness is an ability estimate against a target level with a
 * stated standard error, never a probability of getting an offer.
 */

export interface DashboardDimension {
  readonly dimension: string;
  readonly theta: number;
  readonly standardError: number;
  readonly reportable: boolean;
  readonly targetTheta: number;
}

export interface DashboardRoundScore {
  readonly label: string;
  readonly median: number;
  readonly intervalLow: number;
  readonly intervalHigh: number;
  readonly lowInformation: boolean;
  readonly evidenceQuote: string;
}

export interface DashboardProps {
  readonly abilities: readonly DashboardDimension[];
  readonly recentScores: readonly DashboardRoundScore[];
  readonly focusDimension: string | null;
  readonly dueForReview: readonly string[];
}

export function Dashboard(props: DashboardProps): ReactElement {
  const { abilities, recentScores, focusDimension, dueForReview } = props;
  const measured = abilities.filter((a) => a.reportable);

  return (
    <>
      <h1 className="text-3xl font-bold text-plum-900">Your progress</h1>

      <section
        aria-labelledby="focus-heading"
        className="mt-6 rounded-lg border border-gold-600 bg-gold-100 p-5"
      >
        <h2 id="focus-heading" className="text-lg font-semibold text-plum-900">
          What to practise next
        </h2>
        {focusDimension === null ? (
          <p className="mt-2 text-sm text-neutral-900">
            Not enough evidence yet to recommend a focus. Complete a few more rounds and a
            recommendation will appear here.
          </p>
        ) : (
          <p className="mt-2 text-sm text-neutral-900">
            Your weakest well-measured dimension is <strong>{focusDimension}</strong>. That is
            where practice buys the most right now.
          </p>
        )}
      </section>

      <section aria-labelledby="ability-heading" className="mt-8">
        <h2 id="ability-heading" className="text-xl font-semibold text-plum-900">
          Ability estimates
        </h2>
        <p className="mt-1 max-w-[65ch] text-sm text-neutral-600">
          Each estimate is shown with its standard error. A wide interval means we do not know
          yet, not that you are inconsistent.
        </p>
        {abilities.length === 0 ? (
          <p className="mt-4 text-sm text-neutral-600">No dimensions measured yet.</p>
        ) : (
          <ul className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {abilities.map((a) => (
              <li key={a.dimension}>
                <AbilityReadout
                  dimension={a.dimension}
                  theta={a.theta}
                  standardError={a.standardError}
                  reportable={a.reportable}
                  targetTheta={a.targetTheta}
                />
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-neutral-600">
          {measured.length} of {abilities.length} dimensions have enough evidence to report.
        </p>
      </section>

      <section aria-labelledby="recent-heading" className="mt-8">
        <h2 id="recent-heading" className="text-xl font-semibold text-plum-900">
          Most recent round
        </h2>
        {recentScores.length === 0 ? (
          <p className="mt-4 text-sm text-neutral-600">No graded rounds yet.</p>
        ) : (
          <ul className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {recentScores.map((s) => (
              <li key={s.label}>
                <ScoreWithInterval
                  label={s.label}
                  median={s.median}
                  intervalLow={s.intervalLow}
                  intervalHigh={s.intervalHigh}
                  lowInformation={s.lowInformation}
                  evidenceQuote={s.evidenceQuote}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="review-heading" className="mt-8">
        <h2 id="review-heading" className="text-xl font-semibold text-plum-900">
          Due for review
        </h2>
        {dueForReview.length === 0 ? (
          <p className="mt-4 text-sm text-neutral-600">Nothing is due right now.</p>
        ) : (
          <ul className="mt-4 flex flex-wrap gap-2">
            {dueForReview.map((d) => (
              <li
                key={d}
                className="rounded-full bg-plum-100 px-3 py-1 text-sm font-medium text-plum-900"
              >
                {d}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
