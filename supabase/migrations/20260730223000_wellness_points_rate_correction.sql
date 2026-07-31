-- Fix wellness_points_config.points_to_kobo_rate: the seeded default (1)
-- did not match its own inline comment's stated intent ("1 point = ₦1").
-- The redeem RPC computes kobo := round(points * rate), so rate=1 actually
-- paid 1 point = 1 kobo = ₦0.01 — a realistically-engaged patient earning
-- ~150-250 points/week (daily-capped logging + check-ins + education) would
-- redeem for under ₦2.50/week, which reads as an insult rather than a
-- reward. Correcting the RATE to deliver the value the comment already
-- promised (rate=100 => 1 point = 100 kobo = ₦1) rather than inventing a new
-- number outright. Still admin-editable at /admin/settings/wellness and
-- still a placeholder pending a real founder-confirmed figure, same
-- convention as every other placeholder price in this codebase.

update public.wellness_points_config
set points_to_kobo_rate = 100
where id = true
  and points_to_kobo_rate = 1;

comment on column public.wellness_points_config.points_to_kobo_rate is
  'Kobo credited to the Health Wallet per point redeemed (kobo := round(points * rate)). '
  'Default 100 => 1 point = 100 kobo = NGN 1. PLACEHOLDER, founder to confirm the real figure.';

do $$
declare
  v_rate numeric;
begin
  select points_to_kobo_rate into v_rate from public.wellness_points_config where id = true;
  if v_rate is distinct from 100 then
    raise exception 'wellness_points_rate_correction: expected points_to_kobo_rate = 100, found %', v_rate;
  end if;
end $$;
