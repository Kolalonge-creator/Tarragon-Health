-- Tarragon Health — extend the priority-programme learning curriculum from
-- 4 weeks to a real 12-week course (hypertension, diabetes, obesity) and the
-- general/prevention track from 3 weeks to 12, matching the drip-week engine
-- already built (20260723122000_education_drip_tracks.sql — no code change
-- needed, private.health_education_unlock_week has no week cap). Same shape,
-- tone and honesty discipline as the existing starter curriculum:
-- clinician_reviewed=false until a real doctor review happens.
insert into public.health_education_content
  (code, title, summary, body, content_type, estimated_minutes, condition, drip_week, sort_order, is_active, clinician_reviewed, knowledge_check)
values
-- Hypertension track, weeks 5-12 -----------------------------------------------
('htn_w5_accurate_home_reading', 'Week 5: Getting an accurate reading at home', 'Cuff size, sitting position, and timing change your number more than people realise.',
'A blood pressure reading can shift by 10-15 points just from how it''s taken. Sit with your back supported, feet flat on the floor, arm resting at heart height — not dangling, not raised.

Rest quietly for five minutes first. Talking, a full bladder, or rushing straight from a walk all push the number up temporarily. Use the same arm each time where you can, and take two readings a minute apart — the second is usually the more accurate one.

A cuff that''s too small reads falsely high; too large reads falsely low. If your cuff came with the device, it was sized for an average adult arm — tell your care team if yours is noticeably larger or smaller, so the fit can be checked.',
'article', 3, 'hypertension', 5, 50, true, false,
'[{"question": "Why rest for five minutes before taking a reading?", "options": ["It''s not necessary", "Activity and rushing temporarily raise the number", "It only matters for the first reading of the day"], "answer_index": 1}]'::jsonb),

('htn_w6_alcohol', 'Week 6: Alcohol and your blood pressure', 'Drinking regularly raises blood pressure in a way that''s easy to miss because nothing feels different day to day.',
'Alcohol raises blood pressure directly, and the effect adds up with regular drinking, not just heavy sessions. It can also interact with some blood pressure medicines, and it adds calories that work against weight goals.

If you drink, keeping it modest and infrequent matters more than any specific brand or type. If you don''t drink, that''s already one thing working in your favour — no need to start.

If cutting back feels hard, that''s worth mentioning to your care team directly, not something to manage alone. It''s a common, private conversation, not a judgment.',
'article', 3, 'hypertension', 6, 60, true, false,
'[{"question": "How does regular alcohol use affect blood pressure?", "options": ["It has no measurable effect", "It raises it, and the effect builds with regular drinking", "It only matters if you binge drink"], "answer_index": 1}]'::jsonb),

('htn_w7_stress', 'Week 7: Stress and your numbers', 'Stress hormones raise blood pressure in the moment — the goal isn''t a stress-free life, it''s a way to come back down.',
'Stress triggers hormones that tighten blood vessels and speed the heart — useful for a real emergency, unhelpful when it''s traffic, deadlines, or money worry running on a loop. A single stressful day won''t undo months of good control, but constant, unmanaged stress keeps pressure elevated more of the time.

You don''t need to eliminate stress — that''s not realistic for most lives. What helps is a reliable way back down: slow breathing for a few minutes, a short walk, prayer or quiet time, talking to someone you trust.

If stress is affecting your sleep, appetite, or mood most days, say so at your next check-in. That''s a health matter your care team can actually help with, not something to push through alone.',
'article', 3, 'hypertension', 7, 70, true, false, null),

('htn_w8_tobacco', 'Week 8: Tobacco and blood pressure', 'Every cigarette causes a short, sharp spike — and smoking multiplies your cardiovascular risk on top of high blood pressure.',
'Each cigarette causes an immediate spike in blood pressure and heart rate that lasts about 20-30 minutes — smoke enough through the day and your pressure rarely settles. Smokeless tobacco (chewed or snuffed) raises it too; it isn''t a safer substitute.

The bigger issue is combined risk: tobacco damages blood vessels directly, so smoking with high blood pressure multiplies your risk of a heart attack or stroke rather than simply adding to it.

Quitting is hard, and most people need more than one attempt — that''s normal, not failure. Tell your care team if you use tobacco in any form; there are real supports, and it''s one of the highest-impact changes available to you.',
'article', 3, 'hypertension', 8, 80, true, false,
'[{"question": "Is smokeless tobacco (chewed/snuffed) a safe alternative for blood pressure?", "options": ["Yes, it doesn''t affect blood pressure", "No, it also raises blood pressure", "Only in small amounts"], "answer_index": 1}]'::jsonb),

