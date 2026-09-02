-- ===========================================================================
-- Verification: Patient Health Record architecture review, round 3 —
-- patient_documents (20260829221812), imaging_reports (20260829222245),
-- record_conflicts (20260829222717), patient_record_search
-- (20260829223204), clinical_summaries (20260829223649).
--
-- Run via `supabase db query "$(cat this_file.sql)" --linked`, `psql
-- $DATABASE_URL -f this_file.sql`, or the Supabase SQL editor.
-- Wrapped in BEGIN/ROLLBACK — nothing here persists.
-- ===========================================================================

begin;

create temporary table phr3_fixture(k text primary key, v uuid) on commit drop;
create temporary table phr3_result(
  check_name text, role text, observed text, expected text, verdict text
) on commit drop;

do $$
declare
  v_org        uuid;
  v_patient    uuid;
  v_patient2   uuid;
  v_clinician  uuid := gen_random_uuid();
begin
  select organisation_id into v_org
  from public.profiles
  where role = 'patient' and organisation_id is not null
  group by organisation_id order by count(*) desc limit 1;
  if v_org is null then
    raise exception 'no organisation has patient profiles — cannot run this test';
  end if;

  select id into v_patient from public.profiles where role = 'patient' and organisation_id = v_org limit 1;
  select id into v_patient2 from public.profiles
    where role = 'patient' and organisation_id = v_org and id <> v_patient limit 1;

  insert into phr3_fixture(k, v) values ('org', v_org), ('patient', v_patient), ('clinician', v_clinician);
  if v_patient2 is not null then
    insert into phr3_fixture(k, v) values ('patient2', v_patient2);
  end if;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v_clinician, 'phr3-test-clinician@example.invalid', 'x', now(), '{}', '{}');

  insert into public.profiles (id, organisation_id, role, full_name)
  values (v_clinician, v_org, 'clinician', 'PHR3 Test Clinician')
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role;
end $$;

-- ==========================================================================
-- 1. patient_documents: a patient CAN self-upload tagged source='patient',
--    but CANNOT upload tagged as another source; org staff can upload any.
-- ==========================================================================
do $$
declare
  v_org uuid := (select v from phr3_fixture where k = 'org');
  v_patient uuid := (select v from phr3_fixture where k = 'patient');
  v_caught boolean := false;
  v_doc uuid;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_patient::text, 'role', 'authenticated')::text, true);
  set local role authenticated;

  insert into public.patient_documents (organisation_id, patient_id, document_type, file_path, source)
  values (v_org, v_patient, 'vaccination_card', v_patient::text || '/self.pdf', 'patient')
  returning id into v_doc;

  begin
    insert into public.patient_documents (organisation_id, patient_id, document_type, file_path, source)
    values (v_org, v_patient, 'discharge_summary', v_patient::text || '/spoof.pdf', 'clinician');
  exception when others then
    v_caught := true;
  end;
  reset role;

  insert into phr3_fixture(k, v) values ('document', v_doc);

  insert into phr3_result values
    ('patient self-upload allowed (source=patient)', 'patient', case when v_doc is not null then 'inserted' else 'blocked' end,
     'inserted', case when v_doc is not null then 'PASS' else 'FAIL' end);
  insert into phr3_result values
    ('patient cannot spoof source=clinician', 'patient', case when v_caught then 'blocked' else 'not blocked' end,
     'blocked', case when v_caught then 'PASS' else 'FAIL' end);
  if v_doc is null then
    raise exception 'BROKEN: a patient could not upload their own document';
  end if;
  if not v_caught then
    raise exception 'LEAK: a patient session inserted a patient_documents row tagged source=clinician';
  end if;
end $$;

-- ==========================================================================
-- 2. patient_documents: the upload reached patient_timeline as
--    document_uploaded, and uploaded_by was server-derived (not spoofable).
-- ==========================================================================
do $$
declare
  v_document uuid := (select v from phr3_fixture where k = 'document');
  v_patient uuid := (select v from phr3_fixture where k = 'patient');
  v_uploaded_by uuid;
  v_timeline_count bigint;
begin
  select uploaded_by into v_uploaded_by from public.patient_documents where id = v_document;
  select count(*) into v_timeline_count from public.patient_timeline
    where source_table = 'patient_documents' and source_id = v_document and event_type = 'document_uploaded';

  insert into phr3_result values
    ('patient_documents.uploaded_by server-derived', 'system', coalesce(v_uploaded_by::text, 'null'), v_patient::text,
     case when v_uploaded_by = v_patient then 'PASS' else 'FAIL' end);
  insert into phr3_result values
    ('document upload reached patient_timeline', 'system', v_timeline_count::text, '1',
     case when v_timeline_count = 1 then 'PASS' else 'FAIL' end);
  if v_uploaded_by is distinct from v_patient then
    raise exception 'BROKEN: patient_documents.uploaded_by was not correctly server-derived';
  end if;
  if v_timeline_count <> 1 then
    raise exception 'BROKEN: patient_documents insert did not reach patient_timeline';
  end if;
