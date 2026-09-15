-- ===========================================================================
-- Verification: 20260905000134_payment_transaction_type_refund_and_transfer_labels
--               + apps/web/src/lib/billing/refund-posting.ts
--
-- REQUIRES the migration above to be APPLIED — an enum value added by
-- `ALTER TYPE ... ADD VALUE` cannot be used in the transaction that adds it,
-- so this cannot be run as a combined migration+test dry-run.
--
-- The gap: public.payment_transaction_type had 16 labels and none contained
-- "refund", so `select 'refund.processed'::payment_transaction_type` raised
-- 22P02. The Paystack webhook wrote `event_type: event.event` verbatim, the
-- insert failed, and the handler only tolerates 23505 — so a refund webhook
-- recorded NOTHING. private.finance_post_from_payment's refund branch
-- (Dr 4900 Refunds / Cr 1020 Cash) keys on event_type ilike '%refund%' and
-- was therefore unreachable, and the three refund crons posted no journal
-- entry at all. A refunded ₦5,000 video visit left ₦5,000 of cash and
-- revenue on the books that was not in the bank.
--
-- This script proves, against the real trigger chain:
--   * a completed refund recorded the way refund-posting.ts records it
--     actually posts a balanced Dr 4900 / Cr 1020 entry;
--   * the same refund cannot post twice — the unique
--     (provider, provider_event_id) index is what makes the cron and the
--     webhook safe to both run;
--   * a refund.pending / refund.failed row (processed_at left null) posts
--     nothing, because only money that actually left the account may move
--     the ledger;
--   * and a sabotage run — the same row with a non-refund event_type —
--     posts no refund entry, showing the check discriminates on the label
--     rather than on merely having inserted a row.
--
-- Wrapped in BEGIN/ROLLBACK — a verification script, never seed data.
-- ===========================================================================

begin;

create temporary table rlr_result(
  check_name text,
  observed   text,
  expected   text,
  verdict    text
) on commit drop;

create temporary table rlr_fixture(k text primary key, v uuid) on commit drop;

do $$
declare
  v_org uuid;
begin
  select id into v_org from public.organisations limit 1;
  if v_org is null then
    raise exception 'no organisation available — cannot run this test';
  end if;
  insert into rlr_fixture values ('org', v_org);
end $$;

-- ==========================================================================
-- 1. A completed refund posts the reversal.
-- ==========================================================================
do $$
declare
  v_org    uuid := (select v from rlr_fixture where k = 'org');
  v_txn    uuid;
  v_entry  uuid;
  v_debit  bigint;
  v_credit bigint;
begin
  insert into public.payment_transactions
    (provider, provider_event_id, event_type, amount_minor, currency,
     organisation_id, processed_at, raw_payload)
  values ('paystack', 'refund:rlr-test-1', 'refund.processed', 500000, 'NGN',
          v_org, now(),
          jsonb_build_object('event','refund.processed','source','tarragon-refund-cron',
            'data', jsonb_build_object('id','rlr-test-1','amount',500000,'currency','NGN',
              'transaction', jsonb_build_object('reference','rlr-original-charge'))))
  returning id into v_txn;

  select id into v_entry from public.finance_journal_entries
  where source = 'refund' and source_ref = v_txn::text;

  insert into rlr_result values
    ('a completed refund posts a journal entry',
     case when v_entry is null then 'no entry' else 'entry posted' end,
     'entry posted',
     case when v_entry is not null then 'PASS' else 'FAIL' end);

  if v_entry is null then
    raise exception 'HOLE OPEN: a refund transaction posted nothing to the ledger';
  end if;

  select coalesce(sum(debit_minor) filter (where account_code = '4900'), 0),
         coalesce(sum(credit_minor) filter (where account_code = '1020'), 0)
    into v_debit, v_credit
  from public.finance_journal_lines where entry_id = v_entry;

  insert into rlr_result values
    ('...as Dr 4900 Refunds / Cr 1020 Cash, balanced, for the refunded amount',
     format('Dr4900=%s Cr1020=%s', v_debit, v_credit), 'Dr4900=500000 Cr1020=500000',
     case when v_debit = 500000 and v_credit = 500000 then 'PASS' else 'FAIL' end);

  if v_debit <> 500000 or v_credit <> 500000 then
    raise exception 'BROKEN: refund posted the wrong lines (Dr4900=%, Cr1020=%)', v_debit, v_credit;
  end if;

  insert into rlr_fixture values ('txn', v_txn), ('entry', v_entry);
