-- Proves the sponsor surface built in 20260801091000 and 20260801092000.
--
-- Every negative is paired with a positive in the same transaction, because a
-- grant that blocks everything would pass a negatives-only test. The consented
-- sponsor must SEE something at each point the unconsented one sees nothing.
--
-- Updated 2026-08-31 for the pay-per-service migration: section 5's "sponsor
-- pays the plan" now activates a public.service_purchases row (a
-- service_products.code, not a subscription_plans.code) via
-- private.activate_sponsored_service_purchase — the metadata.kind stays
-- 'sponsored_subscription' (the trigger match key was left unchanged;
-- only the target catalogue/table moved), see
-- 20260831150844_repoint_vouchers_and_sponsor_to_service_products.sql.
--
--   npx supabase db query --linked -f packages/db/tests/sponsor_care_status_and_funding.sql

begin;

create temp table results(check_name text, expected text, actual text) on commit drop;

do $$
declare
  v_org uuid := '00000000-0000-0000-0000-000000000001';
  v_mum uuid;
  v_sponsor uuid;       -- manage + clinical consent
  v_other uuid;         -- a grant, but NO clinical consent (the control)
  v_alert uuid;
  v_med uuid;
  v_pm uuid;
  v_partner uuid;
  v_plan uuid;
  v_plan_code text;
  v_order uuid;
  v_order2 uuid;
  v_status jsonb;
  v_payables jsonb;
  v_err text;
