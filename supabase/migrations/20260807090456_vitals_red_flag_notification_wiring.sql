-- Tarragon Health — wire vitals red-flag pathways into the critical-
-- notification paging engine
--
-- Confirmed by reading the live private.handle_bp_reading_red_flag()
-- (20260730105131_v3_port_escalation_sla_config.sql) and
-- private.handle_emergency_event() (20260801120000_supporter_can_report_and_
-- assess.sql): neither calls private.enqueue_critical_notification. A
-- hypertensive-crisis reading, or any RED/AMBER BP alert, currently only
-- reaches a doctor via the clinician dashboard's 60-second poll
-- (useClinicianAlerts()) — never via the push→WhatsApp→SMS ladder that
-- screening-result abnormalities already get through abnormal-result-
-- handler. That undercuts CLAUDE.md's "immediate, not scheduled" rule for
-- abnormal results: vitals red-flags get worse treatment than screening
-- results today. This migration closes that gap for BP (retroactively) and
-- for the new SpO2/temperature engines added in this same feature.
--
-- Centralization decision: EMERGENCY-tier paging is added ONCE, inside
-- private.handle_emergency_event() — already the single BEFORE INSERT choke
-- point for every emergency-tier source (danger_symptom_checklist,
-- symptom_log, ai_coach, bp_reading, glucose_red_flag, and now
-- spo2_red_flag/temperature_red_flag). This fixes BP- and glucose-emergency
-- paging with one function edit, zero pathway-specific duplication, and
-- needs no new escalation_slas entry (emergency_event/emergency is already
-- seeded: 120 min, push/whatsapp/sms/next_of_kin_call). RED/AMBER-tier
-- paging stays per-trigger (no shared clinician_alerts insert trigger exists
-- today — it's written by many different callers with different shapes;
-- centralizing that too would also page on hospital-admission/referral
-- alert types never in scope here, a materially larger refactor).
--
-- Recipient resolution mirrors supabase/functions/abnormal-result-handler/
-- index.ts (org clinicians with a phone on file — that function applies no
-- active/tier filter today, so none is invented here either).

-- ---------------------------------------------------------------------------
-- 1. New escalation_slas version — copies the current active config forward
--    unchanged and appends the two new pathways. No DB-level "only one
--    active" constraint exists (sign_escalation_slas() enforces it
--    procedurally), so this does the same read/deactivate/insert dance
--    atomically. DRAFT, unsigned — needs Clinical Director sign-off via
--    sign_escalation_slas(), same caveat the v1 seed already carries.
-- ---------------------------------------------------------------------------
with old as (
  select config from public.escalation_slas where is_active limit 1
), deactivated as (
  update public.escalation_slas set is_active = false where is_active returning 1
)
insert into public.escalation_slas (version, config, notes, is_active)
select
  (select coalesce(max(version), 0) + 1 from public.escalation_slas),
  old.config || '[
    {"pathway": "spo2_vitals_red_flag", "tier": "urgent_escalation", "sla_minutes": 30, "channel_sequence": ["push", "whatsapp_nudge"], "source_function": "private.handle_spo2_reading_red_flag", "note": "Red-range SpO2 (90-92%) — tighter SLA than other RED vitals given how fast hypoxia can deteriorate. DRAFT, needs Clinical Director sign-off."},
    {"pathway": "spo2_vitals_red_flag", "tier": "clinician_review", "sla_minutes": 4320, "channel_sequence": ["push, batched"], "source_function": "private.handle_spo2_reading_red_flag", "note": "Amber-range SpO2 (93-94%). DRAFT."},
    {"pathway": "temperature_vitals_red_flag", "tier": "urgent_escalation", "sla_minutes": 60, "channel_sequence": ["push", "whatsapp_nudge"], "source_function": "private.handle_temperature_reading_red_flag", "note": "Red-range fever (>=39.0C, sepsis-relevant). DRAFT."},
    {"pathway": "temperature_vitals_red_flag", "tier": "clinician_review", "sla_minutes": 4320, "channel_sequence": ["push, batched"], "source_function": "private.handle_temperature_reading_red_flag", "note": "Amber-range fever (>=38.0C). DRAFT."}
  ]'::jsonb,
  'v_next — adds spo2_vitals_red_flag / temperature_vitals_red_flag pathways, copies prior config forward unchanged. DRAFT, unsigned — needs Clinical Director sign-off via sign_escalation_slas() before relied upon as attested config (same caveat the v1 seed already carries). Open items for review: mild-hypothermia amber band (35.0-35.7C)?, SpO2''s 30-min urgent SLA is intentionally tighter than BP''s 60-min default given hypoxia''s faster deterioration, should SpO2/temperature share BP''s exact channel_sequence?',
  true
from old;

