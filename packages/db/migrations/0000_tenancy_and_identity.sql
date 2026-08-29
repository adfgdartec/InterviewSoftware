-- 0000 · tenancy, identity, and the RLS substrate.
-- Spec §3.2: RLS on every table, deny by default.

-- search_path is pinned because the internal schema and the database role share the name
-- "loopcraft": with the default '"$user", public', every CREATE TABLE after 0000 creates the
-- schema would silently land in the loopcraft schema instead of public.
set search_path = public, loopcraft;

create extension if not exists "pgcrypto";

create schema if not exists loopcraft;

-- Resolves the acting user. In production Supabase sets request.jwt.claims per request;
-- locally and in tests the connection sets app.current_user_id. Returns NULL when neither
-- is present, which -- because every policy compares against it -- denies all access.
create or replace function loopcraft.current_user_id() returns uuid
language plpgsql
stable
as $$
declare
  claims text;
  raw text;
begin
  claims := current_setting('request.jwt.claims', true);
  if claims is not null and claims <> '' then
    raw := claims::jsonb ->> 'sub';
    if raw is not null and raw <> '' then
      return raw::uuid;
    end if;
  end if;

  raw := current_setting('app.current_user_id', true);
  if raw is null or raw = '' then
    return null;
  end if;
  return raw::uuid;
exception
  when others then
    return null;
end;
$$;

create table orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_at timestamptz not null default now()
);

create table users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  display_name text,
  -- Spec §5.2: gate at 13+, 16+ in the EU. Stored as a verified band, never a birthdate.
  age_band text not null default 'unknown'
    check (age_band in ('unknown', 'under_13', '13_to_15', '16_plus')),
  -- Spec §5.1: video processing is disabled entirely for EU and Illinois users.
  jurisdiction text not null default 'unknown',
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table memberships (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  created_at timestamptz not null default now(),
  unique (org_id, user_id)
);
create index memberships_user_idx on memberships(user_id);
create index memberships_org_idx on memberships(org_id);

-- The org set the acting user may read. STABLE so the planner hoists it out of row loops.
-- SECURITY DEFINER because memberships itself is under RLS: without it, the policy on
-- memberships would recurse into this function.
create or replace function loopcraft.member_org_ids() returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select m.org_id from memberships m where m.user_id = loopcraft.current_user_id();
$$;

create or replace function loopcraft.is_org_member(target uuid) returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from memberships m
    where m.user_id = loopcraft.current_user_id() and m.org_id = target
  );
$$;
