-- Tarragon Health — staff_number: a short, human-readable employee number on
-- every clinical_staff record so employees who share a name AND role/tier can
-- be told apart in staff-facing lists and attribution. Distinct from the MDCN
-- /NMCN credential number (which not every employee has — e.g. Care
-- Coordinators, bio-only Directors); this is an internal Tarragon staff ID.
--
-- Mirrors the existing reference-number pattern
-- (20260715003255_reference_numbers…): a private sequence + the shared
-- private.next_reference() generator + a BEFORE INSERT trigger, backfilled for
-- rows that predate it.

create sequence if not exists private.staff_number_seq;

alter table public.clinical_staff add column if not exists staff_number text unique;

create or replace function private.assign_staff_number()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.staff_number is null then
    new.staff_number := private.next_reference('EMP-', 'private.staff_number_seq'::regclass);
  end if;
  return new;
end;
$$;

drop trigger if exists clinical_staff_assign_staff_number on public.clinical_staff;
create trigger clinical_staff_assign_staff_number
  before insert on public.clinical_staff
  for each row execute function private.assign_staff_number();

-- Backfill existing records. nextval() is volatile and re-evaluated per row,
-- so each gets its own sequential number rather than one value copied across.
update public.clinical_staff
  set staff_number = private.next_reference('EMP-', 'private.staff_number_seq'::regclass)
  where staff_number is null;
