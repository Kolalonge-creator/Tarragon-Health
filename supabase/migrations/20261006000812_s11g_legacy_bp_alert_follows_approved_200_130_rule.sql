-- S11g: the older server alert path follows the Chief Medical Officer's 200/130 decision once the rule set is APPROVED.
-- Until a bp_care_triage rule set is approved nothing below changes behaviour (private.approved_bp_rule_params() is null).
--  * handle_bp_reading_red_flag: with an approved rule set, the old emergency range (diastolic 120 or systolic 200) with no
--    red-flag symptom within 10 minutes, and not in pregnancy or postpartum, is raised as the Priority 1 alert ("rest 5
--    minutes and recheck, review same day") but NOT as a patient emergency record. A symptom keeps it an emergency.
--  * handle_symptom_red_flag: a red-flag symptom answered just after such a reading opens the emergency record then (BP-R1),
--    once per 6 hours, because the question is answered after the reading is saved.
--  * The 160/100 and 135/85 bands are unchanged: aligning them is the S12 band alignment of OQ-67.
-- Function bodies are the live definitions plus the blocks marked S11g.
create or replace function private.approved_bp_rule_params()
returns jsonb language sql stable security definer set search_path = '' as $$
  select rules -> 'params' from public.triage_rule_sets where code = 'bp_care_triage' and status = 'approved' limit 1;
$$;
create or replace function private.bp_red_flag_symptom_near(p_patient uuid, p_at timestamptz, p_params jsonb)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.symptoms s
     where s.patient_id = p_patient
       and s.symptom_type::text in (select jsonb_array_elements_text(p_params #> '{symptomGroups,redFlag}'))
       and s.created_at between p_at - interval '10 minutes' and p_at + interval '10 minutes');
$$;
create or replace function private.bp_is_postpartum(p_patient uuid, p_at timestamptz, p_params jsonb)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.postnatal_profiles pn
     where pn.patient_id = p_patient
       and pn.delivery_date <= (p_at at time zone 'Africa/Lagos')::date
       and pn.delivery_date > (p_at at time zone 'Africa/Lagos')::date - coalesce((p_params #>> '{postpartum,windowDays}')::int, 42));
$$;
revoke all on function private.approved_bp_rule_params(), private.bp_red_flag_symptom_near(uuid, timestamptz, jsonb),
  private.bp_is_postpartum(uuid, timestamptz, jsonb) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION private.handle_bp_reading_red_flag()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  v_params    jsonb;
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

  -- S11g (CMO decision 2026-10-05): once the Chief Medical Officer has approved the triage rule set, a reading in the
  -- old emergency range with NO emergency symptom (and not in pregnancy or the weeks after a birth) is not a patient
  -- emergency: the patient is told to take their medicine, rest and recheck, and the care team still gets the Priority 1
  -- alert below. A symptom in the 10 minutes either side keeps it an emergency. Until approval this changes nothing.
  v_params := private.approved_bp_rule_params();
  if v_params is not null and v_level = 'emergency' and not coalesce(v_pregnant, false)
     and not private.bp_is_postpartum(new.patient_id, new.created_at, v_params)
     and not private.bp_red_flag_symptom_near(new.patient_id, new.created_at, v_params) then
    v_level := 'red';
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
    -- No `and phone is not null`. The first channel for this pathway is push,
    -- which needs no phone; an sms hop that does is failed per-hop by
    -- send-pending-notifications with "recipient has no phone number on file".
    for r in
      select * from public.profiles
      where organisation_id = new.organisation_id and role = 'clinician'
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
$function$
;

CREATE OR REPLACE FUNCTION private.handle_symptom_red_flag()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_low_threshold_types public.symptom_type[] := array[
    'breathlessness', 'palpitations', 'swelling',
    'chest_pain', 'severe_headache', 'visual_disturbance', 'confusion',
    'testicular_pain',
    -- S11e: the emergency-symptom question's other answers (CMO decision 2026-10-05) page like the rest.
    'weakness_or_numbness', 'difficulty_speaking', 'back_pain'
  ];
  v_is_red_flag boolean;
  v_has_escalation_access boolean;
  v_params jsonb;
  v_bp public.vitals_readings%rowtype;
begin
  v_is_red_flag := (
    new.severity >= 8
    or (new.symptom_type = any (v_low_threshold_types) and new.severity >= 6)
  );
  new.is_red_flag := v_is_red_flag;

  -- S11g: the answer to the emergency-symptom question arrives AFTER the reading it is about. With an approved rule set, a
  -- red-flag symptom within 15 minutes of a reading at or above the severe line (BP-R1) is the emergency the reading alone
  -- was not (see handle_bp_reading_red_flag), so it opens the same emergency record, once per 6 hours.
  if v_is_red_flag then
    v_params := private.approved_bp_rule_params();
    if v_params is not null and new.symptom_type::text in (select jsonb_array_elements_text(v_params #> '{symptomGroups,redFlag}')) then
      select * into v_bp from public.vitals_readings vr
       where vr.patient_id = new.patient_id and vr.vital_type = 'blood_pressure' and vr.systolic is not null and vr.diastolic is not null
         and vr.created_at between now() - interval '15 minutes' and now()
       order by vr.created_at desc limit 1;
      if found and (v_bp.systolic >= (v_params #>> '{severe,systolic}')::int or v_bp.diastolic >= (v_params #>> '{severe,diastolic}')::int)
         and not exists (select 1 from public.emergency_events e
                          where e.patient_id = new.patient_id and e.source = 'bp_reading' and e.status = 'active'
                            and e.created_at > now() - interval '6 hours') then
        insert into public.emergency_events (organisation_id, patient_id, source, trigger_detail, status, vital_reading_id)
        values (new.organisation_id, new.patient_id, 'bp_reading',
                format('Home BP reading %s/%s mmHg with an emergency symptom (%s). This is in the hypertensive-crisis range.',
                       v_bp.systolic, v_bp.diastolic, new.symptom_type),
                'active', v_bp.id);
      end if;
    end if;
  end if;

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
$function$
;
