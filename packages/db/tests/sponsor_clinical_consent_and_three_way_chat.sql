-- ---------------------------------------------------------------------------
-- A sponsor may see clinical data, never edit it, and only while the patient
-- says so. And the three of them share one conversation.
--
-- Run inside a transaction that is ROLLED BACK. Nothing here persists.
--
-- Every negative check is paired with a control that must succeed in the same
-- transaction, because a grant that blocks everything would pass a
-- negatives-only test. The controls here are: a second next of kin who is
-- never consented (proves the gate is the consent, not the grant), a stranger
-- with no grant at all, and the sponsor themselves before and after the
-- patient flips the switch (proves it is the switch doing the work).
--
--   patient    the person whose record it is
--   sponsor    profile_access 'view' + clinical_access TRUE  -> reads, posts, cannot write or close
--   kin        profile_access 'view' + clinical_access FALSE -> sees nothing clinical (control)
--   stranger   no grant at all                               -> sees nothing (control)
--   clinician  org staff                                     -> unchanged by any of this (control)
--   admin      superadmin                                    -> must NOT be able to consent on
--                                                               the patient's behalf
--
-- Usage:
--   npx supabase db query --linked -f packages/db/tests/sponsor_clinical_consent_and_three_way_chat.sql
-- ---------------------------------------------------------------------------

begin;

do $$
declare
  v_org       uuid := '00000000-0000-0000-0000-000000000001';
  v_patient   uuid := 'a1e10000-0000-4000-8000-000000000001';
  v_sponsor   uuid := 'a1e10000-0000-4000-8000-000000000002';
  v_kin       uuid := 'a1e10000-0000-4000-8000-000000000003';
  v_stranger  uuid := 'a1e10000-0000-4000-8000-000000000004';
  v_clinician uuid := 'a1e10000-0000-4000-8000-000000000005';
  v_admin     uuid := 'a1e10000-0000-4000-8000-000000000006';
  v_screen    uuid;
  v_sched     uuid;
  v_bundle    uuid;
  v_alert     uuid;
  v_child     uuid := 'a1e10000-0000-4000-8000-000000000007';
  v_thread    uuid;
  v_vital     uuid;
  v_n         int;
  v_txt       text;
  v_flag      boolean;
  v_sqlstate  text;
