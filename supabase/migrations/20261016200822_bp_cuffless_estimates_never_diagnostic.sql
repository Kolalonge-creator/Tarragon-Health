-- A blood pressure that came from a watch, ring or phone sensor (vitals_readings.source = 'wearable') is an ESTIMATE. It stays in the record and stays visible
-- (labelled "Wearable estimate" in the apps), but it must not become a diagnostic number: not a home average, not an outcome measure, not a graded observation.
-- Basis: docs/plans/S06-S10-decisions-and-cmo-signoff-pack.md C1 ("a wrist or finger device, or a watch or ring, is not used for care decisions"; cuffless
-- devices are not recommended for clinical assessment by AHA/ACC-2025). Design and trade-off: docs/design/BP-wearable-estimates.md.
--
-- LIVE FACTS (2026-10-16, read-only): 0 vitals_readings rows have source = 'wearable' (no wearable provider has credentials, HealthKit and Health Connect have never run on a
-- device), so nothing below changes a number that exists today. Latest live migration when written: 20261016023011. Pulse is deliberately NOT touched (founder decision
-- 2026-08-29: a dangerous single heart rate value from any source is triaged); a wearable BP cannot reach the pulse trigger (it fires on vital_type = 'pulse' only).
--
-- WHAT THIS DOES
--  1. private.vitals_readings_diagnostic: private.vitals_readings_current without wearable blood pressure rows. Every other vital, and every other BP source (manual, device,
--     photo, fhir_import, clinic table), is exactly as before. A wrist CUFF is not an estimate (Q4, CMO decision pack: grade every cuff reading, never downgrade a red for cuff type).
--  2. The diagnostic, outcome, risk, adherence and triage readers are pointed at that view. The list is explicit (see the DO block); each is rewritten from its LIVE definition
--     (pg_get_functiondef), never from a file copy, and the migration aborts if a listed function no longer reads private.vitals_readings_current. Display readers (the audited
--     record read, the audit case file, the share view, circle blocks, merge counts, engagement counts, device data-quality) keep reading everything.
--  3. emit_bp_observation_recorded does not emit observation.recorded for an estimate, so the governed triage engine (S12, built for cuff readings) never grades one.
--  4. handle_bp_reading_red_flag: (a) an estimate no longer closes the open "Missing expected blood-pressure readings" alert (the gap detector does not count it, so it would flap);
--     (b) BORN OFF behind platform module device_cuffless_bp_informational: when the CMO switches it on, a wearable estimate at the red or amber level gives the patient the
--     existing recheck guidance (the same text, the same in-app notice) and raises NO clinician alert and NO page. NEVER for pregnancy or the weeks after a birth (the obstetric
--     red route keeps paging), and an emergency-level estimate is not touched: it opens the emergency record exactly as today, so the patient safety net (acknowledge-gated
--     guidance, emergency contact, follow-up) never depends on a reading's source. Note the live rules already grade a 200/130-range reading with no emergency symptom as red
--     (S11g), so with the module ON that case gets the patient guidance and no page; whether it should stay silent is the CMO question OQ-BPW-1.
--  Module OFF: the red and amber path is byte for byte today's behaviour.
--
-- KNOWN EFFECT, by design: a person whose only blood pressure readings are wearable estimates now looks like a person with no blood pressure readings to the monitoring-gap,
-- overdue-vitals and reminder readers (they read the diagnostic view), so the usual "please take a reading" nudges continue. With 0 such rows today nobody is affected.

-- 1. The rule, in one place --------------------------------------------------------------------------------------------------------------
create or replace function private.bp_reading_is_estimate(p_source text)
returns boolean language sql immutable parallel safe set search_path = '' as $$
  select coalesce(p_source = 'wearable', false)
$$;
comment on function private.bp_reading_is_estimate(text) is 'True for a blood pressure source that is a consumer sensor estimate (wearable). The one definition the diagnostic view, the triage emitter and the red-flag handler share.';
revoke all on function private.bp_reading_is_estimate(text) from public, anon;
grant execute on function private.bp_reading_is_estimate(text) to authenticated, service_role;

-- 2. The diagnostic view -----------------------------------------------------------------------------------------------------------------
-- Same owner and same (empty) client grants as private.vitals_readings_current; only SECURITY DEFINER readers owned by postgres use it.
create or replace view private.vitals_readings_diagnostic with (security_invoker = false) as
  select c.*
  from private.vitals_readings_current c
  where not (c.vital_type = 'blood_pressure'::public.vital_type and private.bp_reading_is_estimate(c.source::text));
