-- S80d proof (Module 25.10): the monthly AI review sample scheduler is INERT until the CMO signs, then draws once per month with risk weighting.
--   1. The v1 rules are born unsigned and inactive; with nothing signed the scheduler returns 'inert', draws nothing and writes no run row.
--   2. A manual draw before signing behaves as S80c did (no risk groups).
--   3. Only the active Chief Medical Officer signs (admin, patient and anon refused); a signed version cannot be signed again or edited.
--   4. After signing, the scheduler draws LAST month once: emergency-touching conversations, a patient-reported answer and a cost spike are always
--      in with their own rule; a test-account interaction is never drawn; ordinary calls are not tagged as risk; a second run draws nothing.
--   5. The overview is admin or CMO only, lists the patient report and carries no answer text; the scheduler and the core are not callable by
--      signed-in users.
--   SABOTAGE: (a) the inert guard removed, (b) the test-account filter removed from the emergency rule, (c) the patient-reported rule removed;
--   each must flip a check.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;
create function pg_temp.f(p text) returns uuid language sql as $$ select v from fx where k = p $$;
create function pg_temp.setf(p text, p_v uuid) returns void language sql as
$$ insert into fx values (p, p_v) on conflict (k) do update set v = excluded.v $$;
create function pg_temp.sql_as(p_uid uuid, p_sql text) returns text language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
  begin execute p_sql; exception when others then reset role; return 'ERR:' || sqlstate; end;
  reset role;
  return 'ok';
end $f$;
create function pg_temp.sql_anon(p_sql text) returns text language plpgsql as $f$
begin
  set local role anon;
  begin execute p_sql; exception when others then reset role; return 'ERR:' || sqlstate; end;
  reset role;
  return 'ok';
end $f$;

-- fixtures -----------------------------------------------------------------------------------------------------------------------
do $$
declare
  v_org uuid; v_admin uuid := gen_random_uuid(); v_cmo uuid := gen_random_uuid(); v_pat uuid := gen_random_uuid(); v_test uuid := gen_random_uuid();
  v_sys uuid; v_last timestamptz := date_trunc('month', (now() at time zone 'Africa/Lagos') - interval '1 month') at time zone 'Africa/Lagos' + interval '10 days';
  v_normal uuid; v_report uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  select id into v_sys from public.ai_systems order by system_code limit 1;
  if v_org is null or v_sys is null then raise exception 'fixture missing: the proof needs seed.sql'; end if;
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data) values
    (v_admin, 's80d-ai-admin@example.invalid', 'x', now(), '{}', '{}'), (v_cmo, 's80d-ai-cmo@example.invalid', 'x', now(), '{}', '{}'),
    (v_pat, 's80d-ai-pat@example.invalid', 'x', now(), '{}', '{}'), (v_test, 's80d-ai-test@example.invalid', 'x', now(), '{}', '{}');
  update public.profiles set organisation_id = v_org, role = 'admin', full_name = 'S80d Admin', is_test = true where id = v_admin;
  update public.profiles set organisation_id = v_org, role = 'clinician', full_name = 'S80d CMO', is_test = true where id = v_cmo;
  update public.profiles set organisation_id = v_org, role = 'patient', full_name = 'S80d Real Patient', is_test = false where id = v_pat;
  update public.profiles set organisation_id = v_org, role = 'patient', full_name = 'S80d Test Patient', is_test = true where id = v_test;
  insert into public.clinical_staff (profile_id, organisation_id, full_name, doctor_tier, active, credential_type, credential_number, indemnity_exempt, indemnity_exempt_by, verified_by, license_verified_at)
  values (v_cmo, v_org, 'S80d CMO', 'chief_medical_officer', true, 'MDCN', 'S80D-CMO', true, v_admin, v_admin, now());
  perform pg_temp.setf('org', v_org); perform pg_temp.setf('sys', v_sys); perform pg_temp.setf('admin', v_admin); perform pg_temp.setf('cmo', v_cmo);
  perform pg_temp.setf('pat', v_pat); perform pg_temp.setf('test', v_test);

  -- 20 ordinary calls (1,000 tokens each), 2 emergency-grade real calls, 1 emergency-grade test-account call, 1 reported answer, 1 huge call
  insert into public.ai_interaction_log (organisation_id, ai_system_id, model_identifier, input_category, subject_profile_id, status, safety_classification, input_token_count, output_token_count, output_summary, flagged_for_review, created_at)
  select v_org, v_sys, 's80d-normal', 'proof', v_pat, 'completed', 'routine', 500, 500, 'normal ' || g, false, v_last from generate_series(1, 20) g;
  insert into public.ai_interaction_log (organisation_id, ai_system_id, model_identifier, input_category, subject_profile_id, status, safety_classification, input_token_count, output_token_count, output_summary, flagged_for_review, created_at)
  select v_org, v_sys, 's80d-emergency', 'proof', v_pat, 'completed', 'emergency', 500, 500, 'emergency ' || g, false, v_last from generate_series(1, 2) g;
  insert into public.ai_interaction_log (organisation_id, ai_system_id, model_identifier, input_category, subject_profile_id, status, safety_classification, input_token_count, output_token_count, output_summary, flagged_for_review, created_at)
  values (v_org, v_sys, 's80d-test-emergency', 'proof', v_test, 'completed', 'emergency', 500, 500, 'test emergency', false, v_last);
  insert into public.ai_interaction_log (organisation_id, ai_system_id, model_identifier, input_category, subject_profile_id, status, safety_classification, input_token_count, output_token_count, output_summary, flagged_for_review, created_at)
  values (v_org, v_sys, 's80d-reported', 'proof', v_pat, 'completed', 'routine', 500, 500, 'reported answer', false, v_last) returning id into v_report;
  insert into public.ai_interaction_log (organisation_id, ai_system_id, model_identifier, input_category, subject_profile_id, status, safety_classification, input_token_count, output_token_count, output_summary, flagged_for_review, created_at)
  values (v_org, v_sys, 's80d-spike', 'proof', v_pat, 'completed', 'routine', 5000000, 5000000, 'huge call', false, v_last);
  insert into public.ai_safety_incidents (organisation_id, ai_system_id, interaction_id, reported_by, reporter_kind, category, description, created_at)
  values (v_org, v_sys, v_report, v_pat, 'patient', 'incorrect_information', 'S80d proof: the patient said the answer was wrong', v_last + interval '1 day');
