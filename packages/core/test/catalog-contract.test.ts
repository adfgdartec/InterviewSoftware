import { describe, expect, it } from 'vitest';
import { REQUIRED_ROUND_TYPES, type Item } from '../src/catalog-types.js';
import { TRACKS, trackById } from '../src/tracks.js';
import { RUBRICS, rubricById, rubricFor } from '../src/rubrics.js';
import { LOOP_TEMPLATES } from '../src/loop-templates.js';
import { ITEM_BANK, deterministicItemId, fallbackItem, itemsFor } from '../src/item-bank.js';
import { findBannedTokensInText } from '../src/banned-tokens.js';
import { findClaimViolations } from '../src/claims.js';

/**
 * Phase 1 exit criterion: "contract tests pass for every track". Acceptance criterion 2:
 * "Every track produces a valid warmup, domain, behavioral, situational, and closing item,
 * and the fallback path returns a catalog item when providers fail."
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Every user-visible string in the catalog, keyed for a legible failure message. */
function catalogStrings(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const t of TRACKS) {
    out[`track.${t.id}.name`] = t.name;
    out[`track.${t.id}.covers`] = t.covers;
  }
  for (const r of RUBRICS) {
    out[`rubric.${r.id}.name`] = r.name;
    for (const d of r.dimensions) {
      out[`rubric.${r.id}.${d.id}.name`] = d.name;
      out[`rubric.${r.id}.${d.id}.description`] = d.description;
      for (const a of d.anchors) {
        out[`rubric.${r.id}.${d.id}.L${a.level}.anchor`] = a.anchor;
        out[`rubric.${r.id}.${d.id}.L${a.level}.a`] = a.workedExampleA;
        out[`rubric.${r.id}.${d.id}.L${a.level}.b`] = a.workedExampleB;
      }
    }
  }
  for (const t of LOOP_TEMPLATES) {
    out[`template.${t.id}.name`] = t.name;
    out[`template.${t.id}.note`] = t.modeledOnNote;
    for (const r of t.rounds) out[`template.${t.id}.r${r.position}.persona`] = r.persona;
  }
  for (const i of ITEM_BANK) {
    out[`item.${i.id}.prompt`] = i.prompt;
    out[`item.${i.id}.provenance`] = i.provenanceNote;
  }
  return out;
}

describe('every track produces every required item (acceptance criterion 2)', () => {
  it('ships the twelve tracks in spec §2.4 with a unique ship order', () => {
    expect(TRACKS).toHaveLength(12);
    const orders = TRACKS.map((t) => t.shipOrder);
    expect(new Set(orders).size).toBe(12);
    expect(TRACKS.find((t) => t.shipOrder === 1)?.id).toBe('software-engineering');
    expect(TRACKS.find((t) => t.shipOrder === 2)?.id).toBe('ml-systems');
  });

  it.each(TRACKS.map((t) => t.id))('track %s has an item for every required round type', (trackId) => {
    for (const roundType of REQUIRED_ROUND_TYPES) {
      const items = itemsFor(trackId, roundType);
      expect({ trackId, roundType, count: items.length }).toEqual({
        trackId,
        roundType,
        count: items.length,
      });
      expect(items.length).toBeGreaterThanOrEqual(2);
    }
  });

  it.each(TRACKS.map((t) => t.id))('the fallback path returns an item for track %s', (trackId) => {
    for (const roundType of REQUIRED_ROUND_TYPES) {
      const chosen = fallbackItem(trackId, roundType);
      expect(chosen, `no fallback item for ${trackId}/${roundType}`).toBeDefined();
      expect(chosen?.prompt.length).toBeGreaterThan(20);
    }
  });

  it('gives the demo track a coding and a design item (spec §2.2, §2.3)', () => {
    expect(itemsFor('ml-systems', 'coding').length).toBeGreaterThanOrEqual(2);
    expect(itemsFor('ml-systems', 'design').length).toBeGreaterThanOrEqual(2);
  });

  it('declares no round type a track has no items for', () => {
    for (const track of TRACKS) {
      for (const roundType of track.roundTypes) {
        expect({ track: track.id, roundType, has: itemsFor(track.id, roundType).length > 0 })
          .toEqual({ track: track.id, roundType, has: true });
      }
    }
  });
});

