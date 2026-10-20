-- S07y: where a blood pressure (or diary) reading came from. Two provenance labels on the ordinary reading table, three go-live guards born OFF, and the
-- registration of the diary-reading assistant (AI-021, registered DISABLED).
--
--   pharmacy_machine  "taken at a pharmacy or clinic machine": a real cuff reading that is NOT a home reading.
--   paper_diary       a reading the person copied from their own handwritten diary, confirmed by them row by row.
--
-- WHY A COLUMN AND NOT A NEW vital_source VALUE (read from the live database on 2026-10-20, and the same conclusion the assisted-entry build reached on 2026-10-16):
-- vitals_readings carries 28 triggers and 19 reading functions that key on source. A new enum value would fall outside every one of them without an error:
-- r2_glucose_triage_wiring fires only for source in ('manual','device') (a diary glucose would SKIP glucose triage), stamp_manual_vitals_timestamp clamps
-- taken_at only for 'manual' (a new value would allow backdating), the source lock is deny-by-default and the dedupe class is null. So these readings stay
-- source = 'manual' and every existing safety trigger fires for them exactly as for a typed reading. The label is a separate, frozen column.
--
-- WHAT THIS CHANGES
--   1. vitals_readings.entry_origin and place_label (both nullable, no default, no backfill: 468 rows at writing, all keep their meaning; null = an ordinary reading).
--      Added to the frozen-column list of a_clinical_value_supersession, so a person cannot relabel a reading after the fact (laundering a pharmacy reading into a
--      home reading would change every home average). A correction is a supersede, as for every other recorded value.
--   2. private.stamp_manual_vitals_timestamp(): a labelled reading is refused unless its guard is open for the person (test accounts pass, as everywhere);
--      a pharmacy reading keeps the ordinary bounded window (72 hours, then server time); a diary reading keeps the person's stated time inside a LONGER bounded window
--      (offline_sync_config.diary_window_days, PROPOSED 30) and is REFUSED outside it (never silently stamped as "now": an old value dated today would look like a
--      live reading). time_basis = 'diary_stated' says so. The no-backdating rule is bounded, not removed (S06-1). A CORRECTION of an already-saved labelled reading
--      (public.correct_clinical_value re-inserts the row with its old time) keeps that time and needs no guard, so a labelled reading can still be corrected after
--      its window; a correction that CHANGES the time is judged by the ordinary rules again (found by the code review: it would otherwise have been refused or
--      re-stamped as now).
--   3. The 7-day home protocol (private.home_bp_assess) counts neither label. The home average and the window statistics (private.hbpm_average,
--      private.bp_window_stats) do not count a pharmacy reading. The white-coat / masked comparison reads home_bp_checks, which is built from home_bp_assess, so it
--      follows. The protocol (C1 to C3) is unsigned; whether a diary may ever count toward it is a CMO question (OQ-S07Y-3).
--   4. Both reading views gain the two columns at the END (nothing is renamed or reordered, security_invoker stays false as it was).
--   5. Guards pharmacy_bp_readings, paper_diary_entry, paper_diary_ai_reader: all OFF, CMO's switch. No conditions are defined, so none can be switched on until
--      conditions exist (the S43 reasoning: private.go_live_conditions is patched by many branches and is not restated here).
--   6. AI-021 "Paper diary reader" registered in ai_systems, disabled, not runtime-governed. It suggests values; the person confirms; no evaluation or approval is seeded.
--
-- NOT CHANGED, ON PURPOSE: every red-flag trigger (BP, pulse, glucose, SpO2, temperature) and the observation.recorded event. A dangerous diary or pharmacy
-- value fires them exactly as a live entry does (proof section R). Whether an OLD dangerous value should page is OQ-S07Y-4.

-- 1. the two columns ------------------------------------------------------------------------------------------------------------------
alter table public.vitals_readings
  add column if not exists entry_origin text,
  add column if not exists place_label text;

