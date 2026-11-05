-- The two-minute upload-check sweep no longer needs a copy of the app's CRON_SECRET in Vault (follow-up to
-- 20261105120005_client_upload_checks.sql, security audit 2026-11-05 M-4/L-4).
--
-- Before: private.kick_client_upload_checks() called the app with `Bearer <cron_secret>`, so the sweep stayed off until someone
-- copied the app's cron secret into Vault, a second copy of a credential to keep in step. Now the database proves the call is
-- its own with a one-time code it creates itself:
--
--   1. The kick inserts a random code into private.client_upload_check_kicks and sends it in the x-upload-check-kick header.
--   2. The app route passes the code to public.consume_client_upload_check_kick() (service role only), which accepts it once,
--      within ten minutes of being made, and never again. A copied code is useless once used or ten minutes old, and all it
--      could ever do is run the same idempotent sweep.
--   3. If the app does not answer (a wrong address, the app down, the code refused), codes pile up unspent. Three or more
--      unanswered in the last hour open a sev3 ops incident through the existing private.ops_alert_incident (one per hour,
--      updated not duplicated), so a stalled sweep is seen rather than silent. The Vercel daily backstop still runs.
--
-- Nobody outside the database can make a code, so no shared secret is involved. The Vercel daily backstop keeps the existing
-- CRON_SECRET bearer. The only setting left is the non-secret app address in Vault (app_base_url), set on the live project
-- outside migrations so a local or CI database never calls production.
--
-- Redefined from the live body of private.kick_client_upload_checks (pg_get_functiondef, 2026-11-05).
-- Proof: packages/db/tests/upload_check_kick_one_time_codes.sql.

create table private.client_upload_check_kicks (
  code uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  used_at timestamptz
);

alter table private.client_upload_check_kicks enable row level security;
revoke all on private.client_upload_check_kicks from public, anon, authenticated;

comment on table private.client_upload_check_kicks is
  'One-time codes the upload-check sweep sends to the app so the app knows the call came from this database (no shared secret). '
  'Written by private.kick_client_upload_checks, spent by public.consume_client_upload_check_kick.';

create or replace function private.kick_client_upload_checks()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_base text := (select decrypted_secret from vault.decrypted_secrets where name = 'app_base_url');
  v_code uuid;
  v_unanswered integer;
begin
  if v_base is null then
    return;
  end if;
  -- Spent or stale codes are kept a day for tracing, then removed.
  delete from private.client_upload_check_kicks where created_at < now() - interval '1 day';
  -- The app has not answered recent calls: say so on the ops desk instead of failing quietly.
  select count(*) into v_unanswered
  from private.client_upload_check_kicks
  where used_at is null and created_at < now() - interval '10 minutes' and created_at > now() - interval '1 hour';
  if v_unanswered >= 3 then
    perform private.ops_alert_incident(
      'upload-check-sweep-unanswered:' || to_char(now() at time zone 'UTC', 'YYYYMMDDHH24'),
      'Upload check sweep is not reaching the app',
      v_unanswered || ' calls in the last hour from the database to ' || rtrim(v_base, '/') || '/api/cron/verify-client-uploads '
        || 'were never answered. Check the app_base_url Vault value and the app. Files are still checked on upload, before '
        || 'anyone opens them, and by the daily Vercel run.',
      'sev3'
    );
  end if;
  if not exists (
    select 1 from private.client_upload_checks k
    where k.status = 'pending'
       or (k.status in ('checking', 'error')
            and k.claimed_at < now() - case when k.attempts < 5 then interval '10 minutes' else interval '1 hour' end)
  ) then
    return;
  end if;
  insert into private.client_upload_check_kicks default values returning code into v_code;
  perform net.http_post(
    url := rtrim(v_base, '/') || '/api/cron/verify-client-uploads',
    headers := jsonb_build_object('x-upload-check-kick', v_code::text, 'Content-Type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
end;
$$;

revoke all on function private.kick_client_upload_checks() from public, anon, authenticated;

-- True exactly once for a code this database made in the last ten minutes; false for anything else.
create or replace function public.consume_client_upload_check_kick(p_code uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'consume_client_upload_check_kick is for the server only' using errcode = '42501';
  end if;
  update private.client_upload_check_kicks
  set used_at = now()
  where code = p_code and used_at is null and created_at > now() - interval '10 minutes';
  get diagnostics v_rows = row_count;
  return v_rows = 1;
end;
$$;

revoke all on function public.consume_client_upload_check_kick(uuid) from public, anon, authenticated;
grant execute on function public.consume_client_upload_check_kick(uuid) to service_role;

do $$
begin
  if has_function_privilege('anon', 'public.consume_client_upload_check_kick(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.consume_client_upload_check_kick(uuid)', 'EXECUTE') then
    raise exception 'upload_check_kick: consume must be server-only';
  end if;
  if pg_get_functiondef('private.kick_client_upload_checks'::regproc) like '%cron_secret%' then
    raise exception 'upload_check_kick: the kick still reads cron_secret';
  end if;
end $$;
