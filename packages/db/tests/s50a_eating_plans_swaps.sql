-- S50a proof: eating plans and food swaps (migration *_s50a_eating_plans_swaps.sql).
-- One rolled-back transaction. Proves:
--  * the guidance config is born unsigned and inactive; only the Chief Medical Officer signs it; a patient cannot read the table or write it;
--  * the validator refuses a kidney or pregnancy plan that carries a numbers block, an unknown swap reason, a plan with no care-team prompt;
--  * before signing every patient (plain adult, pregnant, under 18) gets the IDENTICAL {state: unavailable} answer, and nutrition_guidance_is_signed() is false;
--  * after signing: a plain adult gets the swaps and the weight plan; a hypertension patient also gets the hypertension plan; a diabetic gets
--    the diabetes plan; a CKD patient gets the kidney plan; nobody gets a plan their condition does not call for;
--  * withheld people (postnatal year, clinician hold, positive eating-disorder screen, under 18) get EXACTLY the same bare answer as before signing;
--  * a pregnant patient (in each of the three places it is held) gets ONLY the pregnancy plan, no swaps and no other plan, and one under a
--    clinician hold or with a positive eating-disorder screen gets nothing; a plain adult never receives the pregnancy plan;
--  * the function takes no patient argument, so a caregiver is answered about themselves, never about the person they support;
--  * a pregnant minor and a stale pregnancy flag inside the postnatal year get nothing;
--  * anon cannot call anything; a client cannot call the private pregnancy function.
-- SABOTAGE: (1) the pregnancy reader made to answer true for everyone must put the pregnancy plan in front of a plain adult;
--           (2) the withheld rule made to answer false must let a minor receive the weight plan. Both must flip.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;
create function pg_temp.setf(p text, p_v uuid) returns void language sql as $$ insert into fx values (p, p_v) on conflict (k) do update set v = excluded.v $$;
create function pg_temp.f(p text) returns uuid language sql as $$ select v from fx where k = p $$;
create function pg_temp.ck(p_phase text, p_name text, p_expected text, p_actual text) returns void language sql as $$ insert into results values (p_phase, p_name, p_expected, p_actual) $$;

create function pg_temp.mkuser(p_org uuid, p_label text, p_role text, p_dob date default null) returns uuid language plpgsql as
$f$ declare v uuid := gen_random_uuid(); v_lagos date := (now() at time zone 'Africa/Lagos')::date;
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's50a-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  -- registration is adult-only: a minor is created as an adult and then made a minor_child dependant in one UPDATE
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'S50a ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'),
          case when p_dob is not null and p_dob > (v_lagos - interval '18 years')::date then (v_lagos - interval '45 years')::date
               else coalesce(p_dob, (v_lagos - interval '45 years')::date) end, true)
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, is_test = excluded.is_test, is_active = true,
    date_of_birth = excluded.date_of_birth;
  if p_dob is not null and p_dob > (v_lagos - interval '18 years')::date then
    update public.profiles set is_dependent_account = true, dependent_kind = 'minor_child', date_of_birth = p_dob where id = v;
  end if;
  return v;
end $f$;
create function pg_temp.mkdoc(p_org uuid, p_label text, p_tier text, p_admin uuid) returns uuid language plpgsql as
$f$ declare v uuid; s uuid;
begin
  v := pg_temp.mkuser(p_org, p_label, 'clinician');
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
  values (p_org, v, 'S50a ' || p_label, 'MDCN', 'S50A-' || p_label || '-' || substr(v::text, 1, 8), true, 'active', now(), p_admin,
      p_tier::public.doctor_tier, 'contracted'::public.staff_employment_type,
      case when p_tier in ('senior_medical_officer', 'chief_medical_officer') then 2 else 1 end, true, p_admin, true)
  returning id into s;
  return v;
end $f$;