-- ---------------------------------------------------------------------------
-- 2. Centralize EMERGENCY-tier paging in private.handle_emergency_event().
--    Full body copied forward, byte-identical, from the live definition in
--    20260801120000_supporter_can_report_and_assess.sql, plus the paging
--    loop inside the existing "if new.clinician_alert_id is null" block.
-- ---------------------------------------------------------------------------
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

    -- id is already populated (column default fires before BEFORE triggers).
    new.clinician_alert_id := v_alert_id;

    -- Page the org's clinicians immediately — added 2026-08-07. This is the
    -- single choke point for EVERY emergency-tier source, so wiring paging
    -- here fixes bp_reading/glucose_red_flag/spo2_red_flag/
    -- temperature_red_flag/danger_symptom_checklist/symptom_log/ai_coach all
    -- at once, with no pathway-specific duplication. Previously an
    -- emergency-tier alert only ever reached a doctor via the dashboard's
    -- 60-second poll.
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
                       'patient_id', new.patient_id)
  );

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. RED/AMBER-tier paging, per trigger. Each function's full current body
--    is copied forward unchanged; the only addition is: track the raised/
--    updated alert's id, decide whether this is a genuinely new alert or a
--    severity upgrade (never re-page on a same-severity refresh — matches
--    the existing "never spam the worklist" philosophy), and page on that
--    condition only.
-- ---------------------------------------------------------------------------

create or replace function private.handle_bp_reading_red_flag()
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
  v_t_sys     smallint;
  v_t_dia     smallint;
  v_pregnant  boolean;
  v_alert_id  uuid;
  v_should_page boolean := false;
  v_level_label text;
  r           public.profiles%rowtype;
begin
  if new.vital_type <> 'blood_pressure' then
    return new;
  end if;

  update public.clinician_alerts
    set status = 'resolved', updated_at = now()
  where patient_id = new.patient_id
    and status = 'open'
    and title = 'Missing expected blood-pressure readings';

  v_level := private.classify_bp_level(new.systolic, new.diastolic);

  if v_level = 'green' and new.systolic is not null and new.diastolic is not null then
    select systolic, diastolic into v_t_sys, v_t_dia
    from private.patient_home_bp_target(new.patient_id);
    if new.systolic >= v_t_sys or new.diastolic >= v_t_dia then
      v_level := 'amber';
    end if;
  end if;

  select coalesce(p.is_pregnant, false) into v_pregnant from public.profiles p where p.id = new.patient_id;
  if v_pregnant and new.systolic is not null and new.diastolic is not null then
    if new.systolic >= 160 or new.diastolic >= 110 then
      v_level := 'emergency';
    elsif new.systolic >= 140 or new.diastolic >= 90 then
      if v_level not in ('emergency','red') then v_level := 'red'; end if;
    end if;
  end if;

  if v_level in ('unknown', 'green') then
    return new;
  end if;

  v_detail := format('Home BP reading %s/%s mmHg logged %s.',
                     new.systolic, new.diastolic, to_char(new.taken_at, 'YYYY-MM-DD HH24:MI'));
  if v_pregnant then
    v_detail := v_detail || ' PREGNANT — obstetric red route (§18.1); do not manage routinely on-platform.';
  end if;

  if v_level = 'emergency' then
    if not exists (
      select 1 from public.emergency_events e
      where e.patient_id = new.patient_id and e.source = 'bp_reading'
        and e.status = 'active' and e.created_at > now() - interval '6 hours'
    ) then
      insert into public.emergency_events
        (organisation_id, patient_id, source, trigger_detail, status, vital_reading_id)
      values (new.organisation_id, new.patient_id, 'bp_reading',
        v_detail || case when v_pregnant then ' Possible pre-eclampsia — urgent obstetric care.' else ' This is in the hypertensive-crisis range.' end,
        'active', new.id);
    end if;
    return new;
  end if;

  if v_level = 'red' then
    v_alert_lvl := 'urgent_escalation'; v_esc := 3;
    v_sla := private.escalation_sla_minutes('bp_vitals_red_flag', 'urgent_escalation') * interval '1 minute';
    v_title := case when v_pregnant then 'Priority 1: raised BP in pregnancy' else 'Priority 1: high blood pressure reading' end;
    v_detail := v_detail || ' Please ask the patient to rest 5 minutes and re-check, then review same day.';
    v_level_label := 'Priority 1';
  else
    v_alert_lvl := 'clinician_review'; v_esc := 2;
    v_sla := private.escalation_sla_minutes('bp_vitals_red_flag', 'clinician_review') * interval '1 minute';
    v_title := 'Blood pressure above target';
    v_detail := v_detail || ' Above target — review adherence, technique, lifestyle and titration.';
    v_level_label := 'Review needed';
  end if;

  select * into v_existing
  from public.clinician_alerts
  where patient_id = new.patient_id and vital_reading_id is not null and status = 'open'
  order by created_at desc limit 1;

  if v_existing.id is not null then
    if v_esc >= coalesce(v_existing.escalation_level, 0) then
      update public.clinician_alerts
        set level = v_alert_lvl, escalation_level = v_esc, title = v_title,
            detail = v_detail, sla_due_at = now() + v_sla, vital_reading_id = new.id, updated_at = now()
      where id = v_existing.id;
      v_alert_id := v_existing.id;
      if v_esc > coalesce(v_existing.escalation_level, 0) then
        v_should_page := true;
      end if;
    end if;
  else
    insert into public.clinician_alerts
      (organisation_id, patient_id, level, status, title, detail, sla_due_at, escalation_level, vital_reading_id)
    values (new.organisation_id, new.patient_id, v_alert_lvl, 'open', v_title, v_detail,
      now() + v_sla, v_esc, new.id)
    returning id into v_alert_id;
    v_should_page := true;
  end if;

  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (new.organisation_id, new.patient_id, 'bp_red_flag.raised', 'vitals_readings', new.id,
    jsonb_build_object('level', v_level, 'systolic', new.systolic, 'diastolic', new.diastolic, 'pregnant', v_pregnant));

  if v_should_page then
    for r in
      select * from public.profiles
      where organisation_id = new.organisation_id and role = 'clinician' and phone is not null
    loop
      perform private.enqueue_critical_notification(
        new.organisation_id, r.id, 'vitals_red_flag_clinician_alert',
        jsonb_build_object(
          'patient_name', coalesce((select full_name from public.profiles where id = new.patient_id), 'A patient'),
          'vital_label', 'blood pressure',
          'level_label', v_level_label
        ),
        'bp_vitals_red_flag', v_alert_lvl, 'clinician_alerts', v_alert_id
      );
    end loop;
  end if;

  return new;
