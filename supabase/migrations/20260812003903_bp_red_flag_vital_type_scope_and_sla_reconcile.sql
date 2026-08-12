-- Fix 1: private.handle_bp_reading_red_flag()'s "existing open alert" lookup
-- was the one vitals-red-flag trigger NOT scoped by vital_type (flagged
-- 2026-08-07, deliberately deferred, still open as of this audit). A
-- patient's most recent open alert could be an unrelated SpO2/temperature red
-- flag (those also set vital_reading_id); a later qualifying BP reading would
-- find it and overwrite its title/detail/level/sla_due_at with BP content,
-- silently discarding the earlier hypoxia/fever concern. Scope it the same
-- way handle_spo2_reading_red_flag/handle_temperature_reading_red_flag
-- already do: join back to vitals_readings and filter on vital_type.
--
-- Fix 2: reconciles handle_spo2_reading_red_flag/handle_temperature_reading_red_flag/
-- handle_symptom_red_flag against their current, verified-correct LIVE bodies.
-- The committed migration gate_vitals_red_flag_escalation_to_paid_plans.sql
-- pasted in stale pre-fix_vitals_red_flag_sla_config_drift bodies for these
-- three functions when adding the plan gate (hardcoded SLA intervals instead
-- of private.escalation_sla_minutes(...), and the symptom_red_flag
-- clinician_review branch omitted sla_due_at entirely). Production was
-- separately corrected afterward, but the fix was never captured as its own
-- committed migration -- so a fresh `supabase db reset` or a new environment
-- would rebuild the REGRESSED version today. This migration is a no-op
-- against current production (bodies already match) and exists purely to
-- make replaying migrations from scratch match live state.

create or replace function private.handle_bp_reading_red_flag()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
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
    -- Scoped by vital_type (join back to vitals_readings), matching the
    -- SpO2/temperature triggers -- previously unscoped, so a patient's most
    -- recent open alert of ANY vital type could be silently overwritten with
    -- BP content.
    select ca.* into v_existing
    from public.clinician_alerts ca
    join public.vitals_readings vr on vr.id = ca.vital_reading_id
    where ca.patient_id = new.patient_id
      and vr.vital_type = 'blood_pressure'
      and ca.status = 'open'
    order by ca.created_at desc
    limit 1;

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
$function$;

create or replace function private.handle_spo2_reading_red_flag()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
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
$function$;

create or replace function private.handle_temperature_reading_red_flag()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
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
$function$;

create or replace function private.handle_symptom_red_flag()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
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
$function$;
