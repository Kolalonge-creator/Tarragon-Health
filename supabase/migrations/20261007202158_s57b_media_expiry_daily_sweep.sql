-- S57b (CMO/founder decision 2026-10-07: "Expiry flag job runs daily"): the wellbeing library's expiry flag runs by itself, every day.
--
-- BACKGROUND. An item past its next_review_due is already hidden from every patient by the read rule (private.media_is_servable, evaluated at read
-- time), so the flag is display-only: it moves the row to "review due" and un-lists it so the admin readiness report and the review queue are right.
-- Until now the only way to run it was an admin pressing a button (public.media_library_flag_expired). Nobody remembers a button.
--
-- WHAT THIS ADDS.
--   * private.media_library_expiry_sweep(): the same update, with no caller check (it is only reachable by the database's own scheduler and by the
--     two wrappers below), that writes one audit row when anything was flagged (media_library.expired_flagged, with the count and the codes) and,
--     on ANY failure, writes an audit row (media_library_expiry.error) and opens an ops incident (page_incident), then returns -1. It never fails
--     silently and never raises into pg_cron without leaving a trace.
--   * public.media_library_flag_expired() now calls that function (same signature, same admin or service-role gate), so the admin button and the daily job
--     share one code path.
--   * pg_cron job 'media-library-expiry-sweep', daily at 02:25 Lagos time. pg_cron runs in UTC, so the schedule is '25 1 * * *' (Lagos is UTC+1, no daylight saving).
--   * public.media_library_expiry_sweep_health(): admin-only; the last run time and outcome read from cron.job_run_details, so the console can show a sweep that
--     has stopped. A missing job or a failed last run is reported, never hidden.
-- Rows affected on migrate: none (a job is scheduled; no data changes until an item passes its date).

create or replace function private.media_library_expiry_sweep() returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer; v_codes text[]; v_org uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  begin
    with moved as (
      update public.media_library set content_status = 'review_due', is_active = false
       where content_status = 'published' and next_review_due is not null and next_review_due <= (now() at time zone 'Africa/Lagos')::date
      returning code)
    select count(*), coalesce(array_agg(code order by code), '{}') into n, v_codes from moved;
    if n > 0 then
      insert into public.audit_log (organisation_id, action, entity_type, event)
      values (v_org, 'media_library.expired_flagged', 'media_library', jsonb_build_object('count', n, 'codes', to_jsonb(v_codes)));
    end if;
    return n;
  exception when others then
    begin
      insert into public.audit_log (organisation_id, action, entity_type, event)
      values (v_org, 'media_library_expiry.error', 'media_library', jsonb_build_object('error', sqlerrm));
      perform private.page_incident(v_org, 'media_library_expiry_failed:' || to_char(now() at time zone 'Africa/Lagos', 'YYYY-MM-DD'),
        'The wellbeing library expiry check failed', 'The daily check that moves out-of-date library items to review due failed; see audit_log action media_library_expiry.error. Patients are still protected: an item past its date is hidden by the read rule regardless.');
    exception when others then
      raise warning 'media library expiry sweep failed and could not be reported: %', sqlerrm;
    end;
    return -1;
  end;
end $$;
revoke all on function private.media_library_expiry_sweep() from public, anon, authenticated;
grant execute on function private.media_library_expiry_sweep() to service_role;

create or replace function public.media_library_flag_expired() returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  if not (private.is_admin() or coalesce((select auth.role()), '') = 'service_role') then raise exception 'not authorised' using errcode = '42501'; end if;
  n := private.media_library_expiry_sweep();
  if n < 0 then raise exception 'The expiry check failed; see the incident and audit log' using errcode = 'XX000'; end if;
  return n;
end $$;
revoke all on function public.media_library_flag_expired() from public, anon;
grant execute on function public.media_library_flag_expired() to authenticated, service_role;

create or replace function public.media_library_expiry_sweep_health() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_job bigint; r record;
begin
  if not private.is_admin() then raise exception 'not authorised' using errcode = '42501'; end if;
  select jobid into v_job from cron.job where jobname = 'media-library-expiry-sweep';
  if v_job is null then return jsonb_build_object('scheduled', false, 'last_run_at', null, 'last_status', null); end if;
  select start_time, status, return_message into r from cron.job_run_details where jobid = v_job order by start_time desc limit 1;
  return jsonb_build_object('scheduled', true, 'last_run_at', r.start_time, 'last_status', r.status, 'last_message', r.return_message);
end $$;
revoke all on function public.media_library_expiry_sweep_health() from public, anon;
grant execute on function public.media_library_expiry_sweep_health() to authenticated;

do $$ begin
  perform cron.unschedule('media-library-expiry-sweep');
exception when others then null;   -- not scheduled yet
end $$;
select cron.schedule('media-library-expiry-sweep', '25 1 * * *', $$select private.media_library_expiry_sweep();$$);

do $$
begin
  if not exists (select 1 from cron.job where jobname = 'media-library-expiry-sweep' and schedule = '25 1 * * *') then raise exception 'FAIL: the daily expiry job is not scheduled'; end if;
  if has_function_privilege('anon', 'private.media_library_expiry_sweep()', 'EXECUTE') or has_function_privilege('authenticated', 'private.media_library_expiry_sweep()', 'EXECUTE') then
    raise exception 'FAIL: the sweep is callable by anon or authenticated';
  end if;
  if has_function_privilege('anon', 'public.media_library_flag_expired()', 'EXECUTE') or has_function_privilege('anon', 'public.media_library_expiry_sweep_health()', 'EXECUTE') then
    raise exception 'FAIL: anon can run a library function';
  end if;
end $$;