describe('item provenance (guardrail 4)', () => {
  it('records a provenance and a non-empty note on every item', () => {
    for (const i of ITEM_BANK) {
      expect(['rubric_generated', 'staff_authored', 'user_contributed_licensed']).toContain(
        i.provenance,
      );
      expect(i.provenanceNote.length).toBeGreaterThan(10);
    }
  });

  it('cites no scraped or leaked source anywhere', () => {
    const forbidden = /glassdoor|blind|leetcode|leaked|scraped|question dump/i;
    const offenders = ITEM_BANK.filter(
      (i) => forbidden.test(i.provenanceNote.replace(/Not derived from[^.]*\./i, '')) || forbidden.test(i.prompt),
    );
    expect(offenders.map((i) => i.id)).toEqual([]);
  });

  it('gives every item a unique, valid uuid', () => {
    const ids = ITEM_BANK.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(UUID);
  });

  it('derives ids deterministically, so an item keeps its id across environments', () => {
    expect(deterministicItemId('ml-systems:domain:0')).toBe(
      deterministicItemId('ml-systems:domain:0'),
    );
    expect(deterministicItemId('a')).not.toBe(deterministicItemId('b'));
    expect(deterministicItemId('')).toMatch(UUID);
  });

  it('keeps IRT parameters inside the ranges spec §2.5 assumes', () => {
    for (const i of ITEM_BANK) {
      expect(i.difficultyB).toBeGreaterThanOrEqual(-2.5);
      expect(i.difficultyB).toBeLessThanOrEqual(2.5);
      expect(i.discriminationA).toBeGreaterThan(0);
      expect(i.levelBands.length).toBeGreaterThan(0);
    }
  });
});

describe('rubrics are fully anchored (spec §2.6)', () => {
  it('gives every dimension exactly five anchors, levels 1 through 5', () => {
    for (const r of RUBRICS) {
      expect(r.dimensions.length).toBeGreaterThanOrEqual(2);
      for (const d of r.dimensions) {
        expect(d.anchors.map((a) => a.level)).toEqual([1, 2, 3, 4, 5]);
      }
    }
  });

  it('gives every anchor a description and two non-empty worked examples', () => {
    for (const r of RUBRICS) {
      for (const d of r.dimensions) {
        for (const a of d.anchors) {
          expect(a.anchor.length, `${r.id}/${d.id}/L${a.level}`).toBeGreaterThan(15);
          expect(a.workedExampleA.length).toBeGreaterThan(10);
          expect(a.workedExampleB.length).toBeGreaterThan(10);
          expect(a.workedExampleA).not.toBe(a.workedExampleB);
        }
      }
    }
  });

  it('resolves a rubric for every track and required round type', () => {
    for (const track of TRACKS) {
      for (const roundType of REQUIRED_ROUND_TYPES) {
        expect(rubricFor(track.id, roundType), `${track.id}/${roundType}`).toBeDefined();
      }
    }
  });

  it('prefers a track-specific rubric over the shared one when both exist', () => {
    expect(rubricFor('ml-systems', 'coding')?.id).toBe('ml-systems.coding.v1');
    expect(rubricFor('general', 'behavioral')?.id).toBe('shared.behavioral.v1');
  });

  it('points every item at a rubric that exists and matches its round type', () => {
    for (const i of ITEM_BANK) {
      const rubric = rubricById(i.rubricId);
      expect(rubric, `item ${i.id} references missing rubric ${i.rubricId}`).toBeDefined();
      expect(rubric?.roundType).toBe(i.roundType);
    }
  });
});

