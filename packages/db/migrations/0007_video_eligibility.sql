-- 0007 · columns the video framing check's eligibility gate depends on.
--
-- users.age_band and users.jurisdiction already existed (migration 0000) with exactly this
-- feature in mind -- jurisdiction had no constraint yet. No new RLS policy is needed:
-- users already has users_self_read/users_self_update from migration 0002, which cover
-- these new columns automatically since they're not column-specific.

set search_path = public, loopcraft;

alter table users
  add column video_opt_in boolean not null default false;

alter table users
  add constraint users_jurisdiction_check
  check (jurisdiction in ('unknown', 'eu', 'illinois', 'us_other', 'other'));
