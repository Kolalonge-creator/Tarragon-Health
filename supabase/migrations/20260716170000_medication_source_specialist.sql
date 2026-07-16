-- Tarragon Health — medication_source gains 'specialist' (medication pathway, Phase 2)
--
-- Pathway Scenario 3: a partner specialist starts a medication (e.g. a
-- cardiologist adds Sacubitril/Valsartan). Until now `medication_source` was
-- only 'clinician' | 'patient'. A specialist-sourced record is distinct from
-- both: it carries the specialist's name (external prescriber, not an employed
-- clinical_staff row) and, ideally, the consultation document. The patient may
-- add it themselves from the specialist's letter, or a clinician transcribes it.
--
-- Enum-value additions live in their own migration (matching
-- 20260715001653_booking_status_enum_values.sql) so no later statement uses the
-- new value in the same transaction. Idempotent via ADD VALUE IF NOT EXISTS.

alter type public.medication_source add value if not exists 'specialist';
