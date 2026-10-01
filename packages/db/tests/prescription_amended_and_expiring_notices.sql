-- ===========================================================================
-- Proof: *_prescription_amended_and_expiring_notices.sql (prescription PDF phase 4).
--
-- Proves: a brand-new prescription still gives the patient the in-app "prescribed" notice; an AMENDMENT (previous_version_id set) gives the in-app
-- 'prescription_updated_patient' notice and NOT a second "prescribed" one; the email/reminder-channel rows for the amendment are unchanged. The expiry
-- job queues one in-app notice for a current prescription expiring within 7 days, none for one expiring later, already expired, superseded, stopped or
-- patient-sourced, and never queues the same prescription twice; it is not anon-executable. SABOTAGE: removing the dedupe clause from a copy of the
-- function makes a second run queue a duplicate, so the one-per-prescription assertion is not vacuous.
-- Wrapped in BEGIN/ROLLBACK; mints its own fixtures.
-- ===========================================================================

begin;

do $$
declare
  v_org uuid;
  v_pat uuid := gen_random_uuid();
  v_doc uuid := gen_random_uuid();
  v_m1 uuid; v_m2 uuid; v_soon uuid; v_later uuid; v_expired uuid; v_sup uuid; v_stop uuid; v_self uuid;
  v_n integer; v_q integer; v_a integer; v_def text;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  select u, 'rxamd-' || substr(u::text, 1, 8) || '@example.invalid', 'x', now(), '{}', '{}' from unnest(array[v_pat, v_doc]) u;
  insert into public.profiles (id, organisation_id, role, full_name, phone) values
    (v_pat, v_org, 'patient',   'RxAmd Patient', '+2348058880701'),
    (v_doc, v_org, 'clinician', 'RxAmd Doctor',  '+2348058880702')
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, full_name = excluded.full_name;
  insert into public.clinical_staff (organisation_id, profile_id, full_name, active, license_verified_at, doctor_tier,
                                     credential_type, credential_number, indemnity_insurer, indemnity_policy_number, indemnity_expires_at)
  values (v_org, v_doc, 'RxAmd Doctor', true, now(), 'senior_medical_officer', 'MDCN', 'RXAMD-1', 'Probe', 'RXAMD-1', now() + interval '1 year');
  perform set_config('request.jwt.claims', json_build_object('sub', v_doc, 'role', 'authenticated')::text, true);

  -- 1. a new prescription: the usual notices (A rows across channels, at least one in-app)
  insert into public.medications (organisation_id, patient_id, drug_name, dose, frequency, source, added_by)
  values (v_org, v_pat, 'RxAmd Original', '5 mg', 'Daily', 'clinician', v_doc) returning id into v_m1;
  select count(*) into v_a from public.notifications where recipient_id = v_pat and template = 'medication_prescribed_patient'
     and payload->>'drug_name' = 'RxAmd Original';
  select count(*) into v_n from public.notifications where recipient_id = v_pat and channel = 'in_app' and template = 'medication_prescribed_patient'
     and payload->>'drug_name' = 'RxAmd Original';
  if v_n < 1 then raise exception 'FAIL: new prescription has no in-app prescribed notice'; end if;

  -- 2. an amendment: the explicit in-app "prescribed" row is replaced by the "updated" row; every other row is unchanged
  update public.medications set superseded_at = now(), is_active = false where id = v_m1;
  insert into public.medications (organisation_id, patient_id, drug_name, dose, frequency, source, added_by, previous_version_id, version, amendment_reason)
  values (v_org, v_pat, 'RxAmd Original', '2.5 mg', 'Daily', 'clinician', v_doc, v_m1, 2, 'Dose reduced') returning id into v_m2;
  select count(*) into v_n from public.notifications where recipient_id = v_pat and channel = 'in_app' and template = 'prescription_updated_patient'
     and payload->>'drug_name' = 'RxAmd Original' and (payload->>'version')::int = 2;
  if v_n <> 1 then raise exception 'FAIL: amendment updated-notice count % (expected 1)', v_n; end if;
  select count(*) into v_n from public.notifications where recipient_id = v_pat and template = 'medication_prescribed_patient'
     and payload->>'drug_name' = 'RxAmd Original';
  if v_n <> (2 * v_a - 1) then raise exception 'FAIL: amendment prescribed-row count % (expected %: the original % plus all but the in-app row)', v_n, 2 * v_a - 1, v_a; end if;

  -- 3. expiry reminders
  insert into public.medications (organisation_id, patient_id, drug_name, source, added_by) values (v_org, v_pat, 'RxAmd Soon', 'clinician', v_doc) returning id into v_soon;
  insert into public.medications (organisation_id, patient_id, drug_name, source, added_by) values (v_org, v_pat, 'RxAmd Later', 'clinician', v_doc) returning id into v_later;
  insert into public.medications (organisation_id, patient_id, drug_name, source, added_by) values (v_org, v_pat, 'RxAmd Expired', 'clinician', v_doc) returning id into v_expired;
  insert into public.medications (organisation_id, patient_id, drug_name, source, added_by) values (v_org, v_pat, 'RxAmd Superseded', 'clinician', v_doc) returning id into v_sup;
  insert into public.medications (organisation_id, patient_id, drug_name, source, added_by) values (v_org, v_pat, 'RxAmd Stopped', 'clinician', v_doc) returning id into v_stop;
  insert into public.medications (organisation_id, patient_id, drug_name, source, added_by) values (v_org, v_pat, 'RxAmd Self', 'patient', v_pat) returning id into v_self;
  update public.medications set expires_at = now() + interval '3 days' where id in (v_soon, v_sup, v_stop, v_self);
  update public.medications set expires_at = now() + interval '30 days' where id = v_later;
  update public.medications set expires_at = now() - interval '1 day' where id = v_expired;
  update public.medications set superseded_at = now(), is_active = false where id = v_sup;
  update public.medications set is_active = false where id = v_stop;
  update public.medications set expires_at = now() + interval '30 days' where id in (v_m1, v_m2);

  perform private.queue_prescription_expiry_reminders();
  select count(*) into v_n from public.notifications where recipient_id = v_pat and template = 'prescription_expiring_soon';
  if v_n <> 1 then raise exception 'FAIL: expected exactly 1 expiring notice, got %', v_n; end if;
  select count(*) into v_n from public.notifications where recipient_id = v_pat and template = 'prescription_expiring_soon'
     and payload->>'medication_id' = v_soon::text and channel = 'in_app';
  if v_n <> 1 then raise exception 'FAIL: the notice is not the in-app one for the expiring prescription'; end if;

  select private.queue_prescription_expiry_reminders() into v_q;
  select count(*) into v_n from public.notifications where recipient_id = v_pat and template = 'prescription_expiring_soon';
  if v_n <> 1 or v_q <> 0 then raise exception 'FAIL: a second run queued a duplicate (% rows, % queued)', v_n, v_q; end if;

  if has_function_privilege('anon', 'private.queue_prescription_expiry_reminders()', 'EXECUTE') then raise exception 'FAIL: anon can run the reminder job'; end if;

  -- SABOTAGE: without the dedupe clause a second run queues a duplicate
  select replace(pg_get_functiondef('private.queue_prescription_expiry_reminders()'::regprocedure),
                 'and not exists (', 'and true or exists (') into v_def;
  if v_def not like '%and true or exists (%' then raise exception 'SABOTAGE not applied'; end if;
  execute v_def;
  perform private.queue_prescription_expiry_reminders();
  select count(*) into v_n from public.notifications where recipient_id = v_pat and template = 'prescription_expiring_soon' and payload->>'medication_id' = v_soon::text;
  if v_n < 2 then raise exception 'SABOTAGE not effective: dedupe removal did not duplicate (%)', v_n; end if;

  raise notice 'prescription amended + expiring notices: all assertions passed';
end $$;

rollback;
