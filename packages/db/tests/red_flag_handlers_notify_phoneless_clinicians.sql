-- Tarragon Health — verification for
-- 20260905005842_red_flag_handlers_page_clinicians_who_have_no_phone.sql
--
-- The defect: all five DB red-flag handlers selected their clinician
-- recipients with `... and role = 'clinician' and phone is not null`, on a
-- platform where 0 of 7 clinician profiles carry a phone. Each raised its
-- clinician_alerts row and then enqueued ZERO notifications — including
-- private.handle_emergency_event, which is the plan-independent emergency
-- path. Identical to the defect already fixed in
-- supabase/functions/abnormal-result-handler/index.ts, left in its five
-- database twins.
--
-- Proves, in one rolled-back transaction:
--   1. Structural — none of the five filters clinician recipients on a phone
--      number, and all five still select clinician recipients at all (so the
--      check cannot pass by the loop having been deleted).
--   2. Functional — a RED-band BP reading from an ENTITLED patient enqueues
--      exactly one notification per clinician in the organisation, and the
--      first hop is 'push', which needs no phone. Counted before and after the
--      same INSERT, so the number is attributable to that reading.
--   3. The pulse landmine — 'pulse_vitals_red_flag' is not registered in the
--      active escalation_slas config, and private.escalation_channel_sequence
--      raises for an unregistered pathway. Removing the phone predicate alone
--      would therefore have made the first RED-band pulse reading ABORT the
--      vitals_readings INSERT. This asserts the opposite: the reading saves,
--      raises its alert, and notifies on the default channel sequence.
--
-- Run via `supabase db query "$(cat this_file.sql)" --linked`, `psql
-- $DATABASE_URL -f this_file.sql`, or the Supabase SQL editor.
--
-- Wrapped in BEGIN/ROLLBACK — a verification script, not seed data.

begin;

do $$
declare
  v_fn      text;
  v_src     text;
  v_org     uuid;
  v_docs    integer;
  v_product uuid;
  v_price   bigint;
  v_bp      uuid := gen_random_uuid();
  v_pulse   uuid := gen_random_uuid();
  v_doc_a   uuid := gen_random_uuid();
  v_doc_b   uuid := gen_random_uuid();
  v_n0      integer;
  v_n1      integer;
  v_alerts  integer;
  v_channel text;