alter table public.vitals_readings
  add constraint vitals_readings_entry_origin_check
  check (entry_origin is null
         or (entry_origin = 'pharmacy_machine' and vital_type = 'blood_pressure')
         or (entry_origin = 'paper_diary' and vital_type in ('blood_pressure', 'glucose', 'pulse'))) not valid;
alter table public.vitals_readings
  add constraint vitals_readings_place_label_check
  check (place_label is null or (entry_origin = 'pharmacy_machine' and char_length(btrim(place_label)) between 1 and 80)) not valid;
alter table public.vitals_readings validate constraint vitals_readings_entry_origin_check;
alter table public.vitals_readings validate constraint vitals_readings_place_label_check;

comment on column public.vitals_readings.entry_origin is 'S07y: null = an ordinary reading. pharmacy_machine = taken at a pharmacy or clinic machine (not a home reading). paper_diary = copied from the person''s own handwritten diary and confirmed by them. Frozen after insert.';
comment on column public.vitals_readings.place_label is 'S07y: the place the person named for a pharmacy_machine reading (optional, 1 to 80 characters). Never used for any decision.';

-- the provenance is frozen like the value: same trigger, same function, two more columns
drop trigger if exists a_clinical_value_supersession on public.vitals_readings;
create trigger a_clinical_value_supersession
  before insert or delete or update on public.vitals_readings
  for each row execute function private.enforce_clinical_value_supersession(
    'organisation_id,patient_id,source,vital_type,systolic,diastolic,glucose_mmol_l,glucose_context,weight_kg,pulse_bpm,temperature_c,spo2_pct,taken_at,waist_cm,ketones_mmol_l,ketone_urine,respiratory_rate_bpm,peak_flow_l_min,value_numeric,value_unit,position,arm,cuff_type,entry_origin,place_label');

-- the time rules: a new, versioned, PROPOSED value on the existing offline configuration row
alter table public.vitals_readings drop constraint if exists vitals_readings_time_basis_check;
alter table public.vitals_readings
  add constraint vitals_readings_time_basis_check check (time_basis is null or time_basis in ('server', 'client_bounded', 'diary_stated')) not valid;
alter table public.vitals_readings validate constraint vitals_readings_time_basis_check;

alter table public.offline_sync_config
  add column if not exists diary_window_days integer not null default 30 check (diary_window_days between 1 and 90);
comment on column public.offline_sync_config.diary_window_days is 'S07y PROPOSED: how many days back a paper-diary reading may be dated. Outside it the reading is refused, never silently stamped as now. Mirrored in the proposed-config registry as vitals.diary_import.';

-- 2. the guards (all born OFF) ----------------------------------------------------------------------------------------------------------
insert into public.go_live_guards (key, label, blocks, condition_text, switch_role, enforced_in, not_enforced_in) values
  ('pharmacy_bp_readings', 'Blood pressure taken at a pharmacy or clinic machine',
   'Saving a reading labelled "taken at a pharmacy or clinic machine" (the label itself; the reading is stored as an ordinary one)',
   'The Chief Medical Officer has confirmed the label wording and that such a reading is shown but never counted in the home average or the home check (OQ-S07Y-1, OQ-S07Y-2)',
   'cmo', array['stamp_manual_vitals_timestamp (insert trigger on vitals_readings)'],
   'Logging an ordinary reading is never behind this guard. A dangerous value is triaged exactly as an ordinary reading whether or not the label is open. Test accounts pass it. No conditions are defined yet, so it cannot be switched on from the dashboard until they are.'),
  ('paper_diary_entry', 'Readings copied from a paper diary (typed by the person)',
   'Saving readings the person typed in from their own paper diary, with the label "from your paper diary"',
   'The Chief Medical Officer has confirmed the label, the days a diary reading may go back, and whether a diary reading may count in the home average (OQ-S07Y-3, OQ-S07Y-5)',
   'cmo', array['stamp_manual_vitals_timestamp (insert trigger on vitals_readings)'],
   'Not behind this guard: ordinary logging, and every red-flag check (a diary value is triaged like any other). Test accounts pass it. No conditions are defined yet.'),
  ('paper_diary_ai_reader', 'Reading a photo of a paper diary into suggestions (AI-021)',
   'Sending a photo of a diary page to the reading assistant, which suggests values the person then checks and confirms',
   'AI-021 has a recorded evaluation and approval, the data agreement with the model provider is recorded, and the clinical safety case is current',
   'cmo', array['diary reading route (web and phone)'],
   'Typing diary readings by hand (guard paper_diary_entry) never needs this guard. The assistant never stores the photo or any suggestion, and is never in a triage path. No conditions are defined yet.')
