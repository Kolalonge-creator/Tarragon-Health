-- Paystack Dedicated Virtual Accounts: reconciliation proof, in one
-- rolled-back transaction. Mirrors care_vouchers.sql's own
-- positive-control-paired-with-every-negative-check discipline.
--
-- Self-contained: creates its own organisation/profiles/panel bundle.
--
-- Run:  npx supabase db query --linked -f packages/db/tests/paystack_dedicated_virtual_accounts.sql
--       (from the MAIN checkout, not a worktree — see reference_supabase_cli_sql_access)
--
-- The whole file rolls back. Nothing here should survive.

begin;

create temp table _checks (n serial, msg text) on commit drop;
grant insert on _checks to authenticated;
grant usage on sequence _checks_n_seq to authenticated;

do $$
declare
  c_org              constant uuid := gen_random_uuid();
  v_admin            uuid := gen_random_uuid();
  v_one_voucher      uuid := gen_random_uuid();  -- exactly one reserved voucher, half-paid
  v_one_lab          uuid := gen_random_uuid();  -- exactly one pending lab order
  v_two_vouchers     uuid := gen_random_uuid();  -- two reserved vouchers: ambiguous
  v_zero             uuid := gen_random_uuid();  -- nothing outstanding
  v_panel            uuid;
  v_voucher          uuid;
  v_voucher_a        uuid;
  v_lab_order        uuid;
  v_res              jsonb;
  v_n                int;
  v_paid             bigint;
  v_status           text;
  v_note             text;
  v_unmatched_org    uuid;
  v_unmatched_profile uuid;
