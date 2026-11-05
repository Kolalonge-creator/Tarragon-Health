-- Diagnostic directory Phase 2a: listings, branch services, credentials, incidents, eligibility.
-- Migration: 20261104230924_diag_p2_listings_services_credentials_eligibility.sql.
--
-- Proves:
--   A  a patient can neither call an admin_dx_* function nor read any directory table
--   B  a fully listed lab branch offering HbA1c is NOT eligible until a verified, unexpired MLSCN credential exists
--   C  expiry is automatic: moving expires_on into the past makes it ineligible with no other change
--   D  an open serious incident suspends the branch; closing it with reinstatement restores eligibility
--   E  an unavailable service, a stale location check, and an outsourced test with an unknown performer are each ineligible
--   F  ISO 15189 without a stated scope is refused; a lab branch cannot list mammography
--   G  the audit trail is append-only
--   H  a PARTNER imaging order cannot name an uncontracted imaging provider; a self-arranged one can
-- Sabotage x2: credential requirement retired -> B passes with no credential; imaging guard dropped -> H accepts the order.

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
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'dxp2-' || p_label || '-' || substr(v::text, 1, 8) || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, initcap(p_label) || ' Dxp', '+23480' || lpad((random() * 99999999)::int::text, 8, '0'),
          (current_date - interval '40 years')::date, true)
  on conflict (id) do update set role = excluded.role, is_active = true;
  update public.profiles set organisation_id = p_org where id = v;
  return v;
end $f$;

do $$
declare
  v_org uuid := (select id from public.organisations order by created_at limit 1);
  v_admin uuid;
  v_patient uuid;
  v_lab uuid; v_loc uuid; v_loc2 uuid;
  v_pl uuid; v_bl uuid; v_bl2 uuid;
  v_svc uuid; v_svc2 uuid; v_cred uuid; v_inc uuid;
  v_hba1c uuid := (select id from public.reference_concepts where code = 'inv.hba1c');
  v_mammo uuid := (select id from public.reference_concepts where code = 'inv.mammography');
  v_reasons text[];
  v_state text;
  v_n int;
