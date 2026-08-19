-- Tarragon Health — Health Education: remove em dashes from the
-- pre-existing curriculum content (2026-07-17/23), same standing rule as
-- the previous migration. This content predates this session but is part
-- of the same patient-facing library being made advertisement-grade.

update public.health_education_content set
  title = $body$Week 1: What is actually happening in diabetes$body$,
  summary = $body$Insulin, sugar, and why "too much sugar in the blood" is only half the story.$body$,
  body = $body$Every meal becomes glucose: the fuel your cells run on. Insulin is the key that lets that fuel out of the bloodstream and into the cells. In type 2 diabetes the key still exists, but the locks have grown stiff: sugar stays stuck in the blood while your cells run short.

High blood sugar does its damage quietly, over years, to small blood vessels: eyes, kidneys, nerves, heart.

The good news is the same mechanism in reverse: food choices, movement, weight and the right medicines all loosen those locks. Managed early and consistently, diabetes is compatible with a long, full life. That is what this programme is for.$body$
where code = 'dm_w1_what_is_happening';
update public.health_education_content set
  title = $body$Week 10: Your medicines, explained$body$,
  summary = $body$Metformin, sulfonylureas and insulin work differently: knowing the difference helps you understand your own plan.$body$,
  body = $body$Metformin is usually the first medicine prescribed: it reduces how much sugar your liver releases and helps your body respond better to its own insulin. It doesn't typically cause low sugar on its own.

Sulfonylureas (like glimepiride) push your pancreas to release more insulin: effective, but they can cause lows, especially if a meal is delayed or skipped.

Insulin, given by injection, is sometimes needed when the pancreas can no longer produce enough on its own: this is common as diabetes progresses and is not a sign of failure or worsening behaviour. It's simply the next tool for the same job: keeping sugar in range. Whatever combination you're on, take it as prescribed, and ask your care team to walk through exactly what yours does if it's ever unclear.$body$
where code = 'dm_w10_medicines_explained';
update public.health_education_content set
  title = $body$Week 11: Family risk and prevention for your children$body$,
  summary = $body$Type 2 diabetes runs in families: the same habits that help you can lower your children's risk too.$body$,
  body = $body$Type 2 diabetes has a real genetic component: a parent or sibling with it roughly doubles a person's own risk. That's worth knowing, not fearing: risk isn't destiny, and the habits that help you manage it are the same ones that lower your children's future risk.

Practical steps: build the plate-method habit as a family meal, not a separate diet for you alone; keep sugary drinks occasional rather than daily for everyone in the house; and encourage regular movement together.

If you have children or siblings, it's worth mentioning your diagnosis to their own care providers: earlier awareness means earlier screening if it's ever needed, which is exactly when it's easiest to act on.$body$
where code = 'dm_w11_family_prevention';
update public.health_education_content set
  title = $body$Week 12: The long-term outlook$body$,
  summary = $body$You've finished the starter course: for some people, sustained lifestyle change can meaningfully reduce medicine needs over time.$body$,
  body = $body$Twelve weeks in, you've covered the essentials. From here, diabetes management becomes a maintained rhythm: logging readings, taking medicine as prescribed, keeping the yearly foot, eye and kidney checks from week 4, and attending scheduled reviews.

For some people, especially when diagnosed early and lifestyle change is sustained, blood sugar control can improve enough that medicine doses are reduced over time: that's a decision your care team makes based on real readings, never something to attempt alone by skipping doses.

Know your warning signs for urgent care: confusion, fainting, a low that doesn't respond to fast sugar within 15 minutes, or persistent vomiting while on diabetes medicine. Anything short of that is exactly what your regular check-ins are for: you don't need a crisis to reach out.$body$
where code = 'dm_w12_long_term';
update public.health_education_content set
  title = $body$Week 2: The plate method, eating well without weighing anything$body$,
  summary = $body$Half vegetables, a quarter protein, a quarter starch: the simplest eating pattern that actually moves your sugar.$body$,
  body = $body$You do not need to weigh food or count every carbohydrate. Picture your plate in three parts: half non-starchy vegetables (greens, okra without heavy oil, garden egg, cabbage), a quarter protein (fish, chicken, beans, eggs), and a quarter starch (rice, yam, swallow, bread).

The starch quarter is where blood sugar is won or lost: it is usually the part that fills half the plate. Shrinking it, not banning it, is the move.

Swaps that help: unripe plantain over ripe, beans in place of some rice, wholegrain where you can. Eat slowly; sugar rises more gently from the same food eaten over twenty minutes than bolted in five.$body$
where code = 'dm_w2_plate_method';
update public.health_education_content set
  title = $body$Week 3: Low sugar and sick days, the two situations to prepare for$body$,
  summary = $body$How to recognise and treat a low, and why illness needs a plan, not a pause.$body$,
  body = $body$If you take medicines that can drop your sugar, learn the feel of a low: shakiness, sweating, sudden hunger, a racing heart, confusion. Treat it fast (about three cubes of sugar, half a bottle of soft drink (not diet), or glucose tablets) then recheck in 15 minutes. Never sleep off a suspected low.

