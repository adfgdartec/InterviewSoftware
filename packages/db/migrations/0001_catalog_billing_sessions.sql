-- 0001 · plan catalog, rubric/item content, durable sessions, scoring, compliance.
-- Spec §3.2. Tenant tables carry org_id directly so every RLS policy has the same shape.

-- ---------------------------------------------------------------- billing catalog
-- Global, read-only to the application. Guardrail 8: prices are read from these rows,
-- never hard-coded, and never supplied by the client.
-- search_path is pinned because the internal schema and the database role share the name
-- "loopcraft": with the default '"$user", public', every CREATE TABLE after 0000 creates the
-- schema would silently land in the loopcraft schema instead of public.
set search_path = public, loopcraft;

create table plans (
  id text primary key,
  name text not null,
  price_cents integer not null check (price_cents >= 0),
  currency text not null default 'USD',
  billing_period text not null check (billing_period in ('free', 'monthly', 'annual', 'one_time')),
  included_sessions integer not null check (included_sessions >= 0),
  included_asr_minutes integer not null check (included_asr_minutes >= 0),
  allows_loop_simulation boolean not null default false,
  allows_code_execution boolean not null default false,
  allows_video boolean not null default false,
  auto_renews boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table entitlements (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  plan_id text not null references plans(id),
  status text not null check (status in ('trialing', 'active', 'past_due', 'canceled', 'expired')),
  current_period_start timestamptz not null,
  current_period_end timestamptz not null,
  cancel_at timestamptz,
  -- Spec §5.4: California ARL requires separate affirmative consent to the renewal terms.
  renewal_consent_at timestamptz,
  renewal_consent_version text,
  created_at timestamptz not null default now(),
  check (current_period_end > current_period_start)
);

-- Spec §5.4: an auto-renewing entitlement is invalid without recorded affirmative consent.
-- A CHECK cannot join to plans, so this is a constraint trigger instead.
create or replace function loopcraft.assert_renewal_consent() returns trigger
language plpgsql
as $$
declare
  renews boolean;
begin
  select p.auto_renews into renews from plans p where p.id = new.plan_id;
  if renews and new.renewal_consent_at is null then
    raise exception
      'entitlement % is on auto-renewing plan % without recorded renewal consent (spec §5.4)',
      new.id, new.plan_id
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create constraint trigger entitlements_renewal_consent
  after insert or update on entitlements
  deferrable initially immediate
  for each row execute function loopcraft.assert_renewal_consent();

create table usage_ledger (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  meter text not null check (meter in ('session', 'asr_minute', 'code_execution_second', 'grader_run')),
  quantity numeric(12, 4) not null check (quantity >= 0),
  session_id uuid,
  occurred_at timestamptz not null default now()
);
create index usage_ledger_org_meter_idx on usage_ledger(org_id, meter, occurred_at desc);

create table idempotency_keys (
  key text not null,
  org_id uuid not null references orgs(id) on delete cascade,
  route text not null,
  request_hash text not null,
  response_status integer,
  response_body jsonb,
  created_at timestamptz not null default now(),
  primary key (key, org_id, route)
);

-- ---------------------------------------------------------------- content catalog
create table tracks (
  id text primary key,
  name text not null,
  family text not null check (family in ('software', 'ai', 'product', 'general', 'non_technical')),
  ship_order integer not null,
  active boolean not null default true
);

create table rubrics (
  id text primary key,
  track_id text not null references tracks(id),
  round_type text not null
    check (round_type in ('warmup', 'domain', 'coding', 'design', 'behavioral', 'situational', 'closing')),
  name text not null,
  version integer not null default 1,
  unique (track_id, round_type, version)
);

create table rubric_anchors (
  id uuid primary key default gen_random_uuid(),
  rubric_id text not null references rubrics(id) on delete cascade,
  dimension text not null,
  level integer not null check (level between 1 and 5),
  anchor_text text not null,
  worked_example_a text not null,
  worked_example_b text not null,
  unique (rubric_id, dimension, level)
);

create table loop_templates (
  id text primary key,
  name text not null,
  track_id text not null references tracks(id),
  level_band text not null,
  -- Spec §2.1: cite the public careers page; never claim insider knowledge.
  source_urls text[] not null default '{}',
  modeled_on_note text not null,
  active boolean not null default true,
  check (cardinality(source_urls) > 0)
);

create table rounds_spec (
  id uuid primary key default gen_random_uuid(),
  loop_template_id text not null references loop_templates(id) on delete cascade,
  position integer not null check (position > 0),
  round_type text not null
    check (round_type in ('warmup', 'domain', 'coding', 'design', 'behavioral', 'situational', 'closing')),
  persona text not null,
  rubric_id text not null references rubrics(id),
  minutes integer not null check (minutes between 1 and 120),
  unique (loop_template_id, position)
);

create table items (
  id uuid primary key default gen_random_uuid(),
  track_id text not null references tracks(id),
  rubric_id text not null references rubrics(id),
  round_type text not null,
  prompt text not null,
  -- Guardrail 4: generated against a rubric, never scraped. Provenance is mandatory.
  provenance text not null
    check (provenance in ('rubric_generated', 'staff_authored', 'user_contributed_licensed')),
  provenance_note text not null,
  generated_by_model text,
  generator_rubric_version integer,
  difficulty_b numeric(5, 3) not null default 0,
  discrimination_a numeric(5, 3) not null default 1 check (discrimination_a > 0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index items_track_round_idx on items(track_id, round_type) where active;

create table item_stats (
  item_id uuid primary key references items(id) on delete cascade,
  response_count integer not null default 0 check (response_count >= 0),
  calibrated_b numeric(5, 3),
  calibrated_a numeric(5, 3),
  -- Spec §2.5: recalibrate only once an item has >= 200 responses.
  calibrated_at timestamptz,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- durable sessions
-- Spec §3.2: session state lives in Postgres, not React state. Refresh resumes exactly.
create table sessions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  loop_template_id text not null references loop_templates(id),
  track_id text not null references tracks(id),
  level_band text not null,
  status text not null default 'in_progress'
    check (status in ('in_progress', 'completed', 'abandoned', 'expired')),
  current_round_position integer not null default 1,
  cost_ceiling_cents integer not null default 0 check (cost_ceiling_cents >= 0),
  started_at timestamptz not null default now(),
  completed_at timestamptz
);
create index sessions_user_idx on sessions(user_id, started_at desc);

create table rounds (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  session_id uuid not null references sessions(id) on delete cascade,
  position integer not null check (position > 0),
  round_type text not null,
  rubric_id text not null references rubrics(id),
  persona text not null,
  minutes integer not null,
  status text not null default 'pending'
    check (status in ('pending', 'in_progress', 'completed', 'skipped')),
  started_at timestamptz,
  completed_at timestamptz,
  unique (session_id, position)
);

create table turns (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  round_id uuid not null references rounds(id) on delete cascade,
  item_id uuid references items(id),
  position integer not null check (position > 0),
  question text not null,
  transcript text,
  artifact_ref uuid,
  asked_at timestamptz not null default now(),
  answered_at timestamptz,
  unique (round_id, position)
);

create table artifacts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  session_id uuid not null references sessions(id) on delete cascade,
  kind text not null check (kind in ('audio', 'video', 'code_submission', 'diagram', 'resume', 'job_description')),
  -- Guardrail 6: storage keys only. No public URL is ever persisted or constructed.
  storage_key text not null,
  content_type text not null,
  byte_size bigint not null check (byte_size >= 0),
  created_at timestamptz not null default now(),
  purge_after timestamptz
);
create index artifacts_session_idx on artifacts(session_id);

-- ---------------------------------------------------------------- scoring
create table grader_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  round_id uuid not null references rounds(id) on delete cascade,
  rubric_id text not null references rubrics(id),
  grader_model text not null,
  grader_prompt_version text not null,
  -- Spec §2.6: n=3 independent samples at temperature 0.3.
  sample_index integer not null check (sample_index between 1 and 9),
  temperature numeric(3, 2) not null,
  raw_output jsonb not null,
  created_at timestamptz not null default now(),
  unique (round_id, grader_prompt_version, sample_index)
);

create table scores (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  round_id uuid not null references rounds(id) on delete cascade,
  rubric_id text not null references rubrics(id),
  -- Median of the n samples, on the anchored 1-5 scale. Never rescaled to 0-100.
  median_score numeric(4, 2) not null check (median_score between 1 and 5),
  -- Spec §2.6 / acceptance 8: uncertainty is mandatory, so these are NOT NULL.
  interval_low numeric(4, 2) not null,
  interval_high numeric(4, 2) not null,
  sample_variance numeric(6, 4) not null check (sample_variance >= 0),
  sample_count integer not null check (sample_count >= 1),
  created_at timestamptz not null default now(),
  check (interval_low <= median_score and median_score <= interval_high),
  unique (round_id, rubric_id)
);

create table score_dimensions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  score_id uuid not null references scores(id) on delete cascade,
  dimension text not null,
  median_score numeric(4, 2) not null check (median_score between 1 and 5),
  interval_low numeric(4, 2) not null,
  interval_high numeric(4, 2) not null,
  evidence_quote text,
  evidence_turn_id uuid references turns(id),
  unique (score_id, dimension),
  check (interval_low <= median_score and median_score <= interval_high)
);

