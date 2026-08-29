-- Tarragon Health — Health Education: remove em dashes from the new
-- library content (this codebase's standing rule: em dashes read as
-- AI-generated and are not used in any user-facing copy in apps/web,
-- see feedback_no_em_dashes_marketing_copy — this content is patient-facing
-- reading material, squarely within that rule's broadened scope). Rewritten
-- grammatically per instance (comma/colon/period/parentheses as the
-- sentence actually calls for), not a mechanical dash-to-punctuation swap.

update public.health_education_content set
  summary = $body$Higher blood sugar makes gum disease more likely, and gum disease can push sugar higher in turn.$body$,
  body = $body$Diabetes and gum disease affect each other in both directions: higher blood sugar makes infections, including gum infections, more likely and harder to fight off, and gum infection or inflammation can in turn make blood sugar harder to control, a two-way link worth knowing.

Regular dental check-ups, and mentioning your diabetes to your dentist, let them watch for this specifically rather than treating it as a routine unrelated visit.

Daily brushing and flossing matter more with diabetes than they might otherwise, and any persistent gum bleeding, swelling or bad breath is worth a dental visit rather than waiting for your next scheduled check-up.$body$
where code = 'dm-dental-health-link';
update public.health_education_content set
  summary = $body$A common pregnancy condition, well managed with monitoring and, often, no medicine at all.$body$,
  body = $body$Gestational diabetes is high blood sugar that develops during pregnancy, usually identified through a routine screening test in the second trimester. It is common, and does not mean you had diabetes before or will necessarily have it after.

Management usually starts with diet and movement changes, which are enough for many people; some need medicine or insulin added, which is a normal part of the range of management, not a sign anything has gone wrong.

Gestational diabetes raises the chance of developing type 2 diabetes later in life, which is why a follow-up glucose check after delivery matters: it is a useful early-warning signal for your longer-term health, not just a pregnancy-specific issue.$body$
where code = 'dm-gestational-diabetes';
update public.health_education_content set
  summary = $body$Needing insulin is not a failure: it is simply the right tool for where your diabetes is now.$body$,
  body = $body$Some people with diabetes need insulin, either from diagnosis or added later as the condition progresses, which reflects how the condition naturally changes over time, not a sign that earlier management "failed."

Different insulin types work at different speeds: some act quickly around meals, some provide a steady background level through the day. Your care team tailors the specific combination and timing to your life and readings, not a one-size-fits-all schedule.

Correct storage (many insulins need refrigeration, though the pen or vial in current use is often fine at room temperature for a limited time) and correct injection technique both matter for how well it works: ask your care team or pharmacist to walk through both directly.$body$
where code = 'dm-insulin-basics';
update public.health_education_content set
  summary = $body$Time zones, meal timing, and medicine storage: a little planning goes a long way.$body$,
  body = $body$Travel disrupts the routine that diabetes management often relies on, so a little extra planning helps. Pack more testing supplies and medicine than you expect to need, keep insulin (if you use it) at a stable temperature using a cool pack rather than direct ice, and carry medicines in hand luggage in case of delayed baggage.

Crossing time zones can affect insulin timing for those who use it: ask your care team for specific guidance if your trip crosses several zones, rather than guessing on the day.

Keep fast-acting sugar accessible during travel days, which often involve less predictable meal timing than your normal routine: preparedness here is what keeps travel enjoyable rather than stressful.$body$
where code = 'dm-travel-tips';
update public.health_education_content set
  summary = $body$A role many people take on gradually, often without formal preparation.$body$,
  body = $body$Caring for an ageing parent or relative often starts gradually (a bit more help here, a check-in call there) until it becomes a significant role many people never formally planned for or were trained to do.

A few things help early: understanding their full medicine list and what each is for, knowing their care team's contact details, and having a clear sense of their wishes around care decisions before a crisis forces a rushed conversation.

Caregiver burnout is real and common: looking after your own health and wellbeing alongside caregiving is not a distraction from the role, it is what allows you to sustain it. Your own care team is a resource in this too, not only theirs.$body$
where code = 'family-caring-for-elderly-relative';
update public.health_education_content set
  summary = $body$Most fevers are manageable at home: a short list of signs means otherwise.$body$,
  body = $body$Fever itself, in an otherwise well child, is usually the body's normal response to an infection rather than an emergency on its own: how the child is behaving generally matters more than the exact number on the thermometer.

Signs that mean urgent care, rather than home management: a fever in a baby under three months old (any fever at this age warrants prompt medical attention), difficulty breathing, a rash that does not fade when pressed, unusual drowsiness or difficulty waking, a stiff neck, repeated vomiting, or the child seeming seriously unwell to you as a parent, even if you cannot pinpoint exactly why.

Trust your own read of your child alongside this list: a parent's sense that "something is different" is a genuinely valid reason to get checked, not something to second-guess.$body$
where code = 'family-child-fever-urgent-care';
update public.health_education_content set
  summary = $body$A handful of changes address most common childhood accidents.$body$,
  body = $body$Most childhood accidents at home cluster around a predictable few causes: falls, poisoning (from medicines and household chemicals within reach), burns, and choking hazards, which means a handful of specific changes cover most of the real risk.

Storing medicines and cleaning products up high or locked away (not just "out of sight," since children climb), keeping small objects and button batteries away from young children, and supervising closely around water, even shallow amounts, are the highest-value basics.

A home that is completely risk-free is not a realistic goal, and does not need to be: addressing the few highest-risk categories covers most of what actually causes serious injury.$body$
where code = 'family-child-safety-at-home';
update public.health_education_content set
  summary = $body$A brief, plain-language map of why vaccines are timed the way they are.$body$,
  body = $body$Childhood vaccines are timed around when a baby's own immune system is developing and when natural protection from the mother (passed on before birth) starts to fade: the schedule is not arbitrary, it is built around when each vaccine works best and is most needed.

Most schedules start at birth and continue through the early years with several rounds, covering protection against diseases that were once major causes of childhood illness and death, and remain genuinely serious wherever vaccination rates drop.

Keeping your child's vaccination record here, and staying close to the recommended schedule rather than spacing doses out casually, gives the fullest protection at the times it matters most. If a dose is missed or delayed, ask your care team about catching up: it is rarely too late to resume.$body$
where code = 'family-childhood-vaccine-schedule';
update public.health_education_content set
  summary = $body$What's ordinary and self-limiting, and what benefits from a proper look.$body$,
  body = $body$Children get sick often, especially in the early years while their immune system is building experience with common infections: this is a normal, if exhausting, part of early childhood, not usually a sign something is wrong with them.

Fevers, colds, and ear infections are among the most common. Most colds resolve on their own with rest and fluids; ear infections sometimes need treatment and are worth checking, especially with a young child who cannot describe pain clearly, showing instead as pulling at an ear, irritability, or trouble sleeping.

Keeping a simple record of illnesses here helps your care team spot a pattern (unusually frequent infections, for example) that a single visit would not reveal on its own.$body$
where code = 'family-common-childhood-illness';
update public.health_education_content set
  summary = $body$A wide normal range exists: knowing it prevents unnecessary worry and helps spot real delays.$body$,
  body = $body$Developmental milestones (sitting, walking, first words, and beyond) have a genuinely wide normal age range: a child reaching a milestone a bit later than a friend's child is usually within normal variation, not a cause for alarm on its own.

What is worth mentioning to your care team: a clear loss of a skill a child previously had, a milestone significantly outside the typical range with no catch-up over time, or a pattern across several areas at once rather than one isolated area.

Routine check-ups are built specifically to track this over time using growth charts and milestone checks: bringing questions there, even ones that feel minor, is exactly what those visits are for.$body$
where code = 'family-growth-milestones';
update public.health_education_content set
  summary = $body$A family conversation that pays off for years of care decisions.$body$,
  body = $body$A family health history (which close relatives have had which conditions, and roughly at what age) is one of the most useful, and most commonly missing, pieces of information in a health record. It shapes screening timing, risk assessment, and sometimes treatment choices for you and your children.

It is worth having this conversation deliberately with parents, siblings, and grandparents while that information is available, rather than assuming it will always be easy to find out later.

Add what you learn here as you learn it: a family history does not need to be complete on day one, and updating it over time is normal and expected as more comes to light.$body$
where code = 'family-health-history-together';
update public.health_education_content set
  summary = $body$Timing, textures, and the common worries most families share.$body$,
  body = $body$Most guidance points to introducing solid foods around six months, alongside continued breastfeeding or formula, rather than replacing it outright at that stage.

Starting with single, simple foods before mixtures makes it easier to notice if a particular food causes a reaction. Textures generally progress gradually (from smooth purees to mashed, then soft finger foods) matching a baby's developing ability to chew and swallow safely.

Common early worries (gagging (different from choking, and usually a normal reflex as babies learn to manage new textures) and food refusal (often needing several exposures before acceptance)) are typically part of the normal process rather than signs of a problem. Ask your care team if you are ever unsure about a specific food or reaction.$body$
where code = 'family-introducing-solid-foods';
update public.health_education_content set
  summary = $body$Practical comfort measures, and knowing when home care is enough.$body$,
  body = $body$For common, mild childhood illnesses, home care centres on a few practical basics: keeping the child hydrated (small, frequent sips if they are not drinking much), rest, and appropriate fever relief if they are uncomfortable, following correct weight-based dosing.

Watching for the signs that mean it is time to seek care (worsening rather than improving after a couple of days, difficulty breathing, persistent vomiting preventing fluids, or your own sense that something is more than a routine illness) is more useful than fixating on any single symptom in isolation.

Most childhood illness is genuinely manageable at home with these basics. The goal of knowing the warning signs is confidence, not anxiety: most of the time, home care is exactly the right response.$body$
where code = 'family-managing-sick-child-home';
update public.health_education_content set
  summary = $body$A little preparation eases a big adjustment for an older child.$body$,
  body = $body$A new sibling is a major change from an older child's point of view, even when the family is thrilled about it: some regression (in sleep, toileting, or behaviour) in the weeks around the birth is common and usually temporary.

What tends to help: involving the older child in preparation in small, age-appropriate ways, protecting some one-on-one time with them after the baby arrives even briefly, and naming their feelings ("it's okay to feel funny about the new baby") rather than only insisting they should be happy.

This phase generally settles within weeks to a few months as the new routine becomes familiar: consistency and patience matter more than any single perfect conversation.$body$
where code = 'family-preparing-new-sibling';
update public.health_education_content set
  summary = $body$A short, practical list that saves a scramble at enrolment time.$body$,
  body = $body$Schools typically ask for a specific, predictable set of health information at enrolment and periodically after: vaccination records, known allergies, any ongoing medical conditions, and current medicines, especially any needed during school hours.

Keeping this organised here, rather than scattered across old papers, turns a stressful enrolment scramble into an export or a quick summary.

If your child has a condition that needs a plan at school (an allergy, asthma, or another condition requiring specific action), it is worth proactively sharing a clear written plan with the school rather than assuming staff will know what to do in the moment.$body$
where code = 'family-school-health-records';
update public.health_education_content set
  summary = $body$It is less about a strict hour limit and more about what screen time replaces.$body$,
  body = $body$Screen time guidance has shifted somewhat from rigid hour limits toward a more practical question: what is the screen time replacing? Time that displaces sleep, physical activity, or in-person interaction tends to be the actual concern, more than the number of minutes alone.

Practical habits that help regardless of exact limits: no screens in the hour before bed (screen light can delay sleep onset), balancing screen time with active play, and being present and engaged during screen use with younger children rather than using it purely as unsupervised time.

Every family's situation is different: the useful question is whether current habits are crowding out sleep, activity, and connection, not chasing a single universal number.$body$
where code = 'family-screen-time-health';
update public.health_education_content set
  summary = $body$Age-appropriate honesty builds trust and reduces fear more than vague reassurance.$body$,
  body = $body$Children generally cope better with age-appropriate honesty about their own health than with vague reassurance that turns out not to match what happens: a child who was told "it won't hurt at all" before an injection that does hurt learns to distrust the next reassurance too.

Simple, honest, calm explanations work well even for young children: naming what will happen, roughly what it might feel like, and that you will be there with them. For a chronic condition, involving a child gradually in understanding their own care, as age allows, builds confidence rather than fear over time.

Your care team can help pitch explanations at the right level for your child's age if you are unsure how much detail is appropriate for a specific situation.$body$
where code = 'family-talking-to-children-about-health';
update public.health_education_content set
  summary = $body$The details you fill in quietly shape everything from your screening calendar to your medicine safety checks.$body$,
  body = $body$Details like your family history, allergies, past conditions, and lifestyle factors are not just paperwork: they actively shape your screening calendar, medicine safety checks, and how your care team interprets your results.

A profile filled in gradually over time is completely normal: you do not need to complete everything on day one, and adding detail as you think of it (a family diagnosis you remember, an allergy you forgot to mention) genuinely improves your care going forward.

If anything about your health history changes (a new diagnosis elsewhere, a new medicine from another provider) updating it here keeps your care team working from an accurate picture rather than an outdated one.$body$
where code = 'gs-complete-your-profile';
update public.health_education_content set
  summary = $body$A team, not one person: knowing the roles helps you know who to reach for what.$body$,
  body = $body$Your care is handled by a team rather than one individual, and knowing the roles helps you know who to reach for what. Care Coordinators handle logistics, booking, check-ins, and adherence follow-up, and they route anything needing clinical judgement onward rather than deciding it themselves. Doctors review your readings, results and medicines, and their level of seniority scales with case complexity: most routine care is handled at the first level, with more complex cases seen by more senior doctors as needed.

Messages you send go to your care team collectively, not to one named individual, which is what allows continuous coverage rather than a single point of failure when someone is unavailable.

Every review, escalation, or certificate still carries the name of the specific doctor who actually did it: team-based coverage does not mean anonymous care, it means reliable care.$body$
where code = 'gs-meet-your-care-team';
update public.health_education_content set
  summary = $body$What happens after your care team says you need a specialist.$body$,
  body = $body$When your care team decides a specialist opinion would help, a referral connects you to one, along with the reason for it and relevant history so the specialist has context rather than starting from zero.

You can typically choose from suggested options where more than one is reasonable, and after the specialist visit, that finding generally comes back to your regular care team, so it becomes part of your ongoing record rather than a one-off, disconnected visit.

A referral is coordination, not a handoff: your regular care team stays involved and informed throughout, and remains your main point of contact even while a specialist is involved.$body$
where code = 'gs-referrals-explained';
update public.health_education_content set
  summary = $body$Knowing what's included (and what isn't yet) helps you get full value from what you're paying for.$body$,
  body = $body$Different plans include different things: some include personalised health education, lab and referral coordination, an annual doctor review, or lifestyle coaching, while others cover the core essentials. It is worth actually knowing what your specific plan includes, since features you are entitled to are easy to miss if you never go looking.

If you see a feature gated behind an upgrade prompt, that is not a bug: it is genuinely not included in your current plan, and the prompt tells you exactly what tier includes it.