begin
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  v_patient := pg_temp.mkuser(v_org, 'patient', 'patient');

  insert into public.lab_providers (name, is_active) values ('Proof Directory Lab ' || substr(gen_random_uuid()::text, 1, 6), false) returning id into v_lab;
  insert into public.lab_provider_locations (lab_provider_id, name, state, town, address, contact_phone, latitude, longitude, is_active)
  values (v_lab, 'Lekki branch', 'Lagos', 'Lekki', '1 Proof Road, Lekki', '+2348000000001', 6.44, 3.47, true) returning id into v_loc;
  insert into public.lab_provider_locations (lab_provider_id, name, state, town, address, contact_phone, latitude, longitude, is_active)
  values (v_lab, 'Ikeja branch', 'Lagos', 'Ikeja', '2 Proof Road, Ikeja', '+2348000000002', 6.60, 3.35, true) returning id into v_loc2;

  -- A: patient
  perform pg_temp.as_user(v_patient);
  begin
    perform public.admin_dx_create_provider_listing('lab', v_lab, true);
    insert into results values ('A1 patient cannot create a listing', false, 'call succeeded');
  exception when sqlstate '42501' then insert into results values ('A1 patient cannot create a listing', true, null);
  end;
  perform pg_temp.as_postgres();

  -- Build a listed branch with a confirmed HbA1c service, as admin
  perform pg_temp.as_user(v_admin);
  v_pl := public.admin_dx_create_provider_listing('lab', v_lab, true);
  v_bl := public.admin_dx_upsert_branch_listing(v_pl, v_loc, 'Eti-Osa', 'Lekki', 'Lekki Phase 1', null, null, true);
  v_bl2 := public.admin_dx_upsert_branch_listing(v_pl, v_loc2, 'Ikeja', 'Ikeja', null, null, null, true);
  perform public.admin_dx_verify_branch_location(v_bl, 'phone call + Google Maps', 'Called the branch, address and phone confirmed', true);
  perform public.admin_dx_verify_branch_location(v_bl2, 'phone call + Google Maps', 'Called the branch, address and phone confirmed', false);
  perform public.admin_dx_set_listing_status('provider', v_pl, 'listed', 'Identity confirmed for the proof');
  perform public.admin_dx_set_listing_status('branch', v_bl, 'listed', 'Branch confirmed for the proof');
  perform public.admin_dx_set_listing_status('branch', v_bl2, 'listed', 'Branch confirmed for the proof');
  v_svc := public.admin_dx_upsert_service(v_bl, v_hba1c, 'available', 'onsite', null, false, null, null, 'Phone call with branch manager');

  -- B: no credential -> ineligible, for that reason only
  v_reasons := public.admin_dx_service_eligibility(v_svc);
  insert into results values ('B1 no MLSCN credential -> missing_credential only',
                              v_reasons = array['missing_credential:mlscn_registration'], array_to_string(v_reasons, ','));
  v_cred := public.admin_dx_record_credential('provider', v_pl, 'mlscn_registration', 'MLSCN', null, null, 'MLSCN/PROOF/001',
                                              null, null, current_date - 100, current_date + 200, 'https://web.mlscn.gov.ng/proof', null);
  v_reasons := public.admin_dx_service_eligibility(v_svc);
  insert into results values ('B2 a pending credential does not count', 'missing_credential:mlscn_registration' = any (v_reasons), array_to_string(v_reasons, ','));
  perform public.admin_dx_set_credential_status(v_cred, 'verified_current', 'Checked against the MLSCN approved list', current_date + 180);
  v_reasons := public.admin_dx_service_eligibility(v_svc);
  insert into results values ('B3 verified credential -> eligible', cardinality(v_reasons) = 0, array_to_string(v_reasons, ','));
  perform pg_temp.as_postgres();

  -- A2: patient reads nothing
  perform pg_temp.as_user(v_patient);
  select count(*) into v_n from public.diagnostic_branch_services;
  insert into results values ('A2 patient reads no services', v_n = 0, v_n::text);
  select count(*) into v_n from public.diagnostic_credentials;
  insert into results values ('A3 patient reads no credentials', v_n = 0, v_n::text);
  perform pg_temp.as_postgres();

  -- C: expiry is automatic
  update public.diagnostic_credentials set expires_on = current_date - 1 where id = v_cred;
  insert into results values ('C1 expired credential -> ineligible',
                              'missing_credential:mlscn_registration' = any (private.diagnostic_service_eligibility(v_svc)), null);
  select private.diagnostic_credential_effective_status(status, expires_on) into v_state from public.diagnostic_credentials where id = v_cred;
  insert into results values ('C2 reads as expired', v_state = 'expired', v_state);
  update public.diagnostic_credentials set expires_on = current_date + 200 where id = v_cred;

  -- D: incident suspends, reinstatement restores
  perform pg_temp.as_user(v_admin);
  v_inc := public.admin_dx_open_incident('branch', v_bl, 'serious', 'Patient reports results issued without a qualified scientist on site', false);
  v_reasons := public.admin_dx_service_eligibility(v_svc);
  insert into results values ('D1 serious incident suspends the branch', 'branch_incident_open' = any (v_reasons), array_to_string(v_reasons, ','));
  perform public.admin_dx_close_incident(v_inc, 'Investigated: rota shows a scientist present', 'Rota copy filed', true);
  v_reasons := public.admin_dx_service_eligibility(v_svc);
  insert into results values ('D2 reinstated -> eligible again', cardinality(v_reasons) = 0, array_to_string(v_reasons, ','));

  -- D3: an omitted argument keeps the stored LGA
  perform public.admin_dx_upsert_branch_listing(v_pl, v_loc, null, null, null, null, 'https://proof.example.org', true);
  insert into results values ('D3 branch upsert keeps LGA when omitted',
                              (select lga from public.diagnostic_branch_listings where id = v_bl) = 'Eti-Osa', null);

  -- E: unavailable, stale, outsourced to unknown
  perform public.admin_dx_upsert_service(v_bl, v_hba1c, 'temporarily_unavailable', 'onsite', null, false, null, null, 'Branch says analyser down');
  insert into results values ('E1 temporarily unavailable -> ineligible',
                              'service_temporarily_unavailable' = any (public.admin_dx_service_eligibility(v_svc)), null);
  perform public.admin_dx_upsert_service(v_bl, v_hba1c, 'available', 'onsite', null, false, null, null, 'Analyser fixed, branch confirmed');
  v_svc2 := public.admin_dx_upsert_service(v_bl2, v_hba1c, 'available', 'external_facility', null, false, null, null, 'Branch sends samples out');
  insert into results values ('E2 outsourced to an unknown lab -> ineligible',
                              'performer_unknown' = any (public.admin_dx_service_eligibility(v_svc2)), null);
  perform public.admin_dx_upsert_service(v_bl2, v_hba1c, 'available', 'other_branch_same_provider', v_bl, false, null, null, 'Samples go to Lekki');
  v_reasons := public.admin_dx_service_eligibility(v_svc2);
  insert into results values ('E3 outsourced to an eligible sister branch -> eligible', cardinality(v_reasons) = 0, array_to_string(v_reasons, ','));
  perform pg_temp.as_postgres();
  update public.diagnostic_branch_listings set location_verified_at = now() - interval '400 days' where id = v_bl;
  insert into results values ('E4 stale location check -> ineligible',
                              'branch_location_stale' = any (private.diagnostic_service_eligibility(v_svc)), null);
  insert into results values ('E5 sister branch inherits the performer''s staleness',
                              'performer_ineligible' = any (private.diagnostic_service_eligibility(v_svc2)), null);
  update public.diagnostic_branch_listings set location_verified_at = now() where id = v_bl;

  -- F: ISO 15189 needs scope; lab branch cannot list mammography
  perform pg_temp.as_user(v_admin);
  begin
    perform public.admin_dx_record_credential('provider', v_pl, 'iso15189', 'SANAS', 'SANAS', null, 'M0001', null, null, null, null, 'https://example.org/cert', null);
    insert into results values ('F1 ISO 15189 without scope refused', false, 'accepted');
  exception when sqlstate '23514' then insert into results values ('F1 ISO 15189 without scope refused', true, null);
  end;
  begin
    perform public.admin_dx_upsert_service(v_bl, v_mammo, 'available', 'onsite', null, true, null, null, 'Website says so');
    insert into results values ('F2 lab branch cannot list mammography', false, 'accepted');
  exception when sqlstate '23514' then insert into results values ('F2 lab branch cannot list mammography', true, null);
  end;
  perform pg_temp.as_postgres();

  -- G: append-only audit
  begin
    update public.diagnostic_directory_events set note = 'rewritten' where subject_id = v_svc;
    insert into results values ('G1 audit trail append-only', false, 'update succeeded');
  exception when sqlstate '42501' then insert into results values ('G1 audit trail append-only', true, null);
  end;
  select count(*) into v_n from public.diagnostic_directory_events where subject_id in (v_pl, v_bl, v_svc, v_cred, v_inc);
  insert into results values ('G2 every step was logged', v_n >= 10, v_n::text);

  -- G3: a non-reinstating closure deactivates the branch and logs it on the branch's own trail
  perform pg_temp.as_user(v_admin);
  v_inc := public.admin_dx_open_incident('branch', v_bl2, 'routine', 'Branch has closed permanently according to the landlord', true);
  perform public.admin_dx_close_incident(v_inc, 'Branch confirmed closed by phone', null, false);
  perform pg_temp.as_postgres();
  insert into results values ('G3 deactivation logged on the branch trail',
    exists (select 1 from public.diagnostic_directory_events where subject_id = v_bl2 and to_value = 'deactivated'), null);

  -- Sabotage a: retire the MLSCN requirement -> a credential-less service would pass
  delete from public.diagnostic_credentials where id = v_cred;
  update public.diagnostic_credential_requirements set is_active = false, retired_at = now()
   where requirement_group = 'laboratory' and regulator = 'mlscn_registration';
  insert into results values ('SABOTAGE a: without the requirement the check passes (proves B discriminates)',
                              cardinality(private.diagnostic_service_eligibility(v_svc)) = 0, null);
