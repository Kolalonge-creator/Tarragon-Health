-- Tarragon Health — fix private.handle_new_user() correctness bugs
--
-- Two live bugs in the deployed trigger (found auditing the not-yet-built
-- staff/clinician invite path):
--
-- 1. GoTrue's admin.createUser({ phone }) stores auth.users.phone WITHOUT
--    the leading '+' (E.164 digits only, matching SMS-provider convention).
--    handle_new_user() copied that raw value straight into profiles.phone,
--    which fails profiles_phone_e164's `^\+...` check — normalize here.
--
-- 2. When an admin provisions a staff/clinician account via createUser()
--    then a follow-up admin.updateUserById(id, { app_metadata }) call (the
--    standard two-step pattern when role/org aren't known at creation time),
--    the on_auth_user_created trigger has already fired against the OLD,
--    empty raw_app_meta_data — so role/organisation_id silently default to
--    'patient' / the direct-consumer org instead of the intended values.
--    Fix: a second trigger re-syncs profiles.role/organisation_id whenever
--    auth.users.raw_app_meta_data changes after the row already exists.

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, role, organisation_id, full_name, phone)
  values (
    new.id,
    coalesce((new.raw_app_meta_data ->> 'role')::public.user_role, 'patient'),
    coalesce(
      (new.raw_app_meta_data ->> 'organisation_id')::uuid,
      '00000000-0000-0000-0000-000000000001'
    ),
    new.raw_user_meta_data ->> 'full_name',
    case
      when new.phone is null or new.phone = '' then null
      when new.phone ~ '^\+' then new.phone
      else '+' || new.phone
    end
  );
  return new;
end;
$$;

-- Re-syncs role/organisation_id onto the already-provisioned profile when
-- app_metadata is set or changed after the auth.users row was created (the
-- on_auth_user_created trigger only sees a snapshot at insert time).
-- Only touches the keys actually present in the new metadata, so unrelated
-- app_metadata writes (or one that only sets role, not org, etc.) don't
-- clobber a value the profile already has.
create or replace function private.sync_user_profile_from_metadata()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles
  set
    role = coalesce((new.raw_app_meta_data ->> 'role')::public.user_role, role),
    organisation_id = coalesce(
      (new.raw_app_meta_data ->> 'organisation_id')::uuid,
      organisation_id
    )
  where id = new.id
    and (new.raw_app_meta_data ? 'role' or new.raw_app_meta_data ? 'organisation_id');
  return new;
end;
$$;

drop trigger if exists on_auth_user_metadata_updated on auth.users;

create trigger on_auth_user_metadata_updated
  after update of raw_app_meta_data on auth.users
  for each row
  when (old.raw_app_meta_data is distinct from new.raw_app_meta_data)
  execute function private.sync_user_profile_from_metadata();
