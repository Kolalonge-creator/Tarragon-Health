-- S76 gap closure proof (spec 23.2 / 23.3 / silence-as-signal / blast-radius preview), all dark.
--   1. Config: only the CMO signs; a bare update cannot activate or edit; born unsigned and inactive. With NO signed config every sweep skips.
--   2. Re-offer: an unclaimed aged task goes to a DIFFERENT clinician than the one who held it (never the first, never one on leave, never the
--      patient); not before its class minutes; at most reoffer_max times; red (class 1) never; nobody available is recorded and audited, never
--      silent; a real (non-test) patient is untouched while the guard is off; task state and the CMO escalation path are not changed.
--   3. Reads: the offeree and the CMO read the row, another clinician, a patient and anon read nothing; queue_my_reoffers lists only mine.
--   4. Silence: an enrolled patient who was recording and went quiet gets ONE amber (class 5) task; a recent recorder, a never-active patient, a
--      newly enrolled patient and a real patient with the guard off get none; the patient is never contacted (no notification); the sweep refuses
--      to run if the task type were ever above amber.
--   5. Device fault producer: a fault report from a test patient creates the task; a real patient with the guard off does not.
--   6. Blast radius: CMO/admin only, anon refused, aggregate counts when the cell is big enough, SUPPRESSED when a cell is small, test accounts
--      excluded by default, no patient id in the answer, audited.
--   SABOTAGE: (a) the previous-clinician exclusion removed, (b) the amber ceiling removed, (c) suppress_cell made permissive, (d) the read policy
--   opened; each must flip a check.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;
create function pg_temp.f(p text) returns uuid language sql as $$ select v from fx where k = p $$;
create function pg_temp.setf(p text, p_v uuid) returns void language sql as
$$ insert into fx values (p, p_v) on conflict (k) do update set v = excluded.v $$;
create function pg_temp.act(p_uid uuid) returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
end $f$;
create function pg_temp.back() returns void language plpgsql as
$f$ begin reset role; perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.role', '', true); end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's76g-' || p_label || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, is_test)
  values (v, p_org, p_role::public.user_role, 'S76g ' || p_label, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true;
  return v;
end $f$;
create function pg_temp.mkdoc(p_org uuid, p_label text, p_admin uuid, p_tier text) returns uuid
language plpgsql as $f$
declare v uuid;
begin
  v := pg_temp.mkuser(p_org, p_label, 'clinician');
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
  values (p_org, v, 'S76g ' || p_label, 'MDCN', 'S76G-' || p_label || '-' || substr(v::text, 1, 8), true, 'active', now(), p_admin,
      p_tier::public.doctor_tier, 'contracted', 2, true, p_admin, true);
  -- a contracted clinician is only offered work inside a declared availability block (S18, OQ-112)
  insert into public.availability_blocks (organisation_id, clinician_id, starts_at, ends_at, kind, is_test)
    values (p_org, v, now() - interval '1 minute', now() + interval '2 hours', 'queue', true);
  return v;
end $f$;
create function pg_temp.sql_as(p_uid uuid, p_sql text) returns text language plpgsql as $f$
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql; exception when others then perform pg_temp.back(); return 'ERR:' || sqlstate; end;
  perform pg_temp.back();
  return 'ok';
end $f$;
create function pg_temp.sql_anon(p_sql text) returns text language plpgsql as $f$
begin
  set local role anon;
  begin execute p_sql; exception when others then reset role; return 'ERR:' || sqlstate; end;
  reset role;
  return 'ok';
end $f$;
create function pg_temp.count_as(p_uid uuid, p_sql text) returns text language plpgsql as $f$
declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql into r; exception when others then perform pg_temp.back(); return 'ERR:' || sqlstate; end;
  perform pg_temp.back();
  return r;
end $f$;
-- a task made old: created_at moved back (the task-transition flag is the layer's own door for owner-level writes)
create function pg_temp.age_task(p_task uuid, p_minutes integer) returns void language plpgsql as $f$
begin
  perform set_config('tarragon.task_transition', 'on', true);
  update public.clinical_tasks set created_at = now() - make_interval(mins => p_minutes) where id = p_task;
  perform set_config('tarragon.task_transition', 'off', true);
end $f$;
create function pg_temp.hold(p_task uuid, p_who uuid) returns void language plpgsql as $f$
begin
  perform set_config('tarragon.task_transition', 'on', true);
  update public.clinical_tasks set lead_clinician_id = p_who, pushed_to = p_who where id = p_task;
  perform set_config('tarragon.task_transition', 'off', true);
end $f$;
create function pg_temp.reoffers(p_task uuid, p_outcome text) returns text language sql as
$$ select count(*)::text from public.clinical_task_reoffers where task_id = p_task and outcome = p_outcome $$;

do $$
declare
  v_org uuid; v_admin uuid; v_a uuid; v_b uuid; v_c uuid; v_cmo uuid; v_pat uuid; v_real uuid; v_prog uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  select id into v_prog from public.chronic_condition_programmes limit 1;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  v_a := pg_temp.mkdoc(v_org, 'a', v_admin, 'senior_medical_officer');
  v_b := pg_temp.mkdoc(v_org, 'b', v_admin, 'senior_medical_officer');
  v_c := pg_temp.mkdoc(v_org, 'c', v_admin, 'senior_medical_officer');
  v_cmo := pg_temp.mkdoc(v_org, 'cmo', v_admin, 'chief_medical_officer');
  v_pat := pg_temp.mkuser(v_org, 'pat', 'patient');
  v_real := pg_temp.mkuser(v_org, 'real', 'patient');
  update public.profiles set is_test = false where id = v_real;
  -- c is on leave now
  insert into public.provider_time_off (organisation_id, clinician_id, kind, starts_at, ends_at, reason)
    values (v_org, v_c, 'leave', now() - interval '1 day', now() + interval '5 days', 's76g proof');
  perform pg_temp.setf('org', v_org); perform pg_temp.setf('admin', v_admin); perform pg_temp.setf('a', v_a); perform pg_temp.setf('b', v_b);
  perform pg_temp.setf('c', v_c); perform pg_temp.setf('cmo', v_cmo); perform pg_temp.setf('pat', v_pat); perform pg_temp.setf('real', v_real);
  perform pg_temp.setf('prog', v_prog);
  update public.chronic_condition_programmes set is_active = true where id = v_prog;  -- a fresh replay has the pathway closed; this rolls back
end $$;

-- 1. config ---------------------------------------------------------------------------------------------------------------------------
insert into results values ('real', 'v1 is born inactive and unsigned', 'false|false',
  (select is_active::text || '|' || (signed_by is not null)::text from public.clinician_loop_config where version = 1));
insert into results values ('real', 'no signed config: re-offer skips', 'no signed config', (select private.reoffer_unacknowledged_tasks() ->> 'skipped'));
insert into results values ('real', 'no signed config: silence skips', 'no signed config', (select private.sweep_reading_silence() ->> 'skipped'));
insert into results values ('real', 'a non-CMO cannot sign', 'ERR:42501',
  pg_temp.sql_as(pg_temp.f('a'), $q$select public.sign_clinician_loop_config(1, 'checked the times in the pack')$q$));
insert into results values ('real', 'anon cannot sign', 'ERR:42501', pg_temp.sql_anon($q$select public.sign_clinician_loop_config(1, 'checked the times in the pack')$q$));
do $$
declare r text;
begin
  begin update public.clinician_loop_config set is_active = true where version = 1; r := 'ok'; exception when others then r := 'ERR:' || sqlstate; end;
  insert into results values ('real', 'a bare update cannot activate a version', 'ERR:42501', r);
  begin update public.clinician_loop_config set rules = '{}'::jsonb where version = 1; r := 'ok'; exception when others then r := 'ERR:' || sqlstate; end;
  insert into results values ('real', 'a version cannot be edited', 'ERR:42501', r);
end $$;

-- the blast-radius preview works on the PROPOSED row before any signing, so it is checked here too (see section 6); first set up tasks.

-- fixtures for the re-offer: tasks of the layer's own admin_clinical type (class 9, no competency), created through the real function
do $$
declare t1 uuid; t2 uuid; t3 uuid; t4 uuid; t5 uuid; t6 uuid;
begin
  t1 := private.create_clinical_task(pg_temp.f('pat'), 'admin_clinical', null, null);
  perform pg_temp.hold(t1, pg_temp.f('a'));
  perform pg_temp.age_task(t1, 2000);
  perform pg_temp.setf('t_aged', t1);
  -- a fresh one (not old enough)
  t2 := private.create_clinical_task(pg_temp.f('pat'), 'admin_clinical', null, 'fresh');
  perform pg_temp.hold(t2, pg_temp.f('a'));
  perform pg_temp.setf('t_fresh', t2);
  -- red
  t3 := private.create_clinical_task(pg_temp.f('pat'), 'red_event_unacknowledged', null, null);
  perform pg_temp.age_task(t3, 5000);
  perform pg_temp.setf('t_red', t3);
  -- nobody has this competency
  t4 := private.create_clinical_task(pg_temp.f('pat'), 'admin_clinical', null, 'nobody', null, null, null, array['paediatrics']);
  perform pg_temp.age_task(t4, 2000);
  perform pg_temp.setf('t_none', t4);
  -- a real patient's task
  t5 := private.create_clinical_task(pg_temp.f('real'), 'admin_clinical', null, null);
  perform pg_temp.age_task(t5, 2000);
  perform pg_temp.setf('t_real', t5);
end $$;

-- sign (as the CMO) and run with guards still OFF: only test patients are touched
do $$
declare r text;
begin
  r := pg_temp.sql_as(pg_temp.f('cmo'), $q$select public.sign_clinician_loop_config(1, 'checked the times in the pack')$q$);
  insert into results values ('real', 'the CMO signs v1', 'ok', r);
  insert into results values ('real', 'a signed version cannot be signed again', 'ERR:22023',
    pg_temp.sql_as(pg_temp.f('cmo'), $q$select public.sign_clinician_loop_config(1, 'checked the times in the pack')$q$));
  insert into results values ('real', 'v1 is now active with a signer', 'true',
    (select (is_active and signed_by = pg_temp.f('cmo'))::text from public.clinician_loop_config where version = 1));
end $$;

-- 2. re-offer ----------------------------------------------------------------------------------------------------------------------------
select private.reoffer_unacknowledged_tasks();
insert into results values ('real', 'aged task: offered once', '1', pg_temp.reoffers(pg_temp.f('t_aged'), 'offered'));
insert into results values ('real', 'aged task: offered to a different clinician, not the holder, not the one on leave, not the patient', 'true',
  (select (offered_to is distinct from pg_temp.f('a') and offered_to is distinct from pg_temp.f('c') and offered_to is distinct from pg_temp.f('pat')
           and offered_to in (pg_temp.f('b'), pg_temp.f('cmo')) and pg_temp.f('a') = any (previous_ids))::text
     from public.clinical_task_reoffers where task_id = pg_temp.f('t_aged') and outcome = 'offered'));
insert into results values ('real', 'a fresh task is not re-offered', '0', pg_temp.reoffers(pg_temp.f('t_fresh'), 'offered'));
insert into results values ('real', 'a red task is never re-offered', '0',
  (select count(*)::text from public.clinical_task_reoffers where task_id = pg_temp.f('t_red')));
insert into results values ('real', 'nobody qualified: recorded as no_second_clinician, not offered', '1|0',
  pg_temp.reoffers(pg_temp.f('t_none'), 'no_second_clinician') || '|' || pg_temp.reoffers(pg_temp.f('t_none'), 'offered'));
insert into results values ('real', 'nobody qualified: audited', '1',
  (select count(*)::text from public.audit_log where action = 'clinical_task.reoffer_no_candidate' and entity_id = pg_temp.f('t_none')));
insert into results values ('real', 'a real patient task is untouched while the guard is off', '0',
  (select count(*)::text from public.clinical_task_reoffers where task_id = pg_temp.f('t_real')));
insert into results values ('real', 'the re-offer did not change the task state', 'offered_to_lead',
  (select state::text from public.clinical_tasks where id = pg_temp.f('t_aged')) );
select private.reoffer_unacknowledged_tasks();
insert into results values ('real', 'a second sweep does not re-offer again (reoffer_max)', '1', pg_temp.reoffers(pg_temp.f('t_aged'), 'offered'));
insert into results values ('real', 'the offeree was told in-app', '1',
  (select count(*)::text from public.notifications n join public.clinical_task_reoffers ro on ro.offered_to = n.recipient_id and n.source_id = ro.task_id
    where ro.task_id = pg_temp.f('t_aged') and ro.outcome = 'offered' and n.channel = 'in_app'));
insert into results values ('real', 'sweep_clinical_tasks (promotion and CMO escalation) is untouched by this work', 'false',
  (select (pg_get_functiondef('private.sweep_clinical_tasks()'::regprocedure) ilike '%reoffer%')::text));

-- 3. reads
select pg_temp.setf('offeree', offered_to) from public.clinical_task_reoffers where task_id = pg_temp.f('t_aged') and outcome = 'offered';
insert into results values ('real', 'the offeree reads their row', '1',
  pg_temp.count_as(pg_temp.f('offeree'), format($q$select count(*)::text from public.clinical_task_reoffers where task_id = %L$q$, pg_temp.f('t_aged'))));
insert into results values ('real', 'the holder reads nothing', '0',
  pg_temp.count_as(pg_temp.f('a'), format($q$select count(*)::text from public.clinical_task_reoffers where task_id = %L$q$, pg_temp.f('t_aged'))));
insert into results values ('real', 'a patient reads nothing', '0',
  pg_temp.count_as(pg_temp.f('pat'), format($q$select count(*)::text from public.clinical_task_reoffers where task_id = %L$q$, pg_temp.f('t_aged'))));
insert into results values ('real', 'anon cannot read', 'ERR:42501', pg_temp.sql_anon($q$select count(*) from public.clinical_task_reoffers$q$));
insert into results values ('real', 'nobody writes the table directly', 'ERR:42501',
  pg_temp.sql_as(pg_temp.f('offeree'), format($q$delete from public.clinical_task_reoffers where task_id = %L$q$, pg_temp.f('t_aged'))));
insert into results values ('real', 'queue_my_reoffers lists my task', '1',
  pg_temp.count_as(pg_temp.f('offeree'), format($q$select jsonb_array_length(public.queue_my_reoffers())::text$q$)));
insert into results values ('real', 'queue_my_reoffers is empty for the holder', '0',
  pg_temp.count_as(pg_temp.f('a'), $q$select jsonb_array_length(public.queue_my_reoffers())::text$q$));
insert into results values ('real', 'anon cannot call queue_my_reoffers', 'ERR:42501', pg_temp.sql_anon($q$select public.queue_my_reoffers()$q$));

-- 5. device producer
do $$
declare v_fault uuid; v_n text;
begin
  insert into public.device_fault_reports (organisation_id, patient_id, reported_by, description)
    values (pg_temp.f('org'), pg_temp.f('pat'), pg_temp.f('pat'), 'cuff will not inflate') returning id into v_fault;
  insert into results values ('real', 'device fault from a test patient makes a device_alert_review task', '1',
    (select count(*)::text from public.clinical_tasks where patient_id = pg_temp.f('pat') and type = 'device_alert_review' and dedup_key = 'device_fault:' || v_fault));
  insert into results values ('real', 'the task carries no free text', 'true',
    (select (outcome is null and cancel_reason is null)::text from public.clinical_tasks where dedup_key = 'device_fault:' || v_fault));
  insert into public.device_fault_reports (organisation_id, patient_id, reported_by, description)
    values (pg_temp.f('org'), pg_temp.f('real'), pg_temp.f('real'), 'cuff will not inflate') returning id into v_fault;
  insert into results values ('real', 'a real patient with the guard off gets no task', '0',
    (select count(*)::text from public.clinical_tasks where patient_id = pg_temp.f('real') and type = 'device_alert_review'));
end $$;

-- 4. silence
do $$
declare s1 uuid; s2 uuid; s3 uuid; s4 uuid; s5 uuid; i integer; p uuid;
begin
  s1 := pg_temp.mkuser(pg_temp.f('org'), 's1', 'patient');  -- was recording, now quiet
  s2 := pg_temp.mkuser(pg_temp.f('org'), 's2', 'patient');  -- recording recently
  s3 := pg_temp.mkuser(pg_temp.f('org'), 's3', 'patient');  -- never really recorded
  s4 := pg_temp.mkuser(pg_temp.f('org'), 's4', 'patient');  -- enrolled two days ago
  s5 := pg_temp.mkuser(pg_temp.f('org'), 's5', 'patient');  -- a real patient, guard off
  foreach p in array array[s1, s2, s3, s4, s5] loop
    insert into public.chronic_programme_enrolments (organisation_id, patient_id, programme_id, status, enrolled_at)
      values (pg_temp.f('org'), p, pg_temp.f('prog'), 'enrolled', case when p = s4 then now() - interval '2 days' else now() - interval '40 days' end);
  end loop;
  update public.profiles set is_test = false where id = s5;   -- after enrolment: a real patient cannot enrol under a closed pathway guard
  foreach p in array array[s1, s2, s5] loop
    for i in 1..4 loop
      insert into public.vitals_readings (organisation_id, patient_id, vital_type, weight_kg, taken_at, source)
        values (pg_temp.f('org'), p, 'weight', 70 + i, now() - make_interval(days => 8 + i), 'device');
    end loop;
  end loop;
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, weight_kg, taken_at, source)
    values (pg_temp.f('org'), s2, 'weight', 71, now() - interval '1 day', 'device');
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, weight_kg, taken_at, source)
    values (pg_temp.f('org'), s3, 'weight', 71, now() - interval '9 days', 'device');
  perform pg_temp.setf('s1', s1); perform pg_temp.setf('s2', s2); perform pg_temp.setf('s3', s3); perform pg_temp.setf('s4', s4); perform pg_temp.setf('s5', s5);
