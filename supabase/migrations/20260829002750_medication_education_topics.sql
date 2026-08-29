-- Tarragon Health — Module 21: Medication Access & Adherence Engine, part 6/7.
--
-- §21.12 medication education: purpose, timing, administration, expected
-- effects, common side effects, warnings, monitoring, refill information.
-- Timing/administration/dose/refill-date are already on the medications row
-- itself (dose, schedule_times, refill_date) — only the clinical/educational
-- narrative fields need new reference data, so this mirrors
-- drug_monitoring_rules' ILIKE-pattern reference-table shape (20260716173000)
-- rather than inventing a new one.
--
-- Deliberately NOT a full drug formulary (none exists in this codebase — see
-- Module 21 planning research) and deliberately generic, non-dose-specific
-- copy: this is general patient education about a drug class, never a
-- substitute for what the prescribing clinician told this specific patient.
-- A drug with no matching row shows a plain "ask your care team" fallback in
-- the UI rather than fabricating content — same posture as the wearable
-- provider gaps ("not yet available" rather than guessing).

create table public.medication_education_topics (
  id                        uuid primary key default gen_random_uuid(),
  match_pattern             text not null unique, -- ILIKE against medications.drug_name
  drug_class                text not null,
  purpose                   text not null,
  expected_effects          text,
  common_side_effects       text,
  warnings                  text,
  monitoring_note           text,
  is_active                 boolean not null default true,
  created_at                timestamptz not null default now()
);

comment on table public.medication_education_topics is
  'Module 21 §21.12 reference data: general, non-personalised education copy per drug class, matched against medications.drug_name by ILIKE. Public reference data (no PHI) — readable by any authenticated user, admin-write only.';

alter table public.medication_education_topics enable row level security;

create policy medication_education_topics_select on public.medication_education_topics
  for select to authenticated using (true);
create policy medication_education_topics_admin_insert on public.medication_education_topics
  for insert to authenticated with check (private.is_admin());
create policy medication_education_topics_admin_update on public.medication_education_topics
  for update to authenticated using (private.is_admin()) with check (private.is_admin());
create policy medication_education_topics_admin_delete on public.medication_education_topics
  for delete to authenticated using (private.is_admin());

grant select, insert, update, delete on public.medication_education_topics to authenticated;
revoke all on public.medication_education_topics from anon;

insert into public.medication_education_topics
  (match_pattern, drug_class, purpose, expected_effects, common_side_effects, warnings, monitoring_note)
