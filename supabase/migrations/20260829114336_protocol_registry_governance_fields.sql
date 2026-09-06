-- Tarragon Health — Clinical Governance & Patient Safety spec §31.4.
--
-- protocol_versions (20260712210000) already carries protocol_id, title,
-- version_number, change_summary, content, approved_by, approved_at — but
-- the spec's full registry also names specialty, evidence basis, effective
-- date, review date, retirement date, and applicable population, none of
-- which existed as structured columns (only informally inside the free-text
-- `content` jsonb, unqueryable and unenforced). This adds them.
--
-- All six are nullable. This table is append-only by design (no update/
-- delete policy — 20260712210000's own header) and signing a version is
-- already a considered clinical act; making any of these NOT NULL would
-- force a value onto every past pilot-era signature and every future
-- version regardless of whether it applies (e.g. specialty for a protocol
-- that spans several, or retirement_date for one still very much active).
-- The registry's completeness is a data-quality/UI-affordance improvement,
-- not a new constraint on what "signed" means.
--
-- retirement_date is deliberately NOT a soft-delete/is_active flag: a
-- protocol_versions row's own existence already IS the historical record
-- (multiple prior versions stay visible forever per §5), so "retired" is
-- just a date on the row like any other lifecycle date, not a state that
-- hides the row from anyone.

alter table public.protocol_versions
  add column specialty              text,
  add column evidence_basis         text,
  add column effective_date         date,
  add column review_date            date,
  add column retirement_date        date,
  add column applicable_population  text;

comment on column public.protocol_versions.specialty is
  'Spec §31.4 registry field. Free text (matches clinical_staff.specialty''s own shape) — a protocol can span more than one specialty, so this is not an enum.';
comment on column public.protocol_versions.evidence_basis is
  'Spec §31.4 registry field. The guideline/evidence this version is based on (e.g. a named clinical pathway document, a professional body guideline).';
comment on column public.protocol_versions.effective_date is
  'Spec §31.4 registry field. When this version takes effect for patient care — may differ from approved_at (a version can be signed ahead of its effective date).';
comment on column public.protocol_versions.review_date is
  'Spec §31.4 registry field. When this version is next due for clinical review, independent of whether anything has changed.';
comment on column public.protocol_versions.retirement_date is
  'Spec §31.4 registry field. When this version stopped (or will stop) being the guidance to follow. Not a soft-delete flag — the row itself is the permanent historical record either way (§5); this is only a lifecycle date on it.';
comment on column public.protocol_versions.applicable_population is
  'Spec §31.4 registry field. Free text describing who this version applies to (e.g. age range, diagnosis, plan tier) — deliberately not a structured filter, since the app does not act on this field, only displays it.';

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'protocol_versions' and column_name = 'evidence_basis'
  ) then
    raise exception 'protocol_versions.evidence_basis missing after migration';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'protocol_versions' and column_name = 'retirement_date'
  ) then
    raise exception 'protocol_versions.retirement_date missing after migration';
  end if;
  raise notice 'PASS: protocol_versions registry fields present';
end $$;
