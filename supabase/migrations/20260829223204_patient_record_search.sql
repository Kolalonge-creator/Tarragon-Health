-- Patient Health Record architecture review, round 3 — patient record search
-- (spec §1.19/§81.x). docs/PATIENT_HEALTH_RECORD_ARCHITECTURE.md §1.19 found
-- this genuinely MISSING: no tsvector/GIN index on any clinical table, no
-- search component anywhere in apps/web/src, no API route — flagged as
-- follow-up "likely a tsvector generated column across the handful of
-- highest-value tables ... plus a simple search UI, once §1.7's problem list
-- gives it something structured to search." patient_conditions now exists
-- (20260827195615), so this builds the generated-column + unified-RPC half.
--
-- DESIGN: a `search_vector` tsvector column + GIN index on each of the
-- highest-value clinical tables, plus ONE unified, authorization-checked
-- SECURITY DEFINER function returning ranked results across all of them.
-- Lives in `public` (not `private`) for the same reason public.find_profile_
-- by_phone does — PostgREST only exposes public-schema functions
-- (config.toml [api].schemas) — so the anon-EXECUTE revoke below is not
-- optional (see CLAUDE.md's standing "anon inherits EXECUTE through PUBLIC"
-- gotcha, re-checked live more than once in this project's history).
--
-- NOT a GENERATED ALWAYS AS ... STORED column, despite that being the more
-- obvious design and this migration's own first draft: Postgres's
-- `to_tsvector(regconfig, text)` is classified STABLE, not IMMUTABLE (it
-- depends on the named text-search configuration, which is in principle
-- alterable), and a generation expression must be IMMUTABLE — confirmed the
-- hard way via this project's CI migration-replay check
-- (`ERROR: generation expression is not immutable (SQLSTATE 42P17)`), not by
-- reasoning about it in advance. Instead: a plain `tsvector` column kept
-- current by a dedicated `BEFORE INSERT OR UPDATE` trigger per table (same
-- shape as every other derived-column trigger in this codebase), plus a
-- one-time backfill `UPDATE` for the four tables that already carry live
-- production data (`patient_conditions`/`patient_allergies`/`medications`/
-- `screening_results` — `patient_documents`/`imaging_reports` are brand new
-- in this same migration set, so they have no existing rows to backfill).
--
-- No new schema on the read side otherwise — this is exactly the "query-time
-- concern... not obviously a schema gap" style fix already used for
-- lab-result trend display (§1.13). The new columns are additive (existing
-- SELECT *, ORM shapes, etc. are unaffected).
--
-- Verified live (koiplnmbgnqnbywhpjlf) before writing this: none of the six
-- target tables already has a search_vector column, and medications carries
-- several columns beyond the base 20260705211129 migration this repo's local
-- checkout shows (indication, route, instructions, ...) — a live/local drift
-- this project has repeatedly documented. medications.indication is included
-- below since it's genuinely searchable ("diabetes" should surface metformin
-- via its indication, not just its name).

-- --- patient_conditions -------------------------------------------------
alter table public.patient_conditions add column search_vector tsvector;
create index patient_conditions_search_idx on public.patient_conditions using gin (search_vector);

