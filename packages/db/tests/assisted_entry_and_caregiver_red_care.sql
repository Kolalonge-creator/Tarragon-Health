-- Follow-up N proof (migrations *_assisted_entry_permission_value.sql and *_assisted_entry_and_caregiver_red_care.sql).
--
-- One rolled-back transaction. Proves:
--   R. A caregiver can answer the red-care question for the person they support (the 42501 reproduced first, then fixed):
--      R0  the old own-account function still refuses a caregiver (the reproduction of the original 42501), unchanged.
--      R1-R4 a caregiver with a live manage grant answers for the patient; the row is the PATIENT'S with answered_by = the caregiver; a retry is
--            idempotent; the audit row has the caregiver as actor and names the person; the person's access log shows it.
--      R5  the patient sees the answer and who gave it; their own answer still works and carries no helper.
--      R6  an unrelated user, a view-only grant, a manage grant narrowed to neither capability, and an expired grant are all refused (42501).
--      R7  the log_readings-only and receive_alerts-only helpers are both allowed (the helper who typed the dangerous reading answers it).
--      R8  a red event of someone else cannot be answered through your own person; the reproductive_health category is not widened by any of it.
--      R9  an answer never acknowledges anything: pages stay unacknowledged (CMO Q13).
--   A. Assisted entry of readings:
--      A1  a caregiver stores a BP reading for the patient: logged_by is the caregiver, source stays manual, one ledger row names the basis.
--      A2  basis is explicit_permission for a grant that names log_readings; full_manage_grant for an unrestricted one.
--      A3  a narrowed grant without log_readings, a view grant, an expired grant and a stranger are refused and store nothing.
--      A4  the reading goes through the SAME path: a crisis BP entered by the caregiver raises the emergency event for the patient.
--      A5  no backdating: a typed reading dated three days ago is stamped now; wearable, cgm and fhir_import rows and a deviceless device row are refused.
--      A6  a forged logged_by_profile_id is overwritten by the caller's own id.
--      A7  rate limits (per helper per person per hour, per helper per day) STORE and flag the reading, never refuse it; the patient's own entries are never limited.
--      A8  the ledger: the person reads theirs, the helper reads theirs, a stranger reads none, append only, no direct write.
--      A9  attribution names for the label; a stranger gets nothing.
--      A10 the pharmacy seam is closed: guard off, function false, a pharmacist cannot write a reading.
--   Sabotage: the permission check removed (red care), the guard trigger and capability policy removed (assisted entry), the rate limit removed.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;

create function pg_temp.rec(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('real', p_name, p_expected, p_actual) $$;
create function pg_temp.try(p_sql text) returns text language plpgsql as
$f$ begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $f$;
create function pg_temp.try_msg(p_sql text) returns text language plpgsql as
$f$ begin execute p_sql; return 'ok'; exception when others then return sqlstate || ' ' || sqlerrm; end $f$;
create function pg_temp.act(p_uid uuid) returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
end $f$;
create function pg_temp.act_anon() returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
end $f$;
create function pg_temp.back() returns void language plpgsql as
$f$ begin reset role; perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.sub', '', true); end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid language plpgsql as
$f$ declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'ae-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test, language)
  values (v, p_org, p_role::public.user_role, 'AE ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true, 'en')
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone;
  return v;
end $f$;
-- A grant made by the patient (the lifecycle trigger records it). p_perms null = unrestricted.
create function pg_temp.grant_to(p_patient uuid, p_helper uuid, p_level text, p_perms public.caregiver_permission[], p_expired boolean default false) returns void language plpgsql as
$f$ begin
  if p_expired then
    insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by, permissions, created_at, expires_at)
    values (p_patient, p_helper, p_level, p_patient, p_perms, now() - interval '10 days', now() - interval '1 day');
  else
    insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by, permissions)
    values (p_patient, p_helper, p_level, p_patient, p_perms);
  end if;
end $f$;
-- Mimics a definer RPC that a staff session calls (the testing-day point-of-care measurement, an imported-record confirmation): the writer is staff,
-- the row carries their id as logged_by, the role setting stays 'authenticated'.
create function pg_temp.staff_definer_insert(p_org uuid, p_patient uuid, p_source text) returns text language plpgsql security definer as
$f$ begin
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, source, taken_at)
  values (p_org, p_patient, 'blood_pressure', 141, 91, p_source::public.vital_source, now());
  return 'ok';
