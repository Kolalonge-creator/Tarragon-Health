-- Tarragon Health — extend the EMP-NNNNNN staff number to every staff
-- account that has no clinical_staff row: admin, pharmacist, lab_liaison,
-- lab_partner, analyst, finance, hmo_admin, corporate_admin. Those roles have
-- no clinical_staff record at all (that table is scoped to the clinician
-- doctor-tier ladder + care_coordinator, see clinical_staff_staff_number.sql
-- and CLAUDE.md's Clinical Tier Ladder section) so they had no personal
-- reference number anywhere on the platform.
--
-- Deliberately excludes 'patient' (gets TH- via patient_number instead) and
-- 'clinician'/'care_coordinator' (already carry their EMP- number on
-- clinical_staff.staff_number, tied to their clinical record) — this avoids
-- ever assigning the same person two different EMP numbers from two tables.
-- Shares the existing private.staff_number_seq (clinical_staff_staff_number.sql)
-- rather than a new sequence, so an EMP number is globally unique across
-- both tables, never just unique per-table.
--
-- Mirrors profiles.patient_number's own trigger shape exactly
-- (20260715003255_reference_numbers…): BEFORE INSERT OR UPDATE, guarded on
-- the column being null, because private.handle_new_user() always inserts
-- role='patient' first — the documented two-step staff-provisioning path
-- (createUser() defaults to 'patient', a later updateUserById({app_metadata})
-- becomes an UPDATE via private.sync_user_profile_from_metadata()) means role
-- can only become a staff role after the row already exists, so INSERT-only
-- would miss every staff account ever provisioned this way.

alter table public.profiles add column if not exists staff_number text unique;

create or replace function private.assign_profile_staff_number()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.staff_number is null
     and new.role not in ('patient', 'clinician', 'care_coordinator') then
    new.staff_number := private.next_reference('EMP-', 'private.staff_number_seq'::regclass);
  end if;
  return new;
end;
$$;

create trigger profiles_assign_staff_number
  before insert or update on public.profiles
  for each row execute function private.assign_profile_staff_number();

-- Backfill existing rows via a no-op self-update, so the trigger above does
-- the assigning rather than duplicating its logic here (same technique as
-- profiles.patient_number's own backfill).
update public.profiles
  set role = role
  where staff_number is null
    and role not in ('patient', 'clinician', 'care_coordinator');

-- Provable, not hopeful: every non-patient, non-clinical-tier profile now has
-- a staff_number, and no clinician/care_coordinator/patient was ever given
-- one via this path (they either have none, by design, or already carry one
-- from clinical_staff/patient_number and this trigger never touches it).
do $$
declare
  v_missing_count int;
  v_wrongly_assigned_count int;
begin
  select count(*) into v_missing_count
    from public.profiles
    where staff_number is null
      and role not in ('patient', 'clinician', 'care_coordinator');
  if v_missing_count > 0 then
    raise exception 'profiles_staff_number: % staff profile(s) still missing a staff_number', v_missing_count;
  end if;

  select count(*) into v_wrongly_assigned_count
    from public.profiles
    where staff_number is not null
      and role in ('patient', 'clinician', 'care_coordinator');
  if v_wrongly_assigned_count > 0 then
    raise exception 'profiles_staff_number: % patient/clinician/care_coordinator profile(s) wrongly given a profiles.staff_number', v_wrongly_assigned_count;
  end if;
end $$;