on conflict (key) do nothing;

-- 3. the stamp trigger ---------------------------------------------------------------------------------------------------------------
create or replace function private.stamp_manual_vitals_timestamp()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_now  timestamptz := clock_timestamp();
  r      record;
  v_days integer;
  v_skew integer;
  v_key  text;
  v_old_taken timestamptz;
  v_old_basis text;
begin
  new.received_at := v_now;

  -- A CORRECTION of a labelled reading (public.correct_clinical_value copies the old row, label included, and re-inserts it with client_recorded_at set to the
  -- old taken_at). The time was accepted when the reading was first saved, so an unchanged time is kept as it was: not re-judged against today's window (a diary
  -- reading older than the window could never be corrected) and not re-stamped as now (a pharmacy reading older than 72 hours would be), and a correction does
  -- not need the label's guard (it creates no new labelled reading). A CHANGED time falls through to the ordinary rules below. supersedes_id can only be set
  -- by the correction function (a_clinical_value_supersession refuses it from anywhere else).
  if new.entry_origin is not null and new.supersedes_id is not null and new.source = 'manual' then
    select o.taken_at, o.time_basis into v_old_taken, v_old_basis from public.vitals_readings o where o.id = new.supersedes_id;
    if found and new.client_recorded_at is not distinct from v_old_taken then
      new.taken_at := v_old_taken;
      new.time_basis := coalesce(v_old_basis, case new.entry_origin when 'paper_diary' then 'diary_stated' else 'client_bounded' end);
      return new;
    end if;
  end if;

  if new.entry_origin is not null then
    -- a labelled reading is an ordinary reading with a provenance: it only ever rides on source 'manual', so every trigger that keys on source still fires
    if new.source is distinct from 'manual' then
      raise exception 'a reading labelled % must be a manual reading', new.entry_origin using errcode = '22023';
    end if;
    v_key := case new.entry_origin when 'pharmacy_machine' then 'pharmacy_bp_readings' else 'paper_diary_entry' end;
    if not private.go_live_open_patient(v_key, new.patient_id) then
      raise exception 'this kind of reading is not switched on yet (%)', v_key using errcode = '55000';
    end if;
  end if;

  if new.source = 'manual' then
    if new.entry_origin = 'paper_diary' then
      select c.diary_window_days, c.future_skew_minutes into v_days, v_skew from public.offline_sync_config c where c.is_active;
      v_days := coalesce(v_days, 30);
      v_skew := coalesce(v_skew, 5);
      if new.client_recorded_at is null
         or new.client_recorded_at > v_now + make_interval(mins => v_skew)
         or new.client_recorded_at < v_now - make_interval(days => v_days) then
        raise exception 'a diary reading needs the date it was taken, within the last % days and not in the future', v_days using errcode = '22023';
      end if;
      new.taken_at := least(new.client_recorded_at, v_now);
      new.time_basis := 'diary_stated';
    else
      select * into r from private.resolve_offline_event_time(new.client_recorded_at, v_now);
      new.taken_at := r.effective_at;
      new.time_basis := r.basis;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.stamp_manual_vitals_timestamp() from public, anon, authenticated;

