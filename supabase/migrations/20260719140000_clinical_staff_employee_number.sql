-- Tarragon Health — human-readable employee number for clinical staff.
--
-- Every clinical_staff record (doctors, care coordinators, etc.) gets a stable
-- EMP-NNNNNN identifier so two employees who share a name and tier can be told
-- apart at a glance in the admin roster, on rotas, and in support/audit trails.
--
-- Mirrors the existing reference-number machinery in
-- 20260715003255_reference_numbers_specialist_catalogue_commission_rate_types.sql
-- (private.next_reference + a private sequence + a BEFORE INSERT trigger).
-- A clinical_staff row is fully formed at insert (no deferred-role complication
-- like profiles.patient_number), so this is the simpler INSERT-only variant.
--
-- The number is global (one platform-wide sequence), not per-organisation, so
-- it is unique across every tenant — the same guarantee patient_number gives.

create sequence if not exists private.clinical_staff_number_seq;

alter table public.clinical_staff
  add column if not exists employee_number text unique;

create or replace function private.assign_clinical_staff_number()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.employee_number is null then
    new.employee_number := private.next_reference('EMP-', 'private.clinical_staff_number_seq'::regclass);
  end if;
  return new;
end;
$$;

drop trigger if exists clinical_staff_assign_employee_number on public.clinical_staff;
create trigger clinical_staff_assign_employee_number
  before insert on public.clinical_staff
  for each row execute function private.assign_clinical_staff_number();

-- Backfill existing rows. nextval() is VOLATILE, so it is re-evaluated per row
-- inside a single UPDATE — each row receives a distinct sequential number (the
-- same guarantee the reference_numbers backfill relies on). Row-to-number
-- assignment order is not guaranteed, only distinctness.
update public.clinical_staff
  set employee_number = private.next_reference('EMP-', 'private.clinical_staff_number_seq'::regclass)
  where employee_number is null;
