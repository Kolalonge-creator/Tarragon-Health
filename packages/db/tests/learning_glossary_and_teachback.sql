-- Learning quality gates 12b and 12c proof (migration *_learning_quality_gates.sql): the reviewed glossary and the private teach-back quiz.
--
--   G. GLOSSARY: the eight seeded terms are drafts and are shown to nobody; a patient and anon cannot write or publish; only the active CMO publishes,
--      and the reviewer name comes from the signed-in account; a term needs an owner, a source, a future review date and a definition within the
--      reading-grade limit; a published term cannot be edited in place and new wording sends it back to draft and hides it; a passed review date
--      hides it; a patient cannot read the table; anon cannot call the reader.
--   T. TEACH-BACK: the questions are validated against the configured limits (1 to 3 questions, 2 to 4 options, a real right answer, an explanation);
--      they cannot be edited on a live lesson; marking happens in the database and a wrong answer returns the right option with the explanation; the
--      result is the person's own (another patient and anon read nothing), is never written directly, never touches lesson progress, and a retake
--      replaces it and makes it private again; sharing goes through "save for the care team"; a tied clinician sees only a shared result that is still
--      saved, an untied clinician sees nothing (and the denial is audited), the tied read is audited; stopping the share, or deleting the saved lesson,
--      hides it again.
--   SABOTAGE: with the glossary gate dropped an unreviewed term can be published; with the shared-only predicate removed from the clinician read,
--   an unshared result is visible (so each check above can fail).
begin;

create temp table results(n serial, check_name text, ok boolean) on commit drop;
grant all on results to public;
grant all on results_n_seq to public;

create function pg_temp.ck(p_name text, p_ok boolean) returns void language plpgsql as
$f$ begin
  insert into results(check_name, ok) values (p_name, coalesce(p_ok, false));
  if not coalesce(p_ok, false) then raise exception 'FAIL: %', p_name; end if;
end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'gt-' || p_label || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, is_test)
  values (v, p_org, p_role::public.user_role, 'GT ' || p_label, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true;
  return v;
end $f$;
create function pg_temp.as_try(p_uid uuid, p_sql text) returns text language plpgsql as $f$
declare r text := 'ok';
begin
  if p_uid is null then
    perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
    set local role anon;
  else
    perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
    set local role authenticated;
  end if;
  begin execute p_sql; exception when others then r := sqlstate; end;
  reset role; perform set_config('request.jwt.claims', '', true);
  return r;
end $f$;
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
-- scalar text as a user; 'ERR' on error (a null result stays null)
create function pg_temp.as_text(p_uid uuid, p_sql text) returns text language plpgsql as $f$
declare t text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin execute p_sql into t; exception when others then t := 'ERR'; end;
  reset role; perform set_config('request.jwt.claims', '', true);
  return t;
end $f$;
create function pg_temp.owner_try(p_sql text) returns text language plpgsql as $f$
declare r text := 'ok';
begin
  begin execute p_sql; exception when others then r := sqlstate; end;
  return r;
end $f$;
create function pg_temp.mkitem(p_code text, p_status text, p_teachback jsonb default null) returns uuid language plpgsql as $f$
declare v uuid;
begin
  insert into public.health_education_content
    (code, title, summary, body, category, content_status, clinician_reviewed, reviewed_by_name, reviewed_at, source_reference, self_care_action, next_review_due, teachback)
  values (p_code, 'Title ' || p_code, 'Teaser', 'Eat less salt. Check your pressure.', 'getting_started', 'draft', true, 'Dr Reviewer', now(), 'Proof source', 'Do one small thing today', current_date + 90, p_teachback)
  returning id into v;
  if p_status = 'published' then update public.health_education_content set content_status = 'published' where id = v; end if;
  return v;
end $f$;

do $$
declare
  v_org uuid; v_admin uuid; v_cmo uuid; v_pa uuid; v_pb uuid; v_ct uuid; v_cu uuid;
  v_hyp uuid; v_sys uuid; v_dia uuid; v_live uuid; v_draft uuid;
  v_good constant jsonb := '[{"question":"Which number is on top?","options":["Systolic","Diastolic"],"answer_index":0,"explanation":"The top number is the systolic one."},
                              {"question":"Is one good reading enough?","options":["Yes","No"],"answer_index":1,"explanation":"One reading is one small picture. Keep checking."}]';
  v_t text; v_t2 text; v_n integer;
