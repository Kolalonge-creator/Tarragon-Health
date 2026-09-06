-- Reverse the ₦10,000 phantom service-purchase posting, cancel the revenue
-- recognition schedule it created, and stop the recogniser from ever booking
-- revenue against a source row that no longer exists.
--
-- WHAT WAS WRONG
-- --------------
-- finance_journal_entries #171 (b9b38f43-9136-4e05-8b7e-c2daf7c43fb4) posts
-- Dr 1020 Payment processor clearing ₦10,000 / Cr 2000 Deferred revenue ₦10,000, memo "Service
-- purchase — Essential Care Pack", source_ref 628c1ea3-5aff-41e6-b41f-f95b26f01bc5.
-- That source_ref is a payment_transactions id, per the posting path in
-- 20260902192530_fix_voucher_and_sponsored_purchase_finance_posting.sql. Neither
-- that payment transaction nor the service_purchases row behind it exists any
-- more; both were deleted on 2026-09-02 during the subscription-retirement
-- cutover. No cash was ever received. The entry says otherwise, and because
-- accounts 1020 and 2000 carry no other activity at all, this single phantom
-- IS the entire payment-processor clearing balance and the entire deferred-
-- revenue balance on the books.
--
-- Alongside it, revenue_recognition_schedules c890ef77-ea9c-4f90-9650-ba702a963289
-- sits status='active', total ₦10,000, recognised ₦0, 2000 -> 4020, running
-- 2026-09-02 to 2026-10-02, pointing at the same deleted purchase. The
-- finance-revenue-recognition-monthly cron ("0 3 1 * *") recognises every
-- elapsed month of any active schedule, so on 1 October 2026 it would have
-- posted Dr 2000 / Cr 4020 ₦10,000 — turning a bookkeeping artefact into
-- ₦10,000 of reported revenue, and driving the deferred-revenue liability
-- ₦10,000 negative on the way.
--
-- WHY REVERSE RATHER THAN DELETE
-- ------------------------------
-- Deleting entry #171 would make the ledger correct and the record dishonest:
-- nothing would show that ₦10,000 was ever on the books or who took it off.
-- private.finance_reverse_entry posts a balanced contra entry (Dr 2000 /
-- Cr 1020) dated today, links the two by reversal_of, and marks the original
-- is_reversed — so both entries stay visible and the net effect is nil. That
-- is the treatment the platform already offers through the "Reverse" control
-- on the finance ledger page; this migration uses the same function rather
-- than hand-writing a correction.
--
-- WHY THE RECOGNISER IS CHANGED TOO
-- ---------------------------------
-- Cancelling this one schedule fixes this one row. The mechanism that let a
-- schedule outlive its source is untouched: source_id is polymorphic across
-- three tables so it carries no foreign key, and nothing deletes a schedule
-- when its purchase or subscription goes. The next deleted source would post
-- the same phantom revenue on the next 1st of the month. The recogniser now
-- checks its source still exists before posting, and cancels the schedule with
-- a written reason instead of silently skipping it, so an orphan is visible on
-- the finance page rather than being quietly dropped from a cron run.

-- 1. Somewhere to record WHY a schedule was cancelled. Without this the fix
--    below is a status flipped by nobody for no stated reason, which is not
--    an acceptable shape for a financial record.
alter table public.revenue_recognition_schedules
  add column if not exists cancelled_reason text;

