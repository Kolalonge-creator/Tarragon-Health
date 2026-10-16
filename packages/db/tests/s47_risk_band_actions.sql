-- S47 proof: the unsigned S45 risk band actions (migration *_s47_risk_band_actions.sql). One rolled-back transaction.
-- (Share-link defaults are owned by S09x, not this migration.)
-- Proves:
--   1. The risk instrument v2 carries the five band actions, is UNSIGNED, never says the app prescribes, and the instrument itself stays unsigned.
--   2. SABOTAGE: a band action rewritten to prescribe; the matching check flips.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;

create function pg_temp.f(p text) returns uuid language sql as $$ select v from fx where k = p $$;
create function pg_temp.setf(p text, p_v uuid) returns void language sql as
$$ insert into fx values (p, p_v) on conflict (k) do update set v = excluded.v $$;
create function pg_temp.ck(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('real', p_name, p_expected, p_actual) $$;
create function pg_temp.act(p_uid uuid) returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
end $f$;
create function pg_temp.back() returns void language plpgsql as
$f$ begin reset role; perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.role', '', true); end $f$;
-- run a statement as a signed-in user; returns 'ok' or the error message
create function pg_temp.try_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql; r := 'ok'; exception when others then r := sqlerrm; end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.q_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlerrm; end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.q(p_sql text) returns text language plpgsql as
$f$ declare r text; begin execute p_sql into r; return r; end $f$;
create function pg_temp.try_service(p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  set local role service_role;
  begin execute p_sql into r; r := coalesce(r, 'ok'); exception when others then r := sqlerrm; end;
  reset role;
  return r;
end $f$;
create function pg_temp.try_sql_owner(p_sql text) returns text language plpgsql as
$f$ begin execute p_sql; return 'ok'; exception when others then return sqlerrm; end $f$;
create function pg_temp.q_anon(p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  set local role anon;
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlerrm; end;
  reset role;
  return r;
end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's43-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'S43 ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone, date_of_birth = excluded.date_of_birth;
  return v;
end $f$;

do $$
declare v_org uuid; v_pat uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_pat := pg_temp.mkuser(v_org, 'sharer', 'patient');
  perform pg_temp.setf('pat', v_pat);

  -- 1. band actions
  perform pg_temp.ck('instrument v2 is unsigned and inactive and the instrument is still unsigned', 'true,false',
    (select (approved_by is null and not is_active)::text from public.risk_instrument_versions where code = 'who_cvd_2019_wssa' and version = 2) || ',' || private.risk_instrument_signed('who_cvd_2019_wssa')::text);
  perform pg_temp.ck('five band actions and the app never prescribes', '5,false',
    (select (select count(*)::text from jsonb_object_keys(config -> 'bandActions' -> 'bands')) || ',' || (config -> 'bandActions' ->> 'appPrescribes')
       from public.risk_instrument_versions where code = 'who_cvd_2019_wssa' and version = 2));
  perform pg_temp.ck('the actions are the chosen ones', 'lt5:12|5to10:6|10to20:4,3,doctor|20to30:2,3|ge30:1',
    (select 'lt5:' || (config #>> '{bandActions,bands,lt5,reassessMonths}') || '|5to10:' || (config #>> '{bandActions,bands,5to10,bpCheckEveryMonths}') || '|10to20:' || (config #>> '{bandActions,bands,10to20,careTeamReviewWithinWeeks}')
          || ',' || (config #>> '{bandActions,bands,10to20,recheckEveryMonths}') || ',' || case when (config #>> '{bandActions,bands,10to20,doctorDecidesAboutMedicines}')::boolean then 'doctor' else 'none' end
          || '|20to30:' || (config #>> '{bandActions,bands,20to30,doctorReviewWithinWeeks}') || ',' || (config #>> '{bandActions,bands,20to30,recheckEveryMonths}') || '|ge30:' || (config #>> '{bandActions,bands,ge30,doctorReviewWithinWeeks}')
       from public.risk_instrument_versions where code = 'who_cvd_2019_wssa' and version = 2));
  perform pg_temp.ck('no action text key says prescribe or start', 'false',
    (select ((select string_agg(b.value ->> 'copyKey', ' ') from jsonb_each(config -> 'bandActions' -> 'bands') b) ~* 'prescrib|start a medic|start medic')::text from public.risk_instrument_versions where code = 'who_cvd_2019_wssa' and version = 2));
  perform pg_temp.ck('the thresholds are marked unverified against WHO PEN / HEARTS', 'unverified_against_who_pen_hearts',
    (select config -> 'bandActions' ->> 'thresholdsStatus' from public.risk_instrument_versions where code = 'who_cvd_2019_wssa' and version = 2));
  perform pg_temp.ck('the WHO instrument stays off: coefficients are missing so it cannot be signed', 'false',
    (select coalesce((config ->> 'coefficientsVerified')::boolean, false)::text from public.risk_instrument_versions where code = 'who_cvd_2019_wssa' and version = 2));
end $$;

-- 2. Sabotage --------------------------------------------------------------------------------------------------------------------------
do $$
declare v_pat uuid := pg_temp.f('pat');
begin
  -- A: a band action rewritten to prescribe. The wording check must flip.
  update public.risk_instrument_versions set config = jsonb_set(config, '{bandActions,bands,10to20,copyKey}', '"start a medicine"') where code = 'who_cvd_2019_wssa' and version = 2;
  insert into results values ('sabotaged', 'no action text key says prescribe or start', 'false',
    (select ((select string_agg(b.value ->> 'copyKey', ' ') from jsonb_each(config -> 'bandActions' -> 'bands') b) ~* 'prescrib|start a medic|start medic')::text from public.risk_instrument_versions where code = 'who_cvd_2019_wssa' and version = 2));
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S47 proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ')
         from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 1 then raise exception 'VACUOUS TEST: the sabotage flipped % of 1 checks', v_caught; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;

rollback;
