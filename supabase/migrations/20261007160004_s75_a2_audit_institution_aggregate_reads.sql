-- S75 A2: audit the legacy corporate and HMO aggregate reads.
--
-- The dashboards behind apps/web/src/lib/institutions/aggregate-access.ts read aggregate figures through a
-- service-role client after an application-level role check. Nothing recorded that an institution administrator
-- (or a platform admin looking at one) had read an organisation's aggregates. S38e/S38f already write
-- private.log_audit rows for the sponsor surfaces; this does the same for the legacy path.
--
-- public.log_institution_aggregate_read(p_organisation_id, p_surface) is called by the app under the CALLER's own
-- session (so auth.uid() is the real reader). It:
--   * refuses anyone who is not a platform admin or the hmo_admin / corporate_admin of that organisation;
--   * accepts only a short lowercase label for the surface (no free text, so no health data can be written);
--   * writes ONE audit row per reader, organisation and surface per Lagos day (volume: dashboards re-render often,
--     and the question an auditor asks is who looked at which organisation's figures on which day, not how many
--     times a page was refreshed). The row holds only who (actor), which organisation, which surface and the day.
-- Returns true when a row was written, false when one already existed for that day.

create or replace function public.log_institution_aggregate_read(p_organisation_id uuid, p_surface text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := (select auth.uid());
  v_role public.user_role;
  v_org uuid;
  v_day text := to_char((now() at time zone 'Africa/Lagos')::date, 'YYYY-MM-DD');
begin
  if v_caller is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  select role, organisation_id into v_role, v_org from public.profiles where id = v_caller;
  if v_role is null
     or not (v_role = 'admin' or (v_role in ('hmo_admin', 'corporate_admin') and v_org = p_organisation_id)) then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  if p_surface is null or p_surface !~ '^[a-z][a-z_]{2,39}$' then
    raise exception 'invalid surface label';
  end if;

  if exists (
    select 1 from public.audit_log
    where actor_id = v_caller and action = 'institution.aggregate_read' and entity_id = p_organisation_id
      and event ->> 'surface' = p_surface and event ->> 'day' = v_day
  ) then
    return false;
  end if;

  perform private.log_audit('institution.aggregate_read', 'organisation', p_organisation_id,
    jsonb_build_object('surface', p_surface, 'day', v_day, 'reader_role', v_role::text));
  return true;
end $$;

revoke all on function public.log_institution_aggregate_read(uuid, text) from public, anon;
grant execute on function public.log_institution_aggregate_read(uuid, text) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.log_institution_aggregate_read(uuid,text)', 'EXECUTE') then
    raise exception 'FAIL: anon must not execute log_institution_aggregate_read';
  end if;
  if not has_function_privilege('authenticated', 'public.log_institution_aggregate_read(uuid,text)', 'EXECUTE') then
    raise exception 'FAIL: authenticated must execute log_institution_aggregate_read';
  end if;
  raise notice 'PASS: S75 A2 aggregate read audit function in place';
end $$;
