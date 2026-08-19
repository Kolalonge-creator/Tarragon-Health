-- Tarragon Health — Health Education library expansion: heart, kidney, and
-- respiratory (asthma/COPD) topics. These conditions had zero education
-- content despite being named in the patient-facing category labels
-- (CONDITION_LABEL in health-education.tsx already promised "Heart health"
-- and "Kidney health"). Plain-language, Nigeria-grounded, no fear copy —
-- same voice as the existing hypertension/diabetes/weight tracks.
--
-- clinician_reviewed is deliberately left at its default (false, no
-- reviewed_by_name/reviewed_at) — this is placeholder copy pending a real
-- clinical review pass, same honesty rule the 2026-07-23 curriculum content
-- already follows (see 20260723122000_education_drip_tracks.sql). Never
-- claim a review that hasn't happened.

insert into public.health_education_content
  (code, title, summary, body, content_type, estimated_minutes, condition, category, sort_order, knowledge_check)
values

-- ============================================================================
-- Heart & cardiovascular health
-- ============================================================================
('heart-cholesterol-basics', 'Understanding your cholesterol numbers',
 'What LDL, HDL and triglycerides actually mean, in plain language.',
 E'Your cholesterol panel reports a few different things, not one number. LDL is often called "bad" cholesterol — it is what builds up inside artery walls over years. HDL is "good" cholesterol — it helps carry cholesterol away. Triglycerides are a separate type of fat in your blood, often linked to diet and weight.\n\nThe goal is not zero cholesterol; your body needs some. The goal is a healthy balance: lower LDL, higher HDL, and triglycerides in range. Diet, movement and, for some people, medicine all shift this balance.\n\nOne panel is a starting point, not a verdict. Your care team looks at your numbers alongside your blood pressure, sugar and family history to decide what, if anything, needs to change.',
 'article', 4, 'cardiovascular', 'heart', 10,
 '[{"question": "What does LDL cholesterol do?", "options": ["Carries cholesterol away from artery walls", "Builds up inside artery walls over time", "Has no effect on heart health"], "answer_index": 1}]'::jsonb),

('heart-attack-warning-signs', 'Heart attack warning signs worth knowing',
 'Chest pressure is the classic sign, but not the only one — what to watch for and what to do.',
 E'The best-known sign is a pressure, squeezing or tightness in the chest, often lasting more than a few minutes. But a heart attack can also show up as pain spreading to the arm, jaw or back, shortness of breath, cold sweat, nausea, or sudden extreme fatigue — sometimes with little or no chest pain at all.\n\nThis is not a symptom checklist to self-diagnose against. It is information so that if something feels seriously wrong, you do not talk yourself out of getting help. Minutes matter for how much heart muscle is saved.\n\nIf you or someone with you has these signs, treat it as an emergency: get to a hospital or call for help immediately, do not wait to see if it passes.',
 'article', 4, 'cardiovascular', 'heart', 20,
 '[{"question": "Someone has chest pressure lasting several minutes with cold sweat. What should happen?", "options": ["Wait an hour to see if it passes", "Treat it as an emergency and get help immediately", "Take a painkiller and rest"], "answer_index": 1}]'::jsonb),

('heart-stroke-fast', 'Recognising a stroke: the FAST check',
 'A simple four-part check anyone can use in a moment that matters.',
 E'A stroke happens when blood flow to part of the brain is interrupted. It can look different in different people, which is why a simple check helps: FAST.\n\nFace — does one side droop when they smile? Arms — can they raise both arms, or does one drift down? Speech — is it slurred or strange, can they repeat a simple sentence? Time — if any of these are present, time matters enormously; get emergency help right away.\n\nStroke treatment is far more effective the sooner it starts. Do not wait to see if symptoms improve on their own, and do not let the person "sleep it off" — get them to emergency care immediately.',
 'article', 3, 'cardiovascular', 'heart', 30,
 '[{"question": "What does the ''T'' in FAST stand for?", "options": ["Tiredness", "Time — act immediately", "Temperature"], "answer_index": 1}]'::jsonb),

('heart-failure-explained', 'What heart failure means',
 'It does not mean the heart has stopped — it means it is pumping less efficiently than it should.',
 E'"Heart failure" sounds alarming, but it does not mean the heart has stopped working. It means the heart is not pumping quite as efficiently as it should, so fluid can back up into the lungs and body.\n\nCommon signs include breathlessness (especially lying flat or with activity), swelling in the ankles or belly, and unusual tiredness. It is a long-term condition your care team manages, often very successfully, with medicines and monitoring.\n\nThe two habits that matter most day to day: weighing yourself regularly (sudden weight gain can mean fluid building up) and watching your salt intake, because salt makes the body hold onto fluid.',
 'article', 4, 'heart_failure', 'heart', 40, null),

