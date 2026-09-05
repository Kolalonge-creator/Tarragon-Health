-- Tarragon Health — SpO2 red-flag engine verification
--
-- Proves (1) an emergency-range reading raises emergency_events, (2) a
-- red-range reading raises an urgent_escalation clinician_alert, (3) a
-- normal reading raises nothing, and (4) the vital-type-scoped alert lookup
-- fix actually discriminates — a decoy open BP alert must survive a RED SpO2
-- insert untouched (this is the regression test for the cross-vital-
-- contamination bug found and fixed in the BP template during this feature's
-- design; see spo2_red_flag_engine migration's correctness note).
--
-- Run inside a transaction that is always rolled back — nothing here should
-- ever be committed.

begin;

do $$
declare
  v_org uuid;
  v_patient uuid;
  v_product uuid;
  v_reading_id uuid;
  v_alert record;
  v_event_count integer;
  v_bp_alert_id uuid;
  v_bp_alert_after record;
begin
  -- Fixtures are minted here, not borrowed. On a fresh `supabase db reset`
  -- there is no patient at all, and on a populated project an arbitrary
  -- `limit 1` patient carries whatever entitlements and open alerts it
  -- happens to have -- which is how this file used to report a failure that
  -- was really a fixture accident.
  select id into v_org from public.organisations limit 1;
  if v_org is null then
    insert into public.organisations (name, type)
    values ('SpO2 Test Org', 'clinic')
    returning id into v_org;
  end if;

  v_patient := gen_random_uuid();
  insert into auth.users (id, email)
  values (v_patient, 'spo2-test-patient@example.invalid');
  insert into public.profiles (id, organisation_id, role, full_name)
  values (v_patient, v_org, 'patient', 'SpO2 Test Patient')
  on conflict (id) do update
    set organisation_id = excluded.organisation_id, role = excluded.role,
        full_name = excluded.full_name;

  -- The RED band raises a clinician_alerts row only for a patient holding
  -- 'vitals_red_flag_doctor_escalation' (20260810120000). Resolve the granting
  -- product by that FEATURE, never by a product code: complete_pack -- the code
  -- a sibling proof still names -- is is_active = false since the
  -- pay-per-service pivot, so a by-code lookup would entitle nobody and turn
  -- the RED case below into a silent no-op.
  select id into v_product
  from public.service_products
  where is_active and 'vitals_red_flag_doctor_escalation' = any(features)
  order by code limit 1;
  if v_product is null then
    raise exception 'VACUOUS: no active service_product grants vitals_red_flag_doctor_escalation -- the RED-band case below could not fire for anybody';
  end if;

  -- payable_kobo is a GENERATED column: naming it here fails with 428C9.
  insert into public.service_purchases
    (organisation_id, patient_id, purchaser_profile_id, service_product_id,
     status, amount_kobo, currency, purchased_at, expires_at)
  values (v_org, v_patient, v_patient, v_product, 'active',
          1000000, 'NGN', now(), now() + interval '30 days');

  if not private.patient_has_feature_access(v_patient, 'vitals_red_flag_doctor_escalation') then
    raise exception 'VACUOUS: the minted purchase did not grant vitals_red_flag_doctor_escalation';
  end if;

  -- 1) EMERGENCY: spo2_pct = 88 -> emergency_events(source='spo2_red_flag').
  insert into public.vitals_readings (id, organisation_id, patient_id, vital_type, spo2_pct, taken_at, source)
  values (gen_random_uuid(), v_org, v_patient, 'spo2', 88, now(), 'manual')
  returning id into v_reading_id;

  select count(*) into v_event_count
  from public.emergency_events
  where patient_id = v_patient and source = 'spo2_red_flag' and vital_reading_id = v_reading_id;

  if v_event_count <> 1 then
    raise exception 'FAIL: expected 1 emergency_events row for spo2_pct=88, found %', v_event_count;
  end if;
  raise notice 'PASS 1: spo2_pct=88 raised an emergency_events row';

  -- 2) RED: spo2_pct = 91 -> clinician_alerts(level='urgent_escalation').
  insert into public.vitals_readings (id, organisation_id, patient_id, vital_type, spo2_pct, taken_at, source)
  values (gen_random_uuid(), v_org, v_patient, 'spo2', 91, now(), 'manual')
  returning id into v_reading_id;

  select level, status into v_alert
  from public.clinician_alerts
  where vital_reading_id = v_reading_id
  order by created_at desc limit 1;

  if v_alert.level is distinct from 'urgent_escalation' or v_alert.status is distinct from 'open' then
    raise exception 'FAIL: spo2_pct=91 alert level/status = %/% (expected urgent_escalation/open)', v_alert.level, v_alert.status;
  end if;
  raise notice 'PASS 2: spo2_pct=91 raised an open urgent_escalation clinician_alert';

  -- 3) GREEN: spo2_pct = 96 -> no new alert.
  insert into public.vitals_readings (id, organisation_id, patient_id, vital_type, spo2_pct, taken_at, source)
  values (gen_random_uuid(), v_org, v_patient, 'spo2', 96, now(), 'manual')
  returning id into v_reading_id;

  if exists (select 1 from public.clinician_alerts where vital_reading_id = v_reading_id) then
    raise exception 'FAIL: spo2_pct=96 unexpectedly raised a clinician_alert';
  end if;
  if exists (select 1 from public.emergency_events where vital_reading_id = v_reading_id) then
    raise exception 'FAIL: spo2_pct=96 unexpectedly raised an emergency_events row';
  end if;
  raise notice 'PASS 3: spo2_pct=96 raised nothing';

  -- 4) Cross-vital-contamination regression test: a decoy open BP alert must
  --    survive a RED SpO2 reading completely untouched (vital-type-scoped
  --    lookup — see the migration's correctness note vs. the BP template's
  --    own unscoped lookup, which this trigger deliberately does not copy).
  insert into public.vitals_readings (id, organisation_id, patient_id, vital_type, systolic, diastolic, taken_at, source)
  values (gen_random_uuid(), v_org, v_patient, 'blood_pressure', 168, 104, now(), 'manual')
  returning id into v_reading_id;

  select id into v_bp_alert_id
  from public.clinician_alerts
  where vital_reading_id = v_reading_id
  order by created_at desc limit 1;

  if v_bp_alert_id is null then
    raise exception 'FAIL: decoy BP red-flag alert was not raised (test setup broken)';
  end if;

  select title, level, updated_at into v_bp_alert_after
  from public.clinician_alerts where id = v_bp_alert_id;

  insert into public.vitals_readings (id, organisation_id, patient_id, vital_type, spo2_pct, taken_at, source)
  values (gen_random_uuid(), v_org, v_patient, 'spo2', 90, now(), 'manual')
  returning id into v_reading_id;

  if not exists (
    select 1 from public.clinician_alerts
    where id = v_bp_alert_id
      and title = v_bp_alert_after.title
      and level = v_bp_alert_after.level
      and updated_at = v_bp_alert_after.updated_at
  ) then
    raise exception 'FAIL: the SpO2 trigger mutated the decoy BP alert (cross-vital-contamination regression)';
  end if;

  if not exists (
    select 1 from public.clinician_alerts ca
    join public.vitals_readings vr on vr.id = ca.vital_reading_id
    where ca.patient_id = v_patient and vr.vital_type = 'spo2' and ca.status = 'open'
      and ca.vital_reading_id = v_reading_id
  ) then
    raise exception 'FAIL: the SpO2 trigger did not raise its own alert for the RED reading';
  end if;

  raise notice 'PASS 4: decoy BP alert untouched by a RED SpO2 reading; SpO2 raised its own alert';
  raise notice 'ALL SPO2_RED_FLAG_ENGINE CHECKS PASSED';
end $$;

rollback;
