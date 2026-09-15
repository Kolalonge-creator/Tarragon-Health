-- payments_with_payer_for_fraud_sweep + chargeback signal_type: end-to-end
-- proof, in one rolled-back transaction.
--
-- §91.17: payment_fraud_signals and its two RPCs already existed live
-- before this migration (a concurrent session built the schema — see the
-- recovered 20260829001612_payment_fraud_signals.sql). This proves the two
-- things that migration added: the service-role-only read helper the
-- TypeScript fraud-sweep needs (never callable by authenticated/anon), and
-- that 'chargeback' is now a valid signal_type for the webhook dispute
-- handlers to insert.
--
-- Run:  npx supabase db query --linked -f packages/db/tests/fraud_sweep_helper_and_chargeback_signal.sql
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
  v_sub         uuid;
  v_real_txn    uuid;
  v_row         record;
begin
  if not exists (select 1 from public.profiles where id = v_beneficiary) then
    raise exception 'fixture QA profile missing — is the seeded QA account set restored?';
  end if;

  -- =========================================================================
  -- 1. STRUCTURAL LOCKDOWN — the read helper is service-role only
  -- =========================================================================
  if has_function_privilege('anon', 'public.payments_with_payer_for_fraud_sweep(timestamptz, timestamptz)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.payments_with_payer_for_fraud_sweep(timestamptz, timestamptz)', 'EXECUTE') then
    raise exception 'FAIL 1: authenticated/anon can call payments_with_payer_for_fraud_sweep — service-role only';
  else
    insert into _checks (msg) values ('PASS 1: only service-role can call payments_with_payer_for_fraud_sweep');
  end if;

  -- =========================================================================
  -- 2. THE HELPER RESOLVES THE PAYER CORRECTLY (reuses Phase 1's resolver)
  -- =========================================================================
  insert into public.subscriptions (organisation_id, subscriber_id, status, currency, amount_minor, interval, started_at, current_period_end)
  values (c_org, v_beneficiary, 'active', 'NGN', 800000, 'monthly', now(), now() + interval '1 month')
  returning id into v_sub;

  insert into public.payment_transactions
    (organisation_id, provider, provider_event_id, event_type, subscription_id, amount_minor, currency, raw_payload, processed_at)
  values (c_org, 'paystack', 'test-evt-fraud-sweep', 'charge.success', v_sub, 800000, 'NGN', '{}'::jsonb, now())
  returning id into v_real_txn;

  select * into v_row from public.payments_with_payer_for_fraud_sweep(now() - interval '1 hour', now() + interval '1 hour')
    where id = v_real_txn;
  if v_row.payer_profile_id = v_beneficiary and v_row.amount_minor = 800000 then
    insert into _checks (msg) values ('PASS 2: the helper resolves payer/amount correctly for a real fixture row');
  else
    raise exception 'FAIL 2: helper row wrong — %', coalesce(v_row::text, 'null');
  end if;

  -- =========================================================================
  -- 3. 'chargeback' IS NOW A VALID signal_type
  -- =========================================================================
  insert into public.payment_fraud_signals (signal_type, severity, dedupe_key, payment_transaction_id, detail)
  values ('chargeback', 'high', 'test-chargeback-dedupe-key', v_real_txn, '{}'::jsonb);
  insert into _checks (msg) values ('PASS 3: chargeback is a valid signal_type');

  -- =========================================================================
  -- 4. The dedupe_key partial unique index still discriminates correctly —
  --    a second OPEN signal with the same key is rejected.
  -- =========================================================================
  begin
    insert into public.payment_fraud_signals (signal_type, severity, dedupe_key, detail)
    values ('chargeback', 'high', 'test-chargeback-dedupe-key', '{}'::jsonb);
    raise exception 'FAIL 4: a duplicate open dedupe_key was accepted';
  exception when unique_violation then
    insert into _checks (msg) values ('PASS 4: a duplicate open dedupe_key is rejected by the partial unique index');
  end;
end $$;

select msg from _checks order by n;

rollback;
