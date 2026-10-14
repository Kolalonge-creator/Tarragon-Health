-- S05b-g: public.observations (the vitals chart view) must show CURRENT readings only.
--
-- PROBLEM. The S05b-c restrictive policy `vitals_readings_hide_superseded` stops a user session seeing a superseded or entered_in_error reading,
-- but read_patient_chart_audited (and clinician_patient_summary, precall_summary, my_lead_patients) are SECURITY DEFINER functions owned by
-- postgres (BYPASSRLS) that read the security_invoker view public.observations: the view runs with the function owner's rights, so the policy
-- never applied and a tied clinician was shown the original reading AND its replacement. The S05b-c definer rewrite looked for
-- `from|join public.<table>` in function bodies and so never saw a reader that goes through a view. S05b-f (20261014223123, #1134) fixed
-- the same hole for public.allergies and public.conditions (that migration is not touched here).
--
-- AUDIT (live definition of this branch's full replay, 2026-10-14). Views that depend, directly or through another view, on the four corrected
-- tables (vitals_readings, patient_allergies, patient_conditions, lab_analyte_readings):
--   private.*_current (4)             owner-rights, already `correction_status is null`            fine
--   private.v_bp_cohort_90d           owner-rights, reads private.vitals_readings_current          fine (S05b-c)
--   public.diabetes_quality_metrics   owner-rights, reads private.lab_analyte_readings_current     fine (S05b-c)
--   public.allergies, public.conditions                                                            fixed in S05b-f (#1134)
--   public.observations               invoker view over vitals_readings, read by 4 definer functions   FIXED HERE
-- No view exposes lab_analyte_readings to a chart section other than diabetes_quality_metrics: the audited chart reader has no lab section,
-- and public.record_share_by_token (the record share / export route) already reads private.vitals_readings_current and
-- private.lab_analyte_readings_current. So the lab half of the audit found nothing to fix; the proof still asserts it.
-- The definer functions that read public.observations are the four above; fixing the view fixes all of them (none needs a body change).
-- Staff history is unchanged: public.clinical_value_history reads the base tables and returns the whole chain for a tied clinician.
--
-- WHAT THIS DOES. create or replace view public.observations, patched from its live definition (pg_get_viewdef) with one anchor asserted
-- exactly once: `where v.correction_status is null` is appended. Same column list in the same order, same security_invoker = true, grants
-- untouched (create or replace keeps them). A regular user session was already filtered by RLS; this changes nothing for it.
-- Counted first: view columns are compared before and after in the self-check; no data is changed.

do $$
declare
  v_def text;
  v_cols_before text[];
  v_old constant text := 'FROM vitals_readings v';
begin
  select array_agg(attname::text order by attnum) into v_cols_before
    from pg_attribute where attrelid = 'public.observations'::regclass and attnum > 0 and not attisdropped;

  v_def := regexp_replace(pg_get_viewdef('public.observations'::regclass), '[;\s]+$', '');
  if (length(v_def) - length(replace(v_def, v_old, ''))) <> length(v_old) or right(v_def, length(v_old)) <> v_old then
    raise exception 'public.observations: the expected last line "%" must occur exactly once at the end, refusing to guess', v_old;
  end if;
  if position('correction_status' in v_def) > 0 then
    raise exception 'public.observations already mentions correction_status, refusing to patch twice';
  end if;

  execute 'create or replace view public.observations with (security_invoker = true) as '
          || v_def || E'\n  WHERE v.correction_status IS NULL';

  -- ------------------------------------------------------------------------------------------------------------------------------
  -- Self-check
  -- ------------------------------------------------------------------------------------------------------------------------------
  if (select array_agg(attname::text order by attnum) from pg_attribute
       where attrelid = 'public.observations'::regclass and attnum > 0 and not attisdropped) is distinct from v_cols_before then
    raise exception 'S05b-g self-check: the column list of public.observations changed';
  end if;
  if position('correction_status IS NULL' in pg_get_viewdef('public.observations'::regclass)) = 0 then
    raise exception 'S05b-g self-check: public.observations does not filter superseded readings';
  end if;
  if not coalesce((select 'security_invoker=true' = any (reloptions) from pg_class where oid = 'public.observations'::regclass), false) then
    raise exception 'S05b-g self-check: public.observations lost security_invoker';
  end if;
  if not has_table_privilege('authenticated', 'public.observations', 'SELECT')
     or has_table_privilege('anon', 'public.observations', 'SELECT') then
    raise exception 'S05b-g self-check: grants on public.observations changed';
  end if;
  -- every view over the four tables (allergies and conditions included, since S05b-f) must carry the filter as a predicate
  if exists (
    select 1
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where c.relkind in ('v', 'm') and n.nspname in ('public', 'private')
       and pg_get_viewdef(c.oid) ~* '(from|join)\s+(public\.)?(vitals_readings|patient_allergies|patient_conditions|lab_analyte_readings)\M'
       and pg_get_viewdef(c.oid) !~* 'correction_status\s+IS\s+NULL'
  ) then
    raise exception 'S05b-g self-check: a view still reads a corrected table without filtering superseded rows';
  end if;
end $$;