('htn_w9_potassium', 'Week 9: Potassium — the other side of salt', 'Potassium-rich foods help your body handle sodium better; most people eat far less of them than they need.',
'Salt gets most of the attention, but potassium works against it — it helps your kidneys clear excess sodium and relaxes blood vessel walls. Most diets, Nigerian ones included, fall short of what''s protective.

Good sources: bananas, oranges, beans, groundnuts, avocado, spinach, and unripe plantain. Aim to add one potassium-rich food to a meal you already eat most days, rather than overhauling everything at once.

One caution: if you''re on certain blood pressure medicines (ACE inhibitors, ARBs, or a potassium-sparing diuretic), too much potassium can be a problem — check with your care team before using salt substitutes, which are often potassium chloride in disguise.',
'article', 3, 'hypertension', 9, 90, true, false,
'[{"question": "Why check with your care team before using a ''salt substitute''?", "options": ["They taste bad", "Salt substitutes are often potassium-based and can interact with some BP medicines", "They''re always more expensive"], "answer_index": 1}]'::jsonb),

('htn_w10_sleep_apnoea', 'Week 10: Snoring and resistant blood pressure', 'Loud snoring with pauses in breathing is a treatable condition that quietly keeps blood pressure high overnight and into the day.',
'If a partner has ever mentioned loud snoring, gasping, or pauses in your breathing at night, that''s worth raising directly — it describes sleep apnoea, and it''s one of the most common reasons blood pressure stays hard to control despite taking medicine correctly.

Apnoea repeatedly drops oxygen and jolts the body awake without you knowing, which keeps stress hormones elevated through the night. That''s why it shows up as daytime tiredness and blood pressure that won''t come down, not just as poor sleep.

It''s very treatable once identified — often with a simple device worn at night. If any of this sounds familiar, mention it at your next review rather than waiting to be asked.',
'article', 3, 'hypertension', 10, 100, true, false, null),

('htn_w11_multiple_medicines', 'Week 11: Why you might be on two or three tablets', 'Combining lower doses of different medicines usually controls pressure better, with fewer side effects, than one medicine pushed to its maximum.',
'If your care team has added a second or third blood pressure medicine, that''s not a sign your case is severe or that the first one failed — it''s often the plan from the start. Different medicines lower pressure through different routes in the body, so combining them at modest doses usually works better, and with fewer side effects, than maxing out a single drug.

Each one is doing a distinct job: some relax blood vessels, some reduce fluid, some slow the heart''s workload. Skipping one because "the others are enough" undoes that balance, even if your next reading looks fine.

If cost or pill burden is the real issue, say so — there are often combination tablets that fold two medicines into one, and your care team would rather solve that than have a dose quietly skipped.',
'article', 3, 'hypertension', 11, 110, true, false,
'[{"question": "Why might your care team combine two or three BP medicines at lower doses?", "options": ["It usually works better with fewer side effects than one medicine at a high dose", "It''s only done when the condition is severe", "It''s cheaper than one medicine"], "answer_index": 0}]'::jsonb),

('htn_w12_long_term', 'Week 12: What ''controlled'' looks like from here', 'You''ve finished the starter course — control is a maintained pattern, not a one-time achievement, and here''s what to watch for.',
'Twelve weeks in, the goal has shifted from learning to maintaining. ''Controlled'' means your readings sit consistently under 130/85 across weeks, not a single good number — keep logging, because the pattern is still what your care team reads.

From here, the rhythm is simple: take your medicine daily, log readings regularly, keep the habits from this course going, and attend your scheduled reviews. Nothing dramatic is expected of you week to week anymore — consistency is the whole job now.

One thing to know for real emergencies: a reading above roughly 180/120 with a severe headache, chest pain, vision change, or confusion needs urgent same-day care, not a routine message. Anything less urgent, even if it worries you, is exactly what your regular check-ins are for.',
'article', 3, 'hypertension', 12, 120, true, false,
'[{"question": "A reading above ~180/120 with a severe headache or chest pain needs…", "options": ["A routine message whenever convenient", "Urgent same-day care", "No action if you feel otherwise fine"], "answer_index": 1}]'::jsonb),

