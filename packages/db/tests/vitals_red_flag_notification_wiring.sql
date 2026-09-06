-- Tarragon Health — vitals red-flag notification wiring verification
--
-- Proves the paging additions in vitals_red_flag_notification_wiring
-- actually fire: (1) an emergency-range BP reading (the centralized
-- private.handle_emergency_event() path) produces a priority='critical'
-- notifications row for the org's clinicians, and (2) a RED-range SpO2
-- reading (a per-trigger paging path) does the same via a different
-- pathway/template. Both must keep content_class at its 'non_clinical'
-- default (enqueue_critical_notification never sets it) — the
-- notifications_no_clinical_on_open_rail CHECK is the thing actually
-- keeping raw clinical detail off WhatsApp/SMS/email.
--
-- Run inside a transaction that is always rolled back — nothing here should
-- ever be committed.

begin;

do $$
declare
  v_org uuid;
  v_patient uuid;
  v_product uuid;
  v_clinician uuid := gen_random_uuid();
  v_reading_id uuid;
  v_notif record;
begin
  -- Org from public.organisations (seeded by migration 20260706084837), and a
  -- MINTED patient. The old `limit 1` patient was whoever the project happened
  -- to hold, and whether they carried the doctor-escalation entitlement was
  -- pure luck: without it, a hypertensive-crisis reading still raises the
  -- emergency_events safety net but deliberately pages nobody
  -- (20260810120000), so this file reported "raised no notifications row for a
  -- pageable clinician" -- reading as a broken pathway when it was a fixture
  -- with no entitlement.
  select id into v_org from public.organisations limit 1;
  if v_org is null then
    insert into public.organisations (name, type)
    values ('Vitals Paging Test Org', 'clinic')
    returning id into v_org;
  end if;

  v_patient := gen_random_uuid();
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v_patient, 'vitals-red-flag-test-patient@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name)
  values (v_patient, v_org, 'patient', 'Vitals Red Flag Test Patient')
  on conflict (id) do update
    set organisation_id = excluded.organisation_id, role = excluded.role,
        full_name = excluded.full_name;

  -- Entitlement resolved by FEATURE, never by product code: the packs that
  -- used to carry it are is_active = false since the pay-per-service pivot, so
  -- a by-code fixture would entitle nobody and silently re-create the failure
  -- above.
  select id into v_product
  from public.service_products
  where is_active and 'vitals_red_flag_doctor_escalation' = any(features)
  order by code limit 1;
  if v_product is null then
    raise exception 'VACUOUS: no active service_product grants vitals_red_flag_doctor_escalation — no patient on the platform can reach the paging path being proved here';
  end if;

  -- payable_kobo is GENERATED; naming it fails with 428C9.
  insert into public.service_purchases
    (organisation_id, patient_id, purchaser_profile_id, service_product_id,
     status, amount_kobo, currency, purchased_at, expires_at)
  values (v_org, v_patient, v_patient, v_product, 'active',
          1000000, 'NGN', now(), now() + interval '30 days');

  -- Create a throwaway clinician fixture with a phone on file, scoped to the
  -- patient's org — as verified live against production 2026-08-07, none of
  -- the current clinician fixture rows have a phone number set, so relying
  -- on one already existing (the recipient-resolution filter this migration
  -- added mirrors abnormal-result-handler's org-clinician-with-phone filter
  -- exactly) would make this test environment-dependent. Same
  -- auth.users-then-profiles-update pattern as escalation_slas_config.sql
  -- Part 3.
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v_clinician, 'vitals-red-flag-test-clinician@example.invalid', 'x', now(), '{}', '{}');

  update public.profiles
    set organisation_id = v_org, role = 'clinician', full_name = 'Vitals Red Flag Test Clinician',
        phone = '+2340000000000'
    where id = v_clinician;

  -- 1) Hypertensive-crisis BP reading -> emergency_events ->
  --    handle_emergency_event()'s centralized paging.
  insert into public.vitals_readings (id, organisation_id, patient_id, vital_type, systolic, diastolic, taken_at, source)
  values (gen_random_uuid(), v_org, v_patient, 'blood_pressure', 210, 125, now(), 'manual')
  returning id into v_reading_id;

  select priority, escalation_pathway, escalation_alert_tier, content_class, template, channel
    into v_notif
  from public.notifications
  where recipient_id = v_clinician
    and template = 'emergency_event_clinician_alert'
    and source_table = 'clinician_alerts'
  order by created_at desc limit 1;

  if v_notif.priority is null then
    raise exception 'FAIL: hypertensive-crisis BP reading raised no notifications row for a pageable clinician';
  end if;
  if v_notif.priority <> 'critical' then
    raise exception 'FAIL: emergency BP notification priority = % (expected critical)', v_notif.priority;
  end if;
  if v_notif.escalation_pathway <> 'emergency_event' or v_notif.escalation_alert_tier <> 'emergency' then
    raise exception 'FAIL: emergency BP notification pathway/tier = %/% (expected emergency_event/emergency)',
      v_notif.escalation_pathway, v_notif.escalation_alert_tier;
  end if;
  if v_notif.content_class <> 'non_clinical' then
    raise exception 'FAIL: emergency BP notification content_class = % (expected non_clinical default)', v_notif.content_class;
  end if;
  raise notice 'PASS 1: hypertensive-crisis BP reading paged a clinician via the centralized emergency_event path (priority=critical, non_clinical)';

  -- 2) RED-range SpO2 reading -> handle_spo2_reading_red_flag()'s per-trigger
  --    paging, a different pathway/template than case 1.
  insert into public.vitals_readings (id, organisation_id, patient_id, vital_type, spo2_pct, taken_at, source)
  values (gen_random_uuid(), v_org, v_patient, 'spo2', 91, now(), 'manual')
  returning id into v_reading_id;

  select priority, escalation_pathway, escalation_alert_tier, content_class, template
    into v_notif
  from public.notifications
  where recipient_id = v_clinician
    and template = 'vitals_red_flag_clinician_alert'
    and escalation_pathway = 'spo2_vitals_red_flag'
  order by created_at desc limit 1;

  if v_notif.priority is null then
    raise exception 'FAIL: RED SpO2 reading raised no notifications row for a pageable clinician';
  end if;
  if v_notif.priority <> 'critical' then
    raise exception 'FAIL: SpO2 notification priority = % (expected critical)', v_notif.priority;
  end if;
  if v_notif.escalation_alert_tier <> 'urgent_escalation' then
    raise exception 'FAIL: SpO2 notification tier = % (expected urgent_escalation)', v_notif.escalation_alert_tier;
  end if;
  if v_notif.content_class <> 'non_clinical' then
    raise exception 'FAIL: SpO2 notification content_class = % (expected non_clinical default)', v_notif.content_class;
  end if;
  raise notice 'PASS 2: RED SpO2 reading paged a clinician via its own per-trigger path (priority=critical, non_clinical)';

  raise notice 'ALL VITALS_RED_FLAG_NOTIFICATION_WIRING CHECKS PASSED';
end $$;

rollback;
