-- Usage log for the Protocol API (founder ask, 2026-07-31): "license or
-- API-expose the escalation/risk/protocol machinery to smaller providers".
-- Every call to /api/protocol-api/v1/* logs one row here (best-effort,
-- non-blocking, same discipline as api_keys.last_used_at) -- the foundation
-- any future usage-based billing needs, and today's "how much is this
-- partner actually using it" signal for account management.
--
-- No insert policy -- the route handlers write via the service role, same
-- as every other write-only-from-server table in this codebase.

create table if not exists public.protocol_api_usage_log (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id),
  api_key_id       uuid not null references public.api_keys (id),
  endpoint         text not null,
  called_at        timestamptz not null default now()
);

create index if not exists protocol_api_usage_log_org_idx
  on public.protocol_api_usage_log (organisation_id, called_at desc);
create index if not exists protocol_api_usage_log_key_idx
  on public.protocol_api_usage_log (api_key_id, called_at desc);

alter table public.protocol_api_usage_log enable row level security;

-- Org-scoped self-serve read, same shape as api_keys_select -- if a
-- protocol_partner org ever gets its own logged-in staff, they can see
-- their own usage. Tarragon's own admin (a different org) reaches ALL
-- partners' usage through the admin_* RPCs below, not this policy.
create policy protocol_api_usage_log_select on public.protocol_api_usage_log
  for select using (
    organisation_id = private.current_org_id()
    and (private.is_admin() or private.has_permission('integrations.manage'))
  );

grant select on public.protocol_api_usage_log to authenticated;

do $$
begin
  if not has_table_privilege('authenticated', 'public.protocol_api_usage_log', 'SELECT') then
    raise exception 'protocol_api_usage_log: authenticated grant did not take';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Cross-org admin RPCs. Every existing api_keys/partner_integrations RLS
-- policy requires organisation_id = current_org_id() -- correct for a
-- partner org's OWN staff self-serving their OWN integrations, but wrong
-- for THIS use case: an external NGO/PHC licensee typically has no Tarragon
-- login at all, so Tarragon's own admin (a different org) must be able to
-- create the partner org, issue its key, and see its usage on their behalf.
-- Same "admin acts across org boundary via a narrowly-scoped SECURITY
-- DEFINER RPC" pattern as admin_link_lab_partner (20260730215245).
--
-- Every RPC here is narrowly scoped to the protocol-partner shape
-- specifically -- structural, not just app-layer convention -- so this
-- surface can never become a general cross-org backdoor for issuing a
-- device_readings:write key or creating a clinic/HMO org.
-- ---------------------------------------------------------------------------

create or replace function public.admin_create_protocol_partner_org(p_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org_id uuid;
begin
  if not (private.is_admin() or private.has_permission('integrations.manage')) then
    raise exception 'not authorised';
  end if;
  if p_name is null or length(trim(p_name)) < 2 then
    raise exception 'name is required';
  end if;

  insert into public.organisations (name, type)
  values (trim(p_name), 'protocol_partner')
  returning id into v_org_id;

  perform private.log_audit('protocol_api.partner_org.created', 'organisations', v_org_id,
    jsonb_build_object('name', trim(p_name)));

  return v_org_id;
end;
$$;

revoke all on function public.admin_create_protocol_partner_org(text) from public;
grant execute on function public.admin_create_protocol_partner_org(text) to authenticated;
revoke execute on function public.admin_create_protocol_partner_org(text) from anon;

create or replace function public.admin_list_protocol_partners()
returns table (
  organisation_id uuid,
  name text,
  created_at timestamptz,
  active_key_count bigint,
  calls_last_30_days bigint,
  last_called_at timestamptz
)
language sql
security definer
set search_path = ''
as $$
  select
    o.id,
    o.name,
    o.created_at,
    (select count(*) from public.api_keys k
       where k.organisation_id = o.id and k.revoked_at is null) as active_key_count,
    (select count(*) from public.protocol_api_usage_log u
       where u.organisation_id = o.id and u.called_at >= now() - interval '30 days') as calls_last_30_days,
    (select max(u.called_at) from public.protocol_api_usage_log u
       where u.organisation_id = o.id) as last_called_at
  from public.organisations o
  where o.type = 'protocol_partner'
    and (private.is_admin() or private.has_permission('integrations.manage'))
  order by o.created_at desc;
$$;

revoke all on function public.admin_list_protocol_partners() from public;
grant execute on function public.admin_list_protocol_partners() to authenticated;
revoke execute on function public.admin_list_protocol_partners() from anon;

create or replace function public.admin_issue_protocol_api_key(
  p_organisation_id uuid,
  p_name            text,
  p_key_prefix      text,
  p_key_hash        text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key_id uuid;
  v_org_type public.organisation_type;
begin
  if not (private.is_admin() or private.has_permission('integrations.manage')) then
    raise exception 'not authorised';
  end if;

  select type into v_org_type from public.organisations where id = p_organisation_id;
  if v_org_type is null then
    raise exception 'organisation not found';
  end if;
  if v_org_type <> 'protocol_partner' then
    raise exception 'this RPC only issues keys for protocol_partner organisations';
  end if;
  if p_name is null or length(trim(p_name)) < 2 then
    raise exception 'name is required';
  end if;

  -- Scopes are hardcoded, never caller-supplied -- this RPC can never be
  -- used to mint a device_readings:write (or any other) key. A protocol
  -- partner org gets exactly one scope, always.
  insert into public.api_keys (organisation_id, name, key_prefix, key_hash, scopes, created_by)
  values (p_organisation_id, trim(p_name), p_key_prefix, p_key_hash, array['protocol_api:classify'], (select auth.uid()))
  returning id into v_key_id;

  perform private.log_audit('protocol_api.key.issued', 'api_keys', v_key_id,
    jsonb_build_object('organisation_id', p_organisation_id, 'key_prefix', p_key_prefix));

  return v_key_id;
end;
$$;

revoke all on function public.admin_issue_protocol_api_key(uuid, text, text, text) from public;
grant execute on function public.admin_issue_protocol_api_key(uuid, text, text, text) to authenticated;
revoke execute on function public.admin_issue_protocol_api_key(uuid, text, text, text) from anon;

create or replace function public.admin_revoke_protocol_api_key(p_key_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (private.is_admin() or private.has_permission('integrations.manage')) then
    raise exception 'not authorised';
  end if;

  update public.api_keys
  set revoked_at = now()
  where id = p_key_id
    and revoked_at is null
    and scopes = array['protocol_api:classify'];

  perform private.log_audit('protocol_api.key.revoked', 'api_keys', p_key_id, '{}'::jsonb);
end;
$$;

revoke all on function public.admin_revoke_protocol_api_key(uuid) from public;
grant execute on function public.admin_revoke_protocol_api_key(uuid) to authenticated;
revoke execute on function public.admin_revoke_protocol_api_key(uuid) from anon;

create or replace function public.admin_list_protocol_api_keys(p_organisation_id uuid)
returns table (
  id uuid,
  name text,
  key_prefix text,
  created_at timestamptz,
  last_used_at timestamptz,
  revoked_at timestamptz
)
language sql
security definer
set search_path = ''
as $$
  select k.id, k.name, k.key_prefix, k.created_at, k.last_used_at, k.revoked_at
  from public.api_keys k
  where k.organisation_id = p_organisation_id
    and k.scopes = array['protocol_api:classify']
    and (private.is_admin() or private.has_permission('integrations.manage'))
  order by k.created_at desc;
$$;

revoke all on function public.admin_list_protocol_api_keys(uuid) from public;
grant execute on function public.admin_list_protocol_api_keys(uuid) to authenticated;
revoke execute on function public.admin_list_protocol_api_keys(uuid) from anon;

-- Confirm anon is genuinely denied on every new function -- the corrected
-- form (revoke from PUBLIC, not just anon) per this codebase's own
-- documented gotcha (feedback_supabase_anon_execute_gotcha).
do $$
begin
  if has_function_privilege('anon', 'public.admin_create_protocol_partner_org(text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.admin_list_protocol_partners()', 'EXECUTE')
     or has_function_privilege('anon', 'public.admin_issue_protocol_api_key(uuid, text, text, text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.admin_revoke_protocol_api_key(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.admin_list_protocol_api_keys(uuid)', 'EXECUTE')
  then
    raise exception 'protocol_api admin RPCs: anon is still EXECUTE-able';
  end if;
end $$;
