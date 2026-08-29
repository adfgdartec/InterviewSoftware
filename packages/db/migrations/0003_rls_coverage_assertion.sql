-- 0003 · Make "RLS on every table" a database-enforced invariant rather than a convention.
-- Any future migration that adds a table without RLS fails this function, which the test
-- suite and CI both call.

-- search_path is pinned because the internal schema and the database role share the name
-- "loopcraft": with the default '"$user", public', every CREATE TABLE after 0000 creates the
-- schema would silently land in the loopcraft schema instead of public.
set search_path = public, loopcraft;

create or replace function loopcraft.tables_without_rls()
returns table (table_name text, rls_enabled boolean, rls_forced boolean, policy_count bigint)
language sql
stable
as $$
  select
    c.relname::text,
    c.relrowsecurity,
    c.relforcerowsecurity,
    (select count(*) from pg_policy p where p.polrelid = c.oid)
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'r'
    and (c.relrowsecurity is false or c.relforcerowsecurity is false
         or (select count(*) from pg_policy p where p.polrelid = c.oid) = 0)
  order by c.relname;
$$;
