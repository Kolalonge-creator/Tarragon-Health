-- finance_unified_ledger: end-to-end proof, in one rolled-back transaction.
--
-- §91.12 wants one row per transaction carrying payer, recipient, service,
-- amount, currency, status, timestamp, method. `payment_transactions` (a
-- webhook log) and `finance_journal_entries` (the double-entry GL) are real
-- but disjoint; this RPC joins them read-only via the existing
-- `source_ref = payment_transactions.id::text` convention that
-- `private.finance_post_from_payment` already uses for every real charge —
-- no new column, no trigger rewiring.
--
-- This project has zero live subscription/booking revenue as of this test's
-- writing (checked directly against the live DB before writing this file),
-- so the fixture below is synthetic, built against real seeded QA profile
-- ids (patient/stranger/finance) rather than invented ones — same approach
-- packages/db/tests/care_vouchers.sql already uses.
--
-- Run:  npx supabase db query --linked -f packages/db/tests/finance_unified_ledger.sql
--       (from the MAIN checkout, not a worktree — see reference_supabase_cli_sql_access)
--
-- The whole file rolls back. Nothing here should survive.

begin;

create temp table _checks (n serial, msg text) on commit drop;
grant insert, select on _checks to authenticated;
grant usage, select on sequence _checks_n_seq to authenticated;

do $$
declare
  c_org      constant uuid := '00000000-0000-0000-0000-000000000001';
  v_patient  constant uuid := 'ef684028-c40f-4f64-bde9-f84150fb19fd';
  v_stranger constant uuid := 'cb100ba5-204a-4048-a585-2634c27a4c46';
  v_finance  constant uuid := 'c9d6b1e6-74b5-4bcd-a9b0-986e2cddc219';
  v_sub      uuid;
  v_txn      uuid;
  v_failed_txn uuid;
  v_cnt      int;
  v_row      record;
