-- Tarragon Health — Health Education library expansion: medicines/adherence
-- and family & child health. Pure browse categories (condition null) —
-- relevant to every patient regardless of chronic diagnosis. Same honesty
-- rule: clinician_reviewed left at its default false, no fabricated
-- reviewed_by_name/reviewed_at.

insert into public.health_education_content
  (code, title, summary, body, content_type, estimated_minutes, condition, category, sort_order, knowledge_check)
values

-- ============================================================================
-- Medicines & adherence
-- ============================================================================
('med-consistency-matters', 'Why taking medicine consistently matters more than people think',
 'Most chronic-condition medicines work by staying at a steady level, not by a single dose.',
 E'Many chronic-condition medicines — for blood pressure, diabetes, and others — work by keeping a steady level in your body over time, not by a single dose doing all the work. Taking it inconsistently means the level rises and falls, which is often less effective than taking a slightly lower dose perfectly consistently.\n\nThis is also why you may feel completely fine and be tempted to stop — the medicine is often doing quiet, invisible work rather than treating a feeling. Stopping without guidance can undo months of steady progress quickly.\n\nIf a medicine is hard to remember, causes side effects, or simply feels like too much, tell your care team. There is almost always an adjustment available — the goal is a plan you can actually stick to, not a perfect one you can''t.',
 'article', 3, null, 'medicines', 10, null),

('med-reminders-that-work', 'Setting up reminders that actually work',
 'The best reminder is the one tied to something you already do every day.',
 E'The most effective medicine reminders are usually not alarms on their own — they are tied to an existing daily habit: right after brushing your teeth, alongside breakfast, or when you plug in your phone at night. This is called "habit stacking," and it tends to outlast a generic alarm that gets dismissed on autopilot.\n\nA pill organiser sorted by day (and time, if you take medicine more than once daily) makes it obvious at a glance whether today''s dose was taken — useful for medicines taken far apart from any other routine.\n\nSet reminders in the app for anything you are still building into a habit, and revisit them once the habit feels automatic rather than leaving every reminder running forever.',
 'article', 2, null, 'medicines', 20, null),

('med-missed-dose', 'What to do if you miss a dose',
 'The general rule, and why "just double up" is usually the wrong instinct.',
 E'Missing an occasional dose happens to almost everyone, and panicking is not necessary — but doubling up to "catch up" is usually the wrong instinct and can cause its own problems.\n\nThe general rule of thumb: if you remember soon after the missed time, take it as normal. If it is nearly time for your next dose, skip the missed one and continue your regular schedule — do not take two at once unless a professional has specifically told you to for that medicine.\n\nThis general rule does not apply to every medicine equally — some (like certain diabetes or blood-thinning medicines) have specific instructions that matter. If you are ever unsure for a specific medicine, ask your care team or pharmacist rather than guessing.',
 'article', 2, null, 'medicines', 30,
 '[{"question": "You miss a dose and it''s nearly time for the next one. What''s the general rule?", "options": ["Take a double dose to catch up", "Skip the missed one and continue as normal", "Stop the medicine entirely"], "answer_index": 1}]'::jsonb),

('med-generic-vs-brand', 'Understanding generic vs brand medicines',
 'Same active ingredient, same effect, usually a lower price.',
 E'A generic medicine contains the same active ingredient, at the same dose, doing the same job as its brand-name equivalent — it is required to meet the same effectiveness and safety standards, not a lesser copy.\n\nThe price difference exists mainly because the brand covered the original research and marketing costs; once that exclusivity period ends, other manufacturers can produce the same medicine more cheaply.\n\nSwitching between a specific brand and its generic is usually fine, though for a small number of medicines with a narrow safety margin, your care team may prefer consistency — worth asking about for your specific prescriptions rather than assuming either way.',
 'article', 3, null, 'medicines', 40, null),

('med-storage', 'Storing your medicines correctly',
 'Heat and humidity, both common here, can quietly reduce how well a medicine works.',
 E'Most medicines are formulated to be stored at room temperature, away from direct heat, humidity and sunlight — conditions that are genuinely harder to guarantee in a hot, humid climate than the label sometimes assumes.\n\nAvoid storing medicine in a bathroom (humidity), a car, or anywhere near direct sun or a stove — heat and moisture can degrade some medicines faster than their printed expiry date would suggest, without any visible change in appearance.\n\nSome medicines (certain insulins, for example) specifically require refrigeration — always check the label or ask your pharmacist rather than assuming standard storage applies.',
 'article', 2, null, 'medicines', 50, null),