-- 4. the two views gain the columns at the end -------------------------------------------------------------------------------------------
create or replace view private.vitals_readings_current with (security_invoker = false) as
 select id, organisation_id, patient_id, vital_type, systolic, diastolic, glucose_mmol_l, glucose_context, weight_kg, pulse_bpm, temperature_c, spo2_pct, note,
        taken_at, created_at, source, device_id, external_reading_id, cgm_connection_id, waist_cm, ketones_mmol_l, ketone_urine, logged_by_profile_id,
        wearable_connection_id, respiratory_rate_bpm, peak_flow_l_min, "position", arm, validation_status, validation_flags, validated_by, validated_at,
        client_reading_id, triage_event_id, value_numeric, value_unit, client_recorded_at, received_at, time_basis, cuff_type, supersedes_id, superseded_by_id,
        correction_status, correction_reason, corrected_by, corrected_at, entry_origin, place_label
   from public.vitals_readings
  where correction_status is null;

create or replace view private.vitals_readings_diagnostic with (security_invoker = false) as
 select id, organisation_id, patient_id, vital_type, systolic, diastolic, glucose_mmol_l, glucose_context, weight_kg, pulse_bpm, temperature_c, spo2_pct, note,
        taken_at, created_at, source, device_id, external_reading_id, cgm_connection_id, waist_cm, ketones_mmol_l, ketone_urine, logged_by_profile_id,
        wearable_connection_id, respiratory_rate_bpm, peak_flow_l_min, "position", arm, validation_status, validation_flags, validated_by, validated_at,
        client_reading_id, triage_event_id, value_numeric, value_unit, client_recorded_at, received_at, time_basis, cuff_type, supersedes_id, superseded_by_id,
        correction_status, correction_reason, corrected_by, corrected_at, entry_origin, place_label
   from private.vitals_readings_current c
  where not (vital_type = 'blood_pressure'::public.vital_type and private.bp_reading_is_estimate(source::text));

-- 5. the three home-reading functions ---------------------------------------------------------------------------------------------------
-- (a) the signed 7-day protocol: neither label counts (the live definition reads the diagnostic view, which the cuffless-estimate work put there; only the label line is new)
create or replace function private.home_bp_assess(p_patient uuid, p_start date, p_cfg jsonb) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select private.home_bp_assess_readings(
    coalesce(jsonb_agg(jsonb_build_object('s', v.systolic, 'd', v.diastolic, 'at', v.taken_at)), '[]'::jsonb), p_start, p_cfg)
    from private.vitals_readings_diagnostic v
   where v.patient_id = p_patient and v.vital_type = 'blood_pressure' and v.systolic is not null and v.diastolic is not null
     and v.source::text in ('manual', 'device')
     and v.entry_origin is null
     and v.taken_at >= (p_start::timestamp at time zone 'Africa/Lagos')
     and v.taken_at <  ((p_start + (p_cfg -> 'protocol' ->> 'targetDays')::int)::timestamp at time zone 'Africa/Lagos')
$$;
revoke all on function private.home_bp_assess(uuid, date, jsonb) from public, anon, authenticated;

-- (b) the 7-day home average: a reading taken at a machine in a pharmacy is not a home reading
create or replace function private.hbpm_average(p_patient uuid)
 returns table(avg_systolic numeric, avg_diastolic numeric, n_readings integer, n_days integer, window_start date, meets_home_htn boolean)
 language sql stable security definer set search_path = ''
as $$
  with win as (
    select v.systolic, v.diastolic, (v.taken_at at time zone 'Africa/Lagos')::date as d
    from private.vitals_readings_diagnostic v
    where v.patient_id = p_patient
      and v.vital_type = 'blood_pressure'
      and v.systolic is not null and v.diastolic is not null
      and v.entry_origin is distinct from 'pharmacy_machine'
      and v.taken_at >= (now() - interval '7 days')
  ),
  kept as (
    select * from win
    where (select count(distinct d) from win) = 1
       or d > (select min(d) from win)
  )
  select
    round(avg(systolic), 1), round(avg(diastolic), 1),
    count(*)::int, count(distinct d)::int,
    (select min(d) from win),
    (avg(systolic) >= 135 or avg(diastolic) >= 85)
  from kept
  having count(*) > 0;
