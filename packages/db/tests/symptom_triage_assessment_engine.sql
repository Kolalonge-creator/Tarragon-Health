-- Tarragon Health — Symptom Assessment & Triage Engine verification
-- (platform brief §37; supabase/migrations/20260829091247_*,
-- 20260829092518_*, 20260829093804_*, 20260829094911_*).
--
-- Proves:
--   1. category='emergency' raises a linked emergency_events row
--      (source='symptom_triage'); its own existing handle_emergency_event
--      trigger cascades from there.
--   2. category='urgent' on a patient WITH doctor-escalation plan access
--      raises a linked clinician_alerts row (level=urgent_escalation,
--      type_code=symptom_escalation).
--   3. category='urgent' on a patient WITHOUT plan access raises NO
--      clinician_alerts row, but does raise the Free-tier self-care
--      notification instead (CLAUDE.md's vitals/symptom-escalation
--      plan-gate carve-out applies here too).
--   4. clinician_review_required=true on a routine/self_management outcome
--      forces a SEPARATE clinician_review alert (§37.9).
--   5. A plain routine/self_management outcome with no review flag raises
--      no alerts or events at all — no false escalation noise.
--   6. RLS actually blocks a direct authenticated insert (not just "no
--      grant" — a real simulated session, matching the pattern in
--      acting_for_someone.sql) — the classification can only ever be
--      written by the service role after recomputing it server-side.
--
-- The escalation_slas 'symptom_triage' pathway entries are seeded as an
-- unsigned draft (see 20260829092518_*) — this test temporarily flips it
-- active for the duration of the transaction so private.escalation_sla_minutes
-- resolves, then rolls everything back. Nothing here is ever committed.
--
--   npx supabase db query --linked -f packages/db/tests/symptom_triage_assessment_engine.sql

begin;

update public.escalation_slas set is_active = false where is_active;
update public.escalation_slas set is_active = true
  where id = (
    select id from public.escalation_slas c, jsonb_array_elements(c.config) e
    where e->>'pathway' = 'symptom_triage' and e->>'tier' = 'urgent_escalation'
    order by c.version desc limit 1
  );

do $$
declare
  v_org uuid;
  v_paid_patient uuid;
  v_free_patient uuid;
  v_assessment_id uuid;
  v_clinician_alert_id uuid;
  v_review_alert_id uuid;
  v_emergency_event_id uuid;
  v_notif_count int;
  v_alert_count int;
  v_event_count int;
