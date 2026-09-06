-- Tarragon Health
-- 20260902220000_imaging_reports.sql replaced the simple placeholder
-- public.imaging_reports (findings_summary/study_description/search_vector,
-- from the unrelated PHR gap-closure pass) with the real Imaging &
-- Diagnostic Procedure Platform's richer table (findings/impression/
-- body_region, no search_vector column at all). private.search_patient_record()
-- (redefined most recently by 20260830103251_category_scoped_clinical_access_
-- and_emergency_access.sql, off limits to edit directly) still selects the
-- old columns for its imaging_reports branch and would fail with "column
-- r.search_vector does not exist" on first use. Fix forward: add a
-- search_vector column + maintenance trigger to the new table (same pattern
-- 20260830004048_patient_record_search.sql used for every other searchable
-- table), then redefine search_patient_record() once more, changing only the
-- imaging_reports branch to reference the new column names -- every other
-- branch (conditions/allergies/medications/screening_results/documents) is
-- carried forward unchanged.

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
    setweight(to_tsvector('english', coalesce(new.impression, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(new.findings, '')), 'C');
  return new;
end;
$$;

create trigger imaging_reports_search_vector_trg
  before insert or update on public.imaging_reports
  for each row execute function private.imaging_reports_search_vector_update();

create or replace function public.search_patient_record(p_patient uuid, p_query text)
returns table(table_name text, record_id uuid, title text, snippet text, occurred_at timestamptz, rank real)
language plpgsql
stable security definer
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
    or private.can_read_clinical(p_patient, 'medical_history')
  ) then
    raise exception 'insufficient_privilege: not authorised to search this patient''s record';
  end if;

  if p_query is null or length(btrim(p_query)) = 0 then
    return;
  end if;

  v_ts := websearch_to_tsquery('english', p_query);

  return query
  select
    'patient_conditions'::text as table_name, c.id as record_id, c.condition_name as title,
    coalesce(nullif(c.current_treatment, ''), c.supporting_evidence) as snippet,
    coalesce(c.last_reviewed_at, c.date_identified::timestamptz, c.created_at) as occurred_at,
    ts_rank(c.search_vector, v_ts) as rank
    from public.patient_conditions c
    where c.patient_id = p_patient and c.search_vector @@ v_ts
  union all
  select
    'patient_allergies'::text as table_name, a.id as record_id, a.allergen as title, a.reaction as snippet,
    a.noted_at as occurred_at, ts_rank(a.search_vector, v_ts) as rank
    from public.patient_allergies a
    where a.patient_id = p_patient and a.search_vector @@ v_ts
  union all
  select
    'medications'::text as table_name, m.id as record_id, m.drug_name as title, m.dose as snippet,
    m.created_at as occurred_at, ts_rank(m.search_vector, v_ts) as rank
    from public.medications m
    where m.patient_id = p_patient and m.search_vector @@ v_ts
  union all
  select
    'screening_results'::text as table_name, s.id as record_id, 'Screening result'::text as title,
    s.result_summary as snippet, s.created_at as occurred_at, ts_rank(s.search_vector, v_ts) as rank
    from public.screening_results s
    where s.patient_id = p_patient and s.search_vector @@ v_ts
  union all
  select
    'patient_documents'::text as table_name, d.id as record_id, replace(d.document_type::text, '_', ' ') as title,
    coalesce(d.original_filename, d.note) as snippet, d.created_at as occurred_at,
    ts_rank(d.search_vector, v_ts) as rank
    from public.patient_documents d
    where d.patient_id = p_patient and d.search_vector @@ v_ts
  union all
  select
    'imaging_reports'::text as table_name, r.id as record_id, replace(r.modality::text, '_', ' ') as title,
    coalesce(r.impression, r.findings) as snippet, r.created_at as occurred_at,
    ts_rank(r.search_vector, v_ts) as rank
    from public.imaging_reports r
    where r.patient_id = p_patient and r.search_vector @@ v_ts
  order by rank desc
  limit 50;
end;
$$;

comment on function public.search_patient_record(uuid, text) is
  'Unified ranked search across a single patient''s conditions/allergies/medications/screening results/documents/imaging. Authorization checked explicitly inside (SECURITY DEFINER bypasses RLS): self, org staff, or an explicit clinical-access grantee. Imaging branch updated 2026-09-02 for the real Imaging & Diagnostic Procedure Platform table shape (findings/impression, no findings_summary/study_description). See docs/PATIENT_HEALTH_RECORD_ARCHITECTURE.md §1.19.';

revoke execute on function public.search_patient_record(uuid, text) from public, anon;
grant execute on function public.search_patient_record(uuid, text) to authenticated;

-- Proof, not hope.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'imaging_reports' and column_name = 'search_vector'
  ) then
    raise exception 'FAIL: imaging_reports.search_vector was not added';
  end if;

  if (select pg_get_functiondef('public.search_patient_record(uuid, text)'::regprocedure)) not like '%r.impression%' then
    raise exception 'FAIL: search_patient_record was not updated for the new imaging_reports shape';
  end if;

  raise notice 'PASS: imaging_reports search restored on the new platform schema';
end $$;
