-- P4 (patient design audit 2026-10-29, "Exercise: add progress"): a place to record the sessions a person actually did.
--
-- Why: patient_exercise_enrollments says a person STARTED a programme and nothing records what they did afterwards, so any progress number
-- on the Exercise page would have been invented. This table is the missing record. Progress is computed from it and nothing else.
--
-- Design
--   * One row per session done (several a day are fine). performed_on is a Lagos calendar date, never in the future, at most 30 days back.
--   * enrollment_id is optional: a person can log a walk without being on a programme. When given it must belong to the same patient.
--   * symptom_during records "chest pain, dizziness or unusual breathlessness during it". It is the person's own report. The page tells them to
--     stop and what to do; this migration adds NO new clinician alert path (open question, see the PR). Staff read it only through a care tie.
--   * Patient writes their own rows only. Staff never write. Read: the patient, or staff with a care tie (private.staff_may_read, INV-12).
--   * Registered in data_registry (class PROPOSED, reviewed = false: the CMO and DPO have not classified it) and staff_read_scope ('tied').
--   * Under-18 dependants: left in the default 'guarded' class (event trigger S04b-1e adds the restrictive policy), same as exercise_readiness_screens and
--     patient_exercise_enrollments. A guardian cannot log exercise for a child through this table.
-- Nothing is deleted or rewritten. No existing function is edited.

create table public.exercise_session_logs (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete restrict,
  patient_id       uuid not null references public.profiles (id) on delete cascade,
  enrollment_id    uuid references public.patient_exercise_enrollments (id) on delete set null,
  performed_on     date not null,
  duration_minutes integer not null check (duration_minutes between 1 and 600),
  kind             text not null default 'other' check (kind in ('walking', 'mobility', 'strength', 'cardio', 'other')),
  effort           text check (effort is null or effort in ('easy', 'moderate', 'hard')),
  symptom_during   boolean not null default false,
  note             text check (note is null or char_length(note) <= 300),
  created_at       timestamptz not null default now(),
  is_test          boolean not null default false
);

create index exercise_session_logs_patient_idx on public.exercise_session_logs (patient_id, performed_on desc);
create index exercise_session_logs_org_idx on public.exercise_session_logs (organisation_id);
create index exercise_session_logs_enrollment_idx on public.exercise_session_logs (enrollment_id) where enrollment_id is not null;

comment on table public.exercise_session_logs is
  'Exercise sessions a patient recorded as done. The only source for exercise progress: nothing else counts a session. Self-reported, never a clinical measurement.';
comment on column public.exercise_session_logs.symptom_during is
  'Patient''s own answer to "chest pain, dizziness or unusual breathlessness during it". Shown to staff only through a care tie. Adds no alert path by itself.';

-- Date bounds and enrolment ownership. Insert only: a later correction (typo in minutes) must not be blocked by the 30-day window.
create or replace function private.exercise_session_log_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Africa/Lagos')::date;
begin
  if new.performed_on > v_today then
    raise exception 'A session cannot be dated in the future.' using errcode = '22023';
  end if;
  if new.performed_on < v_today - 30 then
    raise exception 'Sessions can be logged up to 30 days back.' using errcode = '22023';
  end if;
  if new.enrollment_id is not null and not exists (
    select 1 from public.patient_exercise_enrollments e where e.id = new.enrollment_id and e.patient_id = new.patient_id
  ) then
    raise exception 'That programme is not yours.' using errcode = '42501';
  end if;
  return new;
end $$;

revoke all on function private.exercise_session_log_guard() from public, anon;

create trigger exercise_session_logs_guard
  before insert on public.exercise_session_logs
  for each row execute function private.exercise_session_log_guard();

-- A row's owner, date and enrolment never change after the fact (a wrong session is deleted and logged again). The one allowed change is
-- enrollment_id going to null, which is the ON DELETE SET NULL of deleting the enrolment; blocking it would make a used enrolment undeletable.
create or replace function private.exercise_session_log_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.patient_id is distinct from old.patient_id
     or new.organisation_id is distinct from old.organisation_id
     or (new.enrollment_id is distinct from old.enrollment_id and new.enrollment_id is not null)
     or new.performed_on is distinct from old.performed_on then
    raise exception 'Owner, date and programme of a logged session cannot be changed.' using errcode = '22023';
  end if;
  return new;
end $$;

revoke all on function private.exercise_session_log_immutable() from public, anon;

create trigger exercise_session_logs_immutable
  before update on public.exercise_session_logs
  for each row execute function private.exercise_session_log_immutable();

alter table public.exercise_session_logs enable row level security;

create policy exercise_session_logs_select on public.exercise_session_logs
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.staff_may_read(patient_id, organisation_id, 'medical_history'::public.care_access_category)
  );

create policy exercise_session_logs_insert on public.exercise_session_logs
  for insert to authenticated
  with check (patient_id = (select auth.uid()) and organisation_id = private.current_org_id());

create policy exercise_session_logs_update on public.exercise_session_logs
  for update to authenticated
  using (patient_id = (select auth.uid()))
  with check (patient_id = (select auth.uid()) and organisation_id = private.current_org_id());

create policy exercise_session_logs_delete on public.exercise_session_logs
  for delete to authenticated
  using (patient_id = (select auth.uid()));

grant select, insert, update, delete on public.exercise_session_logs to authenticated;
revoke all on public.exercise_session_logs from anon, public;

-- The two registries every patient table must be in (rls_shape_gate and s39d_registry_purge_export fail without them).
insert into public.data_registry (table_name, patient_expr, retention_class, end_of_retention, in_export, reviewed, notes)
values ('exercise_session_logs', 'patient_id', 'clinical_record', 'review', true, false,
        'Self-reported exercise sessions. Class assigned by the migration author, not yet reviewed by the CMO and DPO.')
on conflict (table_name) do nothing;

insert into public.staff_read_scope (table_name, mode, patient_expr, category, reason)
values ('exercise_session_logs', 'tied', 'patient_id', 'medical_history', null)
on conflict (table_name) do nothing;

do $$
begin
  if not exists (select 1 from public.data_registry where table_name = 'exercise_session_logs' and not reviewed) then
    raise exception 'exercise_session_logs is not registered in data_registry as expected';
  end if;
  if not exists (select 1 from public.staff_read_scope where table_name = 'exercise_session_logs' and mode = 'tied') then
    raise exception 'exercise_session_logs is not registered in staff_read_scope as expected';
  end if;
  if has_table_privilege('anon', 'public.exercise_session_logs', 'SELECT') then
    raise exception 'anon can read exercise_session_logs';
  end if;
end $$;