end $$;

create function pg_temp.sampled(p_model text) returns text language sql as
$$ select coalesce(string_agg(distinct r.sampled_by_rule, ',' order by r.sampled_by_rule), 'none')
     from public.ai_review_samples r join public.ai_interaction_log l on l.id = r.interaction_id where l.model_identifier = p_model $$;
create function pg_temp.last_month() returns date language sql as
$$ select date_trunc('month', (now() at time zone 'Africa/Lagos') - interval '1 month')::date $$;

-- 1. inert, born unsigned ----------------------------------------------------------------------------------------------------
insert into results values ('real', 'v1 is born unsigned and inactive', 'false/false',
  (select is_active::text || '/' || (approved_at is not null)::text from public.ai_monitoring_config where version = 1));
insert into results values ('real', 'no rules are in force', 'null', (select coalesce(private.ai_monitoring_rules()::text, 'null')));
insert into results values ('real', 'the scheduler is inert', 'inert', (select private.run_ai_review_sample_schedule() ->> 'status'));
insert into results values ('real', 'an inert run writes no run row and samples nothing of ours', '0/none',
  (select count(*)::text from public.ai_review_sample_runs where sample_month = pg_temp.last_month()) || '/' || pg_temp.sampled('s80d-emergency'));
insert into results values ('real', 'the monthly job is scheduled', '1', (select count(*)::text from cron.job where jobname = 'ai-review-sample-monthly'));
insert into results values ('real', 'the sample rate in v1 equals the proposed review rate', '0.05', (select (config ->> 'sample_rate') from public.ai_monitoring_config where version = 1));

-- 2. a manual draw before signing is the S80c behaviour
insert into results values ('real', 'a manual draw before signing works for an admin', 'ok',
  pg_temp.sql_as(pg_temp.f('admin'), format($q$select public.draw_ai_review_sample(%L::date, 0.10)$q$, pg_temp.last_month())));
insert into results values ('real', 'and applies no risk groups', '0',
  (select count(*)::text from public.ai_review_samples where sample_month = pg_temp.last_month() and sampled_by_rule like 'risk\_%'));
delete from public.ai_review_samples where sample_month = pg_temp.last_month();

