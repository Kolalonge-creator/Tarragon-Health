-- Tarragon Health — E-E-A-T signal for /resources: an optional per-article
-- medical-review credit, plus surfacing the row's real update time.
--
-- Same honesty discipline as health_education_content.reviewed_by_name /
-- reviewed_at (20260717150000): a LIBRARY-LEVEL quality credit an admin sets
-- once a real clinician has actually read the article, not a per-patient
-- clinical attribution, and not the null-gated ReviewedByDoctor case-review
-- component (CLINICAL_TRUST_MODEL_SPEC §2/§9 — that rule governs claims
-- about a specific patient's case, which this is not). Both columns stay
-- null until an admin genuinely fills them in — the article page must only
-- ever render the byline when both are set.

alter table public.marketing_resources
  add column if not exists reviewed_by_name text,
  add column if not exists reviewed_at timestamptz;
