-- Tarragon Health — Category 2 -> 1 upgrade: private.handle_abnormal_screening_result()
-- (supabase/migrations/20260711211535_abnormal_result_handler_trigger.sql, redefined by
-- 20260730105131_v3_port_escalation_sla_config.sql).
--
-- Live proof this platform's single highest-priority business event (CLAUDE.md: "Abnormal
-- result -> Category 1 upgrade ... never lose it, never let it fail silently") actually fires
-- correctly. Found during the 2026-09-02 preventative-screening audit that screening_results,
-- screening_upgrades, and prevention_risk_scores all had zero real rows in production — the
-- only historical evidence the trigger had ever run was a one-off manual smoke test. This test
-- closes that gap permanently: every insert path the trigger has to classify correctly, proven
-- in a rolled-back transaction rather than against real patient data.
--
-- Cases:
--   1. 'normal' result -> no screening_upgrades row, no clinician_alerts row (trigger no-ops).
--   2. 'abnormal' + bp flag -> condition_triggered='hypertension', clinician_alerts.level=
--      'urgent_escalation', sla_due_at ~1440 min out (escalation_slas: screening_abnormal_result/
--      urgent_escalation), title 'Priority 1: abnormal screening result'.
--   3. 'critical' + glucose flag -> condition_triggered='diabetes', level='emergency',
--      sla_due_at ~120 min out.
--   4. 'abnormal' + fit flag (a screen_types.sensitive=true type; sex-neutral, unlike psa/
--      mammography/cervical, which are gated to one sex by private.enforce_psa_sdm_gate() and
--      similar checks the test's fixture patient may not satisfy) -> condition_triggered=
--      'cancer_referral', screening_upgrades row links back to the result, sensitive inferred
--      true from the flag itself even without checking screen_types.
--   5. 'abnormal' with an unmapped flag -> condition_triggered='other' (never null, never errors).
--
-- Every case below uses a DISTINCT screen_type_code, deliberately. private.flag_screening_result_
-- discrepancy() (a separate, legitimate AFTER INSERT trigger on this table) raises its own extra
-- clinician_alerts row whenever the same patient gets two results of the SAME screen_type_code
-- within 14 days that disagree (e.g. normal then abnormal) — reusing a code across cases here
-- would make the alert-count/level assertions below ambiguous between two independently-correct
-- triggers, not a bug in either one. Found by this test's own first draft colliding on
-- 'blood_pressure' between what are now cases 1 and 2.
--
-- Run: npx supabase db query --linked -f packages/db/tests/abnormal_screening_result_upgrade.sql

begin;

create temp table probe (k text, v text);

do $$
declare
  v_org uuid;
  v_patient uuid;
  v_result_id uuid;
begin
  select organisation_id into v_org from public.profiles where role = 'patient' limit 1;
  select id into v_patient from public.profiles where role = 'patient' and organisation_id = v_org limit 1;

  -- Case 1: normal result -> no upgrade, no alert.
  insert into public.screening_results (organisation_id, patient_id, result_status, screen_type_code, abnormal_flags)
  values (v_org, v_patient, 'normal', 'ferritin', array[]::text[])
  returning id into v_result_id;

  insert into probe values ('case1_upgrade_count',
    (select count(*)::text from public.screening_upgrades where screening_result_id = v_result_id));
  insert into probe values ('case1_alert_count',
    (select count(*)::text from public.clinician_alerts where screening_result_id = v_result_id));

  -- Case 2: abnormal + bp flag -> hypertension, urgent_escalation, ~24h SLA.
  insert into public.screening_results (organisation_id, patient_id, result_status, screen_type_code, abnormal_flags)
  values (v_org, v_patient, 'abnormal', 'blood_pressure', array['bp'])
  returning id into v_result_id;

  insert into probe values ('case2_condition',
    (select condition_triggered::text from public.screening_upgrades where screening_result_id = v_result_id));
  insert into probe values ('case2_alert_level',
    (select level::text from public.clinician_alerts
     where screening_result_id = v_result_id and title = 'Priority 1: abnormal screening result'));
  insert into probe values ('case2_alert_title',
    (select title from public.clinician_alerts
     where screening_result_id = v_result_id and title = 'Priority 1: abnormal screening result'));
  insert into probe values ('case2_sla_within_1440_1441_min',
    ((select sla_due_at from public.clinician_alerts
      where screening_result_id = v_result_id and title = 'Priority 1: abnormal screening result')
       between now() + interval '1439 minutes' and now() + interval '1441 minutes')::text);

  -- Case 3: critical + glucose flag -> diabetes, emergency, ~2h SLA.
  insert into public.screening_results (organisation_id, patient_id, result_status, screen_type_code, abnormal_flags)
  values (v_org, v_patient, 'critical', 'hba1c', array['glucose'])
  returning id into v_result_id;

  insert into probe values ('case3_condition',
    (select condition_triggered::text from public.screening_upgrades where screening_result_id = v_result_id));
  insert into probe values ('case3_alert_level',
    (select level::text from public.clinician_alerts
     where screening_result_id = v_result_id and title = 'Priority 1: abnormal screening result'));
  insert into probe values ('case3_sla_within_119_121_min',
    ((select sla_due_at from public.clinician_alerts
      where screening_result_id = v_result_id and title = 'Priority 1: abnormal screening result')
       between now() + interval '119 minutes' and now() + interval '121 minutes')::text);

  -- Case 4: abnormal + fit flag -> cancer_referral, upgrade correctly linked back to the result.
  insert into public.screening_results (organisation_id, patient_id, result_status, screen_type_code, abnormal_flags)
  values (v_org, v_patient, 'abnormal', 'fit', array['fit'])
  returning id into v_result_id;

  insert into probe values ('case4_condition',
    (select condition_triggered::text from public.screening_upgrades where screening_result_id = v_result_id));
  insert into probe values ('case4_upgrade_links_back',
    ((select screening_result_id from public.screening_upgrades where screening_result_id = v_result_id) = v_result_id)::text);

  -- Case 5: abnormal with an unmapped flag -> 'other', never errors, never null.
  insert into public.screening_results (organisation_id, patient_id, result_status, screen_type_code, abnormal_flags)
  values (v_org, v_patient, 'abnormal', 'vision_check', array['unmapped_flag_xyz'])
  returning id into v_result_id;

  insert into probe values ('case5_condition',
    (select condition_triggered::text from public.screening_upgrades where screening_result_id = v_result_id));
end $$;

-- Expect: case1_upgrade_count=0, case1_alert_count=0,
-- case2_condition=hypertension, case2_alert_level=urgent_escalation,
--   case2_alert_title='Priority 1: abnormal screening result', case2_sla_within_1440_1441_min=true,
-- case3_condition=diabetes, case3_alert_level=emergency, case3_sla_within_119_121_min=true,
-- case4_condition=cancer_referral, case4_upgrade_links_back=true,
-- case5_condition=other.
select * from probe order by k;

rollback;
