-- Tarragon Health — delegable permission for the AI governance admin console (spec 97.19).
--
-- public.set_ai_system_enabled() already gates the actual kill-switch action to an admin
-- or an active Clinical Director — that RPC-level check is the real authorization boundary
-- and is untouched here. This permission key only controls whether the admin nav shows the
-- page/tile to a non-super-admin, same pattern as every other admin surface in
-- public.permissions (20260718230000_rbac_permissions.sql).

insert into public.permissions (key, label, category, description) values
  ('ai_governance.manage', 'AI governance console', 'Clinical',
   'View the AI governance dashboard and operate the AI system kill switch')
on conflict (key) do nothing;
