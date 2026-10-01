-- S05 (v5 health record data model), part 1 of 3: the additive schema. Decisions applied: OQ-11 (prescriptions table),
-- OQ-23 (live wins for the health record), OQ-02/OQ-03 (tied-patient reads, audited read RPCs), founder rulings 2026-10-01.
-- Design and reconciliation map: docs/design/S05.md.
--
-- Counted first (live, 2026-10-01): vitals_readings 12 rows, symptoms 1, medication_logs 0, medications 0,
-- clinical_encounter_notes 0, specialist_referrals 0, patient_documents 0. No prescriptions table. No client_id on
-- symptoms or medication_logs; vitals_readings already has client_reading_id with a unique (patient_id, client_reading_id)
-- index. Because the two note/referral tables are empty, the new CHECK constraints are validated immediately and no
-- data-conversion step exists.
--
-- What this adds (only the gaps; the rest of v5 4.3 already exists under a live name, see the design note):
--   1. record_source enum and `source` on symptoms, medication_logs, patient_conditions (provenance).
--   2. client_id (device idempotency key) on symptoms and medication_logs, unique per patient.
--   3. vitals_readings.triage_event_id (nullable, no FK until S11) and generic value_numeric/value_unit so a new
--      observation type needs no new column.
--   4. v5-named security_invoker views over the live tables: observations, symptom_reports, dose_events,
--      medication_schedules, conditions, allergies, documents, notes, clinical_referrals.
--   5. prescriptions (new, INV-02) with a signature CHECK, a forward-only state machine and frozen items once signed;
--      medications.prescription_id link.
--   6. specialist_referrals.signed_by / signed_at with the same rule (INV-02).
--   7. clinical_encounter_notes: amends_note_id, ai_drafted, and the patient sees finalized (signed) notes only (INV-11).
--   8. private.clinician_has_patient_access(): the one stub for INV-12 (S16-S19 extend it).
--
-- Deliberately NOT here: care_plan_changes and the patient column allow-list on medications (S24); the audited read
-- functions and the final staff-read block (parts 2 and 3); no signing UI, no scribe, no triage logic.

-- ---------------------------------------------------------------------------
-- 1. Provenance
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                  where n.nspname = 'public' and t.typname = 'record_source') then
    create type public.record_source as enum ('patient', 'device', 'ussd', 'clinician', 'partner', 'system');
  end if;
end $$;

alter table public.symptoms          add column if not exists source public.record_source not null default 'patient';
alter table public.medication_logs   add column if not exists source public.record_source not null default 'patient';
alter table public.patient_conditions add column if not exists source public.record_source not null default 'clinician';

-- Rows a supporter or staff member entered for the patient (logged_by_profile_id is set only when the actor is not
-- the patient, see private.stamp_acting_supporter). 1 symptom row and 0 log rows live at the time of writing.
update public.symptoms        set source = 'clinician' where logged_by_profile_id is not null and logged_by_profile_id <> patient_id
  and exists (select 1 from public.clinical_staff cs where cs.profile_id = symptoms.logged_by_profile_id);
update public.medication_logs set source = 'clinician' where logged_by_profile_id is not null and logged_by_profile_id <> patient_id
  and exists (select 1 from public.clinical_staff cs where cs.profile_id = medication_logs.logged_by_profile_id);

comment on column public.symptoms.source is 'v5 provenance. recorded_by is logged_by_profile_id (null means the patient herself); see view symptom_reports.';
comment on column public.medication_logs.source is 'v5 provenance. recorded_by is logged_by_profile_id (null means the patient herself); see view dose_events.';

-- ---------------------------------------------------------------------------
-- 2. Idempotency (S06 offline retries must never double-insert)
-- ---------------------------------------------------------------------------
alter table public.symptoms        add column if not exists client_id uuid;
alter table public.medication_logs add column if not exists client_id uuid;

create unique index if not exists symptoms_client_dedupe_idx
  on public.symptoms (patient_id, client_id) where client_id is not null;
create unique index if not exists medication_logs_client_dedupe_idx
  on public.medication_logs (patient_id, client_id) where client_id is not null;

