-- ===========================================================================
-- Finance picks its dates from the Lagos clock, not the server (UTC) clock.
--
-- Bug: the posting functions dated a journal entry with `current_date`, or with `some_timestamptz::date`, and both read the
-- session time zone, which on this project is UTC. Lagos is UTC+1 all year, so between 23:00 and 24:00 UTC (00:00 to 01:00 in
-- Lagos) a payment, a voucher redemption, a manual journal or a reversal was dated YESTERDAY in Lagos terms. At a month end that
-- puts the entry in the wrong accounting period, and a period that was already closed in Lagos terms can still take it. The
-- platform rule is Africa/Lagos (CLAUDE.md "Phone numbers always E.164. Timezone always Africa/Lagos").
--
-- Fix: private.lagos_today() (it already exists, 20261013004659) for "today", and `(ts at time zone 'Africa/Lagos')::date`
-- for the date of a timestamp. Every body is read from the LIVE definition (pg_get_functiondef), changed with anchored
-- replacements, and the block raises if a replacement does not match exactly the number of places it is expected, so it cannot
-- silently do nothing. Owner, security mode, search path and every grant are untouched (CREATE OR REPLACE keeps them; the block
-- compares each function's ACL and config before and after).
--
-- Parameter DEFAULTS are different. A default is evaluated as the CALLER, and authenticated cannot execute
-- private.lagos_today() on purpose, so a default of private.lagos_today() would fail with "permission denied" for every finance
-- user who leaves the argument out. Defaults use the inline `(now() at time zone 'Africa/Lagos')::date`, which needs no privilege.
--
-- Changed (all SECURITY DEFINER):
--   posting:   private.apply_subsidy_contribution_from_transaction, finance_post_commission, finance_post_from_payment,
--              finance_post_reward_voucher_issued, finance_post_voucher_redeemed, finance_reverse_entry,
--              finance_recognize_revenue (default + note text), public.approve_lab_order_refund, approve_pharmacy_order_refund,
--              finance_pay_bill, finance_post_manual_journal, finance_run_revenue_recognition
--   reports:   public.finance_trial_balance, finance_balance_sheet, finance_ledger_entries, finance_revenue_by_funding_source
--              (defaults), finance_kpi_summary, finance_dashboard_summary, finance_ap_aging, finance_risk_flags,
--              finance_employer_billing_summary, finance_compliance_calendar, finance_compliance_calendar_for_year,
--              finance_unified_ledger (the payment date of a row and the day filter)
--   "effective from today" tax / billing lookups: private.finance_compute_vat, public.get_or_create_invoice,
--              finance_upsert_tax_rate, finance_upsert_employer_billing_config, and the column default of
--              finance_tax_rates.effective_from
--   the monthly revenue-recognition cron job.
-- Not changed on purpose: the four functions that already used the Lagos date (orders_sponsor_effects, payout_post_gl,
-- post_order_to_ledger, post_refund_reversal); `now()` used as an instant (audit time, approved_at); a programme's own
-- starts_at/ends_at, analytics_accounting_summary and sponsor_care_report, which are not ledger dates.
--
-- No data changes. Entries already posted keep the date they were posted with (posted entries are never edited).
-- ===========================================================================

do $$
declare
  r record;
  rule record;
  v_oid oid;
  v_def text;
  v_new text;
  v_acl_before text;
  v_cfg_before text;
  v_secdef_before boolean;
  v_found integer;
  v_changed integer := 0;
  c_lagos constant text := '(now() at time zone ''Africa/Lagos'')::date';
begin
  if to_regprocedure('private.lagos_today()') is null
     or (select regexp_replace(p.prosrc, '[\s;]+', ' ', 'g') from pg_proc p where p.oid = 'private.lagos_today()'::regprocedure)
        not like '%(now() at time zone ''Africa/Lagos'')::date%' then
    raise exception 'finance lagos dates: private.lagos_today() is missing or is not the Lagos date';
  end if;

  for r in
    select sig, jsonb_agg(jsonb_build_array(pat, repl, expected) order by ord) as rules
      from (select row_number() over () ord, * from (values
      ('private.apply_subsidy_contribution_from_transaction()', '\mcurrent_date\M', 'private.lagos_today()', 1),
      ('private.finance_compute_vat(text,bigint)', '\mcurrent_date\M', 'private.lagos_today()', 1),
      ('private.finance_post_commission(uuid)', '\mcurrent_date\M', 'private.lagos_today()', 2),
      ('private.finance_post_commission(uuid)', '\mc\.earned_at::date', '(c.earned_at at time zone ''Africa/Lagos'')::date', 1),
      ('private.finance_post_commission(uuid)', '\mc\.paid_at::date', '(c.paid_at at time zone ''Africa/Lagos'')::date', 1),
      ('private.finance_post_from_payment(uuid)', '\mcurrent_date\M', 'private.lagos_today()', 1),
      ('private.finance_post_from_payment(uuid)', '\mtxn\.processed_at::date', '(txn.processed_at at time zone ''Africa/Lagos'')::date', 1),
      ('private.finance_post_from_payment(uuid)', '\mv_cpe::date', '(v_cpe at time zone ''Africa/Lagos'')::date', 1),
      ('private.finance_post_reward_voucher_issued()', '\mcurrent_date\M', 'private.lagos_today()', 1),
      ('private.finance_post_voucher_redeemed()', '\mcurrent_date\M', 'private.lagos_today()', 3),
      ('private.finance_recognize_revenue(date)', 'DEFAULT CURRENT_DATE', 'DEFAULT (now() at time zone ''Africa/Lagos'')::date', 1),
      ('private.finance_recognize_revenue(date)', 'to_char\(current_date,', 'to_char(private.lagos_today(),', 1),
      ('private.finance_reverse_entry(uuid,text,uuid)', '\mcurrent_date\M', 'private.lagos_today()', 1),
      ('public.approve_lab_order_refund(uuid)', '\mcurrent_date\M', 'private.lagos_today()', 1),
      ('public.approve_pharmacy_order_refund(uuid)', '\mcurrent_date\M', 'private.lagos_today()', 1),
      ('public.finance_ap_aging()', '\mcurrent_date\M', 'private.lagos_today()', 1),
      ('public.finance_balance_sheet(date,text)', 'DEFAULT CURRENT_DATE', 'DEFAULT (now() at time zone ''Africa/Lagos'')::date', 1),
      ('public.finance_trial_balance(date,text)', 'DEFAULT CURRENT_DATE', 'DEFAULT (now() at time zone ''Africa/Lagos'')::date', 1),
      ('public.finance_compliance_calendar(integer)', 'v_today date := current_date;', 'v_today date := private.lagos_today();', 1),
      ('public.finance_compliance_calendar_for_year(integer)', 'v_today date := current_date;', 'v_today date := private.lagos_today();', 1),
      ('public.finance_dashboard_summary()', 'date_trunc\(''year'', now\(\)\)::date', 'date_trunc(''year'', private.lagos_today())::date', 1),
      ('public.finance_dashboard_summary()', 'date_trunc\(''month'', now\(\)\)::date', 'date_trunc(''month'', private.lagos_today())::date', 1),
      ('public.finance_employer_billing_summary()', '\mcurrent_date\M', 'private.lagos_today()', 2),
      ('public.finance_kpi_summary(text)', 'v_today date := current_date;', 'v_today date := private.lagos_today();', 1),
      ('public.finance_ledger_entries(date,date,text,text,integer,integer)', '\mCURRENT_DATE\M', '(now() at time zone ''Africa/Lagos'')::date', 2),
      ('public.finance_pay_bill(uuid,text,date)', '\mcurrent_date\M', 'private.lagos_today()', 1),
      ('public.finance_post_manual_journal(date,text,text,jsonb)', '\mcurrent_date\M', 'private.lagos_today()', 2),
      ('public.finance_revenue_by_funding_source(date,date,text)', '\(CURRENT_DATE\)::timestamp with time zone', '((now() at time zone ''Africa/Lagos'')::date)::timestamp with time zone', 1),
      ('public.finance_revenue_by_funding_source(date,date,text)', 'DEFAULT CURRENT_DATE', 'DEFAULT (now() at time zone ''Africa/Lagos'')::date', 1),
      ('public.finance_risk_flags()', '\mcurrent_date\M', 'private.lagos_today()', 2),
      ('public.finance_run_revenue_recognition()', '\mcurrent_date\M', 'private.lagos_today()', 1),
      ('public.finance_unified_ledger(uuid,uuid,date,date,integer,integer)', '\mpt\.created_at::date', '(pt.created_at at time zone ''Africa/Lagos'')::date', 3),
      ('public.finance_upsert_employer_billing_config(uuid,uuid,bigint,text,date,date,boolean,text)', '\mcurrent_date\M', 'private.lagos_today()', 2),
      ('public.finance_upsert_tax_rate(uuid,text,text,text,numeric,text,date,boolean,text)', '\mcurrent_date\M', 'private.lagos_today()', 2),
      ('public.get_or_create_invoice(text,uuid)', '\mcurrent_date\M', 'private.lagos_today()', 1)
    ) as v(sig, pat, repl, expected)) t group by sig order by min(ord)
  loop
    v_oid := to_regprocedure(r.sig);
    if v_oid is null then
      raise exception 'finance lagos dates: function % not found', r.sig;
    end if;
    select p.proacl::text, p.proconfig::text, p.prosecdef into v_acl_before, v_cfg_before, v_secdef_before
      from pg_proc p where p.oid = v_oid;
    if not v_secdef_before then
      raise exception 'finance lagos dates: % is not SECURITY DEFINER, so it could not call private.lagos_today()', r.sig;
    end if;

    v_def := pg_get_functiondef(v_oid);
    v_new := v_def;
    for rule in select e->>0 as pat, e->>1 as repl, (e->>2)::int as expected
                  from jsonb_array_elements(r.rules) as e
    loop
      -- 'i' for the \mcurrent_date\M rules only: pg_get_functiondef writes the keyword in the case the author used
      select count(*) into v_found from regexp_matches(v_new, rule.pat, 'gi');
      if v_found <> rule.expected then
        raise exception 'finance lagos dates: % expected % match(es) of % but found %', r.sig, rule.expected, rule.pat, v_found;
      end if;
      v_new := regexp_replace(v_new, rule.pat, replace(rule.repl, '\', '\\'), 'gi');
    end loop;
    if v_new = v_def then
      raise exception 'finance lagos dates: nothing changed in %', r.sig;
    end if;

    execute v_new;
    v_changed := v_changed + 1;

    -- nothing but the body changed
    if exists (
      select 1 from pg_proc p
       where p.oid = v_oid
         and (p.proacl::text is distinct from v_acl_before
              or p.proconfig::text is distinct from v_cfg_before
              or p.prosecdef is distinct from v_secdef_before)
    ) then
      raise exception 'finance lagos dates: grants, config or security mode of % changed', r.sig;
    end if;
  end loop;

  if v_changed <> 28 then
    raise exception 'finance lagos dates: expected 28 functions, changed %', v_changed;
  end if;
end $$;

-- the one column default (a direct insert runs it as the inserting role, so it cannot use private.lagos_today())
alter table public.finance_tax_rates
  alter column effective_from set default (now() at time zone 'Africa/Lagos')::date;

-- the monthly recognition job: 03:00 UTC on the 1st is 04:00 in Lagos, the same calendar day either way, so this changes
-- nothing today; it only keeps the job from carrying the UTC date if the schedule ever moves. Skipped where pg_cron is absent
-- (a plain local replay).
do $$
declare v_job bigint;
begin
  if to_regclass('cron.job') is not null then
    select jobid into v_job from cron.job where jobname = 'finance-revenue-recognition-monthly';
    if v_job is not null then
      perform cron.alter_job(v_job, command => 'select private.finance_recognize_revenue(private.lagos_today());');
    end if;
  end if;
end $$;

-- final assertions: no finance function still reads the UTC date, nobody new can reach the helper, anon cannot reach any of this
do $$
declare v_bad text;
begin
  select string_agg(n.nspname || '.' || p.proname, ', ' order by n.nspname, p.proname) into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private')
     and (p.proname like 'finance\_%' or p.proname in ('apply_subsidy_contribution_from_transaction', 'approve_lab_order_refund',
          'approve_pharmacy_order_refund', 'get_or_create_invoice'))
     and pg_get_functiondef(p.oid) ~* '\mcurrent_date\M|current_timestamp\s*::\s*date|now\(\)\s*::\s*date|\m(earned_at|paid_at|processed_at|created_at)::date';
  if v_bad is not null then
    raise exception 'finance lagos dates: still reading the UTC date: %', v_bad;
  end if;
  if has_function_privilege('anon', 'private.lagos_today()', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.lagos_today()', 'EXECUTE') then
    raise exception 'finance lagos dates: lagos_today must not be executable by anon or authenticated';
  end if;
  if has_function_privilege('anon', 'public.finance_post_manual_journal(date,text,text,jsonb)', 'EXECUTE')
     or has_function_privilege('anon', 'public.finance_ledger_entries(date,date,text,text,integer,integer)', 'EXECUTE')
     or has_function_privilege('anon', 'private.finance_reverse_entry(uuid,text,uuid)', 'EXECUTE') then
    raise exception 'finance lagos dates: anon can execute a finance function';
  end if;
end $$;
