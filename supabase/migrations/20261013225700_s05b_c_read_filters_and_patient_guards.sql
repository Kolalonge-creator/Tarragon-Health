-- S05b-c: read-side hiding of superseded / entered_in_error rows, review-column guard, safety-event guard on the patient correction path.
--
-- WHAT THIS DOES NOT DO ON PURPOSE: it does not grant public.correct_clinical_value to authenticated. The grant is the last step and is
-- held back until this migration has been replayed and proven on a real database (docs/design/S05b.md, section 6 has the one-line grant
-- and the checklist). The function stays service_role only.
--
-- 1. RLS. A RESTRICTIVE select policy on the four tables (vitals_readings, patient_allergies, patient_conditions, lab_analyte_readings):
--    a row marked with a correction_status is invisible to every RLS-bound read (patient, clinician, staff console, exports through a user
--    session, security_invoker views such as public.allergies / conditions / observations). The replacement row has no status, so it shows.
--    service_role and the postgres owner bypass RLS, so the two classes below are handled separately.
-- 2. SECURITY DEFINER readers (they run as postgres and ignore RLS). Every definer function in public/private that reads one of the four
--    tables with "from|join public.<table>" is rewritten to read private.<table>_current, a view that returns only never-marked rows.
--    Functions that write the table (or must see every row) are listed in v_skip and left alone: the correction function itself, the
--    wearable erasure (must still delete marked rows), clear_vitals_validation_flag, record_triage_result, record_poc_measurements,
--    confirm_lab_report_extraction, the FHIR attribution trigger. Invoker functions are untouched (RLS already applies to them).
--    The two security_invoker=off views that read the tables (private.v_bp_cohort_90d, public.diabetes_quality_metrics) are patched too.
--    The _current views belong to postgres, bypass RLS like the definer functions that use them, and are revoked from every client role.
-- 3. History for staff (and the patient on her own record): public.clinical_value_history(table, id) returns the whole chain through
--    supersedes_id / superseded_by_id, access checked inside (the same test the correction function uses).
-- 4. Guard: validated_by, validated_at, logged_by_profile_id and triage_event_id on vitals_readings can no longer be changed by a client session (the patient
--    has an update policy on her own readings). Only a privileged function (clear_vitals_validation_flag and the like) changes them.
-- 5. correct_clinical_value, patient path: refuses a reading that raised a clinician alert, an emergency event, a triage event or a
--    pending triage recheck (patched in place from the live definition, refuses to guess if the anchor is missing).
--
-- COUNTED: all four tables carry correction_status null on every existing row (S05b-a added the columns the same day), so the policy
-- hides nothing today and no data is converted.

-- 1. Restrictive select policies ----------------------------------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['vitals_readings', 'patient_allergies', 'patient_conditions', 'lab_analyte_readings'] loop
    execute format('drop policy if exists %I on public.%I', t || '_hide_superseded', t);
    execute format(
      'create policy %I on public.%I as restrictive for select using (correction_status is null)', t || '_hide_superseded', t);
  end loop;
end $$;

-- 2a. The _current views (owner rights, no client access) ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['vitals_readings', 'patient_allergies', 'patient_conditions', 'lab_analyte_readings'] loop
    execute format('create view private.%I with (security_invoker = false) as select * from public.%I where correction_status is null',
                   t || '_current', t);
    execute format('revoke all on private.%I from public, anon, authenticated', t || '_current');
  end loop;
end $$;

-- 2b. Rewrite the definer readers ---------------------------------------------------------------------------------------------------
do $$
declare
  r record;
  v_def text;
  v_new text;
  v_t text;
  v_patched int := 0;
  v_skip constant text[] := array[
    'correct_clinical_value', 'delete_wearable_connection_data', 'execute_wearable_data_deletion', 'clear_vitals_validation_flag',
    'record_triage_result', 'record_poc_measurements', 'confirm_lab_report_extraction', 'enforce_fhir_import_resource_attribution',
    'capture_record_correction', 'handle_bp_reading_red_flag', 'handle_pulse_reading_red_flag', 'handle_spo2_reading_red_flag', 'handle_temperature_reading_red_flag', 'enforce_htn_alert_attestation'];
