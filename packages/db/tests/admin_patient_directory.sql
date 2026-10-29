-- Proof: public.admin_patient_directory and public.admin_patient_directory_export (migration *_admin_patient_directory.sql).
-- Builds on S36a (OQ-04, INV-10): a directory of activity facts, never contact or clinical data.
--
--   1. Admin sees a real patient with plan, masked phone, age band; the row has no email, date of birth or clinical key.
--   2. A test account is not listed (the list matches the dashboard "Total patients" tile).
--   3. Visits are runs of page views with no gap over 30 minutes; time spent is the sum of their spans.
--   4. Search matches name, not email or phone; wildcards are literal; an unknown segment or sort is refused (22023).
--   5. The members segment filters; the summary counts the searched set.
--   6. A view writes one audit row holding filters and counts, never the typed text.
--   7. Export: a short reason is refused and writes no audit row; a good one writes one row carrying the reason, before rows return.
--   8. A clinician, a patient and anon are refused on both functions.
--   9. Paid purchases only: a pending purchase is not counted next to the paid total.
--  10. A patient active only through the app heartbeat shows at least one active day.
--  11. Audit is not noisy: re-sorting, paging and an identical repeat add no row; a different filter adds one.
--  12. The export honours the sort (name asc and desc return opposite first rows).
--  13. SABOTAGE: reason check, test-account filter, health-kind collapse and audit de-duplication removed; each must flip a check.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;

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
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text, p_name text, p_phone text, p_test boolean) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'dir-' || p_label || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, city, is_test)
  values (v, p_org, p_role::public.user_role, p_name, p_phone, date '1985-03-09', 'Zzdircity', p_test)
  on conflict (id) do update set role = excluded.role, is_test = excluded.is_test, is_active = true, phone = excluded.phone,
    full_name = excluded.full_name, city = excluded.city, date_of_birth = excluded.date_of_birth;
  return v;
end $f$;
-- call the list as a user: returns jsonb, or {"err": sqlstate}
create function pg_temp.dir_as(p_uid uuid, p_search text, p_segment text default 'all', p_sort text default 'joined', p_offset integer default 0) returns jsonb language plpgsql as
$f$ declare r jsonb;
begin
  perform pg_temp.act(p_uid);
  begin r := public.admin_patient_directory(p_search, p_segment, p_sort, 'desc', 25, p_offset); exception when others then r := jsonb_build_object('err', sqlstate); end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.export_as(p_uid uuid, p_reason text, p_search text, p_sort text default 'joined', p_dir text default 'desc') returns jsonb language plpgsql as
$f$ declare r jsonb;
begin
  perform pg_temp.act(p_uid);
  begin r := public.admin_patient_directory_export(p_reason, p_search, 'all', p_sort, p_dir); exception when others then r := jsonb_build_object('err', sqlstate); end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.anon_dir() returns text language plpgsql as
$f$ declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
  begin perform public.admin_patient_directory(null); r := 'ok'; exception when others then r := sqlstate; end;
  reset role;
  return r;
end $f$;

