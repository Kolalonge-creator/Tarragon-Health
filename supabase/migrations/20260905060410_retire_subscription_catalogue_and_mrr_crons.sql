-- Tarragon Health — take the retired subscription catalogue out of service.
--
-- Subscription plans were retired by the 2026-09-02 pay-per-service cutover
-- (the app is free; Tarragon charges per piece of doctor work via
-- service_products). The catalogue rows were left behind still flagged
-- is_active, and the admin editor above them was still able to mint new
-- recurring Paystack Plan objects that no patient checkout could ever charge
-- against. The editor's write path is removed in the same change; this
-- migration closes the data half.
--
-- Live state before this runs (koiplnmbgnqnbywhpjlf):
--   public.subscriptions        0 rows   -- nothing to migrate, ever
--   public.subscription_add_ons 0 rows
--   public.subscription_plans   7 of 13 rows is_active, 6 with a live
--                               paystack_plan_code:
--                                 complete          PLN_xx6p9lxvoca2p41
--                                 complete_yearly   PLN_rrnr23wcfk8kbra
--                                 essential         PLN_a35fb7jxpcjhfwk
--                                 essential_yearly  PLN_x6qurpjgg3f0nn6
--                                 prevent           PLN_vyshgwwcbbwfvju
--                                 prevent_yearly    PLN_5euwee2v1dn7xu9
--                               (plus `free`, price 0, which never had one)
--   public.add_ons              4 of 12 rows is_active, 2 with a live
--                               paystack_plan_code and 2 with a live Stripe
--                               price id:
--                                 lifestyle-coaching       PLN_63vhto3wwjr0qvf
--                                 prevention-screening     PLN_ykxc346sa2zx2g3
--                                 lifestyle-coaching_usd   price_1U07KB...
--                                 prevention-screening_usd price_1U07KA...
--
-- Rows are deactivated, not deleted: they are the only record of what was
-- charged and of which provider objects exist upstream, and the identifiers
-- above are what the founder needs in order to disable those Plans by hand.
--
-- FOUNDER ACTION REQUIRED: Paystack has no API to delete a Plan. The six
-- Paystack Plan objects listed above still exist in the Paystack dashboard
-- and must be disabled there. Nothing in this codebase can do it.

-- ---------------------------------------------------------------------------
-- 1. Deactivate the catalogue.
-- ---------------------------------------------------------------------------
update public.subscription_plans set is_active = false where is_active;
update public.add_ons set is_active = false where is_active;

-- ---------------------------------------------------------------------------
-- 2. Unschedule the two crons that only ever touched the retired tables.
--
--    mrr-snapshot-monthly            inserts into mrr_snapshots by selecting
--                                    from subscriptions joined to
--                                    subscription_plans. With zero
--                                    subscriptions it inserts zero rows every
--                                    month, forever.
--    expire-cancelled-subscriptions-daily
--                                    calls private.expire_cancelled_subscriptions(),
--                                    which updates subscriptions and
--                                    subscription_add_ons. Both are empty.
--
--    private.expire_cancelled_subscriptions() itself is left in place: it is
--    revoked from public/anon/authenticated, has no other caller, and keeping
--    it means a migration replay of 20260724094137 still lines up.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'mrr-snapshot-monthly') then
      perform cron.unschedule('mrr-snapshot-monthly');
    end if;
    if exists (select 1 from cron.job where jobname = 'expire-cancelled-subscriptions-daily') then
      perform cron.unschedule('expire-cancelled-subscriptions-daily');
    end if;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Prove it.
-- ---------------------------------------------------------------------------
do $$
declare
  v_plans int;
  v_addons int;
  v_jobs int;
begin
  select count(*) into v_plans from public.subscription_plans where is_active;
  if v_plans <> 0 then
    raise exception 'still % active subscription_plans rows', v_plans;
  end if;

  select count(*) into v_addons from public.add_ons where is_active;
  if v_addons <> 0 then
    raise exception 'still % active add_ons rows', v_addons;
  end if;

  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    select count(*) into v_jobs from cron.job
      where jobname in ('mrr-snapshot-monthly', 'expire-cancelled-subscriptions-daily');
    if v_jobs <> 0 then
      raise exception 'still % retired subscription cron job(s) scheduled', v_jobs;
    end if;
  end if;

  -- Deliberately no "rows still present" assertion here: on a fresh
  -- `supabase db reset` the catalogue can legitimately be empty at this point
  -- in migration order. The rows are parked rather than deleted on the live
  -- project, which is what the header records.
end;
$$;
