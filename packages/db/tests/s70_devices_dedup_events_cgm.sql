-- S70 proof: cross-source dedup (link, count once, never delete, safety rows untouched), CGM sustained-event rules replayed on synthetic
-- traces, the ECG device alert task, events (ids and counts only), the go-live guard, RLS per role and the listing criteria.
-- Sabotage: dropping the dedup trigger and the CGM trigger must flip the checks that depend on them.
begin;
create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create function pg_temp.rec(p_name text, p_expected text, p_actual text) returns void language sql as $$ insert into results values ('real', p_name, p_expected, p_actual) $$;
create function pg_temp.try(p_sql text) returns text language plpgsql as $f$ begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $f$;
create function pg_temp.act(p_uid uuid) returns void language plpgsql as $f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
end $f$;
create function pg_temp.act_anon() returns void language plpgsql as $f$ begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
end $f$;
create function pg_temp.back() returns void language plpgsql as $f$ begin reset role; end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's70-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'S70 ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone;
  return v;
end $f$;
create function pg_temp.bp(p_pat uuid, p_org uuid, p_src text, p_at timestamptz, p_s integer, p_d integer, p_photo boolean default false) returns uuid language plpgsql as $f$
declare v uuid;
begin
  insert into public.vitals_readings (patient_id, organisation_id, vital_type, source, taken_at, systolic, diastolic, photo_confirmed, position)
  values (p_pat, p_org, 'blood_pressure', p_src::public.vital_source, p_at, p_s, p_d, p_photo, 'seated') returning id into v;
  return v;
end $f$;
create function pg_temp.cgm(p_pat uuid, p_org uuid, p_at timestamptz, p_g numeric) returns void language sql as $f$
  insert into public.vitals_readings (patient_id, organisation_id, vital_type, source, taken_at, glucose_mmol_l)
  values (p_pat, p_org, 'glucose', 'cgm', p_at, p_g)
$f$;

