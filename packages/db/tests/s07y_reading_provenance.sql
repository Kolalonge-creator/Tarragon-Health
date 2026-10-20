-- S07y proof: the two reading labels (pharmacy_machine, paper_diary), their guards, the bounded time rules, the home-average exclusions, and that a labelled
-- dangerous value fires exactly what an ordinary one fires (migration *_s07y_reading_provenance_pharmacy_and_paper_diary.sql).
-- One rolled-back transaction. Proves:
--  * the columns, the checks (a pharmacy reading is blood pressure only, a diary reading is blood pressure, glucose or pulse, the place needs the pharmacy label),
--    the three guards born off with the CMO's switch, AI-021 registered DISABLED and not runtime-governed;
--  * a labelled reading is refused for a real patient while its guard is off, accepted for a test account, and accepted once the guard is on; a label never rides on a
--    non-manual source (so no safety trigger that keys on source can be skipped);
--  * the time rules: a pharmacy reading keeps the ordinary 72 hour window; a diary reading keeps its stated time inside diary_window_days and is REFUSED outside it, with no
--    date, or in the future; an ordinary reading is stamped exactly as before;
--  * a labelled reading can still be CORRECTED after its window and with its guard off, with its stated time kept (a correction that changes the time is judged again);
--  * the label is frozen: a patient session cannot relabel a reading (control: it can still edit its own note);
--  * the 7-day home protocol counts neither label; the home average and window statistics do not count a pharmacy reading;
--  * RED FLAGS: for blood pressure (pharmacy and diary), glucose and pulse (diary), the labelled dangerous reading fires the SAME number of emergency events, clinician
--    alerts and red-flag audit rows as an identical ordinary reading, and the ordinary control is not vacuous (it fires at least one), and observation.recorded is emitted.
-- SABOTAGE (each must flip): (1) the protocol filter removed; (2) the diary window removed; (3) the guard check removed; (4) the home-average filter removed; (5) the correction branch removed.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;
create function pg_temp.setf(p text, p_v uuid) returns void language sql as $$ insert into fx values (p, p_v) on conflict (k) do update set v = excluded.v $$;
create function pg_temp.f(p text) returns uuid language sql as $$ select v from fx where k = p $$;
create function pg_temp.ck(p_phase text, p_name text, p_expected text, p_actual text) returns void language sql as $$ insert into results values (p_phase, p_name, p_expected, p_actual) $$;

create function pg_temp.mkuser(p_org uuid, p_label text, p_test boolean default true) returns uuid language plpgsql as
$f$ declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's07y-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, 'patient'::public.user_role, 'S07y ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, p_test)
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, is_test = excluded.is_test, is_active = true;
  return v;
end $f$;

-- run one statement as a signed-in user; the first column as text, or 'ERR <sqlstate>'
create function pg_temp.as_user(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
  begin execute p_sql into r; exception when others then r := 'ERR ' || sqlstate; end;
  reset role;
  perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.sub', '', true); perform set_config('request.jwt.claim.role', '', true);
  return r;
end $f$;

-- one blood pressure reading with a label; returns the new id or 'ERR <sqlstate>'
create function pg_temp.bp(p_pat uuid, p_origin text, p_sys int, p_dia int, p_client timestamptz, p_source text default 'manual', p_place text default null) returns text language plpgsql as
$f$ declare v uuid;
begin
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, source, entry_origin, place_label, client_recorded_at, position, arm)
  values ((select organisation_id from public.profiles where id = p_pat), p_pat, 'blood_pressure', p_sys, p_dia, p_source::public.vital_source, p_origin, p_place, p_client, 'seated', 'left')
  returning id into v;
  return v::text;
exception when others then return 'ERR ' || sqlstate;
end $f$;

-- the same, glucose (diary) and pulse (diary)
create function pg_temp.glu(p_pat uuid, p_origin text, p_mmol numeric, p_client timestamptz) returns text language plpgsql as
$f$ declare v uuid;
begin
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, glucose_mmol_l, glucose_context, source, entry_origin, client_recorded_at)
  values ((select organisation_id from public.profiles where id = p_pat), p_pat, 'glucose', p_mmol, 'random', 'manual', p_origin, p_client)
  returning id into v;
  return v::text;
