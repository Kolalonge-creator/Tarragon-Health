-- Tarragon Health
-- Data Architecture Gaps Build Plan, §2 Phase 1 (docs/DATA_ARCHITECTURE_GAPS_BUILD_PLAN.md).
-- Confirmed a genuine gap before writing this: no generic clinical-encounter
-- model exists. Nine independently-shaped tables carry encounter data
-- (video_consultations, escalations, medication_reviews, annual_health_checks,
-- annual_reviews, async_consults, case_briefs, postnatal_checkins,
-- weight_management_checkins), with no shared entity and inconsistent actor
-- columns (profiles-typed on some, clinical_staff-typed on others, none at
-- all on case_briefs). clinical_encounter_notes (20260827201621) is the
-- closest existing precedent but is a documentation layer with three
-- *optional* links out, not a unifying entity.
--
-- SCOPE: purely additive. This does NOT touch, rename, or restructure any of
-- the 9 source tables -- their own schema, RLS, triggers and status/actor
-- columns are unchanged. clinical_encounters is a derived summary/index table,
-- kept in sync by one AFTER INSERT OR UPDATE trigger per source table, so a
-- reader (analytics, a future unified worklist) can query one table instead
-- of unioning nine. The source tables remain the system of record; this is
-- not a hard supertype/subtype migration -- see the build-plan doc for why a
-- hard rewrite is deferred (video_consultations alone has 11 inbound FKs,
-- escalations has 6; five of the nine tables have zero, so blast radius is
-- wildly uneven and not a one-size-fits-all migration).
--
-- Writes happen only from SECURITY DEFINER trigger functions (owned by the
-- migration role, same posture as private.enforce_fhir_import_resource_attribution
-- writing into vitals_readings/medications/etc from inside a trigger) --
-- `authenticated` gets SELECT only, matching a derived/denormalised table,
-- never a direct write surface.
--
-- Deliberately deferred to a fast-follow, not attempted here: wiring these
-- same 9 tables into patient_timeline (today only escalations and
-- clinical_encounter_notes write there) -- doing both in one migration risked
-- duplicate timeline entries for escalations and made this diff harder to
-- review; patient_timeline is untouched by this migration.

create table public.clinical_encounters (
  id                        uuid primary key default gen_random_uuid(),
  organisation_id           uuid not null references public.organisations (id) on delete cascade,
  patient_id                uuid not null references public.profiles (id) on delete cascade,

  encounter_type            text not null check (encounter_type in (
    'video_consultation', 'escalation', 'medication_review', 'annual_health_check',
    'annual_review', 'async_consult', 'case_brief', 'postnatal_checkin',
    'weight_management_checkin'
  )),
  source_table              text not null,
  source_id                 uuid not null,

  occurred_at               timestamptz not null,
  status_label              text,
  actor_profile_id          uuid references public.profiles (id) on delete set null,
  actor_clinical_staff_id   uuid references public.clinical_staff (id) on delete set null,

  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),

  unique (source_table, source_id)
);

comment on table public.clinical_encounters is
  'Derived summary/index of the 9 encounter-shaped source tables (video_consultations, escalations, medication_reviews, annual_health_checks, annual_reviews, async_consults, case_briefs, postnatal_checkins, weight_management_checkins) -- see docs/DATA_ARCHITECTURE_GAPS_BUILD_PLAN.md §2. Kept in sync by per-source-table triggers. The source tables remain the system of record; this table is additive and read-oriented, never written to directly.';
comment on column public.clinical_encounters.source_table is
  'Which of the 9 source tables this row summarises -- same soft-pointer convention as patient_timeline.source_table/source_id (no enforced FK, since the target type varies by row).';
comment on column public.clinical_encounters.actor_profile_id is
  'Populated only for source tables whose own actor column is profiles-typed (video_consultations.initiated_by, escalations.assigned_doctor_id/reviewed_by, weight_management_checkins.reviewed_by). Null for the rest -- see actor_clinical_staff_id.';
