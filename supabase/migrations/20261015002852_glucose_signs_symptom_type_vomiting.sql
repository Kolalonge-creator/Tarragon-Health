-- Glucose warning signs stored on the server, one of three enum files (vomiting, abdominal_pain, cannot_swallow), then the mapping migration: the symptom_type value 'vomiting'.
-- The glucose engine (rule set glucose_care_triage) reads this sign, and the phone's glucose entry ticks it, but the server's symptom log
-- had no value for it, so the server could not grade it. Alone in its own file on purpose: a new enum value cannot be used in the
-- transaction that adds it, and the mapping migration (a later file) refers to it. Nothing uses the value yet, so this changes no behaviour by itself.
alter type public.symptom_type add value if not exists 'vomiting';