comment on column public.symptoms.client_id is 'Device-generated idempotency key; unique per patient. A retried insert fails 23505 and the client treats it as done.';
comment on column public.medication_logs.client_id is 'Device-generated idempotency key; unique per patient. A retried insert fails 23505 and the client treats it as done.';

-- ---------------------------------------------------------------------------
-- 3. Observations: triage link and generic typing
-- ---------------------------------------------------------------------------
alter table public.vitals_readings add column if not exists triage_event_id uuid;
alter table public.vitals_readings add column if not exists value_numeric numeric;
alter table public.vitals_readings add column if not exists value_unit text;

comment on column public.vitals_readings.triage_event_id is 'v5 observations.triage_event_id. No FK yet: the triage_events table arrives with S11/S12.';
comment on column public.vitals_readings.value_numeric is
  'For an observation type with no dedicated column (added later with ALTER TYPE vital_type ADD VALUE). Types that already have a column keep using it.';

-- ---------------------------------------------------------------------------
-- 4. Medicines link and notes/referral columns
-- ---------------------------------------------------------------------------
alter table public.clinical_encounter_notes add column if not exists amends_note_id uuid references public.clinical_encounter_notes(id) on delete restrict;
alter table public.clinical_encounter_notes add column if not exists ai_drafted boolean not null default false;

comment on column public.clinical_encounter_notes.amends_note_id is
  'v5 notes.amends_note_id. A finalized note is immutable (existing trigger); a correction is a new note pointing at the original, which then reads as `amended`.';
comment on column public.clinical_encounter_notes.ai_drafted is
  'INV-11: true when an AI scribe produced the draft. Such a note is invisible to the patient and to the record until a clinician finalizes it.';

create or replace function private.validate_note_amendment()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_orig record;
begin
  if new.amends_note_id is null then
    return new;
  end if;
  select patient_id, status into v_orig from public.clinical_encounter_notes where id = new.amends_note_id;
  if v_orig is null then
    raise exception 'amended note not found' using errcode = '23503';
  end if;
  if v_orig.patient_id <> new.patient_id then
    raise exception 'an amendment must be for the same patient as the note it amends' using errcode = '23514';
  end if;
  if v_orig.status <> 'finalized' then
    raise exception 'only a finalized note can be amended; edit the draft instead' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function private.validate_note_amendment() from public, anon;

drop trigger if exists clinical_encounter_notes_validate_amendment on public.clinical_encounter_notes;
create trigger clinical_encounter_notes_validate_amendment
  before insert or update of amends_note_id on public.clinical_encounter_notes
  for each row execute function private.validate_note_amendment();

-- INV-11: the patient reads finalized (signed) notes only. Drafts, AI drafts included, never reach the patient.
drop policy if exists clinical_encounter_notes_select_own_signed on public.clinical_encounter_notes;
create policy clinical_encounter_notes_select_own_signed on public.clinical_encounter_notes
  for select to authenticated
  using (patient_id = (select auth.uid()) and status = 'finalized');

-- Referrals: INV-02. signed_by and signed_at before anything leaves draft.
alter table public.specialist_referrals add column if not exists signed_by uuid references public.profiles(id) on delete restrict;
alter table public.specialist_referrals add column if not exists signed_at timestamptz;

create or replace function private.stamp_referral_signature()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Leaving draft is the clinician's signing act. Only a prescriber-tier clinician in the patient's organisation
  -- can stamp it, and only as herself; any other path leaves the columns null and the CHECK refuses the row.
  if new.status <> 'draft' and (new.signed_by is null or new.signed_at is null) then
    if (select auth.uid()) is not null and private.is_clinical_tier(new.organisation_id) then
      new.signed_by := (select auth.uid());
      new.signed_at := now();
    end if;
  end if;
  if tg_op = 'UPDATE' and old.signed_at is not null
     and (new.signed_by is distinct from old.signed_by or new.signed_at is distinct from old.signed_at) then
    raise exception 'a referral signature cannot be changed' using errcode = '42501';
  end if;
  if new.signed_by is not null and (select auth.uid()) is not null and new.signed_by <> (select auth.uid())
     and (tg_op = 'INSERT' or old.signed_by is distinct from new.signed_by) then
    raise exception 'a referral can only be signed by the clinician acting' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function private.stamp_referral_signature() from public, anon;