comment on column public.clinical_encounters.actor_clinical_staff_id is
  'Populated only for source tables whose own actor column is clinical_staff-typed (medication_reviews/annual_health_checks/annual_reviews.reviewed_by, async_consults.answered_by). Null for the rest -- see actor_profile_id. case_briefs has no actor column at all (AI-generated) and populates neither.';

create index clinical_encounters_patient_idx
  on public.clinical_encounters (patient_id, occurred_at desc);
create index clinical_encounters_org_idx
  on public.clinical_encounters (organisation_id, occurred_at desc);
create index clinical_encounters_type_idx
  on public.clinical_encounters (encounter_type, occurred_at desc);

alter table public.clinical_encounters enable row level security;

create policy clinical_encounters_select on public.clinical_encounters
  for select to authenticated
  using (private.is_org_staff(organisation_id));

-- No insert/update/delete policy at all -- writes happen only from the
-- SECURITY DEFINER trigger functions below, which run as the function owner
-- and so bypass RLS/grants on this table entirely, same as how
-- private.enforce_fhir_import_resource_attribution writes into
-- vitals_readings/medications/etc from inside a trigger.

grant select on public.clinical_encounters to authenticated;
revoke insert, update, delete on public.clinical_encounters from authenticated;
revoke all on public.clinical_encounters from anon;

create trigger clinical_encounters_set_updated_at
  before update on public.clinical_encounters
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- One sync trigger function per source table. Each is a straightforward
-- upsert keyed on (source_table, source_id) -- deliberately not one generic
-- dynamic-SQL function, matching this codebase's existing preference for
-- explicit per-table logic over polymorphic/dynamic column access (confirmed:
-- no supertype/subtype precedent exists anywhere else in this schema).
-- ---------------------------------------------------------------------------

create or replace function private.sync_clinical_encounter_video_consultation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.clinical_encounters
    (organisation_id, patient_id, encounter_type, source_table, source_id, occurred_at, status_label, actor_profile_id, actor_clinical_staff_id)
  values
    (new.organisation_id, new.patient_id, 'video_consultation', 'video_consultations', new.id,
     coalesce(new.scheduled_at, new.created_at), new.status::text, new.initiated_by, null)
  on conflict (source_table, source_id) do update set
    organisation_id = excluded.organisation_id,
    patient_id = excluded.patient_id,
    occurred_at = excluded.occurred_at,
    status_label = excluded.status_label,
    actor_profile_id = excluded.actor_profile_id,
    actor_clinical_staff_id = excluded.actor_clinical_staff_id,
    updated_at = now();
  return new;
end;
$$;

create trigger clinical_encounters_sync_video_consultation
  after insert or update on public.video_consultations
  for each row execute function private.sync_clinical_encounter_video_consultation();

create or replace function private.sync_clinical_encounter_escalation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.clinical_encounters
    (organisation_id, patient_id, encounter_type, source_table, source_id, occurred_at, status_label, actor_profile_id, actor_clinical_staff_id)
  values
    (new.organisation_id, new.patient_id, 'escalation', 'escalations', new.id,
     new.created_at, new.status::text, coalesce(new.reviewed_by, new.assigned_doctor_id), null)
  on conflict (source_table, source_id) do update set
    organisation_id = excluded.organisation_id,
    patient_id = excluded.patient_id,
    occurred_at = excluded.occurred_at,
    status_label = excluded.status_label,
    actor_profile_id = excluded.actor_profile_id,
    actor_clinical_staff_id = excluded.actor_clinical_staff_id,
    updated_at = now();
  return new;
end;
$$;

create trigger clinical_encounters_sync_escalation
  after insert or update on public.escalations
  for each row execute function private.sync_clinical_encounter_escalation();

create or replace function private.sync_clinical_encounter_medication_review()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.clinical_encounters
    (organisation_id, patient_id, encounter_type, source_table, source_id, occurred_at, status_label, actor_profile_id, actor_clinical_staff_id)
  values
    (new.organisation_id, new.patient_id, 'medication_review', 'medication_reviews', new.id,
     coalesce(new.completed_at, new.created_at), new.status::text, null, new.reviewed_by)
  on conflict (source_table, source_id) do update set
    organisation_id = excluded.organisation_id,
    patient_id = excluded.patient_id,
    occurred_at = excluded.occurred_at,
    status_label = excluded.status_label,
    actor_profile_id = excluded.actor_profile_id,
    actor_clinical_staff_id = excluded.actor_clinical_staff_id,
    updated_at = now();
  return new;