do $$
declare v_org uuid; v_admin uuid; v_doc uuid; v_pat uuid; v_pat2 uuid; v_test uuid; v_beat uuid; v_prod uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin', 'Dir Admin', '+2348012110001', true);
  v_doc := pg_temp.mkuser(v_org, 'doc', 'clinician', 'Zzdirname Clinician', '+2348012110002', false);
  v_pat := pg_temp.mkuser(v_org, 'pat', 'patient', 'Zzdirname Member', '+2348012119876', false);
  v_pat2 := pg_temp.mkuser(v_org, 'pat2', 'patient', 'Zzdirname Free', '+2348012110004', false);
  v_test := pg_temp.mkuser(v_org, 'test', 'patient', 'Zzdirname Tester', '+2348012110005', true);
  v_beat := pg_temp.mkuser(v_org, 'beat', 'patient', 'Zzheart Phoneonly', '+2348012110006', false);
  update public.profiles set city = 'Zzotherplace', app_last_active_at = now() - interval '2 hours' where id = v_beat;
  perform pg_temp.setf('beat', v_beat);
  perform pg_temp.setf('org', v_org); perform pg_temp.setf('admin', v_admin); perform pg_temp.setf('doc', v_doc);
  perform pg_temp.setf('pat', v_pat); perform pg_temp.setf('pat2', v_pat2); perform pg_temp.setf('test', v_test);

  insert into public.patient_memberships (organisation_id, patient_id, source, state, starts_at, ends_at, tier)
  values (v_org, v_pat, 'purchase', 'active', now() - interval '10 days', now() + interval '355 days', 'plus');

  -- Two page views 10 minutes apart (one visit, 600 s), then one 2 hours later (a second visit, 0 s).
  insert into public.web_events (occurred_at, path, profile_id, session_id, device_type) values
    (now() - interval '5 hours',               '/patient/vitals',   v_pat, 's1', 'mobile'),
    (now() - interval '5 hours' + interval '10 minutes', '/patient/vitals?x=1', v_pat, 's1', 'mobile'),
    (now() - interval '3 hours',               '/patient/messages', v_pat, 's2', 'mobile');

  -- One paid and one unpaid purchase: only the paid one may be counted.
  select id into v_prod from public.service_products order by created_at limit 1;
  insert into public.service_purchases (organisation_id, patient_id, service_product_id, amount_kobo, currency, status, purchased_at)
  values (v_org, v_pat, v_prod, 500000, 'NGN', 'active', now() - interval '1 day'), (v_org, v_pat, v_prod, 300000, 'NGN', 'pending_payment', null);

  -- A logged symptom: it counts as an action, but the directory must never say WHICH health thing was logged.
  insert into public.symptoms (organisation_id, patient_id, symptom_type, description, severity, is_red_flag) values (v_org, v_pat, (enum_range(null::public.symptom_type))[1], 'proof fixture', 1, false);
end $$;

-- 1 / 2. the row, its shape, and the test account
do $$
declare r jsonb; v_row jsonb; v_keys text;
begin
  r := pg_temp.dir_as(pg_temp.f('admin'), 'Zzdirname');
  select x into v_row from jsonb_array_elements(r -> 'rows') x where x ->> 'patient_id' = pg_temp.f('pat')::text;
  insert into results values ('real', 'the member is listed', 'true', (v_row is not null)::text);
  insert into results values ('real', 'two real patients are listed, the test account is not', '2', (r -> 'summary' ->> 'total'));
  insert into results values ('real', 'the test account is absent', 'false',
    (exists (select 1 from jsonb_array_elements(r -> 'rows') x where x ->> 'patient_id' = pg_temp.f('test')::text))::text);
  insert into results values ('real', 'plan is plus', 'plus', v_row ->> 'plan');
  insert into results values ('real', 'phone is masked', '+234*******876', v_row ->> 'phone_masked');
  insert into results values ('real', 'age is a band', '40-49', v_row ->> 'age_band');
  select string_agg(k, ',') into v_keys from jsonb_object_keys(v_row) k where k ~* 'email|birth|dob|diagnos|condition|medication|note|phone$';
  insert into results values ('real', 'no email, birth date or clinical key in a row', null, v_keys);
  insert into results values ('real', 'free patient has plan free', 'free',
    (select x ->> 'plan' from jsonb_array_elements(r -> 'rows') x where x ->> 'patient_id' = pg_temp.f('pat2')::text));
  insert into results values ('real', 'a patient with no activity is never active', 'never',
    (select x ->> 'activity_status' from jsonb_array_elements(r -> 'rows') x where x ->> 'patient_id' = pg_temp.f('pat2')::text));
end $$;

-- 3. visits and time
do $$
declare v_row jsonb;
begin
  select x into v_row from jsonb_array_elements(pg_temp.dir_as(pg_temp.f('admin'), 'Zzdirname') -> 'rows') x where x ->> 'patient_id' = pg_temp.f('pat')::text;
  insert into results values ('real', 'two visits', '2', v_row ->> 'visits_total');
  insert into results values ('real', 'time is the 10 minute span', '600', v_row ->> 'time_spent_seconds');
  insert into results values ('real', 'main device is mobile', 'mobile', v_row ->> 'main_device');
  insert into results values ('real', 'top section is vitals (2 views)', 'vitals:2', (v_row -> 'top_sections' -> 0 ->> 'key') || ':' || (v_row -> 'top_sections' -> 0 ->> 'count'));
  insert into results values ('real', 'recent page views make the patient active', 'active', v_row ->> 'activity_status');
