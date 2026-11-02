-- ===========================================================================
-- Fix: the two nightly MDM cron RPCs refused their own scheduled caller.
--
-- WHAT WAS WRONG
--   public.run_data_quality_scan() and public.run_patient_duplicate_detection() are SECURITY DEFINER and gated on
--     if current_user <> 'service_role' and not private.is_admin() then raise ...
--   Inside a SECURITY DEFINER function `current_user` is the function OWNER (postgres), never the caller, so the
--   service-role branch could never be true. The Vercel cron routes /api/cron/data-quality-scan and
--   /api/cron/patient-duplicate-detection (service-role client, no auth.uid()) have therefore failed with P0001
--   every night since 2026-09-25 (Vercel runtime errors, 3 occurrences a day, routes listed), and the §34.4 duplicate
--   detector and §34.14 data quality engine have not run on schedule.
--
-- FIX
--   Read the caller's role from the request JWT claim (auth.role()), which PostgREST sets to 'service_role' for a
--   service-role key. A session with no JWT at all (a direct connection as postgres / the migration runner) is
--   also allowed, as it bypasses RLS everywhere else. An authenticated non-admin is still refused.
--
-- Bodies redefined from the LIVE definitions (pg_get_functiondef, 2026-11-02), not from an older migration file.
-- ===========================================================================

-- The helper, defined first so the two gates below never reference a function that does not exist yet.
-- True for the service-role key (auth.role() reads the JWT role claim) and for a session with no JWT at all (postgres,
-- migration runner, pg_cron). False for anon and authenticated.
create or replace function private.is_service_role_or_no_jwt()
 returns boolean
 language sql
 stable
 security definer
 set search_path to ''
as $function$
  select coalesce(auth.role(), 'none') in ('service_role', 'none');
$function$;
revoke all on function private.is_service_role_or_no_jwt() from public, anon, authenticated;

create or replace function public.run_data_quality_scan()
 returns integer
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin
  if not private.is_service_role_or_no_jwt() and not private.is_admin() then
    raise exception 'only an admin (or the scheduled service-role job) may run the data quality scan';
  end if;
  return private.run_data_quality_scan();
end;
$function$;

create or replace function public.run_patient_duplicate_detection()
 returns integer
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin
  if not private.is_service_role_or_no_jwt() and not private.is_admin() then
    raise exception 'only an admin (or the scheduled service-role job) may run duplicate-patient detection';
  end if;
  return private.detect_patient_match_candidates();
end;
$function$;

do $$
begin
  if (select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'run_data_quality_scan') ~ 'current_user' then
    raise exception 'FAIL: run_data_quality_scan still reads current_user';
  end if;
  if (select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'run_patient_duplicate_detection') ~ 'current_user' then
    raise exception 'FAIL: run_patient_duplicate_detection still reads current_user';
  end if;
  if has_function_privilege('anon', 'public.run_data_quality_scan()', 'EXECUTE') then
    raise exception 'FAIL: anon holds EXECUTE on public.run_data_quality_scan';
  end if;
  if has_function_privilege('anon', 'public.run_patient_duplicate_detection()', 'EXECUTE') then
    raise exception 'FAIL: anon holds EXECUTE on public.run_patient_duplicate_detection';
  end if;
end $$;
