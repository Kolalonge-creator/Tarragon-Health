-- Tarragon Health — Health Education library expansion: rounding out the
-- existing hypertension/diabetes/weight tracks with topics their 12-week
-- curricula don't cover (pregnancy, travel, medicines, stigma), plus more
-- getting_started items covering how to actually use Tarragon day to day.
-- Same honesty rule: clinician_reviewed left at its default false, no
-- fabricated reviewed_by_name/reviewed_at.

insert into public.health_education_content
  (code, title, summary, body, content_type, estimated_minutes, condition, category, sort_order, knowledge_check)
values

-- ============================================================================
-- Hypertension additions
-- ============================================================================
('htn-pregnancy-preeclampsia', 'High blood pressure in pregnancy: what to watch for',
 'Preeclampsia is serious but very manageable when caught through routine checks.',
 E'Blood pressure is checked at nearly every antenatal visit for a reason — a rise in pregnancy can be an early sign of preeclampsia, a condition that needs monitoring and sometimes treatment to keep both parent and baby safe.\n\nSigns worth reporting immediately, beyond a raised reading at a check-up: a severe headache that will not ease, vision changes (blurring, flashing lights), sudden swelling in the face or hands, or pain under the ribs on the right side.\n\nThis is exactly why keeping every antenatal appointment matters, even when you feel completely well — preeclampsia can develop with few symptoms you would notice yourself, which is why the routine check, not how you feel, is what catches it.',
 'article', 3, 'hypertension', 'hypertension', 200,
 '[{"question": "Why is blood pressure checked at almost every antenatal visit?", "options": ["It''s not important, just routine paperwork", "A rise can be an early sign of preeclampsia", "It only matters in the third trimester"], "answer_index": 1}]'::jsonb),

('htn-emergency-signs', 'When a blood pressure reading is a genuine emergency',
 'Most high readings are not an emergency — a specific combination is.',
 E'A single high reading, even a notably high one, is usually not itself an emergency — it is a signal to recheck calmly and mention it to your care team. What changes things is a very high reading combined with certain symptoms.\n\nSeek emergency care immediately for a very high reading alongside: a severe headache, chest pain, shortness of breath, vision changes, confusion, or difficulty speaking. This combination can mean organs are being affected right now, not just a number worth monitoring.\n\nA high reading with no symptoms at all is still worth acting on — rest, recheck in a few minutes seated calmly, and contact your care team — but it is a different situation from the emergency combination above, and knowing the difference avoids both dangerous delay and unnecessary panic.',
 'article', 3, 'hypertension', 'hypertension', 210, null),

('htn-white-coat-masked', 'Why your reading at the clinic might not match home',
 'White-coat and masked hypertension explained — why home readings matter so much.',
 E'Some people''s blood pressure runs higher specifically in a clinical setting, from the mild stress of the visit itself — called "white-coat hypertension." Less commonly, the reverse happens: normal at the clinic but higher at home, called "masked hypertension," which is easy to miss entirely without home readings.\n\nThis is a major reason your care team asks you to log readings here regularly rather than relying on clinic visits alone — a home log spanning many readings across different days paints a far more accurate picture than any single clinic moment.\n\nIf your clinic and home readings consistently differ, mention the pattern directly — it changes how your care team interprets your numbers and can change the treatment decision itself.',
 'article', 3, 'hypertension', 'hypertension', 220, null),

('htn-caffeine-effect', 'Caffeine and your blood pressure',
 'A temporary bump after a strong cup — not usually something to fear, but worth knowing.',
 E'Caffeine can cause a temporary rise in blood pressure, typically peaking within about half an hour and easing within a few hours — which is worth knowing if you take a reading soon after a strong coffee or an energy drink and see it higher than expected.\n\nFor most people with well-controlled blood pressure, moderate regular caffeine intake does not cause lasting harm — the effect is usually more relevant to a single reading''s accuracy than to your long-term numbers.\n\nA practical habit: try to take your logged readings before your first coffee of the day, or after a similar gap each time, so your trend reflects your real baseline rather than caffeine timing noise.',
 'article', 2, 'hypertension', 'hypertension', 230, null),

