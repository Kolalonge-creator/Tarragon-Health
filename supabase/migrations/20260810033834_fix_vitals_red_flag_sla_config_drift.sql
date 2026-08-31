-- Tarragon Health — close the escalation_slas config/code drift for
-- spo2/temperature/symptom red-flag triggers.
--
-- Found during a 2026-08-10 preventative-programme review: of the 8 live
-- functions that raise a clinician_alerts row, 5 (screening_abnormal_result,
-- bp_vitals_red_flag, emergency_event, lpe_red_flag, obesity_ed_screen) read
-- their SLA from private.escalation_sla_minutes(pathway, tier) — the
-- Clinical-Director-signable config table built 2026-07-30
-- (20260730105131_v3_port_escalation_sla_config.sql). The other 3
-- (spo2/temperature/symptom red-flags) still hardcode a `v_sla := interval
-- '...'` literal, confirmed via pg_get_functiondef against the live project.
--
-- This is not hypothetical drift: escalation_slas v3 (2026-08-07,
-- unsigned DRAFT, still is_active — id 7b69cc62-06e3-4c22-8b2f-3b91b3de3704)
-- already carries spo2_vitals_red_flag/urgent_escalation = 30 minutes,
-- with its own note explaining WHY: "SpO2's 30-min urgent SLA is
-- intentionally tighter than BP's 60-min default given hypoxia's faster
-- deterioration." The live trigger never got rewired to read it, so a
-- desaturation red flag has been getting BP's 60-minute SLA this whole
-- time — half the clinically-intended urgency. temperature_vitals_red_flag's
-- config (60 / 4320) happens to already match today's hardcoded values, so
-- wiring it up is a no-op there — but it stops future drift the same way.
-- symptom_red_flag was never registered in escalation_slas at all: its
-- higher-severity branch hardcodes 4 hours inline, and its second
-- (severity 5-7, clinician_review) branch inserts a clinician_alerts row
-- with NO sla_due_at column at all — an untriaged-by-SLA alert.
--
-- Net effect of this migration:
--   * spo2 urgent_escalation: 60min -> 30min (a real safety tightening,
--     making live the clinical call already recorded in v3's notes)
--   * temperature: no behaviour change (60/4320 either way)
--   * symptom_red_flag high-severity branch: no behaviour change (240min
--     either way), now sourced from config instead of a literal
--   * symptom_red_flag moderate-severity branch: previously no sla_due_at
--     at all (null) -> now 4320min (3 days), matching every other
--     clinician_review-tier pathway in the config
--
-- ---------------------------------------------------------------------------
-- 1. escalation_slas v4 — copies v3's config forward unchanged, adds
--    symptom_red_flag. Same precedent as v3 itself: is_active=true
--    immediately (the rewritten functions below depend on it resolving the
--    instant this migration completes — a raised exception on a live
--    clinical alert is a worse failure mode than a blocked insert, per
--    escalation_sla_minutes()'s own fail-loud design), approved_by/
--    approved_at left null (an as-transcribed config update is not a
--    Director's clinical attestation — see v1/v3's identical caveat).
-- ---------------------------------------------------------------------------
insert into public.escalation_slas (version, config, notes, is_active)
select
  4,
  (v3.config || '[
    {"pathway": "symptom_red_flag", "tier": "urgent_escalation", "sla_minutes": 240, "channel_sequence": ["push", "whatsapp_nudge"], "source_function": "private.handle_symptom_red_flag", "note": "High-severity (>=8, or a low-threshold red-flag type >=6) patient-logged symptom. As-transcribed from the prior hardcoded 4h literal — no change."},
    {"pathway": "symptom_red_flag", "tier": "clinician_review", "sla_minutes": 4320, "channel_sequence": ["push, batched"], "source_function": "private.handle_symptom_red_flag", "note": "Moderate-severity (5-7) patient-logged symptom. Previously had NO sla_due_at at all (untriaged by SLA) — 4320min chosen to match every other clinician_review-tier entry in this table (bp/lpe/chronic_monitoring_silence)."}
  ]'::jsonb),
  'v4 — wires spo2_vitals_red_flag and temperature_vitals_red_flag into the trigger functions (previously drafted in v3 but never read by code) and registers symptom_red_flag for the first time. Carries forward v3''s still-open review items unchanged (mild-hypothermia amber band, whether SpO2/temperature should share BP''s channel_sequence) plus this migration''s own new item: symptom_red_flag''s clinician_review SLA (4320min) is a first-time value with no prior clinical sign-off, chosen only by consistency with sibling clinician_review entries — flag for Clinical Director review alongside the rest of this table at /admin/settings/escalation-slas. DRAFT, unsigned.',
  true
-- Was `where v3.id = '7b69cc62-06e3-4c22-8b2f-3b91b3de3704'` — v3's real,
-- live id, but escalation_slas.id defaults to gen_random_uuid(), so a
-- from-scratch replay gives v3 a different id and this matched zero rows,
-- silently inserting no v4 row at all (found by the new CI migration-
-- replay job, 2026-08-27 — private.escalation_sla_minutes() then correctly
-- fail-loud raised "no active escalation SLA configured" per its own
-- design, rather than resolving anything). `is_active` identifies the same
-- row by what actually makes it "v3" — being the current config — on any
-- environment.
from public.escalation_slas v3
where v3.is_active;

update public.escalation_slas set is_active = false
where is_active and version <> 4;

-- ---------------------------------------------------------------------------
-- 2. Rewire private.handle_spo2_reading_red_flag() — full body copied
--    forward from the live definition (pg_get_functiondef, 2026-08-10),
--    only the two `v_sla := interval '...'` literals replaced.
-- ---------------------------------------------------------------------------
create or replace function private.handle_spo2_reading_red_flag()
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
  v_alert_id  uuid;
  v_should_page boolean := false;
  v_level_label text;
  r           public.profiles%rowtype;
  v_has_escalation_access boolean;
begin
  if new.vital_type <> 'spo2' then
    return new;
  end if;

  v_level := private.classify_spo2_level(new.spo2_pct);
  if v_level in ('unknown', 'green') then
    return new;
  end if;

  v_detail := format('SpO2 reading %s%% logged %s.',
                     new.spo2_pct, to_char(new.taken_at, 'YYYY-MM-DD HH24:MI'));

  if v_level = 'emergency' then
    if not exists (
      select 1 from public.emergency_events e
      where e.patient_id = new.patient_id
        and e.source = 'spo2_red_flag'
        and e.status = 'active'
        and e.created_at > now() - interval '6 hours'
    ) then
      insert into public.emergency_events
        (organisation_id, patient_id, source, trigger_detail, status, vital_reading_id)
      values (
        new.organisation_id, new.patient_id, 'spo2_red_flag',
        v_detail || ' This is in the hypoxia / emergency range.',
        'active', new.id
      );
    end if;
    return new;
  end if;

  v_has_escalation_access := private.patient_has_feature_access(new.patient_id, 'vitals_red_flag_doctor_escalation');

  if v_level = 'red' then
    v_alert_lvl := 'urgent_escalation'; v_esc := 3;
    v_sla := private.escalation_sla_minutes('spo2_vitals_red_flag', 'urgent_escalation') * interval '1 minute';
    v_title := 'Priority 1: low oxygen saturation reading';
    v_detail := v_detail || ' Please review same day and confirm reading technique.';
    v_level_label := 'Priority 1';
  else
    v_alert_lvl := 'clinician_review'; v_esc := 2;
    v_sla := private.escalation_sla_minutes('spo2_vitals_red_flag', 'clinician_review') * interval '1 minute';
    v_title := 'Oxygen saturation below target';
    v_detail := v_detail || ' Below target — review symptoms and recheck.';
    v_level_label := 'Review needed';
  end if;

  if v_has_escalation_access then
    select ca.* into v_existing
    from public.clinician_alerts ca
    join public.vitals_readings vr on vr.id = ca.vital_reading_id
    where ca.patient_id = new.patient_id
      and vr.vital_type = 'spo2'
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
    perform private.raise_dangerous_reading_ai_suggestion(
      new.organisation_id, new.patient_id, 'oxygen saturation', v_level_label,
      'Sit upright, take slow, deep breaths, and recheck in about 15 minutes. If your reading stays low, or you feel short of breath, dizzy, or unwell, seek care promptly.'
    );
  end if;

  insert into public.audit_log
    (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (
    new.organisation_id, new.patient_id, 'spo2_red_flag.raised',
    'vitals_readings', new.id,
    jsonb_build_object('level', v_level, 'spo2_pct', new.spo2_pct,
                       'escalation_gated_by_plan', not v_has_escalation_access)
  );

  if v_should_page then
    for r in
      select * from public.profiles
      where organisation_id = new.organisation_id and role = 'clinician' and phone is not null
    loop
      perform private.enqueue_critical_notification(
        new.organisation_id, r.id, 'vitals_red_flag_clinician_alert',
        jsonb_build_object(
          'patient_name', coalesce((select full_name from public.profiles where id = new.patient_id), 'A patient'),
          'vital_label', 'oxygen saturation',
          'level_label', v_level_label
        ),
        'spo2_vitals_red_flag', v_alert_lvl, 'clinician_alerts', v_alert_id
      );
    end loop;
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Rewire private.handle_temperature_reading_red_flag() — same treatment.
--    Values are unchanged (60min/4320min either way); only the source of
--    truth moves from a literal to the config table.
-- ---------------------------------------------------------------------------
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
  v_alert_id  uuid;
  v_should_page boolean := false;
  v_level_label text;
  r           public.profiles%rowtype;
  v_has_escalation_access boolean;
begin
  if new.vital_type <> 'temperature' then
    return new;
  end if;

  v_level := private.classify_temperature_level(new.temperature_c);
  if v_level in ('unknown', 'green') then
    return new;
  end if;

  v_detail := format('Temperature reading %sC logged %s.',
                     new.temperature_c, to_char(new.taken_at, 'YYYY-MM-DD HH24:MI'));

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

  v_has_escalation_access := private.patient_has_feature_access(new.patient_id, 'vitals_red_flag_doctor_escalation');

  if v_level = 'red' then
    v_alert_lvl := 'urgent_escalation'; v_esc := 3;
    v_sla := private.escalation_sla_minutes('temperature_vitals_red_flag', 'urgent_escalation') * interval '1 minute';
    v_title := 'Priority 1: high fever reading';
    v_detail := v_detail || ' Sepsis-relevant range — please review same day.';
    v_level_label := 'Priority 1';
  else
    v_alert_lvl := 'clinician_review'; v_esc := 2;
    v_sla := private.escalation_sla_minutes('temperature_vitals_red_flag', 'clinician_review') * interval '1 minute';
    v_title := 'Fever reading logged';
    v_detail := v_detail || ' Review symptoms and recheck.';
    v_level_label := 'Review needed';
  end if;

  if v_has_escalation_access then
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
    perform private.raise_dangerous_reading_ai_suggestion(
      new.organisation_id, new.patient_id, 'temperature', v_level_label,
      'Rest and stay hydrated, and take paracetamol if needed for fever; recheck your temperature in a few hours. If it stays this high, or you feel very unwell, seek care promptly.'
    );
  end if;

  insert into public.audit_log
    (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (
    new.organisation_id, new.patient_id, 'temperature_red_flag.raised',
    'vitals_readings', new.id,
    jsonb_build_object('level', v_level, 'temperature_c', new.temperature_c,
                       'escalation_gated_by_plan', not v_has_escalation_access)
  );

  if v_should_page then
    for r in
      select * from public.profiles
      where organisation_id = new.organisation_id and role = 'clinician' and phone is not null
    loop
      perform private.enqueue_critical_notification(
        new.organisation_id, r.id, 'vitals_red_flag_clinician_alert',
        jsonb_build_object(
          'patient_name', coalesce((select full_name from public.profiles where id = new.patient_id), 'A patient'),
          'vital_label', 'temperature',
          'level_label', v_level_label
        ),
        'temperature_vitals_red_flag', v_alert_lvl, 'clinician_alerts', v_alert_id
      );
    end loop;
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Rewire private.handle_symptom_red_flag() — same treatment, plus adds
--    sla_due_at to the previously-unset second branch.
-- ---------------------------------------------------------------------------
create or replace function private.handle_symptom_red_flag()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_low_threshold_types public.symptom_type[] := array[
    'breathlessness', 'palpitations', 'swelling',
    'chest_pain', 'severe_headache', 'visual_disturbance', 'confusion'
  ];
  v_is_red_flag boolean;
  v_has_escalation_access boolean;
begin
  v_is_red_flag := (
    new.severity >= 8
    or (new.symptom_type = any (v_low_threshold_types) and new.severity >= 6)
  );
  new.is_red_flag := v_is_red_flag;

  if v_is_red_flag then
    v_has_escalation_access := private.patient_has_feature_access(new.patient_id, 'vitals_red_flag_doctor_escalation');
    if v_has_escalation_access then
      insert into public.clinician_alerts
        (organisation_id, patient_id, level, status, title, detail, sla_due_at)
      values (
        new.organisation_id,
        new.patient_id,
        'urgent_escalation',
        'open',
        format('Priority 1: red-flag symptom (%s)', new.symptom_type),
        format('Patient reported %s at severity %s/10.%s',
               new.symptom_type, new.severity,
               case when new.description is not null then ' Note: ' || new.description else '' end),
        now() + (private.escalation_sla_minutes('symptom_red_flag', 'urgent_escalation') * interval '1 minute')
      );
    else
      perform private.raise_dangerous_reading_ai_suggestion(
        new.organisation_id, new.patient_id, replace(new.symptom_type::text, '_', ' '), 'Needs prompt attention',
        format('You reported %s at a high severity. This is described in our emergency guidance as needing prompt in-person care — please go to the nearest hospital if it does not settle quickly.', new.symptom_type)
      );
    end if;
  elsif new.severity >= 5 then
    v_has_escalation_access := private.patient_has_feature_access(new.patient_id, 'vitals_red_flag_doctor_escalation');
    if v_has_escalation_access then
      insert into public.clinician_alerts
        (organisation_id, patient_id, level, status, title, detail, sla_due_at)
      values (
        new.organisation_id,
        new.patient_id,
        'clinician_review',
        'open',
        format('Symptom check: %s', new.symptom_type),
        format('Patient reported %s at severity %s/10.%s',
               new.symptom_type, new.severity,
               case when new.description is not null then ' Note: ' || new.description else '' end),
        now() + (private.escalation_sla_minutes('symptom_red_flag', 'clinician_review') * interval '1 minute')
      );
    else
      perform private.raise_dangerous_reading_ai_suggestion(
        new.organisation_id, new.patient_id, replace(new.symptom_type::text, '_', ' '), 'Review needed',
        format('You reported %s at a moderate severity. Keep an eye on it and note if it changes; if it persists beyond a day or two, or gets worse, please seek in-person care.', new.symptom_type)
      );
    end if;
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Assertions — the migration is the test.
-- ---------------------------------------------------------------------------
do $$
declare
  v_val integer;
begin
  v_val := private.escalation_sla_minutes('spo2_vitals_red_flag', 'urgent_escalation');
  if v_val <> 30 then raise exception 'FAIL: spo2_vitals_red_flag/urgent_escalation = % (expected 30)', v_val; end if;

  v_val := private.escalation_sla_minutes('spo2_vitals_red_flag', 'clinician_review');
  if v_val <> 4320 then raise exception 'FAIL: spo2_vitals_red_flag/clinician_review = % (expected 4320)', v_val; end if;

  v_val := private.escalation_sla_minutes('temperature_vitals_red_flag', 'urgent_escalation');
  if v_val <> 60 then raise exception 'FAIL: temperature_vitals_red_flag/urgent_escalation = % (expected 60)', v_val; end if;

  v_val := private.escalation_sla_minutes('temperature_vitals_red_flag', 'clinician_review');
  if v_val <> 4320 then raise exception 'FAIL: temperature_vitals_red_flag/clinician_review = % (expected 4320)', v_val; end if;

  v_val := private.escalation_sla_minutes('symptom_red_flag', 'urgent_escalation');
  if v_val <> 240 then raise exception 'FAIL: symptom_red_flag/urgent_escalation = % (expected 240)', v_val; end if;

  v_val := private.escalation_sla_minutes('symptom_red_flag', 'clinician_review');
  if v_val <> 4320 then raise exception 'FAIL: symptom_red_flag/clinician_review = % (expected 4320)', v_val; end if;

  -- Every pre-existing (pathway, tier) pair from v3 must still resolve —
  -- carrying the config forward via `v3.config || ...` must not have
  -- dropped anything.
  v_val := private.escalation_sla_minutes('screening_abnormal_result', 'emergency');
  if v_val <> 120 then raise exception 'FAIL: screening_abnormal_result/emergency = % (expected 120, v3 config not carried forward correctly)', v_val; end if;

  v_val := private.escalation_sla_minutes('bp_vitals_red_flag', 'urgent_escalation');
  if v_val <> 60 then raise exception 'FAIL: bp_vitals_red_flag/urgent_escalation = % (expected 60)', v_val; end if;

  if (select count(*) from public.escalation_slas where is_active) <> 1 then
    raise exception 'FAIL: expected exactly one active escalation_slas version';
  end if;

  raise notice 'PASS: escalation_slas v4 active with spo2/temperature/symptom_red_flag registered; all values resolve correctly';
end $$;