drop trigger if exists specialist_referrals_stamp_signature on public.specialist_referrals;
create trigger specialist_referrals_stamp_signature
  before insert or update on public.specialist_referrals
  for each row execute function private.stamp_referral_signature();

alter table public.specialist_referrals drop constraint if exists specialist_referrals_signed_before_send;
alter table public.specialist_referrals add constraint specialist_referrals_signed_before_send
  check (status = 'draft' or (signed_by is not null and signed_at is not null));

-- ---------------------------------------------------------------------------
-- 5. Prescriptions (INV-02; OQ-11 option a)
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                  where n.nspname = 'public' and t.typname = 'prescription_state') then
    create type public.prescription_state as enum ('draft', 'signed', 'sent', 'dispensed', 'cancelled');
  end if;
end $$;

create table if not exists public.prescriptions (
  id                   uuid primary key default gen_random_uuid(),
  organisation_id      uuid not null references public.organisations(id),
  patient_id           uuid not null references public.profiles(id) on delete restrict,
  encounter_note_id    uuid references public.clinical_encounter_notes(id) on delete restrict,
  items                jsonb not null default '[]'::jsonb,
  pharmacy_partner_id  uuid references public.pharmacy_partners(id) on delete restrict,
  collection_code      text,
  state                public.prescription_state not null default 'draft',
  signed_by            uuid references public.profiles(id) on delete restrict,
  signed_at            timestamptz,
  sent_at              timestamptz,
  dispensed_at         timestamptz,
  cancelled_at         timestamptz,
  source               public.record_source not null default 'clinician',
  recorded_by          uuid references public.profiles(id) on delete restrict,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz,
  constraint prescriptions_items_is_array check (jsonb_typeof(items) = 'array'),
  constraint prescriptions_signed_before_send check (
    state in ('draft', 'cancelled') or (signed_by is not null and signed_at is not null)
  )
);

comment on table public.prescriptions is
  'v5 4.3 prescriptions (INV-02). A prescription cannot leave draft, and so cannot be sent or dispensed, without signed_by and signed_at '
  '(CHECK). Items are frozen once signed. Staff read it only through read_prescriptions_audited (INV-10). `medications` stays the patient''s '
  'current-medicines projection (OQ-11); linking is medications.prescription_id.';

create index if not exists prescriptions_patient_idx on public.prescriptions (patient_id, created_at desc);
create index if not exists prescriptions_partner_idx on public.prescriptions (pharmacy_partner_id, state) where pharmacy_partner_id is not null;

alter table public.medications add column if not exists prescription_id uuid references public.prescriptions(id) on delete restrict;
create index if not exists medications_prescription_idx on public.medications (prescription_id) where prescription_id is not null;

create or replace function private.enforce_prescription_rules()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if tg_op = 'INSERT' then
    new.recorded_by := coalesce(new.recorded_by, v_uid);
    if v_uid is not null and new.state <> 'draft' then
      raise exception 'a prescription is created as a draft and signed afterwards' using errcode = '23514';
    end if;
  else
    -- Forward-only state machine. cancelled is terminal.
    if new.state is distinct from old.state and not (
         (old.state = 'draft'  and new.state in ('signed', 'cancelled'))
      or (old.state = 'signed' and new.state in ('sent', 'cancelled'))
      or (old.state = 'sent'   and new.state in ('dispensed', 'cancelled'))
    ) then
      raise exception 'invalid prescription state change % -> %', old.state, new.state using errcode = '23514';
    end if;
    -- Signed content is frozen: a change to a medicine or dose needs a new, newly signed prescription.
    if old.signed_at is not null and (
         new.items is distinct from old.items or new.patient_id is distinct from old.patient_id
      or new.encounter_note_id is distinct from old.encounter_note_id
      or new.signed_by is distinct from old.signed_by or new.signed_at is distinct from old.signed_at) then
      raise exception 'a signed prescription cannot be altered; issue a new one' using errcode = '42501';
    end if;
  end if;

  -- Signing: moving out of draft is the prescriber's act, stamped as herself. Anyone else leaves the columns null
  -- and the CHECK refuses the row.
  if new.state not in ('draft', 'cancelled') and (new.signed_by is null or new.signed_at is null) then
    if v_uid is not null and private.has_prescribing_authority(new.organisation_id) then
      new.signed_by := v_uid;
      new.signed_at := now();
    end if;
  end if;
  if new.signed_by is not null and v_uid is not null and new.signed_by <> v_uid
     and (tg_op = 'INSERT' or old.signed_by is distinct from new.signed_by) then
    raise exception 'a prescription can only be signed by the clinician acting' using errcode = '42501';
  end if;

  if new.state = 'sent'      and new.sent_at      is null then new.sent_at      := now(); end if;
  if new.state = 'dispensed' and new.dispensed_at is null then new.dispensed_at := now(); end if;
  if new.state = 'cancelled' and new.cancelled_at is null then new.cancelled_at := now(); end if;
  if tg_op = 'UPDATE' then new.updated_at := now(); end if;
  return new;