-- ============================================================================
-- Diabetes additions
-- ============================================================================
('dm-gestational-diabetes', 'Gestational diabetes: what it means for you and your baby',
 'A common pregnancy condition, well managed with monitoring and, often, no medicine at all.',
 E'Gestational diabetes is high blood sugar that develops during pregnancy, usually identified through a routine screening test in the second trimester. It is common, and does not mean you had diabetes before or will necessarily have it after.\n\nManagement usually starts with diet and movement changes, which are enough for many people; some need medicine or insulin added, which is a normal part of the range of management, not a sign anything has gone wrong.\n\nGestational diabetes raises the chance of developing type 2 diabetes later in life, which is why a follow-up glucose check after delivery matters — it is a useful early-warning signal for your longer-term health, not just a pregnancy-specific issue.',
 'article', 3, 'diabetes', 'diabetes', 200, null),

('dm-travel-tips', 'Travelling with diabetes',
 'Time zones, meal timing, and medicine storage — a little planning goes a long way.',
 E'Travel disrupts the routine that diabetes management often relies on, so a little extra planning helps. Pack more testing supplies and medicine than you expect to need, keep insulin (if you use it) at a stable temperature using a cool pack rather than direct ice, and carry medicines in hand luggage in case of delayed baggage.\n\nCrossing time zones can affect insulin timing for those who use it — ask your care team for specific guidance if your trip crosses several zones, rather than guessing on the day.\n\nKeep fast-acting sugar accessible during travel days, which often involve less predictable meal timing than your normal routine — preparedness here is what keeps travel enjoyable rather than stressful.',
 'article', 3, 'diabetes', 'diabetes', 210, null),

('dm-insulin-basics', 'Insulin basics, for those who need it',
 'Needing insulin is not a failure — it is simply the right tool for where your diabetes is now.',
 E'Some people with diabetes need insulin, either from diagnosis or added later as the condition progresses — this reflects how the condition naturally changes over time, not a sign that earlier management "failed."\n\nDifferent insulin types work at different speeds: some act quickly around meals, some provide a steady background level through the day. Your care team tailors the specific combination and timing to your life and readings, not a one-size-fits-all schedule.\n\nCorrect storage (many insulins need refrigeration, though the pen or vial in current use is often fine at room temperature for a limited time) and correct injection technique both matter for how well it works — ask your care team or pharmacist to walk through both directly.',
 'article', 3, 'diabetes', 'diabetes', 220, null),

('dm-dental-health-link', 'Diabetes and your dental health',
 'Higher blood sugar makes gum disease more likely — and gum disease can push sugar higher in turn.',
 E'Diabetes and gum disease affect each other in both directions: higher blood sugar makes infections, including gum infections, more likely and harder to fight off, and gum infection or inflammation can in turn make blood sugar harder to control — a two-way link worth knowing.\n\nRegular dental check-ups, and mentioning your diabetes to your dentist, let them watch for this specifically rather than treating it as a routine unrelated visit.\n\nDaily brushing and flossing matter more with diabetes than they might otherwise, and any persistent gum bleeding, swelling or bad breath is worth a dental visit rather than waiting for your next scheduled check-up.',
 'article', 2, 'diabetes', 'diabetes', 230, null),

-- ============================================================================
-- Weight / obesity additions
-- ============================================================================
('ob-weight-loss-medicines-explained', 'Weight-loss medicines: what they are and aren''t',
 'A genuine medical tool for some people, alongside habits, not a replacement for them.',
 E'Newer weight-loss medicines work mainly by affecting appetite and fullness signals, helping many people eat less without constant hunger driving against them — a real, medically legitimate tool for some people, not a shortcut or a moral shortcoming to need.\n\nThey are prescribed based on specific criteria (not simply on request), typically alongside continued attention to diet and activity, not instead of them — the habits still matter for the results to hold.\n\nLike any medicine, they carry side effects and considerations specific to your health history, so this is a conversation to have directly with your care team about whether you are a suitable candidate, not a decision to make from general information alone.',
 'article', 3, 'obesity', 'weight', 200, null),