describe('loop templates (spec §2.1, §5.3)', () => {
  it('resolves every round rubric and every track', () => {
    for (const t of LOOP_TEMPLATES) {
      expect(trackById(t.trackId), `template ${t.id} names unknown track`).toBeDefined();
      expect(t.rounds.length).toBeGreaterThan(0);
      for (const r of t.rounds) {
        expect(rubricById(r.rubricId), `${t.id} round ${r.position}`).toBeDefined();
        expect(r.minutes).toBeGreaterThan(0);
        expect(r.persona.length).toBeGreaterThan(3);
      }
    }
  });

  it('numbers rounds contiguously from one', () => {
    for (const t of LOOP_TEMPLATES) {
      expect(t.rounds.map((r) => r.position)).toEqual(
        Array.from({ length: t.rounds.length }, (_unused, i) => i + 1),
      );
    }
  });

  it('cites at least one public source and carries the affiliation disclaimer', () => {
    for (const t of LOOP_TEMPLATES) {
      expect(t.sourceUrls.length).toBeGreaterThan(0);
      for (const url of t.sourceUrls) expect(url).toMatch(/^https:\/\//);
      expect(t.modeledOnNote).toMatch(/not affiliated with, endorsed by, or sponsored by/i);
      expect(t.modeledOnNote).toMatch(/publicly reported/i);
    }
  });

  it('names no employer in a template name (spec §5.3 trade dress)', () => {
    const employers = /google|amazon|meta|facebook|apple|microsoft|netflix|openai|anthropic/i;
    for (const t of LOOP_TEMPLATES) {
      expect({ id: t.id, hit: employers.test(t.name) }).toEqual({ id: t.id, hit: false });
    }
  });

  it('provides the five-round senior ML systems demo loop with coding and design', () => {
    const demo = LOOP_TEMPLATES.find((t) => t.id === 'frontier-lab-ml-systems');
    expect(demo).toBeDefined();
    expect(demo?.levelBand).toBe('L5');
    expect(demo?.rounds.map((r) => r.roundType)).toEqual([
      'warmup', 'domain', 'coding', 'design', 'behavioral',
    ]);
    expect(new Set(demo?.rounds.map((r) => r.persona)).size).toBe(5);
  });
});

describe('the whole catalog is compliant (guardrails 1 and 3)', () => {
  it('contains no affect vocabulary in any string', () => {
    const offenders = Object.entries(catalogStrings())
      .filter(([, value]) => findBannedTokensInText(value).length > 0)
      .map(([key, value]) => `${key}: ${findBannedTokensInText(value)[0]?.token} in "${value.slice(0, 60)}"`);
    expect(offenders).toEqual([]);
  });

  it('makes no banned marketing claim in any string', () => {
    expect(findClaimViolations(catalogStrings())).toEqual([]);
  });

  it('describes anchors as observable behaviour, not inferred state', () => {
    // A behavioural anchor should say what was done or said. "Seemed", "felt" and "appeared"
    // are the tells for an inference the grader cannot verify from a transcript.
    const inferenceVerbs = /\b(seemed|felt|appeared to be|came across as)\b/i;
    const offenders: string[] = [];
    for (const r of RUBRICS) {
      for (const d of r.dimensions) {
        for (const a of d.anchors) {
          if (inferenceVerbs.test(a.anchor)) offenders.push(`${r.id}/${d.id}/L${a.level}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('the bank is big enough to run a loop without repeating', () => {
  it('holds at least two items per track per required round type', () => {
    const shortfalls: string[] = [];
    for (const track of TRACKS) {
      for (const roundType of REQUIRED_ROUND_TYPES) {
        const n = itemsFor(track.id, roundType).length;
        if (n < 2) shortfalls.push(`${track.id}/${roundType}=${n}`);
      }
    }
    expect(shortfalls).toEqual([]);
  });

  it('holds no duplicate prompt within a track and round type', () => {
    for (const track of TRACKS) {
      for (const roundType of REQUIRED_ROUND_TYPES) {
        const prompts = itemsFor(track.id, roundType).map((i: Item) => i.prompt);
        expect(new Set(prompts).size, `${track.id}/${roundType}`).toBe(prompts.length);
      }
    }
  });

  it('gives each track a domain prompt distinct from every other track', () => {
    const domainPrompts = TRACKS.flatMap((t) => itemsFor(t.id, 'domain').map((i) => i.prompt));
    expect(new Set(domainPrompts).size).toBe(domainPrompts.length);
  });
});