-- Diabetes track, weeks 5-12 -----------------------------------------------
('dm_w5_hba1c', 'Week 5: What HbA1c actually measures', 'One blood test that shows your average sugar over three months, not just today''s number.',
'A fasting or random glucose test is a snapshot of one moment. HbA1c is different — it measures how much sugar has been attaching to your red blood cells over roughly the last three months, giving your care team the real trend rather than one good or bad day.

For most people with diabetes, the target is below 7%, though your care team may set a different target based on your age, other conditions, and how long you''ve had diabetes — there''s no single number that fits everyone.

It''s usually checked every three to six months. Between tests, your own home readings still matter — they show the day-to-day pattern that HbA1c can''t, like which meals or times of day run high.',
'article', 4, 'diabetes', 5, 50, true, false,
'[{"question": "What does HbA1c measure, unlike a single glucose test?", "options": ["Your sugar right now, more precisely", "Your average blood sugar over roughly three months", "Your risk of getting diabetes in future"], "answer_index": 1}]'::jsonb),

('dm_w6_exercise_timing', 'Week 6: Exercise and blood sugar — timing matters', 'Movement lowers blood sugar, but timing around meals and medicine changes what you should watch for.',
'Exercise helps your muscles use sugar without needing as much insulin, which is why regular movement genuinely improves control over time. A walk after a meal is particularly effective — even 10-15 minutes measurably blunts the sugar rise from what you just ate.

If you take insulin or a sulfonylurea, exercise can push sugar too low, especially exercise that''s longer or more intense than usual. Carry a fast source of sugar, and if you''re trying a new activity level, check your sugar before and after until you know how your body responds.

Any movement counts — walking, house chores, stairs. The goal is consistency across most days, not intensity on a few.',
'article', 4, 'diabetes', 6, 60, true, false,
'[{"question": "If you take insulin or a sulfonylurea, unusually intense exercise can…", "options": ["Have no effect on sugar", "Push blood sugar too low", "Only raise blood sugar"], "answer_index": 1}]'::jsonb),

('dm_w7_heart_link', 'Week 7: Diabetes and your heart — why they''re managed together', 'High sugar, high blood pressure and high cholesterol damage blood vessels together, which is why your care team watches all three.',
'Diabetes roughly doubles the risk of heart disease and stroke, mainly because high blood sugar damages blood vessel walls over time — the same vessels that blood pressure and cholesterol also affect. That''s why a diabetes review usually checks all three, not glucose alone.

This is also why blood pressure and cholesterol targets are often stricter for someone with diabetes than for someone without it — the combined effect on your arteries is bigger than any one factor alone.

The upside: the same habits protect all three at once — movement, the plate method from week 2, and taking every prescribed medicine (not just the diabetes ones) all pull in the same direction.',
'article', 4, 'diabetes', 7, 70, true, false,
'[{"question": "Why does a diabetes review usually also check blood pressure and cholesterol?", "options": ["It''s unrelated but convenient to check together", "High sugar, blood pressure and cholesterol damage blood vessels together, multiplying risk", "Diabetes medicine requires it by law"], "answer_index": 1}]'::jsonb),

('dm_w8_eating_out', 'Week 8: Eating out and festive occasions', 'Owambe and parties don''t have to derail your control — a few habits protect you without standing out.',
'Big occasions and buffet-style eating are where control slips most easily — not because of one meal, but because portion sizes and hidden sugar (soft drinks, zobo with added sugar, dessert) stack up quietly.

A few things help without drawing attention: eat a small protein or fibre snack before you go, so you''re not arriving hungry; fill your plate once, starting with protein and vegetables; and choose water or unsweetened drinks as your default, saving a sweet one for a deliberate treat rather than a habit.

One indulgent meal will not undo weeks of good control — the pattern matters far more than any single event. Enjoy the occasion; just don''t skip your medicine because the routine felt disrupted.',
'article', 4, 'diabetes', 8, 80, true, false, null),

