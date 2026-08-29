-- 0005 · The global catalog is read-only to the application role.
--
-- With only a SELECT policy, an UPDATE against a catalog table filtered every row out and
-- reported "0 rows updated" instead of refusing. Silent denial hides bugs: a mis-scoped
-- write looks like a successful no-op. Revoking the verbs makes the refusal explicit, which
-- is also the honest expression of guardrail 5 -- plans, items and rubrics are server-managed
-- content that no tenant-facing code path may mutate.

set search_path = public, loopcraft;

do $$
declare t text;
begin
  foreach t in array array[
    'plans', 'tracks', 'rubrics', 'rubric_anchors', 'loop_templates', 'rounds_spec',
    'items', 'item_stats'
  ]
  loop
    execute format('revoke insert, update, delete on public.%I from loopcraft_app', t);
  end loop;
end
$$;
