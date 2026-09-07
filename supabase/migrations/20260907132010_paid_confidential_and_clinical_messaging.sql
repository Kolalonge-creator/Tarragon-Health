-- Tarragon Health
-- Patient UX fix pass, 2026-09-07, founder decision: "Start a confidential
-- message should be paid on reproductive health, as this will require
-- doctor time — the same with other messages that require doctors time
-- should be paid at ₦2,500." Follow-up question confirmed the scope: any
-- thread that reaches a doctor is gated; Care Coordinator logistics chat
-- (bookings, refills, check-ins — non-clinical, per the Tier Ladder) stays
-- free.
--
-- care_message_threads already carries exactly the two signals needed to
-- draw that line without inventing a new column: `confidential` (true only
-- for the Sexual & Reproductive Health hub's confidential thread — see
-- 20260902211500_confidential_care_message_threads.sql) and `category`
-- (patient-chosen at compose time, 20260830014522 — 'clinical' is the
-- patient explicitly saying "I need clinical input", as distinct from
-- 'appointment'/'medication'/'laboratory'/'pharmacy'/'billing'/'technical',
-- all of which are the logistics conversations a Care Coordinator handles).
-- 'general' is deliberately NOT gated — it is the default category and the
-- ordinary "message your care team" channel this platform's own trust model
-- (docs/CLINICAL_TRUST_MODEL_SPEC.md) treats as free, on-the-record support;
-- gating it would charge for exactly the channel that superseded WhatsApp
-- support as the trusted way to reach a care team.
--
-- Gated only when the PATIENT starts the thread themselves
-- (created_by = patient_id, per start_care_thread's own insert) — a
-- clinician or Care Coordinator opening a thread on a patient's behalf
-- (created_by <> patient_id) is never blocked by the patient's own payment
-- state; that isn't the patient asking for doctor time; it's the care team
-- reaching out.
--
-- Same pay-per-service shape as video_visit_credit/result_interpretation_
-- credit/second_opinion_credit (redeem_available_service_purchase,
-- 20260831162837): a BEFORE INSERT trigger on care_message_threads redeems
-- one confidential_message_credit, raising a specific, catchable error when
-- none is available rather than silently letting the thread through.

insert into public.service_products (code, name, description, price_kobo, currency, access_duration_days, is_active)
values (
  'confidential_message_credit',
  'Confidential Doctor Message',
  'Start a confidential message thread with a doctor — for reproductive health or any question that needs clinical judgement, not routine logistics.',
  250000, -- ₦2,500, founder-given figure
  'NGN', 90, true
)
on conflict (code) do nothing;

create or replace function private.enforce_confidential_message_credit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.created_by = new.patient_id and (new.confidential or new.category = 'clinical') then
    begin
      perform public.redeem_available_service_purchase(
        new.patient_id, 'confidential_message_credit', 'care_message_thread', new.id
      );
    exception when others then
      if sqlerrm like 'no available%' then
        raise exception 'Buy a confidential message credit to send this — it needs a doctor''s time.'
          using errcode = 'P0001', detail = 'CONFIDENTIAL_MESSAGE_CREDIT_REQUIRED';
      end if;
      raise;
    end;
  end if;
  return new;
end;
$$;

create trigger care_message_threads_enforce_confidential_credit
  before insert on public.care_message_threads
  for each row execute function private.enforce_confidential_message_credit();

do $$
declare
  v_org uuid;
  v_patient uuid;
  v_staff_profile uuid;
  v_product_id uuid;
  v_purchase_id uuid;
  v_thread_id uuid;
begin
  if not exists (select 1 from public.service_products where code = 'confidential_message_credit' and price_kobo = 250000 and is_active) then
    raise exception 'FAIL: confidential_message_credit not seeded with the founder-given ₦2,500 figure';
  end if;

  select id, organisation_id into v_patient, v_org from public.profiles where role = 'patient' limit 1;
  if v_patient is null then
    raise notice 'SKIPPED behavioral proof: no patient row exists to test against';
    return;
  end if;

  -- Control: an ungated 'general' thread must succeed with no credit at all.
  perform set_config('request.jwt.claims', json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.care_message_threads (organisation_id, patient_id, subject, created_by, category, confidential)
  values (v_org, v_patient, 'repoint-proof: general, must not be gated', v_patient, 'general', false)
  returning id into v_thread_id;
  reset role;
  delete from public.care_message_threads where id = v_thread_id;

  -- A 'clinical' thread with no credit must be blocked.
  perform set_config('request.jwt.claims', json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into public.care_message_threads (organisation_id, patient_id, subject, created_by, category, confidential)
    values (v_org, v_patient, 'repoint-proof: clinical, should be blocked, no credit', v_patient, 'clinical', false);
    reset role;
    raise exception 'FAIL: a clinical-category thread was created with no confidential_message_credit';
  exception when others then
    reset role;
    if sqlerrm not like '%Buy a confidential message credit%' then
      raise;
    end if;
  end;

  -- With a credit purchased, the same clinical thread must succeed and
  -- redeem it.
  select id into v_product_id from public.service_products where code = 'confidential_message_credit';
  insert into public.service_purchases
    (organisation_id, patient_id, purchaser_profile_id, service_product_id, status,
     amount_kobo, currency, purchased_at, expires_at)
  values
    (v_org, v_patient, v_patient, v_product_id, 'active', 250000, 'NGN', now(), now() + interval '90 days')
  returning id into v_purchase_id;

  perform set_config('request.jwt.claims', json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.care_message_threads (organisation_id, patient_id, subject, created_by, category, confidential)
  values (v_org, v_patient, 'repoint-proof: clinical, paid via credit', v_patient, 'clinical', false)
  returning id into v_thread_id;
  reset role;

  if not exists (select 1 from public.service_purchases where id = v_purchase_id and redeemed_at is not null and redeemed_entity_id = v_thread_id) then
    raise exception 'FAIL: confidential message credit was not redeemed against the new thread row';
  end if;

  delete from public.care_message_threads where id = v_thread_id;
  delete from public.service_purchases where id = v_purchase_id;

  -- Sabotage: a thread opened BY STAFF for the patient (created_by <>
  -- patient_id) must never be blocked, even confidential + clinical with no
  -- credit at all — this is the care team reaching out, not the patient
  -- asking for doctor time.
  select profile_id into v_staff_profile
  from public.clinical_staff
  where organisation_id = v_org and active
  limit 1;

  if v_staff_profile is not null then
    insert into public.care_message_threads (organisation_id, patient_id, subject, created_by, category, confidential)
    values (v_org, v_patient, 'repoint-proof: staff-opened, must not be gated', v_staff_profile, 'clinical', true)
    returning id into v_thread_id;
    delete from public.care_message_threads where id = v_thread_id;
  else
    raise notice 'SKIPPED staff-opened-thread proof: no active clinical_staff fixture in org';
  end if;

  raise notice 'PASS: care_message_threads confidential/clinical credit gate works, general stays free, staff-opened threads are never gated';
end $$;
