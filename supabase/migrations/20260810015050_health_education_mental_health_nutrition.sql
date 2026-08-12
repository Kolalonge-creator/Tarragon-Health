-- Tarragon Health — Health Education library expansion: mental health and
-- nutrition. Pure browse categories (condition null) — relevant to every
-- patient regardless of chronic diagnosis. Same honesty rule: clinician_reviewed
-- left at its default false, no fabricated reviewed_by_name/reviewed_at.

insert into public.health_education_content
  (code, title, summary, body, content_type, estimated_minutes, condition, category, sort_order, knowledge_check)
values

-- ============================================================================
-- Mental & emotional wellbeing
-- ============================================================================
('mh-anxiety-explained', 'Understanding anxiety: what''s happening in your body',
 'Racing heart, tight chest, restlessness — the physical side of a very real response.',
 E'Anxiety is not "just in your head" — it is a real physical response: your body releases stress hormones that raise heart rate, tighten muscles, and sharpen alertness, the same system that once helped humans respond to danger.\n\nOccasional anxiety before something stressful is normal and even useful. It becomes worth addressing when it is frequent, hard to control, or is interfering with sleep, work, or relationships — that pattern is what your care team looks for, not the presence of anxiety at all.\n\nAnxiety disorders are common and very treatable, through therapy, practical coping skills, medicine, or a combination — there is no single "right" treatment, only what fits you.',
 'article', 3, null, 'mental_health', 10, null),

('mh-depression-more-than-sad', 'Understanding depression: more than sadness',
 'Low mood is one symptom among several — and some people barely notice it at all.',
 E'Depression is often pictured as constant sadness, but it commonly shows up differently: low energy, loss of interest in things you used to enjoy, changes in sleep or appetite, difficulty concentrating, or feeling persistently flat rather than actively sad.\n\nIt is different from a bad week or ordinary low mood by duration and impact — lasting most of the day, most days, for two weeks or more, and affecting daily functioning.\n\nDepression is a common, medical, treatable condition, not a personal failing or something to "snap out of." If this sounds familiar, mention it to your care team — the earlier it is addressed, the more options tend to be available.',
 'article', 3, null, 'mental_health', 20,
 '[{"question": "How is depression usually distinguished from an ordinary bad week?", "options": ["It only counts if you cry every day", "By duration (most days, two weeks+) and impact on daily life", "It is not a real medical condition"], "answer_index": 1}]'::jsonb),

('mh-stress-anxiety-burnout', 'Stress vs anxiety vs burnout: telling them apart',
 'Related, but different — and the useful response differs for each.',
 E'These three overlap but are not the same thing. Stress is a response to a specific pressure (a deadline, a bill, a difficult conversation) that usually eases once the pressure lifts. Anxiety can persist even without a clear, specific cause, and often comes with physical symptoms like a racing heart or tight chest. Burnout is a specific kind of exhaustion from prolonged, unrelenting stress — usually tied to work or caregiving — marked by depletion, cynicism, and reduced sense of accomplishment.\n\nKnowing which one you are experiencing helps: stress often responds to addressing the specific pressure; anxiety often benefits from coping skills or treatment; burnout usually needs a genuine reduction in load, not just better coping.\n\nIf you are not sure which applies to you, that is a reasonable thing to bring to your care team rather than figuring out alone.',
 'article', 3, null, 'mental_health', 30, null),

('mh-when-to-seek-help', 'When to seek help: signs it''s time',
 'You do not need to hit a crisis point before reaching out.',
 E'There is a common misconception that mental health support is only for a crisis. In reality, the earlier you reach out, the more options are usually available, and the easier things tend to be to address.\n\nSigns worth acting on: feelings that are affecting your work, relationships, or daily functioning; symptoms lasting more than two weeks; using alcohol or other substances to cope; withdrawing from people you would normally connect with; or simply a persistent sense that something is not right, even without a clear label for it.\n\nAny thought of harming yourself is always worth immediate attention — reach out to your care team or emergency services right away, not later.',
 'article', 3, null, 'mental_health', 40, null),

