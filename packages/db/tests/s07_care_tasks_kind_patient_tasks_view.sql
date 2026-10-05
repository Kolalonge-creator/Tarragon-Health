-- S07 proof: care_tasks.kind, the recurrence roll that must carry it, and the
-- patient_tasks view (decision OQ-65; migration *_s07_care_tasks_kind_and_patient_tasks_view.sql).
--
-- Proves in one rolled-back transaction:
--   1. A patient reads her own tasks through patient_tasks and never another
--      patient's (security_invoker plus the caller scope).
--   2. kind and the state mapping come through (open, then done after completion).
--   3. CONTROL: a staff account reading patient_tasks sees none of the org's tasks,
--      while still reading the table care_tasks directly (existing behaviour kept).
--   4. anon cannot read the view (42501); authenticated has no write privilege on it.
--   4b. A care-team-owned task about the patient is NOT in her view but is still readable
--      on care_tasks (existing behaviour kept), so its title never reaches the Today list.
--   4c. Every care_task_status value other than the three intended open ones is named in
--      the view's state mapping, so a status added later cannot silently read as open.
--   5. The kind CHECK refuses an unknown kind (23514) and accepts null.
--   6. Completing a recurring task rolls the next occurrence WITH its kind, a week
--      later, and without a source_event_id.
--   7. CONTROL: a patient still cannot insert or update care_tasks directly (42501);
--      the only patient write path stays complete_care_task().
--   8. SABOTAGE: with the recurrence function reverted to the pre-S07 body (no
--      kind in its INSERT), check 6 must flip to FAIL, proving it discriminates.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;