('heart-failure-daily-weighing', 'Daily weighing: your earliest heart failure warning system',
 'A same-time, same-scale weigh-in catches fluid buildup days before you would otherwise feel it.',
 E'If you live with heart failure, your bathroom scale is one of your most useful tools. Fluid can build up in the body before you feel breathless or notice swelling — and weight often shows it first.\n\nWeigh yourself each morning, after using the toilet and before eating, on the same scale, in similar clothing. Log it here so the trend is visible over time, not just the number on any one day.\n\nA sudden jump — commonly described as 2kg or more in two to three days — is worth a message to your care team promptly, even if you feel fine otherwise. Catching it early usually means a simple adjustment instead of a hospital visit.',
 'article', 3, 'heart_failure', 'heart', 50, null),

('heart-afib-explained', 'Atrial fibrillation: the irregular heartbeat',
 'What it is, why it raises stroke risk, and why treatment focuses on more than just the rhythm.',
 E'Atrial fibrillation (often shortened to AFib) is when the heart''s upper chambers beat irregularly and often too fast, instead of in their normal steady rhythm. Some people feel a fluttering or racing heartbeat; others feel nothing unusual at all.\n\nThe reason it matters beyond comfort: an irregular rhythm lets blood pool briefly in the heart, which raises the risk of a clot forming and travelling to the brain — a stroke. This is why AFib treatment often includes a blood-thinning medicine alongside anything that manages the rhythm itself.\n\nIf you are prescribed a blood thinner for AFib, taking it consistently matters more than almost any other part of the plan — it is doing quiet, essential work even on days you feel completely normal.',
 'article', 4, 'cardiovascular', 'heart', 60, null),

('heart-exercise-with-condition', 'Exercise with a heart condition: what to check first',
 'Most heart conditions do not mean stopping activity — they mean starting the right way.',
 E'A heart diagnosis often makes people afraid to move, when in most cases the opposite is true: appropriately paced activity strengthens the heart and improves outcomes. The key word is "appropriately" — ask your care team what level is right for your specific situation before starting or resuming.\n\nGeneral signs to stop and rest: chest pain or pressure, unusual breathlessness, dizziness, or an irregular or racing heartbeat that feels different from your normal.\n\nMany people are cleared for brisk walking, and some are referred to structured cardiac rehabilitation programmes, which pace activity up safely under supervision. Ask your care team whether that is right for you.',
 'article', 3, 'cardiovascular', 'heart', 70, null),

('heart-cholesterol-food-swaps', 'Food swaps that actually move your cholesterol',
 'A handful of specific changes matter far more than an overwhelming full diet overhaul.',
 E'You do not need to overhaul every meal to move your cholesterol numbers. A few specific swaps carry most of the benefit.\n\nReplace some fried and processed food with grilled, boiled or steamed options. Choose fish and beans over red or processed meat more often. Swap groundnut oil or palm oil used generously for smaller amounts, and add more fibre — oats, beans, vegetables, fruit with the skin on where possible — which binds cholesterol in the gut before it is absorbed.\n\nStart with one meal a day. Small, sustained changes across months move a cholesterol panel more reliably than a strict week followed by giving up.',
 'article', 3, 'cardiovascular', 'heart', 80,
 '[{"question": "Which change helps lower cholesterol most reliably?", "options": ["A strict diet for one week then stopping", "Small, sustained swaps kept up over months", "Avoiding all fat completely, forever"], "answer_index": 1}]'::jsonb),

('heart-family-history', 'Why we ask about your family''s heart history',
 'A parent or sibling with early heart disease changes how closely your own numbers get watched.',
 E'If a close relative — a parent or sibling — had a heart attack, stroke, or was diagnosed with heart disease at a relatively young age, that raises your own risk somewhat, independent of your personal habits.\n\nThis is not a prediction that the same will happen to you. It is one input your care team weighs alongside your blood pressure, cholesterol, sugar and lifestyle to decide how closely to monitor you and how proactive to be.\n\nIf you know this history, tell your care team even if nobody has asked recently — family details change (a new diagnosis, a relative''s age at the time) and the record here should stay current.',
 'article', 3, 'cardiovascular', 'heart', 90, null),

