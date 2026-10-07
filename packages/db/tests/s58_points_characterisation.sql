-- S58 characterisation of the wellness points machinery (written BEFORE changing it; the plan noted there were no tests).
-- Everything asserted here was true of the F1 state and must stay true after S58 (core ledger and balance behaviour).
-- Behaviour S58 deliberately CHANGED is recorded in docs/design/S58.md, not asserted here:
--   was: a weight-only vitals row paid 10 points; the daily cap used a synthetic md5 id; points were hard-coded in trigger bodies.
begin;
create temp table results(n serial, check_name text, ok boolean) on commit drop;
grant all on results to public; grant all on results_n_seq to public;
create function pg_temp.ck(p_name text, p_ok boolean) returns void language plpgsql as
$f$ begin
  insert into results(check_name, ok) values (p_name, coalesce(p_ok, false));
  if not coalesce(p_ok, false) then raise exception 'FAIL: %', p_name; end if;
end $f$;
do $$
declare
  v_org uuid; v_p uuid := gen_random_uuid(); v_src uuid := gen_random_uuid(); v_bal integer; v_n integer;
begin
  select organisation_id into v_org from public.profiles limit 1;
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v_p, 's58-char@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, is_test)
  values (v_p, v_org, 'patient', 'S58 char', true) on conflict (id) do update set is_test = true;

  perform private.award_wellness_points(v_p, 10, 'char_reason', 'char_table', v_src);
  select balance into v_bal from public.wellness_points_balances where patient_id = v_p;
  perform pg_temp.ck('first award credits the balance', v_bal = 10);
  perform private.award_wellness_points(v_p, 10, 'char_reason', 'char_table', v_src);
  select balance into v_bal from public.wellness_points_balances where patient_id = v_p;
  perform pg_temp.ck('same (patient, source, reason) never pays twice', v_bal = 10);
  perform private.award_wellness_points(v_p, 5, 'other_reason', 'char_table', v_src);
  select balance into v_bal from public.wellness_points_balances where patient_id = v_p;
  perform pg_temp.ck('a different reason on the same source is a different award', v_bal = 15);
  select lifetime_earned into v_n from public.wellness_points_balances where patient_id = v_p;
  perform pg_temp.ck('lifetime_earned follows earnings', v_n = 15);
  perform private.award_wellness_points(v_p, 0, 'zero', 'char_table', gen_random_uuid());
  perform private.award_wellness_points(v_p, -5, 'neg', 'char_table', gen_random_uuid());
  select balance into v_bal from public.wellness_points_balances where patient_id = v_p;
  perform pg_temp.ck('zero and negative awards are ignored', v_bal = 15);
  select count(*) into v_n from public.wellness_points_ledger where patient_id = v_p;
  perform pg_temp.ck('one ledger row per award, balance_after recorded',
    v_n = 2 and (select max(balance_after) from public.wellness_points_ledger where patient_id = v_p) = 15);
  begin
    update public.wellness_points_balances set balance = -1 where patient_id = v_p;
    perform pg_temp.ck('negative balance refused', false);
  exception when check_violation then perform pg_temp.ck('negative balance refused', true); end;
  begin
    perform public.redeem_wellness_points(5);
  exception when others then null; end;
  select balance into v_bal from public.wellness_points_balances where patient_id = v_p;
  perform pg_temp.ck('F1: the redeem RPC never touches the balance (no auth => refused or no-op)', v_bal = 15);
end $$;
select check_name, ok from results order by n;
rollback;
