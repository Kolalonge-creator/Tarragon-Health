-- Tarragon Health — §36.7 medication-information starter library.
--
-- docs/AI_HEALTH_ASSISTANT_ARCHITECTURE.md §5's row for 36.7 said this could
-- not ship without "an authored, clinician-reviewed library" and that no
-- source existed. Reuses public.health_education_content rather than a new
-- table — it already has a 'medicines' category
-- (20260810013703_health_education_categories_and_library.sql) and already
-- carries the review/embedding/RLS machinery
-- (20260810034xxx/20260829103000_health_education_content_embeddings.sql).
-- The existing 'medicines' rows (20260810015401) are general adherence
-- education (missed doses, storage, generic vs brand); these are the
-- missing piece — per-drug purpose explanations for §36.7's actual example
-- ("this medication has been prescribed to help control your blood
-- pressure") — covering the core chronic-disease wedge formulary
-- (hypertension, diabetes; a few common cardiovascular-risk co-prescriptions)
-- per CLAUDE.md's "core wedge."
--
-- SAME HONESTY RULE AS EVERY OTHER DRAFT LIBRARY IN THIS CODEBASE:
-- clinician_reviewed is left at its default false here — these are AI-
-- authored drafts, not a clinician's own words, and are not marked reviewed.
-- lib/ai-coach/tools.ts's getMedicationInformation only ever reads
-- clinician_reviewed = true rows, so none of this reaches a patient until an
-- actual clinician reviews and approves it (same rollout shape as the
-- lpe_content_blocks 58-block starter library and the existing 'medicines'
-- rows this migration sits alongside).
--
-- CONTENT DISCIPLINE: purpose and general mechanism only. No dose, no
-- frequency, no "take X mg" language anywhere below — matching
-- COACH_SYSTEM_PROMPT's own "never recommend a specific medication, dose, or
-- dose change" rule, which must hold for the content the assistant quotes
-- from just as much as for what it says on its own.

insert into public.health_education_content
  (code, title, summary, body, content_type, estimated_minutes, condition, category, sort_order)
values

-- ============================================================================
-- Hypertension
-- ============================================================================
('drug-amlodipine', 'Amlodipine',
 'A calcium channel blocker that relaxes blood vessels to lower blood pressure.',
 E'Amlodipine belongs to a group of medicines called calcium channel blockers. It works by relaxing the muscles in the walls of your blood vessels, which widens them and makes it easier for blood to flow through — this lowers blood pressure and reduces the heart''s workload.\n\nIt is usually taken once a day, often long-term, as part of managing blood pressure alongside lifestyle changes like reducing salt and staying active.\n\nSome people notice swelling in the ankles or feet, flushing, or mild headache, especially when starting — these are common and often settle. If swelling is significant, or you notice anything that concerns you, mention it to your care team rather than stopping the medicine on your own.',
 'article', 2, 'hypertension', 'medicines', 200),

('drug-lisinopril', 'Lisinopril',
 'An ACE inhibitor that relaxes blood vessels and eases strain on the heart.',
 E'Lisinopril belongs to a group of medicines called ACE inhibitors. It blocks a hormone system in the body that would otherwise narrow blood vessels, so blood vessels relax and blood pressure comes down — this also eases the amount of work the heart has to do.\n\nIt is commonly used for blood pressure, and sometimes for protecting the kidneys in diabetes, since it can reduce pressure inside the tiny filtering units of the kidney.\n\nA dry, tickly cough is a well-known side effect of this drug class and worth mentioning to your care team if it bothers you — there are usually alternatives. Some people also notice dizziness when standing up quickly, especially early on.',
 'article', 2, 'hypertension', 'medicines', 210),

('drug-losartan', 'Losartan',
 'An ARB that relaxes blood vessels, often used when an ACE inhibitor causes a cough.',
 E'Losartan belongs to a group of medicines called angiotensin receptor blockers (ARBs). It works in a similar overall way to ACE inhibitors like lisinopril — relaxing blood vessels to lower blood pressure — but through a slightly different step in the same hormone pathway, which is why it is often chosen for someone who developed a cough on an ACE inhibitor.\n\nLike lisinopril, it is sometimes used for kidney protection in diabetes as well as for blood pressure itself.\n\nDizziness, especially when standing up quickly, is the most commonly noticed effect. It is generally well tolerated otherwise. Tell your care team about any new symptoms rather than adjusting or stopping the medicine yourself.',
 'article', 2, 'hypertension', 'medicines', 220),

('drug-hydrochlorothiazide', 'Hydrochlorothiazide (a "water pill")',
 'A thiazide diuretic that helps the kidneys remove extra salt and fluid.',
 E'Hydrochlorothiazide is a diuretic — sometimes called a "water pill" — that helps your kidneys remove extra salt and water from the body through urine. Less fluid in the blood vessels means lower blood pressure.\n\nIt is often combined with other blood pressure medicines rather than used alone, and you may notice needing to urinate more often, especially in the first few weeks.\n\nBecause it changes how the kidneys handle salt and other minerals, your care team may check blood tests periodically while you are on it. Report any unusual muscle cramping, weakness, or feeling unusually thirsty, and always mention it if you are prescribed a new medicine elsewhere, since diuretics can interact with several other drugs.',
 'article', 2, 'hypertension', 'medicines', 230),

('drug-nifedipine', 'Nifedipine',
 'A calcium channel blocker, closely related to amlodipine, that relaxes blood vessels.',
 E'Nifedipine works the same general way as amlodipine — relaxing the muscles in blood vessel walls so blood pressure comes down — but as an extended-release tablet it is designed to release steadily over the day rather than all at once. For this reason, extended-release nifedipine tablets should always be swallowed whole, never crushed or split, unless your care team has specifically told you otherwise.\n\nFlushing, headache, and mild ankle swelling are the most common effects, similar to amlodipine, and often ease after the first couple of weeks.\n\nIf you notice the tablet appearing to pass through undigested, that can be normal for this formulation (the shell can remain intact after the medicine inside has released) — but check with your care team if you are ever unsure.',
 'article', 2, 'hypertension', 'medicines', 240),

('drug-bisoprolol', 'Bisoprolol',
 'A beta blocker that slows and steadies the heart, easing its workload.',
 E'Bisoprolol belongs to a group of medicines called beta blockers. It works by blocking the effect of adrenaline on the heart, which slows the heart rate and reduces how forcefully it beats — this lowers blood pressure and eases the heart''s overall workload, and it is also used for certain heart rhythm and heart failure conditions.\n\nBecause it affects heart rate directly, your care team may check your pulse periodically, and it should never be stopped suddenly — stopping abruptly can cause a rebound effect. Any plan to stop or change it should always go through your care team.\n\nTiredness, cold hands and feet, or a noticeably slower pulse are the most commonly noticed effects, especially when starting.',
 'article', 2, 'hypertension', 'medicines', 250),

('drug-methyldopa', 'Methyldopa',
 'A blood pressure medicine with a long safety record in pregnancy.',
 E'Methyldopa works in the brain and nervous system to reduce the signals that raise blood pressure, relaxing blood vessels as a result. It has one of the longest safety track records of any blood pressure medicine used in pregnancy, which is why it is often the preferred choice for pregnant patients with hypertension.\n\nDrowsiness, especially when starting or after a dose increase, is the most commonly noticed effect, along with a dry mouth for some people. These often ease over the first couple of weeks.\n\nBecause it works differently from newer blood pressure medicines, your care team chooses it deliberately in specific situations — if you are ever switched between blood pressure medicines, ask what changed and why so you understand your own plan.',
 'article', 2, 'hypertension', 'medicines', 260),

-- ============================================================================
-- Diabetes
-- ============================================================================
('drug-metformin', 'Metformin',
 'The usual first medicine for type 2 diabetes, reducing how much sugar the liver releases.',
 E'Metformin is usually the first medicine offered for type 2 diabetes. It works mainly by reducing the amount of sugar your liver releases into the bloodstream and by helping your body respond better to its own insulin — it does not push the pancreas to make more insulin, which is why it does not typically cause low blood sugar on its own.\n\nIt is usually taken with food, which meaningfully reduces the most common side effects: an upset stomach, nausea, or loose stools, especially in the first couple of weeks as your body adjusts.\n\nBecause it is processed by the kidneys, your care team monitors kidney function periodically while you are on it. Tell your care team before any procedure involving contrast dye (some scans), since metformin sometimes needs to be paused around those.',
 'article', 3, 'diabetes', 'medicines', 270),

('drug-gliclazide', 'Gliclazide',
 'A medicine that helps the pancreas release more insulin to lower blood sugar.',
 E'Gliclazide belongs to a group of medicines called sulfonylureas. It works by encouraging your pancreas to release more of its own insulin, which lowers blood sugar — unlike metformin, this means it can cause blood sugar to go too low (hypoglycaemia) if a meal is skipped or delayed, so it is usually taken with or shortly before meals.\n\nKnowing the signs of low blood sugar (shakiness, sweating, sudden hunger, confusion) and what to do about them is worth discussing with your care team when starting this medicine, or reviewing again if it has been a while.\n\nWeight gain is a possible longer-term effect for some people. Bring any pattern of low readings, not just a single one, to your care team''s attention.',
 'article', 3, 'diabetes', 'medicines', 280),

('drug-glibenclamide', 'Glibenclamide',
 'An older, longer-acting sulfonylurea that helps the pancreas release more insulin.',
 E'Glibenclamide works the same general way as gliclazide — encouraging the pancreas to release more insulin — but it stays active in the body longer, which means its blood-sugar-lowering effect lasts longer too. This makes low blood sugar (hypoglycaemia) a somewhat greater risk with this medicine, particularly for older adults or anyone with reduced kidney function.\n\nTaking it consistently with meals matters more than with most other diabetes medicines, since a skipped or delayed meal has a longer window in which low blood sugar could develop.\n\nKnow the signs of low blood sugar (shakiness, sweating, sudden hunger, confusion) before starting, and mention any low readings — even mild ones — to your care team.',
 'article', 3, 'diabetes', 'medicines', 290),

('drug-insulin-general', 'Insulin (general overview)',
 'A hormone injected to help the body move sugar out of the blood and into cells.',
 E'Insulin is the hormone your body normally makes to move sugar out of the bloodstream and into your cells for energy. When it is prescribed as a medicine, it does the same job — some types act quickly and briefly, others act slowly over many hours, and your care team chooses the type(s) and timing based on your own pattern of readings, not a one-size-fits-all rule.\n\nCorrect storage matters: most insulin needs to be kept cool (refrigerated when not in use) and protected from freezing and direct heat, both worth planning for given Nigeria''s climate.\n\nLow blood sugar (hypoglycaemia) is the main thing to watch for and understand — know the signs (shakiness, sweating, sudden hunger, confusion) and have a plan for treating it. Never change an insulin dose or timing on your own without your care team''s guidance — insulin adjustments are individual to you.',
 'article', 4, 'diabetes', 'medicines', 300),

('drug-sitagliptin', 'Sitagliptin',
 'A medicine that helps the body release insulin only when blood sugar is high.',
 E'Sitagliptin belongs to a group of medicines called DPP-4 inhibitors. It works by helping your body release more of its own insulin, but only in response to a meal raising blood sugar — this "smart" mechanism is why it carries a low risk of causing blood sugar to go too low on its own, unlike sulfonylureas.\n\nIt is often added alongside metformin rather than used alone, and is generally well tolerated, with headache or mild stomach upset being the most commonly noticed effects.\n\nRarely, joint pain or signs of pancreas irritation (persistent, severe stomach pain) have been reported with this drug class — uncommon, but worth knowing about and reporting to your care team if it happens rather than dismissing it.',
 'article', 3, 'diabetes', 'medicines', 310),

-- ============================================================================
-- Cardiovascular-risk co-prescriptions (common alongside hypertension/diabetes)
-- ============================================================================
('drug-atorvastatin', 'Atorvastatin',
 'A statin that lowers cholesterol to reduce long-term heart and stroke risk.',
 E'Atorvastatin belongs to a group of medicines called statins. It works by reducing how much cholesterol your liver produces, which lowers the amount circulating in your blood — over years, this meaningfully reduces the risk of heart attack and stroke, particularly for people who already have diabetes, high blood pressure, or other cardiovascular risk factors.\n\nIt is usually taken once daily, often in the evening, and its benefit builds up over the long term rather than being felt day to day — which is why sticking with it matters even though you likely won''t notice a difference in how you feel.\n\nMuscle aches are the most talked-about possible effect; most muscle soreness is unrelated to the medicine, but unexplained, persistent, or severe muscle pain is worth reporting to your care team rather than assuming it will pass.',
 'article', 2, 'cardiovascular', 'medicines', 320),

('drug-aspirin-low-dose', 'Low-dose aspirin (for heart/stroke risk reduction)',
 'A low daily dose used to reduce clotting risk, not as a painkiller.',
 E'At the low dose sometimes prescribed for heart and stroke risk reduction, aspirin works differently from how it''s used as an occasional painkiller — it makes platelets (the blood cells involved in clotting) less likely to stick together, which can reduce the risk of the kind of clot that causes a heart attack or certain strokes.\n\nThis is only prescribed when your care team has judged that the benefit outweighs the risk for you specifically — low-dose aspirin increases bleeding risk, including in the stomach, so it is not something to start or stop on your own, even though it is available without a prescription.\n\nTaking it with food can reduce stomach irritation. Tell your care team about any unusual bruising, black or tarry stools, or bleeding that doesn''t stop as expected.',
 'article', 2, 'cardiovascular', 'medicines', 330);

do $$
declare
  v_count int;
  v_reviewed_count int;
begin
  select count(*) into v_count from public.health_education_content where category = 'medicines' and code like 'drug-%';
  if v_count <> 14 then
    raise exception 'FAIL: expected 14 drug-information rows, found %', v_count;
  end if;

  select count(*) into v_reviewed_count
  from public.health_education_content
  where category = 'medicines' and code like 'drug-%' and clinician_reviewed = true;
  if v_reviewed_count <> 0 then
    raise exception 'FAIL: drug-information drafts must not be pre-marked clinician_reviewed';
  end if;

  raise notice 'PASS: % medication-information drafts inserted, all unreviewed', v_count;
end $$;
