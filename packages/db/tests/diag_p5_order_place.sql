-- Diagnostic directory Phase 5: a doctor suggests where to have an ordered test done.
-- Migration: 20261105093851_diag_p5_order_suggested_place.sql.
--
-- Proves:
--   A  a patient, and a clinician of another organisation, cannot suggest a place
--   B  a clinician suggests an eligible lab branch; the patient reads it, the first read stamps viewed_at, a second read
--      does not move it; staff and the service role read it without stamping
--   C  a branch that is not recommendable (draft) is refused
--   D  an imaging order refuses a lab branch and a test other than the ordered study
--   E  a new suggestion withdraws the old one (one active per order, history kept)
--   F  once the branch's credential expires, the suggestion reads as no longer recommendable
--   G  another patient cannot read it
--   H  a closed (cancelled) order refuses a suggestion
--   I  withdrawal needs a reason; after it the order has no suggestion
--   J  a suggestion changes nothing on the order (fulfilment, provider, location)
--   K  the imaging request folio names the ordering doctor for the patient only; a forged service_role JWT claim reads nothing
-- Sabotage: with eligibility always true, the draft branch is accepted (proves C discriminates).

begin;

create temp table results (check_name text, ok boolean, detail text);
grant all on results to public;
create temp table fx (fk text primary key, fv uuid);
grant all on fx to public;

create function pg_temp.as_user(p_uid uuid) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  set local role authenticated;
end $f$;
create function pg_temp.as_service() returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  perform set_config('request.jwt.claim.sub', '', true);
  set local role service_role;
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
  values (v, 'dxp5-' || p_label || '-' || substr(v::text, 1, 8) || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, initcap(p_label) || ' Dxp', '+23480' || lpad((random() * 99999999)::int::text, 8, '0'),
          (current_date - interval '40 years')::date, true)
  on conflict (id) do update set role = excluded.role, is_active = true;
  update public.profiles set organisation_id = p_org where id = v;
  return v;
end $f$;
create function pg_temp.id(p_k text) returns uuid language sql as $f$ select fv from fx where fk = p_k $f$;
create function pg_temp.try_suggest(p_kind text, p_order uuid, p_branch uuid, p_concept uuid) returns text language plpgsql as $f$
begin
  perform public.clinician_suggest_place(p_kind, p_order, p_branch, p_concept);
  return 'ok';
exception when others then return sqlstate;
end $f$;

do $$
declare
  v_org uuid := (select id from public.organisations order by created_at limit 1);
  v_org2 uuid;
  v_admin uuid; v_clin uuid; v_clin2 uuid; v_pat uuid; v_pat2 uuid;
  v_lab uuid; v_pl uuid; v_cred uuid; v_loc uuid; v_bl uuid; v_bl_draft uuid;
  v_hba1c uuid := (select id from public.reference_concepts where code = 'inv.hba1c');
  v_xray uuid := (select id from public.reference_concepts where modality = 'xray' and not is_ambiguous and investigation_category is not null order by code limit 1);
  v_ip uuid; v_study uuid; v_lab_order uuid; v_lab_order2 uuid; v_img_order uuid;
  v_bundle uuid := (select id from public.panel_bundles order by created_at limit 1);
  v_j jsonb; v_j2 jsonb; v_s text; v_n int; v_sug uuid;