exception when others then return 'ERR ' || sqlstate;
end $f$;
create function pg_temp.pls(p_pat uuid, p_origin text, p_bpm int, p_client timestamptz) returns text language plpgsql as
$f$ declare v uuid;
begin
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, pulse_bpm, source, entry_origin, client_recorded_at)
  values ((select organisation_id from public.profiles where id = p_pat), p_pat, 'pulse', p_bpm, 'manual', p_origin, p_client)
  returning id into v;
  return v::text;
exception when others then return 'ERR ' || sqlstate;
end $f$;

-- what a reading fired: emergency events | clinician alerts | red-flag audit rows
create function pg_temp.fired(p_pat uuid) returns text language sql as $$
  select (select count(*) from public.emergency_events where patient_id = p_pat) || '|' ||
         (select count(*) from public.clinician_alerts where patient_id = p_pat) || '|' ||
         (select count(*) from public.audit_log where entity_type = 'vitals_readings' and action like '%red_flag%'
             and entity_id in (select id from public.vitals_readings where patient_id = p_pat))
$$;
create function pg_temp.has_fired(p_pat uuid) returns text language sql as $$
  select (((select count(*) from public.emergency_events where patient_id = p_pat) + (select count(*) from public.clinician_alerts where patient_id = p_pat)
         + (select count(*) from public.audit_log where entity_type = 'vitals_readings' and action like '%red_flag%'
              and entity_id in (select id from public.vitals_readings where patient_id = p_pat))) > 0)::text
$$;

