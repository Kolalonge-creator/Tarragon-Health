-- Tarragon Health: request to report (migration 20261105164553_lab_order_report_link).
--
-- Proves, as the real roles, in a transaction that is always rolled back:
--   1. an upload made from an open request carries it onto the intake row (source 'upload'); uploading alone does not close it;
--   2. a clinician's review closes it ('resulted', resulted_at), and the document is recorded as having closed it;
--   3. the matcher links a loose upload when exactly one open request shares a test inside the window (a 200-day-old one does not
--      count), and pushes the order down to the store row;
--   4. the matcher leaves a report alone when several open requests fit;
--   5. the candidates list flags the fitting requests and refuses another patient;
--   6. the patient may link their own unfiled document only to an open request that shares a test inside the window: not another
--      patient's, not a cancelled one, not one with no shared test; never another patient's document; never a direct column write;
--      never a document a clinician has reviewed (A); never over an automatic link (B);
--   7. declining clears the link and the matcher never re-links it;
--   8. a multi-test request closes only when filed reports cover every test; the patient's own 'will_not_do' marks never count (C);
--      an order with no readable tests never closes from a link (D); a document that already closed one order never closes another (E);
--   9. a WITHHELD S27 result keeps the request open, like any result that is not released;
--  10. an S27 result filed BEFORE the link (its lab_results.lab_order_id is null) still keeps the request open through the linked
--      document, and the request closes when that result is released;
--  11. "mark reviewed" on an upload whose reading still holds unfiled yearly-panel analytes waits for the S27 hand-off.
--
-- Sabotage, each inside a sub-block that is rolled back, each must make its check fail:
--   S1 (item 6A): the clinician-touched test returns false: the patient relinks a reviewed document;
--   S2 (item 9):  'withheld' treated as final again: the request closes over a withheld result;
--   S3 (item 10): documents tied to no S27 results: the request closes over a held result filed before the link;
--   S4 (item 11): no yearly-panel mapping: "mark reviewed" closes the request before S27 has the values;
--   S5 (item 2):  the completion trigger dropped: a reviewed, linked report leaves its request open.
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