('med-side-effects-normal-vs-report', 'Medicine side effects: what''s normal, what to report',
 'Mild and short-lived is common; severe or persistent deserves a call.',
 E'Many medicines cause mild, often temporary side effects as your body adjusts — some nausea, mild dizziness, or drowsiness in the first days or weeks is common and often settles on its own.\n\nWorth reporting to your care team promptly rather than waiting: severe or worsening symptoms, anything affecting breathing or causing swelling of the face or throat, a rash, or any side effect significant enough that you are tempted to just stop taking the medicine quietly.\n\nStopping quietly is the outcome to avoid — telling your care team lets them adjust the dose, switch the medicine, or confirm the side effect is expected and likely to pass, rather than leaving your condition unmanaged.',
 'article', 3, null, 'medicines', 60, null),

('med-drug-interactions', 'Drug interactions: why your care team needs your full list',
 'Every medicine, supplement, and regular over-the-counter product — the full picture matters.',
 E'Medicines, supplements, and even some foods can interact with each other, sometimes making one less effective, sometimes making a side effect more likely. Your care team can only check for this if they know your complete, current list — including anything from a pharmacy without a prescription, and any regular herbal or traditional remedy.\n\nThis is why it is worth updating your medicine list here whenever anything changes, even something that feels minor, like starting a vitamin or an occasional painkiller you use often.\n\nWhen starting any new medicine, from any source, a quick check against your existing list is a simple, valuable habit — your pharmacist can usually do this check quickly if you are ever unsure.',
 'article', 3, null, 'medicines', 70, null),

('med-refills-avoiding-gap', 'Refilling on time: avoiding a gap',
 'A gap in a chronic-condition medicine can undo weeks of steady control quickly.',
 E'A gap between finishing one supply and starting the next is one of the most common, avoidable reasons a chronic condition drifts out of control — and it often happens simply from being busy, not from any deliberate choice to stop.\n\nRequesting a refill when you have roughly a week''s supply left, rather than waiting until the last dose, builds in a buffer for any delay in getting the next batch.\n\nIf cost or access is the real barrier to refilling on time, say so to your care team directly rather than just going without — there are often options (different pack sizes, generic alternatives, payment plans) that are easier to arrange before a gap happens than after.',
 'article', 2, null, 'medicines', 80, null),

('med-pregnancy-breastfeeding', 'Medicines during pregnancy and breastfeeding: always check first',
 'Some medicines are fine, some need adjusting, some need pausing — never assume, always ask.',
 E'Whether a medicine is safe during pregnancy or while breastfeeding varies a lot by the specific medicine — some are perfectly fine, some need a dose adjustment, and a smaller number need pausing or switching. There is no single safe blanket answer, which is exactly why this needs a specific check rather than a guess in either direction.\n\nIf you are pregnant, breastfeeding, or trying to conceive, tell your care team about every medicine you take, including regular over-the-counter ones, so each can be reviewed individually.\n\nDo not stop a prescribed medicine on your own out of caution before checking — for some conditions, stopping abruptly is riskier than continuing under guidance, so the conversation should always come first.',
 'article', 3, null, 'medicines', 90, null),

('med-traditional-herbal-remedies', 'Traditional and herbal remedies alongside prescribed medicine',
 'Many are safe on their own — the risk is usually in combination, not the remedy itself.',
 E'Traditional and herbal remedies are common alongside prescribed medicine, and many carry a long history of safe use — but "natural" does not automatically mean "no interaction with your prescribed medicine." Some herbal preparations genuinely affect how prescribed medicines are absorbed or broken down by the body.\n\nThis is not about discouraging traditional remedies — it is about your care team being able to check for interactions the same way they would for any other product, which they can only do if they know about it.\n\nMention any herbal or traditional remedy you take regularly, the same way you would a supplement or an over-the-counter medicine — it is a normal, judgement-free part of building your full medicine picture.',
 'article', 3, null, 'medicines', 100, null),

