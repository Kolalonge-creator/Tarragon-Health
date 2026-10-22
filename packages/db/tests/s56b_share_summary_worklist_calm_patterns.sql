-- S56b proof: "Share with my care team", the mental health follow-up worklist, the four go-live guards and the patient-private patterns preference.
-- Roles proved: patient (own and another), tied clinician, untied clinician, tied care coordinator, CMO without a tie, admin, finance, analyst,
-- a non-test patient and clinician (so the guards are really closed), anon.
-- What is proved: the summary holds only what the patient chose and never a check-in note, a tag, a questionnaire item answer or a journal;
-- preview writes nothing; staff read a summary only through the audited function; the worklist is deterministic, tied-only (INV-12), audited
-- per patient served (INV-10), refused to coordinators and everyone else, empty and plain about it until the CMO signs, immutable once signed;
-- a follow-up is a real task; counts carry no identity; the wording guards close again when one word changes.
-- SABOTAGE: the tie filter removed, the clinician gate opened to everyone, the audit row removed, a check-in note added to the summary, the
-- actions table opened; each must flip its checks (the file fails with VACUOUS TEST otherwise). Everything is rolled back.
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
create function pg_temp.sab(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('sabotaged', p_name, p_expected, p_actual) $$;
create function pg_temp.act(p_uid uuid) returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
end $f$;
create function pg_temp.back() returns void language plpgsql as
$f$ begin reset role; perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.role', '', true); end $f$;
-- run a scalar query as a user; returns the value as text, or 'ERR:' || message
create function pg_temp.q_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlerrm; end;
  perform pg_temp.back();
  return r;
end $f$;
-- the same, returning the SQLSTATE of a failure instead of its message ('ok' when it succeeded)
create function pg_temp.try_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql; r := 'ok'; exception when others then r := sqlstate; end;
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
-- the count of audit rows a staff member wrote with a given result and section
create function pg_temp.n_audit(p_actor uuid, p_result text, p_section text) returns text language sql as
$$ select count(*)::text from public.audit_log where actor_id = p_actor and action = 'staff.mental_health_read' and result = p_result and event -> 'sections' ? p_section $$;
-- the patients on a clinician's worklist, as a sorted comma list of fixture names
create function pg_temp.names(p_uid uuid) returns text language plpgsql as
$f$ declare r text; v jsonb;
begin
  perform pg_temp.act(p_uid);
  begin v := public.list_mental_health_worklist(); exception when others then v := jsonb_build_object('error', sqlerrm); end;
  perform pg_temp.back();
  if v ? 'error' then return 'ERR:' || (v ->> 'error'); end if;
  if v ->> 'status' <> 'ok' then return v ->> 'status'; end if;
  select coalesce(string_agg(k, ',' order by k), '') into r
    from jsonb_array_elements(v -> 'rows') x join fx on fx.v = (x ->> 'patient_id')::uuid;
  return r;
end $f$;
create function pg_temp.worklist(p_uid uuid) returns jsonb language plpgsql as
$f$ declare v jsonb;
begin
  perform pg_temp.act(p_uid);
  begin v := public.list_mental_health_worklist(); exception when others then v := jsonb_build_object('error', sqlerrm); end;
  perform pg_temp.back();
  return v;
end $f$;
-- a guard switched the way the guard's own trigger allows: a log row in this transaction, then the update
create function pg_temp.guard(p_key text, p_on boolean) returns void language plpgsql as
$f$ begin
  insert into public.go_live_guard_log (guard_key, action, actor_id, actor_role, note, conditions)
  values (p_key, case when p_on then 'switched_on' else 'switched_off' end, pg_temp.f('admin'), 'admin', 'S56b proof', '[]'::jsonb);
  update public.go_live_guards
     set is_on = p_on, changed_at = case when p_on then now() end, changed_by = case when p_on then pg_temp.f('admin') end, change_note = case when p_on then 'S56b proof' end
   where key = p_key;
end $f$;

-- preview the summary, then send it with the hash the preview returned (what the app does)
create function pg_temp.share(p_uid uuid, p_s boolean, p_c boolean, p_sl boolean, p_note text) returns text language plpgsql as
$f$ declare h text;
begin
  h := pg_temp.q_as(p_uid, format('select (public.preview_wellbeing_summary(%L, %L, %L) ->> ''hash'')', p_s, p_c, p_sl));
  return pg_temp.q_as(p_uid, format('select public.share_wellbeing_summary_with_care_team(%L, %L, %L, %L, %L)::text', p_s, p_c, p_sl, p_note, h));
end $f$;

-- fixture-defs-begin
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text, p_test boolean default true) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's56b-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'S56b ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, p_test)
  on conflict (id) do update set role = excluded.role, is_test = p_test, is_active = true, phone = excluded.phone, full_name = excluded.full_name;
  return v;
end $f$;
create function pg_temp.mkdoc(p_org uuid, p_label text, p_tier text, p_emp text, p_admin uuid, p_test boolean default true) returns uuid
language plpgsql as $f$
declare v uuid; s uuid;
begin
  v := pg_temp.mkuser(p_org, p_label, 'clinician', p_test);
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
  values (p_org, v, 'S56b ' || p_label, 'MDCN', 'S56B-' || p_label || '-' || substr(v::text, 1, 8), true, 'active', now(), p_admin,
      p_tier::public.doctor_tier, p_emp::public.staff_employment_type,
      case when p_tier in ('senior_medical_officer', 'chief_medical_officer') then 2 else 1 end,
      p_emp = 'contracted', case when p_emp = 'contracted' then p_admin else null end, p_test);
  return v;
end $f$;
-- the clinician is tied to the patient through today's care-team assignment (the plain INV-12 tie)
create function pg_temp.tie(p_org uuid, p_patient uuid, p_clinician uuid, p_coordinator uuid default null) returns void language plpgsql as
$f$ begin
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id, care_coordinator_id) values (p_org, p_patient, p_clinician, p_coordinator);
end $f$;
create function pg_temp.org() returns uuid language sql as $$ select id from public.organisations order by created_at limit 1 $$;
create function pg_temp.staff_id(p_profile uuid) returns uuid language sql as $$ select id from public.clinical_staff where profile_id = p_profile $$;
-- fixture-defs-end

-- Fixtures -------------------------------------------------------------------------------------------------------------
do $$
declare
  v_org uuid := pg_temp.org(); v_admin uuid; v_doc uuid; v_coord uuid; v_a uuid; v_b uuid; v_c uuid; v_d uuid; v_e uuid; v_real uuid; v_realdoc uuid; v_f uuid;
  v_i integer;