-- A patient upload, as the patient. Returns the lab_result_documents id.
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
  v_staff uuid;
  o_hba1c uuid; o_hba1c2 uuid; o_fbc_new uuid; o_fbc_old uuid; o_lip1 uuid; o_lip2 uuid; o_diab uuid; o_held uuid; o_other uuid;
  o_cancel uuid; o_nocodes uuid; o_wh uuid; o_s27 uuid; o_x uuid;
  d1 uuid; d2 uuid; d3 uuid; d4 uuid; d5 uuid; d6 uuid; d7 uuid; d8 uuid; d9 uuid; d10 uuid; d11 uuid;
  cd public.clinical_documents;
  cd_f3 uuid;
  r_wh uuid; r3 uuid;
  v_failed boolean;
  v_n integer;
  v_out jsonb;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  select id into v_admin from public.profiles where organisation_id = v_org and role = 'admin' limit 1;

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

  o_hba1c   := pg_temp.order_for(v_org, v_pat, 'single_hba1c', v_staff, interval '3 days');
  o_fbc_new := pg_temp.order_for(v_org, v_pat, 'single_fbc', v_staff, interval '5 days');
  o_fbc_old := pg_temp.order_for(v_org, v_pat, 'single_fbc', v_staff, interval '200 days');
  o_lip1    := pg_temp.order_for(v_org, v_pat, 'single_lipid_panel', v_staff, interval '4 days');
  o_lip2    := pg_temp.order_for(v_org, v_pat, 'single_lipid_panel', v_staff, interval '6 days');
  o_diab    := pg_temp.order_for(v_org, v_pat, 'diabetes_check', v_staff, interval '2 days');      -- hba1c, ogtt_fpg, lipid_panel
  o_held    := pg_temp.order_for(v_org, v_pat, 'single_hba1c', v_staff, interval '400 days');
  o_cancel  := pg_temp.order_for(v_org, v_pat, 'single_hba1c', v_staff, interval '1 day');
  o_other   := pg_temp.order_for(v_org, v_other, 'single_fbc', v_staff, interval '1 day');
  -- force_safe_patient_lab_order_insert opens every non-staff insert as 'ordered'; cancel it afterwards
  update public.lab_orders set status = 'cancelled' where id = o_cancel;
  if o_hba1c is null or o_diab is null or o_lip1 is null then raise exception 'SETUP: bundles missing'; end if;

  -- 1. upload from the open HbA1c request: the intake carries it; the request stays open
  d1 := pg_temp.upload(v_org, v_pat, o_hba1c, '1.pdf', 'hba1c');
  cd := pg_temp.cd_for(d1);
  if cd.lab_order_id is distinct from o_hba1c or cd.lab_order_link_source is distinct from 'upload' then
    raise exception 'FAIL 1: intake link is % / % (expected the HbA1c request, upload)', cd.lab_order_id, cd.lab_order_link_source;
  end if;
  perform pg_temp.assert_open(o_hba1c, '1');

  -- 2. a clinician reviews it: the request closes, and the document is recorded as having closed it
  perform pg_temp.as_user(v_doc);
  perform pg_temp.review(d1, v_doc);
  perform set_config('request.jwt.claims', null, true);
  perform pg_temp.assert_resulted(o_hba1c, '2');
  if (pg_temp.cd_for(d1)).resulted_lab_order_id is distinct from o_hba1c then
    raise exception 'FAIL 2: the closing document was not recorded';
  end if;

  -- 3. a loose FBC upload: one open FBC request in the window: linked automatically, pushed down
  d2 := pg_temp.upload(v_org, v_pat, null, '2.pdf', 'fbc');
  cd := pg_temp.cd_for(d2);
  if cd.lab_order_id is distinct from o_fbc_new or cd.lab_order_link_source is distinct from 'auto' then
    raise exception 'FAIL 3: the loose FBC upload linked to % / % (expected the recent FBC request, auto)', cd.lab_order_id, cd.lab_order_link_source;
  end if;
  if (select lab_order_id from public.lab_result_documents where id = d2) is distinct from o_fbc_new then
    raise exception 'FAIL 3: the automatic link was not pushed down to the store row';
  end if;

  -- 4. three open requests include a lipid panel (two single, one diabetes check): nothing is linked
  d3 := pg_temp.upload(v_org, v_pat, null, '3.pdf', 'lipid_panel');
  cd := pg_temp.cd_for(d3);
  if cd.lab_order_id is not null then raise exception 'FAIL 4: an ambiguous report was linked automatically to %', cd.lab_order_id; end if;

  -- 5. candidates: the three fitting requests flagged; nothing cancelled or foreign offered; another patient refused
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

  -- 6. the patient links their own unfiled report to a fitting request, and nothing else
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
  -- (A) a reviewed document: refused
  v_failed := false;
  begin perform public.link_clinical_document_to_lab_order((pg_temp.cd_for(d1)).id, null); exception when sqlstate '42501' then v_failed := true; end;
  if not v_failed then reset role; raise exception 'FAIL 6A: the patient changed the link on a reviewed document'; end if;
  -- (B) an automatic link: refused, both relink and decline
  v_failed := false;
  begin perform public.link_clinical_document_to_lab_order((pg_temp.cd_for(d2)).id, null); exception when sqlstate '42501' then v_failed := true; end;
  if not v_failed then reset role; raise exception 'FAIL 6B: the patient declined an automatic link'; end if;
  reset role;
  perform set_config('request.jwt.claims', null, true);
  cd := pg_temp.cd_for(d3);
  if cd.lab_order_id is distinct from o_lip1 or cd.lab_order_link_source <> 'patient' or cd.lab_order_linked_by is distinct from v_pat then
    raise exception 'FAIL 6: the hand link is % / % / %', cd.lab_order_id, cd.lab_order_link_source, cd.lab_order_linked_by;
  end if;
  if (select lab_order_id from public.lab_result_documents where id = d3) is distinct from o_lip1 then
    raise exception 'FAIL 6: the hand link was not pushed down';
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

  -- 7. declined: cleared, pushed down, and the matcher never re-links it
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
  if (select lab_order_id from public.lab_result_documents where id = d3) is not null then
    raise exception 'FAIL 7: declining did not clear the store row';
  end if;
  perform pg_temp.assert_open(o_lip1, '7');

  -- 8. multi-test request (HbA1c, OGTT/FPG, lipid)
  d4 := pg_temp.upload(v_org, v_pat, o_diab, '4.pdf', 'hba1c');
  d5 := pg_temp.upload(v_org, v_pat, o_diab, '5.pdf', 'ogtt_fpg');
  perform pg_temp.review(d4, v_doc);
  perform pg_temp.assert_open(o_diab, '8 (one test of three)');
  -- (C) the patient's own 'will_not_do' for the lipid panel does not count
  perform pg_temp.as_user(v_pat);
  set local role authenticated;
  insert into public.lab_order_test_status (lab_order_id, organisation_id, test_code, status) values (o_diab, v_org, ' lipid_panel ', 'will_not_do');
  insert into public.lab_order_test_status (lab_order_id, organisation_id, test_code, status) values (o_diab, v_org, 'lipid_panel', 'will_not_do');
  reset role;
  perform set_config('request.jwt.claims', null, true);
  perform pg_temp.review(d5, v_doc);
  perform pg_temp.assert_open(o_diab, '8C (patient will_not_do counted)');
  d6 := pg_temp.upload(v_org, v_pat, o_diab, '6.pdf', 'lipid_panel');
  perform pg_temp.review(d6, v_doc);
  perform pg_temp.assert_resulted(o_diab, '8 (every test covered)');
  -- (D) an order whose tests cannot be read never closes from a link
  o_nocodes := pg_temp.order_for(v_org, v_pat, 'single_fit', v_staff, interval '1 day');
  update public.lab_orders set excluded_test_codes = '["fit"]'::jsonb where id = o_nocodes;
  d7 := pg_temp.upload(v_org, v_pat, o_nocodes, '7.pdf', null);
  perform pg_temp.review(d7, v_doc);
  perform pg_temp.assert_open(o_nocodes, '8D (no readable tests)');
  -- (E) staff relink the document that closed the first HbA1c request to the second: it does not close that one too
  -- the doctor opens the record through the audited path first, so staff_may_read admits them under tied staff reads
  perform pg_temp.as_user(v_doc);
  set local role authenticated;
  perform public.open_patient_record(v_pat);
  perform public.link_clinical_document_to_lab_order((pg_temp.cd_for(d1)).id, o_hba1c2);
  reset role;
  perform set_config('request.jwt.claims', null, true);
  if (pg_temp.cd_for(d1)).lab_order_id is distinct from o_hba1c2 then raise exception 'FAIL 8E setup: staff relink did not apply'; end if;
  perform pg_temp.assert_open(o_hba1c2, '8E (a document closed two requests)');

  -- 9. a withheld S27 result keeps the request open
  o_wh := pg_temp.order_for(v_org, v_pat, 'single_hba1c', v_staff, interval '300 days');
  v_out := private.submit_lab_result(v_pat, o_wh, null, null,
    jsonb_build_object('file_path', v_pat::text || '/wh.pdf', 'original_filename', 'wh.pdf', 'mime_type', 'application/pdf', 'file_size_bytes', 1000),
    'tarragon_team', v_doc, null);
  r_wh := (v_out ->> 'lab_result_id')::uuid;
  update public.lab_results set release_state = 'withheld', reviewed_by = v_doc, withheld_reason = 'proof' where id = r_wh;
  d8 := pg_temp.upload(v_org, v_pat, o_wh, '8.pdf', 'hba1c');
  perform pg_temp.review(d8, v_doc);
  perform pg_temp.assert_open(o_wh, '9 (withheld result)');
  -- S2: 'withheld' treated as final again
  begin
    create or replace function private.lab_result_is_open_hold(p_result uuid) returns boolean
      language sql stable security definer set search_path to '' as $f$
      select exists (select 1 from public.lab_results r where r.id = p_result and r.release_state not in ('released', 'withheld')
                      and r.withdrawn_at is null and r.superseded_by is null) $f$;
    perform private.complete_lab_order_from_report((pg_temp.cd_for(d8)).id);
    perform pg_temp.assert_open(o_wh, 'S2');
    raise exception 'S2 NOT CAUGHT: the request stayed open with withheld treated as final';
  exception when others then
    if sqlerrm not like 'FAIL S2%' then raise exception '%', sqlerrm; end if;
  end;

  -- 10. an S27 result filed BEFORE any link (no order on it), then linked by staff
  o_s27 := pg_temp.order_for(v_org, v_pat, 'single_hba1c', v_staff, interval '250 days');
  v_out := private.submit_lab_result(v_pat, null, null, null,
    jsonb_build_object('file_path', v_pat::text || '/s27.pdf', 'original_filename', 's27.pdf', 'mime_type', 'application/pdf', 'file_size_bytes', 1000),
    'tarragon_team', v_doc, null);
  r3 := (v_out ->> 'lab_result_id')::uuid;
  select id into cd_f3 from public.clinical_documents where routed_table = 'lab_result_files'
     and routed_id = (select document_id from public.lab_results where id = r3);
  if (select lab_order_id from public.lab_results where id = r3) is not null then raise exception 'FAIL 10 setup: result already has an order'; end if;
  perform pg_temp.as_user(v_doc);
  set local role authenticated;
  perform public.link_clinical_document_to_lab_order(cd_f3, o_s27);
  reset role;
  perform set_config('request.jwt.claims', null, true);
  d9 := pg_temp.upload(v_org, v_pat, o_s27, '9.pdf', 'hba1c');
  perform pg_temp.review(d9, v_doc);
  perform pg_temp.assert_open(o_s27, '10 (held result filed before the link)');
  -- S3: documents tied to no S27 results
  begin
    create or replace function private.document_lab_result_ids(p_document uuid) returns uuid[]
      language sql stable security definer set search_path to '' as $f$ select '{}'::uuid[] $f$;
    perform private.complete_lab_order_from_report((pg_temp.cd_for(d9)).id);
    perform pg_temp.assert_open(o_s27, 'S3');
    raise exception 'S3 NOT CAUGHT: the request stayed open with no tie to the held result';
  exception when others then
    if sqlerrm not like 'FAIL S3%' then raise exception '%', sqlerrm; end if;
  end;
  -- releasing that result closes the request
  update public.lab_results set release_state = 'released', reviewed_by = v_doc where id = r3;
  perform pg_temp.assert_resulted(o_s27, '10 (closed once the earlier result is released)');

  -- 11. "mark reviewed" while the reading still holds an unfiled HbA1c value waits for the S27 hand-off
  o_x := pg_temp.order_for(v_org, v_pat, 'single_hba1c', v_staff, interval '350 days');
  d10 := pg_temp.upload(v_org, v_pat, o_x, '10.pdf', 'hba1c');
  insert into public.lab_report_extractions (organisation_id, patient_id, document_id, status, rows)
  values (v_org, v_pat, d10, 'extracted',
          '[{"code":"hba1c","value":"6.1","unit":"%","status":"ready","confidence":"high"}]'::jsonb);
  perform pg_temp.review(d10, v_doc);
  perform pg_temp.assert_open(o_x, '11 (values not yet filed)');
  -- S4: no yearly-panel mapping, so the pending check sees nothing to wait for
  begin
    create or replace function private.yearly_panel_screen_type(p_code text) returns text
      language sql immutable set search_path to '' as $f$ select null::text $f$;
    perform private.complete_lab_order_from_report((pg_temp.cd_for(d10)).id);
    perform pg_temp.assert_open(o_x, 'S4');
    raise exception 'S4 NOT CAUGHT: the request stayed open without the pending-values check';
  exception when others then
    if sqlerrm not like 'FAIL S4%' then raise exception '%', sqlerrm; end if;
  end;

  -- S5: without the completion trigger, a reviewed linked report leaves its request open (the step-2 check fails)
  begin
    drop trigger zz_lab_order_link_after on public.clinical_documents;
    d11 := pg_temp.upload(v_org, v_pat, o_lip2, '11.pdf', 'lipid_panel');
    perform pg_temp.review(d11, v_doc);
    perform pg_temp.assert_resulted(o_lip2, 'S5');
    raise exception 'S5 NOT CAUGHT: the request closed with the completion trigger removed';
  exception when others then
    if sqlerrm not like 'FAIL S5%' then raise exception '%', sqlerrm; end if;
  end;

  raise notice 'ALL CHECKS PASSED (5 sabotages caught)';
end $$;

rollback;
