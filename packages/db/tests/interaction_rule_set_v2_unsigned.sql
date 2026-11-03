-- Interaction rule set v2 (migration *_interaction_rule_set_v2_unsigned.sql): the non-empty ingredient-pair draft the Chief Medical
-- Officer is asked to sign. Nothing outside this rolled-back transaction signs anything.
--
-- Proves in one rolled-back transaction:
--   1. Version 2 exists with 350 rules, passes private.interaction_rules_valid, every rule passes private.interaction_rule_ok on
--      its own, no pair repeats in either order, no code repeats, every source carries an https link, every severity is
--      contraindicated or caution (High or Review: no Note rule was expanded), and the row is unsigned and inactive.
--   2. Version 1 is untouched (empty, unsigned, inactive) and the guard medicine_interaction_rules is still off.
--   3. While v2 is unsigned, public.active_medicine_interaction_rules() answers 'closed' for a test account (guard open for it)
--      and for an ordinary account: the draft reaches no client.
--   4. A patient and a senior doctor cannot sign it; the CMO can (inside this transaction only), after which the same test
--      account receives exactly the 350 rules and an ordinary account (guard closed) still receives nothing. The gate opens for
--      the right reason, it is not merely stuck shut.
--   5. SABOTAGE, two separate patches: (a) private.interaction_rules_valid replaced by one that says false, and (b) the rules door
--      replaced by one that returns the newest draft whether or not it is signed. (a) must flip the shape check; (b) must flip
--      the "closed while unsigned" check.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;

create or replace function pg_temp.attempt(p_sql text) returns text language plpgsql as $f$
begin
  execute p_sql;
  return 'ok';
exception when others then
  return sqlstate;
end $f$;

create or replace function pg_temp.as_user(p_uid uuid) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $f$;

create or replace function pg_temp.run_checks(p_phase text) returns void
language plpgsql as $f$
declare
  v_org uuid;
  v_pat uuid := gen_random_uuid();       -- is_test: guards open for her
  v_real uuid := gen_random_uuid();      -- ordinary account: guard closed
  v_smo uuid := gen_random_uuid();
  v_cmo uuid := gen_random_uuid();
  v_set1 uuid; v_set2 uuid;
  v_cfg jsonb;
  v_doc jsonb;
  v_res jsonb := '[]'::jsonb;
