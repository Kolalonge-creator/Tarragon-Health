-- Proof (S60, spec 12.13, F1 guard symptom_checker_enabled): the recorded regulatory position, and the attestations wired to records.
--
--   1. Only an admin or the CMO can record a position; a patient, an ordinary clinician and anon cannot. Required fields are enforced.
--   2. Positions are append-only history: no edit, no delete; a new one supersedes the previous.
--   3. Read access: admin and CMO only.
--   4. The NAFDAC attestation is REFUSED without a position (and with one whose classification is "not yet determined"), and allowed
--      with a real one. The accuracy-baseline attestation is REFUSED without a baseline report, and allowed with one. A tick written
--      straight into the attestation table without a record still reads as NOT met on the dashboard function.
--   5. The CMO's dashboard function (go_live_guard_status) shows what the record says, for the CMO to read before attesting.
--   6. The guard itself stays OFF and still cannot be switched on by this alone.
--   SABOTAGE: the attestation function patched to skip the position check; the refused attestation must then succeed.
-- Wrapped in BEGIN/ROLLBACK; fails loudly with raise exception.
begin;

create function pg_temp.act(p_uid uuid) returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
end $f$;
create function pg_temp.act_anon() returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
end $f$;
create function pg_temp.back() returns void language plpgsql as
$f$ begin
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.role', '', true);
end $f$;
create function pg_temp.try(p_sql text) returns text language plpgsql as
$f$ begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $f$;
create function pg_temp.scalar(p_sql text) returns text language plpgsql as
$f$ declare v text; begin execute p_sql into v; return v; end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's60r-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test, language)
  values (v, p_org, p_role::public.user_role, 'S60 ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true, 'en')
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone, date_of_birth = excluded.date_of_birth, full_name = excluded.full_name;
  return v;
end $f$;
create function pg_temp.mkstaff(p_org uuid, p_admin uuid, p_label text, p_tier text) returns uuid
language plpgsql as $f$
declare v uuid := pg_temp.mkuser(p_org, p_label, 'clinician');
begin
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, license_expires_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test, languages, specialty)
  values (p_org, v, 'S60 ' || p_label, 'MDCN', 'S60R-' || p_label || '-' || substr(v::text, 1, 8), true, 'active', now() - interval '5 days', now() + interval '1 year', p_admin,
      p_tier::public.doctor_tier, 'contracted', 2, true, p_admin, true, array['en'], 'General practice');
  return v;
end $f$;

do $$
declare
  v_org uuid; v_admin uuid; v_cmo uuid; v_doc uuid; v_pat uuid; v_id1 uuid; v_id2 uuid; v_r text; v_j jsonb; v_def text; v_cond jsonb;
  v_pos text := 'Counsel advises the checker is decision support that routes people to care, provided it is labelled as such. (proof fixture)';
