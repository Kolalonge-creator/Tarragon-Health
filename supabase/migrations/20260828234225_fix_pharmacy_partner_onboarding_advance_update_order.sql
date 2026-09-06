-- Tarragon Health -- fix admin_advance_pharmacy_partner_onboarding: the
-- 'approved' branch set is_active=true in its own UPDATE, separate from the
-- later generic `onboarding_status = v_next` UPDATE at the end of the
-- function. Between those two statements the row briefly had
-- is_active=true with onboarding_status still 'approved' (not yet
-- 'activated'), which pharmacy_partners_active_requires_activated_onboarding
-- rejects outright -- found by the end-to-end dry run
-- (packages/db/tests/pharmacy_engine_end_to_end.sql), not in production
-- (every real pharmacy_partners row is still is_active=false). Fixed by
-- moving the onboarding_status write before the per-stage evidence update,
-- so 'approved' -> 'activated' and is_active=true land in the same
-- observable state.

create or replace function public.admin_advance_pharmacy_partner_onboarding(p_partner_id uuid)
returns public.pharmacy_partner_onboarding_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current public.pharmacy_partner_onboarding_status;
  v_next    public.pharmacy_partner_onboarding_status;
  v_caller  uuid := (select auth.uid());
  v_has_verified_location boolean;
begin
  if not (private.is_admin() or private.has_permission('partners.pharmacies.manage')) then
    raise exception 'Only an admin can advance pharmacy partner onboarding' using errcode = '42501';
  end if;

  select onboarding_status into v_current
  from public.pharmacy_partners where id = p_partner_id
  for update;

  if v_current is null then
    raise exception 'Pharmacy partner not found' using errcode = '22023';
  end if;

  v_next := case v_current
    when 'application'             then 'business_verification'
    when 'business_verification'   then 'regulatory_verification'
    when 'regulatory_verification' then 'location_verification'
    when 'location_verification'   then 'service_configuration'
    when 'service_configuration'   then 'integration_testing'
    when 'integration_testing'     then 'approved'
    when 'approved'                then 'activated'
    else null
  end;

  if v_next is null then
    raise exception 'Pharmacy partner onboarding is already at a terminal stage (%)', v_current using errcode = '22023';
  end if;

  -- Evidence checks (read-only) happen before any write, same as before.
  if v_current = 'regulatory_verification' then
    if not exists (
      select 1 from public.pharmacy_partners
      where id = p_partner_id and license_verified_at is not null
    ) then
      raise exception 'Cannot advance: regulatory/professional license has not been verified (license_verified_at is null)' using errcode = '22023';
    end if;
  elsif v_current = 'location_verification' then
    select exists (
      select 1 from public.pharmacy_partner_locations
      where pharmacy_partner_id = p_partner_id and verified_at is not null
    ) into v_has_verified_location;
    if not v_has_verified_location then
      raise exception 'Cannot advance: no verified location on file (see admin_verify_pharmacy_partner_location)' using errcode = '22023';
    end if;
  elsif v_current = 'service_configuration' then
    if not exists (
      select 1 from public.pharmacy_partners
      where id = p_partner_id and contact_phone is not null and cardinality(regions) > 0
    ) then
      raise exception 'Cannot advance: contact_phone and at least one service region must be set first' using errcode = '22023';
    end if;
  end if;

  -- Status moves first, so a same-statement is_active=true (the 'approved'
  -- case, below) is never observed alongside a stale onboarding_status --
  -- that ordering is exactly what pharmacy_partners_active_requires_
  -- activated_onboarding checks.
  update public.pharmacy_partners
  set onboarding_status = v_next
  where id = p_partner_id;

  if v_current = 'business_verification' then
    update public.pharmacy_partners
    set business_verified_at = now(), business_verified_by = v_caller
    where id = p_partner_id;
  elsif v_current = 'service_configuration' then
    update public.pharmacy_partners
    set service_configured_at = now(), service_configured_by = v_caller
    where id = p_partner_id;
  elsif v_current = 'integration_testing' then
    update public.pharmacy_partners
    set integration_tested_at = now(), integration_tested_by = v_caller
    where id = p_partner_id;
  elsif v_current = 'approved' then
    update public.pharmacy_partners
    set approved_at = now(), approved_by = v_caller, is_active = true
    where id = p_partner_id;
  end if;

  return v_next;
end;
$$;

revoke execute on function public.admin_advance_pharmacy_partner_onboarding(uuid) from public;
revoke execute on function public.admin_advance_pharmacy_partner_onboarding(uuid) from anon;
grant execute on function public.admin_advance_pharmacy_partner_onboarding(uuid) to authenticated;

do $$
declare
  v_def text;
begin
  select pg_get_functiondef(oid) into v_def
  from pg_proc where proname = 'admin_advance_pharmacy_partner_onboarding' and pronamespace = 'public'::regnamespace;
  if v_def is null then
    raise exception 'FAIL: admin_advance_pharmacy_partner_onboarding missing';
  end if;
  raise notice 'PASS: admin_advance_pharmacy_partner_onboarding update-order fix applied';
end $$;
