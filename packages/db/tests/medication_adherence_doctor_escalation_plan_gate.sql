-- Tarragon Health — verification for
-- 20260826215100_medication_adherence_doctor_escalation_plan_gate.sql
--
-- Proves, for a genuinely fresh Free-tier patient (no subscriptions row at
-- all) vs. a genuinely fresh paid-tier patient (an active 'complete'
-- subscription), each with 6 missed doses of the same medication within 30
-- days: the paid patient's medication_adherence_alerts row reaches
-- level='doctor' exactly as before; the free patient's caps at
-- level='coach' forever, is recorded in audit_log as capped by plan, and
-- still opens a care_outreach_tasks row (trigger_type='missed_medication')
-- — coach-level adherence work stays available on every plan, it just never
-- reaches a doctor for a Free patient.
--
-- Run via `supabase db query "$(cat this_file.sql)" --linked`, `psql
-- $DATABASE_URL -f this_file.sql`, or the Supabase SQL editor.
--
-- Wrapped in BEGIN/ROLLBACK — this is a verification script, not seed data;
-- it always leaves the database exactly as it found it.

begin;

create temporary table maep_fixture(k text primary key, v uuid) on commit drop;

do $$
declare
  v_org           uuid;
  v_free_patient  uuid := gen_random_uuid();
  v_paid_patient  uuid := gen_random_uuid();
  v_complete_plan uuid;
  v_free_med      uuid;
  v_paid_med      uuid;
begin
  select organisation_id into v_org
  from public.profiles where role = 'patient' and organisation_id is not null limit 1;

  if v_org is null then
    raise exception 'no organisation has patient profiles — cannot run this test';
  end if;

  select id into v_complete_plan from public.subscription_plans where code = 'complete' limit 1;
  if v_complete_plan is null then
    raise exception 'no complete subscription_plans row found — cannot run this test';
  end if;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values
    (v_free_patient, 'maep-test-free@example.invalid', 'x', now(), '{}', '{}'),
    (v_paid_patient, 'maep-test-paid@example.invalid', 'x', now(), '{}', '{}');

  insert into public.profiles (id, organisation_id, role, full_name)
  values
    (v_free_patient, v_org, 'patient', 'MAEP Test Free Patient'),
    (v_paid_patient, v_org, 'patient', 'MAEP Test Paid Patient')
  on conflict (id) do update
    set organisation_id = excluded.organisation_id, role = excluded.role, full_name = excluded.full_name;

  -- v_free_patient deliberately gets NO subscriptions row at all — the same
  -- state a real Tarragon Free patient is in.
  insert into public.subscriptions (organisation_id, subscriber_id, plan_id, status)
  values (v_org, v_paid_patient, v_complete_plan, 'active');

  insert into public.medications (id, organisation_id, patient_id, drug_name, is_active, source)
  values (gen_random_uuid(), v_org, v_free_patient, 'MAEP Free Test Drug', true, 'patient')
  returning id into v_free_med;

  insert into public.medications (id, organisation_id, patient_id, drug_name, is_active, source)
  values (gen_random_uuid(), v_org, v_paid_patient, 'MAEP Paid Test Drug', true, 'patient')
  returning id into v_paid_med;

  insert into maep_fixture(k, v) values
    ('org', v_org), ('free_patient', v_free_patient), ('paid_patient', v_paid_patient),
    ('free_med', v_free_med), ('paid_med', v_paid_med);
end $$;

-- ==========================================================================
-- 1. Six missed doses each. Paid patient's alert reaches 'doctor'; free
--    patient's caps at 'coach' and is recorded as capped-by-plan.
-- ==========================================================================
do $$
declare
  v_org       uuid := (select v from maep_fixture where k = 'org');
  v_free      uuid := (select v from maep_fixture where k = 'free_patient');
  v_paid      uuid := (select v from maep_fixture where k = 'paid_patient');
  v_free_med  uuid := (select v from maep_fixture where k = 'free_med');
  v_paid_med  uuid := (select v from maep_fixture where k = 'paid_med');
  v_level     public.med_adherence_alert_level;
  v_missed    integer;
  v_capped_count integer;
  i           integer;
begin
  for i in 1..6 loop
    insert into public.medication_logs (organisation_id, patient_id, medication_id, status, logged_at)
    values (v_org, v_paid, v_paid_med, 'missed', now() - (i || ' hours')::interval);
    insert into public.medication_logs (organisation_id, patient_id, medication_id, status, logged_at)
    values (v_org, v_free, v_free_med, 'missed', now() - (i || ' hours')::interval);
  end loop;

  select level, missed_count into v_level, v_missed
  from public.medication_adherence_alerts where medication_id = v_paid_med;
  if v_level is distinct from 'doctor' then
    raise exception 'FAIL: paid patient with 6 missed doses expected level=doctor, got %', v_level;
  end if;
  if v_missed <> 6 then
    raise exception 'FAIL: paid patient expected missed_count=6, got %', v_missed;
  end if;
  raise notice 'PASS 1: paid patient with 6 missed doses reached doctor-level escalation';

  select level, missed_count into v_level, v_missed
  from public.medication_adherence_alerts where medication_id = v_free_med;
  if v_level is distinct from 'coach' then
    raise exception 'FAIL: free patient with 6 missed doses expected level capped at coach, got %', v_level;
  end if;
  if v_missed <> 6 then
    raise exception 'FAIL: free patient expected missed_count=6 (still counted, not dropped), got %', v_missed;
  end if;
  raise notice 'PASS 2: free patient with 6 missed doses stayed capped at coach-level, count still tracked';

  select count(*) into v_capped_count
  from public.audit_log
  where organisation_id = v_org
    and action = 'medication_adherence_alert.escalation_capped_by_plan'
    and (event ->> 'medication_id')::uuid = v_free_med;
  if v_capped_count <> 1 then
    raise exception 'FAIL: expected exactly 1 escalation_capped_by_plan audit_log row for the free patient, got %', v_capped_count;
  end if;

  select count(*) into v_capped_count
  from public.audit_log
  where organisation_id = v_org
    and action = 'medication_adherence_alert.escalation_capped_by_plan'
    and (event ->> 'medication_id')::uuid = v_paid_med;
  if v_capped_count <> 0 then
    raise exception 'FAIL: paid patient must never be recorded as escalation-capped-by-plan, got % rows', v_capped_count;
  end if;
  raise notice 'PASS 3: capped-by-plan audit trail recorded for the free patient only';
end $$;

-- ==========================================================================
-- 2. Coach-level work stays available on every plan: the free patient's
--    first coach-level alert (raised at their 3rd miss) opened a
--    care_outreach_tasks row — a Care Coordinator still sees and works this,
--    it just never reaches a doctor.
-- ==========================================================================
do $$
declare
  v_free     uuid := (select v from maep_fixture where k = 'free_patient');
  v_task_count integer;
begin
  select count(*) into v_task_count
  from public.care_outreach_tasks
  where patient_id = v_free and trigger_type = 'missed_medication';
  if v_task_count <> 1 then
    raise exception 'FAIL: expected exactly 1 missed_medication care_outreach_tasks row for the free patient, got %', v_task_count;
  end if;
  raise notice 'PASS 4: free patient''s coach-level alert opened a care_outreach_tasks row';
  raise notice 'ALL MEDICATION_ADHERENCE_DOCTOR_ESCALATION_PLAN_GATE CHECKS PASSED';
end $$;

rollback;
