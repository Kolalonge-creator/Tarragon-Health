-- Tarragon Health — delegable permission for suspending/reinstating a staff or partner login.
--
-- Pairs with 20260925093444_enforce_profiles_is_active_in_core_authz.sql, which made
-- profiles.is_active actually mean something (is_org_staff/is_admin/has_permission all
-- gate on it now). This migration adds the permission key so the app layer can gate a
-- new "Suspend"/"Reinstate" action on /admin/settings/members: previously there was no
-- key for it at all, only users.provision, users.roles.assign, users.contact.edit, and
-- users.permissions.grant — none of which is the right fit (suspending isn't
-- provisioning, isn't a role change, and isn't a contact edit).

insert into public.permissions (key, label, category, description) values
  ('users.suspend', 'Suspend / reinstate logins', 'Users',
   'Deactivate a staff or partner login when their tenure ends (blocks sign-in-derived access via is_org_staff/is_admin/has_permission), and reinstate it when they return. Distinct from clinical_staff.manage, which only controls a doctor''s clinical authority, not their login.')
on conflict (key) do nothing;
