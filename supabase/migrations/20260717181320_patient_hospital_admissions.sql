-- Tarragon Health — Patient-reported hospital admissions
--
-- A patient can tell the platform they were (or are) admitted to hospital,
-- with a self-reported diagnosis, the admission date, and — once discharged —
-- the discharge date (duration is DERIVED, never stored). This is the
-- admission/discharge loop the founder asked for; it drives the patient's
-- calendar/timeline and PROMPTS a clinician to review the care plan.
--
-- Guardrails baked in here:
--  * The diagnosis is PATIENT-REPORTED. It is never rendered through the
--    ReviewedByDoctor attribution component and never auto-mutates a care plan.
--    Instead, an admission raises a `clinician_review` alert (escalation_level
--    2 — NOT emergency) so a doctor reviews and, if warranted, *authors* the
--    plan change. Trust model preserved: system proposes, doctor decides.
--  * Patient-authored + org-scoped + RLS, mirroring emergency_events. A patient
--    session may edit only its own descriptive fields (a BEFORE UPDATE guard
--    preserves every staff/system-owned field), so the alert link can't be
--    spoofed.

-- ---------------------------------------------------------------------------
-- 1. Table
-- ---------------------------------------------------------------------------
create table if not exists public.patient_hospital_admissions (
  id                       uuid primary key default gen_random_uuid(),
  organisation_id          uuid not null references public.organisations (id) on delete restrict,
  patient_id               uuid not null references public.profiles (id) on delete cascade,
  -- Where. Optional link to a known facility, else free text.
  facility_id              uuid references public.facilities (id) on delete set null,
  facility_name            text,
  -- When. discharged_on null = still admitted (the patient's "still in / now out"
  -- toggle). Duration is derived (discharged_on - admitted_on), never stored.
  admitted_on              date not null,
  discharged_on            date,
  -- What. Patient-reported only — labelled as such everywhere it renders.
  self_reported_diagnosis  text,
  reason                   text,
  -- Convenience flag for "currently admitted" queries; can't drift from the data.
  is_current               boolean generated always as (discharged_on is null) stored,
  -- The care-plan-review alert this admission raised (set by the insert trigger).
  clinician_alert_id       uuid references public.clinician_alerts (id) on delete set null,
  -- If this admission followed an emergency event, the patient can link it.
  emergency_event_id       uuid references public.emergency_events (id) on delete set null,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  constraint patient_hospital_admissions_discharge_after_admit
    check (discharged_on is null or discharged_on >= admitted_on),
  -- An admission is a past/current event, not a future booking.
  constraint patient_hospital_admissions_admitted_not_future
    check (admitted_on <= ((now() at time zone 'Africa/Lagos')::date + 1))
);

create index if not exists patient_hospital_admissions_patient_idx
  on public.patient_hospital_admissions (patient_id, admitted_on desc);
create index if not exists patient_hospital_admissions_org_idx
  on public.patient_hospital_admissions (organisation_id);
create index if not exists patient_hospital_admissions_current_idx
  on public.patient_hospital_admissions (organisation_id)
  where is_current;

drop trigger if exists patient_hospital_admissions_set_updated_at
  on public.patient_hospital_admissions;
create trigger patient_hospital_admissions_set_updated_at
  before update on public.patient_hospital_admissions
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. RLS — patient manages own rows; org staff read + update. Mirrors
--    emergency_events exactly.
-- ---------------------------------------------------------------------------
alter table public.patient_hospital_admissions enable row level security;

drop policy if exists patient_hospital_admissions_select on public.patient_hospital_admissions;
create policy patient_hospital_admissions_select on public.patient_hospital_admissions
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

drop policy if exists patient_hospital_admissions_insert on public.patient_hospital_admissions;
create policy patient_hospital_admissions_insert on public.patient_hospital_admissions
  for insert to authenticated
  with check (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

drop policy if exists patient_hospital_admissions_update on public.patient_hospital_admissions;
create policy patient_hospital_admissions_update on public.patient_hospital_admissions
  for update to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id))
  with check (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

grant select, insert, update, delete on public.patient_hospital_admissions to authenticated;

-- ---------------------------------------------------------------------------
-- 3. BEFORE INSERT: raise a care-plan-review alert (NOT an emergency)
-- ---------------------------------------------------------------------------
-- Runs SECURITY DEFINER so a patient-initiated row can raise the staff-write
-- clinician_alerts row — same pattern as private.handle_emergency_event(), but
-- at level 'clinician_review' (escalation_level 2). A hospital admission is
-- important context that should trigger a doctor to review the care plan; it is
-- NOT an active emergency and must not surface as a red Priority-1.
create or replace function private.handle_hospital_admission()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_alert_id uuid;
  v_dx_line  text := '';
begin
  if new.self_reported_diagnosis is not null
     and length(btrim(new.self_reported_diagnosis)) > 0 then
    -- Always framed as patient-reported — never presented as a clinical finding.
    v_dx_line := format(' Patient-reported reason: %s.', new.self_reported_diagnosis);
  end if;

  insert into public.clinician_alerts
    (organisation_id, patient_id, level, status, title, detail, escalation_level)
  values (
    new.organisation_id,
    new.patient_id,
    'clinician_review',
    'open',
    'Care plan review: patient reported a hospital admission',
    format('Patient logged a hospital admission dated %s.%s Review whether the care plan needs updating. (Self-reported by the patient — not a clinician diagnosis.)',
           new.admitted_on, v_dx_line),
    2
  )
  returning id into v_alert_id;

  new.clinician_alert_id := v_alert_id;

  insert into public.audit_log
    (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (
    new.organisation_id,
    new.patient_id,
    'hospital_admission.created',
    'patient_hospital_admissions',
    new.id,
    jsonb_build_object('admitted_on', new.admitted_on, 'clinician_alert_id', new.clinician_alert_id)
  );

  return new;
end;
$$;

drop trigger if exists patient_hospital_admissions_raise_alert
  on public.patient_hospital_admissions;
create trigger patient_hospital_admissions_raise_alert
  before insert on public.patient_hospital_admissions
  for each row execute function private.handle_hospital_admission();

-- ---------------------------------------------------------------------------
-- 4. BEFORE UPDATE guard: a patient session may only edit descriptive fields
-- ---------------------------------------------------------------------------
-- A patient can update their own admission (e.g. add the discharge date, tidy
-- the diagnosis) but must not be able to spoof staff/system-owned fields.
-- Service-role (auth.uid() null) and org staff bypass the guard — mirrors
-- private.enforce_emergency_event_update.
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
  return new;
end;
$$;

drop trigger if exists patient_hospital_admissions_update_guard
  on public.patient_hospital_admissions;
create trigger patient_hospital_admissions_update_guard
  before update on public.patient_hospital_admissions
  for each row execute function private.enforce_hospital_admission_update();
