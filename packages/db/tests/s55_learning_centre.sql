-- S55 proof: Module 9, Health Learning Centre (migrations *_s55_learning_centre_foundation.sql and *_functions.sql).
-- The expiry acceptance test (content past its review date is not served) lives in f1_learning_content_expiry_gate.sql,
-- extended there to cover every S55 reader; this file proves everything else.
--
--   1. PUBLISH GATE: a missing reviewer, review date, source, self-care action, an unverified creator, a placeholder, or a
--      micro-lesson that is too long / has no action / has two check questions each refuse; a complete item publishes.
--   2. DRAFT PLACEHOLDERS: six exist, draft, inactive, invisible to a patient, cannot be published, and the flag cannot be
--      cleared without a named clinical author; the myth series itself is inactive.
--   3. SEARCH: "bp" finds an item that only says hypertension and "belle" finds pregnancy (synonym table); a zero-result search is logged once
--      per phrase with a count, an identifier-looking phrase is NOT logged, the log has no patient/organisation column, a patient cannot read
--      it, and an admin sees a phrase only after the configured count.
--   4. EVENTS: lesson.completed once (replay safe), course.completed when the last module is understood; ids only.
--   5. CREATORS: invite-only (a patient, a clinician and anon cannot create or read others), own row readable, only an admin verifies, never
--      themselves, never without evidence; credit shows only while verified; suspension takes their published items down.
--   6. SAVE FOR CONSULTATION: a patient saves, another patient sees nothing, an untied clinician is refused (and a denied audit written), a tied
--      clinician reads (and an audit row is written), anon refused.
--   7. SHARE LINK: anon opens a published, reviewed article; not a faq, not share-disabled, not unreviewed, not a placeholder, not expired; the
--      returned columns carry no patient data.
--   8. OFFLINE PACK: lists servable items only; pack status flags removed items.
--   SABOTAGE: publish gate dropped (an incomplete item publishes), synonym config deactivated (bp misses) and the audience gate neutered
--   (a 20 year old finds a 40-and-over item); each must flip a check.
begin;

create temp table results(n serial, check_name text, ok boolean) on commit drop;
grant all on results to public;
grant all on results_n_seq to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;

create function pg_temp.f(p text) returns uuid language sql as $$ select v from fx where k = p $$;
create function pg_temp.setf(p text, p_v uuid) returns void language sql as
$$ insert into fx values (p, p_v) on conflict (k) do update set v = excluded.v $$;
create function pg_temp.ck(p_name text, p_ok boolean) returns void language plpgsql as
$f$ begin
  insert into results(check_name, ok) values (p_name, coalesce(p_ok, false));
  if not coalesce(p_ok, false) then raise exception 'FAIL: %', p_name; end if;