('mh-talking-to-care-team', 'Talking to your care team about mental health',
 'It is treated with the same seriousness and privacy as any physical symptom.',
 E'Bringing up a mental health concern can feel harder than describing a physical one, but your care team treats it with exactly the same seriousness, privacy, and lack of judgement.\n\nYou do not need the "right" words or a clear diagnosis in mind — describing what you have noticed (sleep changes, low energy, persistent worry, mood shifts) is enough to start the conversation. It is also fine to write it down beforehand if that feels easier than saying it out loud.\n\nWhat happens next varies by what you are experiencing — sometimes a conversation and coping strategies, sometimes a referral, sometimes medicine — but it starts with simply raising it, which is very often the hardest part.',
 'article', 2, null, 'mental_health', 50, null),

('mh-sleep-mental-health-link', 'Sleep and mental health: the two-way link',
 'Poor sleep worsens mental health, and poor mental health worsens sleep — breaking the cycle from either side helps.',
 E'Sleep and mental health influence each other in both directions: poor sleep makes anxiety and low mood measurably worse, and anxiety or low mood, in turn, make sleep harder to get — a cycle that can feel impossible to interrupt from inside it.\n\nThe useful news is that you can work on this from either direction — improving sleep habits often eases mood and anxiety symptoms somewhat, even before other treatment takes full effect, and treating the underlying mental health concern often improves sleep in turn.\n\nA consistent sleep and wake time, limiting screens before bed, and cutting evening caffeine are small, real starting points either way.',
 'article', 3, null, 'mental_health', 60, null),

('mh-grief-no-normal-timeline', 'Grief and loss: there''s no "normal" timeline',
 'Grief is not linear, and there is no fixed schedule for when it should end.',
 E'Grief after losing someone (or something significant — a relationship, a role, your health as it was) does not follow the tidy stages sometimes described. It is common to feel it come in waves, long after people expect you to have "moved on," and to feel a confusing mix of emotions at once.\n\nThere is no fixed timeline, and needing support months or even years later is not a sign that something is wrong with how you are grieving.\n\nWhat is worth raising with your care team: grief that feels stuck without any movement over a long period, or that comes with thoughts of harming yourself. Support, whether from people around you or a professional, is appropriate at any point in the process, not only right after a loss.',
 'article', 3, null, 'mental_health', 70, null),

('mh-supporting-family-member', 'Supporting a family member with mental health struggles',
 'What genuinely helps, and the trap of trying to "fix" it.',
 E'Watching someone you love struggle is hard, and the instinct to fix it quickly is natural — but what usually helps most is simpler and slower: listening without immediately problem-solving, letting them know you are available without pressuring them to talk, and gently encouraging professional support rather than trying to be their only source of help.\n\nAvoid minimising ("just think positive") or comparing to others'' struggles — even well-meant, these tend to make someone feel more alone, not less.\n\nSupporting someone else is genuinely draining too. Looking after your own wellbeing while supporting them is not selfish — it is what makes sustained support possible at all.',
 'article', 3, null, 'mental_health', 80, null),

('mh-coping-skills-anxious-moments', 'Coping skills for anxious moments',
 'A few practical techniques that work in the moment, not just in theory.',
 E'A few grounding techniques genuinely help in an anxious moment, and are worth practising when calm so they are easier to use when you need them.\n\nSlow breathing: in for four counts, hold for four, out for six — the longer exhale specifically signals your body to calm down. The 5-4-3-2-1 technique: name five things you can see, four you can touch, three you can hear, two you can smell, one you can taste — it interrupts spiralling thoughts by anchoring attention in the present. Physical movement, even brief, helps discharge the stress-hormone response your body has already triggered.\n\nThese ease a moment; they are not a substitute for addressing anxiety that is frequent or significant — that is worth raising with your care team.',
 'article', 3, null, 'mental_health', 90,
 '[{"question": "Why does a longer exhale help calm anxiety?", "options": ["It has no real effect, it is just a distraction", "It signals your body''s calming response", "It only works for certain people"], "answer_index": 1}]'::jsonb),