('med-understanding-prescription-label', 'Understanding your prescription label',
 'Decoding the shorthand your pharmacist writes.',
 E'Prescription labels often use shorthand that can look cryptic at first. Common ones: "OD" means once daily, "BD" or "BID" means twice daily, "TDS" or "TID" means three times daily, "PRN" means as needed rather than on a fixed schedule, and "PO" means by mouth.\n\nThe label also usually specifies timing relative to food ("with food," "on an empty stomach") — this is not a minor detail; it can significantly affect how well some medicines are absorbed or how likely they are to cause stomach upset.\n\nIf anything on your label is unclear, ask your pharmacist to explain it in plain terms before you leave — this is one of the most normal, expected questions a pharmacist handles.',
 'article', 2, null, 'medicines', 110,
 '[{"question": "What does \"PRN\" mean on a prescription label?", "options": ["Take before meals only", "As needed, not on a fixed schedule", "Take at night only"], "answer_index": 1}]'::jsonb),

('med-childrens-dosing-safety', 'Medicines for children: dosing safely',
 'Weight-based dosing means a child''s dose is not a smaller guess of an adult one.',
 E'Children''s medicine doses are typically calculated by weight, not simply scaled down from an adult dose by guesswork — which is why an accurate, reasonably current weight matters when a dose is being calculated.\n\nAlways use the dosing device that comes with a liquid medicine (an oral syringe or the specific cup provided) rather than a household spoon, which varies too much in actual volume to dose accurately.\n\nNever give a child a medicine formulated for adults by simply giving a smaller amount — some medicines are genuinely unsuitable for children regardless of dose, and a proper children''s formulation or prescription is the safe route.',
 'article', 3, null, 'medicines', 120, null),

('med-when-safe-to-stop', 'When it''s safe to stop a medicine, and when it''s not',
 'Some medicines are meant to be finished; others are meant to continue indefinitely.',
 E'Some medicines — most antibiotics are the clearest example — are meant to be taken for the full prescribed course even after you feel better, because stopping early can let the underlying infection return, sometimes more resistant to treatment.\n\nOther medicines, particularly for chronic conditions like high blood pressure or diabetes, are generally meant to continue indefinitely, or until your care team specifically changes the plan — feeling fine is often a sign the medicine is working, not a sign it is no longer needed.\n\nThe safe general rule: never stop a prescribed medicine based on how you feel alone. If you want to stop or reduce something, that is a completely reasonable thing to discuss with your care team — just discuss it first.',
 'article', 3, null, 'medicines', 130, null),

('med-travelling-with-medicines', 'Travelling with your medicines',
 'A little preparation avoids a stressful gap far from home.',
 E'Travelling, especially by air, deserves a little medicine preparation. Keep medicines in their original, labelled packaging where possible, and carry essential daily medicines in hand luggage rather than checked baggage, in case luggage is delayed.\n\nPack a few days'' extra supply beyond your planned trip length, in case of delays — running short far from your usual pharmacy is a genuinely stressful situation worth avoiding in advance.\n\nFor international travel, especially with certain medicines (some pain, sleep or anxiety medicines have specific rules in different countries), it is worth checking destination-specific requirements ahead of time rather than discovering an issue at the airport.',
 'article', 2, null, 'medicines', 140, null),

-- ============================================================================
-- Family & child health
-- ============================================================================
('family-childhood-vaccine-schedule', 'The childhood vaccination schedule: what and when',
 'A brief, plain-language map of why vaccines are timed the way they are.',
 E'Childhood vaccines are timed around when a baby''s own immune system is developing and when natural protection from the mother (passed on before birth) starts to fade — the schedule is not arbitrary, it is built around when each vaccine works best and is most needed.\n\nMost schedules start at birth and continue through the early years with several rounds, covering protection against diseases that were once major causes of childhood illness and death, and remain genuinely serious wherever vaccination rates drop.\n\nKeeping your child''s vaccination record here, and staying close to the recommended schedule rather than spacing doses out casually, gives the fullest protection at the times it matters most. If a dose is missed or delayed, ask your care team about catching up — it is rarely too late to resume.',
 'article', 4, null, 'family_child', 10, null),

('family-growth-milestones', 'Growth milestones: what to expect and when to ask',
 'A wide normal range exists — knowing it prevents unnecessary worry and helps spot real delays.',
 E'Developmental milestones (sitting, walking, first words, and beyond) have a genuinely wide normal age range — a child reaching a milestone a bit later than a friend''s child is usually within normal variation, not a cause for alarm on its own.\n\nWhat is worth mentioning to your care team: a clear loss of a skill a child previously had, a milestone significantly outside the typical range with no catch-up over time, or a pattern across several areas at once rather than one isolated area.\n\nRoutine check-ups are built specifically to track this over time using growth charts and milestone checks — bringing questions there, even ones that feel minor, is exactly what those visits are for.',
 'article', 3, null, 'family_child', 20, null),