end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's55-' || p_label || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, is_test)
  values (v, p_org, p_role::public.user_role, 'S55 ' || p_label, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true;
  return v;
end $f$;
-- run one statement as a user; return 'ok' or the sqlstate
create function pg_temp.as_try(p_uid uuid, p_sql text) returns text language plpgsql as $f$
declare r text := 'ok';
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin execute p_sql; exception when others then r := sqlstate; end;
  reset role; perform set_config('request.jwt.claims', '', true);
  return r;
end $f$;
-- run a count(*) query as a user (or anon when p_uid is null)
create function pg_temp.as_count(p_uid uuid, p_sql text) returns integer language plpgsql as $f$
declare n integer;
begin
  if p_uid is null then
    perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
    set local role anon;
  else
    perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
    set local role authenticated;
  end if;
  begin execute p_sql into n; exception when others then n := -1; end;
  reset role; perform set_config('request.jwt.claims', '', true);
  return n;
end $f$;
-- a complete, publishable item
create function pg_temp.mkitem(p_code text, p_extra text default '') returns uuid language plpgsql as $f$
declare v uuid;
begin
  execute format($q$insert into public.health_education_content
    (code, title, summary, body, category, content_status, clinician_reviewed, reviewed_by_name, reviewed_at, source_reference,
     self_care_action, next_review_due %s) values (%L, %L, 'summary', %L, 'getting_started', 'draft', true, 'Dr Reviewer', now(), 'Proof source',
     'Do one thing today.', current_date + 90) returning id$q$, '', p_code, 'S55 ' || p_code, 'Body for ' || p_code) into v;
  return v;
end $f$;
create function pg_temp.publish(p_id uuid) returns text language plpgsql as $f$
begin
  update public.health_education_content set content_status = 'published' where id = p_id;
  return 'ok';
exception when others then return sqlstate;
end $f$;

do $$
declare
  v_org uuid;
  v_admin uuid; v_admin2 uuid; v_pa uuid; v_pb uuid; v_cc uuid; v_ct uuid; v_cu uuid;
  v_id uuid; v_id2 uuid; v_id3 uuid; v_prog uuid; v_n integer; v_cr uuid; v_s text;
begin
  select id, organisation_id into v_admin, v_org from public.profiles where role = 'admin' limit 1;
  v_admin2 := pg_temp.mkuser(v_org, 'admin2', 'admin');
  v_pa := pg_temp.mkuser(v_org, 'patient-a', 'patient');
  v_pb := pg_temp.mkuser(v_org, 'patient-b', 'patient');
  v_cc := pg_temp.mkuser(v_org, 'creator', 'clinician');
  v_ct := pg_temp.mkuser(v_org, 'tied', 'clinician');
  v_cu := pg_temp.mkuser(v_org, 'untied', 'clinician');
  perform pg_temp.setf('admin', v_admin); perform pg_temp.setf('admin2', v_admin2);
  perform pg_temp.setf('pa', v_pa); perform pg_temp.setf('pb', v_pb); perform pg_temp.setf('cc', v_cc);
  perform pg_temp.setf('ct', v_ct); perform pg_temp.setf('cu', v_cu);
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id) values (v_org, v_pa, v_ct);

  -- ================= 1. publish gate =================
  v_id := pg_temp.mkitem('s55-gate-ok');
  update public.health_education_content set creator_id = null where id = v_id;
  perform pg_temp.ck('1a complete item publishes', pg_temp.publish(v_id) = 'ok');

  v_id := pg_temp.mkitem('s55-gate-noreviewer');
  update public.health_education_content set reviewed_by_name = null where id = v_id;
  perform pg_temp.ck('1b no named reviewer is refused', pg_temp.publish(v_id) = '23514');
  v_id := pg_temp.mkitem('s55-gate-nosource');
  update public.health_education_content set source_reference = null, evidence_source = null where id = v_id;
  perform pg_temp.ck('1c no source is refused', pg_temp.publish(v_id) = '23514');
  v_id := pg_temp.mkitem('s55-gate-nodate');
  update public.health_education_content set next_review_due = null where id = v_id;
  perform pg_temp.ck('1d no review date is refused', pg_temp.publish(v_id) = '23514');
  v_id := pg_temp.mkitem('s55-gate-pastdate');
  update public.health_education_content set next_review_due = current_date - 1 where id = v_id;
  perform pg_temp.ck('1e a past review date is refused', pg_temp.publish(v_id) = '23514');
  v_id := pg_temp.mkitem('s55-gate-noaction');
  update public.health_education_content set self_care_action = null where id = v_id;
  perform pg_temp.ck('1f no "What can I do next?" self-care action is refused', pg_temp.publish(v_id) = '23514');
  v_id := pg_temp.mkitem('s55-gate-notreviewed');
  update public.health_education_content set clinician_reviewed = false where id = v_id;
  perform pg_temp.ck('1g not clinician reviewed is refused', pg_temp.publish(v_id) = '23514');

  v_id := pg_temp.mkitem('s55-micro-long');
  update public.health_education_content set is_micro_lesson = true, lesson_action = 'Walk for ten minutes', estimated_minutes = 9,
    knowledge_check = '[{"question":"q","options":["a","b"],"answer_index":0}]'::jsonb where id = v_id;
  perform pg_temp.ck('1h a micro-lesson over the configured minutes is refused', pg_temp.publish(v_id) = '23514');
  v_id := pg_temp.mkitem('s55-micro-noaction');
  update public.health_education_content set is_micro_lesson = true, estimated_minutes = 3,
    knowledge_check = '[{"question":"q","options":["a","b"],"answer_index":0}]'::jsonb where id = v_id;
  perform pg_temp.ck('1i a micro-lesson with no action is refused', pg_temp.publish(v_id) = '23514');
  v_id := pg_temp.mkitem('s55-micro-twoq');
  update public.health_education_content set is_micro_lesson = true, lesson_action = 'Walk for ten minutes', estimated_minutes = 3,
    knowledge_check = '[{"question":"q","options":["a","b"],"answer_index":0},{"question":"r","options":["a","b"],"answer_index":1}]'::jsonb where id = v_id;
  perform pg_temp.ck('1j a micro-lesson with two check questions is refused', pg_temp.publish(v_id) = '23514');
  v_id := pg_temp.mkitem('s55-micro-ok');
  update public.health_education_content set is_micro_lesson = true, lesson_action = 'Walk for ten minutes', estimated_minutes = 4,
    knowledge_check = '[{"question":"q","options":["a","b"],"answer_index":0}]'::jsonb where id = v_id;
  perform pg_temp.ck('1k a well-formed micro-lesson publishes', pg_temp.publish(v_id) = 'ok');
  perform pg_temp.setf('micro', v_id);

  -- ================= 2. placeholders =================
  select count(*) into v_n from public.health_education_content where is_placeholder and content_status = 'draft' and not is_active;
  perform pg_temp.ck('2a six draft placeholders exist and none is active', v_n = 6);
  perform pg_temp.ck('2b the myth series programme is inactive', (select not is_active and kind = 'series' from public.health_education_programmes where code = 'myth_busting'));
  perform pg_temp.ck('2c a patient reads none of the placeholders',
    pg_temp.as_count(v_pa, 'select count(*) from public.health_education_content where is_placeholder') = 0);
  perform pg_temp.ck('2d a placeholder cannot be published', pg_temp.publish((select id from public.health_education_content where code = 'myth-draft-01')) = '23514');
  begin
    update public.health_education_content set is_placeholder = false where code = 'myth-draft-02';
    perform pg_temp.ck('2e clearing the placeholder flag without a clinical author is refused', false);
  exception when sqlstate '23514' then perform pg_temp.ck('2e clearing the placeholder flag without a clinical author is refused', true);
  end;
  begin
    update public.health_education_content set is_placeholder = false, clinical_author_name = 'Dr Real Author' where code = 'myth-draft-02';
    perform pg_temp.ck('2f clearing it with the placeholder body still in place is refused', false);
  exception when sqlstate '23514' then perform pg_temp.ck('2f clearing it with the placeholder body still in place is refused', true);
  end;

  -- ================= 3. search and the zero-result log =================
  v_id := pg_temp.mkitem('s55-search-htn');
  update public.health_education_content set title = 'Living well with hypertension', body = 'Hypertension is a long-term condition.' where id = v_id;
  perform pg_temp.publish(v_id);
  v_id2 := pg_temp.mkitem('s55-search-belle');
  update public.health_education_content set title = 'Your first antenatal visit', body = 'What to expect during pregnancy.' where id = v_id2;
  perform pg_temp.publish(v_id2);
  perform pg_temp.ck('3a "bp" finds an item that only says hypertension',
    pg_temp.as_count(v_pa, $q$select count(*) from public.search_health_education('BP') where code = 's55-search-htn'$q$) = 1);
  perform pg_temp.ck('3b "belle" finds the pregnancy item',
    pg_temp.as_count(v_pa, $q$select count(*) from public.search_health_education('belle') where code = 's55-search-belle'$q$) = 1);
  perform pg_temp.ck('3c anon cannot search', pg_temp.as_count(null, $q$select count(*) from public.search_health_education('bp')$q$) = -1);

  -- the log is OFF in the shipped config, and a type-ahead search never logs even when it is on
  perform pg_temp.as_count(v_pa, $q$select count(*) from public.search_health_education('quokka dental plan', 20, true)$q$);
  perform pg_temp.ck('3c2 the zero-result log is off until confirmed: a submitted search with no result writes nothing',
    not exists (select 1 from public.learning_search_gaps));
  insert into public.learning_config (key, version, value)
    select 'search_gap_log', 2, jsonb_set(private.learning_config('search_gap_log'), '{enabled}', 'true'::jsonb);
  perform pg_temp.as_count(v_pa, $q$select count(*) from public.search_health_education('quokka dental plan')$q$);
  perform pg_temp.ck('3c3 with the log on, a type-ahead search (not submitted) still writes nothing', not exists (select 1 from public.learning_search_gaps));
  perform pg_temp.as_count(v_pa, $q$select count(*) from public.search_health_education('quokka dental plan', 20, true)$q$);
  perform pg_temp.as_count(v_pb, $q$select count(*) from public.search_health_education('Quokka dental plan!', 20, true)$q$);
  perform pg_temp.ck('3d a zero-result phrase is logged once with a count of 2 across two patients',
    (select hit_count from public.learning_search_gaps where query_norm = 'quokka dental plan') = 2);
  perform pg_temp.as_count(v_pa, $q$select count(*) from public.search_health_education('my number is 08031234567', 20, true)$q$);
  perform pg_temp.as_count(v_pa, $q$select count(*) from public.search_health_education('call me a@b.com', 20, true)$q$);
  perform pg_temp.ck('3e a phrase that looks like an identifier is never logged',
    not exists (select 1 from public.learning_search_gaps where query_norm like '%0803%' or query_norm like '%a b com%' or query_norm like '%call me%'));
  perform pg_temp.ck('3f the log has no patient, organisation or user column',
    not exists (select 1 from information_schema.columns where table_name = 'learning_search_gaps'
                 and (column_name like '%patient%' or column_name like '%user%' or column_name like '%org%' or column_name like '%profile%')));
  perform pg_temp.ck('3g a patient cannot read the log', pg_temp.as_count(v_pa, 'select count(*) from public.learning_search_gaps') = 0);
  perform pg_temp.ck('3h a patient cannot call the admin report', pg_temp.as_try(v_pa, 'select * from public.learning_search_gaps_report()') = '42501');
  perform pg_temp.ck('3i the admin report hides a phrase below the configured count',
    pg_temp.as_count(v_admin, $q$select count(*) from public.learning_search_gaps_report() where query_norm = 'quokka dental plan'$q$) = 0);
  perform pg_temp.as_count(v_pa, $q$select count(*) from public.search_health_education('quokka dental plan', 20, true)$q$);
  perform pg_temp.ck('3j at the configured count the admin sees it',
    pg_temp.as_count(v_admin, $q$select count(*) from public.learning_search_gaps_report() where query_norm = 'quokka dental plan'$q$) = 1);
  insert into public.learning_search_gaps (query_norm, last_seen) values ('ancient phrase', current_date - 400);
  perform pg_temp.as_count(v_pa, $q$select count(*) from public.search_health_education('another unfindable phrase', 20, true)$q$);
  perform pg_temp.ck('3k rows past the retention are deleted', not exists (select 1 from public.learning_search_gaps where query_norm = 'ancient phrase'));

  -- synonym matching is longest-first and non-overlapping: "high blood sugar" is about sugar, not blood pressure
  v_id2 := pg_temp.mkitem('s55-search-dm');
  update public.health_education_content set title = 'Living with diabetes', body = 'Diabetes affects your blood glucose.' where id = v_id2;
  perform pg_temp.publish(v_id2);
  perform pg_temp.ck('3l "high blood sugar" finds the diabetes item',
    pg_temp.as_count(v_pa, $q$select count(*) from public.search_health_education('high blood sugar') where code = 's55-search-dm'$q$) = 1);
  perform pg_temp.ck('3m ...and does not drag in the hypertension-only item through the overlapping "high blood"',
    pg_temp.as_count(v_pa, $q$select count(*) from public.search_health_education('high blood sugar') where code = 's55-search-htn'$q$) = 0);
  perform pg_temp.ck('3n "high blood" on its own still finds the hypertension item',
    pg_temp.as_count(v_pa, $q$select count(*) from public.search_health_education('my high blood') where code = 's55-search-htn'$q$) = 1);
  -- identifiers however they are spaced are never logged
  perform pg_temp.as_count(v_pa, $q$select count(*) from public.search_health_education('call 080 312 345 67', 20, true)$q$);
  perform pg_temp.ck('3o a phone number typed with spaces is not logged',
    not exists (select 1 from public.learning_search_gaps where query_norm like '%312%' or query_norm like '%080%'));
  -- the log cannot grow without bound, and junk cannot blind it: at max_rows the lowest-count, oldest row makes room
  insert into public.learning_config (key, version, value)
    select 'search_gap_log', 3, jsonb_set(private.learning_config('search_gap_log'), '{max_rows}', to_jsonb((select count(*) from public.learning_search_gaps)));
  select count(*) into v_n from public.learning_search_gaps;
  perform pg_temp.as_count(v_pa, $q$select count(*) from public.search_health_education('brand new unfindable phrase', 20, true)$q$);
  perform pg_temp.ck('3p at max_rows a new phrase still gets in', exists (select 1 from public.learning_search_gaps where query_norm = 'brand new unfindable phrase'));
  perform pg_temp.ck('3q ...the table did not grow', (select count(*) from public.learning_search_gaps) = v_n);
  perform pg_temp.ck('3q2 ...and the frequent phrase was kept while a count-1 phrase was evicted',
    exists (select 1 from public.learning_search_gaps where query_norm = 'quokka dental plan'));
  delete from public.learning_config where key = 'search_gap_log' and version = 3;
  -- the report ignores rows past the retention even before the next delete removes them
  insert into public.learning_search_gaps (query_norm, hit_count, last_seen) values ('stale but frequent', 9, current_date - 200);
  perform pg_temp.ck('3r the admin report hides a row past its retention',
    pg_temp.as_count(v_admin, $q$select count(*) from public.learning_search_gaps_report() where query_norm = 'stale but frequent'$q$) = 0);
  delete from public.learning_search_gaps where query_norm = 'stale but frequent';
  delete from public.learning_config where key = 'search_gap_log' and version = 2;

  -- audience: an item with an age range is hidden from a patient outside it on every new reader (the feed's rule)
  v_id3 := pg_temp.mkitem('s55-age');
  update public.health_education_content set title = 'Quokka midlife checkup', body = 'Quokka midlife checkup guidance.', min_age = 40, is_micro_lesson = false where id = v_id3;
  perform pg_temp.publish(v_id3);
  update public.profiles set date_of_birth = current_date - interval '20 years' where id = v_pa;
  perform pg_temp.ck('3s a 20 year old does not find a 40-and-over item', pg_temp.as_count(v_pa, $q$select count(*) from public.search_health_education('quokka midlife') where code = 's55-age'$q$) = 0);
  perform pg_temp.ck('3t ...nor is it in their offline pack', pg_temp.as_count(v_pa, $q$select count(*) from public.learning_offline_pack() where code = 's55-age'$q$) = 0);
  perform pg_temp.ck('3t2 ...it is not servable for pack status, cannot be saved, and has no trust record for that patient',
    pg_temp.as_count(v_pa, $q$select count(*) from public.learning_pack_status(array['s55-age']) where servable$q$) = 0
    and pg_temp.as_count(v_pa, $q$select (public.save_lesson_for_consultation('s55-age'))::int$q$) = 0
    and pg_temp.as_count(v_pa, $q$select count(*) from public.health_education_item_trust(array['s55-age'])$q$) = 0);
  update public.profiles set date_of_birth = current_date - interval '50 years' where id = v_pa;
  perform pg_temp.ck('3u a 50 year old finds it', pg_temp.as_count(v_pa, $q$select count(*) from public.search_health_education('quokka midlife') where code = 's55-age'$q$) = 1);
  update public.profiles set date_of_birth = null where id = v_pa;
  perform pg_temp.ck('3v an unknown age is not restricted (as in the feed)', pg_temp.as_count(v_pa, $q$select count(*) from public.search_health_education('quokka midlife') where code = 's55-age'$q$) = 1);

  -- ================= 4. events =================
  insert into public.health_education_programmes (code, title, is_active, kind) values ('s55-course', 'S55 course', true, 'course') returning id into v_prog;
  v_id3 := pg_temp.mkitem('s55-course-l2'); perform pg_temp.publish(v_id3);
  insert into public.health_education_programme_modules (programme_id, content_id, module_number, title)
    values (v_prog, pg_temp.f('micro'), 1, 'L1'), (v_prog, v_id3, 2, 'L2');
  perform set_config('request.jwt.claims', json_build_object('sub', v_pa, 'role', 'authenticated')::text, true);
  insert into public.health_education_progress (organisation_id, patient_id, content_id, status) values (v_org, v_pa, pg_temp.f('micro'), 'seen');
  select count(*) into v_n from public.domain_events where event_type = 'lesson.completed' and patient_id = v_pa;
  perform pg_temp.ck('4a no event while only seen', v_n = 0);
  update public.health_education_progress set status = 'understood' where patient_id = v_pa and content_id = pg_temp.f('micro');
  update public.health_education_progress set status = 'needs_review' where patient_id = v_pa and content_id = pg_temp.f('micro');
  update public.health_education_progress set status = 'understood' where patient_id = v_pa and content_id = pg_temp.f('micro');
  select count(*) into v_n from public.domain_events where event_type = 'lesson.completed' and patient_id = v_pa;
  perform pg_temp.ck('4b exactly one lesson.completed despite a replay', v_n = 1);
  perform pg_temp.ck('4c no course.completed with a module still open',
    not exists (select 1 from public.domain_events where event_type = 'course.completed' and patient_id = v_pa));
  insert into public.health_education_progress (organisation_id, patient_id, content_id, status) values (v_org, v_pa, v_id3, 'understood');
  perform pg_temp.ck('4d course.completed once the last module is understood',
    (select count(*) from public.domain_events where event_type = 'course.completed' and patient_id = v_pa) = 1);
  perform pg_temp.ck('4e the payloads hold course and lesson codes and a count only (S33 contract, no topic names)',
    not exists (select 1 from public.domain_events where patient_id = v_pa and event_type in ('lesson.completed', 'course.completed')
                 and (select count(*) from jsonb_object_keys(payload) k where k not in ('course_code', 'lesson_code', 'lesson_count')) > 0));
  perform pg_temp.ck('4f the events are marked test for a test patient',
    (select bool_and(is_test) from public.domain_events where patient_id = v_pa and event_type in ('lesson.completed', 'course.completed')));
  perform pg_temp.ck('4g S55 registers no second emitter of these events',
    not exists (select 1 from pg_trigger where tgname = 'health_education_progress_emit_events'));

  -- ================= 5. creators =================
  perform pg_temp.ck('5a a patient cannot invite', pg_temp.as_try(v_pa, format('select public.invite_learning_creator(%L, ''X Name'')', v_cc)) = '42501');
  perform pg_temp.ck('5b a clinician cannot invite', pg_temp.as_try(v_cu, format('select public.invite_learning_creator(%L, ''X Name'')', v_cc)) = '42501');
  perform pg_temp.ck('5c anon cannot invite', pg_temp.as_count(null, format('select count(public.invite_learning_creator(%L, ''X Name''))', v_cc)) = -1);
  perform pg_temp.ck('5d only a clinician login can be invited', pg_temp.as_try(v_admin, format('select public.invite_learning_creator(%L, ''X Name'')', v_pa)) = '22023');
  perform pg_temp.ck('5e nobody can insert a creator row directly',
    pg_temp.as_try(v_cc, format('insert into public.learning_creators (organisation_id, profile_id, display_name) values (%L, %L, ''Self'')', v_org, v_cc)) <> 'ok');
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_cr := public.invite_learning_creator(v_cc, 'Dr Creator Name');
  reset role; perform set_config('request.jwt.claims', '', true);
  perform pg_temp.setf('cr', v_cr);
  perform pg_temp.ck('5f the creator reads their own row', pg_temp.as_count(v_cc, 'select count(*) from public.learning_creators') = 1);
  perform pg_temp.ck('5g another clinician reads no creator rows', pg_temp.as_count(v_cu, 'select count(*) from public.learning_creators') = 0);
  perform pg_temp.ck('5h a patient reads no creator rows', pg_temp.as_count(v_pa, 'select count(*) from public.learning_creators') = 0);
  perform pg_temp.ck('5i anon reads no creator rows', pg_temp.as_count(null, 'select count(*) from public.learning_creators') = -1);
  perform pg_temp.ck('5j verification is refused before credentials are submitted', pg_temp.as_try(v_admin, format('select public.verify_learning_creator(%L)', v_cr)) = '22023');
  perform pg_temp.ck('5k short evidence is refused', pg_temp.as_try(v_cc, $q$select public.submit_creator_credentials('MDCN1', 'short', true)$q$) = '22023');
  perform pg_temp.ck('5l credentials submitted', pg_temp.as_try(v_cc, $q$select public.submit_creator_credentials('MDCN12345', 'Folio sighted on the MDCN register, certificate on file', true)$q$) = 'ok');
  perform pg_temp.ck('5m the creator cannot verify themselves (not an admin)', pg_temp.as_try(v_cc, format('select public.verify_learning_creator(%L)', v_cr)) = '42501');
  perform pg_temp.ck('5n a clinician cannot verify', pg_temp.as_try(v_cu, format('select public.verify_learning_creator(%L)', v_cr)) = '42501');
  -- an admin who is also the creator may not verify themselves
  v_s := pg_temp.as_try(v_admin2, format('select public.verify_learning_creator(%L)', v_cr));
  perform pg_temp.ck('5o a different admin verifies', v_s = 'ok');
  perform pg_temp.ck('5p the creator row is verified with a verifier', (select status = 'verified' and verified_by = v_admin2 from public.learning_creators where id = v_cr));
  perform pg_temp.ck('5p2 not even an admin can write a creator row directly (every change goes through the audited functions)',
    pg_temp.as_try(v_admin, format('update public.learning_creators set status_note = ''direct'' where id = %L', v_cr)) = '42501'
    and pg_temp.as_try(v_admin, format('insert into public.learning_creators (organisation_id, profile_id, display_name, status) values (%L, %L, ''Direct'', ''invited'')', v_org, v_cu)) = '42501');
  -- credit appears only while verified
  v_id := pg_temp.mkitem('s55-credit');
  update public.health_education_content set creator_id = v_cr where id = v_id;
  perform pg_temp.ck('5q a verified creator can be credited and the item publishes', pg_temp.publish(v_id) = 'ok');
  -- a second credited item that a protocol bump has FLAGGED (review_due, still served, OQ-F1-04): suspension must take it down too
  v_id3 := pg_temp.mkitem('s55-credit-flag');
  update public.health_education_content set creator_id = v_cr where id = v_id3;
  perform pg_temp.publish(v_id3);
  update public.health_education_content set content_status = 'review_due' where id = v_id3;
  perform pg_temp.ck('5q2 a flagged (review_due) item is still served to a patient',
    pg_temp.as_count(v_pa, format('select count(*) from public.health_education_content where id = %L', v_id3)) = 1);
  perform set_config('request.jwt.claims', json_build_object('sub', v_pa, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from public.health_education_item_trust(array['s55-credit']) where creator_name = 'Dr Creator Name';
  reset role; perform set_config('request.jwt.claims', '', true);
  perform pg_temp.ck('5r the credit is shown by name to a patient', v_n = 1);
  -- suspension
  perform pg_temp.ck('5s a short reason is refused', pg_temp.as_try(v_admin, format('select public.suspend_learning_creator(%L, ''no'')', v_cr)) = '22023');
  perform pg_temp.ck('5t a clinician cannot suspend', pg_temp.as_try(v_cu, format('select public.suspend_learning_creator(%L, ''a long enough reason'')', v_cr)) = '42501');
  perform pg_temp.ck('5u an admin suspends', pg_temp.as_try(v_admin, format('select public.suspend_learning_creator(%L, ''Registration query raised by the council'')', v_cr)) = 'ok');
  perform pg_temp.ck('5v the credited item is taken down (needs re-review: status updated, not live)', (select content_status = 'updated' and not is_active from public.health_education_content where id = v_id));
  perform pg_temp.ck('5v2 ...and so is a credited item that was only flagged review_due (a flag keeps content served, so suspension must really take it down)',
    (select content_status = 'updated' and not is_active from public.health_education_content where code = 's55-credit-flag')
    and pg_temp.as_count(v_pa, format('select count(*) from public.health_education_content where code = ''s55-credit-flag''')) = 0);
  perform pg_temp.ck('5v3 ...with both moves in the status history',
    (select count(*) from public.health_education_content_status_history h join public.health_education_content c on c.id = h.content_id
      where c.creator_id = v_cr and h.to_status = 'updated' and h.note = 'Automatic: credited creator suspended') = 2);
  perform pg_temp.ck('5w a patient no longer reads it', pg_temp.as_count(v_pa, format('select count(*) from public.health_education_content where id = %L', v_id)) = 0);
  v_id := pg_temp.mkitem('s55-credit2');
  update public.health_education_content set creator_id = v_cr where id = v_id;
  perform pg_temp.ck('5x an item credited to a suspended creator cannot publish', pg_temp.publish(v_id) = '23514');
  perform pg_temp.ck('5y a short note is refused on reinstate', pg_temp.as_try(v_admin, format('select public.reinstate_learning_creator(%L, ''no'')', v_cr)) = '22023');
  perform pg_temp.ck('5z a clinician cannot reinstate', pg_temp.as_try(v_cu, format('select public.reinstate_learning_creator(%L, ''Registration query resolved'')', v_cr)) = '42501');
  v_s := pg_temp.as_try(v_admin, format('select public.reinstate_learning_creator(%L, ''Registration query resolved by the council'')', v_cr));
  perform pg_temp.ck('5aa an admin reinstates a suspended creator', v_s = 'ok');
  perform pg_temp.ck('5aa2 ...back to invited with the old MDCN number and evidence cleared (they must send them again)',
    (select status = 'invited' and verified_by is null and mdcn_number is null and credential_evidence is null and not indemnity_confirmed from public.learning_creators where id = v_cr));
  perform pg_temp.ck('5ab the credited item stays down until it is reviewed again', (select content_status = 'updated' from public.health_education_content where code = 's55-credit'));
  perform pg_temp.ck('5ab2 they cannot be verified again until they have sent credentials', pg_temp.as_try(v_admin2, format('select public.verify_learning_creator(%L)', v_cr)) = '22023');
  perform pg_temp.ck('5ab3 they send new credentials', pg_temp.as_try(v_cc, $q$select public.submit_creator_credentials('MDCN12345', 'Register entry re-checked and new certificate on file', true)$q$) = 'ok');
  perform pg_temp.ck('5ac a different admin verifies them again', pg_temp.as_try(v_admin2, format('select public.verify_learning_creator(%L)', v_cr)) = 'ok');
  perform pg_temp.ck('5ad a verified creator cannot be reinstated (nothing to reinstate)', pg_temp.as_try(v_admin, format('select public.reinstate_learning_creator(%L, ''Registration query resolved by the council'')', v_cr)) = '22023');
  perform pg_temp.as_try(v_admin, format('select public.suspend_learning_creator(%L, ''Suspended again for the rest of the proof'')', v_cr));
  perform pg_temp.setf('unverified_item', v_id);

  -- ================= 6. save for consultation =================
  perform pg_temp.ck('6a a patient saves a servable lesson',
    pg_temp.as_count(v_pa, $q$select (public.save_lesson_for_consultation('s55-search-htn'))::int$q$) = 1);
  perform pg_temp.ck('6b a placeholder cannot be saved',
    pg_temp.as_count(v_pa, $q$select (public.save_lesson_for_consultation('myth-draft-01'))::int$q$) = 0);
  perform pg_temp.ck('6c the patient reads their own save', pg_temp.as_count(v_pa, 'select count(*) from public.learning_saved_for_consultation') = 1);
  perform pg_temp.ck('6d another patient reads nothing', pg_temp.as_count(v_pb, 'select count(*) from public.learning_saved_for_consultation') = 0);
  perform pg_temp.ck('6e a patient cannot write the table directly',
    pg_temp.as_try(v_pa, format('insert into public.learning_saved_for_consultation (organisation_id, patient_id, content_id) values (%L, %L, %L)', v_org, v_pa, pg_temp.f('micro'))) <> 'ok');
  perform pg_temp.ck('6f an untied clinician sees nothing', pg_temp.as_count(v_cu, format('select count(*) from public.consultation_saved_lessons(%L)', v_pa)) = 0);
  perform pg_temp.ck('6g the refusal wrote a denied audit row',
    exists (select 1 from public.audit_log where actor_id = v_cu and subject_patient_id = v_pa));
  perform pg_temp.ck('6h a tied clinician reads the saved lesson',
    pg_temp.as_count(v_ct, format('select count(*) from public.consultation_saved_lessons(%L)', v_pa)) = 1);
  perform pg_temp.ck('6i the tied read is audited',
    exists (select 1 from public.audit_log where actor_id = v_ct and action = 'learning_saved.read' and subject_patient_id = v_pa and result = 'success'));
  perform pg_temp.ck('6j anon is refused', pg_temp.as_count(null, format('select count(*) from public.consultation_saved_lessons(%L)', v_pa)) = -1);
  perform pg_temp.ck('6k a patient is refused the clinician read', pg_temp.as_try(v_pb, format('select * from public.consultation_saved_lessons(%L)', v_pa)) = '42501');
  perform pg_temp.ck('6l the tied clinician marks them discussed',
    pg_temp.as_count(v_ct, format('select public.mark_saved_lessons_discussed(%L)', v_pa)) = 1);

  -- ================= 7. share link =================
  perform pg_temp.ck('7a anon opens a published reviewed article',
    pg_temp.as_count(null, $q$select count(*) from public.learn_shared_article('s55-search-htn')$q$) = 1);
  v_id := pg_temp.mkitem('s55-share-faq');
  update public.health_education_content set content_type = 'faq' where id = v_id; perform pg_temp.publish(v_id);
  perform pg_temp.ck('7b a faq does not open', pg_temp.as_count(null, $q$select count(*) from public.learn_shared_article('s55-share-faq')$q$) = 0);
  v_id := pg_temp.mkitem('s55-share-off');
  update public.health_education_content set share_enabled = false where id = v_id; perform pg_temp.publish(v_id);
  perform pg_temp.ck('7c an item with sharing off does not open', pg_temp.as_count(null, $q$select count(*) from public.learn_shared_article('s55-share-off')$q$) = 0);
  v_id := pg_temp.mkitem('s55-share-draft');
  perform pg_temp.ck('7d a draft does not open', pg_temp.as_count(null, $q$select count(*) from public.learn_shared_article('s55-share-draft')$q$) = 0);
  perform pg_temp.ck('7e a placeholder does not open', pg_temp.as_count(null, $q$select count(*) from public.learn_shared_article('myth-draft-01')$q$) = 0);
  perform pg_temp.ck('7f an unknown code does not open', pg_temp.as_count(null, $q$select count(*) from public.learn_shared_article('nope')$q$) = 0);
  perform pg_temp.ck('7g the shared columns carry no patient data',
    not exists (select 1 from pg_proc p, unnest(p.proargnames) a where p.proname = 'learn_shared_article' and (a like '%patient%' or a like '%user%' or a like '%organisation%')));
  -- a grandfathered item (published before the gate existed: no review date) is not opened for a signed-out reader
  v_id := pg_temp.mkitem('s55-share-legacy'); perform pg_temp.publish(v_id);
  perform pg_temp.ck('7g2 a reviewed, dated article opens before it loses its review details',
    pg_temp.as_count(null, $q$select count(*) from public.learn_shared_article('s55-share-legacy')$q$) = 1);
  update public.health_education_content set next_review_due = null where id = v_id;
  perform pg_temp.ck('7g3 an undated (grandfathered) item does not open for a signed-out reader',
    pg_temp.as_count(null, $q$select count(*) from public.learn_shared_article('s55-share-legacy')$q$) = 0);
  update public.health_education_content set next_review_due = current_date + 60, reviewed_by_name = null where id = v_id;
  perform pg_temp.ck('7g4 an item with no named reviewer does not open for a signed-out reader',
    pg_temp.as_count(null, $q$select count(*) from public.learn_shared_article('s55-share-legacy')$q$) = 0);
  perform pg_temp.ck('7g5 the apps are told it is shareable only when the link would open (same definition)',
    pg_temp.as_count(v_pa, $q$select count(*) from public.health_education_item_trust(array['s55-search-htn']) where is_shareable$q$) = 1
    and pg_temp.as_count(v_pa, $q$select count(*) from public.health_education_item_trust(array['s55-share-off']) where is_shareable$q$) = 0
    and pg_temp.as_count(v_pa, $q$select count(*) from public.health_education_item_trust(array['s55-share-legacy']) where is_shareable$q$) = 0);
  update public.health_education_content set next_review_due = current_date - 1 where code = 's55-search-htn';
  perform pg_temp.ck('7h once past its review date the link no longer opens',
    pg_temp.as_count(null, $q$select count(*) from public.learn_shared_article('s55-search-htn')$q$) = 0);
  update public.health_education_content set next_review_due = current_date + 60 where code = 's55-search-htn';

  -- ================= 8. offline pack =================
  update public.health_education_content set sort_order = 0 where code = 's55-search-htn';  -- the pack is capped by item count, ordered by sort_order
  perform pg_temp.ck('8a the pack lists a servable article',
    pg_temp.as_count(v_pa, $q$select count(*) from public.learning_offline_pack() where code = 's55-search-htn' and text_bytes > 0$q$) = 1);
  perform pg_temp.ck('8b the pack omits a placeholder and a draft',
    pg_temp.as_count(v_pa, $q$select count(*) from public.learning_offline_pack() where code in ('myth-draft-01', 's55-share-draft')$q$) = 0);
  perform pg_temp.ck('8c anon cannot fetch the pack', pg_temp.as_count(null, 'select count(*) from public.learning_offline_pack()') = -1);
  update public.health_education_content set content_status = 'updated' where code = 's55-search-belle';
  perform pg_temp.ck('8d pack status flags a removed item as not servable and keeps a good one',
    pg_temp.as_count(v_pa, $q$select count(*) from public.learning_pack_status(array['s55-search-belle','s55-search-htn','gone']) where not servable$q$) = 2
    and pg_temp.as_count(v_pa, $q$select count(*) from public.learning_pack_status(array['s55-search-belle','s55-search-htn','gone']) where servable$q$) = 1);

  -- OQ-F1-04: a review_due FLAG (a protocol bump) keeps the item servable on every S55 reader until its own date
  update public.health_education_content set content_status = 'review_due', next_review_due = current_date + 30, sort_order = 0 where code = 's55-search-belle';  -- sort_order 0: the pack is capped by item count
  perform pg_temp.ck('8e1 a flagged review_due item with a future date stays servable in pack status',
    pg_temp.as_count(v_pa, $q$select count(*) from public.learning_pack_status(array['s55-search-belle']) where servable$q$) = 1);
  perform pg_temp.ck('8e2 ...stays in the offline pack',
    pg_temp.as_count(v_pa, $q$select count(*) from public.learning_offline_pack() where code = 's55-search-belle'$q$) = 1);
  perform pg_temp.ck('8e3 ...and stays findable by search',
    pg_temp.as_count(v_pa, $q$select count(*) from public.search_health_education('belle') where code = 's55-search-belle'$q$) >= 1);
  update public.health_education_content set next_review_due = current_date - 1 where code = 's55-search-belle';
  perform pg_temp.ck('8f ...and is withdrawn the day its own date passes',
    pg_temp.as_count(v_pa, $q$select count(*) from public.learning_pack_status(array['s55-search-belle']) where servable$q$) = 0);
  update public.health_education_content set next_review_due = current_date + 30 where code = 's55-search-belle';

  -- ================= readiness report =================
  perform pg_temp.ck('9a the admin readiness report answers', pg_temp.as_count(v_admin, 'select count(*) from public.learning_readiness_report()') = 9);
  perform pg_temp.ck('9a2 the readiness report counts items flagged review_due that are still live (OQ-F1-04 admin notice source)',
    pg_temp.as_count(v_admin, $q$select coalesce(max(n), 0) from public.learning_readiness_report() where metric = 'review_flagged_still_live'$q$) >= 1);
  perform pg_temp.ck('9b a patient is refused the readiness report', pg_temp.as_try(v_pa, 'select * from public.learning_readiness_report()') = '42501');

  -- ================= SABOTAGE =================
  -- (i) the publish gate dropped: an incomplete item publishes
  drop trigger health_education_publish_gate on public.health_education_content;
  v_id := pg_temp.mkitem('s55-sab-gate');
  update public.health_education_content set reviewed_by_name = null, self_care_action = null where id = v_id;
  perform pg_temp.ck('S1 sabotage: with the gate dropped an unreviewed item publishes (the gate is what refuses it)', pg_temp.publish(v_id) = 'ok');
  -- (ii) the synonym config deactivated: bp no longer finds the hypertension item
  update public.learning_config set is_active = false where key = 'search_synonyms';
  perform pg_temp.ck('S2 sabotage: without the synonym table "bp" misses the item (the table is what finds it)',
    pg_temp.as_count(v_pa, $q$select count(*) from public.search_health_education('BP') where code = 's55-search-htn'$q$) = 0);
  -- (iii) the audience gate neutered: the 40-and-over item is then found by a 20 year old (the gate is what hides it)
  update public.profiles set date_of_birth = current_date - interval '20 years' where id = v_pa;
  create or replace function private.learning_age_ok(p_min integer, p_max integer) returns boolean language sql stable as $f$ select true $f$;
  perform pg_temp.ck('S3 sabotage: with the audience gate neutered a 20 year old finds the 40-and-over item',
    pg_temp.as_count(v_pa, $q$select count(*) from public.search_health_education('quokka midlife') where code = 's55-age'$q$) = 1);
  -- (iv) status-based expiry put back (the first F1 draft): the flagged-but-in-date item is then withdrawn, so 8e can fail
  create or replace function private.health_education_content_expired(p_status public.health_education_content_status, p_next_review_due date)
    returns boolean language sql stable set search_path = '' as $f$
      select p_status = 'review_due' or (p_next_review_due is not null and p_next_review_due <= (now() at time zone 'Africa/Lagos')::date) $f$;
  perform pg_temp.ck('S4 sabotage: with status-based expiry a flagged review_due item is withdrawn (the date-only rule is what keeps it served)',
    pg_temp.as_count(v_pa, $q$select count(*) from public.learning_pack_status(array['s55-search-belle']) where servable$q$) = 0);
  raise notice 'PASS: S55 learning centre, % checks', (select count(*) from results);
end $$;

select n, check_name, case when ok then 'PASS' else 'FAIL' end as verdict from results order by n;
rollback;