comment on view private.vitals_readings_diagnostic is 'vitals_readings_current without wearable (estimate) blood pressure rows. Read by diagnostic, outcome, risk, adherence and triage code; display code reads vitals_readings_current.';
revoke all on private.vitals_readings_diagnostic from public, anon, authenticated, service_role;

-- 3. Point the diagnostic readers at it (from their live definitions) -----------------------------------------------------------------------
do $$
declare
  v_names text[] := array[
    'bp_window_stats', 'hbpm_average', 'home_bp_assess', 'outcome_compute_snapshot', 'risk_compute', 'patient_monitoring_core',
    'triage_context_for_observation', 'triage_context_for_coverage', 'triage_coverage_candidates', 'triage_reading_snapshot',
    'triage_divergence_rows', 'sweep_triage_rechecks', 'emit_symptom_regrade', 'hqm_latest_bp_rows', 'analytics_clinical_outcomes',
    'analytics_programme_funnel', 'compute_board_measure', 'generate_clinical_summary_draft', 'consultation_prep_bundle',
    'evaluate_vitals_monitoring_gaps', 'flag_overdue_vitals', 'queue_vitals_reminders', 'patient_vitals_adherence', 'generate_monthly_reports'];
  v_name text; r record; v_def text; v_new text; v_hits integer;
begin
  foreach v_name in array v_names loop
    v_hits := 0;
    for r in select p.oid from pg_proc p where p.proname = v_name and p.pronamespace in ('public'::regnamespace, 'private'::regnamespace) and p.prokind = 'f' loop
      v_def := pg_get_functiondef(r.oid);
      v_new := replace(v_def, 'private.vitals_readings_current', 'private.vitals_readings_diagnostic');
      if v_new <> v_def then
        execute v_new;
        v_hits := v_hits + 1;
      end if;
    end loop;
    if v_hits = 0 then
      raise exception 'FAIL: % no longer reads private.vitals_readings_current; review the list in this migration', v_name;
    end if;
  end loop;

  -- Two readers take their blood pressure straight from the table (or, once S05b-c has rewritten a definer reader, from the display view);
  -- only their blood pressure lines move, whichever spelling the live definition uses.
  for r in select p.oid, p.proname from pg_proc p where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace) and p.prokind = 'f'
            and p.proname in ('capture_pathway_baseline', 'health_report_collect') loop
    v_def := pg_get_functiondef(r.oid);
    if r.proname = 'capture_pathway_baseline' then
      v_new := regexp_replace(v_def, '(''diastolic'', diastolic, ''taken_at'', taken_at\) from )(public\.vitals_readings|private\.vitals_readings_current)', '\1private.vitals_readings_diagnostic');
    else
      v_new := regexp_replace(regexp_replace(v_def, '(into v_bp from )(public\.vitals_readings|private\.vitals_readings_current)', '\1private.vitals_readings_diagnostic'),
                              '(into v_prior from )(public\.vitals_readings|private\.vitals_readings_current)', '\1private.vitals_readings_diagnostic');
    end if;
    if v_new = v_def then raise exception 'FAIL: % blood pressure lines not found; review this migration', r.proname; end if;
    execute v_new;
  end loop;
end $$;

-- 4. The triage engine never grades an estimate ----------------------------------------------------------------------------------------------
do $$
declare
  v_def text; v_new text;
  v_anchor constant text := 'if new.vital_type::text = ''blood_pressure'' and new.systolic is not null and new.diastolic is not null then';
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p where p.proname = 'emit_bp_observation_recorded' and p.pronamespace = 'private'::regnamespace;
  if position(v_anchor in v_def) = 0 then raise exception 'FAIL: emit_bp_observation_recorded anchor not found'; end if;
  v_new := replace(v_def, v_anchor, v_anchor || chr(10) || '    if private.bp_reading_is_estimate(new.source::text) then return null; end if;');
  execute v_new;
end $$;

-- 5. The module, born OFF, and the red and amber patient-only path ----------------------------------------------------------------------------------------------
insert into public.platform_modules (key, label, description) values
  ('device_cuffless_bp_informational', 'Wearable blood pressure estimates are informational', 'A blood pressure estimate from a watch, ring or phone sensor in the red or amber range gives the person the usual recheck guidance and raises no clinician alert or page, except in pregnancy or the weeks after a birth. An emergency-level estimate still opens the emergency record. Off: they alert as they do today.')
