-- Tarragon Health — Temperature red-flag auto-detection engine
--
-- Same architecture and motivation as spo2_red_flag_engine.sql /
-- 20260720015223_bp_red_flag_engine.sql: a DB trigger on vitals_readings so
-- it fires for EVERY insert path and cannot be bypassed by a missing
-- app-layer check. Until now, temperature had zero clinician-facing
-- escalation — apps/web/src/lib/vitals/plausibility.ts only shows the
-- *patient* a pre-submit "please confirm this reading" prompt
-- (>37.8C / <35.8C), never reaching clinician_alerts/emergency_events. A
-- septic-range fever raised nothing on the clinician side.
--
-- Triage bands:
--   EMERGENCY: >= 40.0C or < 35.0C  -> hyperpyrexia / significant hypothermia
--   RED      : >= 39.0C             -> sepsis-relevant high fever, same-day review
--   AMBER    : >= 38.0C             -> fever, doctor review within a few days
--   GREEN    : < 38.0C (and >= 35.0C)
--
-- Open question, explicitly not decided here — flag for Clinical Director
-- review rather than inventing an unasked band: mild hypothermia
-- (35.0-35.7C, clinically relevant in elderly/malnourished patients, and
-- inside plausibility.ts's existing <35.8 confirm-band) currently falls to
-- GREEN with no clinician-facing signal.
--
-- Same vital-type-scoped "existing open alert" lookup as the SpO2 engine
-- (see that migration's correctness note) — never touches another vital's
-- alert.

-- 1. Additive: emergency_events can be sourced from a temperature reading.
alter type public.emergency_source add value if not exists 'temperature_red_flag';

-- 2. Pure classifier.
create or replace function private.classify_temperature_level(p_temperature_c numeric)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_temperature_c is null then 'unknown'
    when p_temperature_c >= 40.0 or p_temperature_c < 35.0 then 'emergency'
    when p_temperature_c >= 39.0 then 'red'
    when p_temperature_c >= 38.0 then 'amber'
    else 'green'
  end;
$$;

-- 3. The trigger.
create or replace function private.handle_temperature_reading_red_flag()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_level     text;
  v_alert_lvl public.alert_level;
  v_esc       smallint;
  v_sla       interval;
  v_title     text;
  v_detail    text;
  v_existing  public.clinician_alerts%rowtype;
begin
  if new.vital_type <> 'temperature' then
    return new;
  end if;

  v_level := private.classify_temperature_level(new.temperature_c);
  if v_level in ('unknown', 'green') then
    return new;  -- nothing to raise
  end if;

  v_detail := format('Temperature reading %sC logged %s.',
                     new.temperature_c, to_char(new.taken_at, 'YYYY-MM-DD HH24:MI'));

  -- EMERGENCY: hand off to emergency_events. Light dedupe: don't raise a
  -- second temperature_red_flag emergency while one is still active from the
  -- last 6h.
  if v_level = 'emergency' then
    if not exists (
      select 1 from public.emergency_events e
      where e.patient_id = new.patient_id
        and e.source = 'temperature_red_flag'
        and e.status = 'active'
        and e.created_at > now() - interval '6 hours'
    ) then
      insert into public.emergency_events
        (organisation_id, patient_id, source, trigger_detail, status, vital_reading_id)
      values (
        new.organisation_id, new.patient_id, 'temperature_red_flag',
        v_detail || ' This is in the hyperpyrexia/hypothermia emergency range.',
        'active', new.id
      );
    end if;
    return new;
  end if;

  -- RED / AMBER -> clinician_alerts, one active temperature alert per patient, upgrade-only.
  if v_level = 'red' then
    v_alert_lvl := 'urgent_escalation'; v_esc := 3; v_sla := interval '1 hour';
    v_title := 'Priority 1: high fever reading';
    v_detail := v_detail || ' Sepsis-relevant range — please review same day.';
  else
    v_alert_lvl := 'clinician_review'; v_esc := 2; v_sla := interval '72 hours';
    v_title := 'Fever reading logged';
    v_detail := v_detail || ' Review symptoms and recheck.';
  end if;

  select ca.* into v_existing
  from public.clinician_alerts ca
  join public.vitals_readings vr on vr.id = ca.vital_reading_id
  where ca.patient_id = new.patient_id
    and vr.vital_type = 'temperature'
    and ca.status = 'open'
  order by ca.created_at desc
  limit 1;

  if v_existing.id is not null then
    if v_esc >= coalesce(v_existing.escalation_level, 0) then
      update public.clinician_alerts
        set level = v_alert_lvl, escalation_level = v_esc, title = v_title,
            detail = v_detail, sla_due_at = now() + v_sla,
            vital_reading_id = new.id, updated_at = now()
      where id = v_existing.id;
    end if;
  else
    insert into public.clinician_alerts
      (organisation_id, patient_id, level, status, title, detail, sla_due_at,
       escalation_level, vital_reading_id)
    values (
      new.organisation_id, new.patient_id, v_alert_lvl, 'open', v_title, v_detail,
      now() + v_sla, v_esc, new.id
    );
  end if;

  insert into public.audit_log
    (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (
    new.organisation_id, new.patient_id, 'temperature_red_flag.raised',
    'vitals_readings', new.id,
    jsonb_build_object('level', v_level, 'temperature_c', new.temperature_c)
  );

  return new;
end;
$$;

drop trigger if exists vitals_readings_temperature_red_flag on public.vitals_readings;
create trigger vitals_readings_temperature_red_flag
  after insert on public.vitals_readings
  for each row
  when (new.vital_type = 'temperature')
  execute function private.handle_temperature_reading_red_flag();

-- 4. Assertions.
do $$
declare
  v_band text;
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'vitals_readings_temperature_red_flag'
      and tgrelid = 'public.vitals_readings'::regclass
      and not tgisinternal
  ) then
    raise exception 'FAIL: vitals_readings_temperature_red_flag trigger missing';
  end if;

  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where p.proname = 'handle_temperature_reading_red_flag' and n.nspname = 'private'
  ) then
    raise exception 'FAIL: private.handle_temperature_reading_red_flag missing';
  end if;

  v_band := private.classify_temperature_level(40.5);
  if v_band <> 'emergency' then
    raise exception 'FAIL: classify_temperature_level(40.5) = % expected emergency', v_band;
  end if;

  v_band := private.classify_temperature_level(34.5);
  if v_band <> 'emergency' then
    raise exception 'FAIL: classify_temperature_level(34.5) = % expected emergency', v_band;
  end if;

  v_band := private.classify_temperature_level(39.5);
  if v_band <> 'red' then
    raise exception 'FAIL: classify_temperature_level(39.5) = % expected red', v_band;
  end if;

  v_band := private.classify_temperature_level(38.5);
  if v_band <> 'amber' then
    raise exception 'FAIL: classify_temperature_level(38.5) = % expected amber', v_band;
  end if;

  v_band := private.classify_temperature_level(37.0);
  if v_band <> 'green' then
    raise exception 'FAIL: classify_temperature_level(37.0) = % expected green', v_band;
  end if;

  v_band := private.classify_temperature_level(null);
  if v_band <> 'unknown' then
    raise exception 'FAIL: classify_temperature_level(null) = % expected unknown', v_band;
  end if;

  raise notice 'PASS: temperature_red_flag_engine — trigger, function, and classifier bands verified';
end $$;
