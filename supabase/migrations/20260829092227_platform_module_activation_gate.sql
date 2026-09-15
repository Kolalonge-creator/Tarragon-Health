-- Tarragon Health — platform module activation gate.
--
-- Two whole platforms are being built ahead of the business that will use
-- them (module 27, the insurer/payer platform; module 28, the provider
-- organisation platform). The founder's instruction is explicit: build it
-- fully now, do not make it live, switch it on when the time comes.
--
-- "Not live" has to mean something stronger than "no link in the sidebar".
-- A route can be typed. A page can be reached by an old bookmark. A server
-- action can be called directly. So the switch lives in the database, one
-- row per module, and it is checked in three independent places:
--
--   1. RLS — every payer/provider-org table's policies require the module
--      to be on, so a disabled module returns zero rows to everyone except
--      the superadmin who has to set it up before switching it on.
--   2. Every write RPC calls private.assert_module_enabled() and refuses.
--   3. The Next.js route group 404s (see lib/platform-modules.ts).
--
-- Any one of those alone would be a UI decision a future refactor could
-- undo. All three means a half-finished activation cannot leak data: the
-- database is the backstop, exactly as I9's aggregate-only enforcement is.
--
-- Deliberately NOT a generic feature-flag system. Only a superadmin can
-- flip a row, there are only ever a handful of rows, and each flip is
-- audit-logged with a note saying why. Plan-level entitlement gating
-- already has its own mechanism (subscription_plans.features +
-- private.patient_has_feature_access) and this does not replace it — that
-- gates a patient's features, this gates whether a whole platform exists.

create table public.platform_modules (
  key             text primary key,
  label           text not null,
  description     text not null,
  is_enabled      boolean not null default false,
  enabled_at      timestamptz,
  enabled_by      uuid references public.profiles (id) on delete set null,
  activation_note text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- An enabled module always says who switched it on and when. A bare
  -- `update platform_modules set is_enabled = true` from a psql prompt is
  -- rejected by this check, which is the point: activating a platform that
  -- moves real money is a deliberate, attributed act, not a stray UPDATE.
  constraint platform_modules_enabled_has_attribution
    check (not is_enabled or (enabled_at is not null and enabled_by is not null))
);

comment on table public.platform_modules is
  'One row per platform-sized module that ships built but dormant. is_enabled=false means the module''s tables return zero rows under RLS and its write RPCs refuse. Flip only via public.set_platform_module().';

create trigger platform_modules_set_updated_at
  before update on public.platform_modules
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- The predicate. security definer so an RLS policy on a payer table can call
-- it without the caller needing to read platform_modules themselves, and
-- fail-closed on an unknown key: a typo in a policy denies access rather
-- than silently granting it.
-- ---------------------------------------------------------------------------
create or replace function private.module_enabled(p_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select is_enabled from public.platform_modules where key = p_key), false);
$$;

comment on function private.module_enabled(text) is
  'True only when the named module row exists and is switched on. An unknown key is false — a mistyped module name locks a surface down, it never opens one.';

revoke all on function private.module_enabled(text) from public;