begin
  select p.id, p.organisation_id into v_paid_patient, v_org
  from public.profiles p
  join public.subscriptions s on s.subscriber_id = p.id and s.status in ('active', 'trialing')
  join public.subscription_plans pl on pl.id = s.plan_id
  where p.role = 'patient'
    and (pl.code like 'prevent%' or pl.code like 'essential%' or pl.code like 'complete%')
  limit 1;

  select id into v_free_patient
  from public.profiles p
  where p.role = 'patient' and p.organisation_id = v_org
    and not private.patient_has_feature_access(p.id, 'vitals_red_flag_doctor_escalation')
  limit 1;

  if v_paid_patient is null or v_free_patient is null then
    raise exception 'FAIL: test fixture needs a paid-plan patient and a free-plan patient in the same org — seed data missing';
  end if;

  -- 1) EMERGENCY: fired red flag -> linked emergency_events row.
  insert into public.symptom_triage_assessments
    (organisation_id, patient_id, presenting_complaint_key, protocol_version,
     initial_capture, category, clinician_review_required, safety_net_message_key, rationale)
  values
    (v_org, v_paid_patient, 'headache', 1,
     '{"onset":"sudden","severity":9}'::jsonb, 'emergency', false, 'redflag.headache.thunderclap_onset',
     'Red-flag screen fired: headache.thunderclap_onset')
  returning id, emergency_event_id into v_assessment_id, v_emergency_event_id;

  if v_emergency_event_id is null then
    raise exception 'FAIL: emergency category did not populate emergency_event_id';
  end if;
  select count(*) into v_event_count from public.emergency_events
  where id = v_emergency_event_id and source = 'symptom_triage' and patient_id = v_paid_patient;
  if v_event_count <> 1 then
    raise exception 'FAIL: expected 1 emergency_events row with source=symptom_triage, found %', v_event_count;
  end if;
  raise notice 'PASS 1: emergency category created a linked emergency_events row';

  -- 2) URGENT, paid plan -> linked clinician_alerts row.
  insert into public.symptom_triage_assessments
    (organisation_id, patient_id, presenting_complaint_key, protocol_version,
     initial_capture, category, clinician_review_required, safety_net_message_key, rationale)
  values
    (v_org, v_paid_patient, 'headache', 1,
     '{"onset":"gradual","severity":8}'::jsonb, 'urgent', false, 'headache.urgent_severe',
     'Severe pain without a clear non-urgent explanation')
  returning id, clinician_alert_id into v_assessment_id, v_clinician_alert_id;

  if v_clinician_alert_id is null then
    raise exception 'FAIL: urgent category (paid plan) did not populate clinician_alert_id';
  end if;
  select count(*) into v_alert_count from public.clinician_alerts
  where id = v_clinician_alert_id and level = 'urgent_escalation' and type_code = 'symptom_escalation';
  if v_alert_count <> 1 then
    raise exception 'FAIL: expected 1 urgent_escalation/symptom_escalation clinician_alerts row, found %', v_alert_count;
  end if;
  raise notice 'PASS 2: urgent category (paid plan) created a clinician_alerts row';

  -- 3) URGENT, free plan -> no clinician_alerts row, self-care notification instead.
  select count(*) into v_notif_count from public.notifications
  where recipient_id = v_free_patient and template = 'free_tier_reading_self_care_suggestion';

  insert into public.symptom_triage_assessments
    (organisation_id, patient_id, presenting_complaint_key, protocol_version,
     initial_capture, category, clinician_review_required, safety_net_message_key, rationale)
  values
    (v_org, v_free_patient, 'headache', 1,
     '{"onset":"gradual","severity":8}'::jsonb, 'urgent', false, 'headache.urgent_severe',
     'Severe pain without a clear non-urgent explanation')
  returning id, clinician_alert_id into v_assessment_id, v_clinician_alert_id;

  if v_clinician_alert_id is not null then
    raise exception 'FAIL: urgent category (free plan) should NOT create a clinician_alerts row';
  end if;
  if (select count(*) from public.notifications
      where recipient_id = v_free_patient and template = 'free_tier_reading_self_care_suggestion') <= v_notif_count then
    raise exception 'FAIL: urgent category (free plan) should raise a free-tier self-care notification';
  end if;
  raise notice 'PASS 3: urgent category (free plan) gated the clinician alert and raised a self-care notification instead';

  -- 4) clinician_review_required on a routine outcome -> forced clinician_review alert.
  insert into public.symptom_triage_assessments
    (organisation_id, patient_id, presenting_complaint_key, protocol_version,
     initial_capture, category, clinician_review_required, safety_net_message_key, rationale)
  values
    (v_org, v_paid_patient, 'chest_pain', 1,
     '{"onset":"gradual","severity":3}'::jsonb, 'routine', true, 'generic.fallback_review',
     'Triage graph reached an unexpected state')
  returning id, clinician_review_alert_id into v_assessment_id, v_review_alert_id;

  if v_review_alert_id is null then
    raise exception 'FAIL: clinician_review_required=true on a routine outcome did not create a review alert';
  end if;
  select count(*) into v_alert_count from public.clinician_alerts
  where id = v_review_alert_id and level = 'clinician_review';
  if v_alert_count <> 1 then
    raise exception 'FAIL: expected 1 clinician_review clinician_alerts row, found %', v_alert_count;
  end if;
  raise notice 'PASS 4: clinician_review_required forced a clinician_review alert on a routine outcome';

  -- 5) Plain self_management outcome, no review flag -> nothing raised at all.
  insert into public.symptom_triage_assessments
    (organisation_id, patient_id, presenting_complaint_key, protocol_version,
     initial_capture, category, clinician_review_required, safety_net_message_key, rationale)
  values
    (v_org, v_paid_patient, 'headache', 1,
     '{"onset":"gradual","severity":2}'::jsonb, 'self_management', false, 'headache.self_mild',
     'Mild, non-red-flag headache')
  returning id, clinician_alert_id, clinician_review_alert_id, emergency_event_id
  into v_assessment_id, v_clinician_alert_id, v_review_alert_id, v_emergency_event_id;

  if v_clinician_alert_id is not null or v_review_alert_id is not null or v_emergency_event_id is not null then
    raise exception 'FAIL: plain self_management outcome should raise no alerts/events at all';
  end if;
  raise notice 'PASS 5: plain self_management outcome raised no alerts';
end $$;

------------------------------------------------------------------
-- 6) RLS: a real authenticated session cannot insert a forged
-- classification directly, regardless of table-level grants (statement
-- level, not inside the DO block above — see acting_for_someone.sql's note
-- on why RLS role switches must happen between top-level statements).
------------------------------------------------------------------
select set_config('request.jwt.claims',
  json_build_object(
    'sub', (select id from public.profiles where role = 'patient' and organisation_id is not null limit 1),
    'role', 'authenticated'
  )::text, true);
set local role authenticated;

do $$
declare
  v_blocked boolean := false;
begin
  begin
    insert into public.symptom_triage_assessments
      (organisation_id, patient_id, presenting_complaint_key, protocol_version,
       initial_capture, category, clinician_review_required, safety_net_message_key, rationale)
    values
      ('00000000-0000-0000-0000-000000000001',
       (select id from public.profiles where role = 'patient' and organisation_id is not null limit 1),
       'headache', 1, '{"onset":"gradual","severity":1}'::jsonb, 'self_management', false, 'x',
       'client-forged classification attempt');
  exception when insufficient_privilege then
    v_blocked := true;
  end;

  if not v_blocked then
    raise exception 'FAIL: an authenticated session was able to insert into symptom_triage_assessments directly';
  end if;
  raise notice 'PASS 6: RLS blocked a direct authenticated insert into symptom_triage_assessments';
end $$;

reset role;
select set_config('request.jwt.claims', null, true);

rollback;
