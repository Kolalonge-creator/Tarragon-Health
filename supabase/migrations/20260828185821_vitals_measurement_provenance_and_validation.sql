-- Tarragon Health — Monitoring Engine: measurement provenance & validation
-- (spec §6.5/§6.6/§6.7)
--
-- Today a vitals_readings row already carries value/unit/timestamp/source/
-- device/patient-vs-automatic (20260713210000_patient_devices_and_vitals_
-- source.sql and friends), but two things the spec calls for are missing:
--
--  1. Measurement CONTEXT for blood pressure — position (seated/standing/
--     lying) and arm (left/right) genuinely change a BP reading and a
--     clinician reviewing a borderline value has no way to judge technique
--     without them. "Method" (spec §6.7) is deliberately NOT a new column —
--     it's already fully derivable from source + device_id (device_id joins
--     to patient_devices.device_type), so a parallel free-text field would
--     just be a second, driftable copy of the same fact.
--
--  2. VALIDATION STATUS — nothing today marks a reading as suspicious. The
--     spec is explicit that the system "should not simply discard
--     questionable information. It should mark: Requires validation."
--     validation_status/validation_flags do exactly that, set by a BEFORE
--     INSERT trigger so every insert path (manual app/web, BLE device sync,
--     any future path) gets the same check — same reasoning as the red-flag
--     triggers on this table. Deliberately NOT a rejecting check: a real
--     hypertensive-crisis or hypo reading must still reach the row untouched
--     so the existing red-flag triggers fire on it; this only asks a human
--     to take a second look, it never blocks a save.
--
-- Three checks, all things ONLY the database can see (a Zod schema can't
-- query prior rows), which is why this is a DB trigger rather than more
-- client-side plausibility.ts logic:
--   - duplicate_entry: an identical reading for this patient+vital_type
--     within a 2-minute window (double-tap submit, or a device resync that
--     slipped past the id-based dedupe index).
--   - sudden_change: this reading vs. the average of the patient's own last
--     up to 5 CONFIRMED readings of the same vital_type — deliberately a
--     wider band than any clinical red-flag threshold and requires at least
--     3 prior readings before it fires at all (a new patient's first few
--     readings are not a "sudden change" from nothing).
--   - insufficient_context: a BP reading with neither position nor arm on
--     file.
--
-- Plain (non-SECURITY DEFINER) trigger: it only reads vitals_readings (the
-- inserting session already has SELECT on its own rows under the existing
-- patient_id = auth.uid() / is_org_staff policy) and mutates NEW — no
-- privilege beyond the inserting role is needed, unlike the red-flag
-- triggers which write to clinician_alerts/emergency_events.

create type public.vitals_validation_status as enum ('valid', 'requires_validation');

alter table public.vitals_readings
  add column if not exists position           text,
  add column if not exists arm                 text,
  add column if not exists validation_status   public.vitals_validation_status not null default 'valid',
  add column if not exists validation_flags    text[] not null default '{}',
  add column if not exists validated_by        uuid references public.clinical_staff (id) on delete set null,
  add column if not exists validated_at        timestamptz;

alter table public.vitals_readings
  add constraint vitals_readings_position_check check (position is null or position in ('seated', 'standing', 'lying')),
  add constraint vitals_readings_arm_check check (arm is null or arm in ('left', 'right'));

comment on column public.vitals_readings.position is
  'Patient position when a blood_pressure reading was taken (seated/standing/lying). Null for other vital_types.';
comment on column public.vitals_readings.arm is
  'Arm a blood_pressure cuff was applied to (left/right). Null for other vital_types.';
comment on column public.vitals_readings.validation_status is
  'valid (default) or requires_validation — set by private.flag_vitals_requiring_validation() at insert. '
  'Never blocks a save; a flagged reading still reaches the record and its own red-flag trigger fires normally.';
comment on column public.vitals_readings.validation_flags is
  'Why validation_status = requires_validation: any of duplicate_entry / sudden_change / insufficient_context.';
comment on column public.vitals_readings.validated_by is
  'Clinician who reviewed and cleared a requires_validation flag via public.clear_vitals_validation_flag(). Null until reviewed.';

create index if not exists vitals_readings_requires_validation_idx
  on public.vitals_readings (organisation_id, taken_at desc)
  where validation_status = 'requires_validation';

-- ---------------------------------------------------------------------------
-- The flagging trigger
-- ---------------------------------------------------------------------------

create or replace function private.flag_vitals_requiring_validation()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_new_value      numeric;
  v_is_duplicate   boolean := false;
  v_avg            numeric;
  v_history_count  integer;
  v_threshold      numeric;
  v_flags          text[] := '{}';