begin
  -- Fixtures. Real auth users already exist for these QA accounts.
  select id into v_mum from public.profiles where id in
    (select id from auth.users where email = 'patient.complete.test@tarragon.test');
  select id into v_sponsor from public.profiles where id in
    (select id from auth.users where email = 'patient.diaspora.test@tarragon.test');
  select id into v_other from public.profiles where id in
    (select id from auth.users where email = 'patient.free.test@tarragon.test');

  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by, clinical_access)
  values (v_mum, v_sponsor, 'manage', v_mum, false),
         (v_mum, v_other,   'manage', v_mum, false);

  -- Only the owner may consent, so flip it as her.
  perform set_config('request.jwt.claims', json_build_object('sub', v_mum, 'role','authenticated')::text, true);
  update public.profile_access set clinical_access = true
   where profile_id = v_mum and grantee_user_id = v_sponsor;
  perform set_config('request.jwt.claims', null, true);

  insert into public.care_plans (organisation_id, patient_id, condition, status)
  values (v_org, v_mum, 'hypertension', 'active');

  insert into public.clinician_alerts
    (organisation_id, patient_id, level, status, title, detail, sla_due_at, escalation_level)
  values (v_org, v_mum, 'clinician_review', 'open', 'Blood pressure above target',
          'Home BP 156/96 — review adherence and titration.', now() + interval '3 days', 2)
  returning id into v_alert;

  --------------------------------------------------------------------------
  -- 1. sponsor_care_status: consent is what gates it
  --------------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_sponsor, 'role','authenticated')::text, true);
  v_status := public.sponsor_care_status(v_mum);
  insert into results values ('consented sponsor sees the open alert count', '1', v_status->>'open_count');
  insert into results values ('consented sponsor sees a review due date', 'true',
                              (v_status->>'next_review_due' is not null)::text);
  insert into results values ('review not yet overdue', 'false', v_status->>'review_overdue');
  insert into results values ('status carries no clinical detail', 'false',
                              (v_status::text ilike '%titration%')::text);

  perform set_config('request.jwt.claims', json_build_object('sub', v_other, 'role','authenticated')::text, true);
  begin
    perform public.sponsor_care_status(v_mum);
    insert into results values ('sponsor WITHOUT clinical consent is refused', '42501', 'allowed');
  exception when others then
    insert into results values ('sponsor WITHOUT clinical consent is refused', '42501', sqlstate);
  end;

  --------------------------------------------------------------------------
  -- 2. sponsor_request_refill
  --------------------------------------------------------------------------
  perform set_config('request.jwt.claims', null, true);
  insert into public.medications
    (organisation_id, patient_id, drug_name, dose, frequency, source, is_active, refill_date)
  values (v_org, v_mum, 'ZZTestolol', '10 mg', 'Once daily', 'clinician', true, current_date + 5)
  returning id into v_med;

  select id into v_partner from public.pharmacy_partners where is_active limit 1;
  insert into public.pharmacy_medications (pharmacy_partner_id, drug_name, pack_size, price_kobo)
  values (v_partner, 'ZZTestolol', '30 tablets', 450000) returning id into v_pm;

  perform set_config('request.jwt.claims', json_build_object('sub', v_sponsor, 'role','authenticated')::text, true);
  v_order := public.sponsor_request_refill(v_mum, v_med);
  insert into results values ('manage sponsor turns a due refill into a bill', 'true',
                              (v_order is not null)::text);

  -- Called twice, it must hand back the same bill rather than stack duplicates.
  v_order2 := public.sponsor_request_refill(v_mum, v_med);
  insert into results values ('a second refill request does not duplicate the bill', v_order::text, v_order2::text);

  -- ...and that bill is now visible as payable, priced correctly.
  v_payables := public.sponsor_payable_orders(v_mum);
  insert into results values ('the refill shows up as payable at the listed price', 'true',
                              (v_payables::text like '%4500%')::text);
  insert into results values ('payables name a category, never the drug', 'false',
                              (v_payables::text ilike '%ZZTestolol%')::text);

  -- A medication the person is not actually on cannot be refilled.
  begin
    perform public.sponsor_request_refill(v_mum, gen_random_uuid());
    insert into results values ('cannot refill a medication they are not on', '22023', 'allowed');
  exception when others then
    insert into results values ('cannot refill a medication they are not on', '22023', sqlstate);
  end;

  -- A 'view' grantee is refused outright.
  perform set_config('request.jwt.claims', null, true);
  update public.profile_access set permission_level = 'view'
   where profile_id = v_mum and grantee_user_id = v_other;
  perform set_config('request.jwt.claims', json_build_object('sub', v_other, 'role','authenticated')::text, true);
  begin
    perform public.sponsor_request_refill(v_mum, v_med);
    insert into results values ('a view-only grantee cannot create a bill', '42501', 'allowed');
  exception when others then
    insert into results values ('a view-only grantee cannot create a bill', '42501', sqlstate);
  end;

  --------------------------------------------------------------------------
  -- 3. "a doctor has looked at it" reaches the consented sponsor only
  --------------------------------------------------------------------------
  perform set_config('request.jwt.claims', null, true);
  update public.clinician_alerts
     set acknowledged_at = now(), status = 'acknowledged'
   where id = v_alert;

  insert into results
  select 'consented sponsor is told a doctor reviewed it', '2',
         count(*)::text from public.notifications
   where recipient_id = v_sponsor and template = 'sponsor_care_reviewed';

  insert into results
  select 'unconsented grantee is NOT told', '0',
         count(*)::text from public.notifications
   where recipient_id = v_other and template = 'sponsor_care_reviewed';

  insert into results
  select 'the review notice carries no clinical content', 'non_clinical',
         distinct_class from (
    select distinct content_class::text as distinct_class from public.notifications
     where template = 'sponsor_care_reviewed' and recipient_id = v_sponsor) s;

  --------------------------------------------------------------------------
  -- 4. gone quiet
  --------------------------------------------------------------------------
  -- source = 'device', not 'manual': 20260831001537_vitals_symptoms_
  -- timestamp_hardening.sql forces manual-source taken_at to the real
  -- insert time (closing a spoofing gap that has no legitimate manual-entry
  -- use case), so a manual row can no longer be backdated to simulate lapsed
  -- engagement. private.queue_sponsor_quiet_nudges() reads max(taken_at)
  -- with no source filter, so this is equivalent for what this check
  -- actually exercises.
  insert into public.vitals_readings
    (organisation_id, patient_id, vital_type, systolic, diastolic, source, taken_at)
  values (v_org, v_mum, 'blood_pressure', 156, 96, 'device', now() - interval '40 days');

  perform private.queue_sponsor_quiet_nudges();
  insert into results
  select 'a 40-day silence reaches the sponsor', '2',
         count(*)::text from public.notifications
   where recipient_id = v_sponsor and template = 'sponsor_person_quiet';

  -- Run again the same week: must not nag twice.
  perform private.queue_sponsor_quiet_nudges();
  insert into results
  select 'a second run the same month does not nag again', '2',
         count(*)::text from public.notifications
   where recipient_id = v_sponsor and template = 'sponsor_person_quiet';

  --------------------------------------------------------------------------
  -- 5. the sponsor pays the plan
  --------------------------------------------------------------------------
  select id, code into v_plan, v_plan_code
    from public.service_products
   where is_active and currency = 'NGN' and price_kobo > 0
   limit 1;

  insert into public.payment_transactions
    (organisation_id, provider, provider_event_id, event_type, amount_minor, currency,
     raw_payload, processed_at)
  values (v_org, 'paystack', 'evt_zz_sponsor_1', 'charge.success', 100000, 'NGN',
          jsonb_build_object('data', jsonb_build_object('metadata', jsonb_build_object(
            'kind','sponsored_subscription',
            'beneficiary_profile_id', v_mum,
            'sponsor_profile_id', v_sponsor,
            'plan_code', v_plan_code))),
          now());

  insert into results
  select 'the plan is now active and billed to the sponsor', 'true',
         (count(*) > 0)::text from public.service_purchases
   where patient_id = v_mum and purchaser_profile_id = v_sponsor and status = 'active';

  insert into results
  select 'both people are told about the sponsored plan', '4',
         count(*)::text from public.notifications where template = 'sponsored_plan_started';

  -- A grant revoked between checkout and webhook must buy nothing.
  delete from public.service_purchases where patient_id = v_mum;
  delete from public.profile_access where profile_id = v_mum and grantee_user_id = v_sponsor;
  insert into public.payment_transactions
    (organisation_id, provider, provider_event_id, event_type, amount_minor, currency,
     raw_payload, processed_at)
  values (v_org, 'paystack', 'evt_zz_sponsor_2', 'charge.success', 100000, 'NGN',
          jsonb_build_object('data', jsonb_build_object('metadata', jsonb_build_object(
            'kind','sponsored_subscription',
            'beneficiary_profile_id', v_mum,
            'sponsor_profile_id', v_sponsor,
            'plan_code', v_plan_code))),
          now());

  insert into results
  select 'a revoked sponsor cannot buy a plan', '0',
         count(*)::text from public.service_purchases where patient_id = v_mum;
end $$;

select check_name, expected, actual,
       case when expected = actual then 'PASS' else 'FAIL' end as result
from results;

do $$
declare v_fail int;
begin
  select count(*) into v_fail from results where expected <> actual;
  if v_fail > 0 then
    raise exception '% sponsor check(s) failed', v_fail;
  end if;
end $$;

rollback;
