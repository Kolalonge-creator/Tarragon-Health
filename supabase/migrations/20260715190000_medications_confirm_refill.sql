-- Tarragon Health
-- Tier 1 confirm/continue-refill workflow — docs/Tarragon_Health_Master_Operating_Plan_v4.md
-- §4/§8: Tier 1 has no new-prescribing authority (private.has_prescribing_authority,
-- 20260715181500_pharmacy_authority_by_tier.sql), but the ladder's other
-- half of Tier 1's job — confirming and continuing an existing stable,
-- clinician-prescribed medication (extending the refill date, marking it
-- reviewed) — had no built path at all. This adds it, scoped as narrowly
-- as the tier ladder allows: refill-date + confirmation stamp only, never
-- drug/dose/frequency/active-status, which stay Tier 2+/Director acts.
--
-- Same structural-gate pattern as has_prescribing_authority/
-- enforce_pharmacy_order_origin: RLS decides *who* may attempt an update,
-- a BEFORE UPDATE trigger decides *which columns* they may actually change
-- once RLS has let them through. last_confirmed_by is never client-supplied
-- — the trigger derives it from the caller's own active clinical_staff row,
-- so it can't be spoofed, mirroring how ordered_by/reviewed_by are never
-- trusted from client input elsewhere in this schema.

alter table public.medications
  add column last_confirmed_at timestamptz,
  add column last_confirmed_by uuid references public.clinical_staff (id) on delete set null;

create index medications_last_confirmed_by_idx
  on public.medications (last_confirmed_by) where last_confirmed_by is not null;

create or replace function private.can_confirm_medication_refill(org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.clinical_staff
    where profile_id = (select auth.uid())
      and organisation_id = org
      and active
      and doctor_tier = 'tier_1'
  );
$$;

-- Broaden the coarse "who can attempt this" gate to also admit Tier 1 via
-- can_confirm_medication_refill. medications_insert is untouched — Tier 1
-- still cannot create a new medications row, full stop.
drop policy if exists medications_update on public.medications;
create policy medications_update on public.medications
  for update to authenticated
  using (
    patient_id = (select auth.uid())
    or (
      private.is_org_staff(organisation_id)
      and (
        private.has_prescribing_authority(organisation_id)
        or private.can_confirm_medication_refill(organisation_id)
      )
    )
  )
  with check (
    patient_id = (select auth.uid())
    or (
      private.is_org_staff(organisation_id)
      and (
        private.has_prescribing_authority(organisation_id)
        or private.can_confirm_medication_refill(organisation_id)
      )
    )
  );

create or replace function private.enforce_medication_confirm_only()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller_staff_id uuid;
begin
  -- Patient editing their own row: unrestricted, unchanged from prior behavior.
  if new.patient_id = (select auth.uid()) then
    return new;
  end if;

  -- Full prescribing authority (Tier 2+/Director): unrestricted, unchanged from prior behavior.
  if private.has_prescribing_authority(new.organisation_id) then
    return new;
  end if;

  -- Anyone else reaching this trigger passed medications_update's USING
  -- clause only via can_confirm_medication_refill — an active Tier 1
  -- doctor confirming/continuing an existing prescription. Restrict to
  -- refill confirmation: no drug, dose, frequency, schedule, active-status,
  -- or ownership changes.
  if old.source is distinct from 'clinician' then
    raise exception 'Only an existing clinician-prescribed medication can be confirmed and continued' using errcode = '42501';
  end if;

  if old.drug_name is distinct from new.drug_name
    or old.dose is distinct from new.dose
    or old.frequency is distinct from new.frequency
    or old.schedule_times is distinct from new.schedule_times
    or old.is_active is distinct from new.is_active
    or old.care_plan_id is distinct from new.care_plan_id
    or old.source is distinct from new.source
    or old.added_by is distinct from new.added_by
    or old.patient_id is distinct from new.patient_id
    or old.organisation_id is distinct from new.organisation_id
  then
    raise exception 'Confirming a prescription can only update the refill date — changing drug, dose, frequency, or status needs Tier 2 or above' using errcode = '42501';
  end if;

  select id into v_caller_staff_id
  from public.clinical_staff
  where profile_id = (select auth.uid())
    and organisation_id = new.organisation_id
    and active;

  new.last_confirmed_at := now();
  new.last_confirmed_by := v_caller_staff_id;

  return new;
end;
$$;

create trigger medications_enforce_confirm_only
  before update on public.medications
  for each row execute function private.enforce_medication_confirm_only();
