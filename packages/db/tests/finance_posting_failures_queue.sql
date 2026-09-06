-- ===========================================================================
-- Verification: 20260905060420_finance_posting_failures_are_queued_not_warned
--               _about
--
-- THE GAP. All four finance posting triggers wrapped
-- private.finance_post_from_payment() in `exception when others then raise
-- warning`. private.finance_post_journal() raises check_violation when the
-- accounting period is not 'open', so a webhook arriving after month-end
-- close activated the purchase and dropped the GL entry, leaving revenue
-- permanently unrecorded with only a Postgres log line nobody reads.
--
-- This script proves, against the real trigger chain:
--   * a closed accounting period genuinely blocks the posting (the premise);
--   * the payment row still lands -- swallowing the ledger error is
--     deliberate and this fix must not change it;
--   * each firing trigger records a durable finance_posting_failures row
--     carrying the verbatim SQLSTATE (23514 / check_violation);
--   * every admin is notified, once per failing trigger;
--   * a retried webhook updates those rows instead of piling up duplicates,
--     and does not re-notify within the day;
--   * CONTROL: with the period open the entry posts and nothing is queued,
--     so the recorder fires on failure and not on every payment;
--   * SABOTAGE: restoring the old `raise warning` handler makes the failure
--     recorded nowhere again, so the checks above test the fix.
--
-- Wrapped in BEGIN/ROLLBACK -- it closes an accounting period and redefines a
-- trigger, and the rollback is what puts both back.
-- ===========================================================================

begin;
create temporary table p2(check_name text, observed text, expected text, verdict text) on commit drop;
create temporary table p2f(k text primary key, v text) on commit drop;

do $$
declare v_org uuid;
begin
  select id into v_org from public.organisations limit 1;
  insert into p2f values ('org', v_org::text);
  -- Close the current accounting period: the exact condition that makes
  -- finance_post_journal raise check_violation.
  insert into public.finance_periods (period_month, status)
  values (date_trunc('month', now())::date, 'closed')
  on conflict (period_month) do update set status = 'closed';
end $$;

-- ============ PREMISE: a closed period blocks the posting ==================
do $$
declare v_org uuid := (select v from p2f where k='org')::uuid; v_txn uuid; v_cnt int;
begin
  insert into public.payment_transactions
    (provider, provider_event_id, event_type, amount_minor, currency, organisation_id,
     processed_at, raw_payload)
  values ('paystack', 'p2-baseline', 'charge.success', 100000, 'NGN', v_org, now(),
          jsonb_build_object('data', jsonb_build_object(
            'reference','p2-baseline','metadata', jsonb_build_object('kind','voucher_payment'))))
  returning id into v_txn;
  insert into p2f values ('baseline_txn', v_txn::text);

  select count(*) into v_cnt from public.finance_journal_entries where source_ref = v_txn::text;
  insert into p2 values
    ('PREMISE: a payment landing in a CLOSED period posts no journal entry',
     v_cnt::text, '0', case when v_cnt = 0 then 'PASS' else 'FAIL' end);
  if v_cnt <> 0 then
    raise exception 'PREMISE FALSE: the closed period did not block the posting';
  end if;

  select count(*) into v_cnt from public.payment_transactions where id = v_txn;
  insert into p2 values
    ('PREMISE: the payment row itself still lands (the swallow is deliberate and must stay)',
     v_cnt::text, '1', case when v_cnt = 1 then 'PASS' else 'FAIL' end);
end $$;

-- ============ 1. The same failure is now queued and announced ==============
do $$
declare v_org uuid := (select v from p2f where k='org')::uuid;
        v_txn uuid; v_rows int; v_code text; v_admins int; v_notifs int; v_je int;
begin
  insert into public.payment_transactions
    (provider, provider_event_id, event_type, amount_minor, currency, organisation_id,
     processed_at, raw_payload)
  values ('paystack', 'p2-fixed', 'charge.success', 100000, 'NGN', v_org, now(),
          jsonb_build_object('data', jsonb_build_object(
            'reference','p2-fixed','metadata', jsonb_build_object('kind','voucher_payment'))))
  returning id into v_txn;
  insert into p2f values ('fixed_txn', v_txn::text);

  select count(*) into v_je from public.finance_journal_entries where source_ref = v_txn::text;
  insert into p2 values
    ('the posting still fails (this fix records the failure, it does not open the period)',
     v_je::text, '0', case when v_je = 0 then 'PASS' else 'FAIL' end);

  select count(*) into v_rows from public.finance_posting_failures where payment_transaction_id = v_txn;
  insert into p2 values
    ('both triggers that fired record a durable finance_posting_failures row',
     v_rows::text, '2', case when v_rows = 2 then 'PASS' else 'FAIL' end);
  if v_rows <> 2 then
    raise exception 'HOLE OPEN: % failure rows recorded, expected one per firing trigger', v_rows;
  end if;

  select distinct error_code into v_code from public.finance_posting_failures
   where payment_transaction_id = v_txn;
  insert into p2 values
    ('the recorded SQLSTATE is check_violation -- the closed-period refusal, verbatim',
     coalesce(v_code,'<null>'), '23514', case when v_code = '23514' then 'PASS' else 'FAIL' end);
  if v_code is distinct from '23514' then
    raise exception 'FAIL: recorded error_code % , expected 23514 (check_violation)', v_code;
  end if;

  select count(*) into v_admins from public.profiles where role = 'admin';
  select count(*) into v_notifs from public.notifications
   where template = 'finance_posting_failed' and payload->>'payment_transaction_id' = v_txn::text;
  insert into p2 values
    ('every admin is told, once per failing trigger',
     v_notifs::text, (v_admins * 2)::text, case when v_notifs = v_admins * 2 then 'PASS' else 'FAIL' end);
  if v_notifs <> v_admins * 2 then
    raise exception 'HOLE OPEN: % admin notifications raised, expected %', v_notifs, v_admins * 2;
  end if;

  select count(*) into v_rows from public.payment_transactions where id = v_txn;
  insert into p2 values
    ('the payment row still lands -- a ledger failure never aborts the webhook',
     v_rows::text, '1', case when v_rows = 1 then 'PASS' else 'FAIL' end);
  if v_rows <> 1 then raise exception 'REGRESSION: the recorder aborted the payment insert'; end if;
