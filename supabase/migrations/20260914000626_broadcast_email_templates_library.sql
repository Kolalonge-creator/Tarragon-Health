-- Saved-template library for the broadcast composer's branded email design
-- (headline/image/band-color/button/footer note — the BroadcastEmailContent
-- shape). Investigated apps/web/src/app/(dashboard)/admin/settings/
-- notification-templates/ first per the build brief: that page/table
-- (notification_templates + notification_template_locales) catalogues the
-- ~25 hardcoded SYSTEM notification templates the platform sends
-- automatically (vaccination_due, medication_refill_reminder, etc.) — a
-- different concern from an admin saving their own one-off broadcast email
-- layout for reuse. Building a separate, small table here rather than
-- overloading that one.
create table public.broadcast_email_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid not null references public.profiles(id) on delete restrict,
  content jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.broadcast_email_templates is
  'Admin-authored, reusable email designs for the broadcast composer (the BroadcastEmailContent shape: headline/bodyText/imageUrl/bandColor/buttonText/buttonUrl/footerNote). Distinct from notification_templates (the ~25 hardcoded system notification templates) — this is for an admin''s own saved layouts. RLS mirrors notification_broadcasts exactly.';

alter table public.broadcast_email_templates enable row level security;

create policy broadcast_email_templates_select on public.broadcast_email_templates
  for select to authenticated using (private.is_admin());
create policy broadcast_email_templates_insert on public.broadcast_email_templates
  for insert to authenticated with check (private.is_admin() and created_by = (select auth.uid()));
create policy broadcast_email_templates_update on public.broadcast_email_templates
  for update to authenticated using (private.is_admin()) with check (private.is_admin());
create policy broadcast_email_templates_delete on public.broadcast_email_templates
  for delete to authenticated using (private.is_admin());

-- RLS restricts rows; it does not grant table-level access (standing gotcha
-- in this codebase) — explicit grant required for a freshly created table.
grant select, insert, update, delete on public.broadcast_email_templates to authenticated;

create trigger broadcast_email_templates_set_updated_at
  before update on public.broadcast_email_templates
  for each row execute function private.set_updated_at();

do $$
begin
  if not exists (
    select 1 from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'broadcast_email_templates'
      and grantee = 'authenticated' and privilege_type = 'SELECT'
  ) then
    raise exception 'authenticated grant missing on broadcast_email_templates';
  end if;
  if exists (
    select 1 from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'broadcast_email_templates'
      and grantee = 'anon'
  ) then
    raise exception 'anon must never be granted on broadcast_email_templates';
  end if;
end $$;