('dm_w9_burnout', 'Week 9: Diabetes burnout is real', 'Feeling exhausted by constant monitoring and decisions is common and has a name — it''s not a personal failing.',
'Diabetes asks for more daily decisions than almost any other condition — what to eat, when to check, whether a symptom means something. Feeling exhausted, resentful, or like you want to ignore it all for a while is common enough to have a name: diabetes burnout. It isn''t weakness, and it isn''t rare.

Burnout often shows up as skipping checks you used to do reliably, or quietly stopping medicine without telling anyone. If that''s happening, it''s a signal to talk to your care team, not a reason to hide it — the response is support, not a lecture.

Small resets help: pick one thing to track well this week instead of everything at once, and say out loud (to your care team or someone close) that you''re tired of it. Naming it usually loosens its grip.',
'article', 4, 'diabetes', 9, 90, true, false,
'[{"question": "If you notice yourself skipping checks or quietly stopping medicine, what should you do?", "options": ["Push through alone until it passes", "Tell your care team — burnout is common and treatable, not a failure", "Wait until the next scheduled appointment"], "answer_index": 1}]'::jsonb),

('dm_w10_medicines_explained', 'Week 10: Your medicines, explained', 'Metformin, sulfonylureas and insulin work differently — knowing the difference helps you understand your own plan.',
'Metformin is usually the first medicine prescribed — it reduces how much sugar your liver releases and helps your body respond better to its own insulin. It doesn''t typically cause low sugar on its own.

Sulfonylureas (like glimepiride) push your pancreas to release more insulin — effective, but they can cause lows, especially if a meal is delayed or skipped.

Insulin, given by injection, is sometimes needed when the pancreas can no longer produce enough on its own — this is common as diabetes progresses and is not a sign of failure or worsening behaviour. It''s simply the next tool for the same job: keeping sugar in range. Whatever combination you''re on, take it as prescribed, and ask your care team to walk through exactly what yours does if it''s ever unclear.',
'article', 4, 'diabetes', 10, 100, true, false,
'[{"question": "Needing insulin later in your diabetes journey usually means…", "options": ["You did something wrong", "It''s a common next step as the condition progresses, not a failure", "You no longer need to watch your diet"], "answer_index": 1}]'::jsonb),

('dm_w11_family_prevention', 'Week 11: Family risk and prevention for your children', 'Type 2 diabetes runs in families — the same habits that help you can lower your children''s risk too.',
'Type 2 diabetes has a real genetic component — a parent or sibling with it roughly doubles a person''s own risk. That''s worth knowing, not fearing: risk isn''t destiny, and the habits that help you manage it are the same ones that lower your children''s future risk.

Practical steps: build the plate-method habit as a family meal, not a separate diet for you alone; keep sugary drinks occasional rather than daily for everyone in the house; and encourage regular movement together.

If you have children or siblings, it''s worth mentioning your diagnosis to their own care providers — earlier awareness means earlier screening if it''s ever needed, which is exactly when it''s easiest to act on.',
'article', 4, 'diabetes', 11, 110, true, false, null),

('dm_w12_long_term', 'Week 12: The long-term outlook', 'You''ve finished the starter course — for some people, sustained lifestyle change can meaningfully reduce medicine needs over time.',
'Twelve weeks in, you''ve covered the essentials. From here, diabetes management becomes a maintained rhythm: logging readings, taking medicine as prescribed, keeping the yearly foot, eye and kidney checks from week 4, and attending scheduled reviews.

For some people, especially when diagnosed early and lifestyle change is sustained, blood sugar control can improve enough that medicine doses are reduced over time — that''s a decision your care team makes based on real readings, never something to attempt alone by skipping doses.

Know your warning signs for urgent care: confusion, fainting, a low that doesn''t respond to fast sugar within 15 minutes, or persistent vomiting while on diabetes medicine. Anything short of that is exactly what your regular check-ins are for — you don''t need a crisis to reach out.',
'article', 4, 'diabetes', 12, 120, true, false,
'[{"question": "Can diabetes medicine doses ever be reduced?", "options": ["Never, once started always continues at the same dose", "Sometimes, for some people, but only as a decision your care team makes from real readings", "Only by stopping medicine yourself to test if it''s still needed"], "answer_index": 1}]'::jsonb),

