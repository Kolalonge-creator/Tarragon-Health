-- Tarragon Health
-- Subscription auto-renewal + cancel-at-period-end.
--
-- Paid plans auto-renew via the provider (Paystack Plans / Stripe Prices) —
-- the provider re-charges the card each month/year. This migration makes
-- "cancel" mean "stop the NEXT renewal, but keep the plan running to the end
-- of the period the patient has already paid for" (subscriptions are
-- non-refundable — the paid month/year runs to the end).
--
-- Three parts:
--   1. cancel_at_period_end flag on subscriptions + subscription_add_ons.
--   2. has_feature_access keeps entitlement alive while a row is active/
--      trialing UNLESS it's been scheduled to cancel AND its period has
--      already elapsed — so access ends exactly at current_period_end, never
--      the instant the patient clicks cancel.
--   3. A daily sweeper flips scheduled-to-cancel rows to 'cancelled' once
--      current_period_end passes (housekeeping so status/badges settle; the
--      entitlement check above already stops access without waiting on it).

-- ---------------------------------------------------------------------------
-- 1. cancel_at_period_end columns
-- ---------------------------------------------------------------------------
alter table public.subscriptions
  add column if not exists cancel_at_period_end boolean not null default false;

alter table public.subscription_add_ons
  add column if not exists cancel_at_period_end boolean not null default false;

comment on column public.subscriptions.cancel_at_period_end is
  'True once the subscriber has turned off auto-renewal: the row stays active until current_period_end (the paid period is non-refundable and runs to the end), then the daily sweeper marks it cancelled. Resuming auto-renewal sets this back to false.';

comment on column public.subscription_add_ons.cancel_at_period_end is
  'Same semantics as subscriptions.cancel_at_period_end, for an attached add-on.';

-- ---------------------------------------------------------------------------
-- 2. has_feature_access — entitlement survives until the paid period ends
-- ---------------------------------------------------------------------------
-- Only change vs. 20260712201523: a row that is active/trialing but has been
-- scheduled to cancel (cancel_at_period_end) AND whose current_period_end has
-- already passed no longer grants access. Rows without cancel_at_period_end
-- behave exactly as before.
create or replace function public.has_feature_access(feature text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role public.user_role;
begin
  select role into v_role from public.profiles where id = (select auth.uid());

  if v_role = 'admin' then
    return true;
  end if;

  return exists (
    select 1
    from public.subscriptions s
    join public.subscription_plans p on p.id = s.plan_id
    where s.subscriber_id = (select auth.uid())
      and s.status in ('active', 'trialing')
      and not (
        s.cancel_at_period_end
        and s.current_period_end is not null
        and s.current_period_end <= now()
      )
      and feature = any(p.features)
  ) or exists (
    select 1
    from public.subscription_add_ons sao
    join public.subscriptions s on s.id = sao.subscription_id
    join public.add_ons a on a.id = sao.add_on_id
    where s.subscriber_id = (select auth.uid())
      and sao.status in ('active', 'trialing')
      and not (
        sao.cancel_at_period_end
        and sao.current_period_end is not null
        and sao.current_period_end <= now()
      )
      and feature = any(a.features)
  );
end;
$$;

revoke execute on function public.has_feature_access(text) from public;
revoke execute on function public.has_feature_access(text) from anon;
grant execute on function public.has_feature_access(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Daily sweeper: settle scheduled-to-cancel rows once their period ends
-- ---------------------------------------------------------------------------
-- Access already stops via has_feature_access at current_period_end; this
-- just makes the stored status/cancelled_at reflect reality (so the UI badge,
-- the useCurrentSubscription priority sort, and any status-based reporting
-- settle without waiting on a provider webhook that may fire early — Paystack
-- — or exactly at period end — Stripe).
create or replace function private.expire_cancelled_subscriptions()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.subscriptions
    set status = 'cancelled',
        cancelled_at = coalesce(cancelled_at, now())
    where cancel_at_period_end
      and status in ('active', 'trialing')
      and current_period_end is not null
      and current_period_end <= now();

  update public.subscription_add_ons
    set status = 'cancelled',
        cancelled_at = coalesce(cancelled_at, now())
    where cancel_at_period_end
      and status in ('active', 'trialing')
      and current_period_end is not null
      and current_period_end <= now();
end;
$$;

revoke execute on function private.expire_cancelled_subscriptions() from public;
revoke execute on function private.expire_cancelled_subscriptions() from anon;
revoke execute on function private.expire_cancelled_subscriptions() from authenticated;

select cron.schedule(
  'expire-cancelled-subscriptions-daily',
  '15 1 * * *',
  $$select private.expire_cancelled_subscriptions();$$
);