end;
$$;

create trigger clinical_encounters_sync_medication_review
  after insert or update on public.medication_reviews
  for each row execute function private.sync_clinical_encounter_medication_review();

create or replace function private.sync_clinical_encounter_annual_health_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.clinical_encounters
    (organisation_id, patient_id, encounter_type, source_table, source_id, occurred_at, status_label, actor_profile_id, actor_clinical_staff_id)
  values
    (new.organisation_id, new.patient_id, 'annual_health_check', 'annual_health_checks', new.id,
     coalesce(new.reviewed_at, new.created_at), new.status::text, null, new.reviewed_by)
  on conflict (source_table, source_id) do update set
    organisation_id = excluded.organisation_id,
    patient_id = excluded.patient_id,
    occurred_at = excluded.occurred_at,
    status_label = excluded.status_label,
    actor_profile_id = excluded.actor_profile_id,
    actor_clinical_staff_id = excluded.actor_clinical_staff_id,
    updated_at = now();
  return new;
end;
$$;

create trigger clinical_encounters_sync_annual_health_check
  after insert or update on public.annual_health_checks
  for each row execute function private.sync_clinical_encounter_annual_health_check();

create or replace function private.sync_clinical_encounter_annual_review()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.clinical_encounters
    (organisation_id, patient_id, encounter_type, source_table, source_id, occurred_at, status_label, actor_profile_id, actor_clinical_staff_id)
  values
    (new.organisation_id, new.patient_id, 'annual_review', 'annual_reviews', new.id,
     coalesce(new.completed_at, new.created_at), new.status::text, null, new.reviewed_by)
  on conflict (source_table, source_id) do update set
    organisation_id = excluded.organisation_id,
    patient_id = excluded.patient_id,
    occurred_at = excluded.occurred_at,
    status_label = excluded.status_label,
    actor_profile_id = excluded.actor_profile_id,
    actor_clinical_staff_id = excluded.actor_clinical_staff_id,
    updated_at = now();
  return new;
end;
$$;

create trigger clinical_encounters_sync_annual_review
  after insert or update on public.annual_reviews
  for each row execute function private.sync_clinical_encounter_annual_review();

create or replace function private.sync_clinical_encounter_async_consult()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.clinical_encounters
    (organisation_id, patient_id, encounter_type, source_table, source_id, occurred_at, status_label, actor_profile_id, actor_clinical_staff_id)
  values
    (new.organisation_id, new.patient_id, 'async_consult', 'async_consults', new.id,
     new.created_at, new.status::text, null, new.answered_by)
  on conflict (source_table, source_id) do update set
    organisation_id = excluded.organisation_id,
    patient_id = excluded.patient_id,
    occurred_at = excluded.occurred_at,
    status_label = excluded.status_label,
    actor_profile_id = excluded.actor_profile_id,
    actor_clinical_staff_id = excluded.actor_clinical_staff_id,
    updated_at = now();
  return new;
end;
$$;

create trigger clinical_encounters_sync_async_consult
  after insert or update on public.async_consults
  for each row execute function private.sync_clinical_encounter_async_consult();

create or replace function private.sync_clinical_encounter_case_brief()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.clinical_encounters
    (organisation_id, patient_id, encounter_type, source_table, source_id, occurred_at, status_label, actor_profile_id, actor_clinical_staff_id)
  values
    (new.organisation_id, new.patient_id, 'case_brief', 'case_briefs', new.id,
     new.generated_at, new.status::text, null, null)
  on conflict (source_table, source_id) do update set
    organisation_id = excluded.organisation_id,
    patient_id = excluded.patient_id,
    occurred_at = excluded.occurred_at,
    status_label = excluded.status_label,
    updated_at = now();
  return new;
end;
$$;

