-- ===========================================================================
-- Proof: 20261105135508_t2_11d_collection_schedule_and_caregiver.sql
--
-- Proves: (S1) a new prescription's missed-dose tracking starts on the collection date the patient gives (no "missed" before it, missed
-- after it); (S2) never collected, it starts 3 days after signing (versioned fallback), not at signing; (S3) a pharmacy that records first sets the start (source
-- 'pharmacy'); (S4) an existing medicine (flag false) and a patient-added medicine never move; (S5) an undo that leaves no collection
-- puts the start back to the 3-day fallback; (C1) a caregiver with a manage grant carrying manage_pharmacy confirms for the patient: the row is
-- the patient's, recorded_by the caregiver, labelled with the Care Circle relationship ('Daughter'), audited with the caregiver as actor
-- and the patient as subject, and the start is labelled 'caregiver'; an unrestricted manage grant is labelled 'caregiver'; (C2) a caregiver
-- whose grant lacks manage_pharmacy, and a stranger, get not_found and write nothing; (C3) undo by another caregiver or a stranger is
-- refused, by the recording caregiver is accepted and audited as a caregiver withdrawal; once the grant is revoked that caregiver can no
-- longer undo, the patient still can; (C4) the care team reads the label.
-- (R) dose reminders: none before collection, one after it, one once 3 days pass with no collection, none at 2 days, existing and
-- patient-added medicines unchanged. Missed-dose counting for an uncollected prescription starts at the 3-day fallback, not at signing.
-- SABOTAGE: (1) the shared start without the collection: a pre-collection slot is marked missed again; (2) the caregiver gate opened to
-- anyone: a stranger can confirm; (3) the recompute trigger off: a confirmation leaves no start; (4) the reminder job without the wait
-- reminds an uncollected prescription. Each must flip.
-- Wrapped in BEGIN/ROLLBACK; mints its own fixtures.
-- ===========================================================================

begin;