end $$;
create function pg_temp.notif_count(p uuid) returns text language sql as $$ select count(*)::text from public.notifications where recipient_id = p $$;
select pg_temp.setf('dummy', pg_temp.f('s1'));
create temp table notif_before on commit drop as select pg_temp.notif_count(pg_temp.f('s1')) as n;
select private.sweep_reading_silence();
insert into results values ('real', 'the quiet recorder gets exactly one silence_check', '1',
  (select count(*)::text from public.clinical_tasks where patient_id = pg_temp.f('s1') and type = 'silence_check'));
insert into results values ('real', 'it is amber at most (class 4 or later), never red', 'true',
  (select (priority_class >= 4 and priority_class_original >= 4)::text from public.clinical_tasks where patient_id = pg_temp.f('s1') and type = 'silence_check'));
insert into results values ('real', 'a recent recorder gets none', '0', (select count(*)::text from public.clinical_tasks where patient_id = pg_temp.f('s2') and type = 'silence_check'));
insert into results values ('real', 'a never-active patient gets none', '0', (select count(*)::text from public.clinical_tasks where patient_id = pg_temp.f('s3') and type = 'silence_check'));
insert into results values ('real', 'a newly enrolled patient gets none', '0', (select count(*)::text from public.clinical_tasks where patient_id = pg_temp.f('s4') and type = 'silence_check'));
insert into results values ('real', 'a real patient with the guard off gets none', '0', (select count(*)::text from public.clinical_tasks where patient_id = pg_temp.f('s5') and type = 'silence_check'));
insert into results values ('real', 'the patient is never contacted', (select n from notif_before), pg_temp.notif_count(pg_temp.f('s1')));
select private.sweep_reading_silence();
insert into results values ('real', 'a second sweep does not duplicate', '1', (select count(*)::text from public.clinical_tasks where patient_id = pg_temp.f('s1') and type = 'silence_check'));
-- the ceiling: raise the type to red-class and the sweep must refuse (and a second quiet patient gets nothing)
do $$
declare r jsonb; s6 uuid; i integer;
begin
  -- a second quiet patient, created only now so the earlier sweeps never saw it
  s6 := pg_temp.mkuser(pg_temp.f('org'), 's6', 'patient');
  insert into public.chronic_programme_enrolments (organisation_id, patient_id, programme_id, status, enrolled_at)
    values (pg_temp.f('org'), s6, pg_temp.f('prog'), 'enrolled', now() - interval '40 days');
  for i in 1..4 loop
    insert into public.vitals_readings (organisation_id, patient_id, vital_type, weight_kg, taken_at, source)
      values (pg_temp.f('org'), s6, 'weight', 70 + i, now() - make_interval(days => 8 + i), 'device');
  end loop;
  perform pg_temp.setf('s6', s6);
  update public.task_types set priority_class = 3 where code = 'silence_check';
  r := private.sweep_reading_silence();
  insert into results values ('real', 'above amber: the sweep refuses', 'silence_check missing or above amber', r ->> 'skipped');
  insert into results values ('real', 'above amber: nothing created', '0', (select count(*)::text from public.clinical_tasks where patient_id = pg_temp.f('s6') and type = 'silence_check'));
  update public.task_types set priority_class = 5 where code = 'silence_check';