end $$;

-- 3b. health logging is collapsed to one generic kind
do $$
declare v_row jsonb;
begin
  select x into v_row from jsonb_array_elements(pg_temp.dir_as(pg_temp.f('admin'), 'Zzdirname') -> 'rows') x where x ->> 'patient_id' = pg_temp.f('pat')::text;
  insert into results values ('real', 'a logged symptom shows as health_log', 'health_log', v_row -> 'top_actions' -> 0 ->> 'key');
  insert into results values ('real', 'the symptom counts as an action', '1', v_row ->> 'actions_total');
  insert into results values ('real', 'no symptom, vitals or medication kind in the actions list', 'false',
    ((v_row -> 'top_actions')::text ~* 'symptom|vitals|medication')::text);
end $$;

-- 3c. paid purchases only
do $$
declare v_row jsonb;
begin
  select x into v_row from jsonb_array_elements(pg_temp.dir_as(pg_temp.f('admin'), 'Zzdirname') -> 'rows') x where x ->> 'patient_id' = pg_temp.f('pat')::text;
  insert into results values ('real', 'paid total counts the paid purchase only', '500000', v_row ->> 'paid_total_kobo');
  insert into results values ('real', 'purchase count counts the paid purchase only', '1', v_row ->> 'purchases_count');
end $$;

-- 3d. a heartbeat-only patient is active with at least one active day
do $$
declare v_row jsonb;
begin
  select x into v_row from jsonb_array_elements(pg_temp.dir_as(pg_temp.f('admin'), 'Zzheart') -> 'rows') x where x ->> 'patient_id' = pg_temp.f('beat')::text;
  insert into results values ('real', 'heartbeat-only patient is active', 'active', v_row ->> 'activity_status');
  insert into results values ('real', 'heartbeat-only patient has an active day', 'true', ((v_row ->> 'active_days_30d')::int >= 1)::text);
end $$;

-- 4. search rules and refusals
insert into results values ('real', 'search by city finds the two real patients', '2', (pg_temp.dir_as(pg_temp.f('admin'), 'Zzdircity') -> 'summary' ->> 'total'));
insert into results values ('real', 'a typed percent sign matches nothing', '0', (pg_temp.dir_as(pg_temp.f('admin'), '%%%') -> 'summary' ->> 'total'));
insert into results values ('real', 'email is not searchable', '0', (pg_temp.dir_as(pg_temp.f('admin'), 'dir-pat@example.invalid') -> 'summary' ->> 'total'));
insert into results values ('real', 'phone is not searchable', '0', (pg_temp.dir_as(pg_temp.f('admin'), '8012119876') -> 'summary' ->> 'total'));
insert into results values ('real', 'unknown segment refused', '22023', pg_temp.dir_as(pg_temp.f('admin'), 'Zzdirname', 'everyone') ->> 'err');
insert into results values ('real', 'unknown sort refused', '22023', pg_temp.dir_as(pg_temp.f('admin'), 'Zzdirname', 'all', 'email; drop table x') ->> 'err');

-- 5. segments
insert into results values ('real', 'members segment holds the member only', '1', (pg_temp.dir_as(pg_temp.f('admin'), 'Zzdirname', 'members') ->> 'matching'));
insert into results values ('real', 'free segment holds the free patient only', '1', (pg_temp.dir_as(pg_temp.f('admin'), 'Zzdirname', 'free') ->> 'matching'));
insert into results values ('real', 'the summary still counts the whole searched set', '2', (pg_temp.dir_as(pg_temp.f('admin'), 'Zzdirname', 'members') -> 'summary' ->> 'total'));