begin
  for r in
    select p.oid, n.nspname, p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public', 'private') and p.prokind = 'f' and p.prosecdef
       and not (p.proname = any (v_skip))
       and p.prosrc ~* '(from|join)\s+public\.(vitals_readings|patient_allergies|patient_conditions|lab_analyte_readings)\M'
  loop
    if (select p.prosrc from pg_proc p where p.oid = r.oid) ~* '(insert\s+into|update|delete\s+from)\s+public\.(vitals_readings|patient_allergies|patient_conditions|lab_analyte_readings)\M' then
      raise exception 'S05b-c: %.% writes a corrected table: add it to the listed writers on purpose, or read the _current view', r.nspname, r.proname;
    end if;
    if (select p.prosrc from pg_proc p where p.oid = r.oid) ~* '(public\.)?\m(vitals_readings|patient_allergies|patient_conditions|lab_analyte_readings)\.[a-z_*]' then
      raise exception 'S05b-c: %.% refers to a corrected table by name outside a FROM clause: rewrite it by hand', r.nspname, r.proname;
    end if;
    v_def := pg_get_functiondef(r.oid);
    v_new := v_def;
    foreach v_t in array array['vitals_readings', 'patient_allergies', 'patient_conditions', 'lab_analyte_readings'] loop
      v_new := regexp_replace(v_new, '(from|join)(\s+)public\.' || v_t || '\M', '\1\2private.' || v_t || '_current', 'gi');
    end loop;
    if v_new = v_def then raise exception 'S05b-c: no change made to %.%', r.nspname, r.proname; end if;
    execute v_new;
    v_patched := v_patched + 1;
  end loop;
  if v_patched < 30 then
    raise exception 'S05b-c: only % definer readers were rewritten, expected dozens: refusing to continue', v_patched;
  end if;
  raise notice 'S05b-c: % definer readers now read the *_current views', v_patched;
end $$;

-- 2c. The two definer-rights views ------------------------------------------------------------------------------------------------
do $$
declare
  v_def text;
  v_old1 constant text := 'FROM vitals_readings o';
  v_old2 constant text := 'FROM lab_analyte_readings l';
begin
  v_def := pg_get_viewdef('private.v_bp_cohort_90d'::regclass);
  if position(v_old1 in v_def) = 0 then raise exception 'private.v_bp_cohort_90d: expected text not found, refusing to guess'; end if;
  execute 'create or replace view private.v_bp_cohort_90d as ' || replace(v_def, v_old1, 'FROM private.vitals_readings_current o');

  v_def := pg_get_viewdef('public.diabetes_quality_metrics'::regclass);
  if position(v_old2 in v_def) = 0 then raise exception 'public.diabetes_quality_metrics: expected text not found, refusing to guess'; end if;
  execute 'create or replace view public.diabetes_quality_metrics as ' || replace(v_def, v_old2, 'FROM private.lab_analyte_readings_current l');

  -- keep the options the views were created with (a replaced view must stay owner-rights)
  execute 'alter view private.v_bp_cohort_90d set (security_invoker = false)';
  execute 'alter view public.diabetes_quality_metrics set (security_invoker = false)';
end $$;

