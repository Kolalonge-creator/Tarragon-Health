-- Module 20 §20.13 example: two real education programmes, built entirely from the
-- existing week-anchored hypertension/diabetes drip curriculum content
-- (20260730115924_health_education_12_week_priority_curricula.sql) — no new content
-- authored, just sequenced into named modules the way the spec's own example reads
-- ("Hypertension Education Programme / Module 1: What is hypertension? / ...").
insert into public.health_education_programmes (code, title, description, condition, category, sort_order)
values
  ('hypertension_education_programme', 'Hypertension Education Programme',
   'A six-part course on understanding and living with high blood pressure — numbers, salt, medicine, movement, home readings and stress, in order.',
   'hypertension', 'hypertension', 10),
  ('diabetes_education_programme', 'Diabetes Education Programme',
   'A six-part course on understanding and living with diabetes — what''s happening in your body, eating well, low sugar and sick days, the checks that protect you, HbA1c, and exercise timing.',
   'diabetes', 'diabetes', 20)
on conflict (code) do nothing;

insert into public.health_education_programme_modules (programme_id, content_id, module_number, title)
select p.id, c.id, m.module_number, c.title
from public.health_education_programmes p
join (values
  ('hypertension_education_programme', 'htn_w1_what_your_numbers_mean', 1),
  ('hypertension_education_programme', 'htn_w2_salt_you_cannot_see', 2),
  ('hypertension_education_programme', 'htn_w3_medicines_that_work_quietly', 3),
  ('hypertension_education_programme', 'htn_w4_movement_that_counts', 4),
  ('hypertension_education_programme', 'htn_w5_accurate_home_reading', 5),
  ('hypertension_education_programme', 'htn_w6_alcohol', 6),
  ('diabetes_education_programme', 'dm_w1_what_is_happening', 1),
  ('diabetes_education_programme', 'dm_w2_plate_method', 2),
  ('diabetes_education_programme', 'dm_w3_lows_and_sick_days', 3),
  ('diabetes_education_programme', 'dm_w4_beyond_sugar', 4),
  ('diabetes_education_programme', 'dm_w5_hba1c', 5),
  ('diabetes_education_programme', 'dm_w6_exercise_timing', 6)
) as m(programme_code, content_code, module_number) on m.programme_code = p.code
join public.health_education_content c on c.code = m.content_code
on conflict (programme_id, module_number) do nothing;