do $$
declare
  v_org uuid; v_pt uuid; v_pr uuid; v_a uuid; v_b uuid; v_c uuid; v_id text; v_cfg jsonb; v_r jsonb; v_i int; v_start date;
  v_n int; v_act text; v_i2 text; v_msg text;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  perform pg_temp.setf('org', v_org);
  v_pt := pg_temp.mkuser(v_org, 'test patient', true);   perform pg_temp.setf('pt', v_pt);
  v_pr := pg_temp.mkuser(v_org, 'real patient', false);  perform pg_temp.setf('pr', v_pr);

  -- A. schema, guards, registry ---------------------------------------------------------------------------------------------------
  perform pg_temp.ck('real', 'A1 both columns exist on vitals_readings and no existing reading carries a label', '2|0',
    (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'vitals_readings' and column_name in ('entry_origin', 'place_label')) || '|' ||
    (select count(*) from public.vitals_readings where entry_origin is not null));
  perform pg_temp.ck('real', 'A2 the three guards exist, are off, and are the CMO''s switch', 'off|off|off|cmo|cmo|cmo',
    (select string_agg(case when is_on then 'on' else 'off' end, '|' order by key) || '|' || string_agg(switch_role, '|' order by key)
       from public.go_live_guards where key in ('pharmacy_bp_readings', 'paper_diary_entry', 'paper_diary_ai_reader')));
  perform pg_temp.ck('real', 'A3 AI-021 is registered, disabled and not runtime governed', 'true|false|false',
    (select (count(*) = 1)::text || '|' || coalesce(bool_or(is_enabled), false)::text || '|' || coalesce(bool_or(runtime_governed), false)::text from public.ai_systems where system_code = 'AI-021'));
  perform pg_temp.ck('real', 'A4 the diary window is a versioned configuration value, default 30 days', '30',
    (select diary_window_days::text from public.offline_sync_config where is_active));
  perform pg_temp.ck('real', 'A5 anon can read neither reading view; both carry the label column', 'false|false|2',
    has_table_privilege('anon', 'private.vitals_readings_current', 'SELECT')::text || '|' || has_table_privilege('anon', 'private.vitals_readings_diagnostic', 'SELECT')::text || '|' ||
    (select count(*) from information_schema.columns where table_schema = 'private' and table_name in ('vitals_readings_current', 'vitals_readings_diagnostic') and column_name = 'entry_origin'));
  perform pg_temp.ck('real', 'A6 the stamp function is not callable by a signed-in user or anon', 'false|false',
    has_function_privilege('authenticated', 'private.stamp_manual_vitals_timestamp()', 'EXECUTE')::text || '|' || has_function_privilege('anon', 'private.stamp_manual_vitals_timestamp()', 'EXECUTE')::text);

  -- B. the checks ---------------------------------------------------------------------------------------------------------------------
  perform pg_temp.ck('real', 'B1 a pharmacy reading must be blood pressure', 'ERR 23514',
    pg_temp.glu(v_pt, 'pharmacy_machine', 6.0, now()));
  perform pg_temp.ck('real', 'B2 an unknown label is refused', 'ERR 23514', pg_temp.bp(v_pt, 'kiosk', 120, 80, now()));
  perform pg_temp.ck('real', 'B3 a place needs the pharmacy label', 'ERR 23514', pg_temp.bp(v_pt, 'paper_diary', 120, 80, now() - interval '1 day', 'manual', 'Some pharmacy'));
  perform pg_temp.ck('real', 'B4 a place longer than 80 characters is refused', 'ERR 23514', pg_temp.bp(v_pt, 'pharmacy_machine', 120, 80, now(), 'manual', repeat('x', 81)));
  perform pg_temp.ck('real', 'B5 a label never rides on a non-manual source', 'ERR 22023', pg_temp.bp(v_pt, 'pharmacy_machine', 120, 80, now(), 'device'));
  perform pg_temp.ck('real', 'B6 a diary reading may be glucose or pulse, a pharmacy reading may not', 'ok|ok',
    (case when pg_temp.glu(v_pt, 'paper_diary', 6.0, now() - interval '2 days') ~ '^ERR' then 'bad' else 'ok' end) || '|' ||
    (case when pg_temp.pls(v_pt, 'paper_diary', 72, now() - interval '2 days') ~ '^ERR' then 'bad' else 'ok' end));

  -- C. the guards ---------------------------------------------------------------------------------------------------------------------
  perform pg_temp.ck('real', 'C1 a REAL patient cannot save a pharmacy reading while its guard is off', 'ERR 55000', pg_temp.bp(v_pr, 'pharmacy_machine', 124, 80, now()));
  perform pg_temp.ck('real', 'C2 ...nor a diary reading while its guard is off', 'ERR 55000', pg_temp.bp(v_pr, 'paper_diary', 124, 80, now() - interval '2 days'));
  begin
    insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, source, entry_origin, client_recorded_at)
    values (v_org, v_pr, 'blood_pressure', 124, 80, 'manual', 'pharmacy_machine', now());
    v_msg := 'inserted';
  exception when others then v_msg := sqlerrm;
  end;
  perform pg_temp.ck('real', 'C2b the refusal names its guard in the message (the apps tell it from any other 55000 by that, never by the code alone)', 'true',
    (v_msg ~ '\(pharmacy_bp_readings\)')::text);
  perform pg_temp.ck('real', 'C3 ...but an ordinary reading is never behind a guard', 'ok', case when pg_temp.bp(v_pr, null, 124, 80, now()) ~ '^ERR' then 'bad' else 'ok' end);
  perform pg_temp.ck('real', 'C4 a TEST patient passes both guards', 'ok|ok',
    (case when pg_temp.bp(v_pt, 'pharmacy_machine', 124, 80, now(), 'manual', 'Pharmacy on the corner') ~ '^ERR' then 'bad' else 'ok' end) || '|' ||
    (case when pg_temp.bp(v_pt, 'paper_diary', 124, 80, now() - interval '3 days') ~ '^ERR' then 'bad' else 'ok' end));
  -- the guards change only through set_go_live_guard(), which needs conditions that do not exist yet; the proof flips them inside its own rolled-back transaction
  alter table public.go_live_guards disable trigger go_live_guards_guard;
  update public.go_live_guards set is_on = true, changed_at = now(), changed_by = v_pt, change_note = 'S07y proof' where key in ('pharmacy_bp_readings', 'paper_diary_entry');
  perform pg_temp.ck('real', 'C5 with the guards on, the REAL patient can save both (control: the guard was the only thing in the way)', 'ok|ok',
    (case when pg_temp.bp(v_pr, 'pharmacy_machine', 125, 80, now()) ~ '^ERR' then 'bad' else 'ok' end) || '|' ||
    (case when pg_temp.bp(v_pr, 'paper_diary', 125, 80, now() - interval '2 days') ~ '^ERR' then 'bad' else 'ok' end));
  update public.go_live_guards set is_on = false, changed_at = null, changed_by = null, change_note = null where key in ('pharmacy_bp_readings', 'paper_diary_entry');
  alter table public.go_live_guards enable trigger go_live_guards_guard;

  -- D. the time rules -----------------------------------------------------------------------------------------------------------------
  v_id := pg_temp.bp(v_pt, 'pharmacy_machine', 118, 76, now() - interval '2 hours');
  perform pg_temp.ck('real', 'D1 a pharmacy reading keeps its stated time inside the 72 hour window', 'client_bounded|true',
    (select time_basis || '|' || (abs(extract(epoch from (taken_at - (now() - interval '2 hours')))) < 5)::text from public.vitals_readings where id = v_id::uuid));
  v_id := pg_temp.bp(v_pt, 'pharmacy_machine', 118, 76, now() - interval '100 hours');
  perform pg_temp.ck('real', 'D2 ...and falls back to server time beyond it (never a silent backdate)', 'server|true',
    (select time_basis || '|' || (taken_at > now() - interval '1 minute')::text from public.vitals_readings where id = v_id::uuid));
  v_id := pg_temp.bp(v_pt, 'paper_diary', 150, 94, now() - interval '5 days');
  perform pg_temp.ck('real', 'D3 a diary reading keeps its stated time and says so', 'diary_stated|true',
    (select time_basis || '|' || (abs(extract(epoch from (taken_at - (now() - interval '5 days')))) < 5)::text from public.vitals_readings where id = v_id::uuid));
  perform pg_temp.ck('real', 'D4 a diary reading 29 days old is accepted, 31 days old is refused', 'ok|ERR 22023',
    (case when pg_temp.bp(v_pt, 'paper_diary', 128, 82, now() - interval '29 days') ~ '^ERR' then 'bad' else 'ok' end) || '|' || pg_temp.bp(v_pt, 'paper_diary', 128, 82, now() - interval '31 days'));
  perform pg_temp.ck('real', 'D5 a diary reading with no date, or dated in the future, is refused', 'ERR 22023|ERR 22023',
    pg_temp.bp(v_pt, 'paper_diary', 128, 82, null) || '|' || pg_temp.bp(v_pt, 'paper_diary', 128, 82, now() + interval '1 hour'));
  v_id := pg_temp.bp(v_pt, null, 121, 79, now() - interval '100 hours');
  perform pg_temp.ck('real', 'D6 an ordinary manual reading is stamped exactly as before (server time beyond the window)', 'server|true|',
    (select time_basis || '|' || (taken_at > now() - interval '1 minute')::text || '|' || coalesce(entry_origin, '') from public.vitals_readings where id = v_id::uuid));

  -- E. the label is frozen -------------------------------------------------------------------------------------------------------------
  v_id := pg_temp.bp(v_pt, 'pharmacy_machine', 133, 85, now() - interval '1 hour', 'manual', 'Corner pharmacy');
  perform pg_temp.ck('real', 'E1 a patient session cannot relabel a reading as an ordinary one', 'ERR 42501',
    pg_temp.as_user(v_pt, 'update public.vitals_readings set entry_origin = null where id = ''' || v_id || '''::uuid returning ''changed'''));
  perform pg_temp.ck('real', 'E2 ...nor change the place', 'ERR 42501',
    pg_temp.as_user(v_pt, 'update public.vitals_readings set place_label = ''Elsewhere'' where id = ''' || v_id || '''::uuid returning ''changed'''));
  perform pg_temp.ck('real', 'E3 control: the same session can still edit its own note', 'changed',
    pg_temp.as_user(v_pt, 'update public.vitals_readings set note = ''checked twice'' where id = ''' || v_id || '''::uuid returning ''changed'''));

  -- H. the same rules for a signed-in patient session (RLS and the insert triggers together), which is how the apps really write
  perform pg_temp.ck('real', 'H1 a signed-in TEST patient can save a labelled reading through their own session (insert returning needs the select policy)', 'ok',
    case when pg_temp.as_user(v_pt, 'insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, source, entry_origin, place_label, client_recorded_at) values ((select organisation_id from public.profiles where id = ''' || v_pt || '''), ''' || v_pt || ''', ''blood_pressure'', 137, 86, ''manual'', ''pharmacy_machine'', ''Corner'', now() - interval ''20 minutes'') returning id::text') ~ '^ERR' then 'bad' else 'ok' end);
  perform pg_temp.ck('real', 'H2 a signed-in REAL patient is refused while the guard is off (55000), through their own session', 'ERR 55000',
    pg_temp.as_user(v_pr, 'insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, source, entry_origin, client_recorded_at) values ((select organisation_id from public.profiles where id = ''' || v_pr || '''), ''' || v_pr || ''', ''blood_pressure'', 137, 86, ''manual'', ''paper_diary'', now() - interval ''2 days'') returning id::text'));
  perform pg_temp.ck('real', 'H3 ...and an ordinary reading through the same session is unaffected', 'ok',
    case when pg_temp.as_user(v_pr, 'insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, source) values ((select organisation_id from public.profiles where id = ''' || v_pr || '''), ''' || v_pr || ''', ''blood_pressure'', 124, 80, ''manual'') returning id::text') ~ '^ERR' then 'bad' else 'ok' end);
  v_a := pg_temp.mkuser(v_org, 'other test patient', true);
  perform pg_temp.ck('real', 'H4 a patient session cannot insert a labelled reading for ANOTHER patient (the guard passes for a test account, then RLS refuses)', 'ERR 42501',
    pg_temp.as_user(v_pt, 'insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, source, entry_origin, client_recorded_at) values ((select organisation_id from public.profiles where id = ''' || v_a || '''), ''' || v_a || ''', ''blood_pressure'', 137, 86, ''manual'', ''pharmacy_machine'', now()) returning id::text'));

  -- I. a labelled reading can still be CORRECTED after its window, and a correction that changes the time is judged again
  alter table public.go_live_guards disable trigger go_live_guards_guard;
  update public.go_live_guards set is_on = true, changed_at = now(), changed_by = v_pt, change_note = 'S07y proof' where key in ('pharmacy_bp_readings', 'paper_diary_entry');
  v_id := pg_temp.bp(v_pr, 'paper_diary', 121, 79, now() - interval '25 days');
  perform pg_temp.setf('corr_diary', v_id::uuid);
  v_i2 := pg_temp.bp(v_pr, 'pharmacy_machine', 122, 78, now() - interval '2 hours', 'manual', 'Corner');
  perform pg_temp.setf('corr_pharm', v_i2::uuid);
  -- the windows tighten and the guards close: the saved readings are older than the diary window and the pharmacy window, and their guards are off
  update public.offline_sync_config set diary_window_days = 1, backdate_window_hours = 1 where is_active;
  update public.go_live_guards set is_on = false, changed_at = null, changed_by = null, change_note = null where key in ('pharmacy_bp_readings', 'paper_diary_entry');
  alter table public.go_live_guards enable trigger go_live_guards_guard;
  perform pg_temp.ck('real', 'I1 a real patient can correct their own diary reading even though it is older than the window and its guard is off', 'corrected',
    pg_temp.as_user(v_pr, 'select (public.correct_clinical_value(''vitals_readings'', ''' || pg_temp.f('corr_diary') || '''::uuid, ''corrected''::public.correction_status, ''typed the wrong number'', ''{"systolic": 126}''::jsonb)) ->> ''status'''));
  perform pg_temp.ck('real', 'I2 ...the replacement keeps the label, the stated time and the diary time basis, and carries the corrected number', 'paper_diary|diary_stated|true|126',
    (select entry_origin || '|' || time_basis || '|' || (abs(extract(epoch from (taken_at - (select taken_at from public.vitals_readings where id = pg_temp.f('corr_diary'))))) < 1)::text || '|' || systolic
       from public.vitals_readings where supersedes_id = pg_temp.f('corr_diary')));
  perform pg_temp.ck('real', 'I3a a pharmacy reading can be corrected after the pharmacy window, with its guard off', 'corrected',
    pg_temp.as_user(v_pr, 'select (public.correct_clinical_value(''vitals_readings'', ''' || pg_temp.f('corr_pharm') || '''::uuid, ''corrected''::public.correction_status, ''typed the wrong number'', ''{"systolic": 124}''::jsonb)) ->> ''status'''));
  perform pg_temp.ck('real', 'I3b ...and the replacement keeps its own time (about two hours ago, not re-stamped as now) and its label', 'pharmacy_machine|true',
    (select coalesce(entry_origin, 'none') || '|' || (taken_at < now() - interval '90 minutes')::text from public.vitals_readings where supersedes_id = pg_temp.f('corr_pharm')));
  update public.offline_sync_config set diary_window_days = 30, backdate_window_hours = 72 where is_active;
  -- a correction that CHANGES the time is judged by the ordinary rules again
  v_id := pg_temp.bp(v_pt, 'paper_diary', 121, 79, now() - interval '5 days');
  perform pg_temp.ck('real', 'I4 a correction that changes a diary reading''s time to one outside the window is refused (22023); the rules are judged again', 'ERR 22023',
    pg_temp.as_user(v_pt, 'select (public.correct_clinical_value(''vitals_readings'', ''' || v_id || '''::uuid, ''corrected''::public.correction_status, ''wrong day'', jsonb_build_object(''taken_at'', (now() - interval ''40 days'')::text))) ->> ''status'''));

  -- F. the 7-day home protocol and the home averages --------------------------------------------------------------------------------
  v_cfg := jsonb_build_object('protocol', jsonb_build_object('targetDays', 7));
  select config into v_cfg from public.home_bp_programme_signoffs where version = 1;
  v_a := pg_temp.mkuser(v_org, 'protocol patient', true);  perform pg_temp.setf('pa', v_a);
  v_start := (now() at time zone 'Africa/Lagos')::date - 4;
  -- twelve ordinary device readings over the three Lagos days v_start .. v_start + 2 (a device reading keeps its time)
  for v_i in 0..2 loop
    insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, taken_at, source, position, arm)
    select v_org, v_a, 'blood_pressure', 120, 80, ((v_start + v_i)::text || ' ' || t || '+00')::timestamptz, 'device', 'seated', 'left'
      from unnest(array['06:00:00', '06:01:30', '18:00:00', '18:01:30']) t;
  end loop;
  v_r := private.home_bp_assess(v_a, v_start, v_cfg);
  perform pg_temp.ck('real', 'F0 control: twelve ordinary readings are a complete 120/80 protocol', 'true|12|120',
    (v_r ->> 'complete') || '|' || (v_r ->> 'readings') || '|' || (v_r ->> 'systolic'));
  -- then labelled readings far above them, INSIDE the protocol window: three pharmacy readings stamped within the last hours, and diary readings dated on the protocol days
  for v_i in 1..3 loop
    insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, source, entry_origin, client_recorded_at, position, arm)
    values (v_org, v_a, 'blood_pressure', 190, 110, 'manual', 'pharmacy_machine', now() - make_interval(hours => v_i), 'seated', 'left');
  end loop;
  for v_i in 0..2 loop
    insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, source, entry_origin, client_recorded_at, position, arm)
    select v_org, v_a, 'blood_pressure', 190, 110, 'manual', 'paper_diary', ((v_start + v_i)::text || ' ' || t || '+00')::timestamptz, 'seated', 'left'
      from unnest(array['07:00:00', '07:01:30', '19:00:00']) t;
  end loop;
  v_r := private.home_bp_assess(v_a, v_start, v_cfg);
  perform pg_temp.ck('real', 'F1 twelve labelled readings far above change nothing in the protocol (still 12 readings, 120/80)', '12|120|80',
    (v_r ->> 'readings') || '|' || (v_r ->> 'systolic') || '|' || (v_r ->> 'diastolic'));
  v_b := pg_temp.mkuser(v_org, 'labelled only', true);  perform pg_temp.setf('pb', v_b);
  for v_i in 1..12 loop
    insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, source, entry_origin, client_recorded_at, position, arm)
    values (v_org, v_b, 'blood_pressure', 120, 80, 'manual', 'pharmacy_machine', now() - make_interval(mins => v_i * 5), 'seated', 'left');
  end loop;
  v_r := private.home_bp_assess(v_b, v_start, v_cfg);
  perform pg_temp.ck('real', 'F2 twelve pharmacy readings alone are not a protocol: nothing counted', 'false|0',
    (v_r ->> 'complete') || '|' || (v_r ->> 'readings'));

  v_c := pg_temp.mkuser(v_org, 'average patient', true);  perform pg_temp.setf('pc', v_c);
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, taken_at, source, position, arm)
  values (v_org, v_c, 'blood_pressure', 120, 80, now() - interval '1 hour', 'device', 'seated', 'left');
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, client_recorded_at, source, entry_origin, position, arm)
  values (v_org, v_c, 'blood_pressure', 200, 120, now() - interval '30 minutes', 'manual', 'pharmacy_machine', 'seated', 'left');
  perform pg_temp.ck('real', 'F3 the 7-day home average leaves a pharmacy reading out (1 reading, 120)', '1|120.0',
    (select n_readings || '|' || avg_systolic from private.hbpm_average(v_c)));
  select n, avg_sys::text into v_n, v_act from private.bp_window_stats(v_c, (now() at time zone 'Africa/Lagos')::date - 1, (now() at time zone 'Africa/Lagos')::date + 1);
  perform pg_temp.ck('real', 'F4 the window statistics leave a pharmacy reading out (1 reading, 120)', '1|120.0', v_n || '|' || v_act);
  v_b := pg_temp.mkuser(v_org, 'diary average', true);
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, client_recorded_at, source, entry_origin, position, arm)
  values (v_org, v_b, 'blood_pressure', 140, 90, now() - interval '30 minutes', 'manual', 'paper_diary', 'seated', 'left');
  perform pg_temp.ck('real', 'F5 a diary reading IS part of the general 7-day average (it is labelled, not hidden); OQ-S07Y-3 asks whether it should be', '1|140.0',
    (select n_readings || '|' || avg_systolic from private.hbpm_average(v_b)));

  -- G. a dangerous value fires what an ordinary one fires -----------------------------------------------------------------------------
  v_a := pg_temp.mkuser(v_org, 'danger ordinary', true);  perform pg_temp.setf('ga', v_a);
  v_b := pg_temp.mkuser(v_org, 'danger pharmacy', true);  perform pg_temp.setf('gb', v_b);
  v_c := pg_temp.mkuser(v_org, 'danger diary', true);     perform pg_temp.setf('gc', v_c);
  perform pg_temp.bp(v_a, null, 205, 128, null);
  perform pg_temp.bp(v_b, 'pharmacy_machine', 205, 128, null);
  perform pg_temp.bp(v_c, 'paper_diary', 205, 128, now() - interval '1 hour');
  perform pg_temp.ck('real', 'G1 control: an ordinary 205/128 fires something (not a vacuous comparison)', 'true', pg_temp.has_fired(v_a));
  perform pg_temp.ck('real', 'G2 a pharmacy 205/128 fires exactly what the ordinary one fired', pg_temp.fired(v_a), pg_temp.fired(v_b));
  perform pg_temp.ck('real', 'G3 a diary 205/128 fires exactly what the ordinary one fired', pg_temp.fired(v_a), pg_temp.fired(v_c));
  perform pg_temp.ck('real', 'G4 each of the three also emitted observation.recorded for its blood pressure reading', '3',
    (select count(distinct e.aggregate_id)::text from public.domain_events e
      where e.event_type = 'observation.recorded' and e.aggregate_id in (select id from public.vitals_readings where patient_id in (pg_temp.f('ga'), pg_temp.f('gb'), pg_temp.f('gc')) and vital_type = 'blood_pressure')));

  v_a := pg_temp.mkuser(v_org, 'glucose ordinary', true);  perform pg_temp.setf('ha', v_a);
  v_b := pg_temp.mkuser(v_org, 'glucose diary', true);     perform pg_temp.setf('hb', v_b);
  perform pg_temp.glu(v_a, null, 1.8, null);
  perform pg_temp.glu(v_b, 'paper_diary', 1.8, now() - interval '1 hour');
  perform pg_temp.ck('real', 'G5 control: an ordinary severe-low glucose fires something', 'true', pg_temp.has_fired(v_a));
  perform pg_temp.ck('real', 'G6 a diary severe-low glucose fires exactly what the ordinary one fired (it is NOT skipped by the glucose triage wiring)', pg_temp.fired(v_a), pg_temp.fired(v_b));

  v_a := pg_temp.mkuser(v_org, 'pulse ordinary', true);  perform pg_temp.setf('ia', v_a);
  v_b := pg_temp.mkuser(v_org, 'pulse diary', true);     perform pg_temp.setf('ib', v_b);
  perform pg_temp.pls(v_a, null, 190, null);
  perform pg_temp.pls(v_b, 'paper_diary', 190, now() - interval '1 hour');
  perform pg_temp.ck('real', 'G7 control: an ordinary pulse of 190 fires something', 'true', pg_temp.has_fired(v_a));
  perform pg_temp.ck('real', 'G8 a diary pulse of 190 fires exactly what the ordinary one fired', pg_temp.fired(v_a), pg_temp.fired(v_b));
