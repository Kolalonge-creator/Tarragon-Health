-- Fix: private.pin_lab_result_consult_amount() was silently charging patients
-- ₦15,000 instead of the ₦7,500 fee they were quoted, for every lab-result
-- consult request with no organisation-specific override.
--
-- ROOT CAUSE
-- ----------
-- 20260831163723_video_visit_and_result_consult_service_products.sql inserted
-- a service_products.result_interpretation_credit tier BETWEEN the org-
-- override and platform-default tiers of lab_result_consult_prices, on the
-- premise that both held the same figure (₦10,000 at the time) and could
-- safely act as one unified platform default.
--
-- 20260910011848_doctor_time_price_ladder_and_result_interpretation.sql then
-- re-laddered and RENAMED that same service_products row to "Result
-- Consultation" at ₦15,000 -- a genuinely different product (a 15-minute
-- *video* consultation about a result), no longer the same thing this
-- trigger charges for (gating the self-arranged *upload* flow). The very next
-- migration, 20260910014006_unbundle_chronic_pack.sql, separately aligned
-- lab_result_consult_prices itself to ₦7,500 to match the new
-- written_result_interpretation product, and asserted the two stay equal --
-- but neither migration touched this trigger, so its priority-1 fallback
-- kept reading the now-unrelated, now-more-expensive result_interpretation_
-- credit row ahead of the correct platform default at priority 2. Every
-- request with no org override (i.e. every request so far) resolved to
-- ₦15,000 instead of the ₦7,500 the patient was quoted from
-- lab_result_consult_prices (what useLabResultConsultPrice and the admin
-- settings page at /admin/settings/lab-result-consult-pricing both read).
--
-- Reproduced live 2026-09-16: the one lab_result_consult_requests row that
-- exists (a test-mode Paystack reproduction, patient firstpatient@gmail.com,
-- id cd967068-9015-4cd8-859d-916a34d59580) was pinned at amount_minor
-- 1500000 despite being quoted 750000. No other row exists, so no real
-- charge needs reversing -- this migration only needs to stop it recurring.
--
-- THE FIX
-- -------
-- Drop the service_products fallback entirely and go back to the original
-- (pre-2026-08-31) two-tier shape: org-override, then platform default, both
-- from lab_result_consult_prices alone. That table is what the price display
-- and the admin settings page already treat as the source of truth for this
-- specific fee, and it already carries the founder-set ₦7,500 figure. The
-- analogous video-visit fallback (pin_video_visit_amount, same migration) is
-- deliberately left untouched: video_visit_prices and service_products.
-- video_visit_credit were reconciled to the same ₦10,000 figure on 2026-09-10
-- and have no such fork.
begin;

create or replace function private.pin_lab_result_consult_amount()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_price record;
  v_order record;
begin
  if new.lab_order_id is not null then
    select patient_id, organisation_id, fulfilment::text as fulfilment
      into v_order
      from public.lab_orders where id = new.lab_order_id;

    if v_order.patient_id is null or v_order.patient_id is distinct from new.patient_id then
      raise exception 'lab_order_id does not belong to this patient' using errcode = '23514';
    end if;
    if v_order.fulfilment = 'partner' then
      raise exception 'A network-billed lab order does not need a separate consultation fee'
        using errcode = '23514';
    end if;
  end if;

  select p.amount_minor, p.currency, p.is_enabled into v_price
  from (
    select amount_minor, currency, is_enabled, 0 as pri
    from public.lab_result_consult_prices where organisation_id = new.organisation_id
    union all
    select amount_minor, currency, is_enabled, 1
    from public.lab_result_consult_prices where organisation_id is null
  ) p
  order by p.pri
  limit 1;

  if v_price.amount_minor is null or not v_price.is_enabled then
    raise exception 'the lab-result consultation fee is not available right now';
  end if;
  new.amount_minor := v_price.amount_minor;
  new.currency := v_price.currency;
  new.status := 'requested';
  new.origin := 'patient_initiated';
  new.payment_provider := null;
  new.payment_provider_ref := null;
  new.pending_payment_provider_ref := null;
  new.refund_status := null;
  new.refund_ref := null;
  new.lab_result_document_id := null;
  return new;
end;
$$;

do $$
declare
  v_org      uuid;
  v_patient  uuid;
  v_req_id   uuid;
  v_amount   bigint;
  v_expected bigint;
begin
  select amount_minor into v_expected
    from public.lab_result_consult_prices where organisation_id is null and is_enabled;
  if v_expected is null then
    raise exception 'FAIL: no enabled platform-default lab_result_consult_prices row to verify against';
  end if;

  select id, organisation_id into v_patient, v_org from public.profiles where role = 'patient' limit 1;
  if v_patient is null then
    raise notice 'SKIPPED behavioral proof: no patient row exists to test against';
    return;
  end if;

  insert into public.lab_result_consult_requests (organisation_id, patient_id, note)
  values (v_org, v_patient, 'fix-stale-fallback-proof')
  returning id, amount_minor into v_req_id, v_amount;

  if v_amount is distinct from v_expected then
    raise exception 'FAIL: lab_result_consult_requests pinned % but lab_result_consult_prices says %', v_amount, v_expected;
  end if;
  if v_amount = 1500000 and v_expected <> 1500000 then
    raise exception 'FAIL: still resolving the stale result_interpretation_credit fallback';
  end if;
  delete from public.lab_result_consult_requests where id = v_req_id;

  raise notice 'PASS: lab-result consult fee resolves to lab_result_consult_prices (%) alone', v_expected;
end $$;

commit;