-- 3. only the CMO signs
insert into results values ('real', 'an admin cannot sign', 'ERR:42501', pg_temp.sql_as(pg_temp.f('admin'), 'select public.sign_ai_monitoring_config(1)'));
insert into results values ('real', 'a patient cannot sign', 'ERR:42501', pg_temp.sql_as(pg_temp.f('pat'), 'select public.sign_ai_monitoring_config(1)'));
insert into results values ('real', 'anon cannot sign', 'ERR:42501', pg_temp.sql_anon('select public.sign_ai_monitoring_config(1)'));
insert into results values ('real', 'the CMO cannot sign a version that does not exist', 'ERR:P0002', pg_temp.sql_as(pg_temp.f('cmo'), 'select public.sign_ai_monitoring_config(999999)'));
insert into results values ('real', 'still nothing in force after the refusals', 'null', (select coalesce(private.ai_monitoring_rules()::text, 'null')));
-- SABOTAGE (a) runs here, while nothing is signed: with the inert guard removed the scheduler must not stay inert
do $$
declare v_orig text; v_def text; r text;
begin
  v_orig := pg_get_functiondef('private.run_ai_review_sample_schedule()'::regprocedure);
  v_def := replace(v_orig, 'if v_rules is null then', 'if false then');
  if v_def = v_orig then raise exception 'SABOTAGE (a) not applied'; end if;
  execute v_def;
  begin r := private.run_ai_review_sample_schedule() ->> 'status'; exception when others then r := 'ERR:' || sqlstate; end;
  insert into results values ('sabotaged', 'the scheduler is inert', 'inert', r);
  execute v_orig;
end $$;
insert into results values ('real', 'the CMO signs', 'ok', pg_temp.sql_as(pg_temp.f('cmo'), 'select public.sign_ai_monitoring_config(1)'));
insert into results values ('real', 'v1 is now active and signed by the CMO', 'true/true',
  (select is_active::text || '/' || (approved_by = pg_temp.f('cmo'))::text from public.ai_monitoring_config where version = 1));
insert into results values ('real', 'signing is audited', '1', (select count(*)::text from public.audit_log where action = 'ai_monitoring_config.signed' and actor_id = pg_temp.f('cmo')));
insert into results values ('real', 'a signed version cannot be signed again', 'ERR:23514', pg_temp.sql_as(pg_temp.f('cmo'), 'select public.sign_ai_monitoring_config(1)'));
do $$
declare r text;
begin
  begin update public.ai_monitoring_config set config = '{}'::jsonb where version = 1; r := 'edited';
  exception when others then r := 'ERR:' || sqlstate; end;
  insert into results values ('real', 'a signed config cannot be edited', 'ERR:23514', r);
  begin update public.ai_monitoring_config set approved_by = null where version = 1; r := 'unsigned';
  exception when others then r := 'ERR:' || sqlstate; end;
  insert into results values ('real', 'a signed config keeps its signature', 'ERR:23514', r);
  begin delete from public.ai_monitoring_config where version = 1; r := 'deleted';
  exception when others then r := 'ERR:' || sqlstate; end;
  insert into results values ('real', 'a config version is never deleted', 'ERR:23514', r);
end $$;

-- 4. the scheduled draw
create temp table ran(j jsonb) on commit drop;
insert into ran select private.run_ai_review_sample_schedule();
insert into results values ('real', 'the scheduler draws last month', 'drawn', (select j ->> 'status' from ran));
insert into results values ('real', 'emergency-touching conversations are always in with their own rule', 'risk_emergency', pg_temp.sampled('s80d-emergency'));
insert into results values ('real', 'both of them', '2', (select count(*)::text from public.ai_review_samples r join public.ai_interaction_log l on l.id = r.interaction_id where l.model_identifier = 's80d-emergency'));
insert into results values ('real', 'a patient-reported answer is always in with its own rule', 'risk_reported', pg_temp.sampled('s80d-reported'));
insert into results values ('real', 'a cost spike is always in with its own rule', 'risk_cost_spike', pg_temp.sampled('s80d-spike'));
insert into results values ('real', 'a test-account emergency is never drawn', 'none', pg_temp.sampled('s80d-test-emergency'));
insert into results values ('real', 'ordinary calls are never tagged as risk', '0',
  (select count(*)::text from public.ai_review_samples r join public.ai_interaction_log l on l.id = r.interaction_id where l.model_identifier = 's80d-normal' and r.sampled_by_rule like 'risk\_%'));
insert into results values ('real', 'the run is recorded once with the signed version', '1/1',
  (select count(*)::text || '/' || max(config_version)::text from public.ai_review_sample_runs where sample_month = pg_temp.last_month()));
do $$
declare v_before bigint; v_after bigint; v_status text;
begin
  select count(*) into v_before from public.ai_review_samples;
  v_status := private.run_ai_review_sample_schedule() ->> 'status';
  select count(*) into v_after from public.ai_review_samples;
  insert into results values ('real', 'a second run draws nothing', 'already_drawn/0', v_status || '/' || (v_after - v_before)::text);
