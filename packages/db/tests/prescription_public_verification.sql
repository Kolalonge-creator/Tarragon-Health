-- ===========================================================================
-- Proof: *_prescription_public_verification_token.sql (prescription PDF phase 2, no-login verification).
--
-- Proves: every clinician prescription gets a distinct 64-hex public_token at insert and a patient-sourced row gets none; an ANONYMOUS caller
-- holding the token gets proof (status, Rx number, drug, dose, repeats, prescriber) and the function's result has no patient column at all;
-- an unknown token, a malformed token, an upper-cased token, NULL, and a token on a non-clinician row each return zero rows; the status
-- follows superseded / expired / cancelled / active; the patient cannot rewrite their own token. SABOTAGE: a copy of the function without the
-- clinician filter answers for a patient-sourced row, which the real function refuses, so the check is not vacuous.
-- Wrapped in BEGIN/ROLLBACK; mints its own fixtures.
-- ===========================================================================

begin;

do $$
declare
  v_org uuid;
  v_pat uuid := gen_random_uuid();
  v_doc uuid := gen_random_uuid();
  v_m1 uuid; v_m2 uuid; v_m3 uuid; v_m4 uuid; v_self uuid;
  v_t1 text; v_t2 text; v_tself text;
  v_n integer;
  v_status text;
  v_cols text;
  v_failed boolean;
  r record;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  select u, 'rxpub-' || substr(u::text, 1, 8) || '@example.invalid', 'x', now(), '{}', '{}' from unnest(array[v_pat, v_doc]) u;
  insert into public.profiles (id, organisation_id, role, full_name, phone) values
    (v_pat, v_org, 'patient',   'RxPub Patient', '+2348058880501'),
    (v_doc, v_org, 'clinician', 'RxPub Doctor',  '+2348058880502')
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, full_name = excluded.full_name;
  insert into public.clinical_staff (organisation_id, profile_id, full_name, active, license_verified_at, doctor_tier,
                                     credential_type, credential_number, indemnity_insurer, indemnity_policy_number, indemnity_expires_at)
  values (v_org, v_doc, 'RxPub Doctor', true, now(), 'senior_medical_officer', 'MDCN', 'RXPUB-77', 'Probe', 'RXPUB-1', now() + interval '1 year');

  -- added_by is server-stamped from auth.uid(), so the inserts run as the prescriber
  perform set_config('request.jwt.claims', json_build_object('sub', v_doc, 'role', 'authenticated')::text, true);
  insert into public.medications (organisation_id, patient_id, drug_name, dose, frequency, source, added_by, repeats_allowed)
  values (v_org, v_pat, 'RxPub Amlodipine', '5 mg', 'Once daily', 'clinician', v_doc, 2) returning id, public_token into v_m1, v_t1;
  insert into public.medications (organisation_id, patient_id, drug_name, dose, frequency, source, added_by)
  values (v_org, v_pat, 'RxPub Metformin', '500 mg', 'Twice daily', 'clinician', v_doc) returning id, public_token into v_m2, v_t2;
  insert into public.medications (organisation_id, patient_id, drug_name, dose, frequency, source, added_by)
  values (v_org, v_pat, 'RxPub Third', '1 mg', 'Daily', 'clinician', v_doc) returning id into v_m3;
  insert into public.medications (organisation_id, patient_id, drug_name, dose, frequency, source, added_by)
  values (v_org, v_pat, 'RxPub Fourth', '1 mg', 'Daily', 'clinician', v_doc) returning id into v_m4;
  insert into public.medications (organisation_id, patient_id, drug_name, dose, frequency, source, added_by)
  values (v_org, v_pat, 'RxPub Self Added', '1 tab', 'Daily', 'patient', v_pat) returning id, public_token into v_self, v_tself;

  perform set_config('request.jwt.claims', '', true);

  -- 1. stamping
  if v_t1 !~ '^[0-9a-f]{64}$' or v_t2 !~ '^[0-9a-f]{64}$' then raise exception 'FAIL: clinician prescription has no 64-hex token (%, %)', v_t1, v_t2; end if;
  if v_t1 = v_t2 then raise exception 'FAIL: two prescriptions share a token'; end if;
  if v_tself is not null then raise exception 'FAIL: a patient-sourced row received a token'; end if;

  -- 2. anonymous holder of the token gets proof
  execute 'set local role anon';
  select * into r from public.verify_prescription_public(v_t1);
  execute 'reset role';
  if r.status is distinct from 'active' or r.drug_name <> 'RxPub Amlodipine' or r.dose <> '5 mg'
     or r.repeats_allowed <> 2 or r.repeats_remaining <> 2 or r.prescriber_name <> 'RxPub Doctor'
     or r.prescriber_credential is distinct from 'MDCN RXPUB-77' then
    raise exception 'FAIL: proof content wrong: %', r;
  end if;

  -- 3. the result carries no patient identifier, by construction
  select string_agg(a, ',') into v_cols
    from unnest((select proargnames from pg_proc where oid = 'public.verify_prescription_public(text)'::regprocedure)) a
   where a ~* 'patient|dob|birth|phone|email|address|number$' and a <> 'rx_number';
  if v_cols is not null then raise exception 'FAIL: result exposes identifier-like columns: %', v_cols; end if;

  -- 4. nothing else answers
  execute 'set local role anon';
  select count(*) into v_n from public.verify_prescription_public(repeat('0', 64));
  if v_n <> 0 then execute 'reset role'; raise exception 'FAIL: unknown token answered'; end if;
  select count(*) into v_n from public.verify_prescription_public('not-a-token');
  if v_n <> 0 then execute 'reset role'; raise exception 'FAIL: malformed token answered'; end if;
  select count(*) into v_n from public.verify_prescription_public(upper(v_t1));
  if v_n <> 0 then execute 'reset role'; raise exception 'FAIL: upper-cased token answered'; end if;
  select count(*) into v_n from public.verify_prescription_public(null);
  if v_n <> 0 then execute 'reset role'; raise exception 'FAIL: null token answered'; end if;
  select count(*) into v_n from public.verify_prescription_public(substr(v_t1, 1, 32));
  if v_n <> 0 then execute 'reset role'; raise exception 'FAIL: truncated token answered'; end if;
  execute 'reset role';

  -- anon cannot read the table directly
  execute 'set local role anon';
  v_failed := false;
  begin perform 1 from public.medications limit 1; exception when insufficient_privilege then v_failed := true; end;
  execute 'reset role';
  if not v_failed then raise exception 'FAIL: anon read medications'; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_doc, 'role', 'authenticated')::text, true);
  -- 5. a token set on a non-clinician row is still refused
  update public.medications set public_token = repeat('a', 64) where id = v_self;
  select count(*) into v_n from public.verify_prescription_public(repeat('a', 64));
  if v_n <> 0 then raise exception 'FAIL: non-clinician row answered'; end if;

  -- 6. status follows the row
  update public.medications set superseded_at = now(), is_active = false where id = v_m2;
  select status into v_status from public.verify_prescription_public(v_t2);
  if v_status <> 'superseded' then raise exception 'FAIL: superseded read as %', v_status; end if;
  update public.medications set expires_at = now() - interval '1 day' where id = v_m3;
  select status into v_status from public.verify_prescription_public((select public_token from public.medications where id = v_m3));
  if v_status <> 'expired' then raise exception 'FAIL: expired read as %', v_status; end if;
  update public.medications set is_active = false where id = v_m4;
  select status into v_status from public.verify_prescription_public((select public_token from public.medications where id = v_m4));
  if v_status <> 'cancelled' then raise exception 'FAIL: stopped read as %', v_status; end if;

  -- 7. the patient cannot rewrite their own token
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_failed := false;
  begin update public.medications set public_token = repeat('b', 64) where id = v_m1; exception when others then v_failed := true; end;
  execute 'reset role';
  if not v_failed then raise exception 'FAIL: patient rewrote their own public_token'; end if;

  -- SABOTAGE: without the clinician filter the function answers for a patient-sourced row
  create or replace function pg_temp.verify_unfiltered(p_token text) returns integer language sql as
    $f$ select count(*)::integer from public.medications m where m.public_token = p_token $f$;
  if pg_temp.verify_unfiltered(repeat('a', 64)) <> 1 then raise exception 'SABOTAGE not effective'; end if;

  raise notice 'prescription public verification: all assertions passed';
end $$;

rollback;
