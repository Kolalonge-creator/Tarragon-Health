-- Tarragon Health — AI Governance, Safety & Model Management, part 1/6:
-- the AI registry, per-version model metadata, and vendor management.
--
-- The platform already runs ten distinct AI capabilities in production (the
-- AI Coach LangGraph turn, the lifestyle nudge proposer, the patient result
-- explainer, clinician case briefs, lab-report/ECG-report/medication-pack/
-- meal vision extraction, Voyage embeddings, and the Python risk-scoring
-- service) with no shared inventory, no recorded owner, no risk
-- classification, and no way to turn one off without a code deploy. Each one
-- hardcodes its own model id and its own prompt. This is the governance
-- layer for all of them, and it is deliberately a first-class platform
-- capability rather than an appendix: nothing in parts 2-5 works without the
-- registry rows created here.
--
-- NO organisation_id, on purpose. This mirrors escalation_slas
-- (20260730105131) and alert_rules (20260828013011): an AI system's risk
-- class, autonomy ceiling and kill-switch state are platform-wide clinical
-- governance, not tenant data. The *operational* tables that record what a
-- model actually did to a specific patient (ai_interaction_log,
-- ai_safety_incidents, part 3) are org-scoped and RLS'd like any other
-- patient-touching table.
--
-- Two invariants are enforced structurally here rather than left to review:
--   * a high or very-high risk system may never hold autonomy_level =
--     'execute' (40.4, "clinical execution should be highly restricted") --
--     a CHECK, so no migration, admin screen or seed can quietly grant it;
--   * is_enabled (the kill switch, part 5) is only meaningful for a system
--     whose lifecycle_status is 'live'.
-- The fuller "purpose -> owner -> risk -> validation -> guardrails ->
-- monitoring -> audit -> rollback" acceptance gate needs tables from parts
-- 2-4, so it lands as a trigger in part 5.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

-- Potential clinical impact, not model size. Drives how much of the rest of
-- this system is mandatory: high/very_high systems cannot be activated
-- without a signed prompt version and a passing required evaluation run.
create type public.ai_risk_class as enum ('low', 'moderate', 'high', 'very_high');

comment on type public.ai_risk_class is
  'Clinical-impact classification (40.3). low = administrative summarisation; moderate = patient education; high = clinical decision support; very_high = could materially influence diagnosis or treatment.';

-- What the AI is permitted to do on its own. Ordered least-to-most
-- autonomous; private.ai_autonomy_rank() below turns it into an integer so
-- guardrails can express a ceiling.
create type public.ai_autonomy_level as enum ('inform_only', 'recommend', 'assist', 'execute');

comment on type public.ai_autonomy_level is
  'Human-oversight model (40.4). inform_only = AI provides information; recommend = a human must decide; assist = AI performs part of a workflow; execute = AI performs an action automatically.';

create type public.ai_lifecycle_status as enum (
  'draft', 'in_evaluation', 'approved', 'live', 'suspended', 'retired'
);

comment on type public.ai_lifecycle_status is
  'Registry lifecycle. A system reaches ''live'' only through public.set_ai_system_enabled() (part 5), which re-checks the full acceptance criteria; ''suspended'' is where the kill switch leaves it.';

-- ---------------------------------------------------------------------------
-- Vendors (40.19)
-- ---------------------------------------------------------------------------