begin
  perform pg_temp.setf('org', v_org);
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin'); perform pg_temp.setf('admin', v_admin);
  update public.clinical_staff set active = false where is_test is not true;
  -- patients: A rising PHQ-9 + a shared summary, B sleep trouble, C check-ins that stopped, D controls (nothing should fire), E rising but tied to someone else
  v_a := pg_temp.mkuser(v_org, 'pa', 'patient'); perform pg_temp.setf('A', v_a);
  v_b := pg_temp.mkuser(v_org, 'pb', 'patient'); perform pg_temp.setf('B', v_b);
  v_c := pg_temp.mkuser(v_org, 'pc', 'patient'); perform pg_temp.setf('C', v_c);
  v_d := pg_temp.mkuser(v_org, 'pd', 'patient'); perform pg_temp.setf('D', v_d);
  v_e := pg_temp.mkuser(v_org, 'pe', 'patient'); perform pg_temp.setf('E', v_e);
  v_f := pg_temp.mkuser(v_org, 'pf', 'patient'); perform pg_temp.setf('F', v_f);   -- sleep diary only: never used the mental wellbeing area
  v_real := pg_temp.mkuser(v_org, 'real', 'patient', false); perform pg_temp.setf('R', v_real);   -- a real (non-test) patient: the guards are really closed for them
  v_doc := pg_temp.mkdoc(v_org, 'doctied', 'senior_medical_officer', 'contracted', v_admin); perform pg_temp.setf('doctied', v_doc);
  v_coord := pg_temp.mkdoc(v_org, 'coord', 'care_coordinator', 'employed', v_admin); perform pg_temp.setf('coord', v_coord);
  perform pg_temp.setf('finance', pg_temp.mkuser(v_org, 'finance', 'finance'));
  perform pg_temp.setf('analyst', pg_temp.mkuser(v_org, 'analyst', 'analyst'));
  v_realdoc := pg_temp.mkdoc(v_org, 'realdoc', 'senior_medical_officer', 'contracted', v_admin, false); perform pg_temp.setf('realdoc', v_realdoc);
  perform pg_temp.tie(v_org, v_a, v_doc, v_coord);
  perform pg_temp.tie(v_org, v_b, v_doc);
  perform pg_temp.tie(v_org, v_c, v_doc);
  perform pg_temp.tie(v_org, v_d, v_doc);
  perform pg_temp.tie(v_org, v_f, v_doc);
  perform pg_temp.tie(v_org, v_real, v_realdoc);

  -- data. Bands are 'mild' on purpose: the older concern ladder alerts on moderate and above and would tie a clinician (INV-12) behind our back.
  -- A: PHQ-9 8 sixty days ago then 14 five days ago (a rise of 6); GAD-7 5 then 7 (a rise of 2, below the line)
  insert into public.mental_health_screens (organisation_id, patient_id, instrument, total_score, severity_band, item_responses, created_at) values
    (v_org, v_a, 'phq9', 8, 'mild', '{"q9": 3, "marker": "ITEMSECRET"}', now() - interval '60 days'),
    (v_org, v_a, 'phq9', 14, 'mild', '{"q9": 1, "marker": "ITEMSECRET"}', now() - interval '5 days'),
    (v_org, v_a, 'gad7', 5, 'mild', '{}', now() - interval '60 days'),
    (v_org, v_a, 'gad7', 7, 'mild', '{}', now() - interval '5 days');
  insert into public.wellbeing_checkins (organisation_id, patient_id, mood_score, stress_score, sleep_quality, activity_level, note, tags, checked_in_at) values
    (v_org, v_a, 2, 4, 2, 3, 'NOTESECRET private words', array['work', 'sleep'], now() - interval '3 days'),
    (v_org, v_a, 4, 2, 3, 3, null, array[]::text[], now() - interval '10 days');
  insert into public.sleep_log_entries (organisation_id, patient_id, logged_on, duration_hours, quality_rating, sleep_latency_minutes, night_awakenings, note)
    select v_org, v_a, current_date - g, 6 + (g % 3), 3, 20 + g, g % 3, 'SLEEPNOTESECRET' from generate_series(1, 5) g;
  -- B: nine nights in the last 14 days, six of them under 5.5 hours
  insert into public.sleep_log_entries (organisation_id, patient_id, logged_on, duration_hours, quality_rating)
    select v_org, v_b, current_date - g, case when g <= 6 then 4.5 else 8 end, 3 from generate_series(1, 9) g;
  insert into public.wellbeing_checkins (organisation_id, patient_id, mood_score, stress_score, sleep_quality, activity_level, checked_in_at) values (v_org, v_b, 3, 3, 3, 3, now() - interval '3 days');
  insert into public.sleep_log_entries (organisation_id, patient_id, logged_on, duration_hours, quality_rating)
    select v_org, v_f, current_date - g, case when g <= 6 then 4.5 else 8 end, 3 from generate_series(1, 9) g;
  -- C: nine check-ins between 35 and 13 days ago and none since
  insert into public.wellbeing_checkins (organisation_id, patient_id, mood_score, stress_score, sleep_quality, activity_level, checked_in_at)
    select v_org, v_c, 3, 3, 3, 3, now() - make_interval(days => 13 + g * 2) from generate_series(1, 9) g;
  -- D: controls: a GAD-7 that rose by 2, nine good nights, regular check-ins including yesterday, and a PHQ-9 with a long gap that did not rise
  insert into public.mental_health_screens (organisation_id, patient_id, instrument, total_score, severity_band, created_at) values
    (v_org, v_d, 'gad7', 4, 'mild', now() - interval '40 days'), (v_org, v_d, 'gad7', 6, 'mild', now() - interval '2 days'),
    (v_org, v_d, 'phq9', 9, 'mild', now() - interval '50 days'), (v_org, v_d, 'phq9', 9, 'mild', now() - interval '3 days');
  insert into public.sleep_log_entries (organisation_id, patient_id, logged_on, duration_hours, quality_rating)
    select v_org, v_d, current_date - g, 8, 4 from generate_series(1, 9) g;
  insert into public.wellbeing_checkins (organisation_id, patient_id, mood_score, stress_score, sleep_quality, activity_level, checked_in_at)
    select v_org, v_d, 3, 3, 3, 3, now() - make_interval(days => g * 2 - 1) from generate_series(1, 14) g;
  -- E: the same rise as A, but the only clinician tied to E is created below
  insert into public.mental_health_screens (organisation_id, patient_id, instrument, total_score, severity_band, created_at) values
    (v_org, v_e, 'phq9', 6, 'mild', now() - interval '50 days'), (v_org, v_e, 'phq9', 13, 'mild', now() - interval '4 days');
  -- R: a real patient with a rise, tied to a real clinician
  insert into public.mental_health_screens (organisation_id, patient_id, instrument, total_score, severity_band, created_at) values
    (v_org, v_real, 'phq9', 5, 'mild', now() - interval '50 days'), (v_org, v_real, 'phq9', 12, 'mild', now() - interval '4 days');

  -- created AFTER the data so nothing the older ladder wrote can tie them to a patient behind our back
  perform pg_temp.setf('docuntied', pg_temp.mkdoc(v_org, 'docuntied', 'senior_medical_officer', 'contracted', v_admin));
  perform pg_temp.setf('cmo', pg_temp.mkdoc(v_org, 'cmo', 'chief_medical_officer', 'contracted', v_admin));
  perform pg_temp.tie(v_org, v_e, pg_temp.f('docuntied'));
  -- the screening schedules are rolled forward by a trigger on every screen (twelve months out); only A's PHQ-9 is made overdue by hand
  update public.mental_health_screening_schedules set due_date = current_date - 30 where patient_id = v_a and instrument = 'phq9';
end $$;

-- 0. Static facts: the guards, the grants, the config ------------------------------------------------------------------------------
do $$
declare g text; fn text;
begin
  foreach g in array array['mental_health_worklist_enabled', 'wellbeing_summary_share_enabled', 'panic_tool_enabled', 'mood_insights_enabled'] loop
    perform pg_temp.ck('the guard ' || g || ' exists and is off', 'true', exists (select 1 from public.go_live_guards where key = g and not is_on)::text);
  end loop;
  perform pg_temp.ck('the worklist guard has four conditions', '4', jsonb_array_length(private.go_live_conditions('mental_health_worklist_enabled', null))::text);
  perform pg_temp.ck('the share guard has three conditions', '3', jsonb_array_length(private.go_live_conditions('wellbeing_summary_share_enabled', null))::text);
  perform pg_temp.ck('the calm tool guard has three conditions', '3', jsonb_array_length(private.go_live_conditions('panic_tool_enabled', null))::text);
  perform pg_temp.ck('the patterns guard has two conditions', '2', jsonb_array_length(private.go_live_conditions('mood_insights_enabled', null))::text);
  perform pg_temp.ck('the attestable list carries the seven new conditions', '7',
    (select count(*)::text from unnest(array['worklist_cover_confirmed', 'share_cover_confirmed', 'panic_wording_signed', 'panic_accessibility_checked', 'insights_wording_signed', 'worklist_notice_wording_signed', 'share_wording_signed']) c
      where pg_get_functiondef('public.attest_go_live_condition(text,text,boolean,text)'::regprocedure) like '%' || c || '%'));
  perform pg_temp.ck('the worklist configuration v1 is born unsigned and inactive', 'true',
    exists (select 1 from public.mental_health_worklist_config where version = 1 and not is_active and approved_at is null and approved_by is null)::text);
  perform pg_temp.ck('no attestation exists that the build made', '0',
    (select count(*)::text from public.go_live_attestations where guard_key in ('mental_health_worklist_enabled', 'wellbeing_summary_share_enabled', 'panic_tool_enabled', 'mood_insights_enabled')));
  foreach fn in array array['public.list_mental_health_worklist()', 'public.count_mental_health_worklist()', 'public.create_mental_health_worklist_follow_up(uuid,text)',
    'public.share_wellbeing_summary_with_care_team(boolean,boolean,boolean,text,text)', 'public.set_worklist_activity_opt_out(boolean)', 'public.preview_wellbeing_summary(boolean,boolean,boolean)', 'public.mark_mental_health_handoff_seen(uuid)',
    'public.sign_mental_health_worklist_config(integer)', 'public.wellbeing_features_open()', 'public.set_mood_insights_hidden(boolean)'] loop
    perform pg_temp.ck('anon cannot execute ' || fn, 'false', has_function_privilege('anon', fn, 'EXECUTE')::text);
    perform pg_temp.ck('a signed-in user can execute ' || fn, 'true', has_function_privilege('authenticated', fn, 'EXECUTE')::text);
  end loop;
  foreach fn in array array['private.mh_worklist_hits(uuid,jsonb,uuid[])', 'private.mh_activity_opted_out(uuid)', 'private.s56b_share_fingerprint()', 'private.s56b_worklist_notice_fingerprint()', 'private.mh_worklist_for_caller()', 'private.build_wellbeing_summary(uuid,boolean,boolean,boolean)',
    'private.s56b_wording_ok(text,text,text,uuid)', 'private.s56b_attested_with(text,text,text)', 'private.s56b_go_live_conditions(text)', 'private.wellbeing_share_cfg()'] loop
    perform pg_temp.ck('a signed-in user cannot execute ' || fn, 'false', has_function_privilege('authenticated', fn, 'EXECUTE')::text);
  end loop;
  perform pg_temp.ck('the actions table has no table privilege for a signed-in user', 'false', has_table_privilege('authenticated', 'public.mental_health_worklist_actions', 'SELECT')::text);
  perform pg_temp.ck('the count cache is not readable either', 'false', has_table_privilege('authenticated', 'public.mental_health_worklist_count_cache', 'SELECT')::text);
  perform pg_temp.ck('a hand-off''s seen_by is not readable by a signed-in user (a supporter with the consent must not learn who handled it)', 'false', has_column_privilege('authenticated', 'public.mental_health_handoffs', 'seen_by', 'SELECT')::text);
  perform pg_temp.ck('...while seen_at is', 'true', has_column_privilege('authenticated', 'public.mental_health_handoffs', 'seen_at', 'SELECT')::text);
  perform pg_temp.ck('...and no policy at all', '0', (select count(*)::text from pg_policies where tablename = 'mental_health_worklist_actions'));