('family-common-childhood-illness', 'Common childhood illnesses: fever, ear infections, and more',
 'What''s ordinary and self-limiting, and what benefits from a proper look.',
 E'Children get sick often, especially in the early years while their immune system is building experience with common infections — this is a normal, if exhausting, part of early childhood, not usually a sign something is wrong with them.\n\nFevers, colds, and ear infections are among the most common. Most colds resolve on their own with rest and fluids; ear infections sometimes need treatment and are worth checking, especially with a young child who cannot describe pain clearly, showing instead as pulling at an ear, irritability, or trouble sleeping.\n\nKeeping a simple record of illnesses here helps your care team spot a pattern (unusually frequent infections, for example) that a single visit would not reveal on its own.',
 'article', 3, null, 'family_child', 30, null),

('family-child-fever-urgent-care', 'When a child''s fever needs urgent care',
 'Most fevers are manageable at home — a short list of signs means otherwise.',
 E'Fever itself, in an otherwise well child, is usually the body''s normal response to an infection rather than an emergency on its own — how the child is behaving generally matters more than the exact number on the thermometer.\n\nSigns that mean urgent care, rather than home management: a fever in a baby under three months old (any fever at this age warrants prompt medical attention), difficulty breathing, a rash that does not fade when pressed, unusual drowsiness or difficulty waking, a stiff neck, repeated vomiting, or the child seeming seriously unwell to you as a parent, even if you cannot pinpoint exactly why.\n\nTrust your own read of your child alongside this list — a parent''s sense that "something is different" is a genuinely valid reason to get checked, not something to second-guess.',
 'article', 3, null, 'family_child', 40,
 '[{"question": "A baby under three months old has a fever. What should happen?", "options": ["Monitor at home for a few days first", "Seek prompt medical attention", "Only worry if it lasts a week"], "answer_index": 1}]'::jsonb),

('family-introducing-solid-foods', 'Introducing solid foods safely',
 'Timing, textures, and the common worries most families share.',
 E'Most guidance points to introducing solid foods around six months, alongside continued breastfeeding or formula, rather than replacing it outright at that stage.\n\nStarting with single, simple foods before mixtures makes it easier to notice if a particular food causes a reaction. Textures generally progress gradually — from smooth purees to mashed, then soft finger foods — matching a baby''s developing ability to chew and swallow safely.\n\nCommon early worries — gagging (different from choking, and usually a normal reflex as babies learn to manage new textures) and food refusal (often needing several exposures before acceptance) — are typically part of the normal process rather than signs of a problem. Ask your care team if you are ever unsure about a specific food or reaction.',
 'article', 3, null, 'family_child', 50, null),

('family-managing-sick-child-home', 'Managing a sick child at home',
 'Practical comfort measures, and knowing when home care is enough.',
 E'For common, mild childhood illnesses, home care centres on a few practical basics: keeping the child hydrated (small, frequent sips if they are not drinking much), rest, and appropriate fever relief if they are uncomfortable, following correct weight-based dosing.\n\nWatching for the signs that mean it is time to seek care — worsening rather than improving after a couple of days, difficulty breathing, persistent vomiting preventing fluids, or your own sense that something is more than a routine illness — is more useful than fixating on any single symptom in isolation.\n\nMost childhood illness is genuinely manageable at home with these basics. The goal of knowing the warning signs is confidence, not anxiety — most of the time, home care is exactly the right response.',
 'article', 3, null, 'family_child', 60, null),

('family-child-safety-at-home', 'Child safety at home: practical steps',
 'A handful of changes address most common childhood accidents.',
 E'Most childhood accidents at home cluster around a predictable few causes: falls, poisoning (from medicines and household chemicals within reach), burns, and choking hazards — which means a handful of specific changes cover most of the real risk.\n\nStoring medicines and cleaning products up high or locked away (not just "out of sight," since children climb), keeping small objects and button batteries away from young children, and supervising closely around water, even shallow amounts, are the highest-value basics.\n\nA home that is completely risk-free is not a realistic goal, and does not need to be — addressing the few highest-risk categories covers most of what actually causes serious injury.',
 'article', 3, null, 'family_child', 70, null),

