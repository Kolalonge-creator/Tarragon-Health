-- Tarragon Health — AI Health Coach duration-bounded upgrade pass.
--
-- Founder decision 2026-09-01: today's coach cadence is a flat daily-message
-- cap (COACH_DAILY_MESSAGE_LIMIT, apps/web/src/lib/ai-coach/rate-limit.ts,
-- default 20/day). The founder wants a paid way to raise that cap for a
-- bounded window — explicitly NOT a subscription (no auto-renewal; buying it
-- again is the only "renew"), same commercial shape as every other
-- service_products row. No new table or entitlement code needed:
-- access_duration_days + ai_coach_daily_limit already exist on
-- service_products and public.get_ai_coach_daily_limit() (rewired
-- 2026-08-31) already takes the highest ai_coach_daily_limit across the
-- patient's active, unexpired service_purchases. This migration only adds a
-- purchasable row.
--
-- features includes 'ai_coach' (not just a higher limit) so the pass is a
-- complete, standalone purchase — a patient on a plan that doesn't already
-- carry the ai_coach feature (e.g. free_pack, which predates the 2026-08-10
-- lifestyle_coaching bundling) still gets full access for the window, not
-- just a cap that does nothing without a qualifying base plan.
--
-- Price is a founder-adjustable placeholder, same status as every other
-- price in this codebase (see CLAUDE.md: "don't treat any price as
-- current") — update via a plain UPDATE once the founder sets a real one,
-- no migration needed for that.

insert into public.service_products (
  code, name, description, price_kobo, currency, access_duration_days,
  features, ai_coach_daily_limit, is_active
) values (
  'ai_coach_daily_pass_30d',
  'AI Coach Daily Pass (30 days)',
  'Raises your AI Health Coach daily message limit for 30 days — buy again any time to extend, no auto-renewal.',
  500000, -- placeholder ₦5,000 — founder to confirm real price
  'NGN',
  30,
  array['ai_coach'],
  100, -- 5x the env-default daily cap (20) — high but not unbounded, so a runaway client loop still can't be free
  true
)
on conflict (code) do nothing;

do $$
declare
  v_id uuid;
  v_limit integer;
  v_duration integer;
begin
  select id, ai_coach_daily_limit, access_duration_days
    into v_id, v_limit, v_duration
    from public.service_products where code = 'ai_coach_daily_pass_30d';

  if v_id is null then
    raise exception 'FAIL: ai_coach_daily_pass_30d was not seeded';
  end if;
  if v_duration is distinct from 30 then
    raise exception 'FAIL: ai_coach_daily_pass_30d must be a 30-day window, got %', v_duration;
  end if;
  if v_limit is null or v_limit <= 20 then
    raise exception 'FAIL: ai_coach_daily_pass_30d must raise the cap above the base default, got %', v_limit;
  end if;

  raise notice 'PASS: ai_coach_daily_pass_30d seeded (id=%, limit=%/day for % days)', v_id, v_limit, v_duration;
end $$;
