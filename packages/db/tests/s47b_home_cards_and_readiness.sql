-- S47b proof: home_card_config (Today cards, weekly summary gates, wearable readiness) -- migration *_s47b_home_cards_and_readiness.sql.
--   born unsigned and inactive; nothing is served until the CMO signs; only the CMO can sign; the ceiling of two primary actions cannot be stored
--   above 2; a malformed config cannot be stored; anon reaches nothing; a patient reads only through my_home_card_config(), never the table.
-- One rolled-back transaction, is_test data only. SABOTAGE at the end: the ceiling check, the signed-only filter and the table grant are each broken
-- once; the matching checks must flip.
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
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
end $f$;
create function pg_temp.back() returns void language plpgsql as
$f$ begin reset role; perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.sub', '', true); perform set_config('request.jwt.claim.role', '', true); end $f$;
create function pg_temp.q_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin
    if p_sql ~* '^\s*select' then execute p_sql into r; else execute p_sql; r := null; end if;
  exception when others then r := 'ERR:' || sqlerrm; end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.q_anon(p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  perform set_config('request.jwt.claim.sub', '', true);
  set local role anon;
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlstate; end;
  reset role;
  return r;
end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's47b-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'S47b ' || p_label || ' Person', '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true)
  on conflict (id) do update set role = excluded.role, full_name = excluded.full_name, is_test = true, is_active = true, phone = excluded.phone;
  return v;
end $f$;
create function pg_temp.mkdoc(p_org uuid, p_label text, p_tier text, p_admin uuid) returns uuid
language plpgsql as $f$
declare v uuid;
begin
  v := pg_temp.mkuser(p_org, p_label, 'clinician');
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
  values (p_org, v, 'S47b ' || p_label, 'MDCN', 'S48A-' || p_label || '-' || substr(v::text, 1, 8), true, 'active', now(), p_admin,
      p_tier::public.doctor_tier, 'contracted'::public.staff_employment_type,
      case when p_tier in ('senior_medical_officer', 'chief_medical_officer') then 2 else 1 end, true, p_admin, true);
  return v;
end $f$;

do $$
declare v_org uuid; v_admin uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  perform pg_temp.setf('org', v_org);
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  perform pg_temp.setf('p', pg_temp.mkuser(v_org, 'patient', 'patient'));
  perform pg_temp.setf('doc', pg_temp.mkdoc(v_org, 'senior', 'senior_medical_officer', v_admin));
  perform pg_temp.setf('cmo', pg_temp.mkdoc(v_org, 'cmo', 'chief_medical_officer', v_admin));
  perform pg_temp.setf('cfg', (select id from public.home_card_config where version = 1));
exception when others then
  raise exception 'fixture failed: %', sqlerrm;
end $$;