exception when others then return sqlstate;
end $f$;
create function pg_temp.ee(p_patient uuid) returns uuid language plpgsql as
$f$ declare v uuid;
begin
  insert into public.emergency_events (organisation_id, patient_id, source, trigger_detail, status)
  select organisation_id, p_patient, 'bp_reading', 'proof reading', 'active' from public.profiles where id = p_patient returning id into v;
  return v;
end $f$;
create function pg_temp.bp(p_org uuid, p_patient uuid, p_sys int, p_dia int, p_taken text default 'now()', p_source text default 'manual') returns text language plpgsql as
$f$ begin
  return pg_temp.try(format('insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, source, taken_at) values (%L, %L, ''blood_pressure'', %s, %s, %L, %s)',
                            p_org, p_patient, p_sys, p_dia, p_source, p_taken));
end $f$;
create function pg_temp.bp_msg(p_org uuid, p_patient uuid, p_sys int, p_dia int) returns text language plpgsql as
$f$ begin
  return pg_temp.try_msg(format('insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, source, taken_at) values (%L, %L, ''blood_pressure'', %s, %s, ''manual'', now())',
                                p_org, p_patient, p_sys, p_dia));
end $f$;

do $$
declare
  v_org uuid; nurse uuid; cg_nocat uuid; pat uuid; pat2 uuid; cg uuid; cg_lr uuid; cg_ra uuid; cg_narrow uuid; cg_view uuid; cg_exp uuid; stranger uuid; pharm uuid;
  rpat uuid; rcg uuid; rstr uuid; e1 uuid; e2 uuid; ans uuid; ans2 uuid; v_cid uuid := gen_random_uuid(); v_cnt text; v_msg text; v_before int; v_after int;
  v_pharm_role text;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  pat := pg_temp.mkuser(v_org, 'patient', 'patient');
  pat2 := pg_temp.mkuser(v_org, 'patient2', 'patient');
  cg := pg_temp.mkuser(v_org, 'helper-all', 'patient');
  cg_lr := pg_temp.mkuser(v_org, 'helper-log', 'patient');
  cg_ra := pg_temp.mkuser(v_org, 'helper-alerts', 'patient');
  cg_narrow := pg_temp.mkuser(v_org, 'helper-narrow', 'patient');
  cg_view := pg_temp.mkuser(v_org, 'helper-view', 'patient');
  cg_exp := pg_temp.mkuser(v_org, 'helper-expired', 'patient');
  stranger := pg_temp.mkuser(v_org, 'stranger', 'patient');
  nurse := pg_temp.mkuser(v_org, 'nurse', 'clinician');
  cg_nocat := pg_temp.mkuser(v_org, 'helper-nocat', 'patient');
  v_pharm_role := case when exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'user_role' and e.enumlabel = 'pharmacist') then 'pharmacist' else 'patient' end;
  pharm := pg_temp.mkuser(v_org, 'pharmacist', v_pharm_role);

  perform pg_temp.grant_to(pat, cg, 'manage', null);
  perform pg_temp.grant_to(pat, cg_lr, 'manage', array['log_readings']::public.caregiver_permission[]);
  perform pg_temp.grant_to(pat, cg_ra, 'manage', array['receive_alerts']::public.caregiver_permission[]);
  perform pg_temp.grant_to(pat, cg_narrow, 'manage', array['view_appointments', 'book_appointments']::public.caregiver_permission[]);
  perform pg_temp.grant_to(pat, cg_nocat, 'manage', null);
  perform pg_temp.grant_to(pat, cg_view, 'view', null);
  -- The person also gives the unrestricted helper the vitals category (an unrestricted grant alone is not consent to write readings).
  perform pg_temp.act(pat);
  insert into public.profile_access_categories (profile_access_id, category)
  select id, 'vitals_readings'::public.care_access_category from public.profile_access where profile_id = pat and grantee_user_id = cg;
  perform pg_temp.back();
  perform pg_temp.grant_to(pat, cg_exp, 'manage', null, true);

  e1 := pg_temp.ee(pat);
  e2 := pg_temp.ee(pat2);

  -- ============================== R. caregiver red-care answer ==============================
  -- R0 reproduces the original failure: the old own-account function refuses a caregiver with 42501 (it stays exactly like that).
  perform pg_temp.act(cg);
  perform pg_temp.rec('R0 the own-account function still refuses a caregiver (the original 42501, unchanged)', '42501',
    pg_temp.try(format('select public.record_red_care_response(gen_random_uuid(), ''sought_care'', %L, null)', e1)));
  -- R1 the new function answers for the person.
  ans := public.record_red_care_response_for(pat, v_cid, 'sought_care', e1, null, now());
  ans2 := public.record_red_care_response_for(pat, v_cid, 'sought_care', e1, null, now());
  perform pg_temp.back();
  perform pg_temp.rec('R1 a caregiver answer is stored as the patient''s row, answered by the caregiver', 'true,true,true',
    (select (patient_id = pat)::text || ',' || (answered_by = cg)::text || ',' || (emergency_event_id = e1)::text from public.red_care_responses where id = ans));
  perform pg_temp.rec('R2 a retry with the same client id returns the same row and stores one', 'true,1',
    (ans = ans2)::text || ',' || (select count(*)::text from public.red_care_responses where client_id = v_cid));
  perform pg_temp.rec('R3 the audit row has the caregiver as actor and names the person', '1',
    (select count(*)::text from public.audit_log where action = 'red_care_response.recorded' and entity_id = ans and actor_id = cg and event ->> 'acted_for' = pat::text));
  perform pg_temp.rec('R4 the person''s access log shows the caregiver acting', '1',
    (select count(*)::text from public.care_access_events where patient_id = pat and actor_profile_id = cg and kind = 'acted_for' and scope = 'care_status' and metadata ->> 'what' = 'red_care_answer'));
  -- R5 the patient sees the answer and the helper; their own answer carries no helper.
  perform pg_temp.act(pat);
  rpat := public.record_red_care_response(gen_random_uuid(), 'could_not_get_care', e1, null, now());
  perform pg_temp.rec('R5 the patient sees both answers and the helper only on the caregiver''s', '2,1,1',
    (select count(*)::text from public.red_care_responses where patient_id = pat) || ',' ||
    (select count(*)::text from public.red_care_responses where patient_id = pat and answered_by = cg) || ',' ||
    (select count(*)::text from public.red_care_responses where id = rpat and answered_by is null));
  perform pg_temp.rec('R5b the patient''s own answer through the new function works and carries no helper', 'true',
    (select (answered_by is null)::text from public.red_care_responses where id = public.record_red_care_response_for(pat, gen_random_uuid(), 'sought_care', e1, null, now())));
  perform pg_temp.back();
  -- R6 refusals.
  perform pg_temp.act(stranger);
  perform pg_temp.rec('R6a an unrelated user is refused', '42501', pg_temp.try(format('select public.record_red_care_response_for(%L, gen_random_uuid(), ''sought_care'', %L, null, null)', pat, e1)));
  perform pg_temp.back();
  perform pg_temp.act(cg_view);
  perform pg_temp.rec('R6b a view-only grant is refused', '42501', pg_temp.try(format('select public.record_red_care_response_for(%L, gen_random_uuid(), ''sought_care'', %L, null, null)', pat, e1)));
  perform pg_temp.back();
  perform pg_temp.act(cg_narrow);
  perform pg_temp.rec('R6c a manage grant narrowed to neither capability is refused', '42501', pg_temp.try(format('select public.record_red_care_response_for(%L, gen_random_uuid(), ''sought_care'', %L, null, null)', pat, e1)));
  perform pg_temp.back();
  perform pg_temp.act(cg_exp);
  perform pg_temp.rec('R6d an expired grant is refused', '42501', pg_temp.try(format('select public.record_red_care_response_for(%L, gen_random_uuid(), ''sought_care'', %L, null, null)', pat, e1)));
  perform pg_temp.back();
  -- R7 both capability-narrowed helpers are allowed.
  perform pg_temp.act(cg_lr);
  perform pg_temp.rec('R7a a log_readings-only helper may answer', 'ok', pg_temp.try(format('select public.record_red_care_response_for(%L, gen_random_uuid(), ''sought_care'', %L, null, null)', pat, e1)));
  perform pg_temp.back();
  perform pg_temp.act(cg_ra);
  perform pg_temp.rec('R7b a receive_alerts-only helper may answer', 'ok', pg_temp.try(format('select public.record_red_care_response_for(%L, gen_random_uuid(), ''sought_care'', %L, null, null)', pat, e1)));
  perform pg_temp.back();
  -- R8 someone else's event through your own person, and no widening of the reproductive category.
  perform pg_temp.act(cg);
  perform pg_temp.rec('R8a a red event of another person cannot be answered through the person you help', '42501',
    pg_temp.try(format('select public.record_red_care_response_for(%L, gen_random_uuid(), ''sought_care'', %L, null, null)', pat, e2)));
  perform pg_temp.rec('R8b the helper holds no reproductive_health access, before and after', 'false',
    private.can_read_clinical(pat, 'reproductive_health'::public.care_access_category)::text);
  perform pg_temp.rec('R8c a missing client id and a bad answer are refused', '22023,22023',
    pg_temp.try(format('select public.record_red_care_response_for(%L, null, ''sought_care'', %L, null, null)', pat, e1)) || ',' ||
    pg_temp.try(format('select public.record_red_care_response_for(%L, gen_random_uuid(), ''maybe'', %L, null, null)', pat, e1)));
  perform pg_temp.back();
  -- R9 never stops paging.
  perform pg_temp.rec('R9 no answer acknowledged a page', '0',
    (select count(*)::text from public.pages where patient_id = pat and acknowledged_at is not null));
  perform pg_temp.act_anon();
  perform pg_temp.rec('R10 anon cannot execute the new function', '42501',
    pg_temp.try(format('select public.record_red_care_response_for(%L, gen_random_uuid(), ''sought_care'', %L, null, null)', pat, e1)));
  perform pg_temp.back();
  perform pg_temp.rec('R11 the responder''s view now says when a helper answered', 'true',
    (position('answered_by_caregiver' in pg_get_functiondef('public.latest_red_patient_response(uuid,uuid)'::regprocedure)) > 0)::text);

  -- ============================== A. assisted entry ==============================
  -- A1 / A2 a caregiver stores a reading for the patient.
  perform pg_temp.act(cg);
  perform pg_temp.rec('A1 an unrestricted manage grant stores a BP reading for the patient', 'ok', pg_temp.bp(v_org, pat, 128, 82));
  perform pg_temp.back();
  perform pg_temp.rec('A1b the reading is manual, logged by the caregiver, with one ledger row', 'manual,true,1,caregiver,full_manage_grant',
    (select r.source::text || ',' || (r.logged_by_profile_id = cg)::text || ',' || (select count(*)::text from public.assisted_entry_log l where l.vital_reading_id = r.id) || ',' ||
            (select l.actor_kind || ',' || l.consent_basis from public.assisted_entry_log l where l.vital_reading_id = r.id)
       from public.vitals_readings r where r.patient_id = pat and r.systolic = 128));
  perform pg_temp.act(cg_lr);
  perform pg_temp.rec('A2 a grant naming log_readings stores a reading', 'ok', pg_temp.bp(v_org, pat, 131, 84));
  perform pg_temp.back();
  perform pg_temp.rec('A2b its basis is explicit_permission', 'explicit_permission',
    (select l.consent_basis from public.assisted_entry_log l join public.vitals_readings r on r.id = l.vital_reading_id where r.patient_id = pat and r.systolic = 131));
  -- A3 refusals store nothing.
  perform pg_temp.act(cg_narrow);
  perform pg_temp.rec('A3a a manage grant narrowed away from log_readings is refused', '42501', pg_temp.bp(v_org, pat, 133, 85));
  perform pg_temp.back();
  perform pg_temp.act(cg_view);
  perform pg_temp.rec('A3b a view grant is refused', '42501', pg_temp.bp(v_org, pat, 134, 85));
  perform pg_temp.back();
  perform pg_temp.act(cg_exp);
  perform pg_temp.rec('A3c an expired grant is refused', '42501', pg_temp.bp(v_org, pat, 135, 85));
  perform pg_temp.back();
  perform pg_temp.act(stranger);
  perform pg_temp.rec('A3d a stranger is refused', '42501', pg_temp.bp(v_org, pat, 136, 85));
  perform pg_temp.back();
  perform pg_temp.act(cg_nocat);
  perform pg_temp.rec('A3f an unrestricted grant WITHOUT the vitals category is refused (writes are never looser than reads)', '42501', pg_temp.bp(v_org, pat, 137, 85));
  perform pg_temp.back();
  perform pg_temp.rec('A3e none of the refused readings was stored', '0',
    (select count(*)::text from public.vitals_readings where patient_id = pat and systolic in (133, 134, 135, 136, 137)));
  -- A4 same path: a crisis BP entered by the caregiver raises the emergency event for the patient.
  select count(*) into v_before from public.emergency_events where patient_id = pat and trigger_detail is distinct from 'proof reading';
  perform pg_temp.act(cg);
  perform pg_temp.rec('A4 a crisis reading entered by the caregiver is stored', 'ok', pg_temp.bp(v_org, pat, 212, 128));
  perform pg_temp.back();
  select count(*) into v_after from public.emergency_events where patient_id = pat and trigger_detail is distinct from 'proof reading';
  perform pg_temp.rec('A4b the same red-flag path raised an event for the PATIENT (not the helper)', 'true,0',
    (v_after > v_before)::text || ',' || (select count(*)::text from public.emergency_events where patient_id = cg));
  -- A5 no backdating, no sensor rows.
  perform pg_temp.act(cg);
  perform pg_temp.rec('A5a a typed reading dated three days ago is stored', 'ok', pg_temp.bp(v_org, pat, 126, 80, 'now() - interval ''3 days'''));
  perform pg_temp.back();
  perform pg_temp.rec('A5b but it is stamped now, not three days ago', 'true',
    (select (taken_at > now() - interval '5 minutes')::text from public.vitals_readings where patient_id = pat and systolic = 126));
  perform pg_temp.act(cg);
  perform pg_temp.rec('A5c wearable, cgm and fhir_import rows are refused', '42501,42501,42501',
    pg_temp.bp(v_org, pat, 120, 78, 'now()', 'wearable') || ',' || pg_temp.bp(v_org, pat, 120, 78, 'now()', 'cgm') || ',' || pg_temp.bp(v_org, pat, 120, 78, 'now()', 'fhir_import'));
  perform pg_temp.rec('A5d a device row without a device is refused', '42501', pg_temp.bp(v_org, pat, 121, 78, 'now()', 'device'));
  perform pg_temp.rec('A5e a photo-confirmed row dated ten days ago is refused', '22023', pg_temp.bp(v_org, pat, 122, 78, 'now() - interval ''10 days''', 'photo_confirmed'));
  perform pg_temp.back();
  -- A5f the row flag is set for the helper's entry and a forged flag from a client is overwritten for the person's own entry.
  perform pg_temp.rec('A5f the helper''s reading is flagged assisted_entry', 'true',
    (select assisted_entry::text from public.vitals_readings where patient_id = pat and systolic = 128));
  perform pg_temp.act(pat);
  perform pg_temp.try(format('insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, source, taken_at, assisted_entry) values (%L, %L, ''blood_pressure'', 117, 77, ''manual'', now(), true)', v_org, pat));
  perform pg_temp.back();
  perform pg_temp.rec('A5g a forged assisted_entry on the person''s own reading is overwritten', 'false',
    (select assisted_entry::text from public.vitals_readings where patient_id = pat and systolic = 117));
  -- A5h staff writes through definer paths are not helpers: they are neither refused nor flagged.
  perform pg_temp.act(nurse);
  perform pg_temp.rec('A5h a staff session writing through a definer path is not refused, even with a deviceless device source', 'ok,ok',
    pg_temp.staff_definer_insert(v_org, pat, 'device') || ',' || pg_temp.staff_definer_insert(v_org, pat, 'manual'));
  perform pg_temp.back();
  perform pg_temp.rec('A5i those rows carry the staff id but are not flagged assisted', 'true,false',
    (select (bool_and(logged_by_profile_id = nurse))::text || ',' || (bool_or(assisted_entry))::text from public.vitals_readings where patient_id = pat and systolic = 141));
  -- A6 forged attribution is overwritten.
  perform pg_temp.act(cg);
  perform pg_temp.try(format('insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, source, taken_at, logged_by_profile_id) values (%L, %L, ''blood_pressure'', 129, 83, ''manual'', now(), %L)', v_org, pat, pat));
  perform pg_temp.back();
  perform pg_temp.rec('A6 a forged logged_by is replaced by the caller', 'true',
    (select (logged_by_profile_id = cg)::text from public.vitals_readings where patient_id = pat and systolic = 129));

  -- A7 rate limits. A fresh helper and two fresh patients so the earlier entries do not count.
  declare cg2 uuid := pg_temp.mkuser(v_org, 'helper-rate', 'patient'); pa uuid := pg_temp.mkuser(v_org, 'rate-a', 'patient'); pb uuid := pg_temp.mkuser(v_org, 'rate-b', 'patient');
          i int; lim_h int; res text := ''; v_rules jsonb := private.assisted_entry_rules(); v_cid_retry uuid := gen_random_uuid();
  begin
    perform pg_temp.grant_to(pa, cg2, 'manage', array['log_readings']::public.caregiver_permission[]);
    perform pg_temp.grant_to(pb, cg2, 'manage', array['log_readings']::public.caregiver_permission[]);
    lim_h := (private.assisted_entry_rules() ->> 'max_per_helper_per_person_per_hour')::int;
    perform pg_temp.act(cg2);
    res := pg_temp.try(format('insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, source, taken_at, client_reading_id) values (%L, %L, ''blood_pressure'', 120, 80, ''manual'', now(), %L)', v_org, pa, v_cid_retry)) || ',';
    for i in 2..lim_h loop res := res || pg_temp.bp(v_org, pa, 120 + i, 80) || ','; end loop;
    perform pg_temp.rec('A7a the first ' || lim_h || ' entries in an hour are accepted', repeat('ok,', lim_h), res);
    v_msg := pg_temp.bp_msg(v_org, pa, 150, 90);
    perform pg_temp.rec('A7b0 a blind retry of a reading that already landed is a duplicate (23505), not a rate-limit refusal',
      '23505', pg_temp.try(format('insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, source, taken_at, client_reading_id) values (%L, %L, ''blood_pressure'', 120, 80, ''manual'', now(), %L)', v_org, pa, v_cid_retry)));
    perform pg_temp.back();
    perform pg_temp.rec('A7b the entry past the hourly limit is STORED, not refused', 'ok', v_msg);
    perform pg_temp.rec('A7c and flagged as past the limit on the row and in the ledger', 'true,true',
      (select r.assisted_rate_exceeded::text || ',' || (select l.rate_limit_exceeded::text from public.assisted_entry_log l where l.vital_reading_id = r.id)
         from public.vitals_readings r where r.patient_id = pa and r.systolic = 150));
    -- a DANGEROUS reading past the limit is stored and runs the red path for the patient (the limit must never block it).
    select count(*) into v_before from public.emergency_events where patient_id = pa;
    perform pg_temp.act(cg2);
    perform pg_temp.rec('A7c2 a dangerous reading past the hourly limit is accepted', 'ok', pg_temp.bp(v_org, pa, 215, 130));
    perform pg_temp.back();
    perform pg_temp.rec('A7c3 it is stored, flagged, and raised the red path for the patient', 'true,true',
      (select r.assisted_rate_exceeded::text from public.vitals_readings r where r.patient_id = pa and r.systolic = 215) || ',' ||
      ((select count(*) from public.emergency_events where patient_id = pa) > v_before)::text);
    -- the per-day limit across people: lower it for this transaction only.
    update public.assisted_entry_config set rules = '{"max_per_helper_per_person_per_hour": 100, "max_per_helper_per_day": ' || (lim_h + 2) || '}'::jsonb where is_active;
    perform pg_temp.act(cg2);
    perform pg_temp.rec('A7d a second person is still allowed under the day limit and not flagged', 'ok,ok,false',
      pg_temp.bp(v_org, pb, 121, 80) || ',' || pg_temp.bp(v_org, pb, 122, 80) || ',' || (select bool_or(assisted_rate_exceeded)::text from public.vitals_readings where patient_id = pb and systolic in (121, 122)));
    perform pg_temp.rec('A7e past the day limit it is stored and flagged whoever the person is', 'ok,true', pg_temp.bp(v_org, pb, 123, 80) || ',' || (select assisted_rate_exceeded::text from public.vitals_readings where patient_id = pb and systolic = 123));
    perform pg_temp.back();
    -- the patient's own entries are never limited.
    perform pg_temp.act(pb);
    res := '';
    for i in 1..(lim_h + 4) loop res := res || pg_temp.bp(v_org, pb, 118 + i, 79) || ','; end loop;
    perform pg_temp.back();
    perform pg_temp.rec('A7f the patient''s own entries are never limited', repeat('ok,', lim_h + 4), res);
    perform pg_temp.rec('A7g and leave no ledger row for the patient''s own entries', '0',
      (select count(*)::text from public.assisted_entry_log l join public.vitals_readings r on r.id = l.vital_reading_id where r.patient_id = pb and r.logged_by_profile_id is null));
    update public.assisted_entry_config set rules = v_rules where is_active;
  end;

  -- A8 the ledger.
  perform pg_temp.act(pat);
  perform pg_temp.rec('A8a the person reads the ledger rows entered for them', 'true', ((select count(*) from public.assisted_entry_log) >= 5)::text);
  perform pg_temp.rec('A8b a direct insert, update or delete is refused', '42501,42501,42501',
    pg_temp.try(format('insert into public.assisted_entry_log (organisation_id, patient_id, actor_id, actor_kind, vital_reading_id, vital_type, consent_basis) values (%L, %L, %L, ''caregiver'', gen_random_uuid(), ''blood_pressure'', ''full_manage_grant'')', v_org, pat, pat)) || ',' ||
    pg_temp.try('update public.assisted_entry_log set actor_kind = ''pharmacy'' where true') || ',' ||
    pg_temp.try('delete from public.assisted_entry_log where true'));
  perform pg_temp.back();
  perform pg_temp.act(stranger);
  perform pg_temp.rec('A8c a stranger reads none', '0', (select count(*)::text from public.assisted_entry_log));
  perform pg_temp.back();
  perform pg_temp.act(cg);
  perform pg_temp.rec('A8d a helper reads only their own', 'true', (select (count(*) > 0 and count(*) = count(*) filter (where actor_id = cg))::text from public.assisted_entry_log));
  perform pg_temp.back();

  -- A9 attribution names.
  perform pg_temp.act(pat);
  perform pg_temp.rec('A9a the person gets the helper''s name for a reading', 'AE helper-all,caregiver',
    (select a ->> 'actor_name' || ',' || (a ->> 'actor_kind') from jsonb_array_elements(public.assisted_entry_attribution(pat, array[(select id from public.vitals_readings where patient_id = pat and systolic = 128)])) a limit 1));
  perform pg_temp.back();
  perform pg_temp.act(stranger);
  perform pg_temp.rec('A9b a stranger gets nothing', '0',
    jsonb_array_length(public.assisted_entry_attribution(pat, array[(select id from public.vitals_readings where patient_id = pat and systolic = 128)]))::text);
  perform pg_temp.back();

  -- A10 the pharmacy seam is closed.
  perform pg_temp.rec('A10a the pharmacy guard is off and the seam says false', 'false,false',
    private.go_live_guard_on('assisted_entry_pharmacy_enabled')::text || ',' || private.pharmacy_assisted_entry_allowed(pat)::text);
  perform pg_temp.act(pharm);
  perform pg_temp.rec('A10b a pharmacist cannot write a reading for a person', '42501', pg_temp.bp(v_org, pat, 125, 80));
  perform pg_temp.back();
  perform pg_temp.rec('A11 reproductive_health is still not granted to any helper', '0',
    (select count(*)::text from public.profile_access_categories c join public.profile_access a on a.id = c.profile_access_id where a.profile_id = pat and c.category = 'reproductive_health'));
