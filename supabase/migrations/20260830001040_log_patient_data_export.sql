-- Tarragon Health
-- Data Governance gap-closure, item 7 of 7 (§87.8 DSAR export). Confirmed
-- live before writing this via pg_get_functiondef: private.log_care_access()
-- deliberately returns early "if v_actor is null or v_actor = p_patient" --
-- a patient acting on their own record is explicitly excluded, because
-- logging every patient dashboard view of their own data would be pure
-- noise. That guard is correct for its existing call sites, but it means
-- the DSAR self-export route (about to be built) cannot use
-- log_care_access() to record the one self-action that genuinely IS worth
-- an audit trail entry: a patient exporting the whole of their own record.
--
-- Rather than weaken log_care_access()'s guard for every caller, this adds
-- one narrowly-scoped SECURITY DEFINER function whose only job is logging a
-- patient's own data export -- kind is hardcoded to 'data_exported' so it
-- can't be repurposed into a general self-access logger by a future caller.

create or replace function private.log_patient_data_export(p_scope text default 'data_export_dsar')
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

comment on function private.log_patient_data_export(text) is
  '§87.8 DSAR export audit trail. Deliberately separate from private.log_care_access() -- that function''s "patient acting on own record" guard correctly suppresses noise for view/browse events, but a self-export is exactly the one self-action worth logging. kind is hardcoded to data_exported so this cannot be repurposed as a general self-access logger.';

revoke all on function private.log_patient_data_export(text) from public, anon;
grant execute on function private.log_patient_data_export(text) to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_proc where proname = 'log_patient_data_export' and pronamespace = 'private'::regnamespace
  ) then
    raise exception 'private.log_patient_data_export missing after migration';
  end if;
  if has_function_privilege('anon', 'private.log_patient_data_export(text)', 'EXECUTE') then
    raise exception 'anon must not hold EXECUTE on private.log_patient_data_export';
  end if;
  raise notice 'PASS: private.log_patient_data_export created, anon EXECUTE revoked, authenticated EXECUTE granted';
end $$;