-- Obesity / weight track, weeks 5-12 -----------------------------------------------
('ob_w5_realistic_pace', 'Week 5: What a realistic pace looks like', 'Losing about 0.5-1kg a week is sustainable; faster than that usually comes back faster too.',
'A realistic, sustainable pace is about 0.5-1kg a week. Faster loss is possible short-term, but it usually comes from water and muscle as much as fat, and it tends to return the same way it left — quickly.

At that pace, hitting the 5-10% target from week 1 typically takes three to six months, depending on your starting weight. That''s not slow — it''s the pace that studies show actually stays off.

If a week shows no change or even a small rise, that''s not failure — water retention, salt, and hormonal timing (for women) all move the scale independently of fat loss. Judge the month, not the week, exactly like week 3 covered.',
'article', 3, 'obesity', 5, 50, true, false,
'[{"question": "What''s a realistic, sustainable pace of weight loss?", "options": ["3-4 kg per week", "About 0.5-1 kg per week", "Weight loss should be as fast as possible"], "answer_index": 1}]'::jsonb),

('ob_w6_emotional_eating', 'Week 6: Emotional eating and its triggers', 'Eating in response to stress, boredom or sadness is common — noticing the trigger is the first real tool.',
'Eating isn''t only about hunger — stress, boredom, sadness, and even celebration all reliably trigger eating that has nothing to do with an empty stomach. This is extremely common and not a character flaw; food genuinely does soothe in the short term, which is exactly why the habit sticks.

The first tool isn''t willpower — it''s noticing. Before eating outside of a normal mealtime, pause and ask what you''re actually feeling. Sometimes naming it (tired, anxious, lonely) is enough to loosen the pull toward food.

If a trigger keeps repeating — a stressful time of day, a specific emotion — that pattern is worth raising with your care team. It''s a genuinely solvable problem, just not one that pure diet advice touches.',
'article', 3, 'obesity', 6, 60, true, false,
'[{"question": "What''s usually the most useful first step with emotional eating?", "options": ["Pure willpower to resist", "Noticing and naming the trigger before eating", "Skipping meals to compensate"], "answer_index": 1}]'::jsonb),

('ob_w7_reading_labels', 'Week 7: Reading food labels in the supermarket', 'Serving size is the number that changes everything else on the label — check it first.',
'The most misread part of any label is serving size — every other number (calories, sugar, salt) is PER that serving, and a "serving" on the pack is often smaller than what you''d actually eat in one sitting. Check it first, before anything else.

After that, glance at added sugar and sodium — items where sugar appears in the first three ingredients, or where salt is listed in grams rather than milligrams per serving, are worth a second thought.

You don''t need to label-check everything — fresh vegetables, fruit, and unprocessed protein don''t carry labels for a reason. It matters most for packaged and processed food, which is exactly where hidden calories and salt tend to hide.',
'article', 3, 'obesity', 7, 70, true, false,
'[{"question": "What''s the first thing to check on a food label?", "options": ["The brand name", "The serving size, since every other number is per that amount", "The colour of the packaging"], "answer_index": 1}]'::jsonb),

('ob_w8_social_eating', 'Week 8: Owambe and social eating', 'The same small habits that help with parties work here too — you don''t have to sit out the occasion.',
'Big social occasions are where a good week can unravel — not from one plate, but from grazing over hours plus sugary drinks adding up unnoticed. You don''t need to avoid these events; a few habits protect you without anyone noticing.

Eat something small before you go so you''re not arriving starving. Take one plate, filled once, protein and vegetables first. Choose water or an unsweetened drink as your default, and treat a sweet drink as a deliberate choice rather than the automatic one.

One party will not undo a month of progress. The habit that actually matters is getting straight back to your normal pattern the next day, rather than treating one indulgent event as a reason to abandon the week.',
'article', 3, 'obesity', 8, 80, true, false, null),

