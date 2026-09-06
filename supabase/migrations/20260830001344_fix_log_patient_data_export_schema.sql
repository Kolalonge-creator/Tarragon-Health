-- Tarragon Health
-- Bug fix, caught live by packages/db/tests/data_governance_rls.sql check 9
-- before this ever reached app code: private.log_patient_data_export()
-- (20260830001012) was created in the `private` schema, but `authenticated`
-- has no USAGE grant on `private` at all (confirmed live:
-- has_schema_privilege('authenticated', 'private', 'USAGE') = false) --
-- this platform's actual convention is that `private` holds internal-only
-- helpers reachable solely from triggers or from a `public.`-schema RPC
-- wrapper (see public.promote_protocol_draft() wrapping
-- private.stamp_protocol_version_approver()), never called directly by an
-- authenticated client. A DSAR export route calling this via
-- supabase.rpc('log_patient_data_export') would have failed with
-- "permission denied for schema private" in production.
--
-- Fix: move the function to the public schema, matching every other
-- client-callable RPC in this codebase. Logic is unchanged.

drop function if exists private.log_patient_data_export(text);

create or replace function public.log_patient_data_export(p_scope text default 'data_export_dsar')
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_patient uuid := (select auth.uid());
  v_org uuid;
begin
  if v_patient is null then
    return;
  end if;

  select organisation_id into v_org from public.profiles where id = v_patient;
  if v_org is null then
    return;
  end if;

  insert into public.care_access_events
    (organisation_id, patient_id, actor_profile_id, subject_profile_id, kind, scope, metadata)
  values
    (v_org, v_patient, v_patient, v_patient, 'data_exported', p_scope, '{}'::jsonb);
exception
  when others then
    raise warning 'DSAR export log failed for patient %: %', v_patient, sqlerrm;
end;
$function$;

comment on function public.log_patient_data_export(text) is
  '§87.8 DSAR export audit trail. Deliberately separate from private.log_care_access() -- that function''s "patient acting on own record" guard correctly suppresses noise for view/browse events, but a self-export is exactly the one self-action worth logging. kind is hardcoded to data_exported so this cannot be repurposed as a general self-access logger. Lives in public (not private) so an authenticated client can call it directly via supabase.rpc() -- corrected from an initial private-schema placement that authenticated has no USAGE grant for.';

revoke all on function public.log_patient_data_export(text) from public, anon;
grant execute on function public.log_patient_data_export(text) to authenticated;

do $$
begin
  if exists (
    select 1 from pg_proc where proname = 'log_patient_data_export' and pronamespace = 'private'::regnamespace
  ) then
    raise exception 'private.log_patient_data_export still exists -- drop failed';
  end if;
  if not exists (
    select 1 from pg_proc where proname = 'log_patient_data_export' and pronamespace = 'public'::regnamespace
  ) then
    raise exception 'public.log_patient_data_export missing after migration';
  end if;
  if not has_function_privilege('authenticated', 'public.log_patient_data_export(text)', 'EXECUTE') then
    raise exception 'authenticated does not hold EXECUTE on public.log_patient_data_export -- a client rpc() call would fail';
  end if;
  if has_function_privilege('anon', 'public.log_patient_data_export(text)', 'EXECUTE') then
    raise exception 'anon must not hold EXECUTE on public.log_patient_data_export';
  end if;
  raise notice 'PASS: log_patient_data_export moved to public schema, authenticated can execute, anon cannot';
end $$;