create or replace function pg_temp.run_checks(p_phase text) returns void
language plpgsql as $f$
declare
  v_org uuid;
  v_p1 uuid := gen_random_uuid();
  v_p2 uuid := gen_random_uuid();
  v_staff uuid := gen_random_uuid();
  v_rec uuid; v_lesson uuid; v_other uuid; v_clin uuid;
  v_unmapped text;
  v_n integer;
  v_state text;
  v_next record;
  v_failed boolean;
  v_sqlstate text;
  v_due timestamptz := date_trunc('second', now() + interval '1 day');
  v_res jsonb := '[]'::jsonb;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  if v_org is null then raise exception 'S07 proof needs one organisation (seed fixture missing)'; end if;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data) values
    (v_p1,    's07-p1-'    || v_p1    || '@example.invalid', 'x', now(), '{}', '{}'),
    (v_p2,    's07-p2-'    || v_p2    || '@example.invalid', 'x', now(), '{}', '{}'),
    (v_staff, 's07-staff-' || v_staff || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name) values
    (v_p1,    v_org, 'patient',   'S07 Patient One'),
    (v_p2,    v_org, 'patient',   'S07 Patient Two'),
    (v_staff, v_org, 'clinician', 'S07 Staff')
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role;

  -- Fixtures as the table owner (bypasses RLS).
  insert into public.care_tasks (organisation_id, patient_id, title, owner_role, due_at, recurrence, kind, source)
    values (v_org, v_p1, 'S07 log BP', 'patient', v_due, 'weekly', 'log_bp', 'system') returning id into v_rec;
  insert into public.care_tasks (organisation_id, patient_id, title, owner_role, due_at, kind, source)
    values (v_org, v_p1, 'S07 lesson', 'patient', v_due, 'read_lesson', 'system') returning id into v_lesson;
  insert into public.care_tasks (organisation_id, patient_id, title, owner_role, due_at, kind, source)
    values (v_org, v_p2, 'S07 other patient', 'patient', v_due, 'log_bp', 'system') returning id into v_other;

  insert into public.care_tasks (organisation_id, patient_id, title, owner_role, due_at, kind, source)
    values (v_org, v_p1, 'S07 care team task', 'clinician', v_due, null, 'clinician') returning id into v_clin;

  -- 5. kind CHECK
  v_failed := false; v_sqlstate := null;
  begin
    insert into public.care_tasks (organisation_id, patient_id, title, kind) values (v_org, v_p1, 'S07 bad kind', 'bogus');
  exception when others then v_failed := true; get stacked diagnostics v_sqlstate = returned_sqlstate; end;
  v_res := v_res || jsonb_build_array(jsonb_build_array('an unknown kind is refused with a check violation', 'true:23514', v_failed::text || ':' || coalesce(v_sqlstate, 'none')));
  insert into public.care_tasks (organisation_id, patient_id, title) values (v_org, v_p1, 'S07 no kind');
  v_res := v_res || jsonb_build_array(jsonb_build_array('a null kind is accepted', 'true',
    (select (count(*) = 1)::text from public.care_tasks where patient_id = v_p1 and title = 'S07 no kind' and kind is null)));

  -- 1, 2. patient one through the view
  perform set_config('request.jwt.claims', json_build_object('sub', v_p1, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_n from public.patient_tasks where id = v_other;
  v_res := v_res || jsonb_build_array(jsonb_build_array('patient one cannot see patient two''s task through the view', '0', v_n::text));
  select count(*) into v_n from public.patient_tasks where id in (v_rec, v_lesson);
  v_res := v_res || jsonb_build_array(jsonb_build_array('patient one sees her own two patient-owned tasks', '2', v_n::text));
  select state into v_state from public.patient_tasks where id = v_rec;
  v_res := v_res || jsonb_build_array(jsonb_build_array('a not_started task reads as open', 'open', coalesce(v_state, 'null')));
  v_res := v_res || jsonb_build_array(jsonb_build_array('kind comes through the view', 'log_bp',
    coalesce((select kind from public.patient_tasks where id = v_rec), 'null')));

  select count(*) into v_n from public.patient_tasks where id = v_clin;
  v_res := v_res || jsonb_build_array(jsonb_build_array('a care-team-owned task is not in the patient view', '0', v_n::text));
  select count(*) into v_n from public.care_tasks where id = v_clin;
  v_res := v_res || jsonb_build_array(jsonb_build_array('control: the patient still reads that task on care_tasks', '1', v_n::text));

  -- 7. CONTROL: no direct patient write
  v_failed := false; v_sqlstate := null;
  begin
    insert into public.care_tasks (organisation_id, patient_id, title) values (v_org, v_p1, 'S07 patient direct insert');
  exception when others then v_failed := true; get stacked diagnostics v_sqlstate = returned_sqlstate; end;
  v_res := v_res || jsonb_build_array(jsonb_build_array('a patient cannot insert into care_tasks directly', 'true:42501', v_failed::text || ':' || coalesce(v_sqlstate, 'none')));
  update public.care_tasks set status = 'completed' where id = v_lesson;
  get diagnostics v_n = row_count;
  v_res := v_res || jsonb_build_array(jsonb_build_array('a patient cannot update care_tasks directly (no row visible to update)', '0', v_n::text));

  -- 6. complete the recurring task the one allowed way
  perform public.complete_care_task(v_rec, 'completed');
  execute 'reset role';

  select * into v_next from public.care_tasks
    where patient_id = v_p1 and title = 'S07 log BP' and id <> v_rec;
  v_res := v_res || jsonb_build_array(jsonb_build_array('completing a recurring task rolls one next occurrence', '1',
    (select count(*)::text from public.care_tasks where patient_id = v_p1 and title = 'S07 log BP' and id <> v_rec)));
  v_res := v_res || jsonb_build_array(jsonb_build_array('the next occurrence is a week later', 'true',
    coalesce((v_next.due_at = v_due + interval '1 week')::text, 'null')));
  v_res := v_res || jsonb_build_array(jsonb_build_array('the next occurrence keeps kind', 'log_bp', coalesce(v_next.kind, 'null')));
  v_res := v_res || jsonb_build_array(jsonb_build_array('the next occurrence has no source_event_id', 'true', (v_next.source_event_id is null)::text));

  -- 2. state mapping after completion
  perform set_config('request.jwt.claims', json_build_object('sub', v_p1, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select state into v_state from public.patient_tasks where id = v_rec;
  v_res := v_res || jsonb_build_array(jsonb_build_array('a completed task reads as done', 'done', coalesce(v_state, 'null')));
  execute 'reset role';

  -- 3. CONTROL: staff
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_n from public.patient_tasks where patient_id = v_p1;
  v_res := v_res || jsonb_build_array(jsonb_build_array('staff reading the view see none of the org''s tasks', '0', v_n::text));
  select count(*) into v_n from public.care_tasks where patient_id = v_p1;
  v_res := v_res || jsonb_build_array(jsonb_build_array('control: staff still read care_tasks directly', 'true', (v_n > 0)::text));
  execute 'reset role';

  -- 4. anon
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  execute 'set local role anon';
  v_failed := false; v_sqlstate := null;
  begin
    perform 1 from public.patient_tasks limit 1;
  exception when others then v_failed := true; get stacked diagnostics v_sqlstate = returned_sqlstate; end;
  execute 'reset role';
  v_res := v_res || jsonb_build_array(jsonb_build_array('anon cannot read patient_tasks', 'true:42501', v_failed::text || ':' || coalesce(v_sqlstate, 'none')));
  v_res := v_res || jsonb_build_array(jsonb_build_array('authenticated has no write privilege on the view', 'false',
    (has_table_privilege('authenticated', 'public.patient_tasks', 'INSERT')
     or has_table_privilege('authenticated', 'public.patient_tasks', 'UPDATE')
     or has_table_privilege('authenticated', 'public.patient_tasks', 'DELETE'))::text));
  select string_agg(l::text, ',' order by l::text) into v_unmapped
    from unnest(enum_range(null::public.care_task_status)) l
    where pg_get_viewdef('public.patient_tasks'::regclass) not like '%''' || l::text || '''%';
  v_res := v_res || jsonb_build_array(jsonb_build_array('only the three intended open statuses rely on the else branch', 'in_progress,not_started,scheduled', coalesce(v_unmapped, 'none')));

  -- results are written here, with the session role reset, because the role switched to authenticated or anon cannot write the temp table
  insert into results select p_phase, e->>0, e->>1, e->>2 from jsonb_array_elements(v_res) e;
end
$f$;

select pg_temp.run_checks('real');

-- Sabotage: the pre-S07 recurrence body (no kind in the INSERT).
create or replace function private.roll_recurring_care_task()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_next_due timestamptz; v_interval interval;
begin
  if new.recurrence is null then return new; end if;
  v_interval := case new.recurrence when 'daily' then interval '1 day' when 'weekly' then interval '1 week' when 'monthly' then interval '1 month' end;
  v_next_due := coalesce(new.due_at, now()) + v_interval;
  insert into public.care_tasks (organisation_id, patient_id, care_plan_id, goal_id, title, description,
    owner_role, owner_id, priority, due_at, recurrence, source)
  values (new.organisation_id, new.patient_id, new.care_plan_id, new.goal_id, new.title, new.description,
    new.owner_role, new.owner_id, new.priority, v_next_due, new.recurrence, new.source);
  return new;
end;
$$;
select pg_temp.run_checks('sabotaged');

do $$
declare v_bad integer; v_caught text;
begin
  select count(*) into v_bad from results where phase = 'real' and expected <> actual;
  if v_bad > 0 then
    raise exception 'S07 care_tasks proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => ' || actual, '; ') from results where phase = 'real' and expected <> actual);
  end if;
  select string_agg(check_name, '; ') into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught is null then
    raise exception 'VACUOUS TEST: the reverted recurrence function did not fail any check';
  end if;
  if v_caught <> 'the next occurrence keeps kind' then
    raise exception 'sabotage flipped an unexpected check set: %', v_caught;
  end if;
end $$;

select phase, check_name, expected, actual,
       case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;

rollback;
