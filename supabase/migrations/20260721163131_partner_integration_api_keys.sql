-- Partner integration layer, inbound + outbound (explicit founder ask):
--
-- 1. public.api_keys — org-scoped credentials a partner/device-cloud uses to
--    push data INTO TarragonHealth (Authorization: Bearer th_live_...).
--    Only a SHA-256 hash is stored — the full key is shown once at issue
--    time and is unrecoverable afterwards. Scoped (scopes text[]) and
--    revocable, never deleted (audit trail).
-- 2. public.partner_integrations — registry of OUTBOUND partner platforms
--    TarragonHealth calls (base URL + auth header + secret), admin-managed.
--    Server-side code reads it via the service role; RLS is admin-only in
--    both directions so a partner credential never reaches a non-admin
--    session.
--
-- Both gates follow the RBAC pattern: is_admin() OR the dedicated
-- has_permission key, so the super admin can delegate integration
-- management without granting full admin.

create table if not exists public.api_keys (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id),
  name             text not null,
  key_prefix       text not null,
  key_hash         text not null unique,
  scopes           text[] not null default '{device_readings:write}',
  created_by       uuid references public.profiles (id),
  created_at       timestamptz not null default now(),
  last_used_at     timestamptz,
  revoked_at       timestamptz
);

create index if not exists api_keys_org_idx on public.api_keys (organisation_id);

alter table public.api_keys enable row level security;

create policy api_keys_select on public.api_keys
  for select using (
    organisation_id = private.current_org_id()
    and (private.is_admin() or private.has_permission('integrations.manage'))
  );

create policy api_keys_insert on public.api_keys
  for insert with check (
    organisation_id = private.current_org_id()
    and (private.is_admin() or private.has_permission('integrations.manage'))
  );

create policy api_keys_update on public.api_keys
  for update using (
    organisation_id = private.current_org_id()
    and (private.is_admin() or private.has_permission('integrations.manage'))
  );

create table if not exists public.partner_integrations (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id),
  name             text not null,
  base_url         text not null,
  -- Header the partner expects the credential in (e.g. Authorization,
  -- X-API-Key). The stored secret is sent verbatim as its value, so an
  -- "Authorization: Bearer xyz" partner stores secret "Bearer xyz".
  auth_header      text not null default 'Authorization',
  secret           text,
  notes            text,
  is_active        boolean not null default true,
  last_checked_at  timestamptz,
  last_check_ok    boolean,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists partner_integrations_org_idx on public.partner_integrations (organisation_id);

alter table public.partner_integrations enable row level security;

create policy partner_integrations_select on public.partner_integrations
  for select using (
    organisation_id = private.current_org_id()
    and (private.is_admin() or private.has_permission('integrations.manage'))
  );

create policy partner_integrations_insert on public.partner_integrations
  for insert with check (
    organisation_id = private.current_org_id()
    and (private.is_admin() or private.has_permission('integrations.manage'))
  );

create policy partner_integrations_update on public.partner_integrations
  for update using (
    organisation_id = private.current_org_id()
    and (private.is_admin() or private.has_permission('integrations.manage'))
  );

create policy partner_integrations_delete on public.partner_integrations
  for delete using (
    organisation_id = private.current_org_id()
    and (private.is_admin() or private.has_permission('integrations.manage'))
  );

insert into public.permissions (key, label, category, description) values
  ('integrations.manage', 'Manage integrations', 'Integrations',
   'Issue/revoke inbound API keys and manage outbound partner connections')
on conflict (key) do nothing;
