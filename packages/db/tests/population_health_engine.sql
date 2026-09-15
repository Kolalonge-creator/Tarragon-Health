-- Population Health Management Engine (spec §41) — smoke test.
--
-- Run inside a single transaction and ROLLED BACK. Every positive is paired
-- with a negative/sabotage control so a vacuously-passing check can't hide.
--
-- Verified against the linked project. To re-run:
--   npx supabase db query --linked -f packages/db/tests/population_health_engine.sql
-- (run it from the MAIN checkout, not a worktree - see
-- reference_supabase_cli_sql_access)

begin;

create temp table r(step text, verdict text) on commit drop;
grant insert, select on r to authenticated;

do $$
declare
  v_org uuid; v_other_org uuid;
  v_htn_pt uuid; v_dm_pt uuid; v_pregnant_pt uuid; v_engaged_pt uuid; v_other_org_pt uuid;
  v_clinician uuid; v_other_org_clinician uuid;
  v_htn_registry uuid; v_pregnancy_registry uuid; v_custom_pop uuid;
  v_screen_type uuid;
  v_n int; v_claims text; v_summary jsonb; v_queued int; v_campaign uuid; v_eff jsonb;
begin
  ------------------------------------------------------------------
  -- Fixtures.
  ------------------------------------------------------------------
  insert into public.organisations (name, type)
    values ('PHE Test Org', 'direct_consumer') returning id into v_org;
  insert into public.organisations (name, type)
    values ('PHE Test Org (Other)', 'direct_consumer') returning id into v_other_org;

  select id into v_screen_type from public.screen_types limit 1;
  if v_screen_type is null then
    raise exception 'fixture lookup failed (screen_types) - test would be vacuous';
  end if;

  -- Clinicians (org staff) — one in each org, to prove cross-org isolation.
  -- auth.users insert fires handle_new_user(), which already creates the
  -- public.profiles row (as 'patient', default org) — update it rather than
  -- inserting a second time.
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
    values (gen_random_uuid(), 'phe-clinician@example.invalid', 'x', now(), '{}', '{}')
    returning id into v_clinician;
  update public.profiles set organisation_id = v_org, role = 'clinician', full_name = 'Dr PHE Test'
    where id = v_clinician;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
    values (gen_random_uuid(), 'phe-other-clinician@example.invalid', 'x', now(), '{}', '{}')
    returning id into v_other_org_clinician;
  update public.profiles set organisation_id = v_other_org, role = 'clinician', full_name = 'Dr PHE Other Org'
    where id = v_other_org_clinician;

  -- Patients.
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
    values (gen_random_uuid(), 'phe-htn@example.invalid', 'x', now(), '{}', '{}')
    returning id into v_htn_pt;
  update public.profiles set organisation_id = v_org, role = 'patient', full_name = 'HTN Patient',
    date_of_birth = '1970-01-01', sex = 'male', state = 'Lagos'
    where id = v_htn_pt;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
    values (gen_random_uuid(), 'phe-dm@example.invalid', 'x', now(), '{}', '{}')
    returning id into v_dm_pt;
  update public.profiles set organisation_id = v_org, role = 'patient', full_name = 'DM Patient',
    date_of_birth = '1980-01-01', sex = 'female', state = 'Lagos'
    where id = v_dm_pt;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
    values (gen_random_uuid(), 'phe-pregnant@example.invalid', 'x', now(), '{}', '{}')
    returning id into v_pregnant_pt;
  update public.profiles set organisation_id = v_org, role = 'patient', full_name = 'Pregnant Patient',
    date_of_birth = '1995-01-01', sex = 'female', is_pregnant = true
    where id = v_pregnant_pt;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
    values (gen_random_uuid(), 'phe-engaged@example.invalid', 'x', now(), '{}', '{}')
    returning id into v_engaged_pt;
  update public.profiles set organisation_id = v_org, role = 'patient', full_name = 'Engaged Patient',
    date_of_birth = '1990-01-01', sex = 'male'
    where id = v_engaged_pt;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
    values (gen_random_uuid(), 'phe-other-org-pt@example.invalid', 'x', now(), '{}', '{}')
    returning id into v_other_org_pt;
  update public.profiles set organisation_id = v_other_org, role = 'patient', full_name = 'Other Org Patient',
    date_of_birth = '1970-01-01', sex = 'male'
    where id = v_other_org_pt;

  -- Clinical data: HTN patient is high-risk with an overdue screening gap.
  insert into public.care_plans (organisation_id, patient_id, condition, status)
    values (v_org, v_htn_pt, 'hypertension', 'active');
  insert into public.prevention_risk_scores (organisation_id, profile_id, condition, tier)
    values (v_org, v_htn_pt, 'hypertension', 'high');
  insert into public.screening_schedules (organisation_id, patient_id, screen_type_id, status, due_date)
    values (v_org, v_htn_pt, v_screen_type, 'overdue', current_date - 30);

  -- DM patient: controlled, no gaps.
  insert into public.care_plans (organisation_id, patient_id, condition, status)
    values (v_org, v_dm_pt, 'diabetes', 'active');
  insert into public.prevention_risk_scores (organisation_id, profile_id, condition, tier)
    values (v_org, v_dm_pt, 'diabetes', 'low');

  -- Engaged patient: a real behavioural event in the last day.
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, taken_at, source)
    values (v_org, v_engaged_pt, 'blood_pressure', 120, 80, now() - interval '1 hour', 'manual');

  ------------------------------------------------------------------
  -- 1. System registries auto-seeded by the organisations insert trigger.
  ------------------------------------------------------------------
  select count(*) into v_n from public.population_definitions where organisation_id = v_org and is_system;
  insert into r values ('1a five system registries auto-seeded on org creation',
    case when v_n = 5 then 'PASS' else 'FAIL - got ' || v_n end);

  select id into v_htn_registry from public.population_definitions
    where organisation_id = v_org and name = 'Hypertension registry';
  select id into v_pregnancy_registry from public.population_definitions
    where organisation_id = v_org and name = 'Pregnancy registry';
  if v_htn_registry is null or v_pregnancy_registry is null then
    raise exception 'system registries not found - test would be vacuous';
  end if;

  ------------------------------------------------------------------
  -- 2. Membership, as a real clinician session.
  ------------------------------------------------------------------
  v_claims := json_build_object('sub', v_clinician, 'role', 'authenticated')::text;
  perform set_config('request.jwt.claims', v_claims, true);
  set local role authenticated;

  select count(*) into v_n from public.get_population_members(v_htn_registry) where patient_id = v_htn_pt;
  insert into r values ('2a Hypertension registry includes the HTN patient',
    case when v_n = 1 then 'PASS' else 'FAIL' end);

  select count(*) into v_n from public.get_population_members(v_htn_registry) where patient_id = v_dm_pt;
  insert into r values ('2b SABOTAGE: Hypertension registry excludes the DM patient',
    case when v_n = 0 then 'PASS' else 'FAIL - leaked' end);

  select count(*) into v_n from public.get_population_members(v_pregnancy_registry) where patient_id = v_pregnant_pt;
  insert into r values ('2c Pregnancy registry includes the pregnant patient',
    case when v_n = 1 then 'PASS' else 'FAIL' end);

  select count(*) into v_n from public.get_population_members(v_pregnancy_registry) where patient_id = v_htn_pt;
  insert into r values ('2d SABOTAGE: Pregnancy registry excludes a non-pregnant patient',
    case when v_n = 0 then 'PASS' else 'FAIL - leaked' end);

  -- Custom population: a compound filter (risk_levels + control_status).
  insert into public.population_definitions (organisation_id, name, kind, filters, created_by)
    values (v_org, 'High-risk uncontrolled', 'custom',
      '{"risk_levels":["high","very_high"],"control_status":["uncontrolled"]}'::jsonb, v_clinician)
    returning id into v_custom_pop;

  select count(*) into v_n from public.get_population_members(v_custom_pop) where patient_id = v_htn_pt;
  insert into r values ('2e custom risk-level+control-status filter includes the HTN patient',
    case when v_n = 1 then 'PASS' else 'FAIL' end);
  select count(*) into v_n from public.get_population_members(v_custom_pop) where patient_id = v_dm_pt;
  insert into r values ('2f SABOTAGE: custom filter excludes the controlled DM patient',
    case when v_n = 0 then 'PASS' else 'FAIL - leaked' end);

  -- Engagement band.
  select count(*) into v_n from public.get_population_members(v_htn_registry) where patient_id = v_htn_pt and engagement_band = 'disengaged';
  insert into r values ('2g HTN patient with no logged activity reads as disengaged',
    case when v_n = 1 then 'PASS' else 'FAIL' end);

  insert into public.population_definitions (organisation_id, name, kind, filters, created_by)
    values (v_org, 'Actively engaged', 'custom', '{"engagement":["active"]}'::jsonb, v_clinician)
    returning id into v_custom_pop;
  select count(*) into v_n from public.get_population_members(v_custom_pop) where patient_id = v_engaged_pt;
  insert into r values ('2h engagement filter picks up a real behavioural event',
    case when v_n = 1 then 'PASS' else 'FAIL' end);

  ------------------------------------------------------------------
  -- 3. Summary / outcomes.
  ------------------------------------------------------------------
  select public.get_population_summary(v_htn_registry) into v_summary;
  insert into r values ('3a summary total_members = 1',
    case when (v_summary->>'total_members')::int = 1 then 'PASS' else 'FAIL - ' || v_summary::text end);
  insert into r values ('3b summary control_status reports uncontrolled',
    case when v_summary->'control_status' @> '[{"status":"uncontrolled","patients":1}]'::jsonb
      then 'PASS' else 'FAIL - ' || v_summary::text end);
  insert into r values ('3c summary care_gaps reports the overdue screening',
    case when v_summary->'care_gaps' @> '[{"gap_type":"overdue_screening","patients":1}]'::jsonb
      then 'PASS' else 'FAIL - ' || v_summary::text end);

  select public.get_population_outcomes(v_htn_registry) into v_summary;
  insert into r values ('3d outcomes screening_total counts the overdue schedule',
    case when (v_summary->>'screening_total')::int >= 1 then 'PASS' else 'FAIL - ' || v_summary::text end);

  ------------------------------------------------------------------
  -- 4. Outreach: gap-driven, idempotent, both channels notified.
  ------------------------------------------------------------------
  select public.trigger_population_outreach(v_htn_registry) into v_queued;
  insert into r values ('4a outreach queues exactly the one patient with an open gap',
    case when v_queued = 1 then 'PASS' else 'FAIL - got ' || v_queued end);

  select count(*) into v_n from public.care_outreach_tasks
    where patient_id = v_htn_pt and trigger_type = 'overdue_screening';
  insert into r values ('4b a care_outreach_tasks row exists for the HTN patient',
    case when v_n = 1 then 'PASS' else 'FAIL - got ' || v_n end);

  select count(*) into v_n from public.notifications
    where recipient_id = v_htn_pt and template = 'care_outreach_checkin' and channel in ('whatsapp','in_app');
  insert into r values ('4c both whatsapp and in_app nudges were queued',
    case when v_n = 2 then 'PASS' else 'FAIL - got ' || v_n end);

  -- Re-running must not double-queue (same live-status unique index the nightly job relies on).
  perform public.trigger_population_outreach(v_htn_registry);
  select count(*) into v_n from public.care_outreach_tasks
    where patient_id = v_htn_pt and trigger_type = 'overdue_screening';
  insert into r values ('4d re-running outreach does not double-queue',
    case when v_n = 1 then 'PASS' else 'FAIL - got ' || v_n end);

  ------------------------------------------------------------------
  -- 5. Campaign effectiveness.
  ------------------------------------------------------------------
  insert into public.prevention_campaigns
    (organisation_id, code, name, starts_on, population_id, status, created_by)
    values (v_org, 'phe-test-campaign', 'Know Your Blood Pressure', current_date, v_htn_registry, 'active', v_clinician)
    returning id into v_campaign;
  insert into public.prevention_campaign_enrolments (organisation_id, campaign_id, patient_id, status)
    values (v_org, v_campaign, v_htn_pt, 'completed');

  select public.get_campaign_effectiveness(v_campaign) into v_eff;
  insert into r values ('5a campaign effectiveness reports 100% completion of 1',
    case when (v_eff->>'completed')::int = 1 and (v_eff->>'completion_rate')::numeric = 100.0
      then 'PASS' else 'FAIL - ' || v_eff::text end);
  insert into r values ('5b campaign effectiveness reports the linked population size',
    case when (v_eff->>'population_size')::int = 1 then 'PASS' else 'FAIL - ' || v_eff::text end);

  ------------------------------------------------------------------
  -- 6. Cross-org isolation and role gating (negative controls).
  ------------------------------------------------------------------
  reset role;
  v_claims := json_build_object('sub', v_other_org_clinician, 'role', 'authenticated')::text;
  perform set_config('request.jwt.claims', v_claims, true);
  set local role authenticated;

  select count(*) into v_n from public.get_population_members(v_htn_registry);
  insert into r values ('6a a clinician in a different org gets zero rows for this population',
    case when v_n = 0 then 'PASS' else 'FAIL - leaked ' || v_n || ' rows' end);

  select count(*) into v_n from public.population_definitions where id = v_htn_registry;
  insert into r values ('6b RLS also hides the population_definitions row cross-org',
    case when v_n = 0 then 'PASS' else 'FAIL - leaked' end);

  begin
    perform public.trigger_population_outreach(v_htn_registry);
    insert into r values ('6c a clinician in a different org cannot trigger outreach for it', 'FAIL - accepted');
  exception when others then
    insert into r values ('6c a clinician in a different org cannot trigger outreach for it', 'PASS');
  end;

  reset role;
  v_claims := json_build_object('sub', v_htn_pt, 'role', 'authenticated')::text;
  perform set_config('request.jwt.claims', v_claims, true);
  set local role authenticated;

  select count(*) into v_n from public.get_population_members(v_htn_registry);
  insert into r values ('6d a patient (not staff) gets zero rows even for their own org''s population',
    case when v_n = 0 then 'PASS' else 'FAIL - leaked ' || v_n || ' rows' end);

  reset role;
end $$;

select * from r order by step;

rollback;
