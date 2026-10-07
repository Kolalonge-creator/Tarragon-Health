-- S44 proof: interoperability (migrations *_s44_external_exchange_consent_and_records, *_s44_item_notes_and_correction_requests,
-- *_s44_fhir_export_snapshot, *_s44_lab_structured_push_mappings). One rolled-back transaction. Proves:
--   1. Import consent: an import with no consent in force is REFUSED and stores nothing (no batch, proposal or external record) and is audited;
--      a missing source is refused; with consent the import lands (proposal + evidence row + bus event); a replay is idempotent; withdrawing consent
--      stops the next import; a corrected re-send supersedes the older proposal and evidence row; external_records is immutable; a client cannot
--      call the writer; the person reads their own records, another patient reads none; staff read only through the audited, tied function.
--   2. consent_in_force (the wearable_device_data check used by the health-store route): none, accepted, withdrawn.
--   3. Labels, dates and notes: allowed on every item including a device reading the person cannot edit; the item is unchanged; the lock still blocks
--      a patient edit of that device reading; another patient's item is "not found"; staff cannot read a note; correction requests name an item the
--      requester owns (also through a direct insert); a note never appears in the export.
--   4. Export snapshot: self sees every section; a held, withheld or sensitive-positive result is never exported (INV-03, INV-04); a rejected or
--      unconfirmed document never exposes its text; a supporter gets only the sections of the categories granted; an untied clinician is denied and the
--      denial is audited; a tied clinician needs a reason and writes an audit row (INV-10, INV-12); reproductive and mental health are not sections.
--   5. Partner lab structured push: mappings are proposed by an admin and confirmed only by the CMO; an unconfirmed mapping is never used; an unmapped item
--      rejects the whole push and stores no result; a unit conversion uses the confirmed multiplier; a replayed message id writes nothing new;
--      an all-normal result against signed ranges is released, a critical value is HELD with a review task (INV-03), a reactive HIV result goes to
--      clinician disclosure (INV-04); the lab never learns the clinical reason; another lab is refused.
--   6. Grants: nothing new is callable by anon; no client role can write a new table directly.
--   7. SABOTAGE: the consent lookup, the CMO gate, the item-owner check and the staff tie are each defeated once; each must flip its check.
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
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
end $f$;
create function pg_temp.back() returns void language plpgsql as
$f$ begin reset role; perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.role', '', true); end $f$;
create function pg_temp.q_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlerrm; end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.try_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql; r := 'ok'; exception when others then r := sqlerrm; end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.try_anon(p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
  begin execute p_sql; r := 'ok'; exception when others then r := sqlstate; end;
  reset role;
  return r;
end $f$;
create function pg_temp.svc(p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  set local role service_role;
  begin execute p_sql into r; r := coalesce(r, 'ok'); exception when others then r := 'ERR:' || sqlerrm; end;
  reset role;
  return r;
end $f$;
create function pg_temp.owner_try(p_sql text) returns text language plpgsql as
$f$ begin execute p_sql; return 'ok'; exception when others then return sqlerrm; end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's44-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'S44 ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone;
  return v;
end $f$;
create function pg_temp.mkdoc(p_org uuid, p_label text, p_tier text, p_admin uuid) returns uuid
language plpgsql as $f$
declare v uuid; s uuid;
begin
  v := pg_temp.mkuser(p_org, p_label, 'clinician');
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
  values (p_org, v, 'S44 ' || p_label, 'MDCN', 'S44-' || p_label || '-' || substr(v::text, 1, 8), true, 'active', now(), p_admin,
      p_tier::public.doctor_tier, 'contracted'::public.staff_employment_type,
      case when p_tier in ('senior_medical_officer', 'chief_medical_officer') then 2 else 1 end, true, p_admin, true)
  returning id into s;
  insert into public.clinician_competencies (organisation_id, clinical_staff_id, competency_code, granted_by, is_test)
  values (p_org, s, 'result_review', p_admin, true);
  return v;
end $f$;
create function pg_temp.mkorder(p_org uuid, p_pat uuid, p_provider uuid, p_panel text) returns uuid language plpgsql as
$f$ declare v uuid;
begin
  insert into public.lab_orders (organisation_id, patient_id, provider_id, fulfilment, status, origin, ordered_by, clinical_indication, payment_confirmed_at, panel_code)
  values (p_org, p_pat, p_provider, 'partner', 'pending_payment', 'clinically_triggered',
          (select id from public.clinical_staff where profile_id = pg_temp.f('doc')), 'S44 proof order', now() - interval '1 hour', p_panel) returning id into v;
  update public.lab_orders set status = 'sample_collected', payment_confirmed_at = now() - interval '1 hour' where id = v;
  return v;
end $f$;
-- a bundle resource as fhir_import_accept expects it
create function pg_temp.res(p_type text, p_id text, p_proposal boolean, p_payload text default '{"vital_type":"glucose","taken_at":"2026-10-01T08:00:00Z","glucose_mmol_l":5.4,"glucose_context":"random"}')
returns text language sql as
$$ select json_build_object('resource_type', p_type, 'fhir_resource_type', p_type, 'fhir_resource_id', p_id,
     'raw_resource', json_build_object('resourceType', p_type, 'id', p_id),
     'normalized_payload', case when p_proposal then p_payload::json else null end, 'parse_warnings', '[]'::json, 'parser_version', 1)::text $$;
create function pg_temp.accept(p_pat uuid, p_source text, p_bundle text, p_resources text) returns text language sql as
$$ select pg_temp.svc(format($q$select public.fhir_import_accept(%L, (select id from public.api_keys where name = 'S44 proof'), %L, %L, %L, '{"resourceType":"Bundle"}'::jsonb, '{}'::jsonb, '[]'::jsonb, %L::jsonb)::text$q$,
     pg_temp.f('org'), p_pat, p_source, p_bundle, p_resources)) $$;

do $$
declare
  v_org uuid; v_admin uuid; v_pat uuid; v_pat2 uuid; v_doc uuid; v_doc2 uuid; v_cmo uuid; v_sup uuid; v_sup2 uuid; v_pa uuid;
  v_key uuid; v_j jsonb; v_t text; v_n integer; v_b1 uuid; v_vm uuid; v_vd uuid; v_vm2 uuid; v_lab uuid; v_lab2 uuid; v_labu uuid; v_labu2 uuid;
  v_r1 uuid; v_r2 uuid; v_r3 uuid; v_r4 uuid; v_doc_ok uuid; v_doc_bad uuid; v_cv uuid; v_o uuid; v_o2 uuid; v_o3 uuid; v_o4 uuid;
  v_m uuid; v_rid uuid; v_before integer; v_cn integer;
  v_pat3 uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  perform pg_temp.setf('org', v_org);
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');  perform pg_temp.setf('admin', v_admin);
  v_pat := pg_temp.mkuser(v_org, 'pat', 'patient');    perform pg_temp.setf('pat', v_pat);
  v_pat2 := pg_temp.mkuser(v_org, 'pat2', 'patient');  perform pg_temp.setf('pat2', v_pat2);
  v_pat3 := pg_temp.mkuser(v_org, 'pat3', 'patient');
  v_doc := pg_temp.mkdoc(v_org, 'tied', 'senior_medical_officer', v_admin);   perform pg_temp.setf('doc', v_doc);
  v_doc2 := pg_temp.mkdoc(v_org, 'untied', 'senior_medical_officer', v_admin); perform pg_temp.setf('doc2', v_doc2);
  v_cmo := pg_temp.mkdoc(v_org, 'cmo', 'chief_medical_officer', v_admin);     perform pg_temp.setf('cmo', v_cmo);
  v_sup := pg_temp.mkuser(v_org, 'sup', 'patient');
  v_sup2 := pg_temp.mkuser(v_org, 'sup2', 'patient');
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id, assigned_at) values (v_org, v_pat, v_doc, now());
  insert into public.api_keys (organisation_id, name, key_prefix, key_hash, scopes) values (v_org, 'S44 proof', 'tk_s44', 'x' || gen_random_uuid(), '{fhir:import}') returning id into v_key;

  -- ===== 1. import consent ======================================================================================================
  select count(*) into v_before from public.fhir_import_batches where patient_id = v_pat;
  v_t := pg_temp.accept(v_pat, 'Helium Health', 'b-noconsent-1', '[' || pg_temp.res('Observation', 'o-1', true) || ']');
  perform pg_temp.ck('1a an import with no consent is refused', 'consent_required', (v_t::jsonb) ->> 'status');
  perform pg_temp.ck('1b ...and stores nothing: no batch, no proposal, no external record', '0|0|0',
    (select count(*) from public.fhir_import_batches where patient_id = v_pat)::text || '|' ||
    (select count(*) from public.fhir_import_proposed_resources where patient_id = v_pat)::text || '|' ||
    (select count(*) from public.external_records where patient_id = v_pat)::text);
  perform pg_temp.ck('1c ...and the refusal is on the audit trail', '1',
    (select count(*)::text from public.audit_log where action = 'fhir_import.refused_no_consent' and subject_patient_id = v_pat));
  perform pg_temp.ck('1d a missing source is refused', 'source_required', (pg_temp.accept(v_pat, '  ', 'b-x', '[]')::jsonb) ->> 'status');
  perform pg_temp.ck('1e an unknown patient is refused', 'patient_not_found',
    (pg_temp.svc(format($q$select public.fhir_import_accept(%L, null, %L, 'helium health', 'b-y', '{}'::jsonb, '{}'::jsonb, '[]'::jsonb, '[]'::jsonb)::text$q$, v_org, gen_random_uuid()))::jsonb) ->> 'status');
  perform pg_temp.ck('1f only a patient can grant a consent', 'true',
    (pg_temp.q_as(v_doc, $q$select public.grant_external_exchange_consent('helium health', 'import')::text$q$) like 'ERR:this action is for patients')::text);

  v_j := pg_temp.q_as(v_pat, $q$select public.grant_external_exchange_consent('  Helium Health ', 'import')::text$q$)::jsonb;
  perform pg_temp.ck('1g the source name is normalised', 'helium health', v_j ->> 'source_system');
  perform pg_temp.setf('consent1', (v_j ->> 'id')::uuid);
  perform pg_temp.ck('1h consent for another system does not cover this one', 'consent_required',
    (pg_temp.accept(v_pat, 'some other emr', 'b-other', '[]')::jsonb) ->> 'status');
  perform pg_temp.ck('1i an export-only consent does not allow import', 'consent_required', (
    select (pg_temp.accept(v_pat3, 'export only emr', 'b-eo', '[]')::jsonb) ->> 'status'));
  perform pg_temp.q_as(pg_temp.f('pat2'), $q$select public.grant_external_exchange_consent('exportonly', 'export')::text$q$);
  perform pg_temp.ck('1j ...even for the person who gave it for export only', 'consent_required', (pg_temp.accept(v_pat2, 'exportonly', 'b-eo2', '[]')::jsonb) ->> 'status');

  v_t := pg_temp.accept(v_pat, 'helium health', 'b-1',
    '[' || pg_temp.res('Observation', 'o-1', true) || ',' || pg_temp.res('Condition', 'c-1', false) || ',' || pg_temp.res('DocumentReference', 'd-1', false) || ']');
  perform pg_temp.ck('1k with consent the import lands', 'ok|false|1', ((v_t::jsonb) ->> 'status') || '|' || ((v_t::jsonb) ->> 'already_processed') || '|' || ((v_t::jsonb) ->> 'proposed_count'));
  v_b1 := ((v_t::jsonb) ->> 'batch_id')::uuid;
  perform pg_temp.ck('1l one evidence row per resource: proposal for the Observation, stored-only for the others', 'proposed:1|stored_only:2',
    (select string_agg(disposition || ':' || n, '|' order by disposition) from (select disposition, count(*)::text as n from public.external_records where patient_id = v_pat group by 1) x));
  perform pg_temp.ck('1m the evidence names the consent it was received under', 'true',
    (select (bool_and(consent_id = pg_temp.f('consent1')))::text from public.external_records where patient_id = v_pat));
  perform pg_temp.ck('1n the proposal is clinically inert (nothing in vitals)', '0', (select count(*)::text from public.vitals_readings where patient_id = v_pat));
  perform pg_temp.ck('1o the bus event carries ids only', '1',
    (select count(*)::text from public.domain_events where event_type = 'external_record.imported' and aggregate_id = v_b1 and payload::text !~* 'glucose'));
  v_t := pg_temp.accept(v_pat, 'helium health', 'b-1', '[' || pg_temp.res('Observation', 'o-1', true) || ']');
  perform pg_temp.ck('1p a replay of the same bundle is idempotent', 'true|1',
    (((v_t::jsonb) ->> 'already_processed')) || '|' || (select count(*)::text from public.fhir_import_batches where patient_id = v_pat));
  v_t := pg_temp.accept(v_pat, 'helium health', 'b-2', '[' || pg_temp.res('Observation', 'o-1', true, '{"vital_type":"glucose","taken_at":"2026-10-01T08:00:00Z","glucose_mmol_l":6.1,"glucose_context":"random"}') || ']');
  perform pg_temp.ck('1q a corrected re-send supersedes the older proposal', 'superseded:1|proposed:1',
    (select string_agg(status::text || ':' || n, '|' order by status::text desc) from (select status, count(*)::text as n from public.fhir_import_proposed_resources where patient_id = v_pat and fhir_resource_id = 'o-1' group by 1) x));
  perform pg_temp.ck('1r ...and the older evidence row, leaving exactly one current', '1',
    (select count(*)::text from public.external_records where patient_id = v_pat and fhir_id = 'o-1' and superseded_at is null));
  perform pg_temp.ck('1s evidence cannot be edited', 'external_records_immutable',
    pg_temp.owner_try(format($q$update public.external_records set payload = '{}'::jsonb where patient_id = %L and fhir_id = 'o-1' and superseded_at is null$q$, v_pat)));
  perform pg_temp.ck('1t ...or deleted', 'external_records_immutable', pg_temp.owner_try(format($q$delete from public.external_records where patient_id = %L$q$, v_pat)));
  perform pg_temp.ck('1u a client cannot call the import writer', 'true',
    (pg_temp.q_as(v_pat, format($q$select public.fhir_import_accept(%L, null, %L, 'helium health', 'b-z', '{}'::jsonb, '{}'::jsonb, '[]'::jsonb, '[]'::jsonb)$q$, v_org, v_pat)) like 'ERR:permission denied%')::text);
  perform pg_temp.ck('1v the person reads their own records', '4', pg_temp.q_as(v_pat, 'select count(*)::text from public.my_external_records()'));
  perform pg_temp.ck('1w another patient reads none, and no staff session reads the table directly', '0|0',
    pg_temp.q_as(v_pat2, 'select count(*)::text from public.my_external_records()') || '|' || pg_temp.q_as(v_doc, 'select count(*)::text from public.external_records'));
  perform pg_temp.ck('1x a tied clinician reads through the audited function', 'ok|4',
    (pg_temp.q_as(v_doc, format($q$select public.read_patient_external_records_audited(%L, 'S44 proof: review of outside records')::text$q$, v_pat))::jsonb ->> 'status') || '|' ||
    jsonb_array_length(pg_temp.q_as(v_doc, format($q$select public.read_patient_external_records_audited(%L, 'S44 proof: review of outside records')::text$q$, v_pat))::jsonb -> 'records')::text);
  perform pg_temp.ck('1y an untied clinician is denied', 'denied',
    (pg_temp.q_as(v_doc2, format($q$select public.read_patient_external_records_audited(%L, 'S44 proof: not my patient')::text$q$, v_pat))::jsonb ->> 'status'));
  perform pg_temp.ck('1ya ...and the denial is audited', '1',
    (select count(*)::text from public.audit_log where actor_id = v_doc2 and subject_patient_id = v_pat and result = 'denied'));
  perform pg_temp.ck('1z a patient cannot use the staff read', 'true',
    (pg_temp.q_as(v_pat, format($q$select public.read_patient_external_records_audited(%L, 'S44 proof: patient trying')::text$q$, v_pat)) like 'ERR:not authorised')::text);

  -- withdrawing stops the next import
  perform pg_temp.q_as(v_pat, format('select public.withdraw_external_exchange_consent(%L)::text', pg_temp.f('consent1')));
  perform pg_temp.ck('1za after withdrawal the next import is refused', 'consent_required',
    (pg_temp.accept(v_pat, 'helium health', 'b-3', '[' || pg_temp.res('Observation', 'o-9', true) || ']')::jsonb) ->> 'status');
  perform pg_temp.ck('1zb ...and stored nothing new', '2', (select count(*)::text from public.fhir_import_batches where patient_id = v_pat));
  perform pg_temp.ck('1zc another patient cannot withdraw it', 'true',
    (pg_temp.q_as(v_pat2, format('select public.withdraw_external_exchange_consent(%L)::text', pg_temp.f('consent1'))) like 'ERR:consent not found')::text);

  -- ===== 2. consent_in_force (wearable_device_data) =============================================================================
  insert into public.consent_versions (consent_type, version, title, body, is_current) values ('wearable_device_data', 's44-proof', 'proof', 'proof', false) returning id into v_cv;
  perform pg_temp.ck('2a no consent row: not in force', 'false', pg_temp.svc(format($q$select public.consent_in_force(%L, 'wearable_device_data')::text$q$, v_pat)));
  insert into public.patient_consents (organisation_id, patient_id, consent_type, consent_version_id, version) values (v_org, v_pat, 'wearable_device_data', v_cv, 's44-proof');
  perform pg_temp.ck('2b accepted: in force', 'true', pg_temp.svc(format($q$select public.consent_in_force(%L, 'wearable_device_data')::text$q$, v_pat)));
  insert into public.patient_consents (organisation_id, patient_id, consent_type, consent_version_id, version, action) values (v_org, v_pat, 'wearable_device_data', v_cv, 's44-proof', 'withdrawn');
  perform pg_temp.ck('2c withdrawn: not in force', 'false', pg_temp.svc(format($q$select public.consent_in_force(%L, 'wearable_device_data')::text$q$, v_pat)));
  perform pg_temp.ck('2d a client cannot ask', 'true', (pg_temp.q_as(v_pat, format($q$select public.consent_in_force(%L, 'wearable_device_data')::text$q$, v_pat)) like 'ERR:permission denied%')::text);
  perform pg_temp.setf('sup', v_sup); perform pg_temp.setf('sup2', v_sup2); perform pg_temp.setf('pat3', v_pat3);
end $$;

-- ===== 3. labels, dates and notes; correction requests ========================================================================
do $$
declare
  v_org uuid := pg_temp.f('org'); v_pat uuid := pg_temp.f('pat'); v_pat2 uuid := pg_temp.f('pat2'); v_doc uuid := pg_temp.f('doc');
  v_vm uuid; v_vd uuid; v_t text; v_sys integer;
begin
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, source, taken_at)
  values (v_org, v_pat, 'blood_pressure', 130, 85, 'manual', now() - interval '2 days') returning id into v_vm;
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, source, taken_at)
  values (v_org, v_pat, 'blood_pressure', 150, 95, 'device', now() - interval '1 day') returning id into v_vd;
  perform pg_temp.setf('vm', v_vm); perform pg_temp.setf('vd', v_vd);

  perform pg_temp.ck('3a a note on a manual reading is saved', 'true',
    (pg_temp.q_as(v_pat, format($q$select public.set_item_note('vitals_readings', %L, 'After the walk', 'PRIVATE-NOTE-44', '2026-10-01')::text$q$, v_vm)) like '%"id"%')::text);
  perform pg_temp.ck('3b a note on a device reading (which the person cannot edit) is also saved', 'true',
    (pg_temp.q_as(v_pat, format($q$select public.set_item_note('vitals_readings', %L, 'Clinic cuff', null, null)::text$q$, v_vd)) like '%"id"%')::text);
  select systolic into v_sys from public.vitals_readings where id = v_vd;
  perform pg_temp.ck('3c ...and the device reading itself is unchanged', '150', v_sys::text);
  perform pg_temp.ck('3d the source lock still blocks a patient edit of the device reading', 'true',
    (pg_temp.q_as(v_pat, format($q$update public.vitals_readings set systolic = 120 where id = %L$q$, v_vd)) like 'ERR:This reading was recorded automatically%')::text);
  perform pg_temp.ck('3e a patient edit of a manual reading still works', 'ok',
    pg_temp.try_as(v_pat, format($q$update public.vitals_readings set systolic = 128 where id = %L$q$, v_vm)));
  perform pg_temp.ck('3f another patient cannot annotate this item, and learns nothing about it', 'ERR:item not found',
    pg_temp.q_as(v_pat2, format($q$select public.set_item_note('vitals_readings', %L, 'x', null, null)::text$q$, v_vm)));
  perform pg_temp.ck('3g a table outside the closed list is refused the same way', 'ERR:item not found',
    pg_temp.q_as(v_pat, format($q$select public.set_item_note('profiles', %L, 'x', null, null)::text$q$, v_pat)));
  perform pg_temp.ck('3h a label over 60 characters is refused', 'true',
    (pg_temp.q_as(v_pat, format($q$select public.set_item_note('vitals_readings', %L, %L, null, null)::text$q$, v_vm, repeat('a', 61))) like 'ERR:new row%')::text);
  perform pg_temp.ck('3i the person lists their notes', '2', pg_temp.q_as(v_pat, 'select count(*)::text from public.my_item_notes()'));
  perform pg_temp.ck('3j staff cannot read anyone''s notes, directly or by the list', '0|0',
    pg_temp.q_as(v_doc, 'select count(*)::text from public.patient_item_notes') || '|' || pg_temp.q_as(v_doc, 'select count(*)::text from public.my_item_notes()'));
  perform pg_temp.ck('3k a client cannot write the notes table directly', 'true',
    (pg_temp.q_as(v_pat, format($q$insert into public.patient_item_notes (organisation_id, patient_id, item_table, item_id, note) values (%L, %L, 'vitals_readings', %L, 'x')$q$, v_org, v_pat, v_vm)) like 'ERR:permission denied%')::text);

  v_t := pg_temp.q_as(v_pat, format($q$select public.request_item_correction('vitals_readings', %L, 'The cuff was on the wrong arm', 'Mark it as not reliable')::text$q$, v_vd));
  perform pg_temp.ck('3l a correction request on a locked device reading is the way to ask for a change', 'pending', (v_t::jsonb) ->> 'status');
  perform pg_temp.ck('3m ...and it names the item', 'vitals_readings|1',
    (select item_table || '|' || count(*)::text from public.data_correction_requests where patient_id = v_pat and item_id = v_vd group by item_table));
  perform pg_temp.ck('3n a request on someone else''s item is refused', 'ERR:item not found',
    pg_temp.q_as(v_pat2, format($q$select public.request_item_correction('vitals_readings', %L, 'wrong', null)::text$q$, v_vd)));
  perform pg_temp.ck('3o ...also through a direct insert', 'true',
    (pg_temp.q_as(v_pat2, format($q$insert into public.data_correction_requests (organisation_id, patient_id, record_description, what_is_wrong, item_table, item_id) values (%L, %L, 'x', 'wrong', 'vitals_readings', %L)$q$, v_org, v_pat2, v_vd)) = 'ERR:item not found')::text);
  perform pg_temp.ck('3p an item id without a table name is refused', 'ERR:item not found',
    pg_temp.q_as(v_pat, format($q$insert into public.data_correction_requests (organisation_id, patient_id, record_description, what_is_wrong, item_id) values (%L, %L, 'x', 'wrong', %L)$q$, v_org, v_pat, v_vd)));
  perform pg_temp.ck('3q clearing the last field removes the note', 'true',
    (pg_temp.q_as(v_pat, format($q$select public.set_item_note('vitals_readings', %L, null, null, null)::text$q$, v_vd)) like '%cleared%')::text);
  perform pg_temp.ck('3r ...and nothing about the item changed', '150', (select systolic::text from public.vitals_readings where id = v_vd));
