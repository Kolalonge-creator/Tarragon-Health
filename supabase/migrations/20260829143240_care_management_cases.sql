-- Tarragon Health — Chronic Disease Case Management (Module 74), part 1/5:
-- the case itself.
--
-- WHY A NEW TABLE ROOT ("care_management_*"), NOT "case_*": this codebase
-- already uses the word "case" for something else. `case_briefs`
-- (20260730121004) is an AI-drafted summary keyed 1:1 to a single
-- `clinician_alert_id` — "one case is one alert" in that table's own
-- header. Module 74's case is the opposite shape: a longitudinal,
-- per-PATIENT record that can span many alerts, admissions and referrals
-- over weeks or months. Naming it distinctly avoids confusing the two in
-- code search, docs, and this file's own history.
--
-- WHY THIS IS AN ORCHESTRATION LAYER, NOT A NEW "CASE FILE" OF DUPLICATED
-- DATA: Module 74.4 lists a case file as Conditions / Medications /
-- Investigations / Specialists / Hospitalisations / Care goals / Barriers /
-- Tasks. Every one of the first five already has a canonical table
-- (patient_conditions, medications, lab_orders, specialist_referrals,
-- patient_hospital_admissions) — all patient-scoped already, so a case's
-- "file" is just those tables filtered by patient_id for the case's
-- lifetime, read live, never re-stored here. This mirrors the Annual
-- Health Review's own precedent (CLAUDE.md: "it is an orchestration layer
-- that adopts + rolls the patient's existing medication_reviews... condition-
-- specific reviews must stay intact"). Only Care goals and the
-- Problem→Goal→Intervention→Owner→Deadline→Outcome case plan (74.5/74.6)
-- and Barriers/Tasks are genuinely new concepts — and even goals/
-- interventions are NOT duplicated here: part 2 of this series extends the
-- existing `care_plan_goals`/`care_plan_interventions` (built two days
-- before this migration, 20260827205255) to be optionally case-scoped
-- instead of forking a parallel goals/interventions table.
--
-- One active case per patient (partial unique index below) — Module 74
-- describes a single intensive-management episode a patient is "in", not a
-- set of concurrent cases. A patient can still be reopened into a new
-- episode after closure (part 3).

create type public.care_management_case_status as enum ('active', 'closed');

-- 74.7 — the five ways a patient enters case management.
create type public.care_management_entry_reason as enum (
  'risk_engine', 'clinician_referral', 'hospital_discharge', 'repeated_alerts', 'care_coordinator_escalation'
);

-- 74.14/74.15/74.13/74.7 lifecycle timeline — the case-management analogue
-- of clinician_alert_ack_escalations: a lean, append-only audit trail this
-- table's own analytics (part 5) and case-detail UI both read, distinct
-- from the generic audit_log (which only ever logs changed COLUMN NAMES,
-- never enough to answer "why was this case opened/closed").
create type public.care_management_case_event_type as enum (
  'opened', 'escalated', 'deterioration_detected', 'closed', 'reopened'
);

create table public.care_management_cases (
  id                     uuid primary key default gen_random_uuid(),
  organisation_id        uuid not null references public.organisations (id) on delete restrict,
  patient_id             uuid not null references public.profiles (id) on delete cascade,
  status                 public.care_management_case_status not null default 'active',
  entry_reason           public.care_management_entry_reason not null,
  entry_detail           text,
  -- 74.3: "each patient receives a designated case manager WHERE
  -- APPROPRIATE" — nullable by design, same null-gating discipline as
  -- doctor_tier: an unassigned case manager means an admin/lead needs to
  -- assign one, never an inferred default.
  case_manager_id        uuid references public.clinical_staff (id) on delete set null,
  -- Provenance links back to whichever existing table triggered entry —
  -- read-only context, not a copy of that table's data.
  risk_score_id          uuid references public.patient_risk_scores (id) on delete set null,
  hospital_admission_id  uuid references public.patient_hospital_admissions (id) on delete set null,
  referring_alert_id     uuid references public.clinician_alerts (id) on delete set null,
  opened_at              timestamptz not null default now(),
  opened_by              uuid references public.profiles (id) on delete set null,
  closed_at              timestamptz,
  -- Server-derived only, by close_care_management_case() (part 3) — never
  -- client-supplied, same "attribution is structural, not cosmetic"
  -- discipline as reviewed_by/recorded_by elsewhere in this codebase.
  closed_by              uuid references public.clinical_staff (id) on delete set null,
  closure_summary        text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint care_management_cases_closure_fields check (
    status <> 'closed' or closed_at is not null
  ),
  constraint care_management_cases_entry_detail_length check (
    entry_detail is null or char_length(entry_detail) <= 1000
  ),
  constraint care_management_cases_closure_summary_length check (
    closure_summary is null or char_length(closure_summary) <= 2000
  )
);

