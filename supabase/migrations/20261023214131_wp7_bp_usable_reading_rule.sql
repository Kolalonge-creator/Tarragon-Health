-- WP7: one stricter rule for which blood pressure readings the S38 / S75 reports count (OQ-WP3-04, founder + CMO decision 2026-10-23).
--
-- THE BUG. The reports admitted a reading when  validation_status = 'valid'  OR  coalesce(validation_flags, '{}') <@ array['insufficient_context'].
-- An empty array is a subset of every array, so a requires_validation reading with NO flags (or any other status with empty flags, e.g. 'rejected')
-- was counted. The intent was: cleared, or waiting only because the arm/position was not recorded (the value is not in doubt).
--
-- THE RULE (same meaning as WP3's private.wp3_reading_usable, defined here independently so this does not depend on the unmerged WP3 branch):
--   usable  =  status 'valid'
--           OR (status 'requires_validation' AND flags is NON-EMPTY AND every flag is 'insufficient_context').
--
-- WHERE THE OLD PATTERN LIVED (found by grep on main-dev and by scanning every live function, view, policy and materialized view for
-- 'insufficient_context'; no TypeScript or other mirror exists, only the generated database.types.ts mentions the column):
--   1. private.bp_window_stats(uuid, date, date)                (S38c, re-created by S07y; live text reads private.vitals_readings_diagnostic)
--   2. private.outcome_compute_snapshot(uuid, integer, timestamptz)   (S38, then rewritten by the cuffless-BP migration; the snapshot job)
--   3. private.v_bp_cohort_90d   (S38, then rewritten by S05b-c; the "late" test)
--   4. private.v_bp_cohort_day   (S75a; the day-180 "late" test)
-- The fifth live hit, private.flag_vitals_requiring_validation(), is the trigger that WRITES the flags, not a reader; it is untouched.
-- S75 reports, the pack functions and the sponsor/clinical report read these through the objects above, so they follow automatically.
--
-- HOW. Each object is rewritten FROM ITS LIVE DEFINITION (pg_get_functiondef / pg_get_viewdef), never from a file copy, because later migrations
-- patched the bodies by text replacement (S05b-c, the cuffless estimates migration). A single exact-text replacement is made and the block aborts
-- if the old text is not found exactly once, so drift cannot slip through. CREATE OR REPLACE keeps the signature, SECURITY DEFINER, search_path
-- and the existing grants; views get their security_invoker option set again (as S05b-c did) and the block asserts it.
--
-- LIVE FACTS (read-only, 2026-10-23, latest live migration 20261023164200):
--   * 767 blood pressure readings in vitals_readings: 767 are requires_validation with flags exactly {insufficient_context}; 0 are valid; 0 have an
--     empty flag list; 0 have another status or another flag. So NO reading changes eligibility under the new rule.
--   * 1 blood pressure outcome_snapshots row (not a test row). Snapshot rows that would differ if recomputed under the new rule: 0.
--   * Already-written outcome_snapshots rows are NOT rewritten by this migration (and monthly report rows are append-only); the new rule applies to
--     computations made after it lands.
--
-- Open question for later: WP3's private.wp3_reading_usable duplicates private.bp_reading_usable. WP3 should switch to the shared helper when it
-- merges (recorded as OQ-WP7-01 in docs/OPEN-QUESTIONS.md).

create or replace function private.bp_reading_usable(p_status public.vitals_validation_status, p_flags text[]) returns boolean
language sql immutable set search_path = ''
as $$
  select coalesce(
    p_status = 'valid'
    or (p_status = 'requires_validation'
        and cardinality(coalesce(p_flags, '{}'::text[])) > 0
        and p_flags <@ array['insufficient_context']::text[]),
    false)
$$;
revoke all on function private.bp_reading_usable(public.vitals_validation_status, text[]) from public, anon, authenticated, service_role;
comment on function private.bp_reading_usable(public.vitals_validation_status, text[]) is
  'Is a blood pressure reading counted by the outcome and report code? Valid, or requires_validation with a non-empty flag list holding only insufficient_context. An empty flag list never qualifies (empty array is a subset of everything).';

do $$
declare
  v_old_fn constant text := '(validation_status = ''valid'' or coalesce(validation_flags, ''{}''::text[]) <@ array[''insufficient_context'']::text[])';
  v_new_fn constant text := 'private.bp_reading_usable(validation_status, validation_flags)';
  v_old_vw constant text := '((o.validation_status = ''valid''::vitals_validation_status) OR (COALESCE(o.validation_flags, ''{}''::text[]) <@ ARRAY[''insufficient_context''::text]))';
  v_new_vw constant text := 'private.bp_reading_usable(o.validation_status, o.validation_flags)';
  r record; v_def text; v_new text; v_cnt integer; v_fn text;
begin
  -- functions
  foreach v_fn in array array['private.bp_window_stats(uuid,date,date)', 'private.outcome_compute_snapshot(uuid,integer,timestamptz)'] loop
    v_def := pg_get_functiondef(v_fn::regprocedure);
    v_cnt := (length(v_def) - length(replace(v_def, v_old_fn, ''))) / length(v_old_fn);
    if v_cnt <> 1 then raise exception 'FAIL: % has % occurrences of the old pattern, expected exactly 1 (live drift; review before guessing)', v_fn, v_cnt; end if;
    execute replace(v_def, v_old_fn, v_new_fn);
  end loop;

  -- views: the 90-day view first (the day view reads it)
  foreach v_fn in array array['private.v_bp_cohort_90d', 'private.v_bp_cohort_day'] loop
    v_def := pg_get_viewdef(v_fn::regclass);
    v_cnt := (length(v_def) - length(replace(v_def, v_old_vw, ''))) / length(v_old_vw);
    if v_cnt <> 1 then raise exception 'FAIL: % has % occurrences of the old pattern, expected exactly 1 (live drift; review before guessing)', v_fn, v_cnt; end if;
    execute 'create or replace view ' || v_fn || ' as ' || replace(v_def, v_old_vw, v_new_vw);
    execute 'alter view ' || v_fn || ' set (security_invoker = false)';
  end loop;

  -- assertions
  for r in select p.oid, p.proname from pg_proc p where p.pronamespace = 'private'::regnamespace and p.proname in ('bp_window_stats', 'outcome_compute_snapshot') loop
    if pg_get_functiondef(r.oid) like '%insufficient_context%' then raise exception 'FAIL: % still carries the old pattern', r.proname; end if;
    if pg_get_functiondef(r.oid) not like '%private.bp_reading_usable%' then raise exception 'FAIL: % does not call the shared helper', r.proname; end if;
    if not (select prosecdef from pg_proc where oid = r.oid) then raise exception 'FAIL: % lost SECURITY DEFINER', r.proname; end if;
    if has_function_privilege('anon', r.oid, 'EXECUTE') or has_function_privilege('authenticated', r.oid, 'EXECUTE') then raise exception 'FAIL: % is callable by an API role', r.proname; end if;
  end loop;
  for r in select c.oid, c.relname from pg_class c where c.relnamespace = 'private'::regnamespace and c.relname in ('v_bp_cohort_90d', 'v_bp_cohort_day') loop
    if pg_get_viewdef(r.oid) like '%insufficient_context%' or pg_get_viewdef(r.oid) not like '%bp_reading_usable%' then raise exception 'FAIL: view % not converted', r.relname; end if;
    if coalesce((select reloptions::text from pg_class where oid = r.oid), '') not like '%security_invoker=false%' and coalesce((select reloptions::text from pg_class where oid = r.oid), '') not like '%security_invoker=off%' then
      raise exception 'FAIL: view % lost its security_invoker=false option', r.relname;
    end if;
    if has_table_privilege('anon', r.oid, 'SELECT') or has_table_privilege('authenticated', r.oid, 'SELECT') then raise exception 'FAIL: view % is readable by an API role', r.relname; end if;
  end loop;
  if has_function_privilege('anon', 'private.bp_reading_usable(public.vitals_validation_status, text[])', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.bp_reading_usable(public.vitals_validation_status, text[])', 'EXECUTE') then
    raise exception 'FAIL: the helper is callable by an API role';
  end if;
  if not (select provolatile = 'i' from pg_proc where oid = 'private.bp_reading_usable(public.vitals_validation_status, text[])'::regprocedure) then raise exception 'FAIL: helper not immutable'; end if;
end $$;