begin
  v_new_value := case new.vital_type
    when 'blood_pressure' then new.systolic
    when 'glucose' then new.glucose_mmol_l
    when 'weight' then new.weight_kg
    when 'pulse' then new.pulse_bpm
    when 'temperature' then new.temperature_c
    when 'spo2' then new.spo2_pct
    when 'waist_circumference' then new.waist_cm
    else null
  end;

  if v_new_value is not null and new.taken_at is not null then
    select exists (
      select 1
      from public.vitals_readings vr
      where vr.patient_id = new.patient_id
        and vr.vital_type = new.vital_type
        and vr.taken_at between new.taken_at - interval '2 minutes' and new.taken_at + interval '2 minutes'
        and (case new.vital_type
              when 'blood_pressure' then vr.systolic = new.systolic and vr.diastolic = new.diastolic
              when 'glucose' then vr.glucose_mmol_l = new.glucose_mmol_l
              when 'weight' then vr.weight_kg = new.weight_kg
              when 'pulse' then vr.pulse_bpm = new.pulse_bpm
              when 'temperature' then vr.temperature_c = new.temperature_c
              when 'spo2' then vr.spo2_pct = new.spo2_pct
              when 'waist_circumference' then vr.waist_cm = new.waist_cm
              else false
            end)
    ) into v_is_duplicate;

    if v_is_duplicate then
      v_flags := array_append(v_flags, 'duplicate_entry');
    end if;

    select avg(hist.hist_value), count(*)
      into v_avg, v_history_count
    from (
      select (case new.vital_type
                when 'blood_pressure' then vr.systolic
                when 'glucose' then vr.glucose_mmol_l
                when 'weight' then vr.weight_kg
                when 'pulse' then vr.pulse_bpm
                when 'temperature' then vr.temperature_c
                when 'spo2' then vr.spo2_pct
                when 'waist_circumference' then vr.waist_cm
              end)::numeric as hist_value
      from public.vitals_readings vr
      where vr.patient_id = new.patient_id
        and vr.vital_type = new.vital_type
        and vr.validation_status = 'valid'
        and vr.taken_at < new.taken_at
      order by vr.taken_at desc
      limit 5
    ) hist
    where hist.hist_value is not null;

    if coalesce(v_history_count, 0) >= 3 then
      v_threshold := case new.vital_type
        when 'blood_pressure' then 40
        when 'glucose' then 5
        when 'weight' then 8
        when 'pulse' then 35
        when 'temperature' then 1.5
        when 'spo2' then 6
        when 'waist_circumference' then 10
        else null
      end;
      if v_threshold is not null and abs(v_new_value - v_avg) > v_threshold then
        v_flags := array_append(v_flags, 'sudden_change');
      end if;
    end if;
  end if;

  if new.vital_type = 'blood_pressure' and new.position is null and new.arm is null then
    v_flags := array_append(v_flags, 'insufficient_context');
  end if;

  if array_length(v_flags, 1) > 0 then
    new.validation_status := 'requires_validation';
    new.validation_flags := v_flags;
  end if;

  return new;
end;
$$;

drop trigger if exists vitals_readings_flag_validation on public.vitals_readings;
create trigger vitals_readings_flag_validation
  before insert on public.vitals_readings
  for each row
  execute function private.flag_vitals_requiring_validation();

-- ---------------------------------------------------------------------------
-- Clinician review: clear a flag once a human has looked at the reading.
-- A dedicated SECURITY DEFINER RPC rather than a raw table UPDATE grant, so
-- the only thing an org-staff caller can ever change through this path is
-- exactly these three columns — never the reading's actual clinical values.
-- ---------------------------------------------------------------------------

create or replace function public.clear_vitals_validation_flag(p_reading_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  select organisation_id into v_org from public.vitals_readings where id = p_reading_id;
  if v_org is null then
    raise exception 'Reading not found' using errcode = 'no_data_found';
  end if;
  if not private.is_org_staff(v_org) then
    raise exception 'Not authorised to review this reading' using errcode = 'insufficient_privilege';
  end if;

  update public.vitals_readings
    set validation_status = 'valid',
        validated_by = (select id from public.clinical_staff where profile_id = (select auth.uid())),
        validated_at = now()
  where id = p_reading_id;
end;
$$;

grant execute on function public.clear_vitals_validation_flag(uuid) to authenticated;
revoke execute on function public.clear_vitals_validation_flag(uuid) from public;

-- ---------------------------------------------------------------------------
-- Assertions
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'vitals_readings' and column_name = 'validation_status'
  ) then
    raise exception 'FAIL: vitals_readings.validation_status was not added';
  end if;
  if not exists (
    select 1 from pg_trigger where tgname = 'vitals_readings_flag_validation'
  ) then
    raise exception 'FAIL: vitals_readings_flag_validation trigger was not installed';
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'clear_vitals_validation_flag'
  ) then
    raise exception 'FAIL: public.clear_vitals_validation_flag() was not installed';
  end if;

  raise notice 'PASS: vitals measurement provenance & validation installed';
end $$;
