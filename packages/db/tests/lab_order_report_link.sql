-- Tarragon Health: request to report (migration 20261105164553_lab_order_report_link).
--
-- Proves, as the real roles, in a transaction that is always rolled back:
--   1. a patient's upload made from an open request carries that request onto the intake row (source 'upload'); uploading alone
--      does not close the request;
--   2. a clinician's review of that report closes it: 'resulted', resulted_at stamped;
--   3. the matcher links a loose upload when exactly one open request shares a test inside the window (an older request for the same
--      test, outside 90 days, is not a second candidate), and pushes the order down to the store row;
--   4. the matcher leaves a report alone when two open requests fit;
--   5. a patient links it by hand to one of their own requests; they cannot link it to another patient's request, to a cancelled
--      request, or link another patient's document; nobody can write the column directly;
--   6. "answers no request" (declined) clears the link and the matcher never re-links it;
--   7. a multi-test request closes only when the filed reports linked to it cover every test (a 'will_not_do' test counts);
--   8. a request with a result S27 still holds is not closed by a reviewed upload (S27's invariant);
--   9. the candidates list shows the patient's requests with the matching one flagged, and refuses another patient.
--
-- Sabotage (in-script, step 10): drop the completion trigger; a reviewed, linked report then leaves its request open, and the same
-- check that passed in step 2 must fail.
--
-- Run: supabase db query --linked -f packages/db/tests/lab_order_report_link.sql   (or psql -v ON_ERROR_STOP=1 -f ...)

begin;

create or replace function pg_temp.assert_resulted(p_order uuid, p_label text) returns void language plpgsql as $$
begin
  if (select status from public.lab_orders where id = p_order) is distinct from 'resulted'
     or (select resulted_at from public.lab_orders where id = p_order) is null then
    raise exception 'FAIL %: the request is % (expected resulted with resulted_at)', p_label,
      (select status from public.lab_orders where id = p_order);
  end if;
end $$;

create or replace function pg_temp.cd_for(p_lrd uuid) returns public.clinical_documents language sql as $$
  select * from public.clinical_documents where routed_table = 'lab_result_documents' and routed_id = p_lrd
$$;

do $$
declare
  v_org uuid;
  v_admin uuid;
  v_pat uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_doc uuid := gen_random_uuid();
  v_staff uuid;
  b_hba1c uuid; b_fbc uuid; b_lipid uuid; b_diab uuid;
  o_hba1c uuid; o_fbc_new uuid; o_fbc_old uuid; o_lip1 uuid; o_lip2 uuid; o_diab uuid; o_held uuid; o_other uuid; o_cancel uuid;
  d1 uuid; d2 uuid; d3 uuid; d4 uuid; d5 uuid; d6 uuid; d7 uuid;
  cd public.clinical_documents;
  v_failed boolean;
  v_n integer;
  v_out jsonb;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  select id into v_admin from public.profiles where organisation_id = v_org and role = 'admin' limit 1;
  select id into b_hba1c from public.panel_bundles where code = 'single_hba1c';
  select id into b_fbc from public.panel_bundles where code = 'single_fbc';
  select id into b_lipid from public.panel_bundles where code = 'single_lipid_panel';
  select id into b_diab from public.panel_bundles where code = 'diabetes_check';
  if b_hba1c is null or b_fbc is null or b_lipid is null or b_diab is null then raise exception 'SETUP: bundles missing'; end if;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v_pat, 'lorl-pat@example.invalid', 'x', now(), '{}', '{}'),
         (v_other, 'lorl-other@example.invalid', 'x', now(), '{}', '{}'),
         (v_doc, 'lorl-doc@example.invalid', 'x', now(), '{}', '{}');
  update public.profiles set organisation_id = v_org, role = 'patient', full_name = 'Lorl Patient', is_test = true, sex = 'female',
         date_of_birth = date '1975-01-01' where id = v_pat;
  update public.profiles set organisation_id = v_org, role = 'patient', full_name = 'Lorl Other', is_test = true, sex = 'male',
         date_of_birth = date '1975-01-01' where id = v_other;
  update public.profiles set organisation_id = v_org, role = 'clinician', full_name = 'Lorl Doctor', is_test = true where id = v_doc;
  insert into public.clinical_staff (profile_id, organisation_id, full_name, doctor_tier, active, credential_type, credential_number,
                                     indemnity_exempt, indemnity_exempt_by, verified_by, license_verified_at)
  values (v_doc, v_org, 'Lorl Doctor', 'senior_medical_officer', true, 'MDCN', 'LORL-001', true, v_admin, v_admin, now())
  returning id into v_staff;

  insert into public.lab_orders (organisation_id, patient_id, panel_bundle_id, origin, ordered_by, clinical_indication, status, fulfilment, ordered_at)
  values (v_org, v_pat, b_hba1c, 'clinically_triggered', v_staff, 'proof', 'ordered', 'self_arranged', now() - interval '3 days')
  returning id into o_hba1c;
  insert into public.lab_orders (organisation_id, patient_id, panel_bundle_id, origin, ordered_by, clinical_indication, status, fulfilment, ordered_at)
  values (v_org, v_pat, b_fbc, 'clinically_triggered', v_staff, 'proof', 'ordered', 'self_arranged', now() - interval '5 days')
  returning id into o_fbc_new;
  insert into public.lab_orders (organisation_id, patient_id, panel_bundle_id, origin, ordered_by, clinical_indication, status, fulfilment, ordered_at)
  values (v_org, v_pat, b_fbc, 'clinically_triggered', v_staff, 'proof', 'ordered', 'self_arranged', now() - interval '200 days')
  returning id into o_fbc_old;
  insert into public.lab_orders (organisation_id, patient_id, panel_bundle_id, origin, ordered_by, clinical_indication, status, fulfilment, ordered_at)
  values (v_org, v_pat, b_lipid, 'clinically_triggered', v_staff, 'proof', 'ordered', 'self_arranged', now() - interval '4 days')
  returning id into o_lip1;
  insert into public.lab_orders (organisation_id, patient_id, panel_bundle_id, origin, ordered_by, clinical_indication, status, fulfilment, ordered_at)
  values (v_org, v_pat, b_lipid, 'clinically_triggered', v_staff, 'proof', 'ordered', 'self_arranged', now() - interval '6 days')
  returning id into o_lip2;
  insert into public.lab_orders (organisation_id, patient_id, panel_bundle_id, origin, ordered_by, clinical_indication, status, fulfilment, ordered_at)
  values (v_org, v_pat, b_diab, 'clinically_triggered', v_staff, 'proof', 'ordered', 'self_arranged', now() - interval '2 days')
  returning id into o_diab;
  insert into public.lab_orders (organisation_id, patient_id, panel_bundle_id, origin, ordered_by, clinical_indication, status, fulfilment, ordered_at)
  values (v_org, v_pat, b_hba1c, 'clinically_triggered', v_staff, 'proof', 'ordered', 'self_arranged', now() - interval '400 days')
  returning id into o_held;
  insert into public.lab_orders (organisation_id, patient_id, panel_bundle_id, origin, ordered_by, clinical_indication, status, fulfilment, ordered_at)
  values (v_org, v_pat, b_hba1c, 'clinically_triggered', v_staff, 'proof', 'cancelled', 'self_arranged', now() - interval '400 days')
  returning id into o_cancel;
  -- force_safe_patient_lab_order_insert opens every non-staff insert as 'ordered'; cancel it afterwards
  update public.lab_orders set status = 'cancelled' where id = o_cancel;
  insert into public.lab_orders (organisation_id, patient_id, panel_bundle_id, origin, ordered_by, clinical_indication, status, fulfilment, ordered_at)
  values (v_org, v_other, b_fbc, 'clinically_triggered', v_staff, 'proof', 'ordered', 'self_arranged', now() - interval '1 day')
  returning id into o_other;

  -- 1. upload from the open HbA1c request: the intake carries it; the request stays open
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.lab_result_documents (organisation_id, patient_id, lab_order_id, file_path, original_filename, mime_type, file_size_bytes, source, test_code)
  values (v_org, v_pat, o_hba1c, v_pat::text || '/1.pdf', '1.pdf', 'application/pdf', 1000, 'patient', 'hba1c') returning id into d1;
  reset role;
  perform set_config('request.jwt.claims', null, true);
  cd := pg_temp.cd_for(d1);
  if cd.lab_order_id is distinct from o_hba1c or cd.lab_order_link_source is distinct from 'upload' then
    raise exception 'FAIL 1: intake link is % / % (expected the HbA1c request, upload)', cd.lab_order_id, cd.lab_order_link_source;
  end if;
  if (select status from public.lab_orders where id = o_hba1c) <> 'ordered' then
    raise exception 'FAIL 1: uploading alone moved the request to %', (select status from public.lab_orders where id = o_hba1c);
  end if;

  -- 2. a clinician reviews it: the request closes
  perform set_config('request.jwt.claims', json_build_object('sub', v_doc, 'role', 'authenticated')::text, true);
  update public.lab_result_documents set reviewed_at = now() where id = d1;
  perform set_config('request.jwt.claims', null, true);
  perform pg_temp.assert_resulted(o_hba1c, '2');

  -- 3. a loose FBC upload: one open FBC request in the window (the 200-day-old one is outside it): linked automatically, pushed down
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.lab_result_documents (organisation_id, patient_id, file_path, original_filename, mime_type, file_size_bytes, source, test_code)
  values (v_org, v_pat, v_pat::text || '/2.pdf', '2.pdf', 'application/pdf', 1000, 'patient', 'fbc') returning id into d2;
  reset role;
  perform set_config('request.jwt.claims', null, true);
  cd := pg_temp.cd_for(d2);
  if cd.lab_order_id is distinct from o_fbc_new or cd.lab_order_link_source is distinct from 'auto' then
    raise exception 'FAIL 3: the loose FBC upload linked to % / % (expected the recent FBC request, auto)', cd.lab_order_id, cd.lab_order_link_source;
  end if;
  if (select lab_order_id from public.lab_result_documents where id = d2) is distinct from o_fbc_new then
    raise exception 'FAIL 3: the automatic link was not pushed down to the store row';
  end if;

  -- 4. two open lipid requests fit: nothing is linked
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.lab_result_documents (organisation_id, patient_id, file_path, original_filename, mime_type, file_size_bytes, source, test_code)
  values (v_org, v_pat, v_pat::text || '/3.pdf', '3.pdf', 'application/pdf', 1000, 'patient', 'lipid_panel') returning id into d3;
  reset role;
  perform set_config('request.jwt.claims', null, true);
  cd := pg_temp.cd_for(d3);
  if cd.lab_order_id is not null then raise exception 'FAIL 4: an ambiguous report was linked automatically to %', cd.lab_order_id; end if;

  -- 9 (before 5). the candidates list: both lipid requests, and the diabetes check (it includes a lipid panel), flagged as matching;
  --    another patient is refused
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from public.lab_order_link_candidates(cd.id) c where c.tests_match;
  if v_n <> 3 then reset role; raise exception 'FAIL 9: % matching candidates, expected the 2 lipid requests and the diabetes check', v_n; end if;
  if exists (select 1 from public.lab_order_link_candidates(cd.id) c where c.lab_order_id in (o_cancel, o_other)) then
    reset role; raise exception 'FAIL 9: a cancelled or another patient''s request is offered';
  end if;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_other, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_failed := false;
  begin perform * from public.lab_order_link_candidates(cd.id); exception when sqlstate '42501' then v_failed := true; end;
  reset role;
  if not v_failed then raise exception 'FAIL 9: another patient listed this patient''s requests'; end if;

  -- 5. the patient links it by hand
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_out := public.link_clinical_document_to_lab_order(cd.id, o_lip1);
  -- not another patient's request
  v_failed := false;
  begin perform public.link_clinical_document_to_lab_order(cd.id, o_other); exception when sqlstate '42501' then v_failed := true; end;
  if not v_failed then reset role; raise exception 'FAIL 5: a patient linked their report to another patient''s request'; end if;
  -- not a cancelled request
  v_failed := false;
  begin perform public.link_clinical_document_to_lab_order(cd.id, o_cancel); exception when sqlstate '22023' then v_failed := true; end;
  if not v_failed then reset role; raise exception 'FAIL 5: a report was linked to a cancelled request'; end if;
  -- nobody writes the column directly
  v_failed := false;
  begin update public.clinical_documents set lab_order_id = o_lip2 where id = cd.id; exception when sqlstate '42501' then v_failed := true; end;
  if not v_failed then reset role; raise exception 'FAIL 5: a signed-in patient updated clinical_documents directly'; end if;
  reset role;
  perform set_config('request.jwt.claims', null, true);
  cd := pg_temp.cd_for(d3);
  if cd.lab_order_id is distinct from o_lip1 or cd.lab_order_link_source <> 'patient' or cd.lab_order_linked_by is distinct from v_pat then
    raise exception 'FAIL 5: the hand link is % / % / %', cd.lab_order_id, cd.lab_order_link_source, cd.lab_order_linked_by;
  end if;
  if (select lab_order_id from public.lab_result_documents where id = d3) is distinct from o_lip1 then
    raise exception 'FAIL 5: the hand link was not pushed down';
  end if;
  -- another patient cannot touch this document
  perform set_config('request.jwt.claims', json_build_object('sub', v_other, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_failed := false;
  begin perform public.link_clinical_document_to_lab_order(cd.id, null); exception when sqlstate '42501' then v_failed := true; end;
  reset role;
  if not v_failed then raise exception 'FAIL 5: another patient changed this patient''s link'; end if;

  -- 6. declined: cleared, pushed down, and the matcher never re-links it
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.link_clinical_document_to_lab_order(cd.id, null);
  reset role;
  perform set_config('request.jwt.claims', null, true);
  update public.lab_result_documents set reviewed_at = now(), reviewed_by = v_doc where id = d3;   -- a status change re-runs the matcher
  cd := pg_temp.cd_for(d3);
  if cd.lab_order_id is not null or cd.lab_order_link_source <> 'declined' then
    raise exception 'FAIL 6: after declining, link is % / %', cd.lab_order_id, cd.lab_order_link_source;
  end if;
  if (select lab_order_id from public.lab_result_documents where id = d3) is not null then
    raise exception 'FAIL 6: declining did not clear the store row';
  end if;
  if (select status from public.lab_orders where id = o_lip1) <> 'ordered' then
    raise exception 'FAIL 6: an unlinked report closed the request';
  end if;

  -- 7. multi-test request (HbA1c, OGTT/FPG, lipid): one filed report does not close it; a second plus a will_not_do does
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.lab_result_documents (organisation_id, patient_id, lab_order_id, file_path, original_filename, mime_type, file_size_bytes, source, test_code)
  values (v_org, v_pat, o_diab, v_pat::text || '/4.pdf', '4.pdf', 'application/pdf', 1000, 'patient', 'hba1c') returning id into d4;
  insert into public.lab_result_documents (organisation_id, patient_id, lab_order_id, file_path, original_filename, mime_type, file_size_bytes, source, test_code)
  values (v_org, v_pat, o_diab, v_pat::text || '/5.pdf', '5.pdf', 'application/pdf', 1000, 'patient', 'ogtt_fpg') returning id into d5;
  reset role;
  perform set_config('request.jwt.claims', null, true);
  update public.lab_result_documents set reviewed_at = now(), reviewed_by = v_doc where id = d4;
  if (select status from public.lab_orders where id = o_diab) = 'resulted' then
    raise exception 'FAIL 7: one test of three closed the whole request';
  end if;
  insert into public.lab_order_test_status (lab_order_id, organisation_id, test_code, status) values (o_diab, v_org, 'lipid_panel', 'will_not_do');
  update public.lab_result_documents set reviewed_at = now(), reviewed_by = v_doc where id = d5;
  perform pg_temp.assert_resulted(o_diab, '7');

  -- 8. a held S27 result on the request keeps it open, whatever else is reviewed
  perform private.submit_lab_result(v_pat, o_held, null, null,
    jsonb_build_object('file_path', v_pat::text || '/s27.pdf', 'original_filename', 's27.pdf', 'mime_type', 'application/pdf', 'file_size_bytes', 1000),
    'tarragon_team', v_doc, null);
  if (select status from public.lab_orders where id = o_held) <> 'processing' then
    raise exception 'FAIL 8 setup: the held S27 result left the request %', (select status from public.lab_orders where id = o_held);
  end if;
  select * into cd from public.clinical_documents where routed_table = 'lab_result_files' and patient_id = v_pat;
  if cd.lab_order_id is distinct from o_held then
    raise exception 'FAIL 8: the S27 file''s intake did not inherit the request (got %)', cd.lab_order_id;
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.lab_result_documents (organisation_id, patient_id, lab_order_id, file_path, original_filename, mime_type, file_size_bytes, source, test_code)
  values (v_org, v_pat, o_held, v_pat::text || '/6.pdf', '6.pdf', 'application/pdf', 1000, 'patient', 'hba1c') returning id into d6;
  reset role;
  perform set_config('request.jwt.claims', null, true);
  update public.lab_result_documents set reviewed_at = now(), reviewed_by = v_doc where id = d6;
  if (select status from public.lab_orders where id = o_held) = 'resulted' then
    raise exception 'FAIL 8: a reviewed upload closed a request whose S27 result is still held';
  end if;

  -- 10. SABOTAGE: without the completion trigger, the step-2 check must fail
  drop trigger zz_lab_order_link_after on public.clinical_documents;
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.lab_result_documents (organisation_id, patient_id, lab_order_id, file_path, original_filename, mime_type, file_size_bytes, source, test_code)
  values (v_org, v_pat, o_lip2, v_pat::text || '/7.pdf', '7.pdf', 'application/pdf', 1000, 'patient', 'lipid_panel') returning id into d7;
  reset role;
  perform set_config('request.jwt.claims', null, true);
  update public.lab_result_documents set reviewed_at = now(), reviewed_by = v_doc where id = d7;
  v_failed := false;
  begin
    perform pg_temp.assert_resulted(o_lip2, 'sabotage');
  exception when others then
    if sqlerrm like 'FAIL sabotage%' then v_failed := true; else raise; end if;
  end;
  if not v_failed then raise exception 'SABOTAGE NOT CAUGHT: the request closed with the completion trigger removed'; end if;

  raise notice 'ALL CHECKS PASSED (sabotage caught)';
end $$;

rollback;