on conflict (key) do nothing;

do $$
declare
  v_def text; v_new text;
  v_anchor constant text := '  if v_level in (''unknown'', ''green'') then' || chr(10) || '    return new;' || chr(10) || '  end if;';
  v_resolve constant text := 'and title = ''Missing expected blood-pressure readings'';';
  v_block constant text :=
    '  -- Wearable estimate (module device_cuffless_bp_informational, born OFF): the person gets the usual recheck guidance, the care team is not paged.' || chr(10) ||
    '  -- Never for pregnancy or the weeks after a birth (the obstetric red route), and an emergency-level reading is not handled here: it continues below.' || chr(10) ||
    '  if private.bp_reading_is_estimate(new.source::text) and v_level in (''red'', ''amber'') and private.module_enabled(''device_cuffless_bp_informational'')' || chr(10) ||
    '     and not coalesce(v_pregnant, false) and not private.bp_is_postpartum(new.patient_id, new.created_at, v_params) then' || chr(10) ||
    '    perform private.raise_dangerous_reading_ai_suggestion(' || chr(10) ||
    '      new.organisation_id, new.patient_id, ''blood pressure'', case v_level when ''red'' then ''Priority 1'' else ''Review needed'' end,' || chr(10) ||
    '      ''Sit down and rest quietly for 5 minutes, then recheck your blood pressure. Avoid caffeine and salty food for the rest of the day. If it stays this high, or you get a headache, chest pain, or blurred vision, seek care promptly.'');' || chr(10) ||
    '    insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)' || chr(10) ||
    '    values (new.organisation_id, new.patient_id, ''bp_red_flag.estimate_patient_only'', ''vitals_readings'', new.id,' || chr(10) ||
    '      jsonb_build_object(''level'', v_level, ''systolic'', new.systolic, ''diastolic'', new.diastolic, ''source'', new.source));' || chr(10) ||
    '    return new;' || chr(10) ||
    '  end if;' || chr(10) || chr(10);
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p where p.proname = 'handle_bp_reading_red_flag' and p.pronamespace = 'private'::regnamespace;
  if position(v_anchor in v_def) = 0 then raise exception 'FAIL: handle_bp_reading_red_flag anchor not found'; end if;
  if position(v_resolve in v_def) = 0 then raise exception 'FAIL: handle_bp_reading_red_flag missing-readings resolve not found'; end if;
  v_new := replace(v_def, v_anchor, v_block || v_anchor);
  -- An estimate is not a reading for the gap detector (it reads the diagnostic view), so it must not close the "missing readings" alert either; otherwise the alert flaps.
  v_new := replace(v_new, v_resolve, 'and title = ''Missing expected blood-pressure readings''' || chr(10) || '    and not private.bp_reading_is_estimate(new.source::text);');
  execute v_new;
end $$;

-- 6. Assertions -------------------------------------------------------------------------------------------------------------------------
do $$
declare v_n integer;
begin
  if private.module_enabled('device_cuffless_bp_informational') then raise exception 'FAIL: the module was born on'; end if;
  if not exists (select 1 from public.platform_modules where key = 'device_cuffless_bp_informational' and not is_enabled) then raise exception 'FAIL: module row missing'; end if;
  if has_table_privilege('authenticated', 'private.vitals_readings_diagnostic', 'SELECT') or has_table_privilege('anon', 'private.vitals_readings_diagnostic', 'SELECT') then
    raise exception 'FAIL: the diagnostic view is readable by a client role';
  end if;
  if has_function_privilege('anon', 'private.bp_reading_is_estimate(text)', 'EXECUTE') then raise exception 'FAIL: anon can execute the estimate rule'; end if;
  select count(*) into v_n from pg_proc p where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace) and p.proname in ('hbpm_average', 'home_bp_assess', 'outcome_compute_snapshot', 'risk_compute')
    and p.prosrc not like '%vitals_readings_diagnostic%';
  if v_n <> 0 then raise exception 'FAIL: % diagnostic reader(s) not rewritten', v_n; end if;
  if (select prosrc from pg_proc where proname = 'handle_bp_reading_red_flag' and pronamespace = 'private'::regnamespace) not like '%device_cuffless_bp_informational%' then
    raise exception 'FAIL: red-flag handler not rewritten';
  end if;
end $$;
