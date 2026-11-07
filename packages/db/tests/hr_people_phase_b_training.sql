-- HR Phase B training (migration *_hr_people_phase_b_training.sql). One rolled-back transaction.
--
--   1. Shape: anon runs nothing; authenticated reads but never writes the training tables.
--   2. A non-admin cannot add a course, a requirement or a completion, or read the matrix.
--   3. Requirements: everyone / role / department reach the right people with the right due date; a removed rule stops.
--   4. Completions: recorded unverified, verified only by a different admin (never self), expiry derived from the course's
--      renewal period; never edited or deleted; voiding needs a reason and drops the record from the matrix.
--   5. The person reads their own completions; a colleague reads none.
--   6. SABOTAGE: the completion guard made a no-op, and the completion read policy opened to everyone.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(label text primary key, id uuid) on commit drop;
grant all on fx to public;

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
create function pg_temp.back() returns void language plpgsql as
$f$ begin reset role; perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.role', '', true); end $f$;
-- Training records skip test accounts, so these fixtures are non-test; the transaction rolls back.
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'hrb-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test, language)
  values (v, p_org, p_role::public.user_role, 'HRB ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '40 years')::date, false, 'en')
  on conflict (id) do update set role = excluded.role, is_test = false, is_active = true, phone = excluded.phone;
  return v;
end $f$;

do $$
declare
  v_org uuid; v_admin uuid; v_admin2 uuid; v_analyst uuid; v_fin uuid; v_dept uuid; v_course uuid; v_course2 uuid;
  v_req uuid; v_c1 uuid; v_c2 uuid; v_today date := (now() at time zone 'Africa/Lagos')::date;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  v_admin2 := pg_temp.mkuser(v_org, 'admin2', 'admin');
  v_analyst := pg_temp.mkuser(v_org, 'analyst', 'analyst');
  v_fin := pg_temp.mkuser(v_org, 'finance', 'finance');
  insert into fx values ('admin', v_admin), ('admin2', v_admin2), ('analyst', v_analyst), ('finance', v_fin);

  -- 1. Shape
  perform pg_temp.rec('anon runs none of the training functions', '0',
    (select count(*)::text from unnest(array['public.people_training_records(uuid)', 'public.record_training_completion(uuid,uuid,date,boolean,text,text)',
       'public.verify_training_completion(uuid)', 'public.void_training_completion(uuid,text)',
       'public.save_training_course(uuid,text,text,text,text,smallint,boolean)', 'public.add_training_requirement(uuid,text,text,uuid,smallint)',
       'public.remove_training_requirement(uuid)']) f where has_function_privilege('anon', f::regprocedure, 'EXECUTE')));
  perform pg_temp.rec('authenticated reads but never writes completions', 'true|false|false|false',
    has_table_privilege('authenticated', 'public.staff_training_completions', 'SELECT')::text || '|' ||
    has_table_privilege('authenticated', 'public.staff_training_completions', 'INSERT')::text || '|' ||
    has_table_privilege('authenticated', 'public.staff_training_completions', 'UPDATE')::text || '|' ||
    has_table_privilege('authenticated', 'public.staff_training_completions', 'DELETE')::text);

  -- 2. A non-admin
  perform pg_temp.act(v_analyst);
  perform pg_temp.rec('a non-admin cannot add a course', '42501', pg_temp.try($q$select public.save_training_course(null, 'Fake', 'mandatory')$q$));
  perform pg_temp.rec('a non-admin cannot read the training matrix', '42501', pg_temp.try('select * from public.people_training_records()'));
  perform pg_temp.back();

  -- 3. Requirements
  perform pg_temp.act(v_admin);
  v_dept := public.save_staff_department(null, 'HRB proof finance');
  v_course := public.save_training_course(null, 'HRB data protection', 'mandatory', 'Internal', null, 12::smallint);
  v_course2 := public.save_training_course(null, 'HRB anti-fraud', 'mandatory', null, null, null);
  v_req := public.add_training_requirement(v_course, 'everyone', null, null, 30::smallint);
  perform public.add_training_requirement(v_course2, 'role', 'finance', null, 14::smallint);
  perform pg_temp.rec('a duplicate requirement is refused', 'P0001',
    pg_temp.try(format($q$select public.add_training_requirement(%L, 'everyone', null, null, 30::smallint)$q$, v_course)));
  perform pg_temp.rec('an "everyone" course reaches the analyst, due 30 days from today (the rule is newer than their start)',
    (v_today + 30)::text,
    (select due_on::text from public.people_training_records() where profile_id = v_analyst and course_id = v_course));
  perform pg_temp.rec('a role rule reaches finance and not the analyst', '1|0',
    (select count(*)::text from public.people_training_records() where profile_id = v_fin and course_id = v_course2) || '|' ||
    (select count(*)::text from public.people_training_records() where profile_id = v_analyst and course_id = v_course2));

  -- 4. Completions
  v_c1 := public.record_training_completion(v_analyst, v_course, v_today - 10, false, 'Certificate 123');
  perform pg_temp.rec('an unverified completion shows as not verified, with expiry 12 months on', 'false|' || ((v_today - 10) + interval '12 months')::date::text,
    (select verified::text || '|' || expires_on::text from public.people_training_records() where profile_id = v_analyst and course_id = v_course));
  perform pg_temp.rec('a future completion date is refused', 'P0001',
    pg_temp.try(format($q$select public.record_training_completion(%L, %L, %L)$q$, v_analyst, v_course, v_today + 1)));
  perform pg_temp.rec('an admin cannot record their own training as verified', '42501',
    pg_temp.try(format($q$select public.record_training_completion(%L, %L, %L, true)$q$, v_admin, v_course, v_today)));
  v_c2 := public.record_training_completion(v_admin, v_course, v_today, false);
  perform pg_temp.rec('an admin cannot verify their own record', '42501', pg_temp.try(format('select public.verify_training_completion(%L)', v_c2)));
  perform pg_temp.back();
  perform pg_temp.act(v_admin2);
  perform public.verify_training_completion(v_c1);
  perform pg_temp.rec('another admin verifies it', 'true',
    (select verified::text from public.people_training_records() where profile_id = v_analyst and course_id = v_course));
  perform pg_temp.rec('a short void reason is refused', 'P0001', pg_temp.try(format($q$select public.void_training_completion(%L, 'wrong')$q$, v_c1)));
  -- an expired verified record does not hide a newer renewal awaiting verification
  perform public.save_training_course(v_course2, 'HRB anti-fraud', 'mandatory', null, null, 6::smallint);
  perform public.record_training_completion(v_fin, v_course2, v_today - 400, false);
  perform pg_temp.back();
  perform pg_temp.act(v_admin2);
  perform public.verify_training_completion((select id from public.staff_training_completions where profile_id = v_fin and course_id = v_course2));
  perform pg_temp.back();
  perform pg_temp.act(v_admin);
  perform public.record_training_completion(v_fin, v_course2, v_today - 2, false);
  perform pg_temp.rec('a newer renewal awaiting verification is shown, not the expired record', 'false|' || (v_today - 2)::text,
    (select verified::text || '|' || completed_on::text from public.people_training_records(v_fin) where course_id = v_course2));
  perform public.set_training_requirement_due(v_req, 10::smallint);
  perform pg_temp.rec('changing the due period in place moves the due date without restarting the clock', (v_today + 10)::text,
    (select due_on::text from public.people_training_records(v_analyst) where course_id = v_course));
  perform pg_temp.rec('Recent HR activity shows training events with their subject', 'true',
    exists (select 1 from public.people_recent_activity(50) where action = 'staff_training_completion.recorded' and subject_profile_id = v_fin)::text);
  perform pg_temp.back();
  perform pg_temp.rec('a completion cannot be edited', '42501',
    pg_temp.try(format('update public.staff_training_completions set completed_on = completed_on - 1 where id = %L', v_c1)));
  perform pg_temp.rec('a completion cannot be deleted', '42501',
    pg_temp.try(format('delete from public.staff_training_completions where id = %L', v_c1)));

  -- 5. Reads
  perform pg_temp.act(v_analyst);
  perform pg_temp.rec('the person reads their own completion', '1',
    (select count(*)::text from public.staff_training_completions where profile_id = v_analyst));
  perform pg_temp.back();
  perform pg_temp.act(v_fin);
  perform pg_temp.rec('a colleague reads none of it', '0',
    (select count(*)::text from public.staff_training_completions where profile_id = v_analyst));
  perform pg_temp.back();

  -- voiding and removing
  perform pg_temp.act(v_admin2);
  perform public.void_training_completion(v_c1, 'Recorded against the wrong person.');
  perform pg_temp.rec('a voided completion drops out of the matrix', 'null',
    coalesce((select completion_id::text from public.people_training_records() where profile_id = v_analyst and course_id = v_course), 'null'));
  perform public.remove_training_requirement(v_req);
  perform pg_temp.rec('a removed requirement no longer applies', '0',
    (select count(*)::text from public.people_training_records() where profile_id = v_analyst and course_id = v_course));
  perform pg_temp.back();
  perform pg_temp.rec('every write was audited', '14',
    (select count(*)::text from public.audit_log where actor_id in (v_admin, v_admin2) and action like 'staff_training_%'));
end $$;

-- 6. Sabotage
do $$
declare v_admin uuid; v_analyst uuid; v_fin uuid; v_course uuid; v_c uuid;
begin
  select id into v_admin from fx where label = 'admin';
  select id into v_analyst from fx where label = 'analyst';
  select id into v_fin from fx where label = 'finance';
  perform pg_temp.act(v_admin);
  v_course := public.save_training_course(null, 'HRB sabotage course', 'mandatory');
  v_c := public.record_training_completion(v_analyst, v_course, (now() at time zone 'Africa/Lagos')::date, false);
  perform pg_temp.back();
  -- sabotage 1: the guard made a no-op
  create or replace function private.staff_training_completions_guard() returns trigger language plpgsql set search_path = '' as $f$
  begin if tg_op = 'DELETE' then return old; end if; return new; end $f$;
  insert into results values ('sabotaged', 'a completion cannot be deleted', '42501',
    pg_temp.try(format('delete from public.staff_training_completions where id = %L', v_c)));
  -- sabotage 2: the read policy opened to everyone
  drop policy staff_training_completions_read on public.staff_training_completions;
  create policy staff_training_completions_read on public.staff_training_completions for select to authenticated using (true);
  perform pg_temp.act(v_admin);
  perform public.record_training_completion(v_analyst, v_course, (now() at time zone 'Africa/Lagos')::date, false);
  perform pg_temp.back();
  perform pg_temp.act(v_fin);
  insert into results values ('sabotaged', 'a colleague reads none of it', '0',
    (select count(*)::text from public.staff_training_completions where profile_id = v_analyst));
  perform pg_temp.back();
end $$;

do $$
declare v_bad text; v_caught integer;
begin
  select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') into v_bad
    from results where phase = 'real' and expected is distinct from actual;
  if v_bad is not null then raise exception 'hr_people_phase_b_training FAILED: %', v_bad; end if;
  if (select count(*) from results where phase = 'real') <> 23 then
    raise exception 'hr_people_phase_b_training: expected 23 checks, got %', (select count(*) from results where phase = 'real');
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected is distinct from actual;
  if v_caught < 2 then raise exception 'VACUOUS TEST: only % of 2 sabotage steps changed the matching check', v_caught; end if;
end $$;

select phase, check_name, expected, actual,
       case when phase = 'real' then case when expected = actual then 'PASS' else 'FAIL' end
            else case when expected is distinct from actual then 'CAUGHT' else 'MISSED' end end as result
from results order by phase, check_name;

rollback;