create table public.ai_vendors (
  id                          uuid primary key default gen_random_uuid(),
  name                        text not null unique,
  vendor_type                 text not null check (vendor_type in ('model_provider', 'embedding_provider', 'internal', 'other')),
  data_processing_summary     text,
  data_processing_region      text,
  contractual_controls        text,
  security_review_summary     text,
  security_reviewed_at        timestamptz,
  service_availability_target text,
  change_notification_channel text,
  last_change_notice_at       timestamptz,
  last_change_notice_summary  text,
  is_active                   boolean not null default true,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

comment on table public.ai_vendors is
  'External (and internal) providers behind each registered AI system (40.19): who they are, what they do with data, what contractual and security controls apply, and how they notify us of changes. ai_vendor_model_observations is the mechanism that catches a vendor changing the underlying model *without* notifying us.';

create trigger ai_vendors_set_updated_at
  before update on public.ai_vendors
  for each row execute function private.set_updated_at();

alter table public.ai_vendors enable row level security;

create policy ai_vendors_select on public.ai_vendors
  for select to authenticated using (private.is_org_staff(private.current_org_id()));
create policy ai_vendors_write on public.ai_vendors
  for all to authenticated using (private.is_admin()) with check (private.is_admin());

grant select, insert, update, delete on public.ai_vendors to authenticated;

-- ---------------------------------------------------------------------------
-- The registry (40.1, 40.2, 40.3, 40.4, 40.17, 40.18)
-- ---------------------------------------------------------------------------

create table public.ai_systems (
  id                    uuid primary key default gen_random_uuid(),
  system_code           text not null unique check (system_code ~ '^AI-[0-9]{3}$'),
  name                  text not null,
  purpose               text not null,
  -- Accountable owner. owner_role is the *function* that owns it and is
  -- always required; owner_profile_id names the current individual and is
  -- null-gated (an unset owner means "needs assigning", never a default),
  -- the same discipline doctor_tier and reviewed_by already follow.
  owner_role            text not null,
  owner_profile_id      uuid references public.profiles (id) on delete set null,
  vendor_id             uuid references public.ai_vendors (id) on delete restrict,
  risk_class            public.ai_risk_class not null,
  autonomy_level        public.ai_autonomy_level not null,
  -- True when this system's outputs can influence a clinical decision about
  -- an identifiable patient. Drives the mandatory audit trail (40.11) and
  -- the kill-switch requirement (40.17).
  clinically_meaningful boolean not null,
  lifecycle_status      public.ai_lifecycle_status not null default 'draft',
  is_enabled            boolean not null default false,
  disabled_at           timestamptz,
  disabled_by           uuid references public.profiles (id) on delete set null,
  disabled_reason       text,
  -- 40.18: what happens to the workflow when this AI is unavailable or
  -- switched off. Required for every registered system, because "care
  -- continues" is the whole point of registering it.
  fallback_behaviour    text not null,
  code_reference        text,
  review_interval_days  integer check (review_interval_days is null or review_interval_days > 0),
  next_review_due       date,
  notes                 text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  -- 40.4. Clinical execution is highly restricted: a system that could
  -- materially influence diagnosis or treatment, or that provides clinical
  -- decision support, may never act automatically. Structural, so it cannot
  -- be granted by an admin screen, a seed, or a careless later migration.
  constraint ai_systems_no_high_risk_autonomous_execution
    check (not (autonomy_level = 'execute' and risk_class in ('high', 'very_high'))),
  -- The kill switch is only meaningful for a system that is actually live.
  constraint ai_systems_enabled_only_when_live
    check (not is_enabled or lifecycle_status = 'live'),
  -- A disabled system says why and when, so an investigation (40.17) starts
  -- from a record rather than from memory.
  constraint ai_systems_disable_reason_present
    check ((disabled_at is null) = (disabled_reason is null))
);

comment on table public.ai_systems is
  'The AI registry (40.1): one row per AI capability the platform runs, carrying its purpose, accountable owner, vendor, clinical-risk class (40.3), autonomy ceiling (40.4), fallback behaviour (40.18) and kill-switch state (40.17). Platform-wide governance, deliberately not org-scoped -- see the migration header. Runtime code must resolve a system by system_code and honour private.ai_system_runtime_state().';

comment on column public.ai_systems.is_enabled is
  'The kill switch. Flip it only through public.set_ai_system_enabled() (part 5), which enforces the acceptance criteria, records who and why, writes audit_log and notifies clinical operations. A false value must send every caller down fallback_behaviour, never to a degraded silent failure.';

comment on column public.ai_systems.clinically_meaningful is
  'True when this system''s output can influence a clinical decision about an identifiable patient. Every interaction with a clinically meaningful system must be written to ai_interaction_log (40.11).';

create index ai_systems_enabled_idx on public.ai_systems (is_enabled) where is_enabled;
create index ai_systems_risk_idx on public.ai_systems (risk_class, lifecycle_status);
create index ai_systems_review_due_idx on public.ai_systems (next_review_due) where next_review_due is not null;

create trigger ai_systems_set_updated_at
  before update on public.ai_systems
  for each row execute function private.set_updated_at();

alter table public.ai_systems enable row level security;

-- The registry itself is not PHI, and transparency about which AI systems
-- exist is part of the point -- any authenticated user may read it. Only an
-- admin may write, and the governance-significant columns (is_enabled,
-- lifecycle_status) are additionally protected by the part-5 trigger so even
-- an admin goes through the RPC.
create policy ai_systems_select on public.ai_systems
  for select to authenticated using (true);
create policy ai_systems_insert on public.ai_systems
  for insert to authenticated with check (private.is_admin());
create policy ai_systems_update on public.ai_systems
  for update to authenticated using (private.is_admin()) with check (private.is_admin());

grant select, insert, update on public.ai_systems to authenticated;

-- ---------------------------------------------------------------------------
-- Per-version model metadata (40.2) + validation/approval record (40.9)
-- ---------------------------------------------------------------------------

create table public.ai_system_versions (
  id                        uuid primary key default gen_random_uuid(),
  ai_system_id              uuid not null references public.ai_systems (id) on delete cascade,
  version                   text not null,
  model_identifier          text not null,
  training_data_description text,
  intended_population       text not null,
  excluded_population       text not null,
  validation_summary        text,
  validation_completed_at   timestamptz,
  validated_by              uuid references public.clinical_staff (id) on delete restrict,
  approved_by               uuid references public.clinical_staff (id) on delete restrict,
  approved_at               timestamptz,
  deployed_at               timestamptz,
  retired_at                timestamptz,
  review_due_on             date,
  change_summary            text,
  created_by                uuid references public.profiles (id) on delete set null,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),

  constraint ai_system_versions_unique_version unique (ai_system_id, version),
  -- approved_by/approved_at move together, and are server-derived by
  -- public.approve_ai_system_version() (part 5) -- never client-supplied.
  constraint ai_system_versions_approval_paired
    check ((approved_by is null) = (approved_at is null)),
  constraint ai_system_versions_validation_paired
    check ((validated_by is null) = (validation_completed_at is null)),
  -- Nothing is deployed that was never approved.
  constraint ai_system_versions_deploy_requires_approval
    check (deployed_at is null or approved_at is not null)
);