end;
$$;
revoke all on function private.enforce_prescription_rules() from public, anon;

drop trigger if exists prescriptions_enforce_rules on public.prescriptions;
create trigger prescriptions_enforce_rules
  before insert or update on public.prescriptions
  for each row execute function private.enforce_prescription_rules();

drop trigger if exists audit_row_change_trg on public.prescriptions;
create trigger audit_row_change_trg
  after insert or update or delete on public.prescriptions
  for each row execute function private.audit_row_change();

-- ---------------------------------------------------------------------------
-- 6. INV-12 stub: one function every new clinical policy and audited read calls. S16-S19 replace its body
--    with the task, lead-assignment and on-call-page tables; callers do not change.
-- ---------------------------------------------------------------------------
create or replace function private.clinician_has_patient_access(p_patient uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select auth.uid()) is not null
    and p_patient is not null
    and private.is_org_staff((select pr.organisation_id from public.profiles pr where pr.id = p_patient))
    and (
      -- today's care-team assignment (clinician, clinical director, care coordinator)
      exists (
        select 1 from public.care_team_assignment cta
         where cta.patient_id = p_patient
           and (select auth.uid()) in (cta.clinician_id, cta.clinical_director_id, cta.care_coordinator_id)
      )
      -- an open escalation routed to me
      or exists (
        select 1 from public.escalations e
         where e.patient_id = p_patient
           and e.assigned_doctor_id = (select auth.uid())
           and e.status in ('open', 'under_review')
      )
      -- an unresolved alert I am responsible for (or the backup)
      or exists (
        select 1 from public.clinician_alerts a
          join public.clinical_staff cs on cs.id in (a.responsible_clinician_id, a.backup_clinician_id)
         where a.patient_id = p_patient
           and cs.profile_id = (select auth.uid())
           and a.status in ('open', 'acknowledged', 'snoozed')
      )
      -- a booked or in-progress appointment with me
      or exists (
        select 1 from public.appointments ap
         where ap.patient_id = p_patient
           and ap.clinician_id = (select auth.uid())
           and ap.status in ('scheduled', 'booked', 'confirmed', 'checked_in', 'in_progress')
      )
    );
$$;
-- Policies (prescriptions insert/update) evaluate it as the calling user, so authenticated needs EXECUTE (same as private.is_org_staff).
-- anon never does; the private schema is not exposed through the API.
revoke all on function private.clinician_has_patient_access(uuid) from public, anon;
grant execute on function private.clinician_has_patient_access(uuid) to authenticated;

comment on function private.clinician_has_patient_access(uuid) is
  'INV-12 (stub, S05). Staff are tied to a patient by care-team assignment, an open escalation or alert routed to them, or a live appointment. '
  'S16-S19 add active task, lead assignment and on-call page here. Break-glass and support-view sessions are handled by private.can_staff_read_clinical.';

create or replace function private.can_staff_read_clinical(p_patient uuid, p_category public.care_access_category)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.clinician_has_patient_access(p_patient)
      or private.has_emergency_access(p_patient, p_category)
      or private.can_support_view(p_patient);
$$;
revoke all on function private.can_staff_read_clinical(uuid, public.care_access_category) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. Prescriptions RLS and grants (no staff SELECT: staff read through read_prescriptions_audited)
-- ---------------------------------------------------------------------------
alter table public.prescriptions enable row level security;

drop policy if exists prescriptions_select_patient on public.prescriptions;
create policy prescriptions_select_patient on public.prescriptions
  for select to authenticated
  using (patient_id = (select auth.uid()) and state <> 'draft');