end $$;

-- ==========================================================================
-- 3. imaging_reports: an org-staff upload raises a clinician_review alert
--    (same shape as lab_result_documents), and a patient cannot upload
--    tagged as another source.
-- ==========================================================================
do $$
declare
  v_org uuid := (select v from phr3_fixture where k = 'org');
  v_patient uuid := (select v from phr3_fixture where k = 'patient');
  v_clinician uuid := (select v from phr3_fixture where k = 'clinician');
  v_report uuid;
  v_alert_id uuid;
  v_alert_status text;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_clinician::text, 'role', 'authenticated')::text, true);
  set local role authenticated;

  insert into public.imaging_reports
    (organisation_id, patient_id, modality, file_path, source)
  values (v_org, v_patient, 'xray', v_patient::text || '/chest-xray.pdf', 'clinician')
  returning id, clinician_alert_id into v_report, v_alert_id;
  reset role;

  insert into phr3_fixture(k, v) values ('imaging_report', v_report);

  select status::text into v_alert_status from public.clinician_alerts where id = v_alert_id;

  insert into phr3_result values
    ('imaging_reports upload raised a clinician_review alert', 'system', coalesce(v_alert_status, 'none'), 'open',
     case when v_alert_status = 'open' then 'PASS' else 'FAIL' end);
  if v_alert_id is null or v_alert_status is distinct from 'open' then
    raise exception 'BROKEN: imaging_reports insert did not raise an open clinician_review alert';
  end if;
end $$;

-- ==========================================================================
-- 4. record_conflicts: a patient CANNOT flag a conflict; org staff CAN.
--    The resolution-consistency CHECK holds at every step.
-- ==========================================================================
do $$
declare
  v_org uuid := (select v from phr3_fixture where k = 'org');
  v_patient uuid := (select v from phr3_fixture where k = 'patient');
  v_clinician uuid := (select v from phr3_fixture where k = 'clinician');
  v_document uuid := (select v from phr3_fixture where k = 'document');
  v_conflict uuid;
  v_caught boolean := false;
  v_status text;
  v_resolved_by uuid;
  v_resolved_at timestamptz;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_patient::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into public.record_conflicts
      (organisation_id, patient_id, source_document_id, conflict_type, description)
    values (v_org, v_patient, v_document, 'possible_duplicate', 'patient tried to flag their own conflict');
  exception when others then
    v_caught := true;
  end;
  reset role;

  insert into phr3_result values
    ('patient cannot insert record_conflicts', 'patient', case when v_caught then 'blocked' else 'not blocked' end,
     'blocked', case when v_caught then 'PASS' else 'FAIL' end);
  if not v_caught then
    raise exception 'LEAK: a patient session inserted a record_conflicts row';
  end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_clinician::text, 'role', 'authenticated')::text, true);
  set local role authenticated;

  insert into public.record_conflicts
    (organisation_id, patient_id, source_document_id, conflict_type, description)
  values (v_org, v_patient, v_document, 'possible_duplicate', 'Uploaded discharge summary looks like a duplicate of an existing record')
  returning id, status::text, resolved_by, resolved_at into v_conflict, v_status, v_resolved_by, v_resolved_at;
  reset role;

  -- The temporary result/fixture tables were created by the connecting
  -- (superuser) role before any `set local role` — `authenticated` has no
  -- INSERT privilege on them, so every write to phr3_result/phr3_fixture
  -- must happen after `reset role`, never while impersonating a session
  -- role. (Confirmed live: an earlier draft of this test inserted here
  -- while still `authenticated` and failed with a real permission error —
  -- see docs/PATIENT_HEALTH_RECORD_ARCHITECTURE.md §0.)
  insert into phr3_result values
    ('fresh record_conflict starts open with no resolution stamp', 'clinician',
     format('status=%s resolved_by=%s resolved_at=%s', v_status, v_resolved_by, v_resolved_at),
     'status=open resolved_by=<null> resolved_at=<null>',
     case when v_status = 'open' and v_resolved_by is null and v_resolved_at is null then 'PASS' else 'FAIL' end);
  if v_status is distinct from 'open' or v_resolved_by is not null or v_resolved_at is not null then
    raise exception 'BROKEN: a freshly-flagged record_conflict was not open with a null resolution stamp';
  end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_clinician::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.record_conflicts
    set status = 'resolved_updated_record', resolution_note = 'Existing record corrected to match the upload'
    where id = v_conflict;
  reset role;

  insert into phr3_fixture(k, v) values ('conflict', v_conflict);

  select status::text, resolved_by, resolved_at into v_status, v_resolved_by, v_resolved_at
    from public.record_conflicts where id = v_conflict;

  insert into phr3_result values
    ('resolving a record_conflict stamps resolved_by/resolved_at', 'system',
     format('status=%s resolved_by=%s', v_status, v_resolved_by),
     format('status=resolved_updated_record resolved_by=%s', v_clinician),
     case when v_status = 'resolved_updated_record' and v_resolved_by = v_clinician and v_resolved_at is not null
       then 'PASS' else 'FAIL' end);
  if v_status is distinct from 'resolved_updated_record' or v_resolved_by is distinct from v_clinician or v_resolved_at is null then
    raise exception 'BROKEN: resolving a record_conflict did not correctly stamp resolved_by/resolved_at';
  end if;
