-- ============================================================================
-- LPE content library — starter draft (28 blocks across obesity, hypertension,
-- diabetes, and condition-agnostic sleep/stress/behaviour content).
--
-- IMPORTANT: this is a DRAFT. Every row is inserted with clinician_reviewed =
-- false, on purpose — matching the philosophy already stated in
-- 20260719123000_lpe_seed_templates.sql ("Content is honest starter copy — a
-- clinician reviews/expands the library later"). Nothing in this repo
-- currently reads lpe_content_blocks into a patient-facing surface (see
-- embed-content.ts: no embedder is wired up yet), so this is safe to ship as
-- draft rows today. Whenever retrieval IS built, it must filter on
-- `clinician_reviewed = true` — the RLS policy on this table
-- (lpe_content_blocks_read, from 20260719120001_lpe_foundation.sql) allows
-- any authenticated user to SELECT all rows regardless of review status, so
-- the review gate has to be enforced in the retrieval query, not by RLS.
--
-- Content rules followed throughout (mirroring
-- packages/lifestyle-engine/src/messaging/index.ts's toneGuard, which is the
-- same bar this platform already holds nudge copy to):
--   - never "obese/obesity/fat/overweight/failure/failed/cheat/cheating/
--     lazy/willpower/shame"
--   - never a clinical verdict ("your BP/weight/glucose is fine/normal/
--     controlled", "nothing to worry about", "you're fine/healthy")
--   - no specific numeric targets, no medication/dose guidance, no diagnosis
--   - warm, person-first, no fear-based urgency (docs/BRAND_GUIDE.md §3)
--
-- Mapped to the goal templates seeded in 20260719123000_lpe_seed_templates.sql
-- where a natural pairing exists (e.g. htn.diet content supports the
-- 'reduce_salt' goal), but content blocks aren't goal-specific by schema —
-- retrieval (once built) matches on semantic similarity, not a hard FK.
-- ============================================================================

insert into public.lpe_content_blocks (condition, module, key, title, body_md, clinician_reviewed)
values
  -- ---------------- OBESITY ----------------
  ('obesity', 'diet', 'obesity.diet.half_plate', 'The half-plate idea',
   $md$A simple way to build a meal: fill half your plate with vegetables first, then add your protein and starch around it. You don't have to measure anything, just picture the plate before you start serving. It works with jollof, soup, or whatever you're already cooking, just shift the balance.$md$,
   false),
  ('obesity', 'diet', 'obesity.diet.slow_eating', 'Eating without rushing',
   $md$Eating a little more slowly, and putting your utensils down between bites, gives your body time to register that you're satisfied. It's a small shift, not a rule, and it's worth trying even just at one meal a day to start.$md$,
   false),
  ('obesity', 'activity', 'obesity.activity.short_walks', 'Small walks add up',
   $md$A ten-minute walk after a meal, or a short walk to break up a long sitting stretch, counts just as much as one long session. If a full workout feels like too much some days, a short walk is still a real win worth logging.$md$,
   false),
  ('obesity', 'activity', 'obesity.activity.everyday_movement', 'Moving through your day',
   $md$Taking the stairs, parking a little further away, or standing up while on a call all add activity minutes without needing a gym. None of it has to look impressive, it just has to be movement you'll actually keep doing.$md$,
   false),
  ('obesity', 'behaviour', 'obesity.behaviour.weekly_weigh_why', 'Why once a week works',
   $md$Weight moves around day to day with water, food, and hormones, so a single reading can be misleading either way. Weighing yourself on the same day each week, at roughly the same time, gives you a steadier picture of the real trend.$md$,
   false),
  ('obesity', 'behaviour', 'obesity.behaviour.start_smaller', 'Start smaller than you think',
   $md$A goal that feels almost too easy is usually the right size to start with, because you can actually keep it up. Once it's a habit, it's much easier to build on than to start over from a goal that felt like too much.$md$,
   false),
  ('obesity', 'sleep', 'obesity.sleep.sleep_and_goals', 'Sleep and your goals',
   $md$Short, disrupted sleep tends to make appetite harder to manage and cravings stronger the next day. Protecting even one extra half hour of sleep can make the rest of your plan easier to stick to, not just help you feel more rested.$md$,
   false),
  ('obesity', 'sleep', 'obesity.sleep.wind_down', 'A simple wind-down routine',
   $md$Doing the same few things each night, dimming the lights, putting your phone down, a warm drink, signals to your body that sleep is coming. It doesn't need to be elaborate, just repeated often enough to become familiar.$md$,
   false),
  ('obesity', 'stress', 'obesity.stress.noticing_patterns', 'Noticing your patterns',
   $md$Many people eat differently when they're stressed, bored, or tired, and that's an ordinary, human pattern, not something to hide from your care team. Just noticing when it happens, without judging it, is often the first useful step.$md$,
   false),
  ('obesity', 'stress', 'obesity.stress.breathing_reset', 'A one-minute breathing reset',
   $md$Before a stressful moment turns into snacking on autopilot, try breathing in for four counts and out for six, a few times. It only takes a minute, and it gives you a small pause to decide what you actually want to do next.$md$,
   false),

  -- ---------------- HYPERTENSION ----------------
  ('hypertension', 'diet', 'htn.diet.less_salt_cooking', 'Cooking with less salt, still tasty',
   $md$Try building flavour with onion, garlic, ginger, chilli, and fresh herbs before reaching for extra salt or stock cubes. It takes a couple of weeks for your taste buds to adjust, and most people find they stop missing the extra salt after that.$md$,
   false),
  ('hypertension', 'diet', 'htn.diet.reading_labels', 'Spotting hidden salt on labels',
   $md$Stock cubes, instant noodles, canned soups, and processed snacks often carry far more salt than home cooking. Checking the label for sodium content, and choosing the lower option when you can, adds up over a week of meals.$md$,
   false),
  ('hypertension', 'activity', 'htn.activity.gentle_movement', 'Movement that helps',
   $md$Regular gentle activity, brisk walking, cycling, dancing, swimming, can support healthier blood pressure over time when it becomes a habit. It doesn't need to be intense: consistency matters more than intensity here.$md$,
   false),
  ('hypertension', 'activity', 'htn.activity.building_a_habit', 'Making activity a daily habit',
   $md$Attaching a short walk to something you already do daily, after breakfast, after work, before dinner, makes it much easier to keep going than relying on motivation alone. Pick one anchor point and start there.$md$,
   false),
  ('hypertension', 'behaviour', 'htn.behaviour.home_readings', 'Getting a reliable home reading',
   $md$For a home blood pressure reading to be useful, sit quietly for a few minutes first, keep your arm supported at heart height, and avoid caffeine or activity in the half hour before. Taking it around the same time each day helps your care team see a clear pattern.$md$,
   false),
  ('hypertension', 'behaviour', 'htn.behaviour.same_time_every_day', 'Same time, every day',
   $md$Taking your medication and logging your readings at a consistent time each day makes it much easier for your care team to understand how you're doing and adjust your care plan when needed. If your routine changes, your care team can help you find a new time that sticks.$md$,
   false),

  -- ---------------- DIABETES ----------------
  ('diabetes', 'diet', 'diabetes.diet.carb_portions', 'Getting a feel for carb portions',
   $md$Rice, bread, yam, pounded foods, and similar starches all affect glucose the most out of anything on the plate. Getting familiar with what a moderate portion looks like for you, rather than cutting them out entirely, is usually easier to keep up long term.$md$,
   false),
  ('diabetes', 'diet', 'diabetes.diet.balanced_meals', 'Building a balanced meal',
   $md$Pairing your carbs with protein, vegetables, and a source of healthy fats tends to make glucose rise more gently after eating than carbs on their own. Try building meals this way as your usual pattern, rather than a special occasion.$md$,
   false),
  ('diabetes', 'activity', 'diabetes.activity.after_meal_walks', 'A short walk after eating',
   $md$A ten to fifteen minute walk after a meal can help your body use glucose more efficiently right when it's needed. It's one of the simplest changes to try, and you don't need anything more than a bit of space to walk.$md$,
   false),
  ('diabetes', 'activity', 'diabetes.activity.finding_what_works', 'Activity that fits your day',
   $md$Any regular movement, walking, housework, gardening, dancing, chasing after children, counts toward staying active. The best activity for you is the one you'll actually keep doing, not the one that looks most impressive.$md$,
   false),
  ('diabetes', 'behaviour', 'diabetes.behaviour.glucose_patterns', 'What your glucose log can show you',
   $md$A single reading tells you one moment, but a log over a week or two starts to show patterns, which meals, times of day, or activities tend to move things. Sharing that pattern with your care team is often more useful than any single number.$md$,
   false),
  ('diabetes', 'behaviour', 'diabetes.behaviour.daily_foot_check', 'A simple daily foot check',
   $md$A quick daily look at your feet, checking for cuts, blisters, redness, or numb patches, catches small issues early, while they're still easy to treat. It only takes a minute, and it's worth building into a routine you already have, like after a shower.$md$,
   false),

  -- ---------------- GENERAL (condition-agnostic) ----------------
  (null, 'sleep', 'general.sleep.the_basics', 'The basics of good sleep',
   $md$Going to bed and waking up around the same time most days, even on weekends, helps your body settle into a rhythm. A cool, dark, quiet room and a consistent routine beforehand both make it easier to fall and stay asleep.$md$,
   false),
  (null, 'sleep', 'general.sleep.screens_before_bed', 'Screens and winding down',
   $md$The bright light from a phone or television screen can make it harder for your body to feel ready for sleep. Trying to put screens away thirty to sixty minutes before bed, even a few nights a week, is worth testing out.$md$,
   false),
  (null, 'stress', 'general.stress.naming_it', 'Naming what you''re feeling',
   $md$Simply naming a feeling, stressed, tired, anxious, overwhelmed, to yourself or someone else can take some of its intensity down a notch. It's a small habit, but it's often the first step before deciding what, if anything, you want to do about it.$md$,
   false),
  (null, 'stress', 'general.stress.small_resets', 'Small resets during a busy day',
   $md$A short pause, stepping outside for a few minutes, a few slow breaths, a short stretch, can interrupt a stressful stretch of the day before it builds up. These small resets add up over a week more than people expect.$md$,
   false),
  (null, 'behaviour', 'general.behaviour.why_logging_helps', 'Why logging helps, even on off days',
   $md$The days that feel off, a skipped walk, a heavier meal, a missed log, are just as useful for your care team to see as the good days. A complete picture, gaps and all, helps them support you better than a record that only shows the wins.$md$,
   false),
  (null, 'behaviour', 'general.behaviour.getting_back_on_track', 'If you go a few days without logging',
   $md$It's ordinary to go a few days without logging, life gets busy. Whenever you're ready, just pick back up from today, there's no need to fill in what you missed or start over from the beginning.$md$,
   false)
on conflict (key) do nothing;
