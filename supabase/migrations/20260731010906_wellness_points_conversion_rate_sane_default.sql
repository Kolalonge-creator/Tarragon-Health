-- The wellness points-to-kobo conversion rate shipped as 1 (i.e. 1 point =
-- 1 kobo) -- the seeding migration's own comment already flagged this as a
-- placeholder pending founder confirmation. At that rate a full month of
-- consistent daily logging (roughly 600-1000 points) redeems for under ₦10,
-- which reads as an insult rather than an incentive and undermines the
-- entire point of the rewards mechanic.
--
-- This does not resolve the founder confirmation the original migration
-- asked for -- it just replaces a degenerate value with a materially less
-- broken one, same "ship a real placeholder number, flag it" pattern this
-- codebase already uses everywhere else (Prevent tier pricing, video-visit
-- price, prevention_coordination add-on, etc.). Rough anchor: 50 kobo/point
-- puts a single 50-point LPE-goal award at ₦25, and a genuinely engaged
-- month (~1,000 points across logging/checkins/education) at roughly ₦500 --
-- the same order of magnitude as one flat prevention_reward milestone event,
-- not a fraction of a naira. Still a placeholder; still needs a real founder
-- number via the existing /admin/settings/wellness editor, which this
-- migration does not touch or bypass.
update public.wellness_points_config
  set points_to_kobo_rate = 50,
      updated_at = now()
where id = true
  and points_to_kobo_rate = 1;
