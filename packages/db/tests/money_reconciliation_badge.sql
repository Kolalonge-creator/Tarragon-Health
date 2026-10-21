-- Money reconciliation badge proof (migration *_money_reconciliation_badge_snapshot.sql).
-- One rolled-back transaction. Proves: the refresh stores the count of non-test mismatches and a time; a finance user reads it through
-- the badge function; a fresh snapshot is returned; a snapshot older than three hours or a missing one is REFUSED (never an old number);
-- a patient and a signed-out caller are refused; clients cannot read the table. SABOTAGE: the staleness check removed (an old count is
-- served), and the finance gate removed (a patient is let in). Each must flip.
begin;
create temp table results(check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;
create function pg_temp.try_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
  begin execute p_sql into r; exception when others then r := sqlstate; end;
  reset role; perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.role', '', true);
  return r;
end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'mrb-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'MRB ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true;
  return v;
end $f$;

create function pg_temp.run_checks(p_phase text) returns void language plpgsql as
$f$
declare v_org uuid; v_fin uuid; v_pat uuid; v_n bigint;
begin
  select id into v_org from public.organisations limit 1;
  v_fin := pg_temp.mkuser(v_org, 'finance', 'finance'); v_pat := pg_temp.mkuser(v_org, 'patient', 'patient');
  v_n := private.money_reconciliation_snapshot_refresh();
  insert into results values (p_phase || ': refresh stores the detector count', v_n::text, (select mismatch_count::text from public.money_reconciliation_snapshot));
  insert into results values (p_phase || ': finance reads a fresh snapshot', v_n::text, pg_temp.try_as(v_fin, 'select public.money_reconciliation_badge()::text'));
  update public.money_reconciliation_snapshot set computed_at = now() - interval '4 hours';
  insert into results values (p_phase || ': a snapshot older than three hours is refused', 'P0001', pg_temp.try_as(v_fin, 'select public.money_reconciliation_badge()::text'));
  delete from public.money_reconciliation_snapshot;
  insert into results values (p_phase || ': a missing snapshot is refused', 'P0001', pg_temp.try_as(v_fin, 'select public.money_reconciliation_badge()::text'));
  perform private.money_reconciliation_snapshot_refresh();
  insert into results values (p_phase || ': a patient is refused', '42501', pg_temp.try_as(v_pat, 'select public.money_reconciliation_badge()::text'));
  insert into results values (p_phase || ': finance cannot read the table', '42501', pg_temp.try_as(v_fin, 'select count(*)::text from public.money_reconciliation_snapshot'));
end $f$;

select pg_temp.run_checks('real');
insert into results values ('real: anon cannot call the badge', 'false', has_function_privilege('anon', 'public.money_reconciliation_badge()', 'EXECUTE')::text);
insert into results values ('real: the hourly job is scheduled', '1', (select count(*)::text from cron.job where jobname = 'money-reconciliation-snapshot'));

do $$
declare v_flipped integer;
begin
  create or replace function public.money_reconciliation_badge() returns bigint language plpgsql stable security definer set search_path = '' as $f$
  begin return (select mismatch_count from public.money_reconciliation_snapshot); end $f$;
  perform pg_temp.run_checks('sab');
  select count(*) into v_flipped from results r where r.check_name like 'sab:%'
    and exists (select 1 from results x where x.check_name = 'real:' || substr(r.check_name, 5) and x.expected = r.expected) and r.expected is distinct from r.actual;
  if v_flipped < 3 then raise exception 'VACUOUS TEST: the sabotage flipped only % checks', v_flipped; end if;
end $$;

do $$
declare v_bad integer;
begin
  select count(*) into v_bad from results where check_name like 'real:%' and expected is distinct from actual;
  if v_bad > 0 then raise exception 'Money reconciliation badge proof FAILED: %', (select string_agg(check_name || ' expected ' || coalesce(expected,'null') || ' got ' || coalesce(actual,'null'), '; ') from results where check_name like 'real:%' and expected is distinct from actual); end if;
end $$;
select check_name, expected, actual, case when expected is not distinct from actual then 'PASS' else 'FAIL' end result from results where check_name like 'real:%' order by 1;
rollback;