create trigger clinical_encounters_sync_case_brief
  after insert or update on public.case_briefs
  for each row execute function private.sync_clinical_encounter_case_brief();

create or replace function private.sync_clinical_encounter_postnatal_checkin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.clinical_encounters
    (organisation_id, patient_id, encounter_type, source_table, source_id, occurred_at, status_label, actor_profile_id, actor_clinical_staff_id)
  values
    (new.organisation_id, new.patient_id, 'postnatal_checkin', 'postnatal_checkins', new.id,
     coalesce(new.completed_at, new.created_at),
     case when new.completed_at is not null then 'completed' else 'pending' end,
     null, null)
  on conflict (source_table, source_id) do update set
    organisation_id = excluded.organisation_id,
    patient_id = excluded.patient_id,
    occurred_at = excluded.occurred_at,
    status_label = excluded.status_label,
    updated_at = now();
  return new;
end;
$$;

create trigger clinical_encounters_sync_postnatal_checkin
  after insert or update on public.postnatal_checkins
  for each row execute function private.sync_clinical_encounter_postnatal_checkin();

create or replace function private.sync_clinical_encounter_weight_management_checkin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.clinical_encounters
    (organisation_id, patient_id, encounter_type, source_table, source_id, occurred_at, status_label, actor_profile_id, actor_clinical_staff_id)
  values
    (new.organisation_id, new.patient_id, 'weight_management_checkin', 'weight_management_checkins', new.id,
     coalesce(new.reviewed_at, new.created_at),
     case when new.reviewed_at is not null then 'reviewed' else 'pending' end,
     new.reviewed_by, null)
  on conflict (source_table, source_id) do update set
    organisation_id = excluded.organisation_id,
    patient_id = excluded.patient_id,
    occurred_at = excluded.occurred_at,
    status_label = excluded.status_label,
    actor_profile_id = excluded.actor_profile_id,
    updated_at = now();
  return new;
end;
$$;

create trigger clinical_encounters_sync_weight_management_checkin
  after insert or update on public.weight_management_checkins
  for each row execute function private.sync_clinical_encounter_weight_management_checkin();

revoke all on function private.sync_clinical_encounter_video_consultation() from public;
revoke all on function private.sync_clinical_encounter_escalation() from public;
revoke all on function private.sync_clinical_encounter_medication_review() from public;
revoke all on function private.sync_clinical_encounter_annual_health_check() from public;
revoke all on function private.sync_clinical_encounter_annual_review() from public;
revoke all on function private.sync_clinical_encounter_async_consult() from public;
revoke all on function private.sync_clinical_encounter_case_brief() from public;
revoke all on function private.sync_clinical_encounter_postnatal_checkin() from public;
revoke all on function private.sync_clinical_encounter_weight_management_checkin() from public;

-- ---------------------------------------------------------------------------
-- Backfill existing rows -- Phase 1 should reflect current data, not just
-- rows created from here on.
-- ---------------------------------------------------------------------------

insert into public.clinical_encounters
  (organisation_id, patient_id, encounter_type, source_table, source_id, occurred_at, status_label, actor_profile_id, actor_clinical_staff_id)
select organisation_id, patient_id, 'video_consultation', 'video_consultations', id,
       coalesce(scheduled_at, created_at), status::text, initiated_by, null
from public.video_consultations
on conflict (source_table, source_id) do nothing;

insert into public.clinical_encounters
  (organisation_id, patient_id, encounter_type, source_table, source_id, occurred_at, status_label, actor_profile_id, actor_clinical_staff_id)
select organisation_id, patient_id, 'escalation', 'escalations', id,
       created_at, status::text, coalesce(reviewed_by, assigned_doctor_id), null
from public.escalations
on conflict (source_table, source_id) do nothing;

insert into public.clinical_encounters
  (organisation_id, patient_id, encounter_type, source_table, source_id, occurred_at, status_label, actor_profile_id, actor_clinical_staff_id)
select organisation_id, patient_id, 'medication_review', 'medication_reviews', id,
       coalesce(completed_at, created_at), status::text, null, reviewed_by
from public.medication_reviews
on conflict (source_table, source_id) do nothing;

