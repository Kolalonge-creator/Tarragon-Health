-- cancel_care_voucher refund wiring: end-to-end proof, in one rolled-back
-- transaction.
--
-- §91.11 gap: cancel_care_voucher() previously only flipped a status — its
-- own comment said any refund was a human process against the original
-- charge, done separately. This proves the missing half: cancellation now
-- queues a real per-payment refund (voucher_refund_queue, processed by the
-- voucher-cancellation-refunds cron) and reverses the GL entries the
-- cancelled money represented — without ever creating a cash-out path
-- (see the structural checks in packages/db/tests/care_vouchers.sql, which
-- this does not touch or weaken).
--
-- Run:  npx supabase db query --linked -f packages/db/tests/care_voucher_cancellation_refund.sql
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
  v_admin       uuid;
  v_bundle      uuid;
  v_bundle_price bigint;
  v_voucher     uuid;
  v_real_txn    uuid;
  v_res         jsonb;
  v_reward_voucher uuid;
  v_queue_count int;
  v_entry_reversed boolean;
begin
  select id into v_admin from public.profiles where role = 'admin' limit 1;
  select id, price_kobo into v_bundle, v_bundle_price
    from public.panel_bundles where self_bookable limit 1;
  if v_admin is null or v_bundle is null or not exists (select 1 from public.profiles where id = v_beneficiary) then
    raise exception 'fixture QA profiles/catalogue missing — is the seeded QA account set restored?';
  end if;

  -- =========================================================================
  -- 1. FIXTURE: a fully-paid prepaid voucher with one completed payment,
  --    plus the payment-sourced journal entry finance_post_from_payment
  --    would really have posted for it.
  -- =========================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_beneficiary, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_res := public.purchase_care_voucher(v_beneficiary, v_bundle, null);
  v_voucher := (v_res ->> 'voucher_id')::uuid;
  reset role;

  insert into public.payment_transactions
    (organisation_id, provider, provider_event_id, event_type, amount_minor, currency, raw_payload, processed_at)
  values
    (c_org, 'paystack', 'test-evt-voucher-' || v_voucher::text, 'charge.success', v_bundle_price, 'NGN', '{}'::jsonb, now())
  returning id into v_real_txn;

  insert into public.care_voucher_payments
    (organisation_id, voucher_id, payer_profile_id, amount_minor, currency, credit_kobo, provider, pending_provider_ref, status, payment_transaction_id)
  values
    (c_org, v_voucher, v_beneficiary, v_bundle_price, 'NGN', v_bundle_price, 'paystack', 'TEST-REF-' || v_voucher::text, 'applied', v_real_txn);

  update public.care_vouchers set status = 'active', amount_paid_kobo = v_bundle_price, activated_at = now() where id = v_voucher;

  perform private.finance_post_journal(current_date, 'NGN', 'payment', v_real_txn::text, 'Care voucher prepayment (fixture)',
    jsonb_build_array(
      jsonb_build_object('account_code', '1020', 'debit_minor', v_bundle_price, 'credit_minor', 0, 'organisation_id', c_org),
      jsonb_build_object('account_code', '2100', 'debit_minor', 0, 'credit_minor', v_bundle_price, 'organisation_id', c_org)),
    null);

  -- =========================================================================
  -- 2. AUTHORISATION — a non-admin beneficiary cannot cancel their own voucher
  -- =========================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_beneficiary, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.cancel_care_voucher(v_voucher, 'changed my mind');
    raise exception 'FAIL 1: beneficiary (non-admin) cancelled their own voucher';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    insert into _checks (msg) values ('PASS 1: a non-admin beneficiary is refused cancel_care_voucher (' || sqlerrm || ')');
  end;
  reset role;

  -- =========================================================================
  -- 3. ADMIN CANCELS — exactly one refund queued, correctly shaped
  -- =========================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_res := public.cancel_care_voucher(v_voucher, 'test cancellation');
  reset role;

  select count(*) into v_queue_count from public.voucher_refund_queue where voucher_id = v_voucher;
  if (v_res ->> 'refunds_queued')::int = 1 and v_queue_count = 1 then
    insert into _checks (msg) values ('PASS 2: cancelling a fully-paid prepaid voucher queues exactly one refund');
  else
    raise exception 'FAIL 2: expected 1 refund queued, got res=%, queue_count=%', v_res, v_queue_count;
  end if;

  perform 1 from public.voucher_refund_queue
    where voucher_id = v_voucher and provider = 'paystack' and amount_minor = v_bundle_price
      and currency = 'NGN' and provider_reference = 'TEST-REF-' || v_voucher::text and status = 'due';
  if found then
    insert into _checks (msg) values ('PASS 3: refund queue row carries the correct provider/reference/amount, status due');
  else
    raise exception 'FAIL 3: refund queue row shape wrong';
  end if;

  -- =========================================================================
  -- 4. LEDGER — the payment entry behind the voucher is reversed immediately
  -- =========================================================================
  select is_reversed into v_entry_reversed from public.finance_journal_entries
    where source = 'payment' and source_ref = v_real_txn::text;
  if v_entry_reversed then
    insert into _checks (msg) values ('PASS 4: the payment journal entry behind the voucher was reversed on cancellation');
  else
    raise exception 'FAIL 4: payment journal entry was not marked reversed';
  end if;

  -- =========================================================================
  -- 5. REWARD VOUCHER — never paid for, so cancellation queues NOTHING, but
  --    its issuance journal entry is still reversed.
  -- =========================================================================
  v_reward_voucher := private.issue_reward_voucher(v_beneficiary, 50000, 'Test reward', 'fixture');

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_res := public.cancel_care_voucher(v_reward_voucher, 'test reward cancellation');
  reset role;

  select count(*) into v_queue_count from public.voucher_refund_queue where voucher_id = v_reward_voucher;
  if (v_res ->> 'refunds_queued')::int = 0 and v_queue_count = 0 then
    insert into _checks (msg) values ('PASS 5: cancelling a reward_discount voucher queues zero refunds — it was never paid for');
  else
    raise exception 'FAIL 5: a reward voucher should never queue a refund, got %', v_res;
  end if;

  select is_reversed into v_entry_reversed from public.finance_journal_entries
    where source = 'voucher' and source_ref = 'reward:' || v_reward_voucher::text;
  if v_entry_reversed then
    insert into _checks (msg) values ('PASS 6: the reward-issuance journal entry was reversed on cancellation');
  else
    raise exception 'FAIL 6: reward-issuance journal entry was not reversed';
  end if;

  -- =========================================================================
  -- 7. IDEMPOTENCY — a repeat cancel attempt never duplicates a refund
  -- =========================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.cancel_care_voucher(v_voucher, 'try again');
  reset role;

  select count(*) into v_queue_count from public.voucher_refund_queue where voucher_id = v_voucher;
  if v_queue_count = 1 then
    insert into _checks (msg) values ('PASS 7: exactly one refund-queue row still exists after a repeat cancel attempt (no duplication)');
  else
    raise exception 'FAIL 7: refund queue row count drifted on repeat cancellation, got %', v_queue_count;
  end if;

  -- =========================================================================
  -- 8. STRUCTURAL — no payout path was introduced; anon has no access
  -- =========================================================================
  if has_function_privilege('anon', 'public.cancel_care_voucher(uuid, text)', 'EXECUTE') then
    raise exception 'FAIL 8a: anon has EXECUTE on cancel_care_voucher';
  else
    insert into _checks (msg) values ('PASS 8a: anon has no EXECUTE on cancel_care_voucher');
  end if;

  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private') and p.prosrc ilike '%payout%'
  ) then
    raise exception 'FAIL 8b: a function mentioning payout exists — the never-cash-redeemable guarantee may have been weakened';
  else
    insert into _checks (msg) values ('PASS 8b: no function anywhere mentions a payout — still no cash-out route');
  end if;
end $$;

select msg from _checks order by n;

rollback;