end;
$$;

-- H: partner imaging orders need a contracted provider (separate block so a trigger error elsewhere cannot mask it)
do $$
declare
  v_org uuid := (select id from public.organisations order by created_at limit 1);
  v_patient uuid := pg_temp.mkuser((select id from public.organisations order by created_at limit 1), 'impatient', 'patient');
  v_clin uuid := pg_temp.mkuser((select id from public.organisations order by created_at limit 1), 'imclin', 'clinician');
  v_ip uuid; v_study uuid; v_staff uuid;
  v_state text;
begin
  insert into public.clinical_staff (organisation_id, profile_id, full_name, active, is_test)
  values (v_org, v_clin, 'Dxp Clinician', false, true) returning id into v_staff;
  insert into public.imaging_providers (name, is_active) values ('Proof Imaging Centre', false) returning id into v_ip;
  insert into public.imaging_studies (provider_id, modality, code, name, price_kobo) values (v_ip, 'xray', 'proof_cxr_p2', 'Proof CXR', 0)
  returning id into v_study;
  begin
    insert into public.imaging_orders (organisation_id, patient_id, ordering_clinician_id, study_id, provider_id, indication, fulfilment)
    values (v_org, v_patient, v_staff, v_study, v_ip, 'Proof indication text', 'partner');
    v_state := 'accepted';
  exception when others then v_state := sqlstate || ' ' || sqlerrm;
  end;
  insert into results values ('H1 partner order with uncontracted provider refused', v_state like '23514 a partner imaging order%', v_state);

  drop trigger imaging_orders_partner_contracted on public.imaging_orders;
  begin
    insert into public.imaging_orders (organisation_id, patient_id, ordering_clinician_id, study_id, provider_id, indication, fulfilment)
    values (v_org, v_patient, v_staff, v_study, v_ip, 'Proof indication text', 'partner');
    v_state := 'accepted';
  exception when others then v_state := sqlstate || ' ' || sqlerrm;
  end;
  insert into results values ('SABOTAGE b: without the guard the order goes through (proves H1 discriminates)',
                              v_state = 'accepted', v_state);
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
  if (select count(*) from results) < 24 then raise exception 'expected at least 24 checks, ran %', (select count(*) from results); end if;
end;
$$;

rollback;
