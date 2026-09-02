-- Closes the corporate/HMO onboarding gap: organisations.type has carried
-- 'corporate' and 'hmo' values since 20260705211044, and the RBAC seed
-- (20260718230000) already defined orgs.corporate.manage / orgs.hmo.manage /
-- orgs.manage permission keys for exactly this ("Create and edit
-- employer/corporate organisations" / "...HMO organisations"), but nothing
-- ever called them — the only code path that inserts into organisations at
-- all is the signup-time default-consumer-org seed trigger. The whole built
-- corporate ((dashboard)/dashboard/corporate: roster manager, cohort/age-band
-- analytics, outcome reports) and HMO ((dashboard)/dashboard/hmo: claims
-- impact, care-gap panel) dashboard suite has had nothing to run against,
-- because a corporate_admin/hmo_admin login needs profiles.organisation_id
-- pointing at a real corporate/hmo org and there was no way to create one.
--
-- Mirrors admin_create_protocol_partner_org (20260802205424) — same shape,
-- same security-definer + explicit revoke-then-grant pattern, same
-- private.log_audit call — restricted to the two types this gap is actually
-- about rather than every organisation_type (clinic/lab/pharmacy partners are
-- provisioned through their own dedicated tables — lab_providers,
-- pharmacy_partners — not through organisations, so extending this to those
-- types would be solving a problem that doesn't exist).
create or replace function public.admin_create_institution_org(p_name text, p_type text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org_id uuid;
  v_required_perm text;
begin
  if p_type not in ('corporate', 'hmo') then
    raise exception 'p_type must be corporate or hmo';
  end if;
  v_required_perm := case p_type when 'corporate' then 'orgs.corporate.manage' else 'orgs.hmo.manage' end;

  if not (
    private.is_admin()
    or private.has_permission('orgs.manage')
    or private.has_permission(v_required_perm)
  ) then
    raise exception 'not authorised';
  end if;

  if p_name is null or length(trim(p_name)) < 2 then
    raise exception 'name is required';
  end if;

  insert into public.organisations (name, type)
  values (trim(p_name), p_type::public.organisation_type)
  returning id into v_org_id;

  perform private.log_audit('institution_org.created', 'organisations', v_org_id,
    jsonb_build_object('name', trim(p_name), 'type', p_type));

  return v_org_id;
end;
$$;

revoke all on function public.admin_create_institution_org(text, text) from public, anon;
grant execute on function public.admin_create_institution_org(text, text) to authenticated;
revoke execute on function public.admin_create_institution_org(text, text) from anon;

do $$
begin
  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'admin_create_institution_org'
  ) then
    raise exception 'admin_create_institution_org is missing';
  end if;

  if has_function_privilege('anon', 'public.admin_create_institution_org(text, text)', 'EXECUTE') then
    raise exception 'anon must not be able to create organisations — see feedback_supabase_anon_execute_gotcha memory: PUBLIC-inherited execute is the real leak, not a direct anon grant';
  end if;
end $$;