do $$
declare v_cfg uuid := pg_temp.f('cfg'); v_ok jsonb; v_err text;
begin
  perform pg_temp.ck('born unsigned', 'false', (select (approved_by is not null)::text from public.home_card_config where id = v_cfg));
  perform pg_temp.ck('born inactive', '0', (select count(*)::text from public.home_card_config where is_active));
  perform pg_temp.ck('nothing is served while unsigned', 'null', coalesce(pg_temp.q_as(pg_temp.f('p'), 'select public.my_home_card_config()::text'), 'null'));
  perform pg_temp.ck('the seed passes its own validator', 'true', private.home_card_config_valid((select config from public.home_card_config where id = v_cfg))::text);
  perform pg_temp.ck('anon cannot call the reader', '42501', replace(pg_temp.q_anon('select public.my_home_card_config()::text'), 'ERR:', ''));
  perform pg_temp.ck('anon cannot read the table', '42501', replace(pg_temp.q_anon('select count(*)::text from public.home_card_config'), 'ERR:', ''));
  perform pg_temp.ck('a patient reads no rows of the table', '0', pg_temp.q_as(pg_temp.f('p'), 'select count(*)::text from public.home_card_config'));
  perform pg_temp.ck('a senior doctor cannot sign', 'true', (pg_temp.q_as(pg_temp.f('doc'), format('select public.sign_home_card_config(%L)::text', v_cfg)) like '%only the active Chief Medical Officer%')::text);
  perform pg_temp.ck('a patient cannot sign', 'true', (pg_temp.q_as(pg_temp.f('p'), format('select public.sign_home_card_config(%L)::text', v_cfg)) like 'ERR:%')::text);
  perform pg_temp.ck('anon cannot sign', '42501', replace(pg_temp.q_anon(format('select public.sign_home_card_config(%L)::text', v_cfg)), 'ERR:', ''));
  perform pg_temp.ck('the CMO can sign', v_cfg::text, pg_temp.q_as(pg_temp.f('cmo'), format('select public.sign_home_card_config(%L)::text', v_cfg)));
  perform pg_temp.ck('signing records who and when', 'true', (select (approved_by is not null and approved_at is not null and is_active)::text from public.home_card_config where id = v_cfg));
  v_ok := (pg_temp.q_as(pg_temp.f('p'), 'select public.my_home_card_config()::text'))::jsonb;
  perform pg_temp.ck('once signed a patient gets the version and the config', '1', v_ok ->> 'version');
  perform pg_temp.ck('...with the ceiling of two', '2', v_ok #>> '{config,max_primary_actions}');
  -- invalid configs
  perform pg_temp.ck('a ceiling of 3 is refused', 'false', private.home_card_config_valid(jsonb_set((select config from public.home_card_config where id = v_cfg), '{max_primary_actions}', '3'))::text);
  perform pg_temp.ck('a ceiling of 0 is refused', 'false', private.home_card_config_valid(jsonb_set((select config from public.home_card_config where id = v_cfg), '{max_primary_actions}', '0'))::text);
  perform pg_temp.ck('an unknown card is refused', 'false', private.home_card_config_valid(jsonb_set((select config from public.home_card_config where id = v_cfg), '{cards,0,code}', '"teleport"'))::text);
  perform pg_temp.ck('a duplicate card is refused', 'false', private.home_card_config_valid(jsonb_set((select config from public.home_card_config where id = v_cfg), '{cards,1,code}', '"task_due"'))::text);
  perform pg_temp.ck('an information card cannot be a primary action', 'false', private.home_card_config_valid(jsonb_set((select config from public.home_card_config where id = v_cfg), '{cards,6,primary_eligible}', 'true'))::text);
  perform pg_temp.ck('a weekly window that is not 7 is refused', 'false', private.home_card_config_valid(jsonb_set((select config from public.home_card_config where id = v_cfg), '{weekly,window_days}', '30'))::text);
  perform pg_temp.ck('a baseline shorter than its minimum is refused', 'false', private.home_card_config_valid(jsonb_set((select config from public.home_card_config where id = v_cfg), '{readiness,min_baseline_days}', '30'))::text);
  perform pg_temp.ck('a config with no ceiling is refused (a missing key is false, not NULL)', 'false', private.home_card_config_valid((select config from public.home_card_config where id = v_cfg) - 'max_primary_actions')::text);
  perform pg_temp.ck('a config with no cards is refused', 'false', private.home_card_config_valid((select config from public.home_card_config where id = v_cfg) - 'cards')::text);
  perform pg_temp.ck('a config with no streak switch is refused', 'false', private.home_card_config_valid((select config from public.home_card_config where id = v_cfg) - 'streak')::text);
  perform pg_temp.ck('a config with no weekly part is refused', 'false', private.home_card_config_valid((select config from public.home_card_config where id = v_cfg) - 'weekly')::text);
  perform pg_temp.ck('a card with no priority is refused', 'false', private.home_card_config_valid(jsonb_set((select config from public.home_card_config where id = v_cfg), '{cards,0}', ((select config from public.home_card_config where id = v_cfg) #> '{cards,0}') - 'priority'))::text);
  perform pg_temp.ck('a card with no rules is refused', 'false', private.home_card_config_valid(jsonb_set((select config from public.home_card_config where id = v_cfg), '{cards,0}', ((select config from public.home_card_config where id = v_cfg) #> '{cards,0}') - 'rules'))::text);
  perform pg_temp.ck('a goals list holding a number is refused', 'false', private.home_card_config_valid(jsonb_set((select config from public.home_card_config where id = v_cfg), '{cards,0,rules,goals_any}', '[1]'))::text);
  perform pg_temp.ck('a pathways list holding an empty word is refused', 'false', private.home_card_config_valid(jsonb_set((select config from public.home_card_config where id = v_cfg), '{cards,0,rules,pathways_any}', '[""]'))::text);
  perform pg_temp.ck('a fractional weekly minimum is refused', 'false', private.home_card_config_valid(jsonb_set((select config from public.home_card_config where id = v_cfg), '{weekly,min_bp_readings}', '1.5'))::text);
  perform pg_temp.ck('a non-object is refused', 'false', private.home_card_config_valid('[]'::jsonb)::text);
  begin
    insert into public.home_card_config (version, config) values (99, jsonb_set((select config from public.home_card_config where id = v_cfg), '{max_primary_actions}', '5'));
    v_err := 'accepted';
  exception when check_violation then v_err := 'refused'; end;
  perform pg_temp.ck('a stored config above the ceiling is refused by the table', 'refused', v_err);
  -- an older version cannot be activated after a newer one is live
  insert into public.home_card_config (version, config) values (2, (select config from public.home_card_config where id = v_cfg));
  perform pg_temp.ck('the unsigned newer version cannot be active', 'refused', (select case when pg_temp.q_as(pg_temp.f('cmo'), format('update public.home_card_config set is_active = true where version = 2')) like 'ERR:%' then 'refused' else 'accepted' end));
end $$;

-- SABOTAGE ------------------------------------------------------------------------------------------------------------------------------------
do $$
begin
  create or replace function private.home_card_config_valid(p_config jsonb) returns boolean language sql immutable as $g$ select true $g$;
  insert into results values ('sabotaged', 'SABOTAGE: a validator that accepts everything lets a ceiling of 9 through', 'false',
    private.home_card_config_valid(jsonb_set((select config from public.home_card_config where version = 1), '{max_primary_actions}', '9'))::text);
end $$;

do $$
begin
  create or replace function public.my_home_card_config() returns jsonb language sql stable security definer set search_path = '' as
    $g$ select jsonb_build_object('version', version, 'config', config) from public.home_card_config where version = 2 $g$;
  insert into results values ('sabotaged', 'SABOTAGE: a reader that ignores the signature serves an unsigned version', 'null',
    coalesce(pg_temp.q_as(pg_temp.f('p'), 'select public.my_home_card_config()::text'), 'null'));
end $$;

do $$
begin
  grant select on public.home_card_config to anon;
  insert into results values ('sabotaged', 'SABOTAGE: a grant to anon would expose the table', '42501', replace(pg_temp.q_anon('select count(*)::text from public.home_card_config'), 'ERR:', ''));
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S47b proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and check_name like 'SABOTAGE%' and expected <> actual;
  if v_caught < 3 then raise exception 'VACUOUS TEST: the sabotage flipped % of 3 checks', v_caught; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;

rollback;
