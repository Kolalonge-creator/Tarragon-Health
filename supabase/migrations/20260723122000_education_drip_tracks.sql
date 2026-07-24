-- Tarragon Health — per-programme drip tracks + a real starter curriculum
-- (founder ask: drip pacing "fully built", with specifics per health
-- programme and priorities, including general).
--
-- What changes vs the flat drip (20260723010123):
--   * Each condition is its own TRACK with its own clock: a hypertension
--     lesson tagged drip_week=2 unlocks two weeks after the patient's
--     hypertension care plan went active — not two weeks after they joined.
--     A patient who starts a diabetes programme six months in gets the
--     diabetes curriculum from week 1, exactly like Omada's per-programme
--     pacing. General (condition-null) items keep the global anchor (first
--     engagement / onboarding).
--   * Priority ordering: within the feed, the patient's condition-specific
--     lessons rank above general ones, and drip-week order preserves the
--     curriculum sequence — week 1 before week 3, never alphabetical soup.
--   * A seeded starter curriculum: weeks 1-4 for hypertension, diabetes and
--     obesity, weeks 1-3 general — honest, plain-language lessons with
--     knowledge checks, clinician_reviewed=false until a real doctor review
--     happens (the badge stays truthfully off).

create or replace function private.health_education_unlock_week(p_condition public.care_plan_condition)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(
    1,
    (floor(
      extract(epoch from (now() - coalesce(
        -- Condition tracks anchor to when THAT programme went active for the
        -- caller (earliest active plan of that condition).
        case when p_condition is not null then
          (select min(cp.created_at)
           from public.care_plans cp
           where cp.patient_id = (select auth.uid())
             and cp.condition = p_condition
             and cp.status = 'active')
        end,
        -- General track (and a condition track with no plan yet — which the
        -- feed's condition filter already excludes, this is just a safe
        -- fallback): first engagement, else onboarding completion.
        (select min(p.created_at) from public.health_education_progress p
          where p.patient_id = (select auth.uid())),
        (select pr.onboarding_completed_at from public.profiles pr
          where pr.id = (select auth.uid())),
        now()
      ))) / 604800.0
    ))::integer + 1
  );
$$;

create or replace function public.health_education_feed()
 returns table(content_id uuid, code text, title text, summary text, body text, content_type health_education_content_type, video_url text, estimated_minutes integer, condition care_plan_condition, clinician_reviewed boolean, reviewed_by_name text, has_knowledge_check boolean, knowledge_check jsonb, status health_education_status, check_score integer, check_total integer)
 language sql
 stable security definer
 set search_path to ''
as $function$
  with me as (
    select (select auth.uid()) as uid
  ),
  my_conditions as (
    select distinct cp.condition
    from public.care_plans cp, me
    where cp.patient_id = me.uid and cp.status = 'active'
  ),
  my_risk as (
    select coalesce(max(prs.risk_level), 'low'::public.risk_level) as risk_level
    from public.patient_risk_scores prs, me
    where prs.patient_id = me.uid
  )
  select
    c.id,
    c.code,
    c.title,
    c.summary,
    c.body,
    c.content_type,
    c.video_url,
    c.estimated_minutes,
    c.condition,
    c.clinician_reviewed,
    c.reviewed_by_name,
    (c.knowledge_check is not null and jsonb_array_length(c.knowledge_check) > 0) as has_knowledge_check,
    c.knowledge_check,
    p.status,
    p.check_score,
    p.check_total
  from public.health_education_content c
  cross join my_risk
  left join public.health_education_progress p
    on p.content_id = c.id and p.patient_id = (select auth.uid())
  where c.is_active
    and (c.condition is null or c.condition in (select condition from my_conditions))
    and (c.min_risk_level is null or c.min_risk_level <= my_risk.risk_level)
    and (c.drip_week is null or c.drip_week <= private.health_education_unlock_week(c.condition))
  order by
    case coalesce(p.status, 'seen')
      when 'needs_review' then 0
      else 1
    end,
    case when p.status is null then 0 else 1 end,
    case when p.status = 'understood' then 1 else 0 end,
    -- Programme-specific lessons before general ones; curriculum order within.
    case when c.condition is null then 1 else 0 end,
    coalesce(c.drip_week, 0),
    c.sort_order,
    c.title;
$function$;

create or replace function public.health_education_locked_count()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  with me as (
    select (select auth.uid()) as uid
  ),
  my_conditions as (
    select distinct cp.condition
    from public.care_plans cp, me
    where cp.patient_id = me.uid and cp.status = 'active'
  ),
  my_risk as (
    select coalesce(max(prs.risk_level), 'low'::public.risk_level) as risk_level
    from public.patient_risk_scores prs, me
    where prs.patient_id = me.uid
  )
  select count(*)::integer
  from public.health_education_content c
  cross join my_risk
  where c.is_active
    and (c.condition is null or c.condition in (select condition from my_conditions))
    and (c.min_risk_level is null or c.min_risk_level <= my_risk.risk_level)
    and c.drip_week is not null
    and c.drip_week > private.health_education_unlock_week(c.condition);