begin
  ------------------------------------------------------------------ 1. structural
  foreach v_fn in array array[
    'handle_bp_reading_red_flag',
    'handle_pulse_reading_red_flag',
    'handle_spo2_reading_red_flag',
    'handle_temperature_reading_red_flag',
    'handle_emergency_event'
  ] loop
    select p.prosrc into v_src
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'private' and p.proname = v_fn;
    if v_src is null then
      raise exception 'FAIL 1: private.% does not exist', v_fn;
    end if;
    if v_src ~ 'role\s*=\s*''clinician''\s*and\s*phone\s+is\s+not\s+null' then
      raise exception 'FAIL 1: private.% still filters its clinician recipients on phone is not null — it will page nobody', v_fn;
    end if;
    if v_src !~ 'role\s*=\s*''clinician''' then
      raise exception 'FAIL 1: private.% no longer selects clinician recipients at all', v_fn;
    end if;
  end loop;

  ------------------------------------------------------------------ fixtures
  -- Org resolved from public.organisations rather than from an existing
  -- patient: a migration (20260706084837) seeds the direct-consumer org, so
  -- this holds on a bare `supabase db reset`, where there is no patient yet.
  select id into v_org from public.organisations limit 1;
  if v_org is null then
    insert into public.organisations (name, type)
    values ('RFN Test Org', 'clinic')
    returning id into v_org;
  end if;

  -- Two clinicians are MINTED, both deliberately with NO phone number, which
  -- is exactly the recipient this file exists to prove is not dropped. The
  -- old shape refused to run when the organisation had no clinician of its
  -- own -- true of every fresh `supabase db reset` -- so the whole proof
  -- depended on a populated project happening to contain the right staff.
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values
    (v_doc_a, 'rfn-doc-a@example.invalid', 'x', now(), '{}', '{}'),
    (v_doc_b, 'rfn-doc-b@example.invalid', 'x', now(), '{}', '{}');

  insert into public.profiles (id, organisation_id, role, full_name, phone)
  values
    (v_doc_a, v_org, 'clinician', 'RFN Clinician A (no phone)', null),
    (v_doc_b, v_org, 'clinician', 'RFN Clinician B (no phone)', null)
  on conflict (id) do update
    set organisation_id = excluded.organisation_id, role = excluded.role,
        full_name = excluded.full_name, phone = excluded.phone;

  -- Counted AFTER minting, so the per-clinician assertions below cover the
  -- two minted phone-less doctors plus any the project already had.
  select count(*) into v_docs
    from public.profiles where organisation_id = v_org and role = 'clinician';
  if v_docs = 0 then
    raise exception 'VACUOUS: no clinician profiles in the organisation even after minting two';
  end if;

  -- Resolved by FEATURE, never by a hardcoded product code: the same
  -- discipline as doctor_time_entitlement_grantable_by_purchasable_product.sql.
  select id, price_kobo into v_product, v_price
    from public.service_products
   where is_active and 'vitals_red_flag_doctor_escalation' = any(features)
   order by code limit 1;
  if v_product is null then
    raise exception 'no product on sale grants vitals_red_flag_doctor_escalation — no patient can reach the paging path at all';
  end if;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values
    (v_bp,    'rfn-bp@example.invalid',    'x', now(), '{}', '{}'),
    (v_pulse, 'rfn-pulse@example.invalid', 'x', now(), '{}', '{}');

  insert into public.profiles (id, organisation_id, role, full_name)
  values
    (v_bp,    v_org, 'patient', 'RFN BP Patient'),
    (v_pulse, v_org, 'patient', 'RFN Pulse Patient')
  on conflict (id) do update
    set organisation_id = excluded.organisation_id,
        role = excluded.role,
        full_name = excluded.full_name;

  insert into public.service_purchases
    (organisation_id, patient_id, purchaser_profile_id, service_product_id,
     status, amount_kobo, currency, purchased_at, expires_at)
  values
    (v_org, v_bp,    v_bp,    v_product, 'active', v_price, 'NGN', now(), now() + interval '84 days'),
    (v_org, v_pulse, v_pulse, v_product, 'active', v_price, 'NGN', now(), now() + interval '84 days');

  ------------------------------------------------------------------ 2. BP: one notification per clinician
  select count(*) into v_n0
    from public.notifications
   where organisation_id = v_org and template = 'vitals_red_flag_clinician_alert';

  -- 178/104: RED per private.classify_bp_level (systolic >= 160), NOT emergency
  -- (>= 200 / >= 120), so this exercises the clinician_alerts + paging path
  -- rather than the plan-independent emergency_events route.
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic)
  values (v_org, v_bp, 'blood_pressure', 178, 104);

  select count(*) into v_alerts
    from public.clinician_alerts where patient_id = v_bp and status = 'open';
  if v_alerts = 0 then
    raise exception 'FAIL 2: the RED-band BP reading raised no clinician_alerts row';
  end if;

  select count(*) into v_n1
    from public.notifications
   where organisation_id = v_org and template = 'vitals_red_flag_clinician_alert';
  if v_n1 - v_n0 <> v_docs then
    raise exception
      'FAIL 2: expected one notification per clinician in the organisation (%), got % — phone-less clinicians are still being dropped from the recipient loop',
      v_docs, v_n1 - v_n0;
  end if;

  select distinct channel::text into v_channel
    from public.notifications
   where organisation_id = v_org
     and template = 'vitals_red_flag_clinician_alert'
     and escalation_pathway = 'bp_vitals_red_flag'
     and escalation_hop = 1
     and source_id in (select id from public.clinician_alerts where patient_id = v_bp);
  if v_channel <> 'push' then
    raise exception 'FAIL 2: first hop is %, not push — the hop that needs no phone number is not the one being used', v_channel;
  end if;

  ------------------------------------------------------------------ 3. pulse: must not abort the reading
  select count(*) into v_n0
    from public.notifications
   where organisation_id = v_org and template = 'vitals_red_flag_clinician_alert';

  -- 130 bpm is RED per private.classify_pulse_level (121-149), not emergency.
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, pulse_bpm)
  values (v_org, v_pulse, 'pulse', 130);

  select count(*) into v_alerts
    from public.clinician_alerts where patient_id = v_pulse and status = 'open';
  if v_alerts = 0 then
    raise exception 'FAIL 3: the RED-band pulse reading raised no clinician_alerts row';
  end if;

  select count(*) into v_n1
    from public.notifications
   where organisation_id = v_org and template = 'vitals_red_flag_clinician_alert';
  if v_n1 - v_n0 <> v_docs then
    raise exception
      'FAIL 3: expected one notification per clinician (%) for the pulse alert, got % — pulse_vitals_red_flag is unregistered in escalation_slas and the default channel fallback is not being reached',
      v_docs, v_n1 - v_n0;
  end if;

  raise notice
    'PASS: none of the five red-flag handlers drops a phone-less clinician, a RED BP reading notifies all % clinicians on push, and a RED pulse reading still saves and notifies despite pulse_vitals_red_flag being unregistered in the active escalation_slas config',
    v_docs;
end $$;

rollback;
