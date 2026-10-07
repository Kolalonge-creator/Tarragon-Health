-- S33 proof: the BP care course gate, review rules and events (migrations *_s33_course_columns_review_gate_events.sql and
-- *_s33_bpc_course_seed.sql).
--
-- Proves in one rolled-back transaction:
--   1. Shape: 14 lessons seeded, all draft and hidden, no review record, the programme inactive, 14 modules; anon cannot execute
--      learning_course; a patient sees an empty course.
--   2. The gate: only a PUBLISHED lesson with a review date that has not passed is served (no date, a past date, a draft each
--      return nothing); the programme must be active; a reviewer credit comes back only from a complete review record.
--   3. English only: the Pidgin plumbing is gone (columns, trigger, translation join); language_served is always 'en'.
--   4. Edit rule: editing a course lesson's clinical text returns it to clinical_review, hidden, review cleared, logged; the same
--      edit to a non-course row changes nothing (control).
--   5. Sweep: a course lesson whose review date has passed is hidden and logged; a non-course row with a passed date is left alone.
--   6. Events: opening a lesson emits nothing; finishing the teach-back emits lesson.completed exactly once; finishing all 14 emits
--      course.completed exactly once; a non-course lesson emits neither; a test patient's events are marked is_test.
--   7. SABOTAGE: with the progress trigger dropped no event is emitted; with the edit trigger dropped an edited lesson stays
--      published. Both matching checks must flip.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create function pg_temp.rec(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('real', p_name, p_expected, p_actual) $$;
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
create function pg_temp.back() returns void language plpgsql as
$f$ begin
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.role', '', true);
end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text, p_lang text default 'en') returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's33-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test, language)
  values (v, p_org, p_role::public.user_role, 'S33 ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true, p_lang)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone, date_of_birth = excluded.date_of_birth, full_name = excluded.full_name, language = excluded.language;
  return v;
end $f$;
-- The number of lessons a patient is served for the course, and the code of the first one.
create function pg_temp.served() returns text language sql as
$$ select count(*)::text from public.learning_course('bp_care_course') $$;
create function pg_temp.served_codes() returns text language sql as
$$ select coalesce(string_agg(content_code, ',' order by module_number), '') from public.learning_course('bp_care_course') $$;
create function pg_temp.lagos_today() returns date language sql as
$$ select (now() at time zone 'Africa/Lagos')::date $$;
create function pg_temp.events(p_type text, p_patient uuid) returns text language sql as
$$ select count(*)::text from public.domain_events where event_type = p_type and patient_id = p_patient $$;

do $$
declare
  v_org uuid; v_pat uuid; v_pat2 uuid; v_admin uuid; v_prog uuid;
  v_l1 uuid; v_l2 uuid; v_l3 uuid; v_l4 uuid; v_other uuid; v_other_due uuid; v_other2 uuid;
  v_today date := pg_temp.lagos_today();
  v_n integer; v_row record; v_hist integer; v_ids uuid[];
begin
  select organisation_id into v_org from public.profiles where organisation_id is not null group by organisation_id order by count(*) desc limit 1;
  if v_org is null then raise exception 'need an organisation to run this proof'; end if;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  v_pat := pg_temp.mkuser(v_org, 'patient', 'patient');
  v_pat2 := pg_temp.mkuser(v_org, 'patient-two', 'patient');
  select id into v_prog from public.health_education_programmes where code = 'bp_care_course';

  -- 1. Shape ----------------------------------------------------------------------------------------------------
  perform pg_temp.rec('the course programme exists', 'true', (v_prog is not null)::text);
  perform pg_temp.rec('the programme starts inactive', 'false', (select is_active::text from public.health_education_programmes where id = v_prog));
  perform pg_temp.rec('fourteen modules', '14', (select count(*)::text from public.health_education_programme_modules where programme_id = v_prog));
  perform pg_temp.rec('fourteen lessons seeded', '14', (select count(*)::text from public.health_education_content where topic_group_code = 'bp_care_course'));
  perform pg_temp.rec('every seeded lesson is a draft, hidden, with no review record', '0',
    (select count(*)::text from public.health_education_content
      where topic_group_code = 'bp_care_course'
        and (content_status <> 'draft' or is_active or clinician_reviewed or reviewed_by_name is not null or reviewed_at is not null or next_review_due is not null)));
  perform pg_temp.rec('every lesson has an audio clip id, one action and a teach-back question', '14',
    (select count(*)::text from public.health_education_content
      where topic_group_code = 'bp_care_course' and audio_clip_id ~ '^BPC-[0-9]{2}$' and next_action is not null and jsonb_array_length(knowledge_check) = 1));
  perform pg_temp.rec('no translation row is seeded (English only)', '0',
    (select count(*)::text from public.health_education_translations t join public.health_education_content c on c.id = t.content_id where c.topic_group_code = 'bp_care_course'));
  perform pg_temp.rec('anon cannot execute learning_course', 'false', has_function_privilege('anon', 'public.learning_course(text)', 'EXECUTE')::text);
  perform pg_temp.rec('anon is refused when it calls it', '42501', (select pg_temp.try('select * from public.learning_course(''bp_care_course'')') from (select pg_temp.act_anon()) x));
  perform pg_temp.back();
  perform pg_temp.act(v_pat);
  perform pg_temp.rec('a patient is served nothing while every lesson is a draft', '0', pg_temp.served());
  perform pg_temp.back();

  -- 2. The gate -------------------------------------------------------------------------------------------------
  select id into v_l1 from public.health_education_content where code = 'bpc_01_what_blood_pressure_is';
  select id into v_l2 from public.health_education_content where code = 'bpc_02_measure_correctly_at_home';
  select id into v_l3 from public.health_education_content where code = 'bpc_03_understanding_numbers_and_target';
  select id into v_l4 from public.health_education_content where code = 'bpc_04_feeling_fine_with_high_pressure';
  update public.health_education_content set content_status = 'published', next_review_due = v_today + 30 where id = v_l1;     -- served
  update public.health_education_content set content_status = 'published', next_review_due = null where id = v_l2;              -- no review date
  update public.health_education_content set content_status = 'published', next_review_due = v_today - 1 where id = v_l3;       -- date passed
  -- v_l4 stays draft
  -- The programme row stays inactive for good: learning_course checks every lesson, the older programme functions only check the row.
  perform pg_temp.act(v_pat);
  perform pg_temp.rec('the older programme list never shows the course (its programme stays inactive)', '0',
    (select count(*)::text from public.health_education_programmes_list() where code = 'bp_care_course'));
  perform pg_temp.rec('the older programme detail returns nothing for it', '0', (select count(*)::text from public.health_education_programme_detail('bp_care_course')));
  perform pg_temp.back();
  perform pg_temp.act(v_pat);
  perform pg_temp.rec('only the published, in-date lesson is served', 'bpc_01_what_blood_pressure_is', pg_temp.served_codes());
  perform pg_temp.rec('a lesson with no review date is not served', 'false', (pg_temp.served_codes() like '%bpc_02%')::text);
  perform pg_temp.rec('a lesson whose review date has passed is not served', 'false', (pg_temp.served_codes() like '%bpc_03%')::text);
  perform pg_temp.rec('a draft is not served', 'false', (pg_temp.served_codes() like '%bpc_04%')::text);
  perform pg_temp.rec('no reviewer credit without a review record', 'null', (select coalesce(reviewed_by_name, 'null') from public.learning_course('bp_care_course') where module_number = 1));
  perform pg_temp.back();
  update public.health_education_content set reviewed_by_name = 'Dr Test Reviewer', reviewed_at = now(), clinician_reviewed = false where id = v_l1;
  perform pg_temp.act(v_pat);
  perform pg_temp.rec('a name without clinician_reviewed shows no credit', 'null', (select coalesce(reviewed_by_name, 'null') from public.learning_course('bp_care_course') where module_number = 1));
  perform pg_temp.back();
  update public.health_education_content set clinician_reviewed = true where id = v_l1;
  perform pg_temp.act(v_pat);
  perform pg_temp.rec('a complete review record shows the credit', 'Dr Test Reviewer', (select coalesce(reviewed_by_name, 'null') from public.learning_course('bp_care_course') where module_number = 1));
  perform pg_temp.back();
  update public.health_education_content set next_review_due = v_today where id = v_l1;
  perform pg_temp.act(v_pat);
  perform pg_temp.rec('a lesson whose review date is today is not served', '0', pg_temp.served());
  perform pg_temp.back();
  update public.health_education_content set next_review_due = v_today + 30 where id = v_l1;

  -- 3. English only ---------------------------------------------------------------------------------------------
  perform pg_temp.rec('the Pidgin columns are gone from translations', '0',
    (select count(*)::text from information_schema.columns where table_schema = 'public' and table_name = 'health_education_translations' and column_name in ('knowledge_check', 'next_action', 'review_state')));
  perform pg_temp.rec('the translation requeue trigger is gone', '0',
    (select count(*)::text from pg_trigger where tgname = 'health_education_translations_requeue_on_edit' and not tgisinternal));
  perform pg_temp.act(v_pat);
  perform pg_temp.rec('every lesson is served in English', 'en', (select language_served from public.learning_course('bp_care_course') where module_number = 1));
  perform pg_temp.rec('...with the English title', 'What blood pressure is, and why it matters', (select title from public.learning_course('bp_care_course') where module_number = 1));
  perform pg_temp.back();

  -- 4. Edit rule ------------------------------------------------------------------------------------------------
  select count(*) into v_hist from public.health_education_content_status_history where content_id = v_l1;
  update public.health_education_content set body = body || E'\n\nAn added sentence.' where id = v_l1;
  select * into v_row from public.health_education_content where id = v_l1;
  perform pg_temp.rec('editing a lesson sends it back to clinical review', 'clinical_review', v_row.content_status::text);
  perform pg_temp.rec('...hidden', 'false', v_row.is_active::text);
  perform pg_temp.rec('...with the review cleared', 'false', v_row.clinician_reviewed::text);
  perform pg_temp.rec('...and logged', '1', ((select count(*) from public.health_education_content_status_history where content_id = v_l1) - v_hist)::text);
  perform pg_temp.act(v_pat);
  perform pg_temp.rec('...so it is no longer served', '0', pg_temp.served());
  perform pg_temp.back();
  -- control: the same edit to a published row that is not in any course changes nothing
  select c.id into v_other from public.health_education_content c
    where c.content_status = 'published' and not exists (select 1 from public.health_education_programme_modules m where m.content_id = c.id) order by c.code limit 1;
  if v_other is null then
    insert into public.health_education_content (code, title, body, category, content_status) values ('s33_control_published', 'control', 'control body', 'getting_started', 'published') returning id into v_other;
  end if;
  update public.health_education_content set body = body || ' control edit' where id = v_other;
  perform pg_temp.rec('control: editing a non-course row leaves it published', 'published', (select content_status::text from public.health_education_content where id = v_other));

  -- 5. Sweep ----------------------------------------------------------------------------------------------------
  update public.health_education_content set content_status = 'published', clinician_reviewed = true, next_review_due = v_today where id = v_l2;
  insert into public.health_education_content (code, title, body, category, content_status, next_review_due, clinician_reviewed)
    values ('s33_control_due', 'control due', 'control body', 'getting_started', 'published', v_today - 5, true) returning id into v_other_due;
  select count(*) into v_hist from public.health_education_content_status_history where content_id = v_l2;
  v_n := private.learning_hide_overdue_course_lessons();
  perform pg_temp.rec('the sweep hides a course lesson whose review date has come', 'clinical_review', (select content_status::text from public.health_education_content where id = v_l2));
  perform pg_temp.rec('...clears its review', 'false', (select clinician_reviewed::text from public.health_education_content where id = v_l2));
  perform pg_temp.rec('...and logs it', '1', ((select count(*) from public.health_education_content_status_history where content_id = v_l2) - v_hist)::text);
  perform pg_temp.rec('control: the sweep leaves a non-course row with a passed date alone', 'published', (select content_status::text from public.health_education_content where id = v_other_due));
  perform pg_temp.rec('the sweep reports at least the one it moved', 'true', (v_n >= 1)::text);
  perform pg_temp.rec('the sweep cannot be called by a signed-in user', 'false', has_function_privilege('authenticated', 'private.learning_hide_overdue_course_lessons()', 'EXECUTE')::text);

  -- 6. Events ---------------------------------------------------------------------------------------------------
  perform pg_temp.act(v_pat);
  insert into public.health_education_progress (organisation_id, patient_id, content_id, status) values (v_org, v_pat, v_l1, 'seen');
  perform pg_temp.back();
  perform pg_temp.rec('opening a lesson emits nothing', '0', pg_temp.events('lesson.completed', v_pat));
  perform pg_temp.act(v_pat);
  update public.health_education_progress set status = 'understood', check_score = 1, check_total = 1 where patient_id = v_pat and content_id = v_l1;
  perform pg_temp.back();
  perform pg_temp.rec('finishing the teach-back emits lesson.completed', '1', pg_temp.events('lesson.completed', v_pat));
  perform pg_temp.rec('...marked as a test event for a test account (INV-13)', 'true',
    (select bool_and(is_test)::text from public.domain_events where event_type = 'lesson.completed' and patient_id = v_pat));
  perform pg_temp.rec('...carrying codes only', 'bp_care_course/BPC-01',
    (select (payload->>'course_code') || '/' || (payload->>'lesson_code') from public.domain_events where event_type = 'lesson.completed' and patient_id = v_pat limit 1));
  perform pg_temp.act(v_pat);
  update public.health_education_progress set status = 'needs_review' where patient_id = v_pat and content_id = v_l1;
  update public.health_education_progress set status = 'understood' where patient_id = v_pat and content_id = v_l1;
  perform pg_temp.back();
  perform pg_temp.rec('repeating or re-checking emits no second event', '1', pg_temp.events('lesson.completed', v_pat));
  perform pg_temp.rec('no course.completed after one lesson', '0', pg_temp.events('course.completed', v_pat));
  -- a non-course lesson emits nothing
  perform pg_temp.act(v_pat);
  insert into public.health_education_progress (organisation_id, patient_id, content_id, status) values (v_org, v_pat, v_other, 'understood');
  perform pg_temp.back();
  perform pg_temp.rec('a lesson outside any course emits no lesson event', '1', pg_temp.events('lesson.completed', v_pat));
  -- finish the other thirteen (the lesson ids are read as the owner: a patient cannot read the modules of an inactive programme)
  select array_agg(m.content_id) into v_ids from public.health_education_programme_modules m where m.programme_id = v_prog and m.content_id <> v_l1;
  perform pg_temp.act(v_pat);
  insert into public.health_education_progress (organisation_id, patient_id, content_id, status)
    select v_org, v_pat, unnest(v_ids), 'needs_review';
  perform pg_temp.back();
  perform pg_temp.rec('fourteen lesson events after fourteen lessons', '14', pg_temp.events('lesson.completed', v_pat));
  perform pg_temp.rec('finishing every lesson emits course.completed once', '1', pg_temp.events('course.completed', v_pat));
  perform pg_temp.rec('...with the lesson count', '14', (select payload->>'lesson_count' from public.domain_events where event_type = 'course.completed' and patient_id = v_pat limit 1));
  select count(*) into v_n from public.domain_events where patient_id = v_pat and event_type in ('lesson.completed', 'course.completed') and payload::text ~* '(mmhg|reading|pressure|hypertension)';
  perform pg_temp.rec('INV-07: no event payload names a reading or a condition', '0', v_n::text);

  -- 7. SABOTAGE -------------------------------------------------------------------------------------------------
  -- (a) the progress trigger dropped: finishing a lesson emits nothing, so the matching check flips
  drop trigger health_education_progress_events on public.health_education_progress;
  perform pg_temp.act(v_pat2);
  insert into public.health_education_progress (organisation_id, patient_id, content_id, status) values (v_org, v_pat2, v_l4, 'understood');
  perform pg_temp.back();
  insert into results values ('sabotaged', 'finishing the teach-back emits lesson.completed', '1', pg_temp.events('lesson.completed', v_pat2));
  -- (b) the edit trigger dropped: an edited lesson stays published, so the matching check flips
  drop trigger health_education_content_requeue_on_edit on public.health_education_content;
  update public.health_education_content set content_status = 'published', clinician_reviewed = true, next_review_due = v_today + 30 where id = v_l4;
  update public.health_education_content set body = body || ' sabotage edit' where id = v_l4;
  insert into results values ('sabotaged', 'editing a lesson sends it back to clinical review', 'clinical_review', (select content_status::text from public.health_education_content where id = v_l4));
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S33 proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ')
         from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected is distinct from actual;
  if v_caught < 2 then
    raise exception 'VACUOUS TEST: only % of 2 sabotage steps changed the matching check', v_caught;
  end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;
-- Sabotaged rows are asserted to differ inside the DO block above and are deliberately not printed.

rollback;
