-- ===========================================================================
-- Proof: 20261102121434_fix_service_role_gate_on_mdm_cron_rpcs.sql,
--        20261102121517_ai_interaction_platform_org_fallback.sql,
--        20261102121553_cron_failure_incidents_auto_resolve.sql
-- PROVES
--   1. run_data_quality_scan / run_patient_duplicate_detection: allowed with no JWT and with a service_role JWT claim;
--      refused (P0001) for an authenticated non-admin JWT; anon holds no EXECUTE.
--      SABOTAGE: the helper forced to true lets the authenticated caller through, so check 1 discriminates.
--   2. record_ai_interaction: no JWT + no subject records against the platform organisation; a named subject with no
--      profile still raises. SABOTAGE: the live-before body (no fallback) raises for the anonymous call.
--   3. A cron-failure incident whose job no longer exists, or has run clean since, is resolved by record_cron_failures();
--      one whose job failed inside the last 45 minutes stays open. SABOTAGE: a no-op resolver leaves the recovered
--      incident open, so check 3 discriminates.
-- Wrapped in BEGIN/ROLLBACK; mints its own fixtures (incident rows, cron job run rows under a proof-only job name).
-- ===========================================================================
begin;

create temp table gl_results (check_name text, observed text, expected text, verdict text);
create function pg_temp.chk(p_name text, p_expected text, p_observed text) returns void language plpgsql as $$
begin
  insert into gl_results values (p_name, p_observed, p_expected, case when p_observed is not distinct from p_expected then 'PASS' else 'FAIL' end);
end $$;

do $$
declare
  v_platform_org uuid := '00000000-0000-0000-0000-000000000001';
  v_patient uuid;
  v_ok boolean;
  v_id uuid;
  v_org uuid;
  v_inc_gone uuid; v_inc_recovered uuid; v_inc_failing uuid;
  v_jobid bigint;
  v_runid bigint := 900000000000;
  v_src text;