$$;

-- ---------------------------------------------------------------------------
-- Starter curriculum. Idempotent on code; every item is honest plain-language
-- education (no diagnosis, no fear copy), clinician_reviewed=false until a
-- real review record exists.
-- ---------------------------------------------------------------------------
insert into public.health_education_content
  (code, title, summary, body, content_type, estimated_minutes, condition, drip_week, sort_order, is_active, clinician_reviewed, knowledge_check)
values
-- Hypertension track ---------------------------------------------------------
('htn_w1_what_your_numbers_mean', 'Week 1: What your blood pressure numbers mean', 'The two numbers, what counts as high, and why the pattern matters more than any single reading.',
'Your reading has two numbers, like 130/85. The top number is the pressure when your heart squeezes; the bottom is the pressure while it rests between beats.

For most adults, under 130/85 at rest is healthy territory. Readings that keep coming back at 140/90 or higher are what your care team treats as high.

One high reading is not a verdict — stress, caffeine, even rushing to the machine can push it up. What matters is the pattern across days, taken while seated and rested. That is exactly why logging your readings here matters: your care team reads the trend, not one number.',
'article', 3, 'hypertension', 1, 10, true, false,
'[{"question": "Which matters most to your care team?", "options": ["One single high reading", "The pattern of readings across days", "The reading you get after a brisk walk"], "answer_index": 1}]'::jsonb),

('htn_w2_salt_you_cannot_see', 'Week 2: The salt you can''t see', 'Most excess salt never comes from your salt spoon — where it hides and what to change first.',
'Cutting salt is one of the most effective things you can personally do for blood pressure — but the salt spoon is the smallest part of the problem.

Most of it hides in seasoning cubes, instant noodles, tinned and processed foods, salted fish, and ready-made spice mixes. One seasoning cube can carry more sodium than you would ever sprinkle on a plate.

Start with one swap this week: halve the cubes in your cooking and taste before adding more. Cook from fresh ingredients where you can. Your tongue recalibrates in about two weeks — food stops tasting bland and your readings quietly thank you.',
'article', 3, 'hypertension', 2, 20, true, false,
'[{"question": "Where does most hidden salt come from?", "options": ["The salt spoon at the table", "Seasoning cubes and processed foods", "Fresh vegetables"], "answer_index": 1}]'::jsonb),

('htn_w3_medicines_that_work_quietly', 'Week 3: Why you take medicine even when you feel fine', 'High blood pressure has no feeling — what the tablets are actually doing, and why stopping quietly is the trap.',
'High blood pressure almost never announces itself. You can feel completely fine at 170/100 — which is exactly why people stop their tablets and feel no different for months, while the pressure quietly strains the heart, kidneys and brain.

Your medicine is not treating how you feel today. It is lowering the wear on your blood vessels for the next twenty years.

If side effects bother you — swollen ankles, a dry cough, dizziness — do not just stop. Tell your care team here; there is almost always an alternative that suits you better. Stopping silently is the one move that undoes everything.',
'article', 3, 'hypertension', 3, 30, true, false,
'[{"question": "You''ve felt fine for 3 months on your tablets. What does that mean?", "options": ["The medicine is working — keep going", "You''re cured and can stop", "The dose was too high"], "answer_index": 0}]'::jsonb),

('htn_w4_movement_that_counts', 'Week 4: Movement that actually lowers pressure', 'Thirty minutes of brisk walking most days measurably lowers blood pressure — no gym required.',
'Regular movement lowers blood pressure on its own, even before any weight changes. The evidence-backed dose is unglamorous: about 30 minutes of brisk walking, most days.

Brisk means you can talk but not sing. A route near home, the same time each day, counts far more than an ambitious plan you do twice.

Stack it onto something you already do — walk the long way from the bus stop, take calls on your feet. Log your readings as you build the habit; watching your own average drift down is the best motivation there is.',
'article', 3, 'hypertension', 4, 40, true, false, null),

-- Diabetes track -------------------------------------------------------------
('dm_w1_what_is_happening', 'Week 1: What is actually happening in diabetes', 'Insulin, sugar, and why "too much sugar in the blood" is only half the story.',
'Every meal becomes glucose — the fuel your cells run on. Insulin is the key that lets that fuel out of the bloodstream and into the cells. In type 2 diabetes the key still exists, but the locks have grown stiff: sugar stays stuck in the blood while your cells run short.

High blood sugar does its damage quietly, over years, to small blood vessels — eyes, kidneys, nerves, heart.

The good news is the same mechanism in reverse: food choices, movement, weight and the right medicines all loosen those locks. Managed early and consistently, diabetes is compatible with a long, full life. That is what this programme is for.',
'article', 4, 'diabetes', 1, 10, true, false,
'[{"question": "In type 2 diabetes, the core problem is that…", "options": ["The body has no insulin at all", "Cells respond poorly to insulin, so sugar stays in the blood", "Sugar is not absorbed from food"], "answer_index": 1}]'::jsonb),