If you are unsure what your plan covers, your subscription page shows exactly what is included: worth a look occasionally, especially after any plan change.$body$
where code = 'gs-understanding-your-plan';
update public.health_education_content set
  summary = $body$A short, realistic weekly rhythm rather than an overwhelming feature list.$body$,
  body = $body$Tarragon has a lot inside it, and you do not need to use all of it constantly to get real value. A realistic weekly rhythm for most people: log any home readings you take (blood pressure, glucose, weight) as you take them, check messages from your care team, and glance at your dashboard for anything flagged.

Most of the deeper features (screenings, referrals, the education library, family features) are there for when you need them, not a checklist to complete constantly.

If you are not sure what you should be doing regularly for your specific situation, that is a completely reasonable question for your care team: the right rhythm differs depending on what you are managing.$body$
where code = 'gs-using-the-app-daily';
update public.health_education_content set
  summary = $body$A simple way to decide, so you never have to guess under pressure.$body$,
  body = $body$Knowing which channel to use saves time exactly when it matters most. Message your care team in the app for: a new mild-to-moderate symptom, a medicine question, a result you want explained, or anything that can reasonably wait for a same-day-to-a-few-days response.

Go straight to emergency care, without waiting for an in-app reply, for: chest pain, severe breathlessness, signs of a stroke (face drooping, arm weakness, slurred speech), heavy bleeding, severe abdominal pain, or any situation where you would call for emergency help regardless of what app you had open.

If you are ever unsure which category applies, err toward emergency care: it is always the safer default when genuinely uncertain.$body$
where code = 'gs-when-message-vs-emergency';
update public.health_education_content set
  summary = $body$What it is, why it raises stroke risk, and why treatment focuses on more than just the rhythm.$body$,
  body = $body$Atrial fibrillation (often shortened to AFib) is when the heart's upper chambers beat irregularly and often too fast, instead of in their normal steady rhythm. Some people feel a fluttering or racing heartbeat; others feel nothing unusual at all.

The reason it matters beyond comfort is that an irregular rhythm lets blood pool briefly in the heart, which raises the risk of a clot forming and travelling to the brain, a stroke. This is why AFib treatment often includes a blood-thinning medicine alongside anything that manages the rhythm itself.

If you are prescribed a blood thinner for AFib, taking it consistently matters more than almost any other part of the plan: it is doing quiet, essential work even on days you feel completely normal.$body$
where code = 'heart-afib-explained';
update public.health_education_content set
  summary = $body$Chest pressure is the classic sign, but not the only one: what to watch for and what to do.$body$,
  body = $body$The best-known sign is a pressure, squeezing or tightness in the chest, often lasting more than a few minutes. But a heart attack can also show up as pain spreading to the arm, jaw or back, shortness of breath, cold sweat, nausea, or sudden extreme fatigue: sometimes with little or no chest pain at all.

This is not a symptom checklist to self-diagnose against. It is information so that if something feels seriously wrong, you do not talk yourself out of getting help. Minutes matter for how much heart muscle is saved.

If you or someone with you has these signs, treat it as an emergency: get to a hospital or call for help immediately, do not wait to see if it passes.$body$
where code = 'heart-attack-warning-signs';
update public.health_education_content set
  summary = $body$General context to think with, never a substitute for getting checked when something feels wrong.$body$,
  body = $body$Chest pain has many causes, and most of them are not the heart: muscle strain, heartburn, and anxiety are all common culprits. That said, this is context, not a diagnosis tool, and the safe default is always to get checked rather than guess.

Patterns more often linked to the heart: pressure or squeezing rather than sharp or stabbing pain, pain that spreads to the arm, jaw or back, pain brought on by exertion and eased by rest, or pain paired with breathlessness, sweating or nausea.

Patterns more often linked to other causes: pain that changes with breathing or movement, pain you can point to with one finger, or pain that started right after eating. When in doubt, get it checked rather than waiting it out.$body$
where code = 'heart-chest-pain-context';
update public.health_education_content set
  summary = $body$What LDL, HDL and triglycerides actually mean, in plain language.$body$,
  body = $body$Your cholesterol panel reports a few different things, not one number. LDL is often called "bad" cholesterol: it is what builds up inside artery walls over years. HDL is "good" cholesterol: it helps carry cholesterol away. Triglycerides are a separate type of fat in your blood, often linked to diet and weight.

The goal is not zero cholesterol; your body needs some. The goal is a healthy balance: lower LDL, higher HDL, and triglycerides in range. Diet, movement and, for some people, medicine all shift this balance.

One panel is a starting point, not a verdict. Your care team looks at your numbers alongside your blood pressure, sugar and family history to decide what, if anything, needs to change.$body$
where code = 'heart-cholesterol-basics';
update public.health_education_content set
  summary = $body$A handful of specific changes matter far more than an overwhelming full diet overhaul.$body$,
  body = $body$You do not need to overhaul every meal to move your cholesterol numbers. A few specific swaps carry most of the benefit.

Replace some fried and processed food with grilled, boiled or steamed options. Choose fish and beans over red or processed meat more often. Swap groundnut oil or palm oil used generously for smaller amounts, and add more fibre (oats, beans, vegetables, fruit with the skin on where possible) which binds cholesterol in the gut before it is absorbed.

Start with one meal a day. Small, sustained changes across months move a cholesterol panel more reliably than a strict week followed by giving up.$body$
where code = 'heart-cholesterol-food-swaps';
update public.health_education_content set
  summary = $body$Most heart conditions do not mean stopping activity: they mean starting the right way.$body$,
  body = $body$A heart diagnosis often makes people afraid to move, when in most cases the opposite is true: appropriately paced activity strengthens the heart and improves outcomes. The key word is "appropriately": ask your care team what level is right for your specific situation before starting or resuming.

General signs to stop and rest: chest pain or pressure, unusual breathlessness, dizziness, or an irregular or racing heartbeat that feels different from your normal.

Many people are cleared for brisk walking, and some are referred to structured cardiac rehabilitation programmes, which pace activity up safely under supervision. Ask your care team whether that is right for you.$body$
where code = 'heart-exercise-with-condition';
update public.health_education_content set
  summary = $body$A same-time, same-scale weigh-in catches fluid buildup days before you would otherwise feel it.$body$,
  body = $body$If you live with heart failure, your bathroom scale is one of your most useful tools. Fluid can build up in the body before you feel breathless or notice swelling, and weight often shows it first.

Weigh yourself each morning, after using the toilet and before eating, on the same scale, in similar clothing. Log it here so the trend is visible over time, not just the number on any one day.

A sudden jump (commonly described as 2kg or more in two to three days) is worth a message to your care team promptly, even if you feel fine otherwise. Catching it early usually means a simple adjustment instead of a hospital visit.$body$
where code = 'heart-failure-daily-weighing';
update public.health_education_content set
  summary = $body$It does not mean the heart has stopped: it means it is pumping less efficiently than it should.$body$,
  body = $body$"Heart failure" sounds alarming, but it does not mean the heart has stopped working. It means the heart is not pumping quite as efficiently as it should, so fluid can back up into the lungs and body.

Common signs include breathlessness (especially lying flat or with activity), swelling in the ankles or belly, and unusual tiredness. It is a long-term condition your care team manages, often very successfully, with medicines and monitoring.

The two habits that matter most day to day: weighing yourself regularly (sudden weight gain can mean fluid building up) and watching your salt intake, because salt makes the body hold onto fluid.$body$
where code = 'heart-failure-explained';
update public.health_education_content set
  summary = $body$A parent or sibling with early heart disease changes how closely your own numbers get watched.$body$,
  body = $body$If a close relative (a parent or sibling) had a heart attack, stroke, or was diagnosed with heart disease at a relatively young age, that raises your own risk somewhat, independent of your personal habits.

This is not a prediction that the same will happen to you. It is one input your care team weighs alongside your blood pressure, cholesterol, sugar and lifestyle to decide how closely to monitor you and how proactive to be.