end $$;

-- 1. Every guard is closed for a real person --------------------------------------------------------------------------------------
do $$
declare r uuid := pg_temp.f('R');
begin
  perform pg_temp.ck('a real patient: the share preview is refused while the guard is off', 'true',
    (pg_temp.q_as(r, 'select public.preview_wellbeing_summary(true, true, true)::text') like 'ERR:feature_not_open%')::text);
  perform pg_temp.ck('a real patient: sending is refused while the guard is off', 'true',
    (pg_temp.q_as(r, $q$select public.share_wellbeing_summary_with_care_team(true, false, false, 'hello', 'x')::text$q$) like 'ERR:feature_not_open%')::text);
  perform pg_temp.ck('a real patient: nothing is open', '{"panic": false, "share": false, "insights": false, "worklist": false, "insights_hidden": false, "worklist_activity_opt_out": false}',
    pg_temp.q_as(r, 'select public.wellbeing_features_open()::text'));
  perform pg_temp.ck('a test patient is open for the share while the guard is off (the test-account rule)', 'true',
    (pg_temp.q_as(pg_temp.f('A'), 'select (public.wellbeing_features_open() ->> ''share'')') = 'true')::text);
  perform pg_temp.ck('a clinician sees no feature as open', '{"panic": false, "share": false, "insights": false, "worklist": false, "insights_hidden": false, "worklist_activity_opt_out": false}',
    pg_temp.q_as(pg_temp.f('doctied'), 'select public.wellbeing_features_open()::text'));
  perform pg_temp.ck('anon is refused at the features question', '42501', pg_temp.try_anon('select public.wellbeing_features_open()'));
  perform pg_temp.ck('a real clinician: the worklist is off', 'off', pg_temp.names(pg_temp.f('realdoc')));
  perform pg_temp.ck('...and counts 0', '0', pg_temp.q_as(pg_temp.f('realdoc'), 'select public.count_mental_health_worklist()::text'));
end $$;

-- 2. Share with my care team: only what was chosen, never a note, a tag or an item answer -----------------------------------------------
do $$
declare
  v_hash text; a uuid := pg_temp.f('A'); v_prev jsonb; v_h uuid; v_h2 uuid; v_stored jsonb; v_before integer; v_text text;
begin
  perform pg_temp.guard('wellbeing_summary_share_enabled', true);
  select count(*) into v_before from public.mental_health_handoffs where patient_id = a;
  v_prev := pg_temp.q_as(a, 'select public.preview_wellbeing_summary(true, true, true)::text')::jsonb;
  v_hash := v_prev ->> 'hash';
  v_prev := v_prev -> 'summary';
  perform pg_temp.ck('preview writes nothing', v_before::text, (select count(*)::text from public.mental_health_handoffs where patient_id = a));
  perform pg_temp.ck('preview: the latest PHQ-9 and the raw change', '14|6', (v_prev -> 'screens' -> 0 -> 'points' -> 0 ->> 'total') || '|' || (v_prev -> 'screens' -> 0 ->> 'change_since_previous'));
  perform pg_temp.ck('preview: the GAD-7 is there too', 'gad7', v_prev -> 'screens' -> 1 ->> 'instrument');
  perform pg_temp.ck('preview: weekly check-in means', 'true', (jsonb_array_length(v_prev -> 'check_ins') >= 1)::text);
  perform pg_temp.ck('preview: sleep highlights', '5', v_prev -> 'sleep' ->> 'entries');
  v_text := v_prev::text;
  perform pg_temp.ck('the summary carries no check-in note', 'false', (v_text like '%NOTESECRET%')::text);
  perform pg_temp.ck('...no sleep note', 'false', (v_text like '%SLEEPNOTESECRET%')::text);
  perform pg_temp.ck('...no questionnaire item answer', 'false', (v_text like '%ITEMSECRET%' or v_text like '%"q9"%' or v_text like '%item_responses%')::text);
  perform pg_temp.ck('...no tag', 'false', (v_text like '%"work"%' or v_text like '%tags%')::text);
  perform pg_temp.ck('...nothing named journal', 'false', (v_text ilike '%journal%')::text);
  perform pg_temp.ck('only the chosen section is present (scores alone)', 'true',
    (select (s ? 'screens') and not (s ? 'check_ins') and not (s ? 'sleep') from (select pg_temp.q_as(a, 'select (public.preview_wellbeing_summary(true, false, false) -> ''summary'')::text')::jsonb s) x)::text);
  perform pg_temp.ck('nothing is chosen by default: the function defaults add no section', 'true',
    (select not (s ? 'screens') and not (s ? 'check_ins') and not (s ? 'sleep') from (select pg_temp.q_as(a, 'select (public.preview_wellbeing_summary() -> ''summary'')::text')::jsonb s) x)::text);
  perform pg_temp.ck('sending nothing at all is refused', 'true', (pg_temp.q_as(a, 'select public.share_wellbeing_summary_with_care_team()::text') like 'ERR:nothing to share%')::text);
  perform pg_temp.ck('a note that is too long is refused', 'true',
    (pg_temp.q_as(a, format('select public.share_wellbeing_summary_with_care_team(false, false, false, %L)::text', repeat('x', 501))) like 'ERR:note too long%')::text);
  perform pg_temp.ck('a note alone is enough', 'true',
    (pg_temp.share(pg_temp.f('B'), false, false, false, 'I want to talk about sleep') !~ '^ERR')::text);
  -- the preview is bound to the send (a changed entry, a missing or a wrong hash are all refused and nothing is stored)
  perform pg_temp.ck('sending without the preview''s hash is refused', 'true',
    (pg_temp.q_as(a, $q$select public.share_wellbeing_summary_with_care_team(true, true, true, 'x')::text$q$) like 'ERR:summary_changed%')::text);
  perform pg_temp.ck('sending with the wrong hash is refused', 'true',
    (pg_temp.q_as(a, $q$select public.share_wellbeing_summary_with_care_team(true, true, true, 'x', 'deadbeef')::text$q$) like 'ERR:summary_changed%')::text);
  insert into public.wellbeing_checkins (organisation_id, patient_id, mood_score, stress_score, sleep_quality, activity_level, checked_in_at) values (pg_temp.f('org'), a, 5, 1, 5, 5, now() - interval '1 hour');
  perform pg_temp.ck('an entry that changed after the preview makes the old hash fail', 'true',
    (pg_temp.q_as(a, format($q$select public.share_wellbeing_summary_with_care_team(true, true, true, 'x', %L)::text$q$, v_hash)) like 'ERR:summary_changed%')::text);
  perform pg_temp.ck('...and nothing was stored', '0', (select count(*)::text from public.mental_health_handoffs where patient_id = a and kind = 'doctor_summary'));
  delete from public.wellbeing_checkins where patient_id = a and checked_in_at > now() - interval '2 hours';

  v_h := pg_temp.share(a, true, true, true, 'I want to talk about work')::uuid;
  perform pg_temp.setf('hA', v_h);
  select summary into v_stored from public.mental_health_handoffs where id = v_h;
  perform pg_temp.ck('the stored summary is the previewed one', 'true', (v_stored = v_prev)::text);
  perform pg_temp.ck('it is a doctor summary, open, with the patient''s own words', 'doctor_summary|open|I want to talk about work',
    (select kind || '|' || state || '|' || patient_note from public.mental_health_handoffs where id = v_h));
  perform pg_temp.ck('a real clinical task was made', 'admin_clinical', (select type from public.clinical_tasks where id = (select task_id from public.mental_health_handoffs where id = v_h)));
  perform pg_temp.ck('...its key is random and names neither a summary nor the patient', 'true',
    (select (dedup_key ~ '^mhs:[0-9a-f-]{36}$' and dedup_key not like '%' || a::text || '%')::text from public.clinical_tasks where id = (select task_id from public.mental_health_handoffs where id = v_h)));
  perform pg_temp.ck('the event was emitted (no event error was written)', '0', (select count(*)::text from public.audit_log where action = 'wellbeing_summary_event.error' and entity_id = v_h));
  perform pg_temp.ck('the same summary sent again returns the same hand-off', v_h::text,
    pg_temp.share(a, true, true, true, 'I want to talk about work'));
  perform pg_temp.ck('...and raises no second task', '1', (select count(*)::text from public.clinical_tasks where id in (select task_id from public.mental_health_handoffs where patient_id = a and kind = 'doctor_summary')));
  -- the "tell my care team" request is its own kind
  v_h2 := pg_temp.q_as(a, $q$select public.request_mental_health_handoff(null, 'a very anxious moment')::text$q$)::uuid;
  perform pg_temp.ck('a request to talk has its own kind', 'talk_request', (select kind from public.mental_health_handoffs where id = v_h2));
  perform pg_temp.ck('...and a repeat within ten minutes returns the same one', v_h2::text, pg_temp.q_as(a, $q$select public.request_mental_health_handoff(null, 'again')::text$q$));
  perform pg_temp.setf('hS', pg_temp.q_as(a, format($q$select public.request_mental_health_handoff(%L)::text$q$, (select id from public.mental_health_screens where patient_id = a and instrument = 'phq9' order by created_at desc limit 1)))::uuid);
  perform pg_temp.ck('a screen hand-off keeps the old kind', 'screen', (select kind from public.mental_health_handoffs where id = pg_temp.f('hS')));
  -- who can send and who can read
  perform pg_temp.ck('a clinician cannot send a patient summary', 'true', (pg_temp.q_as(pg_temp.f('doctied'), 'select public.share_wellbeing_summary_with_care_team(true, false, false, null, ''x'')::text') like 'ERR:not authorised%')::text);
  perform pg_temp.ck('anon cannot send', '42501', pg_temp.try_anon('select public.share_wellbeing_summary_with_care_team(true)'));
  perform pg_temp.ck('another patient cannot read the hand-off table', '0', pg_temp.q_as(pg_temp.f('D'), 'select count(*)::text from public.mental_health_handoffs'));
  perform pg_temp.ck('the tied clinician cannot read the hand-off table directly', '0', pg_temp.q_as(pg_temp.f('doctied'), 'select count(*)::text from public.mental_health_handoffs'));
  perform pg_temp.ck('the patient cannot read seen_by', 'true', (pg_temp.q_as(a, 'select seen_by::text from public.mental_health_handoffs limit 1') like 'ERR:permission denied%')::text);
  perform pg_temp.ck('the patient reads their own hand-offs', '3', pg_temp.q_as(a, 'select count(*)::text from public.mental_health_handoffs'));