begin
  select id into v_screen from public.screen_types order by code limit 1;
  if v_screen is null then raise exception 'no screen_types seeded — restore the catalogue first'; end if;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values
    (v_patient,   'sponsor-test-patient@example.invalid',   'x', now(), '{}', '{}'),
    (v_sponsor,   'sponsor-test-sponsor@example.invalid',   'x', now(), '{}', '{}'),
    (v_kin,       'sponsor-test-kin@example.invalid',       'x', now(), '{}', '{}'),
    (v_stranger,  'sponsor-test-stranger@example.invalid',  'x', now(), '{}', '{}'),
    (v_clinician, 'sponsor-test-clinician@example.invalid', 'x', now(), '{}', '{}'),
    (v_admin,     'sponsor-test-admin@example.invalid',     'x', now(), '{}', '{}');

  update public.profiles set organisation_id = v_org, role = 'patient',   full_name = 'Mama Test'        where id = v_patient;
  update public.profiles set organisation_id = v_org, role = 'patient',   full_name = 'Daughter Abroad'  where id = v_sponsor;
  update public.profiles set organisation_id = v_org, role = 'patient',   full_name = 'Uncle Nextofkin'  where id = v_kin;
  update public.profiles set organisation_id = v_org, role = 'patient',   full_name = 'Unrelated Person' where id = v_stranger;
  update public.profiles set organisation_id = v_org, role = 'clinician', full_name = 'Test Clinician'   where id = v_clinician;
  update public.profiles set organisation_id = v_org, role = 'admin',     full_name = 'Test Admin'       where id = v_admin;

  -- ---- 1. A new grant never carries health visibility -----------------------
  -- The second row asks for it outright. The trigger must refuse to honour
  -- that: consent is a later, separate act by the record owner.
  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by)
  values (v_patient, v_kin, 'view', v_patient);
  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by, clinical_access)
  values (v_patient, v_sponsor, 'view', v_patient, true);

  select count(*) into v_n from public.profile_access
   where profile_id = v_patient and clinical_access;
  if v_n <> 0 then
    raise exception 'FAIL: % grant(s) were created already able to read health data', v_n;
  end if;
  raise notice 'PASS  a new grant starts with no access to health information, even when asked for';

  -- Something real to look at, written as the system rather than as any persona.
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic)
  values (v_org, v_patient, 'blood_pressure', 148, 92)
  returning id into v_vital;
  insert into public.care_plans (organisation_id, patient_id, condition, status)
  values (v_org, v_patient, 'hypertension', 'active');
  insert into public.medications (organisation_id, patient_id, drug_name, source)
  values (v_org, v_patient, 'Amlodipine 5mg', 'clinician');
  insert into public.screening_schedules (organisation_id, patient_id, screen_type_id, due_date)
  values (v_org, v_patient, v_screen, current_date + 30)
  returning id into v_sched;
  -- A self-bookable bundle with no schedule link: the one patient-initiated
  -- shape private.enforce_lab_order_origin lets through on its own. Self-
  -- arranged (no fulfilment/provider given) is billed by the lab directly,
  -- so total_kobo must be 0 -- private.enforce_lab_order_origin now rejects
  -- a nonzero amount on this shape ("A self-arranged lab order is not
  -- billed by Tarragon").
  select id into v_bundle from public.panel_bundles where self_bookable order by code limit 1;
  if v_bundle is null then raise exception 'no self-bookable panel_bundles seeded'; end if;
  insert into public.lab_orders (organisation_id, patient_id, origin, total_kobo, panel_bundle_id)
  values (v_org, v_patient, 'patient_initiated', 0, v_bundle);
  insert into public.patient_risk_scores (organisation_id, patient_id, score_type, risk_level)
  values (v_org, v_patient, 'bp_control', 'high');

  -- The heavier disclosures the founder added on 2026-07-31: a result, and the
  -- reasoning attached to an escalation.
  -- Deliberately a NORMAL result: an abnormal one would fire the whole Cat 2->1
  -- pipeline and its notifications, which would muddy the notification counts in
  -- step 9. What is being tested here is whether the row is readable at all.
  insert into public.screening_results (organisation_id, patient_id, result_status)
  values (v_org, v_patient, 'normal');
  insert into public.clinician_alerts (organisation_id, patient_id, level, title, status)
  values (v_org, v_patient, 'clinician_review', 'Review the latest reading', 'open')
  returning id into v_alert;
  insert into public.escalations (organisation_id, patient_id, clinician_alert_id, status, reason)
  values (v_org, v_patient, v_alert, 'open', 'Blood pressure trending up over three readings');
  insert into public.lab_analyte_readings (organisation_id, patient_id, code, value, unit, taken_at)
  values (v_org, v_patient, 'total_cholesterol', 6.2, 'mmol/L', now());

  -- ---- 2. Before consent, the sponsor sees nothing clinical -----------------
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_sponsor, 'role', 'authenticated')::text, true);

  select count(*) into v_n from public.vitals_readings where patient_id = v_patient;
  if v_n <> 0 then
    raise exception 'FAIL: an unconsented sponsor already reads % vitals row(s)', v_n;
  end if;
  raise notice 'PASS  before consent the sponsor sees nothing, despite holding a grant';

  -- ---- 3. Nobody but the patient can turn it on -----------------------------
  -- The sponsor cannot: profile_access_update refuses them the row outright, so
  -- assert on the resulting state rather than on an exception.
  update public.profile_access set clinical_access = true
   where profile_id = v_patient and grantee_user_id = v_sponsor;
  select clinical_access into v_flag from public.profile_access
   where profile_id = v_patient and grantee_user_id = v_sponsor;
  if v_flag then raise exception 'FAIL: the sponsor granted themselves access'; end if;
  raise notice 'PASS  a sponsor cannot grant themselves access to the record';

  -- The superadmin CAN pass that policy, and is stopped by the trigger instead.
  -- This is the check that matters: without it, whoever runs the platform could
  -- appoint a reader of any patient's record.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  v_sqlstate := null;
  begin
    update public.profile_access set clinical_access = true
     where profile_id = v_patient and grantee_user_id = v_sponsor;
  exception when others then
    v_sqlstate := sqlstate;
  end;
  if v_sqlstate is distinct from '42501' then
    raise exception 'FAIL: superadmin consent attempt returned %, expected 42501', coalesce(v_sqlstate, 'success');
  end if;
  raise notice 'PASS  not even a superadmin may consent on the patient''s behalf';

  -- ---- 4. The patient turns it on --------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  update public.profile_access set clinical_access = true
   where profile_id = v_patient and grantee_user_id = v_sponsor;

  select clinical_access and clinical_access_updated_at is not null
    into v_flag
   from public.profile_access where profile_id = v_patient and grantee_user_id = v_sponsor;
  if not v_flag then
    raise exception 'FAIL: the patient could not consent, or the consent was not stamped';
  end if;
  raise notice 'PASS  the patient consents, in one click, on their own record';

  -- ---- 5. Now the sponsor reads it, and the unconsented kin still does not ---
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_sponsor, 'role', 'authenticated')::text, true);
  -- Count surfaces that return at least one row, not rows: activating a
  -- hypertension care plan legitimately schedules an extra lipid screening
  -- (ensure_chronic_lipid_schedule), so a fixed row total would be brittle.
  select (case when exists (select 1 from public.vitals_readings      where patient_id = v_patient) then 1 else 0 end)
       + (case when exists (select 1 from public.care_plans           where patient_id = v_patient) then 1 else 0 end)
       + (case when exists (select 1 from public.medications          where patient_id = v_patient) then 1 else 0 end)
       + (case when exists (select 1 from public.screening_schedules  where patient_id = v_patient) then 1 else 0 end)
       + (case when exists (select 1 from public.lab_orders           where patient_id = v_patient) then 1 else 0 end)
       + (case when exists (select 1 from public.patient_risk_scores  where patient_id = v_patient) then 1 else 0 end)
       + (case when exists (select 1 from public.screening_results    where patient_id = v_patient) then 1 else 0 end)
       + (case when exists (select 1 from public.escalations          where patient_id = v_patient) then 1 else 0 end)
       + (case when exists (select 1 from public.clinician_alerts     where patient_id = v_patient) then 1 else 0 end)
       + (case when exists (select 1 from public.lab_analyte_readings where patient_id = v_patient) then 1 else 0 end)
       + (case when exists (select 1 from public.patient_timeline     where patient_id = v_patient) then 1 else 0 end)
    into v_n;
  if v_n <> 11 then
    raise exception 'FAIL: consented sponsor can read % of 11 clinical surfaces', v_n;
  end if;
  raise notice 'PASS  consented sponsor reads all eleven clinical surfaces, results and escalations included';

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_kin, 'role', 'authenticated')::text, true);
  -- lab_analyte_readings and patient_timeline are the two that admitted ANY
  -- grantee before 20260731185243. If either ever returns a row here again, the
  -- consent switch has been made a fiction.
  select (select count(*) from public.vitals_readings      where patient_id = v_patient)
       + (select count(*) from public.medications          where patient_id = v_patient)
       + (select count(*) from public.patient_risk_scores  where patient_id = v_patient)
       + (select count(*) from public.screening_results    where patient_id = v_patient)
       + (select count(*) from public.escalations          where patient_id = v_patient)
       + (select count(*) from public.lab_analyte_readings where patient_id = v_patient)
       + (select count(*) from public.patient_timeline     where patient_id = v_patient)
    into v_n;
  if v_n <> 0 then
    raise exception 'FAIL: an unconsented next of kin sees % clinical row(s)', v_n;
  end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_stranger, 'role', 'authenticated')::text, true);
  select count(*) into v_n from public.vitals_readings where patient_id = v_patient;
  if v_n <> 0 then raise exception 'FAIL: a stranger sees % vitals row(s)', v_n; end if;
  raise notice 'PASS  the gate is the consent, not the grant: kin and stranger still see nothing';

  -- ---- 6. Seeing is not editing ---------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_sponsor, 'role', 'authenticated')::text, true);

  update public.vitals_readings set systolic = 120 where id = v_vital;
  reset role;
  select systolic into v_n from public.vitals_readings where id = v_vital;
  if v_n <> 148 then raise exception 'FAIL: the sponsor edited a reading (systolic now %)', v_n; end if;
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_sponsor, 'role', 'authenticated')::text, true);

  v_sqlstate := null;
  begin
    insert into public.medications (organisation_id, patient_id, drug_name, source)
    values (v_org, v_patient, 'Something the sponsor decided on', 'patient');
  exception when others then
    v_sqlstate := sqlstate;
  end;
  if v_sqlstate is distinct from '42501' then
    raise exception 'FAIL: sponsor medication insert returned %, expected 42501', coalesce(v_sqlstate, 'success');
  end if;
  raise notice 'PASS  the sponsor can read the record and cannot change a single row of it';

  -- ---- 7. One conversation, three voices ------------------------------------
  v_thread := public.start_care_thread(
    'Mum''s blood pressure readings',
    'Her last reading looked high to me. Should she come in?',
    v_patient);

  reset role;
  select author_role::text || '/' || coalesce(author_display, '(none)')
    into v_txt from public.care_messages where thread_id = v_thread;
  if v_txt <> 'sponsor/Daughter Abroad' then
    raise exception 'FAIL: the sponsor''s question is attributed as %, expected sponsor/Daughter Abroad', v_txt;
  end if;
  raise notice 'PASS  the daughter''s question is on the record as hers, by name';

  -- The care team answers once, in the same thread.
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_clinician, 'role', 'authenticated')::text, true);
  select count(*) into v_n from public.care_message_threads where id = v_thread;
  if v_n <> 1 then raise exception 'FAIL: the care team cannot see the thread'; end if;
  perform public.post_care_message(v_thread, 'Thanks — please book a review this week.');

  -- And the patient replies for herself.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  perform public.post_care_message(v_thread, 'I will book it tomorrow.');

  reset role;
  select string_agg(author_role::text, ' -> ' order by created_at)
    into v_txt from public.care_messages where thread_id = v_thread;
  if v_txt <> 'sponsor -> care_team -> patient' then
    raise exception 'FAIL: conversation reads %, expected sponsor -> care_team -> patient', v_txt;
  end if;

  select author_display into v_txt from public.care_messages
   where thread_id = v_thread and author_role = 'care_team';
  if v_txt <> 'Care team' then
    raise exception 'FAIL: care-team attribution is %, expected the null-gated fallback', v_txt;
  end if;
  raise notice 'PASS  one thread, three attributed voices in order, doctor named only when a real record backs it';

  -- All three can read the whole exchange, which is the point of it being one
  -- thread rather than a side channel.
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_sponsor, 'role', 'authenticated')::text, true);
  select count(*) into v_n from public.care_messages where thread_id = v_thread;
  if v_n <> 3 then raise exception 'FAIL: sponsor reads % of 3 messages', v_n; end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_kin, 'role', 'authenticated')::text, true);
  select count(*) into v_n from public.care_messages where thread_id = v_thread;
  if v_n <> 0 then raise exception 'FAIL: an unconsented next of kin reads % message(s)', v_n; end if;
  raise notice 'PASS  everyone consented reads the whole exchange; everyone else reads none of it';

  -- ---- 8. The sponsor cannot end the conversation ---------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_sponsor, 'role', 'authenticated')::text, true);
  update public.care_message_threads set status = 'closed' where id = v_thread;
  reset role;
  select status::text into v_txt from public.care_message_threads where id = v_thread;
  if v_txt <> 'open' then raise exception 'FAIL: the sponsor closed the thread'; end if;
  raise notice 'PASS  the sponsor cannot close a conversation the patient is still having';

  -- ---- 9. Everyone in the room is told, and nobody else ---------------------
  select count(*) into v_n from public.notifications
   where recipient_id = v_patient and template = 'new_care_message' and channel = 'in_app';
  if v_n <> 2 then
    raise exception 'FAIL: patient has % new_care_message notifications, expected 2 (sponsor + care team)', v_n;
  end if;

  select count(*) into v_n from public.notifications
   where recipient_id = v_sponsor and template = 'new_care_message';
  if v_n <> 2 then
    raise exception 'FAIL: sponsor has % notifications, expected 2 (care team + patient, never their own post)', v_n;
  end if;

  select count(*) into v_n from public.notifications where recipient_id = v_kin;
  if v_n <> 0 then raise exception 'FAIL: unconsented kin was notified % time(s)', v_n; end if;

  select count(*) into v_n from public.notifications
   where template = 'new_care_message' and channel <> 'in_app';
  if v_n <> 0 then
    raise exception 'FAIL: % care-message notification(s) left the app', v_n;
  end if;
  raise notice 'PASS  the patient sees every message they did not write, the sponsor is never notified of their own, and none of it leaves the app';

  -- ---- 9b. A child with no login cannot be asked, so 'manage' stands in ------
  -- Without this branch, tightening lab_analyte_readings/patient_timeline would
  -- have silently cut a parent off from their own child's record.
  reset role;
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v_child, 'sponsor-test-child@example.invalid', 'x', now(), '{}', '{}');
  update public.profiles
     set organisation_id = v_org, role = 'patient', full_name = 'Small Child',
         is_dependent_account = true
   where id = v_child;
  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by)
  values (v_child, v_patient, 'manage', v_patient);
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, temperature_c)
  values (v_org, v_child, 'temperature', 38.4);

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  select count(*) into v_n from public.vitals_readings where patient_id = v_child;
  if v_n <> 1 then
    raise exception 'FAIL: a guardian reads % of their own child''s readings', v_n;
  end if;

  -- ...and that standing-in applies ONLY to a dependent account. The kin below
  -- holds no grant on the child at all, so this also proves the join is real.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_kin, 'role', 'authenticated')::text, true);
  select count(*) into v_n from public.vitals_readings where patient_id = v_child;
  if v_n <> 0 then raise exception 'FAIL: an unrelated person reads the child''s record'; end if;
  raise notice 'PASS  a guardian still reads their no-login child, whom nobody could have asked';

  -- ---- 10. Withdrawing consent takes effect immediately ----------------------
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  update public.profile_access set clinical_access = false
   where profile_id = v_patient and grantee_user_id = v_sponsor;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_sponsor, 'role', 'authenticated')::text, true);
  select (select count(*) from public.vitals_readings      where patient_id = v_patient)
       + (select count(*) from public.screening_results     where patient_id = v_patient)
       + (select count(*) from public.escalations           where patient_id = v_patient)
       + (select count(*) from public.lab_analyte_readings  where patient_id = v_patient)
       + (select count(*) from public.patient_timeline      where patient_id = v_patient)
       + (select count(*) from public.care_messages         where thread_id = v_thread)
       + (select count(*) from public.care_message_threads  where id = v_thread)
    into v_n;
  if v_n <> 0 then
    raise exception 'FAIL: a revoked sponsor still reads % row(s)', v_n;
  end if;

  v_sqlstate := null;
  begin
    perform public.post_care_message(v_thread, 'Can I still speak here?');
  exception when others then
    v_sqlstate := sqlstate;
  end;
  if v_sqlstate is distinct from '42501' then
    raise exception 'FAIL: revoked sponsor post returned %, expected 42501', coalesce(v_sqlstate, 'success');
  end if;
  raise notice 'PASS  one click removes them from the record and the conversation together';

  reset role;
  raise notice 'ALL CHECKS PASSED';
end $$;

rollback;