('ob-childhood-weight', 'Talking about weight with children, carefully',
 'How this conversation happens matters enormously for a child''s lifelong relationship with food.',
 E'Childhood weight is a sensitive, important topic — handled well, it protects a child''s health without damaging their relationship with food or their body; handled carelessly, it can cause lasting harm even with good intentions behind it.\n\nWhat generally helps: focusing conversations on health behaviours (family meals, active play, sleep) rather than weight or appearance directly, avoiding comparisons to other children, and modelling the habits you want to encourage rather than only instructing.\n\nIf you have concerns about a child''s growth, that is a conversation for your care team, who track growth against appropriate charts over time — not something to address through comments about food or body at home, which tend to backfire.',
 'article', 3, null, 'weight', 210, null),

('ob-bmi-limitations', 'BMI: a useful screening number with real limits',
 'It is a starting point for a conversation, not a verdict on your health.',
 E'BMI (body mass index) is a simple calculation from height and weight, useful as a quick population-level screening tool — but it has real limitations for any individual: it does not distinguish muscle from fat, and does not directly measure where fat is distributed, which matters for health risk.\n\nA very muscular person can have a "high" BMI without excess fat; body composition and distribution (particularly abdominal fat) often tell a more complete story than BMI alone.\n\nYour care team uses BMI as one input among several, not a standalone verdict — waist measurement, blood pressure, blood sugar and cholesterol together give a much fuller picture of your actual health than any single number.',
 'article', 3, null, 'weight', 220, null),

('ob-weight-stigma-healthcare', 'Weight stigma in healthcare, and what good care looks like',
 'You deserve care that treats your actual concern, not just your weight.',
 E'Weight stigma — having every health concern attributed to weight regardless of what you actually came in for — is a real, documented problem in healthcare, and it causes real harm: people delay care to avoid it, and genuine health issues sometimes get missed.\n\nGood weight-inclusive care means your actual symptom or concern gets properly evaluated on its own terms, with weight addressed only when it is genuinely relevant to what you are asking about — not defaulted to as the explanation for everything.\n\nIf you feel a concern was dismissed or attributed to weight without a proper look, it is entirely reasonable to ask directly for that specific concern to be evaluated, or to raise it with your care team as feedback.',
 'article', 3, null, 'weight', 230, null),

-- ============================================================================
-- Getting started additions
-- ============================================================================
('gs-using-the-app-daily', 'Using Tarragon day to day: what to actually do each week',
 'A short, realistic weekly rhythm rather than an overwhelming feature list.',
 E'Tarragon has a lot inside it, and you do not need to use all of it constantly to get real value. A realistic weekly rhythm for most people: log any home readings you take (blood pressure, glucose, weight) as you take them, check messages from your care team, and glance at your dashboard for anything flagged.\n\nMost of the deeper features — screenings, referrals, the education library, family features — are there for when you need them, not a checklist to complete constantly.\n\nIf you are not sure what you should be doing regularly for your specific situation, that is a completely reasonable question for your care team — the right rhythm differs depending on what you are managing.',
 'article', 3, null, 'getting_started', 200, null),

('gs-meet-your-care-team', 'Meet your care team: who does what',
 'A team, not one person — knowing the roles helps you know who to reach for what.',
 E'Your care is handled by a team rather than one individual, and knowing the roles helps you know who to reach for what. Care Coordinators handle logistics: booking, check-ins, and adherence follow-up — they route anything needing clinical judgement onward rather than deciding it themselves. Doctors review your readings, results and medicines, and their level of seniority scales with case complexity — most routine care is handled at the first level, with more complex cases seen by more senior doctors as needed.\n\nMessages you send go to your care team collectively, not to one named individual, which is what allows continuous coverage rather than a single point of failure when someone is unavailable.\n\nEvery review, escalation, or certificate still carries the name of the specific doctor who actually did it — team-based coverage does not mean anonymous care, it means reliable care.',
 'article', 3, null, 'getting_started', 210, null),

