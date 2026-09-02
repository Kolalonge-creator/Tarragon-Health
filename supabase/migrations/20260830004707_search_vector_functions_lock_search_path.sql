-- Patient Health Record architecture review, round 3 — close a real finding
-- from get_advisors(security) after applying this round's migrations to the
-- live project: all six search_vector BEFORE INSERT/UPDATE trigger functions
-- (20260829223204_patient_record_search.sql) were left without an explicit
-- search_path, unlike every other function in this codebase. Low severity in
-- practice today — each body only calls setweight/to_tsvector/coalesce,
-- which resolve via pg_catalog regardless of search_path — but there's no
-- reason to be the one place in the schema that skips the project's own
-- standing defense-in-depth convention, and it costs nothing to close.
--
-- ALTER FUNCTION ... SET search_path, not CREATE OR REPLACE: same function,
-- same body, no behavioural change — just locking the search_path so a
-- later edit to any of these bodies can't silently pick up an unqualified
-- reference resolved through an attacker-influenced search_path.

alter function private.patient_conditions_search_vector_update() set search_path = '';
alter function private.patient_allergies_search_vector_update() set search_path = '';
alter function private.medications_search_vector_update() set search_path = '';
alter function private.screening_results_search_vector_update() set search_path = '';
alter function private.patient_documents_search_vector_update() set search_path = '';
alter function private.imaging_reports_search_vector_update() set search_path = '';

do $$
declare
  v_fn text;
  v_fns text[] := array[
    'patient_conditions_search_vector_update', 'patient_allergies_search_vector_update',
    'medications_search_vector_update', 'screening_results_search_vector_update',
    'patient_documents_search_vector_update', 'imaging_reports_search_vector_update'
  ];
  v_config text[];
begin
  foreach v_fn in array v_fns loop
    select proconfig into v_config from pg_proc where proname = v_fn and pronamespace = 'private'::regnamespace;
    if v_config is null or not exists (select 1 from unnest(v_config) e where e like 'search_path=%') then
      raise exception 'FAIL: private.% still has a mutable search_path', v_fn;
    end if;
  end loop;
  raise notice 'PASS: search_vector_functions_lock_search_path — all six functions now have search_path locked';
end $$;
