-- ===========================================================================
-- Test data stays out of staff views and the finance console, and is cleaned up on its own.
--
-- WHAT WAS WRONG (read live 2026-11-03)
--   * The General Ledger (finance_journal_entries / _lines) had no is_test column at all. Every one of its 16 entries was
--     test money: two Paystack test charges by the "First Patient" test account (2026-09-16), seven retired platform-credit
--     E2E entries (2026-09-17), the adjustment that corrected one of them, and six monthly revenue-recognition entries that
--     drip the two test purchases into revenue. The finance console (dashboard, trial balance, P&L, KPIs, ledger) summed
--     all of it as real revenue, cash and deferred revenue. Real revenue to date is zero.
--   * payment_transactions had no is_test either; its analytics_clean view only recognised a test payer through a booking
--     order, so the three "First Patient" charges (booking_order_type null) leaked through to the reconciliation page.
--   * revenue_recognition_schedules had no is_test, so once a test patient is purged the schedule's source row is gone and
--     the monthly recogniser would have posted the remaining months as REAL revenue.
--   * The clinician Patients roster (/clinician/patients) read profiles with no is_test filter (fixed in the app, same PR).
--   * Nothing ever removed a test account: public.purge_test_account (S39d) exists but only ran when someone remembered.
--
-- FIX
--   1. finance_journal_entries.is_test, payment_transactions.is_test, revenue_recognition_schedules.is_test, each stamped
--      by a BEFORE INSERT trigger from the row's source (the order, payment, refund, schedule, payer or parent entry), and
--      backfilled for every live row. A posted entry is never deleted (standing rule): a test entry is marked, not removed.
--   2. Two new analytics_clean views (finance_journal_entries, finance_journal_lines, WHERE NOT is_test) and a tightened
--      analytics_clean.payment_transactions; every finance READER rpc is re-created from its LIVE body with the public
--      relation text-replaced by the clean view, the same way OQ-39 did for analytics_*. Writers are untouched.
--   3. profiles.test_keep_reason (admin/service only). private.purge_stale_test_accounts() runs nightly (04:25 UTC, 05:25 Lagos) and
--      calls purge_test_account for every is_test account older than 7 days with no keep reason. The synthetic canary
--      organisation (organisations.metadata->>'canary') is never purged whatever the column says; the App Store review
--      accounts and the canary people get a keep reason here. A failed purge opens one ops incident and the rest continue.
--
-- Rows affected (live): 16 GL entries, 3 payment_transactions, 6 revrec schedules marked is_test; 5 profiles get a keep reason.
-- Bodies redefined from the LIVE definitions (pg_get_functiondef, 2026-11-03).
-- Proof: packages/db/tests/test_data_hidden_from_finance_and_auto_purged.sql
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1a. payment_transactions.is_test — stamped from the payer the row resolves to
-- ---------------------------------------------------------------------------
alter table public.payment_transactions add column if not exists is_test boolean not null default false;
comment on column public.payment_transactions.is_test is 'True when the payer (private.resolve_payment_payer) is a test account at insert time. Set by trigger; never shown in finance totals.';

