-- Community Agents, part 1: role + core table.
--
-- Revenue-architecture spec §12: recruit people with standing in a community
-- (a nurse, a pharmacy attendant, a church health-unit volunteer, a market
-- association secretary) to sell care and earn a fixed naira commission per
-- COMPLETED order, paid weekly. This is a commercial distribution role, not
-- a clinical or care-team one — same class as care_coordinator, not a rung
-- on the doctor tier ladder — and structurally barred from is_org_staff()
-- below for the same reason lab_partner/pharmacist/lab_liaison/finance/
-- analyst already are: it must never inherit the ~110-table patient-scoped
-- RLS surface that role grants. An agent's job is "they sell and they book,
-- nothing else" (§12's non-technical build) — never clinical advice, never
-- results.
--
-- Deliberately its own account role rather than piggybacking on
-- care_coordinator or a bare profile: an agent needs a login (phone+OTP,
-- same as everyone else) and a narrow self-service portal, but must see
-- zero clinical data — not even the aggregate visibility care_coordinator
-- has as org staff.

alter type public.user_role add value if not exists 'agent';

create or replace function private.is_org_staff(org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid())
      and role <> 'patient'
      -- I9: an institution administrator is not care-team staff.
      and role not in ('corporate_admin', 'hmo_admin')
      -- Nor is a partner employee, a back-office account, or a commercial
      -- sales agent. Excluded here rather than in 314 individual policies.
      and role not in ('pharmacist', 'lab_partner', 'lab_liaison', 'finance', 'analyst', 'agent')
      and (role = 'admin' or organisation_id = org)
  );
$$;

comment on function private.is_org_staff(uuid) is
  'Tarragon care-team and operations staff for an organisation: clinician, '
  'doctor, care_coordinator, and the admin super-user. Institution admins '
  '(I9), partner employees (pharmacist, lab_partner), back-office roles, and '
  'community sales agents are excluded and are served by named grants or '
  'their own SECURITY DEFINER RPCs instead.';

-- ---------------------------------------------------------------------------
-- community_agents
-- ---------------------------------------------------------------------------

create type public.agent_status as enum ('active', 'suspended');

create sequence if not exists public.agent_code_seq;

create table public.community_agents (
  id                    uuid primary key default gen_random_uuid(),
  organisation_id       uuid not null references public.organisations (id) on delete restrict,
  profile_id            uuid not null references public.profiles (id) on delete cascade unique,
  agent_code            text not null unique,
  full_name             text not null,
  phone                 text not null,
  community_affiliation text,
  status                public.agent_status not null default 'active',
  recruited_by          uuid references public.profiles (id) on delete set null,
  payout_bank_name      text,
  payout_account_number text,
  payout_account_name   text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint community_agents_phone_e164 check (phone ~ '^\+[1-9][0-9]{7,14}$')
);

create index community_agents_org_idx on public.community_agents (organisation_id, status);
create index community_agents_code_idx on public.community_agents (agent_code);

create trigger community_agents_set_updated_at
  before update on public.community_agents
  for each row execute function private.set_updated_at();

-- Readable over a bad phone line (revenue-architecture spec §12): short,
-- uppercase, no ambiguous characters needed since it's numeric-suffixed
-- off a sequence rather than random.
create or replace function private.next_agent_code()
returns text
language sql
security definer
set search_path = ''
as $$
  select 'TAR-AGT-' || lpad(nextval('public.agent_code_seq')::text, 5, '0');
$$;

-- Admin/coordinator-only creation: an agent is recruited by staff, not
-- self-signed-up ("recruit individuals with standing in a community").
-- Takes an existing profile — the agent signs up like anyone else via
-- phone+OTP first, then staff promotes the account after the agent
-- agreement is signed (a non-technical, off-platform step).
create or replace function public.admin_create_community_agent(
  p_profile_id uuid,
  p_full_name text,
  p_phone text,
  p_community_affiliation text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_org uuid;
  v_code text;
  v_agent_id uuid;
begin
  if v_caller is null then raise exception 'not authenticated'; end if;
  if not (private.is_admin() or private.has_permission('agents.manage')) then
    raise exception 'not authorised to recruit agents' using errcode = '42501';
  end if;
  if p_phone !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception 'phone must be E.164, e.g. +234XXXXXXXXXX';
  end if;

  select organisation_id into v_org from public.profiles where id = p_profile_id;
  if v_org is null then raise exception 'profile not found'; end if;

  v_code := private.next_agent_code();

  insert into public.community_agents
    (organisation_id, profile_id, agent_code, full_name, phone, community_affiliation, recruited_by)
  values
    (v_org, p_profile_id, v_code, p_full_name, p_phone, p_community_affiliation, v_caller)
  returning id into v_agent_id;

  update public.profiles set role = 'agent' where id = p_profile_id and role = 'patient';

  return jsonb_build_object('ok', true, 'agent_id', v_agent_id, 'agent_code', v_code);
exception when unique_violation then
  return jsonb_build_object('ok', false, 'error', 'That person is already registered as an agent.');
end;
$$;

revoke all on function public.admin_create_community_agent(uuid, text, text, text) from public, anon;
grant execute on function public.admin_create_community_agent(uuid, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS. No user INSERT policy: an agent record is only ever created by the
-- definer RPC above. UPDATE is staff-only for now (payout bank details are
-- collected as part of the off-platform agent agreement, matching the
-- existing "commission structure, written... no clawback games" posture) —
-- an agent-editable self-service payout form is a reasonable v2, not built
-- here to avoid a half-verified bank-detail change path.
-- ---------------------------------------------------------------------------

alter table public.community_agents enable row level security;

create policy community_agents_select on public.community_agents
  for select to authenticated
  using (
    profile_id = (select auth.uid())
    or private.is_admin()
    or private.has_permission('agents.manage')
  );

create policy community_agents_update on public.community_agents
  for update to authenticated
  using (private.is_admin() or private.has_permission('agents.manage'))
  with check (private.is_admin() or private.has_permission('agents.manage'));

grant select, update on public.community_agents to authenticated;

insert into public.permissions (key, label, category, description)
values ('agents.manage', 'Manage community agents', 'Commercial',
        'Recruit and manage community sales agents, view and adjust their commission and payout records')
on conflict (key) do nothing;

do $$
begin
  if not exists (
    select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
    where t.typname = 'user_role' and e.enumlabel = 'agent'
  ) then
    raise exception 'agent role was not added';
  end if;
  if (select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'private' and p.proname = 'is_org_staff') not ilike '%agent%' then
    raise exception 'is_org_staff does not exclude the agent role';
  end if;
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'community_agents' and cmd in ('INSERT', 'DELETE')
  ) then
    raise exception 'community_agents must have no direct insert/delete policy: writes go through the definer RPC only';
  end if;
  if not has_function_privilege('authenticated', 'public.admin_create_community_agent(uuid,text,text,text)', 'EXECUTE') then
    raise exception 'authenticated (staff, gated inside the function) must be able to call admin_create_community_agent';
  end if;
  if has_function_privilege('anon', 'public.admin_create_community_agent(uuid,text,text,text)', 'EXECUTE') then
    raise exception 'anon must not be able to recruit agents';
  end if;
end $$;;