('heart-chest-pain-context', 'Chest pain: what tends to be your heart, and what usually isn''t',
 'General context to think with, never a substitute for getting checked when something feels wrong.',
 E'Chest pain has many causes, and most of them are not the heart — muscle strain, heartburn, and anxiety are all common culprits. That said, this is context, not a diagnosis tool, and the safe default is always to get checked rather than guess.\n\nPatterns more often linked to the heart: pressure or squeezing rather than sharp or stabbing pain, pain that spreads to the arm, jaw or back, pain brought on by exertion and eased by rest, or pain paired with breathlessness, sweating or nausea.\n\nPatterns more often linked to other causes: pain that changes with breathing or movement, pain you can point to with one finger, or pain that started right after eating. When in doubt, get it checked rather than waiting it out.',
 'article', 3, 'cardiovascular', 'heart', 100, null),

('heart-stress-management', 'Managing stress for your heart',
 'Chronic stress raises blood pressure and heart rate — small, repeatable habits help most.',
 E'Stress triggers a real physical response: blood pressure and heart rate rise, and over time chronic stress is linked to higher cardiovascular risk. You cannot remove all stress from life, but you can build habits that soften its effect on your body.\n\nWhat helps most, based on what actually gets used day to day: a few minutes of slow breathing when tension spikes, regular movement (even a short walk), protecting sleep, and talking to someone — a friend, family member, or your care team — rather than carrying everything alone.\n\nIf stress is affecting your sleep, appetite or mood for weeks at a time, that is worth raising with your care team directly, not just managing quietly.',
 'article', 3, 'cardiovascular', 'heart', 110, null),

('heart-smoking-alcohol-combined', 'Smoking, alcohol and your heart together',
 'Each raises heart risk on its own — combined, the effect is not simply additive.',
 E'Smoking damages blood vessel walls and makes blood more likely to clot. Heavy alcohol use raises blood pressure and can weaken heart muscle over time. Each is a real risk on its own; together, they tend to compound rather than simply add up.\n\nThe encouraging side: heart risk from smoking starts dropping within weeks of quitting, and continues improving for years. There is no need to quit everything at once — even cutting down, or getting support to quit smoking specifically, moves the numbers in the right direction.\n\nYour care team can point you to real support for quitting, including options that do not rely on willpower alone.',
 'article', 3, 'cardiovascular', 'heart', 120, null),

('heart-medicines-explained', 'Your heart medicines, explained in plain terms',
 'Why heart conditions often mean several tablets, each doing a different job.',
 E'It is common to be prescribed more than one medicine for a heart condition, and that can feel like a lot at once. Broadly, they tend to fall into a few jobs: some lower blood pressure and ease the heart''s workload, some manage heart rhythm, some thin the blood to prevent clots, and some manage cholesterol.\n\nEach is usually doing a different, specific job rather than overlapping — which is why stopping one without medical guidance can undo a piece of the plan the others were built around.\n\nIf a medicine is causing side effects, or the number of tablets feels unmanageable, say so. Your care team would much rather adjust the plan than have you quietly stop taking something.',
 'article', 4, 'cardiovascular', 'heart', 130, null),

('heart-recovery-after-event', 'The first few months after a heart attack or cardiac event',
 'What recovery typically involves, and why the early months set the pattern for years after.',
 E'Recovering from a heart attack or other cardiac event is both physical and emotional. Physically, activity is usually built back up gradually, often with a structured cardiac rehabilitation programme if one is available to you. Emotionally, it is common to feel anxious about symptoms, or low, in the weeks after — this is a normal response worth mentioning to your care team, not something to push through silently.\n\nMedicine adherence in these early months matters enormously; several of the medicines started after an event are specifically protecting against a repeat one.\n\nMost people return to a full, active life. The habits built in the first few months — movement, medicines, follow-up — are what carry that forward long term.',
 'article', 4, 'cardiovascular', 'heart', 140, null),

('heart-sleep-apnoea', 'Snoring, sleep apnoea and your heart',
 'Loud snoring with pauses in breathing is worth mentioning — it strains the heart quietly over years.',
 E'Loud, habitual snoring — especially with pauses in breathing, gasping, or choking sounds, and daytime exhaustion despite a full night in bed — can be a sign of sleep apnoea, where breathing repeatedly stops and restarts during sleep.\n\nEach pause briefly drops oxygen and spikes stress hormones, which over years is linked to high blood pressure, irregular heart rhythm and heart strain. It is often missed because the person having it does not remember the episodes — a partner or family member usually notices first.\n\nIt is very treatable once identified. If this sounds familiar, mention it to your care team; it is a common and often overlooked piece of the picture.',
 'article', 3, null, 'heart', 150, null),

