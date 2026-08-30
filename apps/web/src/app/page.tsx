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
      <h1>Choose a loop to rehearse</h1>
      <p>
        Each loop is modelled on a publicly reported interview format. Rounds are graded
        against published, anchored rubrics.
      </p>

      <section aria-labelledby="templates-heading">
        <h2 id="templates-heading">Loop formats</h2>
        <ul className="template-list">
          {LOOP_TEMPLATES.map((template) => {
            const track = trackById(template.trackId);
            return (
              <li key={template.id} className="template">
                <h3>{template.name}</h3>
                <p className="template__meta">
                  {track?.name ?? template.trackId} · level {template.levelBand} ·{' '}
                  {template.rounds.length} rounds ·{' '}
                  {template.rounds.reduce((sum, r) => sum + r.minutes, 0)} minutes
                </p>
                <p className="template__note">{template.modeledOnNote}</p>
                <details>
                  <summary>What the rounds are</summary>
                  <ol>
                    {template.rounds.map((round) => (
                      <li key={round.position}>
                        <strong>{round.roundType}</strong> — {round.persona}, {round.minutes} min
                      </li>
                    ))}
                  </ol>
                </details>
                <StartLoopButton loopTemplateId={template.id} levelBand={template.levelBand} />
                <p className="template__sources">
                  Modelled on:{' '}
                  {template.sourceUrls.map((url, index) => (
                    <span key={url}>
                      {index > 0 ? ', ' : ''}
                      <a href={url} rel="noreferrer noopener nofollow">
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

      <section aria-labelledby="tracks-heading">
        <h2 id="tracks-heading">Tracks</h2>
        <ul className="track-list">
          {[...TRACKS]
            .sort((a, b) => a.shipOrder - b.shipOrder)
            .map((track) => (
              <li key={track.id}>
                <h3>{track.name}</h3>
                <p>{track.covers}</p>
              </li>
            ))}
        </ul>
      </section>
    </>
  );
}