do $$
declare
  v_org uuid; v_admin uuid; v_doc uuid; v_other uuid; v_pat uuid; v_pat2 uuid; v_real uuid;
  v_t timestamptz := date_trunc('hour', now()) - interval '2 days';
  a uuid; b uuid; c uuid; n integer; v_res jsonb; v_task uuid; i integer;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  v_doc := pg_temp.mkuser(v_org, 'doctor', 'clinician');
  v_other := pg_temp.mkuser(v_org, 'other', 'clinician');
  v_pat := pg_temp.mkuser(v_org, 'patient', 'patient');
  v_pat2 := pg_temp.mkuser(v_org, 'patient2', 'patient');
  v_real := pg_temp.mkuser(v_org, 'real', 'patient');
  update public.profiles set is_test = false where id = v_real;
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id) values (v_org, v_pat, v_doc);

  -- ===== config =====
  perform pg_temp.rec('three active proposed config rows, none confirmed', '3,0', (select count(*)::text || ',' || count(*) filter (where status <> 'proposed')::text from public.device_config where is_active));
  perform pg_temp.rec('events registered', '2', (select count(*)::text from public.event_types where event_type in ('device.synced', 'device.alert')));
  perform pg_temp.rec('guard exists and is off', 'false', (select is_on::text from public.go_live_guards where key = 'device_alerts_enabled'));

  -- ===== dedup =====
  a := pg_temp.bp(v_pat, v_org, 'wearable', v_t, 130, 84);
  b := pg_temp.bp(v_pat, v_org, 'device', v_t + interval '3 minutes', 132, 85);
  perform pg_temp.rec('C1 wearable then cuff: the wearable row is linked as the duplicate of the cuff', 'true,true',
    (select (duplicate_id = a)::text || ',' || (canonical_id = b)::text from public.vitals_reading_links where patient_id = v_pat));
  perform pg_temp.rec('both rows persist, counted once', '2,1',
    (select count(*)::text from public.vitals_readings where patient_id = v_pat and vital_type = 'blood_pressure') || ',' ||
    (select count(*)::text from public.vitals_readings_counted where patient_id = v_pat and vital_type = 'blood_pressure'));
  perform pg_temp.rec('the link records the config version it used', '1', (select dedup_config_version::text from public.vitals_reading_links where duplicate_id = a));

  -- cuff first, wearable later
  a := pg_temp.bp(v_pat2, v_org, 'device', v_t, 120, 80);
  b := pg_temp.bp(v_pat2, v_org, 'wearable', v_t + interval '9 minutes', 123, 82);
  perform pg_temp.rec('C1 cuff then wearable: the later wearable row is the duplicate', 'true', (select (duplicate_id = b and canonical_id = a)::text from public.vitals_reading_links where patient_id = v_pat2));
  -- a typed value from the same measurement (a manual row's time is stamped by the server, so the cuff row is placed just before now)
  a := pg_temp.bp(v_real, v_org, 'device', clock_timestamp() - interval '2 minutes', 120, 80);
  c := pg_temp.bp(v_real, v_org, 'manual', clock_timestamp(), 121, 80);
  perform pg_temp.rec('a typed value of the same measurement links to the cuff (equal rank, first wins)', 'true', (select (duplicate_id = c and canonical_id = a)::text from public.vitals_reading_links where patient_id = v_real));
  -- photo-confirmed outranks wearable that arrived earlier
  a := pg_temp.bp(v_pat2, v_org, 'wearable', v_t + interval '2 hours', 140, 90);
  b := pg_temp.bp(v_pat2, v_org, 'device', v_t + interval '2 hours' + interval '4 minutes', 141, 90, true);
  perform pg_temp.rec('a photo-confirmed reading outranks an earlier wearable estimate', 'true', (select (canonical_id = b)::text from public.vitals_reading_links where duplicate_id = a));
  -- outside window / tolerance
  a := pg_temp.bp(v_pat2, v_org, 'wearable', v_t + interval '5 hours', 130, 84);
  b := pg_temp.bp(v_pat2, v_org, 'device', v_t + interval '5 hours' + interval '11 minutes', 130, 84);
  c := pg_temp.bp(v_pat2, v_org, 'device', v_t + interval '6 hours', 130, 84);
  b := pg_temp.bp(v_pat2, v_org, 'wearable', v_t + interval '6 hours' + interval '2 minutes', 150, 84);
  perform pg_temp.rec('11 minutes apart (window 10) and a 20 mmHg difference (tolerance 4) are not linked', '0',
    (select count(*)::text from public.vitals_reading_links where duplicate_id in (a, b, c) or canonical_id in (a, c)));
  -- glucose window 5 minutes
  insert into public.vitals_readings (patient_id, organisation_id, vital_type, source, taken_at, glucose_mmol_l) values (v_pat2, v_org, 'glucose', 'wearable', v_t + interval '8 hours', 6.0);
  insert into public.vitals_readings (patient_id, organisation_id, vital_type, source, taken_at, glucose_mmol_l) values (v_pat2, v_org, 'glucose', 'device', v_t + interval '8 hours' + interval '4 minutes', 6.2);
  insert into public.vitals_readings (patient_id, organisation_id, vital_type, source, taken_at, glucose_mmol_l) values (v_pat2, v_org, 'glucose', 'wearable', v_t + interval '9 hours', 6.0);
  insert into public.vitals_readings (patient_id, organisation_id, vital_type, source, taken_at, glucose_mmol_l) values (v_pat2, v_org, 'glucose', 'device', v_t + interval '9 hours' + interval '6 minutes', 6.0);
  perform pg_temp.rec('glucose: 4 minutes links, 6 minutes does not', '1', (select count(*)::text from public.vitals_reading_links l join public.vitals_readings r on r.id = l.duplicate_id where r.vital_type = 'glucose' and l.patient_id = v_pat2));
  -- a crisis reading seen from two sources keeps both rows, and the triage side effects of each insert are not suppressed
  perform pg_temp.bp(v_pat, v_org, 'wearable', v_t + interval '12 hours', 215, 125);
  perform pg_temp.bp(v_pat, v_org, 'device', v_t + interval '12 hours' + interval '2 minutes', 214, 124);
  perform pg_temp.rec('a crisis reading from two sources: both rows stored, one counted', '2,1',
    (select count(*)::text from public.vitals_readings where patient_id = v_pat and systolic >= 200) || ',' || (select count(*)::text from public.vitals_readings_counted where patient_id = v_pat and systolic >= 200));
  -- the sweep re-links
  alter table public.vitals_readings disable trigger vitals_readings_link_duplicate;
  a := pg_temp.bp(v_pat, v_org, 'wearable', v_t + interval '20 hours', 118, 76);
  b := pg_temp.bp(v_pat, v_org, 'device', v_t + interval '20 hours' + interval '1 minute', 118, 76);
  alter table public.vitals_readings enable trigger vitals_readings_link_duplicate;
  perform pg_temp.rec('with the trigger off nothing is linked', '0', (select count(*)::text from public.vitals_reading_links where duplicate_id in (a, b)));
  perform pg_temp.act(v_admin);
  perform public.sweep_unlinked_duplicates(30);
  perform pg_temp.back();
  perform pg_temp.rec('the sweep links it', '1', (select count(*)::text from public.vitals_reading_links where duplicate_id in (a, b)));

  -- ===== CGM sustained events: synthetic traces, replayed =====
  -- severe low 2.8 for 15 minutes (readings every 5 minutes)
  for i in 0..3 loop perform pg_temp.cgm(v_pat, v_org, v_t + interval '30 hours' + make_interval(mins => i * 5), 2.8); end loop;
  perform pg_temp.rec('C2 severe low: no alert at 10 minutes, one at 15', '1', (select count(*)::text from public.device_alerts where patient_id = v_pat and alert_code = 'cgm_severe_low'));
  select count(*) into n from public.device_alerts where patient_id = v_pat and alert_code = 'cgm_severe_low' and episode_minutes = 15 and config_version = 1 and state = 'task_created' and task_id is not null;
  perform pg_temp.rec('...at exactly 15 minutes, config version recorded, task created for a test patient', '1', n::text);
  perform pg_temp.rec('...the task is the device alert review type', '1', (select count(*)::text from public.clinical_tasks t join public.device_alerts a on a.task_id = t.id where a.patient_id = v_pat and t.type = 'device_alert_review'));
  perform pg_temp.cgm(v_pat, v_org, v_t + interval '30 hours' + interval '20 minutes', 2.7);
  perform pg_temp.rec('...a continuing episode does not alert again', '1', (select count(*)::text from public.device_alerts where patient_id = v_pat and alert_code = 'cgm_severe_low'));
  perform pg_temp.rec('...and the existing emergency safety record exists', 'true', (exists (select 1 from public.emergency_events where patient_id = v_pat and source = 'glucose_red_flag'))::text);
  -- low 3.5 for 55 minutes: nothing; at 60: cgm_low
  for i in 0..11 loop perform pg_temp.cgm(v_pat2, v_org, v_t + interval '40 hours' + make_interval(mins => i * 5), 3.5); end loop;
  perform pg_temp.rec('C2 low: 55 minutes under 3.9 raises nothing', '0', (select count(*)::text from public.device_alerts where patient_id = v_pat2 and alert_code = 'cgm_low'));
  perform pg_temp.cgm(v_pat2, v_org, v_t + interval '40 hours' + interval '60 minutes', 3.5);
  perform pg_temp.rec('C2 low: 60 minutes raises cgm_low', '1', (select count(*)::text from public.device_alerts where patient_id = v_pat2 and alert_code = 'cgm_low'));
  perform pg_temp.rec('...and 3.5 is not under 3.0, so no severe low', '0', (select count(*)::text from public.device_alerts where patient_id = v_pat2 and alert_code = 'cgm_severe_low'));
  -- a gap over 20 minutes breaks the run
  for i in 0..3 loop perform pg_temp.cgm(v_pat2, v_org, v_t + interval '60 hours' + make_interval(mins => i * 5), 2.9); end loop;
  delete from public.device_alerts where patient_id = v_pat2 and alert_code = 'cgm_severe_low';
  perform pg_temp.cgm(v_pat2, v_org, v_t + interval '60 hours' + interval '50 minutes', 2.9);
  perform pg_temp.cgm(v_pat2, v_org, v_t + interval '60 hours' + interval '55 minutes', 2.9);
  perform pg_temp.rec('a 30 minute gap breaks the run: two short runs are not 15 sustained minutes', '0', (select count(*)::text from public.device_alerts where patient_id = v_pat2 and alert_code = 'cgm_severe_low'));
  -- high over 13.9 for 120 minutes
  for i in 0..23 loop perform pg_temp.cgm(v_pat2, v_org, v_t + interval '80 hours' + make_interval(mins => i * 5), 14.5); end loop;
  perform pg_temp.rec('C2 high: 115 minutes raises nothing', '0', (select count(*)::text from public.device_alerts where patient_id = v_pat2 and alert_code = 'cgm_high'));
  perform pg_temp.cgm(v_pat2, v_org, v_t + interval '80 hours' + interval '120 minutes', 14.5);
  perform pg_temp.rec('C2 high: 120 minutes raises cgm_high', '1', (select count(*)::text from public.device_alerts where patient_id = v_pat2 and alert_code = 'cgm_high'));
  -- exactly 13.9 is not above 13.9
  for i in 0..30 loop perform pg_temp.cgm(v_pat2, v_org, v_t + interval '100 hours' + make_interval(mins => i * 5), 13.9); end loop;
  perform pg_temp.rec('13.9 exactly is not above the threshold', '1', (select count(*)::text from public.device_alerts where patient_id = v_pat2 and alert_code = 'cgm_high'));
  -- guard closed for a real patient: the alert is recorded and event emitted, the task is held
  for i in 0..3 loop perform pg_temp.cgm(v_real, v_org, v_t + interval '120 hours' + make_interval(mins => i * 5), 2.8); end loop;
  perform pg_temp.rec('guard off, real patient: alert recorded, task held', '1,held_guard_off,0',
    (select count(*)::text || ',' || min(state) || ',' || count(task_id)::text from public.device_alerts where patient_id = v_real));
  perform pg_temp.rec('guard off, real patient: the device.alert event is still emitted', '1', (select count(*)::text from public.domain_events where event_type = 'device.alert' and patient_id = v_real));

  -- ===== ECG =====
  perform pg_temp.act(v_pat);
  v_res := public.report_device_ecg_result('irregular_rhythm', 'apple_watch', 'Atrial fibrillation', now() - interval '1 hour');
  perform pg_temp.back();
  perform pg_temp.rec('C3 irregular result: alert true, review flag, no rhythm name in the reply', 'true,false', ((v_res ->> 'alert')) || ',' || (v_res::text ~* 'fibrillation|rhythm')::text);
  perform pg_temp.rec('...a routine task of the right type, due within one working day', '1,7,true',
    (select count(*)::text || ',' || min(t.priority_class)::text || ',' || (min(t.due_at) <= now() + interval '1441 minutes')::text from public.clinical_tasks t join public.device_alerts a on a.task_id = t.id where a.patient_id = v_pat and a.alert_code = 'ecg_irregular'));
  perform pg_temp.act(v_pat);
  v_res := public.report_device_ecg_result('sinus_rhythm', 'apple_watch', 'Sinus rhythm', now() - interval '30 minutes');
  perform pg_temp.back();
  perform pg_temp.rec('a normal result creates nothing', 'false', v_res ->> 'alert');
  perform pg_temp.act(v_pat);
  perform public.report_device_ecg_result('inconclusive', 'apple_watch', 'Inconclusive', now() - interval '2 hours');
  perform public.report_device_ecg_result('inconclusive', 'apple_watch', 'Inconclusive', now() - interval '2 hours');
  perform pg_temp.back();
  perform pg_temp.rec('an inconclusive result alerts once (same recording sent twice)', '1', (select count(*)::text from public.device_alerts where patient_id = v_pat and alert_code = 'ecg_inconclusive'));
  perform pg_temp.act(v_pat);
  perform pg_temp.rec('a clinician-style bad classification is refused', '22023', pg_temp.try($q$select public.report_device_ecg_result('afib', 'x', 'x', now())$q$));
  perform pg_temp.rec('a recording time in the future is refused', '22023', pg_temp.try($q$select public.report_device_ecg_result('inconclusive', 'x', 'x', now() + interval '2 days')$q$));
  perform pg_temp.back();
  perform pg_temp.act(v_doc);
  perform pg_temp.rec('a clinician cannot report a patient''s ECG result', '42501', pg_temp.try($q$select public.report_device_ecg_result('inconclusive', 'x', 'x', now())$q$));
  perform pg_temp.back();

  -- ===== events carry no values =====
  perform pg_temp.rec('no event payload names a value or a reading', '0', (select count(*)::text from public.domain_events where event_type in ('device.alert', 'device.synced') and payload::text ~* '(systolic|diastolic|mmol|glucose_|value|mmhg)'));
  perform pg_temp.act(v_pat);
  perform public.record_device_sync(v_pat, 'fitbit', 'wearable_cloud', 5, 1);
  perform pg_temp.rec('a patient records a sync for themselves', 'ok', pg_temp.try(format('select public.record_device_sync(%L, %L, %L, 2, 0)', v_pat, 'oura', 'wearable_cloud')));
  perform pg_temp.rec('...not for someone else', '42501', pg_temp.try(format('select public.record_device_sync(%L, %L, %L, 2, 0)', v_pat2, 'oura', 'wearable_cloud')));
  perform pg_temp.back();
  perform pg_temp.rec('device.synced counted', '2', (select count(*)::text from public.domain_events where event_type = 'device.synced' and patient_id = v_pat));

  -- ===== RLS per role, including the refused ones =====
  perform pg_temp.act(v_pat);
  perform pg_temp.rec('the patient cannot read device_alerts directly', '42501', pg_temp.try('select * from public.device_alerts'));
  perform pg_temp.rec('the patient cannot read device_config', '0', (select count(*)::text from public.device_config));
  perform pg_temp.rec('the patient sees their own links', 'true', ((select count(*) from public.vitals_reading_links) > 0)::text);
  perform pg_temp.rec('the patient sees none of another patient''s links', '0', (select count(*)::text from public.vitals_reading_links where patient_id = v_pat2));
  perform pg_temp.rec('the patient cannot write a link', '42501', pg_temp.try(format('insert into public.vitals_reading_links (duplicate_id, canonical_id, organisation_id, patient_id, dedup_config_version, duplicate_source, canonical_source) select id, id, organisation_id, patient_id, 1, %L, %L from public.vitals_readings limit 1', 'a', 'b')));
  perform pg_temp.rec('the patient has a neutral review status', 'true', (public.my_device_review_status() > 0)::text);
  perform pg_temp.back();
  perform pg_temp.act(v_admin);
  perform pg_temp.rec('an admin reads the config', '3', (select count(*)::text from public.device_config where is_active));
  perform pg_temp.back();
  perform pg_temp.act(v_doc);
  perform pg_temp.rec('a tied clinician reads alerts through the audited function', '2', (select count(*)::text from public.clinician_device_alerts(v_pat) where alert_code in ('ecg_irregular', 'ecg_inconclusive')));
  perform pg_temp.rec('...and it wrote an audit row', 'true', (exists (select 1 from public.audit_log where action = 'device_alert.read' and actor_id = v_doc))::text);
  perform pg_temp.rec('a clinician cannot read the table directly', '42501', pg_temp.try('select * from public.device_alerts'));
  perform pg_temp.back();
  perform pg_temp.act(v_other);
  perform pg_temp.rec('an untied clinician is refused the alerts', '42501', pg_temp.try(format('select * from public.clinician_device_alerts(%L)', v_pat)));
  perform pg_temp.rec('an untied clinician cannot release held alerts', '42501', pg_temp.try('select public.release_held_device_alerts()'));
  perform pg_temp.back();
  perform pg_temp.act_anon();
  perform pg_temp.rec('anon cannot report an ECG result', '42501', pg_temp.try($q$select public.report_device_ecg_result('inconclusive', 'x', 'x', now())$q$));
  perform pg_temp.rec('anon cannot read links', '42501', pg_temp.try('select * from public.vitals_reading_links'));
  perform pg_temp.back();

  -- ===== release after the guard would open =====
  perform pg_temp.act(v_admin);
  perform pg_temp.rec('release does nothing while the guard is off for a real patient', '0', (select public.release_held_device_alerts())::text);
  perform pg_temp.back();

  -- ===== listing criteria =====
  insert into public.device_catalog (device_name, category, pairing_path) values ('S70 test cuff', 'blood_pressure', 'manual_only') returning id into a;
  perform pg_temp.rec('a device cannot be listed without validation and a distributor', '23514', pg_temp.try(format('update public.device_catalog set active = true where id = %L', a)));
  update public.device_catalog set validation_standard = 'validatebp', validation_reference = 'test entry', nafdac_status = 'authorised_distributor', distributor_name = 'Test distributor', active = true where id = a;
  perform pg_temp.rec('a validated device from an authorised distributor can be listed', 'true', (select active::text from public.device_catalog where id = a));
  perform pg_temp.rec('a NAFDAC-registered device needs its number', '23514', pg_temp.try(format('update public.device_catalog set nafdac_status = %L where id = %L', 'registered', a)));
  perform pg_temp.rec('no seeded device is active', '0', (select count(*)::text from public.device_catalog where active and device_name <> 'S70 test cuff'));

  -- ===== SABOTAGE =====
  alter table public.vitals_readings disable trigger vitals_readings_link_duplicate;
  a := pg_temp.bp(v_pat2, v_org, 'wearable', v_t + interval '200 hours', 111, 70);
  b := pg_temp.bp(v_pat2, v_org, 'device', v_t + interval '200 hours' + interval '1 minute', 111, 70);
  insert into results values ('sabotaged', 'C1 wearable then cuff linked', '1', (select count(*)::text from public.vitals_reading_links where duplicate_id in (a, b)));
  alter table public.vitals_readings disable trigger vitals_readings_cgm_events;
  for i in 0..3 loop perform pg_temp.cgm(v_pat2, v_org, v_t + interval '210 hours' + make_interval(mins => i * 5), 2.6); end loop;
  insert into results values ('sabotaged', 'C2 severe low raises one alert', '1', (select count(*)::text from public.device_alerts where patient_id = v_pat2 and episode_started_at = v_t + interval '210 hours'));
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S70 proof FAILED: %', (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 2 then raise exception 'VACUOUS TEST: sabotage caught % of 2', v_caught; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result from results where phase = 'real' order by check_name;
rollback;