end $$;

-- ==========================================================================
-- 5. record_conflicts: both timeline events fired (flagged + resolved).
-- ==========================================================================
do $$
declare
  v_conflict uuid := (select v from phr3_fixture where k = 'conflict');
  v_count bigint;
begin
  select count(*) into v_count from public.patient_timeline
    where source_table = 'record_conflicts' and source_id = v_conflict
      and event_type in ('record_conflict_flagged', 'record_conflict_resolved');
  insert into phr3_result values
    ('record_conflict flag + resolve reach patient_timeline', 'system', v_count::text, '2',
     case when v_count = 2 then 'PASS' else 'FAIL' end);
  if v_count <> 2 then
    raise exception 'BROKEN: expected 2 timeline rows (flagged + resolved) for conflict %, got %', v_conflict, v_count;
  end if;
end $$;

-- ==========================================================================
-- 6. clinical_summaries: refresh_clinical_summary() generates a draft that
--    mentions the patient's active condition, and a second refresh does NOT
--    clobber a clinician's own validated/edited text.
-- ==========================================================================
do $$
declare
  v_org uuid := (select v from phr3_fixture where k = 'org');
  v_patient uuid := (select v from phr3_fixture where k = 'patient');
  v_clinician uuid := (select v from phr3_fixture where k = 'clinician');
  v_narrative text;
  v_source text;
begin
  -- Give this patient something for the draft generator to actually find.
  insert into public.patient_conditions (organisation_id, patient_id, condition_name, status, recorded_by)
  values (v_org, v_patient, 'PHR3 Test Hypertension', 'active', v_clinician);

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_clinician::text, 'role', 'authenticated')::text, true);
  set local role authenticated;

  perform public.refresh_clinical_summary(v_patient);

  select narrative_text, source::text into v_narrative, v_source
    from public.clinical_summaries where patient_id = v_patient;
  reset role;

  -- Same rule as test 4: phr3_result was created by the connecting
  -- (superuser) role before any `set local role`, so `authenticated` has no
  -- INSERT privilege on it — every write must happen after `reset role`.
  insert into phr3_result values
    ('generated draft mentions the active condition', 'system',
     case when v_narrative ilike '%PHR3 Test Hypertension%' then 'mentioned' else 'missing' end,
     'mentioned', case when v_narrative ilike '%PHR3 Test Hypertension%' then 'PASS' else 'FAIL' end);
  if v_narrative not ilike '%PHR3 Test Hypertension%' then
    raise exception 'BROKEN: generated clinical summary draft did not mention the patient''s active condition: %', v_narrative;
  end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_clinician::text, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- refresh_clinical_summary() marks its own write with a transaction-local
  -- GUC so the write-guard trigger doesn't mistake a clinician's own edit
  -- for another auto-refresh (see that migration's header). In production
  -- each RPC call is its own transaction so this resets on its own; here,
  -- within one test transaction, it must be cleared explicitly to simulate
  -- the clinician's edit as a genuinely separate request.
  perform set_config('app.clinical_summary_system_write', '', true);

  -- Clinician hand-edits and validates it.
  update public.clinical_summaries
    set narrative_text = 'Manually reviewed: stable on current regimen.', is_clinician_validated = true
    where patient_id = v_patient;

  -- A regeneration must NOT clobber the clinician's own text.
  perform public.refresh_clinical_summary(v_patient);

  select narrative_text, source::text into v_narrative, v_source
    from public.clinical_summaries where patient_id = v_patient;
  reset role;

  insert into phr3_result values
    ('refresh does not clobber a clinician-edited summary', 'system', v_source, 'clinician_edited',
     case when v_narrative = 'Manually reviewed: stable on current regimen.' and v_source = 'clinician_edited'
       then 'PASS' else 'FAIL' end);
  if v_narrative is distinct from 'Manually reviewed: stable on current regimen.' then
    raise exception 'BROKEN: refresh_clinical_summary() overwrote a clinician-edited narrative_text';
  end if;
end $$;

-- ==========================================================================
-- 7. clinical_summaries: patient can read their own (validated) summary but
--    cannot write to it.
-- ==========================================================================
do $$
declare
  v_patient uuid := (select v from phr3_fixture where k = 'patient');
  v_caught boolean := false;
  v_readable boolean;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_patient::text, 'role', 'authenticated')::text, true);
  set local role authenticated;

  select exists(select 1 from public.clinical_summaries where patient_id = v_patient) into v_readable;

  -- The UPDATE policy denies this row to a patient session; RLS makes a
  -- denied UPDATE match zero rows rather than raise, so the only reliable
  -- check is confirming the write never actually landed.
  update public.clinical_summaries set narrative_text = 'patient tampering' where patient_id = v_patient;
  select not exists(
    select 1 from public.clinical_summaries where patient_id = v_patient and narrative_text = 'patient tampering'
  ) into v_caught;
  reset role;

  insert into phr3_result values
    ('patient can read own clinical_summaries row', 'patient', v_readable::text, 'true',
     case when v_readable then 'PASS' else 'FAIL' end);
  insert into phr3_result values
    ('patient cannot write clinical_summaries', 'patient', case when v_caught then 'blocked' else 'not blocked' end,
     'blocked', case when v_caught then 'PASS' else 'FAIL' end);
  if not v_readable then
    raise exception 'BROKEN: patient could not read their own clinical_summaries row';
  end if;
  if not v_caught then
    raise exception 'LEAK: a patient session updated their own clinical_summaries row';
  end if;