insert into public.clinical_encounters
  (organisation_id, patient_id, encounter_type, source_table, source_id, occurred_at, status_label, actor_profile_id, actor_clinical_staff_id)
select organisation_id, patient_id, 'annual_health_check', 'annual_health_checks', id,
       coalesce(reviewed_at, created_at), status::text, null, reviewed_by
from public.annual_health_checks
on conflict (source_table, source_id) do nothing;

insert into public.clinical_encounters
  (organisation_id, patient_id, encounter_type, source_table, source_id, occurred_at, status_label, actor_profile_id, actor_clinical_staff_id)
select organisation_id, patient_id, 'annual_review', 'annual_reviews', id,
       coalesce(completed_at, created_at), status::text, null, reviewed_by
from public.annual_reviews
on conflict (source_table, source_id) do nothing;

insert into public.clinical_encounters
  (organisation_id, patient_id, encounter_type, source_table, source_id, occurred_at, status_label, actor_profile_id, actor_clinical_staff_id)
select organisation_id, patient_id, 'async_consult', 'async_consults', id,
       created_at, status::text, null, answered_by
from public.async_consults
on conflict (source_table, source_id) do nothing;

insert into public.clinical_encounters
  (organisation_id, patient_id, encounter_type, source_table, source_id, occurred_at, status_label, actor_profile_id, actor_clinical_staff_id)
select organisation_id, patient_id, 'case_brief', 'case_briefs', id,
       generated_at, status::text, null, null
from public.case_briefs
on conflict (source_table, source_id) do nothing;

insert into public.clinical_encounters
  (organisation_id, patient_id, encounter_type, source_table, source_id, occurred_at, status_label, actor_profile_id, actor_clinical_staff_id)
select organisation_id, patient_id, 'postnatal_checkin', 'postnatal_checkins', id,
       coalesce(completed_at, created_at),
       case when completed_at is not null then 'completed' else 'pending' end,
       null, null
from public.postnatal_checkins
on conflict (source_table, source_id) do nothing;

insert into public.clinical_encounters
  (organisation_id, patient_id, encounter_type, source_table, source_id, occurred_at, status_label, actor_profile_id, actor_clinical_staff_id)
select organisation_id, patient_id, 'weight_management_checkin', 'weight_management_checkins', id,
       coalesce(reviewed_at, created_at),
       case when reviewed_at is not null then 'reviewed' else 'pending' end,
       reviewed_by, null
from public.weight_management_checkins
on conflict (source_table, source_id) do nothing;

do $$
declare
  v_expected bigint;
  v_actual bigint;
begin
  if not exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'clinical_encounters') then
    raise exception 'clinical_encounters missing after migration';
  end if;

  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'clinical_encounters' and cmd in ('INSERT', 'UPDATE', 'DELETE')
  ) then
    raise exception 'clinical_encounters must have no INSERT/UPDATE/DELETE policy -- writes are trigger-only';
  end if;

  if has_table_privilege('authenticated', 'public.clinical_encounters', 'INSERT') then
    raise exception 'authenticated must not hold INSERT on clinical_encounters';
  end if;
  if not has_table_privilege('authenticated', 'public.clinical_encounters', 'SELECT') then
    raise exception 'authenticated must hold SELECT on clinical_encounters';
  end if;

  select
    (select count(*) from public.video_consultations) +
    (select count(*) from public.escalations) +
    (select count(*) from public.medication_reviews) +
    (select count(*) from public.annual_health_checks) +
    (select count(*) from public.annual_reviews) +
    (select count(*) from public.async_consults) +
    (select count(*) from public.case_briefs) +
    (select count(*) from public.postnatal_checkins) +
    (select count(*) from public.weight_management_checkins)
  into v_expected;

  select count(*) into v_actual from public.clinical_encounters;

  if v_actual <> v_expected then
    raise exception 'clinical_encounters backfill count mismatch: expected % rows across the 9 source tables, got %', v_expected, v_actual;
  end if;

  raise notice 'PASS: clinical_encounters backfilled with % rows across 9 source tables, RLS + trigger-only-write posture confirmed', v_actual;
end $$;