begin
  select organisation_id into v_org from public.profiles where organisation_id is not null group by organisation_id order by count(*) desc limit 1;
  if v_org is null then raise exception 'need an organisation to run this proof'; end if;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  v_cmo := pg_temp.mkstaff(v_org, v_admin, 'cmo', 'chief_medical_officer');
  v_doc := pg_temp.mkstaff(v_org, v_admin, 'doctor', 'medical_officer');
  v_pat := pg_temp.mkuser(v_org, 'patient', 'patient');

  -- 1. who may record
  foreach v_r in array array['patient', 'doctor'] loop
    perform pg_temp.act(case v_r when 'patient' then v_pat else v_doc end);
    if pg_temp.try(format('select public.record_regulatory_position(%L, %L, %L, %L, null, current_date, null)', 'symptom_checker', v_pos, 'decision_support_not_a_device', 'A Counsel')) <> '42501' then
      raise exception 'FAIL 1a: % can record a regulatory position', v_r;
    end if;
    perform pg_temp.back();
  end loop;
  if has_function_privilege('anon', 'public.record_regulatory_position(text,text,text,text,text,date,text)', 'EXECUTE') then raise exception 'FAIL 1b: anon can execute record_regulatory_position'; end if;
  perform pg_temp.act(v_admin);
  if pg_temp.try(format('select public.record_regulatory_position(%L, %L, %L, %L, null, current_date, null)', 'symptom_checker', 'too short', 'decision_support_not_a_device', 'A Counsel')) <> '23514' then
    raise exception 'FAIL 1c: a one-line position was accepted';
  end if;
  if pg_temp.try(format('select public.record_regulatory_position(%L, %L, %L, %L, null, current_date + 5, null)', 'symptom_checker', v_pos, 'decision_support_not_a_device', 'A Counsel')) <> '23514' then
    raise exception 'FAIL 1d: a future-dated position was accepted';
  end if;
  if pg_temp.try(format('select public.record_regulatory_position(%L, %L, %L, null, null, current_date, null)', 'symptom_checker', v_pos, 'decision_support_not_a_device')) <> '22023' then
    raise exception 'FAIL 1e: a position with no counsel was accepted';
  end if;
  perform pg_temp.back();

  -- 4a. nothing recorded yet: attestations that need a record are refused; the others are not
  perform pg_temp.act(v_cmo);
  if pg_temp.try(format('select public.attest_go_live_condition(%L, %L, true, %L)', 'symptom_checker_enabled', 'nafdac_position_recorded', 'Attesting with nothing recorded (proof)')) <> '22023' then
    raise exception 'FAIL 4a: the NAFDAC attestation was accepted with no position recorded';
  end if;
  if pg_temp.try(format('select public.attest_go_live_condition(%L, %L, true, %L)', 'symptom_checker_enabled', 'accuracy_baseline_recorded', 'Attesting with no baseline (proof)')) <> '22023' then
    raise exception 'FAIL 4b: the baseline attestation was accepted with no baseline report';
  end if;
  if pg_temp.try(format('select public.attest_go_live_condition(%L, %L, true, %L)', 'symptom_checker_enabled', 'localisation_signoff_recorded', 'Localisation signed off (proof fixture)')) <> 'ok' then
    raise exception 'FAIL 4c: an attestation with no record behind it should still work';
  end if;
  perform pg_temp.back();

  -- SABOTAGE (placed here, while no position exists): skip the position check; the refused NAFDAC attestation must then succeed.
  -- The original definition is put back straight afterwards, and the sabotage tick withdrawn (attestations are append-only).
  v_def := pg_get_functiondef('public.attest_go_live_condition(text, text, boolean, text)'::regprocedure);
  execute replace(v_def, 'if p_met is true and p_key = ''symptom_checker_enabled'' and p_code = ''nafdac_position_recorded''', 'if false and p_key = ''symptom_checker_enabled'' and p_code = ''nafdac_position_recorded''');
  perform pg_temp.act(v_cmo);
  v_r := pg_temp.try(format('select public.attest_go_live_condition(%L, %L, true, %L)', 'symptom_checker_enabled', 'nafdac_position_recorded', 'Sabotage: check skipped (proof)'));
  perform pg_temp.back();
  if v_r <> 'ok' then raise exception 'VACUOUS TEST: with the position check skipped the attestation was still refused (%)', v_r; end if;
  execute v_def;
  insert into public.go_live_attestations (guard_key, condition_code, met, note, attested_by)
  values ('symptom_checker_enabled', 'nafdac_position_recorded', false, 'proof: withdraw the sabotage tick', v_cmo);
  perform pg_temp.act(v_cmo);
  if pg_temp.try(format('select public.attest_go_live_condition(%L, %L, true, %L)', 'symptom_checker_enabled', 'nafdac_position_recorded', 'Attesting with nothing recorded (proof, again)')) <> '22023' then
    raise exception 'FAIL 4a2: the restored function does not refuse again';
  end if;
  perform pg_temp.back();

  -- 4d. a tick written straight into the table (no record) still reads as not met
  insert into public.go_live_attestations (guard_key, condition_code, met, note, attested_by)
  values ('symptom_checker_enabled', 'nafdac_position_recorded', true, 'forged tick without a record', v_cmo);
  select c into v_cond from jsonb_array_elements(private.go_live_conditions('symptom_checker_enabled', v_org)) c where c ->> 'code' = 'nafdac_position_recorded';
  if (v_cond ->> 'met')::boolean then raise exception 'FAIL 4d: a tick with no position record reads as met'; end if;

  -- 2 + 4e. record one that is "not yet determined": recorded, but it does not satisfy the guard
  perform pg_temp.act(v_admin);
  v_id1 := public.record_regulatory_position('symptom_checker', v_pos, 'not_yet_determined', 'A Counsel', 'Counsel LLP', current_date - 3, 'DEC-S60-1');
  perform pg_temp.back();
  select c into v_cond from jsonb_array_elements(private.go_live_conditions('symptom_checker_enabled', v_org)) c where c ->> 'code' = 'nafdac_position_recorded';
  if (v_cond ->> 'met')::boolean then raise exception 'FAIL 4e: a "not yet determined" position satisfied the condition'; end if;
  perform pg_temp.act(v_cmo);
  if pg_temp.try(format('select public.attest_go_live_condition(%L, %L, true, %L)', 'symptom_checker_enabled', 'nafdac_position_recorded', 'Attesting on an undetermined position (proof)')) <> '22023' then
    raise exception 'FAIL 4f: attested on a position that is not yet determined';
  end if;
  perform pg_temp.back();

  -- the CMO records the determined position; it supersedes the first
  perform pg_temp.act(v_cmo);
  v_id2 := public.record_regulatory_position('symptom_checker', v_pos, 'decision_support_not_a_device', 'A Counsel', 'Counsel LLP', current_date - 1, 'DEC-S60-2');
  perform pg_temp.back();
  if (select supersedes_id from public.regulatory_positions where id = v_id2) is distinct from v_id1 then raise exception 'FAIL 2a: the new position does not supersede the previous one'; end if;
  if pg_temp.try(format('update public.regulatory_positions set position_text = %L where id = %L', repeat('x', 60), v_id2)) <> '42501' then raise exception 'FAIL 2b: a position could be edited'; end if;
  if pg_temp.try(format('delete from public.regulatory_positions where id = %L', v_id2)) <> '42501' then raise exception 'FAIL 2c: a position could be deleted'; end if;

  -- 3. read access
  perform pg_temp.act(v_admin);
  if pg_temp.scalar('select count(id) from public.regulatory_positions') <> '2' then raise exception 'FAIL 3a: the admin cannot read positions'; end if;
  perform pg_temp.back();
  perform pg_temp.act(v_cmo);
  if pg_temp.scalar('select count(id) from public.regulatory_positions') <> '2' then raise exception 'FAIL 3b: the CMO cannot read positions'; end if;
  perform pg_temp.back();
  foreach v_r in array array['patient', 'doctor'] loop
    perform pg_temp.act(case v_r when 'patient' then v_pat else v_doc end);
    if pg_temp.scalar('select count(id) from public.regulatory_positions') <> '0' then raise exception 'FAIL 3c: % can read regulatory positions', v_r; end if;
    perform pg_temp.back();
  end loop;
  perform pg_temp.act_anon();
  if pg_temp.try('select count(id) from public.regulatory_positions') <> '42501' then raise exception 'FAIL 3d: anon can read positions'; end if;
  perform pg_temp.back();

  -- 4g. now the attestation is allowed, and the condition reads met (the earlier forged tick plus a real record: the real one is the latest tick)
  perform pg_temp.act(v_cmo);
  if pg_temp.try(format('select public.attest_go_live_condition(%L, %L, true, %L)', 'symptom_checker_enabled', 'nafdac_position_recorded', 'Counsel position recorded and read by the CMO (proof fixture)')) <> 'ok' then
    raise exception 'FAIL 4g: the NAFDAC attestation was refused although a determined position exists';
  end if;
  v_j := public.go_live_guard_status();
  perform pg_temp.back();
  select c into v_cond from jsonb_array_elements(v_j) g, jsonb_array_elements(g -> 'conditions') c where g ->> 'key' = 'symptom_checker_enabled' and c ->> 'code' = 'nafdac_position_recorded';
  if not (v_cond ->> 'met')::boolean then raise exception 'FAIL 4h: the condition does not read met with a record and an attestation: %', v_cond; end if;
  -- 5. the dashboard shows what the record says
  if v_cond ->> 'detail' not like '%A Counsel%' or v_cond ->> 'detail' not like '%decision support%' then raise exception 'FAIL 5: the dashboard detail does not show the record: %', v_cond; end if;

  -- the baseline: refused, then a baseline report exists, then allowed
  perform private.run_symptom_accuracy_audit(v_org, (date_trunc('month', now()) - interval '1 month')::date, true, v_admin);
  perform pg_temp.act(v_cmo);
  if pg_temp.try(format('select public.attest_go_live_condition(%L, %L, true, %L)', 'symptom_checker_enabled', 'accuracy_baseline_recorded', 'Baseline report exists and was read (proof fixture)')) <> 'ok' then
    raise exception 'FAIL 4i: the baseline attestation was refused although a baseline report exists';
  end if;
  perform pg_temp.back();

  -- 6. the guard is still off and still cannot be switched on (the engine and the SLA are not done)
  if private.go_live_open('symptom_checker_enabled') then raise exception 'FAIL 6a: the guard reads open'; end if;
  perform pg_temp.act(v_cmo);
  if pg_temp.try(format('select public.set_go_live_guard(%L, true, %L)', 'symptom_checker_enabled', 'trying (proof)')) <> '22023' then raise exception 'FAIL 6b: the guard switched on with conditions unmet'; end if;
  perform pg_temp.back();

  raise notice 'PASS: regulatory position recorded by admin or CMO only, append-only, attestations refused without a record and allowed with one, dashboard shows the record';
end $$;

rollback;