('gs-when-message-vs-emergency', 'When to message your care team vs when it''s an emergency',
 'A simple way to decide, so you never have to guess under pressure.',
 E'Knowing which channel to use saves time exactly when it matters most. Message your care team in the app for: a new mild-to-moderate symptom, a medicine question, a result you want explained, or anything that can reasonably wait for a same-day-to-a-few-days response.\n\nGo straight to emergency care, without waiting for an in-app reply, for: chest pain, severe breathlessness, signs of a stroke (face drooping, arm weakness, slurred speech), heavy bleeding, severe abdominal pain, or any situation where you would call for emergency help regardless of what app you had open.\n\nIf you are ever unsure which category applies, err toward emergency care — it is always the safer default when genuinely uncertain.',
 'article', 3, null, 'getting_started', 220, null),

('gs-complete-your-profile', 'Why a complete health profile makes your care better',
 'The details you fill in quietly shape everything from your screening calendar to your medicine safety checks.',
 E'Details like your family history, allergies, past conditions, and lifestyle factors are not just paperwork — they actively shape your screening calendar, medicine safety checks, and how your care team interprets your results.\n\nA profile filled in gradually over time is completely normal — you do not need to complete everything on day one, and adding detail as you think of it (a family diagnosis you remember, an allergy you forgot to mention) genuinely improves your care going forward.\n\nIf anything about your health history changes — a new diagnosis elsewhere, a new medicine from another provider — updating it here keeps your care team working from an accurate picture rather than an outdated one.',
 'article', 2, null, 'getting_started', 230, null),

('gs-understanding-your-plan', 'Understanding what''s included in your plan',
 'Knowing what''s included (and what isn''t yet) helps you get full value from what you''re paying for.',
 E'Different plans include different things — some include personalised health education, lab and referral coordination, an annual doctor review, or lifestyle coaching, while others cover the core essentials. It is worth actually knowing what your specific plan includes, since features you are entitled to are easy to miss if you never go looking.\n\nIf you see a feature gated behind an upgrade prompt, that is not a bug — it is genuinely not included in your current plan, and the prompt tells you exactly what tier includes it.\n\nIf you are unsure what your plan covers, your subscription page shows exactly what is included — worth a look occasionally, especially after any plan change.',
 'article', 2, null, 'getting_started', 240, null),

('gs-referrals-explained', 'Referrals and specialist visits, explained',
 'What happens after your care team says you need a specialist.',
 E'When your care team decides a specialist opinion would help, a referral connects you to one, along with the reason for it and relevant history so the specialist has context rather than starting from zero.\n\nYou can typically choose from suggested options where more than one is reasonable, and after the specialist visit, that finding generally comes back to your regular care team, so it becomes part of your ongoing record rather than a one-off, disconnected visit.\n\nA referral is coordination, not a handoff — your regular care team stays involved and informed throughout, and remains your main point of contact even while a specialist is involved.',
 'article', 3, null, 'getting_started', 250, null)

on conflict (code) do nothing;

-- Assertion: prove every row in this file actually landed, and that the
-- library is now genuinely large across every category.
do $$
declare
  inserted integer;
  total_active integer;
  category_count integer;
begin
  select count(*) into inserted
  from public.health_education_content
  where category in ('hypertension', 'diabetes', 'weight', 'getting_started')
    and sort_order >= 200;
  if inserted < 16 then
    raise exception 'expected at least 16 track-expansion rows, found %', inserted;
  end if;

  select count(*) into total_active from public.health_education_content where is_active;
  if total_active < 200 then
    raise exception 'expected the full health-education library to exceed 200 active items, found %', total_active;
  end if;

  select count(distinct category) into category_count from public.health_education_content where is_active;
  if category_count < 14 then
    raise exception 'expected all 14 categories to have at least one active item, found %', category_count;
  end if;
end $$;
