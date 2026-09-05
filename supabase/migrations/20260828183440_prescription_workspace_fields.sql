-- Tarragon Health — prescription workspace: order-entry fields (5.10).
-- Committed to git but never actually applied to production. Content
-- byte-identical to the committed 20260827200208_prescription_workspace_fields.sql.

alter table public.medications
  add column if not exists route             text,
  add column if not exists duration_days     integer,
  add column if not exists quantity          text,
  add column if not exists repeats_allowed   integer not null default 0,
  add column if not exists indication        text,
  add column if not exists instructions      text;

alter table public.medications
  add constraint medications_route_length check (char_length(route) <= 100),
  add constraint medications_duration_days_positive check (duration_days is null or duration_days > 0),
  add constraint medications_quantity_length check (char_length(quantity) <= 100),
  add constraint medications_repeats_allowed_non_negative check (repeats_allowed >= 0),
  add constraint medications_indication_length check (char_length(indication) <= 300),
  add constraint medications_instructions_length check (char_length(instructions) <= 1000);

create or replace function private.stamp_medication_added_by()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.added_by := (select auth.uid());
  return new;
end;
$$;

drop trigger if exists medications_stamp_added_by on public.medications;
create trigger medications_stamp_added_by
  before insert on public.medications
  for each row execute function private.stamp_medication_added_by();

create or replace function private.enforce_medication_confirm_only()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller_staff_id uuid;
begin
  if new.patient_id = (select auth.uid()) then
    return new;
  end if;

  if private.has_prescribing_authority(new.organisation_id) then
    return new;
  end if;

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
    or old.route is distinct from new.route
    or old.duration_days is distinct from new.duration_days
    or old.quantity is distinct from new.quantity
    or old.repeats_allowed is distinct from new.repeats_allowed
    or old.indication is distinct from new.indication
    or old.instructions is distinct from new.instructions
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

do $$
declare
  v_def text;
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'medications' and column_name = 'route'
  ) then
    raise exception 'medications.route was not added';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'medications' and column_name = 'instructions'
  ) then
    raise exception 'medications.instructions was not added';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'medications' and column_name = 'repeats_allowed'
      and is_nullable = 'NO'
  ) then
    raise exception 'medications.repeats_allowed was not added as NOT NULL';
  end if;

  select pg_get_functiondef(oid) into v_def
  from pg_proc where proname = 'enforce_medication_confirm_only' and pronamespace = 'private'::regnamespace;

  if v_def not like '%old.route is distinct from new.route%'
     or v_def not like '%old.instructions is distinct from new.instructions%' then
    raise exception 'enforce_medication_confirm_only is missing the new-column guard';
  end if;
  if v_def not like '%Confirming a prescription can only update the refill date%'
     or v_def not like '%Only an existing clinician-prescribed medication can be confirmed and continued%'
     or v_def not like '%private.has_prescribing_authority(new.organisation_id)%' then
    raise exception 'enforce_medication_confirm_only lost a pre-existing branch';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgname = 'medications_stamp_added_by' and tgrelid = 'public.medications'::regclass
  ) then
    raise exception 'medications_stamp_added_by trigger was not created';
  end if;
end $$;
