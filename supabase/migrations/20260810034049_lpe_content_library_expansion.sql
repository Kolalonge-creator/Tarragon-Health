-- ============================================================================
-- LPE content library — expansion (30 more draft blocks, on top of the 28
-- from 20260810032440_lpe_content_library_starter.sql, total 58).
--
-- Still a DRAFT: clinician_reviewed = false throughout, same as the starter
-- batch — see that migration's header comment for the full rationale.
--
-- This batch goes a step deeper into clinically-relevant territory than the
-- starter batch (medication side-effect awareness, sleep apnoea symptom
-- awareness, hypoglycaemia recognition, orthostatic symptoms, sick-day
-- guidance) while holding to the exact same rules: never diagnose, never
-- give a specific dose/treatment instruction, never a clinical verdict,
-- always defer anything specific or concerning to the patient's care team.
-- Where content touches a real safety topic that also has a red-flag rule in
-- code (packages/lifestyle-engine/src/adapters/obesity.ts's severe_osa and
-- aom_warning_symptom rules), the content is written to reinforce the same
-- "mention it to your care team" behaviour those rules already encode, not
-- to duplicate or override them.
--
-- Same toneGuard bar as the starter batch, verified the same way (every
-- title/body run through the exact deny-list regex before this file was
-- written, not just eyeballed).
-- ============================================================================

