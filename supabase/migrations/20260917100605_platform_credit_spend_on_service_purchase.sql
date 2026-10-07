-- Tarragon Health — Platform Credit, part 4: spend it on a service purchase.
--
-- Deliberately scoped to service_products/service_purchases only — the
-- platform's current general-purpose paid-service catalogue (doctor time,
-- packs, the 12-week programme). Wiring platform credit into the separate
-- lab/pharmacy/referral booking-order checkout paths is a natural follow-up
-- but out of scope here, to keep this change reviewable as one thing.
--
-- pay_service_purchase_on_platform_credit reuses
-- public.record_service_purchase_intent to create the pending row (no new
-- insert path into service_purchases — see
-- 20260905000123_service_purchases_insert_only_via_intent_rpc.sql, whose
-- entire point was that record_service_purchase_intent is the ONE legitimate
-- way in), then settles it from the caller's platform_credit balance instead
-- of starting a Paystack checkout. The UPDATE at the end is byte-identical in
-- shape to private.apply_service_purchase_payment's activation (same status/
-- payment_provider/purchased_at/expires_at columns), so every existing
-- AFTER UPDATE trigger on service_purchases (chronic-programme enrolment,
-- weight-management eligibility, etc.) fires exactly as it would for a card
-- payment — activation is activation, regardless of how it was paid for.

