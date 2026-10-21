-- Money reconciliation daily alert proof (migration *_money_reconciliation_daily_alert.sql).
-- One rolled-back transaction. Proves:
--   1. A real (non-test) mismatch opens exactly ONE ops incident for its organisation, naming the kind and pointing at the screen.
--   2. Running it again (same day or next day) opens no second incident while one is open; the open one is refreshed, not duplicated.
--   3. A mismatch on a TEST order opens nothing (checked only when no other real mismatch exists in the database).
--   4. The scan changes no money: no order, payment, refund, journal or ledger row is written or altered by running it.
--   5. Clients cannot run it or read its config; the cron job exists.
--   6. The two "settled by hand" refund messages tell a person to use the reference refund:<id>.
--   7. SABOTAGE: the incident de-duplication removed (two open incidents appear) and the scan emptied (no incident appears). Each must flip.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;
create function pg_temp.f(p text) returns uuid language sql as $$ select v from fx where k = p $$;
create function pg_temp.setf(p text, p_v uuid) returns void language sql as $$ insert into fx values (p, p_v) on conflict (k) do update set v = excluded.v $$;

create function pg_temp.open_incidents(p_org uuid) returns text language sql as
$$ select count(*)::text from public.ops_incidents where external_reference = 'money-reconciliation-daily:' || p_org and status not in ('resolved', 'closed') $$;
create function pg_temp.money_fingerprint() returns text language sql as
$$ select concat_ws('|', (select count(*) from public.orders), (select coalesce(sum(amount_kobo), 0) from public.orders),
     (select count(*) from public.payments), (select count(*) from public.refunds), (select count(*) from public.finance_journal_entries),
     (select count(*) from public.earnings_ledger)) $$;

do $$
declare v_org uuid; v_pat uuid := gen_random_uuid(); v_item uuid := gen_random_uuid(); v_price uuid := gen_random_uuid(); o uuid := gen_random_uuid(); v_ref text;
begin
  set local session_replication_role = replica;
  select id into v_org from public.organisations limit 1;
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v_pat, 'mrda-' || v_pat || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v_pat, v_org, 'patient', 'MRDA patient', '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true);
  v_ref := 'tho_mrda_' || replace(o::text, '-', '');
  -- a paid, non-test order with no entitlement: kind paid_order_no_entitlement
  insert into public.orders (id, organisation_id, buyer_profile_id, beneficiary_patient_id, catalog_item_id, price_id, amount_kobo, fee_kobo, total_kobo, state, paid_at, paystack_reference, is_test)
  values (o, v_org, v_pat, v_pat, v_item, v_price, 500000, 0, 500000, 'paid', now() - interval '2 days', v_ref, false);
  insert into public.payments (organisation_id, order_id, provider, provider_reference, amount_kobo, fee_kobo, total_kobo, status, source, is_test)
  values (v_org, o, 'paystack', v_ref, 500000, 0, 500000, 'success', 'return', false);
  insert into public.finance_journal_entries (entry_date, period_month, source, source_ref, memo) values (current_date, date_trunc('month', current_date)::date, 'payment', 'order:' || o, 'mrda');
  perform pg_temp.setf('org', v_org); perform pg_temp.setf('order', o);
  delete from public.ops_incidents where external_reference = 'money-reconciliation-daily:' || v_org;
end $$;

