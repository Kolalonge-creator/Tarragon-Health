-- Tarragon Health — 12-week two-track chronic-care programme, Phase 2 (booking + titration)
--
-- Pooled doctor-checkin slot search. get_available_appointment_slots()
-- (built 2026-08-28) already defaults p_clinician_id to null, i.e. pooled
-- search across every clinician with matching availability is already the
-- primitive — wrapped here, not modified, since it's a shared function
-- other callers depend on. Reuses appointment_type='follow_up' +
-- consultation_method='telemedicine' (both already exist) — no new enum
-- value needed. Excludes care_coordinator BY NAME per the codebase's own
-- documented gotcha (doctor_tier is not null would wrongly admit it, since
-- care_coordinator is itself a non-null doctor_tier value).
create or replace function public.get_available_doctor_checkin_slots(
  p_organisation_id uuid,
  p_from date default current_date,
  p_to date default current_date + 13
)
returns table (
  clinician_id uuid,
  clinician_name text,
  slot_start timestamptz,
  slot_end timestamptz,
  location text
)
language sql
stable
security definer
set search_path = ''
as $$
  select s.clinician_id, s.clinician_name, s.slot_start, s.slot_end, s.location
  from public.get_available_appointment_slots(
    p_organisation_id, 'follow_up'::public.appointment_type,
    'telemedicine'::public.appointment_consultation_method, null, p_from, p_to
  ) s
  join public.clinical_staff cs
    on cs.profile_id = s.clinician_id
   and cs.organisation_id = p_organisation_id
   and cs.active
  where cs.doctor_tier is not null
    and cs.doctor_tier <> 'care_coordinator';
$$;

revoke execute on function public.get_available_doctor_checkin_slots(uuid, date, date) from public;
grant execute on function public.get_available_doctor_checkin_slots(uuid, date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- Titration history — exact template copied from
-- private.snapshot_care_plan_version() (20260827205255_care_plan_management.sql),
-- the codebase's own "the generic column-names-only audit trigger can't
-- answer what this looked like before" pattern, applied to medications
-- instead of care_plans.
-- ---------------------------------------------------------------------------

create table public.medication_dose_history (
  id                                uuid primary key default gen_random_uuid(),
  organisation_id                   uuid not null references public.organisations (id) on delete restrict,
  medication_id                     uuid not null references public.medications (id) on delete cascade,
  patient_id                        uuid not null references public.profiles (id) on delete cascade,
  version_number                    integer not null,
  snapshot                          jsonb not null,
  changed_by                        uuid references public.clinical_staff (id) on delete set null,
  changed_reason                    text,
  chronic_programme_occurrence_id   uuid references public.chronic_programme_schedule_occurrences (id) on delete set null,
  created_at                        timestamptz not null default now(),
  unique (medication_id, version_number)
);

create index medication_dose_history_medication_idx
  on public.medication_dose_history (medication_id, version_number desc);
create index medication_dose_history_patient_idx
  on public.medication_dose_history (patient_id);

-- Snapshots the OLD row before a real (non-no-op) change to the
-- dose/frequency/route/etc columns that actually describe "what was
-- prescribed" — updated_at-only touches don't count, same suppression as
-- private.snapshot_care_plan_version.
create or replace function private.snapshot_medication_dose_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_changed boolean;
  v_next    integer;
  v_staff_id uuid;
begin
  v_changed := (
    to_jsonb(new) - 'updated_at' - 'last_confirmed_at' - 'last_confirmed_by'
  ) is distinct from (
    to_jsonb(old) - 'updated_at' - 'last_confirmed_at' - 'last_confirmed_by'
  );
  if not v_changed then
    return new;
  end if;

  select coalesce(max(version_number), 0) + 1 into v_next
  from public.medication_dose_history where medication_id = old.id;

  select id into v_staff_id
  from public.clinical_staff
  where profile_id = (select auth.uid())
    and organisation_id = old.organisation_id
    and active;

  insert into public.medication_dose_history
    (organisation_id, medication_id, patient_id, version_number, snapshot, changed_by)
  values (old.organisation_id, old.id, old.patient_id, v_next, to_jsonb(old), v_staff_id);

  return new;
end;
$$;

drop trigger if exists medications_snapshot_dose_version on public.medications;
create trigger medications_snapshot_dose_version
  before update on public.medications
  for each row execute function private.snapshot_medication_dose_version();

alter table public.medication_dose_history enable row level security;

-- Staff-read-only, trigger-only-write — same shape as care_plan_versions.
-- Care Coordinator gets the same is_org_staff read as any staff role but is
-- structurally excluded from ever appearing as changed_by (they lack
-- prescribing authority, so they can never be the one whose UPDATE on
-- medications fires this trigger in the first place).
create policy medication_dose_history_select on public.medication_dose_history
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
  );

grant select on public.medication_dose_history to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.get_available_doctor_checkin_slots(uuid,date,date)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute get_available_doctor_checkin_slots';
  end if;
  if has_table_privilege('anon', 'public.medication_dose_history', 'INSERT') then
    raise exception 'FAIL: anon must not be able to write medication_dose_history';
  end if;
  -- Table-level grants are not the right check here: this project's default
  -- privileges grant full CRUD to authenticated on every new table (see
  -- reference_authenticated_table_grants_root_cause), so
  -- has_table_privilege(...,'INSERT') would read true regardless. The real
  -- enforcement is RLS having no INSERT/UPDATE/DELETE policy at all for this
  -- table — with RLS enabled, a role with a plain GRANT but no matching
  -- policy is still denied, verified directly here rather than trusted.
  if exists (
    select 1 from pg_policy
    where polrelid = 'public.medication_dose_history'::regclass and polcmd <> 'r'
  ) then
    raise exception 'FAIL: medication_dose_history must be trigger-only-write, not client-insertable';
  end if;
  raise notice 'PASS: pooled doctor-checkin booking wrapper + titration history in place';
end $$;