('ob_w9_honest_expectations', 'Week 9: What this programme is, honestly', 'Right now, Tarragon''s weight programme is lifestyle-managed — here''s exactly what that means and what it doesn''t.',
'It''s worth being direct about what this programme currently offers: structured, doctor-reviewed support for the lifestyle changes covered in this course — food, movement, sleep, and consistent follow-up. It does not currently include weight-loss medication or procedures.

That''s not a permanent limitation, just where the programme starts. Lifestyle change alone, sustained with real follow-up (which is the part most people never get on their own), produces meaningful, durable results for most people — the 5-10% target from week 1 measurably improves blood pressure, blood sugar and cholesterol on its own.

If your care team ever assesses that medication would help in your specific case, that conversation will happen directly and honestly, not implied by marketing. For now, this course is the real, evidence-based tool in front of you — worth taking seriously on its own terms.',
'article', 3, 'obesity', 9, 90, true, false,
'[{"question": "What does Tarragon''s weight programme currently include?", "options": ["Weight-loss medication as standard", "Structured, doctor-reviewed lifestyle support with follow-up", "Surgical referral for everyone who enrols"], "answer_index": 1}]'::jsonb),

('ob_w10_non_scale_benefits', 'Week 10: The benefits the scale doesn''t show', 'Better sleep, less joint pain, and improved mood often show up before the scale moves much at all.',
'The scale is slow and noisy — but several benefits of the habits you''re building show up well before a big number changes. Better sleep quality often improves within the first few weeks of more movement and less late sugar. Joint pain, especially knees and lower back, frequently eases even with modest weight loss, because every kilogram off removes several kilograms of pressure through the knees while walking.

Mood and energy often shift too — partly the movement itself, partly sleeping better, partly the sense of doing something concrete for yourself.

If the scale feels discouraging some weeks, it''s worth checking in on these other signals instead — they''re just as real, and often move first.',
'article', 3, 'obesity', 10, 100, true, false, null),

('ob_w11_family_environment', 'Week 11: Building a healthier home environment', 'Small changes to what''s easy and visible at home shape everyone''s habits, not just yours.',
'What''s easy to reach at home shapes what gets eaten — by you and by your children. Keeping fruit visible on the counter and sugary snacks less visible (even in the same kitchen) measurably shifts what people grab without anyone deciding anything consciously.

You don''t need to police what your family eats, or make a separate meal for yourself. The plate-method habits from this course work as family meals — more vegetables, modest starch portions, protein — without singling anyone out or naming it a "diet."

Children whose parents model steady, non-anxious eating habits tend to develop healthier relationships with food themselves. What you''re building here quietly protects the people around you too.',
'article', 3, 'obesity', 11, 110, true, false, null),

('ob_w12_maintenance', 'Week 12: Why most regain happens, and how to avoid it', 'The habits that lose weight and the habits that keep it off are different — knowing that in advance is the real advantage.',
'Most regained weight doesn''t happen because someone "fails" — it happens because the intensive habits of active weight loss (careful tracking, frequent check-ins) naturally relax once a goal is reached, and nothing replaces them. That''s predictable, not a personal weakness, and knowing it in advance is your real advantage.

Maintenance needs a lighter but permanent version of what you''ve been doing: a weekly weigh-in kept for life, not just the active phase; the plate method as your default, not a temporary rule; and movement as a habit, not a project with an end date.

A small regain — a kilo or two — is normal and easy to correct quickly if you catch it early, which is exactly why the weekly weigh-in doesn''t stop. Treat any small rise as information, not a reason to give up what you''ve built.',
'article', 3, 'obesity', 12, 120, true, false,
'[{"question": "Why does weight often come back after reaching a goal?", "options": ["It''s biologically inevitable for everyone", "The intensive habits of active loss relax and nothing replaces them", "The body ''resets'' automatically after 3 months"], "answer_index": 1}]'::jsonb),

