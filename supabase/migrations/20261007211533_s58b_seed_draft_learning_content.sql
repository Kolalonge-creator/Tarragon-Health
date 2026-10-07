-- S58b: DRAFT narration scripts seeded as non-servable learning rows (10 myth-busting scripts, 10 blood pressure micro-lessons).
-- Source: docs/content/ (drafted 2026-10-07, branch s55-60/content-drafts). Nothing here is clinical approval and nothing is published.
--
-- Rows affected: 20 new health_education_content rows (status draft, is_active false) and 1 new inactive programme
-- (bp_care_course) with 10 modules; 10 modules are added to the existing inactive myth_busting series. 0 existing rows change.
--
-- Why each row cannot reach a patient: content_status is 'draft' (so is_active is false), and is_placeholder is TRUE on purpose:
-- the S55 publish gate refuses any placeholder, and clearing the flag needs a named clinical author and a body that does not start
-- with 'DRAFT PLACEHOLDER'. clinical_author_name and reviewed_by_name are null, clinician_reviewed is false, next_review_due is null.
-- The Chief Medical Officer approves each item (or sends it back) through the normal S55 flow; this migration signs nothing.
-- The micro-lesson check question is stored with NO answer options (options [] and answer_index null, the drafted answer kept as
-- answer_text): the clinical author writes the options. The published-integrity gate (next migration) refuses to publish a
-- micro-lesson whose check has fewer than two options, so an unfinished check cannot go live.
-- Pause markers in the drafted scripts are audio direction and are removed from the text body. No audio exists.

insert into public.health_education_programmes (code, title, description, category, is_active, sort_order, kind)
values ('bp_care_course', 'Blood pressure care course (10 days)',
        'DRAFT. Ten daily micro-lessons. INACTIVE until a clinical author has finalised and the Chief Medical Officer has approved every lesson.',
        'hypertension', false, 901, 'course')
on conflict (code) do nothing;

do $$
declare
  v_myth uuid; v_bp uuid; v_id uuid; r record; v_new integer := 0;