insert into public.lpe_content_blocks (condition, module, key, title, body_md, clinician_reviewed)
values
  -- ---------------- OBESITY ----------------
  ('obesity', 'diet', 'obesity.diet.protein_at_meals', 'Protein at each meal',
   $md$Including a source of protein, beans, fish, eggs, chicken, at each meal tends to help you feel satisfied for longer than starch or sugar alone. It doesn't need to be a large portion, just present at most meals as a habit.$md$,
   false),
  ('obesity', 'diet', 'obesity.diet.mindful_snacking', 'A pause before snacking',
   $md$Before reaching for a snack out of habit rather than hunger, try a short pause to ask what you actually want right now, food, a break, company, or something else. Sometimes the honest answer is food, and that's fine too, the pause is just about choosing on purpose.$md$,
   false),
  ('obesity', 'activity', 'obesity.activity.strength_basics', 'Why strength matters too',
   $md$Activities that work your muscles, carrying shopping, climbing stairs, simple bodyweight exercises, support your body differently than walking alone. You don't need equipment or a gym to start, a couple of short sessions a week using your own body weight is a reasonable place to begin.$md$,
   false),
  ('obesity', 'activity', 'obesity.activity.tracking_without_obsessing', 'Steps as a guide, not a rule',
   $md$A step count is a useful guide for noticing your general activity level over a week, but one lower day doesn't undo the days before it. Look at the trend across a week rather than judging any single day on its own.$md$,
   false),
  ('obesity', 'behaviour', 'obesity.behaviour.plateau_normal', 'When progress seems to pause',
   $md$It's common for progress to slow down or level off for a stretch even when you're keeping up the same habits, your body adjusts over time. A pause isn't a sign to abandon what you're doing, it's often just part of the process, and your care team can help you look at whether anything's worth adjusting.$md$,
   false),
  ('obesity', 'behaviour', 'obesity.behaviour.medication_side_effects', 'Starting a weight-management medication',
   $md$If your care team has started you on a weight-management medication, mild nausea or a change in appetite in the first few weeks is common and often settles down. Ongoing vomiting, severe stomach pain, or signs you're not keeping fluids down are worth calling your care team about promptly rather than waiting it out.$md$,
   false),
  ('obesity', 'sleep', 'obesity.sleep.watch_for_signs', 'Snoring and sleep, worth mentioning',
   $md$Loud snoring, waking up gasping or choking, or feeling very sleepy during the day even after a full night's sleep can sometimes point to something worth a closer look. If someone's mentioned your snoring, or this sounds familiar, it's worth raising with your care team at your next check-in.$md$,
   false),
  ('obesity', 'sleep', 'obesity.sleep.naps_and_night_sleep', 'Naps and your night''s sleep',
   $md$A short nap earlier in the day can be genuinely helpful, but a long nap or one taken late in the afternoon can sometimes make it harder to fall asleep at night. If you nap, keeping it under thirty minutes and earlier in the day is worth trying.$md$,
   false),
  ('obesity', 'stress', 'obesity.stress.social_situations', 'Food-centred gatherings',
   $md$Celebrations, family visits, and gatherings built around food are a normal part of life, not something to avoid or feel awkward about. Going in with a general plan, eating what you enjoy, paying attention to how full you feel, tends to work better than strict rules that are hard to keep at a party.$md$,
   false),
  ('obesity', 'stress', 'obesity.stress.self_talk', 'How you talk to yourself matters',
   $md$The way you talk to yourself about a setback, a missed walk, a bigger meal than planned, tends to shape whether you get back on track quickly or not. Try noticing that inner voice, and speaking to yourself the way you'd speak to a friend in the same situation.$md$,
   false),

  -- ---------------- HYPERTENSION ----------------
  ('hypertension', 'diet', 'htn.diet.potassium_rich_foods', 'Foods naturally rich in potassium',
   $md$Bananas, beans, leafy greens, oranges, and potatoes with the skin on are all naturally rich in potassium, which works alongside a lower-salt pattern to support healthier blood pressure. Building a few of these into your week is a simple, food-first place to start.$md$,
   false),
  ('hypertension', 'diet', 'htn.diet.alcohol_and_bp', 'Alcohol and blood pressure',
   $md$Drinking less alcohol, or none, tends to support healthier blood pressure over time, and even cutting back gradually can make a difference. If you drink, talk to your care team about what a sensible amount looks like for you.$md$,
   false),
  ('hypertension', 'activity', 'htn.activity.warming_up', 'Starting activity safely',
   $md$If you're new to regular activity, starting gently, a slow walk, then building up pace and distance over a few weeks, is a safer and more sustainable way in than starting hard. Your care team can advise on what's appropriate given your own health history.$md$,
   false),
  ('hypertension', 'activity', 'htn.activity.staying_consistent_when_busy', 'Fitting activity into a busy day',
   $md$On days that feel too packed for a proper walk, a few short bursts, five minutes here and there, still add up and count. Consistency over a lower bar beats an ambitious plan you can only manage some weeks.$md$,
   false),
  ('hypertension', 'behaviour', 'htn.behaviour.dizziness_when_standing', 'Feeling dizzy when you stand up',
   $md$Occasional light-headedness when standing up quickly can happen for a lot of reasons, including some blood pressure medications. If it happens often, or feels like more than a passing moment, it's worth mentioning to your care team rather than just working around it.$md$,
   false),
  ('hypertension', 'behaviour', 'htn.behaviour.tracking_trends_not_single_readings', 'One reading is a data point, not the whole picture',
   $md$A single higher-than-usual reading can happen for lots of ordinary reasons, a stressful morning, rushing to take it, a big meal beforehand. Logging consistently so your care team can see the pattern over time is far more useful than reacting to any one number on its own.$md$,
   false),

  -- ---------------- DIABETES ----------------
  ('diabetes', 'diet', 'diabetes.diet.fibre_and_glucose', 'Fibre and your glucose',
   $md$Foods with more fibre, vegetables, beans, whole grains, tend to raise glucose more slowly and gently than their refined versions. Swapping in a fibre-rich option where you can, more beans, less white rice, is a simple place to start.$md$,
   false),
  ('diabetes', 'diet', 'diabetes.diet.hydration_habit', 'Staying hydrated',
   $md$Drinking water through the day, rather than mostly sugary or fizzy drinks, is one of the simplest changes that supports steadier glucose. Keeping a bottle of water nearby can make it an easier default.$md$,
   false),
  ('diabetes', 'activity', 'diabetes.activity.strength_and_glucose', 'Building some strength work in',
   $md$Activities that work your muscles, not just walking, tend to help your body use glucose more efficiently over time. A couple of short sessions a week, even just bodyweight moves at home, is a reasonable place to start.$md$,
   false),
  ('diabetes', 'activity', 'diabetes.activity.timing_around_meals', 'When you''re active, relative to meals',
   $md$Being active sometime after a meal, rather than only on an empty stomach, is often gentler and can help smooth out the glucose rise that follows eating. There's no single right time, find a rhythm that fits your day.$md$,
   false),
  ('diabetes', 'behaviour', 'diabetes.behaviour.low_glucose_signs', 'Recognising a low',
   $md$Shakiness, sudden sweating, feeling unusually hungry, or confusion can be signs your glucose has dropped lower than usual. It's worth knowing your own early signs and having a quick source of sugar on hand, and talking to your care team about what a plan for this should look like for you specifically.$md$,
   false),
  ('diabetes', 'behaviour', 'diabetes.behaviour.sick_day_basics', 'When you''re unwell',
   $md$Being unwell, even with something ordinary like a cold, can affect your glucose in ways that are hard to predict. Keep logging as best you can during this time, and reach out to your care team if your readings look unusual or you're not sure what to do.$md$,
   false),

  -- ---------------- GENERAL (condition-agnostic) ----------------
  (null, 'diet', 'general.diet.fibre_basics', 'Fibre, and why it matters',
   $md$Whole grains, beans, vegetables, and fruit all bring fibre to a meal, which tends to support steadier energy and a longer-lasting feeling of fullness. Building meals around a few of these most days is a solid, simple foundation.$md$,
   false),
  (null, 'diet', 'general.diet.hydration', 'Water as your default',
   $md$Making water your usual drink through the day, and saving sugary or fizzy drinks for occasionally, is one of the easiest changes with a real, cumulative effect. Keeping a bottle within reach makes it much easier to keep up.$md$,
   false),
  (null, 'sleep', 'general.sleep.caffeine_timing', 'Caffeine and your sleep',
   $md$Caffeine can stay in your system for several hours longer than it feels like it does, so a mid-afternoon coffee or tea can still affect how easily you fall asleep that night. Trying to have your last caffeinated drink by early afternoon is worth testing.$md$,
   false),
  (null, 'sleep', 'general.sleep.consistent_wake_time', 'The same wake-up time, most days',
   $md$Keeping your wake-up time steady, even on days you go to bed a bit later, helps your body's internal clock stay consistent. It's often a more powerful lever than trying to control your bedtime alone.$md$,
   false),
  (null, 'stress', 'general.stress.movement_as_a_reset', 'Moving your body to reset',
   $md$A short walk, some stretching, or just standing up and moving for a couple of minutes can shift a stressful moment more than sitting with it usually does. It doesn't need to be planned or long, just enough to change your state a little.$md$,
   false),
  (null, 'stress', 'general.stress.talking_to_someone', 'Talking to someone you trust',
   $md$Saying out loud what's going on, to a friend, a family member, or your care team, often makes a stressful stretch feel more manageable than carrying it alone. You don't need to have it figured out first, just talking about it is often the useful part.$md$,
   false),
  (null, 'behaviour', 'general.behaviour.small_wins_count', 'Small, consistent actions add up',
   $md$A short walk, one balanced meal, a single log entry, each one is small on its own, but they add up over weeks in a way that's easy to underestimate in the moment. Consistency in small actions tends to matter more than any single big effort.$md$,
   false),
  (null, 'behaviour', 'general.behaviour.telling_your_care_team_more', 'Tell your care team more than the numbers',
   $md$Your care team finds it useful to hear about more than just your logged readings, how you're feeling, what's getting in the way, what's working. The fuller picture helps them support you in ways that a number on its own can't show.$md$,
   false)
on conflict (key) do nothing;
