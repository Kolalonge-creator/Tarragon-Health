-- ===========================================================================
-- Proof: *_prescription_requires_quantity_and_duration.sql.
--
-- Proves, with simulated sessions: a tied prescriber is refused (22023) when the quantity is missing or blank, the duration is missing, zero or negative,
-- and nothing is written; a call with both succeeds and stores a trimmed quantity; an UNTIED clinician with no quantity still gets the authorisation
-- refusal (42501), not the validation message; amending a prescription that already has both works with only the changed field; amending an older
-- prescription that has neither is refused until the clinician supplies them, then succeeds and carries them forward; a blank quantity cannot be used to
-- clear an existing one. SABOTAGE: with the checks removed from a copy of prescribe_medication a prescription without quantity is accepted.
-- Wrapped in BEGIN/ROLLBACK; mints its own fixtures.
-- ===========================================================================

begin;

-- The prescribing guard (S37 enforcement) is off by default; this proof is about something else, so switch it on inside the rolled-back test.
insert into public.go_live_guard_log (guard_key, action, actor_id, actor_role, note) select 'prescribing_enabled', 'switched_on', id, 'cmo', 'proof setup' from public.profiles limit 1;
update public.go_live_guards set is_on = true, changed_at = now(), changed_by = (select id from public.profiles limit 1), change_note = 'proof setup' where key = 'prescribing_enabled';

