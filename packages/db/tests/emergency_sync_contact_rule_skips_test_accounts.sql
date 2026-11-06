-- ===========================================================================
-- Proof: 20261102131730_emergency_sync_contact_rule_skips_test_accounts.sql
-- PROVES
--   1. An emergency escalation for an is_test patient resolves on a note alone.
--   2. CONTROL: the same for a real patient is still refused (23514) with no contact.
--   3. SABOTAGE: the pre-fix body (no is_test read) refuses the test patient too, so check 1 discriminates.
-- Wrapped in BEGIN/ROLLBACK; mints its own patient profiles, alert rows and escalations.
-- ===========================================================================
begin;
create temp table esc_results (check_name text, observed text, expected text, verdict text);
create function pg_temp.chk(p_name text, p_expected text, p_observed text) returns void language plpgsql as $$
begin
  insert into esc_results values (p_name, p_observed, p_expected, case when p_observed is not distinct from p_expected then 'PASS' else 'FAIL' end);
end $$;

do $$
declare
  v_org uuid := '00000000-0000-0000-0000-000000000001';
  v_test uuid := gen_random_uuid();
  v_real uuid := gen_random_uuid();
  v_doc uuid;
  v_alert_t uuid; v_alert_r uuid; v_esc_t uuid; v_esc_r uuid;
  v_ok boolean; v_src text;
begin
  insert into auth.users (id, email) values (v_test, 'esc-proof-test-' || v_test || '@example.test'), (v_real, 'esc-proof-real-' || v_real || '@example.test');
  -- an auth.users insert creates the profile row by trigger; shape it afterwards
  update public.profiles set organisation_id = v_org, role = 'patient', full_name = 'Esc proof TEST patient', is_test = true where id = v_test;
  update public.profiles set organisation_id = v_org, role = 'patient', full_name = 'Esc proof real patient', is_test = false where id = v_real;
  select cs.profile_id into v_doc from public.clinical_staff cs where cs.active and cs.organisation_id = v_org and cs.doctor_tier in ('senior_medical_officer', 'chief_medical_officer') order by cs.created_at limit 1;
  if v_doc is null then
    -- a fresh replay has no doctor: mint an employed senior one (no indemnity needed for an employed senior)
    v_doc := gen_random_uuid();
    insert into auth.users (id, email) values (v_doc, 'esc-proof-doctor-' || v_doc || '@example.test');
    update public.profiles set organisation_id = v_org, role = 'clinician', full_name = 'Esc proof senior doctor' where id = v_doc;
    insert into public.clinical_staff (organisation_id, profile_id, full_name, active, license_verified_at, doctor_tier, employment_type)
    values (v_org, v_doc, 'Esc proof senior doctor', true, now(), 'senior_medical_officer', 'employed');
  end if;

  insert into public.clinician_alerts (organisation_id, patient_id, level, status, title) values (v_org, v_test, 'emergency', 'open', 'Esc proof: emergency (test patient)') returning id into v_alert_t;
  insert into public.clinician_alerts (organisation_id, patient_id, level, status, title) values (v_org, v_real, 'emergency', 'open', 'Esc proof: emergency (real patient)') returning id into v_alert_r;
  insert into public.escalations (organisation_id, patient_id, status, assigned_doctor_id, reason, clinician_alert_id) values (v_org, v_test, 'open', v_doc, 'Esc proof test', v_alert_t) returning id into v_esc_t;
  insert into public.escalations (organisation_id, patient_id, status, assigned_doctor_id, reason, clinician_alert_id) values (v_org, v_real, 'open', v_doc, 'Esc proof real', v_alert_r) returning id into v_esc_r;

  perform set_config('request.jwt.claim.sub', v_doc::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  -- 1. test patient: resolves on a note
  begin
    update public.escalations set status = 'resolved', resolution_note = 'test data resolution note', identity_confirmed = true where id = v_esc_t; v_ok := true;
  exception when others then v_ok := false; raise notice 'test patient refused: %', sqlerrm;
  end;
  perform pg_temp.chk('1 test patient emergency resolves on a note', 'true', v_ok::text);

  -- 2. CONTROL: real patient still refused
  begin
    update public.escalations set status = 'resolved', resolution_note = 'note only, no call made', identity_confirmed = true where id = v_esc_r; v_ok := true;
  exception when sqlstate '23514' then v_ok := false;
  end;
  perform pg_temp.chk('2 CONTROL real patient emergency still refused without contact', 'false', v_ok::text);

  -- 3. SABOTAGE: the exact pre-fix body (I5, 2026-07-30, no is_test read) must refuse a FRESH test-patient emergency
  v_src := pg_get_functiondef('private.enforce_emergency_escalation_synchronous_contact'::regproc);
  execute $sab$
    create or replace function private.enforce_emergency_escalation_synchronous_contact()
     returns trigger language plpgsql security definer set search_path to ''
    as $f$
    declare v_level public.alert_level; v_has_contact boolean;
    begin
      if new.status is distinct from 'resolved' or old.status = 'resolved' then return new; end if;
      select level into v_level from public.clinician_alerts where id = new.clinician_alert_id;
      if v_level is distinct from 'emergency' then return new; end if;
      select exists (select 1 from public.video_consultations vc where vc.status in ('started', 'completed')
        and (vc.escalation_id = new.id or (vc.patient_id = new.patient_id and vc.started_at is not null and vc.started_at between new.created_at and now()))) into v_has_contact;
      if not v_has_contact then
        raise exception 'An emergency escalation cannot be resolved with only a note -- complete a synchronous voice or video contact with the patient first (start a virtual review)' using errcode = '23514';
      end if;
      return new;
    end $f$;
  $sab$;
  insert into esc_results values ('info: sabotaged body reads is_test', (pg_get_functiondef('private.enforce_emergency_escalation_synchronous_contact'::regproc) ~ 'is_test')::text, 'false', 'INFO');
  insert into public.clinician_alerts (organisation_id, patient_id, level, status, title) values (v_org, v_test, 'emergency', 'open', 'Esc proof: emergency (test patient, sabotage)') returning id into v_alert_t;
  insert into public.escalations (organisation_id, patient_id, status, assigned_doctor_id, reason, clinician_alert_id) values (v_org, v_test, 'open', v_doc, 'Esc proof test sabotage', v_alert_t) returning id into v_esc_t;
  insert into esc_results values ('info: sabotage fixture alert level', (select level::text from public.clinician_alerts where id = v_alert_t), 'emergency', 'INFO');
  begin
    update public.escalations set status = 'resolved', resolution_note = 'test data resolution note', identity_confirmed = true where id = v_esc_t; v_ok := true;
  exception when sqlstate '23514' then v_ok := false;
  end;
  perform pg_temp.chk('3 SABOTAGE pre-fix body refuses the test patient (check 1 discriminates)', 'false', v_ok::text);
  execute v_src;
end $$;

select * from esc_results order by check_name;
do $$
declare v_fail integer;
begin
  select count(*) into v_fail from esc_results where verdict = 'FAIL';
  if v_fail > 0 then raise exception 'emergency sync-contact test-account proof: % check(s) FAILED', v_fail; end if;
end $$;
rollback;