-- 3. History of a corrected entry ------------------------------------------------------------------------------------------------
create function public.clinical_value_history(p_table text, p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' stable as
$$
declare
  v_uid uuid := (select auth.uid());
  v_patient uuid;
  v_ok boolean := false;
  v_staff boolean := false;
  v_out jsonb;
begin
  if v_uid is null then raise exception 'sign in to view this record' using errcode = '42501'; end if;
  if p_table not in ('vitals_readings', 'patient_conditions', 'patient_allergies', 'lab_analyte_readings') then
    raise exception 'unknown table: %', p_table using errcode = '22023';
  end if;
  execute format('select patient_id from public.%I where id = $1', p_table) into v_patient using p_id;
  -- one answer for missing and not permitted
  if v_patient is null then raise exception 'you cannot view this record' using errcode = '42501'; end if;
  if v_patient = v_uid then
    v_ok := true;
  else
    select exists (
      select 1 from public.clinical_staff cs
       where cs.profile_id = v_uid and cs.active and cs.doctor_tier is not null and cs.doctor_tier <> 'care_coordinator'
    ) and private.clinician_has_patient_access(v_patient) into v_ok;
    v_staff := v_ok;
  end if;
  if not v_ok then raise exception 'you cannot view this record' using errcode = '42501'; end if;

  execute format($q$
    with recursive chain as (
      select id, supersedes_id, superseded_by_id from public.%1$I where id = $1
      union
      select t.id, t.supersedes_id, t.superseded_by_id
        from public.%1$I t join chain c on t.id = c.supersedes_id or t.id = c.superseded_by_id or t.supersedes_id = c.id
    )
    select coalesce(jsonb_agg((case when $2 then to_jsonb(t) - 'search_vector' else to_jsonb(t) - 'search_vector' - 'validated_by' - 'logged_by_profile_id' - 'validation_flags' - 'corrected_by' - 'recorded_by' - 'verified_by' end) order by t.created_at, t.id), '[]'::jsonb)
      from public.%1$I t where t.id in (select id from chain)
  $q$, p_table) into v_out using p_id, v_staff;
  return v_out;
end;
$$;
revoke all on function public.clinical_value_history(text, uuid) from public, anon;
grant execute on function public.clinical_value_history(text, uuid) to authenticated, service_role;

-- 4. Review columns cannot be changed from a client session ----------------------------------------------------------------------------
-- SECURITY INVOKER on purpose (same reason as the supersession guard): current_user is the role running the statement. Definer functions
-- owned by postgres (clear_vitals_validation_flag, the clinician review paths) and the service role pass; a signed-in user session does not.
create function private.guard_vitals_review_columns() returns trigger
language plpgsql set search_path = '' as
$$
begin
  -- the threat is a patient (or other user) session; backend roles are not constrained here
  if current_user in ('postgres', 'supabase_admin', 'service_role') then return new; end if;
  if tg_op = 'INSERT' then
    if new.validated_by is not null or new.validated_at is not null or new.triage_event_id is not null then
      raise exception 'a new reading cannot be created already reviewed or already triaged' using errcode = '42501';
    end if;
    return new;
  end if;
  if new.validated_by is distinct from old.validated_by
     or new.validated_at is distinct from old.validated_at
     or new.logged_by_profile_id is distinct from old.logged_by_profile_id
     or new.triage_event_id is distinct from old.triage_event_id then
    raise exception 'who reviewed or logged a reading, and whether safety triage picked it up, cannot be changed from a client session' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_vitals_review_columns() from public, anon, authenticated;
create trigger b_guard_vitals_review_columns before insert or update on public.vitals_readings
  for each row execute function private.guard_vitals_review_columns();

-- 5. Patient path of correct_clinical_value: not a reading that raised a safety event -----------------------------------------------
do $$
declare
  v_def text;
  v_anchor constant text :=
    E'raise exception ''a clinician has already reviewed this reading: ask your care team to correct it'' using errcode = ''42501'';\n    end if;\n';
  v_add constant text :=
    E'    if p_table = ''vitals_readings'' and (\n'
    || E'         v_old ->> ''triage_event_id'' is not null\n'
    || E'         or exists (select 1 from public.clinician_alerts ca where ca.vital_reading_id = p_id)\n'
    || E'         or exists (select 1 from public.emergency_events ee where ee.vital_reading_id = p_id)\n'
    || E'         or exists (select 1 from public.triage_pending_rechecks tr where tr.observation_id = p_id and tr.state = ''pending'')\n'
    || E'    ) then\n'
    || E'      raise exception ''this reading was picked up by the safety checks: ask your care team to correct it'' using errcode = ''42501'';\n'
    || E'    end if;\n';
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p
   where p.proname = 'correct_clinical_value' and p.pronamespace = 'public'::regnamespace;
  if v_def is null or position(v_anchor in v_def) = 0 then
    raise exception 'correct_clinical_value: expected statement not found, refusing to guess';
  end if;
  execute replace(v_def, v_anchor, v_anchor || v_add);
end $$;

-- 6. Self-check -------------------------------------------------------------------------------------------------------------------
do $$
declare t text; r record;
begin
  foreach t in array array['vitals_readings', 'patient_allergies', 'patient_conditions', 'lab_analyte_readings'] loop
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = t || '_hide_superseded'
                      and permissive = 'RESTRICTIVE' and cmd = 'SELECT') then
      raise exception '% has no restrictive hide policy', t;
    end if;
    if has_table_privilege('authenticated', ('private.' || t || '_current')::regclass, 'SELECT')
       or has_table_privilege('anon', ('private.' || t || '_current')::regclass, 'SELECT') then
      raise exception 'private.%_current is readable by a client role', t;
    end if;
  end loop;
  -- no definer function still reads a base table directly, other than the listed exceptions
  for r in
    select n.nspname || '.' || p.proname as fn
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public', 'private') and p.prokind = 'f' and p.prosecdef
       and p.proname not in ('correct_clinical_value', 'delete_wearable_connection_data', 'execute_wearable_data_deletion',
                             'clear_vitals_validation_flag', 'record_triage_result', 'record_poc_measurements',
                             'confirm_lab_report_extraction', 'enforce_fhir_import_resource_attribution', 'capture_record_correction', 'handle_bp_reading_red_flag', 'handle_pulse_reading_red_flag', 'handle_spo2_reading_red_flag', 'handle_temperature_reading_red_flag', 'enforce_htn_alert_attestation')
       and p.prosrc ~* '(from|join)\s+public\.(vitals_readings|patient_allergies|patient_conditions|lab_analyte_readings)\M'
  loop
    raise exception 'definer function % still reads a corrected table directly', r.fn;
  end loop;
  if has_function_privilege('anon', 'public.clinical_value_history(text, uuid)', 'EXECUTE') then
    raise exception 'anon can execute clinical_value_history';
  end if;
  if has_function_privilege('authenticated', 'public.correct_clinical_value(text, uuid, public.correction_status, text, jsonb)', 'EXECUTE') then
    raise exception 'authenticated must not execute correct_clinical_value yet (S05b-c holds the grant until replay proof)';
  end if;
end $$;

do $$
begin
  if pg_get_viewdef('private.v_bp_cohort_90d'::regclass) ~* '(from|join)\s+(public\.)?(vitals_readings|patient_allergies|patient_conditions|lab_analyte_readings)\M'
     or pg_get_viewdef('public.diabetes_quality_metrics'::regclass) ~* '(from|join)\s+(public\.)?(vitals_readings|patient_allergies|patient_conditions|lab_analyte_readings)\M' then
    raise exception 'a definer-rights view still reads a corrected base table';
  end if;
end $$;