Sick days push sugar UP, even when you barely eat. Vomiting or purging while on diabetes medicines deserves a message to your care team the same day: some tablets need pausing when you cannot keep fluids down.

Keep something sugary within reach at home, at work and in your bag. Preparedness is not pessimism; it is what makes the condition boring, and boring is the goal.$body$
where code = 'dm_w3_lows_and_sick_days';
update public.health_education_content set
  title = $body$Week 4: Feet, eyes and the yearly checks that protect them$body$,
  summary = $body$Diabetes care is more than glucose: the small checks that catch problems while they are still small.$body$,
  body = $body$Because high sugar quietly affects small blood vessels and nerves, diabetes care includes a short list of protective habits beyond glucose numbers.

Feet: look at them daily, between the toes too. Numbness, tingling, or a cut that is slow to heal deserves a message to your care team, not a wait. Well-fitting shoes beat fashionable ones.

Yearly: an eye check (retinal screening (damage is treatable when caught early and silent until late), a kidney check (a simple urine and blood test), and blood pressure and cholesterol reviews) sugar, pressure and lipids multiply each other's effects, so your care team manages them together.$body$
where code = 'dm_w4_beyond_sugar';
update public.health_education_content set
  title = $body$Week 5: What HbA1c actually measures$body$,
  summary = $body$One blood test that shows your average sugar over three months, not just today's number.$body$,
  body = $body$A fasting or random glucose test is a snapshot of one moment. HbA1c is different: it measures how much sugar has been attaching to your red blood cells over roughly the last three months, giving your care team the real trend rather than one good or bad day.

For most people with diabetes, the target is below 7%, though your care team may set a different target based on your age, other conditions, and how long you've had diabetes: there's no single number that fits everyone.

It's usually checked every three to six months. Between tests, your own home readings still matter: they show the day-to-day pattern that HbA1c can't, like which meals or times of day run high.$body$
where code = 'dm_w5_hba1c';
update public.health_education_content set
  title = $body$Week 6: Exercise and blood sugar, timing matters$body$,
  summary = $body$Movement lowers blood sugar, but timing around meals and medicine changes what you should watch for.$body$,
  body = $body$Exercise helps your muscles use sugar without needing as much insulin, which is why regular movement genuinely improves control over time. A walk after a meal is particularly effective: even 10-15 minutes measurably blunts the sugar rise from what you just ate.

If you take insulin or a sulfonylurea, exercise can push sugar too low, especially exercise that's longer or more intense than usual. Carry a fast source of sugar, and if you're trying a new activity level, check your sugar before and after until you know how your body responds.

Any movement counts: walking, house chores, stairs. The goal is consistency across most days, not intensity on a few.$body$
where code = 'dm_w6_exercise_timing';
update public.health_education_content set
  title = $body$Week 7: Diabetes and your heart, why they're managed together$body$,
  summary = $body$High sugar, high blood pressure and high cholesterol damage blood vessels together, which is why your care team watches all three.$body$,
  body = $body$Diabetes roughly doubles the risk of heart disease and stroke, mainly because high blood sugar damages blood vessel walls over time: the same vessels that blood pressure and cholesterol also affect. That's why a diabetes review usually checks all three, not glucose alone.

This is also why blood pressure and cholesterol targets are often stricter for someone with diabetes than for someone without it: the combined effect on your arteries is bigger than any one factor alone.

The upside is that the same habits protect all three at once: movement, the plate method from week 2, and taking every prescribed medicine (not just the diabetes ones) all pull in the same direction.$body$
where code = 'dm_w7_heart_link';
update public.health_education_content set
  title = $body$Week 8: Eating out and festive occasions$body$,
  summary = $body$Owambe and parties don't have to derail your control: a few habits protect you without standing out.$body$,
  body = $body$Big occasions and buffet-style eating are where control slips most easily, not because of one meal, but because portion sizes and hidden sugar (soft drinks, zobo with added sugar, dessert) stack up quietly.

A few things help without drawing attention: eat a small protein or fibre snack before you go, so you're not arriving hungry; fill your plate once, starting with protein and vegetables; and choose water or unsweetened drinks as your default, saving a sweet one for a deliberate treat rather than a habit.

One indulgent meal will not undo weeks of good control: the pattern matters far more than any single event. Enjoy the occasion; just don't skip your medicine because the routine felt disrupted.$body$
where code = 'dm_w8_eating_out';
update public.health_education_content set
  title = $body$Week 9: Diabetes burnout is real$body$,
  summary = $body$Feeling exhausted by constant monitoring and decisions is common and has a name: it's not a personal failing.$body$,
  body = $body$Diabetes asks for more daily decisions than almost any other condition: what to eat, when to check, whether a symptom means something. Feeling exhausted, resentful, or like you want to ignore it all for a while is common enough to have a name: diabetes burnout. It isn't weakness, and it isn't rare.

Burnout often shows up as skipping checks you used to do reliably, or quietly stopping medicine without telling anyone. If that's happening, it's a signal to talk to your care team, not a reason to hide it: the response is support, not a lecture.

