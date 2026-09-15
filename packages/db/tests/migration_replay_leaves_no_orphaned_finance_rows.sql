-- ===========================================================================
-- Verification: a replayed migration history leaves no phantom money behind.
--
-- Sibling of revenue_recognition_orphan_source_guard.sql, and deliberately
-- not the same test. That one proves the RECOGNISER handles an orphan safely
-- once one exists. This one proves no orphan is being created in the first
-- place, by inspecting whatever state the migrations and seed actually leave
-- behind -- which is where the production phantom came from.
--
-- THE GAP. public.revenue_recognition_schedules.source_id is polymorphic
-- across service_purchases / subscriptions / subscription_add_ons, so it
-- carries no foreign key, and finance_journal_entries.source_ref is a bare
-- text column holding a payment_transactions id. Nothing cascades from
-- either. A migration whose self-test inserts a real charge.success
-- payment_transactions row therefore posts a real journal entry and opens a
-- real recognition schedule as a side effect, and if its cleanup deletes only
-- the rows it inserted by hand, both survive pointing at nothing.
--
-- That is not a tidiness problem. It happened for real, in
-- 20260902200003_rewire_finance_ledger_payer_resolution_to_service_purchases
-- .sql: journal entry #171 (Dr 1020 / Cr 2000, ₦10,000, "Service purchase —
-- Essential Care Pack") became the entire balance of both accounts on the
-- production books, and the schedule beside it was queued to recognise
-- ₦10,000 of revenue that never happened on 1 October 2026. PR #492 reversed
-- the entry and cancelled the schedule; that migration's cleanup has since
-- been corrected. This script is what stops the next one.
--
-- WHY THE CHECKS ARE SHAPED AROUND "UNEXPLAINED". A deliberately reversed
-- entry and a deliberately cancelled schedule are how this platform retires a
-- bad financial record -- it never deletes one -- so production legitimately
-- still holds both halves of the 2026-09-02 phantom, and a flat "no row may
-- point at a deleted source" check would fail there forever. What must not
-- exist is an orphan nobody has accounted for. Equally, an "active orphans
-- only" check would be vacuous on a fresh replay: 20260905204245 sweeps
-- active orphans to 'cancelled' as it passes, so a leak reintroduced upstream
-- of it would be tidied away before this script ever looked. Section 1
-- therefore checks both halves: no orphan in a live status, AND no orphan
-- bearing that sweep's own auto-cancellation text, which is the fingerprint
-- of a leak the sweep just caught.
--
-- Proves:
--   * no revenue_recognition_schedules row in a live status ('active' or
--     'completed') points at a source row that does not exist;
--   * no schedule was auto-cancelled by 20260905204245's orphan sweep during
--     this replay -- the one production row it was written for is named and
--     excluded, so anything else is a fresh leak;
--   * no unreversed payment/voucher/refund journal entry points at a
--     payment_transactions row that does not exist;
--   * SABOTAGE: each detector is handed a genuine orphan of its own kind and
--     must find it, so a clean run means "nothing is orphaned" rather than
--     "the query never matches anything".
--
-- Wrapped in BEGIN/ROLLBACK -- the sabotage section writes deliberately
-- broken rows, and the rollback is what removes them.
-- ===========================================================================

begin;
create temporary table rr(check_name text, observed text, expected text, verdict text) on commit drop;

-- The single production row PR #492 reversed and cancelled on purpose. Named
-- once, here, so the exclusions below are auditable rather than scattered.
create temporary table rrk(k text primary key, v text) on commit drop;
insert into rrk values
  ('known_phantom_schedule', 'c890ef77-ea9c-4f90-9650-ba702a963289'),
  ('sweep_reason_prefix',    'Cancelled 2026-09-05 by the migration that introduced the orphan guard');

-- ============ 1. No recognition schedule outlives its source ==============
do $$
declare
  v_known uuid := (select v from rrk where k='known_phantom_schedule')::uuid;
  v_prefix text := (select v from rrk where k='sweep_reason_prefix');
  v_live int;
  v_swept int;
  v_detail text;
begin
  select count(*), string_agg(format('%s %s (%s)', s.source_kind, s.source_id, s.status), '; ')
    into v_live, v_detail
  from public.revenue_recognition_schedules s
  where s.status in ('active', 'completed')
    and s.source_id is not null
    and not private.revrec_source_exists(s.source_kind, s.source_id);

  insert into rr values
    ('no live-status schedule points at a deleted source',
     coalesce(v_detail, 'none'), 'none',
     case when v_live = 0 then 'PASS' else 'FAIL' end);
  if v_live <> 0 then
    raise exception 'HOLE OPEN: % recognition schedule(s) in a live status point at a source that no longer exists: %',
      v_live, v_detail;
  end if;

  -- The sweep's own fingerprint. If a migration upstream of 20260905204245
  -- leaks a schedule again, the sweep cancels it with this exact wording --
  -- so a row carrying it, other than the production phantom it was written
  -- for, means the leak is back and was merely tidied up rather than fixed.
  select count(*), string_agg(format('%s -> %s %s', s.id, s.source_kind, s.source_id), '; ')
    into v_swept, v_detail
  from public.revenue_recognition_schedules s
  where s.id <> v_known
    and s.cancelled_reason like v_prefix || '%';

  insert into rr values
    ('20260905204245''s orphan sweep found nothing new to cancel',
     coalesce(v_detail, 'none'), 'none',
     case when v_swept = 0 then 'PASS' else 'FAIL' end);
  if v_swept <> 0 then
    raise exception
      'HOLE OPEN: % schedule(s) were auto-cancelled as orphans by the 20260905204245 sweep, so a migration is still leaking one: %',
      v_swept, v_detail;
  end if;
end $$;

