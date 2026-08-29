-- Patient Health Record architecture review, round 3 — patient record search
-- (spec §1.19/§81.x). docs/PATIENT_HEALTH_RECORD_ARCHITECTURE.md §1.19 found
-- this genuinely MISSING: no tsvector/GIN index on any clinical table, no
-- search component anywhere in apps/web/src, no API route — flagged as
-- follow-up "likely a tsvector generated column across the handful of
-- highest-value tables ... plus a simple search UI, once §1.7's problem list
-- gives it something structured to search." patient_conditions now exists
-- (20260827195615), so this builds the generated-column + unified-RPC half.
--
-- DESIGN: a `search_vector` GENERATED ALWAYS AS ... STORED column + GIN index
-- on each of the highest-value clinical tables, plus ONE unified,
-- authorization-checked SECURITY DEFINER function returning ranked results
-- across all of them. Lives in `public` (not `private`) for the same reason
-- public.find_profile_by_phone does — PostgREST only exposes public-schema
-- functions (config.toml [api].schemas) — so the anon-EXECUTE revoke below
-- is not optional (see CLAUDE.md's standing "anon inherits EXECUTE through
-- PUBLIC" gotcha, re-checked live more than once in this project's history).
--
-- No new schema on the read side beyond the generated columns — this is
-- exactly the "query-time concern... not obviously a schema gap" style fix
-- already used for lab-result trend display (§1.13). The generated columns
-- are additive (existing SELECT *, ORM shapes, etc. are unaffected).
--
-- Verified live (koiplnmbgnqnbywhpjlf) before writing this: none of the six
-- target tables already has a search_vector column, and medications carries
-- several columns beyond the base 20260705211129 migration this repo's local
-- checkout shows (indication, route, instructions, ...) — a live/local drift
-- this project has repeatedly documented. medications.indication is included
-- below since it's genuinely searchable ("diabetes" should surface metformin
-- via its indication, not just its name).

