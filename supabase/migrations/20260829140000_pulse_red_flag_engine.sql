-- Tarragon Health — heart-rate (pulse) red-flag auto-detection engine.
--
-- Founder-flagged gap while reviewing wearable heart-rate handling: a
-- dangerously fast or slow single pulse reading — wearable, BLE device, or
-- manually typed — currently raises NOTHING on this platform. The only
-- existing heart-rate logic is assess-heart-rate.ts's assessHeartRateBestEffort,
-- which is a 30-day *pattern* check (>=3 readings, >=50% outside 60-100 bpm
-- over a month) that writes a silent clinician_alerts row with no patient-
-- facing message at all — it would not fire on a single acute 180 bpm or
-- 35 bpm reading, and even when it does fire, nothing tells the patient
-- anything. patient-monitoring.ts's own comment ("no single-reading clinical
-- threshold exists for pulse ... only ever pattern-assessed") documents this
-- gap explicitly. Every other vital with a real single-reading danger
-- threshold (BP, SpO2, temperature, glucose) already has exactly the engine
-- this migration adds for pulse — see spo2_red_flag_engine.sql, whose
-- structure this mirrors line for line, already gated to
-- vitals_red_flag_doctor_escalation per gate_vitals_red_flag_escalation_to_
-- paid_plans.sql (which this migration writes as the FIRST version, not a
-- later gate-on retrofit, since that plan-gate machinery already exists).
--
-- What this does NOT do, on purpose: this is a deterministic single-reading
-- threshold, the same kind of engine BP/SpO2/temperature already run — not
-- the cross-metric "digital biomarker" pattern detection the founder
-- deliberately deferred (patient-monitoring.ts's "appetite to design this
-- later, not now" note, re: steps/sleep/HRV trend analysis). A single
-- dangerous heart-rate VALUE is not a trend or a pattern across metrics; it
-- is the same kind of fact a dangerous BP or SpO2 reading already is, and
-- the platform must not treat it differently just because it can arrive
-- from a wearable instead of a cuff.
--
-- Triage bands (a single logged BPM carries no rhythm information — this is
-- NOT arrhythmia/AF detection, same caveat assess-heart-rate.ts already
-- documents — only extreme-value triage, deliberately conservative to avoid
-- alert fatigue on ordinary exercise/stress spikes):
--   EMERGENCY: <= 35 or >= 150 bpm  -> severe brady/tachycardia
--   RED      : 36-39 or 121-149    -> same-day review
--   AMBER    : 40-49 or 101-120    -> review needed
--   GREEN    : 50-100              -> no alert
-- DRAFT bands, same caveat every other vitals red-flag engine in this
-- codebase carries — needs Clinical Director sign-off before being relied
-- upon as attested clinical config, not just a working safety net.

-- 1. Additive: emergency_events can be sourced from a pulse reading.
alter type public.emergency_source add value if not exists 'pulse_red_flag';

-- 2. Pure classifier — one place defines the bands, reused by the trigger.
create or replace function private.classify_pulse_level(p_pulse_bpm integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_pulse_bpm is null then 'unknown'
    when p_pulse_bpm <= 35 or p_pulse_bpm >= 150 then 'emergency'
    when p_pulse_bpm <= 39 or p_pulse_bpm >= 121 then 'red'
    when p_pulse_bpm <= 49 or p_pulse_bpm >= 101 then 'amber'
    else 'green'
  end;
$$;

-- 3. The trigger. Written gated from the start (patient_has_feature_access +
-- raise_dangerous_reading_ai_suggestion fallback) since that machinery
-- already exists — unlike BP/SpO2, which were gated in a later migration
-- because they predate it. Vital-type-scoped "existing open alert" lookup,
-- matching SpO2/temperature's corrected join (not BP's known-buggy unscoped
-- lookup — see spo2_red_flag_engine.sql's own correctness note).
create or replace function private.handle_pulse_reading_red_flag()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_level       text;
  v_alert_lvl   public.alert_level;
  v_esc         smallint;
  v_sla         interval;
  v_title       text;
  v_detail      text;
  v_level_label text;
  v_existing    public.clinician_alerts%rowtype;
  v_alert_id    uuid;
  v_should_page boolean := false;
  v_has_escalation_access boolean;
  r public.profiles%rowtype;
begin
  if new.vital_type <> 'pulse' then
    return new;
  end if;

  v_level := private.classify_pulse_level(new.pulse_bpm);
  if v_level in ('unknown', 'green') then
    return new;
  end if;

  v_detail := format('Heart rate reading %s bpm logged %s.',
                     new.pulse_bpm, to_char(new.taken_at, 'YYYY-MM-DD HH24:MI'));

  -- EMERGENCY: hand off to emergency_events (its own trigger raises the
  -- Priority-1 alert + audit + acknowledge-gated contact notify + follow-up,
  -- and already applies the same plan gate + self-care fallback).
  if v_level = 'emergency' then
    if not exists (
      select 1 from public.emergency_events e
      where e.patient_id = new.patient_id
        and e.source = 'pulse_red_flag'
        and e.status = 'active'
        and e.created_at > now() - interval '6 hours'
    ) then
      insert into public.emergency_events
        (organisation_id, patient_id, source, trigger_detail, status, vital_reading_id)
      values (
        new.organisation_id, new.patient_id, 'pulse_red_flag',
        v_detail || ' This is a severely fast or slow heart rate.',
        'active', new.id
      );
    end if;
    return new;
  end if;

  v_has_escalation_access := private.patient_has_feature_access(new.patient_id, 'vitals_red_flag_doctor_escalation');

  if v_level = 'red' then
    v_alert_lvl := 'urgent_escalation'; v_esc := 3; v_sla := interval '1 hour';
    v_title := 'Priority 1: abnormal heart rate reading';
    v_detail := v_detail || ' Please review same day and confirm reading technique/context.';
    v_level_label := 'Priority 1';
  else
    v_alert_lvl := 'clinician_review'; v_esc := 2; v_sla := interval '72 hours';
    v_title := 'Heart rate outside typical range';
    v_detail := v_detail || ' Outside typical range — review symptoms, medication and context (rest vs. activity).';
    v_level_label := 'Review needed';
  end if;

  if v_has_escalation_access then
    select ca.* into v_existing
    from public.clinician_alerts ca
    join public.vitals_readings vr on vr.id = ca.vital_reading_id
    where ca.patient_id = new.patient_id
      and vr.vital_type = 'pulse'
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
        v_alert_id := v_existing.id;
        if v_esc > coalesce(v_existing.escalation_level, 0) then
          v_should_page := true;
        end if;
      end if;
    else
      insert into public.clinician_alerts
        (organisation_id, patient_id, level, status, title, detail, sla_due_at,
         escalation_level, vital_reading_id)
      values (
        new.organisation_id, new.patient_id, v_alert_lvl, 'open', v_title, v_detail,
        now() + v_sla, v_esc, new.id
      )
      returning id into v_alert_id;
      v_should_page := true;
    end if;
  else
    -- Free tier: no clinician_alerts row, no paging — the patient still gets
    -- an immediate, specific self-care suggestion. This is the same
    -- deterministic safety net BP/SpO2/temperature already give a Free
    -- patient, never silence.
    perform private.raise_dangerous_reading_ai_suggestion(
      new.organisation_id, new.patient_id, 'heart rate', v_level_label,
      'Sit down and rest for a few minutes, then recheck your heart rate — ideally with a proper pulse oximeter or blood-pressure monitor rather than relying on the wearable reading alone. If it stays this fast or slow, or you feel dizzy, faint, chest pain, or short of breath, seek care promptly.'
    );
  end if;

  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (new.organisation_id, new.patient_id, 'pulse_red_flag.raised', 'vitals_readings', new.id,
    jsonb_build_object('level', v_level, 'pulse_bpm', new.pulse_bpm, 'source', new.source,
                       'escalation_gated_by_plan', not v_has_escalation_access));

  if v_should_page then
    for r in
      select * from public.profiles
      where organisation_id = new.organisation_id and role = 'clinician' and phone is not null
    loop
      perform private.enqueue_critical_notification(
        new.organisation_id, r.id, 'vitals_red_flag_clinician_alert',
        jsonb_build_object(
          'patient_name', coalesce((select full_name from public.profiles where id = new.patient_id), 'A patient'),
          'vital_label', 'heart rate',
          'level_label', v_level_label
        ),
        'pulse_vitals_red_flag', v_alert_lvl, 'clinician_alerts', v_alert_id
      );
    end loop;
  end if;

  return new;
end;
$$;

drop trigger if exists vitals_readings_pulse_red_flag on public.vitals_readings;
create trigger vitals_readings_pulse_red_flag
  after insert on public.vitals_readings
  for each row
  when (new.vital_type = 'pulse')
  execute function private.handle_pulse_reading_red_flag();

-- 4. private.handle_emergency_event() — add a pulse-specific self-care
--    message branch for the Free-tier fallback. Full body copied forward,
--    byte-identical otherwise, from the live definition in
--    20260810022401_gate_vitals_red_flag_escalation_to_paid_plans.sql.
create or replace function private.handle_emergency_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_alert_id uuid;
  v_c_name  text;
  v_c_rel   text;
  v_c_phone text;
  v_contact_line text := '';
  v_actor uuid := (select auth.uid());
  v_reporter_line text := '';
  r public.profiles%rowtype;
  v_has_escalation_access boolean;
  v_source_label text;
begin
  select emergency_contact_name, emergency_contact_relationship, emergency_contact_phone
    into v_c_name, v_c_rel, v_c_phone
  from public.profiles where id = new.patient_id;
  if v_c_phone is not null then
    v_contact_line := format(' Emergency contact: %s%s — %s.',
      coalesce(v_c_name, 'on file'),
      case when v_c_rel is not null then ' (' || v_c_rel || ')' else '' end,
      v_c_phone);
  end if;

  if v_actor is not null and v_actor <> new.patient_id then
    v_reporter_line := format(' Reported by %s on the patient''s behalf, not by the patient themselves.',
      coalesce((select nullif(trim(full_name), '') from public.profiles where id = v_actor),
               'someone acting for them'));
  end if;

  if new.clinician_alert_id is null then
    v_has_escalation_access := private.patient_has_feature_access(new.patient_id, 'vitals_red_flag_doctor_escalation');

    if v_has_escalation_access then
      insert into public.clinician_alerts
        (organisation_id, patient_id, level, status, title, detail, sla_due_at, escalation_level)
      values (
        new.organisation_id,
        new.patient_id,
        'emergency',
        'open',
        'Priority 1: emergency reported',
        format('Emergency event (source: %s).%s%s%s',
               new.source,
               case when new.trigger_detail is not null then ' ' || new.trigger_detail else '' end,
               v_reporter_line,
               v_contact_line),
        now() + (private.escalation_sla_minutes('emergency_event', 'emergency') * interval '1 minute'),
        4
      )
      returning id into v_alert_id;

      new.clinician_alert_id := v_alert_id;

      for r in
        select * from public.profiles
        where organisation_id = new.organisation_id and role = 'clinician' and phone is not null
      loop
        perform private.enqueue_critical_notification(
          new.organisation_id, r.id, 'emergency_event_clinician_alert',
          jsonb_build_object(
            'patient_name', coalesce((select full_name from public.profiles where id = new.patient_id), 'A patient'),
            'source_label', new.source::text
          ),
          'emergency_event', 'emergency', 'clinician_alerts', v_alert_id
        );
      end loop;
    else
      -- Free tier: no clinician_alerts row, no paging — the patient still
      -- gets the full emergency_events safety net (this row itself, the
      -- acknowledge-gated hospital-now dialog, emergency-contact auto-notify,
      -- follow-up check-in) plus a specific self-care suggestion.
      v_source_label := replace(new.source::text, '_', ' ');
      perform private.raise_dangerous_reading_ai_suggestion(
        new.organisation_id, new.patient_id, v_source_label, 'Needs prompt attention',
        case new.source
          when 'bp_reading' then 'This is a hypertensive-crisis-range blood pressure reading. Sit down, rest, and recheck in a few minutes; if it stays this high, or you have a headache, chest pain, or blurred vision, go to the nearest hospital now.'
          when 'spo2_red_flag' then 'This is a very low oxygen reading. Sit upright, breathe slowly, and recheck in a few minutes; if it does not come back up or you feel breathless, go to the nearest hospital now.'
          when 'temperature_red_flag' then 'This is a very high or very low temperature reading. Rest, stay hydrated or warm as appropriate, and recheck soon; if you feel very unwell, go to the nearest hospital now.'
          when 'glucose_red_flag' then 'This is a severe blood sugar reading (very low or very high with raised ketones). Follow your usual emergency steps for this now, and go to the nearest hospital if you do not recover quickly or feel worse.'
          when 'pulse_red_flag' then 'This is a very fast or very slow heart rate reading. Sit down, rest, and recheck in a few minutes — ideally with a proper pulse oximeter or blood-pressure monitor rather than relying on the wearable reading alone. If it stays this extreme, or you feel dizzy, faint, chest pain, or short of breath, go to the nearest hospital now.'
          else 'This reading or symptom is in a range that needs prompt in-person attention. Please follow the emergency guidance above and go to the nearest hospital now.'
        end
      );
    end if;
  end if;

  insert into public.audit_log
    (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (
    new.organisation_id,
    coalesce(v_actor, new.patient_id),
    'emergency_event.created',
    'emergency_events',
    new.id,
    jsonb_build_object('source', new.source, 'clinician_alert_id', new.clinician_alert_id,
                       'patient_id', new.patient_id,
                       'escalation_gated_by_plan', new.clinician_alert_id is null)
  );

  return new;
end;
$$;

-- 5. Assertions — prove the engine is wired correctly, not just hoped for.
do $$
declare
  v_band text;
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'vitals_readings_pulse_red_flag'
      and tgrelid = 'public.vitals_readings'::regclass
      and not tgisinternal
  ) then
    raise exception 'FAIL: vitals_readings_pulse_red_flag trigger missing';
  end if;

  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where p.proname = 'handle_pulse_reading_red_flag' and n.nspname = 'private'
  ) then
    raise exception 'FAIL: private.handle_pulse_reading_red_flag missing';
  end if;

  v_band := private.classify_pulse_level(30);
  if v_band <> 'emergency' then raise exception 'FAIL: classify_pulse_level(30) = % expected emergency', v_band; end if;

  v_band := private.classify_pulse_level(35);
  if v_band <> 'emergency' then raise exception 'FAIL: classify_pulse_level(35) = % expected emergency', v_band; end if;

  v_band := private.classify_pulse_level(150);
  if v_band <> 'emergency' then raise exception 'FAIL: classify_pulse_level(150) = % expected emergency', v_band; end if;

  v_band := private.classify_pulse_level(180);
  if v_band <> 'emergency' then raise exception 'FAIL: classify_pulse_level(180) = % expected emergency', v_band; end if;

  v_band := private.classify_pulse_level(38);
  if v_band <> 'red' then raise exception 'FAIL: classify_pulse_level(38) = % expected red', v_band; end if;

  v_band := private.classify_pulse_level(130);
  if v_band <> 'red' then raise exception 'FAIL: classify_pulse_level(130) = % expected red', v_band; end if;

  v_band := private.classify_pulse_level(45);
  if v_band <> 'amber' then raise exception 'FAIL: classify_pulse_level(45) = % expected amber', v_band; end if;

  v_band := private.classify_pulse_level(110);
  if v_band <> 'amber' then raise exception 'FAIL: classify_pulse_level(110) = % expected amber', v_band; end if;

  v_band := private.classify_pulse_level(72);
  if v_band <> 'green' then raise exception 'FAIL: classify_pulse_level(72) = % expected green', v_band; end if;

  v_band := private.classify_pulse_level(100);
  if v_band <> 'green' then raise exception 'FAIL: classify_pulse_level(100) = % expected green', v_band; end if;

  v_band := private.classify_pulse_level(50);
  if v_band <> 'green' then raise exception 'FAIL: classify_pulse_level(50) = % expected green', v_band; end if;

  v_band := private.classify_pulse_level(null);
  if v_band <> 'unknown' then raise exception 'FAIL: classify_pulse_level(null) = % expected unknown', v_band; end if;

  raise notice 'PASS: pulse_red_flag_engine — trigger, function, and classifier bands verified';
end $$;