end $$;

-- 3. Staff read a summary only through the audited function ----------------------------------------------------------------------------
do $$
declare a uuid := pg_temp.f('A'); r text; q text;
begin
  q := format($q$select public.read_patient_mental_health_audited(%L, 'reading the shared summary', array['handoffs'])::text$q$, a);
  r := pg_temp.q_as(pg_temp.f('doctied'), q);
  perform pg_temp.ck('the tied clinician reads the summary', 'doctor_summary|open', (r::jsonb -> 'handoffs' -> 0 ->> 'kind') || '|' || (r::jsonb -> 'handoffs' -> 0 ->> 'state'));
  perform pg_temp.ck('...with the scores inside', '14', r::jsonb -> 'handoffs' -> 0 -> 'summary' -> 'screens' -> 0 -> 'points' -> 0 ->> 'total');
  perform pg_temp.ck('...and it is audited as a success', '1', pg_temp.n_audit(pg_temp.f('doctied'), 'success', 'handoffs'));
  perform pg_temp.ck('an untied clinician is denied', 'denied', (pg_temp.q_as(pg_temp.f('docuntied'), q)::jsonb) ->> 'status');
  perform pg_temp.ck('...and the refusal is audited', '1', pg_temp.n_audit(pg_temp.f('docuntied'), 'denied', 'handoffs'));
  perform pg_temp.ck('a care coordinator, even tied, is denied', 'denied', (pg_temp.q_as(pg_temp.f('coord'), q)::jsonb) ->> 'status');
  perform pg_temp.ck('the CMO without a tie is denied', 'denied', (pg_temp.q_as(pg_temp.f('cmo'), q)::jsonb) ->> 'status');
  perform pg_temp.ck('an admin is denied', 'true', (pg_temp.q_as(pg_temp.f('admin'), q) like 'ERR:%' or (pg_temp.q_as(pg_temp.f('admin'), q)::jsonb ->> 'status') = 'denied')::text);
  perform pg_temp.ck('finance is denied', 'true', (pg_temp.q_as(pg_temp.f('finance'), q) like 'ERR:%' or (pg_temp.q_as(pg_temp.f('finance'), q)::jsonb ->> 'status') = 'denied')::text);
  perform pg_temp.ck('another patient is refused', 'true', (pg_temp.q_as(pg_temp.f('D'), q) like 'ERR:not authorised%')::text);
  perform pg_temp.ck('the patient reads their own summary with no audit row', 'ok', (pg_temp.q_as(a, q)::jsonb) ->> 'status');
  -- marking seen
  perform pg_temp.ck('an untied clinician cannot mark it seen (null, audited)', '',
    coalesce(pg_temp.q_as(pg_temp.f('docuntied'), format('select public.mark_mental_health_handoff_seen(%L)::text', pg_temp.f('hA'))), ''));
  perform pg_temp.ck('a coordinator cannot mark it seen', '', coalesce(pg_temp.q_as(pg_temp.f('coord'), format('select public.mark_mental_health_handoff_seen(%L)::text', pg_temp.f('hA'))), ''));
  perform pg_temp.ck('the patient cannot mark it seen', '', coalesce(pg_temp.q_as(a, format('select public.mark_mental_health_handoff_seen(%L)::text', pg_temp.f('hA'))), ''));
  perform pg_temp.ck('it is still open after those', 'open', (select state from public.mental_health_handoffs where id = pg_temp.f('hA')));
  perform pg_temp.ck('anon cannot mark it seen', '42501', pg_temp.try_anon(format('select public.mark_mental_health_handoff_seen(%L)', pg_temp.f('hA'))));
end $$;