begin
  -- A previous phase's simulated session is transaction-local; clear it so the fixtures are written in the service context.
  perform set_config('request.jwt.claims', '', true);
  execute 'reset role';
  select id into v_org from public.organisations order by created_at limit 1;
  if v_org is null then raise exception 'proof needs one organisation (seed fixture missing)'; end if;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  select u, 'irsv2-' || substr(u::text, 1, 8) || '@example.invalid', 'x', now(), '{}', '{}'
    from unnest(array[v_pat, v_real, v_smo, v_cmo]) u;
  insert into public.profiles (id, organisation_id, role, full_name, is_test) values
    (v_pat,  v_org, 'patient',   'IRSv2 Test Patient', true),
    (v_real, v_org, 'patient',   'IRSv2 Ordinary Patient', false),
    (v_smo,  v_org, 'clinician', 'IRSv2 Senior Doctor', false),
    (v_cmo,  v_org, 'clinician', 'IRSv2 CMO', false)
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, is_test = excluded.is_test, full_name = excluded.full_name;
  insert into public.clinical_staff (organisation_id, profile_id, full_name, active, license_verified_at, doctor_tier,
                                     indemnity_insurer, indemnity_policy_number, indemnity_expires_at) values
    (v_org, v_smo, 'IRSv2 Senior Doctor', true, now(), 'senior_medical_officer', 'Probe Indemnity', 'IRSV2-1', now() + interval '1 year'),
    (v_org, v_cmo, 'IRSv2 CMO',           true, now(), 'chief_medical_officer',  'Probe Indemnity', 'IRSV2-2', now() + interval '1 year');

  -- 1. The draft itself ------------------------------------------------------------------------------------------------------
  select id, config into v_set2, v_cfg from public.medicine_interaction_rule_sets where version = 2;
  select id into v_set1 from public.medicine_interaction_rule_sets where version = 1;
  v_res := v_res || jsonb_build_array(jsonb_build_array('v2 exists', 'true', (v_set2 is not null)::text));
  v_res := v_res || jsonb_build_array(jsonb_build_array('v2 holds 350 rules', '350', coalesce(jsonb_array_length(v_cfg -> 'rules'), 0)::text));
  v_res := v_res || jsonb_build_array(jsonb_build_array('v2 passes private.interaction_rules_valid', 'true', private.interaction_rules_valid(v_cfg)::text));
  v_res := v_res || jsonb_build_array(jsonb_build_array('every rule passes private.interaction_rule_ok', '0',
    (select count(*) from jsonb_array_elements(v_cfg -> 'rules') r where not private.interaction_rule_ok(r))::text));
  v_res := v_res || jsonb_build_array(jsonb_build_array('no pair repeats in either order', '350',
    (select count(distinct least(r ->> 'ingredientA', r ->> 'ingredientB') || '|' || greatest(r ->> 'ingredientA', r ->> 'ingredientB'))
       from jsonb_array_elements(v_cfg -> 'rules') r)::text));
  v_res := v_res || jsonb_build_array(jsonb_build_array('no code repeats', '350',
    (select count(distinct r ->> 'code') from jsonb_array_elements(v_cfg -> 'rules') r)::text));
  v_res := v_res || jsonb_build_array(jsonb_build_array('every source carries an https link', '0',
    (select count(*) from jsonb_array_elements(v_cfg -> 'rules') r where (r ->> 'source') !~* 'https://\S+')::text));
  v_res := v_res || jsonb_build_array(jsonb_build_array('only High and Review were expanded (no info rule)', '0',
    (select count(*) from jsonb_array_elements(v_cfg -> 'rules') r where (r ->> 'severity') not in ('contraindicated', 'caution'))::text));
  v_res := v_res || jsonb_build_array(jsonb_build_array('High and Review counts', '79:271',
    (select count(*) filter (where r ->> 'severity' = 'contraindicated') || ':' || count(*) filter (where r ->> 'severity' = 'caution')
       from jsonb_array_elements(v_cfg -> 'rules') r)));
  v_res := v_res || jsonb_build_array(jsonb_build_array('v2 is unsigned and inactive', 'true',
    (select (not is_active and approved_by is null and approved_at is null)::text from public.medicine_interaction_rule_sets where id = v_set2)));

  -- 2. Nothing else moved -----------------------------------------------------------------------------------------------------
  v_res := v_res || jsonb_build_array(jsonb_build_array('v1 is still empty, unsigned and inactive', 'true',
    (select (jsonb_array_length(config -> 'rules') = 0 and not is_active and approved_by is null)::text from public.medicine_interaction_rule_sets where id = v_set1)));
  v_res := v_res || jsonb_build_array(jsonb_build_array('no rule set is active', '0',
    (select count(*)::text from public.medicine_interaction_rule_sets where is_active)));
  v_res := v_res || jsonb_build_array(jsonb_build_array('the guard medicine_interaction_rules is off', 'false',
    (select is_on::text from public.go_live_guards where key = 'medicine_interaction_rules')));

  -- 3. Unsigned: the draft reaches nobody -------------------------------------------------------------------------------------
  perform pg_temp.as_user(v_pat);
  v_res := v_res || jsonb_build_array(jsonb_build_array('unsigned v2: a test account (guard open for it) gets closed', 'closed',
    public.active_medicine_interaction_rules() ->> 'status'));
  v_res := v_res || jsonb_build_array(jsonb_build_array('a patient cannot read the draft table', '0',
    (select count(*)::text from public.medicine_interaction_rule_sets)));
  v_res := v_res || jsonb_build_array(jsonb_build_array('a patient cannot sign v2', '42501',
    pg_temp.attempt(format('select public.sign_medicine_interaction_rule_sets(%L)', v_set2))));
  execute 'reset role';
  perform pg_temp.as_user(v_real);
  v_res := v_res || jsonb_build_array(jsonb_build_array('unsigned v2: an ordinary account gets closed', 'closed',
    public.active_medicine_interaction_rules() ->> 'status'));
  execute 'reset role';
  perform pg_temp.as_user(v_smo);
  v_res := v_res || jsonb_build_array(jsonb_build_array('a senior doctor cannot sign v2', '42501',
    pg_temp.attempt(format('select public.sign_medicine_interaction_rule_sets(%L)', v_set2))));
  execute 'reset role';

  -- 4. The gate opens for the right reason (signature inside this rolled-back transaction only) ------------------------------
  perform pg_temp.as_user(v_cmo);
  v_res := v_res || jsonb_build_array(jsonb_build_array('the CMO can sign v2 (it is non-empty)', 'ok',
    pg_temp.attempt(format('select public.sign_medicine_interaction_rule_sets(%L)', v_set2))));
  execute 'reset role';
  perform pg_temp.as_user(v_pat);
  v_doc := public.active_medicine_interaction_rules();
  v_res := v_res || jsonb_build_array(jsonb_build_array('signed v2 + guard open (test account): all 350 rules arrive', 'ok:2:350',
    (v_doc ->> 'status') || ':' || (v_doc ->> 'version') || ':' || jsonb_array_length(v_doc -> 'rules')::text));
  execute 'reset role';
  perform pg_temp.as_user(v_real);
  v_res := v_res || jsonb_build_array(jsonb_build_array('signed v2 but guard closed (ordinary account): still closed', 'closed',
    public.active_medicine_interaction_rules() ->> 'status'));
  execute 'reset role';

  insert into results select p_phase, e->>0, e->>1, e->>2 from jsonb_array_elements(v_res) e;
