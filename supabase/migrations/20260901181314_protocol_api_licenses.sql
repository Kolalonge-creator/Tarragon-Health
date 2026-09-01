-- Tarragon Health — Protocol API licensing tiers.
--
-- The Protocol API (20260802205424_protocol_api_usage_log.sql) already has
-- full external-partner key auth, a protocol_partner organisation type, and
-- a call-by-call usage log — but nothing that turns "how much is this
-- partner using it" into a billing tier or a cap. Founder decision
-- 2026-09-01: admin-provisioned flat monthly tiers (no self-serve yet),
-- enforced as a hard monthly call cap with a clear 429 once exceeded rather
-- than a silent degrade or a silent overage — overage needs to be visible
-- for manual invoicing, per the founder's chosen scope. No payment pipeline
-- for this B2B line yet; that stays a manual, outside-the-platform step.
--
-- One license per organisation (unique constraint) — a partner has exactly
-- one active tier at a time, matches the "admin sets a partner up with a
-- tier" mental model rather than a history of superseded tiers.
--
-- No RLS policy for `authenticated` at all — same reasoning as the usage-log
-- migration's own admin_* RPCs: a protocol_partner org typically has no
-- Tarragon login, and unlike usage counts (which that org's own staff could
-- one day see), the price Tarragon is charging them is never something to
-- expose even to their own future staff without a real self-serve billing
-- surface. Every read/write goes through the admin RPCs below.

create table public.protocol_api_licenses (
  id                        uuid primary key default gen_random_uuid(),
  organisation_id           uuid not null references public.organisations (id) on delete cascade,
  tier                      text not null default 'up_to_10k' check (tier in ('up_to_10k', 'up_to_50k', 'unlimited')),
  monthly_price_kobo        bigint not null default 0 check (monthly_price_kobo >= 0),
  -- null = unlimited (matches tier = 'unlimited', but enforcement reads this
  -- column, not the label, so a future tier can't silently drift from it).
  calls_included_per_month  integer check (calls_included_per_month is null or calls_included_per_month > 0),
  is_active                 boolean not null default true,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  created_by                uuid references public.profiles (id) on delete set null,
  constraint protocol_api_licenses_org_unique unique (organisation_id)
);
alter table public.protocol_api_licenses enable row level security;

create trigger protocol_api_licenses_set_updated_at
  before update on public.protocol_api_licenses
  for each row execute function private.set_updated_at();

create or replace function public.admin_set_protocol_api_license(
  p_organisation_id uuid,
  p_tier text,
  p_monthly_price_kobo bigint,
  p_calls_included_per_month integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org_type public.organisation_type;
  v_id uuid;
begin
  if not (private.is_admin() or private.has_permission('integrations.manage')) then
    raise exception 'not authorised';
  end if;

  select type into v_org_type from public.organisations where id = p_organisation_id;
  if v_org_type is null then raise exception 'organisation not found'; end if;
  if v_org_type <> 'protocol_partner' then
    raise exception 'licenses only apply to protocol_partner organisations';
  end if;
  if p_tier not in ('up_to_10k', 'up_to_50k', 'unlimited') then
    raise exception 'invalid tier %', p_tier;
  end if;
  if coalesce(p_monthly_price_kobo, 0) < 0 then raise exception 'price cannot be negative'; end if;

  insert into public.protocol_api_licenses
    (organisation_id, tier, monthly_price_kobo, calls_included_per_month, created_by)
  values (
    p_organisation_id, p_tier, coalesce(p_monthly_price_kobo, 0),
    case when p_tier = 'unlimited' then null else p_calls_included_per_month end,
    (select auth.uid())
  )
  on conflict (organisation_id) do update set
    tier = excluded.tier,
    monthly_price_kobo = excluded.monthly_price_kobo,
    calls_included_per_month = excluded.calls_included_per_month,
    updated_at = now()
  returning id into v_id;

  perform private.log_audit('protocol_api.license.set', 'protocol_api_licenses', v_id,
    jsonb_build_object('organisation_id', p_organisation_id, 'tier', p_tier,
      'monthly_price_kobo', p_monthly_price_kobo, 'calls_included_per_month', p_calls_included_per_month));

  return v_id;
end;
$$;

revoke all on function public.admin_set_protocol_api_license(uuid, text, bigint, integer) from public;
grant execute on function public.admin_set_protocol_api_license(uuid, text, bigint, integer) to authenticated;
revoke execute on function public.admin_set_protocol_api_license(uuid, text, bigint, integer) from anon;

-- Widen admin_list_protocol_partners() with license + this-month-usage
-- columns — a return-type change, so drop before recreate (same pattern as
-- finance_post_manual_journal in 20260726120000).
drop function if exists public.admin_list_protocol_partners();

create or replace function public.admin_list_protocol_partners()
returns table (
  organisation_id uuid,
  name text,
  created_at timestamptz,
  active_key_count bigint,
  calls_last_30_days bigint,
  last_called_at timestamptz,
  tier text,
  monthly_price_kobo bigint,
  calls_included_per_month integer,
  calls_this_month bigint
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
       where u.organisation_id = o.id) as last_called_at,
    l.tier,
    l.monthly_price_kobo,
    l.calls_included_per_month,
    (select count(*) from public.protocol_api_usage_log u
       where u.organisation_id = o.id and u.called_at >= date_trunc('month', now())) as calls_this_month
  from public.organisations o
  left join public.protocol_api_licenses l on l.organisation_id = o.id
  where o.type = 'protocol_partner'
    and (private.is_admin() or private.has_permission('integrations.manage'))
  order by o.created_at desc;
$$;

revoke all on function public.admin_list_protocol_partners() from public;
grant execute on function public.admin_list_protocol_partners() to authenticated;
revoke execute on function public.admin_list_protocol_partners() from anon;

do $$
begin
  if has_function_privilege('anon', 'public.admin_set_protocol_api_license(uuid,text,bigint,integer)', 'EXECUTE')
     or has_function_privilege('anon', 'public.admin_list_protocol_partners()', 'EXECUTE') then
    raise exception 'FAIL: anon must never touch protocol API licensing';
  end if;
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'protocol_api_licenses'
  ) then
    raise exception 'FAIL: protocol_api_licenses must have no RLS policy — admin RPCs only';
  end if;
  raise notice 'PASS: protocol_api_licenses + admin_set_protocol_api_license in place';
end $$;