alter table public.patient_conditions add column search_vector tsvector
  generated always as (
    setweight(to_tsvector('english', coalesce(condition_name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(icd10_code, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(current_treatment, '')), 'C') ||
    setweight(to_tsvector('english', coalesce(supporting_evidence, '')), 'C')
  ) stored;
create index patient_conditions_search_idx on public.patient_conditions using gin (search_vector);

alter table public.patient_allergies add column search_vector tsvector
  generated always as (
    setweight(to_tsvector('english', coalesce(allergen, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(reaction, '')), 'B')
  ) stored;
create index patient_allergies_search_idx on public.patient_allergies using gin (search_vector);

alter table public.medications add column search_vector tsvector
  generated always as (
    setweight(to_tsvector('english', coalesce(drug_name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(indication, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(dose, '')), 'C') ||
    setweight(to_tsvector('english', coalesce(frequency, '')), 'C')
  ) stored;
create index medications_search_idx on public.medications using gin (search_vector);

alter table public.screening_results add column search_vector tsvector
  generated always as (
    setweight(to_tsvector('english', coalesce(result_summary, '')), 'B')
  ) stored;
create index screening_results_search_idx on public.screening_results using gin (search_vector);

alter table public.patient_documents add column search_vector tsvector
  generated always as (
    setweight(to_tsvector('english', coalesce(document_type::text, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(original_filename, '')), 'C') ||
    setweight(to_tsvector('english', coalesce(note, '')), 'C')
  ) stored;
create index patient_documents_search_idx on public.patient_documents using gin (search_vector);

alter table public.imaging_reports add column search_vector tsvector
  generated always as (
    setweight(to_tsvector('english', coalesce(modality::text, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(body_region, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(study_description, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(findings_summary, '')), 'C')
  ) stored;
create index imaging_reports_search_idx on public.imaging_reports using gin (search_vector);

-- ---------------------------------------------------------------------------
-- Unified search RPC.
--
-- Authorization is checked EXPLICITLY inside the function (self, org staff of
-- the patient's own organisation, or an explicit clinical-access grantee via
-- private.can_read_clinical) rather than relying only on each table's own RLS
-- SELECT policy — SECURITY DEFINER functions bypass RLS by design, so the
-- check has to be real, not assumed. Mirrors the same three-clause shape
-- private.can_read_record_correction() already uses for the same kind of
-- decision. Raises rather than silently returning empty on an unauthorised
-- caller — this is a deliberate query action, not a background write path.
-- ---------------------------------------------------------------------------
create or replace function public.search_patient_record(p_patient uuid, p_query text)
returns table (
  table_name  text,
  record_id   uuid,
  title       text,
  snippet     text,
  occurred_at timestamptz,
  rank        real
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_ts  tsquery;
begin
  select p.organisation_id into v_org from public.profiles p where p.id = p_patient;
  if v_org is null then
    raise exception 'unknown patient';
  end if;

  if not (
    p_patient = (select auth.uid())
    or private.is_org_staff(v_org)
    or private.can_read_clinical(p_patient)
  ) then
    raise exception 'insufficient_privilege: not authorised to search this patient''s record';
  end if;

  if p_query is null or length(btrim(p_query)) = 0 then
    return;
  end if;

  v_ts := websearch_to_tsquery('english', p_query);

  return query
  select 'patient_conditions'::text, c.id, c.condition_name,
         coalesce(nullif(c.current_treatment, ''), c.supporting_evidence),
         coalesce(c.last_reviewed_at, c.date_identified::timestamptz, c.created_at),
         ts_rank(c.search_vector, v_ts)
    from public.patient_conditions c
    where c.patient_id = p_patient and c.search_vector @@ v_ts
  union all
  select 'patient_allergies'::text, a.id, a.allergen, a.reaction, a.noted_at, ts_rank(a.search_vector, v_ts)
    from public.patient_allergies a
    where a.patient_id = p_patient and a.search_vector @@ v_ts
  union all
  select 'medications'::text, m.id, m.drug_name, m.dose, m.created_at, ts_rank(m.search_vector, v_ts)
    from public.medications m
    where m.patient_id = p_patient and m.search_vector @@ v_ts
  union all
  select 'screening_results'::text, s.id, 'Screening result'::text, s.result_summary, s.created_at,
         ts_rank(s.search_vector, v_ts)
    from public.screening_results s
    where s.patient_id = p_patient and s.search_vector @@ v_ts
  union all
  select 'patient_documents'::text, d.id, replace(d.document_type::text, '_', ' '),
         coalesce(d.original_filename, d.note), d.created_at, ts_rank(d.search_vector, v_ts)
    from public.patient_documents d
    where d.patient_id = p_patient and d.search_vector @@ v_ts
  union all
  select 'imaging_reports'::text, r.id, replace(r.modality::text, '_', ' '),
         coalesce(r.findings_summary, r.study_description), r.created_at, ts_rank(r.search_vector, v_ts)
    from public.imaging_reports r
    where r.patient_id = p_patient and r.search_vector @@ v_ts
  order by rank desc
  limit 50;
end;
$$;

comment on function public.search_patient_record(uuid, text) is
  'Unified ranked search across a single patient''s conditions/allergies/medications/screening results/documents/imaging. Authorization checked explicitly inside (SECURITY DEFINER bypasses RLS): self, org staff, or an explicit clinical-access grantee. See docs/PATIENT_HEALTH_RECORD_ARCHITECTURE.md §1.19.';

revoke execute on function public.search_patient_record(uuid, text) from public;
revoke execute on function public.search_patient_record(uuid, text) from anon;
grant execute on function public.search_patient_record(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Assertions
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'patient_conditions' and column_name = 'search_vector'
  ) then
    raise exception 'FAIL: patient_conditions.search_vector was not created';
  end if;

  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'search_patient_record'
  ) then
    raise exception 'FAIL: public.search_patient_record was not created';
  end if;

  if has_function_privilege('anon', 'public.search_patient_record(uuid, text)', 'EXECUTE') then
    raise exception 'FAIL: anon can still execute public.search_patient_record — PUBLIC-inherited EXECUTE was not revoked';
  end if;

  if not has_function_privilege('authenticated', 'public.search_patient_record(uuid, text)', 'EXECUTE') then
    raise exception 'FAIL: authenticated cannot execute public.search_patient_record';
  end if;

  raise notice 'PASS: patient_record_search — generated search_vector columns, GIN indexes, and RPC installed with correct EXECUTE grants';
end $$;
