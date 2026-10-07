-- S58 migration 3 of 3: the capped checkout discount (OQ-08 / F1 follow-up) and the employer aggregate seam (11.4).
--
-- REDEMPTION, built but switched OFF. public.apply_points_discount(order, points) exists and is tested, and refuses with
-- 'redemption_unavailable' while reward_config.points_redemption_cap_kobo is 0 (it is 0; the founder sets it, not this migration).
-- Design rules (INV-09, spec 11.2, safety rules "points are not money and cannot be transferred"):
--  * Points buy a PERCENTAGE of one order (points_per_percent points per 1 percent), never a kobo amount: there is no
--    points-to-naira rate anywhere, so a point has no stored value.
--  * The discount can never exceed max_share_bps of the item price, nor the kobo cap per order. Enforced by a trigger on the
--    table itself (a direct insert cannot get round the function), then restated by CHECK constraints.
--  * Order-linked (one redemption per order), the buyer's own points on the buyer's own order (no transfer), integer kobo,
--    no cash-out path exists, minors cannot redeem.
--  * Points are deducted at reservation and returned (kind 'release') if the order fails or is cancelled, via
--    release_points_discount (service role; S71/S72 call it from the order lifecycle). Tarragon funds the discount (OQ-F1-01 open).
-- ROW COUNTS: reward_redemptions is new (0 rows); the legacy wellness_points_redemptions history is untouched.

create table public.reward_redemptions (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete restrict,
  patient_id       uuid not null references public.profiles (id) on delete cascade,
  order_id         uuid not null unique references public.orders (id) on delete restrict,
  points           integer not null check (points > 0),
  discount_bps     integer not null check (discount_bps > 0 and discount_bps <= 10000),
  max_share_bps    integer not null check (max_share_bps between 1 and 10000),
  item_price_kobo  bigint not null check (item_price_kobo > 0),
  discount_kobo    bigint not null check (discount_kobo > 0),
  state            text not null default 'reserved' check (state in ('reserved', 'applied', 'released')),
  spend_ledger_id  uuid references public.wellness_points_ledger (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint reward_redemptions_share_cap check (discount_bps <= max_share_bps),
  constraint reward_redemptions_below_price check (discount_kobo < item_price_kobo),
  constraint reward_redemptions_share_exact check (discount_kobo = (item_price_kobo * discount_bps) / 10000)
);
alter table public.reward_redemptions enable row level security;
revoke all on public.reward_redemptions from public, anon, authenticated;
grant select on public.reward_redemptions to authenticated;
create policy reward_redemptions_own_read on public.reward_redemptions for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_admin());
comment on table public.reward_redemptions is
  'S58: a capped checkout discount bought with points. Percentage-based, order-linked, non-transferable, never cash. No write grant: apply_points_discount / release_points_discount only.';

