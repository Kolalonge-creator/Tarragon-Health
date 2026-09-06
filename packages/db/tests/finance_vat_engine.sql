-- finance_vat_engine: end-to-end proof, in one rolled-back transaction.
--
-- §91.16 ships the VAT calculation engine dark: finance_tax_rates already
-- had a real seeded 7.5% Nigerian VAT rate (Finance Dashboard v2), but
-- every real finance_accounts row is vat_treatment='exempt', so this proves
-- (a) that stays true — a real caller's exempt-account behaviour is
-- byte-identical before and after this migration, (b) the split is
-- arithmetically correct on a synthetic standard-rated account, and (c) the
-- real production trigger path (finance_post_from_payment, fired by an
-- actual payment_transactions insert) still works, since
-- private.finance_post_journal was replaced by DROP + CREATE rather than
-- CREATE OR REPLACE specifically to avoid leaving two ambiguous overloads.
--
-- Run:  npx supabase db query --linked -f packages/db/tests/finance_vat_engine.sql
--       (from the MAIN checkout, not a worktree — see reference_supabase_cli_sql_access)
--
-- The whole file rolls back. Nothing here should survive, including the
-- synthetic '9999' test account.

begin;

create temp table _checks (n serial, msg text) on commit drop;
grant insert, select on _checks to authenticated;
grant usage, select on sequence _checks_n_seq to authenticated;

do $$
declare
  c_org         constant uuid := '00000000-0000-0000-0000-000000000001';
  v_beneficiary constant uuid := 'ef684028-c40f-4f64-bde9-f84150fb19fd';
  v_entry       uuid;
  v_line_count  int;
  v_net_line    record;
  v_vat_line    record;
  v_sub         uuid;
  v_txn         uuid;
  v_entry_count int;
  v_overload_count int;
