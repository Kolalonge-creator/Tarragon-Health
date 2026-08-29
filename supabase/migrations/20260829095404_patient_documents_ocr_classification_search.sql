-- Tarragon Health — Document & Clinical Record Management, part 4/5: OCR text
-- extraction + AI classification (§35.8, §35.9) and search (§35.10).

-- ---------------------------------------------------------------------------
-- 1. OCR / classification
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'document_ocr_status') then
    create type public.document_ocr_status as enum ('pending', 'completed', 'failed');
  end if;
end $$;

-- §35.9: "important classification should have confidence thresholds and
-- appropriate verification." Four states, not a boolean, because "the model
-- agreed with the uploader" and "nobody has looked at a disagreement yet" are
-- different facts a worklist needs to tell apart:
--   agrees        the suggested type matches (or there is no suggestion) —
--                 nothing for a human to do.
--   needs_review  the suggestion disagrees with the declared document_type.
--                 §35.8: OCR-derived information never overwrites verified
--                 clinical information, so this NEVER changes
--                 patient_documents.document_type itself (which is frozen at
--                 insert — see part 2's update guard) — it only surfaces the
--                 disagreement for a person to act on, typically by filing a
--                 corrected version through supersede_patient_document.
--   reviewed      a person looked at the disagreement and recorded a verdict
--                 (reviewed_by/reviewed_at, null-gated exactly like every
--                 other clinical-review stamp on the platform).
--   pending       no OCR result yet.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'document_classification_status') then
    create type public.document_classification_status as enum (
      'pending',
      'agrees',
      'needs_review',
      'reviewed'
    );
  end if;
end $$;

create table if not exists public.patient_document_extractions (
  id                       uuid primary key default gen_random_uuid(),
  organisation_id          uuid not null references public.organisations (id) on delete restrict,
  patient_id               uuid not null references public.profiles (id) on delete cascade,
  -- One live extraction per document, exactly like ecg_report_extractions —
  -- re-running OCR replaces the draft rather than accumulating ones a
  -- reviewer would have to choose between.
  document_id              uuid not null unique
                             references public.patient_documents (id) on delete cascade,

  ocr_status               public.document_ocr_status not null default 'pending',
  ocr_error                text,
  -- Kept verbatim so a reviewer can see everything the OCR pass saw, not just
  -- the fields anything downstream chose to structure.
  extracted_text           text,
  extracted_at             timestamptz,

  -- §35.9 classification.
  suggested_document_type  public.patient_document_type,
  classification_confidence numeric(4, 3) check (
    classification_confidence is null
    or (classification_confidence >= 0 and classification_confidence <= 1)
  ),
  classification_status    public.document_classification_status not null default 'pending',
  classified_at            timestamptz,
  -- Null-gated human-verification stamp (docs/CLINICAL_TRUST_MODEL_SPEC.md
  -- §2 pattern) — set only once a person has actually looked at a mismatch.
  reviewed_by              uuid references public.profiles (id) on delete set null,
  reviewed_at              timestamptz,
  review_note              text,

  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create index if not exists patient_document_extractions_patient_idx
  on public.patient_document_extractions (patient_id);
create index if not exists patient_document_extractions_org_idx
  on public.patient_document_extractions (organisation_id);
-- Classification worklist: disagreements nobody has looked at yet.
create index if not exists patient_document_extractions_needs_review_idx
  on public.patient_document_extractions (organisation_id, classified_at)
  where classification_status = 'needs_review';

drop trigger if exists patient_document_extractions_set_updated_at on public.patient_document_extractions;
create trigger patient_document_extractions_set_updated_at
  before update on public.patient_document_extractions
  for each row execute function private.set_updated_at();

comment on table public.patient_document_extractions is
  '§35.8/§35.9. OCR text + AI type-classification draft for one document. Never a source of truth for patient_documents.document_type (immutable after insert) — a disagreement is surfaced for review, never auto-applied. Same "AI drafts, human confirms" shape as lab_report extraction and ecg_report_extractions.';

alter table public.patient_document_extractions enable row level security;

-- Same audience as the document itself. There is no separate "administrative
-- OCR" concept — an extraction inherits its document's category/
-- confidentiality by joining back to patient_documents rather than carrying
-- its own copy, so the two can never drift apart.
drop policy if exists patient_document_extractions_select on public.patient_document_extractions;
create policy patient_document_extractions_select on public.patient_document_extractions
  for select to authenticated
  using (
    exists (
      select 1 from public.patient_documents d
      where d.id = patient_document_extractions.document_id
        and (
          private.patient_document_readable(d.patient_id, d.organisation_id, d.category, d.confidentiality)
          or private.patient_document_shared_with_caller(d.id)
        )
    )
  );

-- Written only by the OCR pipeline (service-role) and by org staff recording
-- a review verdict — never by a patient, who has no reason to author their
-- own document's classification draft.
drop policy if exists patient_document_extractions_insert on public.patient_document_extractions;
create policy patient_document_extractions_insert on public.patient_document_extractions
  for insert to authenticated
  with check (private.is_org_staff(organisation_id));

drop policy if exists patient_document_extractions_update on public.patient_document_extractions;
create policy patient_document_extractions_update on public.patient_document_extractions
  for update to authenticated
  using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));