('mh-substance-use-overlap', 'Substance use and mental health: the overlap',
 'Using alcohol or other substances to cope is common, and worth addressing directly.',
 E'It is common to reach for alcohol or other substances to manage difficult feelings, and just as common not to notice how much that has become the main coping strategy. In the short term it can seem to help; over time it usually worsens the underlying anxiety or low mood, and can create a second problem alongside the first.\n\nThis is not about judgement — it is a genuinely common overlap, and one your care team is equipped to help with directly and without stigma, treating both together rather than requiring one to be solved before addressing the other.\n\nIf you have noticed yourself using alcohol or anything else specifically to cope with difficult emotions, that pattern itself is worth mentioning, even before it feels like "a problem."',
 'article', 3, null, 'mental_health', 100, null),

('mh-chronic-illness-link', 'Mental health and chronic illness: why they''re managed together',
 'Living with a long-term condition affects mental health, and mental health affects how well the condition is managed.',
 E'Living with a chronic condition like diabetes or hypertension carries a real emotional load — some people describe fatigue with the constant management ("burnout"), and rates of anxiety and depression are measurably higher among people managing a chronic condition than the general population.\n\nThis matters clinically, not just personally: mental health struggles make it harder to keep up with medicines, appointments and healthy habits, which in turn affects the physical condition — the two are genuinely linked, not separate boxes.\n\nThis is exactly why your care team asks about mood and coping alongside your physical numbers. If chronic illness management feels overwhelming, that is worth naming directly, not just pushing through quietly.',
 'article', 3, null, 'mental_health', 110, null),

('mh-postnatal-awareness', 'Postnatal mental health: what families should know',
 'Beyond "baby blues" — recognising when a new parent needs more support.',
 E'"Baby blues" (brief mood dips in the first couple of weeks after birth) are common and usually pass on their own. Postpartum depression and anxiety are different — more intense, lasting beyond two weeks, and can affect either parent, not only the birthing parent.\n\nSigns worth taking seriously: persistent sadness or anxiety, difficulty bonding with the baby, feeling unable to cope, or intrusive frightening thoughts. These are common, treatable, and not a reflection of poor parenting — but they are easy to miss or dismiss as normal exhaustion.\n\nFamily members are often the first to notice, since the person experiencing it may not recognise it themselves. Gently encouraging them to speak to their care team is genuinely one of the most helpful things you can do.',
 'article', 3, null, 'mental_health', 120, null),

('mh-childrens-mental-health', 'Children''s mental health: signs parents can watch for',
 'Children express distress differently than adults do — often through behaviour, not words.',
 E'Children, especially younger ones, often cannot name what they are feeling the way an adult can — distress tends to show up as behaviour instead: withdrawal, irritability, changes in sleep or appetite, regression to younger behaviours, drop in school performance, or physical complaints (stomach aches, headaches) with no clear physical cause.\n\nSome of this is a normal part of growing up and passes on its own. What is worth a proper conversation with your care team: a pattern lasting several weeks, a change that followed a specific event (a loss, a house move, bullying), or anything affecting school or friendships significantly.\n\nChildren respond very well to support when it comes early — noticing and naming the pattern is the hardest and most important first step.',
 'article', 3, null, 'mental_health', 130, null),

('mh-building-support-network', 'Building a support network: why it matters as much as treatment',
 'Connection is not a nice extra — it is a genuine, evidence-backed part of mental health.',
 E'Social connection is not just a pleasant add-on to mental health treatment — people with stronger support networks measurably recover faster and cope better with both mental and physical health challenges.\n\nA support network does not need to be large. A few people you can genuinely be honest with, a community or faith group, or a support group of people managing something similar, all count and each serves a slightly different purpose.\n\nIf you feel you do not have this right now, that is common, especially after a move, a loss, or a long period of managing health challenges — and it is a reasonable thing to build deliberately, including with your care team''s support, rather than something you either have or don''t.',
 'article', 3, null, 'mental_health', 140, null),

-- ============================================================================
-- Nutrition & everyday habits
-- ============================================================================
('nutrition-balanced-plate', 'Building a balanced plate for everyday meals',
 'A simple visual guide that works with any cuisine, including everyday Nigerian meals.',
 E'You do not need to weigh food to eat a balanced meal — picturing your plate in proportions works just as well. Roughly half non-starchy vegetables (greens, okra, garden egg, cabbage), a quarter protein (fish, chicken, beans, eggs), and a quarter starch (rice, yam, swallow, bread, plantain).\n\nMost everyday plates lean heavily toward the starch quarter — that is usually the easiest place to make room for more vegetables and protein without feeling like you are dieting.\n\nThis is a flexible guide, not a rigid rule — the goal across a week is the general pattern, not perfection at every single meal.',
 'article', 3, null, 'nutrition', 10, null),

