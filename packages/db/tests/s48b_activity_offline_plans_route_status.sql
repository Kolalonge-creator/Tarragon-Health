-- S48b proof: offline activity idempotency, workout-plan shape rules, route-recording status (migration *_s48b_activity_offline_plans_route_status.sql).
--   a. activity_log_entries.client_id: a retried offline send is a duplicate; a null client id never collides; another person's same id is fine.
--   b. workout_plans: sessions must be 10 to 20 minutes with minutes present; a chair-based class must be gentle; an audio clip id needs a clinician review.
--   c. public.route_recording_status(): false by default; false with the guard on but the switch off; true only with both; never for anon; per person.
-- One rolled-back transaction. is_test data only. SABOTAGE section at the end: the minutes CHECK, the client_id index and the status function are each
-- broken once; the matching checks must flip (otherwise the test is vacuous).
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;

create function pg_temp.f(p text) returns uuid language sql as $$ select v from fx where k = p $$;
create function pg_temp.setf(p text, p_v uuid) returns void language sql as
$$ insert into fx values (p, p_v) on conflict (k) do update set v = excluded.v $$;
create function pg_temp.ck(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('real', p_name, p_expected, p_actual) $$;
create function pg_temp.act(p_uid uuid) returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
end $f$;
create function pg_temp.back() returns void language plpgsql as
$f$ begin reset role; perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.sub', '', true); perform set_config('request.jwt.claim.role', '', true); end $f$;
create function pg_temp.q_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin
    if p_sql ~* '^\s*select' then execute p_sql into r; else execute p_sql; r := null; end if;
  exception when others then r := 'ERR:' || sqlerrm; end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.q_anon(p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  perform set_config('request.jwt.claim.sub', '', true);
  set local role anon;
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlstate; end;
  reset role;
  return r;
end $f$;
-- run a statement as the owner of the transaction; 'ok' or 'ERR:<sqlstate>'
create function pg_temp.try(p_sql text) returns text language plpgsql as
$f$ begin execute p_sql; return 'ok'; exception when others then return 'ERR:' || sqlstate; end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's48b-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'S48b ' || p_label || ' Person', '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true)
  on conflict (id) do update set role = excluded.role, full_name = excluded.full_name, is_test = true, is_active = true, phone = excluded.phone;
  return v;
end $f$;

-- Fixtures -----------------------------------------------------------------------------------------------------------------------
do $$
declare v_org uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  perform pg_temp.setf('org', v_org);
  perform pg_temp.setf('p', pg_temp.mkuser(v_org, 'patient', 'patient'));
  perform pg_temp.setf('q', pg_temp.mkuser(v_org, 'other', 'patient'));
  perform pg_temp.setf('cid', gen_random_uuid());
exception when others then
  raise exception 'fixture failed: %', sqlerrm;
end $$;

-- a. client_id ---------------------------------------------------------------------------------------------------------------------
do $$
declare v_org uuid := pg_temp.f('org'); v_p uuid := pg_temp.f('p'); v_q uuid := pg_temp.f('q'); v_cid uuid := pg_temp.f('cid'); v_sql text;
begin
  v_sql := format('insert into public.activity_log_entries (organisation_id, patient_id, entry_type, activity_kind, duration_minutes, client_id) values (%L, %L, ''workout'', ''walking'', 30, %L)', v_org, v_p, v_cid);
  perform pg_temp.ck('first send with a client id is stored', 'ok', pg_temp.try(v_sql));
  perform pg_temp.ck('the same client id again is a duplicate (23505)', 'ERR:23505', pg_temp.try(v_sql));
  perform pg_temp.ck('another person may use the same client id', 'ok',
    pg_temp.try(format('insert into public.activity_log_entries (organisation_id, patient_id, entry_type, activity_kind, duration_minutes, client_id) values (%L, %L, ''workout'', ''walking'', 30, %L)', v_org, v_q, v_cid)));
  perform pg_temp.ck('rows without a client id never collide', 'ok',
    pg_temp.try(format('insert into public.activity_log_entries (organisation_id, patient_id, entry_type, activity_kind, duration_minutes) values (%L, %L, ''workout'', ''walking'', 20), (%L, %L, ''workout'', ''walking'', 20)', v_org, v_p, v_org, v_p)));
  perform pg_temp.ck('exactly one stored row for the retried send', '1',
    (select count(*)::text from public.activity_log_entries where patient_id = v_p and client_id = v_cid));
end $$;

-- b. workout plan shape ----------------------------------------------------------------------------------------------------------------
create function pg_temp.plan_sql(p_code text, p_level text, p_format text, p_sessions text, p_audio text default '{}') returns text language sql as
$$ select format('insert into public.workout_plans (code, title, level, format, sessions, audio_clip_ids) values (%L, ''S48b test'', %L, %L, %L::jsonb, %L::text[])', p_code, p_level, p_format, p_sessions, p_audio) $$;
do $$
begin
  perform pg_temp.ck('a 10 minute session is accepted', 'ok', pg_temp.try(pg_temp.plan_sql('s48b_ten', 'gentle', 'home', '[{"minutes":10,"steps":["a"]}]')));
  perform pg_temp.ck('a 20 minute session is accepted', 'ok', pg_temp.try(pg_temp.plan_sql('s48b_twenty', 'moderate', 'home', '[{"minutes":20,"steps":["a"]}]')));
  perform pg_temp.ck('a 9 minute session is refused', 'ERR:23514', pg_temp.try(pg_temp.plan_sql('s48b_nine', 'gentle', 'home', '[{"minutes":9,"steps":["a"]}]')));
  perform pg_temp.ck('a 21 minute session is refused', 'ERR:23514', pg_temp.try(pg_temp.plan_sql('s48b_tw1', 'gentle', 'home', '[{"minutes":21,"steps":["a"]}]')));
  perform pg_temp.ck('one good and one long session in a plan is refused', 'ERR:23514', pg_temp.try(pg_temp.plan_sql('s48b_mix', 'gentle', 'home', '[{"minutes":15,"steps":["a"]},{"minutes":45,"steps":["b"]}]')));
  perform pg_temp.ck('a session with no minutes is refused', 'ERR:23514', pg_temp.try(pg_temp.plan_sql('s48b_nomin', 'gentle', 'home', '[{"steps":["a"]}]')));
  perform pg_temp.ck('a chair-based class at gentle level is accepted', 'ok', pg_temp.try(pg_temp.plan_sql('s48b_chair', 'gentle', 'chair_class', '[{"minutes":15,"steps":["a"]}]')));
  perform pg_temp.ck('a chair-based class above gentle is refused', 'ERR:23514', pg_temp.try(pg_temp.plan_sql('s48b_chair_mod', 'moderate', 'chair_class', '[{"minutes":15,"steps":["a"]}]')));
  perform pg_temp.ck('an audio clip id on an unreviewed plan is refused', 'ERR:23514', pg_temp.try(pg_temp.plan_sql('s48b_audio', 'gentle', 'home', '[{"minutes":15,"steps":["a"]}]', '{WKO-001}')));
  perform pg_temp.ck('the three starter plans are still there, unreviewed, inactive, without audio', '3',
    (select count(*)::text from public.workout_plans where code like 'starter\_%' and not clinician_reviewed and not is_active and audio_clip_ids = '{}'));
end $$;

-- c. route status ---------------------------------------------------------------------------------------------------------------------
do $$
declare v_org uuid := pg_temp.f('org'); v_p uuid := pg_temp.f('p'); v_q uuid := pg_temp.f('q');
begin
  perform pg_temp.ck('born off: the guard is off and the switch is off', 'false', pg_temp.q_as(v_p, 'select public.route_recording_status()::text'));
  perform pg_temp.ck('anon cannot ask', 'true', (pg_temp.q_anon('select public.route_recording_status()::text') like 'ERR:%')::text);
  insert into public.patient_activity_goals (organisation_id, patient_id) values (v_org, v_p), (v_org, v_q);
end $$;
-- the guard table has its own guard trigger; disabled for this test transaction only (rolled back)
alter table public.go_live_guards disable trigger go_live_guards_guard;
update public.go_live_guards set is_on = true, changed_at = now(), changed_by = pg_temp.f('p'), change_note = 'S48b proof: rolled back' where key = 'private_route_recording';
alter table public.go_live_guards enable trigger go_live_guards_guard;
do $$
declare v_p uuid := pg_temp.f('p'); v_q uuid := pg_temp.f('q');
begin
  perform pg_temp.ck('guard on but the person has not switched it on: false', 'false', pg_temp.q_as(v_p, 'select public.route_recording_status()::text'));
  update public.patient_activity_goals set route_recording_enabled = true where patient_id = v_p;
  perform pg_temp.ck('guard on and the person switched it on: true', 'true', pg_temp.q_as(v_p, 'select public.route_recording_status()::text'));
  perform pg_temp.ck('another person with the switch off still gets false', 'false', pg_temp.q_as(v_q, 'select public.route_recording_status()::text'));
  perform pg_temp.ck('anon still cannot ask with the guard on', 'true', (pg_temp.q_anon('select public.route_recording_status()::text') like 'ERR:%')::text);
end $$;

-- d. SABOTAGE ----------------------------------------------------------------------------------------------------------------------------
do $$
declare v_org uuid := pg_temp.f('org'); v_p uuid := pg_temp.f('p'); v_cid uuid := gen_random_uuid(); v_sql text;
begin
  -- (1) minutes CHECK removed: a 9 minute session gets in
  alter table public.workout_plans drop constraint workout_plans_session_minutes_chk;
  insert into results values ('sabotaged', 'SABOTAGE: without the CHECK a 9 minute session is stored', 'ERR:23514',
    pg_temp.try(pg_temp.plan_sql('s48b_nine_sab', 'gentle', 'home', '[{"minutes":9,"steps":["a"]}]')));
  -- (2) client_id index removed: a retried send becomes a second row
  drop index public.activity_log_entries_client_id_uidx;
  v_sql := format('insert into public.activity_log_entries (organisation_id, patient_id, entry_type, activity_kind, duration_minutes, client_id) values (%L, %L, ''workout'', ''running'', 5, %L)', v_org, v_p, v_cid);
  perform pg_temp.try(v_sql);
  insert into results values ('sabotaged', 'SABOTAGE: without the index a retry is stored twice', 'ERR:23505', pg_temp.try(v_sql));
  -- (3) a status function that always says yes
  create or replace function public.route_recording_status() returns boolean language sql stable as $g$ select true $g$;
  insert into results values ('sabotaged', 'SABOTAGE: a status that always says yes opens recording for the switched-off person', 'false',
    pg_temp.q_as(pg_temp.f('q'), 'select public.route_recording_status()::text'));
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S48b proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and check_name like 'SABOTAGE%' and expected <> actual;
  if v_caught < 3 then raise exception 'VACUOUS TEST: the sabotage flipped % of 3 checks', v_caught; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;

rollback;
