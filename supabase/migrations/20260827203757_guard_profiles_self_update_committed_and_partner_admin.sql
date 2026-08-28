create or replace function private.guard_profiles_self_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_is_self_direct_edit boolean;
begin
  if pg_trigger_depth() > 1 then
    return new;
  end if;

  v_is_self_direct_edit :=
    (select auth.uid()) is not null
    and (select auth.uid()) = old.id
    and not private.is_admin()
    and not (old.organisation_id is not null and private.is_org_staff(old.organisation_id));

  if not v_is_self_direct_edit then
    return new;
  end if;

  if new.role is distinct from old.role then
    raise exception 'profiles.role cannot be changed by the account owner';
  end if;
  if new.organisation_id is distinct from old.organisation_id then
    raise exception 'profiles.organisation_id cannot be changed by the account owner';
  end if;
  if new.patient_number is distinct from old.patient_number then
    raise exception 'profiles.patient_number cannot be changed by the account owner';
  end if;
  if new.staff_number is distinct from old.staff_number then
    raise exception 'profiles.staff_number cannot be changed by the account owner';
  end if;
  if new.custom_role_id is distinct from old.custom_role_id then
    raise exception 'profiles.custom_role_id cannot be changed by the account owner';
  end if;
  if new.is_active is distinct from old.is_active then
    raise exception 'profiles.is_active cannot be changed by the account owner';
  end if;
  if new.is_dependent_account is distinct from old.is_dependent_account then
    raise exception 'profiles.is_dependent_account cannot be changed by the account owner';
  end if;
  if new.account_purpose is distinct from old.account_purpose then
    raise exception 'profiles.account_purpose cannot be changed by the account owner';
  end if;
  if new.identity_verified_at is distinct from old.identity_verified_at then
    raise exception 'profiles.identity_verified_at cannot be changed by the account owner';
  end if;
  if new.hbv_status is distinct from old.hbv_status then
    raise exception 'profiles.hbv_status cannot be changed by the account owner';
  end if;
  if new.hcv_status is distinct from old.hcv_status then
    raise exception 'profiles.hcv_status cannot be changed by the account owner';
  end if;
  if new.hiv_status is distinct from old.hiv_status then
    raise exception 'profiles.hiv_status cannot be changed by the account owner';
  end if;
  if new.lab_provider_id is distinct from old.lab_provider_id then
    raise exception 'profiles.lab_provider_id cannot be changed by the account owner';
  end if;
  if new.pharmacy_partner_id is distinct from old.pharmacy_partner_id then
    raise exception 'profiles.pharmacy_partner_id cannot be changed by the account owner';
  end if;
  if new.is_partner_admin is distinct from old.is_partner_admin then
    raise exception 'profiles.is_partner_admin cannot be changed by the account owner';
  end if;
  if new.created_at is distinct from old.created_at then
    raise exception 'profiles.created_at cannot be changed by the account owner';
  end if;

  return new;
end;
$function$;

comment on function private.guard_profiles_self_update() is
  'Blocks a signed-in user from self-editing their own privileged profiles columns (role, organisation_id, lab_provider_id, pharmacy_partner_id, is_partner_admin, custom_role_id, is_active, is_dependent_account, account_purpose, patient_number, staff_number, identity_verified_at, hbv/hcv/hiv_status, created_at) via the broad self-row profiles_update RLS policy. Org staff editing another profile in their own org, or an admin, are exempt (they go through the intended admin-gated app-layer flows). Recommitted 2026-08-27 after being found live with no prior migration record; extended the same day to cover is_partner_admin.';

drop trigger if exists profiles_guard_self_update on public.profiles;
create trigger profiles_guard_self_update
  before update on public.profiles
  for each row execute function private.guard_profiles_self_update();

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.profiles'::regclass
      and tgname = 'profiles_guard_self_update'
      and not tgisinternal
  ) then
    raise exception 'profiles_guard_self_update trigger missing';
  end if;

  if (select pg_get_functiondef(oid) from pg_proc where proname = 'guard_profiles_self_update' and pronamespace = 'private'::regnamespace)
     not ilike '%is_partner_admin%' then
    raise exception 'FAIL: guard_profiles_self_update does not guard is_partner_admin';
  end if;

  raise notice 'PASS: profiles_guard_self_update committed to migration history and extended to guard is_partner_admin';
end $$;