('nutrition-reading-food-labels', 'Reading a food label without getting overwhelmed',
 'The three things worth checking, and the rest you can mostly ignore.',
 E'Food labels can feel overwhelming with dozens of numbers. Three things are worth actually checking: serving size (numbers below it are often per small serving, not the whole pack — easy to underestimate), added sugar (look for it listed directly, or ingredients like syrup, glucose, sucrose high on the ingredient list), and sodium (salt) content, especially for processed and packaged food.\n\nIngredients are listed by quantity, largest first — if sugar or oil appears in the first three ingredients, that tells you a lot quickly without reading the whole label.\n\nYou do not need to analyse every label for every purchase — learning your regular items once is usually enough to guide better choices going forward.',
 'article', 3, null, 'nutrition', 20,
 '[{"question": "How are ingredients ordered on a food label?", "options": ["Alphabetically", "By quantity, largest first", "Randomly"], "answer_index": 1}]'::jsonb),

('nutrition-hydration-how-much', 'Hydration: how much water do you actually need',
 'The "8 glasses" rule is a rough guide, not a strict requirement — and food counts too.',
 E'The commonly quoted "eight glasses a day" is a reasonable rough guide, not a precise medical requirement — actual needs vary by body size, activity, climate, and what else you eat and drink, since food (especially fruit, vegetables and soup) also contributes meaningfully to hydration.\n\nA simple, practical check: pale yellow urine generally suggests you are adequately hydrated; noticeably dark urine is a reasonable sign to drink more, especially in hot weather or after activity.\n\nWater is the best default choice — it hydrates without adding sugar or calories, unlike many other drinks that people reach for out of habit rather than actual thirst.',
 'article', 2, null, 'nutrition', 30, null),

('nutrition-hidden-sugar', 'Sugar: hidden sources in everyday food and drink',
 'Most excess sugar comes from drinks and processed food, not the sugar bowl.',
 E'Added sugar adds up fastest through drinks — soft drinks, sweetened juice, malt drinks, and sweetened tea or coffee can each carry a surprising amount, often without feeling like "eating sugar" at all since they are liquid.\n\nIt also hides in places that do not taste overtly sweet: bread, sauces, flavoured yoghurt, and some seasoning blends can all carry added sugar you would not necessarily expect.\n\nThe single highest-impact change for most people is cutting sweetened drinks specifically — swapping even one sugary drink a day for water is often a bigger change than several smaller food tweaks combined.',
 'article', 3, null, 'nutrition', 40, null),

('nutrition-healthy-fats', 'Healthy fats vs unhealthy fats, explained simply',
 'Not all fat is equal — the type matters more than the total amount for most people.',
 E'Fat has been unfairly treated as universally bad in the past — the type of fat matters more than simply the amount for most health outcomes.\n\nFats worth favouring: those in fish, groundnuts, avocado, and unrefined vegetable oils used in moderation — these support heart health. Fats worth limiting: those in fried food, processed snacks, and some margarines and shortenings, which are more strongly linked to raised cholesterol and heart risk.\n\nA practical swap that helps most: choosing grilled or boiled over deep-fried more often, and using oil more sparingly rather than eliminating it — small, sustained changes here move cholesterol more reliably than an all-or-nothing approach.',
 'article', 3, null, 'nutrition', 50, null),

('nutrition-fibre-matters', 'Fibre: why it matters more than most people think',
 'It slows sugar absorption, feeds healthy gut bacteria, and keeps you full.',
 E'Fibre, found in vegetables, fruit, beans, and wholegrains, does more work than most people realise: it slows how quickly sugar enters the bloodstream (helpful for blood sugar control), feeds beneficial gut bacteria, supports regular digestion, and helps you feel full for longer at the same number of calories.\n\nMost people eat noticeably less fibre than is genuinely beneficial. Easy ways to add more: beans a few times a week, vegetables at most meals rather than as an afterthought, and choosing less-refined starches (unripe plantain, wholegrain where available) over their more refined equivalents.\n\nIncrease fibre gradually rather than all at once — a sudden large jump can cause temporary bloating that easing in avoids.',
 'article', 3, null, 'nutrition', 60, null),