create or replace function private.assert_module_enabled(p_key text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_label text;
begin
  if private.module_enabled(p_key) then
    return;
  end if;
  select label into v_label from public.platform_modules where key = p_key;
  raise exception '% is built but not yet activated on this platform', coalesce(v_label, p_key)
    using errcode = '23514',
          hint = 'A superadmin activates it with select public.set_platform_module(''' || p_key || ''', true, ''<why>'').';
end;
$$;

revoke all on function private.assert_module_enabled(text) from public;

-- ---------------------------------------------------------------------------
-- RLS — everyone signed in may read which modules exist and whether they are
-- on (it is a deployment fact, not patient data, and the app shell needs it
-- to decide whether to render a nav entry). Nobody writes directly: there is
-- no insert/update/delete grant at all, so the RPC below is the only door.
-- ---------------------------------------------------------------------------
alter table public.platform_modules enable row level security;

create policy platform_modules_select on public.platform_modules
  for select to authenticated using (true);

grant select on public.platform_modules to authenticated;
revoke all on public.platform_modules from anon;

-- ---------------------------------------------------------------------------
-- The one deliberate switch.
-- ---------------------------------------------------------------------------
create or replace function public.set_platform_module(
  p_key text,
  p_enabled boolean,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.platform_modules%rowtype;
begin
  if not private.is_admin() then
    raise exception 'only a superadmin can activate or deactivate a platform module'
      using errcode = '42501';
  end if;

  select * into v_row from public.platform_modules where key = p_key;
  if v_row.key is null then
    raise exception 'no such platform module: %', p_key using errcode = '22023';
  end if;

  -- Switching a module ON is the consequential direction, so it must carry a
  -- reason. Switching one off in a hurry (something is wrong, stop it) must
  -- never be blocked by paperwork.
  if p_enabled and coalesce(btrim(p_note), '') = '' then
    raise exception 'activating % needs a note saying why (a signed contract, a go-live date)', v_row.label
      using errcode = '23514';
  end if;

  update public.platform_modules
     set is_enabled      = p_enabled,
         enabled_at      = case when p_enabled then now() else null end,
         enabled_by      = case when p_enabled then (select auth.uid()) else null end,
         activation_note = case when p_enabled then btrim(p_note) else p_note end
   where key = p_key;

  perform private.log_audit(
    case when p_enabled then 'platform_module.activated' else 'platform_module.deactivated' end,
    'platform_module',
    null,
    jsonb_build_object('key', p_key, 'note', p_note)
  );

  return jsonb_build_object('ok', true, 'key', p_key, 'is_enabled', p_enabled);
end;
$$;

revoke all on function public.set_platform_module(text, boolean, text) from public;
revoke all on function public.set_platform_module(text, boolean, text) from anon;
grant execute on function public.set_platform_module(text, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- The two modules this work builds. Both off.
-- ---------------------------------------------------------------------------
insert into public.platform_modules (key, label, description) values
  ('payer_platform',
   'Insurer / payer platform',
   'Lets an insurer or other healthcare purchaser operate on Tarragon directly: plans, members, benefits, network, pre-authorisation, claims, care programmes and aggregate analytics. Dormant until a signed payer contract exists.'),
  ('provider_org_platform',
   'Provider organisation platform',
   'Lets a hospital, clinic, diagnostic centre, pharmacy or specialist practice run its own Tarragon-facing operation: locations, departments, staff, services, scheduling, resources, referral queue, results, billing and analytics. Dormant until the first organisation is onboarded.')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Assertions.
-- ---------------------------------------------------------------------------
do $$
begin
  if (select count(*) from public.platform_modules) < 2 then
    raise exception 'FAIL: both module rows should exist';
  end if;

  if exists (select 1 from public.platform_modules where is_enabled) then
    raise exception 'FAIL: a module shipped switched on — both must ship dormant';
  end if;

  if private.module_enabled('payer_platform') then
    raise exception 'FAIL: module_enabled says payer_platform is on';
  end if;

  -- Fail-closed on nonsense.
  if private.module_enabled('no_such_module_at_all') then
    raise exception 'FAIL: module_enabled returned true for an unknown key';
  end if;

  -- assert_module_enabled actually raises.
  begin
    perform private.assert_module_enabled('payer_platform');
    raise exception 'FAIL: assert_module_enabled did not raise for a dormant module';
  exception
    when check_violation then null;
  end;

  -- The attribution check discriminates rather than passing vacuously.
  begin
    update public.platform_modules set is_enabled = true where key = 'payer_platform';
    raise exception 'FAIL: a bare UPDATE switched a module on with no attribution';
  exception
    when check_violation then null;
  end;

  raise notice 'PASS: platform_modules ships both modules dormant, fail-closed, attribution-enforced';
end $$;
