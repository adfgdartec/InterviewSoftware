import type { ReactElement } from 'react';
import { LOOP_TEMPLATES, TRACKS, trackById } from '@loopcraft/core';
import { StartLoopButton } from '../components/StartLoopButton.js';

/**
 * Prep surface, as a catalogue: the loops are inventory, so the page is an index of them
 * rather than a marketing page with cards. Templates are labelled as modelled on publicly
 * reported formats, and the source pages they were modelled on are linked -- spec §5.3
 * permits naming a company descriptively but forbids implying affiliation, so the
 * disclaimer travels with the name.
 */
export default function PrepPage(): ReactElement {
  return (
    <>
      <header className="max-w-[46ch]">
        <h1 className="display text-plum-900 text-[length:var(--text-display-s)]">
          Choose a loop to rehearse
        </h1>
        <p className="mt-4 text-lg text-neutral-600">
          Each loop is modelled on a publicly reported interview format. Rounds are graded
          against published, anchored rubrics.
        </p>
      </header>

      <section aria-labelledby="templates-heading" className="mt-14">
        <div className="flex items-baseline justify-between gap-4 border-b border-rule-firm pb-3">
          <h2 id="templates-heading" className="display text-2xl text-plum-900">
            Loop formats
          </h2>
          <span className="label data text-neutral-600">{LOOP_TEMPLATES.length} available</span>
        </div>

        <ul className="mt-6 grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
          {LOOP_TEMPLATES.map((template) => {
            const track = trackById(template.trackId);
            const minutes = template.rounds.reduce((sum, r) => sum + r.minutes, 0);
            return (
              <li key={template.id} className="entry overflow-hidden">
                {/* min-height reserves two lines for the name. Loop names differ in length
                    by a line, and without it the spec strip below sits at a different height
                    in every card of a row -- the same misalignment `mt-auto` fixes at the
                    bottom of the card, arriving from the top instead. */}
                <div className="flex min-h-[6.5rem] flex-col justify-start p-5 pb-4">
                  <p className="label text-plum-500">{track?.name ?? template.trackId}</p>
                  <h3 className="display mt-1.5 text-2xl text-plum-900">{template.name}</h3>
                </div>

                {/* The meta row as an actual specification, not a middot sentence. */}
                <dl className="spec">
                  <div>
                    <dt>Level</dt>
                    <dd>{template.levelBand}</dd>
                  </div>
                  <div>
                    <dt>Rounds</dt>
                    <dd>{template.rounds.length}</dd>
                  </div>
                  <div>
                    <dt>Minutes</dt>
                    <dd>{minutes}</dd>
                  </div>
                </dl>

                <div className="flex flex-1 flex-col p-5 pt-4">
                  <p className="text-sm leading-relaxed text-neutral-900">
                    {template.modeledOnNote}
                  </p>

                  <details className="group mt-4">
                    <summary className="label cursor-pointer list-none text-plum-700 transition-colors hover:text-plum-900">
                      <span className="inline-block transition-transform group-open:rotate-90">
                        &rsaquo;
                      </span>{' '}
                      What the rounds are
                    </summary>
                    <ol className="timeline mt-3">
                      {template.rounds.map((round) => (
                        <li key={round.position}>
                          <span className="n data">{String(round.position).padStart(2, '0')}</span>
                          <span className="text-sm text-neutral-600">
                            <strong className="font-semibold text-neutral-900">
                              {round.roundType}
                            </strong>{' '}
                            — {round.persona},{' '}
                            <span className="data text-xs">{round.minutes} min</span>
                          </span>
                        </li>
                      ))}
                    </ol>
                  </details>

                  {/* `mt-auto` is what makes the card's column layout earn its place: the
                      loop descriptions differ in length by several lines, so without it the
                      start buttons and provenance lines sit at a different height in every
                      card of a row. Pushing the whole action block down aligns them. */}
                  <div className="mt-auto pt-5">
                    <StartLoopButton loopTemplateId={template.id} levelBand={template.levelBand} />
                    <p className="mt-3 border-t border-rule pt-3 text-xs text-neutral-600">
                      Modelled on:{' '}
                      {template.sourceUrls.map((url, index) => (
                        <span key={url}>
                          {index > 0 ? ', ' : ''}
                          <a
                            href={url}
                            rel="noreferrer noopener nofollow"
                            className="underline decoration-rule-firm underline-offset-2 transition-colors hover:text-plum-700"
                          >
                            {new URL(url).hostname}
                          </a>
                        </span>
                      ))}
                    </p>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      {/* Tracks are a lower-density index than the loops -- rendered as a rule-separated
          list rather than a second wall of identical cards, so the page has two textures
          instead of one repeated twelve times. */}
      <section aria-labelledby="tracks-heading" className="mt-20">
        <div className="flex items-baseline justify-between gap-4 border-b border-rule-firm pb-3">
          <h2 id="tracks-heading" className="display text-2xl text-plum-900">
            Tracks
          </h2>
          <span className="label data text-neutral-600">{TRACKS.length} tracks</span>
        </div>
        <ul className="mt-2 grid grid-cols-1 md:grid-cols-2">
          {[...TRACKS]
            .sort((a, b) => a.shipOrder - b.shipOrder)
            .map((track) => (
              <li
                key={track.id}
                className="border-b border-rule py-4 pr-6 transition-colors hover:bg-sunk"
              >
                <h3 className="text-base font-semibold text-plum-900">{track.name}</h3>
                <p className="mt-1 max-w-[52ch] text-sm text-neutral-600">{track.covers}</p>
              </li>
            ))}
        </ul>
      </section>
    </>
  );
}
