-- Tarragon Health — gate dangerous vitals/symptom-reading DOCTOR escalation to
-- paid plans. Founder decision 2026-08-10: Tarragon Free is self-tracking —
-- nobody schedules anything for a Free patient, and a doctor reading a raw
-- vitals/symptom red flag for a patient who isn't paying for review spends
-- real clinician time for no platform benefit (same reasoning already applied
-- to routine document review in 20260804232022_gate_result_document_review_to_
-- paid_plans.sql, whose private.patient_has_feature_access() helper this
-- migration reuses unchanged). What changes on Free: a dangerous reading no
-- longer reaches a doctor. What does NOT change on Free: the reading is still
-- classified by the same deterministic thresholds, the patient still gets an
-- immediate, specific self-care suggestion, and — for the emergency tier only
-- — every existing patient-safety mechanism stays on for every plan: the
-- acknowledge-gated "go to the nearest hospital now" dialog
-- (useActiveEmergency reads emergency_events directly, never clinician_alert_
-- id), the emergency-contact auto-notify, and the follow-up-after-discharge
-- check-in. Those are the patient's own emergency protocol, not doctor
-- escalation, so they are untouched here.
--
-- Explicitly NOT touched by this migration, matching the founder's own scope
-- decision: the abnormal screening result pipeline (Category 2->1 upgrade via
-- private.handle_abnormal_screening_result, screening_results.result_status
-- in ('abnormal','critical')). That trigger keeps firing on every plan,
-- unconditionally — CLAUDE.md's "never deprioritise or silently swallow an
-- abnormal screening result event" and the 2026-08-04 migration's own carve-
-- out both still apply. This migration only ever touches an alert/event whose
-- clinician_alerts row is raised via vital_reading_id or a symptom-log/
-- danger-symptom-checklist source — never one carrying screening_result_id.
--
-- Gated pathways (every one of them a direct clinician_alerts insert/update,
-- confirmed against the LIVE function bodies, not just the migration files —
-- private.handle_symptom_red_flag() has drifted since its original migration
-- to insert clinician_alerts directly instead of routing through
-- emergency_events, so it needs its own gate, not just handle_emergency_
-- event()'s):
--   * private.handle_emergency_event()            — EMERGENCY tier, every
--     source (bp_reading, spo2_red_flag, temperature_red_flag, glucose_
--     red_flag, danger_symptom_checklist, symptom_log's severity>=8 branch).
--     Single choke point — one gate fixes every emergency source at once.
--   * private.handle_bp_reading_red_flag()         — RED/AMBER tier
--   * private.handle_spo2_reading_red_flag()       — RED/AMBER tier
--   * private.handle_temperature_reading_red_flag()— RED/AMBER tier
--   * private.handle_symptom_red_flag()            — severity 5-7 branch
-- Glucose's RED/AMBER tier is gated separately in TypeScript
-- (apps/web/src/lib/vitals/assess-glucose.ts raiseGlucoseAlert) because it
-- never runs as a DB trigger — see that file's own header for why. The
-- ai_coach emergency source pre-creates its own clinician_alert_id via
-- logAiCoachEscalation before calling into emergency_events (handle_
-- emergency_event only fires the block below when clinician_alert_id is
-- still null), so it is naturally untouched by this change — a conversational
-- AI Coach escalation is a different mechanism, out of this founder decision's
-- stated scope ("a dangerous reading").

-- ---------------------------------------------------------------------------
-- 1. Grant the new feature to every paid tier, every currency/interval
--    variant — same idiom as result_document_review's grant. Free is
--    deliberately excluded; that is the entire point.
-- ---------------------------------------------------------------------------
update public.subscription_plans
  set features = (select array(select distinct unnest(coalesce(features, '{}') || array['vitals_red_flag_doctor_escalation'])))
  where (code like 'prevent%' or code like 'essential%' or code like 'complete%')
    and not ('vitals_red_flag_doctor_escalation' = any(coalesce(features, '{}')));

-- ---------------------------------------------------------------------------
-- 2. Shared helper: the Free-tier alternative to doctor escalation. Inserts
--    an in_app notification (same channel/table the NotificationBell already
--    reads — see apps/web/src/lib/queries/notifications.ts) addressed to the
--    PATIENT, never a clinician. Deterministic self-care copy, not a live AI
--    call — the same "deterministic thresholds, not ML" discipline the
--    red-flag engines themselves already follow (see spo2_red_flag_engine.sql
--    §2's header). p_self_care_note is written per call-site, specific to the
--    vital/level that raised it.
-- ---------------------------------------------------------------------------
create or replace function private.raise_dangerous_reading_ai_suggestion(
  p_organisation_id uuid,
  p_patient_id uuid,
  p_vital_label text,
  p_level_label text,
  p_self_care_note text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.notifications
    (organisation_id, recipient_id, channel, status, template, payload)
  values (
    p_organisation_id, p_patient_id, 'in_app', 'pending',
    'free_tier_reading_self_care_suggestion',
    jsonb_build_object(
      'vital_label', p_vital_label,
      'level_label', p_level_label,
      'self_care_note', p_self_care_note
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. private.handle_emergency_event() — gate the clinician_alerts insert +
--    paging loop only. Full body copied forward from the live definition
--    (confirmed via pg_get_functiondef against the koiplnmbgnqnbywhpjlf
--    project, 2026-08-10) with one inserted branch; nothing else changes,
--    including the emergency_events row itself, the acknowledge-gated
--    hospital-now dialog, the emergency-contact auto-notify, and the
--    follow-up-after-discharge check-in — none of those read clinician_
--    alert_id, so a free-tier patient keeps every one of them.
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

-- ---------------------------------------------------------------------------
-- 4. RED/AMBER-tier triggers — BP, SpO2, temperature. Full bodies copied
--    forward from the live definitions, one gate inserted around the
--    clinician_alerts insert/update + paging block each.
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
  v_has_escalation_access boolean;
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

  v_has_escalation_access := private.patient_has_feature_access(new.patient_id, 'vitals_red_flag_doctor_escalation');

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

  if v_has_escalation_access then
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
  else
    perform private.raise_dangerous_reading_ai_suggestion(
      new.organisation_id, new.patient_id, 'blood pressure', v_level_label,
      'Sit down and rest quietly for 5 minutes, then recheck your blood pressure. Avoid caffeine and salty food for the rest of the day. If it stays this high, or you get a headache, chest pain, or blurred vision, seek care promptly.'
    );
  end if;

  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (new.organisation_id, new.patient_id, 'bp_red_flag.raised', 'vitals_readings', new.id,
    jsonb_build_object('level', v_level, 'systolic', new.systolic, 'diastolic', new.diastolic, 'pregnant', v_pregnant,
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
-- 5. private.handle_symptom_red_flag() — live definition (confirmed via
--    pg_get_functiondef) inserts clinician_alerts DIRECTLY for both branches;
--    it does not route through emergency_events despite the original
--    emergency_escalation.sql migration doing so (drifted in
--    20260810003553_symptom_types_from_documented_red_flags.sql), so it needs
--    its own gate on both branches, not just handle_emergency_event()'s.
--    new.is_red_flag is left unconditional — that is a factual property of
--    the reading, not an escalation artifact.
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
        now() + interval '4 hours'
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
        (organisation_id, patient_id, level, status, title, detail)
      values (
        new.organisation_id,
        new.patient_id,
        'clinician_review',
        'open',
        format('Symptom check: %s', new.symptom_type),
        format('Patient reported %s at severity %s/10.%s',
               new.symptom_type, new.severity,
               case when new.description is not null then ' Note: ' || new.description else '' end)
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
-- 6. Assertions — schema/registration level, mirroring
--    gate_result_document_review_to_paid_plans.sql's own style. Behavioural
--    coverage (a free-tier reading raises no clinician_alerts row and does
--    raise the in_app suggestion; a paid-tier reading is unaffected) lives in
--    packages/db/tests/vitals_red_flag_plan_gate.sql — a migration must not
--    fabricate patient data (see glucose_emergency_db_backstop.sql's own
--    rationale for the same split).
-- ---------------------------------------------------------------------------
do $$
declare
  v_missing_plans text;
  v_free_has_feature boolean;
begin
  select string_agg(code, ', ') into v_missing_plans
  from public.subscription_plans
  where (code like 'prevent%' or code like 'essential%' or code like 'complete%')
    and not ('vitals_red_flag_doctor_escalation' = any(coalesce(features, '{}')));
  if v_missing_plans is not null then
    raise exception 'FAIL: paid plans missing vitals_red_flag_doctor_escalation: %', v_missing_plans;
  end if;

  select ('vitals_red_flag_doctor_escalation' = any(coalesce(features, '{}'))) into v_free_has_feature
  from public.subscription_plans where code = 'free';
  if coalesce(v_free_has_feature, false) then
    raise exception 'FAIL: free plan unexpectedly granted vitals_red_flag_doctor_escalation';
  end if;

  if not exists (
    select 1 from pg_proc where proname = 'raise_dangerous_reading_ai_suggestion' and pronamespace = 'private'::regnamespace
  ) then
    raise exception 'FAIL: private.raise_dangerous_reading_ai_suggestion was not created';
  end if;

  raise notice 'PASS: vitals_red_flag_doctor_escalation granted to paid plans only, suggestion helper present';
end $$;