-- The database restates the rules on every insert, whoever inserts.
create or replace function private.reward_redemptions_enforce()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_cap bigint := coalesce((private.reward_config('points_redemption_cap_kobo') #>> '{}')::bigint, 0);
  v_cfg jsonb := private.reward_config('redemption');
  v_buyer uuid;
  v_amount bigint;
begin
  if tg_op = 'UPDATE' then
    if new.points is distinct from old.points or new.discount_kobo is distinct from old.discount_kobo
       or new.order_id is distinct from old.order_id or new.patient_id is distinct from old.patient_id
       or new.discount_bps is distinct from old.discount_bps or new.item_price_kobo is distinct from old.item_price_kobo then
      raise exception 'reward_redemption_immutable' using errcode = 'P0001';
    end if;
    new.updated_at := now();
    return new;
  end if;
  if tg_op = 'DELETE' then
    -- a profile purge cascades here from inside another trigger (depth > 1); nothing else may delete a redemption
    if pg_trigger_depth() > 1 then return old; end if;
    raise exception 'reward_redemption_immutable' using errcode = 'P0001';
  end if;
  if v_cap <= 0 then raise exception 'redemption_unavailable' using errcode = 'P0001'; end if;
  select buyer_profile_id, amount_kobo into v_buyer, v_amount from public.orders where id = new.order_id;
  if v_buyer is null or v_buyer is distinct from new.patient_id then
    raise exception 'points_not_transferable' using errcode = 'P0001';
  end if;
  if v_amount is distinct from new.item_price_kobo then raise exception 'price_mismatch' using errcode = 'P0001'; end if;
  if new.max_share_bps is distinct from (v_cfg ->> 'max_share_bps')::integer then raise exception 'cap_mismatch' using errcode = 'P0001'; end if;
  if new.points is distinct from (new.discount_bps / 100) * (v_cfg ->> 'points_per_percent')::integer then
    raise exception 'points_mismatch' using errcode = 'P0001';
  end if;
  if new.discount_kobo > v_cap then raise exception 'over_cap_kobo' using errcode = 'P0001'; end if;
  return new;
end;
$$;
create trigger reward_redemptions_enforce
  before insert or update or delete on public.reward_redemptions
  for each row execute function private.reward_redemptions_enforce();

create or replace function public.apply_points_discount(p_order uuid, p_points integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_cap bigint := coalesce((private.reward_config('points_redemption_cap_kobo') #>> '{}')::bigint, 0);
  v_cfg jsonb := private.reward_config('redemption');
  v_minor_years integer := coalesce((private.reward_config('minor_age_years') ->> 'years')::integer, 18);
  v_ppp integer := (v_cfg ->> 'points_per_percent')::integer;
  v_max_bps integer := (v_cfg ->> 'max_share_bps')::integer;
  v_min integer := coalesce((v_cfg ->> 'min_points')::integer, 1);
  v_order public.orders%rowtype;
  v_bal public.wellness_points_balances%rowtype;
  v_dob date;
  v_bps integer;
  v_kobo bigint;
  v_red uuid := gen_random_uuid();
  v_ledger uuid;
begin
  if v_caller is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if v_cap <= 0 or v_cfg is null then
    return jsonb_build_object('ok', false, 'code', 'redemption_unavailable');
  end if;
  if p_points is null or p_points < v_min or p_points % v_ppp <> 0 then
    return jsonb_build_object('ok', false, 'code', 'invalid_points');
  end if;
  select date_of_birth into v_dob from public.profiles where id = v_caller;
  if v_dob is not null and v_dob > (current_date - make_interval(years => v_minor_years)) then
    return jsonb_build_object('ok', false, 'code', 'not_available_for_minors');
  end if;
  select * into v_order from public.orders where id = p_order;
  if not found or v_order.buyer_profile_id <> v_caller then
    return jsonb_build_object('ok', false, 'code', 'order_not_yours');
  end if;
  if v_order.state <> 'created' or v_order.expires_at <= now() then
    return jsonb_build_object('ok', false, 'code', 'order_not_open');
  end if;
  if exists (select 1 from public.reward_redemptions where order_id = p_order) then
    return jsonb_build_object('ok', false, 'code', 'already_applied');
  end if;
  v_bps := (p_points / v_ppp) * 100;
  if v_bps > v_max_bps then return jsonb_build_object('ok', false, 'code', 'over_cap'); end if;
  v_kobo := (v_order.amount_kobo * v_bps) / 10000;
  if v_kobo < 1 then return jsonb_build_object('ok', false, 'code', 'too_small'); end if;
  if v_kobo > v_cap then return jsonb_build_object('ok', false, 'code', 'over_cap'); end if;

  select * into v_bal from public.wellness_points_balances where patient_id = v_caller for update;
  if not found or v_bal.balance < p_points then
    return jsonb_build_object('ok', false, 'code', 'not_enough_points');
  end if;

  insert into public.reward_redemptions
    (id, organisation_id, patient_id, order_id, points, discount_bps, max_share_bps, item_price_kobo, discount_kobo)
  values (v_red, v_order.organisation_id, v_caller, p_order, p_points, v_bps, v_max_bps, v_order.amount_kobo, v_kobo);

  insert into public.wellness_points_ledger
    (organisation_id, patient_id, points, balance_after, reason, source_table, source_id, kind)
  values (v_order.organisation_id, v_caller, -p_points, v_bal.balance - p_points, 'redeemed_discount', 'reward_redemptions', v_red, 'spend')
  returning id into v_ledger;
  update public.wellness_points_balances set balance = balance - p_points, updated_at = now() where patient_id = v_caller;
  update public.reward_redemptions set spend_ledger_id = v_ledger where id = v_red;

  return jsonb_build_object('ok', true, 'redemption_id', v_red, 'discount_kobo', v_kobo, 'points', p_points);
end;
$$;
revoke execute on function public.apply_points_discount(uuid, integer) from public, anon;
grant execute on function public.apply_points_discount(uuid, integer) to authenticated;

-- Points come back if the order never completes. Service role only: the order lifecycle (S71/S72) calls it.
create or replace function public.release_points_discount(p_order uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_red public.reward_redemptions%rowtype;
  v_state text;
  v_bal integer;
begin
  select * into v_red from public.reward_redemptions where order_id = p_order for update;
  if not found or v_red.state <> 'reserved' then return 0; end if;
  select state into v_state from public.orders where id = p_order;
  if v_state not in ('failed', 'cancelled') then return 0; end if;
  update public.wellness_points_balances set balance = balance + v_red.points, updated_at = now()
   where patient_id = v_red.patient_id returning balance into v_bal;
  insert into public.wellness_points_ledger
    (organisation_id, patient_id, points, balance_after, reason, source_table, source_id, kind)
  values (v_red.organisation_id, v_red.patient_id, v_red.points, v_bal, 'redemption_released', 'reward_redemptions', v_red.id, 'release');
  update public.reward_redemptions set state = 'released' where id = v_red.id;
  return v_red.points;
end;
$$;
revoke execute on function public.release_points_discount(uuid) from public;
revoke execute on function public.release_points_discount(uuid) from anon, authenticated;
grant execute on function public.release_points_discount(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Employer reward pools (11.4): Module 24 is not built. Only the aggregate-only seam exists: counts, never a person,
-- groups smaller than the configured minimum suppressed (I9).
-- ---------------------------------------------------------------------------
create or replace function public.rewards_participation_aggregate(p_org uuid, p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_min integer := coalesce((private.reward_config('employer_aggregate') ->> 'min_group')::integer, 10);
  v_people integer;
  v_points bigint;
begin
  if not private.is_admin()
     or p_org is distinct from (select organisation_id from public.profiles where id = auth.uid()) then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  select count(distinct l.patient_id), coalesce(sum(l.points), 0) into v_people, v_points
    from public.wellness_points_ledger l join public.profiles p on p.id = l.patient_id
   where l.organisation_id = p_org and l.kind = 'earn' and l.points > 0 and not coalesce(p.is_test, false)
     and l.created_at >= p_from and l.created_at < p_to + 1;
  if v_people < v_min then
    return jsonb_build_object('suppressed', true, 'min_group', v_min);
  end if;
  return jsonb_build_object('suppressed', false, 'participants', v_people, 'points', v_points,
    'by_rule', coalesce((select jsonb_agg(jsonb_build_object('rule', x.rule_code, 'participants', x.n))
       from (select l.rule_code, count(distinct l.patient_id) n
               from public.wellness_points_ledger l join public.profiles p on p.id = l.patient_id
              where l.organisation_id = p_org and l.kind = 'earn' and l.points > 0 and l.rule_code is not null
                and not coalesce(p.is_test, false) and l.created_at >= p_from and l.created_at < p_to + 1
              group by 1 having count(distinct l.patient_id) >= v_min) x), '[]'::jsonb));
end;
$$;
revoke execute on function public.rewards_participation_aggregate(uuid, date, date) from public, anon;
grant execute on function public.rewards_participation_aggregate(uuid, date, date) to authenticated;

-- Self-check: no points-to-kobo rate exists anywhere, and redemption is still off.
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public'
              and column_name ~* '(points_to_kobo|kobo_per_point|kobo_rate)') then
    raise exception 'a points-to-kobo rate column exists';
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname in ('public', 'private') and p.prosrc ~* '(points_to_kobo|kobo_per_point|kobo_rate)') then
    raise exception 'a function uses a points-to-kobo rate';
  end if;
  if (private.reward_config('points_redemption_cap_kobo') #>> '{}')::bigint <> 0 then
    raise exception 'the redemption cap must stay 0 until the founder sets it';
  end if;
end $$;