comment on column public.revenue_recognition_schedules.cancelled_reason is
  'Why this schedule stopped recognising revenue. Set whenever status becomes '
  '''cancelled'' — by an operator, or by private.finance_recognize_revenue when '
  'it finds the source row gone. Null for active and completed schedules.';

-- 2. Does the row this schedule bills for still exist? The three source_kind
--    values map to three different tables (see the CHECK on source_kind and
--    the call sites in finance_post_from_payment), so this cannot be a foreign
--    key. An unrecognised kind returns true: this guard exists to stop revenue
--    being posted for a source proven absent, never to block a kind it simply
--    does not know about.
create or replace function private.revrec_source_exists(p_kind text, p_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path to ''
as $function$
begin
  if p_id is null then
    return true;
  end if;
  case p_kind
    when 'service_purchase' then
      return exists (select 1 from public.service_purchases where id = p_id);
    when 'subscription' then
      return exists (select 1 from public.subscriptions where id = p_id);
    when 'add_on' then
      return exists (select 1 from public.subscription_add_ons where id = p_id);
    else
      return true;
  end case;
end;
$function$;

-- anon inherits EXECUTE through the PUBLIC pseudo-role, so revoking from anon
-- alone is a no-op — it has to come off PUBLIC. See CLAUDE.md.
revoke all on function private.revrec_source_exists(text, uuid) from public, anon;

-- 3. The recogniser, unchanged except for the orphan guard at the top of the
--    schedule loop.
create or replace function private.finance_recognize_revenue(p_as_of date default current_date)
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
declare
  s record;
  m date;
  v_last_month date;
  v_month_start date;
  v_month_end date;
  v_total_days numeric;
  v_amount bigint;
  v_entry_date date;
  v_posted int := 0;
  v_is_final boolean;
  v_source_ref text;
begin
  for s in
    select * from public.revenue_recognition_schedules
    where status = 'active' and recognized_minor < total_minor
  loop
    -- A schedule whose source row has been deleted has nothing left to bill
    -- for. Recognising against it would invent revenue. Cancel it with a
    -- reason a person can read on the finance page, and move on; do not raise,
    -- because one orphan must not stop every other schedule in the run.
    if not private.revrec_source_exists(s.source_kind, s.source_id) then
      update public.revenue_recognition_schedules
         set status = 'cancelled',
             cancelled_reason =
               'Cancelled automatically on ' || to_char(current_date, 'YYYY-MM-DD') ||
               ': source ' || s.source_kind || ' ' || s.source_id::text ||
               ' no longer exists, so there is nothing to recognise revenue against. ' ||
               'Recognised ' || s.recognized_minor || ' of ' || s.total_minor ||
               ' minor units before it was found orphaned.'
       where id = s.id;
      raise warning 'finance_recognize_revenue: schedule % cancelled, source % % is gone',
        s.id, s.source_kind, s.source_id;
      continue;
    end if;

    v_total_days := (s.period_end - s.period_start);
    -- last month we may recognise this run = month of min(as_of, period_end)
    v_last_month := date_trunc('month', least(p_as_of, s.period_end))::date;
    m := date_trunc('month', s.period_start)::date;
    while m <= v_last_month loop
      v_source_ref := 'revrec:' || s.id::text || ':' || to_char(m, 'YYYY-MM');
      -- skip months already recognised (idempotent)
      if not exists (
        select 1 from public.finance_journal_entries
        where source = 'revenue_recognition' and source_ref = v_source_ref
      ) then
        v_month_start := greatest(s.period_start, m);
        v_month_end   := least(s.period_end, (m + interval '1 month')::date);
        v_is_final    := (m = date_trunc('month', s.period_end)::date);
        if v_is_final then
          -- remainder so rounding never drifts the total
          v_amount := s.total_minor - s.recognized_minor;
        else
          v_amount := round(s.total_minor * (v_month_end - v_month_start) / v_total_days);
        end if;
        if v_amount > 0 then
          v_entry_date := least(p_as_of, (v_month_end - 1));
          perform private.finance_post_journal(
            v_entry_date, s.currency, 'revenue_recognition', v_source_ref,
            'Revenue recognition ' || to_char(m,'Mon YYYY') || ' — ' ||
              (select name from public.finance_accounts where code = s.revenue_account_code),
            jsonb_build_array(
              jsonb_build_object('account_code', s.deferred_account_code, 'debit_minor', v_amount, 'credit_minor', 0,
                                 'organisation_id', s.organisation_id),
              jsonb_build_object('account_code', s.revenue_account_code, 'debit_minor', 0, 'credit_minor', v_amount,
                                 'organisation_id', s.organisation_id)
            ),
            null);
          update public.revenue_recognition_schedules
            set recognized_minor = recognized_minor + v_amount
            where id = s.id;
          s.recognized_minor := s.recognized_minor + v_amount;
          v_posted := v_posted + 1;
        end if;
      end if;
      m := (m + interval '1 month')::date;
    end loop;
    -- mark complete once fully recognised
    update public.revenue_recognition_schedules
      set status = 'completed'
      where id = s.id and recognized_minor >= total_minor;
  end loop;
  return v_posted;
end;
$function$;

revoke all on function private.finance_recognize_revenue(date) from public, anon;

-- 4. The data fix itself. Every branch is guarded on the rows still looking
--    exactly like the phantom described at the top of this file, so a fresh
--    replay (where none of these rows exist) is a clean no-op, and a replay
--    against a database where the payment transaction turned out to be real
--    refuses to reverse anything.
do $do$
declare
  v_entry uuid := 'b9b38f43-9136-4e05-8b7e-c2daf7c43fb4';
  v_txn   uuid := '628c1ea3-5aff-41e6-b41f-f95b26f01bc5';
  v_sched uuid := 'c890ef77-ea9c-4f90-9650-ba702a963289';
  v_reversal uuid;
  v_orphan record;
begin
  if exists (
        select 1 from public.finance_journal_entries
         where id = v_entry
           and is_reversed = false
           and source = 'payment'
           and source_ref = v_txn::text)
     and not exists (select 1 from public.payment_transactions where id = v_txn)
  then
    v_reversal := private.finance_reverse_entry(
      v_entry,
      'Reversal of a phantom posting. The payment transaction (' || v_txn::text ||
      ') and the service purchase behind this entry were both deleted on 2026-09-02 '
      'during the subscription-retirement cutover; no cash was ever received against it. '
      'Reversed rather than deleted so both entries stay on the ledger.',
      null);
    raise notice 'reversed phantom entry % with %', v_entry, v_reversal;
  end if;

  update public.revenue_recognition_schedules
     set status = 'cancelled',
         cancelled_reason =
           'Cancelled 2026-09-05: source service_purchase b28a4466-dbbc-4e3e-b949-b27f84fe2ddb '
           'no longer exists and the originating journal entry (#171) has been reversed. '
           'Left active, the monthly recogniser would have posted ₦10,000 of revenue that '
           'never happened on 1 October 2026.'
   where id = v_sched
     and status = 'active'
     and not exists (select 1 from public.service_purchases where id = source_id);

  -- Any OTHER active schedule whose source is already gone gets the same
  -- treatment now, rather than waiting for the guard above to catch it on the
  -- next cron run. In production there are none -- the phantom was the only row
  -- in the entire table.
  --
  -- The culprit this sweep was originally written blind against has since been
  -- identified and fixed at source: 20260902200003_rewire_finance_ledger_payer
  -- _resolution_to_service_purchases.sql's behavioural proof deleted the
  -- service_purchase and payment_transactions rows it had inserted but not the
  -- journal entry and recognition schedule the platform posted in response.
  -- That is the same migration that produced the production phantom above --
  -- its applied version, 20260902200256, is stamped on journal entry #171 and
  -- on schedule c890ef77 to the second. Its cleanup now matches the pattern the
  -- sibling finance proofs (20260902103712, 20260902192530) already used, so a
  -- fresh replay reaches this loop with nothing to sweep.
  --
  -- The sweep stays anyway: it is the backstop for the next migration to make
  -- the same mistake, and it is cheap. Each row it finds is named at WARNING
  -- rather than NOTICE, because `supabase db reset` swallows NOTICE -- which is
  -- precisely why the original culprit could not be read out of a CI log.
  for v_orphan in
    select s.id, s.source_kind, s.source_id, s.total_minor, s.recognized_minor
      from public.revenue_recognition_schedules s
     where s.status = 'active'
       and not private.revrec_source_exists(s.source_kind, s.source_id)
  loop
    update public.revenue_recognition_schedules
       set status = 'cancelled',
           cancelled_reason =
             'Cancelled 2026-09-05 by the migration that introduced the orphan guard: source ' ||
             v_orphan.source_kind || ' ' || coalesce(v_orphan.source_id::text, '<null>') ||
             ' no longer exists, so there is nothing to recognise revenue against.'
     where id = v_orphan.id;
    raise warning 'cancelled orphaned schedule % (source % %, % of % minor units recognised)',
      v_orphan.id, v_orphan.source_kind, v_orphan.source_id,
      v_orphan.recognized_minor, v_orphan.total_minor;
  end loop;
end
$do$;

-- 5. Prove it, rather than hoping. Each check tolerates the row being absent,
--    which is the fresh-replay case; what it will not tolerate is the row
--    being present and still wrong.
do $do$
declare
  v_entry uuid := 'b9b38f43-9136-4e05-8b7e-c2daf7c43fb4';
  v_sched uuid := 'c890ef77-ea9c-4f90-9650-ba702a963289';
  v_net_1020 bigint;
  v_net_2000 bigint;
begin
  if exists (select 1 from public.finance_journal_entries where id = v_entry) then
    if not (select is_reversed from public.finance_journal_entries where id = v_entry) then
      raise exception 'phantom entry % is still not reversed', v_entry;
    end if;
    if not exists (select 1 from public.finance_journal_entries where reversal_of = v_entry) then
      raise exception 'no reversing entry points at %', v_entry;
    end if;

    -- The pair must now net to nothing on both accounts it touched.
    select coalesce(sum(l.debit_minor - l.credit_minor), 0) into v_net_1020
      from public.finance_journal_lines l
     where l.account_code = '1020'
       and l.entry_id in (v_entry, (select id from public.finance_journal_entries where reversal_of = v_entry));
    select coalesce(sum(l.credit_minor - l.debit_minor), 0) into v_net_2000
      from public.finance_journal_lines l
     where l.account_code = '2000'
       and l.entry_id in (v_entry, (select id from public.finance_journal_entries where reversal_of = v_entry));
    if v_net_1020 <> 0 or v_net_2000 <> 0 then
      raise exception 'entry % and its reversal do not net to zero (1020=%, 2000=%)',
        v_entry, v_net_1020, v_net_2000;
    end if;
  end if;

  if exists (select 1 from public.revenue_recognition_schedules where id = v_sched) then
    if (select status from public.revenue_recognition_schedules where id = v_sched) <> 'cancelled' then
      raise exception 'phantom schedule % is still %', v_sched,
        (select status from public.revenue_recognition_schedules where id = v_sched);
    end if;
    if (select cancelled_reason from public.revenue_recognition_schedules where id = v_sched) is null then
      raise exception 'schedule % was cancelled without a recorded reason', v_sched;
    end if;
  end if;

  -- No schedule anywhere may be left active pointing at a source that is gone.
  if exists (
    select 1 from public.revenue_recognition_schedules s
     where s.status = 'active'
       and not private.revrec_source_exists(s.source_kind, s.source_id)
  ) then
    raise exception 'an active revenue schedule still points at a deleted source';
  end if;

  -- The guard is actually in the deployed recogniser, not just in this file.
  if pg_get_functiondef('private.finance_recognize_revenue(date)'::regprocedure)
       not like '%revrec_source_exists%' then
    raise exception 'finance_recognize_revenue does not consult revrec_source_exists';
  end if;

  -- The recurring anon-EXECUTE gotcha, checked rather than assumed.
  if has_function_privilege('anon', 'private.revrec_source_exists(text, uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'private.finance_recognize_revenue(date)', 'EXECUTE') then
    raise exception 'anon can execute a finance function';
  end if;

  raise notice 'phantom revenue reversal: all checks passed';
end
$do$;
