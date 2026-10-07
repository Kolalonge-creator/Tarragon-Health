-- F1 fix 2: wellness points are non-monetary (OQ-08, founder decision 2026-09-30; INV-09 no stored value).
--
-- THE DEFECT. public.redeem_wellness_points(integer) converted points to kobo at
-- wellness_points_config.points_to_kobo_rate (50 kobo per point since
-- 20260731010906) and minted a care_vouchers row through private.issue_reward_voucher,
-- so a point was spendable money.
--
-- AFFECTED ROWS. Counted from repo and seed evidence, NOT verified live:
--   * supabase/seed has no wellness_points rows (local replay: 0 balances, 0 redemptions);
--   * OQ-08 records "2 balance rows live" (a points count, not money, and unaffected);
--   * live wellness_points_redemptions and care_vouchers rows with source 'Wellness reward'
--     are unknown to this migration. Nothing here edits or deletes any of them: past
--     redemptions stay as history, and any already-issued voucher keeps working.
--   => the pre-apply dry run must run `select count(*) from wellness_points_redemptions`
--      and record it in the PR (apply checklist).
--
-- WHAT CHANGES (the conversion is removed, not just hidden)
--  * redeem_wellness_points(integer): same signature, no longer reads a rate, no longer
--    issues a voucher, writes nothing. It returns {ok:false, code:'redemption_unavailable'}
--    with a calm message. Until checkout discounts exist (S71/S72) this is the safest
--    minimal state: points keep accruing, nothing is spendable, nothing can be minted.
--  * wellness_points_config.points_to_kobo_rate is dropped.
--  * wellness_points_redemptions: INSERT is refused by trigger, so nothing can resurrect
--    the conversion through the table; history columns (kobo_credited, voucher_id) stay,
--    nullable, as read-only history.
--  * private.issue_reward_voucher is NOT touched: referral, prevention and promo-code
--    rewards still use it, and those are separate, founder-approved flows.
--  * The future cap lives in PROPOSED config (rewards.points_redemption_cap_kobo, integer
--    kobo, 0 = off), never in SQL or app code.

-- 1. The redemption RPC: disabled, writes nothing.
create or replace function public.redeem_wellness_points(p_points integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  -- OQ-08: points are non-monetary. No conversion, no voucher, no ledger or balance change.
  return jsonb_build_object(
    'ok', false,
    'code', 'redemption_unavailable',
    'error', 'Points cannot be redeemed yet. Your points are safe and keep building.');
end;
$$;

revoke execute on function public.redeem_wellness_points(integer) from public;
revoke execute on function public.redeem_wellness_points(integer) from anon;
grant execute on function public.redeem_wellness_points(integer) to authenticated;

comment on function public.redeem_wellness_points(integer) is
  'F1/OQ-08: disabled. Points are non-monetary; this writes nothing and never converts points to kobo. A capped checkout discount arrives with S71/S72 and reads rewards.points_redemption_cap_kobo from PROPOSED config.';

-- 2. Remove the rate itself.
alter table public.wellness_points_config drop column if exists points_to_kobo_rate;

-- 3. Redemption history becomes read-only; nothing may insert a converted amount again.
alter table public.wellness_points_redemptions alter column kobo_credited drop not null;
alter table public.wellness_points_redemptions drop constraint if exists wellness_points_redemptions_kobo_credited_check;
comment on column public.wellness_points_redemptions.kobo_credited is
  'LEGACY history only (F1/OQ-08). Points no longer convert to money; no new row may be inserted.';

create or replace function private.wellness_points_redemptions_refuse_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Wellness points are non-monetary and cannot be redeemed for value (OQ-08)'
    using errcode = 'check_violation';
end;
$$;

drop trigger if exists wellness_points_redemptions_refuse_insert on public.wellness_points_redemptions;
create trigger wellness_points_redemptions_refuse_insert
  before insert on public.wellness_points_redemptions
  for each row execute function private.wellness_points_redemptions_refuse_insert();

-- 4. Self-check: nothing left that converts points to money.
do $$
declare
  v_src text;
begin
  select prosrc into v_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'redeem_wellness_points';
  if v_src ilike '%issue_reward_voucher%' or v_src ilike '%kobo%' or v_src ilike '%rate%' then
    raise exception 'redeem_wellness_points still references a conversion';
  end if;
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'wellness_points_config'
                and column_name = 'points_to_kobo_rate') then
    raise exception 'points_to_kobo_rate still exists';
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname in ('public', 'private')
                and p.proname <> 'redeem_wellness_points'
                and p.prosrc ilike '%points_to_kobo_rate%') then
    raise exception 'a function still reads points_to_kobo_rate';
  end if;
end $$;
