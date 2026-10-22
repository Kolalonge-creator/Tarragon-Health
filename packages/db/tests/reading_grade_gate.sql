-- Learning quality gate 12a proof (migration *_learning_quality_gates.sql): the reading-grade gate on publishing patient content.
--
--   R. The grade is computed by the database with the same formula as packages/shared learning/reading-grade.ts (the golden vectors are repeated
--      here); a client-supplied grade is overwritten; content above the PROPOSED maximum cannot move to 'published'.
--   O. Only the active Chief Medical Officer can record an override, with a long-enough written reason; it is attributed and audited; it is bound to
--      the exact body it was recorded against (editing the text voids it); the override columns cannot be written any other way, not even by the
--      table owner; a patient, an admin and anon are refused.
--   E. Clinician-level content is exempt; a missing limit fails closed; an item published before the gate existed is not touched by ordinary edits;
--      the report is for admin or the CMO only.
--   SABOTAGE: with the gate trigger dropped, dense content publishes with no override (so the refusals R9, O5, O10 and O13 could fail).
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
  values (v, 'rg-' || p_label || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, is_test)
  values (v, p_org, p_role::public.user_role, 'RG ' || p_label, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true;
  return v;
end $f$;
-- run a statement as a user (anon when null); returns 'ok' or the SQLSTATE
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
-- run a scalar integer query as a user; -1 on any error
create function pg_temp.as_count(p_uid uuid, p_sql text) returns integer language plpgsql as $f$
declare n integer;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin execute p_sql into n; exception when others then n := -1; end;
  reset role; perform set_config('request.jwt.claims', '', true);
  return n;
end $f$;
-- a draft item with every review field filled so only the reading grade can stop it; p_extra is a SET clause applied while it is still a draft
create function pg_temp.mkdraft(p_code text, p_body text, p_extra text default 'id = id') returns uuid language plpgsql as $f$
declare v uuid;
begin
  insert into public.health_education_content
    (code, title, summary, body, category, content_status, clinician_reviewed, reviewed_by_name, reviewed_at, source_reference, self_care_action, next_review_due)
  values (p_code, 'Title ' || p_code, 'Teaser', p_body, 'getting_started', 'draft', true, 'Dr Reviewer', now(), 'Proof source', 'Do one small thing today', current_date + 90)
  returning id into v;
  execute format('update public.health_education_content set %s where id = %L', p_extra, v);
  return v;
end $f$;
-- try to publish as the table owner (the way the status function does its update); 'ok' or the SQLSTATE
create function pg_temp.publish(p_id uuid) returns text language plpgsql as $f$
declare r text := 'ok';
begin
  begin update public.health_education_content set content_status = 'published' where id = p_id; exception when others then r := sqlstate; end;
  return r;
end $f$;
-- same, for an arbitrary statement run as the table owner
create function pg_temp.owner_try(p_sql text) returns text language plpgsql as $f$
declare r text := 'ok';
begin
  begin execute p_sql; exception when others then r := sqlstate; end;
  return r;
end $f$;

do $$
declare
  v_org uuid; v_admin uuid; v_cmo uuid; v_pat uuid;
  v_plain constant text := 'Take your tablet each morning. Sit and rest for five minutes. Then check your blood pressure.';
  v_dense constant text := 'Hypertension is a chronic cardiovascular condition characterised by persistently elevated arterial pressure.';
  v_dense2 constant text := 'Antihypertensive pharmacotherapy necessitates comprehensive longitudinal monitoring of haemodynamic parameters.';
  v_id uuid; v_dense_id uuid; v_edit_id uuid;
begin
  select id into v_org from public.organisations limit 1;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  v_cmo := pg_temp.mkuser(v_org, 'cmo', 'clinician');
  v_pat := pg_temp.mkuser(v_org, 'patient', 'patient');
  insert into public.clinical_staff (profile_id, organisation_id, full_name, doctor_tier, active, credential_type, credential_number, indemnity_exempt, indemnity_exempt_by, verified_by, license_verified_at)
  values (v_cmo, v_org, 'RG CMO', 'chief_medical_officer', true, 'MDCN', 'RG-CMO-1', true, v_admin, v_admin, now());

  -- ================= R. the formula and the gate =================
  perform pg_temp.ck('R1 plain golden vector grades 1.2', private.reading_grade(v_plain) = 1.2);
  perform pg_temp.ck('R2 dense golden vector grades 21.5', private.reading_grade(v_dense) = 21.5);
  perform pg_temp.ck('R3 markdown, line breaks and an apostrophe word grade 0.7',
    private.reading_grade(E'## Salt\n- Eat less salt\n- Use **fresh** pepper, not seasoning cubes\nIt is easy to start. Don''t worry if you slip.') = 0.7);
  perform pg_temp.ck('R4 empty and null text grade 0', private.reading_grade('') = 0 and private.reading_grade(null) = 0);
  perform pg_temp.ck('R5 syllable estimate', private.count_syllables('salt') = 1 and private.count_syllables('tablet') = 2
    and private.count_syllables('hypertension') = 4 and private.count_syllables('123') = 0);

  v_id := pg_temp.mkdraft('rg-plain', v_plain);
  perform pg_temp.ck('R6 plain content publishes', pg_temp.publish(v_id) = 'ok');
  perform pg_temp.ck('R7 the stored grade is the computed grade', (select reading_grade from public.health_education_content where id = v_id) = 1.2);

  v_dense_id := pg_temp.mkdraft('rg-dense', v_dense, 'reading_grade = 1.0');
  perform pg_temp.ck('R8 a client-supplied grade is overwritten by the computed one', (select reading_grade from public.health_education_content where id = v_dense_id) = 21.5);
  perform pg_temp.ck('R9 dense content (grade 21.5, maximum 8) cannot be published', pg_temp.publish(v_dense_id) = '23514');
  perform pg_temp.ck('R10 it stayed a draft', (select content_status from public.health_education_content where id = v_dense_id) = 'draft');

  -- ================= O. the override =================
  perform pg_temp.ck('O1 a patient cannot record an override',
    pg_temp.as_try(v_pat, format('select public.set_reading_grade_override(%L, %L)', v_dense_id, 'The drug name cannot be made simpler')) = '42501');
  perform pg_temp.ck('O2 an admin cannot record an override (only the Chief Medical Officer)',
    pg_temp.as_try(v_admin, format('select public.set_reading_grade_override(%L, %L)', v_dense_id, 'The drug name cannot be made simpler')) = '42501');
  perform pg_temp.ck('O3 anon cannot call it',
    pg_temp.as_try(null, format('select public.set_reading_grade_override(%L, %L)', v_dense_id, 'The drug name cannot be made simpler')) = '42501');
  perform pg_temp.ck('O4 the CMO needs a reason of the configured length',
    pg_temp.as_try(v_cmo, format('select public.set_reading_grade_override(%L, %L)', v_dense_id, 'too short')) = '22023');
  perform pg_temp.ck('O5 the dense item still cannot publish after the refused attempts', pg_temp.publish(v_dense_id) = '23514');
  perform pg_temp.ck('O6 the CMO records an override with a real reason',
    pg_temp.as_try(v_cmo, format('select public.set_reading_grade_override(%L, %L)', v_dense_id, 'The drug name cannot be made simpler')) = 'ok');
  perform pg_temp.ck('O7 the override is attributed to the CMO, bound to the body, and audited',
    (select reading_grade_override_by = v_cmo and reading_grade_override_body_md5 = md5(body || chr(31) || coalesce(summary, '')) from public.health_education_content where id = v_dense_id)
    and exists (select 1 from public.audit_log where actor_id = v_cmo and action = 'learning.reading_grade_override' and entity_id = v_dense_id));
  perform pg_temp.ck('O8 with the override the dense item publishes', pg_temp.publish(v_dense_id) = 'ok');
  perform pg_temp.ck('O9 a published item cannot be given an override',
    pg_temp.as_try(v_cmo, format('select public.set_reading_grade_override(%L, %L)', v_dense_id, 'Trying again after it is already live')) = '55000');

  v_edit_id := pg_temp.mkdraft('rg-edit', v_dense);
  perform pg_temp.as_try(v_cmo, format('select public.set_reading_grade_override(%L, %L)', v_edit_id, 'The drug name cannot be made simpler'));
  update public.health_education_content set body = v_dense2 where id = v_edit_id;
  perform pg_temp.ck('O10 editing the text after an override voids it: the item cannot publish', pg_temp.publish(v_edit_id) = '23514');

  v_id := pg_temp.mkdraft('rg-direct', v_dense);
  perform pg_temp.ck('O11 the table owner cannot write the override columns directly',
    pg_temp.owner_try(format('update public.health_education_content set reading_grade_override_reason = %L, reading_grade_override_body_md5 = md5(body) where id = %L',
      'A reason that is long enough', v_id)) = '42501');
  perform pg_temp.ck('O12 nor can a row be inserted carrying an override',
    pg_temp.owner_try($q$insert into public.health_education_content (code, title, body, category, reading_grade_override_reason) values ('rg-direct-ins', 't', 'b', 'getting_started', 'A reason that is long enough')$q$) = '42501');
  perform pg_temp.ck('O13 and the dense draft still cannot publish', pg_temp.publish(v_id) = '23514');

  -- ================= E. exemptions and edges =================
  v_id := pg_temp.mkdraft('rg-clinician', v_dense, 'reading_level = ''clinician''');
  perform pg_temp.ck('E1 clinician-level content is exempt from the patient reading grade', pg_temp.publish(v_id) = 'ok');

  update public.learning_config set is_active = false where key = 'reading_grade';
  v_id := pg_temp.mkdraft('rg-noconfig', v_plain);
  perform pg_temp.ck('E2 with no limit configured, patient content cannot be published (fails closed)', pg_temp.publish(v_id) = '23514');
  update public.learning_config set is_active = true where key = 'reading_grade';
  perform pg_temp.ck('E3 with the limit back, it publishes', pg_temp.publish(v_id) = 'ok');

  alter table public.health_education_content disable trigger health_education_reading_grade_gate;
  v_id := pg_temp.mkdraft('rg-legacy', v_dense);
  update public.health_education_content set content_status = 'published' where id = v_id;
  alter table public.health_education_content enable trigger health_education_reading_grade_gate;
  perform pg_temp.ck('E4 an item published before the gate existed can still be edited in unrelated ways (the gate only looks at a move to published)',
    pg_temp.owner_try(format('update public.health_education_content set sort_order = sort_order + 1 where id = %L', v_id)) = 'ok');

  -- an in-place edit of a published item, and a hard summary, are graded too
  v_id := pg_temp.mkdraft('rg-inplace', v_plain);
  perform pg_temp.ck('E9a plain content publishes', pg_temp.publish(v_id) = 'ok');
  perform pg_temp.ck('E9 editing a published item to dense wording is refused (the gate also runs on an in-place text change)',
    pg_temp.owner_try(format('update public.health_education_content set body = %L where id = %L', v_dense, v_id)) = '23514');
  perform pg_temp.ck('E9b an unrelated edit to the same published item still works',
    pg_temp.owner_try(format('update public.health_education_content set sort_order = sort_order + 1 where id = %L', v_id)) = 'ok');
  v_id := pg_temp.mkdraft('rg-summary', v_plain);
  update public.health_education_content set summary = v_dense where id = v_id;
  perform pg_temp.ck('E10 a plain body with a hard-to-read summary cannot be published', pg_temp.publish(v_id) = '23514');

  perform pg_temp.ck('E5 the report is available to an admin and lists the dense items',
    pg_temp.as_count(v_admin, $q$select count(*) from public.learning_reading_grade_report() where over_maximum$q$) >= 1);
  perform pg_temp.ck('E6 the report is available to the CMO', pg_temp.as_count(v_cmo, 'select count(*) from public.learning_reading_grade_report()') >= 1);
  perform pg_temp.ck('E7 a patient is refused the report', pg_temp.as_try(v_pat, 'select * from public.learning_reading_grade_report()') = '42501');
  perform pg_temp.ck('E8 anon is refused the report', pg_temp.as_try(null, 'select * from public.learning_reading_grade_report()') = '42501');

  -- ================= SABOTAGE =================
  -- (i) with the gate dropped, dense content publishes: the refusal above is the gate's work
  drop trigger health_education_reading_grade_gate on public.health_education_content;
  v_id := pg_temp.mkdraft('rg-sabotage', v_dense2);
  perform pg_temp.ck('S1 sabotage: with the gate trigger dropped, dense content publishes with no override', pg_temp.publish(v_id) = 'ok');

  raise notice 'PASS: reading grade gate, % checks', (select count(*) from results);
end $$;

select n, check_name, case when ok then 'PASS' else 'FAIL' end as verdict from results order by n;
rollback;
