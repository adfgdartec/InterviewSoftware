import type { Item, LoopTemplate, Rubric, Track } from '@loopcraft/core';
import type { Sql } from './client.js';

/**
 * Loads the authored catalog (packages/core) into Postgres. The TypeScript modules are the
 * authoring source; these tables are what the session engine and RLS actually read, and
 * turns.item_id is a foreign key into `items`, so an item that exists only in TypeScript
 * cannot be recorded against a turn.
 *
 * Idempotent: safe to run on every boot and in every test setup.
 */

export async function seedTracks(sql: Sql, tracks: readonly Track[]): Promise<void> {
  for (const t of tracks) {
    await sql`
      insert into tracks (id, name, family, ship_order)
      values (${t.id}, ${t.name}, ${t.family}, ${t.shipOrder})
      on conflict (id) do update
        set name = excluded.name, family = excluded.family, ship_order = excluded.ship_order`;
  }
}

export async function seedRubrics(sql: Sql, rubrics: readonly Rubric[]): Promise<void> {
  for (const r of rubrics) {
    // 'shared' rubrics are not owned by a track but the column is NOT NULL, so they are
    // registered against a synthetic 'shared' track row inserted by the caller.
    await sql`
      insert into rubrics (id, track_id, round_type, name, version)
      values (${r.id}, ${r.trackId}, ${r.roundType}, ${r.name}, ${r.version})
      on conflict (id) do update set name = excluded.name`;
    for (const dim of r.dimensions) {
      for (const a of dim.anchors) {
        await sql`
          insert into rubric_anchors (rubric_id, dimension, level, anchor_text,
                                      worked_example_a, worked_example_b)
          values (${r.id}, ${dim.id}, ${a.level}, ${a.anchor},
                  ${a.workedExampleA}, ${a.workedExampleB})
          on conflict (rubric_id, dimension, level) do update
            set anchor_text = excluded.anchor_text`;
      }
    }
  }
}

export async function seedLoopTemplates(
  sql: Sql,
  templates: readonly LoopTemplate[],
): Promise<void> {
  for (const t of templates) {
    await sql`
      insert into loop_templates (id, name, track_id, level_band, source_urls, modeled_on_note)
      values (${t.id}, ${t.name}, ${t.trackId}, ${t.levelBand},
              ${sql.array(t.sourceUrls as string[])}, ${t.modeledOnNote})
      on conflict (id) do update set name = excluded.name`;
    for (const r of t.rounds) {
      await sql`
        insert into rounds_spec (loop_template_id, position, round_type, persona, rubric_id, minutes)
        values (${t.id}, ${r.position}, ${r.roundType}, ${r.persona}, ${r.rubricId}, ${r.minutes})
        on conflict (loop_template_id, position) do update
          set round_type = excluded.round_type, persona = excluded.persona,
              rubric_id = excluded.rubric_id, minutes = excluded.minutes`;
    }
  }
}

export async function seedItems(sql: Sql, items: readonly Item[]): Promise<void> {
  for (const i of items) {
    await sql`
      insert into items (id, track_id, rubric_id, round_type, prompt, provenance,
                         provenance_note, generator_rubric_version, difficulty_b,
                         discrimination_a)
      values (${i.id}, ${i.trackId}, ${i.rubricId}, ${i.roundType}, ${i.prompt},
              ${i.provenance}, ${i.provenanceNote}, ${i.generatorRubricVersion},
              ${i.difficultyB}, ${i.discriminationA})
      on conflict (id) do update set prompt = excluded.prompt`;
    await sql`
      insert into item_stats (item_id) values (${i.id}) on conflict (item_id) do nothing`;
  }
}

/**
 * Loads the whole authored catalog. Inserts a synthetic `shared` track first: four rubrics
 * are deliberately cross-cutting (spec §2.6 -- STAR quality does not change with the
 * candidate's specialization) but `rubrics.track_id` is NOT NULL and a foreign key, so the
 * shared rubrics need a row to point at. It is marked inactive so it never appears in a
 * track picker.
 */
export async function seedFullCatalog(
  sql: Sql,
  catalog: {
    readonly tracks: readonly Track[];
    readonly rubrics: readonly Rubric[];
    readonly templates: readonly LoopTemplate[];
    readonly items: readonly Item[];
  },
): Promise<void> {
  await sql`
    insert into tracks (id, name, family, ship_order, active)
    values ('shared', 'Cross-cutting rubrics', 'general', 999, false)
    on conflict (id) do nothing`;
  await seedTracks(sql, catalog.tracks);
  await seedRubrics(sql, catalog.rubrics);
  await seedLoopTemplates(sql, catalog.templates);
  await seedItems(sql, catalog.items);
}