-- A charge that resolves to no purchase at all (a stray webhook, a payment nothing claimed) is still a test charge when the
-- card holder's e-mail is a test account's login: the one live example is a 15,329.95 naira Paystack test charge by
-- firstpatient@gmail.com that no purchase ever picked up and that sat on the reconciliation page as "unmatched".
create or replace function private.payment_transaction_is_test(p_txn public.payment_transactions) returns boolean
language sql stable security definer set search_path to '' as $$
  select coalesce((select p.is_test from public.profiles p where p.id = private.resolve_payment_payer(p_txn)), false)
      or exists (select 1 from auth.users u join public.profiles p on p.id = u.id
                  where p.is_test and lower(u.email) = lower(coalesce(p_txn.raw_payload #>> '{data,customer,email}', p_txn.raw_payload #>> '{data,object,customer_email}')));
$$;
revoke all on function private.payment_transaction_is_test(public.payment_transactions) from public, anon, authenticated;

create or replace function private.stamp_payment_transaction_is_test() returns trigger
language plpgsql security definer set search_path to '' as $$
begin
  new.is_test := coalesce(new.is_test, false) or private.payment_transaction_is_test(new);
  return new;
end $$;
revoke all on function private.stamp_payment_transaction_is_test() from public, anon, authenticated;
drop trigger if exists payment_transactions_00_stamp_is_test on public.payment_transactions;
-- INSERT and the enrichment UPDATE both: the webhook inserts a bare charge first and only later writes subscription_id /
-- booking_order_id / processed_at (finance_post_from_payment's own header says so), and a payer that resolves only through
-- those columns must still be caught before that UPDATE's AFTER triggers post the ledger entry.
create trigger payment_transactions_00_stamp_is_test
  before insert or update of subscription_id, subscription_add_on_id, booking_order_id, booking_order_type, processed_at, raw_payload
  on public.payment_transactions
  for each row execute function private.stamp_payment_transaction_is_test();

update public.payment_transactions pt set is_test = true where not pt.is_test and private.payment_transaction_is_test(pt);

-- ---------------------------------------------------------------------------
-- 1b. revenue_recognition_schedules.is_test — stamped from the schedule's source while that source still exists
-- ---------------------------------------------------------------------------
alter table public.revenue_recognition_schedules add column if not exists is_test boolean not null default false;
comment on column public.revenue_recognition_schedules.is_test is 'True when the order, service purchase or payment this schedule drips into revenue belongs to a test account. Stamped at insert so a purged test patient cannot leave a schedule that posts real revenue.';

create or replace function private.revrec_source_is_test(p_source_kind text, p_source_id uuid, p_payment_transaction_id uuid) returns boolean
language sql stable security definer set search_path to '' as $$
  select coalesce(
    case p_source_kind
      when 'order' then (select o.is_test or exists (select 1 from public.profiles p where p.id in (o.buyer_profile_id, o.beneficiary_patient_id) and p.is_test)
                           from public.orders o where o.id = p_source_id)
      when 'service_purchase' then (select exists (select 1 from public.profiles p where p.id in (sp.patient_id, sp.purchaser_profile_id) and p.is_test)
                           from public.service_purchases sp where sp.id = p_source_id)
      else null end,
    (select pt.is_test from public.payment_transactions pt where pt.id = p_payment_transaction_id),
    false);
$$;
revoke all on function private.revrec_source_is_test(text, uuid, uuid) from public, anon, authenticated;

create or replace function private.stamp_revrec_schedule_is_test() returns trigger
language plpgsql security definer set search_path to '' as $$
begin
  new.is_test := coalesce(new.is_test, false) or private.revrec_source_is_test(new.source_kind::text, new.source_id, new.payment_transaction_id);
  return new;
end $$;
revoke all on function private.stamp_revrec_schedule_is_test() from public, anon, authenticated;
drop trigger if exists revrec_00_stamp_is_test on public.revenue_recognition_schedules;
create trigger revrec_00_stamp_is_test before insert on public.revenue_recognition_schedules
  for each row execute function private.stamp_revrec_schedule_is_test();

update public.revenue_recognition_schedules s set is_test = true
 where not s.is_test and private.revrec_source_is_test(s.source_kind::text, s.source_id, s.payment_transaction_id);

-- ---------------------------------------------------------------------------
-- 1c. finance_journal_entries.is_test — stamped from source + source_ref (every poster goes through finance_post_journal)
-- ---------------------------------------------------------------------------
alter table public.finance_journal_entries add column if not exists is_test boolean not null default false;
comment on column public.finance_journal_entries.is_test is 'True when the entry records test money (its order, payment, refund, schedule, parent entry or author is a test account). Stamped by trigger. Posted entries are never deleted; the finance console reads analytics_clean.finance_journal_* which excludes these.';

create or replace function private.finance_source_is_test(p_source text, p_source_ref text, p_created_by uuid) returns boolean
language plpgsql stable security definer set search_path to '' as $$
declare
  v_kind text; v_id text; v_uuid uuid;
  c_uuid constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
  if p_source = 'platform_credit' then return true; end if;   -- retired feature; every live entry was an E2E run (S01b)
  if p_source_ref is not null then
    if p_source_ref ~ c_uuid then
      v_kind := 'payment_transaction'; v_id := p_source_ref;
    else
      v_kind := split_part(p_source_ref, ':', 1); v_id := split_part(p_source_ref, ':', 2);
    end if;
    if v_id ~ c_uuid then
      v_uuid := v_id::uuid;
      case v_kind
        when 'payment_transaction' then
          if coalesce((select pt.is_test from public.payment_transactions pt where pt.id = v_uuid), false) then return true; end if;
        when 'order' then
          if coalesce((select o.is_test or exists (select 1 from public.profiles p where p.id in (o.buyer_profile_id, o.beneficiary_patient_id) and p.is_test)
                         from public.orders o where o.id = v_uuid), false) then return true; end if;
        when 'orderpart' then
          if coalesce((select pay.is_test from public.payments pay where pay.id = v_uuid), false) then return true; end if;
        when 'reversal', 'correction' then
          if coalesce((select e.is_test from public.finance_journal_entries e where e.id = v_uuid), false) then return true; end if;
        when 'refund_deferred_release', 'refund' then
          if coalesce((select r.is_test from public.refunds r where r.id = v_uuid), false) then return true; end if;
        when 'revrec' then
          if coalesce((select s.is_test from public.revenue_recognition_schedules s where s.id = v_uuid), false) then return true; end if;
        else null;
      end case;
    end if;
  end if;
  return coalesce((select p.is_test from public.profiles p where p.id = p_created_by), false);
end $$;
revoke all on function private.finance_source_is_test(text, text, uuid) from public, anon, authenticated;

create or replace function private.stamp_finance_entry_is_test() returns trigger
language plpgsql security definer set search_path to '' as $$
begin
  if tg_op = 'UPDATE' then
    -- finance_reverse_entry links the reversal to its parent after the insert: a reversal of a test entry is a test entry
    if new.reversal_of is not null and old.reversal_of is null then
      new.is_test := new.is_test or coalesce((select e.is_test from public.finance_journal_entries e where e.id = new.reversal_of), false);
    end if;
    return new;
  end if;
  new.is_test := coalesce(new.is_test, false) or private.finance_source_is_test(new.source, new.source_ref, new.created_by);
  return new;
end $$;
revoke all on function private.stamp_finance_entry_is_test() from public, anon, authenticated;
drop trigger if exists finance_journal_entries_00_stamp_is_test on public.finance_journal_entries;
create trigger finance_journal_entries_00_stamp_is_test before insert or update of reversal_of on public.finance_journal_entries
  for each row execute function private.stamp_finance_entry_is_test();

-- Backfill in entry order so a reversal sees its parent's flag; two passes because a correction can reference a later entry.
do $$
declare r record; v_pass int;
begin
  for v_pass in 1..2 loop
    for r in select id, source, source_ref, created_by, reversal_of from public.finance_journal_entries where not is_test order by entry_no loop
      if private.finance_source_is_test(r.source, r.source_ref, r.created_by)
         or coalesce((select e.is_test from public.finance_journal_entries e where e.id = r.reversal_of), false) then
        update public.finance_journal_entries set is_test = true where id = r.id;
      end if;
    end loop;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 2. analytics_clean views for the ledger, a tighter payment_transactions view, and the finance readers re-pointed
-- ---------------------------------------------------------------------------
insert into private.analytics_clean_view_sources (view_name, source_rel, definition) values
  ('finance_journal_entries', 'public.finance_journal_entries', $def$
  select t.* from public.finance_journal_entries t where not t.is_test$def$),
  ('finance_journal_lines', 'public.finance_journal_lines', $def$
  select t.* from public.finance_journal_lines t where not exists (select 1 from public.finance_journal_entries e where e.id = t.entry_id and e.is_test)$def$)
  on conflict (view_name) do update set source_rel = excluded.source_rel, definition = excluded.definition;

update private.analytics_clean_view_sources
   set definition = replace(definition, 'from public.payment_transactions t where ', 'from public.payment_transactions t where not t.is_test and ')
 where view_name = 'payment_transactions' and definition not like '%not t.is_test%';

select private.rebuild_analytics_clean_views();

do $$
declare
  f record; v_def text; v_new text; v_name text;
  -- readers only: every writer (finance_post_manual_journal, finance_reverse_journal, finance_approve_request, the private
  -- posters) keeps writing to the base tables. finance_unified_ledger keeps public.payment_transactions because it passes
  -- the row to private.resolve_payment_payer(payment_transactions); its entries side is filtered, which is what hides test money.
  -- finance_pending_approvals / finance_approval_history are a work queue, not a total: an approval request on a test entry
  -- must stay visible so it can be decided, so they keep reading the base tables.
  v_readers text[] := array['finance_trial_balance','finance_income_statement','finance_balance_sheet','finance_dashboard_summary',
    'finance_kpi_summary','finance_ledger_entries','finance_unified_ledger','finance_cash_flow_statement','finance_pnl_by_cost_center',
    'finance_budget_variance','finance_revenue_by_funding_source','finance_tax_summary','finance_compliance_suggested_amount',
    'finance_reconciliation_summary','finance_risk_flags'];
  v_pt_readers text[] := array['finance_dashboard_summary','finance_reconciliation_summary','finance_risk_flags'];
begin
  foreach v_name in array v_readers loop
    if not exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = v_name) then
      raise exception 'test-data migration: expected finance reader public.% does not exist', v_name;
    end if;
  end loop;
  for f in select p.oid, p.proname from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = any (v_readers) loop
    v_def := pg_get_functiondef(f.oid);
    v_new := replace(v_def, 'public.finance_journal_entries', 'analytics_clean.finance_journal_entries');
    v_new := replace(v_new, 'public.finance_journal_lines', 'analytics_clean.finance_journal_lines');
    if f.proname = any (v_pt_readers) then
      v_new := replace(v_new, 'public.payment_transactions', 'analytics_clean.payment_transactions');
    end if;
    if v_new = v_def then raise exception 'test-data migration: % reads none of the expected relations; refusing to leave it unfiltered', f.proname; end if;
    execute v_new;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Automatic clean-up of disposable test accounts
-- ---------------------------------------------------------------------------
alter table public.profiles add column if not exists test_keep_reason text;
comment on column public.profiles.test_keep_reason is 'Why an is_test account must survive the nightly purge (App Store review account, chain canary). Null on a test account means it is purged 7 days after creation. Admin or service context only.';
select private.rebuild_analytics_clean_views();   -- analytics_clean.profiles freezes its column list; pick the new column up

create or replace function private.guard_test_keep_reason() returns trigger
language plpgsql security definer set search_path to '' as $$
begin
  if new.test_keep_reason is distinct from old.test_keep_reason
     and not ((select auth.uid()) is null or private.is_admin()) then
    raise exception 'profiles.test_keep_reason can only be changed by an admin or a service context' using errcode = '42501';
  end if;
  if new.test_keep_reason is not null and not new.is_test then
    raise exception 'test_keep_reason only applies to a test account' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function private.guard_test_keep_reason() from public, anon, authenticated;
drop trigger if exists profiles_guard_test_keep_reason on public.profiles;
create trigger profiles_guard_test_keep_reason before update of test_keep_reason, is_test on public.profiles
  for each row execute function private.guard_test_keep_reason();

create or replace function private.purge_stale_test_accounts(p_grace interval default interval '7 days') returns jsonb
language plpgsql security definer set search_path to '' as $$
declare
  v_candidates jsonb; r jsonb; v_id uuid; v_purged uuid[] := '{}'; v_failed jsonb := '[]'::jsonb; v_kept int := 0;
begin
  if not pg_try_advisory_xact_lock(hashtext('purge_stale_test_accounts')) then return jsonb_build_object('skipped', 'busy'); end if;
  select count(*) into v_kept from public.profiles p where p.is_test and (p.test_keep_reason is not null or p.created_at >= now() - p_grace);
  -- Materialised first, not a FOR ... IN SELECT cursor: purge_test_account disables and re-enables triggers on profiles,
  -- and ALTER TABLE refuses while this function still holds an open cursor on the same table.
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'role', p.role) order by p.created_at), '[]'::jsonb) into v_candidates
    from public.profiles p
   where p.is_test
     and p.test_keep_reason is null
     and p.created_at < now() - p_grace
     -- the synthetic canary organisation is never purged, whatever its rows say: the clinical chain canary needs its people
     and not exists (select 1 from public.organisations o where o.id = p.organisation_id and coalesce(o.metadata->>'canary', 'false') = 'true');
  for r in select * from jsonb_array_elements(v_candidates) loop
    v_id := (r->>'id')::uuid;
    begin
      perform public.purge_test_account(v_id);
      v_purged := v_purged || v_id;
    exception when others then
      v_failed := v_failed || jsonb_build_object('profile', v_id, 'role', r->>'role', 'error', sqlerrm);
    end;
  end loop;
  if jsonb_array_length(v_failed) > 0 then
    perform private.ops_alert_incident('test_account_purge:failed', 'Nightly test-account purge could not remove ' || jsonb_array_length(v_failed) || ' account(s)',
      'private.purge_stale_test_accounts() failed for: ' || v_failed::text || '. A real patient''s row may still reference the test account; look at the error and remove the reference, or give the account a test_keep_reason.', 'sev4');
  end if;
  perform private.log_audit('test_account_auto_purge', 'organisation', '00000000-0000-0000-0000-000000000001'::uuid,
    jsonb_build_object('purged', to_jsonb(v_purged), 'failed', v_failed, 'kept', v_kept, 'grace', p_grace::text));
  return jsonb_build_object('purged', to_jsonb(v_purged), 'failed', v_failed, 'kept', v_kept);