begin
  select id into v_org from public.organisations limit 1;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  v_cmo := pg_temp.mkuser(v_org, 'cmo', 'clinician');
  v_pa := pg_temp.mkuser(v_org, 'pa', 'patient');
  v_pb := pg_temp.mkuser(v_org, 'pb', 'patient');
  v_ct := pg_temp.mkuser(v_org, 'tied', 'clinician');
  v_cu := pg_temp.mkuser(v_org, 'untied', 'clinician');
  insert into public.clinical_staff (profile_id, organisation_id, full_name, doctor_tier, active, credential_type, credential_number, indemnity_exempt, indemnity_exempt_by, verified_by, license_verified_at)
  values (v_cmo, v_org, 'GT CMO', 'chief_medical_officer', true, 'MDCN', 'GT-CMO-1', true, v_admin, v_admin, now());
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id) values (v_org, v_pa, v_ct);

  -- ================= G. glossary =================
  perform pg_temp.ck('G1 eight draft terms are seeded and every one is a draft', (select count(*) = 8 and bool_and(status = 'draft') from public.learning_glossary_terms where reviewed_by is null and next_review_due is null));
  perform pg_temp.ck('G2 a patient is shown no term while all are drafts', pg_temp.as_count(v_pa, 'select count(*) from public.learning_glossary()') = 0);
  perform pg_temp.ck('G3 anon cannot call the reader', pg_temp.as_try(null, 'select * from public.learning_glossary()') = '42501');
  perform pg_temp.ck('G4 a patient cannot read the table (drafts are staff only)', pg_temp.as_count(v_pa, 'select count(*) from public.learning_glossary_terms') = 0);
  perform pg_temp.ck('G5 a patient cannot write the table or call the writers',
    pg_temp.as_try(v_pa, $q$insert into public.learning_glossary_terms (term, definition) values ('x term', 'A long enough definition')$q$) <> 'ok'
    and pg_temp.as_try(v_pa, $q$select public.save_glossary_draft('hypertension', 'High blood pressure that stays high.', '{}', 'Dr Owner', 'WHO')$q$) = '42501'
    and pg_temp.as_try(null, $q$select public.save_glossary_draft('hypertension', 'High blood pressure that stays high.', '{}', 'Dr Owner', 'WHO')$q$) = '42501');

  select id into v_hyp from public.learning_glossary_terms where lower(term) = 'hypertension';
  select id into v_sys from public.learning_glossary_terms where lower(term) = 'systolic';
  select id into v_dia from public.learning_glossary_terms where lower(term) = 'diastolic';

  perform pg_temp.ck('G6 an admin saves wording with an owner and a source',
    pg_temp.as_try(v_admin, $q$select public.save_glossary_draft('hypertension', 'Blood pressure that stays too high for too long. You often cannot feel it.', array['high blood pressure'], 'Dr Owner', 'WHO hypertension fact sheet')$q$) = 'ok');
  perform pg_temp.ck('G7 an admin cannot publish', pg_temp.as_try(v_admin, format('select public.publish_glossary_term(%L, current_date + 180)', v_hyp)) = '42501');
  perform pg_temp.ck('G8 a patient and anon cannot publish',
    pg_temp.as_try(v_pa, format('select public.publish_glossary_term(%L, current_date + 180)', v_hyp)) = '42501'
    and pg_temp.as_try(null, format('select public.publish_glossary_term(%L, current_date + 180)', v_hyp)) = '42501');
  perform pg_temp.ck('G9 a term with no owner or source cannot be published even by the CMO (systolic is still a bare draft)',
    pg_temp.as_try(v_cmo, format('select public.publish_glossary_term(%L, current_date + 180)', v_sys)) = '23514');
  perform pg_temp.ck('G10 a past review date is refused',
    pg_temp.as_try(v_cmo, format('select public.publish_glossary_term(%L, current_date - 1)', v_hyp)) = '23514');

  perform pg_temp.as_try(v_admin, $q$select public.save_glossary_draft('diastolic', 'Antihypertensive pharmacotherapy necessitates comprehensive longitudinal monitoring.', '{}', 'Dr Owner', 'WHO')$q$);
  perform pg_temp.ck('G11 a definition above the reading-grade limit is refused', pg_temp.as_try(v_cmo, format('select public.publish_glossary_term(%L, current_date + 180)', v_dia)) = '23514');

  perform pg_temp.ck('G12 the CMO publishes a complete term', pg_temp.as_try(v_cmo, format('select public.publish_glossary_term(%L, current_date + 180)', v_hyp)) = 'ok');
  perform pg_temp.ck('G13 the reviewer name comes from the signed-in account',
    (select reviewed_by = v_cmo and reviewed_by_name = 'GT cmo' and reviewed_at is not null from public.learning_glossary_terms where id = v_hyp));
  perform pg_temp.ck('G14 a patient is now shown exactly that one term, with its alias',
    pg_temp.as_count(v_pa, 'select count(*) from public.learning_glossary()') = 1
    and pg_temp.as_text(v_pa, $q$select array_to_string(aliases, ',') from public.learning_glossary() where term = 'hypertension'$q$) = 'high blood pressure');
  perform pg_temp.ck('G15 the other seven stay hidden', pg_temp.as_count(v_pb, $q$select count(*) from public.learning_glossary() where term <> 'hypertension'$q$) = 0);
  perform pg_temp.ck('G16 a published term cannot be edited in place',
    pg_temp.owner_try(format($s$update public.learning_glossary_terms set definition = 'A different definition altogether' where id = %L$s$, v_hyp)) = '23514');
  perform pg_temp.owner_try(format('update public.learning_glossary_terms set next_review_due = current_date - 1 where id = %L', v_hyp));
  perform pg_temp.ck('G17 a passed review date hides it', pg_temp.as_count(v_pa, 'select count(*) from public.learning_glossary()') = 0);
  v_t := pg_temp.as_try(v_cmo, format('select public.publish_glossary_term(%L, current_date + 90)', v_hyp));
  perform pg_temp.ck('G18 the CMO can publish it again with a new date', v_t = 'ok' and pg_temp.as_count(v_pa, 'select count(*) from public.learning_glossary()') = 1);
  perform pg_temp.as_try(v_admin, $q$select public.save_glossary_draft('hypertension', 'Blood pressure that is too high, too often.', array['high blood pressure'], null, null)$q$);
  perform pg_temp.ck('G19 new wording sends a published term back to draft, clears its review and hides it',
    (select status = 'draft' and reviewed_by is null and reviewed_by_name is null and next_review_due is null from public.learning_glossary_terms where id = v_hyp)
    and pg_temp.as_count(v_pa, 'select count(*) from public.learning_glossary()') = 0);
  perform pg_temp.ck('G20 an admin can retire only what is published (a draft is untouched)', pg_temp.as_try(v_admin, format('select public.retire_glossary_term(%L)', v_hyp)) = 'ok'
    and (select status = 'draft' from public.learning_glossary_terms where id = v_hyp));

  -- ================= T. teach-back =================
  v_draft := pg_temp.mkitem('tb-draft', 'draft');
  perform pg_temp.ck('T1 a patient cannot set questions', pg_temp.as_try(v_pa, format('select public.set_lesson_teachback(%L, %L::jsonb)', v_draft, v_good::text)) = '42501');
  perform pg_temp.ck('T2 no questions is refused', pg_temp.as_try(v_admin, format('select public.set_lesson_teachback(%L, ''[]''::jsonb)', v_draft)) = '23514');
  perform pg_temp.ck('T3 four questions is refused',
    pg_temp.as_try(v_admin, format('select public.set_lesson_teachback(%L, %L::jsonb)', v_draft, (select jsonb_agg(q) from (select v_good -> 0 as q from generate_series(1, 4)) s)::text)) = '23514');
  perform pg_temp.ck('T4 one option is refused',
    pg_temp.as_try(v_admin, format($s$select public.set_lesson_teachback(%L, '[{"question":"q","options":["only"],"answer_index":0,"explanation":"e"}]'::jsonb)$s$, v_draft)) = '23514');
  perform pg_temp.ck('T5 a right answer outside the options is refused',
    pg_temp.as_try(v_admin, format($s$select public.set_lesson_teachback(%L, '[{"question":"q","options":["a","b"],"answer_index":2,"explanation":"e"}]'::jsonb)$s$, v_draft)) = '23514');
  perform pg_temp.ck('T6 a missing explanation is refused',
    pg_temp.as_try(v_admin, format($s$select public.set_lesson_teachback(%L, '[{"question":"q","options":["a","b"],"answer_index":0}]'::jsonb)$s$, v_draft)) = '23514');
  perform pg_temp.ck('T7 two good questions are accepted', pg_temp.as_try(v_admin, format('select public.set_lesson_teachback(%L, %L::jsonb)', v_draft, v_good::text)) = 'ok');
  perform pg_temp.ck('T8 a draft lesson cannot be quizzed by a patient', pg_temp.as_text(v_pa, $q$select public.record_teachback_result('tb-draft', array[0, 1])::text$q$) is null);

  v_live := pg_temp.mkitem('tb-live', 'published', v_good);
  v_t := pg_temp.as_text(v_pa, $q$select public.lesson_teachback('tb-live')::text$q$);
  perform pg_temp.ck('T8a before answering, the person gets the questions and options but no answer key and no explanation',
    v_t <> 'ERR' and v_t like '%Which number is on top?%' and v_t not like '%answer_index%' and v_t not like '%explanation%' and (v_t::jsonb -> 1 -> 'options') is not null);
  perform pg_temp.ck('T8b a draft lesson yields no questions and anon is refused',
    pg_temp.as_text(v_pa, $q$select public.lesson_teachback('tb-draft')::text$q$) is null and pg_temp.as_try(null, $q$select public.lesson_teachback('tb-live')$q$) = '42501');
  perform pg_temp.ck('T9 the questions of a live lesson cannot be edited',
    pg_temp.owner_try(format($s$update public.health_education_content set teachback = '[{"question":"q","options":["a","b"],"answer_index":0,"explanation":"e"}]'::jsonb where id = %L$s$, v_live)) = '23514');

  v_t := pg_temp.as_text(v_pa, $q$select public.record_teachback_result('tb-live', array[1, 1])::text$q$);
  perform pg_temp.ck('T10 a wrong answer returns the right option and the kind explanation; a right one is marked right',
    v_t not in ('ERR') and (v_t::jsonb -> 'marks' -> 0 ->> 'correct') = 'false' and (v_t::jsonb -> 'marks' -> 0 ->> 'correct_index') = '0'
    and (v_t::jsonb -> 'marks' -> 0 ->> 'explanation') = 'The top number is the systolic one.'
    and (v_t::jsonb -> 'marks' -> 1 ->> 'correct') = 'true' and (v_t::jsonb ->> 'correct') = '1' and (v_t::jsonb ->> 'total') = '2');
  perform pg_temp.ck('T11 the result is the person''s own: counts only',
    (select total = 2 and correct_count = 1 and per_question = array[false, true] and not shared_with_care_team and is_test from public.learning_teachback_results where patient_id = v_pa));
  perform pg_temp.ck('T12 another patient reads nothing, anon is refused',
    pg_temp.as_count(v_pb, 'select count(*) from public.learning_teachback_results') = 0
    and pg_temp.as_count(null, 'select count(*) from public.learning_teachback_results') = -1);
  perform pg_temp.ck('T13 a patient cannot write or change a result directly',
    pg_temp.as_try(v_pa, format($s$insert into public.learning_teachback_results (organisation_id, patient_id, content_id, total, correct_count, per_question) values (%L, %L, %L, 1, 1, array[true])$s$, v_org, v_pb, v_live)) <> 'ok'
    and pg_temp.as_count(v_pa, 'update public.learning_teachback_results set correct_count = 2 returning 1') <= 0);
  perform pg_temp.ck('T14 the quiz never touches lesson progress or completion (no progress row exists)',
    (select count(*) = 0 from public.health_education_progress where patient_id = v_pa));
  v_t := pg_temp.as_text(v_pa, $q$select public.record_teachback_result('tb-live', array[0, 1])::text$q$);
  perform pg_temp.ck('T15 a retake replaces the result (one row) and the score follows',
    v_t <> 'ERR' and (v_t::jsonb ->> 'correct') = '2'
    and (select count(*) = 1 and bool_and(correct_count = 2) from public.learning_teachback_results where patient_id = v_pa));
  v_t := pg_temp.as_text(v_pa, $q$select public.record_teachback_result('tb-live', array[0])::text$q$);
  perform pg_temp.ck('T16 a missing or short answer list is simply not right yet, never an error', v_t <> 'ERR' and (v_t::jsonb ->> 'correct') = '1');

  -- sharing
  perform pg_temp.ck('T17 before sharing, a tied clinician sees nothing', pg_temp.as_count(v_ct, format('select count(*) from public.consultation_shared_teachbacks(%L)', v_pa)) = 0);
  v_t := pg_temp.as_text(v_pa, $q$select public.share_teachback_with_care_team('tb-live', true)::text$q$);
  perform pg_temp.ck('T18 the person shares: the lesson is saved for the care team in the same step',
    v_t = 'true'
    and exists (select 1 from public.learning_saved_for_consultation s join public.health_education_content c on c.id = s.content_id where s.patient_id = v_pa and c.code = 'tb-live')
    and (select shared_with_care_team and shared_at is not null from public.learning_teachback_results where patient_id = v_pa));
  v_n := pg_temp.as_count(v_cu, format('select count(*) from public.consultation_shared_teachbacks(%L)', v_pa));
  perform pg_temp.ck('T19 an untied clinician sees nothing and the denial is audited',
    v_n = 0 and exists (select 1 from public.audit_log where actor_id = v_cu and subject_patient_id = v_pa));
  v_n := pg_temp.as_count(v_ct, format('select count(*) from public.consultation_shared_teachbacks(%L) where code = ''tb-live'' and correct_count = 1 and total = 2', v_pa));
  perform pg_temp.ck('T20 a tied clinician sees the shared result (counts only) and the read is audited',
    v_n = 1 and exists (select 1 from public.audit_log where actor_id = v_ct and action = 'learning_teachback.read' and subject_patient_id = v_pa and result = 'success'));
  perform pg_temp.ck('T21 a patient, another patient and anon get nothing from the clinician read',
    pg_temp.as_count(v_pa, format('select count(*) from public.consultation_shared_teachbacks(%L)', v_pa)) <= 0
    and pg_temp.as_count(v_pb, format('select count(*) from public.consultation_shared_teachbacks(%L)', v_pa)) <= 0
    and pg_temp.as_count(null, format('select count(*) from public.consultation_shared_teachbacks(%L)', v_pa)) = -1);
  v_t := pg_temp.as_text(v_pa, $q$select public.share_teachback_with_care_team('tb-live', false)::text$q$);
  perform pg_temp.ck('T22 stopping the share hides it again',
    v_t = 'true' and pg_temp.as_count(v_ct, format('select count(*) from public.consultation_shared_teachbacks(%L)', v_pa)) = 0);
  v_t := pg_temp.as_text(v_pa, $q$select public.share_teachback_with_care_team('tb-live', true)::text$q$);
  v_t2 := pg_temp.as_text(v_pa, $q$select public.record_teachback_result('tb-live', array[0, 1])::text$q$);
  perform pg_temp.ck('T23 a retake after sharing starts private again',
    v_t = 'true' and v_t2 <> 'ERR'
    and (select not shared_with_care_team from public.learning_teachback_results where patient_id = v_pa)
    and pg_temp.as_count(v_ct, format('select count(*) from public.consultation_shared_teachbacks(%L)', v_pa)) = 0);
  v_t := pg_temp.as_text(v_pa, $q$select public.share_teachback_with_care_team('tb-live', true)::text$q$);
  delete from public.learning_saved_for_consultation where patient_id = v_pa;
  perform pg_temp.ck('T24 deleting the saved lesson also hides a shared result',
    v_t = 'true' and pg_temp.as_count(v_ct, format('select count(*) from public.consultation_shared_teachbacks(%L)', v_pa)) = 0);
  perform pg_temp.ck('T25 sharing a result that does not exist does nothing', pg_temp.as_text(v_pb, $q$select public.share_teachback_with_care_team('tb-live', true)::text$q$) = 'false');

  -- ================= SABOTAGE =================
  -- (i) glossary gate dropped: an unreviewed term can be published
  drop trigger learning_glossary_gate on public.learning_glossary_terms;
  perform pg_temp.ck('S1 sabotage: with the glossary gate dropped a bare draft is published', pg_temp.owner_try(format($s$update public.learning_glossary_terms set status = 'published' where id = %L$s$, v_sys)) = 'ok'
    and pg_temp.as_count(v_pa, $q$select count(*) from public.learning_glossary() where term = 'systolic'$q$) = 0);
  -- (the reader still hides it, because it also demands a reviewer and a review date: two independent locks)
  -- (ii) the shared-only predicate removed from the clinician read: an unshared result becomes visible
  update public.learning_teachback_results set shared_with_care_team = false, shared_at = null where patient_id = v_pa;
  create or replace function public.consultation_shared_teachbacks(p_patient uuid)
  returns table (code text, title text, total integer, correct_count integer, per_question boolean[], taken_at timestamptz)
  language sql security definer set search_path = '' as $f$
    select c.code, c.title, r.total, r.correct_count, r.per_question, r.taken_at
      from public.learning_teachback_results r join public.health_education_content c on c.id = r.content_id
     where r.patient_id = p_patient and private.clinician_has_patient_access(p_patient)
  $f$;
  perform pg_temp.ck('S2 sabotage: without the shared-only predicate a tied clinician sees an unshared result',
    pg_temp.as_count(v_ct, format('select count(*) from public.consultation_shared_teachbacks(%L)', v_pa)) = 1);

  raise notice 'PASS: glossary and teach-back, % checks', (select count(*) from results);
end $$;

select n, check_name, case when ok then 'PASS' else 'FAIL' end as verdict from results order by n;
rollback;