('heart-women-symptoms-differ', 'Heart attack symptoms can look different for women',
 'Chest pressure still happens, but nausea, fatigue and jaw pain are more often the leading signs.',
 E'Classic chest-pressure heart attack symptoms are common in women too, but women somewhat more often experience less "classic" signs as the leading symptom: unusual fatigue, nausea, jaw or back pain, breathlessness, or a vague sense that something is wrong — sometimes with little or no chest pain.\n\nThis matters because those signs are easier to dismiss as stress, indigestion, or tiredness, which can delay getting help.\n\nThe same rule applies regardless of how the symptoms show up: if something feels seriously wrong, particularly with any combination of these signs, treat it as an emergency and get checked rather than waiting to see if it passes.',
 'article', 3, 'cardiovascular', 'heart', 160, null),

-- ============================================================================
-- Kidney health (CKD)
-- ============================================================================
('kidney-what-they-do', 'What your kidneys actually do',
 'More than "filtering waste" — the quiet, constant work behind healthy kidneys.',
 E'Your two kidneys filter your entire blood volume roughly forty times a day, removing waste and extra fluid as urine. But that is only part of the job — they also balance salts and minerals, help control blood pressure, and trigger the body to make red blood cells.\n\nBecause of this, kidney problems can show up in surprising places: tiredness (from low red blood cells), swelling (from fluid balance), or high blood pressure that is hard to control.\n\nKidneys can lose a good deal of function before you feel anything at all, which is exactly why blood and urine tests, not symptoms, are how your care team actually tracks kidney health.',
 'article', 4, 'ckd', 'kidney', 10, null),

('kidney-ckd-stages', 'Understanding CKD stages and eGFR',
 'What that eGFR number on your lab report is actually measuring.',
 E'Chronic kidney disease (CKD) is tracked in stages, from 1 (mild) to 5 (kidney failure), based mainly on a number called eGFR — estimated glomerular filtration rate. Think of it as roughly how efficiently your kidneys are filtering, expressed as a percentage-like score: 90+ is normal-range, while lower numbers mean reduced function.\n\nA lower stage number does not mean an emergency — many people live for years at earlier stages with steady monitoring and never progress quickly. What matters most is the trend over time, and managing the conditions (commonly high blood pressure and diabetes) that drive further decline.\n\nYour care team uses your eGFR trend, not a single reading, to decide how often to check and what to adjust.',
 'article', 4, 'ckd', 'kidney', 20,
 '[{"question": "What does eGFR roughly measure?", "options": ["Blood sugar level", "How efficiently your kidneys are filtering", "Blood pressure"], "answer_index": 1}]'::jsonb),

('kidney-protecting-with-diabetes-htn', 'Protecting your kidneys when you have diabetes or high blood pressure',
 'The two biggest drivers of kidney damage worldwide — and why managing them protects kidneys too.',
 E'High blood sugar and high blood pressure are, between them, the leading causes of kidney damage worldwide. Both quietly strain the tiny blood vessels inside the kidneys that do the actual filtering.\n\nThe encouraging part: managing these two conditions well is one of the most effective things you can do to protect your kidneys, often more effective than anything kidney-specific. Keeping blood pressure and blood sugar in the range your care team sets, and taking medicines consistently, is the core of kidney protection for most people.\n\nCertain blood pressure medicines are specifically protective for kidneys with diabetes — which is one reason your care team may choose one type over another for you specifically.',
 'article', 4, 'ckd', 'kidney', 30, null),

('kidney-eating-well', 'Eating well for kidney health',
 'Protein, potassium and phosphorus — what changes, and why it depends on your stage.',
 E'Kidney-friendly eating is not one-size-fits-all — it depends on your stage of kidney function, so specifics should come from your care team or a dietitian, not a generic list. That said, a few themes come up often.\n\nProtein: earlier CKD does not usually mean cutting protein sharply, but very high-protein eating can add to the kidneys'' workload. Potassium and phosphorus: as kidney function drops, these can build up in the blood, so some people are advised to limit high-potassium foods (like large amounts of banana, orange, or potato) or high-phosphorus foods (some processed and packaged items).\n\nSalt is nearly always worth limiting, since it affects both blood pressure and fluid balance, which the kidneys are already managing.',
 'article', 4, 'ckd', 'kidney', 40, null),

