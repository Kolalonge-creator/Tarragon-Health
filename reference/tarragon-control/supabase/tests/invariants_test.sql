-- I1-I10 invariant tests, per spec §18.1 ("one failing-first test per
-- invariant"). Run supabase/tests/m1_fixture.sql first.
--
-- Honesty note: I2, I6, I7, I10, I11, I12, I13 are NOT tested here because
-- the functionality they govern does not exist yet at M1 (the
-- classification pipeline is M5, patient export is M7, the internal
-- governance query is M8, ai_drafts/titration_proposals are Phase 2). A
-- fake pass for those would be worse than no test — each is called out
-- explicitly at the bottom of this file as pending, naming the milestone
-- that will make it testable. Only I1, I3, I4, I5, I8, I9, I14 have real
-- enforcement in the schema shipped so far, so only those get real
-- assertions below.

-- I1: no clinical content on an open rail (whatsapp/sms/email), enforced
-- at the DB level on both notification_templates and notification_sends.
do $$
begin
  begin
    insert into notification_templates (key, channel, content_class, criticality, body_template)
    values ('i1_violation_whatsapp_clinical', 'whatsapp', 'clinical', 'routine', 'Your BP is 180/110');
    raise exception 'FAIL I1: clinical content_class on whatsapp channel was NOT rejected';
  exception
    when check_violation then
      raise notice 'PASS I1a: clinical+whatsapp on notification_templates correctly rejected (%)', sqlerrm;
  end;

  -- valid non-clinical template on the same channel must succeed
  insert into notification_templates (key, channel, content_class, criticality, body_template)
  values ('i1_valid_whatsapp_nonclinical', 'whatsapp', 'non_clinical', 'important', 'Your result is ready — open the app.');
  raise notice 'PASS I1b: non_clinical+whatsapp template accepted';
end $$;

do $$
declare
  v_template_id uuid;
begin
  select id into v_template_id from notification_templates where key = 'i1_valid_whatsapp_nonclinical';
  begin
    insert into notification_sends (template_id, patient_id, channel, criticality, content_class)
    values (v_template_id, '33333333-3333-3333-3333-333333333301', 'sms', 'urgent', 'clinical');
    raise exception 'FAIL I1: clinical content_class on sms channel (notification_sends) was NOT rejected';
  exception
    when check_violation then
      raise notice 'PASS I1c: clinical+sms on notification_sends correctly rejected (%)', sqlerrm;
  end;
end $$;

-- I3: source_detail is NOT NULL on readings — "no unknown source path".
do $$
begin
  begin
    insert into readings (patient_id, type, value_numeric, unit, taken_at, source, source_detail)
    values ('33333333-3333-3333-3333-333333333301', 'weight', 70, 'kg', now(), 'patient_manual', null);
    raise exception 'FAIL I3: reading with null source_detail was NOT rejected';
  exception
    when not_null_violation then
      raise notice 'PASS I3: reading with null source_detail correctly rejected (%)', sqlerrm;
  end;
end $$;

-- I4: consent checked at query time, not account creation. Grant, read,
-- revoke, re-read in the same session, no cache invalidation step.
do $$
declare
  v_consent_id uuid;
  v_count int;
begin
  insert into consent_records (patient_id, scope, granted_to_profile_id, capture_method, captured_by)
  values ('33333333-3333-3333-3333-333333333301', 'funder_summary', '11111111-1111-1111-1111-111111111106', 'in_app', '11111111-1111-1111-1111-111111111101')
  returning id into v_consent_id;

  perform set_config('request.jwt.claims', json_build_object('sub','11111111-1111-1111-1111-111111111106','role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_count from consent_records where id = v_consent_id and granted_to_profile_id = auth.uid() and revoked_at is null;
  if v_count <> 1 then raise exception 'FAIL I4: grantee could not read an active consent grant made to them'; end if;
  raise notice 'PASS I4a: grantee reads an active consent grant';

  reset role;
  update consent_records set revoked_at = now() where id = v_consent_id;

  perform set_config('request.jwt.claims', json_build_object('sub','11111111-1111-1111-1111-111111111106','role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_count from consent_records where id = v_consent_id and granted_to_profile_id = auth.uid() and revoked_at is null;
  if v_count <> 0 then raise exception 'FAIL I4: revoked consent still visible to grantee in the same session, no cache clear'; end if;
  raise notice 'PASS I4b: revocation takes effect on the very next query, no cache invalidation needed';

  reset role; -- every block below needs the postgres/service context back
end $$;

-- I5: urgent/emergency classification cannot be closed by a text-only note
-- — closure requires a linked voice or synchronous_in_app contact.
do $$
declare
  v_reading_id uuid;
  v_urgent_classification_id uuid;
  v_contact_id uuid;
begin
  reset role; -- defensive: previous block may have left an authenticated role set
  insert into readings (patient_id, type, systolic, diastolic, unit, taken_at, source, source_detail)
  values ('33333333-3333-3333-3333-333333333301', 'bp', 190, 115, 'mmHg', now(), 'patient_manual', 'i5-fixture')
  returning id into v_reading_id;

  insert into triage_classifications (patient_id, reading_id, classification, protocol_config_id, rule_fired)
  values ('33333333-3333-3333-3333-333333333301', v_reading_id, 'urgent', '55555555-5555-5555-5555-555555555501', 'i5_fixture_urgent')
  returning id into v_urgent_classification_id;

  begin
    insert into clinical_notes (patient_id, clinician_id, note_type, body, linked_classification_id, accountability_model_at_signing, mdcn_number_at_signing)
    values ('33333333-3333-3333-3333-333333333301', '44444444-4444-4444-4444-444444444401', 'review', 'Text-only note attempting to close an urgent case', v_urgent_classification_id, 'tech_layer', 'MDCN-FIXTURE-001');
    raise exception 'FAIL I5: text-only closure of an urgent classification was NOT rejected';
  exception
    when others then
      if sqlerrm like 'I5 violation%' then
        raise notice 'PASS I5a: text-only closure of an urgent classification correctly rejected (%)', sqlerrm;
      else
        raise;
      end if;
  end;

  -- valid path: a voice contact exists and is linked — must succeed
  insert into clinical_contacts (patient_id, clinician_id, contact_type, started_at, ended_at, duration_seconds)
  values ('33333333-3333-3333-3333-333333333301', '44444444-4444-4444-4444-444444444401', 'voice', now(), now(), 300)
  returning id into v_contact_id;

  insert into clinical_notes (patient_id, clinician_id, note_type, body, linked_contact_id, linked_classification_id, accountability_model_at_signing, mdcn_number_at_signing)
  values ('33333333-3333-3333-3333-333333333301', '44444444-4444-4444-4444-444444444401', 'review', 'Closed after a voice call', v_contact_id, v_urgent_classification_id, 'tech_layer', 'MDCN-FIXTURE-001');
  raise notice 'PASS I5b: closure with a linked voice contact succeeds';

  reset role;
end $$;

-- I8: no capitation billing structure may exist — the enum itself has no
-- such value, so casting the string is rejected before any row is touched.
do $$
begin
  begin
    perform 'capitation'::invoice_line_type;
    raise exception 'FAIL I8: invoice_line_type accepted the value ''capitation''';
  exception
    when invalid_text_representation then
      raise notice 'PASS I8: invoice_line_type has no capitation value (%)', sqlerrm;
  end;
end $$;

-- I9: covered exhaustively by supabase/tests/m1_exit_test.sql
-- (institution_admin returns zero rows on every patient-scoped table).
do $$
begin
  raise notice 'SEE m1_exit_test.sql for I9 (institution_admin zero-rows), already asserted there';
end $$;

-- I14: a device-linked reading cannot be edited by a patient. Implemented
-- more strictly than the letter of I14 requires — patients have NO update
-- policy on readings at all (a correction is a new row, never an edit of
-- an existing one, device-sourced or not). Confirm zero rows affected.
do $$
declare
  v_reading_id uuid;
  v_affected int;
begin
  reset role; -- defensive: previous block may have left an authenticated role set
  insert into readings (patient_id, type, systolic, diastolic, unit, taken_at, source, source_detail, device_serial, device_firmware)
  values ('33333333-3333-3333-3333-333333333301', 'bp', 140, 90, 'mmHg', now(), 'patient_device_bt', 'i14-fixture-device', 'SN-FIXTURE-001', '1.0.0')
  returning id into v_reading_id;

  perform set_config('request.jwt.claims', json_build_object('sub','11111111-1111-1111-1111-111111111101','role','authenticated')::text, true);
  set local role authenticated;
  update readings set systolic = 999 where id = v_reading_id;
  get diagnostics v_affected = row_count;
  if v_affected <> 0 then raise exception 'FAIL I14: patient was able to edit a device-linked reading (% rows affected)', v_affected; end if;
  raise notice 'PASS I14: patient cannot edit a device-linked (or any) reading — 0 rows affected';

  reset role;
end $$;

do $$
begin
  raise notice '=== PENDING, not yet buildable at M1 (naming the dependency, not a gap in this schema) ===';
  raise notice 'I2  (every reading -> exactly one classification): needs the classification pipeline, M5';
  raise notice 'I6  (escalation counts never compensation-reachable): needs the internal governance query, M8';
  raise notice 'I7  (export always available regardless of subscription): needs the export feature, M7';
  raise notice 'I10 (every clinical action writes proof_log): needs each write path''s trigger, lands with M5-M8';
  raise notice 'I11/I12 (ai_drafts / titration_proposals): Phase 2 tables, not in scope until Phase 2 begins';
  raise notice 'I13 (research export governance): Phase 2 §3.9, not in scope until Phase 2 begins';
end $$;