grant select, insert, update on public.patient_document_extractions to authenticated;

-- The confidence threshold above which a suggestion is trusted enough to
-- resolve an AGREEMENT automatically (i.e. no disagreement worth a human's
-- time) — it never raises the bar for FILING a document, only for how loudly
-- a disagreement below it is surfaced. A single named function so the number
-- lives in one place rather than three trigger bodies.
create or replace function private.document_classification_review_threshold()
returns numeric
language sql
immutable
set search_path = ''
as $$
  select 0.75::numeric;
$$;

-- Classifies on every insert/update of the suggestion or confidence, so a
-- re-run OCR pass (which replaces this row rather than adding another one)
-- re-evaluates the same way a first pass would.
create or replace function private.classify_patient_document_extraction()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_declared_type public.patient_document_type;
  v_title         text;
begin
  -- A review verdict — whether it was already recorded, or is being recorded
  -- by THIS update — freezes the status label regardless of what else the
  -- same UPDATE touches. Checked first and unconditionally, so a reviewer
  -- setting reviewed_at can never fall through into the reclassify logic
  -- below and re-raise the very alert they just resolved.
  if new.reviewed_at is not null then
    new.classification_status := 'reviewed';
    return new;
  end if;

  if new.suggested_document_type is null then
    new.classification_status := case when new.ocr_status = 'completed' then 'agrees' else 'pending' end;
    if new.ocr_status = 'completed' then
      new.classified_at := coalesce(new.classified_at, now());
    end if;
    return new;
  end if;

  select document_type, title into v_declared_type, v_title
    from public.patient_documents where id = new.document_id;

  new.classified_at := now();

  if new.suggested_document_type = v_declared_type then
    new.classification_status := 'agrees';
    return new;
  end if;

  new.classification_status := 'needs_review';

  -- Don't re-raise the same alert every time an unrelated column on this row
  -- is touched — only actually alert the run that first surfaces THIS
  -- suggestion/confidence pair as a mismatch.
  if tg_op = 'UPDATE'
     and old.classification_status = 'needs_review'
     and old.suggested_document_type is not distinct from new.suggested_document_type
     and old.classification_confidence is not distinct from new.classification_confidence
  then
    return new;
  end if;

  -- Only raise a clinician review flag for a HIGH-confidence disagreement on
  -- a document that mattered enough to reach the registry at all — a low-
  -- confidence guess is noise a worklist can absorb without paging anyone,
  -- matching the platform's existing alert-fatigue discipline.
  if coalesce(new.classification_confidence, 0) >= private.document_classification_review_threshold() then
    insert into public.clinician_alerts
      (organisation_id, patient_id, level, status, title, detail, escalation_level)
    values (
      new.organisation_id,
      new.patient_id,
      'clinician_review',
      'open',
      'Document type mismatch — needs review',
      format(
        '"%s" was filed as %s, but automatic classification suggests %s (confidence %s). The filed type has not been changed — review and, if it is wrong, file a corrected version.',
        v_title, v_declared_type::text, new.suggested_document_type::text,
        round(new.classification_confidence, 2)::text
      ),
      2
    );
  end if;

  return new;
end;
$$;

drop trigger if exists patient_document_extractions_classify on public.patient_document_extractions;
create trigger patient_document_extractions_classify
  before insert or update of suggested_document_type, classification_confidence, ocr_status, reviewed_at
  on public.patient_document_extractions
  for each row execute function private.classify_patient_document_extraction();

-- Review-verdict attribution, server-derived — same shape as
-- enforce_lab_result_document_update's reviewed_by handling.
create or replace function private.enforce_patient_document_extraction_review()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.organisation_id := old.organisation_id;
  new.patient_id       := old.patient_id;
  new.document_id      := old.document_id;

  if new.reviewed_at is not null and old.reviewed_at is null then
    new.reviewed_by := coalesce((select auth.uid()), new.reviewed_by);
    new.reviewed_at := now();
  elsif old.reviewed_at is not null then
    new.reviewed_by := old.reviewed_by;
    new.reviewed_at := old.reviewed_at;
  end if;

  return new;
