-- S09y proof: My Health gaps (migration *_s09y_my_health_gaps.sql).
--   1. Emergency card cover (HMO / NHIA member number and plan name): patient-typed, fixed provenance, written only through the RPC, never readable by
--      another patient or by staff directly, shown on the live card only when filled, never in the lock-screen payload, audited without the number.
--   2. Outside records: a patient-supplied file is 'unchecked' and cannot be made 'verified' by the patient, by an untied doctor, by a care coordinator
--      or by a direct write. Only a tied clinical-tier doctor can decide, once, and reviewed_by / reviewed_at are the server's. The clinician queue
--      (clinical_worklist / org_open_work_counts) carries the item and drops it when checked.
-- One rolled-back transaction. is_test data only. SABOTAGE section at the end: the care-tie check, the clinical-tier check and the status guard are each
-- removed once; the matching checks must flip (otherwise the test is vacuous).
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;

create function pg_temp.f(p text) returns uuid language sql as $$ select v from fx where k = p $$;
create function pg_temp.setf(p text, p_v uuid) returns void language sql as
$$ insert into fx values (p, p_v) on conflict (k) do update set v = excluded.v $$;
create function pg_temp.ck(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('real', p_name, p_expected, p_actual) $$;
create function pg_temp.act(p_uid uuid) returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
end $f$;
create function pg_temp.back() returns void language plpgsql as
$f$ begin reset role; perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.sub', '', true); perform set_config('request.jwt.claim.role', '', true); end $f$;
-- run one query as a signed-in user, return its single text value, or 'ERR:' || message
create function pg_temp.q_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlerrm; end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.q_anon(p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  perform set_config('request.jwt.claim.sub', '', true);
  set local role anon;
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlstate; end;
  reset role;
  return r;
end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's09y-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'S09y ' || p_label || ' Person', '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true)
  on conflict (id) do update set role = excluded.role, full_name = excluded.full_name, is_test = true, is_active = true, phone = excluded.phone;
  return v;
end $f$;
create function pg_temp.mkdoc(p_org uuid, p_label text, p_tier text, p_admin uuid) returns uuid
language plpgsql as $f$
declare v uuid;
begin
  v := pg_temp.mkuser(p_org, p_label, 'clinician');
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
  values (p_org, v, 'S09y ' || p_label, 'MDCN', 'S09Y-' || p_label || '-' || substr(v::text, 1, 8), true, 'active', now(), p_admin,
      p_tier::public.doctor_tier, 'contracted'::public.staff_employment_type,
      case when p_tier in ('senior_medical_officer', 'chief_medical_officer') then 2 else 1 end, true, p_admin, true);
  return v;
end $f$;
-- a patient-supplied document, inserted under the patient's own session; returns its id
create function pg_temp.mkdoc_as(p_patient uuid, p_label text) returns uuid
language plpgsql as $f$
declare v uuid;
begin
  perform pg_temp.act(p_patient);
  insert into public.patient_documents (organisation_id, patient_id, document_type, file_path, source)
  values (pg_temp.f('org'), p_patient, 'previous_hospital_record', p_patient || '/s09y-' || p_label || '.jpg', 'patient') returning id into v;
  perform pg_temp.back();
  return v;
end $f$;

-- Fixtures ---------------------------------------------------------------------------------------------------------------------
do $$
declare v_org uuid; v_admin uuid; v_p uuid; v_q uuid; v_tied uuid; v_untied uuid; v_co uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  perform pg_temp.setf('org', v_org);
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  v_p := pg_temp.mkuser(v_org, 'patient', 'patient');  perform pg_temp.setf('p', v_p);
  v_q := pg_temp.mkuser(v_org, 'other', 'patient');    perform pg_temp.setf('q', v_q);
  v_tied := pg_temp.mkdoc(v_org, 'tied', 'senior_medical_officer', v_admin);     perform pg_temp.setf('tied', v_tied);
  v_untied := pg_temp.mkdoc(v_org, 'untied', 'senior_medical_officer', v_admin); perform pg_temp.setf('untied', v_untied);
  v_co := pg_temp.mkdoc(v_org, 'coord', 'care_coordinator', v_admin);            perform pg_temp.setf('co', v_co);
  update public.profiles set emergency_contact_name = 'S09y Contact', emergency_contact_phone = '+2348012345678', emergency_contact_relationship = 'sibling'
   where id in (v_p, v_q);
  insert into public.patient_blood_profile (patient_id, organisation_id, blood_group, genotype, provenance, attested_at, attestation_version)
  values (v_p, v_org, 'O+', 'AA', 'patient_attested', now(), 'v1'), (v_q, v_org, 'A+', 'AS', 'patient_attested', now(), 'v1');
  -- the care tie: the 'tied' doctor and the coordinator are on patient p's team; the 'untied' doctor is not
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id, care_coordinator_id, assigned_at) values (v_org, v_p, v_tied, v_co, now());
exception when others then
  raise exception 'fixture failed: %', sqlerrm;