-- The author reads back what she just wrote (INSERT ... RETURNING needs a SELECT policy).
drop policy if exists prescriptions_select_author on public.prescriptions;
create policy prescriptions_select_author on public.prescriptions
  for select to authenticated
  using (recorded_by = (select auth.uid()));

drop policy if exists prescriptions_select_partner on public.prescriptions;
create policy prescriptions_select_partner on public.prescriptions
  for select to authenticated
  using (
    state in ('sent', 'dispensed')
    and pharmacy_partner_id is not null
    and pharmacy_partner_id = (select p.pharmacy_partner_id from public.profiles p where p.id = (select auth.uid()))
  );

-- A Care Circle supporter reads a non-draft prescription only through the category-scoped model (medications). The explicit cast
-- matters: can_read_clinical has two other overloads and an untyped literal is ambiguous.
drop policy if exists prescriptions_select_supporter on public.prescriptions;
create policy prescriptions_select_supporter on public.prescriptions
  for select to authenticated
  using (state <> 'draft' and private.can_read_clinical(patient_id, 'medications'::public.care_access_category));

drop policy if exists prescriptions_insert_prescriber on public.prescriptions;
create policy prescriptions_insert_prescriber on public.prescriptions
  for insert to authenticated
  with check (
    private.has_prescribing_authority(organisation_id)
    and private.clinician_has_patient_access(patient_id)
  );

drop policy if exists prescriptions_update_prescriber on public.prescriptions;
create policy prescriptions_update_prescriber on public.prescriptions
  for update to authenticated
  using (private.has_prescribing_authority(organisation_id) and private.clinician_has_patient_access(patient_id))
  with check (private.has_prescribing_authority(organisation_id) and private.clinician_has_patient_access(patient_id));

drop policy if exists prescriptions_update_partner_dispense on public.prescriptions;
create policy prescriptions_update_partner_dispense on public.prescriptions
  for update to authenticated
  using (
    state = 'sent' and pharmacy_partner_id is not null
    and pharmacy_partner_id = (select p.pharmacy_partner_id from public.profiles p where p.id = (select auth.uid()))
  )
  with check (state = 'dispensed');

revoke all on public.prescriptions from anon;
grant select, insert, update on public.prescriptions to authenticated;

-- ---------------------------------------------------------------------------
-- 8. v5-named views over the live tables (security_invoker: the base-table RLS decides, no second source of truth)
-- ---------------------------------------------------------------------------
create or replace view public.observations with (security_invoker = true) as
select
  v.id,
  v.organisation_id,
  v.patient_id,
  case v.vital_type
    when 'blood_pressure' then 'bp'
    when 'waist_circumference' then 'waist'
    else v.vital_type::text
  end as type,
  v.systolic,
  v.diastolic,
  coalesce(
    case v.vital_type
      when 'glucose' then v.glucose_mmol_l
      when 'weight' then v.weight_kg
      when 'pulse' then v.pulse_bpm::numeric
      when 'temperature' then v.temperature_c
      when 'spo2' then v.spo2_pct::numeric
      when 'waist_circumference' then v.waist_cm
      when 'ketones' then v.ketones_mmol_l
      when 'respiratory_rate' then v.respiratory_rate_bpm::numeric
      when 'peak_flow' then v.peak_flow_l_min::numeric
    end,
    v.value_numeric
  ) as value_numeric,
  coalesce(
    case v.vital_type
      when 'blood_pressure' then 'mmHg'
      when 'glucose' then 'mmol/L'
      when 'weight' then 'kg'
      when 'pulse' then 'bpm'
      when 'temperature' then 'C'
      when 'spo2' then '%'
      when 'waist_circumference' then 'cm'
      when 'ketones' then 'mmol/L'
      when 'respiratory_rate' then 'breaths/min'
      when 'peak_flow' then 'L/min'
    end,
    v.value_unit
  ) as unit,
  v.taken_at as measured_at,
  jsonb_strip_nulls(jsonb_build_object(
    'arm', v.arm, 'position', v."position", 'glucose_context', v.glucose_context, 'note', v.note
  )) as context,
  v.client_reading_id as client_id,
  v.triage_event_id,
  (case v.source
     when 'manual' then 'patient'
     when 'device' then 'device'
     when 'wearable' then 'device'
     when 'cgm' then 'device'
     when 'fhir_import' then 'partner'
   end)::public.record_source as source,
  coalesce(v.logged_by_profile_id, v.patient_id) as recorded_by,
  v.validation_status,
  v.created_at
