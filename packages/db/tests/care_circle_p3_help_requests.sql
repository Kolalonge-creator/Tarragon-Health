-- ===========================================================================
-- Proof: Care Circle Phase 3, help requests (20261104190227_care_circle_p3_help_requests.sql)
--   A. An addressed request (with the patient's note, D4) is seen, notified and answerable only by the people named on it, including a
--      named person who only views (founder decision 2026-11-04); the notice carries no note.
--   B. Answers: "I can't" is recorded and shown to the patient by first name; "I can help" claims it and replaces "I can't"; done.
--   C. Rules: only the patient addresses or writes a note; "other" needs a note; a note is at most 140 characters; recipients must be in
--      the circle; exactly one post_circle_task signature.
--   D. Outsiders: a stranger cannot claim or decline; nobody reads the answers table directly.
--   E. Unaddressed jobs behave as before (helpers claim, viewers see); a passed date expires a request; a named recipient keeps a claim.
--   SABOTAGE: recipients ignored (a helper sees an addressed request); notices to every helper; a helper allowed to write a note.
-- BEGIN/ROLLBACK; mints its own fixtures.
-- ===========================================================================
begin;
create temp table results (phase text, check_name text, expected text, actual text);
grant all on results to public;

create function pg_temp.ck(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('real', p_name, p_expected, p_actual) $$;
create function pg_temp.sk(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('sabotaged', p_name, p_expected, p_actual) $$;
create function pg_temp.q_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  set local role authenticated;
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlstate; end;
  reset role;
  perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.sub', '', true);
  return r;
end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text) returns uuid language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'ccp3-' || p_label || '-' || substr(v::text, 1, 8) || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, 'patient'::public.user_role, initcap(p_label) || ' Ccp', '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '50 years')::date, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone, full_name = excluded.full_name;
  update public.profiles set organisation_id = p_org where id = v;
  return v;
end $f$;
create function pg_temp.tasks(p_uid uuid, p_pat uuid) returns jsonb language sql as
$$ select pg_temp.q_as(p_uid, format('select public.circle_tasks(%L::uuid)::text', p_pat))::jsonb $$;
create function pg_temp.count_tasks(p_uid uuid, p_pat uuid) returns text language sql as
$$ select coalesce(jsonb_array_length(pg_temp.tasks(p_uid, p_pat) -> 'tasks')::text, 'ERR') $$;
create function pg_temp.notes(p_uid uuid) returns text language sql as
$$ select count(*)::text from public.notifications where recipient_id = p_uid and template = 'circle_task_update' $$;

do $$
declare
  v_org uuid := (select id from public.organisations order by created_at limit 1);
  pat uuid; helper uuid; viewer uuid; named uuid; stranger uuid; m_named uuid; r text; v jsonb; tk uuid; job uuid; d text;
begin
  pat := pg_temp.mkuser(v_org, 'patient'); helper := pg_temp.mkuser(v_org, 'helper'); viewer := pg_temp.mkuser(v_org, 'viewer');
  named := pg_temp.mkuser(v_org, 'named'); stranger := pg_temp.mkuser(v_org, 'stranger');
  insert into public.care_circle_members (organisation_id, patient_id, supporter_id, relationship, permissions, expires_at, is_test)
  values (v_org, pat, helper, 'Son', array['appointments', 'pay_for_care'], now() + interval '30 days', true),
         (v_org, pat, viewer, 'Niece', array['appointments'], now() + interval '30 days', true),
         (v_org, pat, named, 'Daughter', array['red_alerts'], now() + interval '30 days', true);
  m_named := (select id from public.care_circle_members where patient_id = pat and supporter_id = named);
  update public.platform_modules set is_enabled = true, enabled_at = now(), enabled_by = pat, activation_note = 'care_circle_p3 proof' where key = 'care_circle_tasks';

  -- A. an addressed request with a note
  r := pg_temp.q_as(pat, format($q$select public.post_circle_task(%L::uuid, 'help_paying_test', current_date + 3, %L::uuid[], 'For the kidney test on Friday')::text$q$,
                                pat, array[m_named]));
  tk := (r::jsonb ->> 'task_id')::uuid;
  perform pg_temp.ck('A1 the patient posts a request to one named person, with a note', 'true', (r like '{%')::text);
  perform pg_temp.ck('A2 the helper who is not named does not see it', '0', pg_temp.count_tasks(helper, pat));
  perform pg_temp.ck('A3 the viewer who is not named does not see it', '0', pg_temp.count_tasks(viewer, pat));
  v := pg_temp.tasks(named, pat);
  perform pg_temp.ck('A4 the named person (who only gets alerts) sees it, with the note, and may answer either way', '1/For the kidney test on Friday/true/true',
    jsonb_array_length(v -> 'tasks') || '/' || (v -> 'tasks' -> 0 ->> 'note') || '/' || (v -> 'tasks' -> 0 ->> 'can_claim') || '/' || (v -> 'tasks' -> 0 ->> 'can_decline'));
  perform pg_temp.ck('A5 only the named person is told, never the helper', '1/0', pg_temp.notes(named) || '/' || pg_temp.notes(helper));
  perform pg_temp.ck('A6 the notice carries only whose circle it is, never the note', 'true',
    (select bool_and(payload = jsonb_build_object('patient_id', pat)) from public.notifications where recipient_id = named and template = 'circle_task_update')::text);
  perform pg_temp.ck('A7 the recipient list is shown to the patient only', 'null/1',
    coalesce(v -> 'tasks' -> 0 ->> 'recipients', 'null') || '/' || jsonb_array_length(pg_temp.tasks(pat, pat) -> 'tasks' -> 0 -> 'recipients')::text);

  -- B. answers
  perform pg_temp.ck('B1 the named person says they cannot help', 'true', pg_temp.q_as(named, format('select public.decline_circle_task(%L::uuid)::text', tk)));
  v := pg_temp.tasks(pat, pat);
  perform pg_temp.ck('B2 the patient sees that answer by first name, and is told', 'Named/cannot_help/1',
    (v -> 'tasks' -> 0 -> 'recipients' -> 0 ->> 'name') || '/' || (v -> 'tasks' -> 0 -> 'recipients' -> 0 ->> 'answer') || '/' ||
    (select count(*)::text from public.notifications where recipient_id = pat and template = 'circle_task_update'));
  r := pg_temp.q_as(named, format('select public.claim_circle_task(%L::uuid)::text', tk));
  perform pg_temp.ck('B3 then they change their mind: "I can help" claims it and replaces "I can''t"', 'true/can_help/0',
    r || '/' ||
    (pg_temp.tasks(pat, pat) -> 'tasks' -> 0 -> 'recipients' -> 0 ->> 'answer') || '/' ||
    (select count(*)::text from public.care_circle_task_responses where task_id = tk));
  r := pg_temp.q_as(named, format('select public.complete_circle_task(%L::uuid)::text', tk));
  perform pg_temp.ck('B4 the named person marks it done', 'true/done', r || '/' || (select state from public.care_circle_tasks where id = tk));

  -- C. rules
  perform pg_temp.ck('C1 a helper may not address a request or write a note', 'ERR:42501',
    pg_temp.q_as(helper, format($q$select public.post_circle_task(%L::uuid, 'transport', null, null, 'a note')::text$q$, pat)));
  perform pg_temp.ck('C2 "other" needs a note', 'ERR:22023', pg_temp.q_as(pat, format($q$select public.post_circle_task(%L::uuid, 'other')::text$q$, pat)));
  perform pg_temp.ck('C3 a note longer than 140 characters is refused', 'ERR:22023',
    pg_temp.q_as(pat, format($q$select public.post_circle_task(%L::uuid, 'other', null, null, %L)::text$q$, pat, repeat('x', 141))));
  perform pg_temp.ck('C4 a recipient outside the circle is refused', 'ERR:22023',
    pg_temp.q_as(pat, format($q$select public.post_circle_task(%L::uuid, 'transport', null, %L::uuid[])::text$q$, pat, array[gen_random_uuid()])));
  perform pg_temp.ck('C5 exactly one post_circle_task signature', '1',
    (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'post_circle_task'));

  -- D. outsiders
  r := pg_temp.q_as(pat, format($q$select public.post_circle_task(%L::uuid, 'transport', current_date + 2, %L::uuid[])::text$q$, pat, array[m_named]));
  tk := (r::jsonb ->> 'task_id')::uuid;
  perform pg_temp.ck('D1 a stranger cannot claim or decline it', 'ERR:P0002/ERR:P0002',
    pg_temp.q_as(stranger, format('select public.claim_circle_task(%L::uuid)::text', tk)) || '/' || pg_temp.q_as(stranger, format('select public.decline_circle_task(%L::uuid)::text', tk)));
  perform pg_temp.ck('D2 the unnamed helper cannot claim it either', 'ERR:P0002', pg_temp.q_as(helper, format('select public.claim_circle_task(%L::uuid)::text', tk)));
  perform pg_temp.ck('D3 nobody reads the answers table directly', 'ERR:42501', pg_temp.q_as(named, 'select count(*)::text from public.care_circle_task_responses'));

  -- E. unaddressed jobs, expiry, a named person's claim survives the sweep
  r := pg_temp.q_as(pat, format($q$select public.post_circle_task(%L::uuid, 'visit')::text$q$, pat));
  job := (r::jsonb ->> 'task_id')::uuid;
  perform pg_temp.ck('E1 an unaddressed job: the helper may claim, the viewer only sees, the alerts-only person does not see it', 'true/false/0',
    (select (e ->> 'can_claim') from jsonb_array_elements(pg_temp.tasks(helper, pat) -> 'tasks') e where (e ->> 'task_id')::uuid = job) || '/' ||
    (select (e ->> 'can_claim') from jsonb_array_elements(pg_temp.tasks(viewer, pat) -> 'tasks') e where (e ->> 'task_id')::uuid = job) || '/' ||
    (select count(*)::text from jsonb_array_elements(pg_temp.tasks(named, pat) -> 'tasks') e where (e ->> 'task_id')::uuid = job));
  perform pg_temp.q_as(named, format('select public.claim_circle_task(%L::uuid)::text', tk));
  perform private.sweep_circle_tasks();
  perform pg_temp.ck('E2 the sweep leaves a named person''s claim alone', 'claimed', (select state from public.care_circle_tasks where id = tk));
  update public.care_circle_tasks set needed_by = current_date - 10 where id = job;
  perform private.sweep_circle_tasks();
  perform pg_temp.ck('E3 a request whose date passed is expired, not cancelled', 'expired', (select state from public.care_circle_tasks where id = job));

  -- F. the weekly digest never counts a request addressed to someone else
  update public.platform_modules set is_enabled = true, enabled_at = now(), enabled_by = pat, activation_note = 'care_circle_p3 proof' where key = 'care_circle_digest';
  perform pg_temp.q_as(pat, format($q$select public.post_circle_task(%L::uuid, 'consultation_help', current_date + 6, %L::uuid[])::text$q$, pat, array[m_named]));
  perform pg_temp.ck('F0 an open request addressed to the named person exists', '1',
    (select count(*)::text from public.care_circle_tasks where patient_id = pat and state = 'open' and recipients is not null));
  perform pg_temp.ck('F1 the helper''s digest does not count the open request addressed to someone else', '0',
    pg_temp.q_as(helper, format('select (public.circle_weekly_digest(%L::uuid) #>> ''{tasks,open}'')', pat)));
  perform pg_temp.ck('F2 a named person who only gets alerts still gets no task counts in the digest (their permissions decide)', 'absent',
    coalesce(pg_temp.q_as(named, format('select (public.circle_weekly_digest(%L::uuid) -> ''tasks'')::text', pat)), 'absent'));

  -- ---------------- SABOTAGE ----------------
  r := pg_temp.q_as(pat, format($q$select public.post_circle_task(%L::uuid, 'transport', current_date + 4, %L::uuid[])::text$q$, pat, array[m_named]));
  tk := (r::jsonb ->> 'task_id')::uuid;
  begin
    create or replace function private.circle_task_access(p_task public.care_circle_tasks) returns text
      language sql stable security definer set search_path = '' as $f$ select private.circle_task_role(p_task.patient_id) $f$;
    r := (select count(*)::text from jsonb_array_elements(pg_temp.tasks(helper, pat) -> 'tasks') e where (e ->> 'task_id')::uuid = tk);
    raise exception using errcode = 'P0099';
  exception when sqlstate 'P0099' then null;
  end;
  perform pg_temp.sk('S1 recipients ignored: the unnamed helper DOES see the addressed request (flips A2)', '1', r);
  begin
    select pg_get_functiondef('private.circle_task_notify(care_circle_tasks, boolean)'::regprocedure) into d;
    d := replace(d, 'case when p_task.recipients is not null then m.supporter_id = any (p_task.recipients)', 'case when false then true');
    if d = pg_get_functiondef('private.circle_task_notify(care_circle_tasks, boolean)'::regprocedure) then raise exception 'sabotage S2 did not change the function'; end if;
    execute d;
    d := pg_temp.notes(helper);
    perform pg_temp.q_as(pat, format($q$select public.post_circle_task(%L::uuid, 'transport', current_date + 5, %L::uuid[])::text$q$, pat, array[m_named]));
    r := (pg_temp.notes(helper)::integer - d::integer)::text;
    raise exception using errcode = 'P0099';
  exception when sqlstate 'P0099' then null;
  end;
  perform pg_temp.sk('S2 notices to every helper: the unnamed helper IS told about the addressed request (flips A5)', '1', r);
  begin
    select pg_get_functiondef('public.post_circle_task(uuid, text, date, uuid[], text)'::regprocedure) into d;
    d := replace(d, 'if v_role <> ''patient'' and (p_recipients is not null or v_note is not null) then', 'if false then');
    if d = pg_get_functiondef('public.post_circle_task(uuid, text, date, uuid[], text)'::regprocedure) then raise exception 'sabotage S3 did not change the function'; end if;
    execute d;
    r := (pg_temp.q_as(helper, format($q$select public.post_circle_task(%L::uuid, 'transport', null, null, 'a note')::text$q$, pat)) like '{%')::text;
    raise exception using errcode = 'P0099';
  exception when sqlstate 'P0099' then null;
  end;
  perform pg_temp.sk('S3 a helper allowed to write a note (flips C1)', 'true', r);
end $$;

select phase, check_name, expected, actual, case when expected is not distinct from actual then 'PASS' else 'FAIL' end as verdict
  from results order by phase, check_name;
do $$
declare n integer;
begin
  select count(*) into n from results where expected is distinct from actual;
  if n > 0 then raise exception 'care_circle_p3_help_requests: % check(s) did not hold', n; end if;
  if (select count(*) from results) < 22 then raise exception 'care_circle_p3_help_requests: fewer checks ran than expected'; end if;
end $$;
rollback;