comment on table public.care_management_cases is
  'Module 74 chronic disease case management: one intensive-management episode per patient. The "case file" (conditions/medications/investigations/specialists/hospitalisations) is read live from existing patient-scoped tables, never duplicated here — see file header.';

-- 74.14/74.15: a patient is "in" at most one active case at a time.
create unique index care_management_cases_one_active_per_patient
  on public.care_management_cases (patient_id) where status = 'active';
create index care_management_cases_org_status_idx on public.care_management_cases (organisation_id, status);
create index care_management_cases_patient_idx on public.care_management_cases (patient_id, opened_at desc);
create index care_management_cases_manager_idx on public.care_management_cases (case_manager_id) where status = 'active';

create trigger care_management_cases_set_updated_at
  before update on public.care_management_cases
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Closure guard — 74.14 says a case "should close only when" goals are
-- achieved, outstanding actions are resolved, and (where appropriate) the
-- responsible clinician agrees. That is a real clinical-safety gate, not a
-- loose status stepper like care_plans.status, so unlike that table's plain
-- client-writable status column, a transition INTO 'closed' may only
-- happen through public.close_care_management_case() (part 3), which
-- checks the goals/actions/barriers gate and derives closed_by server-side
-- before authorizing itself via this session-local flag. Every other field
-- on this table (including case_manager_id reassignment, and reopening —
-- 74.15 lists valid reopening triggers but no mechanical blocking
-- condition, so that stays a plain client write) is a normal is_org_staff
-- write, same trust level as care_plans.
-- ---------------------------------------------------------------------------
create or replace function private.enforce_care_management_case_closure()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'closed'
     and old.status is distinct from 'closed'
     and coalesce(current_setting('private.case_close_authorized', true), '') <> 'true'
  then
    raise exception 'Cases may only be closed via public.close_care_management_case(), which enforces the goals/actions/barriers gate and derives closed_by server-side.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger care_management_cases_enforce_closure
  before update on public.care_management_cases
  for each row execute function private.enforce_care_management_case_closure();

alter table public.care_management_cases enable row level security;

create policy care_management_cases_select on public.care_management_cases
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or private.can_read_clinical(patient_id)
  );

create policy care_management_cases_write on public.care_management_cases
  for all to authenticated
  using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));

grant select, insert, update, delete on public.care_management_cases to authenticated;

-- ---------------------------------------------------------------------------
-- Lifecycle event log — 74.16 analytics (active count, avg duration) and
-- the case-detail timeline both read this. Only ever written by
-- SECURITY DEFINER paths for 'closed'/'deterioration_detected' (parts 3/5);
-- 'opened'/'escalated'/'reopened' may also be logged directly by org staff
-- alongside their own plain writes to care_management_cases/clinician_alerts
-- — same "no cross-table transaction, sequential client writes" risk
-- tolerance already established by care-plan-management.ts's goal/
-- intervention hooks.
-- ---------------------------------------------------------------------------
create table public.care_management_case_events (
  id                  uuid primary key default gen_random_uuid(),
  case_id             uuid not null references public.care_management_cases (id) on delete cascade,
  organisation_id     uuid not null references public.organisations (id) on delete restrict,
  patient_id          uuid not null references public.profiles (id) on delete cascade,
  event_type          public.care_management_case_event_type not null,
  reason              text,
  -- Populated for 'escalated' events only — which rung of the 74.13 ladder
  -- was targeted (care_management_escalate_case, part 3, writes this).
  target_level        text,
  clinician_alert_id  uuid references public.clinician_alerts (id) on delete set null,
  actor_id            uuid references public.profiles (id) on delete set null,
  clinical_staff_id   uuid references public.clinical_staff (id) on delete set null,
  created_at          timestamptz not null default now(),
  constraint care_management_case_events_reason_length check (
    reason is null or char_length(reason) <= 1000
  )
);

