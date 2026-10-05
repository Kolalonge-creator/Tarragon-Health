-- Regression test for 20260924221152_fix_finance_create_recognition_schedule_
-- overload_ambiguity.sql — found live while testing an unrelated PR:
-- 20260924213634_fix_voucher_redemption_cross_voucher_double_count_and_revrec_
-- rounding.sql added a 10th parameter (p_promo_minor default 0) to
-- private.finance_create_recognition_schedule via `create or replace
-- function`, which only replaces a function with an IDENTICAL parameter
-- list — since the new definition had a different argument count, Postgres
-- created a SECOND overload instead of replacing the original, and every
-- existing 9-positional-argument call site (private.finance_post_from_payment,
-- private.finance_post_platform_credit_ledger_entry,
-- private.finance_post_voucher_redeemed) became ambiguous (42725). Because
-- those callers all run inside an `exception when others` handler built to
-- protect a payment webhook from an accounting failure
-- (finance_posting_failures — see finance_posting_failures_queue.sql), the
-- ambiguity was swallowed silently: the payment landed, but ZERO GL entries
-- and ZERO revenue recognition schedules posted for every booking,
-- subscription, add_on, and service_purchase in the meantime.
--
-- Run:  npx supabase db query --linked -f packages/db/tests/finance_create_recognition_schedule_overload_ambiguity.sql
--       (from the MAIN checkout, not a worktree — see reference_supabase_cli_sql_access)
--
-- The whole file rolls back. Nothing here should survive.

begin;

create temp table _checks (n serial, msg text) on commit drop;

do $$
declare
  v_overload_count int;
  v_org uuid;
  v_txn uuid;
  v_entry uuid;
begin
  -- =========================================================================
  -- 1. STRUCTURAL — exactly one overload exists (the actual root cause: two
  --    overloads with the same effective call shape is what made the call
  --    ambiguous, regardless of which specific caller hits it).
  -- =========================================================================
  select count(*) into v_overload_count from pg_proc
    where proname = 'finance_create_recognition_schedule' and pronamespace = 'private'::regnamespace;
  if v_overload_count <> 1 then
    raise exception 'FAIL 1: expected exactly one private.finance_create_recognition_schedule overload, found %', v_overload_count;
  end if;
  insert into _checks (msg) values ('PASS 1: exactly one finance_create_recognition_schedule overload exists');

  -- =========================================================================
  -- 2. BEHAVIOURAL — a real 9-positional-argument call site
  --    (private.finance_post_from_payment's service_purchase branch, which
  --    calls finance_create_recognition_schedule with exactly 9 positional
  --    arguments) resolves without ambiguity and actually posts.
  -- =========================================================================
  declare
    v_patient uuid;
    v_product public.service_products%rowtype;
    v_purchase uuid;
    v_ref text;
  begin
    select p.id, p.organisation_id into v_patient, v_org
      from public.profiles p
      where p.role = 'patient' and not exists (select 1 from public.service_purchases sp where sp.patient_id = p.id)
      limit 1;
    select * into v_product from public.service_products
      where is_active and currency = 'NGN' and price_kobo > 0 and access_duration_days is not null
      limit 1;

    if v_patient is null or v_product.id is null then
      raise notice 'SKIPPED behavioural check: no purchase-history-free patient / bounded-duration product fixture available';
    else
      perform set_config('request.jwt.claims', json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
      set local role authenticated;
      v_purchase := public.record_service_purchase_intent(v_patient, v_product.code);
      reset role;

      v_ref := 'overload-ambiguity-test-' || v_purchase::text;
      update public.service_purchases set pending_payment_provider_ref = v_ref where id = v_purchase;

      insert into public.payment_transactions
        (organisation_id, provider, provider_event_id, event_type, amount_minor, currency, raw_payload, processed_at)
      values
        (v_org, 'paystack', 'overload-ambiguity-evt-' || v_purchase::text, 'charge.success', v_product.price_kobo, 'NGN',
         jsonb_build_object('data', jsonb_build_object('reference', v_ref, 'metadata', jsonb_build_object('kind', 'service_purchase'))),
         now())
      returning id into v_txn;

      select id into v_entry from public.finance_journal_entries where source = 'payment' and source_ref = v_txn::text;
      -- The service_purchase branch calls finance_create_recognition_schedule
      -- with exactly 9 positional arguments — the exact call shape that was
      -- ambiguous. If this raised 42725, it would have been swallowed into
      -- finance_posting_failures and v_entry would be null.
      if v_entry is null then
        raise exception 'FAIL 2: no payment journal entry posted for a bounded-duration service purchase — the 9-argument call site may still be ambiguous or otherwise broken';
      end if;
      insert into _checks (msg) values ('PASS 2: a real 9-argument finance_create_recognition_schedule call site posts cleanly, no ambiguity');

      if exists (select 1 from public.finance_posting_failures where payment_transaction_id = v_txn and error_code = '42725') then
        raise exception 'FAIL 3: a 42725 (ambiguous function) posting failure was recorded for this payment';
      end if;
      insert into _checks (msg) values ('PASS 3: no 42725 ambiguous-function posting failure was recorded');
    end if;
  end;

  -- =========================================================================
  -- 4. SABOTAGE — recreate the old 9-argument overload alongside the current
  --    10-argument one and confirm the ambiguity genuinely reappears, proving
  --    check 1 actually discriminates rather than passing vacuously.
  -- =========================================================================
  create function private.finance_create_recognition_schedule(
    p_source_kind text, p_source_id uuid, p_payment_txn uuid, p_org uuid,
    p_revenue_account text, p_currency public.currency, p_total bigint,
    p_period_start date, p_period_end date
  ) returns uuid
  language plpgsql security definer set search_path = '' as $sab$
  begin
    return null;
  end; $sab$;

  select count(*) into v_overload_count from pg_proc
    where proname = 'finance_create_recognition_schedule' and pronamespace = 'private'::regnamespace;
  if v_overload_count <> 2 then
    raise exception 'SABOTAGE SETUP FAILED: expected 2 overloads after recreating the old one, found %', v_overload_count;
  end if;

  begin
    perform private.finance_create_recognition_schedule(
      'subscription', gen_random_uuid(), null, v_org, '4000', 'NGN'::public.currency, 100000,
      current_date, current_date + 30
    );
    raise exception 'SABOTAGE FAILED: a 9-argument call resolved cleanly with two overloads present — check 1 does not actually catch this bug class';
  exception when others then
    if sqlerrm like 'SABOTAGE FAILED%' then raise; end if;
    insert into _checks (msg) values ('PASS 4: sabotage (recreating the dropped overload) reproduces the exact 42725 ambiguity (' || sqlerrm || ')');
  end;

  drop function private.finance_create_recognition_schedule(
    text, uuid, uuid, uuid, text, public.currency, bigint, date, date
  );
end $$;

select msg from _checks order by n;

rollback;