create function pg_temp.run_checks(p_phase text) returns void language plpgsql as
$f$
declare v_org uuid := pg_temp.f('org'); v_before text; v_after text; v_other integer;
begin
  delete from public.ops_incidents where external_reference = 'money-reconciliation-daily:' || v_org;
  v_before := pg_temp.money_fingerprint();
  perform private.money_reconciliation_daily_check();
  insert into results values (p_phase, 'a real mismatch opens one incident', '1', pg_temp.open_incidents(v_org));
  insert into results values (p_phase, 'the incident names the kind and the screen', 'true',
    (select (summary like '%paid_order_no_entitlement%' and summary like '%/finance/money-reconciliation%')::text from public.ops_incidents
      where external_reference = 'money-reconciliation-daily:' || v_org and status not in ('resolved', 'closed') limit 1));
  perform private.money_reconciliation_daily_check();
  perform private.money_reconciliation_daily_check();
  insert into results values (p_phase, 'repeat runs open no second incident', '1', pg_temp.open_incidents(v_org));
  v_after := pg_temp.money_fingerprint();
  insert into results values (p_phase, 'the scan changes no money', v_before, v_after);

  -- test-only: the same order marked as a test order opens nothing (only when no OTHER real mismatch exists)
  update public.orders set is_test = true where id = pg_temp.f('order');
  update public.payments set is_test = true where order_id = pg_temp.f('order');
  delete from public.ops_incidents where external_reference = 'money-reconciliation-daily:' || v_org;
  select count(*) into v_other from private.money_mismatches(false, 1440, 15) m where m.organisation_id is not distinct from v_org;
  perform private.money_reconciliation_daily_check();
  insert into results values (p_phase, 'a test-order mismatch opens nothing', case when v_other = 0 then '0' else 'n/a' end,
    case when v_other = 0 then pg_temp.open_incidents(v_org) else 'n/a' end);
  update public.orders set is_test = false where id = pg_temp.f('order');
  update public.payments set is_test = false where order_id = pg_temp.f('order');
end $f$;

select pg_temp.run_checks('real');

insert into results values ('real', 'anon cannot run the scan', 'false', has_function_privilege('anon', 'private.money_reconciliation_daily_check()', 'EXECUTE')::text);
insert into results values ('real', 'authenticated cannot run the scan', 'false', has_function_privilege('authenticated', 'private.money_reconciliation_daily_check()', 'EXECUTE')::text);
insert into results values ('real', 'authenticated cannot read the config', 'false', has_table_privilege('authenticated', 'public.money_reconciliation_alert_config', 'SELECT')::text);
insert into results values ('real', 'the daily job is scheduled', '1', (select count(*)::text from cron.job where jobname = 'money-reconciliation-daily-check'));
insert into results values ('real', 'settle-by-hand text gives the refund reference', 'true',
  (pg_get_functiondef('public.admin_settle_processing_refund(uuid,boolean,text)'::regprocedure) like '%reference refund:%')::text);
insert into results values ('real', 'cash-post-failed text gives the refund reference', 'true',
  (pg_get_functiondef('public.service_refund_incident(uuid,text)'::regprocedure) like '%reference refund:%')::text);

-- SABOTAGE
do $$
declare v_flipped integer;
begin
  -- (a) de-duplication removed: every run opens a new incident
  create or replace function private.order_incident(p_org uuid, p_ref text, p_title text, p_summary text) returns void
  language plpgsql security definer set search_path = '' as $f$
  begin
    insert into public.ops_incidents (organisation_id, category, severity, title, summary, external_reference, ack_due_at, resolve_due_at)
    values (p_org, 'financial', 'sev2', p_title, p_summary, p_ref, now() + interval '4 hours', now() + interval '24 hours');
  end $f$;
  perform pg_temp.run_checks('sabotaged_dedupe');
  -- (b) the scan emptied: nothing is ever raised
  create or replace function private.money_reconciliation_daily_check() returns integer language sql security definer set search_path = '' as $f$ select 0 $f$;
  perform pg_temp.run_checks('sabotaged_empty');
  select count(*) into v_flipped from results r
   where r.phase like 'sabotaged%' and exists (select 1 from results x where x.phase = 'real' and x.check_name = r.check_name and x.expected = r.expected)
     and r.expected is distinct from r.actual;
  if v_flipped < 2 then raise exception 'VACUOUS TEST: the sabotage flipped only % checks', v_flipped; end if;
  if not exists (select 1 from results where phase = 'sabotaged_dedupe' and check_name = 'repeat runs open no second incident' and expected is distinct from actual) then
    raise exception 'VACUOUS TEST: removing de-duplication did not open a second incident';
  end if;
  if not exists (select 1 from results where phase = 'sabotaged_empty' and check_name = 'a real mismatch opens one incident' and expected is distinct from actual) then
    raise exception 'VACUOUS TEST: emptying the scan did not remove the incident';
  end if;
end $$;

do $$
declare v_bad integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'Money reconciliation daily alert proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || coalesce(expected, 'null') || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
end $$;

select phase, check_name, expected, actual, case when expected is not distinct from actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;

rollback;