create or replace function public.pay_service_purchase_on_platform_credit(
  p_service_purchase_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_purchase public.service_purchases%rowtype;
  v_product public.service_products%rowtype;
  v_amount_kobo bigint;
  v_ledger_entry_id uuid;
  v_new_balance bigint;
  v_balance public.platform_credit_balances%rowtype;
begin
  if v_caller is null then
    raise exception 'not authenticated';
  end if;

  select * into v_purchase from public.service_purchases
    where id = p_service_purchase_id for update;
  if not found then
    raise exception 'purchase not found';
  end if;
  if v_purchase.status <> 'pending_payment' then
    return jsonb_build_object('ok', false, 'reason', 'not_payable', 'status', v_purchase.status);
  end if;
  if v_purchase.purchaser_profile_id <> v_caller and not private.is_org_staff(v_purchase.organisation_id) then
    raise exception 'not authorised to pay for this purchase' using errcode = '42501';
  end if;

  select * into v_product from public.service_products where id = v_purchase.service_product_id;

  -- payable_kobo already reflects any promo-code/voucher discount applied to
  -- this pending purchase (see record_service_purchase_intent/
  -- redeem_promo_code) — same amount the Paystack path would charge.
  v_amount_kobo := coalesce(v_purchase.payable_kobo, v_purchase.amount_kobo);
  if v_amount_kobo is null or v_amount_kobo <= 0 then
    -- record_service_purchase_intent already activates a free/fully-covered
    -- purchase itself; nothing left for platform credit to pay.
    return jsonb_build_object('ok', true, 'already_active', v_purchase.status = 'active');
  end if;

  select * into v_balance from public.platform_credit_balances where patient_id = v_purchase.patient_id;

  if v_balance.patient_id is null or v_balance.balance_kobo < v_amount_kobo then
    return jsonb_build_object(
      'ok', false,
      'reason', 'insufficient_balance',
      'balance_kobo', coalesce(v_balance.balance_kobo, 0),
      'required_kobo', v_amount_kobo,
      'shortfall_kobo', v_amount_kobo - coalesce(v_balance.balance_kobo, 0)
    );
  end if;

  v_new_balance := private.platform_credit_apply(
    p_patient_id := v_purchase.patient_id,
    p_organisation_id := v_purchase.organisation_id,
    p_entry_type := 'spend',
    p_amount_kobo := v_amount_kobo,
    p_service_purchase_id := v_purchase.id,
    p_description := 'Service purchase: ' || coalesce(v_product.name, v_product.code)
  );

  select id into v_ledger_entry_id from public.platform_credit_ledger_entries
    where service_purchase_id = v_purchase.id order by created_at desc limit 1;

  update public.service_purchases
    set status = 'active',
        payment_provider = 'platform_credit',
        payment_provider_ref = v_ledger_entry_id::text,
        pending_payment_provider_ref = null,
        purchased_at = now(),
        expires_at = case when v_product.access_duration_days is null then null
                          else now() + (v_product.access_duration_days || ' days')::interval end
    where id = v_purchase.id;

  return jsonb_build_object(
    'ok', true,
    'service_purchase_id', v_purchase.id,
    'amount_kobo', v_amount_kobo,
    'new_balance_kobo', v_new_balance
  );

exception
  when sqlstate 'TH001' then
    -- A concurrent spend (e.g. two tabs) beat this one to the balance
    -- between the read above and platform_credit_apply's own lock — surface
    -- the same shape as the pre-check above rather than a raw DB error.
    select * into v_balance from public.platform_credit_balances where patient_id = v_purchase.patient_id;
    return jsonb_build_object(
      'ok', false,
      'reason', 'insufficient_balance',
      'balance_kobo', coalesce(v_balance.balance_kobo, 0),
      'required_kobo', v_amount_kobo,
      'shortfall_kobo', v_amount_kobo - coalesce(v_balance.balance_kobo, 0)
    );
end;
$$;

revoke execute on function public.pay_service_purchase_on_platform_credit(uuid) from public, anon;
grant execute on function public.pay_service_purchase_on_platform_credit(uuid) to authenticated;

do $$
declare
  v_product_id uuid;
  v_patient uuid;
  v_org uuid;
  v_purchase_id uuid;
  v_result jsonb;
  v_balance_before bigint;
  v_balance_after bigint;
  v_pre_existing_balance public.platform_credit_balances%rowtype;
  v_had_pre_existing_balance boolean;
begin
  if has_function_privilege('anon', 'public.pay_service_purchase_on_platform_credit(uuid)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute pay_service_purchase_on_platform_credit';
  end if;

  select id, organisation_id into v_patient, v_org from public.profiles where role = 'patient' limit 1;
  if v_patient is null then
    raise notice 'SKIPPED behavioral proof: no patient row exists to test against';
  else
    select id into v_product_id from public.service_products
      where is_active and currency = 'NGN' and price_kobo > 0 order by price_kobo limit 1;
    if v_product_id is null then
      raise notice 'SKIPPED behavioral proof: no active priced NGN service_product exists';
    else
      -- Refused with no balance at all.
      insert into public.service_purchases
        (organisation_id, patient_id, purchaser_profile_id, service_product_id, status, amount_kobo, currency)
      select v_org, v_patient, v_patient, v_product_id, 'pending_payment', p.price_kobo, p.currency
        from public.service_products p where p.id = v_product_id
      returning id into v_purchase_id;

      -- Preserve whatever platform credit state this real patient already
      -- had (if any) — this proof mutates it and must restore it exactly,
      -- never leave a test artefact or a wiped real balance behind.
      select * into v_pre_existing_balance from public.platform_credit_balances where patient_id = v_patient;
      v_had_pre_existing_balance := found;

      -- pay_service_purchase_on_platform_credit checks auth.uid() itself, so
      -- the call has to run under a simulated authenticated session (same
      -- technique as packages/db/tests/service_purchases_insert_only_via_intent_rpc.sql)
      -- rather than as the migration's own postgres role.
      perform set_config('request.jwt.claims',
        json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
      set local role authenticated;
      select public.pay_service_purchase_on_platform_credit(v_purchase_id) into v_result;
      reset role;
      if (v_result ->> 'ok')::boolean is distinct from false or (v_result ->> 'reason') is distinct from 'insufficient_balance' then
        raise exception 'FAIL: spend with zero balance should be refused as insufficient_balance, got %', v_result;
      end if;

      -- Fund it via the same primitive a real top-up uses, then spend succeeds.
      perform private.platform_credit_apply(
        p_patient_id := v_patient, p_organisation_id := v_org, p_entry_type := 'topup',
        p_amount_kobo := (select price_kobo from public.service_products where id = v_product_id) + 100000,
        p_description := 'migration-proof funding'
      );
      select balance_kobo into v_balance_before from public.platform_credit_balances where patient_id = v_patient;

      set local role authenticated;
      select public.pay_service_purchase_on_platform_credit(v_purchase_id) into v_result;
      reset role;
      if (v_result ->> 'ok')::boolean is distinct from true then
        raise exception 'FAIL: spend with sufficient balance should succeed, got %', v_result;
      end if;

      if (select status from public.service_purchases where id = v_purchase_id) is distinct from 'active' then
        raise exception 'FAIL: service_purchases row was not activated by the credit spend';
      end if;
      if (select payment_provider from public.service_purchases where id = v_purchase_id) is distinct from 'platform_credit' then
        raise exception 'FAIL: payment_provider was not stamped platform_credit';
      end if;

      select balance_kobo into v_balance_after from public.platform_credit_balances where patient_id = v_patient;
      if v_balance_after >= v_balance_before then
        raise exception 'FAIL: balance did not decrease after spend (before=%, after=%)', v_balance_before, v_balance_after;
      end if;

      -- Sabotage: an already-active purchase must not be payable again.
      set local role authenticated;
      select public.pay_service_purchase_on_platform_credit(v_purchase_id) into v_result;
      reset role;
      if (v_result ->> 'ok')::boolean is distinct from false or (v_result ->> 'reason') is distinct from 'not_payable' then
        raise exception 'FAIL: paying an already-active purchase again should be refused, got %', v_result;
      end if;

      delete from public.platform_credit_ledger_entries
        where service_purchase_id = v_purchase_id or description = 'migration-proof funding';
      delete from public.service_purchases where id = v_purchase_id;

      if v_had_pre_existing_balance then
        update public.platform_credit_balances
          set paid_balance_kobo = v_pre_existing_balance.paid_balance_kobo,
              promo_balance_kobo = v_pre_existing_balance.promo_balance_kobo,
              lifetime_funded_kobo = v_pre_existing_balance.lifetime_funded_kobo,
              lifetime_granted_kobo = v_pre_existing_balance.lifetime_granted_kobo,
              lifetime_spent_kobo = v_pre_existing_balance.lifetime_spent_kobo
          where patient_id = v_patient;
      else
        delete from public.platform_credit_balances where patient_id = v_patient;
      end if;
    end if;
  end if;

  raise notice 'PASS: pay_service_purchase_on_platform_credit refuses/succeeds/discriminates correctly';
end $$;
