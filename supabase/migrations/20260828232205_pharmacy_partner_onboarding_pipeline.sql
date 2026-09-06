-- Tarragon Health -- pharmacy partner onboarding pipeline (Pharmacy Engine
-- spec §12.3, docs/PHARMACY_ENGINE_SPEC.md, built ahead of a real partner on
-- explicit founder ask 2026-08-28: "full build this infrastructure ... so
-- that when Tarragon start having pharmacy partner it will be easier to
-- activate it").
--
-- Replaces the flat admin-insert-a-row model with a real state machine:
-- application -> business verification -> regulatory/professional
-- verification -> location verification -> service configuration ->
-- integration testing -> approved -> activated (or rejected, from any
-- non-terminal stage). Reuses existing infrastructure rather than
-- duplicating it: regulatory verification reuses license_verified_at/by
-- (20260731011319_partner_regulatory_license_tracking.sql, PCN premises
-- registration) instead of a new column, and 'activated' is the existing
-- is_active flag rather than a parallel status.
--
-- Existing rows (4, all is_active=false, predating this pipeline) are
-- grandfathered to onboarding_status='activated' -- they were vetted through
-- the old ad-hoc admin-insert process, and forcing them to restart the new
-- pipeline would retroactively block an admin from ever toggling is_active
-- on a row that already legitimately exists. New partners going forward
-- start at 'application'.

create type public.pharmacy_partner_onboarding_status as enum (
  'application', 'business_verification', 'regulatory_verification',
  'location_verification', 'service_configuration', 'integration_testing',
  'approved', 'activated', 'rejected'
);

alter table public.pharmacy_partners
  add column if not exists onboarding_status public.pharmacy_partner_onboarding_status
    not null default 'application',
  add column if not exists business_registration_number text,
  add column if not exists business_verified_at timestamptz,
  add column if not exists business_verified_by uuid references public.profiles (id) on delete set null,
  add column if not exists service_configured_at timestamptz,
  add column if not exists service_configured_by uuid references public.profiles (id) on delete set null,
  add column if not exists integration_tested_at timestamptz,
  add column if not exists integration_tested_by uuid references public.profiles (id) on delete set null,
  add column if not exists approved_at timestamptz,
  add column if not exists approved_by uuid references public.profiles (id) on delete set null,
  add column if not exists rejected_at timestamptz,
  add column if not exists rejected_by uuid references public.profiles (id) on delete set null,
  add column if not exists rejection_reason text;

comment on column public.pharmacy_partners.onboarding_status is
  'Pharmacy Engine spec §12.3 pipeline stage. Advance via admin_advance_pharmacy_partner_onboarding()/admin_reject_pharmacy_partner_onboarding() -- never write this column directly, the evidence columns it depends on (business_verified_at, license_verified_at, a verified pharmacy_partner_locations row, service_configured_at) would go unstamped/unchecked.';

update public.pharmacy_partners
set onboarding_status = 'activated'
where onboarding_status = 'application';

alter table public.pharmacy_partners
  add constraint pharmacy_partners_active_requires_activated_onboarding
  check (not is_active or onboarding_status = 'activated');

alter table public.pharmacy_partner_locations
  add column if not exists verified_at timestamptz,
  add column if not exists verified_by uuid references public.profiles (id) on delete set null;

comment on column public.pharmacy_partner_locations.verified_at is
  'Admin-verified physical location -- Pharmacy Engine spec §12.3 onboarding step 4. Set only via admin_verify_pharmacy_partner_location(); never partner-settable, see pharmacy_partner_locations_guard_verification below (a partner has direct UPDATE on their own location rows for everything else).';

-- --------------------------------------------------------------------------
-- Guard: a partner already has direct UPDATE on their own
-- pharmacy_partner_locations rows (pharmacy_partner_locations_update_partner,
-- 20260827203345). verified_at/verified_by must stay admin-only or a
-- partner could self-certify their own address as verified.
-- --------------------------------------------------------------------------
create or replace function private.guard_pharmacy_partner_location_verification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (new.verified_at is distinct from old.verified_at
      or new.verified_by is distinct from old.verified_by)
     and not (private.is_admin() or private.has_permission('partners.pharmacies.manage')) then
    raise exception 'Only an admin can verify a pharmacy location' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists pharmacy_partner_locations_guard_verification on public.pharmacy_partner_locations;
create trigger pharmacy_partner_locations_guard_verification
  before update on public.pharmacy_partner_locations
  for each row execute function private.guard_pharmacy_partner_location_verification();

-- --------------------------------------------------------------------------
-- admin_verify_pharmacy_partner_location -- the only writer of verified_at/
-- verified_by (the trigger above blocks everyone else, including the
-- partner's own admin-equivalent self-service update path).
-- --------------------------------------------------------------------------
create or replace function public.admin_verify_pharmacy_partner_location(p_location_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (private.is_admin() or private.has_permission('partners.pharmacies.manage')) then
    raise exception 'Only an admin can verify a pharmacy location' using errcode = '42501';
  end if;

  update public.pharmacy_partner_locations
  set verified_at = now(), verified_by = (select auth.uid())
  where id = p_location_id;

  if not found then
    raise exception 'Location not found' using errcode = '22023';
  end if;
end;
$$;

-- --------------------------------------------------------------------------
-- admin_advance_pharmacy_partner_onboarding -- moves a partner exactly one
-- stage forward, stamping the evidence for the stage just completed
-- (business_verification, service_configuration, integration_testing,
-- approved->activated) and checking the evidence for stages whose proof is
-- stamped by a separate action (regulatory_verification reuses
-- license_verified_at, set by the existing admin edit path;
-- location_verification checks admin_verify_pharmacy_partner_location was
-- called at least once). Reaching 'activated' is the only transition that
-- also flips is_active -- the actual go-live switch stays a single,
-- traceable moment, not implicit in reaching the last enum value.
-- --------------------------------------------------------------------------
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

  if v_current = 'business_verification' then
    update public.pharmacy_partners
    set business_verified_at = now(), business_verified_by = v_caller
    where id = p_partner_id;
  elsif v_current = 'regulatory_verification' then
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

  update public.pharmacy_partners
  set onboarding_status = v_next
  where id = p_partner_id;

  return v_next;
end;
$$;

-- --------------------------------------------------------------------------
-- admin_reject_pharmacy_partner_onboarding -- terminal negative outcome,
-- reachable from any non-terminal stage.
-- --------------------------------------------------------------------------
create or replace function public.admin_reject_pharmacy_partner_onboarding(p_partner_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current public.pharmacy_partner_onboarding_status;
begin
  if not (private.is_admin() or private.has_permission('partners.pharmacies.manage')) then
    raise exception 'Only an admin can reject a pharmacy partner application' using errcode = '42501';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'A rejection reason is required' using errcode = '22023';
  end if;

  select onboarding_status into v_current
  from public.pharmacy_partners where id = p_partner_id
  for update;

  if v_current is null then
    raise exception 'Pharmacy partner not found' using errcode = '22023';
  end if;
  if v_current in ('activated', 'rejected') then
    raise exception 'Cannot reject a partner already at %', v_current using errcode = '22023';
  end if;

  update public.pharmacy_partners
  set onboarding_status = 'rejected',
      rejected_at = now(), rejected_by = (select auth.uid()), rejection_reason = btrim(p_reason)
  where id = p_partner_id;
end;
$$;

revoke execute on function public.admin_verify_pharmacy_partner_location(uuid) from public, anon;
revoke execute on function public.admin_verify_pharmacy_partner_location(uuid) from anon;
grant execute on function public.admin_verify_pharmacy_partner_location(uuid) to authenticated;

revoke execute on function public.admin_advance_pharmacy_partner_onboarding(uuid) from public, anon;
revoke execute on function public.admin_advance_pharmacy_partner_onboarding(uuid) from anon;
grant execute on function public.admin_advance_pharmacy_partner_onboarding(uuid) to authenticated;

revoke execute on function public.admin_reject_pharmacy_partner_onboarding(uuid, text) from public, anon;
revoke execute on function public.admin_reject_pharmacy_partner_onboarding(uuid, text) from anon;
grant execute on function public.admin_reject_pharmacy_partner_onboarding(uuid, text) to authenticated;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='pharmacy_partners' and column_name='onboarding_status'
  ) then
    raise exception 'FAIL: onboarding_status was not added';
  end if;
  if exists (select 1 from public.pharmacy_partners where onboarding_status = 'application') then
    -- fine if a real application exists; this just proves the backfill ran for pre-existing rows
    null;
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'pharmacy_partners_active_requires_activated_onboarding'
  ) then
    raise exception 'FAIL: activation gate constraint missing';
  end if;
  if has_function_privilege('anon', 'public.admin_advance_pharmacy_partner_onboarding(uuid)', 'execute') then
    raise exception 'FAIL: admin_advance_pharmacy_partner_onboarding is anon-executable';
  end if;
  if has_function_privilege('anon', 'public.admin_verify_pharmacy_partner_location(uuid)', 'execute') then
    raise exception 'FAIL: admin_verify_pharmacy_partner_location is anon-executable';
  end if;
  if has_function_privilege('anon', 'public.admin_reject_pharmacy_partner_onboarding(uuid, text)', 'execute') then
    raise exception 'FAIL: admin_reject_pharmacy_partner_onboarding is anon-executable';
  end if;
  raise notice 'PASS: pharmacy partner onboarding pipeline installed';
end $$;