end $$;

-- 6. blast radius: 25 test patients, 20 at pulse 95, 5 at pulse 105 (amber readings may raise their own alerts; rolled back)
do $$
declare p uuid; i integer;
begin
  for i in 1..25 loop
    p := pg_temp.mkuser(pg_temp.f('org'), 'b' || i, 'patient');
    insert into public.vitals_readings (organisation_id, patient_id, vital_type, pulse_bpm, taken_at, source)
      values (pg_temp.f('org'), p, 'pulse', case when i <= 5 then 105 else 95 end, now() - interval '2 days', 'device');
  end loop;
end $$;
-- the admin and the CMO are both in the org; the preview uses the caller's org
insert into results values ('real', 'a plain clinician cannot preview', 'ERR:42501',
  pg_temp.sql_as(pg_temp.f('a'), $q$select public.threshold_blast_radius_preview('pulse_bpm', 'gte', 110, 100, true)$q$));
insert into results values ('real', 'a patient cannot preview', 'ERR:42501',
  pg_temp.sql_as(pg_temp.f('pat'), $q$select public.threshold_blast_radius_preview('pulse_bpm', 'gte', 110, 100, true)$q$));
insert into results values ('real', 'anon cannot preview', 'ERR:42501', pg_temp.sql_anon($q$select public.threshold_blast_radius_preview('pulse_bpm', 'gte', 110, 100, true)$q$));
insert into results values ('real', 'an unknown metric is refused', 'ERR:22023',
  pg_temp.sql_as(pg_temp.f('cmo'), $q$select public.threshold_blast_radius_preview('patient_name', 'gte', 110, 100, true)$q$));