end;
$$;

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

  if v_level = 'red' then
    v_alert_lvl := 'urgent_escalation'; v_esc := 3; v_sla := interval '1 hour';
    v_title := 'Priority 1: low oxygen saturation reading';
    v_detail := v_detail || ' Please review same day and confirm reading technique.';
    v_level_label := 'Priority 1';
  else
    v_alert_lvl := 'clinician_review'; v_esc := 2; v_sla := interval '72 hours';
    v_title := 'Oxygen saturation below target';
    v_detail := v_detail || ' Below target — review symptoms and recheck.';
    v_level_label := 'Review needed';
  end if;

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

  insert into public.audit_log
    (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (
    new.organisation_id, new.patient_id, 'spo2_red_flag.raised',
    'vitals_readings', new.id,
    jsonb_build_object('level', v_level, 'spo2_pct', new.spo2_pct)
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

  if v_level = 'red' then
    v_alert_lvl := 'urgent_escalation'; v_esc := 3; v_sla := interval '1 hour';
    v_title := 'Priority 1: high fever reading';
    v_detail := v_detail || ' Sepsis-relevant range — please review same day.';
    v_level_label := 'Priority 1';
  else
    v_alert_lvl := 'clinician_review'; v_esc := 2; v_sla := interval '72 hours';
    v_title := 'Fever reading logged';
    v_detail := v_detail || ' Review symptoms and recheck.';
    v_level_label := 'Review needed';
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

  insert into public.audit_log
    (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (
    new.organisation_id, new.patient_id, 'temperature_red_flag.raised',
    'vitals_readings', new.id,
    jsonb_build_object('level', v_level, 'temperature_c', new.temperature_c)
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
-- 4. Assertions.
-- ---------------------------------------------------------------------------
do $$
declare
  v_active_count integer;
  v_val integer;
begin
  select count(*) into v_active_count from public.escalation_slas where is_active;
  if v_active_count <> 1 then
    raise exception 'FAIL: expected exactly 1 active escalation_slas row, found %', v_active_count;
  end if;

  v_val := private.escalation_sla_minutes('spo2_vitals_red_flag', 'urgent_escalation');
  if v_val <> 30 then raise exception 'FAIL: spo2_vitals_red_flag/urgent_escalation = % (expected 30)', v_val; end if;

  v_val := private.escalation_sla_minutes('spo2_vitals_red_flag', 'clinician_review');
  if v_val <> 4320 then raise exception 'FAIL: spo2_vitals_red_flag/clinician_review = % (expected 4320)', v_val; end if;

  v_val := private.escalation_sla_minutes('temperature_vitals_red_flag', 'urgent_escalation');
  if v_val <> 60 then raise exception 'FAIL: temperature_vitals_red_flag/urgent_escalation = % (expected 60)', v_val; end if;

  v_val := private.escalation_sla_minutes('temperature_vitals_red_flag', 'clinician_review');
  if v_val <> 4320 then raise exception 'FAIL: temperature_vitals_red_flag/clinician_review = % (expected 4320)', v_val; end if;

  -- Prior pathways must still resolve unchanged — proves the config || append
  -- preserved everything, not just the new entries.
  v_val := private.escalation_sla_minutes('bp_vitals_red_flag', 'urgent_escalation');
  if v_val <> 60 then raise exception 'FAIL: bp_vitals_red_flag/urgent_escalation = % (expected 60, config carry-forward broken)', v_val; end if;

  v_val := private.escalation_sla_minutes('emergency_event', 'emergency');
  if v_val <> 120 then raise exception 'FAIL: emergency_event/emergency = % (expected 120, config carry-forward broken)', v_val; end if;

  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where p.proname = 'handle_emergency_event' and n.nspname = 'private'
  ) then
    raise exception 'FAIL: private.handle_emergency_event missing';
  end if;

  raise notice 'PASS: vitals_red_flag_notification_wiring — new pathways resolve, prior config intact, functions present';
end $$;