('dm_w2_plate_method', 'Week 2: The plate method — eating well without weighing anything', 'Half vegetables, a quarter protein, a quarter starch — the simplest eating pattern that actually moves your sugar.',
'You do not need to weigh food or count every carbohydrate. Picture your plate in three parts: half non-starchy vegetables (greens, okra without heavy oil, garden egg, cabbage), a quarter protein (fish, chicken, beans, eggs), and a quarter starch (rice, yam, swallow, bread).

The starch quarter is where blood sugar is won or lost — it is usually the part that fills half the plate. Shrinking it, not banning it, is the move.

Swaps that help: unripe plantain over ripe, beans in place of some rice, wholegrain where you can. Eat slowly; sugar rises more gently from the same food eaten over twenty minutes than bolted in five.',
'article', 4, 'diabetes', 2, 20, true, false,
'[{"question": "On the plate method, the starch (rice/yam/swallow) should be…", "options": ["Half the plate", "A quarter of the plate", "Banned completely"], "answer_index": 1}]'::jsonb),

('dm_w3_lows_and_sick_days', 'Week 3: Low sugar and sick days — the two situations to prepare for', 'How to recognise and treat a low, and why illness needs a plan, not a pause.',
'If you take medicines that can drop your sugar, learn the feel of a low: shakiness, sweating, sudden hunger, a racing heart, confusion. Treat it fast — about three cubes of sugar, half a bottle of soft drink (not diet), or glucose tablets — then recheck in 15 minutes. Never sleep off a suspected low.

Sick days push sugar UP, even when you barely eat. Vomiting or purging while on diabetes medicines deserves a message to your care team the same day — some tablets need pausing when you cannot keep fluids down.

Keep something sugary within reach at home, at work and in your bag. Preparedness is not pessimism; it is what makes the condition boring — and boring is the goal.',
'article', 4, 'diabetes', 3, 30, true, false,
'[{"question": "You feel shaky, sweaty and suddenly hungry. What first?", "options": ["Lie down and wait for it to pass", "Take fast sugar now, recheck in 15 minutes", "Take an extra dose of your diabetes medicine"], "answer_index": 1}]'::jsonb),

('dm_w4_beyond_sugar', 'Week 4: Feet, eyes and the yearly checks that protect them', 'Diabetes care is more than glucose — the small checks that catch problems while they are still small.',
'Because high sugar quietly affects small blood vessels and nerves, diabetes care includes a short list of protective habits beyond glucose numbers.

Feet: look at them daily — between the toes too. Numbness, tingling, or a cut that is slow to heal deserves a message to your care team, not a wait. Well-fitting shoes beat fashionable ones.

Yearly: an eye check (retinal screening — damage is treatable when caught early and silent until late), a kidney check (a simple urine and blood test), and blood pressure and cholesterol reviews — sugar, pressure and lipids multiply each other''s effects, so your care team manages them together.',
'article', 4, 'diabetes', 4, 40, true, false, null),

-- Obesity / weight track ------------------------------------------------------
('ob_w1_why_weight_is_medical', 'Week 1: Why weight is a medical matter, not a willpower verdict', 'Biology fights weight loss — which is exactly why structured support beats going it alone.',
'If losing weight were simply a decision, nobody would carry extra weight. Your body actively defends its current weight: hunger hormones rise when you cut back, and metabolism quietly slows. That is biology, not weakness.

This is why the programme treats weight like any other medical condition: with a plan, follow-up, and adjustments — not blame.

The target that changes health is smaller than most people think: losing 5–10% of body weight, and keeping it off, measurably improves blood pressure, blood sugar and cholesterol. For a 100 kg person that is 5–10 kg — a realistic, defensible goal.',
'article', 3, 'obesity', 1, 10, true, false,
'[{"question": "What weight loss already measurably improves health?", "options": ["Only reaching a ''normal'' BMI", "5-10% of body weight, kept off", "Nothing under 20 kg"], "answer_index": 1}]'::jsonb),

