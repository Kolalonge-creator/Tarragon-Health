-- Tarragon Health -- the resolver/reviewer attribution stamp from
-- 20260828225826_medication_flags_stamp_resolver_attribution.sql only fired
-- BEFORE UPDATE, so a direct INSERT with status already set to
-- 'resolved'/'reviewed' bypassed it entirely: the insert policies only check
-- patient_id = auth.uid() OR is_org_staff(organisation_id), nothing stops
-- either from inserting a row pre-populated with a spoofed resolved_by/
-- reviewed_by that would then satisfy the *_resolution_documented CHECK
-- constraint unexamined. Both triggers now also fire on INSERT.

create or replace function private.stamp_medication_affordability_report_resolved_by()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'resolved' and (tg_op = 'INSERT' or new.status is distinct from old.status) then
    new.resolved_by := (select auth.uid());
    new.resolved_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists medication_affordability_reports_stamp_resolved_by
  on public.medication_affordability_reports;
create trigger medication_affordability_reports_stamp_resolved_by
  before insert or update on public.medication_affordability_reports
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
  if new.status in ('reviewed', 'resolved') and (tg_op = 'INSERT' or new.status is distinct from old.status) then
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

drop trigger if exists medication_dispense_flags_stamp_reviewed_by
  on public.medication_dispense_flags;
create trigger medication_dispense_flags_stamp_reviewed_by
  before insert or update on public.medication_dispense_flags
  for each row execute function private.stamp_medication_dispense_flag_reviewed_by();

do $$
declare
  v_def text;
begin
  select pg_get_functiondef(oid) into v_def
  from pg_proc where proname = 'stamp_medication_affordability_report_resolved_by' and pronamespace = 'private'::regnamespace;
  if v_def not like '%tg_op = ''INSERT''%' then
    raise exception 'FAIL: affordability stamp trigger still UPDATE-only';
  end if;

  select pg_get_functiondef(oid) into v_def
  from pg_proc where proname = 'stamp_medication_dispense_flag_reviewed_by' and pronamespace = 'private'::regnamespace;
  if v_def not like '%tg_op = ''INSERT''%' then
    raise exception 'FAIL: dispense flag stamp trigger still UPDATE-only';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgname = 'medication_affordability_reports_stamp_resolved_by'
      and tgrelid = 'public.medication_affordability_reports'::regclass
      and tgtype & 4 = 4  -- INSERT bit set
  ) then
    raise exception 'FAIL: affordability trigger not firing on INSERT';
  end if;
  raise notice 'PASS: both stamp triggers now also fire on INSERT';
end $$;
