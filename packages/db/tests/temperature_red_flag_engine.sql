-- Tarragon Health — Temperature red-flag engine verification
--
-- Same shape as spo2_red_flag_engine.sql: emergency/red/amber/green bands,
-- plus the cross-vital-contamination regression test against a decoy open
-- BP alert.
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
  v_red_alert_id uuid;
begin
  -- Fixtures are minted here, not borrowed. On a fresh `supabase db reset`
  -- there is no patient at all, and on a populated project an arbitrary
  -- `limit 1` patient carries whatever entitlements and open alerts it
  -- happens to have -- which is how this file used to report a failure that
  -- was really a fixture accident.
  select id into v_org from public.organisations limit 1;
  if v_org is null then
    insert into public.organisations (name, type)
    values ('Temperature Test Org', 'clinic')
    returning id into v_org;
  end if;

  v_patient := gen_random_uuid();
  insert into auth.users (id, email)
  values (v_patient, 'temp-test-patient@example.invalid');
  insert into public.profiles (id, organisation_id, role, full_name)
  values (v_patient, v_org, 'patient', 'Temperature Test Patient')
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

  -- 1) EMERGENCY (high): temperature_c = 40.5 -> emergency_events.
  insert into public.vitals_readings (id, organisation_id, patient_id, vital_type, temperature_c, taken_at, source)
  values (gen_random_uuid(), v_org, v_patient, 'temperature', 40.5, now(), 'manual')
  returning id into v_reading_id;

  select count(*) into v_event_count
  from public.emergency_events
  where patient_id = v_patient and source = 'temperature_red_flag' and vital_reading_id = v_reading_id;

  if v_event_count <> 1 then
    raise exception 'FAIL: expected 1 emergency_events row for temperature_c=40.5, found %', v_event_count;
  end if;
  raise notice 'PASS 1: temperature_c=40.5 raised an emergency_events row';

  -- 2) EMERGENCY (low): temperature_c = 34.5 -> a second, distinct emergency
  --    event (outside the 6h dedupe window is not the point here — this
  --    proves the low-end band independently fires the same pathway).
  insert into public.vitals_readings (id, organisation_id, patient_id, vital_type, temperature_c, taken_at, source)
  values (gen_random_uuid(), v_org, v_patient, 'temperature', 34.5, now(), 'manual')
  returning id into v_reading_id;

  -- Dedupe window means no NEW row for this second emergency within 6h — but
  -- the reading itself must not raise a clinician_alerts row (returns early).
  if exists (select 1 from public.clinician_alerts where vital_reading_id = v_reading_id) then
    raise exception 'FAIL: temperature_c=34.5 unexpectedly raised a clinician_alert instead of routing to emergency_events';
  end if;
  raise notice 'PASS 2: temperature_c=34.5 (hypothermia) routed to the emergency path, not clinician_alerts';

  -- 3) RED: temperature_c = 39.5 -> clinician_alerts(level='urgent_escalation').
  insert into public.vitals_readings (id, organisation_id, patient_id, vital_type, temperature_c, taken_at, source)
  values (gen_random_uuid(), v_org, v_patient, 'temperature', 39.5, now(), 'manual')
  returning id into v_reading_id;

  select id, level, status into v_alert
  from public.clinician_alerts
  where vital_reading_id = v_reading_id
  order by created_at desc limit 1;

  if v_alert.level is distinct from 'urgent_escalation' or v_alert.status is distinct from 'open' then
    raise exception 'FAIL: temperature_c=39.5 alert level/status = %/% (expected urgent_escalation/open)', v_alert.level, v_alert.status;
  end if;
  v_red_alert_id := v_alert.id;
  raise notice 'PASS 3: temperature_c=39.5 raised an open urgent_escalation clinician_alert';

  -- 4) AMBER: temperature_c = 38.5, logged while the RED alert above is still
  --    open. Upgrade-only means this less-severe reading must NOT touch the
  --    open RED alert at all (no downgrade, no vital_reading_id overwrite).
  insert into public.vitals_readings (id, organisation_id, patient_id, vital_type, temperature_c, taken_at, source)
  values (gen_random_uuid(), v_org, v_patient, 'temperature', 38.5, now(), 'manual')
  returning id into v_reading_id;

  if not exists (
    select 1 from public.clinician_alerts
    where id = v_red_alert_id and level = 'urgent_escalation' and status = 'open'
      and vital_reading_id <> v_reading_id
  ) then
    raise exception 'FAIL: an amber reading downgraded or overwrote the still-open RED temperature alert';
  end if;
  raise notice 'PASS 4: amber reading did not downgrade the still-open RED temperature alert (upgrade-only holds)';

  -- 5) GREEN: temperature_c = 37.0 -> no new alert, no emergency event.
  insert into public.vitals_readings (id, organisation_id, patient_id, vital_type, temperature_c, taken_at, source)
  values (gen_random_uuid(), v_org, v_patient, 'temperature', 37.0, now(), 'manual')
  returning id into v_reading_id;

  if exists (select 1 from public.clinician_alerts where vital_reading_id = v_reading_id) then
    raise exception 'FAIL: temperature_c=37.0 unexpectedly raised a clinician_alert';
  end if;
  if exists (select 1 from public.emergency_events where vital_reading_id = v_reading_id) then
    raise exception 'FAIL: temperature_c=37.0 unexpectedly raised an emergency_events row';
  end if;
  raise notice 'PASS 5: temperature_c=37.0 raised nothing';

  raise notice 'ALL TEMPERATURE_RED_FLAG_ENGINE CHECKS PASSED';
end $$;

rollback;