Small resets help: pick one thing to track well this week instead of everything at once, and say out loud (to your care team or someone close) that you're tired of it. Naming it usually loosens its grip.$body$
where code = 'dm_w9_burnout';
update public.health_education_content set
  title = $body$Understanding your blood sugar$body$,
  summary = $body$What HbA1c and daily readings tell you, in plain language.$body$,
  body = $body$Blood sugar rises and falls through the day around what you eat and how active you are. A single high reading is not a crisis: the trend is what your care team watches.

HbA1c is a longer-term average over about three months, which is why your doctor checks it periodically rather than daily. Steady meals, movement after eating, and taking medicine as prescribed keep the trend where you want it.$body$
where code = 'dm-understanding-sugar';
update public.health_education_content set
  title = $body$Week 1: Know your four numbers$body$,
  summary = $body$Blood pressure, blood sugar, cholesterol, waist: the baseline every adult should own.$body$,
  body = $body$Four numbers predict more about your next twenty years than almost anything else: your blood pressure, your blood sugar (HbA1c or fasting glucose), your cholesterol panel, and your waist measurement.

None of them can be felt. All of them can be measured cheaply, and all of them respond to action when caught drifting.

If you do not know yours, that is this week's task: log a blood pressure reading, and book the blood tests through the app if you are due. A baseline turns every future reading into information.$body$
where code = 'gen_w1_your_numbers_baseline';
update public.health_education_content set
  title = $body$Week 11: Asking questions is part of good care$body$,
  summary = $body$A good care team welcomes questions and second opinions: treat both as normal, not as distrust.$body$,
  body = $body$Asking your care team to explain something again, or asking why a particular medicine or test is recommended, is a completely normal part of good care, not a challenge to their judgment. If an explanation doesn't make sense, ask again in a different way; that's useful feedback for them too.

Wanting a second opinion on something significant (a new diagnosis, a major medication change, a procedure) is also entirely reasonable, and shouldn't need justifying. Your Tarragon record makes this easier: your history travels with the request instead of starting from nothing.

The goal of this whole platform is a care team you actually trust because you understand what they're doing and why, not one you simply defer to.$body$
where code = 'gen_w11_second_opinions';
update public.health_education_content set
  title = $body$Week 12: Why consistency beats intensity$body$,
  summary = $body$You've finished the starter course: the habits that stick are boring, repeated ones, not the biggest single effort.$body$,
  body = $body$Most health plans don't fail in the first week: they fail around week three or four, when the initial motivation fades and life gets in the way. If that's happened to you before, it doesn't mean something is wrong with you; it means the plan relied on motivation instead of habit.

What actually works long-term is unglamorous: the same small actions, repeated, even on days you don't feel like it. A short walk on a tired day beats a long one you skip because you couldn't manage the "proper" version. A logged reading you almost forgot beats a perfect week you gave up on entirely.

You've now been through the foundations across every area this platform tracks. From here, the job is simply continuing: logging, showing up to reviews, and letting your care team do the watching, so you don't have to carry it alone.$body$
where code = 'gen_w12_consistency';
update public.health_education_content set
  title = $body$Week 2: Sleep is not a luxury$body$,
  summary = $body$Short, broken sleep pushes blood pressure, sugar and appetite the wrong way: the fixes are unglamorous and effective.$body$,
  body = $body$Sleep is when blood pressure dips, sugar regulation resets and appetite hormones rebalance. Chronically short or broken sleep pushes all three the wrong way: it is a health input as real as diet.

The fixes are boring and effective: a consistent sleep and wake time (weekends included), screens out of the last 30 minutes, caffeine finished by early afternoon, and the room as dark and cool as you can manage.

One flag worth raising with your care team: loud snoring with gasping or choking. That pattern (sleep apnoea) quietly drives resistant blood pressure and daytime exhaustion, and it is very treatable.$body$
where code = 'gen_w2_sleep_is_treatment';
update public.health_education_content set
  title = $body$Week 3: How to read a lab result without panicking$body$,
  summary = $body$Flags and asterisks are conversation starters, not verdicts: what "abnormal" actually means.$body$,
  body = $body$A lab report full of flags can look alarming. Here is the honest context: reference ranges describe where 95% of healthy people fall, which means a perfectly healthy person will sit slightly outside some range on a long enough panel.

A single mildly-out-of-range value is a conversation starter, not a diagnosis. What your care team weighs is the pattern: how far out, in what combination, and how it compares with YOUR previous results, which is why results here live on your record, not in a drawer.

The rule of thumb: never ignore a flagged result, and never panic over one either. Ask. If something on your record needs action, your care team flags it: that is the whole point of monitored care.$body$
where code = 'gen_w3_reading_your_results';
update public.health_education_content set
  title = $body$Week 4: Vaccines aren't just for children$body$,
  summary = $body$Tetanus boosters, flu shots and others matter well into adulthood: here's what most adults are missing.$body$,
  body = $body$Vaccination doesn't stop after childhood. Adults need a tetanus booster roughly every ten years, and depending on age and health, may benefit from flu, hepatitis B, and (for some adults) shingles vaccination.