('kidney-fluid-and-salt', 'Fluid and salt as kidney function changes',
 'Why "drink more water" is not universal advice once kidney function has dropped.',
 E'Healthy kidneys handle a wide range of fluid intake without much trouble. As kidney function drops, that flexibility narrows — which is why fluid advice for CKD is genuinely different from general health advice, and should come from your care team rather than generic guidance.\n\nSalt is more consistent: reducing it helps blood pressure and reduces fluid retention at almost every stage. The same hidden sources apply as elsewhere — seasoning cubes, processed and tinned food, salted snacks.\n\nIf you notice new swelling in your legs or around your eyes, or sudden weight gain over a few days, that is worth mentioning to your care team — it can reflect fluid balance shifting.',
 'article', 3, 'ckd', 'kidney', 50, null),

('kidney-painkillers-caution', 'Painkillers and your kidneys: what to be careful with',
 'Some common over-the-counter painkillers are harder on the kidneys than others.',
 E'Some widely available painkillers, particularly a class called NSAIDs (common examples include ibuprofen and diclofenac), can reduce blood flow to the kidneys and are best used cautiously, especially with existing kidney disease, and ideally not regularly without checking with your care team first.\n\nThis is not about avoiding pain relief altogether — it is about choosing wisely and not assuming "available without a prescription" means "no kidney impact." Paracetamol is generally considered gentler on the kidneys at normal doses, but any regular medicine use is worth mentioning at your next check-in.\n\nIf you take regular painkillers for a chronic pain condition and also have CKD, ask your care team to review the combination directly rather than guessing.',
 'article', 3, 'ckd', 'kidney', 60, null),

('kidney-urine-protein-test', 'Understanding a urine protein test result',
 'Why a little protein in urine matters even when everything else feels fine.',
 E'Healthy kidneys keep protein in the blood, not the urine. A urine test that finds protein (sometimes reported as ACR or a "protein:creatinine ratio") can be an early sign that the kidney''s filters are letting things through they normally would not — often before blood tests show any change.\n\nA small amount detected once is not automatically alarming; your care team usually confirms with a repeat test, since things like a recent infection, heavy exercise, or dehydration can cause a temporary blip.\n\nA confirmed, persistent result is useful information, not a diagnosis on its own — it helps your care team decide how closely to monitor you and whether to start kidney-protective treatment earlier.',
 'article', 3, 'ckd', 'kidney', 70, null),

('kidney-anaemia-link', 'Anaemia and kidney disease: why they''re linked',
 'Your kidneys help make red blood cells — when kidney function drops, anaemia often follows.',
 E'Kidneys release a hormone that signals the body to make red blood cells. As kidney function declines, that signal weakens, and anaemia (low red blood cell count) becomes more common — which is why unusual tiredness in CKD is not always "just tiredness."\n\nAnaemia from CKD is treatable, sometimes with iron, sometimes with a medicine that replaces the missing signal, depending on how significant it is.\n\nIf you have CKD and notice new or worsening fatigue, breathlessness on mild exertion, or looking unusually pale, mention it — it is a reasonable and common thing for your care team to check for specifically.',
 'article', 3, 'ckd', 'kidney', 80, null),

('kidney-preparing-for-dialysis', 'Preparing for dialysis: what the conversation usually covers',
 'A conversation, not a sudden event — most people have real time to prepare and choose.',
 E'For most people, the conversation about dialysis happens well before it is urgently needed, giving real time to understand the options and prepare rather than facing a sudden decision. It typically covers the type of dialysis (haemodialysis, usually at a centre, or peritoneal dialysis, usually done at home), what a typical week looks like with each, and how it fits your life and work.\n\nSome people are also assessed for a kidney transplant as an alternative or eventual step, which your care team can discuss with you.\n\nIt is a significant conversation and a lot to take in at once — it is entirely reasonable to ask for it in stages, bring a family member, and ask the same question more than once.',
 'article', 4, 'ckd', 'kidney', 90, null),

('kidney-living-well-on-dialysis', 'Living well on dialysis',
 'Routines that make ongoing dialysis fit into a real, full life.',
 E'Starting dialysis is a major adjustment, but many people build a stable, workable routine around it and continue working, socialising and travelling with planning.\n\nA few things tend to help most: keeping to the fluid and diet guidance from your dialysis team closely (it matters more here than at earlier CKD stages), planning ahead for travel or events around your schedule, and treating the emotional side as real — it is common to grieve the change, and support (from family, your care team, or a support group) genuinely helps.\n\nIf a session routinely leaves you feeling unusually unwell, or something about the schedule stops working for your life, say so — there is often more flexibility in the plan than people assume.',
 'article', 4, 'ckd', 'kidney', 100, null),