If you know this history, tell your care team even if nobody has asked recently: family details change (a new diagnosis, a relative's age at the time) and the record here should stay current.$body$
where code = 'heart-family-history';
update public.health_education_content set
  summary = $body$Why heart conditions often mean several tablets, each doing a different job.$body$,
  body = $body$It is common to be prescribed more than one medicine for a heart condition, and that can feel like a lot at once. Broadly, they tend to fall into a few jobs: some lower blood pressure and ease the heart's workload, some manage heart rhythm, some thin the blood to prevent clots, and some manage cholesterol.

Each is usually doing a different, specific job rather than overlapping, which is why stopping one without medical guidance can undo a piece of the plan the others were built around.

If a medicine is causing side effects, or the number of tablets feels unmanageable, say so. Your care team would much rather adjust the plan than have you quietly stop taking something.$body$
where code = 'heart-medicines-explained';
update public.health_education_content set
  summary = $body$What recovery typically involves, and why the early months set the pattern for years after.$body$,
  body = $body$Recovering from a heart attack or other cardiac event is both physical and emotional. Physically, activity is usually built back up gradually, often with a structured cardiac rehabilitation programme if one is available to you. Emotionally, it is common to feel anxious about symptoms, or low, in the weeks after: this is a normal response worth mentioning to your care team, not something to push through silently.

Medicine adherence in these early months matters enormously; several of the medicines started after an event are specifically protecting against a repeat one.

Most people return to a full, active life. The habits built in the first few months (movement, medicines, follow-up) are what carry that forward long term.$body$
where code = 'heart-recovery-after-event';
update public.health_education_content set
  summary = $body$Loud snoring with pauses in breathing is worth mentioning: it strains the heart quietly over years.$body$,
  body = $body$Loud, habitual snoring (especially with pauses in breathing, gasping, or choking sounds, and daytime exhaustion despite a full night in bed) can be a sign of sleep apnoea, where breathing repeatedly stops and restarts during sleep.

Each pause briefly drops oxygen and spikes stress hormones, which over years is linked to high blood pressure, irregular heart rhythm and heart strain. It is often missed because the person having it does not remember the episodes: a partner or family member usually notices first.

It is very treatable once identified. If this sounds familiar, mention it to your care team; it is a common and often overlooked piece of the picture.$body$
where code = 'heart-sleep-apnoea';
update public.health_education_content set
  summary = $body$Each raises heart risk on its own: combined, the effect is not simply additive.$body$,
  body = $body$Smoking damages blood vessel walls and makes blood more likely to clot. Heavy alcohol use raises blood pressure and can weaken heart muscle over time. Each is a real risk on its own; together, they tend to compound rather than simply add up.

The encouraging side: heart risk from smoking starts dropping within weeks of quitting, and continues improving for years. There is no need to quit everything at once: even cutting down, or getting support to quit smoking specifically, moves the numbers in the right direction.

Your care team can point you to real support for quitting, including options that do not rely on willpower alone.$body$
where code = 'heart-smoking-alcohol-combined';
update public.health_education_content set
  summary = $body$Chronic stress raises blood pressure and heart rate: small, repeatable habits help most.$body$,
  body = $body$Stress triggers a real physical response: blood pressure and heart rate rise, and over time chronic stress is linked to higher cardiovascular risk. You cannot remove all stress from life, but you can build habits that soften its effect on your body.

What helps most, based on what actually gets used day to day: a few minutes of slow breathing when tension spikes, regular movement (even a short walk), protecting sleep, and talking to someone (a friend, family member, or your care team) rather than carrying everything alone.

If stress is affecting your sleep, appetite or mood for weeks at a time, that is worth raising with your care team directly, not just managing quietly.$body$
where code = 'heart-stress-management';
update public.health_education_content set
  summary = $body$A simple four-part check anyone can use in a moment that matters.$body$,
  body = $body$A stroke happens when blood flow to part of the brain is interrupted. It can look different in different people, which is why a simple check helps: FAST.

Face: does one side droop when they smile? Arms: can they raise both arms, or does one drift down? Speech: is it slurred or strange, can they repeat a simple sentence? Time, if any of these are present, time matters enormously; get emergency help right away.

Stroke treatment is far more effective the sooner it starts. Do not wait to see if symptoms improve on their own, and do not let the person "sleep it off": get them to emergency care immediately.$body$
where code = 'heart-stroke-fast';
update public.health_education_content set
  summary = $body$Chest pressure still happens, but nausea, fatigue and jaw pain are more often the leading signs.$body$,
  body = $body$Classic chest-pressure heart attack symptoms are common in women too, but women somewhat more often experience less "classic" signs as the leading symptom, with unusual fatigue, nausea, jaw or back pain, breathlessness, or a vague sense that something is wrong: sometimes with little or no chest pain.

This matters because those signs are easier to dismiss as stress, indigestion, or tiredness, which can delay getting help.

The same rule applies regardless of how the symptoms show up: if something feels seriously wrong, particularly with any combination of these signs, treat it as an emergency and get checked rather than waiting to see if it passes.$body$
where code = 'heart-women-symptoms-differ';
update public.health_education_content set
  summary = $body$A temporary bump after a strong cup, not usually something to fear, but worth knowing.$body$,
  body = $body$Caffeine can cause a temporary rise in blood pressure, typically peaking within about half an hour and easing within a few hours, which is worth knowing if you take a reading soon after a strong coffee or an energy drink and see it higher than expected.

For most people with well-controlled blood pressure, moderate regular caffeine intake does not cause lasting harm: the effect is usually more relevant to a single reading's accuracy than to your long-term numbers.

A practical habit: try to take your logged readings before your first coffee of the day, or after a similar gap each time, so your trend reflects your real baseline rather than caffeine timing noise.$body$
where code = 'htn-caffeine-effect';
update public.health_education_content set
  summary = $body$Most high readings are not an emergency: a specific combination is.$body$,
  body = $body$A single high reading, even a notably high one, is usually not itself an emergency: it is a signal to recheck calmly and mention it to your care team. What changes things is a very high reading combined with certain symptoms.

Seek emergency care immediately for a very high reading alongside: a severe headache, chest pain, shortness of breath, vision changes, confusion, or difficulty speaking. This combination can mean organs are being affected right now, not just a number worth monitoring.

A high reading with no symptoms at all is still worth acting on (rest, recheck in a few minutes seated calmly, and contact your care team) but it is a different situation from the emergency combination above, and knowing the difference avoids both dangerous delay and unnecessary panic.$body$
where code = 'htn-emergency-signs';
update public.health_education_content set
  summary = $body$Preeclampsia is serious but very manageable when caught through routine checks.$body$,
  body = $body$Blood pressure is checked at nearly every antenatal visit for a reason: a rise in pregnancy can be an early sign of preeclampsia, a condition that needs monitoring and sometimes treatment to keep both parent and baby safe.

Signs worth reporting immediately, beyond a raised reading at a check-up: a severe headache that will not ease, vision changes (blurring, flashing lights), sudden swelling in the face or hands, or pain under the ribs on the right side.

This is exactly why keeping every antenatal appointment matters, even when you feel completely well: preeclampsia can develop with few symptoms you would notice yourself, which is why the routine check, not how you feel, is what catches it.$body$
where code = 'htn-pregnancy-preeclampsia';
update public.health_education_content set
  summary = $body$White-coat and masked hypertension explained: why home readings matter so much.$body$,
  body = $body$Some people's blood pressure runs higher specifically in a clinical setting, from the mild stress of the visit itself, called "white-coat hypertension." Less commonly, the reverse happens: normal at the clinic but higher at home, called "masked hypertension," which is easy to miss entirely without home readings.

This is a major reason your care team asks you to log readings here regularly rather than relying on clinic visits alone: a home log spanning many readings across different days paints a far more accurate picture than any single clinic moment.

If your clinic and home readings consistently differ, mention the pattern directly: it changes how your care team interprets your numbers and can change the treatment decision itself.$body$
where code = 'htn-white-coat-masked';
update public.health_education_content set
  summary = $body$Your kidneys help make red blood cells: when kidney function drops, anaemia often follows.$body$,
  body = $body$Kidneys release a hormone that signals the body to make red blood cells. As kidney function declines, that signal weakens, and anaemia (low red blood cell count) becomes more common, which is why unusual tiredness in CKD is not always "just tiredness."

Anaemia from CKD is treatable, sometimes with iron, sometimes with a medicine that replaces the missing signal, depending on how significant it is.

If you have CKD and notice new or worsening fatigue, breathlessness on mild exertion, or looking unusually pale, mention it: it is a reasonable and common thing for your care team to check for specifically.$body$
where code = 'kidney-anaemia-link';
update public.health_education_content set
  summary = $body$Each affects the other: control one and you help protect the other.$body$,
  body = $body$High blood pressure damages kidneys over time, and damaged kidneys struggle to help regulate blood pressure: each makes the other worse, which is why your care team manages them as one connected picture rather than two separate problems.

Certain blood pressure medicines are specifically chosen for their kidney-protective effect, beyond just lowering the number, which is one reason your specific medicine choice may differ from a family member's, even with a similar blood pressure reading.

Keeping to your blood pressure targets, taking medicine consistently, and attending kidney check-ups on schedule are, together, the most effective kidney protection available for most people with CKD.$body$
where code = 'kidney-bp-protection-together';
update public.health_education_content set
  summary = $body$What that eGFR number on your lab report is actually measuring.$body$,
  body = $body$Chronic kidney disease (CKD) is tracked in stages, from 1 (mild) to 5 (kidney failure), based mainly on a number called eGFR: estimated glomerular filtration rate. Think of it as roughly how efficiently your kidneys are filtering, expressed as a percentage-like score: 90+ is normal-range, while lower numbers mean reduced function.

A lower stage number does not mean an emergency: many people live for years at earlier stages with steady monitoring and never progress quickly. What matters most is the trend over time, and managing the conditions (commonly high blood pressure and diabetes) that drive further decline.

Your care team uses your eGFR trend, not a single reading, to decide how often to check and what to adjust.$body$
where code = 'kidney-ckd-stages';
update public.health_education_content set
  summary = $body$Protein, potassium and phosphorus: what changes, and why it depends on your stage.$body$,
  body = $body$Kidney-friendly eating is not one-size-fits-all: it depends on your stage of kidney function, so specifics should come from your care team or a dietitian, not a generic list. That said, a few themes come up often.

Protein: earlier CKD does not usually mean cutting protein sharply, but very high-protein eating can add to the kidneys' workload. Potassium and phosphorus: as kidney function drops, these can build up in the blood, so some people are advised to limit high-potassium foods (like large amounts of banana, orange, or potato) or high-phosphorus foods (some processed and packaged items).

Salt is nearly always worth limiting, since it affects both blood pressure and fluid balance, which the kidneys are already managing.$body$
where code = 'kidney-eating-well';
update public.health_education_content set
  summary = $body$Why "drink more water" is not universal advice once kidney function has dropped.$body$,
  body = $body$Healthy kidneys handle a wide range of fluid intake without much trouble. As kidney function drops, that flexibility narrows, which is why fluid advice for CKD is genuinely different from general health advice, and should come from your care team rather than generic guidance.

Salt is more consistent: reducing it helps blood pressure and reduces fluid retention at almost every stage. The same hidden sources apply as elsewhere: seasoning cubes, processed and tinned food, salted snacks.

If you notice new swelling in your legs or around your eyes, or sudden weight gain over a few days, that is worth mentioning to your care team: it can reflect fluid balance shifting.$body$
where code = 'kidney-fluid-and-salt';
update public.health_education_content set
  summary = $body$Routines that make ongoing dialysis fit into a real, full life.$body$,
  body = $body$Starting dialysis is a major adjustment, but many people build a stable, workable routine around it and continue working, socialising and travelling with planning.

A few things tend to help most: keeping to the fluid and diet guidance from your dialysis team closely (it matters more here than at earlier CKD stages), planning ahead for travel or events around your schedule, and treating the emotional side as real, since it is common to grieve the change, and support (from family, your care team, or a support group) genuinely helps.

If a session routinely leaves you feeling unusually unwell, or something about the schedule stops working for your life, say so: there is often more flexibility in the plan than people assume.$body$
where code = 'kidney-living-well-on-dialysis';
update public.health_education_content set
  summary = $body$Some common over-the-counter painkillers are harder on the kidneys than others.$body$,
  body = $body$Some widely available painkillers, particularly a class called NSAIDs (common examples include ibuprofen and diclofenac), can reduce blood flow to the kidneys and are best used cautiously, especially with existing kidney disease, and ideally not regularly without checking with your care team first.

This is not about avoiding pain relief altogether: it is about choosing wisely and not assuming "available without a prescription" means "no kidney impact." Paracetamol is generally considered gentler on the kidneys at normal doses, but any regular medicine use is worth mentioning at your next check-in.

If you take regular painkillers for a chronic pain condition and also have CKD, ask your care team to review the combination directly rather than guessing.$body$
where code = 'kidney-painkillers-caution';
update public.health_education_content set
  summary = $body$A conversation, not a sudden event: most people have real time to prepare and choose.$body$,
  body = $body$For most people, the conversation about dialysis happens well before it is urgently needed, giving real time to understand the options and prepare rather than facing a sudden decision. It typically covers the type of dialysis (haemodialysis, usually at a centre, or peritoneal dialysis, usually done at home), what a typical week looks like with each, and how it fits your life and work.

Some people are also assessed for a kidney transplant as an alternative or eventual step, which your care team can discuss with you.

It is a significant conversation and a lot to take in at once: it is entirely reasonable to ask for it in stages, bring a family member, and ask the same question more than once.$body$
where code = 'kidney-preparing-for-dialysis';
update public.health_education_content set
  summary = $body$The two biggest drivers of kidney damage worldwide, and why managing them protects kidneys too.$body$,
  body = $body$High blood sugar and high blood pressure are, between them, the leading causes of kidney damage worldwide. Both quietly strain the tiny blood vessels inside the kidneys that do the actual filtering.

The encouraging part: managing these two conditions well is one of the most effective things you can do to protect your kidneys, often more effective than anything kidney-specific. Keeping blood pressure and blood sugar in the range your care team sets, and taking medicines consistently, is the core of kidney protection for most people.

Certain blood pressure medicines are specifically protective for kidneys with diabetes, which is one reason your care team may choose one type over another for you specifically.$body$
where code = 'kidney-protecting-with-diabetes-htn';
update public.health_education_content set
  summary = $body$A short, practical list, not everything, but the things worth not waiting on.$body$,
  body = $body$Most days with CKD involve no new symptoms at all, and that is expected. A short list of changes is worth messaging your care team about rather than waiting for your next scheduled check: new or worsening swelling in the legs, ankles or around the eyes; sudden weight gain over a few days; a marked drop in how much urine you are passing; new breathlessness; or unusual, persistent fatigue.

None of these automatically means an emergency: often they lead to a simple test or medicine adjustment. But they are the kind of change that is genuinely more useful reported early than mentioned in passing at a routine visit weeks later.$body$
where code = 'kidney-signs-to-report';
update public.health_education_content set
  summary = $body$A short, evidence-backed list rather than an overwhelming one.$body$,
  body = $body$CKD progression can often be slowed meaningfully, even when it cannot be reversed. The habits with the most evidence behind them are a short list, not a long one: keeping blood pressure at your target, keeping blood sugar controlled if you have diabetes, taking prescribed kidney-protective medicines consistently, limiting salt, being cautious with NSAID painkillers, and attending your scheduled kidney check-ups so any change is caught early.

Smoking also accelerates kidney decline, so quitting has a direct kidney benefit alongside its heart and lung ones.

None of this requires perfection. Consistency across most days, sustained over months and years, is what actually shows up in your eGFR trend.$body$
where code = 'kidney-slowing-progression';
update public.health_education_content set
  summary = $body$What assessment, waiting, and life after a transplant broadly involve.$body$,
  body = $body$A kidney transplant can offer a fuller return to normal life than dialysis for many eligible people, and is worth discussing with your care team as your CKD progresses. It generally starts with an assessment of overall health to confirm transplant is suitable, followed by matching with a donor: sometimes a living relative or friend, sometimes through a waiting list.

After a transplant, daily anti-rejection medicine is essential, taken consistently for as long as the transplant is working: this is not optional or occasional.

A transplant is a major step with real trade-offs and benefits specific to each person. Your care team can help you understand whether and when it makes sense for you.$body$
where code = 'kidney-transplant-basics';
update public.health_education_content set
  summary = $body$Why a little protein in urine matters even when everything else feels fine.$body$,
  body = $body$Healthy kidneys keep protein in the blood, not the urine. A urine test that finds protein (sometimes reported as ACR or a "protein:creatinine ratio") can be an early sign that the kidney's filters are letting things through they normally would not: often before blood tests show any change.

A small amount detected once is not automatically alarming; your care team usually confirms with a repeat test, since things like a recent infection, heavy exercise, or dehydration can cause a temporary blip.

A confirmed, persistent result is useful information, not a diagnosis on its own: it helps your care team decide how closely to monitor you and whether to start kidney-protective treatment earlier.$body$
where code = 'kidney-urine-protein-test';
update public.health_education_content set
  summary = $body$More than "filtering waste": the quiet, constant work behind healthy kidneys.$body$,
  body = $body$Your two kidneys filter your entire blood volume roughly forty times a day, removing waste and extra fluid as urine. But that is only part of the job: they also balance salts and minerals, help control blood pressure, and trigger the body to make red blood cells.

Because of this, kidney problems can show up in surprising places: tiredness (from low red blood cells), swelling (from fluid balance), or high blood pressure that is hard to control.

Kidneys can lose a good deal of function before you feel anything at all, which is exactly why blood and urine tests, not symptoms, are how your care team actually tracks kidney health.$body$
where code = 'kidney-what-they-do';
update public.health_education_content set
  summary = $body$Weight-based dosing means a child's dose is not a smaller guess of an adult one.$body$,
  body = $body$Children's medicine doses are typically calculated by weight, not simply scaled down from an adult dose by guesswork, which is why an accurate, reasonably current weight matters when a dose is being calculated.

Always use the dosing device that comes with a liquid medicine (an oral syringe or the specific cup provided) rather than a household spoon, which varies too much in actual volume to dose accurately.

Never give a child a medicine formulated for adults by simply giving a smaller amount: some medicines are genuinely unsuitable for children regardless of dose, and a proper children's formulation or prescription is the safe route.$body$
where code = 'med-childrens-dosing-safety';
update public.health_education_content set
  summary = $body$Most chronic-condition medicines work by staying at a steady level, not by a single dose.$body$,
  body = $body$Many chronic-condition medicines (for blood pressure, diabetes, and others) work by keeping a steady level in your body over time, not by a single dose doing all the work. Taking it inconsistently means the level rises and falls, which is often less effective than taking a slightly lower dose perfectly consistently.

This is also why you may feel completely fine and be tempted to stop: the medicine is often doing quiet, invisible work rather than treating a feeling. Stopping without guidance can undo months of steady progress quickly.

If a medicine is hard to remember, causes side effects, or simply feels like too much, tell your care team. There is almost always an adjustment available: the goal is a plan you can actually stick to, not a perfect one you can't.$body$
where code = 'med-consistency-matters';
update public.health_education_content set
  summary = $body$Every medicine, supplement, and regular over-the-counter product: the full picture matters.$body$,
  body = $body$Medicines, supplements, and even some foods can interact with each other, sometimes making one less effective, sometimes making a side effect more likely. Your care team can only check for this if they know your complete, current list: including anything from a pharmacy without a prescription, and any regular herbal or traditional remedy.

This is why it is worth updating your medicine list here whenever anything changes, even something that feels minor, like starting a vitamin or an occasional painkiller you use often.

When starting any new medicine, from any source, a quick check against your existing list is a simple, valuable habit: your pharmacist can usually do this check quickly if you are ever unsure.$body$
where code = 'med-drug-interactions';
update public.health_education_content set
  summary = $body$Same active ingredient, same effect, usually a lower price.$body$,
  body = $body$A generic medicine contains the same active ingredient, at the same dose, doing the same job as its brand-name equivalent: it is required to meet the same effectiveness and safety standards, not a lesser copy.

The price difference exists mainly because the brand covered the original research and marketing costs; once that exclusivity period ends, other manufacturers can produce the same medicine more cheaply.

Switching between a specific brand and its generic is usually fine, though for a small number of medicines with a narrow safety margin, your care team may prefer consistency: worth asking about for your specific prescriptions rather than assuming either way.$body$
where code = 'med-generic-vs-brand';
update public.health_education_content set
  summary = $body$The general rule, and why "just double up" is usually the wrong instinct.$body$,
  body = $body$Missing an occasional dose happens to almost everyone, and panicking is not necessary, but doubling up to "catch up" is usually the wrong instinct and can cause its own problems.

The general rule of thumb: if you remember soon after the missed time, take it as normal. If it is nearly time for your next dose, skip the missed one and continue your regular schedule: do not take two at once unless a professional has specifically told you to for that medicine.

This general rule does not apply to every medicine equally: some (like certain diabetes or blood-thinning medicines) have specific instructions that matter. If you are ever unsure for a specific medicine, ask your care team or pharmacist rather than guessing.$body$
where code = 'med-missed-dose';
update public.health_education_content set
  summary = $body$Some medicines are fine, some need adjusting, some need pausing: never assume, always ask.$body$,
  body = $body$Whether a medicine is safe during pregnancy or while breastfeeding varies a lot by the specific medicine: some are perfectly fine, some need a dose adjustment, and a smaller number need pausing or switching. There is no single safe blanket answer, which is exactly why this needs a specific check rather than a guess in either direction.

If you are pregnant, breastfeeding, or trying to conceive, tell your care team about every medicine you take, including regular over-the-counter ones, so each can be reviewed individually.

Do not stop a prescribed medicine on your own out of caution before checking: for some conditions, stopping abruptly is riskier than continuing under guidance, so the conversation should always come first.$body$
where code = 'med-pregnancy-breastfeeding';
update public.health_education_content set
  summary = $body$A gap in a chronic-condition medicine can undo weeks of steady control quickly.$body$,
  body = $body$A gap between finishing one supply and starting the next is one of the most common, avoidable reasons a chronic condition drifts out of control, and it often happens simply from being busy, not from any deliberate choice to stop.

Requesting a refill when you have roughly a week's supply left, rather than waiting until the last dose, builds in a buffer for any delay in getting the next batch.

If cost or access is the real barrier to refilling on time, say so to your care team directly rather than just going without: there are often options (different pack sizes, generic alternatives, payment plans) that are easier to arrange before a gap happens than after.$body$
where code = 'med-refills-avoiding-gap';
update public.health_education_content set
  summary = $body$The best reminder is the one tied to something you already do every day.$body$,
  body = $body$The most effective medicine reminders are usually not alarms on their own, they are tied to an existing daily habit: right after brushing your teeth, alongside breakfast, or when you plug in your phone at night. This is called "habit stacking," and it tends to outlast a generic alarm that gets dismissed on autopilot.

A pill organiser sorted by day (and time, if you take medicine more than once daily) makes it obvious at a glance whether today's dose was taken: useful for medicines taken far apart from any other routine.

Set reminders in the app for anything you are still building into a habit, and revisit them once the habit feels automatic rather than leaving every reminder running forever.$body$
where code = 'med-reminders-that-work';
update public.health_education_content set
  summary = $body$Mild and short-lived is common; severe or persistent deserves a call.$body$,
  body = $body$Many medicines cause mild, often temporary side effects as your body adjusts: some nausea, mild dizziness, or drowsiness in the first days or weeks is common and often settles on its own.

Worth reporting to your care team promptly rather than waiting: severe or worsening symptoms, anything affecting breathing or causing swelling of the face or throat, a rash, or any side effect significant enough that you are tempted to just stop taking the medicine quietly.

Stopping quietly is the outcome to avoid: telling your care team lets them adjust the dose, switch the medicine, or confirm the side effect is expected and likely to pass, rather than leaving your condition unmanaged.$body$
where code = 'med-side-effects-normal-vs-report';
update public.health_education_content set
  summary = $body$Heat and humidity, both common here, can quietly reduce how well a medicine works.$body$,
  body = $body$Most medicines are formulated to be stored at room temperature, away from direct heat, humidity and sunlight: conditions that are genuinely harder to guarantee in a hot, humid climate than the label sometimes assumes.

Avoid storing medicine in a bathroom (humidity), a car, or anywhere near direct sun or a stove: heat and moisture can degrade some medicines faster than their printed expiry date would suggest, without any visible change in appearance.

Some medicines (certain insulins, for example) specifically require refrigeration: always check the label or ask your pharmacist rather than assuming standard storage applies.$body$
where code = 'med-storage';
update public.health_education_content set
  summary = $body$Many are safe on their own: the risk is usually in combination, not the remedy itself.$body$,
  body = $body$Traditional and herbal remedies are common alongside prescribed medicine, and many carry a long history of safe use, but "natural" does not automatically mean "no interaction with your prescribed medicine." Some herbal preparations genuinely affect how prescribed medicines are absorbed or broken down by the body.

This is not about discouraging traditional remedies: it is about your care team being able to check for interactions the same way they would for any other product, which they can only do if they know about it.

Mention any herbal or traditional remedy you take regularly, the same way you would a supplement or an over-the-counter medicine: it is a normal, judgement-free part of building your full medicine picture.$body$
where code = 'med-traditional-herbal-remedies';
update public.health_education_content set
  summary = $body$A little preparation avoids a stressful gap far from home.$body$,
  body = $body$Travelling, especially by air, deserves a little medicine preparation. Keep medicines in their original, labelled packaging where possible, and carry essential daily medicines in hand luggage rather than checked baggage, in case luggage is delayed.

Pack a few days' extra supply beyond your planned trip length, in case of delays: running short far from your usual pharmacy is a genuinely stressful situation worth avoiding in advance.

For international travel, especially with certain medicines (some pain, sleep or anxiety medicines have specific rules in different countries), it is worth checking destination-specific requirements ahead of time rather than discovering an issue at the airport.$body$
where code = 'med-travelling-with-medicines';
update public.health_education_content set
  summary = $body$Decoding the shorthand your pharmacist writes.$body$,
  body = $body$Prescription labels often use shorthand that can look cryptic at first. Common ones: "OD" means once daily, "BD" or "BID" means twice daily, "TDS" or "TID" means three times daily, "PRN" means as needed rather than on a fixed schedule, and "PO" means by mouth.

The label also usually specifies timing relative to food ("with food," "on an empty stomach"): this is not a minor detail; it can significantly affect how well some medicines are absorbed or how likely they are to cause stomach upset.

If anything on your label is unclear, ask your pharmacist to explain it in plain terms before you leave: this is one of the most normal, expected questions a pharmacist handles.$body$
where code = 'med-understanding-prescription-label';
update public.health_education_content set
  summary = $body$Some medicines are meant to be finished; others are meant to continue indefinitely.$body$,
  body = $body$Some medicines (most antibiotics are the clearest example) are meant to be taken for the full prescribed course even after you feel better, because stopping early can let the underlying infection return, sometimes more resistant to treatment.

Other medicines, particularly for chronic conditions like high blood pressure or diabetes, are generally meant to continue indefinitely, or until your care team specifically changes the plan: feeling fine is often a sign the medicine is working, not a sign it is no longer needed.

The safe general rule: never stop a prescribed medicine based on how you feel alone. If you want to stop or reduce something, that is a completely reasonable thing to discuss with your care team: just discuss it first.$body$
where code = 'med-when-safe-to-stop';
update public.health_education_content set
  summary = $body$A common, treatable issue that can also be useful early information about heart health.$body$,
  body = $body$Erectile dysfunction (ED) is common, especially with age, and very treatable, but it is worth knowing it can also be an early signal of cardiovascular issues, since the small blood vessels involved are often affected before larger ones show symptoms elsewhere.

This is genuinely useful information rather than something to be alarmed by: if ED shows up, especially in a younger man or alongside other risk factors, it is a reasonable prompt to check blood pressure, cholesterol and blood sugar, catching a cardiovascular issue earlier than it might otherwise be found.

ED is a completely normal, common thing to bring up with your care team: it is one of the more effectively treated conditions in medicine, with several options depending on the cause.$body$
where code = 'men-erectile-dysfunction-signal';
update public.health_education_content set
  summary = $body$Sperm health is affected by more everyday factors than most people expect.$body$,
  body = $body$Male fertility factors are involved in a substantial share of couples' difficulty conceiving, yet get discussed far less than female fertility factors. Sperm production is affected by everyday things: heat exposure (frequent hot baths, laptops on the lap), smoking, heavy alcohol use, certain medicines, weight, and some health conditions.

A semen analysis is a straightforward, non-invasive first test if a couple has been trying to conceive without success, and is a reasonable thing to check alongside, not instead of, female fertility evaluation.

Many male fertility factors are treatable or improvable with lifestyle changes or medical treatment once identified: it is worth a proper evaluation rather than assuming nothing can be done.$body$
where code = 'men-fertility-basics';
update public.health_education_content set
  summary = $body$Most male hair loss is genetic pattern baldness: common, and not usually a sign of illness.$body$,
  body = $body$Most hair loss in men follows a predictable pattern (receding hairline, thinning crown) driven by genetics and hormones: extremely common, and not a sign of an underlying illness on its own.

Worth mentioning to your care team: sudden, patchy hair loss (rather than gradual thinning), hair loss alongside other symptoms like fatigue or weight changes, or hair loss that starts unusually early and rapidly. These patterns are less typical of standard pattern baldness and are worth a proper look.

Several treatments exist for standard pattern hair loss if it bothers you, ranging in effectiveness: a reasonable, low-stakes conversation to have with your care team if you are interested.$body$
where code = 'men-hair-loss-normal-vs-medical';
update public.health_education_content set
  summary = $body$On average, cardiovascular risk rises earlier in men: worth knowing, not worth fearing.$body$,
  body = $body$On average, men tend to develop cardiovascular risk factors and heart disease earlier in life than women, who are relatively protected until after menopause by hormonal factors, though the gap narrows with age, and heart disease remains a leading cause of death for both.

This is a reason for men to take blood pressure, cholesterol and blood sugar screening seriously from a somewhat earlier age, not a reason for alarm: the same well-understood, manageable factors (diet, movement, smoking, weight, medicine when needed) apply.

If heart disease runs in your family, particularly a father or brother diagnosed relatively young, mention it to your care team: it may reasonably shift how early or how closely you are screened.$body$
where code = 'men-heart-risk-earlier';
update public.health_education_content set
  summary = $body$A bulge that appears with straining is a common, fixable issue worth not ignoring.$body$,
  body = $body$A hernia happens when tissue pushes through a weak spot in the abdominal wall, often showing as a bulge in the groin or abdomen that becomes more noticeable when straining, lifting, or coughing, and may ease when lying down.

Most hernias are uncomfortable rather than dangerous, but they do not fix themselves and generally need a procedure eventually if they are causing symptoms.

A hernia that suddenly becomes very painful, firm, and will not push back in (sometimes with nausea or vomiting) can mean the tissue has become trapped, which is a genuine emergency needing immediate care, not a routine appointment. A straightforward, non-urgent hernia is still worth getting evaluated rather than living around indefinitely.$body$
where code = 'men-hernia-signs';
update public.health_education_content set
  summary = $body$Men report distress less often, which doesn't mean they experience it less.$body$,
  body = $body$Men are, on average, diagnosed with depression and anxiety less often than women, but this gap reflects underreporting more than a real difference in how often these conditions occur. Symptoms in men also sometimes look different: irritability, anger, or physical complaints rather than sadness, which can make them harder to recognise as mental health symptoms at all.

The practical cost of underreporting is real: delayed treatment, and higher rates of the most serious outcomes among men who do struggle.

Mentioning persistent low mood, irritability, loss of interest in things you normally enjoy, or difficulty coping to your care team is exactly the kind of thing worth raising: it is treated with the same seriousness and privacy as any physical symptom.$body$
where code = 'men-mental-health-underreporting';
update public.health_education_content set
  summary = $body$Men attend routine check-ups less often, and it shows up in outcomes.$body$,
  body = $body$Men are, on average, less likely to attend routine check-ups and screenings than women, and less likely to seek care early when something feels wrong: a pattern that contributes to men being diagnosed later, on average, across several conditions.

There is no single reason, but common ones include feeling fine so seeing no urgency, discomfort discussing symptoms, or simply not having a routine built around it.

The fix is mostly structural rather than about willpower: building a habit around your screening calendar here, the same way you would for a car service, turns "I should probably get that checked sometime" into something that actually happens on schedule.$body$
where code = 'men-preventive-care-gap';
update public.health_education_content set
  summary = $body$An enlarged prostate is common with age and usually not cancer, but the symptoms overlap.$body$,
  body = $body$The prostate commonly enlarges with age, a condition called BPH (benign prostatic hyperplasia), which is not cancer, though it can cause bothersome urinary symptoms: a weaker stream, frequent urination (especially at night), or a sense of incomplete emptying.

Prostate cancer can cause similar urinary symptoms, or none at all in its earlier stages, which is exactly why symptoms alone cannot reliably tell the two apart: a proper evaluation is what does.

If you are noticing new or worsening urinary symptoms, mention them to your care team rather than assuming it is "just age": the evaluation is straightforward and the vast majority of the time, the explanation is the benign one.$body$
where code = 'men-prostate-basics';
update public.health_education_content set
  summary = $body$What it measures, and why a raised result needs context, not panic.$body$,
  body = $body$PSA (prostate-specific antigen) is a protein the prostate produces; a blood test measures its level. It can be raised by prostate cancer, but also by BPH, prostatitis (inflammation), recent ejaculation, or even a recent bike ride or exam: so a single raised result needs context and often a repeat test, not an immediate alarm.

Whether to have PSA testing at all is a personal decision your care team should walk you through, since it carries genuine trade-offs, not just benefits.

If your result comes back raised, your care team will explain what it likely means for you specifically and what, if anything, happens next: most raised results do not turn out to be cancer.$body$
where code = 'men-psa-test-explained';
update public.health_education_content set
  summary = $body$A quick monthly habit that catches one of the most treatable cancers early.$body$,
  body = $body$Testicular cancer is relatively rare but is one of the most treatable cancers when caught early, and it tends to affect younger men more than most cancers do, which makes early awareness particularly worthwhile in this age group.

A simple monthly check, ideally after a warm shower when tissue is relaxed, involves gently feeling each testicle for any new lump, hardness, or change in size or texture compared to what feels normal for you. A little size difference between the two sides is normal; a new, distinct lump is what to note.

If you notice something new, mention it to your care team promptly rather than waiting: most findings are not cancer, but the ones that are respond very well to early treatment.$body$
where code = 'men-testicular-self-exam';
update public.health_education_content set
  summary = $body$What it actually does, and why "low T" symptoms often have other explanations.$body$,
  body = $body$Testosterone naturally declines gradually with age, but the dramatic "low T" symptoms attributed to it in some marketing (fatigue, low mood, reduced muscle) often have other, more common explanations: poor sleep, stress, weight changes, or other health conditions.

A genuinely low testosterone level is diagnosed with a proper blood test, ideally morning, sometimes repeated, not from a symptom checklist alone, since the symptoms overlap heavily with several other common conditions.

If you are concerned, ask your care team for a proper evaluation rather than starting supplements or treatments on your own: inappropriate testosterone use carries real risks and is not something to self-manage.$body$
where code = 'men-testosterone-myths';
update public.health_education_content set
  summary = $body$Muscle mass declines from the 30s onward unless actively maintained: a different problem than weight alone.$body$,
  body = $body$From around the 30s onward, muscle mass gradually declines unless it is actively maintained: a separate issue from body weight, since it is possible for weight to stay stable while muscle quietly gives way to fat over years.

This matters beyond appearance: muscle supports metabolism, blood sugar control, and physical independence later in life. Resistance exercise (bodyweight work, weights, resistance bands) two to three times a week, alongside adequate protein, is what specifically counters this, more than cardio alone.

It is never too late to start: muscle responds to training at any age, and the health benefits (including for blood sugar and joint support) show up relatively quickly once a routine sticks.$body$
where code = 'men-weight-muscle-balance';
update public.health_education_content set
  summary = $body$Racing heart, tight chest, restlessness: the physical side of a very real response.$body$,
  body = $body$Anxiety is not "just in your head". It is a real physical response: your body releases stress hormones that raise heart rate, tighten muscles, and sharpen alertness, the same system that once helped humans respond to danger.

Occasional anxiety before something stressful is normal and even useful. It becomes worth addressing when it is frequent, hard to control, or is interfering with sleep, work, or relationships: that pattern is what your care team looks for, not the presence of anxiety at all.

Anxiety disorders are common and very treatable, through therapy, practical coping skills, medicine, or a combination: there is no single "right" treatment, only what fits you.$body$
where code = 'mh-anxiety-explained';
update public.health_education_content set
  summary = $body$Connection is not a nice extra: it is a genuine, evidence-backed part of mental health.$body$,
  body = $body$Social connection is not just a pleasant add-on to mental health treatment: people with stronger support networks measurably recover faster and cope better with both mental and physical health challenges.

A support network does not need to be large. A few people you can genuinely be honest with, a community or faith group, or a support group of people managing something similar, all count and each serves a slightly different purpose.

If you feel you do not have this right now, that is common, especially after a move, a loss, or a long period of managing health challenges, and it is a reasonable thing to build deliberately, including with your care team's support, rather than something you either have or don't.$body$
where code = 'mh-building-support-network';
update public.health_education_content set
  summary = $body$Children express distress differently than adults do: often through behaviour, not words.$body$,
  body = $body$Children, especially younger ones, often cannot name what they are feeling the way an adult can, so distress tends to show up as behaviour instead: withdrawal, irritability, changes in sleep or appetite, regression to younger behaviours, drop in school performance, or physical complaints (stomach aches, headaches) with no clear physical cause.

Some of this is a normal part of growing up and passes on its own. What is worth a proper conversation with your care team: a pattern lasting several weeks, a change that followed a specific event (a loss, a house move, bullying), or anything affecting school or friendships significantly.

Children respond very well to support when it comes early: noticing and naming the pattern is the hardest and most important first step.$body$
where code = 'mh-childrens-mental-health';
update public.health_education_content set
  summary = $body$Living with a long-term condition affects mental health, and mental health affects how well the condition is managed.$body$,
  body = $body$Living with a chronic condition like diabetes or hypertension carries a real emotional load: some people describe fatigue with the constant management ("burnout"), and rates of anxiety and depression are measurably higher among people managing a chronic condition than the general population.

This matters clinically, not just personally: mental health struggles make it harder to keep up with medicines, appointments and healthy habits, which in turn affects the physical condition. The two are genuinely linked, not separate boxes.

This is exactly why your care team asks about mood and coping alongside your physical numbers. If chronic illness management feels overwhelming, that is worth naming directly, not just pushing through quietly.$body$
where code = 'mh-chronic-illness-link';
update public.health_education_content set
  summary = $body$A few practical techniques that work in the moment, not just in theory.$body$,
  body = $body$A few grounding techniques genuinely help in an anxious moment, and are worth practising when calm so they are easier to use when you need them.

Slow breathing, in for four counts, hold for four, out for six, is one that helps: the longer exhale specifically signals your body to calm down. The 5-4-3-2-1 technique: name five things you can see, four you can touch, three you can hear, two you can smell, one you can taste. It interrupts spiralling thoughts by anchoring attention in the present. Physical movement, even brief, helps discharge the stress-hormone response your body has already triggered.

These ease a moment; they are not a substitute for addressing anxiety that is frequent or significant: that is worth raising with your care team.$body$
where code = 'mh-coping-skills-anxious-moments';
update public.health_education_content set
  summary = $body$Low mood is one symptom among several, and some people barely notice it at all.$body$,
  body = $body$Depression is often pictured as constant sadness, but it commonly shows up differently: low energy, loss of interest in things you used to enjoy, changes in sleep or appetite, difficulty concentrating, or feeling persistently flat rather than actively sad.

It is different from a bad week or ordinary low mood by duration and impact: lasting most of the day, most days, for two weeks or more, and affecting daily functioning.

Depression is a common, medical, treatable condition, not a personal failing or something to "snap out of." If this sounds familiar, mention it to your care team: the earlier it is addressed, the more options tend to be available.$body$
where code = 'mh-depression-more-than-sad';
update public.health_education_content set
  summary = $body$Grief is not linear, and there is no fixed schedule for when it should end.$body$,
  body = $body$Grief after losing someone (or something significant: a relationship, a role, your health as it was) does not follow the tidy stages sometimes described. It is common to feel it come in waves, long after people expect you to have "moved on," and to feel a confusing mix of emotions at once.

There is no fixed timeline, and needing support months or even years later is not a sign that something is wrong with how you are grieving.

What is worth raising with your care team: grief that feels stuck without any movement over a long period, or that comes with thoughts of harming yourself. Support, whether from people around you or a professional, is appropriate at any point in the process, not only right after a loss.$body$
where code = 'mh-grief-no-normal-timeline';
update public.health_education_content set
  summary = $body$Beyond "baby blues": recognising when a new parent needs more support.$body$,
  body = $body$"Baby blues" (brief mood dips in the first couple of weeks after birth) are common and usually pass on their own. Postpartum depression and anxiety are different: more intense, lasting beyond two weeks, and can affect either parent, not only the birthing parent.

Signs worth taking seriously: persistent sadness or anxiety, difficulty bonding with the baby, feeling unable to cope, or intrusive frightening thoughts. These are common, treatable, and not a reflection of poor parenting, but they are easy to miss or dismiss as normal exhaustion.

Family members are often the first to notice, since the person experiencing it may not recognise it themselves. Gently encouraging them to speak to their care team is genuinely one of the most helpful things you can do.$body$
where code = 'mh-postnatal-awareness';
update public.health_education_content set
  summary = $body$Poor sleep worsens mental health, and poor mental health worsens sleep: breaking the cycle from either side helps.$body$,
  body = $body$Sleep and mental health influence each other in both directions: poor sleep makes anxiety and low mood measurably worse, and anxiety or low mood, in turn, make sleep harder to get, a cycle that can feel impossible to interrupt from inside it.

The useful news is that you can work on this from either direction: improving sleep habits often eases mood and anxiety symptoms somewhat, even before other treatment takes full effect, and treating the underlying mental health concern often improves sleep in turn.

A consistent sleep and wake time, limiting screens before bed, and cutting evening caffeine are small, real starting points either way.$body$
where code = 'mh-sleep-mental-health-link';
update public.health_education_content set
  summary = $body$Related, but different, and the useful response differs for each.$body$,
  body = $body$These three overlap but are not the same thing. Stress is a response to a specific pressure (a deadline, a bill, a difficult conversation) that usually eases once the pressure lifts. Anxiety can persist even without a clear, specific cause, and often comes with physical symptoms like a racing heart or tight chest. Burnout is a specific kind of exhaustion from prolonged, unrelenting stress (usually tied to work or caregiving) marked by depletion, cynicism, and reduced sense of accomplishment.

Knowing which one you are experiencing helps: stress often responds to addressing the specific pressure; anxiety often benefits from coping skills or treatment; burnout usually needs a genuine reduction in load, not just better coping.

If you are not sure which applies to you, that is a reasonable thing to bring to your care team rather than figuring out alone.$body$
where code = 'mh-stress-anxiety-burnout';
update public.health_education_content set
  summary = $body$Using alcohol or other substances to cope is common, and worth addressing directly.$body$,
  body = $body$It is common to reach for alcohol or other substances to manage difficult feelings, and just as common not to notice how much that has become the main coping strategy. In the short term it can seem to help; over time it usually worsens the underlying anxiety or low mood, and can create a second problem alongside the first.

This is not about judgement: it is a genuinely common overlap, and one your care team is equipped to help with directly and without stigma, treating both together rather than requiring one to be solved before addressing the other.

If you have noticed yourself using alcohol or anything else specifically to cope with difficult emotions, that pattern itself is worth mentioning, even before it feels like "a problem."$body$
where code = 'mh-substance-use-overlap';
update public.health_education_content set
  summary = $body$What genuinely helps, and the trap of trying to "fix" it.$body$,
  body = $body$Watching someone you love struggle is hard, and the instinct to fix it quickly is natural, but what usually helps most is simpler and slower: listening without immediately problem-solving, letting them know you are available without pressuring them to talk, and gently encouraging professional support rather than trying to be their only source of help.

Avoid minimising ("just think positive") or comparing to others' struggles: even well-meant, these tend to make someone feel more alone, not less.

Supporting someone else is genuinely draining too. Looking after your own wellbeing while supporting them is not selfish: it is what makes sustained support possible at all.$body$
where code = 'mh-supporting-family-member';
update public.health_education_content set
  summary = $body$It is treated with the same seriousness and privacy as any physical symptom.$body$,
  body = $body$Bringing up a mental health concern can feel harder than describing a physical one, but your care team treats it with exactly the same seriousness, privacy, and lack of judgement.

You do not need the "right" words or a clear diagnosis in mind: describing what you have noticed (sleep changes, low energy, persistent worry, mood shifts) is enough to start the conversation. It is also fine to write it down beforehand if that feels easier than saying it out loud.

What happens next varies by what you are experiencing (sometimes a conversation and coping strategies, sometimes a referral, sometimes medicine) but it starts with simply raising it, which is very often the hardest part.$body$
where code = 'mh-talking-to-care-team';
update public.health_education_content set
  summary = $body$You do not need to hit a crisis point before reaching out.$body$,
  body = $body$There is a common misconception that mental health support is only for a crisis. In reality, the earlier you reach out, the more options are usually available, and the easier things tend to be to address.

Signs worth acting on: feelings that are affecting your work, relationships, or daily functioning; symptoms lasting more than two weeks; using alcohol or other substances to cope; withdrawing from people you would normally connect with; or simply a persistent sense that something is not right, even without a clear label for it.

Any thought of harming yourself is always worth immediate attention: reach out to your care team or emergency services right away, not later.$body$
where code = 'mh-when-to-seek-help';
update public.health_education_content set
  summary = $body$Alcoholic drinks carry real calories that are easy to overlook.$body$,
  body = $body$Alcoholic drinks carry meaningful calories: beer, wine and spirits all contribute, often more than people account for when thinking about their overall eating pattern, since drinks are rarely tracked the way food is.

Beyond calories, alcohol also tends to lower inhibition around other food choices later in the same evening, and interferes with sleep quality even when it does not feel like it at the time.

This is not about eliminating alcohol: it is about being aware it is part of the overall picture, the same as any other calorie source, and factoring it in rather than treating it as separate from "what I ate today."$body$
where code = 'nutrition-alcohol-hidden-calories';
update public.health_education_content set
  summary = $body$A simple visual guide that works with any cuisine, including everyday Nigerian meals.$body$,
  body = $body$You do not need to weigh food to eat a balanced meal: picturing your plate in proportions works just as well. Roughly half non-starchy vegetables (greens, okra, garden egg, cabbage), a quarter protein (fish, chicken, beans, eggs), and a quarter starch (rice, yam, swallow, bread, plantain).

Most everyday plates lean heavily toward the starch quarter: that is usually the easiest place to make room for more vegetables and protein without feeling like you are dieting.

This is a flexible guide, not a rigid rule: the goal across a week is the general pattern, not perfection at every single meal.$body$
where code = 'nutrition-balanced-plate';
update public.health_education_content set
  summary = $body$What actually works, and the pressure tactics that tend to backfire.$body$,
  body = $body$Children's eating habits form early and tend to stick, but pressure and bribery ("finish your vegetables to get dessert") often backfire, teaching a child to see vegetables as a chore and dessert as the real prize.

What tends to work better is regularly offering a variety of foods without forcing them (repeated exposure, even without eating, increases familiarity and eventual acceptance), involving children in simple food preparation, and eating the same foods together as a family rather than preparing separate "children's meals."

It is normal for children to reject a new food multiple times before accepting it: persistence without pressure, over weeks, tends to work far better than a single mealtime battle.$body$
where code = 'nutrition-childrens-habits';
update public.health_education_content set
  summary = $body$The amount you use usually matters more than which specific oil you choose.$body$,
  body = $body$Different cooking oils have somewhat different fat profiles, but for most home cooking, how much oil you use matters more than exactly which oil you choose. Measuring or being mindful of oil quantity, rather than pouring freely, is the highest-impact single change.

Reusing oil for frying multiple times, especially at high heat, breaks it down and creates compounds worth avoiding: freshly used oil, in reasonable amounts, is the better default over heavily reused oil.

Unrefined oils used in moderation (groundnut, olive where available) are a reasonable everyday choice; the goal is moderate, mindful use rather than eliminating oil or fixating on finding one "perfect" type.$body$
where code = 'nutrition-cooking-oils';
update public.health_education_content set
  summary = $body$Structure, not willpower, is what keeps eating on track away from home.$body$,
  body = $body$Eating well away from your normal routine is harder mainly because the structure that usually supports good choices disappears: no fridge of familiar food, less control over what is available, different schedules.

A few things that genuinely help: carrying a simple snack (nuts, fruit) so hunger does not force a rushed, less considered choice; scanning a menu for the vegetable and protein options first before deciding; and not treating one less-than-ideal meal as a reason to abandon the rest of the day or trip.

Consistency across most days and most trips is what actually matters for your health numbers, not a perfect record with no exceptions.$body$
where code = 'nutrition-eating-while-travelling';
update public.health_education_content set
  summary = $body$Whether for faith or other reasons, a few practical steps make fasting safer.$body$,
  body = $body$Many people fast for religious reasons at points in the year, and fasting is generally safe for healthy adults with a few sensible precautions, though anyone managing a chronic condition, pregnant, or on regular medicine should talk to their care team beforehand, since fasting can genuinely change medicine timing and dosing needs.

Practical tips for those who can fast safely: prioritise hydration and a balanced meal at the times you do eat rather than making up for the day with very heavy or very sugary meals, and break a fast gradually rather than with a large sudden meal, which can cause discomfort.

If you have diabetes, low blood pressure, or another condition affected by fasting, this is exactly the kind of plan your care team can help you adjust safely, rather than skipping medicine or your usual monitoring during the fasting period.$body$
where code = 'nutrition-fasting-practices';
update public.health_education_content set
  summary = $body$It slows sugar absorption, feeds healthy gut bacteria, and keeps you full.$body$,
  body = $body$Fibre, found in vegetables, fruit, beans, and wholegrains, does more work than most people realise: it slows how quickly sugar enters the bloodstream (helpful for blood sugar control), feeds beneficial gut bacteria, supports regular digestion, and helps you feel full for longer at the same number of calories.

Most people eat noticeably less fibre than is genuinely beneficial. Easy ways to add more: beans a few times a week, vegetables at most meals rather than as an afterthought, and choosing less-refined starches (unripe plantain, wholegrain where available) over their more refined equivalents.

Increase fibre gradually rather than all at once: a sudden large jump can cause temporary bloating that easing in avoids.$body$
where code = 'nutrition-fibre-matters';
update public.health_education_content set
  summary = $body$Not all fat is equal: the type matters more than the total amount for most people.$body$,
  body = $body$Fat has been unfairly treated as universally bad in the past: the type of fat matters more than simply the amount for most health outcomes.

Fats worth favouring are those in fish, groundnuts, avocado, and unrefined vegetable oils used in moderation: these support heart health. Fats worth limiting: those in fried food, processed snacks, and some margarines and shortenings, which are more strongly linked to raised cholesterol and heart risk.

A practical swap that helps most: choosing grilled or boiled over deep-fried more often, and using oil more sparingly rather than eliminating it. Small, sustained changes here move cholesterol more reliably than an all-or-nothing approach.$body$
where code = 'nutrition-healthy-fats';
update public.health_education_content set
  summary = $body$Most excess sugar comes from drinks and processed food, not the sugar bowl.$body$,
  body = $body$Added sugar adds up fastest through drinks: soft drinks, sweetened juice, malt drinks, and sweetened tea or coffee can each carry a surprising amount, often without feeling like "eating sugar" at all since they are liquid.

It also hides in places that do not taste overtly sweet: bread, sauces, flavoured yoghurt, and some seasoning blends can all carry added sugar you would not necessarily expect.

The single highest-impact change for most people is cutting sweetened drinks specifically: swapping even one sugary drink a day for water is often a bigger change than several smaller food tweaks combined.$body$
where code = 'nutrition-hidden-sugar';
update public.health_education_content set
  summary = $body$The "8 glasses" rule is a rough guide, not a strict requirement, and food counts too.$body$,
  body = $body$The commonly quoted "eight glasses a day" is a reasonable rough guide, not a precise medical requirement: actual needs vary by body size, activity, climate, and what else you eat and drink, since food (especially fruit, vegetables and soup) also contributes meaningfully to hydration.

A simple, practical check: pale yellow urine generally suggests you are adequately hydrated; noticeably dark urine is a reasonable sign to drink more, especially in hot weather or after activity.

Water is the best default choice: it hydrates without adding sugar or calories, unlike many other drinks that people reach for out of habit rather than actual thirst.$body$
where code = 'nutrition-hydration-how-much';
update public.health_education_content set
  summary = $body$Eating well and spending less are not opposites: a few habits make both easier.$body$,
  body = $body$Eating well on a limited budget is genuinely achievable with a few habits. Beans, eggs and locally grown vegetables are typically among the most affordable, nutrient-dense options available, and hold their own against far more expensive alternatives.

Buying and cooking in slightly larger batches, then portioning for a few days, saves both time and money compared to cooking small amounts repeatedly. Seasonal, local produce is usually cheaper and fresher than imported or out-of-season alternatives.

Planning a few meals ahead, even loosely, reduces the last-minute takeout or processed-food purchases that tend to cost more per meal than home cooking, healthy or not.$body$
where code = 'nutrition-meal-prep-budget';
update public.health_education_content set
  summary = $body$Your hand is a surprisingly reliable, always-available measuring tool.$body$,
  body = $body$You do not need a kitchen scale to eat sensible portions: your own hand offers a rough, practical guide that travels with you everywhere. A portion of protein is roughly the size and thickness of your palm. A portion of starch (rice, yam, swallow) is roughly a cupped handful. A portion of fat (oil, groundnut) is roughly a thumb's worth. Vegetables, generally, are the one category to serve generously without much concern.

This is a rough guide, not a precise science: it is meant to build a general sense of proportion over time, useful especially when eating away from home where weighing is not an option.

Use it as a starting reference, then trust the sense of scale it builds after a few weeks of noticing.$body$
where code = 'nutrition-portion-sizes-no-scale';
update public.health_education_content set
  summary = $body$Beans, fish, eggs and chicken all count, and most people need less than the marketing suggests.$body$,
  body = $body$Protein needs are generally more modest than fitness marketing often implies for most people, though needs are somewhat higher for older adults, and for anyone doing regular strength training.

Good sources, several of them budget-friendly: beans and legumes, eggs, fish, chicken, and moi moi. Spreading protein across meals through the day, rather than concentrating it all at dinner, tends to be more effective for muscle maintenance and fullness.

You do not need protein powders or supplements to meet your needs: whole food sources cover it well for the vast majority of people, and are typically both cheaper and more filling.$body$
where code = 'nutrition-protein-how-much';
update public.health_education_content set
  summary = $body$The three things worth checking, and the rest you can mostly ignore.$body$,
  body = $body$Food labels can feel overwhelming with dozens of numbers. Three things are worth actually checking: serving size (numbers below it are often per small serving, not the whole pack, easy to underestimate), added sugar (look for it listed directly, or ingredients like syrup, glucose, sucrose high on the ingredient list), and sodium (salt) content, especially for processed and packaged food.

Ingredients are listed by quantity, largest first, if sugar or oil appears in the first three ingredients, that tells you a lot quickly without reading the whole label.

You do not need to analyse every label for every purchase: learning your regular items once is usually enough to guide better choices going forward.$body$
where code = 'nutrition-reading-food-labels';
update public.health_education_content set
  summary = $body$You do not need to avoid eating out: a few swaps make a real difference.$body$,
  body = $body$Eating out does not have to mean abandoning healthy habits. A few swaps make a real difference without requiring you to avoid your favourite spots: choosing grilled, boiled, or roasted over deep-fried where available; asking for stew or sauce on the side so you control how much you add; and choosing water or an unsweetened drink over a sweetened one.

Portion sizes at many food spots are often larger than a typical home serving: sharing, or simply not finishing everything served, is a reasonable and normal choice, not wasteful.

The goal is making eating out compatible with your health, not off-limits: most people eat out sometimes, and that is entirely fine within an otherwise balanced pattern.$body$
where code = 'nutrition-street-food-eating-out';
update public.health_education_content set
  summary = $body$Most people get what they need from food: a few situations genuinely call for more.$body$,
  body = $body$For most healthy adults eating a varied diet, a general multivitamin adds little benefit: the nutrients are usually already covered by food, and supplements are not a substitute for an unbalanced diet.

That said, some situations genuinely benefit from a specific supplement: folic acid before and during early pregnancy, vitamin D if you get very little sun exposure, iron if you have been diagnosed with iron-deficiency anaemia, or specific supplements your care team recommends for a particular condition.

The useful rule: a targeted supplement for an identified need, based on your care team's advice or a blood test, rather than a general "just in case" habit with no specific reason behind it.$body$
where code = 'nutrition-vitamins-supplements';
update public.health_education_content set
  summary = $body$It is a starting point for a conversation, not a verdict on your health.$body$,
  body = $body$BMI (body mass index) is a simple calculation from height and weight, useful as a quick population-level screening tool, but it has real limitations for any individual: it does not distinguish muscle from fat, and does not directly measure where fat is distributed, which matters for health risk.

A very muscular person can have a "high" BMI without excess fat; body composition and distribution (particularly abdominal fat) often tell a more complete story than BMI alone.

Your care team uses BMI as one input among several, not a standalone verdict: waist measurement, blood pressure, blood sugar and cholesterol together give a much fuller picture of your actual health than any single number.$body$
where code = 'ob-bmi-limitations';
update public.health_education_content set
  summary = $body$How this conversation happens matters enormously for a child's lifelong relationship with food.$body$,
  body = $body$Childhood weight is a sensitive, important topic: handled well, it protects a child's health without damaging their relationship with food or their body; handled carelessly, it can cause lasting harm even with good intentions behind it.

What generally helps: focusing conversations on health behaviours (family meals, active play, sleep) rather than weight or appearance directly, avoiding comparisons to other children, and modelling the habits you want to encourage rather than only instructing.

If you have concerns about a child's growth, that is a conversation for your care team, who track growth against appropriate charts over time, not something to address through comments about food or body at home, which tend to backfire.$body$
where code = 'ob-childhood-weight';
update public.health_education_content set
  summary = $body$A genuine medical tool for some people, alongside habits, not a replacement for them.$body$,
  body = $body$Newer weight-loss medicines work mainly by affecting appetite and fullness signals, helping many people eat less without constant hunger driving against them: a real, medically legitimate tool for some people, not a shortcut or a moral shortcoming to need.

They are prescribed based on specific criteria (not simply on request), typically alongside continued attention to diet and activity, not instead of them: the habits still matter for the results to hold.

Like any medicine, they carry side effects and considerations specific to your health history, so this is a conversation to have directly with your care team about whether you are a suitable candidate, not a decision to make from general information alone.$body$
where code = 'ob-weight-loss-medicines-explained';
update public.health_education_content set
  summary = $body$You deserve care that treats your actual concern, not just your weight.$body$,
  body = $body$Weight stigma (having every health concern attributed to weight regardless of what you actually came in for) is a real, documented problem in healthcare, and it causes real harm: people delay care to avoid it, and genuine health issues sometimes get missed.

Good weight-inclusive care means your actual symptom or concern gets properly evaluated on its own terms, with weight addressed only when it is genuinely relevant to what you are asking about, not defaulted to as the explanation for everything.

If you feel a concern was dismissed or attributed to weight without a proper look, it is entirely reasonable to ask directly for that specific concern to be evaluated, or to raise it with your care team as feedback.$body$
where code = 'ob-weight-stigma-healthcare';
update public.health_education_content set
  summary = $body$A simple traffic-light system that turns "how am I doing" into a clear decision.$body$,
  body = $body$An asthma action plan is a simple written guide, usually built with your care team, that uses a traffic-light system so you always know what to do next.

Green means your usual, well-controlled self: continue your regular preventer as prescribed. Yellow means symptoms are creeping up (more coughing, tightness, or needing your reliever more often) and usually means a temporary step-up in treatment, following the specific instructions your care team gave you. Red means a serious flare (severe breathlessness, reliever not helping, difficulty speaking in full sentences) and means urgent or emergency care, not waiting it out.

If you do not have a written action plan yet, ask your care team for one. It turns a stressful moment into a clear, rehearsed decision.$body$
where code = 'resp-asthma-action-plan';
update public.health_education_content set
  summary = $body$Well-controlled asthma should not mean avoiding exercise: often the opposite.$body$,
  body = $body$Exercise can trigger symptoms in some people with asthma, which sometimes leads to avoiding activity altogether, but that usually makes overall fitness and even asthma control worse over time, not better.

For most people, well-controlled asthma and regular exercise are entirely compatible. A few adjustments help: warming up gradually, using a reliever beforehand if your care team has advised it for exercise-triggered symptoms, and choosing activities with brief bursts and recovery (like football or swimming) if continuous cardio brings on symptoms more.

If exercise reliably triggers significant symptoms despite these steps, that is worth discussing with your care team directly: it often means your everyday asthma control needs adjusting, not that exercise should be avoided.$body$
where code = 'resp-asthma-exercise';
update public.health_education_content set
  summary = $body$Why airways narrow, and why that means both quick relief and longer-term control matter.$body$,
  body = $body$Asthma is a condition where the airways become inflamed and can narrow suddenly, making it harder to breathe. Two things are typically happening: ongoing, lower-grade inflammation in the airway lining, and episodes where the airway muscles tighten further, called a flare or attack.

This is why asthma treatment usually involves two different jobs: a reliever inhaler that quickly opens narrowed airways during a flare, and, for many people, a preventer inhaler taken daily that calms the underlying inflammation so flares happen less often.

Using only the reliever and skipping a prescribed preventer is one of the most common reasons asthma stays poorly controlled: the preventer is doing its job quietly, on days you feel fine.$body$
where code = 'resp-asthma-explained';
update public.health_education_content set
  summary = $body$Triggers are personal: the same list does not apply to everyone.$body$,
  body = $body$Asthma triggers vary a lot between people. Common ones include dust, harmattan haze and air pollution, smoke, strong perfumes or cleaning products, cold air, respiratory infections, certain pets, and in some people, exercise or strong emotion.

Keeping a simple note of what you were doing or exposed to before flares helps you and your care team spot your own personal pattern over a few months: it is rarely obvious after just one or two episodes.

Avoiding a trigger entirely is not always possible, and that is fine: the goal is reducing exposure where practical (an air filter, avoiding known irritants where you can) alongside taking your preventer medicine consistently, not eliminating every trigger from your life.$body$
where code = 'resp-asthma-triggers';
update public.health_education_content set
  summary = $body$Two simple techniques that ease breathlessness without any equipment.$body$,
  body = $body$Two breathing techniques are widely taught for COPD because they genuinely help, and need no equipment.

Pursed-lip breathing: breathe in gently through your nose, then breathe out slowly through pursed lips (as if blowing out a candle very gently), taking about twice as long to breathe out as in. This keeps airways open a little longer and eases the feeling of breathlessness.

Diaphragmatic (belly) breathing: place a hand on your belly, breathe in so your belly rises more than your chest, breathe out slowly. This uses the breathing muscles more efficiently, which can reduce fatigue from breathing itself.

Practising both when calm, not only during a breathless moment, makes them easier to use when you actually need them.$body$
where code = 'resp-copd-breathing-techniques';
update public.health_education_content set
  summary = $body$Both affect breathing, but the underlying damage and typical pattern differ.$body$,
  body = $body$COPD (chronic obstructive pulmonary disease) and asthma both affect the airways, but they are different conditions. Asthma airway narrowing is largely reversible with treatment; COPD involves longer-term damage to the airways and air sacs, most commonly from years of smoking, so symptoms tend to be more constant rather than coming in isolated flares.

Common COPD symptoms are ongoing breathlessness (especially with activity, worsening gradually over time), a chronic cough, and frequent chest infections.

COPD cannot be reversed, but its progression can often be slowed significantly, and symptoms managed well, especially by quitting smoking completely and staying consistent with prescribed treatment and breathing techniques.$body$
where code = 'resp-copd-explained';
update public.health_education_content set
  summary = $body$Why a routine chest infection needs faster attention when you have COPD.$body$,
  body = $body$A common cold or chest infection that would pass quickly for most people can seriously worsen COPD symptoms: this is often called an "exacerbation" or flare-up, and it is one of the more common reasons for a COPD-related hospital visit.

Signs worth acting on quickly: a noticeable increase in breathlessness beyond your usual, more coughing or wheeze, a change in the colour or amount of phlegm, or fever. Many people with COPD are given a plan by their care team for what to do at the first sign of a flare: follow it rather than waiting to see if it passes.

Staying up to date with recommended vaccines (flu, pneumonia) is one of the most effective ways to reduce how often these flares happen at all.$body$
where code = 'resp-copd-infections';
update public.health_education_content set
  summary = $body$Practical, Nigeria-specific steps for the dustiest months of the year.$body$,
  body = $body$Harmattan season brings fine dust and reduced air quality that can affect anyone's breathing, and especially anyone with asthma, COPD, or other lung sensitivity.

Practical steps that help: keeping windows closed during the dustiest hours (usually mornings), using a damp cloth to reduce dust indoors rather than dry sweeping, wearing a mask outdoors on particularly hazy days if you are sensitive, and staying extra consistent with any prescribed preventer inhaler through the season rather than only reacting once symptoms start.

If you notice your breathing reliably gets worse every harmattan season, mention the pattern to your care team: some people benefit from a temporary step-up in treatment specifically for these months.$body$
where code = 'resp-harmattan-air-quality';
update public.health_education_content set
  summary = $body$Technique often matters more than which inhaler you have been prescribed.$body$,
  body = $body$A surprisingly large share of inhalers are used with technique that means much of the medicine never reaches the lungs at all: it ends up in the mouth and throat instead. Getting technique right can matter as much as the medicine itself.

General steps for most inhalers: breathe out fully away from the device, seal your lips around the mouthpiece, breathe in slowly and steadily while pressing the canister (for a metered-dose inhaler) or forcefully (for a dry-powder inhaler), then hold your breath for about ten seconds before breathing out.

Ask your care team or pharmacist to actually watch you use your inhaler at least once: technique is far easier to correct in person than to describe in writing, and it is a completely normal thing to ask for.$body$
where code = 'resp-inhaler-technique';
update public.health_education_content set
  summary = $body$Being prescribed oxygen is a treatment adjustment, not a sign the end is near.$body$,
  body = $body$Being told you need home oxygen can feel like a frightening milestone, but it is best understood as one more tool for managing a chronic condition, prescribed when your blood oxygen level is measurably low enough to benefit from it.

Common questions: Do I need it all the time? Depends on your prescription: some people need it continuously, others only during sleep or activity, based on testing. Is it addictive? No: oxygen is not habit-forming; your body simply uses what it needs. Can I still go out? Yes, with portable options available for many prescriptions.

If oxygen has been recommended and you have concerns about how it fits your daily life, raise them directly with your care team: the plan can often be adjusted around real practical constraints.$body$
where code = 'resp-oxygen-therapy-faqs';
update public.health_education_content set
  summary = $body$Whatever stage you are at, quitting still helps: starting today, not just years ago.$body$,
  body = $body$If you smoke, quitting is the single most effective thing you can do for your lungs, whatever condition (or none) you currently have. The benefit is not only for people who quit early: even after years of smoking or an existing diagnosis like COPD, quitting slows further decline and reduces flare-ups.

Most people who successfully quit for good do so with support rather than through willpower alone: this can include nicotine replacement, medicines that reduce cravings, and behavioural support. It is common to need more than one attempt; that is a normal part of the process, not a failure.

Ask your care team about support options available to you. The conversation is judgment-free and the benefit starts within days of stopping.$body$
where code = 'resp-quit-smoking';
update public.health_education_content set
  summary = $body$Most breathlessness is manageable at home: a short list of signs means it is not.$body$,
  body = $body$Breathlessness has many ordinary causes (exertion, heat, anxiety, a mild cold) and most of the time it settles with rest. A shorter list of signs means it needs urgent attention instead: breathlessness that stops you speaking in full sentences, blue-tinged lips or fingertips, breathlessness that comes on suddenly and severely, chest pain alongside it, or breathlessness that is not easing with your usual reliever inhaler or rest.

If any of these apply, treat it as an emergency and get help immediately rather than waiting to see if it improves.

For breathlessness that is new, gradually worsening over weeks, or reliably triggered by specific activities, that is worth a non-urgent message to your care team to look into rather than an emergency visit.$body$
where code = 'resp-when-breathlessness-urgent';
update public.health_education_content set
  summary = $body$Mammograms and clinical exams explained, and typical starting ages.$body$,
  body = $body$Breast cancer screening aims to catch changes before they can be felt, when treatment tends to be most effective. It typically combines a clinical breast exam by a professional with imaging (mammogram) from a certain age or risk level, which your care team can advise based on your own history.

A mammogram itself takes only a few minutes and involves brief compression of breast tissue to get a clear image: uncomfortable for some, but brief.

An abnormal-looking screening result is common and does not mean cancer: most callbacks lead to a clearer picture, not a diagnosis. Your screening calendar in the app is built around your age and history so you know when you are due.$body$
where code = 'screen-breast-cancer';
update public.health_education_content set
  summary = $body$Getting familiar with your own normal is more useful than a rigid monthly ritual.$body$,
  body = $body$Rather than a strict monthly checklist, the more useful habit is simply getting familiar with how your own breasts normally look and feel, so a genuine change stands out.

Worth mentioning to your care team: a new lump or thickening, a change in size or shape, skin dimpling or puckering, nipple changes (including discharge, unless you are breastfeeding), or persistent pain in one specific spot.

Most breast changes, including most lumps, are not cancer: cysts and fibrous tissue changes are common and often harmless. But any new, persistent change is worth getting checked rather than watched indefinitely on your own.$body$
where code = 'screen-breast-self-exam';
update public.health_education_content set
  summary = $body$Pap smear and HPV testing, in plain terms, and why this screening is unusually effective.$body$,
  body = $body$Cervical cancer screening (a Pap smear, sometimes paired with an HPV test) looks for early cell changes on the cervix, years before they could develop into cancer, which is part of why this particular screening has been so effective at reducing cervical cancer rates where it is widely used.

The test itself is brief: a small sample of cells is gently collected during a short exam. It can be uncomfortable but is not usually painful, and takes only a few minutes.

Most abnormal results reflect minor, common changes that resolve on their own or need simple monitoring, not cancer. Your care team will explain exactly what any result means for you and what, if anything, happens next.$body$
where code = 'screen-cervical-cancer';
update public.health_education_content set
  summary = $body$What changes are worth mentioning, and why earlier screening ages are becoming more common.$body$,
  body = $body$Colorectal (bowel) cancer often develops slowly from polyps that screening can catch and remove before they become cancer at all, which makes this one of the more preventable cancers when caught through screening.

Symptoms worth mentioning to your care team, especially if new and persistent: a change in bowel habits lasting more than a couple of weeks, blood in the stool, unexplained weight loss, or persistent abdominal discomfort. Most of these have far more common, non-cancer explanations, but they are worth checking rather than assuming.

Screening recommendations vary by risk and family history, and ages are trending earlier in many guidelines: ask your care team what applies to you.$body$
where code = 'screen-colorectal-cancer';
update public.health_education_content set
  summary = $body$The waiting period is genuinely hard: a few things that help.$body$,
  body = $body$Being called back after a screening test for more investigation is one of the more anxious waits in healthcare, and it is completely normal to feel that. It helps to remember that callbacks are a routine, expected part of how screening is designed to work, and most resolve as nothing serious.

A few things that help through the wait: ask your care team directly what the realistic range of outcomes is, rather than filling the gap with worst-case guessing; bring someone with you to the follow-up appointment if that helps you take in information; and know that "needs more testing" is a different, much more common category than "cancer confirmed."

However it resolves, you are not waiting alone: your care team is available for questions the whole way through.$body$
where code = 'screen-coping-with-callback';
update public.health_education_content set
  summary = $body$A close relative's early diagnosis can move your own screening age forward.$body$,
  body = $body$Standard screening ages are built around average risk. If a close relative (a parent, sibling, or child) was diagnosed with certain cancers, especially at a younger-than-typical age, your own screening may reasonably start earlier or happen more often.

This applies most clearly to breast, colorectal, and some other cancers with a stronger hereditary pattern. It does not mean you will develop the same condition: it means your risk profile is different enough from average to plan around.

If you know of this kind of family history, make sure it is on your record here, even if nobody has specifically asked recently: it directly shapes your personal screening calendar.$body$
where code = 'screen-family-history-earlier';
update public.health_education_content set
  summary = $body$Common, often silent infections that a simple blood test can catch early.$body$,
  body = $body$Hepatitis B and C are viral infections that can silently damage the liver over years, and both are more common in Nigeria than in many other regions, which is part of why liver-related screening is a genuinely relevant topic here specifically.

Both can be present for years with no symptoms at all, discovered only through a blood test. Hepatitis B has an effective vaccine; hepatitis C does not, but has effective treatment once found.

If you have never been tested, or do not know your status, it is a reasonable, simple test to ask your care team about: especially if you have a family history of liver disease or hepatitis.$body$
where code = 'screen-hepatitis-liver';
update public.health_education_content set
  summary = $body$A vaccine that prevents the infection behind most cervical cancer cases.$body$,
  body = $body$HPV (human papillomavirus) is a very common infection, and certain types are the main cause of cervical cancer, along with a share of some other cancers. The HPV vaccine protects against the types responsible for most of these cases.

It works best given before exposure to HPV, which is why it is often recommended in the pre-teen or teen years, though catch-up vaccination is available for older people too: ask your care team what applies to you or your child.

The vaccine does not replace cervical screening later in life; the two work together, one preventing infection, the other catching any changes that still occur.$body$
where code = 'screen-hpv-vaccine';
update public.health_education_content set
  summary = $body$A targeted screening, not a universal one: mainly relevant with a significant smoking history.$body$,
  body = $body$Unlike breast or cervical screening, lung cancer screening (a low-dose CT scan) is not typically recommended for everyone: it is generally aimed at people with a significant smoking history, particularly those who smoked heavily over many years, whether currently or in the past.

If that description applies to you, it is worth asking your care team whether screening makes sense for your specific history, rather than assuming it does or doesn't apply.

Whatever your screening status, a persistent cough lasting more than three weeks, coughing up blood, or unexplained weight loss are worth mentioning to your care team regardless of screening eligibility.$body$
where code = 'screen-lung-cancer-who';
update public.health_education_content set
  summary = $body$A quick, often-overlooked part of a regular check-up.$body$,
  body = $body$A quick look inside the mouth during a check-up is looking for more than cavities. Persistent mouth sores that will not heal, unexplained white or red patches, or a lump that does not go away are things a doctor or dentist checks for as part of routine care.

Tobacco use in any form (including chewing tobacco) and heavy alcohol use both raise risk meaningfully, and combined raise it further: one more reason both are worth discussing with your care team if they apply to you.

Most mouth changes are minor and heal on their own. Anything unusual lasting more than two to three weeks is worth mentioning rather than waiting it out.$body$
where code = 'screen-oral-cancer';
update public.health_education_content set
  summary = $body$Why this screening decision is more personal than most, and what it involves.$body$,
  body = $body$Prostate cancer screening, usually a blood test called PSA sometimes alongside a physical exam, is one where the decision to test is genuinely more personal than most screenings: it depends on your age, family history, and how you feel about the trade-offs, which your care team should walk through with you rather than apply as a blanket rule.

The reason: an elevated PSA can come from prostate cancer, but also from non-cancerous causes, so results are not always straightforward, and screening carries real trade-offs worth understanding before testing, not after an unexpected result.

If you are approaching the age where this becomes relevant, or have a family history, raise it with your care team so you can make an informed decision together.$body$
where code = 'screen-prostate-conversation';
update public.health_education_content set
  summary = $body$The ABCDE rule for spotting a mole worth getting checked.$body$,
  body = $body$Most skin marks are completely harmless, but it helps to know what is worth a second look. The ABCDE rule is a simple guide: Asymmetry (one half looks different from the other), Border (irregular or blurred edges), Colour (uneven, or multiple colours in one mark), Diameter (larger than about a pencil eraser), and Evolving (changing in size, shape or colour over time).

A new mark that appears suddenly in someone past mid-life, or any mark that itches, bleeds, or will not heal, is also worth mentioning.

Most checked marks turn out to be nothing serious. The goal of checking early is exactly that reassurance, or catching the rare exception while it is easiest to treat.$body$
where code = 'screen-skin-checks';
update public.health_education_content set
  summary = $body$A callback is far more often reassurance in disguise than a diagnosis.$body$,
  body = $body$Hearing "your screening result needs a closer look" understandably raises anxiety immediately. It helps to know what that phrase usually means in practice: screening tests are deliberately built to be sensitive, catching anything that might be worth a second look, which means they also flag a good number of things that turn out to be completely normal on closer inspection.

A callback for more testing is a normal, expected part of how screening works, not a sign that something is definitely wrong. The follow-up test (often more detailed or more specific) is what actually clarifies the picture.

If you get a callback, it is completely reasonable to ask your care team directly what the range of likely outcomes is, so the wait feels less like the worst-case default.$body$
where code = 'screen-what-abnormal-means';
update public.health_education_content set
  summary = $body$Age, family history, and lifestyle each play a role: none of them alone decides the outcome.$body$,
  body = $body$Cancer risk is shaped by several things together: age (risk generally rises over time for most cancers), family and genetic history, and lifestyle factors like smoking, alcohol, diet, weight and sun exposure.

Having a risk factor does not mean cancer is inevitable, and having none does not mean it is impossible: screening exists precisely because risk is a spectrum, not a guarantee in either direction.

What you can act on: the lifestyle factors are the ones within your control, and staying current with the screenings that match your age and history is the most effective response to the factors that aren't.$body$
where code = 'screen-your-risk-factors';
update public.health_education_content set
  summary = $body$Falling oestrogen speeds bone loss: a few habits protect against it.$body$,
  body = $body$Oestrogen helps maintain bone density, so bone loss speeds up notably after menopause, raising the risk of osteoporosis and fractures over time: this is a real, measurable shift, not a vague ageing concern.

What helps: adequate calcium and vitamin D (from food, sunlight, or supplements as advised), regular weight-bearing exercise (walking counts, and resistance work helps more), and avoiding smoking, which independently accelerates bone loss.

A bone density scan may be recommended depending on your risk factors: ask your care team whether and when that applies to you, particularly if you have other risk factors like a family history of fractures.$body$
where code = 'women-bone-health-menopause';
update public.health_education_content set
  summary = $body$Latch, supply, and the challenges that have real solutions.$body$,
  body = $body$A good latch (the baby taking in enough of the areola, not just the nipple) is the foundation of comfortable, effective breastfeeding, and is worth getting help with early if it feels wrong, rather than pushing through pain.

Worries about milk supply are extremely common, but true low supply is less common than the worry itself: frequent feeding, particularly in the first weeks, is usually what builds and maintains supply.

Common challenges (soreness, engorgement, blocked ducts) usually have straightforward fixes with the right guidance. If breastfeeding is causing ongoing pain, or you are worried about your baby's feeding or weight gain, ask your care team for support early rather than struggling alone.$body$
where code = 'women-breastfeeding-basics';
update public.health_education_content set
  summary = $body$The main categories, and how to think about which fits your life.$body$,
  body = $body$Contraception broadly falls into a few categories: hormonal methods (pills, injections, implants, hormonal IUDs), non-hormonal methods (copper IUD, condoms, natural family planning), and permanent methods (sterilisation) for those certain they want no future pregnancies.

Each category has real trade-offs in effectiveness, how much daily effort it takes, side effects, and reversibility: there is no single "best" option, only the best fit for your health, life stage, and priorities right now.

This is a genuinely personal decision worth a real conversation with your care team rather than picking from a list alone: they can walk through what fits your specific health history and what you are optimising for.$body$
where code = 'women-contraception-options';
update public.health_education_content set
  summary = $body$Age, timing, and health conditions all play a role: understanding the basics helps planning.$body$,
  body = $body$Fertility is influenced by several things together: age (fertility gradually declines over time, more noticeably from the mid-30s for many people), overall health conditions like PCOS or thyroid issues, weight, and simply the timing of intercourse relative to ovulation, which typically occurs roughly midway through a cycle.

If you are trying to conceive, tracking your cycle helps identify your fertile window more accurately than guessing.

If you have been trying for a year without success (or six months if you are over 35), that is a reasonable point to talk to your care team rather than waiting longer: many fertility factors are very treatable once identified, and earlier evaluation gives more options.$body$
where code = 'women-fertility-basics';
update public.health_education_content set
  summary = $body$Very common, usually harmless growths, but worth knowing the signs that need attention.$body$,
  body = $body$Fibroids are non-cancerous growths in or around the uterus, and they are extremely common: many women have them without ever knowing, especially when small and symptom-free.

When they do cause symptoms, the most common are heavy or prolonged periods, pelvic pressure or pain, frequent urination (from pressure on the bladder), or, less commonly, fertility difficulties depending on size and location.

Treatment ranges widely depending on symptoms and plans for future pregnancy: from monitoring, to medicine, to procedures that remove fibroids while preserving the uterus, to more significant surgery in some cases. Most fibroids do not need treatment at all; the right approach depends entirely on what they are actually doing for you.$body$
where code = 'women-fibroids-explained';
update public.health_education_content set
  summary = $body$Occasional variation is normal: a pattern of irregularity is worth investigating.$body$,
  body = $body$A period arriving a few days early or late occasionally is normal and usually not worth worrying about: stress, travel, illness and weight changes can all shift a single cycle.

Worth checking with your care team: periods consistently outside the typical 21–35 day range, periods that stop for three months or more (without pregnancy or menopause), bleeding between periods, or periods that become dramatically heavier or more painful than your normal.

Common causes include hormonal shifts, PCOS, thyroid changes, or stress: most are manageable once identified. Tracking your cycle here helps turn "it feels off" into a clear pattern your care team can actually act on.$body$
where code = 'women-irregular-periods';
update public.health_education_content set
  summary = $body$Practical options, from lifestyle adjustments to medical treatment.$body$,
  body = $body$A range of approaches can ease menopause symptoms, and most people benefit from combining a few. For hot flushes: dressing in layers, identifying personal triggers (caffeine, alcohol, spicy food, stress are common ones), and cooling strategies at night. For sleep: a consistent routine and a cool bedroom help meaningfully.

For symptoms significantly affecting daily life, hormone therapy and other medical treatments are genuinely effective options for many people: worth discussing directly with your care team rather than assuming they aren't suitable for you specifically, as suitability depends on your individual health history.

Vaginal dryness, often under-discussed, has simple and effective treatments too: it is a completely reasonable thing to raise.$body$
where code = 'women-menopause-symptom-management';
update public.health_education_content set
  summary = $body$The transition is usually gradual, not sudden, and highly individual.$body$,
  body = $body$Menopause is officially marked by twelve months without a period, but the transition leading up to it (perimenopause) is often gradual, sometimes lasting several years, with irregular periods and shifting symptoms along the way.

Common symptoms include hot flushes, night sweats, sleep disruption, mood changes, and vaginal dryness, though the combination and intensity vary enormously between people; some notice very little.

Menopause is a normal life stage, not a medical problem to fix, but the symptoms are very treatable if they are affecting your quality of life: there is no need to simply endure them if they are disruptive. Talk to your care team about what is bothering you most.$body$
where code = 'women-menopause-what-to-expect';
update public.health_education_content set
  summary = $body$What's actually happening hormonally, and what counts as a "normal" range.$body$,
  body = $body$A typical cycle runs anywhere from about 21 to 35 days, counted from the first day of one period to the first day of the next: there is a wide normal range, not one universal number.

Hormones rise and fall through the cycle to prepare and then shed the uterine lining if pregnancy does not occur. This is also why mood, energy, skin and appetite can shift predictably through the month for many people: it is a real hormonal pattern, not "just in your head."

Tracking your cycle here, even roughly, makes it much easier for you and your care team to spot when something has genuinely changed versus normal month-to-month variation.$body$
where code = 'women-menstrual-cycle';
update public.health_education_content set
  summary = $body$A common hormonal condition affecting periods, skin, and fertility: very manageable once identified.$body$,
  body = $body$PCOS (polycystic ovary syndrome) is a common hormonal condition, affecting a significant share of women of reproductive age. It can show up as irregular periods, acne, excess hair growth, weight changes, and difficulty conceiving, though the specific combination varies a lot between people, and not everyone has all of these.

It is diagnosed through a combination of symptoms, blood tests, and sometimes an ultrasound: no single test confirms it alone.

PCOS is very manageable, though not curable: treatment is tailored to what matters most to you personally, whether that is regulating periods, managing skin symptoms, supporting fertility, or a combination, which is why the conversation with your care team about priorities matters as much as the diagnosis itself.$body$
where code = 'women-pcos-explained';
update public.health_education_content set
  summary = $body$A wide range of causes, from ordinary to needing prompt attention.$body$,
  body = $body$Pelvic pain has a genuinely wide range of causes: period cramps, ovulation pain, urinary tract infections, and digestive issues are common and usually manageable. Some causes, like endometriosis or fibroids, are chronic and benefit from a proper diagnosis rather than being lived with indefinitely.

A smaller set of causes need prompt attention: sudden, severe pelvic pain, especially with fever, fainting, or heavy bleeding, can point to something needing urgent care rather than a routine appointment.

Pain that is dismissed as "normal" for too long is a common and unfortunate pattern: persistent or worsening pelvic pain deserves a proper look, not just reassurance that it is probably nothing.$body$
where code = 'women-pelvic-pain-causes';
update public.health_education_content set
  summary = $body$Recovery takes longer than the six-week mark most people expect, and the emotional side is just as real.$body$,
  body = $body$Physical recovery after birth genuinely extends well beyond the commonly cited six-week mark, especially for the pelvic floor, abdominal muscles, and if there was a caesarean, the surgical site. Rest, gradual return to activity, and attending your postpartum check-up matter more than rushing back to "normal."

Emotionally, mood changes in the first couple of weeks ("baby blues") are common and usually settle on their own. What is different, and worth reporting to your care team promptly, is persistent low mood, anxiety, or difficulty bonding lasting beyond two weeks, or any thoughts of harming yourself or the baby: postpartum depression and anxiety are common, treatable, and nothing to be ashamed of.

Asking for practical and emotional support in this period is a sign of good planning, not a failure to cope.$body$
where code = 'women-postpartum-recovery';
update public.health_education_content set
  summary = $body$A few specific steps in the months before trying to conceive make a real difference.$body$,
  body = $body$If you are planning a pregnancy, a few specific steps in the months beforehand genuinely improve outcomes. Starting a folic acid supplement before conception, not just after a positive test, meaningfully reduces certain birth defect risks: this is one of the most evidence-backed preconception steps there is.

Other worthwhile steps: getting chronic conditions like diabetes or high blood pressure well controlled beforehand, reviewing any regular medicines with your care team (some need adjusting before pregnancy), and catching up on any due vaccinations.

It is also a good time to raise any family history or personal health concerns with your care team, so the pregnancy itself starts from the clearest possible picture.$body$
where code = 'women-preconception-health';
update public.health_education_content set
  summary = $body$What's typical in the early weeks, and the appointments worth not delaying.$body$,
  body = $body$The first trimester (roughly weeks 1–12) is when many of the foundational pregnancy checks happen, even though it can be a quiet time symptom-wise for some, and an intense one (nausea, fatigue) for others: both are normal ranges.

Booking your first antenatal appointment early, rather than waiting, matters: it is when baseline blood tests, dating, and risk screening typically happen, and earlier identification of any issue generally means more options to address it.

Continuing (or starting) folic acid, avoiding alcohol and smoking, and mentioning any regular medicines to your care team for a pregnancy-safety review are the practical essentials of this stage.$body$
where code = 'women-pregnancy-first-trimester';
update public.health_education_content set
  summary = $body$Most pregnancy symptoms are ordinary discomforts: a specific short list is not.$body$,
  body = $body$Most of what pregnancy brings (nausea, fatigue, aches) is uncomfortable but ordinary. A specific, shorter list of signs is different, and warrants urgent care rather than waiting for a routine appointment: heavy vaginal bleeding, severe abdominal pain, a severe headache that does not ease with rest or usual pain relief, sudden vision changes, severe swelling in the face or hands, reduced or absent baby movement after the point you would normally feel it, or fever.

These signs can point to serious but very treatable complications when caught early. If any of them apply, contact your care team or go to emergency care immediately rather than waiting to see if it passes: this is exactly the kind of situation where acting promptly makes the difference.$body$
where code = 'women-pregnancy-warning-signs';
update public.health_education_content set
  summary = $body$Most vaginal symptoms have simple, well-understood explanations.$body$,
  body = $body$Vaginal discharge, itching, or odour changes are common and usually have straightforward, treatable explanations: yeast infections and bacterial vaginosis are both frequent and respond well to treatment, not something to be embarrassed about mentioning.

What is worth getting checked rather than self-treating repeatedly: symptoms that keep recurring despite treatment, symptoms alongside pelvic pain or fever, or any new symptom after a new sexual partner, which could indicate a sexually transmitted infection worth specifically testing for.

This is one of the more common reasons people delay seeking care out of discomfort discussing it: your care team handles these conversations routinely and without judgment.$body$
where code = 'women-vaginal-health';

update public.health_education_content set
  body = $body$Healthcare costs often arrive as one lump sum right when you need a plan, a test, or a referral most. Care Vouchers are built to soften that.

Pay toward a voucher in whatever amounts suit you, whenever you have it, and the balance builds until it covers what it is set for. A family member, local or abroad, can pay toward it directly too, which is often easier than sending cash for a specific bill after the fact.

Once a voucher is fully funded, you redeem it toward the plan or care it was set up for. If you have not looked at yours yet, it is worth a glance: paying small-small, over weeks, is far easier for most people to manage than one large bill.$body$
where code = 'gen_w10_health_wallet';

-- Assertion: no em dashes should remain in the rows this migration touched.
-- (The pre-existing 2026-07-17/23 curriculum content has the same issue and
-- is cleaned up separately — see the following migration — so this checks
-- only what was actually rewritten above, not the whole table.)
--
-- Was `created_at > now() - interval '3 hours' or code = '...'` — worked
-- on live, where these rows were genuinely inserted hours before this
-- migration ran, but on a from-scratch replay every migration in the whole
-- 601-file history applies within seconds of each other, so that window
-- also (wrongly) swept in the untouched 2026-07-17/23 content the comment
-- above says is out of scope, caught by the next migration instead — found
-- by the new CI migration-replay job, 2026-08-27. Lists the exact codes
-- this migration updates instead, which is what "touched" always actually
-- meant.
do $$
declare
  remaining integer;
begin
  select count(*) into remaining
  from public.health_education_content
  where (title like '%' || chr(8212) || '%'
      or summary like '%' || chr(8212) || '%'
      or body like '%' || chr(8212) || '%')
    and code = any(array[
    'dm-dental-health-link',
    'dm-gestational-diabetes',
    'dm-insulin-basics',
    'dm-travel-tips',
    'family-caring-for-elderly-relative',
    'family-child-fever-urgent-care',
    'family-child-safety-at-home',
    'family-childhood-vaccine-schedule',
    'family-common-childhood-illness',
    'family-growth-milestones',
    'family-health-history-together',
    'family-introducing-solid-foods',
    'family-managing-sick-child-home',
    'family-preparing-new-sibling',
    'family-school-health-records',
    'family-screen-time-health',
    'family-talking-to-children-about-health',
    'gen_w10_health_wallet',
    'gs-complete-your-profile',
    'gs-meet-your-care-team',
    'gs-referrals-explained',
    'gs-understanding-your-plan',
    'gs-using-the-app-daily',
    'gs-when-message-vs-emergency',
    'heart-afib-explained',
    'heart-attack-warning-signs',
    'heart-chest-pain-context',
    'heart-cholesterol-basics',
    'heart-cholesterol-food-swaps',
    'heart-exercise-with-condition',
    'heart-failure-daily-weighing',
    'heart-failure-explained',
    'heart-family-history',
    'heart-medicines-explained',
    'heart-recovery-after-event',
    'heart-sleep-apnoea',
    'heart-smoking-alcohol-combined',
    'heart-stress-management',
    'heart-stroke-fast',
    'heart-women-symptoms-differ',
    'htn-caffeine-effect',
    'htn-emergency-signs',
    'htn-pregnancy-preeclampsia',
    'htn-white-coat-masked',
    'kidney-anaemia-link',
    'kidney-bp-protection-together',
    'kidney-ckd-stages',
    'kidney-eating-well',
    'kidney-fluid-and-salt',
    'kidney-living-well-on-dialysis',
    'kidney-painkillers-caution',
    'kidney-preparing-for-dialysis',
    'kidney-protecting-with-diabetes-htn',
    'kidney-signs-to-report',
    'kidney-slowing-progression',
    'kidney-transplant-basics',
    'kidney-urine-protein-test',
    'kidney-what-they-do',
    'med-childrens-dosing-safety',
    'med-consistency-matters',
    'med-drug-interactions',
    'med-generic-vs-brand',
    'med-missed-dose',
    'med-pregnancy-breastfeeding',
    'med-refills-avoiding-gap',
    'med-reminders-that-work',
    'med-side-effects-normal-vs-report',
    'med-storage',
    'med-traditional-herbal-remedies',
    'med-travelling-with-medicines',
    'med-understanding-prescription-label',
    'med-when-safe-to-stop',
    'men-erectile-dysfunction-signal',
    'men-fertility-basics',
    'men-hair-loss-normal-vs-medical',
    'men-heart-risk-earlier',
    'men-hernia-signs',
    'men-mental-health-underreporting',
    'men-preventive-care-gap',
    'men-prostate-basics',
    'men-psa-test-explained',
    'men-testicular-self-exam',
    'men-testosterone-myths',
    'men-weight-muscle-balance',
    'mh-anxiety-explained',
    'mh-building-support-network',
    'mh-childrens-mental-health',
    'mh-chronic-illness-link',
    'mh-coping-skills-anxious-moments',
    'mh-depression-more-than-sad',
    'mh-grief-no-normal-timeline',
    'mh-postnatal-awareness',
    'mh-sleep-mental-health-link',
    'mh-stress-anxiety-burnout',
    'mh-substance-use-overlap',
    'mh-supporting-family-member',
    'mh-talking-to-care-team',
    'mh-when-to-seek-help',
    'nutrition-alcohol-hidden-calories',
    'nutrition-balanced-plate',
    'nutrition-childrens-habits',
    'nutrition-cooking-oils',
    'nutrition-eating-while-travelling',
    'nutrition-fasting-practices',
    'nutrition-fibre-matters',
    'nutrition-healthy-fats',
    'nutrition-hidden-sugar',
    'nutrition-hydration-how-much',
    'nutrition-meal-prep-budget',
    'nutrition-portion-sizes-no-scale',
    'nutrition-protein-how-much',
    'nutrition-reading-food-labels',
    'nutrition-street-food-eating-out',
    'nutrition-vitamins-supplements',
    'ob-bmi-limitations',
    'ob-childhood-weight',
    'ob-weight-loss-medicines-explained',
    'ob-weight-stigma-healthcare',
    'resp-asthma-action-plan',
    'resp-asthma-exercise',
    'resp-asthma-explained',
    'resp-asthma-triggers',
    'resp-copd-breathing-techniques',
    'resp-copd-explained',
    'resp-copd-infections',
    'resp-harmattan-air-quality',
    'resp-inhaler-technique',
    'resp-oxygen-therapy-faqs',
    'resp-quit-smoking',
    'resp-when-breathlessness-urgent',
    'screen-breast-cancer',
    'screen-breast-self-exam',
    'screen-cervical-cancer',
    'screen-colorectal-cancer',
    'screen-coping-with-callback',
    'screen-family-history-earlier',
    'screen-hepatitis-liver',
    'screen-hpv-vaccine',
    'screen-lung-cancer-who',
    'screen-oral-cancer',
    'screen-prostate-conversation',
    'screen-skin-checks',
    'screen-what-abnormal-means',
    'screen-your-risk-factors',
    'women-bone-health-menopause',
    'women-breastfeeding-basics',
    'women-contraception-options',
    'women-fertility-basics',
    'women-fibroids-explained',
    'women-irregular-periods',
    'women-menopause-symptom-management',
    'women-menopause-what-to-expect',
    'women-menstrual-cycle',
    'women-pcos-explained',
    'women-pelvic-pain-causes',
    'women-postpartum-recovery',
    'women-preconception-health',
    'women-pregnancy-first-trimester',
    'women-pregnancy-warning-signs',
    'women-vaginal-health'
  ]);
  if remaining > 0 then
    raise exception 'expected zero em-dash rows among the ones this migration rewrote, found %', remaining;
  end if;
end $$;