end $$;

-- ==========================================================================
-- 8. search_patient_record: the patient finds their own condition by name;
--    a different patient searching gets nothing back for a query only the
--    first patient's record matches (no cross-patient leak via ranking).
-- ==========================================================================
do $$
declare
  v_patient uuid := (select v from phr3_fixture where k = 'patient');
  v_patient2 uuid := (select v from phr3_fixture where k = 'patient2');
  v_hit_count int;
  v_cross_count int := 0;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_patient::text, 'role', 'authenticated')::text, true);
  set local role authenticated;

  select count(*) into v_hit_count from public.search_patient_record(v_patient, 'PHR3 Test Hypertension')
    where table_name = 'patient_conditions';
  reset role;

  insert into phr3_result values
    ('search_patient_record finds own condition', 'patient', v_hit_count::text, '>=1',
     case when v_hit_count >= 1 then 'PASS' else 'FAIL' end);
  if v_hit_count < 1 then
    raise exception 'BROKEN: search_patient_record did not find the patient''s own condition';
  end if;

  if v_patient2 is not null then
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_patient2::text, 'role', 'authenticated')::text, true);
    set local role authenticated;
    begin
      select count(*) into v_cross_count from public.search_patient_record(v_patient, 'PHR3 Test Hypertension');
    exception when others then
      v_cross_count := -1; -- an exception (insufficient_privilege) also counts as correctly blocked
    end;
    reset role;

    insert into phr3_result values
      ('a different patient cannot search this patient''s record', 'patient2',
       case when v_cross_count <= 0 then 'blocked/empty' else v_cross_count::text end,
       'blocked/empty', case when v_cross_count <= 0 then 'PASS' else 'FAIL' end);
    if v_cross_count > 0 then
      raise exception 'LEAK: search_patient_record(v_patient, ...) returned % rows to an unrelated patient session', v_cross_count;
    end if;
  end if;
end $$;

-- ==========================================================================
-- Summary
-- ==========================================================================
do $$
declare
  v_fail_count int;
  v_report     text;
begin
  select string_agg(format('[%s] %-62s observed=%s expected=%s', verdict, check_name, observed, expected), E'\n')
    into v_report from phr3_result;
  raise notice E'--- patient_health_record_round3 results ---\n%', v_report;

  select count(*) into v_fail_count from phr3_result where verdict = 'FAIL';
  if v_fail_count > 0 then
    raise exception '% check(s) FAILED — see notices above', v_fail_count;
  end if;
  raise notice 'ALL CHECKS PASSED (%)', (select count(*) from phr3_result);
end $$;

rollback;
