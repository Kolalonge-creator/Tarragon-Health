-- voucher_refund_queue beneficiary SELECT policy: end-to-end proof, in one
-- rolled-back transaction.
--
-- §91.12's patient financial-profile screen needs a patient to see the
-- status of a refund queued against their own cancelled voucher —
-- previously only admin/vouchers.manage staff could read this table.
--
-- Run:  npx supabase db query --linked -f packages/db/tests/voucher_refund_queue_beneficiary_select.sql
--       (from the MAIN checkout, not a worktree — see reference_supabase_cli_sql_access)
--
-- The whole file rolls back. Nothing here should survive.

begin;

create temp table _checks (n serial, msg text) on commit drop;
grant insert, select on _checks to authenticated;
grant usage, select on sequence _checks_n_seq to authenticated;

do $$
declare
  c_org         constant uuid := '00000000-0000-0000-0000-000000000001';
  v_beneficiary constant uuid := 'ef684028-c40f-4f64-bde9-f84150fb19fd';
  v_stranger    constant uuid := 'cb100ba5-204a-4048-a585-2634c27a4c46';
  v_admin       uuid;
  v_bundle      uuid;
  v_bundle_price bigint;
  v_voucher     uuid;
  v_res         jsonb;
  v_real_txn    uuid;
  v_cnt         int;
begin
  select id into v_admin from public.profiles where role = 'admin' limit 1;
  select id, price_kobo into v_bundle, v_bundle_price from public.panel_bundles where self_bookable limit 1;
  if v_admin is null or v_bundle is null then
    raise exception 'fixture QA profiles/catalogue missing — is the seeded QA account set restored?';
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_beneficiary, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_res := public.purchase_care_voucher(v_beneficiary, v_bundle, null);
  v_voucher := (v_res ->> 'voucher_id')::uuid;
  reset role;

  insert into public.payment_transactions
    (organisation_id, provider, provider_event_id, event_type, amount_minor, currency, raw_payload, processed_at)
  values (c_org, 'paystack', 'test-evt-' || v_voucher::text, 'charge.success', v_bundle_price, 'NGN', '{}'::jsonb, now())
  returning id into v_real_txn;

  insert into public.care_voucher_payments
    (organisation_id, voucher_id, payer_profile_id, amount_minor, currency, credit_kobo, provider, pending_provider_ref, status, payment_transaction_id)
  values (c_org, v_voucher, v_beneficiary, v_bundle_price, 'NGN', v_bundle_price, 'paystack', 'TEST-REF-' || v_voucher::text, 'applied', v_real_txn);
  update public.care_vouchers set status = 'active', amount_paid_kobo = v_bundle_price, activated_at = now() where id = v_voucher;

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.cancel_care_voucher(v_voucher, 'test cancellation');
  reset role;

  -- =========================================================================
  -- POSITIVE — the beneficiary sees their own refund-queue row
  -- =========================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_beneficiary, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_cnt from public.voucher_refund_queue where voucher_id = v_voucher;
  reset role;
  if v_cnt = 1 then
    insert into _checks (msg) values ('PASS 1: beneficiary can see their own refund-queue row');
  else
    raise exception 'FAIL 1: beneficiary saw % rows, expected 1', v_cnt;
  end if;

  -- =========================================================================
  -- SABOTAGE — a stranger cannot see someone else's refund-queue row
  -- =========================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_stranger, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_cnt from public.voucher_refund_queue where voucher_id = v_voucher;
  reset role;
  if v_cnt = 0 then
    insert into _checks (msg) values ('PASS 2: a stranger cannot see someone else''s refund-queue row');
  else
    raise exception 'FAIL 2: stranger saw % rows, expected 0', v_cnt;
  end if;

  -- =========================================================================
  -- CONTROL — finance staff can still see it too (the original policy stands)
  -- =========================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_cnt from public.voucher_refund_queue where voucher_id = v_voucher;
  reset role;
  if v_cnt = 1 then
    insert into _checks (msg) values ('PASS 3: admin staff can still see the row (existing policy untouched)');
  else
    raise exception 'FAIL 3: admin lost visibility, saw % rows', v_cnt;
  end if;
end $$;

select msg from _checks order by n;

rollback;
