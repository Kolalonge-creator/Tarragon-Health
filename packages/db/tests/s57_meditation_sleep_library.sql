-- S57 proof: the meditation and sleep library and sleep tools (functions 10.4 to 10.11).
--  * library publish gate (placeholder, reviewer, dates, payload per kind, breathing bounds, change-after-review) and the expiry read rule
--    (an expired item is not served: table, manifest, session), the script guard, the offline manifest caps
--  * media_sessions are patient-only; the event carries ids only
--  * the journal: ciphertext only, owner only (no staff, supporter, sponsor, admin, break-glass section), sync off deletes copies
--  * the sleep questionnaire: an UNSIGNED instrument never creates a task (guard on or off, any answers); signed + cut-off creates one; staff read
--    only through the audited function (tie), refusals audited
--  * wind-down plan patient-only; diary columns bounded; the CMO confirm is CMO-only
-- Roles proved: patient own, other patient, tied clinician, untied clinician, tied coordinator, CMO, admin, sponsor, caregiver with and without consent, anon.
-- SABOTAGE: expiry rule removed, a staff journal policy added, the staff tie gate opened, the signed check removed, the publish gate dropped; each must flip checks.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;

create function pg_temp.rec(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('real', p_name, p_expected, p_actual) $$;
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
-- run a statement as a user; returns 'ok' or the error message (the message is the stable queue_* code)
create function pg_temp.try_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql; r := 'ok'; exception when others then r := sqlerrm; end;
  perform pg_temp.back();
  return r;
end $f$;
-- run a scalar query as a user; returns the value as text, or 'ERR:' || message
create function pg_temp.q_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlerrm; end;
  perform pg_temp.back();
  return r;
end $f$;
-- the same as anon
create function pg_temp.try_anon(p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
  begin execute p_sql; r := 'ok'; exception when others then r := sqlstate; end;
  reset role;
  return r;
end $f$;
create function pg_temp.next_as(p_uid uuid) returns jsonb language plpgsql as
$f$ declare r jsonb;
begin
  perform pg_temp.act(p_uid);
  begin r := public.queue_next(); exception when others then r := jsonb_build_object('error', sqlerrm); end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.next_task(p_uid uuid) returns uuid language sql as
$$ select (pg_temp.next_as(p_uid) -> 'task' ->> 'id')::uuid $$;
-- 'claimed', the error code, or the reason no task was given
create function pg_temp.next_outcome(p_uid uuid) returns text language sql as
$$ select coalesce(r ->> 'error', case when jsonb_typeof(r -> 'task') = 'object' then 'claimed' else r ->> 'reason' end)
     from (select pg_temp.next_as(p_uid) as r) x $$;
create function pg_temp.backdate(p_task uuid, p_set text) returns void language plpgsql as
$f$ begin
  perform set_config('tarragon.task_transition', 'on', true);
  execute format('update public.clinical_tasks set %s where id = %L', p_set, p_task);
  perform set_config('tarragon.task_transition', 'off', true);
end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's22-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'S22 ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone;
  return v;
end $f$;
create function pg_temp.mkdoc(p_org uuid, p_label text, p_tier text, p_emp text, p_comps text[], p_admin uuid, p_test boolean default true) returns uuid
language plpgsql as $f$
declare v uuid; s uuid; c text;
begin
  v := pg_temp.mkuser(p_org, p_label, 'clinician');
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
  values (p_org, v, 'S22 ' || p_label, 'MDCN', 'S17-' || p_label || '-' || substr(v::text, 1, 8), true, 'active', now(), p_admin,
      p_tier::public.doctor_tier, p_emp::public.staff_employment_type,
      case when p_tier in ('senior_medical_officer', 'chief_medical_officer') then 2 else 1 end,
      p_emp = 'contracted', case when p_emp = 'contracted' then p_admin else null end, p_test)
  returning id into s;
  foreach c in array p_comps loop
    insert into public.clinician_competencies (organisation_id, clinical_staff_id, competency_code, granted_by, is_test) values (p_org, s, c, p_admin, true);
  end loop;
  return v;
end $f$;

create function pg_temp.ck(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('real', p_name, p_expected, p_actual) $$;
create function pg_temp.sab(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('sabotaged', p_name, p_expected, p_actual) $$;
create function pg_temp.cnt(p_uid uuid, p_table text) returns text language sql as
$$ select pg_temp.q_as(p_uid, format('select count(*)::text from public.%I', p_table)) $$;
create function pg_temp.audit_n(p_actor uuid, p_result text) returns integer language sql as
$$ select count(*)::integer from public.audit_log where actor_id = p_actor and action = 'staff.mental_health_read' and result = p_result $$;

-- Fixtures -------------------------------------------------------------------------------------------------------------
do $$
declare v_org uuid; v_admin uuid; v_pat uuid; v_doc uuid; v_pa uuid; v_i uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  perform pg_temp.setf('org', v_org);
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin'); perform pg_temp.setf('admin', v_admin);
  update public.clinical_staff set active = false where is_test is not true;
  v_pat := pg_temp.mkuser(v_org, 'pat', 'patient'); perform pg_temp.setf('pat', v_pat);
  perform pg_temp.setf('pat2', pg_temp.mkuser(v_org, 'pat2', 'patient'));
  perform pg_temp.setf('realpat', pg_temp.mkuser(v_org, 'realpat', 'patient'));
  update public.profiles set is_test = false where id = pg_temp.f('realpat');
  v_doc := pg_temp.mkdoc(v_org, 'doctied', 'medical_officer', 'contracted', '{adult_general}', v_admin); perform pg_temp.setf('doctied', v_doc);
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id) values (v_org, v_pat, v_doc);
  perform pg_temp.setf('coord', pg_temp.mkdoc(v_org, 'coord', 'care_coordinator', 'employed', '{}', v_admin));
  perform pg_temp.setf('docuntied', pg_temp.mkdoc(v_org, 'docuntied', 'medical_officer', 'contracted', '{adult_general}', v_admin));
  perform pg_temp.setf('cmo', pg_temp.mkdoc(v_org, 'cmo', 'chief_medical_officer', 'contracted', '{adult_general}', v_admin));
  perform pg_temp.setf('spons', pg_temp.mkuser(v_org, 'spons', 'patient'));
  perform pg_temp.setf('cgyes', pg_temp.mkuser(v_org, 'cgyes', 'patient'));
  perform pg_temp.setf('cgno', pg_temp.mkuser(v_org, 'cgno', 'patient'));
  set local session_replication_role = replica;
  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by, clinical_access) values (v_pat, pg_temp.f('cgyes'), 'view', v_pat, true) returning id into v_pa;
  insert into public.profile_access_categories (profile_access_id, category) select v_pa, c from unnest(array['medical_history', 'mental_health']::public.care_access_category[]) c;
  set local session_replication_role = origin;
end $$;

create function pg_temp.guard(p_key text, p_on boolean) returns void language plpgsql as
$f$ begin
  set local session_replication_role = replica;
  update public.go_live_guards set is_on = p_on, changed_at = case when p_on then now() end, changed_by = case when p_on then pg_temp.f('admin') end, change_note = case when p_on then 'proof' end where key = p_key;
  set local session_replication_role = origin;
end $f$;

create function pg_temp.mkitem(p_code text, p_kind text, p_extra text default '') returns uuid language plpgsql as $f$
declare v uuid;
begin
  execute format($q$insert into public.media_library (code, kind, exercise_type, title, series, is_placeholder, duration_seconds, bytes, audio_url, script)
    values (%L, %L, %L, 'S57 proof item', 'stress', false, %s) returning id$q$, p_code, p_kind,
    case when p_kind = 'exercise' then 'self_help' end, p_extra) into v;
  return v;
end $f$;
create function pg_temp.pub(p_id uuid, p_reviewer text default 'Dr Reviewer', p_due_offset integer default 90) returns text language plpgsql as $f$
begin
  begin
    update public.media_library set content_status = 'published', is_active = true, reviewed_by_name = p_reviewer, reviewed_at = current_date,
      next_review_due = (now() at time zone 'Africa/Lagos')::date + p_due_offset where id = p_id;
    return 'ok';
  exception when others then return sqlerrm; end;
end $f$;

-- A. Library: publish gate --------------------------------------------------------------------------------------------------------
do $$
declare v_ph uuid; v_a uuid; v_b uuid; v_bad uuid; v_ex uuid; v_ex2 uuid; r text;
begin
  select id into v_ph from public.media_library where code = 'draft-stress-1';
  perform pg_temp.ck('twelve draft placeholders are seeded', '12', (select count(*)::text from public.media_library where code like 'draft-%'));
  perform pg_temp.ck('a placeholder cannot be published', 'true', (pg_temp.pub(v_ph) like '%placeholder cannot be published%')::text);
  perform pg_temp.ck('no seeded item is servable', '0', (select count(*)::text from public.media_library where private.media_is_servable(is_active, content_status, is_placeholder, next_review_due)));

  v_a := pg_temp.mkitem('s57-audio-a', 'meditation', $q$600, 3000000, 'https://example.invalid/a.mp3', null$q$); perform pg_temp.setf('a', v_a);
  r := (select pg_temp.pub(v_a, null));
  perform pg_temp.ck('publishing needs a named reviewer', 'true', (r like '%named reviewer%')::text);
  perform pg_temp.ck('publishing needs a future review date', 'true', (pg_temp.pub(v_a, 'Dr Reviewer', -1) like '%next review date%')::text);
  v_bad := pg_temp.mkitem('s57-audio-bad', 'meditation', $q$600, 3000000, null, null$q$);
  perform pg_temp.ck('an audio item needs a file', 'true', (pg_temp.pub(v_bad) like '%needs an audio file%')::text);
  perform pg_temp.ck('a script item needs a step', 'true', (pg_temp.pub(pg_temp.mkitem('s57-ex-bad', 'exercise', $q$null, null, null, '{"steps":[]}'::jsonb$q$)) like '%at least one step%')::text);
  perform pg_temp.ck('a breathing item outside 3 to 5 minutes is refused', 'true',
    (pg_temp.pub(pg_temp.mkitem('s57-br-short', 'breathing', $q$60, null, null, '{"steps":[{"text":"x"}],"pattern":{"inhale_s":4,"hold_s":0,"exhale_s":6}}'::jsonb$q$)) like '%between 180 and 300%')::text);
  perform pg_temp.ck('a breathing phase over the limit is refused', 'true',
    (pg_temp.pub(pg_temp.mkitem('s57-br-long', 'breathing', $q$200, null, null, '{"steps":[{"text":"x"}],"pattern":{"inhale_s":30,"hold_s":0,"exhale_s":6}}'::jsonb$q$)) like '%within the configured limit%')::text);
  perform pg_temp.ck('a fully reviewed audio item publishes', 'ok', pg_temp.pub(v_a));
  perform pg_temp.ck('editing a published item without a new review is refused', 'true',
    (pg_temp.try_as(pg_temp.f('admin'), format($q$update public.media_library set audio_url = 'https://example.invalid/other.mp3' where id = %L$q$, v_a)) like '%new review date%')::text);
  v_b := pg_temp.mkitem('s57-breath-ok', 'breathing', $q$240, null, null, '{"steps":[{"text":"x"}],"pattern":{"inhale_s":4,"hold_s":0,"exhale_s":6}}'::jsonb$q$); perform pg_temp.setf('b', v_b);
  perform pg_temp.ck('a reviewed breathing item publishes', 'ok', pg_temp.pub(v_b));
  v_ex := pg_temp.mkitem('s57-exercise', 'exercise', $q$null, null, null, '{"steps":[{"text":"x"}]}'::jsonb$q$); perform pg_temp.setf('ex', v_ex);
  perform pg_temp.ck('a reviewed exercise publishes', 'ok', pg_temp.pub(v_ex));
  -- the admin screen path: an authenticated admin (not the table owner) publishes through RLS and the definer gate
  v_ex2 := pg_temp.mkitem('s57-br-admin', 'breathing', $q$200, null, null, '{"steps":[{"text":"x"}],"pattern":{"inhale_s":4,"hold_s":0,"exhale_s":6}}'::jsonb$q$);
  perform pg_temp.ck('an authenticated admin publishes through RLS and the gate', 'ok',
    pg_temp.try_as(pg_temp.f('admin'), format($q$update public.media_library set content_status = 'published', is_active = true, reviewed_by_name = 'Dr Reviewer', reviewed_at = current_date, next_review_due = current_date + 60 where id = %L$q$, v_ex2)));
  perform pg_temp.ck('...and the same gate refuses an incomplete publish from the admin', 'true',
    (pg_temp.try_as(pg_temp.f('admin'), format($q$update public.media_library set content_status = 'published', is_active = true where id = %L$q$, pg_temp.mkitem('s57-br-admin2', 'meditation', $q$600, 3000000, 'https://example.invalid/x.mp3', null$q$))) like '%named reviewer%')::text);
  perform pg_temp.ck('a non-admin cannot write the catalogue', 'true',
    (pg_temp.try_as(pg_temp.f('pat'), $q$insert into public.media_library (code, kind, title) values ('s57-x', 'meditation', 'x')$q$) like '%row-level security%')::text);
  perform pg_temp.ck('the CMO (not an admin) cannot write the catalogue', 'true',
    (pg_temp.try_as(pg_temp.f('cmo'), $q$insert into public.media_library (code, kind, title) values ('s57-x2', 'meditation', 'x')$q$) like '%row-level security%')::text);
end $$;

-- B. Library: read rule, script guard, manifest, sessions -------------------------------------------------------------------------------
do $$
declare v_a uuid := pg_temp.f('a'); v_ex uuid := pg_temp.f('ex'); r text; sid uuid; ev integer;
begin
  perform pg_temp.ck('a patient reads the published audio item', '1', pg_temp.q_as(pg_temp.f('pat'), format('select count(*)::text from public.media_library where id = %L', v_a)));
  perform pg_temp.ck('a patient reads no placeholder or draft', '0', pg_temp.q_as(pg_temp.f('pat'), $q$select count(*)::text from public.media_library where is_placeholder$q$));
  perform pg_temp.ck('anon cannot read the library', '42501', pg_temp.try_anon('select count(*) from public.media_library'));
  -- guard: a real patient does not see a script while the guard is off; a test account does; on, the real patient does
  perform pg_temp.ck('a real patient does not see scripts while the guard is off', '0', pg_temp.q_as(pg_temp.f('realpat'), format('select count(*)::text from public.media_library where id = %L', v_ex)));
  perform pg_temp.ck('a test account does (guards always open for tests)', '1', pg_temp.q_as(pg_temp.f('pat'), format('select count(*)::text from public.media_library where id = %L', v_ex)));
  perform pg_temp.ck('the real patient still sees audio with the guard off', '1', pg_temp.q_as(pg_temp.f('realpat'), format('select count(*)::text from public.media_library where id = %L', v_a)));
  perform pg_temp.guard('wellbeing_library_clinical_scripts', true);
  perform pg_temp.ck('...and sees scripts once the guard is on', '1', pg_temp.q_as(pg_temp.f('realpat'), format('select count(*)::text from public.media_library where id = %L', v_ex)));
  perform pg_temp.guard('wellbeing_library_clinical_scripts', false);

  perform pg_temp.ck('a real patient cannot record a session on a script while the guard is off', 'true',
    (pg_temp.q_as(pg_temp.f('realpat'), format($q$select public.record_media_session(%L, 600)::text$q$, v_ex)) like 'ERR:That item is not available%')::text);
  -- sessions + event
  r := pg_temp.q_as(pg_temp.f('pat'), format($q$select public.record_media_session(%L, 600)::text$q$, v_a)); sid := r::uuid;
  perform pg_temp.ck('a patient records a session', 'true', (sid is not null)::text);
  select count(*) into ev from public.domain_events where event_type = 'media.session_completed' and patient_id = pg_temp.f('pat') and aggregate_id = sid
    and payload = jsonb_build_object('session_id', sid);
  perform pg_temp.ck('the event is on the outbox with ids only (no media id)', '1', ev::text);
  perform pg_temp.ck('a short listen records but emits no event', '0', (
    select count(*)::text from (select pg_temp.q_as(pg_temp.f('pat'), format($q$select public.record_media_session(%L, 5)::text$q$, v_a)) x) y,
      lateral (select 1 from public.domain_events where event_type = 'media.session_completed' and patient_id = pg_temp.f('pat') and aggregate_id::text = y.x) z));
  perform pg_temp.ck('the patient reads their own sessions', '2', pg_temp.cnt(pg_temp.f('pat'), 'media_sessions'));
  perform pg_temp.ck('another patient reads none', '0', pg_temp.cnt(pg_temp.f('pat2'), 'media_sessions'));
  perform pg_temp.ck('a tied clinician reads none', '0', pg_temp.cnt(pg_temp.f('doctied'), 'media_sessions'));
  perform pg_temp.ck('a supporter with the mental-health category reads none', '0', pg_temp.cnt(pg_temp.f('cgyes'), 'media_sessions'));
  perform pg_temp.ck('an admin reads none', '0', pg_temp.cnt(pg_temp.f('admin'), 'media_sessions'));
  perform pg_temp.ck('a sponsor reads none', '0', pg_temp.cnt(pg_temp.f('spons'), 'media_sessions'));
  perform pg_temp.ck('a patient cannot insert a session directly', 'true',
    (pg_temp.try_as(pg_temp.f('pat'), format($q$insert into public.media_sessions (organisation_id, patient_id, media_id, listened_seconds) values (%L, %L, %L, 1)$q$, pg_temp.f('org'), pg_temp.f('pat'), v_a)) like '%permission denied%')::text);
  perform pg_temp.ck('staff cannot record a session', 'true', (pg_temp.q_as(pg_temp.f('doctied'), format($q$select public.record_media_session(%L, 100)::text$q$, v_a)) like 'ERR:not authorised%')::text);
  perform pg_temp.ck('anon cannot record a session', '42501', pg_temp.try_anon(format($q$select public.record_media_session(%L, 100)$q$, v_a)));

  -- manifest: audio only, cap respected
  r := pg_temp.q_as(pg_temp.f('pat'), 'select public.media_offline_manifest()::text');
  perform pg_temp.ck('the manifest lists the audio item and not scripts', '1', jsonb_array_length(r::jsonb -> 'items')::text);
  perform pg_temp.ck('the manifest says Wi-Fi only', 'true', (r::jsonb ->> 'wifi_only'));
  update public.media_library_config set config = jsonb_set(config, '{download,max_track_bytes}', '1000000') where is_active;
  perform pg_temp.ck('an item over the per-track cap is left out of the manifest', '0', jsonb_array_length(pg_temp.q_as(pg_temp.f('pat'), 'select public.media_offline_manifest()::text')::jsonb -> 'items')::text);
  update public.media_library_config set config = jsonb_set(config, '{download,max_track_bytes}', '5242880') where is_active;

  -- expiry: not served anywhere
  -- time passing is simulated with the gate trigger off (a real expiry needs no update at all)
  set local session_replication_role = replica;
  update public.media_library set next_review_due = (now() at time zone 'Africa/Lagos')::date where id = v_a;
  set local session_replication_role = origin;
  perform pg_temp.ck('an item on its review date is not read by a patient', '0', pg_temp.q_as(pg_temp.f('pat'), format('select count(*)::text from public.media_library where id = %L', v_a)));
  perform pg_temp.ck('...is not in the manifest', '0', jsonb_array_length(pg_temp.q_as(pg_temp.f('pat'), 'select public.media_offline_manifest()::text')::jsonb -> 'items')::text);
  perform pg_temp.ck('...cannot start a session', 'true', (pg_temp.q_as(pg_temp.f('pat'), format($q$select public.record_media_session(%L, 600)::text$q$, v_a)) like 'ERR:That item is not available%')::text);
  perform pg_temp.ck('...but an admin still sees it', '1', pg_temp.q_as(pg_temp.f('admin'), format('select count(*)::text from public.media_library where id = %L', v_a)));
  perform pg_temp.ck('the flag job marks it review due', '1', pg_temp.q_as(pg_temp.f('admin'), 'select public.media_library_flag_expired()::text'));
  perform pg_temp.ck('...and it cannot be republished without a new date', 'true', (pg_temp.pub(v_a, 'Dr Reviewer', 0) like '%next review date%')::text);
  perform pg_temp.ck('a patient cannot flag items', 'true', (pg_temp.q_as(pg_temp.f('pat'), 'select public.media_library_flag_expired()::text') like 'ERR:not authorised%')::text);
  perform pg_temp.ck('the readiness report is admin only', 'true', (pg_temp.q_as(pg_temp.f('pat'), 'select public.media_library_readiness_report()::text') like 'ERR:not authorised%')::text);
  perform pg_temp.ck('the readiness report counts 36 placeholders (12 structure rows and the 24 seeded draft scripts, S57b)', '36', (pg_temp.q_as(pg_temp.f('admin'), 'select public.media_library_readiness_report()::text')::jsonb ->> 'placeholders'));
end $$;

-- C. Journal ----------------------------------------------------------------------------------------------------------------------------
do $$
declare v_pat uuid := pg_temp.f('pat'); eid uuid := gen_random_uuid(); r text; t text;
begin
  perform pg_temp.ck('with sync off the server refuses an entry', 'true',
    (pg_temp.try_as(v_pat, format($q$select public.upsert_journal_entry(%L, 'xchacha20poly1305-v1', 'aaaaaaaaaaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbb', now())$q$, eid)) like '%sync is off%')::text);
  perform pg_temp.ck('the patient turns sync on', 'true', (pg_temp.q_as(v_pat, 'select public.set_journal_sync(true)::text')::jsonb ->> 'enabled'));
  perform pg_temp.ck('staff cannot turn it on for someone', 'true', (pg_temp.q_as(pg_temp.f('doctied'), 'select public.set_journal_sync(true)::text') like 'ERR:not authorised%')::text);
  perform pg_temp.ck('an entry syncs', 'ok', pg_temp.try_as(v_pat, format($q$select public.upsert_journal_entry(%L, 'xchacha20poly1305-v1', 'aaaaaaaaaaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbb', now())$q$, eid)));
  perform pg_temp.ck('an unknown cipher is refused', 'true',
    (pg_temp.try_as(v_pat, format($q$select public.upsert_journal_entry(%L, 'plaintext', 'aaaaaaaaaaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbb', now())$q$, gen_random_uuid())) like '%check constraint%')::text);
  perform pg_temp.try_as(v_pat, format($q$select public.upsert_journal_entry(%L, 'xchacha20poly1305-v1', 'aaaaaaaaaaaaaaaaaaaaaaaa', 'cccccccccccccccccccccccccccc', now() - interval '1 day')$q$, eid));
  perform pg_temp.ck('an older copy does not overwrite a newer one', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbb', (select ciphertext from public.journal_synced_entries where client_entry_id = eid));
  perform pg_temp.ck('the owner reads their copy', '1', pg_temp.cnt(v_pat, 'journal_synced_entries'));
  foreach t in array array['pat2', 'doctied', 'docuntied', 'coord', 'cmo', 'admin', 'spons', 'cgyes', 'cgno'] loop
    perform pg_temp.ck(t || ' reads no journal rows', '0', pg_temp.cnt(pg_temp.f(t), 'journal_synced_entries'));
  end loop;
  perform pg_temp.ck('nobody else sees the sync setting', '0', pg_temp.cnt(pg_temp.f('admin'), 'journal_sync_settings'));
  perform pg_temp.ck('anon is refused', '42501', pg_temp.try_anon('select count(*) from public.journal_synced_entries'));
  perform pg_temp.ck('the owner-only select is the ONLY policy on the journal table', '1', (select count(*)::text from pg_policies where tablename = 'journal_synced_entries'));
  perform pg_temp.ck('the staff audited read has no journal section', 'true',
    (pg_temp.q_as(pg_temp.f('doctied'), format($q$select public.read_patient_mental_health_audited(%L, 'trying to read the journal', array['journal'])::text$q$, v_pat)) like 'ERR:unknown section%')::text);
  perform pg_temp.q_as(pg_temp.f('pat2'), format($q$select public.delete_journal_entry(%L)::text$q$, eid));
  perform pg_temp.ck('another patient''s delete leaves the entry in place', '1', (select count(*)::text from public.journal_synced_entries where client_entry_id = eid));
  perform pg_temp.ck('a direct insert is refused', 'true',
    (pg_temp.try_as(v_pat, format($q$insert into public.journal_synced_entries (organisation_id, patient_id, client_entry_id, alg, iv, ciphertext, client_updated_at) values (%L, %L, gen_random_uuid(), 'xchacha20poly1305-v1', 'aaaaaaaaaaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbb', now())$q$, pg_temp.f('org'), v_pat)) like '%permission denied%')::text);
  r := pg_temp.q_as(v_pat, 'select public.set_journal_sync(false)::text');
  perform pg_temp.ck('turning sync off deletes every server copy', '1', r::jsonb ->> 'server_copies_deleted');
  perform pg_temp.ck('...none remain', '0', (select count(*)::text from public.journal_synced_entries where patient_id = v_pat));
end $$;

-- D. Sleep -----------------------------------------------------------------------------------------------------------------------------
do $$
declare v_pat uuid := pg_temp.f('pat'); v_real uuid := pg_temp.f('realpat'); r jsonb; rt text; yes jsonb; no jsonb; two jsonb; n integer;
begin
  yes := '{"snoring":"yes","tired":"yes","observed_pauses":"yes","high_blood_pressure":"yes","height_cm":160,"weight_kg":120,"age_over_50":"yes","neck_cm":45,"sex_male":"yes"}';
  no := '{"snoring":"no","tired":"no","observed_pauses":"no","high_blood_pressure":"no","height_cm":175,"weight_kg":70,"age_over_50":"no","neck_cm":35,"sex_male":"no"}';
  two := '{"snoring":"yes","tired":"yes","observed_pauses":"no","high_blood_pressure":"no","height_cm":175,"weight_kg":70,"age_over_50":"no","neck_cm":35,"sex_male":"no"}';
  perform pg_temp.ck('the seeded instrument is a draft, unsigned', '0', (select count(*)::text from public.sleep_apnoea_screen_config where status = 'confirmed'));
  perform pg_temp.ck('a real patient sees the questionnaire closed (guard off)', 'false', (pg_temp.q_as(v_real, 'select public.get_sleep_apnoea_instrument()::text')::jsonb ->> 'open'));
  perform pg_temp.ck('...and cannot submit', 'true', (pg_temp.q_as(v_real, format($q$select public.submit_sleep_apnoea_screen(%L::jsonb)::text$q$, yes)) like 'ERR:not open yet%')::text);
  r := pg_temp.q_as(v_pat, 'select public.get_sleep_apnoea_instrument()::text')::jsonb;
  perform pg_temp.ck('a test account sees it open, unsigned, 8 items', '8', jsonb_array_length(r -> 'items')::text);
  perform pg_temp.ck('...unsigned', 'false', r ->> 'signed');
  r := pg_temp.q_as(v_pat, format($q$select public.submit_sleep_apnoea_screen(%L::jsonb)::text$q$, yes))::jsonb;
  perform pg_temp.ck('UNSIGNED: every answer yes saves but shows no result', 'false', r ->> 'show_result');
  perform pg_temp.ck('UNSIGNED: no task is created', '0', (select count(*)::text from public.clinical_tasks where dedup_key = 'sleep_apnoea:' || v_pat));
  perform pg_temp.ck('UNSIGNED: no result is stored', 'true', (select (cut_off_met is null and not signed)::text from public.sleep_apnoea_screens where patient_id = v_pat order by created_at desc limit 1));
  -- guard ON for everybody, still unsigned
  perform pg_temp.guard('sleep_apnoea_screen_enabled', true);
  r := pg_temp.q_as(v_real, format($q$select public.submit_sleep_apnoea_screen(%L::jsonb)::text$q$, yes))::jsonb;
  perform pg_temp.ck('UNSIGNED with the guard ON: a real patient saves, no result', 'false', r ->> 'show_result');
  perform pg_temp.ck('UNSIGNED with the guard ON: still no task', '0', (select count(*)::text from public.clinical_tasks where dedup_key = 'sleep_apnoea:' || v_real));
  perform pg_temp.ck('a missing answer is refused', 'true', (pg_temp.q_as(v_pat, $q$select public.submit_sleep_apnoea_screen('{"snoring":"yes"}'::jsonb)::text$q$) like 'ERR:answer every question%')::text);
  perform pg_temp.ck('an unknown question is refused', 'true', (pg_temp.q_as(v_pat, format($q$select public.submit_sleep_apnoea_screen(%L::jsonb || '{"extra":"yes"}'::jsonb)::text$q$, no)) like 'ERR:unknown question%')::text);
  -- the CMO confirms: only a CMO can
  perform pg_temp.ck('a patient cannot confirm the instrument', 'true', (pg_temp.try_as(v_pat, 'select public.confirm_sleep_apnoea_screen_config(1)') like '%not authorised%')::text);
  perform pg_temp.ck('an admin cannot confirm it', 'true', (pg_temp.try_as(pg_temp.f('admin'), 'select public.confirm_sleep_apnoea_screen_config(1)') like '%not authorised%')::text);
  perform pg_temp.ck('a non-CMO clinician cannot confirm it', 'true', (pg_temp.try_as(pg_temp.f('doctied'), 'select public.confirm_sleep_apnoea_screen_config(1)') like '%not authorised%')::text);
  perform pg_temp.ck('...still unsigned', '0', (select count(*)::text from public.sleep_apnoea_screen_config where status = 'confirmed'));
  perform pg_temp.ck('the CMO confirms', 'ok', pg_temp.try_as(pg_temp.f('cmo'), 'select public.confirm_sleep_apnoea_screen_config(1)'));
  perform pg_temp.ck('...signed with a name and time', '1', (select count(*)::text from public.sleep_apnoea_screen_config where status = 'confirmed' and confirmed_by = pg_temp.f('cmo') and confirmed_at is not null));
  -- signed
  r := pg_temp.q_as(v_real, format($q$select public.submit_sleep_apnoea_screen(%L::jsonb)::text$q$, yes))::jsonb;
  perform pg_temp.ck('SIGNED + guard on + cut-off met: the result is shown', 'true', r ->> 'cut_off_met');
  perform pg_temp.ck('...and a referral task now exists', '1', (select count(*)::text from public.clinical_tasks where dedup_key = 'sleep_apnoea:' || v_real));
  r := pg_temp.q_as(pg_temp.f('pat2'), format($q$select public.submit_sleep_apnoea_screen(%L::jsonb)::text$q$, two))::jsonb;
  perform pg_temp.ck('SIGNED: below the cut-off shows false and creates no task', 'false', r ->> 'cut_off_met');
  perform pg_temp.ck('...no task', '0', (select count(*)::text from public.clinical_tasks where dedup_key = 'sleep_apnoea:' || pg_temp.f('pat2')));
  -- STOP-Bang scoring edges (S57b): BMI above 35 (not equal), neck 40 cm or more, unsure scores one point, bad numbers refused
  -- (rows of one transaction share created_at, so each case clears the test patient's rows first and reads the one it made)
  create or replace function pg_temp.score(p_extra jsonb) returns text language plpgsql as $f$
  declare v_p uuid := pg_temp.f('pat2'); v_no jsonb := '{"snoring":"no","tired":"no","observed_pauses":"no","high_blood_pressure":"no","height_cm":175,"weight_kg":70,"age_over_50":"no","neck_cm":35,"sex_male":"no"}';
  begin
    delete from public.sleep_apnoea_screens where patient_id = v_p;
    perform pg_temp.q_as(v_p, format($q$select public.submit_sleep_apnoea_screen(%L::jsonb)::text$q$, v_no || p_extra));
    return (select total || '/' || unsure_count from public.sleep_apnoea_screens where patient_id = v_p);
  end $f$;
  perform pg_temp.ck('BMI exactly 35 does not score', '0/0', pg_temp.score('{"height_cm":100,"weight_kg":35}'));
  perform pg_temp.ck('BMI above 35 scores one', '1/0', pg_temp.score('{"height_cm":100,"weight_kg":36}'));
  perform pg_temp.ck('neck 40 cm scores one', '1/0', pg_temp.score('{"neck_cm":40}'));
  perform pg_temp.ck('neck 39.9 cm does not score', '0/0', pg_temp.score('{"neck_cm":39.9}'));
  perform pg_temp.ck('a neck and a weight not sure score one each', '2/2', pg_temp.score('{"neck_cm":"unsure","weight_kg":"unsure"}'));
  perform pg_temp.ck('a yes/no not sure scores one', '1/1', pg_temp.score('{"sex_male":"unsure"}'));
  perform pg_temp.ck('an impossible height is refused', 'true', (pg_temp.q_as(pg_temp.f('pat2'), format($q$select public.submit_sleep_apnoea_screen(%L::jsonb)::text$q$, no::jsonb || '{"height_cm":5}'::jsonb)) like 'ERR:check the numbers%')::text);
  perform pg_temp.ck('a number given as text is refused', 'true', (pg_temp.q_as(pg_temp.f('pat2'), format($q$select public.submit_sleep_apnoea_screen(%L::jsonb)::text$q$, no::jsonb || '{"neck_cm":"big"}'::jsonb)) like 'ERR:check the numbers%')::text);
  perform pg_temp.ck('a missing measurement is refused', 'true', (pg_temp.q_as(pg_temp.f('pat2'), format($q$select public.submit_sleep_apnoea_screen(%L::jsonb)::text$q$, no::jsonb - 'neck_cm')) like 'ERR:answer every question%')::text);
  perform pg_temp.guard('sleep_apnoea_screen_enabled', false);
  rt := pg_temp.q_as(v_real, format($q$select public.submit_sleep_apnoea_screen(%L::jsonb)::text$q$, yes));
  perform pg_temp.ck('SIGNED but guard OFF: a real patient cannot submit', 'true', (rt like 'ERR:not open yet%')::text);

  -- access
  perform pg_temp.ck('the patient reads their own screens', '1', pg_temp.cnt(v_pat, 'sleep_apnoea_screens'));
end $$;

do $$
declare v_pat uuid := pg_temp.f('pat'); t text;
begin
  foreach t in array array['pat2', 'doctied', 'docuntied', 'coord', 'cmo', 'admin', 'spons', 'cgyes', 'cgno'] loop
    perform pg_temp.ck(t || ' reads no sleep screen rows directly', '0', pg_temp.q_as(pg_temp.f(t), format('select count(*)::text from public.sleep_apnoea_screens where patient_id = %L', v_pat)));
  end loop;
  perform pg_temp.ck('the tied clinician reads through the audited function', 'ok',
    pg_temp.q_as(pg_temp.f('doctied'), format($q$select public.read_patient_sleep_screens_audited(%L, 'reviewing the sleep referral')::jsonb ->> 'status'$q$, v_pat)));
  perform pg_temp.ck('...the read is audited', '1', (select count(*)::text from public.audit_log where actor_id = pg_temp.f('doctied') and action = 'staff.mental_health_read' and result = 'success' and event -> 'sections' ? 'sleep_screens'));
  foreach t in array array['docuntied', 'coord', 'admin', 'cmo'] loop
    perform pg_temp.ck(t || ' without a tie is denied', 'denied',
      pg_temp.q_as(pg_temp.f(t), format($q$select public.read_patient_sleep_screens_audited(%L, 'looking at this chart today')::jsonb ->> 'status'$q$, v_pat)));
    perform pg_temp.ck(t || ' denial is audited', '1', (select count(*)::text from public.audit_log where actor_id = pg_temp.f(t) and action = 'staff.mental_health_read' and result = 'denied' and event -> 'sections' ? 'sleep_screens'));
  end loop;
  perform pg_temp.ck('a reason is required', 'true', (pg_temp.q_as(pg_temp.f('doctied'), format($q$select public.read_patient_sleep_screens_audited(%L, 'x')::text$q$, v_pat)) like 'ERR:a reason%')::text);
  perform pg_temp.ck('another patient cannot read it', 'true', (pg_temp.q_as(pg_temp.f('pat2'), format($q$select public.read_patient_sleep_screens_audited(%L, 'looking at this chart today')::text$q$, v_pat)) like 'ERR:not authorised%')::text);
  perform pg_temp.ck('anon cannot call it', '42501', pg_temp.try_anon(format($q$select public.read_patient_sleep_screens_audited(%L)$q$, v_pat)));

  -- wind-down + diary
  perform pg_temp.ck('a patient saves a wind-down plan', 'ok', pg_temp.try_as(v_pat, $q$select public.save_wind_down_plan(45, array['dim_lights','breathing'], true)$q$));
  perform pg_temp.ck('an unknown step is refused', 'true', (pg_temp.try_as(v_pat, $q$select public.save_wind_down_plan(45, array['take_a_pill'], false)$q$) like '%check constraint%')::text);
  perform pg_temp.ck('a lead time over two hours is refused', 'true', (pg_temp.try_as(v_pat, $q$select public.save_wind_down_plan(300, array[]::text[], false)$q$) like '%check constraint%')::text);
  perform pg_temp.ck('the plan is the patient''s only', '0', pg_temp.cnt(pg_temp.f('doctied'), 'sleep_wind_down_plans'));
  perform pg_temp.ck('the owner reads it', '1', pg_temp.cnt(v_pat, 'sleep_wind_down_plans'));
  perform pg_temp.ck('staff cannot save a plan', 'true', (pg_temp.try_as(pg_temp.f('doctied'), $q$select public.save_wind_down_plan(45, array[]::text[], false)$q$) like '%not authorised%')::text);
  perform pg_temp.ck('diary: a night of 9 wakings is stored', 'ok', pg_temp.try_as(v_pat, format($q$insert into public.sleep_log_entries (organisation_id, patient_id, duration_hours, sleep_latency_minutes, night_awakenings, bedtime, waketime) values (%L, %L, 6.5, 25, 3, '23:00', '06:00')$q$, pg_temp.f('org'), v_pat)));
  perform pg_temp.ck('diary: an absurd latency is refused', 'true', (pg_temp.try_as(v_pat, format($q$insert into public.sleep_log_entries (organisation_id, patient_id, duration_hours, sleep_latency_minutes, logged_on) values (%L, %L, 6, 9999, current_date - 3)$q$, pg_temp.f('org'), v_pat)) like '%check constraint%')::text);
  perform pg_temp.ck('no sleep SCORE column exists', '0', (select count(*)::text from information_schema.columns where table_schema = 'public' and table_name in ('sleep_log_entries', 'sleep_wind_down_plans', 'sleep_apnoea_screens') and column_name ~* 'score'));
  perform pg_temp.ck('anon holds no grant on any new table', '0', (select count(*)::text from information_schema.role_table_grants where grantee = 'anon' and table_name in ('media_library', 'media_sessions', 'media_library_config', 'journal_sync_settings', 'journal_synced_entries', 'sleep_wind_down_plans', 'sleep_apnoea_screens', 'sleep_apnoea_screen_config')));
  perform pg_temp.ck('anon cannot execute any new function', '0', (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
    and p.proname in ('record_media_session', 'media_offline_manifest', 'set_journal_sync', 'upsert_journal_entry', 'delete_journal_entry', 'save_wind_down_plan', 'submit_sleep_apnoea_screen', 'get_sleep_apnoea_instrument', 'read_patient_sleep_screens_audited', 'confirm_sleep_apnoea_screen_config', 'media_library_flag_expired', 'media_library_readiness_report')
    and has_function_privilege('anon', p.oid, 'EXECUTE')));
  perform pg_temp.ck('both guards are seeded off', '0', (select count(*)::text from public.go_live_guards where key in ('wellbeing_library_clinical_scripts', 'sleep_apnoea_screen_enabled') and is_on));
end $$;

-- E. SABOTAGE -------------------------------------------------------------------------------------------------------------------------
-- (1) expiry rule removed
create or replace function private.media_is_servable(p_active boolean, p_status text, p_placeholder boolean, p_next_review date)
returns boolean language sql stable set search_path = '' as $$ select coalesce(p_active, false) $$;
-- (2) a staff policy on the journal
create policy journal_sabotage on public.journal_synced_entries for select to authenticated using (private.is_org_staff(organisation_id));
-- (3) the staff tie gate opened
create or replace function private.can_staff_read_mental_health(p_patient uuid) returns boolean language sql stable security definer set search_path = '' as $$ select true $$;
-- (4) the publish gate dropped
drop trigger media_library_gate on public.media_library;
-- (5) the signed check removed
do $$ declare d text; begin
  d := pg_get_functiondef('public.submit_sleep_apnoea_screen(jsonb)'::regprocedure);
  if d not like '%v_signed := v_cfg.status = ''confirmed'';%' then raise exception 'sabotage marker missing'; end if;
  execute replace(d, 'v_signed := v_cfg.status = ''confirmed'';', 'v_signed := true;');
end $$;
do $$
declare v_pat uuid := pg_temp.f('pat'); v_ph uuid; v_cfg_back boolean;
begin
  -- the published breathing item is made to pass its date, with the gate trigger off (it is already dropped below the sabotage, so use replica)
  set local session_replication_role = replica;
  update public.media_library set next_review_due = (now() at time zone 'Africa/Lagos')::date where id = pg_temp.f('b');
  set local session_replication_role = origin;
  perform pg_temp.sab('an expired item is not read by a patient', '0', pg_temp.q_as(pg_temp.f('pat'), format('select count(*)::text from public.media_library where id = %L', pg_temp.f('b'))));
  perform pg_temp.q_as(v_pat, 'select public.set_journal_sync(true)::text');
  perform pg_temp.try_as(v_pat, format($q$select public.upsert_journal_entry(%L, 'xchacha20poly1305-v1', 'aaaaaaaaaaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbb', now())$q$, gen_random_uuid()));
  perform pg_temp.sab('a clinician reads no journal rows', '0', pg_temp.cnt(pg_temp.f('doctied'), 'journal_synced_entries'));
  perform pg_temp.sab('a clinician without a tie is denied', 'denied',
    pg_temp.q_as(pg_temp.f('docuntied'), format($q$select public.read_patient_sleep_screens_audited(%L, 'looking at this chart today')::jsonb ->> 'status'$q$, v_pat)));
  select id into v_ph from public.media_library where code = 'draft-stress-1';
  perform pg_temp.sab('a placeholder cannot be published', 'true', (pg_temp.pub(v_ph) like '%placeholder cannot be published%')::text);
  -- (5) needs a confirmed instrument -> set it back to proposed, then submit all-yes as a test patient
  update public.sleep_apnoea_screen_config set status = 'proposed', confirmed_by = null, confirmed_at = null where version = 1;
  perform pg_temp.q_as(pg_temp.f('spons'), format($q$select public.submit_sleep_apnoea_screen(%L::jsonb)::text$q$,
    '{"snoring":"yes","tired":"yes","observed_pauses":"yes","high_blood_pressure":"yes","height_cm":160,"weight_kg":120,"age_over_50":"yes","neck_cm":45,"sex_male":"yes"}'));
  perform pg_temp.sab('an unsigned instrument creates no task', '0', (select count(*)::text from public.clinical_tasks where dedup_key = 'sleep_apnoea:' || pg_temp.f('spons')));
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S57 proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 5 then raise exception 'VACUOUS TEST: the sabotage flipped % of 5 checks', v_caught; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;

rollback;
