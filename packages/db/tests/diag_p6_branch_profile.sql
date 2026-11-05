-- Diagnostic directory Phase 6: the public branch profile. Migration: 20261105095359_diag_p6_branch_profile.sql.
--
-- Proves:
--   A  anon cannot call it; a real user is refused while the directory guard is off
--   B  a listed branch shows only the tests it passes every check for (an awaiting-confirmation test is left out)
--   C  a draft branch, and a branch of a suspended provider, return nothing
--   D  a test listing is hidden from a real user
--   E  no internal field (evidence, verifier, contract, credential number, note) is in the profile
--   F  once the credential expires, the branch shows no tests
-- Sabotage: with eligibility always true, the awaiting test appears (proves B discriminates).

begin;

create temp table results (check_name text, ok boolean, detail text);
grant all on results to public;

create function pg_temp.as_user(p_uid uuid) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  set local role authenticated;
end $f$;
create function pg_temp.as_postgres() returns void language plpgsql as $f$
begin
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text, p_test boolean) returns uuid language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'dxp6-' || p_label || '-' || substr(v::text, 1, 8) || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, initcap(p_label) || ' Dxp', '+23480' || lpad((random() * 99999999)::int::text, 8, '0'),
          (current_date - interval '40 years')::date, p_test)
  on conflict (id) do update set role = excluded.role, is_active = true, is_test = excluded.is_test;
  update public.profiles set organisation_id = p_org where id = v;
  return v;
end $f$;
create function pg_temp.profile(p_uid uuid, p_branch uuid) returns text language plpgsql as $f$
declare v jsonb;
begin
  perform pg_temp.as_user(p_uid);
  v := public.diagnostic_branch_profile(p_branch);
  perform pg_temp.as_postgres();
  return coalesce(v::text, 'null');
exception when others then
  perform pg_temp.as_postgres();
  return 'ERR ' || sqlstate;
end $f$;

do $$
declare
  v_org uuid := (select id from public.organisations order by created_at limit 1);
  v_admin uuid; v_real uuid;
  v_lab uuid; v_lab2 uuid; v_pl uuid; v_pl2 uuid; v_cred uuid; v_cred2 uuid; v_loc uuid; v_bl uuid; v_draft uuid; v_testbl uuid;
  v_hba1c uuid := (select id from public.reference_concepts where code = 'inv.hba1c');
  v_fbc uuid := (select id from public.reference_concepts where code = 'inv.fbc');
  v text; v_j jsonb;