begin
  insert into public.organisations (name, type) select 'Proof other org ' || substr(gen_random_uuid()::text, 1, 6), type from public.organisations where id = v_org returning id into v_org2;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  v_clin := pg_temp.mkuser(v_org, 'clin', 'clinician');
  v_clin2 := pg_temp.mkuser(v_org2, 'clin2', 'clinician');
  v_pat := pg_temp.mkuser(v_org, 'pat', 'patient');
  v_pat2 := pg_temp.mkuser(v_org, 'pat2', 'patient');

  -- Fixtures inserted directly (billing, routing and staffing triggers are not what this proof is about)
  set local session_replication_role = replica;
  insert into public.clinical_staff (organisation_id, profile_id, full_name, active, is_test, doctor_tier, employment_type, license_verified_at)
  values (v_org, v_clin, 'Dxp Clin', true, true, 'senior_medical_officer', 'employed', now()),
         (v_org2, v_clin2, 'Dxp Clin2', true, true, 'senior_medical_officer', 'employed', now());
  insert into public.lab_orders (organisation_id, patient_id, panel_bundle_id, total_kobo, status, origin, clinical_indication)
  values (v_org, v_pat, v_bundle, 0, 'ordered', 'clinically_triggered', 'Proof indication') returning id into v_lab_order;
  insert into public.lab_orders (organisation_id, patient_id, panel_bundle_id, total_kobo, status, origin, clinical_indication)
  values (v_org, v_pat, v_bundle, 0, 'cancelled', 'clinically_triggered', 'Proof indication') returning id into v_lab_order2;
  insert into public.imaging_providers (name, is_active) values ('Proof P5 Imaging', false) returning id into v_ip;
  insert into public.imaging_studies (provider_id, modality, code, name, price_kobo, concept_id)
  values (v_ip, 'xray', 'proof_p5_xray', 'Proof X-ray', 0, v_xray) returning id into v_study;
  insert into public.imaging_orders (organisation_id, patient_id, ordering_clinician_id, study_id, indication, urgency)
  values (v_org, v_pat, (select id from public.clinical_staff where profile_id = v_clin), v_study, 'Proof indication text', 'routine')
  returning id into v_img_order;
  set local session_replication_role = origin;

  -- A listed, eligible lab branch, and a draft one, both doing HbA1c
  insert into public.lab_providers (name, is_active) values ('Proof P5 Lab ' || substr(gen_random_uuid()::text, 1, 6), false) returning id into v_lab;
  perform pg_temp.as_user(v_admin);
  v_pl := public.admin_dx_create_provider_listing('lab', v_lab, false);
  perform public.admin_dx_set_listing_status('provider', v_pl, 'listed', 'Identity confirmed for the proof');
  v_cred := public.admin_dx_record_credential('provider', v_pl, 'mlscn_registration', 'MLSCN', null, null, 'MLSCN/PROOF/P5',
                                              null, null, current_date - 100, current_date + 200, 'https://web.mlscn.gov.ng/proof', null);
  perform public.admin_dx_set_credential_status(v_cred, 'verified_current', 'Checked against the MLSCN approved list', current_date + 180);
  perform pg_temp.as_postgres();
  insert into public.lab_provider_locations (lab_provider_id, name, state, town, address, contact_phone, latitude, longitude, is_active)
  values (v_lab, 'Listed branch', 'Lagos', 'Ikeja', '1 Proof Road, Ikeja', '+2348000000051', 6.60, 3.35, true) returning id into v_loc;
  perform pg_temp.as_user(v_admin);
  v_bl := public.admin_dx_upsert_branch_listing(v_pl, v_loc, 'Ikeja', 'Ikeja', null, null, null, false);
  perform public.admin_dx_verify_branch_location(v_bl, 'phone call + Google Maps', 'Called the branch, address and phone confirmed', true);
  perform public.admin_dx_set_listing_status('branch', v_bl, 'listed', 'Branch confirmed for the proof');
  perform public.admin_dx_upsert_service(v_bl, v_hba1c, 'available', 'onsite', null, false, 'Fasting not needed', null, 'Phone call with branch manager');
  perform pg_temp.as_postgres();
  insert into public.lab_provider_locations (lab_provider_id, name, state, town, address, contact_phone, latitude, longitude, is_active)
  values (v_lab, 'Draft branch', 'Lagos', 'Yaba', '2 Proof Road, Yaba', '+2348000000052', 6.51, 3.38, true) returning id into v_loc;
  perform pg_temp.as_user(v_admin);
  v_bl_draft := public.admin_dx_upsert_branch_listing(v_pl, v_loc, 'Yaba', 'Yaba', null, null, null, false);
  perform public.admin_dx_upsert_service(v_bl_draft, v_hba1c, 'available', 'onsite', null, false, null, null, 'Phone call with branch manager');
  perform pg_temp.as_postgres();

  -- A
  perform pg_temp.as_user(v_pat);
  v_s := pg_temp.try_suggest('lab', v_lab_order, v_bl, v_hba1c);
  perform pg_temp.as_postgres();
  insert into results values ('A1 a patient cannot suggest a place', v_s = '42501', v_s);
  perform pg_temp.as_user(v_clin2);
  v_s := pg_temp.try_suggest('lab', v_lab_order, v_bl, v_hba1c);
  perform pg_temp.as_postgres();
  insert into results values ('A2 a clinician of another organisation cannot', v_s = '42501', v_s);

  -- C, D, H
  perform pg_temp.as_user(v_clin);
  v_s := pg_temp.try_suggest('lab', v_lab_order, v_bl_draft, v_hba1c);
  insert into results values ('C1 a draft branch is refused', v_s = '23514', v_s);
  v_s := pg_temp.try_suggest('imaging', v_img_order, v_bl, v_hba1c);
  insert into results values ('D1 an imaging order refuses a lab branch or another test', v_s = '22023', v_s);
  v_s := pg_temp.try_suggest('lab', v_lab_order2, v_bl, v_hba1c);
  insert into results values ('H1 a cancelled order refuses a suggestion', v_s = '22023', v_s);

  -- B
  v_s := pg_temp.try_suggest('lab', v_lab_order, v_bl, v_hba1c);
  insert into results values ('B1 a clinician suggests an eligible branch', v_s = 'ok', v_s);
  v_j := public.order_suggested_place('lab', v_lab_order);
  perform pg_temp.as_postgres();
  insert into results values ('B2 staff read it without stamping viewed_at', v_j ->> 'branch_name' = 'Listed branch' and v_j ->> 'viewed_at' is null, v_j::text);
  perform pg_temp.as_service();
  v_j := public.order_suggested_place('lab', v_lab_order);
  perform pg_temp.as_postgres();
  insert into results values ('B3 the service role reads it without stamping', v_j ->> 'test' is not null and v_j ->> 'viewed_at' is null, null);
  perform pg_temp.as_user(v_pat);
  v_j := public.order_suggested_place('lab', v_lab_order);
  v_j2 := public.order_suggested_place('lab', v_lab_order);
  perform pg_temp.as_postgres();
  insert into results values ('B4 the patient reads it, still recommendable, with the preparation note',
    (v_j ->> 'still_recommendable')::boolean and v_j ->> 'preparation_note' = 'Fasting not needed', v_j::text);
  insert into results values ('B5 the first patient read stamps viewed_at and a second does not move it',
    v_j ->> 'viewed_at' is not null and v_j ->> 'viewed_at' = v_j2 ->> 'viewed_at', null);

  -- G
  perform pg_temp.as_user(v_pat2);
  begin
    v_j := public.order_suggested_place('lab', v_lab_order);
    v_s := 'returned';
  exception when others then v_s := sqlstate;
  end;
  perform pg_temp.as_postgres();
  insert into results values ('G1 another patient cannot read it', v_s = '42501', v_s);

  -- E
  perform pg_temp.as_user(v_clin);
  v_s := pg_temp.try_suggest('lab', v_lab_order, v_bl, v_hba1c);
  perform pg_temp.as_postgres();
  select count(*) into v_n from public.diagnostic_order_suggestions where lab_order_id = v_lab_order;
  insert into results values ('E1 a new suggestion keeps the old one, withdrawn',
    v_s = 'ok' and v_n = 2 and (select count(*) from public.diagnostic_order_suggestions where lab_order_id = v_lab_order and withdrawn_at is null) = 1,
    v_n::text);

  -- J
  insert into results values ('J1 the order itself is unchanged',
    (select fulfilment::text = 'self_arranged' and provider_id is null and location_id is null from public.lab_orders where id = v_lab_order), null);

  -- F
  update public.diagnostic_credentials set expires_on = current_date - 1 where id = v_cred;
  perform pg_temp.as_user(v_pat);
  v_j := public.order_suggested_place('lab', v_lab_order);
  perform pg_temp.as_postgres();
  insert into results values ('F1 after the credential expires the suggestion reads as no longer recommendable',
    not (v_j ->> 'still_recommendable')::boolean, v_j ->> 'still_recommendable');
  update public.diagnostic_credentials set expires_on = current_date + 200 where id = v_cred;

  -- I
  select id into v_sug from public.diagnostic_order_suggestions where lab_order_id = v_lab_order and withdrawn_at is null;
  perform pg_temp.as_user(v_clin);
  begin
    perform public.clinician_withdraw_place(v_sug, '');
    v_s := 'ok';
  exception when others then v_s := sqlstate;
  end;
  insert into results values ('I1 withdrawal needs a reason', v_s = '22023', v_s);
  perform public.clinician_withdraw_place(v_sug, 'Patient prefers a branch near work');
  v_j := public.order_suggested_place('lab', v_lab_order);
  perform pg_temp.as_postgres();
  insert into results values ('I2 after withdrawal the order has no suggestion', v_j is null, coalesce(v_j::text, 'null'));

  -- K: imaging request folio, and a forged service-role claim
  perform pg_temp.as_user(v_pat);
  select string_agg(full_name, ',') into v_s from public.clinician_folio_for_document('imaging_request', array[v_img_order]);
  perform pg_temp.as_postgres();
  insert into results values ('K1 the patient gets the ordering doctor on the imaging request', v_s = 'Dxp Clin', v_s);
  perform pg_temp.as_user(v_pat2);
  begin
    perform public.clinician_folio_for_document('imaging_request', array[v_img_order]);
    v_s := 'returned';
  exception when others then v_s := sqlstate;
  end;
  perform pg_temp.as_postgres();
  insert into results values ('K2 another patient is refused the imaging folio', v_s = '42501', v_s);
  perform pg_temp.as_user(v_clin);
  perform public.clinician_suggest_place('lab', v_lab_order, v_bl, v_hba1c);
  perform pg_temp.as_postgres();
  perform pg_temp.as_user(v_pat2);
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat2, 'role', 'service_role')::text, true);
  begin
    perform public.order_suggested_place('lab', v_lab_order);
    v_s := 'returned';
  exception when others then v_s := sqlstate;
  end;
  perform pg_temp.as_postgres();
  insert into results values ('K3 a forged service_role claim does not read another patient''s suggestion', v_s = '42501', v_s);

  -- Sabotage: eligibility always true -> the draft branch is accepted
  create or replace function private.diagnostic_service_eligible(p_service_id uuid) returns boolean language sql stable as $s$ select true $s$;
  perform pg_temp.as_user(v_clin);
  v_s := pg_temp.try_suggest('lab', v_lab_order, v_bl_draft, v_hba1c);
  perform pg_temp.as_postgres();
  insert into results values ('SABOTAGE: with eligibility always true the draft branch is accepted (proves C1 discriminates)', v_s = 'ok', v_s);
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
  if (select count(*) from results) < 20 then raise exception 'expected at least 20 checks, ran %', (select count(*) from results); end if;
end;
$$;

rollback;
