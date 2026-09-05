-- 0008 · the columns real accounts need, on top of the identity substrate from 0000.
--
-- users.email, age_band, jurisdiction and deleted_at already existed: migration 0000 was
-- written for real auth from the start, and loopcraft.current_user_id() already reads
-- request.jwt.claims ->> 'sub' before falling back to app.current_user_id. Nothing about the
-- RLS substrate changes here -- this only records what a real signup collects.
--
-- No RLS policy is added: users_self_read and users_self_update (migration 0002) are not
-- column-specific, so they cover these automatically.
--
-- Deliberately nullable with no default. Existing rows predate consent, and backfilling a
-- terms_accepted_at they never gave would be a fabricated legal record.

set search_path = public, loopcraft;

alter table users add column terms_accepted_at timestamptz;
alter table users add column terms_version text;
alter table users add column privacy_version text;
alter table users add column auth_provider text
  check (auth_provider in ('password', 'google'));

comment on column users.terms_accepted_at is
  'When this user accepted the terms and privacy notice. NULL for pre-auth demo rows.';
comment on column users.auth_provider is
  'How the account was created. Determines whether a password reset applies to it.';