-- 4. The worklist: nothing until the CMO signs ----------------------------------------------------------------------------------------
do $$
begin
  perform pg_temp.guard('mental_health_worklist_enabled', true);
  perform pg_temp.ck('guard on, rules unsigned: the tied clinician is told so and sees no row', 'not_signed', pg_temp.names(pg_temp.f('doctied')));
  perform pg_temp.ck('...and the count is 0', '0', pg_temp.q_as(pg_temp.f('doctied'), 'select public.count_mental_health_worklist()::text'));
  perform pg_temp.ck('a plain clinician cannot sign the rules', '42501', pg_temp.try_as(pg_temp.f('doctied'), 'select public.sign_mental_health_worklist_config(1)'));
  perform pg_temp.ck('an admin cannot sign the rules', '42501', pg_temp.try_as(pg_temp.f('admin'), 'select public.sign_mental_health_worklist_config(1)'));
  perform pg_temp.ck('a patient cannot sign the rules', '42501', pg_temp.try_as(pg_temp.f('A'), 'select public.sign_mental_health_worklist_config(1)'));
  perform pg_temp.ck('anon cannot sign the rules', '42501', pg_temp.try_anon('select public.sign_mental_health_worklist_config(1)'));
  perform pg_temp.ck('the rules are still unsigned', 'false', exists (select 1 from public.mental_health_worklist_config where approved_at is not null)::text);
  perform pg_temp.ck('a plain clinician cannot read the rule table', '0', pg_temp.q_as(pg_temp.f('doctied'), 'select count(*)::text from public.mental_health_worklist_config'));
  perform pg_temp.ck('the CMO can read it', '1', pg_temp.q_as(pg_temp.f('cmo'), 'select count(*)::text from public.mental_health_worklist_config'));
  perform pg_temp.ck('the CMO signs version 1', 'ok', pg_temp.try_as(pg_temp.f('cmo'), 'select public.sign_mental_health_worklist_config(1)'));
  perform pg_temp.ck('...which is now active and signed by the CMO', 'true',
    exists (select 1 from public.mental_health_worklist_config where version = 1 and is_active and approved_at is not null and approved_by = pg_temp.f('cmo'))::text);
  perform pg_temp.ck('signing again is refused', '23514', pg_temp.try_as(pg_temp.f('cmo'), 'select public.sign_mental_health_worklist_config(1)'));
  perform pg_temp.ck('the signature is written to the audit log', '1', (select count(*)::text from public.audit_log where action = 'mental_health_worklist_config.signed'));
  begin update public.mental_health_worklist_config set rules = rules || '{"max_rows": 5}' where version = 1; perform pg_temp.ck('a signed rule set cannot be edited', 'refused', 'edited');
  exception when others then perform pg_temp.ck('a signed rule set cannot be edited', 'refused', 'refused'); end;
  begin delete from public.mental_health_worklist_config where version = 1; perform pg_temp.ck('a rule set is never deleted', 'refused', 'deleted');
  exception when others then perform pg_temp.ck('a rule set is never deleted', 'refused', 'refused'); end;
  begin insert into public.mental_health_worklist_config (version, is_active, effective_from, rules, approved_at, approved_by)
          select 2, true, current_date, rules, now(), pg_temp.f('cmo') from public.mental_health_worklist_config where version = 1;
        perform pg_temp.ck('a rule set cannot be created signed', 'refused', 'created');
  exception when others then perform pg_temp.ck('a rule set cannot be created signed', 'refused', 'refused'); end;
  perform pg_temp.ck('the first draft ships the check-ins-stopped rule disabled', 'false', (select (rules #>> '{missed_checkins,enabled}') from public.mental_health_worklist_config where version = 1));
  perform pg_temp.ck('with v1 signed C (check-ins stopped) is not on the list, A and B are', 'A,B', pg_temp.names(pg_temp.f('doctied')));
  -- the rule code is still there: a later signed version may enable it (v2 = v1 with the rule on) and C appears
  insert into public.mental_health_worklist_config (version, effective_from, rules)
    select 2, current_date, jsonb_set(rules, '{missed_checkins,enabled}', 'true') from public.mental_health_worklist_config where version = 1;
  perform pg_temp.ck('the CMO signs version 2 (rule enabled)', 'ok', pg_temp.try_as(pg_temp.f('cmo'), 'select public.sign_mental_health_worklist_config(2)'));
  perform pg_temp.ck('...and now C appears', 'A,B,C', pg_temp.names(pg_temp.f('doctied')));
  begin insert into public.mental_health_worklist_config (version, effective_from, rules) values (9, current_date, '{"max_rows": 0}');
        perform pg_temp.ck('rules that are not valid are refused', 'refused', 'created');
  exception when others then perform pg_temp.ck('rules that are not valid are refused', 'refused', 'refused'); end;
end $$;

-- 5. The worklist: who sees what -------------------------------------------------------------------------------------------------------
do $$
declare v jsonb; r jsonb; n integer;
begin
  perform pg_temp.ck('the tied clinician sees A, B and C and not the controls, the sleep-only patient F or the untied patient', 'A,B,C', pg_temp.names(pg_temp.f('doctied')));
  perform pg_temp.ck('...the count agrees and is only a number', '3', pg_temp.q_as(pg_temp.f('doctied'), 'select public.count_mental_health_worklist()::text'));
  perform pg_temp.ck('the other clinician sees only the patient tied to them', 'E', pg_temp.names(pg_temp.f('docuntied')));
  perform pg_temp.ck('...count 1', '1', pg_temp.q_as(pg_temp.f('docuntied'), 'select public.count_mental_health_worklist()::text'));
  -- break-glass: an emergency grant still opens ONE patient's record (2026-10-07 decision) but never puts a patient on a list
  insert into public.emergency_record_access_grants (requester_id, requester_org_id, patient_id, patient_org_id, reason, expires_at)
    values (pg_temp.f('docuntied'), pg_temp.f('org'), pg_temp.f('A'), pg_temp.f('org'), 'proof break-glass', now() + interval '1 hour');
  perform pg_temp.ck('an emergency grant still opens the individual record (audited)', 'ok',
    pg_temp.q_as(pg_temp.f('docuntied'), format($q$select (public.read_patient_mental_health_audited(%L, 'emergency access in progress', array['screens']))->>'status'$q$, pg_temp.f('A'))));
  perform pg_temp.ck('...but the list stays tied-only: the grant does not add A to it', 'E', pg_temp.names(pg_temp.f('docuntied')));
  perform pg_temp.ck('...and the count stays 1', '1', pg_temp.q_as(pg_temp.f('docuntied'), 'select public.count_mental_health_worklist()::text'));
  update public.emergency_record_access_grants set ended_at = now() where requester_id = pg_temp.f('docuntied');
  perform pg_temp.ck('an ended grant opens nothing', 'denied',
    pg_temp.q_as(pg_temp.f('docuntied'), format($q$select (public.read_patient_mental_health_audited(%L, 'emergency access in progress', array['screens']))->>'status'$q$, pg_temp.f('A'))));
  perform pg_temp.ck('the CMO without a tie sees nobody (a clinician is not a free pass)', '', pg_temp.names(pg_temp.f('cmo')));
  perform pg_temp.ck('...count 0', '0', pg_temp.q_as(pg_temp.f('cmo'), 'select public.count_mental_health_worklist()::text'));
  perform pg_temp.ck('a care coordinator tied to A is refused the list', 'true', (pg_temp.names(pg_temp.f('coord')) like 'ERR:not authorised%')::text);
  perform pg_temp.ck('...and the count is 0', '0', pg_temp.q_as(pg_temp.f('coord'), 'select public.count_mental_health_worklist()::text'));
  perform pg_temp.ck('an admin is refused the list', 'true', (pg_temp.names(pg_temp.f('admin')) like 'ERR:not authorised%')::text);
  perform pg_temp.ck('finance is refused the list', 'true', (pg_temp.names(pg_temp.f('finance')) like 'ERR:not authorised%')::text);
  perform pg_temp.ck('an analyst is refused the list', 'true', (pg_temp.names(pg_temp.f('analyst')) like 'ERR:not authorised%')::text);
  perform pg_temp.ck('a patient is refused the list', 'true', (pg_temp.names(pg_temp.f('A')) like 'ERR:not authorised%')::text);
  perform pg_temp.ck('anon is refused the list', '42501', pg_temp.try_anon('select public.list_mental_health_worklist()'));
  perform pg_temp.ck('anon is refused the count', '42501', pg_temp.try_anon('select public.count_mental_health_worklist()'));
  -- the reasons and the numbers behind them
  v := pg_temp.worklist(pg_temp.f('doctied'));
  select x into r from jsonb_array_elements(v -> 'rows') x where (x ->> 'patient_id')::uuid = pg_temp.f('A');
  perform pg_temp.ck('A: the PHQ-9 rise with its numbers', '8|14|6',
    (select (y -> 'facts' ->> 'from') || '|' || (y -> 'facts' ->> 'to') || '|' || (y -> 'facts' ->> 'rise') from jsonb_array_elements(r -> 'reasons') y where y ->> 'code' = 'rising_screen'));
  perform pg_temp.ck('A: only one rising reason (the GAD-7 rose by 2, below the line)', '1', (select count(*)::text from jsonb_array_elements(r -> 'reasons') y where y ->> 'code' = 'rising_screen'));
  perform pg_temp.ck('A: the shared summary is waiting only once it is old enough (not yet)', '0', (select count(*)::text from jsonb_array_elements(r -> 'reasons') y where y ->> 'code' = 'unactioned_handoff'));
  select x into r from jsonb_array_elements(v -> 'rows') x where (x ->> 'patient_id')::uuid = pg_temp.f('B');
  perform pg_temp.ck('B: sleep trouble with its numbers', '9|6', (select (y -> 'facts' ->> 'entries') || '|' || (y -> 'facts' ->> 'trouble_nights') from jsonb_array_elements(r -> 'reasons') y where y ->> 'code' = 'sleep_trouble'));
  select x into r from jsonb_array_elements(v -> 'rows') x where (x ->> 'patient_id')::uuid = pg_temp.f('C');
  perform pg_temp.ck('C: check-ins that stopped, with the count before', '9|10', (select (y -> 'facts' ->> 'prior_check_ins') || '|' || (y -> 'facts' ->> 'silent_days') from jsonb_array_elements(r -> 'reasons') y where y ->> 'code' = 'missed_checkins'));
  perform pg_temp.ck('the overdue rule is off while the screening schedule is unsigned, and the screen says why', 'true',
    ((v -> 'notes') ? 'overdue_off_cadence_unsigned' and not exists (select 1 from jsonb_array_elements(v -> 'rows') x, jsonb_array_elements(x -> 'reasons') y where y ->> 'code' = 'overdue_screen'))::text);
  update public.mental_health_screening_cadences set approved_at = now(), approved_by = pg_temp.staff_id(pg_temp.f('cmo')) where is_active;
  v := pg_temp.worklist(pg_temp.f('doctied'));
  perform pg_temp.ck('once the schedule is signed, A''s overdue PHQ-9 appears', '1',
    (select count(*)::text from jsonb_array_elements(v -> 'rows') x, jsonb_array_elements(x -> 'reasons') y where (x ->> 'patient_id')::uuid = pg_temp.f('A') and y ->> 'code' = 'overdue_screen' and y -> 'facts' ->> 'instrument' = 'phq9'));
  perform pg_temp.ck('...and the note is gone', 'false', ((v -> 'notes') ? 'overdue_off_cadence_unsigned')::text);
  perform pg_temp.ck('...and nobody else is overdue', '1', (select count(*)::text from jsonb_array_elements(v -> 'rows') x, jsonb_array_elements(x -> 'reasons') y where y ->> 'code' = 'overdue_screen'));
  -- a hand-off nobody has seen for two days
  update public.mental_health_handoffs set created_at = now() - interval '3 days' where id = pg_temp.f('hA');
  v := pg_temp.worklist(pg_temp.f('doctied'));
  perform pg_temp.ck('a hand-off waiting three days puts A first', 'A', (select k from jsonb_array_elements(v -> 'rows') with ordinality x(j, o) join fx on fx.v = (j ->> 'patient_id')::uuid order by o limit 1));
  perform pg_temp.ck('...with the hours it has waited', 'true', (select ((y -> 'facts' ->> 'hours_waiting')::integer >= 72)::text from jsonb_array_elements(v -> 'rows') x, jsonb_array_elements(x -> 'reasons') y where y ->> 'code' = 'unactioned_handoff' limit 1));
  perform pg_temp.ck('marking it seen as the tied clinician works', 'true', pg_temp.q_as(pg_temp.f('doctied'), format('select public.mark_mental_health_handoff_seen(%L)::text', pg_temp.f('hA'))));
  perform pg_temp.ck('...and records who and when', 'seen|true', (select state || '|' || (seen_by = pg_temp.f('doctied') and seen_at is not null)::text from public.mental_health_handoffs where id = pg_temp.f('hA')));
  perform pg_temp.ck('...marking it again changes nothing', 'false', pg_temp.q_as(pg_temp.f('doctied'), format('select public.mark_mental_health_handoff_seen(%L)::text', pg_temp.f('hA'))));
  v := pg_temp.worklist(pg_temp.f('doctied'));
  perform pg_temp.ck('...and the waiting reason clears', '0', (select count(*)::text from jsonb_array_elements(v -> 'rows') x, jsonb_array_elements(x -> 'reasons') y where y ->> 'code' = 'unactioned_handoff'));
  -- audit: one row per patient served, with the section, in the patient's own trail; the count writes none
  select count(*) into n from public.audit_log where actor_id = pg_temp.f('doctied') and action = 'staff.mental_health_read' and event -> 'sections' ? 'worklist' and result = 'success';
  perform pg_temp.ck('every patient served is an audit row', 'true', (n >= 3)::text);
  perform pg_temp.ck('...in the patient''s own trail', '0', (select count(*)::text from public.audit_log where actor_id = pg_temp.f('doctied') and event -> 'sections' ? 'worklist' and subject_patient_id is null));
  perform pg_temp.ck('...none for the controls', '0', (select count(*)::text from public.audit_log where actor_id = pg_temp.f('doctied') and event -> 'sections' ? 'worklist' and subject_patient_id in (pg_temp.f('D'), pg_temp.f('E'))));
  perform pg_temp.ck('a refused list writes no patient audit row for the coordinator', '0', pg_temp.n_audit(pg_temp.f('coord'), 'success', 'worklist'));
  perform pg_temp.ck('...nor for the CMO with nobody tied', '0', pg_temp.n_audit(pg_temp.f('cmo'), 'success', 'worklist'));
end $$;

-- 5b. The count is kept briefly (a bare number), and the patient's opt-out removes the two activity rules only ------------------------------------
do $$
begin
  delete from public.mental_health_worklist_count_cache;
  perform pg_temp.ck('the count is worked out and kept', '3', pg_temp.q_as(pg_temp.f('doctied'), 'select public.count_mental_health_worklist()::text'));
  perform pg_temp.ck('...as a bare number for that clinician only', '3|1', (select n::text from public.mental_health_worklist_count_cache where clinician_id = pg_temp.f('doctied')) || '|' || (select count(*)::text from public.mental_health_worklist_count_cache));
  update public.mental_health_worklist_count_cache set n = 99 where clinician_id = pg_temp.f('doctied');
  perform pg_temp.ck('inside the window the kept number is served', '99', pg_temp.q_as(pg_temp.f('doctied'), 'select public.count_mental_health_worklist()::text'));
  update public.mental_health_worklist_count_cache set computed_at = now() - interval '1 hour' where clinician_id = pg_temp.f('doctied');
  perform pg_temp.ck('after the window it is worked out again', '3', pg_temp.q_as(pg_temp.f('doctied'), 'select public.count_mental_health_worklist()::text'));
  perform pg_temp.ck('the cache does not outlive the guard (a count is 0 for a coordinator whatever is kept)', '0', pg_temp.q_as(pg_temp.f('coord'), 'select public.count_mental_health_worklist()::text'));
  -- opt-out
  perform pg_temp.ck('C opts out of the activity rules', 'ok', pg_temp.try_as(pg_temp.f('C'), 'select public.set_worklist_activity_opt_out(true)'));
  perform pg_temp.ck('B opts out too', 'ok', pg_temp.try_as(pg_temp.f('B'), 'select public.set_worklist_activity_opt_out(true)'));
  perform pg_temp.ck('A opts out (A is on the list for a score, which the opt-out does not touch)', 'ok', pg_temp.try_as(pg_temp.f('A'), 'select public.set_worklist_activity_opt_out(true)'));
  perform pg_temp.ck('...C and B leave the list; A stays', 'A', pg_temp.names(pg_temp.f('doctied')));
  perform pg_temp.ck('the features question reports the choice', 'true', (pg_temp.q_as(pg_temp.f('C'), 'select public.wellbeing_features_open()::text')::jsonb ->> 'worklist_activity_opt_out'));
  perform pg_temp.ck('a clinician cannot set a patient''s opt-out', 'true', (pg_temp.try_as(pg_temp.f('doctied'), 'select public.set_worklist_activity_opt_out(true)') <> 'ok')::text);
  perform pg_temp.ck('anon cannot', '42501', pg_temp.try_anon('select public.set_worklist_activity_opt_out(true)'));
  perform pg_temp.try_as(pg_temp.f('C'), 'select public.set_worklist_activity_opt_out(false)');
  perform pg_temp.try_as(pg_temp.f('B'), 'select public.set_worklist_activity_opt_out(false)');
  perform pg_temp.try_as(pg_temp.f('A'), 'select public.set_worklist_activity_opt_out(false)');
  perform pg_temp.ck('...and back on when they change their mind', 'A,B,C', pg_temp.names(pg_temp.f('doctied')));
  delete from public.mental_health_worklist_count_cache;
end $$;

-- 6. A follow-up from the worklist is a real task ----------------------------------------------------------------------------------------
do $$
declare t text; v jsonb; a uuid := pg_temp.f('A'); v_task uuid;
begin
  -- a questionnaire hand-off nobody marked seen, waiting three days: it pins A to the top until someone acts
  update public.mental_health_handoffs set created_at = now() - interval '3 days' where id = pg_temp.f('hS');
  v := pg_temp.worklist(pg_temp.f('doctied'));
  perform pg_temp.ck('a waiting questionnaire hand-off is a reason', 'screen', (select y -> 'facts' ->> 'kind' from jsonb_array_elements(v -> 'rows') x, jsonb_array_elements(x -> 'reasons') y where (x ->> 'patient_id')::uuid = a and y ->> 'code' = 'unactioned_handoff'));
  t := pg_temp.q_as(pg_temp.f('doctied'), format($q$select public.create_mental_health_worklist_follow_up(%L, 'rising score, please call')::text$q$, a));
  perform pg_temp.ck('the tied clinician makes a follow-up for A', 'true', (t !~ '^ERR' and t is not null)::text);
  v_task := t::uuid;
  perform pg_temp.ck('it is a real task of the hand-off type, not a plan-gated doctor-time review', 'admin_clinical', (select type from public.clinical_tasks where id = v_task));
  perform pg_temp.ck('...with a random key that names neither the worklist nor the patient', 'true', (select (dedup_key ~ '^mhw:[0-9a-f-]{36}$' and dedup_key not like '%' || a::text || '%')::text from public.clinical_tasks where id = v_task));
  perform pg_temp.ck('...no task key anywhere carries the old readable forms', '0', (select count(*)::text from public.clinical_tasks where dedup_key like 'mh_worklist:%' or dedup_key like 'mh_summary:%'));
  perform pg_temp.ck('...with a due time in the future (the signed rules say 72 hours)', 'true', (select (due_at > now() + interval '1 hour')::text from public.clinical_tasks where id = v_task));
  perform pg_temp.ck('...and an action row records who, which rules and the reasons', 'doctied|2',
    (select case when clinician_id = pg_temp.f('doctied') then 'doctied' end || '|' || config_version from public.mental_health_worklist_actions where patient_id = a));
  perform pg_temp.ck('...the reasons are kept as codes', 'true', (select (reasons @> array['rising_screen'])::text from public.mental_health_worklist_actions where patient_id = a));
  perform pg_temp.ck('...the event was emitted (no event error was written)', '0', (select count(*)::text from public.audit_log where action = 'mh_worklist_event.error'));
  perform pg_temp.ck('...every hand-off still waiting for A is now marked seen by the clinician who acted', 'doctied|0',
    (select case when bool_and(seen_by = pg_temp.f('doctied')) then 'doctied' else 'other' end from public.mental_health_handoffs where patient_id = a and seen_at is not null and created_at > now() - interval '4 days') || '|' || (select count(*)::text from public.mental_health_handoffs where patient_id = a and state = 'open'));
  perform pg_temp.ck('...so the waiting reason clears for A', '0', (select count(*)::text from jsonb_array_elements(pg_temp.worklist(pg_temp.f('doctied')) -> 'rows') x, jsonb_array_elements(x -> 'reasons') y where (x ->> 'patient_id')::uuid = a and y ->> 'code' = 'unactioned_handoff'));
  perform pg_temp.ck('...and the follow-up is audited', 'true', (pg_temp.n_audit(pg_temp.f('doctied'), 'success', 'worklist_follow_up')::integer >= 1)::text);
  v := pg_temp.worklist(pg_temp.f('doctied'));
  perform pg_temp.ck('A stays on the list, marked as followed up (nothing is hidden)', 'true',
    (select (x ->> 'followed_up_at') is not null from jsonb_array_elements(v -> 'rows') x where (x ->> 'patient_id')::uuid = a)::text);
  perform pg_temp.ck('...and is listed after the patients who have not been followed up', 'A', (select k2 from jsonb_array_elements(v -> 'rows') with ordinality x(j, o) join (select k as k2, fx.v from fx) f on f.v = (j ->> 'patient_id')::uuid order by o desc limit 1));
  perform pg_temp.ck('the same clinician again the same day gets the same task', v_task::text, pg_temp.q_as(pg_temp.f('doctied'), format($q$select public.create_mental_health_worklist_follow_up(%L)::text$q$, a)));
  perform pg_temp.ck('...and no second action row was written', '1', (select count(*)::text from public.mental_health_worklist_actions where patient_id = a));
  -- refusals
  perform pg_temp.ck('an untied clinician gets nothing (null), audited as denied', '',
    coalesce(pg_temp.q_as(pg_temp.f('docuntied'), format($q$select public.create_mental_health_worklist_follow_up(%L)::text$q$, a)), ''));
  perform pg_temp.ck('...the refusal is audited', '1', pg_temp.n_audit(pg_temp.f('docuntied'), 'denied', 'worklist_follow_up'));
  perform pg_temp.ck('a care coordinator gets nothing', '', coalesce(pg_temp.q_as(pg_temp.f('coord'), format($q$select public.create_mental_health_worklist_follow_up(%L)::text$q$, a)), ''));
  perform pg_temp.ck('the CMO without a tie gets nothing', '', coalesce(pg_temp.q_as(pg_temp.f('cmo'), format($q$select public.create_mental_health_worklist_follow_up(%L)::text$q$, a)), ''));
  perform pg_temp.ck('an admin gets nothing', '', coalesce(pg_temp.q_as(pg_temp.f('admin'), format($q$select public.create_mental_health_worklist_follow_up(%L)::text$q$, a)), ''));
  perform pg_temp.ck('a patient gets nothing', '', coalesce(pg_temp.q_as(pg_temp.f('D'), format($q$select public.create_mental_health_worklist_follow_up(%L)::text$q$, a)), ''));
  perform pg_temp.ck('anon is refused', '42501', pg_temp.try_anon(format($q$select public.create_mental_health_worklist_follow_up(%L)$q$, a)));
  perform pg_temp.ck('a tied patient who is NOT on the list cannot be followed up from it', 'true',
    (pg_temp.q_as(pg_temp.f('doctied'), format($q$select public.create_mental_health_worklist_follow_up(%L)::text$q$, pg_temp.f('D'))) like 'ERR:that patient is not on your worklist%')::text);
  perform pg_temp.ck('a note over 300 characters is refused', 'true',
    (pg_temp.q_as(pg_temp.f('doctied'), format('select public.create_mental_health_worklist_follow_up(%L, %L)::text', pg_temp.f('B'), repeat('y', 301))) like 'ERR:note too long%')::text);
  perform pg_temp.ck('no task was made for the untied patient', '0', (select count(*)::text from public.mental_health_worklist_actions where patient_id = pg_temp.f('E')));
  -- the table behind it
  perform pg_temp.ck('nobody can read the count cache', 'true', (pg_temp.q_as(pg_temp.f('doctied'), 'select count(*)::text from public.mental_health_worklist_count_cache') like 'ERR:permission denied%')::text);
  perform pg_temp.ck('the tied clinician cannot read the actions table', 'true', (pg_temp.q_as(pg_temp.f('doctied'), 'select count(*)::text from public.mental_health_worklist_actions') like 'ERR:permission denied%')::text);
  perform pg_temp.ck('the admin cannot read the actions table', 'true', (pg_temp.q_as(pg_temp.f('admin'), 'select count(*)::text from public.mental_health_worklist_actions') like 'ERR:permission denied%')::text);
  perform pg_temp.ck('the patient cannot read the actions table', 'true', (pg_temp.q_as(a, 'select count(*)::text from public.mental_health_worklist_actions') like 'ERR:permission denied%')::text);
  perform pg_temp.ck('nobody can write it directly', 'true', (pg_temp.q_as(pg_temp.f('doctied'), format($q$insert into public.mental_health_worklist_actions (organisation_id, patient_id, clinician_id, config_version, reasons) values (%L, %L, %L, 1, '{x}')$q$, pg_temp.f('org'), a, pg_temp.f('doctied'))) like 'ERR:permission denied%')::text);
end $$;

-- 7. A real clinician's worklist opens only when the guard is on ---------------------------------------------------------------------------
do $$
begin
  perform pg_temp.guard('mental_health_worklist_enabled', false);
  perform pg_temp.ck('with the guard off again a real clinician sees nothing', 'off', pg_temp.names(pg_temp.f('realdoc')));
  perform pg_temp.ck('...and the test clinician still sees the test patients (the test-account rule)', 'A,B,C', pg_temp.names(pg_temp.f('doctied')));
  perform pg_temp.guard('mental_health_worklist_enabled', true);
  perform pg_temp.ck('a real clinician sees the real patient once the guard is on', 'R', pg_temp.names(pg_temp.f('realdoc')));
end $$;

-- 8. The wording guards: the attestation counts only for the exact text ----------------------------------------------------------------------
do $$
declare r uuid := pg_temp.f('R'); fp text := private.s56b_panic_fingerprint(); c uuid := pg_temp.f('cmo');
  feats text := 'select public.wellbeing_features_open()::text';
begin
  perform pg_temp.guard('panic_tool_enabled', true);
  perform pg_temp.ck('guard on but not attested: a real patient does not get the calm tool', 'false', (pg_temp.q_as(r, feats)::jsonb ->> 'panic'));
  perform pg_temp.ck('a plain clinician cannot record an attestation', 'true',
    (pg_temp.try_as(pg_temp.f('doctied'), $q$select public.attest_go_live_condition('panic_tool_enabled', 'panic_wording_signed', true, 'Text fingerprint x. Read in full.')$q$) <> 'ok')::text);
  perform pg_temp.ck('a patient cannot record an attestation', 'true',
    (pg_temp.try_as(r, $q$select public.attest_go_live_condition('panic_tool_enabled', 'panic_wording_signed', true, 'Text fingerprint x. Read in full.')$q$) <> 'ok')::text);
  perform pg_temp.ck('the CMO attests the wording WITHOUT the fingerprint', 'ok',
    pg_temp.try_as(c, $q$select public.attest_go_live_condition('panic_tool_enabled', 'panic_wording_signed', true, 'I read it, it looks fine to me.')$q$));
  perform pg_temp.ck('...which does not count: the condition stays unmet', 'false',
    (select (x ->> 'met') from jsonb_array_elements(private.go_live_conditions('panic_tool_enabled', null)) x where x ->> 'code' = 'panic_wording_signed'));
  perform pg_temp.ck('...and the patient still does not get it', 'false', (pg_temp.q_as(r, feats)::jsonb ->> 'panic'));
  perform pg_temp.ck('the CMO attests with the WRONG fingerprint', 'ok',
    pg_temp.try_as(c, $q$select public.attest_go_live_condition('panic_tool_enabled', 'panic_wording_signed', true, 'Text fingerprint 000000000000. Read in full.')$q$));
  perform pg_temp.ck('...which does not count either', 'false', (pg_temp.q_as(r, feats)::jsonb ->> 'panic'));
  perform pg_temp.ck('the CMO attests with the current fingerprint', 'ok',
    pg_temp.try_as(c, format($q$select public.attest_go_live_condition('panic_tool_enabled', 'panic_wording_signed', true, %L)$q$, 'Text fingerprint ' || fp || '. Read in full.')));
  perform pg_temp.ck('...and now the condition is met', 'true',
    (select (x ->> 'met') from jsonb_array_elements(private.go_live_conditions('panic_tool_enabled', null)) x where x ->> 'code' = 'panic_wording_signed'));
  perform pg_temp.ck('...and the real patient gets the calm tool', 'true', (pg_temp.q_as(r, feats)::jsonb ->> 'panic'));
  perform pg_temp.ck('a newer attestation without the fingerprint is recorded', 'ok',
    pg_temp.try_as(c, $q$select public.attest_go_live_condition('panic_tool_enabled', 'panic_wording_signed', true, 'Re-read after an edit, fine.')$q$));
  perform pg_temp.ck('...and closes the tool again (the words are no longer vouched for)', 'false', (pg_temp.q_as(r, feats)::jsonb ->> 'panic'));
  perform pg_temp.ck('an unknown condition cannot be attested', 'true',
    (pg_temp.try_as(c, $q$select public.attest_go_live_condition('panic_tool_enabled', 'made_up_condition', true, 'Text fingerprint x. Read in full.')$q$) <> 'ok')::text);
  -- patterns: same mechanism with its own fingerprint, and the test-account rule
  perform pg_temp.guard('mood_insights_enabled', true);
  perform pg_temp.ck('patterns: guard on, not attested: closed for a real patient', 'false', (pg_temp.q_as(r, feats)::jsonb ->> 'insights'));
  perform pg_temp.ck('patterns: a test patient is open (the test-account rule)', 'true', (pg_temp.q_as(pg_temp.f('A'), feats)::jsonb ->> 'insights'));
  perform pg_temp.ck('patterns: the CMO attests with the fingerprint', 'ok',
    pg_temp.try_as(c, format($q$select public.attest_go_live_condition('mood_insights_enabled', 'insights_wording_signed', true, %L)$q$, 'Text fingerprint ' || private.s56b_insights_fingerprint() || '. Read in full.')));
  perform pg_temp.ck('patterns: ...and it opens for the real patient', 'true', (pg_temp.q_as(r, feats)::jsonb ->> 'insights'));
  perform pg_temp.ck('share: guard on, wording not attested: closed for a real patient', 'false', (pg_temp.q_as(r, feats)::jsonb ->> 'share'));
  perform pg_temp.ck('share: the CMO attests with the fingerprint', 'ok',
    pg_temp.try_as(c, format($q$select public.attest_go_live_condition('wellbeing_summary_share_enabled', 'share_wording_signed', true, %L)$q$, 'Text fingerprint ' || private.s56b_share_fingerprint() || '. Read in full.')));
  perform pg_temp.ck('share: ...and it opens', 'true', (pg_temp.q_as(r, feats)::jsonb ->> 'share'));
  perform pg_temp.ck('follow-up notice: the guard is on but the sentence is not attested, so a real patient is not told (and is not on the list either)', 'false', (pg_temp.q_as(r, feats)::jsonb ->> 'worklist'));
  perform pg_temp.ck('follow-up notice: the CMO attests with the fingerprint', 'ok',
    pg_temp.try_as(c, format($q$select public.attest_go_live_condition('mental_health_worklist_enabled', 'worklist_notice_wording_signed', true, %L)$q$, 'Text fingerprint ' || private.s56b_worklist_notice_fingerprint() || '. Read in full.')));
  perform pg_temp.ck('follow-up notice: ...and the patient is shown it', 'true', (pg_temp.q_as(r, feats)::jsonb ->> 'worklist'));
end $$;

-- 9. Hiding the patterns view is the patient's own preference -----------------------------------------------------------------------------------
do $$
declare a uuid := pg_temp.f('A');
begin
  perform pg_temp.ck('a patient hides the patterns', 'ok', pg_temp.try_as(a, 'select public.set_mood_insights_hidden(true)'));
  perform pg_temp.ck('...and the features question reports it', 'true', (pg_temp.q_as(a, 'select public.wellbeing_features_open()::text')::jsonb ->> 'insights_hidden'));
  perform pg_temp.ck('...and shows it again', 'ok', pg_temp.try_as(a, 'select public.set_mood_insights_hidden(false)'));
  perform pg_temp.ck('...which the features question reports', 'false', (pg_temp.q_as(a, 'select public.wellbeing_features_open()::text')::jsonb ->> 'insights_hidden'));
  perform pg_temp.ck('a clinician cannot set it', 'true', (pg_temp.try_as(pg_temp.f('doctied'), 'select public.set_mood_insights_hidden(true)') <> 'ok')::text);
  perform pg_temp.ck('anon cannot set it', '42501', pg_temp.try_anon('select public.set_mood_insights_hidden(true)'));
  perform pg_temp.ck('the tied clinician cannot read the preference row', '0', pg_temp.q_as(pg_temp.f('doctied'), 'select count(*)::text from public.wellbeing_checkin_preferences'));
  perform pg_temp.ck('...nor the CMO', '0', pg_temp.q_as(pg_temp.f('cmo'), 'select count(*)::text from public.wellbeing_checkin_preferences'));
  perform pg_temp.ck('the patient reads their own row', '1', pg_temp.q_as(a, 'select count(*)::text from public.wellbeing_checkin_preferences'));
end $$;

-- 10. SABOTAGE: each protection removed must flip its checks ---------------------------------------------------------------------------------------
do $$
declare v_def text; v_new text;
begin
  -- (a) the tie filter removed from the worklist
  v_def := pg_get_functiondef('private.mh_worklist_for_caller()'::regprocedure);
  v_new := replace(v_def, 'private.clinician_has_patient_access(e.pid) and ', '');
  if v_new = v_def then raise exception 'sabotage (a) did not change the function'; end if;
  execute v_new;
  -- (b) the clinician gate opened to everyone with a staff row
  execute 'create or replace function private.is_mental_health_clinician() returns boolean language sql stable security definer set search_path = '''' as $q$ select exists (select 1 from public.clinical_staff cs where cs.profile_id = (select auth.uid())) $q$';
  -- (c) the audit row removed
  execute 'create or replace function private.audit_mental_health_read(p_patient uuid, p_sections text[], p_reason text, p_result text) returns void language sql as $q$ select 1 $q$';
  -- (d) a check-in note added to the summary
  v_def := pg_get_functiondef('private.build_wellbeing_summary(uuid,boolean,boolean,boolean)'::regprocedure);
  v_new := replace(v_def, E'return v_out;', E'return v_out || jsonb_build_object(''notes'', (select jsonb_agg(note) from public.wellbeing_checkins where patient_id = p_patient));');
  if v_new = v_def then raise exception 'sabotage (d) did not change the function'; end if;
  execute v_new;
  -- (e) the actions table opened
  execute 'grant select on public.mental_health_worklist_actions to authenticated';
  execute 'create policy sabotage_open on public.mental_health_worklist_actions for select to authenticated using (true)';
  -- (f) the opt-out ignored
  execute 'create or replace function private.mh_activity_opted_out(p_patient uuid) returns boolean language sql stable security definer set search_path = '''' as $q$ select false $q$';
  -- (g) the preview hash not checked
  v_def := pg_get_functiondef('public.share_wellbeing_summary_with_care_team(boolean,boolean,boolean,text,text)'::regprocedure);
  v_new := replace(v_def, 'if p_expected_hash is null or p_expected_hash <> md5(v_sum::text) then', 'if false then');
  if v_new = v_def then raise exception 'sabotage (g) did not change the function'; end if;
  execute v_new;
  delete from public.mental_health_worklist_count_cache;
end $$;
do $$
declare v_before integer; v_after integer;
begin
  perform pg_temp.sab('(a) the tied clinician''s list still excludes the untied patient E', 'A,B,C', pg_temp.names(pg_temp.f('doctied')));
  perform pg_temp.sab('(a) the count stays 3', '3', pg_temp.q_as(pg_temp.f('doctied'), 'select public.count_mental_health_worklist()::text'));
  perform pg_temp.sab('(b) a care coordinator is still refused the list', 'true', (pg_temp.names(pg_temp.f('coord')) like 'ERR:not authorised%')::text);
  select count(*) into v_before from public.audit_log where actor_id = pg_temp.f('doctied') and action = 'staff.mental_health_read' and event -> 'sections' ? 'worklist';
  perform pg_temp.worklist(pg_temp.f('doctied'));
  select count(*) into v_after from public.audit_log where actor_id = pg_temp.f('doctied') and action = 'staff.mental_health_read' and event -> 'sections' ? 'worklist';
  perform pg_temp.sab('(c) listing the worklist still writes an audit row per patient', 'true', (v_after > v_before)::text);
  perform pg_temp.sab('(d) a preview carries no check-in note', 'false', (pg_temp.q_as(pg_temp.f('A'), 'select public.preview_wellbeing_summary(true, true, true)::text') like '%NOTESECRET%')::text);
  perform pg_temp.try_as(pg_temp.f('C'), 'select public.set_worklist_activity_opt_out(true)');
  perform pg_temp.sab('(f) a patient who opted out is not on the list for check-in silence', 'true', (pg_temp.names(pg_temp.f('doctied')) not like '%C%')::text);
  insert into public.wellbeing_checkins (organisation_id, patient_id, mood_score, stress_score, sleep_quality, activity_level, checked_in_at) values (pg_temp.f('org'), pg_temp.f('D'), 5, 1, 5, 5, now() - interval '1 hour');
  perform pg_temp.sab('(g) a send with a stale hash is refused', 'true', (pg_temp.q_as(pg_temp.f('D'), 'select public.share_wellbeing_summary_with_care_team(true, true, true, ''x'', ''stale'')::text') like 'ERR:summary_changed%')::text);
  perform pg_temp.sab('(e) the tied clinician still cannot read the actions table', 'true', (pg_temp.q_as(pg_temp.f('doctied'), 'select count(*)::text from public.mental_health_worklist_actions') like 'ERR:permission denied%')::text);
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S56b proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 8 then raise exception 'VACUOUS TEST: the sabotage flipped % of 8 checks (need 8)', v_caught; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;

rollback;
