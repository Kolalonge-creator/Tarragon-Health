-- CRITICAL SECURITY FIX, found while reconciling against the parallel tarragon-control build
-- of this same spec (which caught this independently — see its 0007_handle_new_user.sql).
--
-- private.handle_new_user() read role from new.raw_user_meta_data, which is CLIENT-SETTABLE:
-- any public signUp() call can pass options.data = { role: 'superadmin' } (or clinician,
-- ops_admin, institution_admin) and self-grant that role, since nothing validated it against
-- the caller's actual privilege. This is a full privilege-escalation hole -- every RLS policy
-- keyed on private.actor_role() (organisations, invoice_lines, subscriptions, wallets,
-- app_config writes, clinicians activation/update, etc.) would have trusted it.
--
-- Fix: read role ONLY from new.raw_app_meta_data, which is never client-settable -- it can only
-- be set by an admin/service-role call (supabase.auth.admin.createUser/updateUserById with
-- app_metadata). A public self-signup can now only ever produce role='patient'. Staff accounts
-- must be provisioned via the Admin API, matching the same convention already established for
-- clinician credential verification (ops/superadmin-only writes to `clinicians`).
create or replace function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into profiles (id, full_name, email, phone_e164, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', 'Unnamed'),
    new.email,
    new.raw_user_meta_data->>'phone_e164',
    coalesce((new.raw_app_meta_data->>'role')::user_role, 'patient')
  );
  return new;
end;
$$;

comment on function private.handle_new_user is
  'role is read ONLY from raw_app_meta_data (server/admin-API-settable), never raw_user_meta_data (client-settable) -- a public signup cannot grant itself a staff role by passing role in its own signup metadata. Fixed 2026-07-29, was previously reading raw_user_meta_data.';
