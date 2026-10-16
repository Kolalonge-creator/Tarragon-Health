-- S67, migration 3 of 4: three symptom values for the pregnancy danger-sign group (CMO selection A2, 2026-10-07, PROPOSED).
-- Kept alone because a new enum value cannot be used in the transaction that adds it; migration 4 refers to them only as text.
-- Existing symptom rows are unaffected (0 rows use these values).
alter type public.symptom_type add value if not exists 'convulsion';
alter type public.symptom_type add value if not exists 'loss_of_consciousness';
alter type public.symptom_type add value if not exists 'sudden_face_hand_swelling';