comment on table public.ai_system_versions is
  'Per-version model metadata (40.2): the model actually behind this version, what it was trained on, who it is and is not intended for, and the validation + governance approval that let it deploy. intended_population/excluded_population are NOT NULL because "who is this not for" is the single most safety-relevant field on the record and an empty one reads as "everyone".';

comment on column public.ai_system_versions.excluded_population is
  'Populations this version is explicitly NOT validated for (40.2, 40.5 unsupported-population restrictions). Write "None identified" rather than leaving it vague -- an unstated exclusion is indistinguishable from an unconsidered one.';

create index ai_system_versions_system_idx on public.ai_system_versions (ai_system_id, created_at desc);
create index ai_system_versions_model_idx on public.ai_system_versions (model_identifier);
create index ai_system_versions_review_idx on public.ai_system_versions (review_due_on) where review_due_on is not null;

create trigger ai_system_versions_set_updated_at
  before update on public.ai_system_versions
  for each row execute function private.set_updated_at();

alter table public.ai_system_versions enable row level security;

create policy ai_system_versions_select on public.ai_system_versions
  for select to authenticated using (true);
-- A draft version may be proposed by an admin, but never self-approved:
-- approval goes through public.approve_ai_system_version() (part 5), which
-- checks the required evaluation runs first.
create policy ai_system_versions_insert on public.ai_system_versions
  for insert to authenticated
  with check (private.is_admin() and approved_by is null and approved_at is null and deployed_at is null);
create policy ai_system_versions_update on public.ai_system_versions
  for update to authenticated using (private.is_admin()) with check (private.is_admin());

grant select, insert, update on public.ai_system_versions to authenticated;

-- Blocks the "edit the approved record instead of cutting a new version"
-- shortcut. Once a version carries an approval, the fields that describe
-- what was approved are frozen; correcting them means a new version row.
create or replace function private.guard_ai_system_version_immutability()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.approved_at is not null then
    if new.model_identifier is distinct from old.model_identifier
      or new.intended_population is distinct from old.intended_population
      or new.excluded_population is distinct from old.excluded_population
      or new.training_data_description is distinct from old.training_data_description
      or new.version is distinct from old.version
    then
      raise exception 'ai_system_versions: % is already approved -- create a new version instead of editing what was approved', old.version;
    end if;
  end if;
  return new;
end;
$$;

comment on function private.guard_ai_system_version_immutability() is
  'Freezes the substantive metadata of an approved AI system version. Correcting an approved record means a new version row, so the approval always refers to something that still exists as approved.';

create trigger ai_system_versions_immutable_after_approval
  before update on public.ai_system_versions
  for each row execute function private.guard_ai_system_version_immutability();

