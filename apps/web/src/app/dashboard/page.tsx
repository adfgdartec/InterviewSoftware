import type { ReactElement } from 'react';
import { AbilityReadout, ScoreWithInterval } from '../../components/ScoreWithInterval.js';

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
      <h1>Your progress</h1>

      <section aria-labelledby="focus-heading">
        <h2 id="focus-heading">What to practise next</h2>
        {focusDimension === null ? (
          <p>
            Not enough evidence yet to recommend a focus. Complete a few more rounds and a
            recommendation will appear here.
          </p>
        ) : (
          <p>
            Your weakest well-measured dimension is <strong>{focusDimension}</strong>. That is
            where practice buys the most right now.
          </p>
        )}
      </section>

      <section aria-labelledby="ability-heading">
        <h2 id="ability-heading">Ability estimates</h2>
        <p>
          Each estimate is shown with its standard error. A wide interval means we do not know
          yet, not that you are inconsistent.
        </p>
        {abilities.length === 0 ? (
          <p>No dimensions measured yet.</p>
        ) : (
          <ul className="ability-list">
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
        <p className="dashboard__count">
          {measured.length} of {abilities.length} dimensions have enough evidence to report.
        </p>
      </section>

      <section aria-labelledby="recent-heading">
        <h2 id="recent-heading">Most recent round</h2>
        {recentScores.length === 0 ? (
          <p>No graded rounds yet.</p>
        ) : (
          <ul className="score-list">
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

      <section aria-labelledby="review-heading">
        <h2 id="review-heading">Due for review</h2>
        {dueForReview.length === 0 ? (
          <p>Nothing is due right now.</p>
        ) : (
          <ul>
            {dueForReview.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

/** Route entry point. Data is fetched server-side; this file renders it. */
export default function DashboardPage(): ReactElement {
  return (
    <Dashboard
      abilities={[]}
      recentScores={[]}
      focusDimension={null}
      dueForReview={[]}
    />
  );
}