-- General / prevention track, weeks 4-12 -----------------------------------------------
('gen_w4_adult_vaccines', 'Week 4: Vaccines aren''t just for children', 'Tetanus boosters, flu shots and others matter well into adulthood — here''s what most adults are missing.',
'Vaccination doesn''t stop after childhood. Adults need a tetanus booster roughly every ten years, and depending on age and health, may benefit from flu, hepatitis B, and — for some adults — shingles vaccination.

Missing a childhood dose doesn''t mean it''s too late; catch-up is usually possible and worth checking rather than assuming. Tarragon''s vaccination record tracks exactly what''s due for you specifically, based on age, sex and what''s already logged — not a generic list.

If you''re not sure what you''ve had, that''s completely normal — most adults aren''t. Check your vaccination record on your dashboard this week; it will show you precisely what''s outstanding.',
'article', 3, null, 4, 40, true, false,
'[{"question": "Roughly how often do adults need a tetanus booster?", "options": ["Every year", "About every ten years", "Only once, in childhood"], "answer_index": 1}]'::jsonb),

('gen_w5_cancer_screening', 'Week 5: Cancer screening — what and when', 'Cervical, breast, prostate and colorectal screening all catch problems at their most treatable stage, before symptoms appear.',
'Cancer screening''s entire value is catching something before it causes symptoms — by the time a symptom appears, the most treatable window has often already narrowed. That''s why these checks are recommended on a schedule, not "when something feels wrong."

Cervical screening is recommended from 25 for women. Breast screening typically starts around 40. Prostate (PSA) screening is a conversation from 45 for men, since it needs weighing individually. Colorectal screening usually starts around 45 for everyone.

Your Tarragon calendar already applies these ages (and your sex) automatically — check your dashboard for what''s currently due rather than trying to remember the ages yourself.',
'article', 3, null, 5, 50, true, false,
'[{"question": "What is the main value of cancer screening?", "options": ["Treating cancer after symptoms appear", "Catching problems before symptoms appear, when they''re most treatable", "It only matters if there''s a family history"], "answer_index": 1}]'::jsonb),

('gen_w6_alcohol_how_much', 'Week 6: Alcohol — how much is actually a lot?', 'Most people underestimate their own drinking; here''s a plain way to check where you actually sit.',
'There''s no drinking level that''s risk-free, but risk rises clearly once intake goes from occasional to regular. A rough, honest marker: drinking most days of the week, or regularly having more than 2-3 drinks in one sitting, moves into territory worth discussing with your care team.

People consistently underestimate their own intake — a large pour, a strong local brew, or "just at weekends but every weekend" all add up faster than they feel like they do.

This isn''t about guilt. If your own honest count surprised you while reading this, that''s useful information, not a verdict — mention it at your next check-in, and your care team can help you think through it without judgment.',
'article', 3, null, 6, 60, true, false, null),

('gen_w7_mental_health_basics', 'Week 7: Mental health is part of your health record', 'Persistent low mood, anxiety or sleep trouble are medical matters your care team can actually help with, not something to push through.',
'Physical and mental health aren''t separate systems — persistent stress and low mood raise blood pressure and blood sugar, disturb sleep, and make every other habit on this platform harder to sustain. That''s why it belongs on your health record, not off to the side.

If low mood, anxiety, or sleep trouble has lasted more than two weeks and is affecting your daily life, that''s worth raising directly at your next check-in — the same way you''d mention a physical symptom.

There''s no need to have a diagnosis or the right words ready. "I haven''t been myself lately" is a complete and useful thing to say to your care team.',
'article', 3, null, 7, 70, true, false,
'[{"question": "If low mood or anxiety has lasted more than two weeks, what should you do?", "options": ["Wait for it to pass on its own", "Raise it with your care team, the same as a physical symptom", "Only mention it if you have a formal diagnosis"], "answer_index": 1}]'::jsonb),

