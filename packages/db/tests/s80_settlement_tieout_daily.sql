-- S80 gap closure proof (25.6): the daily settlement tie-out, three classes, posted to the finance queue.
--   1. With the guard settlement_tieout_daily OFF the job does nothing and writes no row.
--   2. ON: one matched line, one settled-but-missing-in-ledger line, one paid charge missing at Paystack, one amount difference are counted in the
--      right class; one finance incident is opened and a second run does not stack it; the general ledger is untouched.
--   3. A finance user reads the overview and the exceptions (three class names); a patient and anon are refused; the job is not executable by
--      authenticated or anon.
--   SABOTAGE: (a) every settled line counts as matched, (b) the finance gate on the reader removed; each must flip a check.
-- Not run against any database when written (no local Supabase stack was available); run it on the CI replay stack.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;
create function pg_temp.f(p text) returns uuid language sql as $$ select v from fx where k = p $$;
create function pg_temp.setf(p text, p_v uuid) returns void language sql as
$$ insert into fx values (p, p_v) on conflict (k) do update set v = excluded.v $$;
create function pg_temp.act(p_uid uuid) returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
end $f$;
create function pg_temp.back() returns void language plpgsql as
$f$ begin reset role; perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.role', '', true); end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's80sto-' || p_label || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, is_test)
  values (v, p_org, p_role::public.user_role, 'S80sto ' || p_label, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true;
  return v;
end $f$;
-- a scalar as a user: the text of the value, or 'ERR:sqlstate'
create function pg_temp.val_as(p_uid uuid, p_sql text) returns text language plpgsql as $f$
declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql into r; exception when others then perform pg_temp.back(); return 'ERR:' || sqlstate; end;
  perform pg_temp.back();
  return coalesce(r, 'null');
end $f$;
create function pg_temp.val_anon(p_sql text) returns text language plpgsql as $f$
declare r text;
begin
  set local role anon;
  begin execute p_sql into r; exception when others then reset role; return 'ERR:' || sqlstate; end;
  reset role;
  return coalesce(r, 'null');
end $f$;
create function pg_temp.guard(p_on boolean) returns void language plpgsql as $f$
begin
  set local session_replication_role = replica;
  -- G-01: an open guard is never held (go_live_guards_open_is_not_held), so switching on clears the hold
  update public.go_live_guards set is_on = p_on, changed_at = case when p_on then now() end, changed_by = case when p_on then pg_temp.f('admin') end,
         change_note = case when p_on then 'S80 proof run' end, held_reason = case when p_on then null else held_reason end where key = 'settlement_tieout_daily';
  set local session_replication_role = origin;
end $f$;

do $$
declare v_org uuid; v_admin uuid; v_fin uuid; v_pat uuid; v_rep uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  if v_org is null then raise exception 'no organisation: the proof needs seed.sql'; end if;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  v_fin := pg_temp.mkuser(v_org, 'fin', 'finance');
  v_pat := pg_temp.mkuser(v_org, 'pat', 'patient');
  perform pg_temp.setf('admin', v_admin); perform pg_temp.setf('fin', v_fin); perform pg_temp.setf('pat', v_pat);

  set local session_replication_role = replica;
  insert into public.payment_transactions (provider, provider_event_id, event_type, amount_minor, currency, raw_payload)
  values ('paystack', 's80sto-a', 'charge.success', 500000, 'NGN', '{}'), ('paystack', 's80sto-b', 'charge.success', 700000, 'NGN', '{}');
  insert into public.payments (organisation_id, order_id, provider_reference, amount_kobo, fee_kobo, total_kobo, status, source, verified_at, is_test)
  values (v_org, gen_random_uuid(), 's80sto-c', 900000, 0, 900000, 'success', 'webhook', now() - interval '100 hours', false);
  set local session_replication_role = origin;

  -- a settlement from yesterday (Lagos): a matches, b differs by amount, x is not in our ledger. Total = sum of lines so no total break.
  v_rep := public.record_settlement_report('s80sto-set-1', 'success', 1250000, 20000, now() - interval '1 day',
    '[{"reference":"s80sto-a","amount_kobo":500000,"fees_kobo":7500,"status":"success"},
      {"reference":"s80sto-b","amount_kobo":650000,"fees_kobo":9000,"status":"success"},
      {"reference":"s80sto-x","amount_kobo":100000,"fees_kobo":1500,"status":"success"}]'::jsonb, true);
  perform public.reconcile_settlement_report(v_rep);
end $$;

-- 1. guard off
select pg_temp.guard(false);
insert into results values ('real', 'guard off: the job returns nothing', 'null', coalesce(private.settlement_tieout_run()::text, 'null'));
insert into results values ('real', 'guard off: no day row is written', '0', (select count(*)::text from public.settlement_tieout_days));

-- 2. guard on
select pg_temp.guard(true);
select private.settlement_tieout_run();
insert into results values ('real', 'one matched line, 500000 kobo', '1|500000',
  (select matched_count || '|' || matched_kobo from public.settlement_tieout_days where settlement_date = (now() at time zone 'Africa/Lagos')::date - 1));
insert into results values ('real', 'one settled line missing in our ledger, 100000 kobo', '1|100000',
  (select missing_in_ledger_count || '|' || missing_in_ledger_kobo from public.settlement_tieout_days where settlement_date = (now() at time zone 'Africa/Lagos')::date - 1));
insert into results values ('real', 'one paid charge missing at Paystack, 900000 kobo', '1|900000',
  (select missing_at_paystack_count || '|' || missing_at_paystack_kobo from public.settlement_tieout_days where settlement_date = (now() at time zone 'Africa/Lagos')::date - 1));
insert into results values ('real', 'an amount difference is counted as other, not as matched', '1',
  (select other_break_count::text from public.settlement_tieout_days where settlement_date = (now() at time zone 'Africa/Lagos')::date - 1));
insert into results values ('real', 'one finance incident is open for the day', '1',
  (select count(*)::text from public.ops_incidents where external_reference = 'settlement-tieout:' || ((now() at time zone 'Africa/Lagos')::date - 1) and status not in ('resolved', 'closed')));
select private.settlement_tieout_run();
insert into results values ('real', 'a second run does not stack the incident or the day row', '1|1',
  (select count(*)::text from public.ops_incidents where external_reference = 'settlement-tieout:' || ((now() at time zone 'Africa/Lagos')::date - 1))
  || '|' || (select count(*)::text from public.settlement_tieout_days where settlement_date = (now() at time zone 'Africa/Lagos')::date - 1));
insert into results values ('real', 'the tie-out posts nothing to the general ledger', '0',
  (select count(*)::text from public.finance_journal_entries where source_ref like 's80sto-%'));

-- 3. who can read
insert into results values ('real', 'finance reads the overview', '1', pg_temp.val_as(pg_temp.f('fin'), $q$select count(*)::text from public.settlement_tieout_overview(30) where settlement_date = (now() at time zone 'Africa/Lagos')::date - 1$q$));
insert into results values ('real', 'finance sees the three class names among the exceptions', 'missing_at_paystack,missing_in_ledger,other',
  pg_temp.val_as(pg_temp.f('fin'), $q$select string_agg(distinct tieout_class, ',' order by tieout_class) from public.settlement_tieout_exceptions() where provider_reference like 's80sto-%'$q$));
insert into results values ('real', 'a patient is refused the overview', 'ERR:42501', pg_temp.val_as(pg_temp.f('pat'), $q$select count(*)::text from public.settlement_tieout_overview(30)$q$));
insert into results values ('real', 'a patient is refused the exceptions', 'ERR:42501', pg_temp.val_as(pg_temp.f('pat'), $q$select count(*)::text from public.settlement_tieout_exceptions()$q$));
insert into results values ('real', 'anon is refused the overview', 'ERR:42501', pg_temp.val_anon($q$select count(*)::text from public.settlement_tieout_overview(30)$q$));
insert into results values ('real', 'finance cannot run the job', 'ERR:42501', pg_temp.val_as(pg_temp.f('fin'), $q$select private.settlement_tieout_run()::text$q$));
insert into results values ('real', 'finance cannot write a day row', 'ERR:42501', pg_temp.val_as(pg_temp.f('fin'), $q$insert into public.settlement_tieout_days (settlement_date, matched_count, matched_kobo, missing_in_ledger_count, missing_in_ledger_kobo, missing_at_paystack_count, missing_at_paystack_kobo, other_break_count) values (current_date - 400, 1, 1, 0, 0, 0, 0, 0) returning '1'$q$));

-- SABOTAGE (a): every settled line counts as matched
do $$
declare v_orig text; v_def text;
begin
  v_orig := pg_get_functiondef('private.settlement_tieout_run(date)'::regprocedure);
  v_def := replace(v_orig, 'count(*) filter (where x.lg is not null and x.lg = l.amount_kobo)', 'count(*)');
  if v_def = v_orig then raise exception 'SABOTAGE (a) not applied'; end if;
  execute v_def;
  perform private.settlement_tieout_run();
  insert into results values ('sabotaged', 'with every line counted as matched the matched count is 3', '1',
    (select matched_count::text from public.settlement_tieout_days where settlement_date = (now() at time zone 'Africa/Lagos')::date - 1));
  execute v_orig;
end $$;

-- SABOTAGE (b): the finance gate on the reader removed
do $$
declare v_orig text; v_def text;
begin
  v_orig := pg_get_functiondef('public.settlement_tieout_overview(integer)'::regprocedure);
  v_def := replace(v_orig, 'or not private.is_finance()', 'or false');
  if v_def = v_orig then raise exception 'SABOTAGE (b) not applied'; end if;
  execute v_def;
  insert into results values ('sabotaged', 'with the gate removed a patient reads the overview', 'ERR:42501', pg_temp.val_as(pg_temp.f('pat'), $q$select count(*)::text from public.settlement_tieout_overview(30)$q$));
  execute v_orig;
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S80 settlement tie-out proof FAILED: %', (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 2 then raise exception 'VACUOUS TEST: only % of 2 sabotages flipped a check', v_caught; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result from results where phase = 'real' order by check_name;
rollback;