end
$f$;

select pg_temp.run_checks('real');

-- Put the shipped state back so the sabotage phases start where the real one did.
update public.medicine_interaction_rule_sets set is_active = false, approved_by = null, approved_at = null;

-- SABOTAGE (a): the shape check says no to everything; the shape check must flip.
create or replace function private.interaction_rules_valid(config jsonb) returns boolean
language sql immutable set search_path = '' as $$ select false $$;
select pg_temp.run_checks('sabotaged_shape');

-- SABOTAGE (b): the door hands out the newest draft whether or not it is signed; "closed while unsigned" must flip.
create or replace function private.interaction_rules_valid(config jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(
         jsonb_typeof(config) = 'object'
     and jsonb_typeof(config -> 'rules') = 'array'
     and jsonb_array_length(config -> 'rules') <= 500
     and not exists (select 1 from jsonb_array_elements(config -> 'rules') r where not private.interaction_rule_ok(r))
     and (select count(*) = count(distinct r ->> 'code') from jsonb_array_elements(config -> 'rules') r), false)
$$;
update public.medicine_interaction_rule_sets set is_active = false, approved_by = null, approved_at = null;
create or replace function public.active_medicine_interaction_rules() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_row public.medicine_interaction_rule_sets;
begin
  if (select auth.uid()) is null then raise exception 'not authorised' using errcode = '42501'; end if;
  if not private.go_live_open_patient('medicine_interaction_rules', (select auth.uid())) then
    return jsonb_build_object('status', 'closed');
  end if;
  select * into v_row from public.medicine_interaction_rule_sets order by version desc limit 1;
  return jsonb_build_object('status', 'ok', 'version', v_row.version, 'rules', v_row.config -> 'rules');
end $$;
select pg_temp.run_checks('sabotaged_door');

do $$
declare v_bad text; v_a text; v_b text;
begin
  select string_agg(check_name || ' => ' || coalesce(actual, 'NULL') || ' (wanted ' || expected || ')', '; ') into v_bad
    from results where phase = 'real' and expected is distinct from actual;
  if v_bad is not null then raise exception 'interaction rule set v2 proof FAILED on the real migration: %', v_bad; end if;

  select string_agg(check_name, '; ') into v_a from results where phase = 'sabotaged_shape' and expected is distinct from actual;
  if v_a is null or v_a not like '%v2 passes private.interaction_rules_valid%' then
    raise exception 'sabotage (a) did not flip the shape check (flipped: %)', coalesce(v_a, 'nothing');
  end if;

  select string_agg(check_name, '; ') into v_b from results where phase = 'sabotaged_door' and expected is distinct from actual;
  if v_b is null or v_b not like '%unsigned v2: a test account (guard open for it) gets closed%' then
    raise exception 'sabotage (b) did not flip the closed-while-unsigned check (flipped: %)', coalesce(v_b, 'nothing');
  end if;
  raise notice 'interaction rule set v2 proof PASSED: % real checks; sabotage (a) flipped [%]; sabotage (b) flipped [%]',
    (select count(*) from results where phase = 'real'), v_a, v_b;
end $$;

select phase, check_name, expected, actual, case when expected is distinct from actual then 'FLIPPED' else 'ok' end as verdict
  from results order by phase, check_name;

rollback;
