-- S36e proof: public.reliability_dashboard(p_gap_days, p_min_group), the reliability and SLA dashboard (spec 9.5 and 9.4).
--   1. Who may read: the CMO (viewer 'lead'), an ops holder and an admin (viewer 'ops'); a plain clinician, a patient and anon are refused.
--   2. Ops sees aggregates only: no individuals list, no on-call names, no clinician name anywhere in the answer.
--   3. The CMO sees every active non-test clinician by name, ordered by name, with their own score.
--   4. Tasks waiting by class with the oldest wait and the past-due count; is_test tasks do not count (INV-13).
--   5. Red pages: total, acknowledged, acknowledged within the first escalation window, still unacknowledged; is_test pages do not count;
--      an unacknowledged row carries no patient and no clinician.
--   6. Cover: no rota means not covered and uncovered gaps in the next days; a rota covering now with a backup means covered.
--   7. Hand-back counts by kind; is_test events do not count.
--   8. Score distribution is withheld from ops for a small group and given to the CMO.
--   9. Bad arguments are refused (22023).
--   SABOTAGE A: the lead test forced true; ops must then see individuals (flips the ops-aggregate-only check).
--   SABOTAGE B: the is_test filters removed; the test task and test page must then be counted (flips the exclusion checks).
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;
create temp table snap(k text primary key, j jsonb) on commit drop;
grant all on snap to public;
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
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's36e-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test, language)
  values (v, p_org, p_role::public.user_role, 'S36e ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true, 'en')
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone;
  return v;
end $f$;
-- a clinician; p_real = true makes the staff row a real (non-test) one so the dashboard counts it
create function pg_temp.mkdoc(p_org uuid, p_admin uuid, p_label text, p_tier text, p_real boolean) returns uuid
language plpgsql as $f$
declare v uuid := pg_temp.mkuser(p_org, p_label, 'clinician'); v_staff uuid;
begin
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
  values (p_org, v, 'S36e ' || p_label, 'MDCN', 'S36E-' || p_label || '-' || substr(v::text, 1, 8), true, 'active', now(), p_admin,
      p_tier::public.doctor_tier, case when p_tier = 'chief_medical_officer' then 'contracted' else 'employed' end::public.staff_employment_type, 2,
      p_tier = 'chief_medical_officer', case when p_tier = 'chief_medical_officer' then p_admin end, not p_real)
  returning id into v_staff;
  insert into public.clinician_competencies (organisation_id, clinical_staff_id, competency_code, granted_by, is_test) values (p_org, v_staff, 'on_call', p_admin, true);
  insert into public.on_call_readiness (clinician_id, checklist_version, organisation_id, items, is_test) values (v, private.readiness_version(), p_org, private.readiness_items(), true);
  return v;
end $f$;
create function pg_temp.dash_as(p_uid uuid, p_gap integer, p_min integer) returns jsonb language plpgsql as $f$
declare r jsonb;
begin
  perform pg_temp.act(p_uid);
  begin r := public.reliability_dashboard(p_gap, p_min); exception when others then perform pg_temp.back(); return jsonb_build_object('err', sqlstate); end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.waiting(j jsonb, p_class integer) returns integer language sql as
$$ select coalesce((select (x ->> 'waiting')::integer from jsonb_array_elements(j -> 'tasks' -> 'waiting') x where (x ->> 'priority_class')::integer = p_class), 0) $$;
create function pg_temp.mktask(p_org uuid, p_patient uuid, p_class integer, p_age_min integer, p_due_in_min integer, p_test boolean) returns uuid language plpgsql as $f$
declare v uuid;
begin
  perform set_config('tarragon.task_transition', 'on', true);
  insert into public.clinical_tasks (organisation_id, type, task_type_version, priority_class, priority_class_original, patient_id, min_tier, due_at, state, is_test, created_at)
  select p_org, tt.code, tt.version, p_class, p_class, p_patient, tt.min_doctor_tier, now() + make_interval(mins => p_due_in_min), 'open', p_test, now() - make_interval(mins => p_age_min)
    from public.task_types tt where tt.is_active order by tt.code limit 1 returning id into v;
  perform set_config('tarragon.task_transition', 'off', true);
  return v;
end $f$;
create function pg_temp.red(p_patient uuid, p_set uuid) returns uuid language plpgsql as
$f$ declare v_id uuid; v_rs record;
begin
  select code, version, status into v_rs from public.triage_rule_sets where id = p_set;
  insert into public.triage_events (organisation_id, patient_id, trigger_type, trigger_id, grade, rule_id, rule_set_id, rule_set_code,
      rule_set_version, rule_set_status, actions, shadow, is_test, basis)
  select pr.organisation_id, p_patient, 'observation', gen_random_uuid(), 'red', 'R1', p_set, v_rs.code, v_rs.version, v_rs.status,
         '[{"kind":"page_on_call"}]'::jsonb, true, true, gen_random_uuid()::text
    from public.profiles pr where pr.id = p_patient returning id into v_id;
  return v_id;
end $f$;
create function pg_temp.mkpage(p_org uuid, p_patient uuid, p_event uuid, p_clin uuid, p_sent_min_ago integer, p_ack_after_min integer, p_test boolean) returns uuid language plpgsql as $f$
declare v uuid;
begin
  perform set_config('tarragon.paging_write', 'on', true);
  insert into public.pages (organisation_id, patient_id, triage_event_id, role, to_clinician_id, escalation_level, config_version, sent_at, acknowledged_at, acknowledged_by, is_test)
  values (p_org, p_patient, p_event, 'primary', p_clin, 0, 1, now() - make_interval(mins => p_sent_min_ago),
          case when p_ack_after_min is not null then now() - make_interval(mins => p_sent_min_ago) + make_interval(mins => p_ack_after_min) end,
          case when p_ack_after_min is not null then p_clin end, p_test) returning id into v;
  perform set_config('tarragon.paging_write', 'off', true);
  return v;
end $f$;
create function pg_temp.ev(p_org uuid, p_clin uuid, p_kind text, p_test boolean) returns void language sql as
$$ insert into public.clinician_reliability_events (organisation_id, clinician_id, kind, good, weight, config_version, is_test) values (p_org, p_clin, p_kind, 1, 1, 1, p_test) $$;
create function pg_temp.rec(p_phase text, p_name text, p_exp text, p_act text) returns void language sql as
$$ insert into results values (p_phase, p_name, p_exp, p_act) $$;

do $$
declare
  v_org uuid; v_admin uuid; v_ops uuid; v_cmo uuid; v_a uuid; v_b uuid; v_t uuid; v_doc uuid; v_pat uuid; v_pat2 uuid;
  v_set uuid; e1 uuid; e2 uuid; e3 uuid; e4 uuid; e5 uuid; j0 jsonb; j1 jsonb; jo jsonb; jc jsonb; v_n0 integer;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  select id into v_set from public.triage_rule_sets order by created_at limit 1;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  v_ops := pg_temp.mkuser(v_org, 'ops', 'finance');
  v_doc := pg_temp.mkuser(v_org, 'plain-doc', 'clinician');
  v_pat := pg_temp.mkuser(v_org, 'patient-1', 'patient');
  v_pat2 := pg_temp.mkuser(v_org, 'patient-2', 'patient');
  insert into public.user_permission_grants (profile_id, permission_key, granted_by) values (v_ops, 'ops.console.view', v_admin);
  v_cmo := pg_temp.mkdoc(v_org, v_admin, 'cmo', 'chief_medical_officer', false);
  v_a := pg_temp.mkdoc(v_org, v_admin, 'clin-b-bravo', 'senior_medical_officer', true);
  v_b := pg_temp.mkdoc(v_org, v_admin, 'clin-a-alpha', 'senior_medical_officer', true);
  v_t := pg_temp.mkdoc(v_org, v_admin, 'clin-test', 'senior_medical_officer', false);
  update public.clinical_staff set reliability_score = 80 where profile_id = v_a;
  update public.clinical_staff set reliability_score = 95 where profile_id = v_b;
  update public.clinical_staff set reliability_score = 10 where profile_id = v_t;
  perform pg_temp.setf('ops', v_ops); perform pg_temp.setf('admin', v_admin); perform pg_temp.setf('cmo', v_cmo); perform pg_temp.setf('doc', v_doc);
  perform pg_temp.setf('pat', v_pat); perform pg_temp.setf('a', v_a); perform pg_temp.setf('b', v_b);

  -- baseline (the shared database may hold other rows, so every count below is a difference)
  j0 := pg_temp.dash_as(v_cmo, 7, 1);
  insert into snap values ('base', j0);

  -- 1. who may read
  perform pg_temp.rec('real', 'CMO reads as lead', 'lead', j0 ->> 'viewer');
  jo := pg_temp.dash_as(v_ops, 7, 1);
  perform pg_temp.rec('real', 'ops reads as ops', 'ops', jo ->> 'viewer');
  perform pg_temp.rec('real', 'admin reads as ops (aggregate)', 'ops', pg_temp.dash_as(v_admin, 7, 1) ->> 'viewer');
  perform pg_temp.rec('real', 'a plain clinician is refused', '42501', pg_temp.dash_as(v_doc, 7, 1) ->> 'err');
  perform pg_temp.rec('real', 'a patient is refused', '42501', pg_temp.dash_as(v_pat, 7, 1) ->> 'err');
  perform pg_temp.rec('real', 'anon cannot execute', 'false', has_function_privilege('anon', 'public.reliability_dashboard(integer, integer)', 'EXECUTE')::text);
  -- 9. bad arguments
  perform pg_temp.rec('real', 'zero gap days refused', '22023', pg_temp.dash_as(v_cmo, 0, 1) ->> 'err');
  perform pg_temp.rec('real', 'null min group refused', '22023', pg_temp.dash_as(v_cmo, 7, null) ->> 'err');
  delete from public.user_permission_grants where profile_id = v_ops;
  perform pg_temp.rec('real', 'a revoked ops permission closes the read', '42501', pg_temp.dash_as(v_ops, 7, 1) ->> 'err');
  insert into public.user_permission_grants (profile_id, permission_key, granted_by) values (v_ops, 'ops.console.view', v_admin);

  -- 3. the lead's named list: both fixture clinicians, ordered by name (alpha before bravo, though bravo has the lower score), test clinician absent
  perform pg_temp.rec('real', 'lead list holds the real clinicians by name, never by score',
    'S36e clin-a-alpha>S36e clin-b-bravo', (select string_agg(x ->> 'name', '>' order by ord) from jsonb_array_elements(j0 -> 'individuals') with ordinality t(x, ord) where x ->> 'name' like 'S36e clin-%' and x ->> 'name' <> 'S36e clin-test'));
  perform pg_temp.rec('real', 'lead list leaves a test clinician out', '0', (select count(*)::text from jsonb_array_elements(j0 -> 'individuals') x where x ->> 'name' = 'S36e clin-test'));
  perform pg_temp.rec('real', 'lead sees a clinician own score', '95', (select (x ->> 'score')::numeric::integer::text from jsonb_array_elements(j0 -> 'individuals') x where x ->> 'name' = 'S36e clin-a-alpha'));

  -- 4. tasks: one real class 2 task 120 minutes old due 60 minutes ago, one test task of the same class, one real class 3 due later
  perform pg_temp.mktask(v_org, v_pat, 2, 120, -60, false);
  perform pg_temp.mktask(v_org, v_pat, 2, 500, -400, true);
  perform pg_temp.mktask(v_org, v_pat2, 3, 10, 50, false);
  j1 := pg_temp.dash_as(v_cmo, 7, 1);
  perform pg_temp.rec('real', 'a real class 2 task is counted', '1', (pg_temp.waiting(j1, 2) - pg_temp.waiting(j0, 2))::text);
  perform pg_temp.rec('real', 'a test task is not counted (class 2 grew by exactly one)', '1', (pg_temp.waiting(j1, 2) - pg_temp.waiting(j0, 2))::text);
  perform pg_temp.rec('real', 'the oldest class 2 wait is at least the 120 minute task', 'true',
    ((select (x ->> 'oldest_wait_minutes')::integer from jsonb_array_elements(j1 -> 'tasks' -> 'waiting') x where (x ->> 'priority_class')::integer = 2) >= 119)::text);
  perform pg_temp.rec('real', 'a task past its due time is counted past due', 'true',
    ((select (x ->> 'past_due')::integer from jsonb_array_elements(j1 -> 'tasks' -> 'waiting') x where (x ->> 'priority_class')::integer = 2) >= 1)::text);
  perform pg_temp.rec('real', 'a class 3 task not yet due is waiting but not past due', 'true',
    ((select (x ->> 'waiting')::integer - (x ->> 'past_due')::integer from jsonb_array_elements(j1 -> 'tasks' -> 'waiting') x where (x ->> 'priority_class')::integer = 3) >= 1)::text);

  -- 5. pages: acknowledged in 3 minutes (inside the 5 minute window), acknowledged in 8 (outside), one unacknowledged for 20 minutes, one test page
  e1 := pg_temp.red(v_pat, v_set); e2 := pg_temp.red(v_pat2, v_set); e3 := pg_temp.red(v_pat, v_set); e4 := pg_temp.red(v_pat2, v_set);
  perform pg_temp.mkpage(v_org, v_pat, e1, v_a, 60, 3, false);
  perform pg_temp.mkpage(v_org, v_pat2, e2, v_a, 50, 8, false);
  perform pg_temp.mkpage(v_org, v_pat, e3, v_b, 20, null, false);
  perform pg_temp.mkpage(v_org, v_pat2, e4, v_b, 25, null, true);
  jo := pg_temp.dash_as(v_ops, 7, 1);
  jc := pg_temp.dash_as(v_cmo, 7, 1);
  perform pg_temp.rec('real', 'three real red pages are counted, the test page is not', '3', ((jo -> 'pages' ->> 'total')::integer - (j0 -> 'pages' ->> 'total')::integer)::text);
  perform pg_temp.rec('real', 'two of them were acknowledged', '2', ((jo -> 'pages' ->> 'acknowledged')::integer - (j0 -> 'pages' ->> 'acknowledged')::integer)::text);
  perform pg_temp.rec('real', 'one was acknowledged inside the first escalation window', '1', ((jo -> 'pages' ->> 'acknowledged_in_window')::integer - (j0 -> 'pages' ->> 'acknowledged_in_window')::integer)::text);
  perform pg_temp.rec('real', 'one real page is still unacknowledged (test page excluded)', '1', (jsonb_array_length(jo -> 'pages' -> 'unacknowledged') - jsonb_array_length(j0 -> 'pages' -> 'unacknowledged'))::text);
  perform pg_temp.rec('real', 'the unacknowledged row shows only time, level and cover', 'level,no_cover,seconds_waiting,sent_at',
    (select string_agg(k, ',' order by k) from (select distinct jsonb_object_keys(x) k from jsonb_array_elements(jo -> 'pages' -> 'unacknowledged') x) s));
  perform pg_temp.rec('real', 'the first escalation window is the configured one', (private.paging_rule('escalation_minutes') ->> 0), jo -> 'pages' ->> 'window_minutes');

  -- 2. ops sees aggregates only
  perform pg_temp.rec('real', 'ops answer has no individuals list', 'false', (jo ? 'individuals')::text);
  perform pg_temp.rec('real', 'ops answer has no on-call names', 'false', (jo ? 'on_call')::text);
  perform pg_temp.rec('real', 'no fixture clinician name appears anywhere in the ops answer', 'false', (jo::text like '%S36e%')::text);
  perform pg_temp.rec('real', 'no patient id appears in the ops answer', 'false', (jo::text like '%' || v_pat::text || '%')::text);
  perform pg_temp.rec('real', 'ops answer does not carry any score tied to a person (aggregate-only)', 'false', (jo::text like '%"score"%')::text);

  -- 7. hand-backs: A: 2 on time, 1 handed back (other); B: 1 handed back with reason; test event ignored
  perform pg_temp.ev(v_org, v_a, 'completed_on_time', false); perform pg_temp.ev(v_org, v_a, 'completed_on_time', false);
  perform pg_temp.ev(v_org, v_a, 'handed_back_other', false); perform pg_temp.ev(v_org, v_b, 'handed_back_reasoned', false);
  perform pg_temp.ev(v_org, v_t, 'handed_back_other', true);
  jo := pg_temp.dash_as(v_ops, 7, 1); jc := pg_temp.dash_as(v_cmo, 7, 1);
  perform pg_temp.rec('real', 'completed on time grew by two', '2', (coalesce((jo -> 'handbacks' ->> 'completed_on_time')::integer, 0) - coalesce((j0 -> 'handbacks' ->> 'completed_on_time')::integer, 0))::text);
  perform pg_temp.rec('real', 'handed back other grew by one (test event not counted)', '1', (coalesce((jo -> 'handbacks' ->> 'handed_back_other')::integer, 0) - coalesce((j0 -> 'handbacks' ->> 'handed_back_other')::integer, 0))::text);
  perform pg_temp.rec('real', 'handed back with a reason grew by one', '1', (coalesce((jo -> 'handbacks' ->> 'handed_back_reasoned')::integer, 0) - coalesce((j0 -> 'handbacks' ->> 'handed_back_reasoned')::integer, 0))::text);
  perform pg_temp.rec('real', 'the lead sees one clinician own hand-back count', '1', (select (x ->> 'handbacks') from jsonb_array_elements(jc -> 'individuals') x where x ->> 'name' = 'S36e clin-b-bravo'));

  -- 8. distribution
  perform pg_temp.rec('real', 'ops gets no scores for a group below the minimum', 'true,null',
    ((pg_temp.dash_as(v_ops, 7, 100) -> 'distribution' ->> 'suppressed') || ',' || coalesce(pg_temp.dash_as(v_ops, 7, 100) -> 'distribution' ->> 'scores', 'null')));
  perform pg_temp.rec('real', 'ops gets the scores once the group is big enough', 'false', (pg_temp.dash_as(v_ops, 7, 1) -> 'distribution' ->> 'suppressed'));
  perform pg_temp.rec('real', 'the lead always gets the scores', 'false', (pg_temp.dash_as(v_cmo, 7, 100) -> 'distribution' ->> 'suppressed'));
  perform pg_temp.rec('real', 'a test clinician score is not in the distribution (10 absent)', '0',
    (select count(*)::text from jsonb_array_elements(pg_temp.dash_as(v_cmo, 7, 1) -> 'distribution' -> 'scores') s where (s #>> '{}')::numeric = 10));

  -- 6. cover: with no rota covering now, not covered; then a rota with a backup covers now
  delete from public.on_call_rota where organisation_id = v_org and starts_at <= now() and ends_at > now();
  perform pg_temp.rec('real', 'no rota now means not covered', 'false', (pg_temp.dash_as(v_ops, 7, 1) -> 'cover' ->> 'covered_now'));
  perform pg_temp.rec('real', 'and uncovered gaps are listed', 'true', ((jsonb_array_length(pg_temp.dash_as(v_ops, 7, 1) -> 'cover' -> 'gaps')) >= 1)::text);
  perform set_config('tarragon.lead_write', 'on', true);
  insert into public.on_call_rota (organisation_id, starts_at, ends_at, primary_clinician_id, backup_clinician_id, is_test)
    values (v_org, now() - interval '1 hour', now() + interval '2 hours', v_a, v_b, false);
  perform set_config('tarragon.lead_write', 'off', true);
  perform pg_temp.rec('real', 'a rota with primary and backup covers now', 'true', (pg_temp.dash_as(v_ops, 7, 1) -> 'cover' ->> 'covered_now'));
  perform pg_temp.rec('real', 'the lead sees who is on call', 'S36e clin-b-bravo', (pg_temp.dash_as(v_cmo, 7, 1) -> 'on_call' ->> 'primary'));
  perform pg_temp.rec('real', 'ops sees only that someone is on call', 'false', ((pg_temp.dash_as(v_ops, 7, 1) -> 'cover')::text like '%S36e%')::text);
end $$;

-- sabotage A: the lead test forced true
do $$
declare v_orig text; v_def text; jo jsonb;
begin
  v_orig := pg_get_functiondef('public.reliability_dashboard(integer,integer)'::regprocedure);
  v_def := replace(v_orig, 'v_lead boolean := private.cmo_of(private.caller_org());', 'v_lead boolean := true;');
  if v_def = v_orig then raise exception 'SABOTAGE A not applied'; end if;
  execute v_def;
  jo := pg_temp.dash_as(pg_temp.f('ops'), 7, 1);
  insert into results values ('sabotaged', 'ops answer has no individuals list', 'false', (jo ? 'individuals')::text);
  execute v_orig;
end $$;

-- sabotage B: the is_test filters removed
do $$
declare v_orig text; v_def text; jo jsonb; v_base jsonb;
begin
  v_orig := pg_get_functiondef('public.reliability_dashboard(integer,integer)'::regprocedure);
  v_def := replace(replace(replace(v_orig, 'not t.is_test', 'true'), 'not p.is_test', 'true'), 'not ev.is_test', 'true');
  if v_def = v_orig then raise exception 'SABOTAGE B not applied'; end if;
  execute v_def;
  jo := pg_temp.dash_as(pg_temp.f('ops'), 7, 1);
  select j into v_base from snap where k = 'base';
  insert into results values ('sabotaged', 'a test task is not counted (class 2 grew by exactly one)', '1', (pg_temp.waiting(jo, 2) - pg_temp.waiting(v_base, 2))::text);
  insert into results values ('sabotaged', 'three real red pages are counted, the test page is not', '3', ((jo -> 'pages' ->> 'total')::integer - (v_base -> 'pages' ->> 'total')::integer)::text);
  execute v_orig;
end $$;

do $$
declare v_bad integer; v_caught integer; v_flipped_a boolean; v_flipped_b integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S36e proof FAILED: %', (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) > 0 into v_flipped_a from results where phase = 'sabotaged' and check_name = 'ops answer has no individuals list' and expected <> actual;
  select count(*) into v_flipped_b from results where phase = 'sabotaged' and check_name <> 'ops answer has no individuals list' and expected <> actual;
  if not v_flipped_a then raise exception 'VACUOUS TEST: sabotage A did not flip the ops aggregate-only check'; end if;
  if v_flipped_b < 2 then raise exception 'VACUOUS TEST: sabotage B flipped % of 2 exclusion checks', v_flipped_b; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result from results where phase = 'real' order by check_name;
rollback;