Missing a childhood dose doesn't mean it's too late; catch-up is usually possible and worth checking rather than assuming. Tarragon's vaccination record tracks exactly what's due for you specifically, based on age, sex and what's already logged, not a generic list.

If you're not sure what you've had, that's completely normal: most adults aren't. Check your vaccination record on your dashboard this week; it will show you precisely what's outstanding.$body$
where code = 'gen_w4_adult_vaccines';
update public.health_education_content set
  title = $body$Week 5: Cancer screening, what and when$body$,
  summary = $body$Cervical, breast, prostate and colorectal screening all catch problems at their most treatable stage, before symptoms appear.$body$,
  body = $body$Cancer screening's entire value is catching something before it causes symptoms: by the time a symptom appears, the most treatable window has often already narrowed. That's why these checks are recommended on a schedule, not "when something feels wrong."

Cervical screening is recommended from 25 for women. Breast screening typically starts around 40. Prostate (PSA) screening is a conversation from 45 for men, since it needs weighing individually. Colorectal screening usually starts around 45 for everyone.

Your Tarragon calendar already applies these ages (and your sex) automatically: check your dashboard for what's currently due rather than trying to remember the ages yourself.$body$
where code = 'gen_w5_cancer_screening';
update public.health_education_content set
  title = $body$Week 6: Alcohol, how much is actually a lot?$body$,
  summary = $body$Most people underestimate their own drinking; here's a plain way to check where you actually sit.$body$,
  body = $body$There's no drinking level that's risk-free, but risk rises clearly once intake goes from occasional to regular. A rough, honest marker: drinking most days of the week, or regularly having more than 2-3 drinks in one sitting, moves into territory worth discussing with your care team.

People consistently underestimate their own intake: a large pour, a strong local brew, or "just at weekends but every weekend" all add up faster than they feel like they do.

This isn't about guilt. If your own honest count surprised you while reading this, that's useful information, not a verdict: mention it at your next check-in, and your care team can help you think through it without judgment.$body$
where code = 'gen_w6_alcohol_how_much';
update public.health_education_content set
  title = $body$Week 7: Mental health is part of your health record$body$,
  summary = $body$Persistent low mood, anxiety or sleep trouble are medical matters your care team can actually help with, not something to push through.$body$,
  body = $body$Physical and mental health aren't separate systems: persistent stress and low mood raise blood pressure and blood sugar, disturb sleep, and make every other habit on this platform harder to sustain. That's why it belongs on your health record, not off to the side.

If low mood, anxiety, or sleep trouble has lasted more than two weeks and is affecting your daily life, that's worth raising directly at your next check-in: the same way you'd mention a physical symptom.

There's no need to have a diagnosis or the right words ready. "I haven't been myself lately" is a complete and useful thing to say to your care team.$body$
where code = 'gen_w7_mental_health_basics';
update public.health_education_content set
  title = $body$Week 8: Why your family's health history matters$body$,
  summary = $body$A parent's or sibling's condition changes what you should be screened for, and when: a five-minute conversation is worth having.$body$,
  body = $body$A close relative's health history (a parent's diabetes, a sibling's early heart disease, a family pattern of a particular cancer) genuinely changes your own risk and can shift when certain screenings should start for you.

You don't need medical records; a rough picture is enough: which close relatives have which conditions, and roughly how old they were when diagnosed. Even "my mother has high blood pressure, not sure when it started" is useful.

