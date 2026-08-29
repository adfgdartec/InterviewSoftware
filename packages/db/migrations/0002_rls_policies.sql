-- 0002 · Row-level security on every table, deny by default.
-- Spec §3.2 and acceptance criterion 6. Enabling RLS with no matching policy denies; each
-- policy below is therefore additive to a closed baseline, never a loosening of an open one.
--
-- The application connects as loopcraft_app, which is NOT a superuser and does NOT own the
-- tables, so RLS genuinely applies to it. Migrations run as the owner and bypass RLS, the
-- same split Supabase uses between the postgres role and the authenticated role.

-- search_path is pinned because the internal schema and the database role share the name
-- "loopcraft": with the default '"$user", public', every CREATE TABLE after 0000 creates the
-- schema would silently land in the loopcraft schema instead of public.
set search_path = public, loopcraft;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'loopcraft_app') then
    create role loopcraft_app login password 'loopcraft_app_local_dev';
  end if;
end
$$;

grant usage on schema public, loopcraft to loopcraft_app;
grant select, insert, update, delete on all tables in schema public to loopcraft_app;
grant usage, select on all sequences in schema public to loopcraft_app;
grant execute on all functions in schema loopcraft to loopcraft_app;
alter default privileges in schema public
  grant select, insert, update, delete on tables to loopcraft_app;

-- Every table in public gets RLS enabled and forced. FORCE matters: without it the owner
-- silently bypasses its own policies and a future owner-connected code path would leak.
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public'
  loop
    execute format('alter table public.%I enable row level security', t.tablename);
    execute format('alter table public.%I force row level security', t.tablename);
  end loop;
end
$$;

-- ---------------------------------------------------------------- identity
create policy orgs_member_read on orgs
  for select using (loopcraft.is_org_member(id));

create policy users_self_read on users
  for select using (id = loopcraft.current_user_id());
create policy users_self_update on users
  for update using (id = loopcraft.current_user_id())
  with check (id = loopcraft.current_user_id());

create policy memberships_member_read on memberships
  for select using (loopcraft.is_org_member(org_id));

-- ---------------------------------------------------------------- global catalog
-- Readable by any authenticated user; writable by none. Guardrail 5: item selection and
-- plan resolution happen server-side, and no client may mutate the catalog.
do $$
declare t text;
begin
  foreach t in array array[
    'plans', 'tracks', 'rubrics', 'rubric_anchors', 'loop_templates', 'rounds_spec',
    'items', 'item_stats'
  ]
  loop
    execute format(
      'create policy %I on public.%I for select using (loopcraft.current_user_id() is not null)',
      t || '_authenticated_read', t);
  end loop;
end
$$;

-- ---------------------------------------------------------------- tenant tables
-- One uniform shape: a row is visible exactly when the acting user is a member of its org.
do $$
declare t text;
begin
  foreach t in array array[
    'entitlements', 'usage_ledger', 'idempotency_keys', 'sessions', 'rounds', 'turns',
    'artifacts', 'grader_runs', 'scores', 'score_dimensions', 'ability_estimates',
    'consent_events', 'retention_jobs', 'model_runs'
  ]
  loop
    execute format(
      'create policy %I on public.%I for all using (loopcraft.is_org_member(org_id)) '
      || 'with check (loopcraft.is_org_member(org_id))',
      t || '_org_isolation', t);
  end loop;
end
$$;

-- audit_log is append-only from the application's perspective and its org_id is nullable
-- for system events, which must never be readable by a tenant.
create policy audit_log_org_read on audit_log
  for select using (org_id is not null and loopcraft.is_org_member(org_id));
create policy audit_log_org_insert on audit_log
  for insert with check (org_id is not null and loopcraft.is_org_member(org_id));

-- consent_events is immutable append-only (spec §3.2). Revoke the verbs outright rather
-- than relying on the absence of a policy, so the intent is visible in the grant table.
revoke update, delete on consent_events from loopcraft_app;
revoke update, delete on audit_log from loopcraft_app;
