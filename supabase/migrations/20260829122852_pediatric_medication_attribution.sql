-- Tarragon Health — a parent can log their child's medication (Child Health
-- Platform §48.10 gap-close)
--
-- A supporter managing a child dependent (profiles.is_dependent_account, no
-- login of their own) could already log the child's vitals and symptoms
-- (20260801110000's can_act_for extension) but not what they were actually
-- giving them. Same narrow shape: a supporter may ADD a self-reported
-- medication entry, attributed to themselves (logged_by_profile_id,
-- forge-proof, server-derived), and may never revise or remove one.
--
-- NOTE on reconciliation (2026-09-02): the branch's original migration would
-- have replaced medications_insert with a version that dropped the
-- private.has_prescribing_authority(organisation_id) gate on the org-staff
-- branch entirely, and restricted the self-report branch to source='patient'
-- only — which would have broken the existing patient-self-reports-a-
-- specialist-prescribed-medication path (source='specialist', live since
-- 20260716170000_medication_source_specialist.sql, predating this branch).
-- Both are corrected below: the staff branch keeps has_prescribing_authority,
-- and the self-report branch allows both 'patient' and 'specialist' sources,
-- exactly matching what was already possible before this migration — only
-- adding private.can_act_for(patient_id) as an additional way to qualify for
-- that branch.

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

-- Additive: alongside the patient's own self-report insert (source 'patient'
-- or 'specialist' — the two non-clinician-authored sources), a 'manage'
-- grantee may also self-report on the child's behalf. A supporter can never
-- label an entry as clinician-prescribed; the staff branch is unchanged
-- (still gated on private.has_prescribing_authority, per
-- 20260715181500_pharmacy_authority_by_tier.sql).
drop policy if exists medications_insert on public.medications;
create policy medications_insert on public.medications
  for insert to authenticated
  with check (
    (
      (patient_id = (select auth.uid()) or private.can_act_for(patient_id))
      and source in ('patient', 'specialist')
    )
    or (private.is_org_staff(organisation_id) and private.has_prescribing_authority(organisation_id))
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
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'medications'
      and policyname = 'medications_insert'
      and with_check::text like '%has_prescribing_authority%'
  ) then
    raise exception 'the org-staff branch of medications_insert must still require prescribing authority';
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