insert into results values ('real', 'a 5-person difference is suppressed as a small cell', 'true|small_cell',
  pg_temp.count_as(pg_temp.f('cmo'), $q$select (r ->> 'suppressed') || '|' || coalesce(r ->> 'reason', '') from (select public.threshold_blast_radius_preview('pulse_bpm', 'gte', 110, 100, true) r) x$q$));
insert into results values ('real', 'a large enough difference returns aggregate counts', '25|0|25|25|0',
  pg_temp.count_as(pg_temp.f('cmo'), $q$select (r ->> 'people_with_readings') || '|' || (r ->> 'flagged_now') || '|' || (r ->> 'flagged_proposed') || '|' || (r ->> 'newly_flagged') || '|' || (r ->> 'no_longer_flagged')
    from (select public.threshold_blast_radius_preview('pulse_bpm', 'gte', 110, 90, true) r) x$q$));
insert into results values ('real', 'an admin can preview too', 'false',
  pg_temp.count_as(pg_temp.f('admin'), $q$select (public.threshold_blast_radius_preview('pulse_bpm', 'gte', 110, 90, true) ->> 'suppressed')$q$));
insert into results values ('real', 'test accounts are excluded by default (so the cell is empty and suppressed)', 'true',
  pg_temp.count_as(pg_temp.f('cmo'), $q$select (public.threshold_blast_radius_preview('pulse_bpm', 'gte', 110, 90) ->> 'suppressed')$q$));