begin
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin', false);
  v_real := pg_temp.mkuser(v_org, 'real', 'patient', false);

  insert into public.lab_providers (name, is_active) values ('Proof P6 Lab ' || substr(gen_random_uuid()::text, 1, 6), false) returning id into v_lab;
  insert into public.lab_providers (name, is_active) values ('Proof P6 Test Lab ' || substr(gen_random_uuid()::text, 1, 6), false) returning id into v_lab2;
  perform pg_temp.as_user(v_admin);
  v_pl := public.admin_dx_create_provider_listing('lab', v_lab, false);
  v_pl2 := public.admin_dx_create_provider_listing('lab', v_lab2, true);
  perform public.admin_dx_set_listing_status('provider', v_pl, 'listed', 'Identity confirmed for the proof');
  perform public.admin_dx_set_listing_status('provider', v_pl2, 'listed', 'Identity confirmed for the proof');
  v_cred := public.admin_dx_record_credential('provider', v_pl, 'mlscn_registration', 'MLSCN', null, null, 'MLSCN/PROOF/P6',
                                              null, null, current_date - 100, current_date + 200, 'https://web.mlscn.gov.ng/proof', null);
  perform public.admin_dx_set_credential_status(v_cred, 'verified_current', 'Checked against the MLSCN approved list', current_date + 180);
  v_cred2 := public.admin_dx_record_credential('provider', v_pl2, 'mlscn_registration', 'MLSCN', null, null, 'MLSCN/PROOF/P6T',
                                               null, null, current_date - 100, current_date + 200, 'https://web.mlscn.gov.ng/proof', null);
  perform public.admin_dx_set_credential_status(v_cred2, 'verified_current', 'Checked against the MLSCN approved list', current_date + 180);
  perform pg_temp.as_postgres();

  insert into public.lab_provider_locations (lab_provider_id, name, state, town, address, contact_phone, latitude, longitude, is_active)
  values (v_lab, 'Listed branch', 'Lagos', 'Ikeja', '1 Proof Road, Ikeja', '+2348000000061', 6.60, 3.35, true) returning id into v_loc;
  perform pg_temp.as_user(v_admin);
  v_bl := public.admin_dx_upsert_branch_listing(v_pl, v_loc, 'Ikeja', 'Ikeja', null, null, null, false);
  perform public.admin_dx_verify_branch_location(v_bl, 'phone call + Google Maps', 'Called the branch, address and phone confirmed', true);
  perform public.admin_dx_set_listing_status('branch', v_bl, 'listed', 'Branch confirmed for the proof');
  perform public.admin_dx_upsert_service(v_bl, v_hba1c, 'available', 'onsite', null, false, 'No fasting needed', null, 'Phone call with branch manager');
  perform public.admin_dx_upsert_service(v_bl, v_fbc, 'awaiting_confirmation', 'onsite', null, false, null, null, 'Imported, not yet confirmed');
  perform pg_temp.as_postgres();
  insert into public.lab_provider_locations (lab_provider_id, name, state, town, address, contact_phone, latitude, longitude, is_active)
  values (v_lab, 'Draft branch', 'Lagos', 'Yaba', '2 Proof Road, Yaba', '+2348000000062', 6.51, 3.38, true) returning id into v_loc;
  perform pg_temp.as_user(v_admin);
  v_draft := public.admin_dx_upsert_branch_listing(v_pl, v_loc, 'Yaba', 'Yaba', null, null, null, false);
  perform pg_temp.as_postgres();
  insert into public.lab_provider_locations (lab_provider_id, name, state, town, address, contact_phone, latitude, longitude, is_active)
  values (v_lab2, 'Test branch', 'Lagos', 'Ikeja', '3 Proof Road, Ikeja', '+2348000000063', 6.60, 3.35, true) returning id into v_loc;
  perform pg_temp.as_user(v_admin);
  v_testbl := public.admin_dx_upsert_branch_listing(v_pl2, v_loc, 'Ikeja', 'Ikeja', null, null, null, true);
  perform public.admin_dx_verify_branch_location(v_testbl, 'phone call + Google Maps', 'Called the branch, address and phone confirmed', true);
  perform public.admin_dx_set_listing_status('branch', v_testbl, 'listed', 'Branch confirmed for the proof');
  perform pg_temp.as_postgres();

  -- A
  insert into results values ('A1 anon cannot call the profile', not has_function_privilege('anon', 'public.diagnostic_branch_profile(uuid)', 'EXECUTE'), null);
  set local session_replication_role = replica;
  update public.go_live_guards set is_on = false where key = 'directory_enabled';
  set local session_replication_role = origin;
  v := pg_temp.profile(v_real, v_bl);
  insert into results values ('A2 a real user is refused while the directory is off', v = 'ERR 55000', v);
  set local session_replication_role = replica;
  update public.go_live_guards set is_on = true, changed_at = now(), changed_by = v_admin, change_note = 'Opened inside the P6 proof transaction'
   where key = 'directory_enabled';
  set local session_replication_role = origin;

  -- B, E
  v_j := pg_temp.profile(v_real, v_bl)::jsonb;
  insert into results values ('B1 only the test that passes every check is listed',
    (select string_agg(x ->> 'test', ',') from jsonb_array_elements(v_j -> 'services') x)
      = (select display from public.reference_concepts where id = v_hba1c), v_j::text);
  insert into results values ('B2 the preparation note and location-checked date are shown',
    v_j -> 'services' -> 0 ->> 'preparation_note' = 'No fasting needed' and v_j ->> 'location_checked_on' is not null, null);
  insert into results values ('E1 no internal field is returned',
    v_j::text !~* '(evidence|verified_by|contracted|is_active|MLSCN/PROOF|status_reason|confirmed_by|commission)', v_j::text);

  -- C, D
  v := pg_temp.profile(v_real, v_draft);
  insert into results values ('C1 a draft branch returns nothing', v = 'null', v);
  v := pg_temp.profile(v_real, v_testbl);
  insert into results values ('D1 a test listing is hidden from a real user', v = 'null', v);

  -- F
  update public.diagnostic_credentials set expires_on = current_date - 1 where id = v_cred;
  v_j := pg_temp.profile(v_real, v_bl)::jsonb;
  insert into results values ('F1 after the credential expires the branch shows no tests', jsonb_array_length(v_j -> 'services') = 0, v_j::text);
  update public.diagnostic_credentials set expires_on = current_date + 200 where id = v_cred;

  -- C2 (suspends the provider: last)
  perform pg_temp.as_user(v_admin);
  perform public.admin_dx_set_listing_status('provider', v_pl, 'suspended', 'Suspended for the proof after a complaint');
  perform pg_temp.as_postgres();
  v := pg_temp.profile(v_real, v_bl);
  insert into results values ('C2 a branch of a suspended provider returns nothing', v = 'null', v);
  perform pg_temp.as_user(v_admin);
  perform public.admin_dx_set_listing_status('provider', v_pl, 'listed', 'Reinstated for the proof sabotage step');
  perform pg_temp.as_postgres();

  -- Sabotage
  create or replace function private.diagnostic_service_eligible(p_service_id uuid) returns boolean language sql stable as $s$ select true $s$;
  v_j := pg_temp.profile(v_real, v_bl)::jsonb;
  insert into results values ('SABOTAGE: with eligibility always true the awaiting test appears (proves B1 discriminates)',
    jsonb_array_length(v_j -> 'services') = 2, v_j::text);
end;
$$;

do $$
declare r record; v_fail int := 0;
begin
  for r in select * from results order by check_name loop
    raise notice '% % %', case when r.ok then 'PASS' else 'FAIL' end, r.check_name, coalesce(r.detail, '');
    if not r.ok then v_fail := v_fail + 1; end if;
  end loop;
  if v_fail > 0 then raise exception '% check(s) failed', v_fail; end if;
  if (select count(*) from results) < 10 then raise exception 'expected at least 10 checks, ran %', (select count(*) from results); end if;
end;
$$;

rollback;