('nutrition-portion-sizes-no-scale', 'Portion sizes without a scale',
 'Your hand is a surprisingly reliable, always-available measuring tool.',
 E'You do not need a kitchen scale to eat sensible portions — your own hand offers a rough, practical guide that travels with you everywhere. A portion of protein is roughly the size and thickness of your palm. A portion of starch (rice, yam, swallow) is roughly a cupped handful. A portion of fat (oil, groundnut) is roughly a thumb''s worth. Vegetables, generally, are the one category to serve generously without much concern.\n\nThis is a rough guide, not a precise science — it is meant to build a general sense of proportion over time, useful especially when eating away from home where weighing is not an option.\n\nUse it as a starting reference, then trust the sense of scale it builds after a few weeks of noticing.',
 'article', 2, null, 'nutrition', 70, null),

('nutrition-meal-prep-budget', 'Meal prep on a budget',
 'Eating well and spending less are not opposites — a few habits make both easier.',
 E'Eating well on a limited budget is genuinely achievable with a few habits. Beans, eggs and locally grown vegetables are typically among the most affordable, nutrient-dense options available, and hold their own against far more expensive alternatives.\n\nBuying and cooking in slightly larger batches, then portioning for a few days, saves both time and money compared to cooking small amounts repeatedly. Seasonal, local produce is usually cheaper and fresher than imported or out-of-season alternatives.\n\nPlanning a few meals ahead, even loosely, reduces the last-minute takeout or processed-food purchases that tend to cost more per meal than home cooking, healthy or not.',
 'article', 3, null, 'nutrition', 80, null),

('nutrition-eating-while-travelling', 'Eating well while travelling or at work',
 'Structure, not willpower, is what keeps eating on track away from home.',
 E'Eating well away from your normal routine is harder mainly because the structure that usually supports good choices disappears — no fridge of familiar food, less control over what is available, different schedules.\n\nA few things that genuinely help: carrying a simple snack (nuts, fruit) so hunger does not force a rushed, less considered choice; scanning a menu for the vegetable and protein options first before deciding; and not treating one less-than-ideal meal as a reason to abandon the rest of the day or trip.\n\nConsistency across most days and most trips is what actually matters for your health numbers — not a perfect record with no exceptions.',
 'article', 2, null, 'nutrition', 90, null),

('nutrition-street-food-eating-out', 'Street food and eating out: smarter choices',
 'You do not need to avoid eating out — a few swaps make a real difference.',
 E'Eating out does not have to mean abandoning healthy habits. A few swaps make a real difference without requiring you to avoid your favourite spots: choosing grilled, boiled, or roasted over deep-fried where available; asking for stew or sauce on the side so you control how much you add; and choosing water or an unsweetened drink over a sweetened one.\n\nPortion sizes at many food spots are often larger than a typical home serving — sharing, or simply not finishing everything served, is a reasonable and normal choice, not wasteful.\n\nThe goal is making eating out compatible with your health, not off-limits — most people eat out sometimes, and that is entirely fine within an otherwise balanced pattern.',
 'article', 3, null, 'nutrition', 100, null),

('nutrition-vitamins-supplements', 'Vitamins and minerals: do you need a supplement?',
 'Most people get what they need from food — a few situations genuinely call for more.',
 E'For most healthy adults eating a varied diet, a general multivitamin adds little benefit — the nutrients are usually already covered by food, and supplements are not a substitute for an unbalanced diet.\n\nThat said, some situations genuinely benefit from a specific supplement: folic acid before and during early pregnancy, vitamin D if you get very little sun exposure, iron if you have been diagnosed with iron-deficiency anaemia, or specific supplements your care team recommends for a particular condition.\n\nThe useful rule: a targeted supplement for an identified need, based on your care team''s advice or a blood test, rather than a general "just in case" habit with no specific reason behind it.',
 'article', 3, null, 'nutrition', 110, null),