from public.vitals_readings v;

create or replace view public.symptom_reports with (security_invoker = true) as
select
  s.id,
  s.organisation_id,
  s.patient_id,
  s.symptom_type as code,
  s.description as free_text,
  s.severity,
  s.is_red_flag,
  s.reported_at,
  s.client_id,
  s.source,
  coalesce(s.logged_by_profile_id, s.patient_id) as recorded_by,
  s.medication_id,
  s.created_at
from public.symptoms s;

create or replace view public.medication_schedules with (security_invoker = true) as
select
  m.id as medication_id,
  m.organisation_id,
  m.patient_id,
  m.schedule_times as times,
  nullif(btrim(coalesce(m.dose, '') || ' ' || coalesce(m.frequency, '')), '') as dose_text,
  m.created_at::date as start_date,
  coalesce(m.stopped_at::date, m.expires_at::date) as end_date,
  m.is_active as active
from public.medications m;

create or replace view public.dose_events with (security_invoker = true) as
select
  l.id,
  l.organisation_id,
  l.patient_id,
  l.medication_id as schedule_id,
  case
    when l.scheduled_for_date is not null and l.scheduled_time ~ '^[0-2]?[0-9]:[0-5][0-9]'
      then ((l.scheduled_for_date + l.scheduled_time::time) at time zone 'Africa/Lagos')
    else l.logged_at
  end as due_at,
  case l.status
    when 'taken' then 'taken'
    when 'delayed' then 'taken'
    when 'skipped' then 'skipped'
    when 'not_available' then 'skipped'
    when 'missed' then 'missed'
  end as status,
  l.logged_at as recorded_at,
  l.client_id,
  l.source,
  coalesce(l.logged_by_profile_id, l.patient_id) as recorded_by
from public.medication_logs l;

create or replace view public.conditions with (security_invoker = true) as
select
  c.id,
  c.organisation_id,
  c.patient_id,
  c.icd10_code as code,
  c.condition_name as display,
  c.status,
  c.recorded_by,
  (c.diagnosing_clinician_id is not null) as verified_by_clinician,
  c.source,
  c.created_at
from public.patient_conditions c;

create or replace view public.allergies with (security_invoker = true) as
select
  a.id,
  a.organisation_id,
  a.patient_id,
  a.allergen as substance,
  a.reaction,
  a.severity,
  a.verification_status,
  a.recorded_by,
  a.created_at
from public.patient_allergies a;

create or replace view public.documents with (security_invoker = true) as
select
  d.id,
  d.organisation_id,
  d.patient_id,
  d.document_type as kind,
  d.file_path as storage_path,
  d.uploaded_by,
  (case d.source
     when 'patient' then 'patient'
     when 'lab_liaison' then 'partner'
     when 'clinician' then 'clinician'
     when 'admin' then 'system'
   end)::public.record_source as source,
  d.document_date,
  d.created_at
from public.patient_documents d;

create or replace view public.notes with (security_invoker = true) as
select
  n.id,
  n.organisation_id,
  n.patient_id,
  n.clinical_encounter_id as encounter_id,
  n.authored_by_staff as author_clinician_id,
  case
    when n.status <> 'finalized' then 'draft'
    when exists (select 1 from public.clinical_encounter_notes a where a.amends_note_id = n.id and a.status = 'finalized') then 'amended'
    else 'signed'
  end as state,
  jsonb_strip_nulls(jsonb_build_object(
    'reason', n.reason_for_encounter, 'history', n.history, 'examination', n.examination_findings,
    'assessment', n.assessment, 'diagnosis', n.diagnosis, 'plan', n.plan, 'follow_up', n.follow_up_instructions
  )) as body,
  n.ai_drafted,
  n.finalized_at as signed_at,
  n.amends_note_id,
  n.created_at
from public.clinical_encounter_notes n;