('ob_w2_food_that_keeps_you_full', 'Week 2: Eat to stay full — protein, fibre and the liquid-calorie trap', 'The practical food changes that reduce hunger instead of fighting it.',
'Diets fail when they leave you hungry. The workaround is choosing food that fills you for longer at the same calories.

Protein (beans, eggs, fish, chicken, moi moi) and fibre (vegetables, wholegrains, unripe plantain) hold hunger down for hours. White starches and fried snacks burn off fast and leave you hunting for more.

The quietest saboteur is liquid: soft drinks, juice, malt drinks and sweetened tea can carry a meal''s worth of calories with zero fullness. Swapping them for water or zobo without sugar is often worth more than any other single change this month.',
'article', 3, 'obesity', 2, 20, true, false,
'[{"question": "Which change often removes the most calories with the least hunger?", "options": ["Skipping breakfast", "Replacing sugary drinks with water", "Eating only once a day"], "answer_index": 1}]'::jsonb),

('ob_w3_track_the_trend', 'Week 3: Weigh weekly, judge monthly', 'Daily weight bounces are noise — how to track so the trend keeps you honest and sane.',
'Your weight swings a kilo or two day to day on water, salt and timing alone. Judging yourself by daily numbers is how motivation dies in week two.

The steadier habit: weigh once a week — same day, same time, before breakfast — and log it here. Judge the direction over a month, not the number over a day.

A month that holds steady after a losing streak is not failure; plateaus are part of every real weight-loss curve. What your care team watches is the six-month line — and every reading you log sharpens their picture.',
'article', 3, 'obesity', 3, 30, true, false,
'[{"question": "The most useful weigh-in habit is…", "options": ["Every morning, judged daily", "Once a week, judged over a month", "Only at clinic visits"], "answer_index": 1}]'::jsonb),

('ob_w4_movement_and_muscle', 'Week 4: Movement for weight — and why muscle is your ally', 'Walking burns the fat; strength work protects the engine that keeps it off.',
'For weight, movement''s biggest job is not burning today''s calories — it is protecting muscle while you lose fat. Muscle is the engine that burns calories at rest; crash diets that strip it away are why the weight comes back with interest.

The combination that works: brisk walking most days, plus two days a week of simple strength work — squats to a chair, wall press-ups, carrying shopping. No gym required.

Movement also buys you better sleep, and short sleep drives hunger hormones the wrong way. The pieces reinforce each other — which is why the programme asks about all of them, not just the scale.',
'article', 3, 'obesity', 4, 40, true, false, null),

-- General track ---------------------------------------------------------------
('gen_w1_your_numbers_baseline', 'Week 1: Know your four numbers', 'Blood pressure, blood sugar, cholesterol, waist — the baseline every adult should own.',
'Four numbers predict more about your next twenty years than almost anything else: your blood pressure, your blood sugar (HbA1c or fasting glucose), your cholesterol panel, and your waist measurement.

None of them can be felt. All of them can be measured cheaply, and all of them respond to action when caught drifting.

If you do not know yours, that is this week''s task: log a blood pressure reading, and book the blood tests through the app if you are due. A baseline turns every future reading into information.',
'article', 3, null, 1, 10, true, false,
'[{"question": "Why measure these numbers if you feel fine?", "options": ["Feeling fine means they must be normal", "None of them can be felt — measuring is the only way to know", "They only matter after age 60"], "answer_index": 1}]'::jsonb),

('gen_w2_sleep_is_treatment', 'Week 2: Sleep is not a luxury', 'Short, broken sleep pushes blood pressure, sugar and appetite the wrong way — the fixes are unglamorous and effective.',
'Sleep is when blood pressure dips, sugar regulation resets and appetite hormones rebalance. Chronically short or broken sleep pushes all three the wrong way — it is a health input as real as diet.

The fixes are boring and effective: a consistent sleep and wake time (weekends included), screens out of the last 30 minutes, caffeine finished by early afternoon, and the room as dark and cool as you can manage.

One flag worth raising with your care team: loud snoring with gasping or choking. That pattern (sleep apnoea) quietly drives resistant blood pressure and daytime exhaustion — and it is very treatable.',
'article', 3, null, 2, 20, true, false, null),

('gen_w3_reading_your_results', 'Week 3: How to read a lab result without panicking', 'Flags and asterisks are conversation starters, not verdicts — what "abnormal" actually means.',
'A lab report full of flags can look alarming. Here is the honest context: reference ranges describe where 95% of healthy people fall — which means a perfectly healthy person will sit slightly outside some range on a long enough panel.

A single mildly-out-of-range value is a conversation starter, not a diagnosis. What your care team weighs is the pattern: how far out, in what combination, and how it compares with YOUR previous results — which is why results here live on your record, not in a drawer.

The rule of thumb: never ignore a flagged result, and never panic over one either. Ask. If something on your record needs action, your care team flags it — that is the whole point of monitored care.',
'article', 3, null, 3, 30, true, false,
'[{"question": "One value sits just outside the reference range. What does that mean?", "options": ["A definite diagnosis", "Worth a question — pattern and history decide, not one value", "Labs are unreliable"], "answer_index": 1}]'::jsonb)

on conflict (code) do nothing;