end $$;

-- ==========================================================================
-- 2. The same refund cannot post twice. This is the whole reason the cron
--    and the webhook can both be live: they derive the same
--    `refund:<refundId>` key, so the second one conflicts.
-- ==========================================================================
do $$
declare
  v_org   uuid := (select v from rlr_fixture where k = 'org');
  v_state text;
  v_count int;
begin
  begin
    insert into public.payment_transactions
      (provider, provider_event_id, event_type, amount_minor, currency,
       organisation_id, processed_at, raw_payload)
    values ('paystack', 'refund:rlr-test-1', 'refund.processed', 500000, 'NGN', v_org, now(), '{}'::jsonb);
    v_state := 'ACCEPTED';
  exception when unique_violation then
    v_state := '23505';
  end;

  select count(*) into v_count from public.finance_journal_entries
  where source = 'refund' and source_ref = (select v from rlr_fixture where k = 'txn')::text;

  insert into rlr_result values
    ('the same refund id cannot be recorded twice', v_state, '23505',
     case when v_state = '23505' then 'PASS' else 'FAIL' end);
  insert into rlr_result values
    ('...so exactly one reversal exists', v_count::text, '1',
     case when v_count = 1 then 'PASS' else 'FAIL' end);

  if v_state <> '23505' or v_count <> 1 then
    raise exception 'DOUBLE POSTING RISK: refund idempotency is not holding (% / % entries)', v_state, v_count;
  end if;
end $$;

-- ==========================================================================
-- 3. A refund that has not completed moves nothing.
-- ==========================================================================
do $$
declare
  v_org   uuid := (select v from rlr_fixture where k = 'org');
  v_txn   uuid;
  v_count int;
begin
  insert into public.payment_transactions
    (provider, provider_event_id, event_type, amount_minor, currency,
     organisation_id, processed_at, raw_payload)
  values ('paystack', 'refund:rlr-test-pending', 'refund.pending', 500000, 'NGN', v_org, null, '{}'::jsonb)
  returning id into v_txn;

  select count(*) into v_count from public.finance_journal_entries
  where source = 'refund' and source_ref = v_txn::text;

  insert into rlr_result values
    ('a refund.pending row (processed_at null) posts nothing', v_count::text, '0',
     case when v_count = 0 then 'PASS' else 'FAIL' end);

  if v_count <> 0 then
    raise exception 'BROKEN: an incomplete refund moved the ledger';
  end if;
end $$;

-- ==========================================================================
-- 4. SABOTAGE — the identical row with a non-refund event_type must NOT
--    produce a refund entry. If it does, section 1 is passing because
--    something else posts on every processed transaction, not because the
--    refund branch was reached.
-- ==========================================================================
do $$
declare
  v_org   uuid := (select v from rlr_fixture where k = 'org');
  v_txn   uuid;
  v_count int;
begin
  insert into public.payment_transactions
    (provider, provider_event_id, event_type, amount_minor, currency,
     organisation_id, processed_at, raw_payload)
  values ('paystack', 'refund:rlr-test-sabotage', 'charge.failed', 500000, 'NGN', v_org, now(), '{}'::jsonb)
  returning id into v_txn;

  select count(*) into v_count from public.finance_journal_entries
  where source = 'refund' and source_ref = v_txn::text;

  insert into rlr_result values
    ('sabotage: a non-refund event_type posts no refund entry (proves the label is what matters)',
     v_count::text, '0', case when v_count = 0 then 'PASS' else 'FAIL' end);

  if v_count <> 0 then
    raise exception 'VACUOUS TEST: a non-refund transaction also posted a refund entry — section 1 proves nothing';
  end if;
end $$;

select check_name, observed, expected, verdict
from rlr_result
order by verdict desc, check_name;

rollback;