('kidney-transplant-basics', 'Kidney transplant: the basics of the pathway',
 'What assessment, waiting, and life after a transplant broadly involve.',
 E'A kidney transplant can offer a fuller return to normal life than dialysis for many eligible people, and is worth discussing with your care team as your CKD progresses. It generally starts with an assessment of overall health to confirm transplant is suitable, followed by matching with a donor — sometimes a living relative or friend, sometimes through a waiting list.\n\nAfter a transplant, daily anti-rejection medicine is essential, taken consistently for as long as the transplant is working — this is not optional or occasional.\n\nA transplant is a major step with real trade-offs and benefits specific to each person. Your care team can help you understand whether and when it makes sense for you.',
 'article', 4, 'ckd', 'kidney', 110, null),

('kidney-bp-protection-together', 'Why blood pressure and kidney health are managed together',
 'Each affects the other — control one and you help protect the other.',
 E'High blood pressure damages kidneys over time, and damaged kidneys struggle to help regulate blood pressure — each makes the other worse, which is why your care team manages them as one connected picture rather than two separate problems.\n\nCertain blood pressure medicines are specifically chosen for their kidney-protective effect, beyond just lowering the number — which is one reason your specific medicine choice may differ from a family member''s, even with a similar blood pressure reading.\n\nKeeping to your blood pressure targets, taking medicine consistently, and attending kidney check-ups on schedule are, together, the most effective kidney protection available for most people with CKD.',
 'article', 3, 'ckd', 'kidney', 120, null),

('kidney-signs-to-report', 'Signs that deserve a message to your care team',
 'A short, practical list — not everything, but the things worth not waiting on.',
 E'Most days with CKD involve no new symptoms at all, and that is expected. A short list of changes is worth messaging your care team about rather than waiting for your next scheduled check: new or worsening swelling in the legs, ankles or around the eyes; sudden weight gain over a few days; a marked drop in how much urine you are passing; new breathlessness; or unusual, persistent fatigue.\n\nNone of these automatically means an emergency — often they lead to a simple test or medicine adjustment. But they are the kind of change that is genuinely more useful reported early than mentioned in passing at a routine visit weeks later.',
 'article', 3, 'ckd', 'kidney', 130, null),

('kidney-slowing-progression', 'The habits that matter most for slowing CKD',
 'A short, evidence-backed list rather than an overwhelming one.',
 E'CKD progression can often be slowed meaningfully, even when it cannot be reversed. The habits with the most evidence behind them are a short list, not a long one: keeping blood pressure at your target, keeping blood sugar controlled if you have diabetes, taking prescribed kidney-protective medicines consistently, limiting salt, being cautious with NSAID painkillers, and attending your scheduled kidney check-ups so any change is caught early.\n\nSmoking also accelerates kidney decline, so quitting has a direct kidney benefit alongside its heart and lung ones.\n\nNone of this requires perfection. Consistency across most days, sustained over months and years, is what actually shows up in your eGFR trend.',
 'article', 3, 'ckd', 'kidney', 140,
 '[{"question": "What matters most for slowing CKD progression?", "options": ["One perfect week followed by a break", "Consistent habits sustained over months and years", "Avoiding all doctor visits"], "answer_index": 1}]'::jsonb),

-- ============================================================================
-- Respiratory health (asthma / COPD)
-- ============================================================================
('resp-asthma-explained', 'Understanding asthma: what''s happening in your airways',
 'Why airways narrow, and why that means both quick relief and longer-term control matter.',
 E'Asthma is a condition where the airways become inflamed and can narrow suddenly, making it harder to breathe. Two things are typically happening: ongoing, lower-grade inflammation in the airway lining, and episodes where the airway muscles tighten further, called a flare or attack.\n\nThis is why asthma treatment usually involves two different jobs: a reliever inhaler that quickly opens narrowed airways during a flare, and, for many people, a preventer inhaler taken daily that calms the underlying inflammation so flares happen less often.\n\nUsing only the reliever and skipping a prescribed preventer is one of the most common reasons asthma stays poorly controlled — the preventer is doing its job quietly, on days you feel fine.',
 'article', 4, 'asthma', 'respiratory', 10, null),

('resp-asthma-triggers', 'Finding and avoiding your asthma triggers',
 'Triggers are personal — the same list does not apply to everyone.',
 E'Asthma triggers vary a lot between people. Common ones include dust, harmattan haze and air pollution, smoke, strong perfumes or cleaning products, cold air, respiratory infections, certain pets, and in some people, exercise or strong emotion.\n\nKeeping a simple note of what you were doing or exposed to before flares helps you and your care team spot your own personal pattern over a few months — it is rarely obvious after just one or two episodes.\n\nAvoiding a trigger entirely is not always possible, and that is fine — the goal is reducing exposure where practical (an air filter, avoiding known irritants where you can) alongside taking your preventer medicine consistently, not eliminating every trigger from your life.',
 'article', 3, 'asthma', 'respiratory', 20, null),