-- v5 calls this `referrals`; that name is taken by the invite/reward table, so the clinical one is clinical_referrals.
create or replace view public.clinical_referrals with (security_invoker = true) as
select
  r.id,
  r.organisation_id,
  r.patient_id,
  r.specialist_type as to_facility,
  r.referral_reason as reason,
  r.status::text as state,
  r.signed_by,
  r.signed_at,
  r.referred_by,
  r.created_at
from public.specialist_referrals r;

revoke all on public.observations, public.symptom_reports, public.medication_schedules, public.dose_events,
              public.conditions, public.allergies, public.documents, public.notes, public.clinical_referrals from anon;
grant select on public.observations, public.symptom_reports, public.medication_schedules, public.dose_events,
                public.conditions, public.allergies, public.documents, public.notes, public.clinical_referrals to authenticated;

-- ---------------------------------------------------------------------------
-- 9. Assertions: "built" is provable
-- ---------------------------------------------------------------------------
do $$
declare
  v_n integer;
  v_name text;
begin
  -- idempotency indexes exist and are unique
  select count(*) into v_n from pg_indexes
   where schemaname = 'public' and indexname in ('symptoms_client_dedupe_idx', 'medication_logs_client_dedupe_idx', 'vitals_readings_client_dedupe_idx')
     and indexdef ilike 'create unique index%';
  if v_n <> 3 then raise exception 'S05 assertion: expected 3 unique client dedupe indexes, found %', v_n; end if;

  -- every new view is security_invoker
  for v_name in select unnest(array['observations','symptom_reports','medication_schedules','dose_events','conditions','allergies','documents','notes','clinical_referrals']) loop
    if not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                    where n.nspname = 'public' and c.relname = v_name and c.relkind = 'v'
                      and coalesce(c.reloptions, '{}') @> array['security_invoker=true']) then
      raise exception 'S05 assertion: view % missing or not security_invoker', v_name;
    end if;
    if has_table_privilege('anon', 'public.' || v_name, 'SELECT') then
      raise exception 'S05 assertion: anon can read view %', v_name;
    end if;
  end loop;

  -- prescriptions: RLS on, no anon, signature CHECK present, no staff SELECT policy
  if not (select relrowsecurity from pg_class where oid = 'public.prescriptions'::regclass) then
    raise exception 'S05 assertion: prescriptions has no RLS';
  end if;
  if has_table_privilege('anon', 'public.prescriptions', 'SELECT') then
    raise exception 'S05 assertion: anon can read prescriptions';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'prescriptions_signed_before_send') then
    raise exception 'S05 assertion: prescriptions signature CHECK missing';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'prescriptions' and cmd = 'SELECT' and qual ilike '%is_org_staff%') then
    raise exception 'S05 assertion: prescriptions has an org-staff SELECT policy';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'specialist_referrals_signed_before_send') then
    raise exception 'S05 assertion: referral signature CHECK missing';
  end if;

  -- the INV-12 stub is evaluated inside policies as the caller, so authenticated has EXECUTE; anon never does;
  -- the combined gate is reachable only from the audited SECURITY DEFINER functions
  if has_function_privilege('anon', 'private.clinician_has_patient_access(uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'private.clinician_has_patient_access(uuid)', 'EXECUTE') then
    raise exception 'S05 assertion: clinician_has_patient_access privileges are wrong';
  end if;
  if has_function_privilege('anon', 'private.can_staff_read_clinical(uuid,public.care_access_category)', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.can_staff_read_clinical(uuid,public.care_access_category)', 'EXECUTE') then
    raise exception 'S05 assertion: can_staff_read_clinical is executable by an app role';
  end if;

  -- the existing red-flag triggers on vitals_readings are all still attached
  select count(*) into v_n from pg_trigger t
   where t.tgrelid = 'public.vitals_readings'::regclass and not t.tgisinternal
     and t.tgname in ('vitals_readings_bp_red_flag', 'vitals_readings_spo2_red_flag', 'vitals_readings_pulse_red_flag',
                      'vitals_readings_temperature_red_flag', 'vitals_readings_glucose_emergency_backstop',
                      'vitals_readings_stamp_manual_timestamp', 'vitals_readings_enforce_source_lock');
  if v_n <> 7 then raise exception 'S05 assertion: a vitals trigger went missing (found % of 7)', v_n; end if;
end $$;
