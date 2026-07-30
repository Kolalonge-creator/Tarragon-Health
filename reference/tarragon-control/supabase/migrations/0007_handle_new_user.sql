-- Tarragon Control — M2: auth.users -> profiles auto-provisioning
-- Source: docs/tarragon-build-spec-v3.md §5.2 ("extends auth.users") and
-- the M2 milestone name ("Auth, profiles..."). Not explicit DDL in the
-- spec -- the wiring between Supabase Auth and the profiles table is
-- assumed infrastructure, same pattern used throughout the existing
-- Tarragon Health platform's own handle_new_user() trigger.
--
-- Role assignment: a public self-signup (the patient app, apps/patient,
-- M7) can only ever produce role='patient' -- raw_user_meta_data is
-- client-settable, so it is never trusted for role. Staff accounts
-- (clinician/coordinator/ops_admin/institution_admin/superadmin) are
-- provisioned by an existing superadmin via the Auth Admin API, which
-- writes raw_app_meta_data (NOT client-settable). Only that field is
-- trusted for role.
--
-- Deliberately does NOT create a `patients` row here. patients.date_of_birth
-- and sex_at_birth are NOT NULL with no sensible default, and are not
-- known at signup time -- that data is collected in the onboarding flow
-- (M7, the patient app), which creates the patients row itself
-- (patients_insert_own already grants this from 0002_rls.sql).

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role user_role;
  v_full_name text;
begin
  v_role := coalesce(
    (new.raw_app_meta_data ->> 'role')::user_role,
    'patient'
  );

  v_full_name := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
    new.email,
    new.phone,
    'Unnamed'
  );

  insert into profiles (id, role, full_name, phone_e164, email)
  values (new.id, v_role, v_full_name, new.phone, new.email);

  return new;
end;
$$;

comment on function private.handle_new_user is
  'role is read ONLY from raw_app_meta_data (server/admin-API-settable), never raw_user_meta_data (client-settable) -- a public signup cannot grant itself a staff role by passing role in its own signup metadata.';

create trigger trg_handle_new_user
  after insert on auth.users
  for each row
  execute function private.handle_new_user();
