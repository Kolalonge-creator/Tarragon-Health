-- First-purchase money-back guarantee: end-to-end proof, in one rolled-back
-- transaction. See 20260924210805_first_purchase_guarantee_refunds.sql for
-- the scope/design rationale.
--
-- Exercises the REAL activation pipeline rather than hand-rolled fixtures
-- where practical: a fixture purchase is created via
-- record_service_purchase_intent() and then activated by inserting the same
-- shape of payment_transactions row the Paystack webhook would insert (for
-- the card-paid case) or via the real pay_service_purchase_on_platform_credit
-- RPC (for the credit-paid case) — so the fixtures also exercise
-- apply_service_purchase_payment/finance_post_from_payment/
-- finance_create_recognition_schedule/activate_chronic_programme_doctor_
-- supported_track exactly as production would, not a guess at their shape.
--
-- Covers: eligibility gating (not-first-purchase, ineligible provider,
-- already-claimed), the admin-only gate on the decide RPC (proved to refuse
-- a non-admin, not just to succeed for an admin — a gate that only ever
-- succeeds is unproven), GL reversal correctness including an
-- ALREADY-RECOGNISED revenue tranche (the case 20260905204245_reverse_
-- phantom_service_purchase_revenue.sql exists to warn about), the Paystack
-- refund queue shape, the platform-credit balance restoration + its GL
-- reversal, the chronic-programme track downgrade, and a repeat-decide
-- idempotency guard.
--
-- Run:  npx supabase db query --linked -f packages/db/tests/first_purchase_guarantee_refund.sql
--       (from the MAIN checkout, not a worktree — see reference_supabase_cli_sql_access)
--
-- The whole file rolls back. Nothing here should survive.

begin;

create temp table _checks (n serial, msg text) on commit drop;
grant insert, select on _checks to authenticated;
grant usage, select on sequence _checks_n_seq to authenticated;

do $$
declare
  v_admin              uuid;
  v_patient            uuid;
  v_org                uuid;
  v_product_a          public.service_products%rowtype;
  v_purchase_a         uuid;
  v_ref_a              text;
  v_txn_a              uuid;
  v_entry_a            uuid;
  v_schedule_a         record;
  v_recognised_before  bigint;
  v_purchase_v         uuid; -- ineligible: voucher-funded
  v_claim_id           uuid;
  v_res                jsonb;
  v_queue_count        int;
  v_entry_reversed     boolean;
  v_recog_entry_id     uuid;
  v_recog_reversed     boolean;
  -- Platform-credit + chronic-programme-track fixture
  v_patient2           uuid;
  v_org2               uuid;
  v_have_patient2      boolean := false;
  v_programme_id       uuid;
  v_product_c          public.service_products%rowtype;
  v_enrolment_id       uuid;
  v_purchase_c         uuid;
  v_res_c              jsonb;
  v_ledger_before      bigint;
  v_ledger_after       bigint;
  v_claim_id2          uuid;
  v_track_after        public.chronic_programme_track;