end $$;

-- ===================================== sabotage =====================================
-- Each step reverts one protection inside this transaction, re-runs the matching check, and records what it sees. The checks must change.
do $$
declare
  v_org uuid; pat uuid; stranger uuid; cg_narrow uuid; cg_rate uuid; pr uuid; e1 uuid; v_def text; lim_h int; i int; res text := '';
begin
  select id into v_org from public.organisations order by created_at limit 1;
  pat := pg_temp.mkuser(v_org, 'sab-patient', 'patient');
  stranger := pg_temp.mkuser(v_org, 'sab-stranger', 'patient');
  cg_narrow := pg_temp.mkuser(v_org, 'sab-narrow', 'patient');
  cg_rate := pg_temp.mkuser(v_org, 'sab-rate', 'patient');
  pr := pg_temp.mkuser(v_org, 'sab-rate-patient', 'patient');
  perform pg_temp.grant_to(pat, cg_narrow, 'manage', array['view_appointments']::public.caregiver_permission[]);
  perform pg_temp.grant_to(pr, cg_rate, 'manage', array['log_readings']::public.caregiver_permission[]);
  e1 := pg_temp.ee(pat);

  -- S1 the red-care permission check removed: a stranger could answer for anyone.
  v_def := pg_get_functiondef('public.record_red_care_response_for(uuid,uuid,text,uuid,uuid,timestamptz)'::regprocedure);
  if position('you are not allowed to answer for this person' in v_def) = 0 then raise exception 'VACUOUS TEST: permission anchor not found'; end if;
  execute replace(v_def, 'if not (private.can_act_for(p_patient, ''receive_alerts''::public.caregiver_permission)', 'if false and not (private.can_act_for(p_patient, ''receive_alerts''::public.caregiver_permission)');
  perform pg_temp.act(stranger);
  insert into results values ('sabotaged', 'an unrelated user is refused the red-care answer', '42501',
    pg_temp.try(format('select public.record_red_care_response_for(%L, gen_random_uuid(), ''sought_care'', %L, null, null)', pat, e1)));
  perform pg_temp.back();
  execute v_def;

  -- S2 the capability policy and the guard trigger removed: a narrowed grant could write readings.
  drop trigger vitals_readings_assisted_entry_guard on public.vitals_readings;
  drop policy vitals_readings_insert_acting_supporter on public.vitals_readings;
  create policy vitals_readings_insert_acting_supporter on public.vitals_readings for insert to authenticated with check (private.can_act_for(patient_id));
  perform pg_temp.act(cg_narrow);
  insert into results values ('sabotaged', 'a grant narrowed away from log_readings is refused', '42501', pg_temp.bp(v_org, pat, 133, 85));
  perform pg_temp.back();

  -- S3 only the rate limit removed (the guard trigger put back first): the entry past the hourly limit gets through.
  create trigger vitals_readings_assisted_entry_guard before insert on public.vitals_readings for each row execute function private.assisted_entry_guard();
  v_def := pg_get_functiondef('private.assisted_entry_guard()'::regprocedure);
  if position('if v_n >= v_hour then' in v_def) = 0 then raise exception 'VACUOUS TEST: rate limit anchor not found'; end if;
  execute replace(v_def, 'if v_n >= v_hour then', 'if false then');
  -- (with the limit removed nothing is ever flagged, so the flag check below changes)
  lim_h := (private.assisted_entry_rules() ->> 'max_per_helper_per_person_per_hour')::int;
  perform pg_temp.act(cg_rate);
  for i in 1..lim_h loop perform pg_temp.bp(v_org, pr, 120 + i, 80); end loop;
  perform pg_temp.bp(v_org, pr, 150, 90);
  perform pg_temp.back();
  insert into results values ('sabotaged', 'the entry past the hourly limit is flagged', 'true',
    coalesce((select r.assisted_rate_exceeded::text from public.vitals_readings r where r.patient_id = pr and r.systolic = 150), 'missing'));
  execute v_def;
  -- S4 a limit that REFUSES (the rejected design): a dangerous reading past the limit would be lost. Sabotage makes the guard raise.
  v_def := pg_get_functiondef('private.assisted_entry_guard()'::regprocedure);
  execute replace(v_def, 'new.assisted_rate_exceeded := true;', 'raise exception ''assisted_entry_rate_limited'' using errcode = ''53400'';');
  perform pg_temp.act(cg_rate);
  insert into results values ('sabotaged', 'a dangerous reading past the limit is accepted', 'ok', pg_temp.bp(v_org, pr, 220, 135));
  perform pg_temp.back();
  execute v_def;
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'assisted entry proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected is distinct from actual;
  if v_caught < 4 then
    raise exception 'VACUOUS TEST: only % of 4 sabotage steps changed the matching check', v_caught;
  end if;
end $$;

select phase, check_name, expected, actual,
       case when phase = 'sabotaged' then case when expected is distinct from actual then 'PASS (caught)' else 'FAIL' end
            when expected is not distinct from actual then 'PASS' else 'FAIL' end as result
from results order by phase desc, check_name;

rollback;