end $$;

-- 5. who can see and call what
insert into results values ('real', 'a patient cannot read the overview', 'ERR:42501', pg_temp.sql_as(pg_temp.f('pat'), 'select public.ai_monitoring_overview()'));
insert into results values ('real', 'anon cannot read the overview', 'ERR:42501', pg_temp.sql_anon('select public.ai_monitoring_overview()'));
insert into results values ('real', 'the CMO can read the overview', 'ok', pg_temp.sql_as(pg_temp.f('cmo'), 'select public.ai_monitoring_overview()'));
create temp table ov(j jsonb) on commit drop;
do $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', pg_temp.f('admin'), 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into ov select public.ai_monitoring_overview();
  reset role;
end $$;
insert into results values ('real', 'the admin overview says the scheduler is armed at the signed version', 'true/1', (select (j #>> '{scheduler,armed}') || '/' || (j #>> '{scheduler,signed_version}') from ov));
insert into results values ('real', 'it lists the patient report and says it is in the review sample', 'true',
  (select exists (select 1 from jsonb_array_elements(j -> 'reported') e where e ->> 'category' = 'incorrect_information' and (e ->> 'in_review_sample')::boolean)::text from ov));
insert into results values ('real', 'it carries no answer text', 'false', (select (j::text like '%reported answer%' or j::text like '%huge call%')::text from ov));
insert into results values ('real', 'the overview read is audited', 'true', (select (count(*) >= 1)::text from public.audit_log where action = 'ai_monitoring.overview_read'));
insert into results values ('real', 'signed-in users cannot run the scheduler', 'false', (select has_function_privilege('authenticated', 'private.run_ai_review_sample_schedule()', 'EXECUTE')::text));
insert into results values ('real', 'signed-in users cannot call the core', 'false', (select has_function_privilege('authenticated', 'private.draw_ai_review_sample_core(date, numeric, jsonb)', 'EXECUTE')::text));
insert into results values ('real', 'anon cannot read the config table', 'false', (select has_table_privilege('anon', 'public.ai_monitoring_config', 'SELECT')::text));
insert into results values ('real', 'anon cannot read the run table', 'false', (select has_table_privilege('anon', 'public.ai_review_sample_runs', 'SELECT')::text));

-- SABOTAGE (b): the test-account filter removed from the emergency rule
do $$
declare v_orig text; v_def text; v_n bigint;
begin
  v_orig := pg_get_functiondef('private.draw_ai_review_sample_core(date, numeric, jsonb)'::regprocedure);
  v_def := replace(v_orig, 'coalesce(sp.is_test, false) = false', 'true');
  if v_def = v_orig then raise exception 'SABOTAGE (b) not applied'; end if;
  delete from public.ai_review_samples where sample_month = pg_temp.last_month();
  execute v_def;
  perform private.draw_ai_review_sample_core(pg_temp.last_month(), 0.05, private.ai_monitoring_rules());
  insert into results values ('sabotaged', 'a test-account emergency is never drawn', 'none', pg_temp.sampled('s80d-test-emergency'));
  execute v_orig;
end $$;

-- SABOTAGE (c): the patient-reported rule removed
do $$
declare v_orig text; v_def text;
begin
  v_orig := pg_get_functiondef('private.draw_ai_review_sample_core(date, numeric, jsonb)'::regprocedure);
  v_def := replace(v_orig, 'if v_always ? ''patient_reported'' then', 'if false then');
  if v_def = v_orig then raise exception 'SABOTAGE (c) not applied'; end if;
  delete from public.ai_review_samples where sample_month = pg_temp.last_month();
  execute v_def;
  perform private.draw_ai_review_sample_core(pg_temp.last_month(), 0.05, private.ai_monitoring_rules());
  insert into results values ('sabotaged', 'a patient-reported answer is always in with its own rule', 'risk_reported', pg_temp.sampled('s80d-reported'));
  execute v_orig;
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S80d AI monitoring proof FAILED: %', (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected is distinct from actual;
  if v_caught < 3 then raise exception 'VACUOUS TEST: only % of 3 sabotages flipped a check: %', v_caught, (select string_agg(check_name || ' expected ' || expected || ' got ' || coalesce(actual,'null'), '; ') from results where phase = 'sabotaged'); end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result from results where phase = 'real' order by check_name;
rollback;
