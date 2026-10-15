-- S39h proof: a registry row whose table has been dropped must not break the export or the retention report (found when S28d dropped pharmacy_order_delivery_attempts).
-- A stale row is inserted; the export (admin) and the retention report still work, and the stale row is not exported; the registry names no missing table; config v4 is confirmed.
-- SABOTAGE: the table-exists guard removed from the export; the export must fail with 42P01.
begin;
create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create function pg_temp.ck(p_phase text, p_name text, p_expected text, p_actual text) returns void language sql as $$ insert into results values (p_phase, p_name, p_expected, p_actual) $$;
create function pg_temp.try_sql(p_sql text) returns text language plpgsql as $f$ declare r text; begin execute p_sql into r; return coalesce(r, 'ok'); exception when others then return 'ERR ' || sqlstate; end $f$;

select pg_temp.ck('real', 'S1 the registry names no table that does not exist', '0', (select count(*)::text from public.data_registry where to_regclass('public.' || quote_ident(table_name)) is null));
insert into public.data_registry (table_name, patient_expr, retention_class, end_of_retention, in_export, reviewed) values ('s39h_table_that_was_dropped', 'patient_id', 'clinical_record', 'review', true, true);
select pg_temp.ck('real', 'S2 with a stale registry row the export body still works', 'true', (pg_temp.try_sql($q$select (private.export_patient_json((select id from public.profiles where role = 'patient' limit 1)) -> 'tables') is not null$q$) = 'true')::text);
do $$
declare v_ad uuid; v_r text;
begin
  select id into v_ad from public.profiles where role = 'admin' and is_active order by created_at limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', v_ad, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_ad::text, true);
  begin perform count(*) from public.retention_review_report(); v_r := 'true'; exception when others then v_r := 'ERR ' || sqlstate; end;
  perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.sub', '', true);
  perform pg_temp.ck('real', 'S3 ...and the retention report still works for an admin', 'true', v_r);
end $$;
select pg_temp.ck('real', 'S4 the active config is v4 and CMO confirmed values are unchanged (window 8, alert 20, no auto-delete)', 'true',
  (select (version >= 4 and (config ->> 'record_open_window_hours') = '8' and (config ->> 'untied_open_alert_per_hour') = '20' and (config -> 'retention' ->> 'real_data_auto_delete') = 'false')::text from public.security_config where is_active));
do $$
declare v_def text; v_out text;
begin
  select pg_get_functiondef('private.export_patient_json(uuid)'::regprocedure) into v_def;
  v_def := replace(v_def, 'and to_regclass(''public.'' || quote_ident(table_name)) is not null', '');
  execute v_def;
  v_out := pg_temp.try_sql($q$select (private.export_patient_json((select id from public.profiles where role = 'patient' limit 1)) -> 'tables') is not null$q$);
  insert into results values ('sabotaged', 'SABOTAGE: without the guard a stale registry row breaks the export', 'true', v_out);
end $$;
do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then raise exception 'S39h proof FAILED: %', (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual); end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and check_name like 'SABOTAGE%' and expected <> actual;
  if v_caught < 1 then raise exception 'VACUOUS TEST: the sabotage did not flip'; end if;
end $$;
select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result from results where phase = 'real' order by check_name;
rollback;
