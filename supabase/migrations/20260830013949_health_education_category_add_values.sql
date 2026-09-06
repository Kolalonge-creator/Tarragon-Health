-- Tarragon Health — Health Education: category taxonomy expansion (§79.2)
--
-- health_education_category (20260810013703) has 14 values covering most of
-- the blueprint's list, but exercise/sleep/vaccination content today lives
-- as prose inside other categories (e.g. htn_w10_sleep_apnoea under
-- 'hypertension', family-childhood-vaccine-schedule under 'family_child')
-- rather than being independently browsable. Values-only migration —
-- Postgres cannot use a newly added enum value in the same transaction that
-- added it, so retagging happens in the next migration.
alter type public.health_education_category add value if not exists 'exercise';
alter type public.health_education_category add value if not exists 'sleep';
alter type public.health_education_category add value if not exists 'vaccination';
