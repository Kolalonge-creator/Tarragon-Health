-- Tarragon Health: the abnormal-result trigger sends the shared jobs secret to its Edge Function (2026-10-30)
--
-- The abnormal-result Edge Function pages clinicians and writes patient notices with the service role, is deployed with verify_jwt off,
-- and used to check nothing: the trigger called it with the project's publishable key, which is public by design. The function now refuses
-- a caller without the shared jobs secret (supabase/functions/abnormal-result-handler/auth.ts), so the trigger MUST send it or no page
-- goes out. This proof reads the request the trigger queues (pg_net queues it inside the transaction, so it can be read before the
-- rollback) and checks:
--
--   1  a critical result queues one call to the handler with the jobs secret from Vault in x-notification-jobs-secret, and still sends the
--      Authorization header and a JSON body naming the screening result
--   2  the clinician alert row is written as before (the safety net does not depend on the call)
--   3  a normal result queues no call and no alert
--
-- Fixtures built here (including the two Vault secrets the trigger reads), wrapped in BEGIN/ROLLBACK, raises on failure.
-- Run: psql "$DATABASE_URL" -f packages/db/tests/abnormal_result_trigger_sends_jobs_secret.sql

begin;

create temp table fx (k text primary key, v text) on commit drop;
grant all on fx to public;

do $$
declare v_org uuid; v_pat uuid := gen_random_uuid();
begin
  select id into v_org from public.organisations order by created_at limit 1;
  if v_org is null then raise exception 'no organisation exists, the core migrations did not run'; end if;

  -- The trigger reads these from Vault at run time; a fresh database has none, production has all three.
  delete from vault.secrets where name in ('project_url', 'edge_function_publishable_key', 'notification_jobs_secret');
  perform vault.create_secret('https://ev12.example.invalid', 'project_url');
  perform vault.create_secret('sb_publishable_ev12_public_key', 'edge_function_publishable_key');
  perform vault.create_secret('ev12-jobs-secret-0123456789-abcdefghijklmnopqrstuvwxyz-0123456789', 'notification_jobs_secret');

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v_pat, 'ev12-pat@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, date_of_birth, is_test)
  values (v_pat, v_org, 'patient', 'EV12 Patient', date '1980-01-01', true)
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, full_name = excluded.full_name;
  insert into fx values ('org', v_org::text), ('pat', v_pat::text);
end $$;

-- ================================================================ 3 first: a normal result calls nothing
do $$
declare v_before bigint; v_after bigint; v_alerts_before bigint; v_alerts_after bigint;
begin
  select count(*) into v_before from net.http_request_queue;
  select count(*) into v_alerts_before from public.clinician_alerts where patient_id = (select v::uuid from fx where k = 'pat');
  insert into public.screening_results (organisation_id, patient_id, result_status, screen_type_code, abnormal_flags)
  values ((select v::uuid from fx where k = 'org'), (select v::uuid from fx where k = 'pat'), 'normal', 'hba1c', array[]::text[]);
  select count(*) into v_after from net.http_request_queue;
  select count(*) into v_alerts_after from public.clinician_alerts where patient_id = (select v::uuid from fx where k = 'pat');
  if v_after <> v_before then raise exception 'FAIL 3: a normal result queued % call(s) to the handler', v_after - v_before; end if;
  if v_alerts_after <> v_alerts_before then raise exception 'FAIL 3: a normal result raised an alert'; end if;
end $$;

-- ================================================================ 1 and 2 a critical result
do $$
declare
  v_result uuid; v_req record; v_n bigint; v_secret text; v_alert uuid;
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'notification_jobs_secret';
  if v_secret is null then raise exception 'FAIL setup: the fixture secret was not created'; end if;

  select count(*) into v_n from net.http_request_queue where url like 'https://ev12.example.invalid/functions/v1/abnormal-result-handler';
  if v_n <> 0 then raise exception 'FAIL setup: a handler call was already queued before the critical result'; end if;

  insert into public.screening_results (organisation_id, patient_id, result_status, screen_type_code, abnormal_flags)
  values ((select v::uuid from fx where k = 'org'), (select v::uuid from fx where k = 'pat'), 'critical', 'hba1c', array['glucose'])
  returning id into v_result;

  select count(*) into v_n from net.http_request_queue where url = 'https://ev12.example.invalid/functions/v1/abnormal-result-handler';
  if v_n <> 1 then raise exception 'FAIL 1: expected exactly 1 queued call to the handler, found %', v_n; end if;

  select * into v_req from net.http_request_queue where url = 'https://ev12.example.invalid/functions/v1/abnormal-result-handler';
  if v_req.headers ->> 'x-notification-jobs-secret' is distinct from v_secret then
    raise exception 'FAIL 1: the call does not carry the jobs secret from Vault (got %)',
      case when v_req.headers ? 'x-notification-jobs-secret' then 'a different value' else 'no such header' end;
  end if;
  if v_req.headers ->> 'Authorization' is distinct from 'Bearer sb_publishable_ev12_public_key' then
    raise exception 'FAIL 1: the Authorization header changed';
  end if;
  if convert_from(v_req.body, 'UTF8')::jsonb ->> 'screening_result_id' is distinct from v_result::text then
    raise exception 'FAIL 1: the call body does not name the screening result';
  end if;
  if v_req.headers::text like '%' || 'sb_secret' || '%' then
    raise exception 'FAIL 1: a service key appears in the headers';
  end if;

  select id into v_alert from public.clinician_alerts where screening_result_id = v_result and level = 'emergency';
  if v_alert is null then raise exception 'FAIL 2: no emergency clinician alert was written for the critical result'; end if;
end $$;

rollback;

select 'abnormal_result_trigger_sends_jobs_secret: ok' as result;