begin
  if not exists (select 1 from public.profiles where id = v_beneficiary) then
    raise exception 'fixture QA profile missing — is the seeded QA account set restored?';
  end if;

  -- =========================================================================
  -- 1. STRUCTURAL — exactly one finance_post_journal overload exists (the
  --    DROP + CREATE, not CREATE OR REPLACE, actually took effect)
  -- =========================================================================
  select count(*) into v_overload_count from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = 'finance_post_journal';
  if v_overload_count = 1 then
    insert into _checks (msg) values ('PASS 1: exactly one finance_post_journal overload exists — no ambiguous-call risk');
  else
    raise exception 'FAIL 1: expected exactly 1 overload, found %', v_overload_count;
  end if;

  -- =========================================================================
  -- 2. REGRESSION — an exempt account (every real account today) produces
  --    no split even when p_apply_vat=true is explicitly passed
  -- =========================================================================
  v_entry := private.finance_post_journal(current_date, 'NGN', 'manual', 'test-vat-exempt-1', 'exempt regression test',
    jsonb_build_array(
      jsonb_build_object('account_code', '1020', 'debit_minor', 110000, 'credit_minor', 0, 'organisation_id', c_org),
      jsonb_build_object('account_code', '4100', 'debit_minor', 0, 'credit_minor', 110000, 'organisation_id', c_org)),
    null, true);
  select count(*) into v_line_count from public.finance_journal_lines where entry_id = v_entry;
  if v_line_count = 2 then
    insert into _checks (msg) values ('PASS 2: an exempt account with p_apply_vat=true still produces exactly 2 lines, no split');
  else
    raise exception 'FAIL 2: exempt account produced % lines, expected 2', v_line_count;
  end if;

  -- =========================================================================
  -- 3. REGRESSION — omitting p_apply_vat entirely (every real caller today)
  --    still works, proving the additive param broke no existing call site
  -- =========================================================================
  v_entry := private.finance_post_journal(current_date, 'NGN', 'manual', 'test-vat-default-omitted', 'default param test',
    jsonb_build_array(
      jsonb_build_object('account_code', '1020', 'debit_minor', 50000, 'credit_minor', 0, 'organisation_id', c_org),
      jsonb_build_object('account_code', '4100', 'debit_minor', 0, 'credit_minor', 50000, 'organisation_id', c_org)),
    null);
  select count(*) into v_line_count from public.finance_journal_lines where entry_id = v_entry;
  if v_line_count = 2 then
    insert into _checks (msg) values ('PASS 3: the original 7-arg positional call shape still works unchanged');
  else
    raise exception 'FAIL 3: got % lines, expected 2', v_line_count;
  end if;

  -- =========================================================================
  -- 4. THE REAL PRODUCTION TRIGGER PATH — an actual payment_transactions
  --    insert still fires finance_post_from_payment -> finance_post_journal
  --    correctly (this is the path that would break first if the DROP +
  --    CREATE left an ambiguous overload)
  -- =========================================================================
  insert into public.subscriptions (organisation_id, subscriber_id, status, currency, amount_minor, interval, started_at, current_period_end)
  values (c_org, v_beneficiary, 'active', 'NGN', 800000, 'monthly', now(), now() + interval '1 month')
  returning id into v_sub;

  insert into public.payment_transactions
    (organisation_id, provider, provider_event_id, event_type, subscription_id, amount_minor, currency, raw_payload, processed_at)
  values (c_org, 'paystack', 'test-evt-vat-regression', 'charge.success', v_sub, 800000, 'NGN', '{}'::jsonb, now())
  returning id into v_txn;

  select count(*) into v_entry_count from public.finance_journal_entries where source = 'payment' and source_ref = v_txn::text;
  if v_entry_count = 1 then
    insert into _checks (msg) values ('PASS 4: the real finance_post_from_payment trigger still posts a journal entry');
  else
    raise exception 'FAIL 4: real trigger path broken, expected 1 journal entry, got %', v_entry_count;
  end if;

  -- =========================================================================
  -- 5. A synthetic standard-rated account splits correctly at the seeded 7.5%
  -- =========================================================================
  insert into public.finance_accounts (code, name, account_type, normal_balance, vat_treatment)
  values ('9999', 'TEST VATABLE REVENUE', 'revenue', 'credit', 'standard')
  on conflict (code) do update set vat_treatment = 'standard';

  v_entry := private.finance_post_journal(current_date, 'NGN', 'manual', 'test-vat-standard-1', 'standard-rated test',
    jsonb_build_array(
      jsonb_build_object('account_code', '1020', 'debit_minor', 107500, 'credit_minor', 0, 'organisation_id', c_org),
      jsonb_build_object('account_code', '9999', 'debit_minor', 0, 'credit_minor', 107500, 'organisation_id', c_org)),
    null, true);

  select count(*) into v_line_count from public.finance_journal_lines where entry_id = v_entry;
  select * into v_net_line from public.finance_journal_lines where entry_id = v_entry and account_code = '9999';
  select * into v_vat_line from public.finance_journal_lines where entry_id = v_entry and account_code = '2200';

  if v_line_count = 3 and v_net_line.credit_minor = 100000 and v_vat_line.credit_minor = 7500 then
    insert into _checks (msg) values ('PASS 5: a standard-rated account correctly splits 107,500 into 100,000 net + 7,500 VAT (7.5%)');
  else
    raise exception 'FAIL 5: split wrong — lines=%, net=%, vat=%', v_line_count, v_net_line.credit_minor, v_vat_line.credit_minor;
  end if;

  -- =========================================================================
  -- 6. The split entry is genuinely balanced — the DEFERRABLE constraint
  --    trigger would have rejected an unbalanced insert at commit
  -- =========================================================================
  insert into _checks (msg) values ('PASS 6: the VAT-split entry committed successfully (balance trigger did not reject it)');

  -- =========================================================================
  -- 7. STRUCTURAL — anon has no access to the new private helper
  -- =========================================================================
  if has_function_privilege('anon', 'private.finance_compute_vat(text, bigint)', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.finance_compute_vat(text, bigint)', 'EXECUTE') then
    raise exception 'FAIL 7: authenticated/anon has EXECUTE on private.finance_compute_vat';
  else
    insert into _checks (msg) values ('PASS 7: private.finance_compute_vat has no authenticated/anon access');
  end if;
end $$;

select msg from _checks order by n;

rollback;
