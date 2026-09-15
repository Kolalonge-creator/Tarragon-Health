-- Patient Health Record architecture review, round 3 — fix a genuine live
-- production bug in public.search_patient_record() (20260829223204), found
-- by actually running packages/db/tests/patient_health_record_round3.sql
-- against the live database rather than trusting the earlier "reviewed
-- carefully by hand, not executed" caveat.
--
-- Every call to this function has been failing since it went live:
--
--   ERROR: 0A000: invalid UNION/INTERSECT/EXCEPT ORDER BY clause
--   DETAIL: Only result column names can be used, not expressions or functions.
--
-- Root cause: `RETURNS TABLE (..., rank real)` names the function's OUTPUT
-- row type, but the `return query select ... union all ... order by rank
-- desc` statement is a plain SQL query evaluated on its own — its column
-- names come from what each SELECT branch's expressions produce, not from
-- the enclosing function's RETURNS TABLE clause. None of the six UNION
-- branches aliased their `ts_rank(...)` expression, so no output column is
-- actually named `rank` inside the query itself; Postgres then tries to
-- parse the bare identifier `rank` in ORDER BY as a call to the built-in
-- `rank()` window function instead, which isn't valid there either — hence
-- the confusing "not expressions or functions" wording.
--
-- Fix: explicitly alias every UNION branch's `table_name`/`record_id`/
-- `title`/`snippet`/`occurred_at`/`ts_rank(...)` expression to match the
-- RETURNS TABLE column names. Only the FIRST branch's aliases actually
-- determine a UNION query's output column names, but all six are aliased
-- for clarity. No other change — same six-table UNION, same authorization
-- checks, same grants.

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
    coalesce(r.findings_summary, r.study_description) as snippet, r.created_at as occurred_at,
    ts_rank(r.search_vector, v_ts) as rank
    from public.imaging_reports r
    where r.patient_id = p_patient and r.search_vector @@ v_ts
  order by rank desc
  limit 50;
end;
$$;

comment on function public.search_patient_record(uuid, text) is
  'Unified ranked search across a single patient''s conditions/allergies/medications/screening results/documents/imaging. Authorization checked explicitly inside (SECURITY DEFINER bypasses RLS): self, org staff, or an explicit clinical-access grantee. See docs/PATIENT_HEALTH_RECORD_ARCHITECTURE.md §1.19. Column aliases on every UNION branch fixed in 20260829230000 — see that migration for why the unaliased version failed on every call.';

-- CREATE OR REPLACE preserves existing grants, but re-assert them anyway —
-- proof, not hope, matching this project's established discipline.
do $$
begin
  if has_function_privilege('anon', 'public.search_patient_record(uuid, text)', 'EXECUTE') then
    raise exception 'FAIL: anon can still execute public.search_patient_record';
  end if;
  if not has_function_privilege('authenticated', 'public.search_patient_record(uuid, text)', 'EXECUTE') then
    raise exception 'FAIL: authenticated cannot execute public.search_patient_record';
  end if;
  raise notice 'PASS: fix_search_patient_record_order_by_rank — function replaced, grants intact';
end $$;