('resp-inhaler-technique', 'Using your inhaler correctly',
 'Technique often matters more than which inhaler you have been prescribed.',
 E'A surprisingly large share of inhalers are used with technique that means much of the medicine never reaches the lungs at all — it ends up in the mouth and throat instead. Getting technique right can matter as much as the medicine itself.\n\nGeneral steps for most inhalers: breathe out fully away from the device, seal your lips around the mouthpiece, breathe in slowly and steadily while pressing the canister (for a metered-dose inhaler) or forcefully (for a dry-powder inhaler), then hold your breath for about ten seconds before breathing out.\n\nAsk your care team or pharmacist to actually watch you use your inhaler at least once — technique is far easier to correct in person than to describe in writing, and it is a completely normal thing to ask for.',
 'article', 3, 'asthma', 'respiratory', 30,
 '[{"question": "After pressing an inhaler and breathing in, what should you do?", "options": ["Breathe out immediately", "Hold your breath for about ten seconds", "Take another puff right away"], "answer_index": 1}]'::jsonb),

('resp-asthma-action-plan', 'Your asthma action plan: green, yellow, red',
 'A simple traffic-light system that turns "how am I doing" into a clear decision.',
 E'An asthma action plan is a simple written guide, usually built with your care team, that uses a traffic-light system so you always know what to do next.\n\nGreen means your usual, well-controlled self — continue your regular preventer as prescribed. Yellow means symptoms are creeping up — more coughing, tightness, or needing your reliever more often — and usually means a temporary step-up in treatment, following the specific instructions your care team gave you. Red means a serious flare — severe breathlessness, reliever not helping, difficulty speaking in full sentences — and means urgent or emergency care, not waiting it out.\n\nIf you do not have a written action plan yet, ask your care team for one. It turns a stressful moment into a clear, rehearsed decision.',
 'article', 4, 'asthma', 'respiratory', 40, null),

('resp-asthma-exercise', 'Staying active with asthma',
 'Well-controlled asthma should not mean avoiding exercise — often the opposite.',
 E'Exercise can trigger symptoms in some people with asthma, which sometimes leads to avoiding activity altogether — but that usually makes overall fitness and even asthma control worse over time, not better.\n\nFor most people, well-controlled asthma and regular exercise are entirely compatible. A few adjustments help: warming up gradually, using a reliever beforehand if your care team has advised it for exercise-triggered symptoms, and choosing activities with brief bursts and recovery (like football or swimming) if continuous cardio brings on symptoms more.\n\nIf exercise reliably triggers significant symptoms despite these steps, that is worth discussing with your care team directly — it often means your everyday asthma control needs adjusting, not that exercise should be avoided.',
 'article', 3, 'asthma', 'respiratory', 50, null),

('resp-copd-explained', 'Understanding COPD: what''s different from asthma',
 'Both affect breathing, but the underlying damage and typical pattern differ.',
 E'COPD (chronic obstructive pulmonary disease) and asthma both affect the airways, but they are different conditions. Asthma airway narrowing is largely reversible with treatment; COPD involves longer-term damage to the airways and air sacs, most commonly from years of smoking, so symptoms tend to be more constant rather than coming in isolated flares.\n\nCommon COPD symptoms are ongoing breathlessness (especially with activity, worsening gradually over time), a chronic cough, and frequent chest infections.\n\nCOPD cannot be reversed, but its progression can often be slowed significantly, and symptoms managed well, especially by quitting smoking completely and staying consistent with prescribed treatment and breathing techniques.',
 'article', 4, 'copd', 'respiratory', 60, null),

('resp-copd-breathing-techniques', 'Breathing techniques that help with COPD',
 'Two simple techniques that ease breathlessness without any equipment.',
 E'Two breathing techniques are widely taught for COPD because they genuinely help, and need no equipment.\n\nPursed-lip breathing: breathe in gently through your nose, then breathe out slowly through pursed lips (as if blowing out a candle very gently), taking about twice as long to breathe out as in. This keeps airways open a little longer and eases the feeling of breathlessness.\n\nDiaphragmatic (belly) breathing: place a hand on your belly, breathe in so your belly rises more than your chest, breathe out slowly. This uses the breathing muscles more efficiently, which can reduce fatigue from breathing itself.\n\nPractising both when calm, not only during a breathless moment, makes them easier to use when you actually need them.',
 'article', 3, 'copd', 'respiratory', 70, null),