('gen_w8_family_history', 'Week 8: Why your family''s health history matters', 'A parent''s or sibling''s condition changes what you should be screened for, and when — a five-minute conversation is worth having.',
'A close relative''s health history — a parent''s diabetes, a sibling''s early heart disease, a family pattern of a particular cancer — genuinely changes your own risk and can shift when certain screenings should start for you.

You don''t need medical records; a rough picture is enough: which close relatives have which conditions, and roughly how old they were when diagnosed. Even "my mother has high blood pressure, not sure when it started" is useful.

Add what you know to your profile, and mention it at your next review. It''s one of the few things about your risk that a single conversation can genuinely improve.',
'article', 3, null, 8, 80, true, false, null),

('gen_w9_emergency_ready', 'Week 9: The basics that matter in an emergency', 'Knowing your emergency contact, allergies and current medicines are on file means faster, safer care if something urgent happens.',
'In a real emergency, the questions that matter most are simple: what medicines are you on, any allergies, and who should be called. Having these already on your Tarragon record means anyone treating you — even someone who''s never met you — can find them fast.

Check three things this week: that your emergency contact is set (see your Family page if you haven''t named a next of kin), that any known allergies are logged, and that your current medicines list is accurate, including anything not prescribed through Tarragon.

This takes a few minutes and matters far more than it feels like it does, right up until the day it matters completely.',
'article', 3, null, 9, 90, true, false,
'[{"question": "What three things does this lesson ask you to check on your record?", "options": ["Diet, exercise, and sleep logs", "Emergency contact, allergies, and current medicines", "Insurance details and payment method"], "answer_index": 1}]'::jsonb),

('gen_w10_health_wallet', 'Week 10: Paying for care, small-small', 'Your Health Wallet lets you or family fund care in small amounts over time instead of one large payment at once.',
'Healthcare costs often arrive as one lump sum right when you need the test or medicine most — the Health Wallet is built to soften that. Top it up in whatever amounts suit you, whenever you have it, and the balance sits ready for lab tests, pharmacy orders, or referrals when they come up.

A family member — local or abroad — can also fund your wallet directly, which is often easier than sending cash for a specific bill after the fact. And a savings goal, like this year''s Annual Health Check, quietly completes itself once the balance reaches it.

If you haven''t looked at it yet, it''s worth a glance — some people find that paying small-small, over weeks, is far easier to manage than one large bill.',
'article', 3, null, 10, 100, true, false, null),

('gen_w11_second_opinions', 'Week 11: Asking questions is part of good care', 'A good care team welcomes questions and second opinions — treat both as normal, not as distrust.',
'Asking your care team to explain something again, or asking why a particular medicine or test is recommended, is a completely normal part of good care — not a challenge to their judgment. If an explanation doesn''t make sense, ask again in a different way; that''s useful feedback for them too.

Wanting a second opinion on something significant — a new diagnosis, a major medication change, a procedure — is also entirely reasonable, and shouldn''t need justifying. Your Tarragon record makes this easier: your history travels with the request instead of starting from nothing.

The goal of this whole platform is a care team you actually trust because you understand what they''re doing and why — not one you simply defer to.',
'article', 3, null, 11, 110, true, false, null),

('gen_w12_consistency', 'Week 12: Why consistency beats intensity', 'You''ve finished the starter course — the habits that stick are boring, repeated ones, not the biggest single effort.',
'Most health plans don''t fail in the first week — they fail around week three or four, when the initial motivation fades and life gets in the way. If that''s happened to you before, it doesn''t mean something is wrong with you; it means the plan relied on motivation instead of habit.

What actually works long-term is unglamorous: the same small actions, repeated, even on days you don''t feel like it. A short walk on a tired day beats a long one you skip because you couldn''t manage the "proper" version. A logged reading you almost forgot beats a perfect week you gave up on entirely.

You''ve now been through the foundations across every area this platform tracks. From here, the job is simply continuing — logging, showing up to reviews, and letting your care team do the watching, so you don''t have to carry it alone.',
'article', 3, null, 12, 120, true, false,
'[{"question": "According to this lesson, why do most health plans actually fail?", "options": ["People are lazy", "They rely on motivation instead of small, repeated habits", "They''re too easy to follow"], "answer_index": 1}]'::jsonb)

on conflict (code) do nothing;