begin
  if not exists (select 1 from public.profiles where id = v_patient)
     or not exists (select 1 from public.profiles where id = v_stranger)
     or not exists (select 1 from public.profiles where id = v_finance and role in ('finance','admin')) then
    raise exception 'fixture QA profiles missing — is the seeded QA account set restored?';
  end if;

  -- =========================================================================
  -- 1. FIXTURE: a real subscription payment for a real patient.
  -- =========================================================================
  insert into public.subscriptions
    (organisation_id, subscriber_id, status, currency, amount_minor, interval, started_at, current_period_end)
  values
    (c_org, v_patient, 'active', 'NGN', 800000, 'monthly', now(), now() + interval '1 month')
  returning id into v_sub;

  insert into public.payment_transactions
    (organisation_id, provider, provider_event_id, event_type, subscription_id, amount_minor, currency, raw_payload, processed_at)
  values
    (c_org, 'paystack', 'test-evt-' || v_sub::text, 'charge.success', v_sub, 800000, 'NGN', '{}'::jsonb, now())
  returning id into v_txn;

  perform private.finance_post_journal(
    current_date, 'NGN', 'payment', v_txn::text, 'Subscription payment (test fixture)',
    jsonb_build_array(
      jsonb_build_object('account_code', '1020', 'debit_minor', 800000, 'credit_minor', 0, 'organisation_id', c_org),
      jsonb_build_object('account_code', '2000', 'debit_minor', 0, 'credit_minor', 800000, 'organisation_id', c_org)),
    null);

  if private.resolve_payment_payer((select pt from public.payment_transactions pt where id = v_txn)) = v_patient then
    insert into _checks (msg) values ('PASS 1: resolve_payment_payer resolves the fixture patient');
  else
    raise exception 'FAIL 1: resolve_payment_payer did not resolve the fixture payer';
  end if;

  -- =========================================================================
  -- 2. PATIENT SELF-VIEW
  -- =========================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select * into v_row from public.finance_unified_ledger(p_profile_id => v_patient) l where l.payment_transaction_id = v_txn;
  reset role;

  if v_row.amount_minor = 800000 and v_row.direction = 'money_in'
     and v_row.service_label = 'Subscription' and v_row.status = 'completed' and v_row.method = 'paystack'
     and v_row.recipient_label = 'Tarragon Health' then
    insert into _checks (msg) values ('PASS 2: patient sees a correctly-shaped row for their own payment');
  else
    raise exception 'FAIL 2: fixture row malformed for the patient — %', coalesce(v_row::text, 'null');
  end if;

  -- =========================================================================
  -- 3. SABOTAGE — cross-profile leak checks
  -- =========================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_stranger, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_cnt from public.finance_unified_ledger(p_profile_id => v_stranger) l where l.payment_transaction_id = v_txn;
  reset role;
  if v_cnt = 0 then
    insert into _checks (msg) values ('PASS 3a: stranger querying their own profile_id sees none of the patient''s rows');
  else
    raise exception 'FAIL 3a: stranger''s own-profile query leaked the patient''s payment row';
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_stranger, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.finance_unified_ledger(p_profile_id => v_patient);
    raise exception 'FAIL 3b: stranger directly requested the patient''s profile_id and was allowed';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    insert into _checks (msg) values ('PASS 3b: stranger directly requesting the patient''s profile_id is refused (' || sqlerrm || ')');
  end;
  reset role;

  -- =========================================================================
  -- 4. FINANCE STAFF — positive controls proving the gate discriminates
  --    rather than blocking everyone
  -- =========================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_finance, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_cnt from public.finance_unified_ledger(p_profile_id => v_patient) l where l.payment_transaction_id = v_txn;
  reset role;
  if v_cnt = 1 then
    insert into _checks (msg) values ('PASS 4a: finance staff can look up the patient''s row by profile_id');
  else
    raise exception 'FAIL 4a: finance staff could not see the fixture row, expected 1 got %', v_cnt;
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_finance, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_cnt from public.finance_unified_ledger(p_organisation_id => c_org) l where l.payment_transaction_id = v_txn;
  reset role;
  if v_cnt = 1 then
    insert into _checks (msg) values ('PASS 4b: finance org-wide ledger includes the fixture row');
  else
    raise exception 'FAIL 4b: finance org-wide ledger missing the fixture row, got %', v_cnt;
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.finance_unified_ledger(p_organisation_id => c_org);
    raise exception 'FAIL 4c: a plain patient read the org-wide ledger';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    insert into _checks (msg) values ('PASS 4c: a plain patient is refused the org-wide ledger (' || sqlerrm || ')');
  end;
  reset role;

  -- =========================================================================
  -- 5. FAILED PAYMENT SURFACING — no journal entry, still visible as 'failed'
  -- =========================================================================
  insert into public.payment_transactions
    (organisation_id, provider, provider_event_id, event_type, subscription_id, amount_minor, currency, raw_payload, error)
  values
    (c_org, 'paystack', 'test-evt-failed-' || v_sub::text, 'invoice.payment_failed', v_sub, 800000, 'NGN', '{}'::jsonb, 'insufficient_funds')
  returning id into v_failed_txn;

  perform set_config('request.jwt.claims', json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select * into v_row from public.finance_unified_ledger(p_profile_id => v_patient) l where l.payment_transaction_id = v_failed_txn;
  reset role;
  if v_row.status = 'failed' and v_row.memo = 'insufficient_funds' and v_row.entry_id is null then
    insert into _checks (msg) values ('PASS 5: a failed payment with no journal entry surfaces with status=failed');
  else
    raise exception 'FAIL 5: failed payment fixture not surfaced correctly — %', coalesce(v_row::text, 'null');
  end if;

  -- =========================================================================
  -- 6. INPUT VALIDATION + STRUCTURAL LOCKDOWN
  -- =========================================================================
  begin
    perform public.finance_unified_ledger();
    raise exception 'FAIL 6a: calling with neither p_profile_id nor p_organisation_id should have raised';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    insert into _checks (msg) values ('PASS 6a: calling with no scope at all is refused');
  end;

  if has_function_privilege('anon', 'public.finance_unified_ledger(uuid, uuid, date, date, integer, integer)', 'EXECUTE') then
    raise exception 'FAIL 6b: anon has EXECUTE on finance_unified_ledger';
  else
    insert into _checks (msg) values ('PASS 6b: anon has no EXECUTE on finance_unified_ledger');
  end if;

  if has_function_privilege('anon', 'private.resolve_payment_payer(public.payment_transactions)', 'EXECUTE')
     or has_function_privilege('anon', 'private.payment_transaction_service_label(public.payment_transactions)', 'EXECUTE') then
    raise exception 'FAIL 6c: anon has EXECUTE on a private helper function';
  else
    insert into _checks (msg) values ('PASS 6c: anon has no EXECUTE on either private helper');
  end if;
end $$;

select msg from _checks order by n;

rollback;
