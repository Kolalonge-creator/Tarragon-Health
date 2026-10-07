-- S56 step 4 of 4: the crisis card's data (function 10.3). No model anywhere in this path (INV-01).
--
-- FOUNDER DECISION 2026-10-07: there are no usable crisis helplines in Nigeria, so the crisis card shows NO helpline number. It tells the
-- person to go to the nearest hospital now and keeps the emergency-number wording (112, flagged for CMO approval in crisis_card_config).
-- The earlier draft of this migration created a crisis_helplines table plus verify/unverify functions and an admin verification page; all
-- of that is removed (the S56 migrations were never applied anywhere, so this file is edited in place). If helplines are ever wanted
-- later, add a new migration with a table, a verification gate (last_verified_at null means never shown) and a card section.
--
-- 1. crisis_card_config: PROPOSED values (emergency number, staffed callback SLA). The callback SLA is shown to a patient only once the
--    row is confirmed; a draft number is never promised.
-- 2. get_crisis_card(): what any signed-in patient may read, also cached on the device. Carries no helplines.
--
-- Rows: crisis_card_config 1 (seed). Nothing existing is changed.

create table if not exists public.crisis_card_config (
  id         uuid primary key default gen_random_uuid(),
  version    integer not null unique check (version >= 1),
  status     text not null default 'proposed' check (status in ('proposed', 'confirmed')),
  config     jsonb not null,
  notes      text,
  is_active  boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index if not exists crisis_card_config_one_active on public.crisis_card_config (is_active) where is_active;
alter table public.crisis_card_config enable row level security;
drop policy if exists crisis_card_config_select on public.crisis_card_config;
create policy crisis_card_config_select on public.crisis_card_config for select to authenticated
  using (private.is_admin() or private.is_active_clinical_director());
revoke all on public.crisis_card_config from anon;
grant select on public.crisis_card_config to authenticated;
-- crisis-card-v1-begin
insert into public.crisis_card_config (version, status, config, notes, is_active)
values (1, 'proposed', $json${"emergency_number":"112","callback_sla_minutes":30}$json$::jsonb,
  'PROPOSED by the build, owner CMO: 112 is the national emergency line (it may not connect everywhere, so the card always also says go to the nearest hospital now); the staffed callback SLA is shown to a patient only once this row is confirmed.', true)
on conflict (version) do nothing;
-- crisis-card-v1-end

create or replace function public.get_crisis_card()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_cfg public.crisis_card_config%rowtype;
begin
  if (select auth.uid()) is null then raise exception 'not authorised' using errcode = '42501'; end if;
  select * into v_cfg from public.crisis_card_config where is_active;
  return jsonb_build_object('emergency_number', coalesce(v_cfg.config ->> 'emergency_number', '112'),
    'callback_sla_minutes', case when v_cfg.status = 'confirmed' then (v_cfg.config ->> 'callback_sla_minutes')::integer else null end);
end $$;
revoke all on function public.get_crisis_card() from public, anon;
grant execute on function public.get_crisis_card() to authenticated;

do $$
begin
  if to_regclass('public.crisis_helplines') is not null then raise exception 'FAIL: the crisis_helplines table must not exist'; end if;
  if has_function_privilege('anon', 'public.get_crisis_card()', 'EXECUTE') then
    raise exception 'FAIL: anon can reach the crisis card function';
  end if;
end $$;
