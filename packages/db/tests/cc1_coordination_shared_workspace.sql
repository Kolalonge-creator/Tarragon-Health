-- Proof: one shared care coordination workspace (migration *_cc1_coordination_shared_workspace.sql, decisions CC-1..CC-4).
--
-- Proves in one rolled-back transaction:
--   1. Who may do coordinator work: a coordinator, an employed Senior Medical Officer and a contracted Chief Medical Officer may; a
--      contracted Senior Medical Officer (partner specialist), a patient and anon may not.
--   2. The widened gates serve the employed doctor and still refuse the contracted one: lab upload organisation, the booking lookup,
--      acting for a patient on the monthly meeting.
--   3. A doctor's phone booking through hold_appointment_slot_by_phone is stamped coordinator_phone with the 30 minute phone hold; the
--      same doctor through the plain door is still 'staff'; the contracted specialist is refused the phone door.
--   4. With no coordinator active, a new outreach task, support request and programme task each go to the doctor, marked auto.
--   5. A hand claim clears the mark; a patient cannot move the assignee of their own support request.
--   6. Once a coordinator is active, the sweep moves the untouched auto items to them and leaves the claimed one; new items go straight
--      to the coordinator; the patient's own coordinator is preferred over a less busy one.
--   7. S16: a coordinator-level task is pushed to the coordinator; with the coordinator inactive it is not.
--   8. Read models: staff see the items in coordination_work_items and recent activity; a patient sees none; the roster lists the
--      patient for their coordinator ('mine') and for a covering doctor ('all'), and nothing for someone who may not coordinate.
--   9. SABOTAGE (automatic): the upload gate restored to coordinators only -> the employed doctor is refused (so 2 proves the change);
--      the routing trigger dropped -> a new outreach task has no assignee (so 4 proves the trigger); the sweep made a no-op -> the
--      auto item stays with the doctor (so 6 proves the sweep).
--
-- Run: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/db/tests/cc1_coordination_shared_workspace.sql
begin;

create temp table results(check_name text, expected text, actual text) on commit drop;
grant all on results to public;

create function pg_temp.rec(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values (p_name, p_expected, p_actual) $$;
create function pg_temp.try(p_sql text) returns text language plpgsql as
$f$ begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $f$;
create function pg_temp.act(p_uid uuid) returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
end $f$;
create function pg_temp.act_anon() returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
end $f$;
create function pg_temp.back() returns void language plpgsql as $f$ begin reset role; perform set_config('request.jwt.claims', '', true); end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text, p_dob date) returns uuid language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'cc1-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test, sex)
  values (v, p_org, p_role::public.user_role, 'CC1 ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), p_dob, true, 'female')
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, is_test = true, is_active = true,
    phone = excluded.phone, date_of_birth = excluded.date_of_birth, full_name = excluded.full_name, sex = excluded.sex;
  return v;
end $f$;
create function pg_temp.mkstaff(p_org uuid, p_uid uuid, p_admin uuid, p_tier text, p_employment text, p_active boolean) returns uuid
language plpgsql as $f$
declare v uuid;
begin
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, license_expires_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt,
      indemnity_exempt_by, languages, specialty, credential_verified_at, credential_verified_by, is_test)
  values (p_org, p_uid, 'CC1 ' || p_tier, 'MDCN', 'CC1-' || left(p_uid::text, 8), p_active, 'active',
      now() - interval '10 days', now() + interval '1 year', p_admin, p_tier::public.doctor_tier, p_employment::public.staff_employment_type,
      2, true, p_admin, array['en'], 'General practice', now() - interval '5 days', p_admin, true)
  returning id into v;
  return v;
end $f$;
create function pg_temp.open_time(p_clin uuid, p_start timestamptz) returns void language plpgsql as
$f$ declare v_org uuid;
begin
  select organisation_id into v_org from public.profiles where id = p_clin;
  insert into public.availability_blocks (organisation_id, clinician_id, starts_at, ends_at, kind, state, is_test)
  values (v_org, p_clin, p_start, p_start + interval '2 hours', 'bookable_consultations', 'confirmed', true);