insert into results values ('real', 'the answer carries no patient identifier', 'false',
  pg_temp.count_as(pg_temp.f('cmo'), format($q$select (public.threshold_blast_radius_preview('pulse_bpm', 'gte', 110, 90, true)::text like '%%' || %L || '%%')::text$q$, left(pg_temp.f('pat')::text, 8))));
insert into results values ('real', 'previews are audited', 'true',
  (select (count(*) >= 4)::text from public.audit_log where action = 'threshold_blast_radius.previewed'));

-- SABOTAGE (a): the previous-holder exclusion removed. Everyone else is made unavailable, so correct code finds nobody and the sabotaged code
-- re-offers to the holder.
do $$
declare t uuid; v_def text; v_pat uuid;
begin
  v_pat := pg_temp.mkuser(pg_temp.f('org'), 'sabpat', 'patient');
  update public.clinical_staff set active = false where is_test and profile_id <> pg_temp.f('a');
  t := private.create_clinical_task(v_pat, 'admin_clinical', null, 'sab-a');
  perform pg_temp.hold(t, pg_temp.f('a'));
  perform pg_temp.age_task(t, 2000);
  perform private.reoffer_unacknowledged_tasks();
  insert into results values ('real', 'only the holder left: correct code records no_second_clinician', '1|0', pg_temp.reoffers(t, 'no_second_clinician') || '|' || pg_temp.reoffers(t, 'offered'));
  delete from public.clinical_task_reoffers where task_id = t;
  v_def := pg_get_functiondef('private.reoffer_unacknowledged_tasks()'::regprocedure);
  if v_def not like '%not (cs.profile_id = any (v_prev))%' then raise exception 'sabotage anchor missing'; end if;
  execute replace(v_def, 'not (cs.profile_id = any (v_prev))', 'true');
  perform private.reoffer_unacknowledged_tasks();
  insert into results values ('sabotaged', 'only the holder left: correct code records no_second_clinician', '1|0', pg_temp.reoffers(t, 'no_second_clinician') || '|' || pg_temp.reoffers(t, 'offered'));
  update public.clinical_staff set active = true where is_test;
