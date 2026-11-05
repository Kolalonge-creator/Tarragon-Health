-- Tarragon Health: request to report (migration 20261105164553_lab_order_report_link).
--
-- The rule under test: ONLY a link a clinician made or confirmed counts toward completing an order. Upload, patient and automatic
-- links are suggestions. Proves, as the real roles, in a transaction that is always rolled back:
--   1. an upload made from an open request carries it as a suggestion ('upload'); a clinician's review alone does NOT close it;
--   2. the clinician confirms the link (same order): the request closes, and the document is recorded as having closed it;
--   3. the matcher suggests a link for a loose upload (exactly one fitting request; a 200-day-old one does not count); the suggestion
--      is NOT pushed down to the store row, and a reviewed, auto-suggested report does not close the request;
--   4. a request the PATIENT created (self-bookable, backdated) is not closed by an auto-suggested, clinician-reviewed report;
--   5. the candidates list flags the fitting requests and refuses another patient;
--   6. the patient may suggest a link only for their own unfiled document, to an open request sharing a test inside the window; never
--      another patient's or a cancelled request, never one with no shared test, never another patient's document, never a direct
--      column write, never a reviewed document, never over an automatic link; a patient link is not pushed down;
--   7. declining clears the link and the matcher never re-links it;
--   8. coverage uses clinician-confirmed data only: three confirmed, reviewed reports whose ONLY test evidence is the patient-set
--      test_code do not close a multi-test request; patient 'will_not_do' marks never count; an order with no readable tests never
--      closes; a document that closed one order never closes another;
--   9. a withheld S27 result keeps the request open;
--  10. an S27 result filed BEFORE the link keeps it open through the linked document; releasing it closes the request;
--  11. "mark reviewed" while the reading still holds unfiled yearly-panel analytes waits;
--  12. end to end through public.confirm_lab_report_extraction with a CONFIRMED link: the S27 result carries the order, and once
--      every tied result is released the request is resulted;
--  13. end to end with only a SUGGESTED link (the patient's own link after upload): the S27 result carries NO order and the
--      request stays open after release; an order the patient named AT UPLOAD still reaches S27 exactly as before (pre-existing);
--  14. a held result superseded by a correction: the request stays open until the correction is released, then closes;
--  15. a care coordinator cannot link at all (clinical write only);
--  16. a lab_orders trigger that refuses the move to 'resulted' never fails a filing: the filing lands, the completion failure is
--      audited, and an HbA1c filing still hands its values to S27 under the same refusing trigger.
--
-- Sabotage, each inside a sub-block that is rolled back; each makes its check fail:
--   S1 (6):  the clinician-touched test returns false: the patient relinks a reviewed document;
--   S2 (9):  'withheld' treated as final: the request closes over a withheld result;
--   S3 (10): documents tied to no S27 results: the request closes over a held result filed before the link;
--   S4 (11): no yearly-panel mapping: "mark reviewed" closes the request before S27 has the values;
--   S5 (2):  the completion trigger dropped: a confirmed, reviewed report leaves its request open;
--   S6 (3):  the automatic suggestion counted as confirmed: the request closes;
--   S7 (8):  the patient-set test_code counted as evidence: the multi-test request closes;
--   S8 (13): raise_abnormal_results_from_filed_upload reading ANY link source: a patient suggestion reaches S27 and the release
--            closes the request;
--   S9 (16): the completion guard removed: the refusing lab_orders trigger fails the clinician's filing.
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

create or replace function pg_temp.assert_open(p_order uuid, p_label text) returns void language plpgsql as $$
begin
  if (select status from public.lab_orders where id = p_order) = 'resulted' then
    raise exception 'FAIL %: the request was closed', p_label;
  end if;
end $$;

create or replace function pg_temp.cd_for(p_lrd uuid) returns public.clinical_documents language sql as $$
  select * from public.clinical_documents where routed_table = 'lab_result_documents' and routed_id = p_lrd
$$;

create or replace function pg_temp.as_user(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true)
$$;

create or replace function pg_temp.upload(p_org uuid, p_pat uuid, p_order uuid, p_name text, p_test text) returns uuid
language plpgsql as $$
declare v uuid;
begin
  perform pg_temp.as_user(p_pat);
  set local role authenticated;
  insert into public.lab_result_documents (organisation_id, patient_id, lab_order_id, file_path, original_filename, mime_type,
                                           file_size_bytes, source, test_code)
  values (p_org, p_pat, p_order, p_pat::text || '/' || p_name, p_name, 'application/pdf', 1000, 'patient', p_test) returning id into v;
  reset role;
  perform set_config('request.jwt.claims', null, true);
  return v;
end $$;

create or replace function pg_temp.review(p_lrd uuid, p_doc uuid) returns void language sql as $$
  update public.lab_result_documents set reviewed_at = now(), reviewed_by = p_doc where id = p_lrd
$$;

-- the clinician links (or confirms) a document to an order through the real function, as themselves
create or replace function pg_temp.confirm(p_doc uuid, p_cd uuid, p_order uuid) returns void language plpgsql as $$
begin
  perform pg_temp.as_user(p_doc);
  set local role authenticated;
  perform public.link_clinical_document_to_lab_order(p_cd, p_order);
  reset role;
  perform set_config('request.jwt.claims', null, true);
end $$;

-- what release_lab_result does to a result and its order
create or replace function pg_temp.release(p_result uuid, p_doc uuid) returns void language plpgsql as $$
begin
  update public.lab_results set release_state = 'released', reviewed_by = p_doc where id = p_result;
  perform private.lab_order_resulted((select lab_order_id from public.lab_results where id = p_result));
end $$;

create or replace function pg_temp.release_tied(p_cd uuid, p_doc uuid) returns void language plpgsql as $$
declare x uuid;
begin
  for x in select unnest(private.document_lab_result_ids(p_cd)) loop
    if private.lab_result_is_open_hold(x) then perform pg_temp.release(x, p_doc); end if;
  end loop;
end $$;

-- a clinician files the HbA1c read from an uploaded report, end to end
create or replace function pg_temp.file_extraction(p_org uuid, p_pat uuid, p_lrd uuid, p_doc uuid, p_code text default 'hba1c')
returns uuid language plpgsql as $$
declare v_e uuid;
begin
  select id into v_e from public.lab_report_extractions where document_id = p_lrd;
  if v_e is null then
    insert into public.lab_report_extractions (organisation_id, patient_id, document_id, status, rows)
    values (p_org, p_pat, p_lrd, 'extracted',
            jsonb_build_array(jsonb_build_object('code', p_code, 'value', '6.1', 'unit', '%', 'status', 'ready', 'confidence', 'high')))
    returning id into v_e;
  end if;
  perform pg_temp.as_user(p_doc);
  perform public.confirm_lab_report_extraction(v_e, jsonb_build_array(jsonb_build_object('code', p_code, 'value', '6.1', 'unit', '%')),
                                               private.lagos_today());
  perform set_config('request.jwt.claims', null, true);
  return v_e;
end $$;

create or replace function pg_temp.order_for(p_org uuid, p_pat uuid, p_bundle text, p_staff uuid, p_age interval) returns uuid
language sql as $$
  insert into public.lab_orders (organisation_id, patient_id, panel_bundle_id, origin, ordered_by, clinical_indication, status,
                                 fulfilment, ordered_at)
  select p_org, p_pat, pb.id, 'clinically_triggered', p_staff, 'proof', 'ordered', 'self_arranged', now() - p_age
    from public.panel_bundles pb where pb.code = p_bundle
  returning id
$$;

do $$
declare
  v_org uuid;
  v_admin uuid;
  v_pat uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_doc uuid := gen_random_uuid();
  v_coord uuid := gen_random_uuid();
  v_cmo uuid := gen_random_uuid();
  v_staff uuid;
  o_hba1c uuid; o_hba1c2 uuid; o_fbc_new uuid; o_fbc_old uuid; o_lip1 uuid; o_lip2 uuid; o_diab uuid; o_other uuid; o_cancel uuid;
  o_nocodes uuid; o_wh uuid; o_s27 uuid; o_x uuid; o_y uuid; o_c uuid; o_pat uuid;
  d1 uuid; d2 uuid; d3 uuid; d4 uuid; d5 uuid; d6 uuid; d7 uuid; d8 uuid; d9 uuid; d10 uuid; d11 uuid; d12 uuid; d13 uuid; d14 uuid; d15 uuid; d16 uuid; d17 uuid; d18 uuid; dp uuid;
  o_v uuid; o_v2 uuid; o_h uuid;
  cd public.clinical_documents;
  cd_f3 uuid; cd_a uuid;
  r_wh uuid; r3 uuid; r_a uuid; r_b uuid;
  v_failed boolean;
  v_n integer;
  v_out jsonb;
  v_def text;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  select id into v_admin from public.profiles where organisation_id = v_org and role = 'admin' limit 1;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v_pat, 'lorl-pat@example.invalid', 'x', now(), '{}', '{}'),
         (v_other, 'lorl-other@example.invalid', 'x', now(), '{}', '{}'),
         (v_doc, 'lorl-doc@example.invalid', 'x', now(), '{}', '{}'),
         (v_coord, 'lorl-coord@example.invalid', 'x', now(), '{}', '{}');
  update public.profiles set organisation_id = v_org, role = 'patient', full_name = 'Lorl Patient', is_test = true, sex = 'female',
         date_of_birth = date '1975-01-01' where id = v_pat;
  update public.profiles set organisation_id = v_org, role = 'patient', full_name = 'Lorl Other', is_test = true, sex = 'male',
         date_of_birth = date '1975-01-01' where id = v_other;
  update public.profiles set organisation_id = v_org, role = 'clinician', full_name = 'Lorl Doctor', is_test = true where id = v_doc;
  update public.profiles set organisation_id = v_org, role = 'care_coordinator', full_name = 'Lorl Coordinator', is_test = true where id = v_coord;
  insert into public.clinical_staff (profile_id, organisation_id, full_name, doctor_tier, active, credential_type, credential_number,
                                     indemnity_exempt, indemnity_exempt_by, verified_by, license_verified_at)
  values (v_doc, v_org, 'Lorl Doctor', 'senior_medical_officer', true, 'MDCN', 'LORL-001', true, v_admin, v_admin, now())
  returning id into v_staff;
  -- Steps 12, 13 and 16 file an HbA1c through confirm_lab_report_extraction, whose S27 hand-off depends on the yearly-panel ranges
  -- being signed: signed (production since 2026-10-30), the value is classified and S27 HOLDS it; unsigned (a fresh replay), it is
  -- "not classified", raise_abnormal_results_from_filed_upload writes a screening_results row against the order, and the
  -- pre-existing screening_results_maybe_result_order trigger closes a single-test order while S27 still holds the file. Sign the
  -- ranges here as a test CMO, inside this rolled-back transaction, the way t2_upload_alert_parity.sql does, so the proof runs the
  -- production path on every database.
  if not private.lab_panels_signed() then
    insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
    values (v_cmo, 'lorl-cmo@example.invalid', 'x', now(), '{}', '{}');
    update public.profiles set organisation_id = v_org, role = 'clinician', full_name = 'Lorl CMO', is_test = true where id = v_cmo;
    insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
        license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
    values (v_org, v_cmo, 'Lorl CMO', 'MDCN', 'LORL-CMO', true, 'active', now(), v_admin,
        'chief_medical_officer', 'contracted', 2, true, v_admin, true);
    perform pg_temp.as_user(v_cmo);
    set local role authenticated;
    perform public.sign_lab_panels((select id from public.lab_panel_signoffs where is_active));
    reset role;
    perform set_config('request.jwt.claims', null, true);
  end if;
  if not private.lab_panels_signed() then
    raise exception 'SETUP: the yearly-panel ranges could not be signed in this database';
  end if;

  -- the doctor opens the record through the audited path, so the tied staff read/write tests admit them
  perform pg_temp.as_user(v_doc);
  set local role authenticated;
  perform public.open_patient_record(v_pat);
  reset role;
  perform set_config('request.jwt.claims', null, true);

  o_hba1c   := pg_temp.order_for(v_org, v_pat, 'single_hba1c', v_staff, interval '3 days');
  o_fbc_new := pg_temp.order_for(v_org, v_pat, 'single_fbc', v_staff, interval '5 days');
  o_fbc_old := pg_temp.order_for(v_org, v_pat, 'single_fbc', v_staff, interval '200 days');
  o_lip1    := pg_temp.order_for(v_org, v_pat, 'single_lipid_panel', v_staff, interval '4 days');
  o_lip2    := pg_temp.order_for(v_org, v_pat, 'single_lipid_panel', v_staff, interval '6 days');
  o_diab    := pg_temp.order_for(v_org, v_pat, 'diabetes_check', v_staff, interval '2 days');      -- hba1c, ogtt_fpg, lipid_panel
  o_cancel  := pg_temp.order_for(v_org, v_pat, 'single_hba1c', v_staff, interval '1 day');
  o_other   := pg_temp.order_for(v_org, v_other, 'single_fbc', v_staff, interval '1 day');
  update public.lab_orders set status = 'cancelled' where id = o_cancel;   -- non-staff inserts open as 'ordered'
  if o_hba1c is null or o_diab is null or o_lip1 is null then raise exception 'SETUP: bundles missing'; end if;

  -- 1. upload from the open HbA1c request: a suggestion; a clinician's review alone does not close it
  d1 := pg_temp.upload(v_org, v_pat, o_hba1c, '1.pdf', 'hba1c');
  cd := pg_temp.cd_for(d1);
  if cd.lab_order_id is distinct from o_hba1c or cd.lab_order_link_source is distinct from 'upload' then
    raise exception 'FAIL 1: intake link is % / % (expected the HbA1c request, upload)', cd.lab_order_id, cd.lab_order_link_source;
  end if;
  perform pg_temp.review(d1, v_doc);
  perform pg_temp.assert_open(o_hba1c, '1 (a suggested link closed the request on review)');

  -- 2. the clinician confirms the same order: the request closes, and the document is recorded as having closed it
  perform pg_temp.confirm(v_doc, cd.id, o_hba1c);
  perform pg_temp.assert_resulted(o_hba1c, '2');
  if (pg_temp.cd_for(d1)).lab_order_link_source <> 'staff' or (pg_temp.cd_for(d1)).resulted_lab_order_id is distinct from o_hba1c then
    raise exception 'FAIL 2: the confirmation or the closing document was not recorded';
  end if;

  -- 3. a loose FBC upload: suggested automatically, NOT pushed down, and review alone does not close the request
  d2 := pg_temp.upload(v_org, v_pat, null, '2.pdf', 'fbc');
  cd := pg_temp.cd_for(d2);
  if cd.lab_order_id is distinct from o_fbc_new or cd.lab_order_link_source is distinct from 'auto' then
    raise exception 'FAIL 3: the loose FBC upload linked to % / % (expected the recent FBC request, auto)', cd.lab_order_id, cd.lab_order_link_source;
  end if;
  if (select lab_order_id from public.lab_result_documents where id = d2) is not null then
    raise exception 'FAIL 3: an automatic suggestion was pushed down to the store row';
  end if;
  perform pg_temp.review(d2, v_doc);
  perform pg_temp.assert_open(o_fbc_new, '3 (an automatic suggestion closed the request)');
  -- S6: if the suggestion counted as confirmed, the request would close
  begin
    update public.clinical_documents set lab_order_link_source = 'staff', lab_order_linked_by = v_doc where id = cd.id;
    perform pg_temp.assert_open(o_fbc_new, 'S6');
    raise exception 'S6 NOT CAUGHT: a confirmed link on a reviewed single-test report left the request open';
  exception when others then
    if sqlerrm not like 'FAIL S6%' then raise exception '%', sqlerrm; end if;
  end;

  -- 4. a request the patient created (self-bookable, backdated): an auto-suggested, reviewed report does not close it
  perform pg_temp.as_user(v_pat);
  set local role authenticated;
  insert into public.lab_orders (organisation_id, patient_id, panel_bundle_id, origin, fulfilment, ordered_at, total_kobo)
  select v_org, v_pat, pb.id, 'patient_initiated', 'self_arranged', now() - interval '10 days', 0
    from public.panel_bundles pb where pb.code = 'single_vitamin_b12'
  returning id into o_pat;
  reset role;
  perform set_config('request.jwt.claims', null, true);
  dp := pg_temp.upload(v_org, v_pat, null, 'p.pdf', 'vitamin_b12');
  if (pg_temp.cd_for(dp)).lab_order_id is distinct from o_pat or (pg_temp.cd_for(dp)).lab_order_link_source <> 'auto' then
    raise exception 'FAIL 4 setup: the patient-created request was not suggested';
  end if;
  perform pg_temp.review(dp, v_doc);
  perform pg_temp.assert_open(o_pat, '4 (an auto link closed a patient-created request)');

  -- 5. three open requests include a lipid panel: nothing is suggested; the candidates list flags them; another patient refused
  d3 := pg_temp.upload(v_org, v_pat, null, '3.pdf', 'lipid_panel');
  cd := pg_temp.cd_for(d3);
  if cd.lab_order_id is not null then raise exception 'FAIL 5: an ambiguous report was linked automatically to %', cd.lab_order_id; end if;
  perform pg_temp.as_user(v_pat);
  set local role authenticated;
  select count(*) into v_n from public.lab_order_link_candidates(cd.id) c where c.tests_match;
  if v_n <> 3 then reset role; raise exception 'FAIL 5: % fitting candidates, expected 3', v_n; end if;
  if exists (select 1 from public.lab_order_link_candidates(cd.id) c where c.lab_order_id in (o_cancel, o_other)) then
    reset role; raise exception 'FAIL 5: a cancelled or another patient''s request is offered';
  end if;
  reset role;
  perform pg_temp.as_user(v_other);
  set local role authenticated;
  v_failed := false;
  begin perform * from public.lab_order_link_candidates(cd.id); exception when sqlstate '42501' then v_failed := true; end;
  reset role;
  if not v_failed then raise exception 'FAIL 5: another patient listed this patient''s requests'; end if;

  -- 6. the patient suggests a link for their own unfiled report to a fitting request, and nothing else
  perform pg_temp.as_user(v_pat);
  set local role authenticated;
  v_out := public.link_clinical_document_to_lab_order(cd.id, o_lip1);
  v_failed := false;
  begin perform public.link_clinical_document_to_lab_order(cd.id, o_other); exception when sqlstate '42501' then v_failed := true; end;
  if not v_failed then reset role; raise exception 'FAIL 6: linked to another patient''s request'; end if;
  v_failed := false;
  begin perform public.link_clinical_document_to_lab_order(cd.id, o_cancel); exception when sqlstate '22023' then v_failed := true; end;
  if not v_failed then reset role; raise exception 'FAIL 6: linked to a cancelled request'; end if;
  v_failed := false;
  begin perform public.link_clinical_document_to_lab_order(cd.id, o_fbc_new); exception when sqlstate '22023' then v_failed := true; end;
  if not v_failed then reset role; raise exception 'FAIL 6: a lipid report was linked to an FBC request'; end if;
  v_failed := false;
  begin update public.clinical_documents set lab_order_id = o_lip2 where id = cd.id; exception when sqlstate '42501' then v_failed := true; end;
  if not v_failed then reset role; raise exception 'FAIL 6: a signed-in patient updated clinical_documents directly'; end if;
  v_failed := false;
  begin perform public.link_clinical_document_to_lab_order((pg_temp.cd_for(d1)).id, null); exception when sqlstate '42501' then v_failed := true; end;
  if not v_failed then reset role; raise exception 'FAIL 6: the patient changed the link on a reviewed document'; end if;
  v_failed := false;
  begin perform public.link_clinical_document_to_lab_order((pg_temp.cd_for(d2)).id, null); exception when sqlstate '42501' then v_failed := true; end;
  if not v_failed then reset role; raise exception 'FAIL 6: the patient declined an automatic link'; end if;
  reset role;
  perform set_config('request.jwt.claims', null, true);
  cd := pg_temp.cd_for(d3);
  if cd.lab_order_id is distinct from o_lip1 or cd.lab_order_link_source <> 'patient' or cd.lab_order_linked_by is distinct from v_pat then
    raise exception 'FAIL 6: the patient link is % / % / %', cd.lab_order_id, cd.lab_order_link_source, cd.lab_order_linked_by;
  end if;
  if (select lab_order_id from public.lab_result_documents where id = d3) is not null then
    raise exception 'FAIL 6: a patient link was pushed down';
  end if;
  perform pg_temp.as_user(v_other);
  set local role authenticated;
  v_failed := false;
  begin perform public.link_clinical_document_to_lab_order(cd.id, null); exception when sqlstate '42501' then v_failed := true; end;
  reset role;
  if not v_failed then raise exception 'FAIL 6: another patient changed this patient''s link'; end if;
  -- S1: with the clinician-touched test removed, the patient relinks the reviewed document to another fitting HbA1c request
  o_hba1c2 := pg_temp.order_for(v_org, v_pat, 'single_hba1c', v_staff, interval '1 day');
  begin
    create or replace function private.clinical_document_clinician_touched(p_document uuid) returns boolean
      language sql stable security definer set search_path to '' as $f$ select false $f$;
    update public.clinical_documents set lab_order_link_source = 'upload' where id = (pg_temp.cd_for(d1)).id;  -- as before confirmation
    perform pg_temp.as_user(v_pat);
    set local role authenticated;
    perform public.link_clinical_document_to_lab_order((pg_temp.cd_for(d1)).id, o_hba1c2);
    reset role;
    raise exception 'SABOTAGE_CAUGHT';
  exception when others then
    reset role;
    if sqlerrm <> 'SABOTAGE_CAUGHT' then raise exception 'S1 NOT CAUGHT: %', sqlerrm; end if;
  end;
  perform set_config('request.jwt.claims', null, true);

  -- 7. declined: cleared, and the matcher never re-links it
  perform pg_temp.as_user(v_pat);
  set local role authenticated;
  perform public.link_clinical_document_to_lab_order(cd.id, null);
  reset role;
  perform set_config('request.jwt.claims', null, true);
  perform pg_temp.review(d3, v_doc);
  cd := pg_temp.cd_for(d3);
  if cd.lab_order_id is not null or cd.lab_order_link_source <> 'declined' then
    raise exception 'FAIL 7: after declining, link is % / %', cd.lab_order_id, cd.lab_order_link_source;
  end if;
  perform pg_temp.assert_open(o_lip1, '7');

  -- 8. multi-test request: three CONFIRMED, reviewed reports whose only test evidence is the patient-set test_code
  d4 := pg_temp.upload(v_org, v_pat, o_diab, '4.pdf', 'hba1c');
  d5 := pg_temp.upload(v_org, v_pat, o_diab, '5.pdf', 'ogtt_fpg');
  d6 := pg_temp.upload(v_org, v_pat, o_diab, '6.pdf', 'lipid_panel');
  perform pg_temp.as_user(v_pat);
  set local role authenticated;
  insert into public.lab_order_test_status (lab_order_id, organisation_id, test_code, status) values (o_diab, v_org, 'lipid_panel', 'will_not_do');
  reset role;
  perform set_config('request.jwt.claims', null, true);
  perform pg_temp.confirm(v_doc, (pg_temp.cd_for(d4)).id, o_diab);
  perform pg_temp.confirm(v_doc, (pg_temp.cd_for(d5)).id, o_diab);
  perform pg_temp.confirm(v_doc, (pg_temp.cd_for(d6)).id, o_diab);
  perform pg_temp.review(d4, v_doc);
  perform pg_temp.review(d5, v_doc);
  perform pg_temp.review(d6, v_doc);
  perform pg_temp.assert_open(o_diab, '8 (patient-set test codes counted as evidence)');
  -- S7: the patient-set test_code counted as evidence
  begin
    create or replace function private.confirmed_report_test_codes(p_document uuid) returns text[]
      language sql stable security definer set search_path to '' as $f$
      select coalesce(array_agg(lower(d.test_code)), '{}'::text[]) from public.clinical_documents cd
        join public.lab_result_documents d on cd.routed_table = 'lab_result_documents' and d.id = cd.routed_id
       where cd.id = p_document and d.test_code is not null $f$;
    perform private.complete_lab_order_from_report((pg_temp.cd_for(d6)).id);
    perform pg_temp.assert_open(o_diab, 'S7');
    raise exception 'S7 NOT CAUGHT';
  exception when others then
    if sqlerrm not like 'FAIL S7%' then raise exception '%', sqlerrm; end if;
  end;
  -- an order whose tests cannot be read never closes
  o_nocodes := pg_temp.order_for(v_org, v_pat, 'single_fit', v_staff, interval '1 day');
  update public.lab_orders set excluded_test_codes = '["fit"]'::jsonb where id = o_nocodes;
  d7 := pg_temp.upload(v_org, v_pat, o_nocodes, '7.pdf', null);
  perform pg_temp.confirm(v_doc, (pg_temp.cd_for(d7)).id, o_nocodes);
  perform pg_temp.review(d7, v_doc);
  perform pg_temp.assert_open(o_nocodes, '8 (no readable tests)');
  -- the document that closed the first HbA1c request, relinked by the clinician: it does not close the second
  perform pg_temp.confirm(v_doc, (pg_temp.cd_for(d1)).id, o_hba1c2);
  if (pg_temp.cd_for(d1)).lab_order_id is distinct from o_hba1c2 then raise exception 'FAIL 8 setup: the relink did not apply'; end if;
  perform pg_temp.assert_open(o_hba1c2, '8 (one document closed two requests)');

  -- 9. a withheld S27 result keeps the request open
  o_wh := pg_temp.order_for(v_org, v_pat, 'single_hba1c', v_staff, interval '300 days');
  v_out := private.submit_lab_result(v_pat, o_wh, null, null,
    jsonb_build_object('file_path', v_pat::text || '/wh.pdf', 'original_filename', 'wh.pdf', 'mime_type', 'application/pdf', 'file_size_bytes', 1000),
    'tarragon_team', v_doc, null);
  r_wh := (v_out ->> 'lab_result_id')::uuid;
  update public.lab_results set release_state = 'withheld', reviewed_by = v_doc, withheld_reason = 'proof' where id = r_wh;
  d8 := pg_temp.upload(v_org, v_pat, o_wh, '8.pdf', 'hba1c');
  perform pg_temp.confirm(v_doc, (pg_temp.cd_for(d8)).id, o_wh);
  perform pg_temp.review(d8, v_doc);
  perform pg_temp.assert_open(o_wh, '9 (withheld result)');
  begin
    create or replace function private.lab_result_is_open_hold(p_result uuid) returns boolean
      language sql stable security definer set search_path to '' as $f$
      select exists (select 1 from public.lab_results r where r.id = p_result and r.release_state not in ('released', 'withheld')
                      and r.withdrawn_at is null and r.superseded_by is null) $f$;
    perform private.complete_lab_order_from_report((pg_temp.cd_for(d8)).id);
    perform pg_temp.assert_open(o_wh, 'S2');
    raise exception 'S2 NOT CAUGHT';
  exception when others then
    if sqlerrm not like 'FAIL S2%' then raise exception '%', sqlerrm; end if;
  end;

  -- 10. an S27 result filed BEFORE any link (no order on it), then linked by the clinician
  o_s27 := pg_temp.order_for(v_org, v_pat, 'single_hba1c', v_staff, interval '250 days');
  v_out := private.submit_lab_result(v_pat, null, null, null,
    jsonb_build_object('file_path', v_pat::text || '/s27.pdf', 'original_filename', 's27.pdf', 'mime_type', 'application/pdf', 'file_size_bytes', 1000),
    'tarragon_team', v_doc, null);
  r3 := (v_out ->> 'lab_result_id')::uuid;
  select id into cd_f3 from public.clinical_documents where routed_table = 'lab_result_files'
     and routed_id = (select document_id from public.lab_results where id = r3);
  perform pg_temp.confirm(v_doc, cd_f3, o_s27);
  d9 := pg_temp.upload(v_org, v_pat, o_s27, '9.pdf', 'hba1c');
  perform pg_temp.confirm(v_doc, (pg_temp.cd_for(d9)).id, o_s27);
  perform pg_temp.review(d9, v_doc);
  perform pg_temp.assert_open(o_s27, '10 (held result filed before the link)');
  begin
    create or replace function private.document_lab_result_ids(p_document uuid) returns uuid[]
      language sql stable security definer set search_path to '' as $f$ select '{}'::uuid[] $f$;
    perform private.complete_lab_order_from_report((pg_temp.cd_for(d9)).id);
    perform pg_temp.assert_open(o_s27, 'S3');
    raise exception 'S3 NOT CAUGHT';
  exception when others then
    if sqlerrm not like 'FAIL S3%' then raise exception '%', sqlerrm; end if;
  end;
  update public.lab_results set release_state = 'released', reviewed_by = v_doc where id = r3;
  perform pg_temp.assert_resulted(o_s27, '10 (closed once the earlier result is released)');

  -- 11. "mark reviewed" while the reading still holds an unfiled HbA1c value waits
  o_x := pg_temp.order_for(v_org, v_pat, 'single_hba1c', v_staff, interval '350 days');
  d10 := pg_temp.upload(v_org, v_pat, o_x, '10.pdf', 'hba1c');
  insert into public.lab_report_extractions (organisation_id, patient_id, document_id, status, rows)
  values (v_org, v_pat, d10, 'extracted', '[{"code":"hba1c","value":"6.1","unit":"%","status":"ready","confidence":"high"}]'::jsonb);
  perform pg_temp.confirm(v_doc, (pg_temp.cd_for(d10)).id, o_x);
  perform pg_temp.review(d10, v_doc);
  perform pg_temp.assert_open(o_x, '11 (values not yet filed)');
  begin
    create or replace function private.yearly_panel_screen_type(p_code text) returns text
      language sql immutable set search_path to '' as $f$ select null::text $f$;
    perform private.complete_lab_order_from_report((pg_temp.cd_for(d10)).id);
    perform pg_temp.assert_open(o_x, 'S4');
    raise exception 'S4 NOT CAUGHT';
  exception when others then
    if sqlerrm not like 'FAIL S4%' then raise exception '%', sqlerrm; end if;
  end;

  -- 12. end to end, CONFIRMED link: the clinician files the values; the S27 result carries the order; released, the request closes
  perform pg_temp.file_extraction(v_org, v_pat, d10, v_doc);
  if not exists (select 1 from unnest(private.document_lab_result_ids((pg_temp.cd_for(d10)).id)) x
                  join public.lab_results r on r.id = x where r.lab_order_id = o_x) then
    raise exception 'FAIL 12: the filed S27 result does not carry the confirmed order';
  end if;
  if exists (select 1 from unnest(private.document_lab_result_ids((pg_temp.cd_for(d10)).id)) x where private.lab_result_is_open_hold(x)) then
    perform pg_temp.assert_open(o_x, '12 (closed while S27 holds the filed values)');
    perform pg_temp.release_tied((pg_temp.cd_for(d10)).id, v_doc);
  end if;
  perform pg_temp.assert_resulted(o_x, '12 (filed and released)');

  -- 13. end to end, SUGGESTED link only (the patient's own link after a loose upload): S27 gets no order; released, it stays open
  d12 := pg_temp.upload(v_org, v_pat, null, '12.pdf', 'hba1c');
  if (pg_temp.cd_for(d12)).lab_order_id is not null then raise exception 'FAIL 13 setup: the loose HbA1c upload was auto-linked'; end if;
  perform pg_temp.as_user(v_pat);
  set local role authenticated;
  perform public.link_clinical_document_to_lab_order((pg_temp.cd_for(d12)).id, o_hba1c2);
  reset role;
  perform set_config('request.jwt.claims', null, true);
  perform pg_temp.file_extraction(v_org, v_pat, d12, v_doc);
  if cardinality(private.document_lab_result_ids((pg_temp.cd_for(d12)).id)) = 0 then
    raise exception 'FAIL 13 setup: the filing produced no S27 result to release';
  end if;
  if exists (select 1 from unnest(private.document_lab_result_ids((pg_temp.cd_for(d12)).id)) x
              join public.lab_results r on r.id = x where r.lab_order_id is not null) then
    raise exception 'FAIL 13: a patient suggestion reached S27';
  end if;
  perform pg_temp.release_tied((pg_temp.cd_for(d12)).id, v_doc);
  perform pg_temp.assert_open(o_hba1c2, '13 (a patient suggestion closed the request through S27)');
  -- an order the patient named AT UPLOAD still reaches S27, exactly as before this migration (pre-existing, documented limit)
  o_y := pg_temp.order_for(v_org, v_pat, 'single_hba1c', v_staff, interval '380 days');
  d13 := pg_temp.upload(v_org, v_pat, o_y, '13.pdf', 'hba1c');
  perform pg_temp.file_extraction(v_org, v_pat, d13, v_doc);
  if not exists (select 1 from unnest(private.document_lab_result_ids((pg_temp.cd_for(d13)).id)) x
                  join public.lab_results r on r.id = x where r.lab_order_id = o_y) then
    raise exception 'FAIL 13: the order named at upload no longer reaches S27 (today''s behaviour changed)';
  end if;
  -- S8: the hand-off reading ANY link source: the patient's suggestion reaches S27 and its release closes the request
  begin
    v_def := pg_get_functiondef('private.raise_abnormal_results_from_filed_upload()'::regprocedure);
    v_def := replace(v_def, 'cdoc.lab_order_link_source = ' || quote_literal('staff'), 'cdoc.lab_order_link_source is not null');
    execute v_def;
    d14 := pg_temp.upload(v_org, v_pat, null, '13s.pdf', 'hba1c');
    perform pg_temp.as_user(v_pat);
    set local role authenticated;
    perform public.link_clinical_document_to_lab_order((pg_temp.cd_for(d14)).id, o_hba1c2);
    reset role;
    perform set_config('request.jwt.claims', null, true);
    perform pg_temp.file_extraction(v_org, v_pat, d14, v_doc);
    perform pg_temp.release_tied((pg_temp.cd_for(d14)).id, v_doc);
    perform pg_temp.assert_open(o_hba1c2, 'S8');
    raise exception 'S8 NOT CAUGHT';
  exception when others then
    reset role;
    if sqlerrm not like 'FAIL S8%' then raise exception '%', sqlerrm; end if;
  end;
  perform set_config('request.jwt.claims', null, true);

  -- 14. a held result superseded by a correction: open until the correction is released, then closed
  o_c := pg_temp.order_for(v_org, v_pat, 'single_hba1c', v_staff, interval '330 days');
  v_out := private.submit_lab_result(v_pat, null, null, null,
    jsonb_build_object('file_path', v_pat::text || '/ca.pdf', 'original_filename', 'ca.pdf', 'mime_type', 'application/pdf', 'file_size_bytes', 1000),
    'tarragon_team', v_doc, null);
  r_a := (v_out ->> 'lab_result_id')::uuid;
  select id into cd_a from public.clinical_documents where routed_table = 'lab_result_files'
     and routed_id = (select document_id from public.lab_results where id = r_a);
  perform pg_temp.confirm(v_doc, cd_a, o_c);
  d15 := pg_temp.upload(v_org, v_pat, o_c, '14.pdf', 'hba1c');
  perform pg_temp.confirm(v_doc, (pg_temp.cd_for(d15)).id, o_c);
  perform pg_temp.review(d15, v_doc);
  perform pg_temp.assert_open(o_c, '14 (held result)');
  v_out := private.submit_lab_result(v_pat, null, null, null,
    jsonb_build_object('file_path', v_pat::text || '/cb.pdf', 'original_filename', 'cb.pdf', 'mime_type', 'application/pdf', 'file_size_bytes', 1000),
    'tarragon_team', v_doc, null, r_a, 'corrected', 'proof correction');
  r_b := (v_out ->> 'lab_result_id')::uuid;
  if (select superseded_by from public.lab_results where id = r_a) is distinct from r_b then
    raise exception 'FAIL 14 setup: the correction did not supersede the held result';
  end if;
  perform pg_temp.assert_open(o_c, '14 (held correction)');
  update public.lab_results set release_state = 'released', reviewed_by = v_doc where id = r_b;
  perform pg_temp.assert_resulted(o_c, '14 (correction released)');

  -- 15. a care coordinator cannot link
  perform pg_temp.as_user(v_coord);
  set local role authenticated;
  v_failed := false;
  begin perform public.link_clinical_document_to_lab_order((pg_temp.cd_for(d3)).id, o_lip1); exception when sqlstate '42501' then v_failed := true; end;
  reset role;
  perform set_config('request.jwt.claims', null, true);
  if not v_failed then raise exception 'FAIL 15: a care coordinator linked a report'; end if;

  -- 16. a lab_orders trigger refusing the move to 'resulted' never fails a filing
  create function public.zz_proof_boom() returns trigger language plpgsql as $f$
  begin
    if new.status = 'resulted' and old.status is distinct from 'resulted' then raise exception 'proof boom'; end if;
    return new;
  end $f$;
  create trigger zzz_proof_boom after update on public.lab_orders for each row execute function public.zz_proof_boom();
  -- a non-panel reading on a confirmed single-test request: the filing completes the request, which the trigger refuses
  o_v := pg_temp.order_for(v_org, v_pat, 'single_vitamin_b12', v_staff, interval '20 days');
  d16 := pg_temp.upload(v_org, v_pat, o_v, '16.pdf', 'vitamin_b12');
  perform pg_temp.confirm(v_doc, (pg_temp.cd_for(d16)).id, o_v);
  perform pg_temp.file_extraction(v_org, v_pat, d16, v_doc, 'vitamin_b12');
  if (select status from public.lab_report_extractions where document_id = d16) <> 'confirmed'
     or not exists (select 1 from public.lab_analyte_readings where patient_id = v_pat and code = 'vitamin_b12') then
    raise exception 'FAIL 16: the filing did not land';
  end if;
  if not exists (select 1 from public.audit_log where action = 'lab_order.completion_failed' and entity_id = (pg_temp.cd_for(d16)).id) then
    raise exception 'FAIL 16: the refused completion was not audited';
  end if;
  perform pg_temp.assert_open(o_v, '16 (the refusing trigger was bypassed)');
  -- an HbA1c filing on a confirmed request still hands its values to S27 under the same trigger
  o_h := pg_temp.order_for(v_org, v_pat, 'single_hba1c', v_staff, interval '360 days');
  d17 := pg_temp.upload(v_org, v_pat, o_h, '17.pdf', 'hba1c');
  perform pg_temp.confirm(v_doc, (pg_temp.cd_for(d17)).id, o_h);
  perform pg_temp.file_extraction(v_org, v_pat, d17, v_doc);
  if (select status from public.lab_report_extractions where document_id = d17) <> 'confirmed'
     or cardinality(private.document_lab_result_ids((pg_temp.cd_for(d17)).id)) = 0 then
    raise exception 'FAIL 16: the HbA1c filing or its S27 hand-off did not land';
  end if;
  -- S9: without the guard, the same refusal fails the clinician's filing
  begin
    create or replace function private.try_complete_lab_order_from_report(p_document uuid) returns void
      language plpgsql security definer set search_path to '' as $g$
      begin perform private.complete_lab_order_from_report(p_document); end $g$;
    o_v2 := pg_temp.order_for(v_org, v_pat, 'single_vitamin_b12', v_staff, interval '21 days');
    d18 := pg_temp.upload(v_org, v_pat, o_v2, '18.pdf', 'vitamin_b12');
    perform pg_temp.confirm(v_doc, (pg_temp.cd_for(d18)).id, o_v2);
    perform pg_temp.file_extraction(v_org, v_pat, d18, v_doc, 'vitamin_b12');
    raise exception 'S9 NOT CAUGHT: the filing succeeded without the guard';
  exception when others then
    if sqlerrm not like '%proof boom%' then raise exception '%', sqlerrm; end if;
  end;
  perform set_config('request.jwt.claims', null, true);
  drop trigger zzz_proof_boom on public.lab_orders;

  -- S5: without the completion trigger, a confirmed, reviewed report leaves its request open
  begin
    drop trigger zz_lab_order_link_after on public.clinical_documents;
    d11 := pg_temp.upload(v_org, v_pat, o_lip2, '11.pdf', 'lipid_panel');
    perform pg_temp.confirm(v_doc, (pg_temp.cd_for(d11)).id, o_lip2);
    perform pg_temp.review(d11, v_doc);
    perform pg_temp.assert_resulted(o_lip2, 'S5');
    raise exception 'S5 NOT CAUGHT';
  exception when others then
    if sqlerrm not like 'FAIL S5%' then raise exception '%', sqlerrm; end if;
  end;

  raise notice 'ALL CHECKS PASSED (9 sabotages caught)';
end $$;

rollback;