end $$;

-- 1. Cover on the emergency card -------------------------------------------------------------------------------------------------
do $$
declare v_p uuid := pg_temp.f('p'); v_q uuid := pg_temp.f('q'); tok text; card jsonb; r text;
begin
  perform pg_temp.ck('anon cannot save cover', '42501', replace(pg_temp.q_anon($q$select public.set_emergency_card_coverage('hmo', 'REL/12345', 'Gold')::text$q$), 'ERR:', ''));
  perform pg_temp.ck('a clinician cannot save cover on a card', 'true',
    (pg_temp.q_as(pg_temp.f('tied'), $q$select public.set_emergency_card_coverage('hmo', 'REL/12345', 'Gold')::text$q$) like 'ERR:%')::text);
  perform pg_temp.ck('a bad scheme is refused', 'true', (pg_temp.q_as(v_p, $q$select public.set_emergency_card_coverage('visa', 'REL/12345', 'Gold')::text$q$) like 'ERR:%choose HMO or NHIA%')::text);
  perform pg_temp.ck('markup in the plan name is refused', 'true', (pg_temp.q_as(v_p, $q$select public.set_emergency_card_coverage('hmo', 'REL/12345', '<b>x</b>')::text$q$) like 'ERR:%plan name%')::text);
  perform pg_temp.ck('a member number with punctuation attacks is refused', 'true', (pg_temp.q_as(v_p, $q$select public.set_emergency_card_coverage('hmo', '12; drop', null)::text$q$) like 'ERR:%member number%')::text);

  r := pg_temp.q_as(v_p, 'select public.create_emergency_card()::text');
  select token into tok from public.emergency_cards where patient_id = v_p and is_active;
  card := pg_temp.q_anon(format('select public.emergency_card_by_token(%L)::text', tok))::jsonb;
  perform pg_temp.ck('with no cover saved the live card has no cover key (its key set is unchanged)', 'false', (card ? 'coverage')::text);

  perform pg_temp.ck('the patient saves cover', 'saved', pg_temp.q_as(v_p, $q$select (public.set_emergency_card_coverage('hmo', 'REL/12345', 'Reliance Gold'))->>'status'$q$));
  perform pg_temp.ck('provenance is fixed and the actor is the server''s uid', 'patient_entered|true',
    (select provenance || '|' || (entered_by = patient_id)::text from public.emergency_card_coverage where patient_id = v_p));
  perform pg_temp.ck('another patient cannot read the row', '0', pg_temp.q_as(v_q, 'select count(*)::text from public.emergency_card_coverage'));
  perform pg_temp.ck('the care team (tied doctor) cannot read the row directly either', '0', pg_temp.q_as(pg_temp.f('tied'), 'select count(*)::text from public.emergency_card_coverage'));
  perform pg_temp.ck('the owner reads their own row', '1', pg_temp.q_as(v_p, 'select count(*)::text from public.emergency_card_coverage'));
  perform pg_temp.ck('no direct insert', 'true',
    (pg_temp.q_as(v_q, format($q$insert into public.emergency_card_coverage (patient_id, organisation_id, scheme, member_number) values (%L, %L, 'hmo', 'ABC123') returning patient_id::text$q$, v_q, pg_temp.f('org'))) like 'ERR:permission denied%')::text);
  perform pg_temp.ck('no direct update', 'true',
    (pg_temp.q_as(v_p, $q$update public.emergency_card_coverage set member_number = 'FORGED1' returning patient_id::text$q$) like 'ERR:permission denied%')::text);
  perform pg_temp.ck('the audit row names fields and never the number', '1|false',
    (select count(*)::text from public.audit_log where action = 'emergency_card_coverage.saved' and actor_id = v_p) || '|' ||
    (select coalesce(bool_or(event::text like '%REL/12345%'), false)::text from public.audit_log where action like 'emergency_card_coverage.%' and actor_id = v_p));

  card := pg_temp.q_anon(format('select public.emergency_card_by_token(%L)::text', tok))::jsonb;
  perform pg_temp.ck('the live card shows the cover once filled, labelled patient entered', 'REL/12345|Reliance Gold|hmo|patient_entered',
    (card #>> '{coverage,member_number}') || '|' || (card #>> '{coverage,plan_name}') || '|' || (card #>> '{coverage,scheme}') || '|' || (card #>> '{coverage,provenance}'));
  r := pg_temp.q_as(v_q, 'select public.create_emergency_card()::text');
  card := pg_temp.q_anon(format('select public.emergency_card_by_token(%L)::text', (select token from public.emergency_cards where patient_id = v_q and is_active)))::jsonb;
  perform pg_temp.ck('another patient''s live card never carries this patient''s cover', 'false', (card ? 'coverage')::text);

  perform pg_temp.q_as(v_p, 'select public.set_lock_screen_pass(true)::text');
  perform pg_temp.ck('the lock-screen payload carries no cover', 'false|false',
    (pg_temp.q_as(v_p, 'select public.my_lock_screen_facts()::text') ilike '%REL/12345%')::text || '|' || (pg_temp.q_as(v_p, 'select public.my_lock_screen_facts()::text') ilike '%coverage%')::text);
  perform pg_temp.ck('the lock-screen function source never mentions cover', 'false',
    (pg_get_functiondef('public.my_lock_screen_facts()'::regprocedure) ilike '%coverage%')::text);

  perform pg_temp.ck('both blank clears it', 'cleared', pg_temp.q_as(v_p, $q$select (public.set_emergency_card_coverage(null, '  ', ''))->>'status'$q$));
  card := pg_temp.q_anon(format('select public.emergency_card_by_token(%L)::text', tok))::jsonb;
  perform pg_temp.ck('...and the live card drops the cover key', 'false|0', (card ? 'coverage')::text || '|' || (select count(*)::text from public.emergency_card_coverage where patient_id = v_p));
  perform pg_temp.ck('a plan name alone is allowed', 'saved', pg_temp.q_as(v_p, $q$select (public.set_emergency_card_coverage('nhia', null, 'NHIA formal sector'))->>'status'$q$));
  perform pg_temp.ck('the registry lists the table, in the export', 'true', (select in_export::text from public.data_registry where table_name = 'emergency_card_coverage'));
end $$;

-- 2. Outside records ---------------------------------------------------------------------------------------------------------------
do $$
declare v_p uuid := pg_temp.f('p'); v_org uuid := pg_temp.f('org'); d1 uuid; d2 uuid; d3 uuid; d4 uuid; r text;
begin
  d1 := pg_temp.mkdoc_as(v_p, '1');
  perform pg_temp.setf('d1', d1);
  perform pg_temp.ck('a patient file starts unchecked, with no reviewer', 'unchecked|true|true',
    (select verification_status || '|' || (reviewed_by is null)::text || '|' || (reviewed_at is null)::text from public.patient_documents where id = d1));
  perform pg_temp.ck('an insert that claims to be checked is reset to unchecked', 'unchecked',
    pg_temp.q_as(v_p, format($q$insert into public.patient_documents (organisation_id, patient_id, document_type, file_path, source, verification_status, reviewed_at) values (%L, %L, 'other', %L, 'patient', 'verified', now()) returning verification_status$q$, v_org, v_p, v_p || '/s09y-forge.jpg')));
  insert into public.patient_documents (organisation_id, patient_id, document_type, file_path, source, uploaded_by)
  values (v_org, v_p, 'specialist_letter', v_p || '/s09y-c.pdf', 'clinician', pg_temp.f('tied')) returning id into d4;
  perform pg_temp.ck('a clinician-filed document is not applicable (nothing to check)', 'not_applicable', (select verification_status from public.patient_documents where id = d4));
  perform pg_temp.ck('the timeline never says "added to your record" for a patient file', 'Document you supplied',
    (select title from public.patient_timeline where source_table = 'patient_documents' and source_id = d1 limit 1));

  perform pg_temp.ck('a file a clinician filed keeps the old timeline title', 'Document added to your record',
    (select title from public.patient_timeline where source_table = 'patient_documents' and source_id = d4 limit 1));
  perform pg_temp.ck('verifying uses the care tie itself, never the broader read gate that also admits emergency access and support view', 'true|false',
    (position('private.clinician_has_patient_access' in pg_get_functiondef('public.verify_outside_record(uuid,text,text)'::regprocedure)) > 0)::text || '|' ||
    (position('can_staff_read_clinical' in pg_get_functiondef('public.verify_outside_record(uuid,text,text)'::regprocedure)) > 0)::text);
  perform pg_temp.ck('a patient cannot mark their own file verified', 'true',
    (pg_temp.q_as(v_p, format($q$update public.patient_documents set verification_status = 'verified', reviewed_at = now() where id = %L returning id::text$q$, d1)) is null
     and (select verification_status from public.patient_documents where id = d1) = 'unchecked')::text);
  begin
    update public.patient_documents set verification_status = 'verified', reviewed_at = now() where id = d1;
    r := 'flipped';
  exception when others then r := sqlerrm; end;
  perform pg_temp.ck('...the guard trigger refuses a direct flip', 'a document is checked only by a clinician, once', r);

  d2 := pg_temp.mkdoc_as(v_p, '2');
  perform pg_temp.setf('d2', d2);
  d3 := pg_temp.mkdoc_as(v_p, '3');
  perform pg_temp.setf('d3', d3);
  perform pg_temp.ck('the patient cannot verify their own file through the RPC', 'true',
    (pg_temp.q_as(v_p, format($q$select public.verify_outside_record(%L, 'verified')::text$q$, d2)) like 'ERR:not authorised%')::text);
  perform pg_temp.ck('anon cannot call the RPC', '42501', replace(pg_temp.q_anon(format($q$select public.verify_outside_record(%L, 'verified')::text$q$, d2)), 'ERR:', ''));
  perform pg_temp.ck('a care coordinator (tied) cannot verify', 'true',
    (pg_temp.q_as(pg_temp.f('co'), format($q$select public.verify_outside_record(%L, 'verified')::text$q$, d2)) like 'ERR:not authorised%')::text);
  r := pg_temp.q_as(pg_temp.f('untied'), format($q$select (public.verify_outside_record(%L, 'verified'))->>'status'$q$, d2));
  -- (a separate statement from the call: a row written by a function is not visible to a sub-select of the same statement)
  perform pg_temp.ck('a doctor with no tie to the patient is refused, and the refusal is audited as denied', 'refused|1',
    r || '|' || (select count(*)::text from public.audit_log where action = 'staff.outside_record_verify' and result = 'denied' and actor_id = pg_temp.f('untied')));
  perform pg_temp.ck('none of those changed the file', 'unchecked', (select verification_status from public.patient_documents where id = d2));

  -- the queue
  perform pg_temp.ck('the shared worklist shows the unchecked files to a clinician with no tie (name and date only)', '4',
    pg_temp.q_as(pg_temp.f('untied'), $q$select count(*)::text from public.clinical_worklist() w where w.kind = 'outside_records'$q$));
end $$;

-- Opening a file to check it ---------------------------------------------------------------------------------------------------------
do $$
declare d2 uuid := pg_temp.f('d2'); r_tied text; r_untied text;
begin
  r_tied := pg_temp.q_as(pg_temp.f('tied'), format($q$select public.open_outside_record_for_check(%L)::text$q$, d2));
  r_untied := pg_temp.q_as(pg_temp.f('untied'), format($q$select (public.open_outside_record_for_check(%L))->>'status'$q$, d2));
  perform pg_temp.ck('a tied doctor opens the file: status, path and the patient''s name only', 'ok|true|S09y patient Person',
    (r_tied::jsonb ->> 'status') || '|' || ((r_tied::jsonb ->> 'path') like '%/s09y-2.jpg')::text || '|' || (r_tied::jsonb ->> 'patient_name'));
  perform pg_temp.ck('an untied doctor is refused', 'refused', r_untied);
end $$;
do $$
declare d2 uuid := pg_temp.f('d2');
begin
  perform pg_temp.ck('the open is audited as a success for the tied doctor and as denied for the untied one', '1|1',
    (select count(*)::text from public.audit_log where action = 'staff.outside_record_open' and result = 'success' and actor_id = pg_temp.f('tied')) || '|' ||
    (select count(*)::text from public.audit_log where action = 'staff.outside_record_open' and result = 'denied' and actor_id = pg_temp.f('untied')));
  perform pg_temp.ck('a care coordinator and the patient cannot open it for checking', 'true|true',
    (pg_temp.q_as(pg_temp.f('co'), format($q$select public.open_outside_record_for_check(%L)::text$q$, d2)) like 'ERR:not authorised%')::text || '|' ||
    (pg_temp.q_as(pg_temp.f('p'), format($q$select public.open_outside_record_for_check(%L)::text$q$, d2)) like 'ERR:not authorised%')::text);
  perform pg_temp.ck('anon cannot call it', '42501', replace(pg_temp.q_anon(format($q$select public.open_outside_record_for_check(%L)::text$q$, d2)), 'ERR:', ''));
  perform pg_temp.ck('an unknown document is not found, not an error', 'not_found',
    pg_temp.q_as(pg_temp.f('tied'), format($q$select (public.open_outside_record_for_check(%L))->>'status'$q$, gen_random_uuid())));
end $$;

-- The tied doctor decides ----------------------------------------------------------------------------------------------------------
do $$
declare v_tied uuid := pg_temp.f('tied'); d1 uuid := pg_temp.f('d1'); d2 uuid := pg_temp.f('d2'); d3 uuid := pg_temp.f('d3'); r text;
begin
  perform pg_temp.ck('declining needs a short reason', 'true',
    (pg_temp.q_as(v_tied, format($q$select public.verify_outside_record(%L, 'not_verified')::text$q$, d1)) like 'ERR:%say briefly why%')::text);
  perform pg_temp.ck('a bad outcome is refused', 'true',
    (pg_temp.q_as(v_tied, format($q$select public.verify_outside_record(%L, 'approved')::text$q$, d1)) like 'ERR:%outcome%')::text);
  perform pg_temp.ck('the tied doctor verifies', 'verified', pg_temp.q_as(v_tied, format($q$select (public.verify_outside_record(%L, 'verified', 'Matches the discharge summary I was shown'))->>'status'$q$, d1)));
  perform pg_temp.ck('reviewed_by and reviewed_at are the doctor''s and the server''s', 'true|true',
    (select (reviewed_by = v_tied)::text || '|' || (reviewed_at is not null and abs(extract(epoch from now() - reviewed_at)) < 60)::text from public.patient_documents where id = d1));
  perform pg_temp.ck('the check is audited', '1', (select count(*)::text from public.audit_log where action = 'staff.outside_record_verified' and entity_id = d1));
  perform pg_temp.ck('a second decision is refused', 'true',
    (pg_temp.q_as(v_tied, format($q$select public.verify_outside_record(%L, 'not_verified', 'changed my mind')::text$q$, d1)) like 'ERR:%already been checked%')::text);
  perform pg_temp.ck('the tied doctor can decline another with a reason', 'not_verified', pg_temp.q_as(v_tied, format($q$select (public.verify_outside_record(%L, 'not_verified', 'The photo is too blurred to read'))->>'status'$q$, d2)));
  perform pg_temp.ck('the patient sees the status and the reviewer on their own row', 'verified|true',
    pg_temp.q_as(pg_temp.f('p'), format($q$select verification_status || '|' || (reviewed_by is not null)::text from public.patient_documents where id = %L$q$, d1)));
  perform pg_temp.ck('the staff chart view carries the status', 'verified', (select verification_status from public.documents where id = d1));
  perform pg_temp.ck('the queue now holds only the two still unchecked, in the list and in the totals', '2|2',
    pg_temp.q_as(pg_temp.f('untied'), $q$select count(*)::text from public.clinical_worklist() w where w.kind = 'outside_records'$q$) || '|' ||
    pg_temp.q_as(pg_temp.f('untied'), $q$select n::text from public.org_open_work_counts() where kind = 'outside_records'$q$));
  update public.patient_documents set reviewed_at = now() - interval '1 day', verification_status = 'verified' where id = d1;
  perform pg_temp.ck('a check cannot be re-dated afterwards', 'true',
    (select (reviewed_at > now() - interval '1 hour')::text from public.patient_documents where id = d1));
  perform pg_temp.ck('the FHIR export lists the status', 'true',
    (pg_get_functiondef('public.fhir_export_snapshot(uuid,text[],text)'::regprocedure) like '%source::text as source, verification_status, created_at%')::text);
end $$;

-- Grants -----------------------------------------------------------------------------------------------------------------------------
do $$
begin
  perform pg_temp.ck('no client can write the cover table, anon cannot read it', 'false|false|false|false',
    has_table_privilege('authenticated', 'public.emergency_card_coverage', 'INSERT')::text || '|' || has_table_privilege('authenticated', 'public.emergency_card_coverage', 'UPDATE')::text || '|' ||
    has_table_privilege('authenticated', 'public.emergency_card_coverage', 'DELETE')::text || '|' || has_table_privilege('anon', 'public.emergency_card_coverage', 'SELECT')::text);
  perform pg_temp.ck('patient_documents still has no UPDATE policy', '0',
    (select count(*)::text from pg_policies where schemaname = 'public' and tablename = 'patient_documents' and cmd in ('UPDATE', 'ALL')));
  perform pg_temp.ck('anon cannot execute either new function', 'false|false',
    has_function_privilege('anon', 'public.set_emergency_card_coverage(text,text,text)', 'EXECUTE')::text || '|' || has_function_privilege('anon', 'public.verify_outside_record(uuid,text,text)', 'EXECUTE')::text);
end $$;

-- SABOTAGE -------------------------------------------------------------------------------------------------------------------------
do $$
declare v_def text; v_def0 text; d uuid; r text;
begin
  v_def0 := pg_get_functiondef('public.verify_outside_record(uuid,text,text)'::regprocedure);

  -- (1) the care-tie check removed: an untied doctor must then be able to decide
  v_def := replace(v_def0, 'if not private.clinician_has_patient_access(d.patient_id) then', 'if false then');
  if v_def = v_def0 then raise exception 'sabotage 1 did not apply'; end if;
  execute v_def;
  d := pg_temp.mkdoc_as(pg_temp.f('p'), 'sab1');
  r := pg_temp.q_as(pg_temp.f('untied'), format($q$select (public.verify_outside_record(%L, 'verified'))->>'status'$q$, d));
  insert into results values ('sabotaged', 'SABOTAGE: without the care-tie check an untied doctor verifies', 'refused', r);

  -- (2) the clinical-tier check removed: a care coordinator must then be able to decide
  execute v_def0;
  v_def := replace(v_def0, 'if not private.is_clinical_tier(d.organisation_id) or d.patient_id = v_uid then', 'if d.patient_id = v_uid then');
  if v_def = v_def0 then raise exception 'sabotage 2 did not apply'; end if;
  execute v_def;
  d := pg_temp.mkdoc_as(pg_temp.f('p'), 'sab2');
  r := pg_temp.q_as(pg_temp.f('co'), format($q$select (public.verify_outside_record(%L, 'verified'))->>'status'$q$, d));
  insert into results values ('sabotaged', 'SABOTAGE: without the clinical-tier check a coordinator verifies', 'ERR:not authorised', r);
  execute v_def0;

  -- (3) the status guard dropped: a direct flip must then succeed
  drop trigger patient_documents_verification_guard on public.patient_documents;
  d := pg_temp.mkdoc_as(pg_temp.f('p'), 'sab3');
  begin
    update public.patient_documents set verification_status = 'verified', reviewed_at = now() where id = d;
    r := 'flipped';
  exception when others then r := sqlerrm; end;
  insert into results values ('sabotaged', 'SABOTAGE: without the guard trigger a direct write marks a file verified', 'a document is checked only by a clinician, once', r);

end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S09y proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and check_name like 'SABOTAGE%' and expected <> actual;
  if v_caught < 3 then raise exception 'VACUOUS TEST: the sabotage flipped % of 3 checks', v_caught; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results order by phase desc, check_name;

rollback;
