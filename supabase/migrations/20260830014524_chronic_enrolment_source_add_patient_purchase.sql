-- Episodic-fee rebuild, step 2/6.
--
-- chronic_programme_enrolments.source needs a value for an enrolment created
-- automatically by a paid programme_purchases activation (step 3), distinct
-- from 'recommended'/'staff'/'clinician' (all of which describe a clinician
-- deciding to enrol someone). Isolated in its own migration — this repo has
-- been bitten before by combining an ADD VALUE with code in the same file
-- that references the new value in the same transaction.

alter type public.chronic_enrolment_source add value if not exists 'patient_purchase';