end $$;

-- SABOTAGE (b): the amber ceiling removed; with the type at class 3 the sweep creates it anyway
do $$
declare v_def text; r jsonb;
begin
  v_def := pg_get_functiondef('private.sweep_reading_silence()'::regprocedure);
  if v_def not like '%v_class < 4%' then raise exception 'sabotage anchor missing'; end if;
  execute replace(v_def, 'v_class < 4', 'false');
  update public.task_types set priority_class = 3 where code = 'silence_check';
  r := private.sweep_reading_silence();
  insert into results values ('sabotaged', 'above amber: the sweep refuses', 'silence_check missing or above amber', r ->> 'skipped');
  update public.task_types set priority_class = 5 where code = 'silence_check';
end $$;

-- SABOTAGE (c): suppress_cell made permissive; the 5-person difference is now shown
do $$
begin
  create or replace function private.suppress_cell(p_n bigint, p_categories bigint[] default null, p_min integer default null) returns text
    language sql stable security definer set search_path = '' as $f$ select null::text $f$;
  insert into results values ('sabotaged', 'a 5-person difference is suppressed as a small cell', 'true|small_cell',
    pg_temp.count_as(pg_temp.f('cmo'), $q$select (r ->> 'suppressed') || '|' || coalesce(r ->> 'reason', '') from (select public.threshold_blast_radius_preview('pulse_bpm', 'gte', 110, 100, true) r) x$q$));
end $$;

-- SABOTAGE (d): the read policy opened to everyone
do $$
begin
  alter policy clinical_task_reoffers_read on public.clinical_task_reoffers using (true);
  insert into results values ('sabotaged', 'the holder reads nothing', '0',
    pg_temp.count_as(pg_temp.f('a'), format($q$select count(*)::text from public.clinical_task_reoffers where task_id = %L$q$, pg_temp.f('t_aged'))));
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S76 clinician proof FAILED: %', (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected is distinct from actual;
  if v_caught < 4 then raise exception 'VACUOUS TEST: only % of 4 sabotages flipped a check', v_caught; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result from results where phase = 'real' order by check_name;
rollback;
