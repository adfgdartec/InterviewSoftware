-- 0010 · the columns real billing needs, and somewhere to keep a round's framing summary.
--
-- BILLING. packages/billing already models the California ARL flows (separate affirmative
-- renewal consent, a retainable acknowledgment, reminders, cancellation in no more clicks
-- than signup). What it had no way to do was take money: nothing stored a Stripe customer,
-- subscription or price, so a webhook had nothing to reconcile against.
--
-- Stripe ids are stored, never prices or card data. The plan row remains the authority on
-- what a plan grants -- entitlements.resolveEntitlement reads it, not Stripe -- so a
-- compromised or replayed webhook can change WHICH plan an org is on but cannot invent one
-- with different limits.

set search_path = public, loopcraft;

alter table orgs add column stripe_customer_id text unique;

alter table plans add column stripe_price_id text unique;

alter table entitlements add column stripe_subscription_id text unique;

-- The webhook is the only writer of these, and it is idempotent on event id. Stripe redelivers
-- aggressively, and processing one event twice would double-count a period or re-open a
-- cancelled subscription.
create table loopcraft.stripe_events (
  event_id     text primary key,
  event_type   text not null,
  received_at  timestamptz not null default now()
);
grant select, insert on loopcraft.stripe_events to loopcraft_app;

comment on table loopcraft.stripe_events is
  'Processed Stripe webhook event ids, for idempotency. Infrastructure, not tenant data -- '
  'deliberately outside the public schema and its RLS invariant.';

-- PRESENCE. One row per round, holding only the aggregate counts and ratios computed in the
-- browser by summarizePresence. No frame, image, video, landmark or face geometry is stored,
-- because none is ever uploaded -- there is nothing here that could reconstruct a person.
create table round_presence (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references orgs(id) on delete cascade,
  round_id              uuid not null references rounds(id) on delete cascade unique,
  sample_count          integer not null check (sample_count >= 0),
  detected_count        integer not null check (detected_count >= 0),
  well_framed_ratio     numeric(4,2) not null check (well_framed_ratio between 0 and 1),
  off_center_ratio      numeric(4,2) not null check (off_center_ratio between 0 and 1),
  distance_off_ratio    numeric(4,2) not null check (distance_off_ratio between 0 and 1),
  eye_line_off_ratio    numeric(4,2) not null check (eye_line_off_ratio between 0 and 1),
  drift_events          integer not null check (drift_events >= 0),
  longest_well_framed_ms integer not null check (longest_well_framed_ms >= 0),
  created_at            timestamptz not null default now()
);

alter table round_presence enable row level security;
alter table round_presence force row level security;

create policy round_presence_member_read on round_presence
  for select using (loopcraft.is_org_member(org_id));
create policy round_presence_member_write on round_presence
  for insert with check (loopcraft.is_org_member(org_id));
-- The route upserts: a candidate can stop and restart the camera within a round, and the
-- later summary supersedes the earlier one. Without an UPDATE policy the ON CONFLICT branch
-- is denied by RLS and the whole request fails.
create policy round_presence_member_update on round_presence
  for update using (loopcraft.is_org_member(org_id))
  with check (loopcraft.is_org_member(org_id));

comment on table round_presence is
  'Aggregate camera-framing counts for one round. Geometry only -- no frame, image, video or '
  'face landmark is ever uploaded or stored.';