-- ============ 2. No payment posting outlives its transaction ==============
do $$
declare
  v_orphans int;
  v_detail text;
begin
  -- source_ref is text and only the payment/voucher/refund sources put a
  -- payment_transactions id in it (revenue recognition writes 'revrec:...',
  -- reward vouchers write 'reward:...'), so the uuid shape is both the filter
  -- and the guarantee the cast below is safe. is_reversed excludes an entry
  -- that has been deliberately retired with a balanced contra entry -- the
  -- platform's own way of taking a bad posting off the books.
  select count(*), string_agg(format('#%s %s (%s)', je.entry_no, je.source_ref, je.memo), '; ')
    into v_orphans, v_detail
  from public.finance_journal_entries je
  where je.source in ('payment', 'voucher', 'refund')
    and not je.is_reversed
    and je.source_ref ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and not exists (
      select 1 from public.payment_transactions t where t.id = je.source_ref::uuid);

  insert into rr values
    ('no unreversed payment entry points at a deleted payment_transactions row',
     coalesce(v_detail, 'none'), 'none',
     case when v_orphans = 0 then 'PASS' else 'FAIL' end);
  if v_orphans <> 0 then
    raise exception 'HOLE OPEN: % journal entr(ies) are posted against a payment transaction that no longer exists: %',
      v_orphans, v_detail;
  end if;
end $$;

-- ============ 3. SABOTAGE: hand each detector a real orphan ================
-- Written directly rather than by replaying a payment through the trigger
-- chain: what sections 1 and 2 assert is that these shapes are absent, and
-- this proves the queries looking for them actually see them. The trigger
-- chain that produces them for real is covered by 20260902103712's own
-- behavioural assertion, and the recogniser's handling of one by
-- revenue_recognition_orphan_source_guard.sql.
do $$
declare
  v_known uuid := (select v from rrk where k='known_phantom_schedule')::uuid;
  v_prefix text := (select v from rrk where k='sweep_reason_prefix');
  v_org uuid;
  v_gone uuid := gen_random_uuid();
  v_n int;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  if v_org is null then
    raise exception 'no organisation exists at all -- the core migrations did not run';
  end if;

  -- (a) a live-status schedule pointing at a service_purchase that is not there
  insert into public.revenue_recognition_schedules
    (source_kind, source_id, organisation_id, revenue_account_code,
     deferred_account_code, currency, total_minor, period_start, period_end, status)
  values ('service_purchase', v_gone, v_org, '4020', '2000', 'NGN',
          1000000, current_date, current_date + 30, 'active');

  select count(*) into v_n
  from public.revenue_recognition_schedules s
  where s.status in ('active', 'completed')
    and s.source_id is not null
    and not private.revrec_source_exists(s.source_kind, s.source_id);

  insert into rr values
    ('SABOTAGE: a live schedule pointing at a deleted purchase is detected',
     v_n::text, '1', case when v_n = 1 then 'PASS' else 'FAIL' end);
  if v_n <> 1 then
    raise exception 'VACUOUS TEST: section 1 did not see a deliberately orphaned schedule (saw %)', v_n;
  end if;

  -- (b) a schedule bearing the sweep's auto-cancellation fingerprint
  insert into public.revenue_recognition_schedules
    (source_kind, source_id, organisation_id, revenue_account_code,
     deferred_account_code, currency, total_minor, period_start, period_end,
     status, cancelled_reason)
  values ('service_purchase', gen_random_uuid(), v_org, '4020', '2000', 'NGN',
          1000000, current_date, current_date + 30, 'cancelled',
          v_prefix || ': source service_purchase ' || gen_random_uuid()::text ||
          ' no longer exists, so there is nothing to recognise revenue against.');

  select count(*) into v_n
  from public.revenue_recognition_schedules s
  where s.id <> v_known and s.cancelled_reason like v_prefix || '%';

  insert into rr values
    ('SABOTAGE: a schedule swept up as an orphan is detected',
     v_n::text, '1', case when v_n = 1 then 'PASS' else 'FAIL' end);
  if v_n <> 1 then
    raise exception 'VACUOUS TEST: section 1''s sweep-fingerprint check did not see a swept orphan (saw %)', v_n;
  end if;

  -- (c) an unreversed payment entry pointing at a transaction that is not there
  perform private.finance_post_journal(
    current_date, 'NGN'::public.currency, 'payment', v_gone::text,
    'Sabotage: posting against a payment transaction that does not exist',
    jsonb_build_array(
      jsonb_build_object('account_code','1020','debit_minor',1000000,'credit_minor',0,'organisation_id',v_org),
      jsonb_build_object('account_code','2000','debit_minor',0,'credit_minor',1000000,'organisation_id',v_org)),
    null);

  select count(*) into v_n
  from public.finance_journal_entries je
  where je.source in ('payment', 'voucher', 'refund')
    and not je.is_reversed
    and je.source_ref ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and not exists (
      select 1 from public.payment_transactions t where t.id = je.source_ref::uuid);

  insert into rr values
    ('SABOTAGE: an unreversed entry pointing at a deleted transaction is detected',
     v_n::text, '1', case when v_n = 1 then 'PASS' else 'FAIL' end);
  if v_n <> 1 then
    raise exception 'VACUOUS TEST: section 2 did not see a deliberately orphaned journal entry (saw %)', v_n;
  end if;
end $$;

select check_name, observed, expected, verdict from rr order by check_name;

do $$
declare v_fail int;
begin
  select count(*) into v_fail from rr where verdict <> 'PASS';
  if v_fail > 0 then
    raise exception 'HOLE OPEN: % check(s) failed -- see the table above', v_fail;
  end if;
  raise notice 'migration replay leaves no orphaned finance rows: all checks passed';
end $$;

rollback;