-- 6. audit of a view: filters and counts only, once per distinct first-page view
do $$
declare v_before integer; v_txt text;
begin
  select count(*) into v_before from public.audit_log where actor_id = pg_temp.f('admin') and action = 'admin.patient_directory_viewed';
  perform pg_temp.dir_as(pg_temp.f('admin'), 'Zzdirname', 'dormant');
  insert into results values ('real', 'a new view writes one audit row', '1',
    ((select count(*) from public.audit_log where actor_id = pg_temp.f('admin') and action = 'admin.patient_directory_viewed') - v_before)::text);
  perform pg_temp.dir_as(pg_temp.f('admin'), 'Zzdirname', 'dormant', 'time_spent');
  insert into results values ('real', 're-sorting the same view adds no audit row', '1',
    ((select count(*) from public.audit_log where actor_id = pg_temp.f('admin') and action = 'admin.patient_directory_viewed') - v_before)::text);
  perform pg_temp.dir_as(pg_temp.f('admin'), 'Zzdirname', 'dormant', 'joined', 25);
  insert into results values ('real', 'paging past the first page adds no audit row', '1',
    ((select count(*) from public.audit_log where actor_id = pg_temp.f('admin') and action = 'admin.patient_directory_viewed') - v_before)::text);
  perform pg_temp.dir_as(pg_temp.f('admin'), 'Zzdirname', 'never');
  insert into results values ('real', 'a different filter adds a new audit row', '2',
    ((select count(*) from public.audit_log where actor_id = pg_temp.f('admin') and action = 'admin.patient_directory_viewed') - v_before)::text);
  select string_agg(event::text, ' ') into v_txt from public.audit_log where actor_id = pg_temp.f('admin') and action = 'admin.patient_directory_viewed';
  insert into results values ('real', 'no audit row ever holds the typed text', 'false', (coalesce(v_txt, '') ilike '%zzdirname%')::text);
  insert into results values ('real', 'the audit row holds the segment and count', 'true',
    (exists (select 1 from public.audit_log where actor_id = pg_temp.f('admin') and action = 'admin.patient_directory_viewed'
        and event ->> 'segment' = 'dormant' and event ->> 'matching' is not null))::text);
end $$;

-- 7. export
do $$
declare v_before integer; v_after integer; r jsonb; v_reason text; v_n integer;
begin
  select count(*) into v_before from public.audit_log where action = 'admin.patient_directory_exported' and actor_id = pg_temp.f('admin');
  r := pg_temp.export_as(pg_temp.f('admin'), 'too short', 'Zzdirname');
  select count(*) into v_after from public.audit_log where action = 'admin.patient_directory_exported' and actor_id = pg_temp.f('admin');
  insert into results values ('real', 'a short reason is refused', '22023', coalesce(r ->> 'err', 'accepted'));
  insert into results values ('real', 'a refused export writes no audit row', '0', (v_after - v_before)::text);

  r := pg_temp.export_as(pg_temp.f('admin'), 'Monthly engagement review with operations', 'Zzdirname');
  insert into results values ('real', 'a good export returns the two real patients', '2', jsonb_array_length(r -> 'rows')::text);
  select count(*), max(reason) into v_n, v_reason from public.audit_log where action = 'admin.patient_directory_exported' and actor_id = pg_temp.f('admin');
  insert into results values ('real', 'exactly one export audit row', '1', v_n::text);
  insert into results values ('real', 'the audit row carries the reason', 'Monthly engagement review with operations', v_reason);
end $$;

-- 7b. the export follows the sort
do $$
declare v_asc text; v_desc text;
begin
  v_asc := pg_temp.export_as(pg_temp.f('admin'), 'Checking export order please', 'Zzdirname', 'name', 'asc') -> 'rows' -> 0 ->> 'patient_id';
  v_desc := pg_temp.export_as(pg_temp.f('admin'), 'Checking export order please', 'Zzdirname', 'name', 'desc') -> 'rows' -> 0 ->> 'patient_id';
  insert into results values ('real', 'export by name ascending starts with Free', pg_temp.f('pat2')::text, v_asc);
  insert into results values ('real', 'export by name descending starts with Member', pg_temp.f('pat')::text, v_desc);
  insert into results values ('real', 'an unknown export sort is refused', '22023', pg_temp.export_as(pg_temp.f('admin'), 'Checking export order please', 'Zzdirname', 'email') ->> 'err');
end $$;

