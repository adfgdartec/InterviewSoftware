import type { ReactElement } from 'react';
import { LOOP_TEMPLATES, TRACKS, trackById } from '@loopcraft/core';
import { StartLoopButton } from '../components/StartLoopButton.js';

/**
 * Prep surface. Templates are labelled as modelled on publicly reported formats, and the
 * source pages they were modelled on are linked -- spec §5.3 permits naming a company
 * descriptively but forbids implying affiliation, so the disclaimer travels with the name.
 */
export default function PrepPage(): ReactElement {
  return (
    <>
      <h1 className="text-3xl font-bold text-plum-900">Choose a loop to rehearse</h1>
      <p className="mt-2 max-w-[65ch] text-neutral-600">
        Each loop is modelled on a publicly reported interview format. Rounds are graded
        against published, anchored rubrics.
      </p>

      <section aria-labelledby="templates-heading" className="mt-8">
        <h2 id="templates-heading" className="text-xl font-semibold text-plum-900">
          Loop formats
        </h2>
        <ul className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {LOOP_TEMPLATES.map((template) => {
            const track = trackById(template.trackId);
            return (
              <li
                key={template.id}
                className="flex flex-col rounded-lg border border-neutral-200 bg-white p-5 shadow-sm"
              >
                <h3 className="text-lg font-semibold text-plum-900">{template.name}</h3>
                <p className="mt-1 text-xs font-medium uppercase tracking-wide text-neutral-600">
                  {track?.name ?? template.trackId} · level {template.levelBand} ·{' '}
                  {template.rounds.length} rounds ·{' '}
                  {template.rounds.reduce((sum, r) => sum + r.minutes, 0)} minutes
                </p>
                <p className="mt-3 text-sm text-neutral-900">{template.modeledOnNote}</p>
                <details className="mt-3 text-sm text-neutral-600">
                  <summary className="cursor-pointer font-medium text-plum-700">
                    What the rounds are
                  </summary>
                  <ol className="mt-2 list-decimal space-y-1 pl-5">
                    {template.rounds.map((round) => (
                      <li key={round.position}>
                        <strong className="text-neutral-900">{round.roundType}</strong> —{' '}
                        {round.persona}, {round.minutes} min
                      </li>
                    ))}
                  </ol>
                </details>
                <StartLoopButton loopTemplateId={template.id} levelBand={template.levelBand} />
                <p className="mt-4 text-xs text-neutral-600">
                  Modelled on:{' '}
                  {template.sourceUrls.map((url, index) => (
                    <span key={url}>
                      {index > 0 ? ', ' : ''}
                      <a
                        href={url}
                        rel="noreferrer noopener nofollow"
                        className="underline hover:text-plum-700"
                      >
                        {new URL(url).hostname}
                      </a>
                    </span>
                  ))}
                </p>
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby="tracks-heading" className="mt-10">
        <h2 id="tracks-heading" className="text-xl font-semibold text-plum-900">
          Tracks
        </h2>
        <ul className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[...TRACKS]
            .sort((a, b) => a.shipOrder - b.shipOrder)
            .map((track) => (
              <li
                key={track.id}
                className="rounded-lg border border-neutral-200 bg-white p-5 shadow-sm"
              >
                <h3 className="text-lg font-semibold text-plum-900">{track.name}</h3>
                <p className="mt-1 text-sm text-neutral-600">{track.covers}</p>
              </li>
            ))}
        </ul>
      </section>
    </>
  );
}
