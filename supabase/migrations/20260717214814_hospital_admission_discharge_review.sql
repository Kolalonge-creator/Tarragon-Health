-- Tarragon Health — hospital admission discharge review prompt + staff attribution
--
-- Extends patient_hospital_admissions (20260717181320) rather than introducing a
-- second, parallel admissions table — see the "one directory, not two" discipline
-- already applied elsewhere in this codebase.
--
-- Two gaps closed:
--  1. Authorship: an admission can now also be staff_recorded (e.g. a hospital
--     calls the clinic directly), attributed to the caller's own clinical_staff
--     row — server-derived, never client-supplied, and immutable after creation
--     (same "set once, never retroactively" rule as reviewed_by/completed_at
--     elsewhere in this codebase). A discharge_summary free-text field is added
--     alongside the existing self_reported_diagnosis/reason fields.
--  2. The discharge-time review prompt: the existing BEFORE INSERT trigger
--     already raises a clinician_review alert when an admission is first
--     logged — useful early context, left untouched. This migration ADDS a
--     second, distinct AFTER UPDATE trigger firing specifically on the
--     discharged_on null -> non-null transition, because the founder ask is
--     that discharge (not admission) is when a care-plan review actually makes
--     sense — the acute episode is over and there's something to reassess.
--     It raises a clinician_alerts row (the exact same worklist mechanism the
--     admission trigger already uses, and the one clinician-alerts.ts /
--     worklist.tsx already renders on the main /clinician dashboard — no new
--     clinician page needed). It only ever creates a review PROMPT; it never
--     writes to care_plans. A doctor reviewing it authors any plan change
--     themselves, same as every other clinician_review alert in this system.

-- ---------------------------------------------------------------------------
-- 1. Authorship columns
-- ---------------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_type where typname = 'hospital_admission_source') then
    create type public.hospital_admission_source as enum ('patient_reported', 'staff_recorded');
  end if;
end $$;

alter table public.patient_hospital_admissions
  add column if not exists source public.hospital_admission_source
    not null default 'patient_reported',
  add column if not exists recorded_by uuid references public.clinical_staff (id) on delete set null,
  add column if not exists discharge_summary text,
  add column if not exists discharge_review_alert_id uuid references public.clinician_alerts (id) on delete set null;

comment on column public.patient_hospital_admissions.recorded_by is
  'Server-derived from the inserting staff session''s own clinical_staff row (private.stamp_hospital_admission_recorder). Null for patient_reported rows. Never client-supplied, immutable after insert.';
comment on column public.patient_hospital_admissions.discharge_summary is
  'Free-text discharge notes, same non-clinical framing as self_reported_diagnosis/reason — not a formal clinical document.';

-- ---------------------------------------------------------------------------
-- 2. BEFORE INSERT: stamp source/recorded_by from the caller's own session
-- ---------------------------------------------------------------------------
-- A staff (org-staff, not the patient themselves) session inserting on a
-- patient's behalf is attributed to their own clinical_staff row; anything
-- else (the patient's own session, or a service-role/system insert) is
-- patient_reported with no recorded_by. Mirrors
-- private.stamp_medication_review_completion's lookup.
create or replace function private.stamp_hospital_admission_recorder()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff_id uuid;
begin
  if (select auth.uid()) is not null
     and new.patient_id <> (select auth.uid())
     and private.is_org_staff(new.organisation_id) then
    select id into v_staff_id
    from public.clinical_staff
    where profile_id = (select auth.uid())
      and organisation_id = new.organisation_id
      and active;
    new.source := 'staff_recorded';
    new.recorded_by := v_staff_id;
  else
    new.source := 'patient_reported';
    new.recorded_by := null;
  end if;
  return new;
end;
$$;

drop trigger if exists patient_hospital_admissions_stamp_recorder
  on public.patient_hospital_admissions;
create trigger patient_hospital_admissions_stamp_recorder
  before insert on public.patient_hospital_admissions
  for each row execute function private.stamp_hospital_admission_recorder();

-- ---------------------------------------------------------------------------
-- 3. Extend the update guard: authorship + the discharge alert link are
--    immutable after creation, for every session (not just patient sessions).
-- ---------------------------------------------------------------------------
create or replace function private.enforce_hospital_admission_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is not null
     and not private.is_org_staff(new.organisation_id) then
    new.organisation_id    := old.organisation_id;
    new.patient_id         := old.patient_id;
    new.clinician_alert_id := old.clinician_alert_id;
    new.created_at         := old.created_at;
  end if;
  -- Authorship is set once at insert time (private.stamp_hospital_admission_recorder)
  -- and the discharge-alert link is set once by the discharge trigger below —
  -- neither can be rewritten by any session afterward.
  new.source                    := old.source;
  new.recorded_by               := old.recorded_by;
  new.discharge_review_alert_id := old.discharge_review_alert_id;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. AFTER UPDATE: discharge -> raise a care-plan-review PROMPT (never edits
--    care_plans). Fires exactly once per admission, on the null -> non-null
--    discharged_on transition (the WHEN clause below is the natural guard —
--    it can't refire since old.discharged_on won't be null again).
-- ---------------------------------------------------------------------------
create or replace function private.handle_hospital_discharge()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_alert_id uuid;
  v_days     integer;
  v_summary_line text := '';
begin
  v_days := greatest(0, new.discharged_on - new.admitted_on);

  if new.discharge_summary is not null and length(btrim(new.discharge_summary)) > 0 then
    v_summary_line := format(' Discharge notes: %s.', new.discharge_summary);
  end if;

  insert into public.clinician_alerts
    (organisation_id, patient_id, level, status, title, detail, escalation_level)
  values (
    new.organisation_id,
    new.patient_id,
    'clinician_review',
    'open',
    'Review care plan after hospital discharge',
    format('Patient was discharged on %s (admitted %s, %s day%s). Review whether the care plan needs updating — this does not change the plan automatically.%s',
           new.discharged_on, new.admitted_on, v_days, case when v_days = 1 then '' else 's' end,
           v_summary_line),
    2
  )
  returning id into v_alert_id;

  -- AFTER triggers can't mutate NEW in place — stamp the link with an explicit
  -- UPDATE, same pattern as private.notify_unacknowledged_emergencies.
  update public.patient_hospital_admissions
    set discharge_review_alert_id = v_alert_id
    where id = new.id;

  insert into public.audit_log
    (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (
    new.organisation_id,
    coalesce((select auth.uid()), new.patient_id),
    'hospital_admission.discharged',
    'patient_hospital_admissions',
    new.id,
    jsonb_build_object('discharged_on', new.discharged_on, 'clinician_alert_id', v_alert_id)
  );

  return null;
end;
$$;

drop trigger if exists patient_hospital_admissions_discharge_review
  on public.patient_hospital_admissions;
create trigger patient_hospital_admissions_discharge_review
  after update on public.patient_hospital_admissions
  for each row
  when (old.discharged_on is null and new.discharged_on is not null)
  execute function private.handle_hospital_discharge();