end $$;

-- SABOTAGE 1: the protocol filter removed. The labelled readings must now be counted.
do $$
declare v_def text; v_out jsonb; v_cfg jsonb := (select config from public.home_bp_programme_signoffs where version = 1);
  v_a uuid := pg_temp.f('pa'); v_start date := (now() at time zone 'Africa/Lagos')::date - 4;
begin
  select pg_get_functiondef('private.home_bp_assess(uuid, date, jsonb)'::regprocedure) into v_def;
  v_def := replace(v_def, 'and v.entry_origin is null', '');
  execute v_def;
  v_out := private.home_bp_assess(v_a, v_start, v_cfg);
  insert into results values ('sabotaged', 'SABOTAGE: without the protocol filter the labelled readings are counted', '12', (v_out ->> 'readings'));
end $$;
-- SABOTAGE 5 (run before the others, which edit the same function): the correction branch removed. Correcting a diary reading with its guard off must now be refused.
do $$
declare v_def text; v_out text;
begin
  select pg_get_functiondef('private.stamp_manual_vitals_timestamp()'::regprocedure) into v_def;
  v_def := replace(v_def, 'if found and new.client_recorded_at is not distinct from v_old_taken then', 'if false then');
  execute v_def;
  perform set_config('request.jwt.claims', json_build_object('sub', pg_temp.f('pr'), 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', pg_temp.f('pr')::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
  begin
    perform public.correct_clinical_value('vitals_readings', (select id from public.vitals_readings where patient_id = pg_temp.f('pr') and entry_origin = 'paper_diary' and supersedes_id is null and correction_status is null limit 1), 'corrected'::public.correction_status, 'sabotage', '{"systolic": 127}'::jsonb);
    v_out := 'corrected';
  exception when others then v_out := 'ERR ' || sqlstate;
  end;
  reset role;
  insert into results values ('sabotaged', 'SABOTAGE: without the correction branch a diary reading older than the window cannot be corrected', 'corrected', v_out);
end $$;

-- SABOTAGE 2: the diary window removed. A 60 day old diary reading must now be accepted.
do $$
declare v_def text; v_out text;
begin
  select pg_get_functiondef('private.stamp_manual_vitals_timestamp()'::regprocedure) into v_def;
  v_def := replace(v_def, 'or new.client_recorded_at < v_now - make_interval(days => v_days)', 'or false');
  execute v_def;
  v_out := pg_temp.bp(pg_temp.f('pt'), 'paper_diary', 128, 82, now() - interval '60 days');
  insert into results values ('sabotaged', 'SABOTAGE: without the window a 60 day old diary reading is refused', 'ERR 22023', case when v_out ~ '^ERR' then v_out else 'accepted' end);
end $$;
-- SABOTAGE 3: the guard check removed. The real patient must now be able to save a labelled reading with the guard off.
do $$
declare v_def text; v_out text;
begin
  select pg_get_functiondef('private.stamp_manual_vitals_timestamp()'::regprocedure) into v_def;
  v_def := replace(v_def, 'if not private.go_live_open_patient(v_key, new.patient_id) then', 'if false then');
  execute v_def;
  v_out := pg_temp.bp(pg_temp.f('pr'), 'pharmacy_machine', 124, 80, now());
  insert into results values ('sabotaged', 'SABOTAGE: without the guard check a real patient can save a labelled reading while it is off', 'ERR 55000', case when v_out ~ '^ERR' then v_out else 'accepted' end);
end $$;
-- SABOTAGE 4: the home-average filter removed. The average must now include the pharmacy reading.
do $$
declare v_def text; v_out text;
begin
  select pg_get_functiondef('private.hbpm_average(uuid)'::regprocedure) into v_def;
  v_def := replace(v_def, 'and v.entry_origin is distinct from ''pharmacy_machine''', '');
  execute v_def;
  select n_readings::text into v_out from private.hbpm_average(pg_temp.f('pc'));
  insert into results values ('sabotaged', 'SABOTAGE: without the home-average filter a pharmacy reading is counted', '1', v_out);
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S07y proof FAILED: %', (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and check_name like 'SABOTAGE%' and expected <> actual;
  if v_caught < 5 then raise exception 'VACUOUS TEST: a sabotage did not flip (% of 5)', v_caught; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result from results where phase = 'real' order by check_name;
rollback;