create index care_management_case_events_case_idx on public.care_management_case_events (case_id, created_at desc);
create index care_management_case_events_org_idx on public.care_management_case_events (organisation_id);

alter table public.care_management_case_events enable row level security;

create policy care_management_case_events_select on public.care_management_case_events
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or private.can_read_clinical(patient_id)
  );

create policy care_management_case_events_insert on public.care_management_case_events
  for insert to authenticated
  with check (private.is_org_staff(organisation_id));

grant select, insert on public.care_management_case_events to authenticated;

-- ---------------------------------------------------------------------------
-- Barriers — 74.4/74.14: a genuinely new concept with no existing table.
-- Deliberately NOT gated to a clinical tier to write: identifying "the
-- patient can't afford transport to clinic" is exactly the kind of
-- logistics-only observation a Care Coordinator is meant to log (Master
-- Operating Plan §4: "logistics only... routes anything needing judgment to
-- Tier 1"), same trust level as care_outreach_tasks.
-- ---------------------------------------------------------------------------
create type public.care_management_barrier_category as enum (
  'financial', 'transport', 'health_literacy', 'social_support', 'access', 'other'
);
create type public.care_management_barrier_status as enum ('open', 'resolved');

create table public.care_management_barriers (
  id              uuid primary key default gen_random_uuid(),
  case_id         uuid not null references public.care_management_cases (id) on delete cascade,
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  patient_id      uuid not null references public.profiles (id) on delete cascade,
  category        public.care_management_barrier_category not null default 'other',
  description     text not null,
  status          public.care_management_barrier_status not null default 'open',
  created_by      uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  resolved_at     timestamptz,
  resolved_by     uuid references public.profiles (id) on delete set null,
  constraint care_management_barriers_description_length check (char_length(description) between 1 and 500),
  constraint care_management_barriers_resolved_fields check (
    (status = 'resolved' and resolved_at is not null) or (status = 'open' and resolved_at is null)
  )
);

create index care_management_barriers_case_idx on public.care_management_barriers (case_id);
create index care_management_barriers_org_idx on public.care_management_barriers (organisation_id);
create index care_management_barriers_open_idx on public.care_management_barriers (case_id) where status = 'open';

alter table public.care_management_barriers enable row level security;

create policy care_management_barriers_select on public.care_management_barriers
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or private.can_read_clinical(patient_id)
  );

create policy care_management_barriers_write on public.care_management_barriers
  for all to authenticated
  using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));

grant select, insert, update, delete on public.care_management_barriers to authenticated;

-- ---------------------------------------------------------------------------
-- Proof, not hope.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'care_management_case_status') then
    raise exception 'care_management_case_status enum was not created';
  end if;
  if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'care_management_cases') then
    raise exception 'care_management_cases table was not created';
  end if;
  if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'care_management_case_events') then
    raise exception 'care_management_case_events table was not created';
  end if;
  if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'care_management_barriers') then
    raise exception 'care_management_barriers table was not created';
  end if;
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and tablename = 'care_management_cases'
      and indexname = 'care_management_cases_one_active_per_patient'
  ) then
    raise exception 'one-active-case-per-patient unique index was not created';
  end if;
  if not exists (
    select 1 from pg_trigger tg join pg_class c on c.oid = tg.tgrelid
    where c.relname = 'care_management_cases' and tg.tgname = 'care_management_cases_enforce_closure'
      and not tg.tgisinternal
  ) then
    raise exception 'care_management_cases_enforce_closure trigger was not created';
  end if;
  if has_table_privilege('anon', 'public.care_management_cases', 'SELECT') then
    raise exception 'FAIL: anon can select care_management_cases';
  end if;
  raise notice 'PASS: care_management_cases/case_events/barriers tables + RLS + closure guard all present, anon denied';
end $$;