do $$
declare
  v_org uuid;
  v_pat uuid := gen_random_uuid();
  v_smo uuid := gen_random_uuid();
  v_untied uuid := gen_random_uuid();
  v_id uuid; v_id2 uuid; v_legacy uuid;
  v_row record;
  v_state text;
  v_n integer;
  v_def text;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  select u, 'rxqty-' || substr(u::text, 1, 8) || '@example.invalid', 'x', now(), '{}', '{}' from unnest(array[v_pat, v_smo, v_untied]) u;
  insert into public.profiles (id, organisation_id, role, full_name, phone) values
    (v_pat,    v_org, 'patient',   'RxQty Patient',  '+2348058880901'),
    (v_smo,    v_org, 'clinician', 'RxQty Tied SMO', '+2348058880902'),
    (v_untied, v_org, 'clinician', 'RxQty Untied',   '+2348058880903')
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, full_name = excluded.full_name;
  insert into public.patient_allergies (organisation_id, patient_id, allergen, source) values (v_org, v_pat, 'proof-allergen-none', 'clinician');
  insert into public.clinical_staff (organisation_id, profile_id, full_name, active, license_verified_at, doctor_tier,
                                     credential_type, credential_number, indemnity_insurer, indemnity_policy_number, indemnity_expires_at) values
    (v_org, v_smo,    'RxQty Tied SMO', true, now(), 'senior_medical_officer', 'MDCN', 'RXQTY-1', 'Probe', 'RXQ-1', now() + interval '1 year'),
    (v_org, v_untied, 'RxQty Untied',   true, now(), 'senior_medical_officer', 'MDCN', 'RXQTY-2', 'Probe', 'RXQ-2', now() + interval '1 year');
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id, assigned_at)
  values (v_org, v_pat, v_smo, now()) on conflict (patient_id) do update set clinician_id = v_smo;

  perform set_config('request.jwt.claims', json_build_object('sub', v_smo, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  -- 1. missing or blank quantity, missing / zero / negative duration: refused, nothing written
  begin perform public.prescribe_medication(v_pat, 'RxQty Drug', p_duration_days => 7);
  exception when invalid_parameter_value then v_state := 'q-null-refused'; end;
  if v_state is distinct from 'q-null-refused' then raise exception 'FAIL: a prescription without quantity was accepted'; end if;
  v_state := null;
  begin perform public.prescribe_medication(v_pat, 'RxQty Drug', p_duration_days => 7, p_quantity => '   ');
  exception when invalid_parameter_value then v_state := 'q-blank-refused'; end;
  if v_state is distinct from 'q-blank-refused' then raise exception 'FAIL: a blank quantity was accepted'; end if;
  v_state := null;
  begin perform public.prescribe_medication(v_pat, 'RxQty Drug', p_quantity => '7 tablets');
  exception when invalid_parameter_value then v_state := 'd-null-refused'; end;
  if v_state is distinct from 'd-null-refused' then raise exception 'FAIL: a prescription without duration was accepted'; end if;
  v_state := null;
  begin perform public.prescribe_medication(v_pat, 'RxQty Drug', p_duration_days => 0, p_quantity => '7 tablets');
  exception when invalid_parameter_value then v_state := 'd-zero-refused'; end;
  if v_state is distinct from 'd-zero-refused' then raise exception 'FAIL: a zero duration was accepted'; end if;
  v_state := null;
  begin perform public.prescribe_medication(v_pat, 'RxQty Drug', p_duration_days => -3, p_quantity => '7 tablets');
  exception when invalid_parameter_value then v_state := 'd-neg-refused'; end;
  if v_state is distinct from 'd-neg-refused' then raise exception 'FAIL: a negative duration was accepted'; end if;
  execute 'reset role';
  select count(*) into v_n from public.medications where drug_name = 'RxQty Drug';
  if v_n <> 0 then raise exception 'FAIL: a refused prescription wrote % rows', v_n; end if;

  -- 2. both present: accepted, quantity trimmed
  perform set_config('request.jwt.claims', json_build_object('sub', v_smo, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_id := public.prescribe_medication(v_pat, 'RxQty Drug', p_duration_days => 30, p_quantity => '  30 tablets ', p_repeats_allowed => 1);
  execute 'reset role';
  select quantity, duration_days into v_row from public.medications where id = v_id;
  if v_row.quantity <> '30 tablets' or v_row.duration_days <> 30 then raise exception 'FAIL: stored values wrong: %', v_row; end if;

  -- 3. an untied clinician with no quantity still gets the authorisation refusal, not the validation message
  perform set_config('request.jwt.claims', json_build_object('sub', v_untied, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin perform public.prescribe_medication(v_pat, 'RxQty Drug');
  exception when insufficient_privilege then v_state := 'untied-42501'; when others then v_state := 'other:' || sqlstate; end;
  execute 'reset role';
  if v_state is distinct from 'untied-42501' then raise exception 'FAIL: untied caller got % instead of the authorisation refusal', v_state; end if;

  -- 4. amend: only the changed field is needed when the prescription already has both
  perform set_config('request.jwt.claims', json_build_object('sub', v_smo, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_id2 := public.amend_medication(v_id, 'Dose change', p_dose => '10mg');
  execute 'reset role';
  select quantity, duration_days, version into v_row from public.medications where id = v_id2;
  if v_row.quantity <> '30 tablets' or v_row.duration_days <> 30 or v_row.version <> 2 then raise exception 'FAIL: amendment lost quantity or duration: %', v_row; end if;

  -- 5. amend an older prescription that never had them: refused until supplied, then carried forward
  perform set_config('request.jwt.claims', null, true);
  insert into public.medications (organisation_id, patient_id, drug_name, dose, frequency, source, is_active, added_by)
  values (v_org, v_pat, 'RxQty Legacy', '5mg', 'daily', 'clinician', true, v_smo) returning id into v_legacy;
  perform set_config('request.jwt.claims', json_build_object('sub', v_smo, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_state := null;
  begin perform public.amend_medication(v_legacy, 'Review', p_dose => '10mg');
  exception when invalid_parameter_value then v_state := 'legacy-refused'; end;
  if v_state is distinct from 'legacy-refused' then execute 'reset role'; raise exception 'FAIL: amending a prescription with no quantity or duration was accepted'; end if;
  v_state := null;
  begin perform public.amend_medication(v_legacy, 'Review', p_quantity => '30 tablets');
  exception when invalid_parameter_value then v_state := 'legacy-no-duration-refused'; end;
  if v_state is distinct from 'legacy-no-duration-refused' then execute 'reset role'; raise exception 'FAIL: an amendment without a duration was accepted'; end if;
  v_id2 := public.amend_medication(v_legacy, 'Review', p_quantity => '30 tablets', p_duration_days => 30);
  -- a blank quantity cannot clear an existing one
  v_id := public.amend_medication(v_id2, 'Again', p_quantity => '   ');
  execute 'reset role';
  select quantity, duration_days into v_row from public.medications where id = v_id;
  if v_row.quantity <> '30 tablets' or v_row.duration_days <> 30 then raise exception 'FAIL: legacy amendment values wrong: %', v_row; end if;

  -- SABOTAGE: without the checks a prescription with no quantity is accepted
  select replace(replace(pg_get_functiondef('public.prescribe_medication(uuid,text,text,text,date,jsonb,uuid,text,integer,text,integer,text,text,boolean,text)'::regprocedure),
                 'if coalesce(btrim(p_quantity), '''') = '''' then', 'if false then'),
                 'if p_duration_days is null or p_duration_days <= 0 then', 'if false then') into v_def;
  if v_def not like '%if false then%if false then%' then raise exception 'SABOTAGE not applied'; end if;
  execute v_def;
  perform set_config('request.jwt.claims', json_build_object('sub', v_smo, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_id := public.prescribe_medication(v_pat, 'RxQty Sabotage');
  execute 'reset role';
  select count(*) into v_n from public.medications where id = v_id and quantity is null;
  if v_n <> 1 then raise exception 'SABOTAGE not effective: the unchecked function did not accept a prescription without quantity'; end if;

  raise notice 'prescription quantity + duration required: all assertions passed';
end $$;

rollback;