begin
  -- a non-admin authenticated identity: any patient profile, or a minted one
  select id into v_patient from public.profiles where role = 'patient' limit 1;
  if v_patient is null then
    v_patient := gen_random_uuid();
    insert into auth.users (id, email) values (v_patient, 'gl-proof-' || v_patient || '@example.test');
    insert into public.profiles (id, organisation_id, role, full_name) values (v_patient, v_platform_org, 'patient', 'GL proof patient');
  end if;

  -- 1. the gate
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.role', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform pg_temp.chk('1a no JWT runs the scan', 'true', (public.run_data_quality_scan() is not null)::text);
  perform pg_temp.chk('1b no JWT runs duplicate detection', 'true', (public.run_patient_duplicate_detection() is not null)::text);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform pg_temp.chk('1c service_role claim runs the scan', 'true', (public.run_data_quality_scan() is not null)::text);
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', v_patient)::text, true);
  perform set_config('request.jwt.claim.sub', v_patient::text, true);
  begin
    perform public.run_data_quality_scan(); v_ok := true;
  exception when others then v_ok := false;
  end;
  perform pg_temp.chk('1d authenticated non-admin refused', 'false', v_ok::text);
  perform pg_temp.chk('1e anon has no EXECUTE on the scan', 'false', has_function_privilege('anon', 'public.run_data_quality_scan()', 'EXECUTE')::text);
  perform pg_temp.chk('1f anon has no EXECUTE on duplicate detection', 'false', has_function_privilege('anon', 'public.run_patient_duplicate_detection()', 'EXECUTE')::text);
  -- SABOTAGE 1: helper always true
  v_src := pg_get_functiondef('private.is_service_role_or_no_jwt'::regproc);
  execute 'create or replace function private.is_service_role_or_no_jwt() returns boolean language sql stable security definer set search_path to '''' as $f$ select true $f$';
  begin
    perform public.run_data_quality_scan(); v_ok := true;
  exception when others then v_ok := false;
  end;
  perform pg_temp.chk('1g SABOTAGE: forced helper lets the non-admin through (check 1d discriminates)', 'true', v_ok::text);
  execute v_src;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);

  -- 2. the AI audit fallback (no JWT, no subject)
  v_id := public.record_ai_interaction('AI-023', 'gl-proof-model', 'gl_proof', 'completed'::public.ai_interaction_status, null, 'proof');
  select organisation_id into v_org from public.ai_interaction_log where id = v_id;
  perform pg_temp.chk('2a anonymous interaction recorded against the platform organisation', v_platform_org::text, v_org::text);
  begin
    perform public.record_ai_interaction('AI-023', 'gl-proof-model', 'gl_proof', 'completed'::public.ai_interaction_status, gen_random_uuid(), 'proof'); v_ok := true;
  exception when others then v_ok := false;
  end;
  perform pg_temp.chk('2b a named subject with no profile still raises', 'false', v_ok::text);
  perform pg_temp.chk('2c fallback is in the live body', 'true', (pg_get_functiondef('public.record_ai_interaction'::regproc) ~ '00000000-0000-0000-0000-000000000001')::text);

  -- 3. cron-failure incidents
  insert into public.ops_incidents (category, severity, title, summary, external_reference, ack_due_at, resolve_due_at, detected_at)
    values ('technical', 'sev3', 'Scheduled job failed: zz_gl_proof_gone', 'proof', 'cron-failure:zz_gl_proof_gone:2026110201', now(), now(), now() - interval '2 hours') returning id into v_inc_gone;
  -- a job that exists, failed earlier, then ran clean
  select jobid into v_jobid from cron.job where jobname = 'zz_gl_proof_job';
  if v_jobid is null then
    v_jobid := cron.schedule('zz_gl_proof_job', '0 0 31 2 *', 'select 1');
  end if;
  insert into public.ops_incidents (category, severity, title, summary, external_reference, ack_due_at, resolve_due_at, detected_at)
    values ('technical', 'sev3', 'Scheduled job failed: zz_gl_proof_job', 'proof', 'cron-failure:zz_gl_proof_job:2026110202', now(), now(), now() - interval '2 hours') returning id into v_inc_recovered;
  insert into cron.job_run_details (jobid, runid, job_pid, database, username, command, status, return_message, start_time, end_time)
    values (v_jobid, v_runid, 1, current_database(), current_user, 'select 1', 'failed', 'proof failure', now() - interval '3 hours', now() - interval '3 hours'),
           (v_jobid, v_runid + 1, 1, current_database(), current_user, 'select 1', 'succeeded', '1 row', now() - interval '1 hour', now() - interval '1 hour');
  -- a job still failing inside the window
  insert into public.ops_incidents (category, severity, title, summary, external_reference, ack_due_at, resolve_due_at, detected_at)
    values ('technical', 'sev3', 'Scheduled job failed: zz_gl_proof_failing', 'proof', 'cron-failure:zz_gl_proof_failing:2026110203', now(), now(), now() - interval '2 hours') returning id into v_inc_failing;
  perform cron.schedule('zz_gl_proof_failing', '0 0 31 2 *', 'select 1');
  insert into cron.job_run_details (jobid, runid, job_pid, database, username, command, status, return_message, start_time, end_time)
    select jobid, v_runid + 2, 1, current_database(), current_user, 'select 1', 'failed', 'proof failure', now() - interval '10 minutes', now() - interval '10 minutes'
      from cron.job where jobname = 'zz_gl_proof_failing';

  perform private.record_cron_failures();
  perform pg_temp.chk('3a incident for a job that no longer exists is resolved', 'resolved', (select status::text from public.ops_incidents where id = v_inc_gone));
  perform pg_temp.chk('3b incident for a job that ran clean since is resolved', 'resolved', (select status::text from public.ops_incidents where id = v_inc_recovered));
  perform pg_temp.chk('3c resolved row carries a corrective action', 'true', (select corrective_action is not null from public.ops_incidents where id = v_inc_recovered)::text);
  perform pg_temp.chk('3d incident for a job still failing stays open', 'open', (select status::text from public.ops_incidents where id = v_inc_failing));
  perform pg_temp.chk('3e status change is logged', 'true', (select exists (select 1 from public.ops_incident_updates u where u.incident_id = v_inc_recovered and u.status_to = 'resolved'))::text);
  -- SABOTAGE 3: no-op resolver; a fresh recovered incident must stay open
  v_src := pg_get_functiondef('private.resolve_recovered_cron_failure_incidents'::regproc);
  execute 'create or replace function private.resolve_recovered_cron_failure_incidents() returns integer language sql security definer set search_path to '''' as $f$ select 0 $f$';
  insert into public.ops_incidents (category, severity, title, summary, external_reference, ack_due_at, resolve_due_at, detected_at)
    values ('technical', 'sev3', 'Scheduled job failed: zz_gl_proof_gone', 'proof', 'cron-failure:zz_gl_proof_gone:2026110204', now(), now(), now() - interval '2 hours') returning id into v_inc_gone;
  perform private.record_cron_failures();
  perform pg_temp.chk('3f SABOTAGE: no-op resolver leaves the recovered incident open (check 3a discriminates)', 'open', (select status::text from public.ops_incidents where id = v_inc_gone));
  execute v_src;
end $$;

select * from gl_results order by check_name;
do $$
declare v_fail integer;
begin
  select count(*) into v_fail from gl_results where verdict = 'FAIL';
  if v_fail > 0 then raise exception 'go-live readiness proof: % check(s) FAILED', v_fail; end if;
end $$;

rollback;