end $f$;

do $$
declare
  v_org uuid; v_admin uuid;
  v_coord uuid; v_coord2 uuid; v_doc uuid; v_spec uuid; v_cmo uuid; v_pt uuid; v_pt2 uuid;
  v_coord_staff uuid; v_coord2_staff uuid; v_doc_staff uuid; v_doc2 uuid; v_doc2_staff uuid; v_out4 uuid; v_out5 uuid;
  v_out1 uuid; v_out2 uuid; v_out3 uuid; v_nav uuid; v_prog uuid; v_occ uuid := gen_random_uuid(); v_task uuid;
  v_start timestamptz := date_trunc('hour', now()) + interval '3 days' + interval '9 hours';
  v_appt public.appointments%rowtype;
  v_type text; v_comp text;
  v_n integer; v_txt text;
begin
  select organisation_id into v_org from public.profiles where organisation_id is not null group by organisation_id order by count(*) desc limit 1;
  if v_org is null then raise exception 'SETUP: need an organisation'; end if;

  -- Only this proof's people can be picked: every other staff row in the organisation is switched off for the transaction.
  update public.clinical_staff set active = false where organisation_id = v_org;

  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin', date '1975-01-01');
  v_coord := pg_temp.mkuser(v_org, 'coordinator', 'care_coordinator', date '1990-01-01');
  v_coord2 := pg_temp.mkuser(v_org, 'coordinator-two', 'care_coordinator', date '1991-01-01');
  v_doc := pg_temp.mkuser(v_org, 'doctor', 'clinician', date '1980-01-01');
  v_spec := pg_temp.mkuser(v_org, 'specialist', 'clinician', date '1978-01-01');
  v_cmo := pg_temp.mkuser(v_org, 'cmo', 'clinician', date '1970-01-01');
  v_pt := pg_temp.mkuser(v_org, 'patient', 'patient', date '1960-01-01');
  v_pt2 := pg_temp.mkuser(v_org, 'patient-two', 'patient', date '1962-01-01');
  update public.profiles set state = 'Lagos', receives_care = true where id in (v_pt, v_pt2);
  insert into public.patient_memberships (organisation_id, patient_id, source, state, is_test) values (v_org, v_pt, 'purchase', 'active', true);

  perform pg_temp.mkstaff(v_org, v_doc, v_admin, 'senior_medical_officer', 'employed', true);
  perform pg_temp.mkstaff(v_org, v_spec, v_admin, 'senior_medical_officer', 'contracted', true);
  perform pg_temp.mkstaff(v_org, v_cmo, v_admin, 'chief_medical_officer', 'contracted', true);
  v_coord_staff := pg_temp.mkstaff(v_org, v_coord, v_admin, 'care_coordinator', 'employed', false);
  v_coord2_staff := pg_temp.mkstaff(v_org, v_coord2, v_admin, 'care_coordinator', 'employed', false);
  -- the CMO is made too busy to be the least-loaded pick only by being contracted (care_gap_pick_doctor takes employed doctors)

  -- ===== 1. who may coordinate =====
  perform pg_temp.act(v_coord);  perform pg_temp.rec('1 coordinator may coordinate', 'true', private.is_coordination_actor()::text); perform pg_temp.back();
  perform pg_temp.act(v_doc);    perform pg_temp.rec('1 employed SMO may coordinate', 'true', private.is_coordination_actor()::text); perform pg_temp.back();
  perform pg_temp.act(v_cmo);    perform pg_temp.rec('1 contracted CMO may coordinate', 'true', private.is_coordination_actor()::text); perform pg_temp.back();
  perform pg_temp.act(v_spec);   perform pg_temp.rec('1 contracted SMO (partner specialist) may not', 'false', private.is_coordination_actor()::text); perform pg_temp.back();
  perform pg_temp.act(v_pt);     perform pg_temp.rec('1 patient may not', 'false', private.is_coordination_actor()::text); perform pg_temp.back();
  perform pg_temp.act(v_doc);    perform pg_temp.rec('1 wrong organisation is no', 'false', private.is_coordination_actor(gen_random_uuid())::text); perform pg_temp.back();
  perform pg_temp.act_anon();    perform pg_temp.rec('1 anon cannot call it (42501)', '42501', pg_temp.try('select private.is_coordination_actor()')); perform pg_temp.back();

  -- ===== 2. the widened gates =====
  perform pg_temp.act(v_doc);
  perform pg_temp.rec('2 employed doctor gets an upload organisation', v_org::text, private.cde_uploader_org()::text);
  perform pg_temp.rec('2 employed doctor can use the booking lookup', 'ok', pg_temp.try('select * from public.coordinator_find_patient(''CC1 patient'')'));
  perform pg_temp.rec('2 the lookup finds the patient', '1', (select count(*)::text from public.coordinator_find_patient('CC1 patient') where patient_id = v_pt));
  perform pg_temp.rec('2 employed doctor may act for the patient on the monthly meeting', 'true', private.is_care_coordinator_for(v_pt)::text);
  perform pg_temp.back();
  perform pg_temp.act(v_spec);
  perform pg_temp.rec('2 partner specialist gets no upload organisation', 'null', coalesce(private.cde_uploader_org()::text, 'null'));
  perform pg_temp.rec('2 partner specialist is refused the lookup (42501)', '42501', pg_temp.try('select * from public.coordinator_find_patient(''CC1 patient'')'));
  perform pg_temp.rec('2 partner specialist may not act for the patient', 'false', private.is_care_coordinator_for(v_pt)::text);
  perform pg_temp.back();
  perform pg_temp.act(v_coord);
  perform pg_temp.rec('2 coordinator keeps the upload organisation', v_org::text, private.cde_uploader_org()::text);
  perform pg_temp.back();

  -- ===== 3. phone booking by a doctor =====
  perform pg_temp.open_time(v_doc, v_start);
  perform pg_temp.open_time(v_doc, v_start + interval '1 day');
  perform pg_temp.act(v_doc);
  select * into v_appt from public.hold_appointment_slot_by_phone(v_org, v_doc, 'telemedicine'::public.appointment_type, 'telemedicine',
         v_start, v_start + interval '30 minutes', v_pt);
  perform pg_temp.back();
  perform pg_temp.rec('3 doctor phone booking is stamped coordinator_phone', 'coordinator_phone', v_appt.booked_via);
  perform pg_temp.rec('3 doctor phone booking holds at least 30 minutes', 'true', (v_appt.hold_expires_at >= now() + interval '29 minutes')::text);
  perform pg_temp.act(v_doc);
  select * into v_appt from public.hold_appointment_slot(v_org, v_doc, 'telemedicine'::public.appointment_type, 'telemedicine',
         v_start + interval '1 day', v_start + interval '1 day 30 minutes', null, null, null, null, null, v_pt);
  perform pg_temp.back();
  perform pg_temp.rec('3 the plain door still stamps staff', 'staff', v_appt.booked_via);
  perform pg_temp.rec('3 the flag does not outlive the call', 'off', coalesce(nullif(current_setting('tarragon.phone_booking', true), ''), 'off'));
  perform pg_temp.act(v_spec);
  perform pg_temp.rec('3 partner specialist is refused the phone door (42501)', '42501',
    pg_temp.try(format('select public.hold_appointment_slot_by_phone(%L, %L, ''telemedicine'', ''telemedicine'', %L, %L, %L)',
                       v_org, v_doc, v_start + interval '2 days', v_start + interval '2 days 30 minutes', v_pt)));
  perform pg_temp.back();
  perform pg_temp.act(v_doc);
  perform pg_temp.rec('3 a phone booking for yourself is refused (22023)', '22023',
    pg_temp.try(format('select public.hold_appointment_slot_by_phone(%L, %L, ''telemedicine'', ''telemedicine'', %L, %L, %L)',
                       v_org, v_doc, v_start + interval '2 days', v_start + interval '2 days 30 minutes', v_doc)));
  perform pg_temp.back();

  -- ===== 4. no coordinator active: work goes to the doctor =====
  insert into public.care_outreach_tasks (organisation_id, patient_id, trigger_type, priority, status)
  values (v_org, v_pt, 'stale_monitoring', 2, 'open') returning id into v_out1;
  insert into public.care_outreach_tasks (organisation_id, patient_id, trigger_type, priority, status)
  values (v_org, v_pt2, 'overdue_screening', 3, 'open') returning id into v_out2;
  perform pg_temp.rec('4 outreach task goes to the doctor', v_doc::text, (select assigned_to::text from public.care_outreach_tasks where id = v_out1));
  perform pg_temp.rec('4 outreach task is marked auto', 'true', (select auto_assigned::text from public.care_outreach_tasks where id = v_out1));
  perform pg_temp.act(v_pt);
  insert into public.navigation_requests (organisation_id, patient_id, category, description)
  values (v_org, v_pt, 'appointment', 'CC1 please help me book') returning id into v_nav;
  perform pg_temp.back();
  perform pg_temp.rec('4 support request goes to the doctor', v_doc::text, (select assigned_to::text from public.navigation_requests where id = v_nav));
  perform pg_temp.rec('4 support request is marked auto', 'true', (select auto_assigned::text from public.navigation_requests where id = v_nav));
  execute 'alter table public.chronic_programme_coordinator_tasks drop constraint chronic_programme_coordinator_tasks_occurrence_id_fkey';
  insert into public.chronic_programme_coordinator_tasks (organisation_id, patient_id, occurrence_id, task_type)
  values (v_org, v_pt, v_occ, 'missed_lab_panel') returning id into v_prog;
  perform pg_temp.rec('4 programme task goes to the doctor', v_doc::text, (select assigned_to::text from public.chronic_programme_coordinator_tasks where id = v_prog));
  insert into public.care_outreach_tasks (organisation_id, patient_id, trigger_type, priority, status, assigned_to)
  values (v_org, v_pt2, 'missed_appointment', 2, 'open', v_cmo) returning id into v_out3;
  perform pg_temp.rec('4 an explicit assignee is kept and not marked auto', v_cmo::text || '/false',
    (select assigned_to::text || '/' || auto_assigned::text from public.care_outreach_tasks where id = v_out3));

  -- ===== 4b. load is balanced on coordination work, not only gaps and queue tasks =====
  -- v_doc already holds several coordination items and no gaps or queue tasks; a second, idle doctor must get the next one.
  v_doc2 := pg_temp.mkuser(v_org, 'doctor-two', 'clinician', date '1982-01-01');
  v_doc2_staff := pg_temp.mkstaff(v_org, v_doc2, v_admin, 'senior_medical_officer', 'employed', true);
  insert into public.care_outreach_tasks (organisation_id, patient_id, trigger_type, priority, status)
  values (v_org, v_pt2, 'consultation_follow_up', 2, 'open') returning id into v_out4;
  perform pg_temp.rec('4b the next item goes to the idle doctor, not the one holding the coordination work', v_doc2::text,
    (select assigned_to::text from public.care_outreach_tasks where id = v_out4));
  update public.clinical_staff set active = false where id = v_doc2_staff;

  -- ===== 4c. an item that arrives when nobody can take it is routed later =====
  select id into v_doc_staff from public.clinical_staff where profile_id = v_doc;
  update public.clinical_staff set active = false where id = v_doc_staff;
  insert into public.care_outreach_tasks (organisation_id, patient_id, trigger_type, priority, status)
  values (v_org, v_pt2, 'failed_referral', 2, 'open') returning id into v_out5;
  perform pg_temp.rec('4c with no eligible doctor or coordinator the item arrives with no owner', 'null',
    coalesce((select assigned_to::text from public.care_outreach_tasks where id = v_out5), 'null'));
  update public.clinical_staff set active = true where id = v_doc_staff;
  perform private.coordination_handover_sweep();
  perform pg_temp.rec('4c the sweep gives it an owner once one is available', v_doc::text || '/true',
    (select assigned_to::text || '/' || auto_assigned::text from public.care_outreach_tasks where id = v_out5));

  -- ===== 5. claims and patients =====
  perform pg_temp.act(v_cmo);
  update public.care_outreach_tasks set assigned_to = v_cmo where id = v_out2;
  perform pg_temp.back();
  perform pg_temp.rec('5 a hand claim clears the auto mark', v_cmo::text || '/false',
    (select assigned_to::text || '/' || auto_assigned::text from public.care_outreach_tasks where id = v_out2));
  perform pg_temp.act(v_doc);
  update public.care_outreach_tasks set auto_assigned = true where id = v_out2;
  perform pg_temp.back();
  perform pg_temp.rec('5 staff cannot set the auto mark themselves', 'false', (select auto_assigned::text from public.care_outreach_tasks where id = v_out2));
  perform pg_temp.act(v_pt);
  update public.navigation_requests set assigned_to = v_pt, auto_assigned = false where id = v_nav;
  perform pg_temp.back();
  perform pg_temp.rec('5 a patient cannot move their request''s assignee', v_doc::text || '/true',
    (select assigned_to::text || '/' || auto_assigned::text from public.navigation_requests where id = v_nav));

  -- ===== 6. a coordinator arrives =====
  update public.clinical_staff set active = true where id = v_coord_staff;
  -- at least this proof's four auto items (outreach x2, support, programme); other rows in a shared database may move too
  perform pg_temp.rec('6 the sweep moves this proof''s untouched items', 'true', (private.coordination_handover_sweep() >= 4)::text);
  perform pg_temp.rec('6 the 4c item moved to the coordinator too', v_coord::text, (select assigned_to::text from public.care_outreach_tasks where id = v_out5));
  perform pg_temp.rec('6 outreach task moved to the coordinator', v_coord::text, (select assigned_to::text from public.care_outreach_tasks where id = v_out1));
  perform pg_temp.rec('6 and stays marked auto', 'true', (select auto_assigned::text from public.care_outreach_tasks where id = v_out1));
  perform pg_temp.rec('6 support request moved to the coordinator', v_coord::text, (select assigned_to::text from public.navigation_requests where id = v_nav));
  perform pg_temp.rec('6 programme task moved to the coordinator', v_coord::text, (select assigned_to::text from public.chronic_programme_coordinator_tasks where id = v_prog));
  perform pg_temp.rec('6 the hand-claimed task stays with the CMO', v_cmo::text, (select assigned_to::text from public.care_outreach_tasks where id = v_out2));
  perform pg_temp.rec('6 a second sweep moves nothing', '0', private.coordination_handover_sweep()::text);
  insert into public.care_outreach_tasks (organisation_id, patient_id, trigger_type, priority, status)
  values (v_org, v_pt2, 'engagement_decline', 2, 'open') returning id into v_out3;
  perform pg_temp.rec('6 a new task goes straight to the coordinator', v_coord::text, (select assigned_to::text from public.care_outreach_tasks where id = v_out3));
  -- the patient's own coordinator wins over a less busy one
  update public.clinical_staff set active = true where id = v_coord2_staff;
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id, care_coordinator_id, assigned_at)
  values (v_org, v_pt, v_doc, v_coord, now())
  on conflict (patient_id) do update set clinician_id = excluded.clinician_id, care_coordinator_id = excluded.care_coordinator_id;
  perform pg_temp.rec('6 the patient''s own coordinator is preferred', v_coord::text, private.pick_coordination_owner(v_org, v_pt)::text);
  perform pg_temp.rec('6 a patient with no coordinator goes to the less busy one', v_coord2::text, private.pick_coordination_owner(v_org, v_pt2)::text);
  -- one rule for "active coordinator": a staff row alone is not enough once the account is no longer a coordinator
  update public.profiles set role = 'patient' where id = v_coord2;
  perform pg_temp.rec('6 a staff row whose account is no longer a coordinator is not picked', v_coord::text, private.pick_coordination_owner(v_org, v_pt2)::text);
  update public.profiles set role = 'care_coordinator' where id = v_coord2;
  update public.clinical_staff set active = false where id = v_coord2_staff;

  -- ===== 7. S16 queue: coordinator first =====
  select code into v_type from public.task_types where is_active and creatable and pushable and min_doctor_tier = 'care_coordinator'
     and priority_class > 1 and lead_window_minutes > 0 order by code limit 1;
  if v_type is null then raise exception 'SETUP: no pushable coordinator-level task type'; end if;
  for v_comp in select unnest(required_competencies) from public.task_types where code = v_type and is_active loop
    insert into public.clinician_competencies (organisation_id, clinical_staff_id, competency_code, granted_by, is_test)
    values (v_org, v_coord_staff, v_comp, v_admin, true) on conflict do nothing;
  end loop;
  v_task := private.create_clinical_task(v_pt2, v_type, null, 'cc1-proof-' || gen_random_uuid());
  perform pg_temp.rec('7 a coordinator-level queue task is pushed to the coordinator (' || v_type || ')', v_coord::text,
    (select pushed_to::text from public.clinical_tasks where id = v_task));
  update public.clinical_staff set active = false where id = v_coord_staff;
  v_task := private.create_clinical_task(v_pt2, v_type, null, 'cc1-proof-' || gen_random_uuid());
  perform pg_temp.rec('7 with no coordinator it is not pushed to one', 'false',
    (select (pushed_to is not distinct from v_coord)::text from public.clinical_tasks where id = v_task));
  update public.clinical_staff set active = true where id = v_coord_staff;

  -- ===== 8. read models =====
  perform pg_temp.act(v_coord);
  insert into public.care_outreach_contacts (organisation_id, patient_id, task_id, channel, note, contacted_by)
  values (v_org, v_pt, v_out1, 'call', 'CC1 called', v_coord);
  perform pg_temp.rec('8 the coordinator sees the outreach task in the worklist', '1',
    (select count(*)::text from public.coordination_work_items where item_id = v_out1 and source = 'outreach' and assigned_to = v_coord));
  perform pg_temp.rec('8 the coordinator sees the support request', '1',
    (select count(*)::text from public.coordination_work_items where item_id = v_nav and source = 'support'));
  perform pg_temp.rec('8 the coordinator sees the programme task', '1',
    (select count(*)::text from public.coordination_work_items where item_id = v_prog and source = 'programme'));
  perform pg_temp.rec('8 the worklist carries the patient name', 'CC1 patient',
    (select patient_name from public.coordination_work_items where item_id = v_out1));
  perform pg_temp.rec('8 recent activity shows the call', '1',
    (select count(*)::text from public.coordination_recent_activity where patient_id = v_pt and kind = 'contact_logged'));
  perform pg_temp.rec('8 the roster (mine) lists the patient', '1', (select count(*)::text from public.coordination_patient_roster('mine') where patient_id = v_pt));
  perform pg_temp.rec('8 the roster counts the patient''s open items', 'true',
    (select (open_items >= 3)::text from public.coordination_patient_roster('mine') where patient_id = v_pt));
  perform pg_temp.rec('8 the roster shows the last contact', 'true',
    (select (last_contact_at is not null)::text from public.coordination_patient_roster('mine') where patient_id = v_pt));
  perform pg_temp.back();
  perform pg_temp.act(v_doc);
  perform pg_temp.rec('8 a covering doctor sees everyone with scope all', '1', (select count(*)::text from public.coordination_patient_roster('all') where patient_id = v_pt2));
  perform pg_temp.back();
  perform pg_temp.act(v_pt);
  perform pg_temp.rec('8 a patient sees no worklist rows (not even their own request)', '0', (select count(*)::text from public.coordination_work_items));
  perform pg_temp.rec('8 a patient sees no activity', '0', (select count(*)::text from public.coordination_recent_activity));
  perform pg_temp.rec('8 a patient gets no roster', '0', (select count(*)::text from public.coordination_patient_roster('all')));
  perform pg_temp.back();
  perform pg_temp.act(v_spec);
  perform pg_temp.rec('8 a partner specialist gets no roster', '0', (select count(*)::text from public.coordination_patient_roster('all')));
  perform pg_temp.back();
  perform pg_temp.act_anon();
  perform pg_temp.rec('8 anon cannot read the worklist (42501)', '42501', pg_temp.try('select 1 from public.coordination_work_items'));
  perform pg_temp.back();

  -- ===== 9. SABOTAGE =====
  -- (a) the upload gate back to coordinators only
  execute $s$ create or replace function private.cde_uploader_org() returns uuid language sql stable security definer set search_path = '' as $b$
              select organisation_id from public.profiles where id = (select auth.uid()) and is_active and role in ('care_coordinator', 'lab_liaison') and organisation_id is not null $b$ $s$;
  perform pg_temp.act(v_doc);
  perform pg_temp.rec('9 SABOTAGE old upload gate: the employed doctor is refused (so 2 proves the change)', 'null', coalesce(private.cde_uploader_org()::text, 'null'));
  perform pg_temp.back();
  -- (b) the sweep does nothing: an auto item stays with the doctor
  update public.clinical_staff set active = false where id = v_coord_staff;
  insert into public.care_outreach_tasks (organisation_id, patient_id, trigger_type, priority, status)
  values (v_org, v_pt2, 'missed_care_task', 2, 'open') returning id into v_out3;
  update public.clinical_staff set active = true where id = v_coord_staff;
  execute $s$ create or replace function private.coordination_handover_sweep() returns integer language sql security definer set search_path = '' as $b$ select 0 $b$ $s$;
  perform private.coordination_handover_sweep();
  perform pg_temp.rec('9 SABOTAGE no-op sweep: the auto item stays with the doctor (so 6 proves the sweep)', v_doc::text,
    (select assigned_to::text from public.care_outreach_tasks where id = v_out3));
  -- (c) the routing trigger dropped: a new task has no assignee
  execute 'drop trigger zz_coordination_route on public.care_outreach_tasks';
  insert into public.care_outreach_tasks (organisation_id, patient_id, trigger_type, priority, status)
  values (v_org, v_pt2, 'repeated_no_show', 2, 'open') returning id into v_out3;
  perform pg_temp.rec('9 SABOTAGE no routing trigger: the new task has no assignee (so 4 proves the trigger)', 'null',
    coalesce((select assigned_to::text from public.care_outreach_tasks where id = v_out3), 'null'));

  -- ===== verdict =====
  if exists (select 1 from results where expected is distinct from actual) then
    raise exception 'cc1 coordination workspace proof FAILED: %', (select string_agg(check_name || ' (expected ' || expected || ', got ' || coalesce(actual, 'null') || ')', E'\n') from results where expected is distinct from actual);
  end if;
  raise notice 'cc1 coordination workspace: % checks PASSED', (select count(*) from results);
end $$;

select check_name, expected, actual, case when expected is not distinct from actual then 'PASS' else 'FAIL' end as verdict from results order by 1;

rollback;