('family-talking-to-children-about-health', 'Talking to children about their own health',
 'Age-appropriate honesty builds trust and reduces fear more than vague reassurance.',
 E'Children generally cope better with age-appropriate honesty about their own health than with vague reassurance that turns out not to match what happens — a child who was told "it won''t hurt at all" before an injection that does hurt learns to distrust the next reassurance too.\n\nSimple, honest, calm explanations work well even for young children: naming what will happen, roughly what it might feel like, and that you will be there with them. For a chronic condition, involving a child gradually in understanding their own care, as age allows, builds confidence rather than fear over time.\n\nYour care team can help pitch explanations at the right level for your child''s age if you are unsure how much detail is appropriate for a specific situation.',
 'article', 3, null, 'family_child', 80, null),

('family-screen-time-health', 'Screen time and children''s health',
 'It is less about a strict hour limit and more about what screen time replaces.',
 E'Screen time guidance has shifted somewhat from rigid hour limits toward a more practical question: what is the screen time replacing? Time that displaces sleep, physical activity, or in-person interaction tends to be the actual concern, more than the number of minutes alone.\n\nPractical habits that help regardless of exact limits: no screens in the hour before bed (screen light can delay sleep onset), balancing screen time with active play, and being present and engaged during screen use with younger children rather than using it purely as unsupervised time.\n\nEvery family''s situation is different — the useful question is whether current habits are crowding out sleep, activity, and connection, not chasing a single universal number.',
 'article', 3, null, 'family_child', 90, null),

('family-health-history-together', 'Building your family health history together',
 'A family conversation that pays off for years of care decisions.',
 E'A family health history — which close relatives have had which conditions, and roughly at what age — is one of the most useful, and most commonly missing, pieces of information in a health record. It shapes screening timing, risk assessment, and sometimes treatment choices for you and your children.\n\nIt is worth having this conversation deliberately with parents, siblings, and grandparents while that information is available, rather than assuming it will always be easy to find out later.\n\nAdd what you learn here as you learn it — a family history does not need to be complete on day one, and updating it over time is normal and expected as more comes to light.',
 'article', 3, null, 'family_child', 100, null),

('family-caring-for-elderly-relative', 'Caring for an elderly family member: the basics',
 'A role many people take on gradually, often without formal preparation.',
 E'Caring for an ageing parent or relative often starts gradually — a bit more help here, a check-in call there — until it becomes a significant role many people never formally planned for or were trained to do.\n\nA few things help early: understanding their full medicine list and what each is for, knowing their care team''s contact details, and having a clear sense of their wishes around care decisions before a crisis forces a rushed conversation.\n\nCaregiver burnout is real and common — looking after your own health and wellbeing alongside caregiving is not a distraction from the role, it is what allows you to sustain it. Your own care team is a resource in this too, not only theirs.',
 'article', 3, null, 'family_child', 110, null),

('family-preparing-new-sibling', 'Preparing for a new sibling: supporting the older child',
 'A little preparation eases a big adjustment for an older child.',
 E'A new sibling is a major change from an older child''s point of view, even when the family is thrilled about it — some regression (in sleep, toileting, or behaviour) in the weeks around the birth is common and usually temporary.\n\nWhat tends to help: involving the older child in preparation in small, age-appropriate ways, protecting some one-on-one time with them after the baby arrives even briefly, and naming their feelings ("it''s okay to feel funny about the new baby") rather than only insisting they should be happy.\n\nThis phase generally settles within weeks to a few months as the new routine becomes familiar — consistency and patience matter more than any single perfect conversation.',
 'article', 3, null, 'family_child', 120, null),

('family-school-health-records', 'School health: what''s worth keeping on file',
 'A short, practical list that saves a scramble at enrolment time.',
 E'Schools typically ask for a specific, predictable set of health information at enrolment and periodically after: vaccination records, known allergies, any ongoing medical conditions, and current medicines, especially any needed during school hours.\n\nKeeping this organised here, rather than scattered across old papers, turns a stressful enrolment scramble into an export or a quick summary.\n\nIf your child has a condition that needs a plan at school (an allergy, asthma, or another condition requiring specific action), it is worth proactively sharing a clear written plan with the school rather than assuming staff will know what to do in the moment.',
 'article', 2, null, 'family_child', 130, null)

on conflict (code) do nothing;

-- Assertion: prove every row in this file actually landed.
do $$
declare
  inserted integer;
begin
  select count(*) into inserted
  from public.health_education_content
  where category in ('medicines', 'family_child');
  if inserted < 26 then
    raise exception 'expected at least 26 medicines/family_child rows, found %', inserted;
  end if;
end $$;
