-- Tarragon Health — allow the scheduled cron job to run duplicate-patient
-- detection without an admin session.
--
-- run_patient_duplicate_detection() (mdm_duplicate_patient_detection.sql)
-- gated on private.is_admin(), which reads auth.uid() from the caller's
-- JWT — correct for an admin clicking a "detect duplicates" button, but
-- wrong for the periodic cron sweep this platform's own convention wires
-- up for every other batch job (see apps/web/src/lib/risk-reassessment/
-- run.ts, wired via api/cron/risk-reassessment + vercel.json): that job
-- calls Supabase through a service-role client, which PostgREST executes
-- as the Postgres `service_role` role, with no end-user JWT/auth.uid() at
-- all — private.is_admin() would always read false for it, permanently
-- locking the cron out.
--
-- Fix: also allow the call through when the CONNECTING POSTGRES ROLE
-- itself is service_role (current_user, not a JWT claim — set by
-- PostgREST from the service-role key, not forgeable by an authenticated
-- end user, who always connects as `authenticated`). This is narrower
-- than granting EXECUTE more broadly: an authenticated non-admin still
-- gets the exact same "only an admin may..." rejection as before.
create or replace function public.run_patient_duplicate_detection()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
begin
  if current_user <> 'service_role' and not private.is_admin() then
    raise exception 'only an admin (or the scheduled service-role job) may run duplicate-patient detection';
  end if;
  return private.detect_patient_match_candidates();
end;
$$;

do $$
begin
  if has_function_privilege('anon', 'public.run_patient_duplicate_detection()', 'EXECUTE') then
    raise exception 'FAIL: anon still holds EXECUTE on public.run_patient_duplicate_detection';
  end if;
end;
$$;
