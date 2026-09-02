-- Tarragon Health — delegable permission for the notification template registry admin UI.
--
-- Companion to the Health Communication Engine migrations (notification_templates/
-- notification_template_locales, applied earlier this same session). Those shipped the
-- registry and its RLS (admin-only write) but nothing delegable — this adds the catalogue
-- entry so the capability can be handed to a non-super-admin the same way every other
-- admin surface already is (20260718230000_rbac_permissions.sql). The RLS itself already
-- reads private.is_admin() OR private.has_permission(...) is NOT yet true for this table —
-- see the follow-up policy update below, additive only (never narrows).

insert into public.permissions (key, label, category, description) values
  ('notification_templates.manage', 'Manage notification templates', 'Operations',
   'View and toggle the notification template registry, and approve clinically-sensitive templates')
on conflict (key) do nothing;

drop policy if exists notification_templates_select on public.notification_templates;
create policy notification_templates_select on public.notification_templates
  for select to authenticated using (true);
drop policy if exists notification_templates_insert on public.notification_templates;
create policy notification_templates_insert on public.notification_templates
  for insert to authenticated
  with check (private.is_admin() or private.has_permission('notification_templates.manage'));
drop policy if exists notification_templates_update on public.notification_templates;
create policy notification_templates_update on public.notification_templates
  for update to authenticated
  using (private.is_admin() or private.has_permission('notification_templates.manage'))
  with check (private.is_admin() or private.has_permission('notification_templates.manage'));
drop policy if exists notification_templates_delete on public.notification_templates;
create policy notification_templates_delete on public.notification_templates
  for delete to authenticated using (private.is_admin() or private.has_permission('notification_templates.manage'));
