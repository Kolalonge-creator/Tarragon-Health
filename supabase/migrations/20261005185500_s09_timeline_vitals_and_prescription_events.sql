-- S09: add vitals_recorded and prescription_signed timeline event types
-- and the AFTER triggers that write them.
--
-- Gap: the patient_timeline has 28 event types but no vitals or prescription
-- signing events. A patient logging a BP reading or having a prescription
-- signed are important milestones. Closes spec 2.1 (timeline completeness).

-- 1. Extend the enum --------------------------------------------------------
alter type public.timeline_event_type add value if not exists 'vitals_recorded';
alter type public.timeline_event_type add value if not exists 'prescription_signed';

-- NOTE: ALTER TYPE ... ADD VALUE cannot run inside a transaction on Postgres <14,
-- but Supabase (PG15+) allows it. The values are immediately usable below.

-- 2. Trigger: vitals_readings → vitals_recorded -----------------------------
create or replace function private.timeline_from_vitals_reading()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_title text;
  v_source_label text;
begin
  v_title := case new.vital_type::text
    when 'blood_pressure' then 'Blood pressure recorded'
    when 'glucose'        then 'Glucose recorded'
    when 'weight'         then 'Weight recorded'
    when 'pulse'          then 'Pulse recorded'
    when 'temperature'    then 'Temperature recorded'
    when 'spo2'           then 'SpO2 recorded'
    when 'waist_circumference' then 'Waist circumference recorded'
    when 'ketones'        then 'Ketones recorded'
    when 'respiratory_rate' then 'Respiratory rate recorded'
    when 'peak_flow'      then 'Peak flow recorded'
    else initcap(replace(new.vital_type::text, '_', ' ')) || ' recorded'
  end;

  v_source_label := case new.source::text
    when 'manual'   then 'Manual'
    when 'device'   then 'Device'
    when 'wearable' then 'Wearable'
    when 'cgm'      then 'CGM'
    when 'fhir_import' then 'FHIR import'
    else new.source::text
  end;

  perform private.record_timeline_event(
    new.organisation_id,
    new.patient_id,
    'vitals_recorded'::public.timeline_event_type,
    'vitals_readings',
    new.id,
    v_title,
    v_source_label,
    coalesce(new.taken_at, new.created_at),
    null,
    jsonb_build_object(
      'vital_type', new.vital_type::text,
      'source', new.source::text
    )
  );

  return new;
end;
$$;

drop trigger if exists vitals_readings_timeline_insert on public.vitals_readings;
create trigger vitals_readings_timeline_insert
  after insert on public.vitals_readings
  for each row execute function private.timeline_from_vitals_reading();

-- 3. Trigger: prescriptions signed_at transition → prescription_signed ------
create or replace function private.timeline_from_prescription_signed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_drug_names text;
begin
  -- Only fire when signed_at transitions from null to non-null
  if new.signed_at is null or old.signed_at is not null then
    return new;
  end if;

  -- Extract drug names from the items JSONB array
  v_drug_names := coalesce(
    (select string_agg(item->>'drug_name', ', ' order by ordinality)
     from jsonb_array_elements(new.items) with ordinality as t(item, ordinality)
     where item->>'drug_name' is not null),
    'Prescription'
  );

  perform private.record_timeline_event(
    new.organisation_id,
    new.patient_id,
    'prescription_signed'::public.timeline_event_type,
    'prescriptions',
    new.id,
    'Prescription signed',
    v_drug_names,
    new.signed_at,
    (select cs.id from public.clinical_staff cs where cs.profile_id = new.signed_by limit 1),
    jsonb_build_object(
      'state', new.state::text,
      'collection_code', new.collection_code
    )
  );

  return new;
end;
$$;

drop trigger if exists prescriptions_timeline_signed on public.prescriptions;
create trigger prescriptions_timeline_signed
  after update of signed_at on public.prescriptions
  for each row execute function private.timeline_from_prescription_signed();

-- 4. Revoke anon execute on the new functions (standard pattern) ------------
revoke all on function private.timeline_from_vitals_reading() from public;
revoke all on function private.timeline_from_prescription_signed() from public;

-- 5. Self-check: both enum values exist and triggers are attached -----------
do $$
begin
  if not exists (
    select 1 from pg_enum
    where enumtypid = 'public.timeline_event_type'::regtype
      and enumlabel = 'vitals_recorded'
  ) then
    raise exception 'vitals_recorded enum value missing';
  end if;

  if not exists (
    select 1 from pg_enum
    where enumtypid = 'public.timeline_event_type'::regtype
      and enumlabel = 'prescription_signed'
  ) then
    raise exception 'prescription_signed enum value missing';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgname = 'vitals_readings_timeline_insert'
      and tgrelid = 'public.vitals_readings'::regclass
  ) then
    raise exception 'vitals_readings_timeline_insert trigger missing';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgname = 'prescriptions_timeline_signed'
      and tgrelid = 'public.prescriptions'::regclass
  ) then
    raise exception 'prescriptions_timeline_signed trigger missing';
  end if;
end
$$;