values
  ('metformin%', 'Metformin (biguanide)',
    'Helps your body respond better to insulin and lowers how much sugar your liver releases, to keep blood glucose in a healthier range.',
    'Blood glucose readings gradually settling into your target range over several weeks — it is not a fast-acting drug.',
    'Stomach upset, diarrhoea, or nausea, especially when starting — often eases if taken with food.',
    'Tell your care team before any procedure needing contrast dye or if you become seriously dehydrated (e.g. from vomiting/diarrhoea).',
    'Kidney function is checked periodically while you are on this — see the lab monitoring on your medications page.'),
  ('amlodipine%', 'Amlodipine (calcium channel blocker)',
    'Relaxes and widens blood vessels so your heart does not have to work as hard, lowering blood pressure.',
    'Blood pressure readings trending down over 1-2 weeks.',
    'Ankle/leg swelling, flushing, or headache — usually mild and often eases over time.',
    'Do not stop suddenly without talking to your care team, even if you feel fine — blood pressure control needs to stay continuous.',
    'Home blood pressure checks help your care team see how well this is working between visits.'),
  ('lisinopril%', 'ACE inhibitor', 'Relaxes blood vessels and reduces the workload on your heart, lowering blood pressure and protecting your kidneys over time.',
    'Blood pressure readings trending down over 1-2 weeks.',
    'A dry, tickly cough in some people; dizziness when standing up quickly, especially with the first few doses.',
    'Tell your care team right away about facial/lip/throat swelling (rare but urgent) or if you are or may become pregnant.',
    'Kidney function and potassium are checked after starting or a dose change — see the lab monitoring on your medications page.'),
  ('ramipril%', 'ACE inhibitor', 'Relaxes blood vessels and reduces the workload on your heart, lowering blood pressure and protecting your kidneys over time.',
    'Blood pressure readings trending down over 1-2 weeks.',
    'A dry, tickly cough in some people; dizziness when standing up quickly, especially with the first few doses.',
    'Tell your care team right away about facial/lip/throat swelling (rare but urgent) or if you are or may become pregnant.',
    'Kidney function and potassium are checked after starting or a dose change — see the lab monitoring on your medications page.'),
  ('losartan%', 'ARB (angiotensin receptor blocker)',
    'Relaxes blood vessels to lower blood pressure — often used when an ACE inhibitor causes a cough.',
    'Blood pressure readings trending down over 1-2 weeks.',
    'Dizziness, especially when standing up quickly; occasionally raised potassium.',
    'Tell your care team if you are or may become pregnant.',
    'Kidney function and potassium may be checked periodically.'),
  ('hydrochlorothiazide%', 'Thiazide diuretic',
    'A "water pill" that helps your kidneys remove extra salt and water, lowering blood pressure.',
    'More frequent urination, especially in the first few days.',
    'Dizziness, low potassium (muscle cramps/weakness), increased urination.',
    'Stay hydrated in hot weather; tell your care team if you feel unusually weak or crampy.',
    'Kidney function and electrolytes (especially potassium) are checked periodically while you are on this.'),
  ('atorvastatin%', 'Statin', 'Lowers cholesterol to reduce your long-term risk of heart attack and stroke.',
    'Cholesterol levels improving over weeks to months — you will not feel a difference day to day.',
    'Muscle aches are the most common complaint; usually mild.',
    'Tell your care team promptly about severe, unexplained muscle pain or weakness, or if you are or may become pregnant.',
    'Liver function is checked when clinically indicated — see the lab monitoring on your medications page.'),
  ('rosuvastatin%', 'Statin', 'Lowers cholesterol to reduce your long-term risk of heart attack and stroke.',
    'Cholesterol levels improving over weeks to months — you will not feel a difference day to day.',
    'Muscle aches are the most common complaint; usually mild.',
    'Tell your care team promptly about severe, unexplained muscle pain or weakness, or if you are or may become pregnant.',
    'Liver function is checked when clinically indicated — see the lab monitoring on your medications page.'),
  ('insulin%', 'Insulin', 'Replaces or supplements your body''s own insulin to move sugar from your blood into your cells for energy.',
    'More stable, predictable glucose readings once dosing is settled with your care team.',
    'Low blood sugar (shakiness, sweating, confusion) if a dose is too high relative to food/activity; injection-site reactions.',
    'Always know how to recognise and treat low blood sugar; never change your dose on your own without talking to your care team first.',
    'Regular glucose monitoring is essential — log readings so your care team can see the pattern, not just a single number.'),
  ('glibenclamide%', 'Sulfonylurea', 'Helps your pancreas release more insulin to lower blood glucose after meals.',
    'Lower post-meal glucose readings.',
    'Low blood sugar, especially if a meal is delayed or skipped; mild weight gain over time.',
    'Do not skip meals after taking this; tell your care team about repeated low-blood-sugar episodes.',
    'Regular glucose monitoring helps catch lows early.'),
  ('aspirin%', 'Antiplatelet (low-dose)',
    'Makes blood platelets less likely to stick together, reducing the risk of clots that cause heart attack or stroke, when your care team has judged that benefit outweighs bleeding risk for you.',
    'No day-to-day feeling of "it working" — this is a long-term risk-reduction medicine.',
    'Stomach irritation; easier bruising or bleeding (e.g. gums, minor cuts taking longer to stop).',
    'Tell your care team before any surgery or dental procedure, and about any black/tarry stools or unusual bleeding.',
    null)
on conflict (match_pattern) do nothing;

do $$
begin
  if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'medication_education_topics') then
    raise exception 'medication_education_topics table was not created';
  end if;
  if (select count(*) from public.medication_education_topics) < 10 then
    raise exception 'medication_education_topics seed did not insert the expected rows';
  end if;
  if has_table_privilege('anon', 'public.medication_education_topics', 'SELECT') then
    raise exception 'FAIL: anon can select medication_education_topics';
  end if;
  raise notice 'PASS: medication_education_topics reference table + seed installed, anon denied';
end $$;