('nutrition-protein-how-much', 'Protein: how much and from where',
 'Beans, fish, eggs and chicken all count — and most people need less than the marketing suggests.',
 E'Protein needs are generally more modest than fitness marketing often implies for most people, though needs are somewhat higher for older adults, and for anyone doing regular strength training.\n\nGood sources, several of them budget-friendly: beans and legumes, eggs, fish, chicken, and moi moi. Spreading protein across meals through the day, rather than concentrating it all at dinner, tends to be more effective for muscle maintenance and fullness.\n\nYou do not need protein powders or supplements to meet your needs — whole food sources cover it well for the vast majority of people, and are typically both cheaper and more filling.',
 'article', 2, null, 'nutrition', 120, null),

('nutrition-cooking-oils', 'Cooking oils: choosing and using them well',
 'The amount you use usually matters more than which specific oil you choose.',
 E'Different cooking oils have somewhat different fat profiles, but for most home cooking, how much oil you use matters more than exactly which oil you choose. Measuring or being mindful of oil quantity, rather than pouring freely, is the highest-impact single change.\n\nReusing oil for frying multiple times, especially at high heat, breaks it down and creates compounds worth avoiding — freshly used oil, in reasonable amounts, is the better default over heavily reused oil.\n\nUnrefined oils used in moderation (groundnut, olive where available) are a reasonable everyday choice; the goal is moderate, mindful use rather than eliminating oil or fixating on finding one "perfect" type.',
 'article', 2, null, 'nutrition', 130, null),

('nutrition-fasting-practices', 'Fasting practices and your health: what to know',
 'Whether for faith or other reasons, a few practical steps make fasting safer.',
 E'Many people fast for religious reasons at points in the year, and fasting is generally safe for healthy adults with a few sensible precautions — though anyone managing a chronic condition, pregnant, or on regular medicine should talk to their care team beforehand, since fasting can genuinely change medicine timing and dosing needs.\n\nPractical tips for those who can fast safely: prioritise hydration and a balanced meal at the times you do eat rather than making up for the day with very heavy or very sugary meals, and break a fast gradually rather than with a large sudden meal, which can cause discomfort.\n\nIf you have diabetes, low blood pressure, or another condition affected by fasting, this is exactly the kind of plan your care team can help you adjust safely, rather than skipping medicine or your usual monitoring during the fasting period.',
 'article', 3, null, 'nutrition', 140, null),

('nutrition-childrens-habits', 'Building healthy eating habits in children early',
 'What actually works, and the pressure tactics that tend to backfire.',
 E'Children''s eating habits form early and tend to stick — but pressure and bribery ("finish your vegetables to get dessert") often backfire, teaching a child to see vegetables as a chore and dessert as the real prize.\n\nWhat tends to work better: regularly offering a variety of foods without forcing them (repeated exposure, even without eating, increases familiarity and eventual acceptance), involving children in simple food preparation, and eating the same foods together as a family rather than preparing separate "children''s meals."\n\nIt is normal for children to reject a new food multiple times before accepting it — persistence without pressure, over weeks, tends to work far better than a single mealtime battle.',
 'article', 3, null, 'nutrition', 150, null),

('nutrition-alcohol-hidden-calories', 'Alcohol and nutrition: the calories you don''t see',
 'Alcoholic drinks carry real calories that are easy to overlook.',
 E'Alcoholic drinks carry meaningful calories — beer, wine and spirits all contribute, often more than people account for when thinking about their overall eating pattern, since drinks are rarely tracked the way food is.\n\nBeyond calories, alcohol also tends to lower inhibition around other food choices later in the same evening, and interferes with sleep quality even when it does not feel like it at the time.\n\nThis is not about eliminating alcohol — it is about being aware it is part of the overall picture, the same as any other calorie source, and factoring it in rather than treating it as separate from "what I ate today."',
 'article', 2, null, 'nutrition', 160, null)

on conflict (code) do nothing;

-- Assertion: prove every row in this file actually landed.
do $$
declare
  inserted integer;
begin
  select count(*) into inserted
  from public.health_education_content
  where category in ('mental_health', 'nutrition');
  if inserted < 28 then
    raise exception 'expected at least 28 mental_health/nutrition rows, found %', inserted;
  end if;
end $$;