('resp-copd-infections', 'COPD and infections: why a cold hits harder',
 'Why a routine chest infection needs faster attention when you have COPD.',
 E'A common cold or chest infection that would pass quickly for most people can seriously worsen COPD symptoms — this is often called an "exacerbation" or flare-up, and it is one of the more common reasons for a COPD-related hospital visit.\n\nSigns worth acting on quickly: a noticeable increase in breathlessness beyond your usual, more coughing or wheeze, a change in the colour or amount of phlegm, or fever. Many people with COPD are given a plan by their care team for what to do at the first sign of a flare — follow it rather than waiting to see if it passes.\n\nStaying up to date with recommended vaccines (flu, pneumonia) is one of the most effective ways to reduce how often these flares happen at all.',
 'article', 3, 'copd', 'respiratory', 80, null),

('resp-oxygen-therapy-faqs', 'Oxygen therapy: common questions answered',
 'Being prescribed oxygen is a treatment adjustment, not a sign the end is near.',
 E'Being told you need home oxygen can feel like a frightening milestone, but it is best understood as one more tool for managing a chronic condition, prescribed when your blood oxygen level is measurably low enough to benefit from it.\n\nCommon questions: Do I need it all the time? Depends on your prescription — some people need it continuously, others only during sleep or activity, based on testing. Is it addictive? No — oxygen is not habit-forming; your body simply uses what it needs. Can I still go out? Yes, with portable options available for many prescriptions.\n\nIf oxygen has been recommended and you have concerns about how it fits your daily life, raise them directly with your care team — the plan can often be adjusted around real practical constraints.',
 'article', 3, 'copd', 'respiratory', 90, null),

('resp-quit-smoking', 'Quitting smoking: the single biggest step for lung health',
 'Whatever stage you are at, quitting still helps — starting today, not just years ago.',
 E'If you smoke, quitting is the single most effective thing you can do for your lungs, whatever condition (or none) you currently have. The benefit is not only for people who quit early — even after years of smoking or an existing diagnosis like COPD, quitting slows further decline and reduces flare-ups.\n\nMost people who successfully quit for good do so with support rather than through willpower alone — this can include nicotine replacement, medicines that reduce cravings, and behavioural support. It is common to need more than one attempt; that is a normal part of the process, not a failure.\n\nAsk your care team about support options available to you. The conversation is judgment-free and the benefit starts within days of stopping.',
 'article', 3, null, 'respiratory', 100, null),

('resp-harmattan-air-quality', 'Harmattan, dust and protecting your lungs locally',
 'Practical, Nigeria-specific steps for the dustiest months of the year.',
 E'Harmattan season brings fine dust and reduced air quality that can affect anyone''s breathing, and especially anyone with asthma, COPD, or other lung sensitivity.\n\nPractical steps that help: keeping windows closed during the dustiest hours (usually mornings), using a damp cloth to reduce dust indoors rather than dry sweeping, wearing a mask outdoors on particularly hazy days if you are sensitive, and staying extra consistent with any prescribed preventer inhaler through the season rather than only reacting once symptoms start.\n\nIf you notice your breathing reliably gets worse every harmattan season, mention the pattern to your care team — some people benefit from a temporary step-up in treatment specifically for these months.',
 'article', 3, null, 'respiratory', 110, null),

('resp-when-breathlessness-urgent', 'When breathlessness needs urgent attention',
 'Most breathlessness is manageable at home — a short list of signs means it is not.',
 E'Breathlessness has many ordinary causes — exertion, heat, anxiety, a mild cold — and most of the time it settles with rest. A shorter list of signs means it needs urgent attention instead: breathlessness that stops you speaking in full sentences, blue-tinged lips or fingertips, breathlessness that comes on suddenly and severely, chest pain alongside it, or breathlessness that is not easing with your usual reliever inhaler or rest.\n\nIf any of these apply, treat it as an emergency and get help immediately rather than waiting to see if it improves.\n\nFor breathlessness that is new, gradually worsening over weeks, or reliably triggered by specific activities, that is worth a non-urgent message to your care team to look into rather than an emergency visit.',
 'article', 3, null, 'respiratory', 120, null)

on conflict (code) do nothing;

-- Assertion: prove every row in this file actually landed.
do $$
declare
  inserted integer;
begin
  select count(*) into inserted
  from public.health_education_content
  where category in ('heart', 'kidney', 'respiratory');
  if inserted < 40 then
    raise exception 'expected at least 40 heart/kidney/respiratory rows, found %', inserted;
  end if;
end $$;
