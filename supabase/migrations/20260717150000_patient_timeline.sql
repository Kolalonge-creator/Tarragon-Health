-- Tarragon Health — unified patient activity timeline (append-only event spine)
--
-- The "care coordination glue": today every vertical (lab_orders, medications,
-- specialist_referrals, medication_adherence_alerts, screening_schedules,
-- escalations, vaccination_records, care_plans, …) has its own trigger→notify
-- wiring but nothing writes to a shared feed. This migration introduces one:
-- an APPEND-ONLY table that every clinical event writes into via BEFORE/AFTER
-- triggers, read by both the patient dashboard and the clinician worklist as a
-- single chronological stream.
--
-- Design rules (per CLAUDE.md):
--   • organisation_id on every row; RLS exactly like the other multi-tenant
--     tables — a patient reads their own rows, org staff read their org's rows.
--   • APPEND-ONLY: grant select + insert only; no update/delete grant and no
--     update/delete policy, so history can never be rewritten. Triggers are
--     SECURITY DEFINER, so they insert regardless of the (staff-only) insert
--     policy without any policy being widened.
--   • NOT a new source of truth: a row references source_table/source_id and
--     stores a short DISPLAY summary only — the authoritative data stays in the
--     originating table.
--   • Doctor attribution is null-gated: actor_clinical_staff_id only ever holds
--     a REAL public.clinical_staff.id (resolved + validated below), never a
--     hardcoded name. The UI renders "Reviewed by Dr X" via the shared
--     ReviewedByDoctor component, which is null-gated on this column.
--
-- Supersedes the read-time `public.patient_timeline` VIEW from the (unmerged)
-- patient-admissions-timeline branch: the founder-approved decision is that the
-- append-only table becomes the real spine, so we DROP that view first. When
-- that branch merges, its admissions rows flow in through the conditional
-- trigger at the bottom of this file and its card reads this table instead.

drop view if exists public.patient_timeline;

-- --- event type enum ---------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'timeline_event_type') then
    create type public.timeline_event_type as enum (
      'lab_completed',
      'lab_abnormal',
      'medication_started',
      'medication_stopped',
      'medication_missed',
      'referral_created',
      'referral_status_changed',
      'screening_due',
      'screening_completed',
      'vaccination_recorded',
      'escalation_raised',
      'escalation_resolved',
      'care_plan_updated',
      'admission_recorded',
      'discharge_recorded'
    );
  end if;
end $$;

-- --- the append-only table ---------------------------------------------------
create table if not exists public.patient_timeline (
  id                       uuid primary key default gen_random_uuid(),
  organisation_id          uuid not null references public.organisations (id) on delete restrict,
  patient_id               uuid not null references public.profiles (id) on delete cascade,
  event_type               public.timeline_event_type not null,
  source_table             text not null,
  source_id                uuid,
  title                    text not null,
  summary                  text,
  occurred_at              timestamptz not null default now(),
  actor_clinical_staff_id  uuid references public.clinical_staff (id) on delete set null,
  metadata                 jsonb not null default '{}'::jsonb,
  created_at               timestamptz not null default now()
);

-- Read paths: patient feed (patient_id + occurred_at) and clinician worklist
-- (organisation_id + occurred_at). Both sort newest-first.
create index if not exists patient_timeline_patient_idx
  on public.patient_timeline (patient_id, occurred_at desc);
create index if not exists patient_timeline_org_idx
  on public.patient_timeline (organisation_id, occurred_at desc);
create index if not exists patient_timeline_source_idx
  on public.patient_timeline (source_table, source_id);

-- --- RLS: read own/org, insert org-staff, NO update/delete (append-only) ------
alter table public.patient_timeline enable row level security;

drop policy if exists patient_timeline_select on public.patient_timeline;
create policy patient_timeline_select on public.patient_timeline
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

drop policy if exists patient_timeline_insert on public.patient_timeline;
create policy patient_timeline_insert on public.patient_timeline
  for insert to authenticated
  with check (private.is_org_staff(organisation_id));

-- Deliberately NO update/delete policy and NO update/delete grant → append-only.
grant select, insert on public.patient_timeline to authenticated;

comment on table public.patient_timeline is
  'Append-only unified activity feed. Each row references source_table/source_id and stores a display summary only — never a new source of truth. Written by SECURITY DEFINER triggers; no update/delete grant. actor_clinical_staff_id is null-gated against a real clinical_staff row (see ReviewedByDoctor).';