create or replace function private.patient_conditions_search_vector_update()
returns trigger
language plpgsql
as $$
begin
  new.search_vector :=
    setweight(to_tsvector('english', coalesce(new.condition_name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(new.icd10_code, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(new.current_treatment, '')), 'C') ||
    setweight(to_tsvector('english', coalesce(new.supporting_evidence, '')), 'C');
  return new;
end;
$$;

create trigger patient_conditions_search_vector_trg
  before insert or update on public.patient_conditions
  for each row execute function private.patient_conditions_search_vector_update();

-- patient_conditions is one of the two record_corrections reason-mandatory
-- tables (20260827195333) — this backfill touches every existing row, going
-- search_vector NULL -> a real value, which capture_record_correction()
-- would otherwise flag as a changed column requiring a reason. Set it once
-- for the whole statement (transaction-local GUC, same idiom used
-- throughout this migration set).
select set_config('app.change_reason', 'backfill: populate new search_vector column (patient record search, round 3)', true);
update public.patient_conditions set search_vector =
  setweight(to_tsvector('english', coalesce(condition_name, '')), 'A') ||
  setweight(to_tsvector('english', coalesce(icd10_code, '')), 'B') ||
  setweight(to_tsvector('english', coalesce(current_treatment, '')), 'C') ||
  setweight(to_tsvector('english', coalesce(supporting_evidence, '')), 'C');

-- --- patient_allergies ----------------------------------------------------
alter table public.patient_allergies add column search_vector tsvector;
create index patient_allergies_search_idx on public.patient_allergies using gin (search_vector);

create or replace function private.patient_allergies_search_vector_update()
returns trigger
language plpgsql
as $$
begin
  new.search_vector :=
    setweight(to_tsvector('english', coalesce(new.allergen, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(new.reaction, '')), 'B');
  return new;
end;
$$;

create trigger patient_allergies_search_vector_trg
  before insert or update on public.patient_allergies
  for each row execute function private.patient_allergies_search_vector_update();

-- patient_allergies is the other reason-mandatory table — same guard.
select set_config('app.change_reason', 'backfill: populate new search_vector column (patient record search, round 3)', true);
update public.patient_allergies set search_vector =
  setweight(to_tsvector('english', coalesce(allergen, '')), 'A') ||
  setweight(to_tsvector('english', coalesce(reaction, '')), 'B');

-- --- medications ------------------------------------------------------------
alter table public.medications add column search_vector tsvector;
create index medications_search_idx on public.medications using gin (search_vector);

create or replace function private.medications_search_vector_update()
returns trigger
language plpgsql
as $$
begin
  new.search_vector :=
    setweight(to_tsvector('english', coalesce(new.drug_name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(new.indication, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(new.dose, '')), 'C') ||
    setweight(to_tsvector('english', coalesce(new.frequency, '')), 'C');
  return new;
end;
$$;

create trigger medications_search_vector_trg
  before insert or update on public.medications
  for each row execute function private.medications_search_vector_update();

update public.medications set search_vector =
  setweight(to_tsvector('english', coalesce(drug_name, '')), 'A') ||
  setweight(to_tsvector('english', coalesce(indication, '')), 'B') ||
  setweight(to_tsvector('english', coalesce(dose, '')), 'C') ||
  setweight(to_tsvector('english', coalesce(frequency, '')), 'C');

-- --- screening_results ------------------------------------------------------
alter table public.screening_results add column search_vector tsvector;
create index screening_results_search_idx on public.screening_results using gin (search_vector);

create or replace function private.screening_results_search_vector_update()
returns trigger
language plpgsql
as $$
begin
  new.search_vector := setweight(to_tsvector('english', coalesce(new.result_summary, '')), 'B');
  return new;
end;
$$;

create trigger screening_results_search_vector_trg
  before insert or update on public.screening_results
  for each row execute function private.screening_results_search_vector_update();

update public.screening_results set search_vector =
  setweight(to_tsvector('english', coalesce(result_summary, '')), 'B');

-- --- patient_documents (new table this round — nothing to backfill) --------
alter table public.patient_documents add column search_vector tsvector;
create index patient_documents_search_idx on public.patient_documents using gin (search_vector);

create or replace function private.patient_documents_search_vector_update()
returns trigger
language plpgsql
as $$
begin
  new.search_vector :=
    setweight(to_tsvector('english', coalesce(new.document_type::text, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(new.original_filename, '')), 'C') ||
    setweight(to_tsvector('english', coalesce(new.note, '')), 'C');
  return new;
end;
$$;

create trigger patient_documents_search_vector_trg
  before insert or update on public.patient_documents
  for each row execute function private.patient_documents_search_vector_update();

-- --- imaging_reports (new table this round — nothing to backfill) ----------
alter table public.imaging_reports add column search_vector tsvector;
create index imaging_reports_search_idx on public.imaging_reports using gin (search_vector);

create or replace function private.imaging_reports_search_vector_update()
returns trigger
language plpgsql
as $$
begin
  new.search_vector :=
    setweight(to_tsvector('english', coalesce(new.modality::text, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(new.body_region, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(new.study_description, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(new.findings_summary, '')), 'C');
  return new;
end;
$$;

create trigger imaging_reports_search_vector_trg
  before insert or update on public.imaging_reports
  for each row execute function private.imaging_reports_search_vector_update();

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
