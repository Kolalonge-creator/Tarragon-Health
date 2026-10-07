-- ===========================================================================
-- Proof: *_s05b_allergies_conditions_audited_reads.sql (S05b; OQ-54 decision: one surface at a time).
--
-- Proves, against the real migrated schema, with simulated sessions:
--   1. The chart sections `allergies` and `conditions` carry the columns the clinician screens need (source, noted_at,
--      next_review_due_at, last_reviewed_at, date_identified) for a clinician tied to the patient, and an untied clinician is refused
--      with status `denied`, not an empty list.
--   2. search_patient_ids_by_condition: org staff find the patients with a matching condition; the optional scope narrows the result;
--      LIKE wildcards in the term are literal (a bare % or _ matches nothing); a one-character term and an out-of-range cap raise; a
--      patient caller is refused; anon cannot execute; the search writes one audit row that carries the term's LENGTH, never the term.
--   3. SABOTAGE: the unescaped version would let a bare % match every patient with a condition, so check 2c proves something.
--
-- Wrapped in BEGIN/ROLLBACK; mints its own fixtures.
-- ===========================================================================

begin;

do $$
declare
  v_org uuid;
  v_pat uuid := gen_random_uuid();
  v_pat2 uuid := gen_random_uuid();
  v_tied uuid := gen_random_uuid();
  v_untied uuid := gen_random_uuid();
  v_ph uuid := gen_random_uuid();
  v_other_org uuid := gen_random_uuid();
  v_org2 uuid := gen_random_uuid();
  v_json jsonb;
  v_ids uuid[];
  v_n integer;
  v_failed boolean;
  v_sqlstate text;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  if v_org is null then raise exception 'fixture FAIL: no organisation'; end if;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data) values
    (v_pat,    's05b-pat@example.invalid',    'x', now(), '{}', '{}'),
    (v_pat2,   's05b-pat2@example.invalid',   'x', now(), '{}', '{}'),
    (v_tied,   's05b-tied@example.invalid',   'x', now(), '{}', '{}'),
    (v_untied, 's05b-untied@example.invalid', 'x', now(), '{}', '{}'),
    (v_ph,     's05b-ph@example.invalid',     'x', now(), '{}', '{}'),
    (v_other_org, 's05b-other@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone) values
    (v_pat,    v_org, 'patient',   'S05b Patient One', '+2348052220001'),
    (v_pat2,   v_org, 'patient',   'S05b Patient Two', '+2348052220002'),
    (v_tied,   v_org, 'clinician', 'S05b Tied Doctor', '+2348052220003'),
    (v_untied, v_org, 'clinician', 'S05b Untied Doctor','+2348052220004'),
    (v_ph,     v_org, 'pharmacist','S05b Pharmacist',   '+2348052220005')
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, full_name = excluded.full_name;
  insert into public.clinical_staff (organisation_id, profile_id, full_name, active, license_verified_at, doctor_tier) values
    (v_org, v_tied,   'S05b Tied Doctor',   true, now(), 'senior_medical_officer'),
    (v_org, v_untied, 'S05b Untied Doctor', true, now(), 'senior_medical_officer');
  insert into public.organisations (id, name, type) values (v_org2, 'S05b Other Org', 'direct_consumer');
  insert into public.profiles (id, organisation_id, role, full_name, phone) values (v_other_org, v_org2, 'clinician', 'S05b Other Org Doctor', '+2348052220006')
    on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role;
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id, assigned_at)
  values (v_org, v_pat, v_tied, now()) on conflict (patient_id) do update set clinician_id = v_tied;

  insert into public.patient_allergies (organisation_id, patient_id, allergen, reaction, severity, source)
  values (v_org, v_pat, 'S05b penicillin', 'hives', 'severe', 'clinician');
  insert into public.patient_conditions (organisation_id, patient_id, condition_name, status, date_identified)
  values (v_org, v_pat,  'S05b type 2 diabetes', 'active', current_date),
         (v_org, v_pat2, 'S05b hypertension',    'active', current_date);

  -- 1. chart sections carry the new columns for the tied clinician; the untied one is denied
  perform set_config('request.jwt.claims', json_build_object('sub', v_tied, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select public.read_patient_chart_audited(v_pat, array['allergies','conditions'], 'S05b proof: tied clinician review') into v_json;
  execute 'reset role';
  if v_json ->> 'status' <> 'ok'
     or (v_json -> 'sections' -> 'allergies' -> 0 ->> 'source') <> 'clinician'
     or (v_json -> 'sections' -> 'allergies' -> 0 ->> 'noted_at') is null
     or (v_json -> 'sections' -> 'conditions' -> 0 ->> 'date_identified') is null
     or not (v_json -> 'sections' -> 'conditions' -> 0 ? 'next_review_due_at')
     or not (v_json -> 'sections' -> 'conditions' -> 0 ? 'last_reviewed_at') then
    raise exception 'FAIL 1a: the tied clinician did not get the extended sections: %', v_json;
  end if;
  if not exists (select 1 from public.audit_log where action = 'staff.chart_read' and actor_id = v_tied and event ->> 'basis' = 'tied') then
    raise exception 'FAIL 1c: the chart read audit row carries no access basis';
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_untied, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select public.read_patient_chart_audited(v_pat, array['allergies'], 'S05b proof: untied clinician attempt') into v_json;
  execute 'reset role';
  if v_json ->> 'status' <> 'denied' or v_json -> 'sections' <> '{}'::jsonb then
    raise exception 'FAIL 1b: an untied clinician was not denied: %', v_json;
  end if;

  -- 2. the list-wide condition search (tied patients only)
  perform set_config('request.jwt.claims', json_build_object('sub', v_tied, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select array_agg(patient_id) into v_ids from public.search_patient_ids_by_condition('S05b type 2');
  if v_ids is distinct from array[v_pat] then raise exception 'FAIL 2a: search found % instead of the one patient', v_ids; end if;
  select array_agg(patient_id order by patient_id) into v_ids from public.search_patient_ids_by_condition('S05b');
  if v_ids is distinct from array[v_pat] then raise exception 'FAIL 2b: search found % , expected only the tied patient', v_ids; end if;
  select count(*) into v_n from public.search_patient_ids_by_condition('S05b', array[v_pat2]);
  if v_n <> 0 then raise exception 'FAIL 2b: an untied patient was reachable through the scope (found %)', v_n; end if;
  -- wildcards are literal
  select count(*) into v_n from public.search_patient_ids_by_condition('%%');
  if v_n <> 0 then raise exception 'FAIL 2c: a bare %% term matched % patients', v_n; end if;
  select count(*) into v_n from public.search_patient_ids_by_condition('__');
  if v_n <> 0 then raise exception 'FAIL 2c: a bare underscore term matched % patients', v_n; end if;
  -- bounds
  v_failed := false; v_sqlstate := null;
  begin perform public.search_patient_ids_by_condition('a');
  exception when others then v_failed := true; get stacked diagnostics v_sqlstate = returned_sqlstate; end;
  if not v_failed or v_sqlstate <> '22023' then raise exception 'FAIL 2d: a one-character term was accepted'; end if;
  v_failed := false; v_sqlstate := null;
  begin perform public.search_patient_ids_by_condition('diabetes', null, 0);
  exception when others then v_failed := true; get stacked diagnostics v_sqlstate = returned_sqlstate; end;
  if not v_failed or v_sqlstate <> '22023' then raise exception 'FAIL 2d: cap 0 was accepted'; end if;
  execute 'reset role';

  -- the oracle is closed: an untied clinician, an excluded role and another organisation's staff learn nothing
  perform set_config('request.jwt.claims', json_build_object('sub', v_untied, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_n from public.search_patient_ids_by_condition('S05b type 2', array[v_pat]);
  if v_n <> 0 then raise exception 'FAIL 2g: an untied clinician confirmed a condition through the search (found %)', v_n; end if;
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', v_ph, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_n from public.search_patient_ids_by_condition('S05b');
  execute 'reset role';
  if v_n <> 0 then raise exception 'FAIL 2g: a pharmacist found % patients', v_n; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_other_org, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_n from public.search_patient_ids_by_condition('S05b');
  execute 'reset role';
  if v_n <> 0 then raise exception 'FAIL 2g: staff of another organisation found % patients', v_n; end if;

  -- audit: one row per search, the term's length and never the term
  select count(*) into v_n from public.audit_log
   where action = 'staff.condition_search' and actor_id = v_tied and (event ->> 'basis') = 'tied' and (event ->> 'query_length')::int = 11 and (event ->> 'result_count')::int = 1;
  if v_n < 1 then raise exception 'FAIL 2e: the search was not audited with its length and result count'; end if;
  if exists (select 1 from public.audit_log where action = 'staff.condition_search' and event::text ilike '%S05b%') then
    raise exception 'FAIL 2e: the search term was stored in the audit row';
  end if;

  -- a patient caller is refused; anon cannot execute
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_failed := false; v_sqlstate := null;
  begin perform public.search_patient_ids_by_condition('S05b');
  exception when others then v_failed := true; get stacked diagnostics v_sqlstate = returned_sqlstate; end;
  execute 'reset role';
  if not v_failed or v_sqlstate <> '42501' then raise exception 'FAIL 2f: a patient caller was not refused (sqlstate=%)', v_sqlstate; end if;
  if has_function_privilege('anon', 'public.search_patient_ids_by_condition(text,uuid[],integer)', 'EXECUTE') then
    raise exception 'FAIL 2f: anon can execute the condition search';
  end if;

  -- 3. SABOTAGE: an unescaped, untied search lets a bare % match everything and confirms conditions, so checks 2c and 2g could fail
  create or replace function public.search_patient_ids_by_condition(p_condition text, p_scope uuid[] default null, p_cap integer default 301)
  returns table (patient_id uuid) language sql security definer set search_path = '' as $f$
    select distinct pc.patient_id from public.patient_conditions pc where pc.condition_name ilike '%' || p_condition || '%'
  $f$;
  perform set_config('request.jwt.claims', json_build_object('sub', v_untied, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_n from public.search_patient_ids_by_condition('%%');
  execute 'reset role';
  if v_n = 0 then raise exception 'FAIL SABOTAGE 3: the unescaped search still matched nothing, so check 2c proves nothing'; end if;
  -- the same unscoped version is the oracle: an untied clinician now confirms a condition, so check 2g can fail
  perform set_config('request.jwt.claims', json_build_object('sub', v_untied, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_n from public.search_patient_ids_by_condition('S05b type 2');
  execute 'reset role';
  if v_n = 0 then raise exception 'FAIL SABOTAGE 3: without the tie the untied clinician still learned nothing, so check 2g proves nothing'; end if;

  raise notice 'S05b proof: all checks and the sabotage passed';
end $$;

rollback;