-- --- helpers -----------------------------------------------------------------
-- Central writer so every trigger enqueues identically. SECURITY DEFINER so it
-- can insert past the staff-only insert policy from any trigger context; a null
-- patient/org is silently skipped rather than raising inside a data-write path.
create or replace function private.record_timeline_event(
  p_org         uuid,
  p_patient     uuid,
  p_event_type  public.timeline_event_type,
  p_source_table text,
  p_source_id   uuid,
  p_title       text,
  p_summary     text,
  p_occurred_at timestamptz default null,
  p_actor       uuid default null,
  p_metadata    jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_patient is null or p_org is null then
    return;
  end if;
  insert into public.patient_timeline
    (organisation_id, patient_id, event_type, source_table, source_id,
     title, summary, occurred_at, actor_clinical_staff_id, metadata)
  values
    (p_org, p_patient, p_event_type, p_source_table, p_source_id,
     p_title, p_summary, coalesce(p_occurred_at, now()), p_actor,
     coalesce(p_metadata, '{}'::jsonb));
end;
$$;

-- Null-gate a profile id to a REAL active clinical_staff row for this org (many
-- attribution columns store a profiles.id, not a clinical_staff.id). Returns
-- null when the profile isn't a current staff member — never a placeholder.
create or replace function private.timeline_staff_from_profile(p_profile uuid, p_org uuid)
returns uuid
language sql
security definer
set search_path = ''
stable
as $$
  select id
  from public.clinical_staff
  where profile_id = p_profile
    and organisation_id = p_org
    and active
  limit 1;
$$;

-- ============================================================================
-- Source triggers. Each references source_table/source_id + a short summary
-- only; no source data is duplicated.
-- ============================================================================

-- --- lab_orders → lab_completed ---------------------------------------------
create or replace function private.timeline_from_lab_order()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'resulted' and old.status is distinct from 'resulted' then
    perform private.record_timeline_event(
      new.organisation_id, new.patient_id, 'lab_completed',
      'lab_orders', new.id,
      'Lab results ready',
      coalesce('Order ' || nullif(new.order_number, ''), 'Your lab results are ready'),
      coalesce(new.resulted_at, now()),
      null,
      jsonb_build_object('order_number', new.order_number, 'status', new.status)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists lab_orders_timeline on public.lab_orders;
create trigger lab_orders_timeline
  after update of status on public.lab_orders
  for each row execute function private.timeline_from_lab_order();

-- --- screening_results → lab_abnormal (highest-priority business event) ------
create or replace function private.timeline_from_screening_result()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.result_status in ('abnormal', 'critical') then
    perform private.record_timeline_event(
      new.organisation_id, new.patient_id, 'lab_abnormal',
      'screening_results', new.id,
      'Abnormal result flagged',
      coalesce(nullif(new.result_summary, ''), 'A result needs a doctor''s review'),
      new.created_at,
      null,
      jsonb_build_object(
        'result_status', new.result_status,
        'abnormal_flags', to_jsonb(new.abnormal_flags),
        'lab_order_id', new.lab_order_id
      )
    );
  end if;
  return new;
end;
$$;

drop trigger if exists screening_results_timeline on public.screening_results;
create trigger screening_results_timeline
  after insert on public.screening_results
  for each row execute function private.timeline_from_screening_result();

-- --- medications → medication_started / medication_stopped -------------------
create or replace function private.timeline_from_medication()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_label text;
begin
  v_label := new.drug_name || coalesce(' · ' || nullif(new.dose, ''), '');

  if tg_op = 'INSERT' then
    perform private.record_timeline_event(
      new.organisation_id, new.patient_id, 'medication_started',
      'medications', new.id,
      'Medication started', v_label,
      new.created_at, null,
      jsonb_build_object('drug_name', new.drug_name, 'dose', new.dose, 'source', new.source)
    );
  elsif tg_op = 'UPDATE'
        and new.stopped_at is not null
        and old.stopped_at is null then
    perform private.record_timeline_event(
      new.organisation_id, new.patient_id, 'medication_stopped',
      'medications', new.id,
      'Medication stopped',
      v_label || coalesce(' · ' || nullif(new.stopped_reason, ''), ''),
      new.stopped_at, null,
      jsonb_build_object('drug_name', new.drug_name, 'stopped_reason', new.stopped_reason)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists medications_timeline_insert on public.medications;
create trigger medications_timeline_insert
  after insert on public.medications
  for each row execute function private.timeline_from_medication();

drop trigger if exists medications_timeline_stop on public.medications;
create trigger medications_timeline_stop
  after update of stopped_at on public.medications
  for each row execute function private.timeline_from_medication();

-- --- medication_adherence_alerts → medication_missed ------------------------
create or replace function private.timeline_from_adherence_alert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.record_timeline_event(
    new.organisation_id, new.patient_id, 'medication_missed',
    'medication_adherence_alerts', new.id,
    'Missed doses flagged',
    new.missed_count::text || ' missed dose(s) in ' || new.window_days::text || ' days',
    new.created_at, null,
    jsonb_build_object('level', new.level, 'missed_count', new.missed_count, 'window_days', new.window_days)
  );
  return new;
end;
$$;

drop trigger if exists adherence_alerts_timeline on public.medication_adherence_alerts;
create trigger adherence_alerts_timeline
  after insert on public.medication_adherence_alerts
  for each row execute function private.timeline_from_adherence_alert();

-- --- specialist_referrals → referral_created / referral_status_changed -------
create or replace function private.timeline_from_referral()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform private.record_timeline_event(
      new.organisation_id, new.patient_id, 'referral_created',
      'specialist_referrals', new.id,
      'Referral created',
      new.specialist_type::text || coalesce(' · ' || nullif(new.referral_reason, ''), ''),
      new.created_at, null,
      jsonb_build_object(
        'referral_number', new.referral_number,
        'specialist_type', new.specialist_type,
        'urgency', new.urgency,
        'status', new.status
      )
    );
  elsif tg_op = 'UPDATE' and new.status is distinct from old.status then
    perform private.record_timeline_event(
      new.organisation_id, new.patient_id, 'referral_status_changed',
      'specialist_referrals', new.id,
      'Referral ' || replace(new.status::text, '_', ' '),
      coalesce('Referral ' || nullif(new.referral_number, ''), 'Referral') ||
        ' · ' || replace(new.status::text, '_', ' '),
      new.updated_at, null,
      jsonb_build_object('referral_number', new.referral_number, 'status', new.status)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists referrals_timeline_insert on public.specialist_referrals;
create trigger referrals_timeline_insert
  after insert on public.specialist_referrals
  for each row execute function private.timeline_from_referral();

drop trigger if exists referrals_timeline_status on public.specialist_referrals;
create trigger referrals_timeline_status
  after update of status on public.specialist_referrals
  for each row execute function private.timeline_from_referral();

-- --- screening_schedules → screening_due / screening_completed ---------------
create or replace function private.timeline_from_screening_schedule()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
begin
  select name into v_name from public.screen_types where id = new.screen_type_id;
  v_name := coalesce(v_name, 'Screening');

  if tg_op = 'INSERT' and new.status in ('pending', 'overdue') then
    perform private.record_timeline_event(
      new.organisation_id, new.patient_id, 'screening_due',
      'screening_schedules', new.id,
      'Screening due',
      v_name || ' · due ' || new.due_date::text,
      new.created_at, null,
      jsonb_build_object('screen_type_id', new.screen_type_id, 'due_date', new.due_date, 'status', new.status)
    );
  elsif tg_op = 'UPDATE' and new.status = 'overdue' and old.status is distinct from 'overdue' then
    perform private.record_timeline_event(
      new.organisation_id, new.patient_id, 'screening_due',
      'screening_schedules', new.id,
      'Screening overdue',
      v_name || ' · was due ' || new.due_date::text,
      now(), null,
      jsonb_build_object('screen_type_id', new.screen_type_id, 'due_date', new.due_date, 'status', new.status)
    );
  elsif tg_op = 'UPDATE' and new.status = 'completed' and old.status is distinct from 'completed' then
    perform private.record_timeline_event(
      new.organisation_id, new.patient_id, 'screening_completed',
      'screening_schedules', new.id,
      'Screening completed', v_name,
      new.updated_at, null,
      jsonb_build_object('screen_type_id', new.screen_type_id)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists screening_schedules_timeline_insert on public.screening_schedules;
create trigger screening_schedules_timeline_insert
  after insert on public.screening_schedules
  for each row execute function private.timeline_from_screening_schedule();

drop trigger if exists screening_schedules_timeline_status on public.screening_schedules;
create trigger screening_schedules_timeline_status
  after update of status on public.screening_schedules
  for each row execute function private.timeline_from_screening_schedule();

-- --- vaccination_records → vaccination_recorded -----------------------------
-- NOTE: vaccination_records keys the patient as profile_id (not patient_id).
create or replace function private.timeline_from_vaccination()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
begin
  select name into v_name from public.vaccination_catalog where id = new.vaccination_catalog_id;
  v_name := coalesce(v_name, 'Vaccination');

  perform private.record_timeline_event(
    new.organisation_id, new.profile_id, 'vaccination_recorded',
    'vaccination_records', new.id,
    'Vaccination recorded',
    v_name || ' · dose ' || new.dose_number::text,
    new.date_administered::timestamptz, null,
    jsonb_build_object(
      'vaccination_catalog_id', new.vaccination_catalog_id,
      'dose_number', new.dose_number,
      'verification_status', new.verification_status
    )
  );
  return new;
end;
$$;

drop trigger if exists vaccination_records_timeline on public.vaccination_records;
create trigger vaccination_records_timeline
  after insert on public.vaccination_records
  for each row execute function private.timeline_from_vaccination();

-- --- escalations → escalation_raised / escalation_resolved ------------------
-- escalation_resolved carries doctor attribution: reviewed_by is a profiles.id,
-- so we null-gate it to a real clinical_staff row (never a hardcoded name).
create or replace function private.timeline_from_escalation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
begin
  if tg_op = 'INSERT' then
    perform private.record_timeline_event(
      new.organisation_id, new.patient_id, 'escalation_raised',
      'escalations', new.id,
      'Escalation raised',
      new.reason,
      new.created_at, null,
      jsonb_build_object('status', new.status)
    );
  elsif tg_op = 'UPDATE' and new.status = 'resolved' and old.status is distinct from 'resolved' then
    v_actor := private.timeline_staff_from_profile(new.reviewed_by, new.organisation_id);
    perform private.record_timeline_event(
      new.organisation_id, new.patient_id, 'escalation_resolved',
      'escalations', new.id,
      'Escalation resolved',
      coalesce(nullif(new.resolution_note, ''), new.reason),
      coalesce(new.reviewed_at, new.updated_at, now()),
      v_actor,
      jsonb_build_object('status', new.status)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists escalations_timeline_insert on public.escalations;
create trigger escalations_timeline_insert
  after insert on public.escalations
  for each row execute function private.timeline_from_escalation();

drop trigger if exists escalations_timeline_status on public.escalations;
create trigger escalations_timeline_status
  after update of status on public.escalations
  for each row execute function private.timeline_from_escalation();

-- --- care_plans → care_plan_updated -----------------------------------------
-- assigned_clinician_id is a profiles.id → null-gated to clinical_staff.
create or replace function private.timeline_from_care_plan()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    return new; -- only surface creation + status changes, not every edit
  end if;

  v_actor := private.timeline_staff_from_profile(new.assigned_clinician_id, new.organisation_id);
  perform private.record_timeline_event(
    new.organisation_id, new.patient_id, 'care_plan_updated',
    'care_plans', new.id,
    case when tg_op = 'INSERT' then 'Care plan created' else 'Care plan updated' end,
    replace(new.condition::text, '_', ' ') || ' · ' || new.status::text,
    coalesce(new.updated_at, new.created_at, now()),
    v_actor,
    jsonb_build_object('condition', new.condition, 'status', new.status)
  );
  return new;
end;
$$;

drop trigger if exists care_plans_timeline_insert on public.care_plans;
create trigger care_plans_timeline_insert
  after insert on public.care_plans
  for each row execute function private.timeline_from_care_plan();

drop trigger if exists care_plans_timeline_status on public.care_plans;
create trigger care_plans_timeline_status
  after update of status on public.care_plans
  for each row execute function private.timeline_from_care_plan();

-- --- patient_hospital_admissions → admission_recorded / discharge_recorded ---
-- This source table ships on the (still unmerged) patient-admissions-timeline
-- branch, so it may or may not exist in a given environment. The function is
-- created unconditionally (plpgsql binds table refs lazily, at first call) but
-- the triggers are only attached when the table actually exists — so this
-- migration applies cleanly on main-dev today and light up automatically once
-- that branch's table lands. Columns per that branch: admitted_on/discharged_on
-- (date), self_reported_diagnosis, patient_id, organisation_id.
create or replace function private.timeline_from_admission()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform private.record_timeline_event(
      new.organisation_id, new.patient_id, 'admission_recorded',
      'patient_hospital_admissions', new.id,
      'Hospital admission',
      coalesce(nullif(new.self_reported_diagnosis, ''), 'Admission recorded'),
      new.admitted_on::timestamptz, null,
      jsonb_build_object('admitted_on', new.admitted_on)
    );
  elsif tg_op = 'UPDATE' and new.discharged_on is not null and old.discharged_on is null then
    perform private.record_timeline_event(
      new.organisation_id, new.patient_id, 'discharge_recorded',
      'patient_hospital_admissions', new.id,
      'Hospital discharge',
      coalesce(nullif(new.self_reported_diagnosis, ''), 'Discharge recorded'),
      new.discharged_on::timestamptz, null,
      jsonb_build_object('discharged_on', new.discharged_on)
    );
  end if;
  return new;
end;
$$;

do $do$
begin
  if to_regclass('public.patient_hospital_admissions') is not null then
    execute 'drop trigger if exists admissions_timeline_insert on public.patient_hospital_admissions';
    execute 'create trigger admissions_timeline_insert '
         || 'after insert on public.patient_hospital_admissions '
         || 'for each row execute function private.timeline_from_admission()';
    execute 'drop trigger if exists admissions_timeline_discharge on public.patient_hospital_admissions';
    execute 'create trigger admissions_timeline_discharge '
         || 'after update of discharged_on on public.patient_hospital_admissions '
         || 'for each row execute function private.timeline_from_admission()';
  end if;
end
$do$;