create function pg_temp.as_user(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
  begin execute p_sql into r; exception when others then r := 'ERR ' || sqlstate; end;
  reset role;
  perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.sub', '', true); perform set_config('request.jwt.claim.role', '', true);
  return r;
end $f$;
create function pg_temp.as_anon(p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
  begin execute p_sql into r; exception when others then r := 'ERR ' || sqlstate; end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return r;
end $f$;
create function pg_temp.try(p_sql text) returns text language plpgsql as $f$ begin execute p_sql; return 'ok'; exception when others then return 'ERR ' || sqlstate; end $f$;

create function pg_temp.guid(p uuid) returns jsonb language plpgsql as
$f$ declare r text;
begin r := pg_temp.as_user(p, $$ select public.my_nutrition_guidance()::text $$); return r::jsonb; end $f$;
-- what a person is shown, as a short word: 'unavailable' or the sorted plan codes plus 'swaps' if any swap came with them
create function pg_temp.shown(p uuid) returns text language plpgsql as
$f$ declare g jsonb := pg_temp.guid(p);
begin
  if g ->> 'state' <> 'ok' then return g ->> 'state'; end if;
  return coalesce((select string_agg(x ->> 'code', ',' order by x ->> 'code') from jsonb_array_elements(g -> 'plans') x), '')
    || case when jsonb_array_length(g -> 'swaps') > 0 then '+swaps' else '' end;
end $f$;

-- fixtures -------------------------------------------------------------------------------------------------------------------------
do $$
declare v_org uuid; v_admin uuid; v_lagos date := (now() at time zone 'Africa/Lagos')::date;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  if v_org is null then insert into public.organisations (name) values ('S50a proof org') returning id into v_org; end if;
  perform pg_temp.setf('org', v_org);
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  perform pg_temp.setf('admin', v_admin);
  perform pg_temp.setf('cmo', pg_temp.mkdoc(v_org, 'cmo', 'chief_medical_officer', v_admin));
  perform pg_temp.setf('smo', pg_temp.mkdoc(v_org, 'smo', 'senior_medical_officer', v_admin));
  perform pg_temp.setf('plain', pg_temp.mkuser(v_org, 'plain', 'patient'));
  perform pg_temp.setf('htn', pg_temp.mkuser(v_org, 'htn', 'patient'));
  perform pg_temp.setf('dm', pg_temp.mkuser(v_org, 'dm', 'patient'));
  perform pg_temp.setf('ckd', pg_temp.mkuser(v_org, 'ckd', 'patient'));
  perform pg_temp.setf('preg_profile', pg_temp.mkuser(v_org, 'pregprofile', 'patient'));
  perform pg_temp.setf('preg_table', pg_temp.mkuser(v_org, 'pregtable', 'patient'));
  perform pg_temp.setf('preg_stage', pg_temp.mkuser(v_org, 'pregstage', 'patient'));
  perform pg_temp.setf('preg_held', pg_temp.mkuser(v_org, 'pregheld', 'patient'));
  perform pg_temp.setf('preg_ed', pg_temp.mkuser(v_org, 'pregED', 'patient'));
  perform pg_temp.setf('postnatal', pg_temp.mkuser(v_org, 'postnatal', 'patient'));
  perform pg_temp.setf('ed', pg_temp.mkuser(v_org, 'ed', 'patient'));
  perform pg_temp.setf('held', pg_temp.mkuser(v_org, 'held', 'patient'));
  perform pg_temp.setf('minor', pg_temp.mkuser(v_org, 'minor', 'patient', (v_lagos - interval '16 years')::date));
  perform pg_temp.setf('preg_minor', pg_temp.mkuser(v_org, 'pregminor', 'patient', (v_lagos - interval '16 years')::date));
  perform pg_temp.setf('preg_postnatal', pg_temp.mkuser(v_org, 'pregpostnatal', 'patient'));
  insert into public.care_plans (organisation_id, patient_id, condition, status) values
    (v_org, pg_temp.f('htn'), 'hypertension', 'active'), (v_org, pg_temp.f('dm'), 'diabetes', 'active'), (v_org, pg_temp.f('ckd'), 'ckd', 'active'),
    (v_org, pg_temp.f('plain'), 'diabetes', 'completed');   -- a finished plan calls for nothing
  update public.profiles set is_pregnant = true where id in (pg_temp.f('preg_profile'), pg_temp.f('preg_held'), pg_temp.f('preg_ed'), pg_temp.f('preg_minor'), pg_temp.f('preg_postnatal'));
  insert into public.postnatal_profiles (organisation_id, patient_id, delivery_date) values (v_org, pg_temp.f('preg_postnatal'), v_lagos - 30);
  insert into public.patient_pregnancy (organisation_id, patient_id, is_pregnant) values (v_org, pg_temp.f('preg_table'), true);
  insert into public.reproductive_health_profiles (organisation_id, patient_id, life_stage) values (v_org, pg_temp.f('preg_stage'), 'pregnant');
  insert into public.postnatal_profiles (organisation_id, patient_id, delivery_date) values (v_org, pg_temp.f('postnatal'), v_lagos - 100);
  -- a trigger derives `positive` from the SCOFF answers (two or more), so a real positive screen carries them
  insert into public.obesity_ed_screens (organisation_id, patient_id, scoff_sick, scoff_control) values
    (v_org, pg_temp.f('ed'), true, true), (v_org, pg_temp.f('preg_ed'), true, true);
  insert into public.nutrition_target_holds (organisation_id, patient_id, reason, set_by) values
    (v_org, pg_temp.f('held'), 'clinician_flag', pg_temp.f('smo')), (v_org, pg_temp.f('preg_held'), 'clinician_flag', pg_temp.f('smo'));
end $$;

-- 1 the config ----------------------------------------------------------------------------------------------------------------------
select pg_temp.ck('1', 'born inactive', '0', (select count(*)::text from public.nutrition_guidance_config where is_active));
select pg_temp.ck('1', 'the seed passes its own validator', 'true', (select private.nutrition_guidance_config_valid(config)::text from public.nutrition_guidance_config where version = 1));
select pg_temp.ck('1', 'the guard against activating a superseded version is on the table', '1',
  (select count(*)::text from pg_trigger where tgname = 'refuse_superseded_activation' and not tgisinternal and tgrelid = 'public.nutrition_guidance_config'::regclass));
select pg_temp.ck('1', 'a patient cannot read the config table', '0', pg_temp.as_user(pg_temp.f('plain'), $$ select count(*)::text from public.nutrition_guidance_config $$));
select pg_temp.ck('1', 'a clinician can read it to sign it', '1', pg_temp.as_user(pg_temp.f('smo'), $$ select count(*)::text from public.nutrition_guidance_config $$));
select pg_temp.ck('1', 'a patient cannot write it', 'ERR 42501', pg_temp.as_user(pg_temp.f('plain'), $$ update public.nutrition_guidance_config set notes = 'x' returning 'x' $$));
select pg_temp.ck('1', 'the kidney plan with a numbers block is refused', 'ERR 23514', pg_temp.try($$
  insert into public.nutrition_guidance_config (version, config) select 91, jsonb_set(config, '{plans,kidney,numbers}', '{"protein_g":40}') from public.nutrition_guidance_config where version = 1 $$));
select pg_temp.ck('1', 'the pregnancy plan with a numbers block is refused', 'ERR 23514', pg_temp.try($$
  insert into public.nutrition_guidance_config (version, config) select 92, jsonb_set(config, '{plans,pregnancy,numbers}', '{"kcal":2200}') from public.nutrition_guidance_config where version = 1 $$));
select pg_temp.ck('1', 'a plan with no care-team prompt is refused', 'ERR 23514', pg_temp.try($$
  insert into public.nutrition_guidance_config (version, config) select 93, config #- '{plans,weight,care_team_prompt}' from public.nutrition_guidance_config where version = 1 $$));
select pg_temp.ck('1', 'a swap with an unknown reason kind is refused', 'ERR 23514', pg_temp.try($$
  insert into public.nutrition_guidance_config (version, config) select 94, jsonb_set(config, '{swaps,0,reason_kind}', '"bad_food"') from public.nutrition_guidance_config where version = 1 $$));
select pg_temp.ck('1', 'a missing plan is refused', 'ERR 23514', pg_temp.try($$
  insert into public.nutrition_guidance_config (version, config) select 95, config #- '{plans,diabetes}' from public.nutrition_guidance_config where version = 1 $$));
select pg_temp.ck('1', 'a config with no swaps key is refused', 'ERR 23514', pg_temp.try($$
  insert into public.nutrition_guidance_config (version, config) select 97, config - 'swaps' from public.nutrition_guidance_config where version = 1 $$));
select pg_temp.ck('1', 'a plan with no tips key is refused', 'ERR 23514', pg_temp.try($$
  insert into public.nutrition_guidance_config (version, config) select 98, config #- '{plans,weight,tips}' from public.nutrition_guidance_config where version = 1 $$));
select pg_temp.ck('1', 'a swap with no code is refused', 'ERR 23514', pg_temp.try($$
  insert into public.nutrition_guidance_config (version, config) select 99, config #- '{swaps,0,code}' from public.nutrition_guidance_config where version = 1 $$));
select pg_temp.ck('1', 'a swap with no to_food_codes is refused', 'ERR 23514', pg_temp.try($$
  insert into public.nutrition_guidance_config (version, config) select 100, config #- '{swaps,0,to_food_codes}' from public.nutrition_guidance_config where version = 1 $$));
select pg_temp.ck('1', 'a swap for an unknown audience is refused', 'ERR 23514', pg_temp.try($$
  insert into public.nutrition_guidance_config (version, config) select 101, jsonb_set(config, '{swaps,0,for}', '["kidney"]') from public.nutrition_guidance_config where version = 1 $$));
select pg_temp.ck('1', 'live without a signature is refused', 'ERR 23514', pg_temp.try($$
  insert into public.nutrition_guidance_config (version, is_active, config) select 96, true, config from public.nutrition_guidance_config where version = 1 $$));
select pg_temp.ck('1', 'every swap names foods that exist', '0', (
  select count(*)::text from (
    select s ->> 'from_food_code' c from public.nutrition_guidance_config g, jsonb_array_elements(g.config -> 'swaps') s where g.version = 1
    union all select t from public.nutrition_guidance_config g, jsonb_array_elements(g.config -> 'swaps') s, jsonb_array_elements_text(s -> 'to_food_codes') t where g.version = 1) x
  where not exists (select 1 from public.nigerian_foods f where f.code = x.c)));

-- 2 before signing: everybody gets the same bare answer ------------------------------------------------------------------------------
select pg_temp.ck('2', 'not signed: is_signed is false', 'false', pg_temp.as_user(pg_temp.f('plain'), $$ select public.nutrition_guidance_is_signed()::text $$));
select pg_temp.ck('2', 'unsigned: plain adult', '{"state": "unavailable"}', pg_temp.guid(pg_temp.f('plain'))::text);
select pg_temp.ck('2', 'unsigned: pregnant is the IDENTICAL answer', pg_temp.guid(pg_temp.f('plain'))::text, pg_temp.guid(pg_temp.f('preg_profile'))::text);
select pg_temp.ck('2', 'unsigned: a minor is the IDENTICAL answer', pg_temp.guid(pg_temp.f('plain'))::text, pg_temp.guid(pg_temp.f('minor'))::text);

-- 3 signing -------------------------------------------------------------------------------------------------------------------------
select pg_temp.ck('3', 'a senior medical officer cannot sign', 'ERR P0001', pg_temp.as_user(pg_temp.f('smo'), format($$ select public.sign_nutrition_guidance_config(%L)::text $$, (select id from public.nutrition_guidance_config where version = 1))));
select pg_temp.ck('3', 'a patient cannot sign', 'ERR P0001', pg_temp.as_user(pg_temp.f('plain'), format($$ select public.sign_nutrition_guidance_config(%L)::text $$, (select id from public.nutrition_guidance_config where version = 1))));
select pg_temp.ck('3', 'anon cannot sign', 'ERR 42501', pg_temp.as_anon(format($$ select public.sign_nutrition_guidance_config(%L)::text $$, (select id from public.nutrition_guidance_config where version = 1))));
select pg_temp.ck('3', 'still unsigned after the refusals', '0', (select count(*)::text from public.nutrition_guidance_config where is_active));
select pg_temp.ck('3', 'the Chief Medical Officer signs', 'true', (pg_temp.as_user(pg_temp.f('cmo'), format($$ select public.sign_nutrition_guidance_config(%L)::text $$, (select id from public.nutrition_guidance_config where version = 1))) ~ '^[0-9a-f-]{36}$')::text);
select pg_temp.ck('3', 'is_signed is now true', 'true', pg_temp.as_user(pg_temp.f('plain'), $$ select public.nutrition_guidance_is_signed()::text $$));
select pg_temp.ck('3', 'the signing was audited', 'true', (select (count(*) >= 1)::text from public.audit_log where action = 'nutrition_guidance_config.signed'));

-- 4 who sees what -------------------------------------------------------------------------------------------------------------------
select pg_temp.ck('4', 'plain adult: the weight plan and the swaps (a finished diabetes plan calls for nothing)', 'weight+swaps', pg_temp.shown(pg_temp.f('plain')));
select pg_temp.ck('4', 'hypertension patient', 'hypertension,weight+swaps', pg_temp.shown(pg_temp.f('htn')));
select pg_temp.ck('4', 'diabetes patient', 'diabetes,weight+swaps', pg_temp.shown(pg_temp.f('dm')));
select pg_temp.ck('4', 'kidney disease patient', 'kidney,weight+swaps', pg_temp.shown(pg_temp.f('ckd')));
select pg_temp.ck('4', 'the plain adult never sees the pregnancy plan', '0', (select count(*)::text from jsonb_array_elements(pg_temp.guid(pg_temp.f('plain')) -> 'plans') x where x ->> 'code' = 'pregnancy'));
select pg_temp.ck('4', 'the answer carries the signed version and no other patient facts', 'config_version,plans,state,swaps',
  (select string_agg(k, ',' order by k) from jsonb_object_keys(pg_temp.guid(pg_temp.f('plain'))) k));

-- withheld people get exactly the bare answer
create function pg_temp.bare() returns text language sql as $$ select '{"state": "unavailable"}' $$;
select pg_temp.ck('4', 'postnatal year: nothing', pg_temp.bare(), pg_temp.guid(pg_temp.f('postnatal'))::text);
select pg_temp.ck('4', 'clinician hold: nothing', pg_temp.bare(), pg_temp.guid(pg_temp.f('held'))::text);
select pg_temp.ck('4', 'positive eating-disorder screen: nothing', pg_temp.bare(), pg_temp.guid(pg_temp.f('ed'))::text);
select pg_temp.ck('4', 'under 18: nothing', pg_temp.bare(), pg_temp.guid(pg_temp.f('minor'))::text);
select pg_temp.ck('4', 'nobody signed in: nothing', pg_temp.bare(), (select public.my_nutrition_guidance()::text));

-- pregnancy: only the pregnancy plan, from the patient's own record, in each place it is held
select pg_temp.ck('4', 'pregnant (profile flag): only the pregnancy plan, no swaps', 'pregnancy', pg_temp.shown(pg_temp.f('preg_profile')));
select pg_temp.ck('4', 'pregnant (patient_pregnancy): only the pregnancy plan', 'pregnancy', pg_temp.shown(pg_temp.f('preg_table')));
select pg_temp.ck('4', 'pregnant (reproductive life stage): only the pregnancy plan', 'pregnancy', pg_temp.shown(pg_temp.f('preg_stage')));
select pg_temp.ck('4', 'pregnant under a clinician hold: nothing', pg_temp.bare(), pg_temp.guid(pg_temp.f('preg_held'))::text);
select pg_temp.ck('4', 'pregnant with a positive eating-disorder screen: nothing', pg_temp.bare(), pg_temp.guid(pg_temp.f('preg_ed'))::text);
select pg_temp.ck('4', 'the pregnancy plan has no numbers', 'false', ((pg_temp.guid(pg_temp.f('preg_profile')) #> '{plans,0}') ? 'numbers')::text);
select pg_temp.ck('4', 'a pregnant minor: nothing (age rule holds on the pregnancy branch)', pg_temp.bare(), pg_temp.guid(pg_temp.f('preg_minor'))::text);
select pg_temp.ck('4', 'a stale pregnancy flag in the postnatal year: nothing', pg_temp.bare(), pg_temp.guid(pg_temp.f('preg_postnatal'))::text);
-- a caller is answered about themselves: the function takes no patient, so a caregiver cannot ask about the person they support
select pg_temp.ck('4', 'my_nutrition_guidance takes no arguments', '0', (select pronargs::text from pg_proc where oid = 'public.my_nutrition_guidance()'::regprocedure));
select pg_temp.ck('4', 'nutrition_guidance_is_signed takes no arguments', '0', (select pronargs::text from pg_proc where oid = 'public.nutrition_guidance_is_signed()'::regprocedure));

-- 5 closed doors --------------------------------------------------------------------------------------------------------------------
select pg_temp.ck('5', 'anon cannot read guidance', 'ERR 42501', pg_temp.as_anon($$ select public.my_nutrition_guidance()::text $$));
select pg_temp.ck('5', 'anon cannot ask if it is signed', 'ERR 42501', pg_temp.as_anon($$ select public.nutrition_guidance_is_signed()::text $$));
select pg_temp.ck('5', 'a client cannot ask who is pregnant', 'ERR 42501', pg_temp.as_user(pg_temp.f('plain'), format($$ select private.nutrition_pregnancy_known(%L)::text $$, pg_temp.f('preg_profile'))));
select pg_temp.ck('5', 'anon has no table access', 'false', has_table_privilege('anon', 'public.nutrition_guidance_config', 'SELECT')::text);
select pg_temp.ck('5', 'the guard count test sees the new table (see governed_config_supersede_guard.sql)', '1',
  (select count(*)::text from pg_trigger where tgname = 'refuse_superseded_activation' and tgrelid = 'public.nutrition_guidance_config'::regclass));

-- SABOTAGE 1: a pregnancy reader that answers true for everyone must put the pregnancy plan in front of a plain adult
create or replace function private.nutrition_pregnancy_known(p_patient uuid) returns boolean language sql stable security definer set search_path = '' as $$ select true $$;
select pg_temp.ck('sabotage', 'with the pregnancy rule broken a plain adult would be shown the pregnancy plan', 'pregnancy', pg_temp.shown(pg_temp.f('plain')));
create or replace function private.nutrition_pregnancy_known(p_patient uuid) returns boolean language sql stable security definer set search_path = '' as $$ select false $$;

-- SABOTAGE 2: a withheld rule that never withholds must let a minor receive the weight plan
create or replace function private.nutrition_targets_withheld(p_patient uuid) returns boolean language sql stable security definer set search_path = '' as $$ select false $$;
select pg_temp.ck('sabotage', 'with the withheld rule removed a minor would receive the weight plan', 'weight+swaps', pg_temp.shown(pg_temp.f('minor')));

-- verdict ---------------------------------------------------------------------------------------------------------------------------
do $$
declare v_bad text;
begin
  select string_agg(phase || ' / ' || check_name || ': expected ' || coalesce(expected, 'NULL') || ' got ' || coalesce(actual, 'NULL'), E'\n')
    into v_bad from results where expected is distinct from actual;
  if v_bad is not null then raise exception E'S50a proof FAILED:\n%', v_bad; end if;
  raise notice 'S50a proof: % checks passed', (select count(*) from results);
end $$;

rollback;
