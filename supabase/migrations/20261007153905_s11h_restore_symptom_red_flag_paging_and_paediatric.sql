-- S11h: put back what the S11e and S11g rewrites of private.handle_symptom_red_flag dropped.
--
-- What went wrong. The function has been rewritten many times, each migration pasting the whole body. S11e (2026-10-05) and S11g (2026-10-06)
-- were written from an OLDER copy of the body (the testicular-pain version of 20260829101512), not from the newest one
-- (20260905011852). Both are applied live, so the live function lost, since then:
--   1. the loop that PAGES every clinician when a red-flag or moderate symptom raises an alert (`enqueue_critical_notification`, added on
--      2026-09-05 because the handler "raises an alert and pages nobody"). Today a red-flag symptom writes a clinician_alerts row and nobody
--      is notified by this function;
--   2. the paediatric red flags for a child under 5 (poor feeding, lethargy, grunting or retractions, dehydration signs) of 20260829122452.
-- Separately, 20260829122452 had itself dropped `testicular_pain` from the red-flag symptom list (the testicular migration from earlier the
-- same day); S11e put it back, so this version keeps it.
--
-- This migration is the merge of all of them: the 2026-09-05 body (alerts, paging, paediatric), plus testicular pain, plus S11e's three
-- emergency-symptom answers, plus S11g's emergency record for a severe reading followed by a red-flag symptom. Nothing is new in behaviour
-- except that the lost parts are back. It is also the first time the proof `symptom_red_flag_handler_pages_a_clinician.sql` can pass
-- on a database that has S11e and S11g, which is how the loss was found (migration replay of the S11c to S11h restore).
begin;

create or replace function private.handle_symptom_red_flag()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_low_threshold_types public.symptom_type[] := array[
    'breathlessness', 'palpitations', 'swelling',
    'chest_pain', 'severe_headache', 'visual_disturbance', 'confusion',
    'testicular_pain',
    -- S11e: the emergency-symptom question's other answers (CMO decision 2026-10-05) page like the rest.
    'weakness_or_numbness', 'difficulty_speaking', 'back_pain'
  ];
  v_paediatric_types public.symptom_type[] := array[
    'poor_feeding', 'lethargy', 'grunting_or_retractions', 'dehydration_signs'
  ];
  v_dob date;
  v_age_years integer;
  v_is_red_flag boolean;
  v_has_escalation_access boolean;
  v_alert_id uuid;
  v_alert_lvl public.alert_level;
  v_level_label text;
  v_should_page boolean := false;
  r public.profiles%rowtype;
  v_params jsonb;
  v_bp public.vitals_readings%rowtype;
begin
  select date_of_birth into v_dob from public.profiles where id = new.patient_id;
  if v_dob is not null then
    v_age_years := extract(year from age(new.reported_at::date, v_dob));
  end if;

  v_is_red_flag := (
    new.severity >= 8
    or (new.symptom_type = any (v_low_threshold_types) and new.severity >= 6)
    or (v_age_years is not null and v_age_years < 5
        and new.symptom_type = any (v_paediatric_types) and new.severity >= 4)
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
      )
      returning id into v_alert_id;
      v_alert_lvl := 'urgent_escalation';
      v_level_label := 'Priority 1';
      v_should_page := true;
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
      )
      returning id into v_alert_id;
      v_alert_lvl := 'clinician_review';
      v_level_label := 'Review needed';
      v_should_page := true;
    else
      perform private.raise_dangerous_reading_ai_suggestion(
        new.organisation_id, new.patient_id, replace(new.symptom_type::text, '_', ' '), 'Review needed',
        format('You reported %s at a moderate severity. Keep an eye on it and note if it changes; if it persists beyond a day or two, or gets worse, please seek in-person care.', new.symptom_type)
      );
    end if;
  end if;

  if v_should_page then
    -- Deliberately NO phone predicate on this recipient query: hop 1 for symptom_red_flag is push on both tiers, and a later hop that does
    -- need a phone is failed per-hop by send-pending-notifications rather than by dropping the recipient here (see 20260905005842).
    for r in
      select * from public.profiles
      where organisation_id = new.organisation_id and role = 'clinician'
    loop
      perform private.enqueue_critical_notification(
        new.organisation_id, r.id, 'vitals_red_flag_clinician_alert',
        jsonb_build_object(
          'patient_name', coalesce((select full_name from public.profiles where id = new.patient_id), 'A patient'),
          'vital_label', 'reported symptom',
          'level_label', v_level_label
        ),
        'symptom_red_flag', v_alert_lvl, 'clinician_alerts', v_alert_id
      );
    end loop;
  end if;

  return new;
end;
$$;

do $$
declare v_src text;
begin
  select p.prosrc into v_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'private' and p.proname = 'handle_symptom_red_flag';
  if v_src !~ 'enqueue_critical_notification' then raise exception 'S11h self-check: the clinician paging call is missing'; end if;
  if v_src !~ 'role\s*=\s*''clinician''' then raise exception 'S11h self-check: the clinician recipient loop is missing'; end if;
  if v_src ~ 'role\s*=\s*''clinician''\s*and\s*phone\s+is\s+not\s+null' then raise exception 'S11h self-check: recipients must not be filtered on a phone number'; end if;
  if v_src !~ 'v_paediatric_types' then raise exception 'S11h self-check: the paediatric red flags are missing'; end if;
  if v_src !~ 'testicular_pain' then raise exception 'S11h self-check: testicular pain is missing from the red-flag list'; end if;
  if v_src !~ 'weakness_or_numbness' or v_src !~ 'difficulty_speaking' or v_src !~ 'back_pain' then raise exception 'S11h self-check: the S11e emergency answers are missing'; end if;
  if v_src !~ 'approved_bp_rule_params' then raise exception 'S11h self-check: the S11g emergency record is missing'; end if;
end $$;

commit;