$$;

-- (c) the window statistics behind the trend average: same rule
create or replace function private.bp_window_stats(p_patient uuid, p_from date, p_to date, out n integer, out days integer, out avg_sys numeric, out avg_dia numeric)
 returns record language sql stable security definer set search_path = ''
as $$
  select count(*)::integer, count(distinct (taken_at at time zone 'Africa/Lagos')::date)::integer,
         round(avg(systolic)::numeric, 1), round(avg(diastolic)::numeric, 1)
    from private.vitals_readings_diagnostic
   where patient_id = p_patient and vital_type = 'blood_pressure' and systolic is not null and diastolic is not null
     and entry_origin is distinct from 'pharmacy_machine'
     and (validation_status = 'valid' or coalesce(validation_flags, '{}'::text[]) <@ array['insufficient_context']::text[])
     and (taken_at at time zone 'Africa/Lagos')::date between p_from and p_to
$$;

-- 6. AI-021, registered DISABLED -----------------------------------------------------------------------------------------------------
insert into public.ai_systems (
  system_code, name, purpose, owner_role, risk_class, autonomy_level, clinically_meaningful,
  lifecycle_status, is_enabled, runtime_governed, fallback_behaviour, code_reference
) values (
  'AI-021',
  'Paper diary reader',
  'Reads a photo of a handwritten blood pressure or glucose diary page into SUGGESTED rows (date, time, the numbers). The person checks and edits every row and confirms it; '
  || 'nothing is stored until then, the photo and the suggestions are never kept, and the model is never in a triage or red-flag path (INV-01). It never says whether a value is normal.',
  'Clinical Director',
  'moderate',
  'assist',
  true,
  'draft',
  false,
  false,
  'The manual multi-row entry sheet (the person types the rows from the diary). It needs no model and works with this system off.',
  'apps/web/src/lib/diary/read-diary-page.ts'
) on conflict (system_code) do nothing;

-- 7. self-check -----------------------------------------------------------------------------------------------------------------------
do $$
begin
  if (select count(*) from public.go_live_guards where key in ('pharmacy_bp_readings', 'paper_diary_entry', 'paper_diary_ai_reader') and not is_on) <> 3 then
    raise exception 'S07y self-check: the three guards must exist and be off';
  end if;
  if not exists (select 1 from public.ai_systems where system_code = 'AI-021' and is_enabled = false and runtime_governed = false) then
    raise exception 'S07y self-check: AI-021 must be registered and disabled';
  end if;
  if (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'vitals_readings' and column_name in ('entry_origin', 'place_label')) <> 2 then
    raise exception 'S07y self-check: the two provenance columns are missing';
  end if;
  if (select count(*) from information_schema.columns where table_schema = 'private' and table_name in ('vitals_readings_current', 'vitals_readings_diagnostic') and column_name = 'entry_origin') <> 2 then
    raise exception 'S07y self-check: both views must carry entry_origin';
  end if;
  if pg_get_functiondef('private.home_bp_assess(uuid, date, jsonb)'::regprocedure) not like '%entry_origin is null%' then
    raise exception 'S07y self-check: the home protocol must exclude labelled readings';
  end if;
  if (select count(*) from public.vitals_readings where entry_origin is not null) <> 0 then
    raise exception 'S07y self-check: no existing reading may carry a label';
  end if;
  if exists (select 1 from information_schema.table_privileges where table_schema = 'private' and table_name in ('vitals_readings_current', 'vitals_readings_diagnostic') and grantee in ('anon', 'PUBLIC')) then
    raise exception 'S07y self-check: the views must not be readable by anon';
  end if;
end $$;