-- 8. everyone else refused
insert into results values ('real', 'a clinician cannot list', '42501', pg_temp.dir_as(pg_temp.f('doc'), 'Zzdirname') ->> 'err');
insert into results values ('real', 'a patient cannot list', '42501', pg_temp.dir_as(pg_temp.f('pat2'), 'Zzdirname') ->> 'err');
insert into results values ('real', 'anon cannot list', '42501', pg_temp.anon_dir());
insert into results values ('real', 'a clinician cannot export', '42501', pg_temp.export_as(pg_temp.f('doc'), 'A long enough reason here', 'Zzdirname') ->> 'err');
insert into results values ('real', 'a patient cannot export', '42501', pg_temp.export_as(pg_temp.f('pat2'), 'A long enough reason here', 'Zzdirname') ->> 'err');
insert into results values ('real', 'the row function is not callable by a signed-in user', 'false',
  has_function_privilege('authenticated', 'private.admin_patient_directory_rows(text)', 'EXECUTE')::text);

-- 9. sabotage
do $$
declare v_orig text; v_def text; r jsonb; v_n1 integer; v_n2 integer;
begin
  v_orig := pg_get_functiondef('public.admin_patient_directory_export(text,text,text,text,text)'::regprocedure);
  v_def := replace(v_orig, 'char_length(v_reason) < 10 or', 'false and');
  if v_def = v_orig then raise exception 'SABOTAGE 1 not applied'; end if;
  execute v_def;
  r := pg_temp.export_as(pg_temp.f('admin'), 'short', 'Zzdirname');
  insert into results values ('sabotaged', 'a short reason is refused', '22023', coalesce(r ->> 'err', 'accepted'));
  execute v_orig;

  v_orig := pg_get_functiondef('private.admin_patient_directory_rows(text)'::regprocedure);
  v_def := replace(v_orig, 'and not coalesce(p.is_test, false)', 'and true');
  if v_def = v_orig then raise exception 'SABOTAGE 2 not applied'; end if;
  execute v_def;
  insert into results values ('sabotaged', 'the test account is absent', '2', (pg_temp.dir_as(pg_temp.f('admin'), 'Zzdirname') -> 'summary' ->> 'total'));
  execute v_orig;

  v_orig := pg_get_functiondef('private.admin_patient_directory_rows(text)'::regprocedure);
  v_def := replace(v_orig, 'case when e.channel in (''vitals'', ''symptom'', ''medication_adherence'') then ''health_log'' else e.channel end', 'e.channel');
  if v_def = v_orig then raise exception 'SABOTAGE 3 not applied'; end if;
  execute v_def;
  select x into r from jsonb_array_elements(pg_temp.dir_as(pg_temp.f('admin'), 'Zzdirname') -> 'rows') x where x ->> 'patient_id' = pg_temp.f('pat')::text;
  insert into results values ('sabotaged', 'a logged symptom shows as health_log', 'health_log', r -> 'top_actions' -> 0 ->> 'key');
  execute v_orig;

  v_orig := pg_get_functiondef('public.admin_patient_directory(text,text,text,text,integer,integer)'::regprocedure);
  v_def := replace(v_orig, 'if v_offset = 0 and not exists (', 'if true or not exists (');
  if v_def = v_orig then raise exception 'SABOTAGE 4 not applied'; end if;
  execute v_def;
  perform pg_temp.dir_as(pg_temp.f('admin'), 'Zzdirname', 'free');
  select count(*) into v_n1 from public.audit_log where actor_id = pg_temp.f('admin') and action = 'admin.patient_directory_viewed';
  perform pg_temp.dir_as(pg_temp.f('admin'), 'Zzdirname', 'free', 'time_spent');
  select count(*) into v_n2 from public.audit_log where actor_id = pg_temp.f('admin') and action = 'admin.patient_directory_viewed';
  insert into results values ('sabotaged', 're-sorting adds no audit row', '0', (v_n2 - v_n1)::text);
  execute v_orig;
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'admin_patient_directory proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || coalesce(expected, 'null') || ' got ' || coalesce(actual, 'null'), '; ')
         from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 4 then
    raise exception 'VACUOUS TEST: the sabotage flipped % of 4 checks (%)', v_caught,
      (select string_agg(check_name || ' => ' || actual, '; ') from results where phase = 'sabotaged');
  end if;
end $$;

select phase, check_name, expected, actual, case when expected is not distinct from actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;

rollback;