-- ---------------------------------------------------------------------------
-- Vendor model observations (40.19 -- "a vendor silently changing the
-- underlying model should not go unnoticed")
-- ---------------------------------------------------------------------------

create table public.ai_vendor_model_observations (
  id                        uuid primary key default gen_random_uuid(),
  ai_system_id              uuid not null references public.ai_systems (id) on delete cascade,
  vendor_id                 uuid references public.ai_vendors (id) on delete set null,
  observed_model_identifier text not null,
  expected_model_identifier text,
  is_expected               boolean not null,
  first_seen_at             timestamptz not null default now(),
  last_seen_at              timestamptz not null default now(),
  observation_count         bigint not null default 1,
  acknowledged_by           uuid references public.profiles (id) on delete set null,
  acknowledged_at           timestamptz,

  constraint ai_vendor_model_observations_unique
    unique (ai_system_id, observed_model_identifier)
);

comment on table public.ai_vendor_model_observations is
  'What model identifier each AI system actually reported at call time, versus what the approved active version says it should be (40.19). An unexpected observation is the detection point for a vendor swapping the underlying model without notice; part 3''s recording function raises an automated ai_safety_incidents row the first time one appears.';

create index ai_vendor_model_observations_unexpected_idx
  on public.ai_vendor_model_observations (last_seen_at desc) where not is_expected;

alter table public.ai_vendor_model_observations enable row level security;

create policy ai_vendor_model_observations_select on public.ai_vendor_model_observations
  for select to authenticated using (private.is_org_staff(private.current_org_id()));
create policy ai_vendor_model_observations_update on public.ai_vendor_model_observations
  for update to authenticated using (private.is_admin()) with check (private.is_admin());

grant select, update on public.ai_vendor_model_observations to authenticated;

-- ---------------------------------------------------------------------------
-- Shared helper: autonomy as an orderable rank, so a guardrail can express
-- a ceiling ("this system may never exceed 'recommend'") without every
-- caller re-encoding the enum order.
-- ---------------------------------------------------------------------------

create or replace function private.ai_autonomy_rank(p_level public.ai_autonomy_level)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case p_level
    when 'inform_only' then 1
    when 'recommend'   then 2
    when 'assist'      then 3
    when 'execute'     then 4
  end;
$$;

comment on function private.ai_autonomy_rank(public.ai_autonomy_level) is
  'Least-to-most autonomous rank for ai_autonomy_level, so a max_autonomy guardrail (40.5) can be compared numerically.';

revoke all on function private.ai_autonomy_rank(public.ai_autonomy_level) from public, anon;

-- ---------------------------------------------------------------------------
-- Assertions -- "created" should be provable, not hopeful.
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_type where typname = 'ai_risk_class') then
    raise exception 'ai_risk_class enum was not created';
  end if;
  if not exists (select 1 from pg_type where typname = 'ai_autonomy_level') then
    raise exception 'ai_autonomy_level enum was not created';
  end if;
  if not exists (select 1 from pg_type where typname = 'ai_lifecycle_status') then
    raise exception 'ai_lifecycle_status enum was not created';
  end if;

  if (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname in ('ai_vendors', 'ai_systems', 'ai_system_versions', 'ai_vendor_model_observations')) <> 4
  then
    raise exception 'not every part-1 AI governance table was created';
  end if;

  -- Every new table has RLS on. (The 2026-08-01 sweep found ~30 tables that
  -- did not; this asserts rather than assumes.)
  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in ('ai_vendors', 'ai_systems', 'ai_system_versions', 'ai_vendor_model_observations')
      and not c.relrowsecurity
  ) then
    raise exception 'an AI governance table was created without row level security';
  end if;

  -- The two structural invariants actually discriminate.
  begin
    insert into public.ai_systems
      (system_code, name, purpose, owner_role, risk_class, autonomy_level,
       clinically_meaningful, fallback_behaviour)
    values ('AI-999', 'assertion probe', 'probe', 'probe', 'very_high', 'execute', true, 'probe');
    raise exception 'ai_systems_no_high_risk_autonomous_execution did not block a very_high/execute row';
  exception
    when check_violation then null;
  end;

  begin
    insert into public.ai_systems
      (system_code, name, purpose, owner_role, risk_class, autonomy_level,
       clinically_meaningful, fallback_behaviour, lifecycle_status, is_enabled)
    values ('AI-999', 'assertion probe', 'probe', 'probe', 'low', 'inform_only', false, 'probe', 'draft', true);
    raise exception 'ai_systems_enabled_only_when_live did not block an enabled draft row';
  exception
    when check_violation then null;
  end;

  if exists (select 1 from public.ai_systems where system_code = 'AI-999') then
    raise exception 'assertion probe row leaked into ai_systems';
  end if;
end;
$$;