Add what you know to your profile, and mention it at your next review. It's one of the few things about your risk that a single conversation can genuinely improve.$body$
where code = 'gen_w8_family_history';
update public.health_education_content set
  title = $body$Week 9: The basics that matter in an emergency$body$,
  summary = $body$Knowing your emergency contact, allergies and current medicines are on file means faster, safer care if something urgent happens.$body$,
  body = $body$In a real emergency, the questions that matter most are simple: what medicines are you on, any allergies, and who should be called. Having these already on your Tarragon record means anyone treating you (even someone who's never met you) can find them fast.

Check three things this week: that your emergency contact is set (see your Family page if you haven't named a next of kin), that any known allergies are logged, and that your current medicines list is accurate, including anything not prescribed through Tarragon.

This takes a few minutes and matters far more than it feels like it does, right up until the day it matters completely.$body$
where code = 'gen_w9_emergency_ready';
update public.health_education_content set
  title = $body$Week 1: What your blood pressure numbers mean$body$,
  summary = $body$The two numbers, what counts as high, and why the pattern matters more than any single reading.$body$,
  body = $body$Your reading has two numbers, like 130/85. The top number is the pressure when your heart squeezes; the bottom is the pressure while it rests between beats.

For most adults, under 130/85 at rest is healthy territory. Readings that keep coming back at 140/90 or higher are what your care team treats as high.

One high reading is not a verdict: stress, caffeine, even rushing to the machine can push it up. What matters is the pattern across days, taken while seated and rested. That is exactly why logging your readings here matters: your care team reads the trend, not one number.$body$
where code = 'htn_w1_what_your_numbers_mean';
update public.health_education_content set
  title = $body$Week 10: Snoring and resistant blood pressure$body$,
  summary = $body$Loud snoring with pauses in breathing is a treatable condition that quietly keeps blood pressure high overnight and into the day.$body$,
  body = $body$If a partner has ever mentioned loud snoring, gasping, or pauses in your breathing at night, that's worth raising directly: it describes sleep apnoea, and it's one of the most common reasons blood pressure stays hard to control despite taking medicine correctly.

Apnoea repeatedly drops oxygen and jolts the body awake without you knowing, which keeps stress hormones elevated through the night. That's why it shows up as daytime tiredness and blood pressure that won't come down, not just as poor sleep.

It's very treatable once identified: often with a simple device worn at night. If any of this sounds familiar, mention it at your next review rather than waiting to be asked.$body$
where code = 'htn_w10_sleep_apnoea';
update public.health_education_content set
  title = $body$Week 11: Why you might be on two or three tablets$body$,
  summary = $body$Combining lower doses of different medicines usually controls pressure better, with fewer side effects, than one medicine pushed to its maximum.$body$,
  body = $body$If your care team has added a second or third blood pressure medicine, that's not a sign your case is severe or that the first one failed: it's often the plan from the start. Different medicines lower pressure through different routes in the body, so combining them at modest doses usually works better, and with fewer side effects, than maxing out a single drug.

Each one is doing a distinct job: some relax blood vessels, some reduce fluid, some slow the heart's workload. Skipping one because "the others are enough" undoes that balance, even if your next reading looks fine.

If cost or pill burden is the real issue, say so: there are often combination tablets that fold two medicines into one, and your care team would rather solve that than have a dose quietly skipped.$body$
where code = 'htn_w11_multiple_medicines';
update public.health_education_content set
  title = $body$Week 12: What 'controlled' looks like from here$body$,
  summary = $body$You've finished the starter course: control is a maintained pattern, not a one-time achievement, and here's what to watch for.$body$,
  body = $body$Twelve weeks in, the goal has shifted from learning to maintaining. 'Controlled' means your readings sit consistently under 130/85 across weeks, not a single good number: keep logging, because the pattern is still what your care team reads.

From here, the rhythm is simple: take your medicine daily, log readings regularly, keep the habits from this course going, and attend your scheduled reviews. Nothing dramatic is expected of you week to week anymore: consistency is the whole job now.

One thing to know for real emergencies: a reading above roughly 180/120 with a severe headache, chest pain, vision change, or confusion needs urgent same-day care, not a routine message. Anything less urgent, even if it worries you, is exactly what your regular check-ins are for.$body$
where code = 'htn_w12_long_term';
update public.health_education_content set
  title = $body$Week 2: The salt you can't see$body$,
  summary = $body$Most excess salt never comes from your salt spoon, where it hides and what to change first.$body$,
  body = $body$Cutting salt is one of the most effective things you can personally do for blood pressure, but the salt spoon is the smallest part of the problem.

Most of it hides in seasoning cubes, instant noodles, tinned and processed foods, salted fish, and ready-made spice mixes. One seasoning cube can carry more sodium than you would ever sprinkle on a plate.

Start with one swap this week: halve the cubes in your cooking and taste before adding more. Cook from fresh ingredients where you can. Your tongue recalibrates in about two weeks: food stops tasting bland and your readings quietly thank you.$body$
where code = 'htn_w2_salt_you_cannot_see';
update public.health_education_content set
  title = $body$Week 3: Why you take medicine even when you feel fine$body$,
  summary = $body$High blood pressure has no feeling: what the tablets are actually doing, and why stopping quietly is the trap.$body$,
  body = $body$High blood pressure almost never announces itself. You can feel completely fine at 170/100, which is exactly why people stop their tablets and feel no different for months, while the pressure quietly strains the heart, kidneys and brain.

Your medicine is not treating how you feel today. It is lowering the wear on your blood vessels for the next twenty years.

If side effects bother you (swollen ankles, a dry cough, dizziness) do not just stop. Tell your care team here; there is almost always an alternative that suits you better. Stopping silently is the one move that undoes everything.$body$
where code = 'htn_w3_medicines_that_work_quietly';
update public.health_education_content set
  title = $body$Week 4: Movement that actually lowers pressure$body$,
  summary = $body$Thirty minutes of brisk walking most days measurably lowers blood pressure: no gym required.$body$,
  body = $body$Regular movement lowers blood pressure on its own, even before any weight changes. The evidence-backed dose is unglamorous: about 30 minutes of brisk walking, most days.

Brisk means you can talk but not sing. A route near home, the same time each day, counts far more than an ambitious plan you do twice.

Stack it onto something you already do: walk the long way from the bus stop, take calls on your feet. Log your readings as you build the habit; watching your own average drift down is the best motivation there is.$body$
where code = 'htn_w4_movement_that_counts';
update public.health_education_content set
  title = $body$Week 5: Getting an accurate reading at home$body$,
  summary = $body$Cuff size, sitting position, and timing change your number more than people realise.$body$,
  body = $body$A blood pressure reading can shift by 10-15 points just from how it's taken. Sit with your back supported, feet flat on the floor, arm resting at heart height, not dangling, not raised.

Rest quietly for five minutes first. Talking, a full bladder, or rushing straight from a walk all push the number up temporarily. Use the same arm each time where you can, and take two readings a minute apart: the second is usually the more accurate one.

A cuff that's too small reads falsely high; too large reads falsely low. If your cuff came with the device, it was sized for an average adult arm: tell your care team if yours is noticeably larger or smaller, so the fit can be checked.$body$
where code = 'htn_w5_accurate_home_reading';
update public.health_education_content set
  title = $body$Week 6: Alcohol and your blood pressure$body$,
  summary = $body$Drinking regularly raises blood pressure in a way that's easy to miss because nothing feels different day to day.$body$,
  body = $body$Alcohol raises blood pressure directly, and the effect adds up with regular drinking, not just heavy sessions. It can also interact with some blood pressure medicines, and it adds calories that work against weight goals.

If you drink, keeping it modest and infrequent matters more than any specific brand or type. If you don't drink, that's already one thing working in your favour: no need to start.

If cutting back feels hard, that's worth mentioning to your care team directly, not something to manage alone. It's a common, private conversation, not a judgment.$body$
where code = 'htn_w6_alcohol';
update public.health_education_content set
  title = $body$Week 7: Stress and your numbers$body$,
  summary = $body$Stress hormones raise blood pressure in the moment: the goal isn't a stress-free life, it's a way to come back down.$body$,
  body = $body$Stress triggers hormones that tighten blood vessels and speed the heart: useful for a real emergency, unhelpful when it's traffic, deadlines, or money worry running on a loop. A single stressful day won't undo months of good control, but constant, unmanaged stress keeps pressure elevated more of the time.

You don't need to eliminate stress: that's not realistic for most lives. What helps is a reliable way back down: slow breathing for a few minutes, a short walk, prayer or quiet time, talking to someone you trust.

If stress is affecting your sleep, appetite, or mood most days, say so at your next check-in. That's a health matter your care team can actually help with, not something to push through alone.$body$
where code = 'htn_w7_stress';
update public.health_education_content set
  title = $body$Week 8: Tobacco and blood pressure$body$,
  summary = $body$Every cigarette causes a short, sharp spike, and smoking multiplies your cardiovascular risk on top of high blood pressure.$body$,
  body = $body$Each cigarette causes an immediate spike in blood pressure and heart rate that lasts about 20-30 minutes: smoke enough through the day and your pressure rarely settles. Smokeless tobacco (chewed or snuffed) raises it too; it isn't a safer substitute.

The bigger issue is combined risk: tobacco damages blood vessels directly, so smoking with high blood pressure multiplies your risk of a heart attack or stroke rather than simply adding to it.

Quitting is hard, and most people need more than one attempt: that's normal, not failure. Tell your care team if you use tobacco in any form; there are real supports, and it's one of the highest-impact changes available to you.$body$
where code = 'htn_w8_tobacco';
update public.health_education_content set
  title = $body$Week 9: Potassium, the other side of salt$body$,
  summary = $body$Potassium-rich foods help your body handle sodium better; most people eat far less of them than they need.$body$,
  body = $body$Salt gets most of the attention, but potassium works against it: it helps your kidneys clear excess sodium and relaxes blood vessel walls. Most diets, Nigerian ones included, fall short of what's protective.

Good sources: bananas, oranges, beans, groundnuts, avocado, spinach, and unripe plantain. Aim to add one potassium-rich food to a meal you already eat most days, rather than overhauling everything at once.

One caution: if you're on certain blood pressure medicines (ACE inhibitors, ARBs, or a potassium-sparing diuretic), too much potassium can be a problem, so check with your care team before using salt substitutes, which are often potassium chloride in disguise.$body$
where code = 'htn_w9_potassium';
update public.health_education_content set
  title = $body$Understanding your blood pressure$body$,
  summary = $body$What the two numbers mean, and the everyday habits that help most.$body$,
  body = $body$Blood pressure is written as two numbers: the top (systolic) is the push when your heart beats, the bottom (diastolic) is the rest between beats. For most adults, a healthy target is around 120/80, but your own target is set with your doctor.

Small, steady habits move it most: less added salt, regular movement, taking your medicine at the same time each day, and enough sleep. You do not need to change everything at once: one habit at a time is enough.$body$
where code = 'htn-understanding-bp';
update public.health_education_content set
  title = $body$Week 1: Why weight is a medical matter, not a willpower verdict$body$,
  summary = $body$Biology fights weight loss, which is exactly why structured support beats going it alone.$body$,
  body = $body$If losing weight were simply a decision, nobody would carry extra weight. Your body actively defends its current weight: hunger hormones rise when you cut back, and metabolism quietly slows. That is biology, not weakness.

This is why the programme treats weight like any other medical condition: with a plan, follow-up, and adjustments, not blame.

The target that changes health is smaller than most people think: losing 5–10% of body weight, and keeping it off, measurably improves blood pressure, blood sugar and cholesterol. For a 100 kg person that is 5–10 kg: a realistic, defensible goal.$body$
where code = 'ob_w1_why_weight_is_medical';
update public.health_education_content set
  title = $body$Week 10: The benefits the scale doesn't show$body$,
  summary = $body$Better sleep, less joint pain, and improved mood often show up before the scale moves much at all.$body$,
  body = $body$The scale is slow and noisy, but several benefits of the habits you're building show up well before a big number changes. Better sleep quality often improves within the first few weeks of more movement and less late sugar. Joint pain, especially knees and lower back, frequently eases even with modest weight loss, because every kilogram off removes several kilograms of pressure through the knees while walking.

Mood and energy often shift too: partly the movement itself, partly sleeping better, partly the sense of doing something concrete for yourself.

If the scale feels discouraging some weeks, it's worth checking in on these other signals instead: they're just as real, and often move first.$body$
where code = 'ob_w10_non_scale_benefits';
update public.health_education_content set
  title = $body$Week 11: Building a healthier home environment$body$,
  summary = $body$Small changes to what's easy and visible at home shape everyone's habits, not just yours.$body$,
  body = $body$What's easy to reach at home shapes what gets eaten: by you and by your children. Keeping fruit visible on the counter and sugary snacks less visible (even in the same kitchen) measurably shifts what people grab without anyone deciding anything consciously.

You don't need to police what your family eats, or make a separate meal for yourself. The plate-method habits from this course work as family meals (more vegetables, modest starch portions, protein) without singling anyone out or naming it a "diet."

Children whose parents model steady, non-anxious eating habits tend to develop healthier relationships with food themselves. What you're building here quietly protects the people around you too.$body$
where code = 'ob_w11_family_environment';
update public.health_education_content set
  title = $body$Week 12: Why most regain happens, and how to avoid it$body$,
  summary = $body$The habits that lose weight and the habits that keep it off are different: knowing that in advance is the real advantage.$body$,
  body = $body$Most regained weight doesn't happen because someone "fails": it happens because the intensive habits of active weight loss (careful tracking, frequent check-ins) naturally relax once a goal is reached, and nothing replaces them. That's predictable, not a personal weakness, and knowing it in advance is your real advantage.

Maintenance needs a lighter but permanent version of what you've been doing: a weekly weigh-in kept for life, not just the active phase; the plate method as your default, not a temporary rule; and movement as a habit, not a project with an end date.

A small regain (a kilo or two) is normal and easy to correct quickly if you catch it early, which is exactly why the weekly weigh-in doesn't stop. Treat any small rise as information, not a reason to give up what you've built.$body$
where code = 'ob_w12_maintenance';
update public.health_education_content set
  title = $body$Week 2: Eat to stay full, protein, fibre and the liquid-calorie trap$body$,
  summary = $body$The practical food changes that reduce hunger instead of fighting it.$body$,
  body = $body$Diets fail when they leave you hungry. The workaround is choosing food that fills you for longer at the same calories.

Protein (beans, eggs, fish, chicken, moi moi) and fibre (vegetables, wholegrains, unripe plantain) hold hunger down for hours. White starches and fried snacks burn off fast and leave you hunting for more.

The quietest saboteur is liquid: soft drinks, juice, malt drinks and sweetened tea can carry a meal's worth of calories with zero fullness. Swapping them for water or zobo without sugar is often worth more than any other single change this month.$body$
where code = 'ob_w2_food_that_keeps_you_full';
update public.health_education_content set
  title = $body$Week 3: Weigh weekly, judge monthly$body$,
  summary = $body$Daily weight bounces are noise: how to track so the trend keeps you honest and sane.$body$,
  body = $body$Your weight swings a kilo or two day to day on water, salt and timing alone. Judging yourself by daily numbers is how motivation dies in week two.

The steadier habit: weigh once a week (same day, same time, before breakfast) and log it here. Judge the direction over a month, not the number over a day.

A month that holds steady after a losing streak is not failure; plateaus are part of every real weight-loss curve. What your care team watches is the six-month line, and every reading you log sharpens their picture.$body$
where code = 'ob_w3_track_the_trend';
update public.health_education_content set
  title = $body$Week 4: Movement for weight, and why muscle is your ally$body$,
  summary = $body$Walking burns the fat; strength work protects the engine that keeps it off.$body$,
  body = $body$For weight, movement's biggest job is not burning today's calories: it is protecting muscle while you lose fat. Muscle is the engine that burns calories at rest; crash diets that strip it away are why the weight comes back with interest.

The combination that works: brisk walking most days, plus two days a week of simple strength work, squats to a chair, wall press-ups, carrying shopping. No gym required.

Movement also buys you better sleep, and short sleep drives hunger hormones the wrong way. The pieces reinforce each other, which is why the programme asks about all of them, not just the scale.$body$
where code = 'ob_w4_movement_and_muscle';
update public.health_education_content set
  title = $body$Week 5: What a realistic pace looks like$body$,
  summary = $body$Losing about 0.5-1kg a week is sustainable; faster than that usually comes back faster too.$body$,
  body = $body$A realistic, sustainable pace is about 0.5-1kg a week. Faster loss is possible short-term, but it usually comes from water and muscle as much as fat, and it tends to return the same way it left: quickly.

At that pace, hitting the 5-10% target from week 1 typically takes three to six months, depending on your starting weight. That's not slow: it's the pace that studies show actually stays off.

If a week shows no change or even a small rise, that's not failure: water retention, salt, and hormonal timing (for women) all move the scale independently of fat loss. Judge the month, not the week, exactly like week 3 covered.$body$
where code = 'ob_w5_realistic_pace';
update public.health_education_content set
  title = $body$Week 6: Emotional eating and its triggers$body$,
  summary = $body$Eating in response to stress, boredom or sadness is common: noticing the trigger is the first real tool.$body$,
  body = $body$Eating isn't only about hunger: stress, boredom, sadness, and even celebration all reliably trigger eating that has nothing to do with an empty stomach. This is extremely common and not a character flaw; food genuinely does soothe in the short term, which is exactly why the habit sticks.

The first tool isn't willpower: it's noticing. Before eating outside of a normal mealtime, pause and ask what you're actually feeling. Sometimes naming it (tired, anxious, lonely) is enough to loosen the pull toward food.

If a trigger keeps repeating (a stressful time of day, a specific emotion) that pattern is worth raising with your care team. It's a genuinely solvable problem, just not one that pure diet advice touches.$body$
where code = 'ob_w6_emotional_eating';
update public.health_education_content set
  title = $body$Week 7: Reading food labels in the supermarket$body$,
  summary = $body$Serving size is the number that changes everything else on the label: check it first.$body$,
  body = $body$The most misread part of any label is serving size: every other number (calories, sugar, salt) is PER that serving, and a "serving" on the pack is often smaller than what you'd actually eat in one sitting. Check it first, before anything else.

After that, glance at added sugar and sodium: items where sugar appears in the first three ingredients, or where salt is listed in grams rather than milligrams per serving, are worth a second thought.

You don't need to label-check everything: fresh vegetables, fruit, and unprocessed protein don't carry labels for a reason. It matters most for packaged and processed food, which is exactly where hidden calories and salt tend to hide.$body$
where code = 'ob_w7_reading_labels';
update public.health_education_content set
  title = $body$Week 8: Owambe and social eating$body$,
  summary = $body$The same small habits that help with parties work here too: you don't have to sit out the occasion.$body$,
  body = $body$Big social occasions are where a good week can unravel, not from one plate, but from grazing over hours plus sugary drinks adding up unnoticed. You don't need to avoid these events; a few habits protect you without anyone noticing.

Eat something small before you go so you're not arriving starving. Take one plate, filled once, protein and vegetables first. Choose water or an unsweetened drink as your default, and treat a sweet drink as a deliberate choice rather than the automatic one.

One party will not undo a month of progress. The habit that actually matters is getting straight back to your normal pattern the next day, rather than treating one indulgent event as a reason to abandon the week.$body$
where code = 'ob_w8_social_eating';
update public.health_education_content set
  title = $body$Week 9: What this programme is, honestly$body$,
  summary = $body$Right now, Tarragon's weight programme is lifestyle-managed: here's exactly what that means and what it doesn't.$body$,
  body = $body$It's worth being direct about what this programme currently offers: structured, doctor-reviewed support for the lifestyle changes covered in this course, food, movement, sleep, and consistent follow-up. It does not currently include weight-loss medication or procedures.

That's not a permanent limitation, just where the programme starts. Lifestyle change alone, sustained with real follow-up (which is the part most people never get on their own), produces meaningful, durable results for most people: the 5-10% target from week 1 measurably improves blood pressure, blood sugar and cholesterol on its own.

If your care team ever assesses that medication would help in your specific case, that conversation will happen directly and honestly, not implied by marketing. For now, this course is the real, evidence-based tool in front of you: worth taking seriously on its own terms.$body$
where code = 'ob_w9_honest_expectations';
update public.health_education_content set
  title = $body$Why screening is worth it$body$,
  summary = $body$Catching things early is easier and cheaper than treating them late.$body$,
  body = $body$Screening looks for problems before you feel anything, which is exactly when they are most treatable. Many serious conditions give no warning signs in their early, most fixable stage.

Your screening calendar is built around your age, sex, and history. Keeping to it is one of the highest-value things you can do for your long-term health, and your care team handles the booking and follow-up with you.$body$
where code = 'prev-why-screening';
update public.health_education_content set
  title = $body$Making sense of your health numbers$body$,
  summary = $body$A gentle orientation to the readings your care team follows and why they matter.$body$,
  body = $body$Your care team follows a few key numbers over time: things like your blood pressure, blood sugar, and weight. No single reading tells the whole story; what matters is the pattern across weeks and months.

Logging steadily, even when you feel fine, is what lets your doctor spot a change early. This is the quiet work that keeps care ahead of problems rather than chasing them.$body$
where code = 'welcome-your-numbers';

-- Assertion: no em dashes should remain anywhere in the whole library now.
do $$
declare
  remaining integer;
begin
  select count(*) into remaining
  from public.health_education_content
  where title like '%' || chr(8212) || '%'
     or summary like '%' || chr(8212) || '%'
     or body like '%' || chr(8212) || '%';
  if remaining > 0 then
    raise exception 'expected zero health_education_content rows with an em dash, found %', remaining;
  end if;
end $$;