end $$;
revoke all on function private.purge_stale_test_accounts(interval) from public, anon, authenticated;
comment on function private.purge_stale_test_accounts(interval) is 'Nightly: purge_test_account() for every is_test profile older than the grace with no test_keep_reason, never the canary organisation. One ops incident per failed night, the others continue.';

select cron.unschedule(jobid) from cron.job where jobname = 'purge-stale-test-accounts';
select cron.schedule('purge-stale-test-accounts', '25 4 * * *', $$ select private.purge_stale_test_accounts(); $$);

-- Accounts that must survive: App Store review (docs/APP_STORE_SUBMISSION.md) and the chain canary's people.
update public.profiles p set test_keep_reason = 'App Store / Play Store review account (docs/APP_STORE_SUBMISSION.md)'
 where p.is_test and p.test_keep_reason is null
   and exists (select 1 from auth.users u where u.id = p.id and u.email in ('apple.reviewer@tarragon.test', 'appreview.demo@tarragon.test'));
update public.profiles p set test_keep_reason = 'Clinical chain canary (synthetic organisation, P1)'
 where p.is_test and p.test_keep_reason is null
   and exists (select 1 from public.organisations o where o.id = p.organisation_id and coalesce(o.metadata->>'canary', 'false') = 'true');

-- ---------------------------------------------------------------------------
-- Self-check
-- ---------------------------------------------------------------------------
do $$
declare v_def text;
begin
  if (select count(*) from public.finance_journal_entries where not is_test and source = 'platform_credit') > 0 then
    raise exception 'self-check: a platform_credit entry is still unmarked'; end if;
  if (select count(*) from public.finance_journal_entries e where not e.is_test and e.source_ref ~ '^[0-9a-f-]{36}$'
        and exists (select 1 from public.payment_transactions pt where pt.id::text = e.source_ref and pt.is_test)) > 0 then
    raise exception 'self-check: a test payment entry is still unmarked'; end if;
  if not exists (select 1 from pg_views where schemaname = 'analytics_clean' and viewname in ('finance_journal_entries', 'finance_journal_lines')) then
    raise exception 'self-check: ledger views missing'; end if;
  v_def := pg_get_functiondef('public.finance_trial_balance'::regproc);
  if v_def like '%public.finance_journal_%' or v_def not like '%analytics_clean.finance_journal_%' then
    raise exception 'self-check: finance_trial_balance still reads the base ledger'; end if;
  if (select count(*) from cron.job where jobname = 'purge-stale-test-accounts') <> 1 then raise exception 'self-check: purge job not scheduled'; end if;
  if has_function_privilege('anon', 'private.purge_stale_test_accounts(interval)', 'EXECUTE') then raise exception 'self-check: anon can execute the purge'; end if;
  if has_function_privilege('authenticated', 'private.purge_stale_test_accounts(interval)', 'EXECUTE') then raise exception 'self-check: authenticated can execute the purge'; end if;
end $$;