begin
  insert into public.organisations (id, name, type) values (c_org, 'DVA Test Org', 'clinic');

  insert into auth.users (id) values (v_admin), (v_one_voucher), (v_one_lab), (v_two_vouchers), (v_zero);

  insert into public.profiles (id, organisation_id, role, full_name, phone) values
    (v_admin, c_org, 'admin', 'DVA Admin', '+2348030000001'),
    (v_one_voucher, c_org, 'patient', 'One Voucher Patient', '+2348030000002'),
    (v_one_lab, c_org, 'patient', 'One Lab Order Patient', '+2348030000003'),
    (v_two_vouchers, c_org, 'patient', 'Two Voucher Patient', '+2348030000004'),
    (v_zero, c_org, 'patient', 'Zero Obligation Patient', '+2348030000005');

  insert into public.panel_bundles (id, code, name, price_kobo)
    values (gen_random_uuid(), 'db_test_dva_panel_' || substr(c_org::text, 1, 8), 'DVA Test Panel', 2950000)
    returning id into v_panel;

  insert into public.patient_dedicated_accounts
    (organisation_id, profile_id, paystack_customer_code, paystack_dedicated_account_id, account_number, bank_name, bank_slug)
  values
    (c_org, v_one_voucher, 'CUS_TEST_' || v_one_voucher, 'DA_1', '9010000001', 'Wema Bank', 'wema-bank'),
    (c_org, v_one_lab, 'CUS_TEST_' || v_one_lab, 'DA_2', '9010000002', 'Wema Bank', 'wema-bank'),
    (c_org, v_two_vouchers, 'CUS_TEST_' || v_two_vouchers, 'DA_3', '9010000003', 'Wema Bank', 'wema-bank'),
    (c_org, v_zero, 'CUS_TEST_' || v_zero, 'DA_4', '9010000004', 'Wema Bank', 'wema-bank');

  -- Half-paid voucher: 1,475,000 of 2,950,000 already paid, 1,475,000 owing.
  insert into public.care_vouchers
    (organisation_id, voucher_number, kind, beneficiary_profile_id, purchaser_profile_id,
     panel_bundle_id, sku_code, sku_name, face_value_kobo, amount_paid_kobo, status)
  values
    (c_org, 'TAR-VCH-DVATEST1-' || substr(c_org::text, 1, 8), 'prepaid_service',
     v_one_voucher, v_one_voucher, v_panel, 'DVA_TEST', 'DVA Test Panel', 2950000, 1475000, 'reserved')
  returning id into v_voucher;

  insert into public.lab_orders (organisation_id, patient_id, panel_bundle_id, status, payable_kobo)
    values (c_org, v_one_lab, v_panel, 'pending_payment', 2950000)
    returning id into v_lab_order;

  insert into public.care_vouchers
    (organisation_id, voucher_number, kind, beneficiary_profile_id, purchaser_profile_id,
     panel_bundle_id, sku_code, sku_name, face_value_kobo, amount_paid_kobo, status)
  values
    (c_org, 'TAR-VCH-DVATEST2-' || substr(c_org::text, 1, 8), 'prepaid_service',
     v_two_vouchers, v_two_vouchers, v_panel, 'DVA_TEST', 'DVA Test Panel', 2950000, 0, 'reserved')
  returning id into v_voucher_a;
  insert into public.care_vouchers
    (organisation_id, voucher_number, kind, beneficiary_profile_id, purchaser_profile_id,
     panel_bundle_id, sku_code, sku_name, face_value_kobo, amount_paid_kobo, status)
  values
    (c_org, 'TAR-VCH-DVATEST3-' || substr(c_org::text, 1, 8), 'prepaid_service',
     v_two_vouchers, v_two_vouchers, v_panel, 'DVA_TEST', 'DVA Test Panel', 2950000, 0, 'reserved');

  -- =========================================================================
  -- 1. Unknown customer_code: queued, org/profile genuinely null, never guessed
  -- =========================================================================
  insert into public.payment_transactions (provider, provider_event_id, event_type, amount_minor, currency, raw_payload)
  values ('paystack', 'evt_unknown_' || c_org, 'charge.success', 500000, 'NGN',
    jsonb_build_object('data', jsonb_build_object(
      'reference', 'evt_unknown_' || c_org, 'amount', 500000,
      'authorization', jsonb_build_object('channel', 'dedicated_nuban'),
      'customer', jsonb_build_object('customer_code', 'CUS_DOES_NOT_EXIST_' || c_org))));
  select organisation_id, profile_id into v_unmatched_org, v_unmatched_profile
    from public.unmatched_bank_transfers
    where payment_transaction_id = (select id from public.payment_transactions where provider_event_id = 'evt_unknown_' || c_org);
  if v_unmatched_org is not null or v_unmatched_profile is not null then
    raise exception 'FAIL 1: an unrecognised customer_code should leave organisation_id/profile_id genuinely null, got % / %', v_unmatched_org, v_unmatched_profile;
  end if;
  insert into _checks (msg) values ('PASS 1: an unrecognised customer_code is queued, not guessed at');

  -- =========================================================================
  -- 2. Exactly one voucher candidate: partial instalment applies correctly
  -- =========================================================================
  insert into public.payment_transactions (provider, provider_event_id, event_type, amount_minor, currency, raw_payload)
  values ('paystack', 'evt_partial_' || v_voucher, 'charge.success', 500000, 'NGN',
    jsonb_build_object('data', jsonb_build_object(
      'reference', 'evt_partial_' || v_voucher, 'amount', 500000,
      'authorization', jsonb_build_object('channel', 'dedicated_nuban'),
      'customer', jsonb_build_object('customer_code', 'CUS_TEST_' || v_one_voucher))));
  select amount_paid_kobo, status into v_paid, v_status from public.care_vouchers where id = v_voucher;
  if v_paid <> 1975000 or v_status <> 'reserved' then
    raise exception 'FAIL 2: expected 1,975,000 paid and still reserved, got % / %', v_paid, v_status;
  end if;
  insert into _checks (msg) values ('PASS 2 (control): the sole outstanding voucher gets the instalment, stays reserved until paid in full');

  -- =========================================================================
  -- 3. Same voucher, final instalment overpays — credit is capped, excess flagged
  -- =========================================================================
  insert into public.payment_transactions (provider, provider_event_id, event_type, amount_minor, currency, raw_payload)
  values ('paystack', 'evt_final_' || v_voucher, 'charge.success', 1476000, 'NGN', -- 975,000 owed, overpays by 501,000
    jsonb_build_object('data', jsonb_build_object(
      'reference', 'evt_final_' || v_voucher, 'amount', 1476000,
      'authorization', jsonb_build_object('channel', 'dedicated_nuban'),
      'customer', jsonb_build_object('customer_code', 'CUS_TEST_' || v_one_voucher))));
  select amount_paid_kobo, status into v_paid, v_status from public.care_vouchers where id = v_voucher;
  if v_paid <> 2950000 or v_status <> 'active' then
    raise exception 'FAIL 3a: expected fully paid and active, got % / %', v_paid, v_status;
  end if;
  select amount_kobo into v_n from public.unmatched_bank_transfers
    where payment_transaction_id = (select id from public.payment_transactions where provider_event_id = 'evt_final_' || v_voucher);
  if v_n <> 501000 then raise exception 'FAIL 3b: overpayment excess should be flagged at 501,000, got %', v_n; end if;
  insert into _checks (msg) values ('PASS 3 (control): an overpaying instalment is capped at what is owed and the excess is queued for a human, never absorbed or lost');

  -- =========================================================================
  -- 4. Exactly one booking candidate, exact amount — auto-settles
  -- =========================================================================
  insert into public.payment_transactions (provider, provider_event_id, event_type, amount_minor, currency, raw_payload)
  values ('paystack', 'evt_lab_' || v_lab_order, 'charge.success', 2950000, 'NGN',
    jsonb_build_object('data', jsonb_build_object(
      'reference', 'evt_lab_' || v_lab_order, 'amount', 2950000,
      'authorization', jsonb_build_object('channel', 'dedicated_nuban'),
      'customer', jsonb_build_object('customer_code', 'CUS_TEST_' || v_one_lab))));
  select status::text into v_status from public.lab_orders where id = v_lab_order;
  if v_status <> 'payment_confirmed' then raise exception 'FAIL 4: expected payment_confirmed, got %', v_status; end if;
  insert into _checks (msg) values ('PASS 4 (control): the sole outstanding booking order auto-settles on an exact amount match');

  -- =========================================================================
  -- 5. Ambiguous — two candidates, must queue, must not touch either voucher
  -- =========================================================================
  insert into public.payment_transactions (provider, provider_event_id, event_type, amount_minor, currency, raw_payload)
  values ('paystack', 'evt_ambiguous_' || v_two_vouchers, 'charge.success', 500000, 'NGN',
    jsonb_build_object('data', jsonb_build_object(
      'reference', 'evt_ambiguous_' || v_two_vouchers, 'amount', 500000,
      'authorization', jsonb_build_object('channel', 'dedicated_nuban'),
      'customer', jsonb_build_object('customer_code', 'CUS_TEST_' || v_two_vouchers))));
  if exists (select 1 from public.care_vouchers where beneficiary_profile_id = v_two_vouchers and amount_paid_kobo <> 0) then
    raise exception 'FAIL 5a: an ambiguous transfer touched a voucher it should not have';
  end if;
  select status, note into v_status, v_note from public.unmatched_bank_transfers
    where payment_transaction_id = (select id from public.payment_transactions where provider_event_id = 'evt_ambiguous_' || v_two_vouchers);
  if v_status <> 'unmatched' or v_note not ilike '%2 candidate%' then
    raise exception 'FAIL 5b: expected an unmatched row citing 2 candidates, got % / %', v_status, v_note;
  end if;
  insert into _checks (msg) values ('PASS 5 (control): two simultaneously-outstanding vouchers is genuinely ambiguous and is never auto-guessed');

  -- =========================================================================
  -- 6. Zero candidates — queued, no crash
  -- =========================================================================
  insert into public.payment_transactions (provider, provider_event_id, event_type, amount_minor, currency, raw_payload)
  values ('paystack', 'evt_zero_' || v_zero, 'charge.success', 500000, 'NGN',
    jsonb_build_object('data', jsonb_build_object(
      'reference', 'evt_zero_' || v_zero, 'amount', 500000,
      'authorization', jsonb_build_object('channel', 'dedicated_nuban'),
      'customer', jsonb_build_object('customer_code', 'CUS_TEST_' || v_zero))));
  select count(*) into v_n from public.unmatched_bank_transfers
    where payment_transaction_id = (select id from public.payment_transactions where provider_event_id = 'evt_zero_' || v_zero);
  if v_n <> 1 then raise exception 'FAIL 6: a transfer with nothing outstanding should still be queued exactly once, got %', v_n; end if;
  insert into _checks (msg) values ('PASS 6: a transfer with no outstanding obligation at all is queued, not dropped or errored');

  -- =========================================================================
  -- 7. A card charge (not dedicated_nuban) is completely untouched by this trigger
  -- =========================================================================
  insert into public.payment_transactions (provider, provider_event_id, event_type, amount_minor, currency, raw_payload)
  values ('paystack', 'evt_card_' || v_one_voucher, 'charge.success', 500000, 'NGN',
    jsonb_build_object('data', jsonb_build_object(
      'reference', 'evt_card_' || v_one_voucher, 'amount', 500000,
      'authorization', jsonb_build_object('channel', 'card'),
      'customer', jsonb_build_object('customer_code', 'CUS_TEST_' || v_one_voucher))));
  select count(*) into v_n from public.unmatched_bank_transfers
    where payment_transaction_id = (select id from public.payment_transactions where provider_event_id = 'evt_card_' || v_one_voucher);
  if v_n <> 0 then raise exception 'FAIL 7: a plain card charge must never be touched by the dedicated-account reconciler'; end if;
  insert into _checks (msg) values ('PASS 7: a card charge.success is left entirely to the existing card path, untouched by this trigger');

  -- =========================================================================
  -- 8. Staff resolves the ambiguous case; RLS gates who may
  -- =========================================================================
  perform set_config('request.jwt.claim.sub', v_zero::text, true);
  begin
    perform public.resolve_unmatched_bank_transfer(
      (select id from public.unmatched_bank_transfers
        where payment_transaction_id = (select id from public.payment_transactions where provider_event_id = 'evt_zero_' || v_zero)),
      'ignore', null, null);
    raise exception 'FAIL 8a: an ordinary patient resolved a bank transfer';
  exception when others then
    if sqlerrm not ilike '%not authorised%' then raise; end if;
    insert into _checks (msg) values ('PASS 8a: only admin/finance.reconcile may resolve a queued transfer');
  end;

  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  v_res := public.resolve_unmatched_bank_transfer(
    (select id from public.unmatched_bank_transfers
      where payment_transaction_id = (select id from public.payment_transactions where provider_event_id = 'evt_ambiguous_' || v_two_vouchers)),
    'apply_to_voucher', v_voucher_a, 'Confirmed with patient by phone which voucher this was for');
  if not (v_res->>'ok')::boolean then raise exception 'FAIL 8b (control): admin could not resolve the ambiguous transfer'; end if;
  select amount_paid_kobo into v_paid from public.care_vouchers where id = v_voucher_a;
  if v_paid <> 500000 then raise exception 'FAIL 8c: staff resolution did not credit the chosen voucher, got %', v_paid; end if;
  insert into _checks (msg) values ('PASS 8b/c (control): staff can resolve an ambiguous transfer onto the voucher the patient actually meant');

  v_res := public.resolve_unmatched_bank_transfer(
    (select id from public.unmatched_bank_transfers
      where payment_transaction_id = (select id from public.payment_transactions where provider_event_id = 'evt_ambiguous_' || v_two_vouchers)),
    'ignore', null, null);
  if (v_res->>'ok')::boolean is not false then raise exception 'FAIL 8d: an already-resolved transfer was resolved again'; end if;
  insert into _checks (msg) values ('PASS 8d: a transfer cannot be resolved twice');

  -- =========================================================================
  -- 9. RLS: a patient sees only their own dedicated account, never another's
  -- =========================================================================
  set role authenticated;
  perform set_config('request.jwt.claim.sub', v_zero::text, true);
  select count(*) into v_n from public.patient_dedicated_accounts;
  reset role;
  if v_n <> 1 then raise exception 'FAIL 9: a patient should see exactly their own dedicated account row, saw %', v_n; end if;
  insert into _checks (msg) values ('PASS 9: a patient sees exactly their own dedicated account, never anyone else''s');

  insert into _checks (msg) values ('=== ALL PAYSTACK DEDICATED VIRTUAL ACCOUNT CHECKS PASSED ===');
end $$;

select msg from _checks order by n;

rollback;