end;
$$;

drop trigger if exists patient_document_extractions_review_guard on public.patient_document_extractions;
create trigger patient_document_extractions_review_guard
  before update on public.patient_document_extractions
  for each row execute function private.enforce_patient_document_extraction_review();

-- ---------------------------------------------------------------------------
-- 2. Search (§35.10) — "search HbA1c and find relevant results, reports,
--    consultation notes."
-- ---------------------------------------------------------------------------
-- One tsvector over the document's own metadata plus its OCR text once one
-- exists, so a search for an analyte name that only appears inside a scanned
-- PDF still finds it. Weighted so a title/type match ranks above a body-text
-- hit — the metadata is almost always what a clinician typed to find the
-- document again, extracted_text is what makes an otherwise-opaque PDF
-- searchable at all.
-- document_type's text form comes from a CASE over literal comparisons, not
-- a cast (document_type::text) — an enum-to-text cast goes through enum_out,
-- which Postgres marks STABLE rather than IMMUTABLE (a value's label could
-- change under ALTER TYPE ... RENAME VALUE), so a GENERATED STORED column
-- cannot use it directly ("generation expression is not immutable"). Enum
-- equality against a literal, unlike enum_out, is immutable, so the CASE
-- itself is safe.
alter table public.patient_documents
  add column if not exists search_vector tsvector
    generated always as (
      setweight(to_tsvector('english', coalesce(title, '')), 'A')
      || setweight(
           to_tsvector('english', case document_type
             when 'laboratory_report' then 'laboratory report'
             when 'imaging_report' then 'imaging report'
             when 'referral_letter' then 'referral letter'
             when 'consultation_note' then 'consultation note'
             when 'prescription' then 'prescription'
             when 'discharge_summary' then 'discharge summary'
             when 'consent_form' then 'consent form'
             when 'invoice' then 'invoice'
             when 'insurance_document' then 'insurance document'
             when 'identification_document' then 'identification document'
             when 'clinical_photograph' then 'clinical photograph'
             else 'other'
           end),
           'B'
         )
      || setweight(to_tsvector('english', coalesce(description, '')), 'C')
      || setweight(to_tsvector('english', coalesce(author_name, '') || ' ' || coalesce(author_organisation, '')), 'D')
    ) stored;

create index if not exists patient_documents_search_idx
  on public.patient_documents using gin (search_vector);

-- OCR text lives on the extraction row, not on patient_documents itself (this
-- table does not own the OCR pipeline's data), so it gets its own generated
-- column + index rather than being folded into the expression above.
alter table public.patient_document_extractions
  add column if not exists search_vector tsvector
    generated always as (
      setweight(to_tsvector('english', coalesce(extracted_text, '')), 'B')
    ) stored;

create index if not exists patient_document_extractions_search_idx
  on public.patient_document_extractions using gin (search_vector);

-- Single search entry point — joins both vectors so a caller does not need to
-- know that OCR text lives in a different table, and re-uses the exact same
-- readability predicate as the SELECT policies rather than trusting the
-- caller's own RLS-scoped read (SECURITY DEFINER functions bypass RLS, so the
-- check has to be explicit here, same reasoning as
-- private.record_patient_document_access).
create or replace function public.search_patient_documents(
  p_patient_id uuid,
  p_query      text
)
returns table (
  document_id  uuid,
  title        text,
  document_type public.patient_document_type,
  document_date date,
  rank         real
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    d.id,
    d.title,
    d.document_type,
    d.document_date,
    ts_rank(d.search_vector || coalesce(e.search_vector, ''::tsvector), websearch_to_tsquery('english', p_query)) as rank
  from public.patient_documents d
  left join public.patient_document_extractions e on e.document_id = d.id
  where d.patient_id = p_patient_id
    and d.status not in ('created', 'rejected')
    and (
      private.patient_document_readable(d.patient_id, d.organisation_id, d.category, d.confidentiality)
      or private.patient_document_shared_with_caller(d.id)
    )
    and (d.search_vector || coalesce(e.search_vector, ''::tsvector)) @@ websearch_to_tsquery('english', p_query)
  order by rank desc, d.document_date desc nulls last
  limit 50;
$$;

comment on function public.search_patient_documents(uuid, text) is
  '§35.10. Full-text search across a patient''s documents plus their OCR text. Re-checks readability itself (this is a SECURITY DEFINER function, so RLS does not run for it) rather than trusting the caller — same reasoning as private.record_patient_document_access.';

revoke execute on function public.search_patient_documents(uuid, text) from public;
revoke execute on function public.search_patient_documents(uuid, text) from anon;
grant execute on function public.search_patient_documents(uuid, text) to authenticated, service_role;