begin
  select id into v_myth from public.health_education_programmes where code = 'myth_busting';
  select id into v_bp from public.health_education_programmes where code = 'bp_care_course';
  for r in select * from (values
  ('myth-01','myth',1,$q$'I would feel it if my blood pressure was high'$q$,$q$Here is a common thing people say. "I would feel it if my blood pressure was high."
Let us look at that.
The myth. People think high blood pressure always makes you feel unwell. A pounding head. Hot face. Dizziness.
What is true. Most people with high blood pressure feel nothing at all. The World Health Organization says most people with hypertension do not feel any symptoms. The NHS says the same. That is why it is easy to miss, and why many people do not know they have it.
So feeling fine does not tell you your pressure is fine.
The only way to know is to measure it. A simple cuff does this in a minute or two. Many pharmacies, clinics and community health outreaches can check it.
One safe action. If you have not had your blood pressure checked in the last year, have it checked this week. If you already have a cuff, use it at rest, sitting, and write the number down. Share it with your care team in the app.
Get care now if you have chest pain, trouble breathing, a sudden severe headache, weakness on one side of the body, trouble speaking, confusion, or fainting, or if you feel very unwell and cannot keep fluids down. Go to the nearest hospital, or ask someone to take you. Do not wait for a call back.
This is general information, and it is not a diagnosis. Your care team can tell you what your numbers mean for you.$q$,$q$- S1: WHO, Hypertension fact sheet, https://www.who.int/news-room/fact-sheets/detail/hypertension
- S4: NHS, High blood pressure (hypertension), https://www.nhs.uk/conditions/high-blood-pressure-hypertension/$q$,'hypertension'::public.health_education_category,2,$q$One safe action. If you have not had your blood pressure checked in the last year, have it checked this week. If you already have a cuff, use it at rest, sitting, and write the number down. Share it with your care team in the app.$q$,null,null),
  ('myth-02','myth',2,$q$'If I had diabetes, I would know'$q$,$q$Another thing people say. "If I had diabetes, I would know."
The myth. You would always notice very strong thirst, or lose a lot of weight.
What is true. Type 2 diabetes can come on slowly. Symptoms such as feeling very tired, needing to pass urine more often, being thirsty all the time, or losing weight without trying can be mild, or can be missed for years. The NHS says not everyone with type 2 diabetes has symptoms. The World Health Organization says the symptoms of type 2 can be mild and take years to notice, which is why regular checks matter.
So a normal day does not rule it out.
Who should check? Especially anyone with family members who have diabetes, anyone who is overweight, and anyone who is not very active. A simple blood test can tell you.
One safe action. Ask for a blood sugar check, at a clinic, a lab, or through your care team. If you already know your sugar, keep your checks regular.
Get care now if you have chest pain, trouble breathing, a sudden severe headache, weakness on one side of the body, trouble speaking, confusion, or fainting, or if you feel very unwell and cannot keep fluids down. Go to the nearest hospital, or ask someone to take you. Do not wait for a call back.
This is general information, not a diagnosis.$q$,$q$- S5: WHO, Diabetes fact sheet, https://www.who.int/news-room/fact-sheets/detail/diabetes
- S6: NHS, Type 2 diabetes symptoms, https://www.nhs.uk/conditions/type-2-diabetes/symptoms/$q$,'diabetes'::public.health_education_category,2,$q$One safe action. Ask for a blood sugar check, at a clinic, a lab, or through your care team. If you already know your sugar, keep your checks regular.$q$,null,null),
  ('myth-03','myth',3,$q$'Herbal means natural, so it is safe'$q$,$q$Many families use herbs, roots and leaves, passed down over generations. This is part of our culture. So let us talk about it with respect.
The myth. If something is natural, it must be safe.
What is true. Natural does not always mean safe. The United States National Center for Complementary and Integrative Health says some herbal products can have side effects of their own, and some can change how prescribed medicines work. It gives an example of a plant sold as a supplement that can harm the liver.
Strength, dose and what the bottle or bag really contains can vary a lot between batches. That is not a reason to feel ashamed. It is a reason to be open about what you take.
Studies in sub-Saharan Africa, many of them done in Nigeria, found that a large number of people with high blood pressure use both herbal medicine and prescribed medicine. Often their care team was not told.
One safe action. Write down what herbs, teas, tonics or supplements you use. Show the list to your pharmacist or message your care team in the app before starting something new. Do not add or remove anything on your own.
Get care now if you have chest pain, trouble breathing, a sudden severe headache, weakness on one side of the body, trouble speaking, confusion, or fainting, or if you feel very unwell and cannot keep fluids down. Go to the nearest hospital, or ask someone to take you. Do not wait for a call back.
This is general information. It does not tell you which herb is safe for you.$q$,$q$- S9: NCCIH, Using dietary supplements wisely, https://www.nccih.nih.gov/health/using-dietary-supplements-wisely
- S10: Liwa AC et al., Traditional herbal medicine use among hypertensive patients in sub-Saharan Africa: a systematic review. Curr Hypertens Rep 2014, https://pmc.ncbi.nlm.nih.gov/articles/PMC4076776$q$,'medicines'::public.health_education_category,3,$q$One safe action. Write down what herbs, teas, tonics or supplements you use. Show the list to your pharmacist or message your care team in the app before starting something new. Do not add or remove anything on your own.$q$,null,null),
  ('myth-04','myth',4,$q$'I feel fine, so I can stop my medicine'$q$,$q$This is one of the most important ones. "I feel fine, so I can stop my medicine."
The myth. When I feel well, I do not need my tablets any more.
What is true. For conditions like high blood pressure and type 2 diabetes, feeling well often means the medicine is doing its job, or that the condition was never causing symptoms in the first place. High blood pressure usually causes no symptoms, as the World Health Organization notes. So you may feel the same whether your pressure is controlled or not.
If medicines are stopped without advice, numbers can drift up again without any warning.
Many people stop because of cost, side effects, or confusion about the instructions. These are real problems, and they have real answers. You are not alone in this, and you will not be judged for talking about it.
One safe action. Do not stop or change any medicine on your own. If you are thinking of stopping, or you ran out, or something about your tablets is bothering you, tell your care team in the app. They can look at the options with you.
Get care now if you have chest pain, trouble breathing, a sudden severe headache, weakness on one side of the body, trouble speaking, confusion, or fainting, or if you feel very unwell and cannot keep fluids down. Go to the nearest hospital, or ask someone to take you. Do not wait for a call back.
This is general information. Only your care team can decide what is right for you.$q$,$q$- S16: Adherence to antihypertensive medicines: WHO and CDC summaries; Harvard Health 'Don't skip blood pressure medication', https://www.health.harvard.edu/heart-health/reminder-don-t-skip-blood-pressure-medication
- S1: WHO, Hypertension fact sheet, https://www.who.int/news-room/fact-sheets/detail/hypertension$q$,'medicines'::public.health_education_category,2,$q$One safe action. Do not stop or change any medicine on your own. If you are thinking of stopping, or you ran out, or something about your tablets is bothering you, tell your care team in the app. They can look at the options with you.$q$,null,null),
  ('myth-05','myth',5,$q$'I only need to check my pressure when I have a headache'$q$,$q$Many people say, "I only check my blood pressure when I have a headache."
The myth. A headache tells you your pressure is high, and no headache means it is fine.
What is true. Headaches have many causes. Tiredness, not drinking enough water, stress, poor sleep, and many more. And as the World Health Organization says, most people with high blood pressure feel no symptoms. So a headache is not a reliable signal, in either direction. A clear head does not mean a safe number, and a sore head does not mean a high one.
The World Health Organization does say that a very high reading can come with severe headache, chest pain or confusion, and that this needs care straight away.
In daily life this means a small change. Instead of waiting for a feeling, make checking part of your routine, like brushing your teeth. A number you measured calmly is worth more than a guess based on how you feel.
One safe action. Check your pressure on a regular schedule that your care team agrees with, at rest, sitting down, the same time each day. Write it down in the app. Do not wait for a headache to tell you.
Get care now if you have chest pain, trouble breathing, a sudden severe headache, weakness on one side of the body, trouble speaking, confusion, or fainting, or if you feel very unwell and cannot keep fluids down. Go to the nearest hospital, or ask someone to take you. Do not wait for a call back.
This is general information.$q$,$q$- S1: WHO, Hypertension fact sheet, https://www.who.int/news-room/fact-sheets/detail/hypertension
- S4: NHS, High blood pressure (hypertension), https://www.nhs.uk/conditions/high-blood-pressure-hypertension/$q$,'hypertension'::public.health_education_category,2,$q$One safe action. Check your pressure on a regular schedule that your care team agrees with, at rest, sitting down, the same time each day. Write it down in the app. Do not wait for a headache to tell you.$q$,null,null),
  ('myth-06','myth',6,$q$'Seasoning cubes are not salt'$q$,$q$"Seasoning cubes are not salt. Only the salt I add counts."
The myth. Only the salt from the salt jar matters.
What is true. The World Health Organization recommends adults take less than 5 grams of salt a day. That is about one teaspoon in total, from everything. Salt hides in many foods and flavourings, including processed foods and stock or seasoning products.
Reports from Nigeria say that seasoning cubes are used in almost every home, and that a cube can carry a lot of salt. So if you use two or three cubes in a pot of soup, and add salt as well, the total can rise fast, even if the soup does not taste very salty.
This does not mean your food has to taste of nothing. Pepper, onions, ginger, garlic, locust beans, scent leaf and other herbs and spices add a lot of flavour with very little salt.
One safe action. Try using one cube fewer in your next pot. Add the salt last, and taste first. Read the label for sodium when you can.
Get care now if you have chest pain, trouble breathing, a sudden severe headache, weakness on one side of the body, trouble speaking, confusion, or fainting, or if you feel very unwell and cannot keep fluids down. Go to the nearest hospital, or ask someone to take you. Do not wait for a call back.
This is general information. If your care team has given you a salt target, follow theirs.$q$,$q$- S2: WHO, Salt reduction fact sheet, https://www.who.int/news-room/fact-sheets/detail/salt-reduction
- S3: WHO, Healthy diet fact sheet, https://www.who.int/news-room/fact-sheets/detail/healthy-diet
- S17: Nigerian press reports on seasoning cubes and salt intake (secondary), https://allafrica.com/stories/202507030615.html$q$,'nutrition'::public.health_education_category,2,$q$One safe action. Try using one cube fewer in your next pot. Add the salt last, and taste first. Read the label for sodium when you can.$q$,null,null),
  ('myth-07','myth',7,$q$'Bitter leaf will bring my sugar down'$q$,$q$A lot of families say, "Bitter leaf will bring my sugar down."
Bitter leaf, also called ewuro or onugbu, is a loved part of our cooking. It is a real vegetable, and a good one.
The myth. Bitter leaf, taken as juice or in large amounts, will control diabetes, so tablets are not needed.
What is true. Studies so far are mostly in animals, or small groups of healthy people eating one meal. A search of the evidence found no good trials in people who actually have diabetes. So we do not know how much, how often, or whether it is safe next to diabetes medicines. Blood sugar that goes too low can be dangerous.
So bitter leaf in your soup is fine. But no one should rely on it to replace diabetes treatment.
One safe action. Keep eating vegetables. If you want to try bitter leaf juice or a herbal drink, tell your care team first, and keep checking your blood sugar as advised. Never stop or change your diabetes medicine because of it.
Get care now if you have chest pain, trouble breathing, a sudden severe headache, weakness on one side of the body, trouble speaking, confusion, or fainting, or if you feel very unwell and cannot keep fluids down. Go to the nearest hospital, or ask someone to take you. Do not wait for a call back.
This is general information.$q$,$q$- S12: Bitter leaf (Vernonia amygdalina) and blood glucose: literature, https://ir.unilag.edu.ng/items/3be86051-89a3-43b9-ada2-c887818727f2
- S9: NCCIH, Using dietary supplements wisely, https://www.nccih.nih.gov/health/using-dietary-supplements-wisely$q$,'diabetes'::public.health_education_category,2,$q$One safe action. Keep eating vegetables. If you want to try bitter leaf juice or a herbal drink, tell your care team first, and keep checking your blood sugar as advised. Never stop or change your diabetes medicine because of it.$q$,null,null),
  ('myth-08','myth',8,$q$'Diabetes comes from eating too many sweets'$q$,$q$"Diabetes comes from eating too many sweets."
The myth. If you eat sweets, cake, or sugary drinks, you get diabetes. And people who get diabetes brought it on themselves.
What is true. Type 2 diabetes has several causes. Family history, carrying extra weight, and being less active all play a part, as the World Health Organization notes. Eating sugar does not directly cause it on its own.
But sugar is not harmless. Sugary food and drinks add a lot of energy, and can lead to weight gain, which raises risk. Sugary drinks, such as soft drinks and sweetened juice, are linked with higher risk in many studies. The World Health Organization suggests keeping free sugars to a small part of your daily energy.
And here is something kind to remember. You did not cause your diabetes by one bad habit. It is not a moral failure.
One safe action. Swap one sugary drink a day for water. Do not skip meals or stop medicine to compensate. Ask your care team about what is right for you.
Get care now if you have chest pain, trouble breathing, a sudden severe headache, weakness on one side of the body, trouble speaking, confusion, or fainting, or if you feel very unwell and cannot keep fluids down. Go to the nearest hospital, or ask someone to take you. Do not wait for a call back.
This is general information.$q$,$q$- S5: WHO, Diabetes fact sheet, https://www.who.int/news-room/fact-sheets/detail/diabetes
- S7: Diabetes UK, Sugar and diabetes, https://www.diabetes.org.uk/living-with-diabetes/eating/sugar-and-diabetes
- S3: WHO, Healthy diet fact sheet, https://www.who.int/news-room/fact-sheets/detail/healthy-diet$q$,'diabetes'::public.health_education_category,2,$q$One safe action. Swap one sugary drink a day for water. Do not skip meals or stop medicine to compensate. Ask your care team about what is right for you.$q$,null,null),
  ('myth-09','myth',9,$q$'A fast is fine as long as I take my tablets'$q$,$q$Many people fast for faith or for health. So here is a question that matters. "A fast is fine as long as I take my tablets."
The myth. If I carry on with my medicine, nothing can go wrong while fasting.
What is true. For people on medicine for diabetes or blood pressure, fasting can change how the medicine works in the body. Sugar can go too low, or too high, and a person can become dehydrated. NHS guidance for people with diabetes who plan to fast says to speak to your health team before you start, because medicines may need to be planned differently.
That is not a judgement about your choice to fast. Choosing is personal. The aim is to fast safely, with a plan.
One safe action. Tell your care team in the app that you plan to fast. Ask for a plan well before the date, not on the day. Do not change the timing or amount of any medicine on your own.
If you are fasting and begin to feel shaky, sweaty, very confused, or unusually unwell, treat that as important. Seek help, as below.
Get care now if you have chest pain, trouble breathing, a sudden severe headache, weakness on one side of the body, trouble speaking, confusion, or fainting, or if you feel very unwell and cannot keep fluids down. Go to the nearest hospital, or ask someone to take you. Do not wait for a call back.
This is general information, not advice for your own medicines.$q$,$q$- S8: NHS England (Midlands), diabetes expert fasting advice for Ramadan, 27 Feb 2025, https://www.england.nhs.uk/midlands/2025/02/27/nhs-diabetes-expert-offers-fasting-advice-to-diabetics-in-the-west-midlands-for-ramadan/$q$,'getting_started'::public.health_education_category,2,$q$One safe action. Tell your care team in the app that you plan to fast. Ask for a plan well before the date, not on the day. Do not change the timing or amount of any medicine on your own.$q$,null,null),
  ('myth-10','myth',10,$q$'My care team does not need to know about my herbal drink'$q$,$q$Here is one more. "My care team does not need to know about my herbal drink. It is just a leaf."
The myth. Herbs and teas are not like medicine, so there is no need to mention them.
What is true. Some herbal products can change how prescribed medicines work, making them stronger, weaker, or causing side effects. The United States National Center for Complementary and Integrative Health asks everyone to tell all their health providers about any herbal product or supplement they use.
Studies in Nigeria and nearby countries show that many people use both. They also show that care teams are often not told. That is a gap we can close, with no blame and no shame.
Telling your care team does not mean they will ask you to stop something you love. It means they can keep you safe. Together, you can decide what to do.
One safe action. This week, list everything you take. Tablets, injections, herbs, teas, tonics, vitamins, and anything a friend recommended. Put it in the app or show it to your pharmacist. Do not stop or start anything on your own because of this episode.
Get care now if you have chest pain, trouble breathing, a sudden severe headache, weakness on one side of the body, trouble speaking, confusion, or fainting, or if you feel very unwell and cannot keep fluids down. Go to the nearest hospital, or ask someone to take you. Do not wait for a call back.
This is general information.$q$,$q$- S9: NCCIH, Using dietary supplements wisely, https://www.nccih.nih.gov/health/using-dietary-supplements-wisely
- S10: Liwa AC et al., Traditional herbal medicine use among hypertensive patients in sub-Saharan Africa: a systematic review. Curr Hypertens Rep 2014, https://pmc.ncbi.nlm.nih.gov/articles/PMC4076776$q$,'medicines'::public.health_education_category,2,$q$One safe action. This week, list everything you take. Tablets, injections, herbs, teas, tonics, vitamins, and anything a friend recommended. Put it in the app or show it to your pharmacist. Do not stop or start anything on your own because of this episode.$q$,null,null),
  ('bp-lesson-01','lesson',1,$q$Day 1: Measure it the right way$q$,$q$Welcome to day one of your blood pressure course. This lesson takes about three minutes.
Today we learn one thing. How to take a good reading.
A reading can change a lot depending on how you take it. If you have just walked in, climbed stairs, or been arguing with someone, the number can be higher than your true number.
So here is how.
First, sit down on a chair, with your back supported and your feet flat on the floor. Do not cross your legs.
Second, rest for about five minutes. No talking, no phone, no tea or cigarettes just before.
Third, put the cuff on your bare upper arm, and rest your arm on a table, so the cuff is at about the level of your heart.
Fourth, press the button and stay still. Do not talk while it measures.
Fifth, write the numbers down. The top number and the bottom number.
Your action today. Take one reading the right way, and write it down in the app.
Now a quick question. Before you take a reading, how long should you sit quietly first?
The answer. About five minutes, with your back supported and your feet flat on the floor.
Well done. See you tomorrow.
If a reading ever comes with chest pain, trouble breathing, a sudden severe headache, weakness, trouble speaking or confusion, go to the nearest hospital now. Do not wait.$q$,$q$- S4: NHS, High blood pressure (hypertension), https://www.nhs.uk/conditions/high-blood-pressure-hypertension/
- S1: WHO, Hypertension fact sheet, https://www.who.int/news-room/fact-sheets/detail/hypertension$q$,'hypertension'::public.health_education_category,2,null,jsonb_build_array(jsonb_build_object('question',$q$Before you take a reading, how long should you sit quietly first?$q$,'options','[]'::jsonb,'answer_index',null,'answer_text',$q$About five minutes, sitting with your back supported and feet flat on the floor.$q$)),$q$Sit quietly for five minutes, feet flat, back supported, arm resting at heart level, then take one reading and write it down.$q$),
  ('bp-lesson-02','lesson',2,$q$Day 2: Pick a regular time$q$,$q$Welcome to day two. Yesterday you took a reading the right way. Today, a small habit.
Blood pressure changes through the day. It is lower when you rest and higher when you are busy or worried. So one reading on its own tells only a small part of the story.
What helps most is a pattern. And a pattern is easiest to see when you measure at the same time each day.
Pick a time that fits your life. After morning prayers or breakfast. Before your evening meal. Or before bed. It does not have to be perfect. It just has to be a time you can keep.
Link it to something you already do. For example, right after you brush your teeth, or right before you take your evening tea.
Your care team will tell you how many readings you need and on which days. Follow their plan.
Your action today. Choose one time, and set a daily reminder in the app.
A quick question. Why is it helpful to take your reading at the same time each day?
The answer. It makes readings easier to compare, so you and your care team can see the real pattern.
Well done. See you tomorrow.
If you ever feel unwell with chest pain, trouble breathing, sudden severe headache, weakness on one side, or confusion, go to the nearest hospital now.$q$,$q$- S4: NHS, High blood pressure (hypertension), https://www.nhs.uk/conditions/high-blood-pressure-hypertension/$q$,'hypertension'::public.health_education_category,2,null,jsonb_build_array(jsonb_build_object('question',$q$Why is it helpful to take your reading at the same time each day?$q$,'options','[]'::jsonb,'answer_index',null,'answer_text',$q$It makes your readings easier to compare, so you and your care team can see the real pattern.$q$)),$q$Choose one time of day for your readings and set a daily reminder in the app.$q$),
  ('bp-lesson-03','lesson',3,$q$Day 3: Write it down or log it$q$,$q$Welcome to day three. Today we talk about records.
Your memory is good, but it is not a notebook. After a few weeks, nobody remembers what their blood pressure was last Tuesday.
When you write each reading down, you give your care team something real to look at.
In the app, you log the top number and the bottom number. The app records the date and the time for you. If you use a paper notebook, write them yourself.
It also helps to add a small note if something was unusual. For example, "I had a bad night's sleep," or "I had just walked fast to the bus." This helps your care team understand the number.
Do not worry if a reading looks high or low to you. Just record it as it is. Never change a number to look better. The number is information, not a grade.
Your action today. Log today's reading in the app.
A quick question. What two things should you record with each reading?
The answer. The numbers, top and bottom, and the date and time you took them.
Well done. See you tomorrow.
If you ever have chest pain, trouble breathing, a sudden severe headache, weakness, trouble speaking or confusion, go to the nearest hospital now.$q$,$q$- S4: NHS, High blood pressure (hypertension), https://www.nhs.uk/conditions/high-blood-pressure-hypertension/$q$,'hypertension'::public.health_education_category,2,null,jsonb_build_array(jsonb_build_object('question',$q$What two things should you record with each blood pressure reading?$q$,'options','[]'::jsonb,'answer_index',null,'answer_text',$q$The numbers (top and bottom) and the date and time you took them.$q$)),$q$Log today's reading in the app, with the date and time.$q$),
  ('bp-lesson-04','lesson',4,$q$Day 4: Tie your medicine to a habit$q$,$q$Welcome to day four. Today is about remembering your medicine.
Many people forget a tablet now and then. It is common, and it is human. The goal is not perfect. The goal is a steady routine.
The easiest way to build a routine is to attach it to something you already do every day. Brushing your teeth. Making tea. Locking up the shop. Switching off the news.
Put your tablets, or a reminder, where you will see them at that moment. Not in a drawer you never open.
You can also set a reminder in the app.
If you miss a time, or you are not sure what to do, do not guess and do not double up. Check the label or leaflet, or ask your pharmacist or your care team. They will tell you what to do for your medicine.
And never stop a medicine on your own because you feel well. Talk to your care team first.
Your action today. Pair your medicine with a daily habit, and set a reminder in the app.
A quick question. If you miss a medicine time or are not sure what to do, what should you do?
The answer. Do not double up or guess. Check your instructions, or ask your care team or pharmacist.
Well done. See you tomorrow.
If you feel chest pain, trouble breathing, a sudden severe headache, weakness or confusion, go to the nearest hospital now.$q$,$q$- S16: Adherence to antihypertensive medicines: WHO and CDC summaries; Harvard Health 'Don't skip blood pressure medication', https://www.health.harvard.edu/heart-health/reminder-don-t-skip-blood-pressure-medication$q$,'medicines'::public.health_education_category,2,null,jsonb_build_array(jsonb_build_object('question',$q$If you miss a medicine time or feel unsure what to do, what should you do?$q$,'options','[]'::jsonb,'answer_index',null,'answer_text',$q$Do not double up or guess. Check your medicine instructions or ask your care team or pharmacist.$q$)),$q$Pair your medicine time with something you do every day, and set an app reminder.$q$),
  ('bp-lesson-05','lesson',5,$q$Day 5: Cut back on seasoning cubes$q$,$q$Welcome to day five. Today is about flavour, and salt.
The World Health Organization suggests adults take less than five grams of salt a day. That is about one teaspoon, counting everything. Salt in bread, in processed food, in sauces, in seasoning cubes, and in the salt jar.
Many of us cook with seasoning cubes every day. Reports from Nigeria say cubes can be a big source of salt in the home. So here is a small experiment.
In your next meal, use one cube fewer than usual. Add the salt last, and taste before you add any.
Then add flavour another way. Fresh pepper. Onions. Garlic. Ginger. Thyme. Curry leaf. Locust beans. Scent leaf. A squeeze of lime. These bring taste without much salt.
Your taste buds adjust in a few weeks. Food that tasted flat at first begins to taste right.
If your care team has given you a salt target, follow that one.
Your action today. Use one seasoning cube fewer in your next meal.
A quick question. About how much salt a day should an adult take in total, according to the World Health Organization?
The answer. Less than five grams, about one teaspoon, from all food together.
Well done. See you tomorrow.
If you ever have chest pain, trouble breathing, sudden severe headache, weakness or confusion, go to the nearest hospital now.$q$,$q$- S2: WHO, Salt reduction fact sheet, https://www.who.int/news-room/fact-sheets/detail/salt-reduction
- S3: WHO, Healthy diet fact sheet, https://www.who.int/news-room/fact-sheets/detail/healthy-diet
- S17: Nigerian press reports on seasoning cubes and salt intake (secondary), https://allafrica.com/stories/202507030615.html$q$,'nutrition'::public.health_education_category,2,null,jsonb_build_array(jsonb_build_object('question',$q$About how much salt in total should an adult take in a day, according to the World Health Organization?$q$,'options','[]'::jsonb,'answer_index',null,'answer_text',$q$Less than 5 grams, which is about one teaspoon, from all food together.$q$)),$q$In your next meal, use one seasoning cube fewer and taste before adding salt.$q$),
  ('bp-lesson-06','lesson',6,$q$Day 6: A ten minute walk$q$,$q$Welcome to day six. Today we move, just a little.
The World Health Organization suggests adults aim for at least 150 minutes of moderate activity a week. That sounds like a lot. But the same page says that any amount of activity is better than none, and all activity counts.
So do not think of exercise as a gym. Think of walking to the junction. Taking the stairs. Playing with children. Dancing in the kitchen.
Today, just do one ten minute walk. After a meal is a good time. Walk at a pace where you could still hold a conversation.
Wear comfortable shoes. Drink some water. Walk in the cooler part of the day, if you can.
If you ever get chest pain, feel faint, or find it hard to breathe while walking, stop and rest, and get help. And if you have a heart condition or other health problem, ask your care team what level of activity is right for you.
Your action today. Take one ten minute walk.
A quick question. According to the World Health Organization, does a small amount of activity count?
The answer. Yes. Any amount of activity is better than none.
Well done. See you tomorrow.$q$,$q$- S18: WHO, Physical activity fact sheet, https://www.who.int/news-room/fact-sheets/detail/physical-activity$q$,'exercise'::public.health_education_category,2,null,jsonb_build_array(jsonb_build_object('question',$q$According to the World Health Organization, does a small amount of activity count?$q$,'options','[]'::jsonb,'answer_index',null,'answer_text',$q$Yes. Any amount of activity is better than none, and all activity counts.$q$)),$q$Take a ten minute walk after one meal today, at an easy pace you can talk through.$q$),
  ('bp-lesson-07','lesson',7,$q$Day 7: Do not run out$q$,$q$Welcome to day seven. A short lesson on a simple problem. Running out.
Medicine runs out at the worst times. During a holiday. During the fuel queue. At the end of the month when money is tight.
Cost is one of the main reasons people stop their medicine. If cost is a problem, say so. Your care team can look at options with you.
Here is a simple habit. Once a week, on the same day, look in your medicine box. Count how many days you have left.
If you have about a week left or less, ask for a refill in the app. This gives time for the order to arrive, or for you to collect it.
If you ever run out and you are not sure what to do, do not skip or stretch your doses on your own. Message your care team the same day.
Your action today. Check how many days of medicine you have, and request a refill if it is about a week or less.
A quick question. When should you ask for a refill?
The answer. Before you run out. Ideally when you have about a week left.
Well done. See you tomorrow.
If you feel chest pain, trouble breathing, sudden severe headache, weakness or confusion, go to the nearest hospital now.$q$,$q$- S16: Adherence to antihypertensive medicines: WHO and CDC summaries; Harvard Health 'Don't skip blood pressure medication', https://www.health.harvard.edu/heart-health/reminder-don-t-skip-blood-pressure-medication$q$,'medicines'::public.health_education_category,2,null,jsonb_build_array(jsonb_build_object('question',$q$When should you ask for a refill?$q$,'options','[]'::jsonb,'answer_index',null,'answer_text',$q$Before you run out, ideally when you have about a week left, so there is time to get it.$q$)),$q$Check how many days of medicine you have left, and request a refill in the app if it is a week or less.$q$),
  ('bp-lesson-08','lesson',8,$q$Day 8: When to message your care team$q$,$q$Welcome to day eight. Today we learn when to message your care team, and when not to wait.
The app is for ordinary questions and updates. For example, a reading that looks different from usual, a side effect that bothers you, a question about your tablets, or a change in plans.
Your care team will tell you what numbers matter for you. The app will show you if a reading needs attention. Do not worry about learning numbers by heart.
Some things are different. If you have chest pain, trouble breathing, a sudden severe headache, weakness on one side of the body, trouble speaking, confusion, or you faint, do not message and wait. Go to the nearest hospital now, or ask someone to take you.
This is not meant to frighten you. It is so that you know what to do.
Your action today. Open the app and find the button to message your care team.
A quick question. If you feel chest pain or trouble breathing, should you wait for a reply from your care team?
The answer. No. Go to the nearest hospital now, or ask someone to take you.
Well done. See you tomorrow.$q$,$q$- S1: WHO, Hypertension fact sheet, https://www.who.int/news-room/fact-sheets/detail/hypertension
- S4: NHS, High blood pressure (hypertension), https://www.nhs.uk/conditions/high-blood-pressure-hypertension/$q$,'hypertension'::public.health_education_category,2,null,jsonb_build_array(jsonb_build_object('question',$q$If you feel chest pain or trouble breathing, should you wait for a reply from your care team?$q$,'options','[]'::jsonb,'answer_index',null,'answer_text',$q$No. Go to the nearest hospital now, or ask someone to take you.$q$)),$q$Find the Message my care team button in the app and read what it says about when to use it.$q$),
  ('bp-lesson-09','lesson',9,$q$Day 9: Tell your care team what else you take$q$,$q$Welcome to day nine. Today is about the whole picture.
Many people use more than just prescribed tablets. A herbal tea. A tonic from the market. A vitamin from a friend. This is very common, and nothing to be embarrassed about.
But some herbal products can change how prescribed medicines work. They may make them weaker, stronger, or cause side effects. That is why it helps your care team to know.
Make a simple list. Write down everything you take, how often, and why. Include the name on the packet if you can. Take a photo of the label if that is easier.
Add the list to the app, or show it to your pharmacist.
Do not stop or start anything because of this lesson. Just tell the truth about what you take, and let your care team help you decide.
Your action today. Write down everything you take, and add it to the app.
A quick question. Why should you tell your care team about herbs and supplements?
The answer. Some can change how prescribed medicines work or cause side effects, so your care team needs to know.
Well done. See you tomorrow.
If you have chest pain, trouble breathing, sudden severe headache, weakness or confusion, go to the nearest hospital now.$q$,$q$- S9: NCCIH, Using dietary supplements wisely, https://www.nccih.nih.gov/health/using-dietary-supplements-wisely
- S10: Liwa AC et al., Traditional herbal medicine use among hypertensive patients in sub-Saharan Africa: a systematic review. Curr Hypertens Rep 2014, https://pmc.ncbi.nlm.nih.gov/articles/PMC4076776$q$,'medicines'::public.health_education_category,2,null,jsonb_build_array(jsonb_build_object('question',$q$Why should you tell your care team about herbs and supplements?$q$,'options','[]'::jsonb,'answer_index',null,'answer_text',$q$Some can change how prescribed medicines work or cause side effects, so your care team needs to know to keep you safe.$q$)),$q$Write a list of every tablet, herb, tea and supplement you take, and add it to the app.$q$),
  ('bp-lesson-10','lesson',10,$q$Day 10: Five minutes of calm$q$,$q$Welcome to day ten, the last lesson. Today is about calm.
Stress and poor sleep are part of life. They do not cause every problem, but many people find that taking a few quiet minutes helps them feel steadier. This lesson is not a treatment, and it does not replace your medicine or your readings.
Here is an exercise from public health guidance. Sit comfortably. Let your breath flow gently into your belly, without forcing it. Breathe in through your nose, and out through your mouth, counting slowly from one to five on each breath. Keep going for about five minutes.
Breathe gently. If you feel dizzy, light-headed or tingly, stop, breathe normally, and open your eyes. If it does not pass, get help.
Tarragon also has short guided breathing sessions in the app. You can try one tonight.
Your action today. Do five minutes of slow, gentle breathing, sitting down.
A quick question. What should you do if you feel dizzy during a breathing exercise?
The answer. Stop, breathe normally, and open your eyes. If it does not pass, get help.
Well done. You have finished the ten days. Keep measuring, keep taking your medicine as advised, and keep talking to your care team. We are with you.
If you feel chest pain, trouble breathing, a sudden severe headache, weakness or confusion, go to the nearest hospital now.$q$,$q$- S14: NHS, Breathing exercises for stress, https://www.nhs.uk/mental-health/self-help/guides-tools-and-activities/breathing-exercises-for-stress/
- S15: NHS, Insomnia: tips for better sleep, https://www.nhs.uk/conditions/insomnia/$q$,'mental_health'::public.health_education_category,2,null,jsonb_build_array(jsonb_build_object('question',$q$What should you do if you feel dizzy while doing a breathing exercise?$q$,'options','[]'::jsonb,'answer_index',null,'answer_text',$q$Stop, breathe normally, and open your eyes. If it does not pass, get help.$q$)),$q$Do five minutes of slow, gentle breathing today, sitting down.$q$)
  ) as t(code, kind, n, title, body, sources, category, mins, self_care, kcheck, laction)
  loop
    insert into public.health_education_content
      (code, title, summary, body, category, content_status, is_placeholder, is_micro_lesson, lesson_action, self_care_action,
       knowledge_check, estimated_minutes, source_reference, sort_order)
    values (r.code, r.title,
            'Draft script. Needs a named clinical author and Chief Medical Officer approval before anyone can see it.',
            r.body, r.category, 'draft', true, r.kind = 'lesson', r.laction, r.self_care, r.kcheck, r.mins, r.sources,
            case when r.kind = 'myth' then 910 + r.n else 930 + r.n end)
    on conflict (code) do nothing
    returning id into v_id;
    if v_id is null then
      select id into v_id from public.health_education_content where code = r.code;
    else
      v_new := v_new + 1;
    end if;
    insert into public.health_education_programme_modules (programme_id, content_id, module_number, title)
    values (case when r.kind = 'myth' then v_myth else v_bp end, v_id, case when r.kind = 'myth' then 6 + r.n else r.n end, r.title)
    on conflict (programme_id, module_number) do nothing;
  end loop;
  raise notice 'S58b: % draft content rows inserted', v_new;
end $$;

do $$
begin
  if exists (select 1 from public.health_education_content c
              where c.code ~ '^(myth-(0[1-9]|10)|bp-lesson-(0[1-9]|10))$'
                and (c.content_status <> 'draft' or c.is_active or not c.is_placeholder or c.clinician_reviewed
                     or c.reviewed_by_name is not null or c.clinical_author_name is not null)) then
    raise exception 'S58b: a seeded draft is not a closed draft';
  end if;
  if (select count(*) from public.health_education_content c where c.code ~ '^(myth-(0[1-9]|10)|bp-lesson-(0[1-9]|10))$') <> 20 then
    raise exception 'S58b: expected 20 seeded drafts';
  end if;
end $$;