do $$
declare
  v_org uuid;
  v_pat uuid := gen_random_uuid();
  v_doc uuid := gen_random_uuid();
  v_cg1 uuid := gen_random_uuid();   -- manage + manage_pharmacy, Care Circle 'Daughter'
  v_cg2 uuid := gen_random_uuid();   -- manage, but only view_medication
  v_cg3 uuid := gen_random_uuid();   -- manage, unrestricted (null permissions), no circle row
  v_str uuid := gen_random_uuid();   -- no grant
  v_m1 uuid; v_m2 uuid; v_m3 uuid; v_m4 uuid; v_m5 uuid; v_m6 uuid; v_m7 uuid; v_mp uuid;
  v_t4 text;
  v_today date := (now() at time zone 'Africa/Lagos')::date;
  -- signed at midnight Lagos four days ago: the 3-day fallback (prescription_supply_config v2) is then midnight yesterday
  v_old timestamptz := ((((now() at time zone 'Africa/Lagos')::date) - 4)::timestamp at time zone 'Africa/Lagos');
  v_slot text := to_char(now() at time zone 'Africa/Lagos', 'HH24:MI');
  v_r1 uuid; v_r2 uuid; v_r3 uuid; v_r4 uuid; v_r5 uuid; v_r6 uuid;
  r record;
  v_n integer;
  v_out text;
  v_c uuid;
  v_def text;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  select u, 't211d-' || substr(u::text, 1, 8) || '@example.invalid', 'x', now(), '{}', '{}' from unnest(array[v_pat, v_doc, v_cg1, v_cg2, v_cg3, v_str]) u;
  insert into public.profiles (id, organisation_id, role, full_name, phone) values
    (v_pat, v_org, 'patient',   'T211d Patient', '+2348058882101'),
    (v_doc, v_org, 'clinician', 'T211d Doctor',  '+2348058882102'),
    (v_cg1, v_org, 'patient',   'T211d Daughter', '+2348058882103'),
    (v_cg2, v_org, 'patient',   'T211d Viewer',  '+2348058882104'),
    (v_cg3, v_org, 'patient',   'T211d Helper',  '+2348058882105'),
    (v_str, v_org, 'patient',   'T211d Stranger', '+2348058882106')
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, full_name = excluded.full_name;
  insert into public.clinical_staff (organisation_id, profile_id, full_name, active, license_verified_at, doctor_tier,
                                     credential_type, credential_number, indemnity_insurer, indemnity_policy_number, indemnity_expires_at)
  values (v_org, v_doc, 'T211d Doctor', true, now(), 'senior_medical_officer', 'MDCN', 'T211D-1', 'Probe', 'T211D-1', now() + interval '1 year');
  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by, permissions) values
    (v_pat, v_cg1, 'manage', v_pat, array['manage_pharmacy', 'view_medication']::public.caregiver_permission[]),
    (v_pat, v_cg2, 'manage', v_pat, array['view_medication']::public.caregiver_permission[]),
    (v_pat, v_cg3, 'manage', v_pat, null);
  insert into public.care_circle_members (organisation_id, patient_id, supporter_id, relationship, permissions, expires_at)
  values (v_org, v_pat, v_cg1, 'Daughter', array['adherence_summary'], now() + interval '30 days');

  perform set_config('request.jwt.claims', json_build_object('sub', v_doc, 'role', 'authenticated')::text, true);
  insert into public.medications (organisation_id, patient_id, drug_name, dose, frequency, quantity, source, added_by, repeats_allowed, schedule_times)
  select v_org, v_pat, 'T211d Med ' || n, '5 mg', 'Once daily', '30 tablets', 'clinician', v_doc, 0, '["08:00"]'::jsonb from generate_series(1, 7) n;
  select id into v_m1 from public.medications where patient_id = v_pat and drug_name = 'T211d Med 1';
  select id into v_m2 from public.medications where patient_id = v_pat and drug_name = 'T211d Med 2';
  select id into v_m3 from public.medications where patient_id = v_pat and drug_name = 'T211d Med 3';
  select id, public_token into v_m4, v_t4 from public.medications where patient_id = v_pat and drug_name = 'T211d Med 4';
  select id into v_m5 from public.medications where patient_id = v_pat and drug_name = 'T211d Med 5';
  select id into v_m6 from public.medications where patient_id = v_pat and drug_name = 'T211d Med 6';
  select id into v_m7 from public.medications where patient_id = v_pat and drug_name = 'T211d Med 7';
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  insert into public.medications (organisation_id, patient_id, drug_name, dose, frequency, source, schedule_times)
  values (v_org, v_pat, 'T211d Own Vitamin', '1 tab', 'Daily', 'patient', '["08:00"]'::jsonb) returning id into v_mp;
  perform set_config('request.jwt.claims', '', true);

  if (select count(*) from public.medications where patient_id = v_pat and schedule_starts_on_collection) <> 7 then
    raise exception 'FAIL F1: new clinician prescriptions are not flagged to start on collection';
  end if;
  if (select schedule_starts_on_collection from public.medications where id = v_mp) then
    raise exception 'FAIL F2: a patient-added medicine was flagged';
  end if;
  -- signed five days ago; m3 stands for a medicine that existed before this change
  -- fixture back-dating only: the medicines row guards would read it as an edit, so they are bypassed for these two statements
  set local session_replication_role = replica;
  update public.medications set created_at = v_old, schedule_effective_from = v_old where patient_id = v_pat;
  update public.medications set schedule_starts_on_collection = false where id = v_m3;
  set local session_replication_role = origin;

  -- (S1) collected two days ago, said by the patient --------------------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select * into r from public.confirm_prescription_collected(v_m1, v_today - 2);
  if r.outcome <> 'recorded' then execute 'reset role'; raise exception 'FIXTURE S1: %', r; end if;
  select * into r from public.confirm_prescription_collected(v_m3, v_today - 2);
  if r.outcome <> 'recorded' then execute 'reset role'; raise exception 'FIXTURE S4: %', r; end if;
  -- the patient reads their own start row
  select count(*) into v_n from public.medication_schedule_starts where medication_id = v_m1;
  execute 'reset role';
  if v_n <> 1 then raise exception 'FAIL S1a: the patient cannot read their schedule start'; end if;
  select * into r from public.medication_schedule_starts where medication_id = v_m1;
  if r.source <> 'patient' or r.collected_on <> v_today - 2 or r.starts_at <> ((v_today - 2)::timestamp at time zone 'Africa/Lagos') then
    raise exception 'FAIL S1b: start row %', r;
  end if;
  if private.medication_active_from(v_m1) <> ((v_today - 2)::timestamp at time zone 'Africa/Lagos') then
    raise exception 'FAIL S1c: active_from %', private.medication_active_from(v_m1);
  end if;

  -- (S3) a pharmacy records first
  execute 'set local role anon';
  select * into r from public.record_prescription_supply_public(v_t4, 'Corner Chemist', 'Ada Pharmacist', 'PCN-123');
  execute 'reset role';
  if r.outcome <> 'recorded' then raise exception 'FIXTURE S3: %', r; end if;
  select * into r from public.medication_schedule_starts where medication_id = v_m4;
  if r.source is distinct from 'pharmacy' or r.collected_on <> v_today or r.starts_at < now() - interval '1 minute' then
    raise exception 'FAIL S3: pharmacy-first start %', r;
  end if;

  perform private.mark_overdue_doses_missed(now());
  -- m1: nothing missed before collection (today-3), missed from collection on (today-2)
  if exists (select 1 from public.medication_logs where medication_id = v_m1 and scheduled_for_date = v_today - 3) then
    raise exception 'FAIL S1d: a dose before collection was marked missed';
  end if;
  if not exists (select 1 from public.medication_logs where medication_id = v_m1 and scheduled_for_date = v_today - 2 and status = 'missed') then
    raise exception 'FAIL S1e: a dose after collection was not marked missed';
  end if;
  -- (S2) never collected: counting starts at the fallback (signing + 3 days = midnight yesterday), not at signing
  if exists (select 1 from public.medication_logs where medication_id = v_m2 and scheduled_for_date in (v_today - 3, v_today - 2)) then
    raise exception 'FAIL S2a: an uncollected prescription counted a missed dose before the 3-day fallback';
  end if;
  if not exists (select 1 from public.medication_logs where medication_id = v_m2 and scheduled_for_date = v_today - 1 and status = 'missed') then
    raise exception 'FAIL S2b: an uncollected prescription does not count from the 3-day fallback';
  end if;
  -- (S4) an existing medicine and a patient-added one do not move
  if exists (select 1 from public.medication_schedule_starts where medication_id in (v_m3, v_mp))
     or not exists (select 1 from public.medication_logs where medication_id = v_m3 and scheduled_for_date = v_today - 3 and status = 'missed') then
    raise exception 'FAIL S4: an existing medicine moved to its collection date';
  end if;
  -- m4: the pharmacy recorded today, so nothing before today is missed
  if exists (select 1 from public.medication_logs where medication_id = v_m4 and scheduled_for_date < v_today) then
    raise exception 'FAIL S3b: a dose before the pharmacy supply was marked missed';
  end if;

  -- (S5) undo with nothing else collected: back to signing
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  select id into v_c from public.pharmacy_order_dispenses where medication_id = v_m1 and recorded_via = 'patient_confirmation';
  execute 'set local role authenticated';
  v_out := public.undo_prescription_collected(v_c);
  execute 'reset role';
  if v_out <> 'undone' then raise exception 'FIXTURE S5: %', v_out; end if;
  if exists (select 1 from public.medication_schedule_starts where medication_id = v_m1) or private.medication_active_from(v_m1) <> v_old + interval '3 days' then
    raise exception 'FAIL S5: after undo the start is not the 3-day fallback (%)', private.medication_active_from(v_m1);
  end if;

  -- (C1) a caregiver with manage_pharmacy confirms for the patient ------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_cg1, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select * into r from public.confirm_prescription_collected(v_m5, v_today - 1, 'Ward Pharmacy', 'Yaba', null, v_pat);
  execute 'reset role';
  if r.outcome <> 'recorded' then raise exception 'FAIL C1a: caregiver with the permission refused: %', r; end if;
  v_c := r.dispense_id;
  select * into r from public.pharmacy_order_dispenses where id = v_c;
  if r.patient_id <> v_pat or r.recorded_by <> v_cg1 or r.reported_by_relationship is distinct from 'Daughter'
     or r.recorded_via <> 'patient_confirmation' or r.source <> 'patient' then
    raise exception 'FAIL C1b: caregiver row %', r;
  end if;
  if not exists (select 1 from public.audit_log where entity_id = v_c and action = 'prescription.patient_reported_supply'
                   and actor_id = v_cg1 and subject_patient_id = v_pat and event ->> 'reported_by' = 'caregiver' and event ->> 'relationship' = 'Daughter') then
    raise exception 'FAIL C1c: caregiver confirmation not audited with who did it';
  end if;
  if (select source from public.medication_schedule_starts where medication_id = v_m5) is distinct from 'caregiver' then
    raise exception 'FAIL C1d: the start is not labelled caregiver';
  end if;
  -- the start is readable exactly where the medicine is: a caregiver sees it if and only if they can see the medicine; a stranger never
  perform set_config('request.jwt.claims', json_build_object('sub', v_cg1, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select (select count(*) from public.medication_schedule_starts where medication_id = v_m5)
       - (select count(*) from public.medications where id = v_m5) into v_n;
  execute 'reset role';
  if v_n <> 0 then raise exception 'FAIL C1e: the start is readable differently from the medicine for a caregiver (%)', v_n; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_str, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_n from public.medication_schedule_starts where patient_id = v_pat;
  execute 'reset role';
  if v_n <> 0 then raise exception 'FAIL C1f: a stranger reads % schedule starts', v_n; end if;
  -- an unrestricted manage grant is labelled 'caregiver'
  perform set_config('request.jwt.claims', json_build_object('sub', v_cg3, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select * into r from public.confirm_prescription_collected(v_m6, null, null, null, null, v_pat);
  execute 'reset role';
  if r.outcome <> 'recorded' or (select reported_by_relationship from public.pharmacy_order_dispenses where id = r.dispense_id) is distinct from 'caregiver' then
    raise exception 'FAIL C1g: unrestricted caregiver: %', r;
  end if;

  -- (C2) no permission, no stranger -------------------------------------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_cg2, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select * into r from public.confirm_prescription_collected(v_m7, null, null, null, null, v_pat);
  execute 'reset role';
  if r.outcome <> 'not_found' then raise exception 'FAIL C2a: a caregiver without manage_pharmacy confirmed: %', r; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_str, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select * into r from public.confirm_prescription_collected(v_m7, null, null, null, null, v_pat);
  if r.outcome <> 'not_found' then execute 'reset role'; raise exception 'FAIL C2b: a stranger confirmed: %', r; end if;
  -- a stranger naming no patient is just themselves: the medicine is not theirs
  select * into r from public.confirm_prescription_collected(v_m7);
  execute 'reset role';
  if r.outcome <> 'not_found' then raise exception 'FAIL C2c: a stranger confirmed without naming the patient: %', r; end if;
  if exists (select 1 from public.pharmacy_order_dispenses where medication_id = v_m7) then raise exception 'FAIL C2d: a refused confirmation wrote a row'; end if;

  -- (C3) undo ----------------------------------------------------------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_cg3, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_out := public.undo_prescription_collected(v_c);
  execute 'reset role';
  if v_out <> 'not_found' then raise exception 'FAIL C3a: another caregiver undid it: %', v_out; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_str, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_out := public.undo_prescription_collected(v_c);
  execute 'reset role';
  if v_out <> 'not_found' then raise exception 'FAIL C3b: a stranger undid it: %', v_out; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_cg1, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_out := public.undo_prescription_collected(v_c, 'Wrong medicine');
  execute 'reset role';
  if v_out <> 'undone' then raise exception 'FAIL C3c: the recording caregiver could not undo: %', v_out; end if;
  if not exists (select 1 from public.audit_log where entity_id = v_c and action = 'prescription.patient_reported_supply_withdrawn'
                   and actor_id = v_cg1 and subject_patient_id = v_pat and event ->> 'withdrawn_by' = 'caregiver') then
    raise exception 'FAIL C3d: caregiver undo not audited';
  end if;
  -- confirm again, then the grant goes: the caregiver can no longer undo, the patient can
  execute 'set local role authenticated';
  select * into r from public.confirm_prescription_collected(v_m5, null, null, null, null, v_pat);
  execute 'reset role';
  if r.outcome <> 'recorded' then raise exception 'FIXTURE C3e: %', r; end if;
  v_c := r.dispense_id;
  delete from public.profile_access where profile_id = v_pat and grantee_user_id = v_cg1;
  execute 'set local role authenticated';
  v_out := public.undo_prescription_collected(v_c);
  execute 'reset role';
  if v_out <> 'not_found' then raise exception 'FAIL C3f: a caregiver whose grant was revoked undid it: %', v_out; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_out := public.undo_prescription_collected(v_c);
  execute 'reset role';
  if v_out <> 'undone' then raise exception 'FAIL C3g: the patient could not undo the caregiver''s confirmation: %', v_out; end if;

  -- SABOTAGE 1: the shared start without the collection: m1-like med, a pre-collection slot is marked missed again ------------------
  delete from public.medication_logs where medication_id = v_m6;
  -- m6 was confirmed today by cg3; with the start honoured nothing before today is missed
  perform private.mark_overdue_doses_missed(now());
  if exists (select 1 from public.medication_logs where medication_id = v_m6 and scheduled_for_date < v_today) then
    raise exception 'FAIL S6: m6 has a missed dose before its collection';
  end if;
  v_def := pg_get_functiondef('private.medication_active_from(uuid)'::regprocedure);
  execute $s$create or replace function private.medication_active_from(p_medication uuid) returns timestamptz
    language sql stable security definer set search_path = '' as $b$
      select greatest(m.created_at, coalesce(m.schedule_effective_from, m.created_at)) from public.medications m where m.id = p_medication $b$ $s$;
  perform private.mark_overdue_doses_missed(now());
  execute v_def;
  if not exists (select 1 from public.medication_logs where medication_id = v_m6 and scheduled_for_date = v_today - 3) then
    raise exception 'SABOTAGE 1 did not flip: without the collection start a pre-collection slot is still not marked missed';
  end if;

  -- SABOTAGE 2: the caregiver gate opened: a stranger confirms --------------------------------------------------------------------------
  v_def := pg_get_functiondef('private.may_confirm_collection_for(uuid)'::regprocedure);
  execute $s$create or replace function private.may_confirm_collection_for(p_patient uuid) returns boolean
    language sql stable security definer set search_path = '' as $b$ select true $b$ $s$;
  perform set_config('request.jwt.claims', json_build_object('sub', v_str, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select * into r from public.confirm_prescription_collected(v_m7, null, null, null, null, v_pat);
  execute 'reset role';
  execute v_def;
  if r.outcome <> 'recorded' then raise exception 'SABOTAGE 2 did not flip: an open gate still refused the stranger (%)', r.outcome; end if;

  -- SABOTAGE 3: the recompute trigger off: a confirmation leaves no start -------------------------------------------------------------
  delete from public.medication_schedule_starts where medication_id = v_m2;
  alter table public.pharmacy_order_dispenses disable trigger pharmacy_order_dispenses_schedule_start;
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select * into r from public.confirm_prescription_collected(v_m2);
  execute 'reset role';
  alter table public.pharmacy_order_dispenses enable trigger pharmacy_order_dispenses_schedule_start;
  if r.outcome <> 'recorded' then raise exception 'FIXTURE S3x: %', r; end if;
  if exists (select 1 from public.medication_schedule_starts where medication_id = v_m2) then
    raise exception 'SABOTAGE 3 did not flip: a start appeared without the trigger';
  end if;
  perform private.recompute_medication_schedule_start(v_m2);
  if not exists (select 1 from public.medication_schedule_starts where medication_id = v_m2) then
    raise exception 'FAIL S3y: recompute did not create the start';
  end if;

  -- (R) dose reminders wait for collection, or the 3-day fallback; other medicines unchanged --------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_doc, 'role', 'authenticated')::text, true);
  insert into public.medications (organisation_id, patient_id, drug_name, dose, frequency, quantity, source, added_by, repeats_allowed, schedule_times)
  select v_org, v_pat, 'T211d Rem ' || n, '5 mg', 'Once daily', '30 tablets', 'clinician', v_doc, 0, jsonb_build_array(v_slot) from generate_series(1, 5) n;
  select id into v_r1 from public.medications where patient_id = v_pat and drug_name = 'T211d Rem 1';
  select id into v_r2 from public.medications where patient_id = v_pat and drug_name = 'T211d Rem 2';
  select id into v_r3 from public.medications where patient_id = v_pat and drug_name = 'T211d Rem 3';
  select id into v_r4 from public.medications where patient_id = v_pat and drug_name = 'T211d Rem 4';
  select id into v_r5 from public.medications where patient_id = v_pat and drug_name = 'T211d Rem 5';
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  insert into public.medications (organisation_id, patient_id, drug_name, dose, frequency, source, schedule_times)
  values (v_org, v_pat, 'T211d Rem Own', '1 tab', 'Daily', 'patient', jsonb_build_array(v_slot)) returning id into v_r6;
  set local session_replication_role = replica;
  update public.medications set created_at = now() - interval '3 days 1 hour', schedule_effective_from = now() - interval '3 days 1 hour' where id = v_r3;
  update public.medications set created_at = now() - interval '2 days', schedule_effective_from = now() - interval '2 days' where id = v_r4;
  update public.medications set schedule_starts_on_collection = false where id = v_r5;   -- stands for a medicine signed before this change
  set local session_replication_role = origin;
  execute 'set local role authenticated';
  select * into r from public.confirm_prescription_collected(v_r2);
  execute 'reset role';
  if r.outcome <> 'recorded' then raise exception 'FIXTURE R: %', r; end if;
  perform set_config('request.jwt.claims', '', true);
  perform private.queue_medication_dose_reminders();
  if exists (select 1 from public.medication_dose_reminders where medication_id = v_r1) then
    raise exception 'FAIL R1: a reminder before collection';
  end if;
  if not exists (select 1 from public.medication_dose_reminders where medication_id = v_r2 and scheduled_for_date = v_today) then
    raise exception 'FAIL R2: no reminder after collection';
  end if;
  if not exists (select 1 from public.medication_dose_reminders where medication_id = v_r3 and scheduled_for_date = v_today) then
    raise exception 'FAIL R3: no reminder once 3 days passed without a collection';
  end if;
  if exists (select 1 from public.medication_dose_reminders where medication_id = v_r4) then
    raise exception 'FAIL R4: a reminder 2 days after signing with no collection';
  end if;
  if not exists (select 1 from public.medication_dose_reminders where medication_id = v_r5)
     or not exists (select 1 from public.medication_dose_reminders where medication_id = v_r6) then
    raise exception 'FAIL R5: an existing or patient-added medicine lost its reminder';
  end if;

  -- SABOTAGE 4: the reminder job without the wait: a prescription not yet collected is reminded ---------------------------------------
  v_def := pg_get_functiondef('private.queue_medication_dose_reminders()'::regprocedure);
  if position('and (not m.schedule_starts_on_collection or private.medication_active_from(m.id) <= now())' in v_def) = 0 then
    raise exception 'FIXTURE S4: the reminder wait is not where the sabotage expects it';
  end if;
  execute replace(v_def, 'and (not m.schedule_starts_on_collection or private.medication_active_from(m.id) <= now())', 'and true');
  perform private.queue_medication_dose_reminders();
  execute v_def;
  if not exists (select 1 from public.medication_dose_reminders where medication_id = v_r1) then
    raise exception 'SABOTAGE 4 did not flip: without the wait the uncollected prescription is still not reminded';
  end if;

  raise notice 'PASS: t2_11d collection schedule and caregiver';
end $$;

rollback;