end $$;

-- ===== 4. export snapshot =====================================================================================================
do $$
declare
  v_org uuid := pg_temp.f('org'); v_pat uuid := pg_temp.f('pat'); v_pat2 uuid := pg_temp.f('pat2'); v_doc uuid := pg_temp.f('doc'); v_doc2 uuid := pg_temp.f('doc2');
  v_sup uuid := pg_temp.f('sup'); v_sup2 uuid := pg_temp.f('sup2'); v_pa uuid; v_cat uuid;
  v_r1 uuid; v_r2 uuid; v_r3 uuid; v_r4 uuid; v_j jsonb; v_txt text;
begin
  insert into public.medications (organisation_id, patient_id, drug_name, dose, source) values (v_org, v_pat, 'S44 Amlodipine', '5 mg', 'patient');
  insert into public.patient_conditions (organisation_id, patient_id, condition_name, status, source) values (v_org, v_pat, 'S44 Hypertension', 'active', 'patient');
  insert into public.patient_allergies (organisation_id, patient_id, allergen, reaction, severity, source) values (v_org, v_pat, 'S44 Penicillin', 'Rash', 'moderate', 'patient');
  select id into v_cat from public.vaccination_catalog where is_active order by name limit 1;
  insert into public.vaccination_records (organisation_id, profile_id, vaccination_catalog_id, dose_number, date_administered, verification_status)
  values (v_org, v_pat, v_cat, 1, current_date - 30, 'self_reported');
  perform set_config('request.jwt.claims', json_build_object('sub', v_doc, 'role', 'authenticated')::text, true);
  insert into public.vaccination_records (organisation_id, profile_id, vaccination_catalog_id, dose_number, date_administered, verification_status, verified_by, verified_at)
  values (v_org, v_pat, v_cat, 2, current_date - 10, 'rejected', v_doc, now());
  perform set_config('request.jwt.claims', '', true);
  insert into public.patient_documents (organisation_id, patient_id, document_type, file_path, source, ocr_state, original_filename)
  values (v_org, v_pat, 'previous_hospital_record', v_pat || '/s44-a.jpg', 'patient', 'pending', 'PRIVATE-FILENAME-44.jpg');

  -- results: released / awaiting review / withheld / sensitive positive awaiting disclosure
  insert into public.lab_results (organisation_id, patient_id, source, submitted_by_kind, release_state, is_test) values (v_org, v_pat, 'pdf_upload', 'tarragon_team', 'awaiting_review', true) returning id into v_r1;
  insert into public.lab_results (organisation_id, patient_id, source, submitted_by_kind, release_state, is_test) values (v_org, v_pat, 'pdf_upload', 'tarragon_team', 'awaiting_review', true) returning id into v_r2;
  insert into public.lab_results (organisation_id, patient_id, source, submitted_by_kind, release_state, is_test) values (v_org, v_pat, 'pdf_upload', 'tarragon_team', 'awaiting_review', true) returning id into v_r3;
  insert into public.lab_results (organisation_id, patient_id, source, submitted_by_kind, release_state, release_reason, is_test) values (v_org, v_pat, 'pdf_upload', 'tarragon_team', 'clinician_disclosure_required', 'sensitive_positive', true) returning id into v_r4;
  insert into public.lab_result_items (lab_result_id, organisation_id, patient_id, analyte_code, value_numeric, unit, ref_low, ref_high, flag, is_test) values (v_r1, v_org, v_pat, 'creatinine', 0.9, 'mg/dL', 0.6, 1.3, 'normal', true);
  insert into public.lab_result_items (lab_result_id, organisation_id, patient_id, analyte_code, value_numeric, unit, flag, is_test) values (v_r2, v_org, v_pat, 'potassium', 4.1, 'mmol/L', 'normal', true);
  insert into public.lab_result_items (lab_result_id, organisation_id, patient_id, analyte_code, value_numeric, unit, flag, is_test) values (v_r3, v_org, v_pat, 'sodium', 140, 'mmol/L', 'normal', true);
  insert into public.lab_result_items (lab_result_id, organisation_id, patient_id, analyte_code, value_text, unit, flag, sensitive_positive, is_test) values (v_r4, v_org, v_pat, 'hiv_screen', 'positive', '', 'positive', true, true);
  update public.lab_results set release_state = 'released', reviewed_by = v_doc where id = v_r1;
  update public.lab_results set release_state = 'withheld', reviewed_by = v_doc, withheld_reason = 'wrong patient' where id = v_r3;

  -- the person's own export
  v_j := pg_temp.q_as(v_pat, format($q$select public.fhir_export_snapshot(%L, null, null)::text$q$, v_pat))::jsonb;
  v_txt := v_j::text;
  perform pg_temp.ck('4a the person exports every section', '7|self', jsonb_array_length(v_j -> 'sections_included')::text || '|' || (v_j ->> 'requester_kind'));
  perform pg_temp.ck('4b only the RELEASED result is exported (held, withheld and sensitive positive never are)', 'creatinine',
    (select string_agg(x ->> 'code', ',') from jsonb_array_elements(v_j -> 'lab_results') x));
  perform pg_temp.ck('4c no trace of the held, withheld or sensitive analytes anywhere in the file', 'false',
    (v_txt ~* '(potassium|sodium|hiv_screen)')::text);
  perform pg_temp.ck('4d a rejected vaccination dose is left out', '1', jsonb_array_length(v_j -> 'immunizations')::text);
  perform pg_temp.ck('4e a document is metadata only: no file name, no text, no extracted values', 'false',
    (v_txt ~* '(PRIVATE-FILENAME-44|ocr_text|extracted|file_path)')::text);
  perform pg_temp.ck('4f the person''s private note is never exported', 'false', (v_txt ~ 'PRIVATE-NOTE-44')::text);
  perform pg_temp.ck('4g manual and device vitals both exported with their source', 'device,manual',
    (select string_agg(distinct x ->> 'source', ',' order by x ->> 'source') from jsonb_array_elements(v_j -> 'vitals') x));
  perform pg_temp.ck('4h reproductive health and mental health are named as excluded', 'reproductive_health,mental_health',
    (select string_agg(x #>> '{}', ',' order by ord) from jsonb_array_elements(v_j -> 'excluded_domains') with ordinality t(x, ord)));
  perform pg_temp.ck('4i ...and cannot be asked for as a section', 'ERR:unknown section',
    pg_temp.q_as(v_pat, format($q$select public.fhir_export_snapshot(%L, array['reproductive_health'], null)::text$q$, v_pat)));
  perform pg_temp.ck('4j the export is logged for the person to see', '1|self',
    (select count(*)::text || '|' || min(requester_kind) from public.fhir_export_log where patient_id = v_pat));
  perform pg_temp.ck('4k ...and the person can read that log, another patient cannot', '1|0',
    pg_temp.q_as(v_pat, 'select count(*)::text from public.fhir_export_log') || '|' || pg_temp.q_as(v_pat2, 'select count(*)::text from public.fhir_export_log'));

  -- a Care Circle supporter holds some categories
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  insert into public.profile_access (profile_id, grantee_user_id, granted_by, permission_level) values (v_pat, v_sup, v_pat, 'view') returning id into v_pa;
  insert into public.profile_access_categories (profile_access_id, category) values (v_pa, 'vitals_readings');
  perform set_config('request.jwt.claims', '', true);
  v_j := pg_temp.q_as(v_sup, format($q$select public.fhir_export_snapshot(%L, null, null)::text$q$, v_pat))::jsonb;
  perform pg_temp.ck('4l a supporter exports only the section of the category granted', 'supporter|vitals|6',
    (v_j ->> 'requester_kind') || '|' || (v_j #>> '{sections_included,0}') || '|' || jsonb_array_length(v_j -> 'sections_refused')::text);
  perform pg_temp.ck('4m ...and gets no labs, medicines, conditions or allergies', 'false',
    (v_j ? 'lab_results' or v_j ? 'medications' or v_j ? 'conditions' or v_j ? 'allergies')::text);
  perform pg_temp.ck('4n a patient with no grant at all is denied', 'denied',
    (pg_temp.q_as(v_sup2, format($q$select public.fhir_export_snapshot(%L, null, null)::text$q$, v_pat))::jsonb) ->> 'status');
  perform pg_temp.ck('4o another patient with no grant is denied', 'denied',
    (pg_temp.q_as(v_pat2, format($q$select public.fhir_export_snapshot(%L, null, null)::text$q$, v_pat))::jsonb) ->> 'status');

  -- staff
  perform pg_temp.ck('4p a staff export needs a written reason', 'true',
    (pg_temp.q_as(v_doc, format($q$select public.fhir_export_snapshot(%L, null, 'short')::text$q$, v_pat)) like 'ERR:a reason of at least 10 characters%')::text);
  perform pg_temp.ck('4q an untied clinician is denied', 'denied',
    (pg_temp.q_as(v_doc2, format($q$select public.fhir_export_snapshot(%L, null, 'S44 proof: not my patient')::text$q$, v_pat))::jsonb) ->> 'status');
  perform pg_temp.ck('4r ...and the denial is on the audit trail (one from the external-records read above, one from this export)', '2',
    (select count(*)::text from public.audit_log where actor_id = v_doc2 and subject_patient_id = v_pat and result = 'denied'));
  v_j := pg_temp.q_as(v_doc, format($q$select public.fhir_export_snapshot(%L, null, 'S44 proof: preparing a transfer letter')::text$q$, v_pat))::jsonb;
  perform pg_temp.ck('4s a tied clinician with a reason exports', 'ok|staff', (v_j ->> 'status') || '|' || (v_j ->> 'requester_kind'));
  perform pg_temp.ck('4t ...and the export writes an audit row (INV-10)', '1',
    (select count(*)::text from public.audit_log where actor_id = v_doc and subject_patient_id = v_pat and action = 'staff.chart_read' and result = 'success' and reason like '%transfer letter%'));
  perform pg_temp.ck('4u staff see the same released-only labs', 'creatinine', (select string_agg(x ->> 'code', ',') from jsonb_array_elements(v_j -> 'lab_results') x));
  perform pg_temp.ck('4v anon cannot export', '42501', pg_temp.try_anon(format('select public.fhir_export_snapshot(%L, null, null)', v_pat)));
end $$;

-- ===== 5. partner lab structured push =========================================================================================
create function pg_temp.push_items(p_glucose numeric, p_glucose_unit text) returns text language sql as
$$ select '[{"loinc":"1558-6","value":' || p_glucose || ',"unit":"' || p_glucose_unit || '"},{"loinc":"4548-4","value":5.2,"unit":"%"},{"loinc":"2160-0","value":0.9,"unit":"mg/dL"},'
  || '{"loinc":"2823-3","value":4.1,"unit":"mmol/L"},{"loinc":"2951-2","value":140,"unit":"mmol/L"},{"loinc":"2093-3","value":170,"unit":"mg/dL"},'
  || '{"loinc":"13457-7","value":100,"unit":"mg/dL"},{"loinc":"2085-9","value":55,"unit":"mg/dL"},{"loinc":"2571-8","value":110,"unit":"mg/dL"},{"loinc":"1742-6","value":24,"unit":"U/L"},'
  || '{"loinc":"1920-8","value":22,"unit":"U/L"},{"loinc":"718-7","value":14,"unit":"g/dL"},{"loinc":"6690-2","value":6,"unit":"10^9/L"},'
  || '{"loinc":"777-3","value":250,"unit":"10^9/L"},{"loinc":"3016-3","value":2,"unit":"mIU/L"}]' $$;
create function pg_temp.push(p_uid uuid, p_order uuid, p_msg text, p_items text) returns text language sql as
$$ select pg_temp.q_as(p_uid, format('select public.lab_partner_push_result(%L, %L, %L::jsonb)::text', p_order, p_msg, p_items)) $$;

do $$
declare
  v_org uuid := pg_temp.f('org'); v_admin uuid := pg_temp.f('admin'); v_cmo uuid := pg_temp.f('cmo'); v_doc uuid := pg_temp.f('doc');
  v_pat uuid := pg_temp.f('pat'); v_pat2 uuid := pg_temp.f('pat2'); v_pat3 uuid := pg_temp.f('pat3');
  v_lab uuid; v_lab2 uuid; v_labu uuid; v_labu2 uuid; v_o1 uuid; v_o2 uuid; v_o3 uuid; v_o4 uuid; v_o5 uuid; v_o6 uuid; v_m uuid; v_t text; v_j jsonb; v_rid uuid;
  m record; v_n integer;
begin
  insert into public.lab_providers (name, is_active) values ('S44 Lab A', false) returning id into v_lab;
  insert into public.lab_providers (name, is_active) values ('S44 Lab B', false) returning id into v_lab2;
  v_labu := pg_temp.mkuser(v_org, 'labA', 'lab_partner'); v_labu2 := pg_temp.mkuser(v_org, 'labB', 'lab_partner');
  update public.profiles set lab_provider_id = v_lab where id = v_labu;
  update public.profiles set lab_provider_id = v_lab2 where id = v_labu2;
  perform pg_temp.setf('lab', v_lab); perform pg_temp.setf('labu', v_labu); perform pg_temp.setf('labu2', v_labu2);
  v_o1 := pg_temp.mkorder(v_org, v_pat2, v_lab, 'membership_annual'); perform pg_temp.setf('o1', v_o1);

  -- 5a. nothing is mapped yet: the whole push is rejected, nothing is stored
  v_j := pg_temp.push(v_labu, v_o1, 'msg-000001', pg_temp.push_items(88, 'mg/dL'))::jsonb;
  perform pg_temp.ck('5a with no mappings the push is rejected as unmapped, listing the pairs', 'rejected|unmapped_item|15',
    (v_j ->> 'status') || '|' || (v_j ->> 'reject_code') || '|' || jsonb_array_length(v_j -> 'unmapped')::text);
  perform pg_temp.ck('5b ...and no result exists for the order', '0', (select count(*)::text from public.lab_results where lab_order_id = v_o1));

  -- 5c. proposals: an admin proposes, a wrong panel unit is refused, a multiplier needs a different unit
  for m in select * from (values ('fasting_glucose', '1558-6', 'mg/dL', 'mg/dL'), ('hba1c', '4548-4', '%', '%'), ('creatinine', '2160-0', 'mg/dL', 'mg/dL'),
       ('potassium', '2823-3', 'mmol/L', 'mmol/L'), ('sodium', '2951-2', 'mmol/L', 'mmol/L'), ('total_cholesterol', '2093-3', 'mg/dL', 'mg/dL'),
       ('ldl_cholesterol', '13457-7', 'mg/dL', 'mg/dL'), ('hdl_cholesterol', '2085-9', 'mg/dL', 'mg/dL'), ('triglycerides', '2571-8', 'mg/dL', 'mg/dL'),
       ('alt', '1742-6', 'U/L', 'U/L'),
       -- integration with S27g: the one membership panel needs these five more before a push counts as complete (hiv, hbsag and hcv are optional)
       ('ast', '1920-8', 'U/L', 'U/L'), ('haemoglobin', '718-7', 'g/dL', 'g/dL'), ('wbc', '6690-2', '10^9/L', '10^9/L'),
       ('platelets', '777-3', '10^9/L', '10^9/L'), ('tsh', '3016-3', 'mIU/L', 'mIU/L')) t(a, l, u, p) loop
    perform pg_temp.q_as(v_admin, format($q$select public.propose_lab_code_mapping(%L, %L, %L, %L, %L)::text$q$, v_lab, m.l, m.u, m.a, m.p));
  end loop;
  perform pg_temp.q_as(v_admin, format($q$select public.propose_lab_code_mapping(%L, '1558-6', 'mmol/L', 'fasting_glucose', 'mg/dL', 18.016)::text$q$, v_lab));
  perform pg_temp.q_as(v_admin, format($q$select public.propose_lab_code_mapping(%L, '75622-1', '', 'hiv_screen', '')::text$q$, v_lab));
  perform pg_temp.ck('5c sixteen numeric mappings and one qualitative are proposed', '17', (select count(*)::text from public.lab_code_mappings where lab_provider_id = v_lab and status = 'proposed'));
  perform pg_temp.ck('5d a stored unit that is not the panel''s own is refused', 'ERR:lab_unit_mismatch',
    pg_temp.q_as(v_admin, format($q$select public.propose_lab_code_mapping(%L, '2160-0', 'umol/L', 'creatinine', 'umol/L', 1)::text$q$, v_lab)));
  perform pg_temp.ck('5e an analyte that is on no panel is refused', 'ERR:lab_unknown_analyte',
    pg_temp.q_as(v_admin, format($q$select public.propose_lab_code_mapping(%L, '1234-5', 'mg/dL', 'made_up', 'mg/dL', 1)::text$q$, v_lab)));
  perform pg_temp.ck('5f a multiplier with the same unit is refused by the table', 'true',
    (pg_temp.owner_try(format($q$insert into public.lab_code_mappings (lab_provider_id, loinc_code, ucum_unit, analyte_code, panel_unit, unit_factor) values (%L, '9999-9', 'mg/dL', 'creatinine', 'mg/dL', 2)$q$, v_lab)) like '%violates check constraint%')::text);
  perform pg_temp.ck('5g a clinician or a patient cannot propose', 'true|true',
    (pg_temp.q_as(v_doc, format($q$select public.propose_lab_code_mapping(%L, '2160-0', 'mg/dL', 'creatinine', 'mg/dL')::text$q$, v_lab)) like 'ERR:this action is for admins%')::text || '|' ||
    (pg_temp.q_as(v_pat, format($q$select public.propose_lab_code_mapping(%L, '2160-0', 'mg/dL', 'creatinine', 'mg/dL')::text$q$, v_lab)) like 'ERR:this action is for admins%')::text);

  -- 5h. an unconfirmed mapping is never used
  v_j := pg_temp.push(v_labu, v_o1, 'msg-000002', pg_temp.push_items(88, 'mg/dL'))::jsonb;
  perform pg_temp.ck('5h proposed (unconfirmed) mappings are not used', 'rejected|unmapped_item', (v_j ->> 'status') || '|' || (v_j ->> 'reject_code'));

  -- 5i. only the CMO confirms
  select id into v_m from public.lab_code_mappings where lab_provider_id = v_lab and loinc_code = '2160-0';
  perform pg_temp.ck('5i a clinician who is not the CMO cannot confirm', 'true',
    (pg_temp.q_as(v_doc, format('select public.confirm_lab_code_mapping(%L)::text', v_m)) like 'ERR:only the Chief Medical Officer%')::text);
  perform pg_temp.ck('5j an admin cannot confirm', 'true',
    (pg_temp.q_as(v_admin, format('select public.confirm_lab_code_mapping(%L)::text', v_m)) like 'ERR:only the Chief Medical Officer%')::text);
  perform pg_temp.ck('5k the lab cannot confirm its own mapping', 'true',
    (pg_temp.q_as(v_labu, format('select public.confirm_lab_code_mapping(%L)::text', v_m)) like 'ERR:only the Chief Medical Officer%')::text);
  for m in select id from public.lab_code_mappings where lab_provider_id = v_lab loop
    perform pg_temp.q_as(v_cmo, format('select public.confirm_lab_code_mapping(%L)::text', m.id));
  end loop;
  perform pg_temp.ck('5l the CMO confirms them all, with a name and a time', '17',
    (select count(*)::text from public.lab_code_mappings where lab_provider_id = v_lab and status = 'confirmed' and confirmed_by is not null and confirmed_at is not null));
  perform pg_temp.ck('5m a lab sees its own mappings; another lab sees none', '17|0',
    pg_temp.q_as(v_labu, 'select count(*)::text from public.lab_code_mappings') || '|' || pg_temp.q_as(v_labu2, 'select count(*)::text from public.lab_code_mappings'));

  -- 5n. ranges are not signed yet: an all-normal push is accepted but HELD
  v_j := pg_temp.push(v_labu, v_o1, 'msg-000003', pg_temp.push_items(88, 'mg/dL'))::jsonb;
  perform pg_temp.ck('5n an all-normal push against UNSIGNED ranges is received and held', 'received|held', (v_j ->> 'status') || '|' || (v_j ->> 'state'));
  select id into v_rid from public.lab_results where lab_order_id = v_o1;
  perform pg_temp.ck('5o ...it is not visible to the patient (INV-03)', '0', pg_temp.q_as(v_pat2, format('select count(*)::text from public.lab_results where id = %L', v_rid)));
  perform pg_temp.ck('5p ...fifteen items stored in the panel unit', '15|mg/dL',
    (select count(*)::text || '|' || (select unit from public.lab_result_items where lab_result_id = v_rid and analyte_code = 'creatinine') from public.lab_result_items where lab_result_id = v_rid));
  perform pg_temp.ck('5q the push is recorded, accepted, with the items exactly as received', 'accepted|1558-6',
    (select outcome || '|' || (items_received -> 0 ->> 'loinc') from public.lab_result_pushes where lab_provider_id = v_lab and message_id = 'msg-000003'));
  perform pg_temp.ck('5r the two earlier rejections are recorded too', '2',
    (select count(*)::text from public.lab_result_pushes where lab_provider_id = v_lab and outcome = 'rejected'));

  -- 5s. the CMO signs the ranges; now a normal result is released
  perform pg_temp.q_as(v_cmo, format('select public.sign_lab_panels(%L)::text', (select id from public.lab_panel_signoffs where is_active)));
  v_o2 := pg_temp.mkorder(v_org, v_pat, v_lab, 'membership_annual');
  v_j := pg_temp.push(v_labu, v_o2, 'msg-000004', pg_temp.push_items(88, 'mg/dL'))::jsonb;
  select id into v_rid from public.lab_results where lab_order_id = v_o2;
  perform pg_temp.ck('5s an all-normal push against SIGNED ranges is released', 'received|released|released',
    (v_j ->> 'status') || '|' || (v_j ->> 'state') || '|' || (select release_state from public.lab_results where id = v_rid));
  perform pg_temp.ck('5t the patient sees it', '1', pg_temp.q_as(v_pat, format('select count(*)::text from public.lab_results where id = %L', v_rid)));
  perform pg_temp.ck('5u a replay of the same message id writes nothing new', 'true|1',
    ((pg_temp.push(v_labu, v_o2, 'msg-000004', pg_temp.push_items(88, 'mg/dL'))::jsonb ->> 'replayed')) || '|' || (select count(*)::text from public.lab_results where lab_order_id = v_o2));
  perform pg_temp.ck('5v a new message for an order that already has a result is rejected', 'rejected|result_already_received',
    (pg_temp.push(v_labu, v_o2, 'msg-000005', pg_temp.push_items(88, 'mg/dL'))::jsonb ->> 'status') || '|' || (pg_temp.push(v_labu, v_o2, 'msg-000006', pg_temp.push_items(88, 'mg/dL'))::jsonb ->> 'reject_code'));

  -- 5w. unit conversion through a confirmed multiplier
  v_o3 := pg_temp.mkorder(v_org, v_pat3, v_lab, 'membership_annual');
  v_j := pg_temp.push(v_labu, v_o3, 'msg-000007', pg_temp.push_items(5.0, 'mmol/L'))::jsonb;
  perform pg_temp.ck('5w glucose sent in mmol/L is converted with the confirmed multiplier and stored in mg/dL', '90.080000|mg/dL',
    (select value_numeric::text || '|' || unit from public.lab_result_items i join public.lab_results r on r.id = i.lab_result_id where r.lab_order_id = v_o3 and i.analyte_code = 'fasting_glucose'));
  -- an unmapped unit rejects the whole push
  v_o4 := pg_temp.mkorder(v_org, v_pat2, v_lab, 'membership_annual');
  v_j := pg_temp.push(v_labu, v_o4, 'msg-000008', replace(pg_temp.push_items(88, 'mg/dL'), '"value":0.9,"unit":"mg/dL"', '"value":80,"unit":"umol/L"'))::jsonb;
  perform pg_temp.ck('5x one item in an unmapped unit rejects the whole push', 'rejected|unmapped_item|0',
    (v_j ->> 'status') || '|' || (v_j ->> 'reject_code') || '|' || (select count(*)::text from public.lab_results where lab_order_id = v_o4));

  -- 5y. a critical value is held, with a review task, and the lab is not told why
  v_j := pg_temp.push(v_labu, v_o4, 'msg-000009', pg_temp.push_items(450, 'mg/dL'))::jsonb;
  select id into v_rid from public.lab_results where lab_order_id = v_o4;
  perform pg_temp.ck('5y a critical glucose is held for review (INV-03)', 'received|held|awaiting_review|critical',
    (v_j ->> 'status') || '|' || (v_j ->> 'state') || '|' || (select release_state || '|' || release_reason from public.lab_results where id = v_rid));
  perform pg_temp.ck('5z ...with a critical result review task', 'critical_result_review', (select type from public.clinical_tasks where dedup_key = 'lab_result:' || v_rid limit 1));
  perform pg_temp.ck('5za ...and the lab''s answer names no clinical reason', 'false', (v_j::text ~* '(critical|abnormal|sensitive|positive|reason)')::text);
  perform pg_temp.ck('5zb ...and the patient cannot see it', '0', pg_temp.q_as(v_pat2, format('select count(*)::text from public.lab_results where id = %L', v_rid)));

  -- 5zc. a reactive HIV screening result goes to a clinician (INV-04)
  v_o5 := pg_temp.mkorder(v_org, v_pat, v_lab, 'membership_annual');
  v_j := pg_temp.push(v_labu, v_o5, 'msg-000010', '[{"loinc":"75622-1","value_text":"Positive","unit":""}]')::jsonb;
  select id into v_rid from public.lab_results where lab_order_id = v_o5;
  perform pg_temp.ck('5zc a reactive HIV screen needs clinician disclosure and is never released', 'received|held|clinician_disclosure_required|true',
    (v_j ->> 'status') || '|' || (v_j ->> 'state') || '|' || (select release_state from public.lab_results where id = v_rid) || '|' ||
    (select sensitive_positive::text from public.lab_result_items where lab_result_id = v_rid));
  perform pg_temp.ck('5zd ...a disclosure task exists and the patient sees nothing', 'sensitive_result_disclosure|0',
    (select type from public.clinical_tasks where dedup_key = 'lab_result:' || v_rid limit 1) || '|' || pg_temp.q_as(v_pat, format('select count(*)::text from public.lab_results where id = %L and release_state = ''clinician_disclosure_required''', v_rid)));

  -- 5ze. who may push
  perform pg_temp.ck('5ze another lab cannot push to this order', 'true',
    (pg_temp.push(v_labu2, v_o5, 'msg-000011', pg_temp.push_items(88, 'mg/dL')) like 'ERR:Order not found for this lab')::text);
  perform pg_temp.ck('5zf a patient or a clinician cannot push', 'true|true',
    (pg_temp.push(v_pat, v_o5, 'msg-000012', pg_temp.push_items(88, 'mg/dL')) like 'ERR:This action is for partner labs')::text || '|' ||
    (pg_temp.push(v_doc, v_o5, 'msg-000013', pg_temp.push_items(88, 'mg/dL')) like 'ERR:This action is for partner labs')::text);
  perform pg_temp.ck('5zg anon cannot push', '42501', pg_temp.try_anon(format($q$select public.lab_partner_push_result(%L, 'msg-000014', '[]'::jsonb)$q$, v_o5)));
  perform pg_temp.ck('5zh a message id that is too short is refused', 'true',
    (pg_temp.push(v_labu, v_o5, 'x', pg_temp.push_items(88, 'mg/dL')) like 'ERR:a message id of 6 to 120 characters%')::text);
  perform pg_temp.ck('5zi an empty item list is refused', 'true',
    (pg_temp.push(v_labu, v_o5, 'msg-000015', '[]') like 'ERR:items must be a list%')::text);
  perform pg_temp.ck('5zj a lab sees its own push log; another lab and a patient see none', '>0|0|0',
    case when pg_temp.q_as(v_labu, 'select count(*)::text from public.lab_result_pushes')::integer > 0 then '>0' else '0' end || '|' ||
    pg_temp.q_as(v_labu2, 'select count(*)::text from public.lab_result_pushes') || '|' || pg_temp.q_as(v_pat, 'select count(*)::text from public.lab_result_pushes'));
  perform pg_temp.ck('5zk a lab cannot write a mapping or a push row directly', 'true|true',
    (pg_temp.q_as(v_labu, format($q$insert into public.lab_code_mappings (lab_provider_id, loinc_code, analyte_code) values (%L, '1111-1', 'creatinine')$q$, v_lab)) like 'ERR:permission denied%')::text || '|' ||
    (pg_temp.q_as(v_labu, format($q$delete from public.lab_result_pushes where lab_provider_id = %L$q$, v_lab)) like 'ERR:permission denied%')::text);

  -- 5zl. INV-14: the go-live guard starts off, and a REAL (non-test) patient's order is refused while it is off; a test patient passes (5a to 5zd above)
  perform pg_temp.ck('5zl the lab push guard exists and starts off', 'false', (select is_on::text from public.go_live_guards where key = 'lab_structured_push_enabled'));
  update public.profiles set is_test = false where id = v_pat3;
  v_o6 := pg_temp.mkorder(v_org, v_pat3, v_lab, 'membership_annual'); perform pg_temp.setf('o6', v_o6);
  v_j := pg_temp.push(v_labu, v_o6, 'msg-000016', pg_temp.push_items(88, 'mg/dL'))::jsonb;
  perform pg_temp.ck('5zm a real patient''s order is refused while the guard is off, and nothing is stored as a result', 'rejected|not_enabled|0',
    (v_j ->> 'status') || '|' || (v_j ->> 'reject_code') || '|' || (select count(*)::text from public.lab_results where lab_order_id = v_o6));
  update public.profiles set is_test = true where id = v_pat3;
end $$;

-- ===== 6. grants ==============================================================================================================
do $$
begin
  perform pg_temp.ck('6a no new function is callable by anon', '',
    coalesce((select string_agg(fn, ',') from unnest(array[
      'public.grant_external_exchange_consent(text, text)', 'public.withdraw_external_exchange_consent(uuid)', 'public.my_external_exchange_consents()',
      'public.my_external_records(integer)', 'public.read_patient_external_records_audited(uuid, text)', 'public.set_item_note(text, uuid, text, text, date)',
      'public.my_item_notes(text)', 'public.request_item_correction(text, uuid, text, text)', 'public.fhir_export_snapshot(uuid, text[], text)',
      'public.propose_lab_code_mapping(uuid, text, text, text, text, numeric, text)', 'public.confirm_lab_code_mapping(uuid)', 'public.retire_lab_code_mapping(uuid)',
      'public.lab_partner_push_result(uuid, text, jsonb)', 'public.fhir_import_accept(uuid, uuid, uuid, text, text, jsonb, jsonb, jsonb, jsonb)',
      'public.consent_in_force(uuid, public.consent_type)']) fn where has_function_privilege('anon', fn::regprocedure, 'EXECUTE')), ''));
  perform pg_temp.ck('6b the import writer and the consent check are not callable by a signed-in client', '',
    coalesce((select string_agg(fn, ',') from unnest(array['public.fhir_import_accept(uuid, uuid, uuid, text, text, jsonb, jsonb, jsonb, jsonb)', 'public.consent_in_force(uuid, public.consent_type)']) fn
      where has_function_privilege('authenticated', fn::regprocedure, 'EXECUTE')), ''));
  perform pg_temp.ck('6c RLS is on for every new table', '0',
    (select count(*)::text from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public'
      and c.relname in ('external_exchange_consents', 'external_records', 'patient_item_notes', 'fhir_export_log', 'lab_code_mappings', 'lab_result_pushes') and not c.relrowsecurity));
  perform pg_temp.ck('6d no client role can write any new table directly', '0',
    (select count(*)::text from information_schema.role_table_grants where table_schema = 'public'
      and table_name in ('external_exchange_consents', 'external_records', 'patient_item_notes', 'fhir_export_log', 'lab_code_mappings', 'lab_result_pushes')
      and grantee in ('anon', 'authenticated') and privilege_type in ('INSERT', 'UPDATE', 'DELETE')));
end $$;

-- ===== 7. sabotage: defeat each gate once; the matching check must flip ======================================================
do $$
declare
  v_org uuid := pg_temp.f('org'); v_pat uuid := pg_temp.f('pat'); v_pat2 uuid := pg_temp.f('pat2'); v_pat3 uuid := pg_temp.f('pat3'); v_doc uuid := pg_temp.f('doc'); v_doc2 uuid := pg_temp.f('doc2');
  v_admin uuid := pg_temp.f('admin'); v_lab uuid := pg_temp.f('lab'); v_m uuid; v_j jsonb;
begin
  -- A. the consent lookup always finds a consent: an import with none must now go through (so check 1a would fail)
  create or replace function private.external_exchange_consent_id(p_patient uuid, p_source text, p_direction text) returns uuid
    language sql stable as $f$ select pg_temp.f('consent1') $f$;
  insert into results values ('sabotaged', '1a import with no consent (lookup defeated)', 'consent_required',
    (pg_temp.accept(v_pat3, 'never consented emr', 'b-sab-1', '[]')::jsonb) ->> 'status');
  -- B. the CMO gate always true: a clinician who is not the CMO confirms a mapping (so check 5i would fail)
  perform pg_temp.q_as(v_admin, format($q$select public.propose_lab_code_mapping(%L, '2160-0', 'mg/dL', 'creatinine', 'mg/dL')::text$q$, v_lab));
  perform pg_temp.q_as(v_admin, format($q$select public.propose_lab_code_mapping(%L, '2160-0', 'umol/L', 'creatinine', 'mg/dL', 0.0113)::text$q$, v_lab));
  select id into v_m from public.lab_code_mappings where lab_provider_id = v_lab and loinc_code = '2160-0' and ucum_unit = 'umol/L';
  create or replace function private.is_active_clinical_director() returns boolean language sql stable as $f$ select true $f$;
  insert into results values ('sabotaged', '5i a non-CMO confirms a mapping (gate defeated)', 'refused',
    case when pg_temp.q_as(v_doc, format('select public.confirm_lab_code_mapping(%L)::text', v_m)) like 'ERR:%' then 'refused' else 'accepted' end);
  -- C. the item-owner check returns the caller: another patient annotates an item that is not theirs (so check 3f would fail)
  create or replace function private.item_owner(p_table text, p_id uuid) returns uuid language sql stable as $f$ select (select auth.uid()) $f$;
  insert into results values ('sabotaged', '3f another patient annotates this item (owner check defeated)', 'refused',
    case when pg_temp.q_as(v_pat2, format($q$select public.set_item_note('vitals_readings', %L, 'x', null, null)::text$q$, pg_temp.f('vm'))) like 'ERR:%' then 'refused' else 'accepted' end);
  -- D. the staff tie always passes: an untied clinician exports (so check 4q would fail)
  create or replace function private.can_staff_read_clinical(p_patient uuid, p_category public.care_access_category) returns boolean language sql stable as $f$ select true $f$;
  insert into results values ('sabotaged', '4q an untied clinician exports (tie defeated)', 'denied',
    (pg_temp.q_as(v_doc2, format($q$select public.fhir_export_snapshot(%L, null, 'S44 proof: sabotage run')::text$q$, v_pat))::jsonb) ->> 'status');
  -- E. the go-live guard always open: a real patient's order is no longer refused (so check 5zm would fail)
  update public.profiles set is_test = false where id = v_pat3;
  create or replace function private.go_live_open_patient(p_key text, p_patient uuid) returns boolean language sql stable as $f$ select true $f$;
  insert into results values ('sabotaged', '5zm a real patient''s order with the guard off (guard defeated)', 'rejected',
    (pg_temp.push(pg_temp.f('labu'), pg_temp.f('o6'), 'msg-000017', pg_temp.push_items(88, 'mg/dL'))::jsonb) ->> 'status');
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FLIPPED' end as result
from results where phase = 'sabotaged'
union all
select 'real', count(*)::text || ' checks', 'all pass', 'all pass', 'PASS' from results where phase = 'real';

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S44 proof FAILED: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), E'\n  ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 5 then raise exception 'VACUOUS TEST: the sabotage flipped % of 5 checks', v_caught; end if;
end $$;

rollback;