end $$;

-- ============ 2. A retried webhook does not pile up rows or spam ===========
do $$
declare v_org uuid := (select v from p2f where k='org')::uuid;
        v_txn uuid := (select v from p2f where k='fixed_txn')::uuid;
        v_rows int; v_notifs int; v_admins int;
begin
  -- Same transaction, trigger fired again (an UPDATE re-running the
  -- processed_at branch is the real-world retry shape).
  update public.payment_transactions set processed_at = null where id = v_txn;
  update public.payment_transactions set processed_at = now() where id = v_txn;

  select count(*) into v_rows from public.finance_posting_failures where payment_transaction_id = v_txn;
  insert into p2 values
    ('a retry updates the existing rows rather than piling up new ones',
     v_rows::text, '2', case when v_rows = 2 then 'PASS' else 'FAIL' end);
  if v_rows <> 2 then raise exception 'FAIL: retry produced % rows', v_rows; end if;

  select count(*) into v_admins from public.profiles where role = 'admin';
  select count(*) into v_notifs from public.notifications
   where template = 'finance_posting_failed' and payload->>'payment_transaction_id' = v_txn::text;
  insert into p2 values
    ('a retry inside the day does not re-notify (the bell is not spammed)',
     v_notifs::text, (v_admins * 2)::text, case when v_notifs = v_admins * 2 then 'PASS' else 'FAIL' end);
  if v_notifs <> v_admins * 2 then raise exception 'FAIL: retry re-notified (% rows)', v_notifs; end if;
end $$;

-- ============ 3. CONTROL: an OPEN period posts and queues nothing ==========
do $$
declare v_org uuid := (select v from p2f where k='org')::uuid;
        v_txn uuid; v_je int; v_fail int;
begin
  update public.finance_periods set status = 'open' where period_month = date_trunc('month', now())::date;

  insert into public.payment_transactions
    (provider, provider_event_id, event_type, amount_minor, currency, organisation_id,
     processed_at, raw_payload)
  values ('paystack', 'p2-control', 'charge.success', 100000, 'NGN', v_org, now(),
          jsonb_build_object('data', jsonb_build_object(
            'reference','p2-control','metadata', jsonb_build_object('kind','voucher_payment'))))
  returning id into v_txn;

  select count(*) into v_je from public.finance_journal_entries where source_ref = v_txn::text;
  select count(*) into v_fail from public.finance_posting_failures where payment_transaction_id = v_txn;
  insert into p2 values
    ('CONTROL: with the period open the entry posts and nothing is queued',
     'entries=' || v_je || ' failures=' || v_fail, 'entries=1 failures=0',
     case when v_je = 1 and v_fail = 0 then 'PASS' else 'FAIL' end);
  if v_je <> 1 or v_fail <> 0 then
    raise exception 'FAIL: open period gave entries=% failures=% -- the recorder fires on success', v_je, v_fail;
  end if;

  update public.finance_periods set status = 'closed' where period_month = date_trunc('month', now())::date;
end $$;

-- ============ 4. SABOTAGE: restore `raise warning`, nothing is recorded ====
do $$
declare v_org uuid := (select v from p2f where k='org')::uuid;
        v_txn uuid; v_fail int;
begin
  create or replace function private.finance_on_voucher_payment()
  returns trigger language plpgsql security definer set search_path to ''
  as $sab$
  begin
    if new.event_type::text in ('charge.success', 'checkout.session.completed')
       and coalesce(new.raw_payload#>>'{data,metadata,kind}', new.raw_payload#>>'{metadata,kind}') = 'voucher_payment'
    then
      begin
        perform private.finance_post_from_payment(new.id);
      exception when others then
        raise warning 'sabotage: posting failed for txn % (%)', new.id, sqlerrm;
      end;
    end if;
    return new;
  end;
  $sab$;

  -- processed_at left null so ONLY the voucher trigger fires; the
  -- voucher_payment branch of finance_post_from_payment does not require it.
  insert into public.payment_transactions
    (provider, provider_event_id, event_type, amount_minor, currency, organisation_id, raw_payload)
  values ('paystack', 'p2-sabotage', 'charge.success', 100000, 'NGN', v_org,
          jsonb_build_object('data', jsonb_build_object(
            'reference','p2-sabotage','metadata', jsonb_build_object('kind','voucher_payment'))))
  returning id into v_txn;

  select count(*) into v_fail from public.finance_posting_failures where payment_transaction_id = v_txn;
  insert into p2 values
    ('SABOTAGE: with the old `raise warning` handler back, the failure is recorded nowhere',
     v_fail::text, '0', case when v_fail = 0 then 'PASS' else 'FAIL' end);
  if v_fail <> 0 then
    raise exception 'VACUOUS TEST: a warning-only handler still queued the failure -- sections 1-2 prove nothing';
  end if;
end $$;

select check_name, observed, expected, verdict from p2 order by check_name;
rollback;