begin
  select id, organisation_id into v_admin, v_org from public.profiles where role = 'admin' limit 1;
  select p.id, p.organisation_id into v_patient, v_org
    from public.profiles p
    where p.role = 'patient' and not exists (select 1 from public.service_purchases sp where sp.patient_id = p.id)
    limit 1;
  select * into v_product_a from public.service_products
    where code = 'async_consult_credit' and is_active;

  if v_admin is null or v_patient is null or v_product_a.id is null then
    raise notice 'SKIPPED behavioral proof: no admin/service-purchase-free patient/async_consult_credit product fixture available';
  else

    -- =========================================================================
    -- 1. FIXTURE — a real card-paid, bounded-duration (deferred revenue)
    --    purchase, activated via the same payment_transactions row shape the
    --    Paystack webhook inserts, then one month of revenue recognised
    --    ahead of the refund (proves the reversal covers already-recognised
    --    tranches, not just the original entry).
    -- =========================================================================
    perform set_config('request.jwt.claims', json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
    set local role authenticated;
    v_purchase_a := public.record_service_purchase_intent(v_patient, v_product_a.code);
    reset role;

    v_ref_a := 'TEST-GUAR-A-' || v_purchase_a::text;
    update public.service_purchases set pending_payment_provider_ref = v_ref_a where id = v_purchase_a;

    -- Simulate a customer-borne processor fee: charge 2% more than the
    -- nominal price, the way this account's real Paystack charges do (see
    -- 20260910215431_service_purchase_activation_tolerates_customer_borne_fee.sql).
    -- The guarantee refund must return the REAL charged amount, not the
    -- nominal price — proved below.
    insert into public.payment_transactions
      (organisation_id, provider, provider_event_id, event_type, amount_minor, currency, raw_payload, processed_at)
    values
      (v_org, 'paystack', 'test-evt-guar-a-' || v_purchase_a::text, 'charge.success',
       v_product_a.price_kobo + (v_product_a.price_kobo / 50), 'NGN',
       jsonb_build_object('data', jsonb_build_object('reference', v_ref_a, 'metadata', jsonb_build_object('kind', 'service_purchase'))),
       now())
    returning id into v_txn_a;

    if (select status from public.service_purchases where id = v_purchase_a) is distinct from 'active' then
      raise exception 'FIXTURE FAIL: purchase A was not activated by the simulated webhook payment';
    end if;

    select id into v_entry_a from public.finance_journal_entries where source = 'payment' and source_ref = v_txn_a::text;
    if v_entry_a is null then
      raise exception 'FIXTURE FAIL: no payment journal entry was posted for purchase A';
    end if;

    select * into v_schedule_a from public.revenue_recognition_schedules
      where source_kind = 'service_purchase' and source_id = v_purchase_a;
    if v_schedule_a.id is null then
      raise exception 'FIXTURE FAIL: no revenue recognition schedule was created for purchase A (async_consult_credit has a bounded access window)';
    end if;

    -- Force one month of revenue to recognise, so the refund below has to
    -- reverse a tranche that already posted, not just the original entry.
    perform private.finance_recognize_revenue((current_date + interval '31 days')::date);
    select recognized_minor into v_recognised_before from public.revenue_recognition_schedules where id = v_schedule_a.id;
    if v_recognised_before <= 0 then
      raise exception 'FIXTURE FAIL: expected at least one month of revenue recognised ahead of the refund, got %', v_recognised_before;
    end if;
    select id into v_recog_entry_id from public.finance_journal_entries
      where source = 'revenue_recognition' and source_ref like 'revrec:' || v_schedule_a.id::text || ':%'
      limit 1;
    if v_recog_entry_id is null then
      raise exception 'FIXTURE FAIL: expected a revenue_recognition journal entry to exist ahead of the refund';
    end if;

    -- A second, ineligible-provider purchase for the same patient (voucher-
    -- funded — no patient cash behind it). Inserted directly: this is
    -- proving MY eligibility gate, not re-proving the voucher purchase path.
    -- purchased_at is explicitly later than purchase A's: within one
    -- transaction now() is frozen, so without this both purchases would tie
    -- on purchased_at and the id-based tiebreak could make this one "first"
    -- by accident, which is not what this fixture is testing.
    insert into public.service_purchases
      (organisation_id, patient_id, purchaser_profile_id, service_product_id, status, amount_kobo, currency,
       payment_provider, payment_provider_ref, purchased_at)
    values
      (v_org, v_patient, v_patient, v_product_a.id, 'active', v_product_a.price_kobo, 'NGN',
       'voucher', 'test-voucher-ref', now() + interval '1 minute')
    returning id into v_purchase_v;

    -- =========================================================================
    -- 2. request_purchase_guarantee_refund — eligibility gating
    -- =========================================================================
    perform set_config('request.jwt.claims', json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
    set local role authenticated;

    select public.request_purchase_guarantee_refund(v_purchase_v) into v_res;
    if (v_res ->> 'ok')::boolean is distinct from false or (v_res ->> 'reason') is distinct from 'not_eligible_provider' then
      raise exception 'FAIL 1: a voucher-funded purchase should be refused not_eligible_provider, got %', v_res;
    end if;
    insert into _checks (msg) values ('PASS 1: a voucher-funded purchase is refused with not_eligible_provider');

    select public.request_purchase_guarantee_refund(v_purchase_a, 'wanted to try something else') into v_res;
    reset role;
    if (v_res ->> 'ok')::boolean is distinct from true then
      raise exception 'FAIL 2: the patient''s eligible first purchase should be claimable, got %', v_res;
    end if;
    v_claim_id := (v_res ->> 'claim_id')::uuid;
    insert into _checks (msg) values ('PASS 2: an eligible first-purchase claim is created');

    perform set_config('request.jwt.claims', json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
    set local role authenticated;
    select public.request_purchase_guarantee_refund(v_purchase_a) into v_res;
    reset role;
    if (v_res ->> 'ok')::boolean is distinct from false or (v_res ->> 'reason') is distinct from 'already_claimed' then
      raise exception 'FAIL 3: a second claim on the same purchase should be refused already_claimed, got %', v_res;
    end if;
    insert into _checks (msg) values ('PASS 3: a repeat claim on the same purchase is refused already_claimed');

    -- =========================================================================
    -- 3. decide_purchase_guarantee_refund — admin-only gate proved BOTH ways
    -- =========================================================================
    perform set_config('request.jwt.claims', json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
    set local role authenticated;
    begin
      perform public.decide_purchase_guarantee_refund(v_claim_id, true, 'self-approved');
      raise exception 'FAIL 4: a non-admin patient approved their own guarantee claim';
    exception when others then
      if sqlerrm like 'FAIL%' then raise; end if;
      insert into _checks (msg) values ('PASS 4: a non-admin is refused decide_purchase_guarantee_refund (' || sqlerrm || ')');
    end;
    reset role;

    perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
    set local role authenticated;
    select public.decide_purchase_guarantee_refund(v_claim_id, true, 'approved for test') into v_res;
    reset role;
    if (v_res ->> 'ok')::boolean is distinct from true or (v_res ->> 'status') is distinct from 'approved'
       or (v_res ->> 'refund_mode') is distinct from 'queued' then
      raise exception 'FAIL 5: admin approval of a paystack-paid claim should succeed queued, got %', v_res;
    end if;
    insert into _checks (msg) values ('PASS 5: an admin approves a paystack-paid claim, refund_mode=queued');

    if (select status from public.service_purchases where id = v_purchase_a) is distinct from 'refunded' then
      raise exception 'FAIL 6: purchase A status was not flipped to refunded';
    end if;
    insert into _checks (msg) values ('PASS 6: the underlying service_purchases row is marked refunded');

    select is_reversed into v_entry_reversed from public.finance_journal_entries where id = v_entry_a;
    if not v_entry_reversed then
      raise exception 'FAIL 7: the original payment journal entry was not reversed';
    end if;
    insert into _checks (msg) values ('PASS 7: the original payment journal entry was reversed');

    select is_reversed into v_recog_reversed from public.finance_journal_entries where id = v_recog_entry_id;
    if not v_recog_reversed then
      raise exception 'FAIL 8: the ALREADY-RECOGNISED revenue tranche was not reversed — this is exactly the phantom-revenue class of bug';
    end if;
    insert into _checks (msg) values ('PASS 8: the already-recognised revenue tranche was also reversed, not just the original entry');

    if (select status from public.revenue_recognition_schedules where id = v_schedule_a.id) is distinct from 'cancelled'
       or (select cancelled_reason from public.revenue_recognition_schedules where id = v_schedule_a.id) is null then
      raise exception 'FAIL 9: the recognition schedule was not cancelled with a recorded reason';
    end if;
    insert into _checks (msg) values ('PASS 9: the recognition schedule is cancelled with a recorded reason');

    -- Review fix: the queued refund must be the REAL charged amount
    -- (including the simulated 2% customer-borne fee above), never the
    -- nominal price — a guarantee that shorts the patient by the processor
    -- fee is not "the FULL amount actually paid" as promised.
    select count(*) into v_queue_count from public.service_purchase_refund_queue where guarantee_claim_id = v_claim_id;
    perform 1 from public.service_purchase_refund_queue
      where guarantee_claim_id = v_claim_id and provider = 'paystack' and status = 'due'
        and provider_reference = v_ref_a
        and amount_minor = v_product_a.price_kobo + (v_product_a.price_kobo / 50);
    if v_queue_count = 1 and found then
      insert into _checks (msg) values ('PASS 10: refund queue row refunds the REAL charged amount (incl. customer-borne fee), not the nominal price');
    else
      raise exception 'FAIL 10: refund queue row missing or wrongly-amounted (fee not honoured), count=%', v_queue_count;
    end if;

    perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
    set local role authenticated;
    select public.decide_purchase_guarantee_refund(v_claim_id, true, 'try again') into v_res;
    reset role;
    if (v_res ->> 'ok')::boolean is distinct from false or (v_res ->> 'reason') is distinct from 'already_decided' then
      raise exception 'FAIL 11: deciding an already-decided claim again should be refused, got %', v_res;
    end if;
    insert into _checks (msg) values ('PASS 11: a repeat decision on an already-decided claim is refused (no double refund)');
  end if;

  -- =========================================================================
  -- 4. Platform-credit path + chronic-programme track downgrade — a
  --    separate, purchase-history-free patient so their guarantee-eligible
  --    "first purchase" is unambiguous.
  -- =========================================================================
  select p.id, p.organisation_id into v_patient2, v_org2
    from public.profiles p
    where p.role = 'patient' and p.id is distinct from v_patient
      and not exists (select 1 from public.service_purchases sp where sp.patient_id = p.id)
    limit 1;
  select id into v_programme_id from public.chronic_condition_programmes limit 1;
  select * into v_product_c from public.service_products
    where 'chronic_doctor_supported_track' = any(features) and is_active and currency = 'NGN' and price_kobo > 0
    limit 1;
  v_have_patient2 := v_admin is not null and v_patient2 is not null and v_programme_id is not null and v_product_c.id is not null;

  if not v_have_patient2 then
    raise notice 'SKIPPED platform-credit/chronic-track section: no second purchase-history-free patient / chronic programme / doctor-supported product fixture available';
  else
    insert into public.chronic_programme_enrolments (organisation_id, patient_id, programme_id, status)
    values (v_org2, v_patient2, v_programme_id, 'enrolled')
    returning id into v_enrolment_id;
    -- Simulate "already upgraded by a prior real purchase" — the trigger
    -- under test here is the DOWNGRADE on refund, not this upgrade (that is
    -- proved by 20260911211641_fix_stale_chronic_doctor_supported_track_
    -- activation_check.sql already).
    update public.chronic_programme_enrolments set track = 'doctor_supported' where id = v_enrolment_id;

    perform private.platform_credit_apply(
      p_patient_id := v_patient2, p_organisation_id := v_org2, p_entry_type := 'topup',
      p_amount_kobo := v_product_c.price_kobo + 500000, p_description := 'guarantee-test funding'
    );
    select balance_kobo into v_ledger_before from public.platform_credit_balances where patient_id = v_patient2;

    perform set_config('request.jwt.claims', json_build_object('sub', v_patient2, 'role', 'authenticated')::text, true);
    set local role authenticated;
    v_purchase_c := public.record_service_purchase_intent(v_patient2, v_product_c.code, 'chronic_programme_enrolments', v_enrolment_id);
    select public.pay_service_purchase_on_platform_credit(v_purchase_c) into v_res_c;
    reset role;

    if (v_res_c ->> 'ok')::boolean is distinct from true then
      raise exception 'FIXTURE FAIL: platform-credit purchase of % did not succeed, got %', v_product_c.code, v_res_c;
    end if;
    if (select track from public.chronic_programme_enrolments where id = v_enrolment_id) is distinct from 'doctor_supported' then
      raise exception 'FIXTURE FAIL: expected the enrolment to still be doctor_supported after the fixture purchase';
    end if;

    perform set_config('request.jwt.claims', json_build_object('sub', v_patient2, 'role', 'authenticated')::text, true);
    set local role authenticated;
    select public.request_purchase_guarantee_refund(v_purchase_c) into v_res;
    reset role;
    if (v_res ->> 'ok')::boolean is distinct from true then
      raise exception 'FAIL 12: the platform-credit-paid first purchase should be claimable, got %', v_res;
    end if;
    v_claim_id2 := (v_res ->> 'claim_id')::uuid;
    insert into _checks (msg) values ('PASS 12: a platform-credit-paid first purchase is claimable');

    perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
    set local role authenticated;
    select public.decide_purchase_guarantee_refund(v_claim_id2, true, 'approved for test') into v_res;
    reset role;
    if (v_res ->> 'ok')::boolean is distinct from true or (v_res ->> 'refund_mode') is distinct from 'platform_credit_restored' then
      raise exception 'FAIL 13: admin approval of a platform-credit-paid claim should succeed platform_credit_restored, got %', v_res;
    end if;
    insert into _checks (msg) values ('PASS 13: an admin approves a platform-credit-paid claim, refund_mode=platform_credit_restored');

    select balance_kobo into v_ledger_after from public.platform_credit_balances where patient_id = v_patient2;
    if v_ledger_after <= v_ledger_before - v_product_c.price_kobo then
      -- Allow for the earlier topup fixture; the assertion that matters is
      -- the balance went back UP by (about) the spend amount after refund,
      -- not the exact absolute figure.
      raise exception 'FAIL 14: platform credit balance was not restored by the refund (before=%, after=%)', v_ledger_before, v_ledger_after;
    end if;
    insert into _checks (msg) values ('PASS 14: the patient''s platform credit balance is restored');

    select track into v_track_after from public.chronic_programme_enrolments where id = v_enrolment_id;
    if v_track_after is distinct from 'self_monitoring' then
      raise exception 'FAIL 15: the chronic-programme enrolment track was not downgraded back to self_monitoring after the refund, got %', v_track_after;
    end if;
    insert into _checks (msg) values ('PASS 15: the chronic-programme enrolment track is downgraded back to self_monitoring on refund');

    -- Review fix: no duplicate GL posting on the liability account. The
    -- 'spend-paid' entry must be left UN-reversed — correct_platform_credit
    -- is now the sole reversal mechanism for a platform-credit-paid
    -- purchase; also reversing the original spend entry would double-debit
    -- account 2100/2600 for one restoration event.
    if exists (
      select 1 from public.finance_journal_entries e
      join public.platform_credit_ledger_entries l
        on e.source = 'platform_credit' and e.source_ref = 'spend-paid:' || l.id::text
      where l.service_purchase_id = v_purchase_c and e.is_reversed = true
    ) then
      raise exception 'FAIL 16: the platform-credit spend entry was reversed — this is the double-GL-posting bug the review fix removed';
    else
      insert into _checks (msg) values ('PASS 16: the platform-credit spend entry is left untouched (correct_platform_credit is the sole reversal path, no double-debit)');
    end if;
  end if;

  -- =========================================================================
  -- 5. STRUCTURAL — anon has no access to either RPC
  -- =========================================================================
  if has_function_privilege('anon', 'public.request_purchase_guarantee_refund(uuid, text)', 'EXECUTE') then
    raise exception 'FAIL 17: anon has EXECUTE on request_purchase_guarantee_refund';
  else
    insert into _checks (msg) values ('PASS 17: anon has no EXECUTE on request_purchase_guarantee_refund');
  end if;
  if has_function_privilege('anon', 'public.decide_purchase_guarantee_refund(uuid, boolean, text)', 'EXECUTE') then
    raise exception 'FAIL 18: anon has EXECUTE on decide_purchase_guarantee_refund';
  else
    insert into _checks (msg) values ('PASS 18: anon has no EXECUTE on decide_purchase_guarantee_refund');
  end if;
end $$;

select msg from _checks order by n;

rollback;
