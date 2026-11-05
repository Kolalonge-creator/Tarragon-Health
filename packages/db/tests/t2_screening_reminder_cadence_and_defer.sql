-- Tarragon Health: screening reminders at 14, 7 and 1 day before due and 7 and 30 days overdue, read from a versioned setting; a test can
-- be moved with a recorded reason (20261104233439, founder decision T2-12).
--
--  1. exactly one active version (v2); history cannot be edited or deleted;
--  2. one night: due in 14 / 10 / 7 / 1 days, 7 and 30 days overdue each get exactly the step that fits now (never an old one),
--     due in 20 days gets nothing; only in-app, push and email are used;
--  3. the next run: only the 30-days-overdue schedule moves on (to escalated, the stage the coordinator sweep reads); a third run sends nothing;
--  4. a stage reached under the old code is never sent again;
--  5. defer: the patient moves a test with a reason; the sequence restarts; bad reason, missing note for 'other', a date too far, a
--     stranger and a fourth patient deferral are refused; a tied clinician may move it again;
--  6. privileges.
-- Sabotage (rolled-back sub-blocks): the window upper bound removed -> check 2 flips; the reason check removed -> check 5 flips.
--
-- Run: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/db/tests/t2_screening_reminder_cadence_and_defer.sql

begin;

create function pg_temp.as_user(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
  begin execute p_sql; r := 'ok'; exception when others then r := sqlstate || ':' || sqlerrm; end;
  reset role; perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.role', '', true);
  return r;
end $f$;

create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid language plpgsql as
$f$ declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 't2rc-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  update public.profiles set organisation_id = p_org, role = p_role::public.user_role, full_name = 'T2rc ' || p_label, is_test = true, is_active = true,
         date_of_birth = '1975-01-01', sex = 'female' where id = v;
  return v;
end $f$;

create temp table sch (k text primary key, id uuid) on commit drop;
create function pg_temp.s(p text) returns public.screening_schedules language sql as $$ select s.* from public.screening_schedules s join sch on sch.id = s.id where sch.k = p $$;

do $proof$
declare
  v_org uuid; v_pat uuid; v_stranger uuid; v_doc uuid; v_admin uuid;
  v_types uuid[];
  v_k text; i integer := 0;
  v_n integer; r text;
  v_offsets integer[] := array[14, 10, 7, 1, -7, -30, 20, -40];
  v_keys text[] := array['d14', 'd10', 'd7', 'd1', 'o7', 'o30', 'd20', 'legacy'];
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_pat := pg_temp.mkuser(v_org, 'pat', 'patient');
  v_stranger := pg_temp.mkuser(v_org, 'stranger', 'patient');
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  v_doc := pg_temp.mkuser(v_org, 'doc', 'clinician');
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, is_test)
  values (v_org, v_doc, 'T2rc Doctor', 'MDCN', 'T2RC-DOC-1', true, 'active', now(), v_admin, 'senior_medical_officer', 'employed', 2, true);
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id) values (v_org, v_pat, v_doc);

  -- 1. one active version, history fixed
  if (select version from public.screening_reminder_configs where is_active) <> 2 then raise exception 'FAIL 1: v2 is not the active version'; end if;
  begin
    update public.screening_reminder_configs set rules = '{"steps":[{}]}'::jsonb where version = 1;
    raise exception 'FAIL 1: a version was edited';
  exception when sqlstate '55000' then null; end;
  begin
    delete from public.screening_reminder_configs where version = 1;
    raise exception 'FAIL 1: a version was deleted';
  exception when sqlstate '55000' then null; end;

  -- eight schedules on eight different screen types (one open schedule per type)
  select array_agg(id order by code) into v_types from (select id, code from public.screen_types where is_active and not coalesce(sensitive, false) order by code limit 8) x;
  foreach v_k in array v_keys loop
    i := i + 1;
    insert into sch values (v_k, gen_random_uuid());
    insert into public.screening_schedules (id, organisation_id, patient_id, screen_type_id, status, due_date, reminder_stage)
    values ((select sch.id from sch where sch.k = v_k), v_org, v_pat, v_types[i],
            case when v_offsets[i] < 0 then 'overdue' else 'pending' end::public.screening_status,
            current_date + v_offsets[i], case when v_k = 'legacy' then 'escalated'::public.reminder_stage end);
  end loop;

  -- 2. one night
  perform private.queue_screening_reminders();
  if (pg_temp.s('d14')).reminder_stage is distinct from 'upcoming' or (pg_temp.s('d14')).reminder_last_offset is distinct from -14 then raise exception 'FAIL 2: due in 14 days'; end if;
  if (pg_temp.s('d10')).reminder_last_offset is distinct from -14 then raise exception 'FAIL 2: due in 10 days should get the 14-day step'; end if;
  if (pg_temp.s('d7')).reminder_last_offset is distinct from -7 or (pg_temp.s('d7')).reminder_stage <> 'upcoming' then raise exception 'FAIL 2: due in 7 days'; end if;
  if (pg_temp.s('d1')).reminder_last_offset is distinct from -1 or (pg_temp.s('d1')).reminder_stage <> 'due' then raise exception 'FAIL 2: due tomorrow'; end if;
  if (pg_temp.s('o7')).reminder_last_offset is distinct from 7 or (pg_temp.s('o7')).reminder_stage <> 'overdue' then raise exception 'FAIL 2: 7 days overdue got %', (pg_temp.s('o7')).reminder_stage; end if;
  if (pg_temp.s('o30')).reminder_last_offset is distinct from 7 then raise exception 'FAIL 2: 30 days overdue, never reminded, should first get the 7-day overdue step'; end if;
  if (pg_temp.s('d20')).reminder_stage is not null then raise exception 'FAIL 2: due in 20 days got a reminder'; end if;
  -- grouping (20261030110000) still applies: 6 schedules moved, in 4 stages; the patient's own channel plus the in-app copy (plus push)
  if exists (select 1 from public.notifications where recipient_id = v_pat and channel::text not in ('in_app', 'push', 'email')) then
    raise exception 'FAIL 2: a reminder used a channel other than in-app, push or email';
  end if;
  if not exists (select 1 from public.notifications where recipient_id = v_pat and template = 'screening_due' and channel = 'push') then
    raise exception 'FAIL 2: the due-tomorrow step did not push';
  end if;

  -- 3. next run: only o30 moves (to escalated); then nothing
  select count(*) into v_n from public.notifications where recipient_id = v_pat;
  perform private.queue_screening_reminders();
  if (pg_temp.s('o30')).reminder_stage <> 'escalated' or (pg_temp.s('o30')).reminder_last_offset <> 30 then raise exception 'FAIL 3: 30 days overdue did not escalate'; end if;
  if (pg_temp.s('d7')).reminder_last_offset <> -7 or (pg_temp.s('o7')).reminder_last_offset <> 7 then raise exception 'FAIL 3: a schedule moved twice'; end if;
  if (select rules -> 'coordinatorFollowUp' ->> 'afterStage' from public.screening_reminder_configs where is_active) <> (pg_temp.s('o30')).reminder_stage::text then
    raise exception 'FAIL 3: the last step does not reach the stage the coordinator sweep reads';
  end if;
  select count(*) - v_n into v_n from public.notifications where recipient_id = v_pat;
  if v_n < 1 then raise exception 'FAIL 3: the escalation sent nothing'; end if;
  select count(*) into v_n from public.notifications where recipient_id = v_pat;
  perform private.queue_screening_reminders();
  if (select count(*) from public.notifications where recipient_id = v_pat) <> v_n then raise exception 'FAIL 3: a third run sent more reminders'; end if;

  -- 4. a stage from the old code is not sent again
  if (pg_temp.s('legacy')).reminder_last_offset is not null then raise exception 'FAIL 4: an escalated schedule from the old code was reminded again'; end if;

  -- 5. defer
  r := pg_temp.as_user(v_pat, format('select public.defer_screening(%L, current_date + 20, %L, null)', (pg_temp.s('o30')).id, 'travelling'));
  if r <> 'ok' then raise exception 'FAIL 5: the patient could not move the test: %', r; end if;
  if (pg_temp.s('o30')).due_date <> current_date + 20 or (pg_temp.s('o30')).reminder_stage is not null or (pg_temp.s('o30')).reminder_last_offset is not null
     or (pg_temp.s('o30')).original_due_date <> current_date - 30 or (pg_temp.s('o30')).defer_count <> 1 or (pg_temp.s('o30')).status <> 'pending'
     or (pg_temp.s('o30')).deferred_reason_code <> 'travelling' or (pg_temp.s('o30')).deferred_by <> v_pat then
    raise exception 'FAIL 5: the move was not recorded correctly';
  end if;
  if not exists (select 1 from public.audit_log where entity_id = (pg_temp.s('o30')).id and action = 'screening.deferred') then
    raise exception 'FAIL 5: no audit row for the move';
  end if;
  perform private.queue_screening_reminders();
  if (pg_temp.s('o30')).reminder_stage is not null then raise exception 'FAIL 5: a moved test was reminded before its new window'; end if;
  r := pg_temp.as_user(v_pat, format('select public.defer_screening(%L, current_date + 30, %L, null)', (pg_temp.s('d20')).id, 'because'));
  if r not like '22023:reason_required%' then raise exception 'FAIL 5: an unknown reason was accepted: %', r; end if;
  r := pg_temp.as_user(v_pat, format('select public.defer_screening(%L, current_date + 30, %L, null)', (pg_temp.s('d20')).id, 'other'));
  if r not like '22023:note_required%' then raise exception 'FAIL 5: other without a note was accepted: %', r; end if;
  r := pg_temp.as_user(v_pat, format('select public.defer_screening(%L, current_date + 400, %L, null)', (pg_temp.s('d20')).id, 'cost'));
  if r not like '22023:new_date_out_of_range%' then raise exception 'FAIL 5: a date too far ahead was accepted: %', r; end if;
  r := pg_temp.as_user(v_stranger, format('select public.defer_screening(%L, current_date + 30, %L, null)', (pg_temp.s('d20')).id, 'cost'));
  if r not like '42501:%' then raise exception 'FAIL 5: a stranger moved someone else''s test: %', r; end if;
  for i in 2..3 loop
    r := pg_temp.as_user(v_pat, format('select public.defer_screening(%L, current_date + %s, %L, null)', (pg_temp.s('o30')).id, 20 + i * 10, 'unwell'));
    if r <> 'ok' then raise exception 'FAIL 5: deferral % refused: %', i, r; end if;
  end loop;
  r := pg_temp.as_user(v_pat, format('select public.defer_screening(%L, current_date + 90, %L, null)', (pg_temp.s('o30')).id, 'unwell'));
  if r not like 'P0001:defer_limit_reached%' then raise exception 'FAIL 5: a fourth patient deferral was accepted: %', r; end if;
  r := pg_temp.as_user(v_doc, format('select public.defer_screening(%L, current_date + 90, %L, %L)', (pg_temp.s('o30')).id, 'waiting_for_doctor_advice', 'Repeat after the medicine change.'));
  if r <> 'ok' then raise exception 'FAIL 5: a tied clinician could not move it: %', r; end if;

  -- 6. privileges
  if has_function_privilege('anon', 'public.defer_screening(uuid,date,text,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.queue_screening_reminders()', 'EXECUTE') then
    raise exception 'FAIL 6: a reminder function is callable by the wrong role';
  end if;
  r := pg_temp.as_user(v_pat, 'select public.activate_screening_reminder_config(1, ''a patient trying to change the timing'')');
  if r not like '42501:%' then raise exception 'FAIL 6: a patient switched the reminder timing: %', r; end if;
  r := pg_temp.as_user(v_admin, 'select public.activate_screening_reminder_config(1, ''proof: back to the old timing, rolled back'')');
  if r <> 'ok' or (select version from public.screening_reminder_configs where is_active) <> 1 then raise exception 'FAIL 6: an admin could not switch the version: %', r; end if;
  r := pg_temp.as_user(v_admin, 'select public.activate_screening_reminder_config(2, ''proof: back to the founder timing, rolled back'')');

  -- SABOTAGE A: no upper bound on a step's window -> a 7-days-overdue schedule gets the 14-day "coming up" step
  begin
    execute replace(pg_get_functiondef('private.queue_screening_reminders()'::regprocedure),
                    'and (st.until_d is null or current_date < op.due_date + st.until_d)', '');
    update public.screening_schedules set reminder_stage = null, reminder_last_offset = null where id = (pg_temp.s('o7')).id;
    perform private.queue_screening_reminders();
    if (pg_temp.s('o7')).reminder_last_offset is not distinct from 7 then raise exception 'VACUOUS A: the window bound is not tested'; end if;
    raise exception 'sabotage_rollback';
  exception when raise_exception then if sqlerrm <> 'sabotage_rollback' then raise; end if;
  end;

  -- SABOTAGE B: no reason check -> an unknown reason is accepted
  begin
    execute replace(pg_get_functiondef('public.defer_screening(uuid,date,text,text)'::regprocedure),
                    'if p_reason_code is null or not ((v_cfg -> ''reasonCodes'') ? p_reason_code) then raise exception ''reason_required'' using errcode = ''22023''; end if;', '');
    r := pg_temp.as_user(v_pat, format('select public.defer_screening(%L, current_date + 30, %L, null)', (pg_temp.s('d20')).id, 'because'));
    if r like '22023:reason_required%' then raise exception 'VACUOUS B: the reason check is not tested'; end if;
    raise exception 'sabotage_rollback';
  exception when raise_exception then if sqlerrm <> 'sabotage_rollback' then raise; end if;
  end;

  r := pg_temp.as_user(v_pat, format('select public.defer_screening(%L, current_date + 30, %L, null)', (pg_temp.s('d20')).id, 'because'));
  if r not like '22023:reason_required%' then raise exception 'FAIL: the reason check was not restored after sabotage'; end if;
  raise notice 't2_screening_reminder_cadence_and_defer: PASS';
end $proof$;

rollback;
