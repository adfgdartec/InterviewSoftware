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
      <h1 className="display text-plum-900 text-[length:var(--text-display-s)]">Your progress</h1>

      {/* The single most actionable thing on the page, so it leads and is the only block on
          it wearing the gold. Everything below is reference. */}
      <section
        aria-labelledby="focus-heading"
        className="mt-8 rounded-xl border border-gold-600/40 bg-gold-100 p-6"
      >
        <h2 id="focus-heading" className="label text-plum-900">
          What to practise next
        </h2>
        {focusDimension === null ? (
          <p className="mt-3 max-w-[58ch] text-neutral-900">
            Not enough evidence yet to recommend a focus. Complete a few more rounds and a
            recommendation will appear here.
          </p>
        ) : (
          <p className="mt-3 max-w-[58ch] text-lg text-neutral-900">
            Your weakest well-measured dimension is{' '}
            <strong className="font-semibold text-plum-900">{focusDimension}</strong>. That is
            where practice buys the most right now.
          </p>
        )}
      </section>

      <section aria-labelledby="ability-heading" className="mt-14">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-rule-firm pb-3">
          <h2 id="ability-heading" className="display text-2xl text-plum-900">
            Ability estimates
          </h2>
          <span className="label data text-neutral-600">
            {measured.length} of {abilities.length} reportable
          </span>
        </div>
        <p className="mt-4 max-w-[65ch] text-sm text-neutral-600">
          Each estimate is shown with its standard error. A wide interval means we do not know
          yet, not that you are inconsistent.
        </p>
        {abilities.length === 0 ? (
          <p className="mt-5 rounded-xl border border-dashed border-rule-firm bg-sunk p-6 text-sm text-neutral-600">
            No dimensions measured yet.
          </p>
        ) : (
          <ul className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
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
      </section>

      <section aria-labelledby="recent-heading" className="mt-14">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-rule-firm pb-3">
          <h2 id="recent-heading" className="display text-2xl text-plum-900">
            Most recent round
          </h2>
          <span className="label data text-neutral-600">{recentScores.length} scored</span>
        </div>
        {recentScores.length === 0 ? (
          <p className="mt-5 rounded-xl border border-dashed border-rule-firm bg-sunk p-6 text-sm text-neutral-600">
            No graded rounds yet.
          </p>
        ) : (
          <ul className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
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

      <section aria-labelledby="review-heading" className="mt-14">
        <div className="border-b border-rule-firm pb-3">
          <h2 id="review-heading" className="display text-2xl text-plum-900">
            Due for review
          </h2>
        </div>
        {dueForReview.length === 0 ? (
          <p className="mt-5 text-sm text-neutral-600">Nothing is due right now.</p>
        ) : (
          <ul className="mt-5 flex flex-wrap gap-2">
            {dueForReview.map((d) => (
              <li
                key={d}
                className="rounded-full border border-plum-100 bg-plum-100 px-3.5 py-1.5 text-sm font-medium text-plum-900"
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
