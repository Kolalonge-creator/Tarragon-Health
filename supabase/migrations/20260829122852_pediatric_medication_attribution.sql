-- Tarragon Health — a parent can log their child's medication (Child Health
-- Platform §48.10 gap-close)
--
-- Confirmed gap: 20260706024722_medication_schedule_refills.sql let a patient
-- self-report a medication (source = 'patient'), but 20260801110000's
-- can_act_for extension only reached vitals_readings and symptoms — a parent
-- managing a child dependent (profiles.is_dependent_account, no login of
-- their own) could log the child's vitals and symptoms but not what they were
-- actually giving them. Same narrow shape as that migration: a supporter may
-- ADD a self-reported medication entry, attributed to themselves
-- (logged_by_profile_id, forge-proof, server-derived), and may never revise
-- or remove one — correcting a medication record is a conversation with the
-- care team, not a quiet edit.

alter table public.medications
  add column if not exists logged_by_profile_id uuid references public.profiles (id);

comment on column public.medications.logged_by_profile_id is
  'Who physically entered this self-reported medication, when that is not the patient (a parent logging for a child dependent). NULL = the patient themselves, or a clinician/staff-authored row. Server-derived from auth.uid(), never client-supplied.';

create or replace function private.stamp_acting_supporter_medications()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.patient_id is distinct from (select auth.uid()) then
    new.logged_by_profile_id := (select auth.uid());
  else
    new.logged_by_profile_id := null;
  end if;
  return new;
end;
$$;

drop trigger if exists stamp_acting_supporter on public.medications;
create trigger stamp_acting_supporter
  before insert on public.medications
  for each row execute function private.stamp_acting_supporter_medications();

-- Additive: alongside the patient's own self-report insert, a 'manage'
-- grantee may also self-report (source = 'patient' only — a supporter can
-- never label an entry as clinician-prescribed, same as the patient's own
-- self-report path).
drop policy if exists medications_insert on public.medications;
create policy medications_insert on public.medications
  for insert to authenticated
  with check (
    (
      (patient_id = (select auth.uid()) or private.can_act_for(patient_id))
      and source = 'patient'
    )
    or private.is_org_staff(organisation_id)
  );

-- Deliberately NO change to medications_update/medications_delete: a
-- supporter's write access here is insert-only, exactly like vitals/symptoms.

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'medications'
      and policyname = 'medications_insert'
      and with_check::text like '%can_act_for%'
  ) then
    raise exception 'a parent/guardian must be able to self-report a medication for a child they manage';
  end if;
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'medications'
      and cmd in ('UPDATE', 'DELETE')
      and (qual::text like '%can_act_for%' or with_check::text like '%can_act_for%')
  ) then
    raise exception 'a supporter must never be able to revise or delete a medication record';
  end if;
end $$;
