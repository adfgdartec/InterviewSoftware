-- 0004 · Split the RLS invariant into the two things it actually asserts.
--
-- A table with RLS enabled and forced but zero policies is deny-all, which is the safest
-- state, not a hole -- schema_migrations is deliberately in that state. The security
-- invariant is therefore "enabled AND forced on every table"; the separate functional
-- invariant "every tenant table is reachable by its own org" is asserted by the test suite.

set search_path = public, loopcraft;

drop function if exists loopcraft.tables_without_rls();

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
    and (c.relrowsecurity is false or c.relforcerowsecurity is false)
  order by c.relname;
$$;

-- Tables that hold tenant rows and must be reachable by a member of their own org.
create or replace function loopcraft.tenant_tables_without_policy()
returns table (table_name text)
language sql
stable
as $$
  select c.relname::text
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  join pg_attribute a on a.attrelid = c.oid and a.attname = 'org_id' and a.attnum > 0
  where n.nspname = 'public'
    and c.relkind = 'r'
    and (select count(*) from pg_policy p where p.polrelid = c.oid) = 0
  order by c.relname;
$$;
