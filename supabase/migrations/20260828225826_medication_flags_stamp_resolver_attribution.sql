-- Tarragon Health -- close a falsifiable-attribution gap on the two new
-- Pharmacy Engine tables (medication_affordability_reports.resolved_by,
-- medication_dispense_flags.reviewed_by): their UPDATE RLS policies only
-- check private.is_org_staff(organisation_id), not that the resolver/
-- reviewer id being written is the caller's own -- any org staff member
-- could otherwise write an arbitrary profiles/clinical_staff id into those
-- columns and have it displayed as if that person acted. Same class of gap
-- CLAUDE.md's ReviewedByDoctor rule and stamp_medication_added_by /
-- enforce_medication_confirm_only guard against elsewhere in this schema --
-- closed the same way: server-derive from auth.uid()/the caller's own
-- active clinical_staff row, never trust the client-supplied value.

create or replace function private.stamp_medication_affordability_report_resolved_by()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is distinct from old.status and new.status = 'resolved' then
    new.resolved_by := (select auth.uid());
    new.resolved_at := now();
  end if;
  return new;
end;
$$;

create trigger medication_affordability_reports_stamp_resolved_by
  before update on public.medication_affordability_reports
  for each row execute function private.stamp_medication_affordability_report_resolved_by();

create or replace function private.stamp_medication_dispense_flag_reviewed_by()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller_staff_id uuid;
begin
  if new.status is distinct from old.status and new.status in ('reviewed', 'resolved') then
    select id into v_caller_staff_id
    from public.clinical_staff
    where profile_id = (select auth.uid())
      and organisation_id = new.organisation_id
      and active;

    if v_caller_staff_id is null then
      raise exception 'Only an active clinical staff member can review or resolve a medication flag' using errcode = '42501';
    end if;

    new.reviewed_by := v_caller_staff_id;
    new.reviewed_at := now();
  end if;
  return new;
end;
$$;

create trigger medication_dispense_flags_stamp_reviewed_by
  before update on public.medication_dispense_flags
  for each row execute function private.stamp_medication_dispense_flag_reviewed_by();

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'medication_affordability_reports_stamp_resolved_by'
      and tgrelid = 'public.medication_affordability_reports'::regclass
  ) then
    raise exception 'FAIL: medication_affordability_reports_stamp_resolved_by trigger missing';
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgname = 'medication_dispense_flags_stamp_reviewed_by'
      and tgrelid = 'public.medication_dispense_flags'::regclass
  ) then
    raise exception 'FAIL: medication_dispense_flags_stamp_reviewed_by trigger missing';
  end if;
  raise notice 'PASS: resolver/reviewer attribution is now server-stamped on both tables';
end $$;
