-- 0009 · shared rate-limit state, so the limiter survives more than one process.
--
-- FixedWindowRateLimiter kept its counters in a Map inside one Node process. That was
-- correct for a single node and said so, but the product now guards two metered, billable
-- providers (Deepgram transcription, Cartesia synthesis) and is deployed to Workers, which
-- run many isolates. A per-isolate Map enforces nothing: every isolate starts at zero.
--
-- This table lives in the `loopcraft` schema, NOT `public`, on purpose. It is infrastructure,
-- not tenant data -- there is no org to scope it to, and the RLS invariant asserted by
-- migration 0004 (`enabled AND forced on every public table`) exists to protect tenant rows.
-- Putting a counter table in `public` would either violate that invariant or require a
-- deny-all policy that the app role could not then write through.
--
-- Isolation instead comes from the key itself: `<bucket>:<userId>`, built in guards.ts from
-- the AUTHENTICATED user id and never from anything a client supplies, so one caller cannot
-- address another caller's counter.

set search_path = public, loopcraft;

create table loopcraft.rate_limits (
  bucket_key   text primary key,
  window_start timestamptz not null default now(),
  hits         integer not null default 0
);

-- Sweeping expired rows is cheap and keeps the table bounded; nothing reads a stale window.
create index rate_limits_window_start_idx on loopcraft.rate_limits (window_start);

grant select, insert, update, delete on loopcraft.rate_limits to loopcraft_app;

comment on table loopcraft.rate_limits is
  'Fixed-window counters keyed on <bucket>:<authenticated user id>. Infrastructure, not '
  'tenant data -- deliberately outside the public schema and its RLS invariant.';