create table ability_estimates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  track_id text not null references tracks(id),
  dimension text not null,
  -- Spec §2.5: IRT ability with a standard error. Readiness is never a probability of an offer.
  theta numeric(6, 3) not null,
  standard_error numeric(6, 3) not null check (standard_error > 0),
  responses_used integer not null check (responses_used >= 0),
  estimated_at timestamptz not null default now()
);
create index ability_user_dim_idx on ability_estimates(user_id, track_id, dimension, estimated_at desc);

-- ---------------------------------------------------------------- compliance
create table consent_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  purpose text not null
    check (purpose in ('terms_of_service', 'privacy_policy', 'audio_processing', 'video_processing',
                       'auto_renewal', 'research_participation')),
  granted boolean not null,
  policy_version text not null,
  occurred_at timestamptz not null default now()
);
create index consent_user_purpose_idx on consent_events(user_id, purpose, occurred_at desc);

create table retention_jobs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  subject_user_id uuid not null references users(id) on delete cascade,
  kind text not null check (kind in ('account_delete', 'artifact_expiry', 'dsr_export')),
  status text not null default 'pending' check (status in ('pending', 'running', 'succeeded', 'failed')),
  rows_purged integer not null default 0,
  storage_objects_purged integer not null default 0,
  requested_at timestamptz not null default now(),
  completed_at timestamptz
);

create table audit_log (
  id bigserial primary key,
  org_id uuid references orgs(id) on delete set null,
  actor_user_id uuid references users(id) on delete set null,
  action text not null,
  subject_table text not null,
  subject_id text,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create table model_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  session_id uuid references sessions(id) on delete cascade,
  purpose text not null
    check (purpose in ('question_generation', 'interviewer_turn', 'grading', 'asr', 'tts', 'debrief')),
  provider text not null,
  model text not null,
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  duration_ms integer not null default 0 check (duration_ms >= 0),
  cost_micros bigint not null default 0 check (cost_micros >= 0),
  fell_back boolean not null default false,
  created_at timestamptz not null default now()
);
create index model_runs_session_idx on model_runs(session_id);
