-- Tarragon Health
-- Founder decision, 2026-09-24: retire three doctor-time products from
-- patient purchase entirely — Senior Case Review, Doctor-Signed Documents
-- (all seven verified_document_* types), and the Confidential Doctor Message
-- credit. Removed from the marketing pricing page and the patient dashboard
-- in the same pass (apps/web).
--
-- Deactivating service_products stops any NEW purchase — both the dedicated
-- patient-dashboard cards (now deleted) and the generic catalogue on
-- /patient/subscription (SubscriptionManager, driven by
-- useActiveServiceProducts()) only ever list is_active = true rows — without
-- touching service_purchases history or the clinician-side review queues
-- (/clinician/senior-case-reviews, /clinician/verified-documents), which stay
-- intact to process any request already in flight. Same pattern already used
-- for verified_document_credit's 2026-09-10 retirement.
--
-- Confidential Doctor Message is different in kind, not just in degree: it
-- was never a standalone purchase button, it was a BEFORE INSERT gate
-- (private.enforce_confidential_message_credit, migration
-- 20260907132010_paid_confidential_and_clinical_messaging.sql) blocking any
-- patient-started 'clinical'-category or confidential (sexual/reproductive
-- health) thread until a credit was redeemed. Deactivating the product alone
-- would leave that gate live with no way left to buy through it — a dead end
-- for any patient with no pre-existing credit. Confirmed in-session with the
-- founder that the gate itself should go, not just its storefront listing:
-- every message category is free now, same as 'general' already was.

drop trigger if exists care_message_threads_enforce_confidential_credit on public.care_message_threads;
drop function if exists private.enforce_confidential_message_credit();

update public.service_products
set is_active = false
where code in (
  'confidential_message_credit',
  'senior_case_review_credit',
  'verified_document_fit_to_work',
  'verified_document_return_to_work',
  'verified_document_travel_health_certificate',
  'verified_document_medication_carry_letter',
  'verified_document_specialist_referral_letter',
  'verified_document_school_health_form',
  'verified_document_insurance_medical_summary'
);

do $$
declare
  v_org uuid;
  v_patient uuid;
  v_thread_id uuid;
  v_still_active int;
begin
  select count(*) into v_still_active
  from public.service_products
  where code in (
    'confidential_message_credit',
    'senior_case_review_credit',
    'verified_document_fit_to_work',
    'verified_document_return_to_work',
    'verified_document_travel_health_certificate',
    'verified_document_medication_carry_letter',
    'verified_document_specialist_referral_letter',
    'verified_document_school_health_form',
    'verified_document_insurance_medical_summary'
  ) and is_active;

  if v_still_active > 0 then
    raise exception 'FAIL: % of the 9 retired products are still active', v_still_active;
  end if;

  if exists (select 1 from pg_trigger where tgname = 'care_message_threads_enforce_confidential_credit') then
    raise exception 'FAIL: confidential message credit trigger still exists';
  end if;

  if exists (select 1 from pg_proc where proname = 'enforce_confidential_message_credit' and pronamespace = 'private'::regnamespace) then
    raise exception 'FAIL: enforce_confidential_message_credit function still exists';
  end if;

  -- Behavioural proof: a 'clinical'-category thread must now succeed with NO
  -- credit at all, the same way 'general' already did before this migration.
  select id, organisation_id into v_patient, v_org from public.profiles where role = 'patient' limit 1;
  if v_patient is null then
    raise notice 'SKIPPED behavioral proof: no patient row exists to test against';
    return;
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.care_message_threads (organisation_id, patient_id, subject, created_by, category, confidential)
  values (v_org, v_patient, 'confidential-message-paywall-removed: clinical, must not be gated', v_patient, 'clinical', false)
  returning id into v_thread_id;
  reset role;
  delete from public.care_message_threads where id = v_thread_id;

  raise notice 'PASS: senior case review / verified documents / confidential message credit all deactivated, confidential-message paywall trigger removed, clinical-category threads are free';
end $$;
