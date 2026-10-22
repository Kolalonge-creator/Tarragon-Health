-- INV-07: the stored payload of a clinician alert notification carries no clinical label.
--
-- The text a clinician receives is already neutral: templates vitals_red_flag_clinician_alert and emergency_event_clinician_alert send only
-- "New priority case. Open your Tarragon Health worklist." and never read the payload labels. But the handlers wrote clinical labels into
-- the stored payload anyway: vital_label ('blood pressure', 'heart rate', 'oxygen saturation', 'temperature', 'reported symptom',
-- 'child growth check'), level_label, and source_label (the emergency source, or 'a check-in' for a wellbeing event). Those keys are on the
-- forbidden parameter list (supabase/functions/_shared/notifications/neutral.ts, FORBIDDEN_PARAM_KEYS), they leave clinical words sitting in
-- public.notifications, and Browser E2E journey J2 (step notifications-neutral) fails on them.
--
-- Each function below is patched in place from its live definition (pg_get_functiondef), so no body is retyped; every edit is asserted, and a
-- definition that has drifted from what this migration expects stops the migration instead of being half-patched. What is removed:
--   handle_bp_reading_red_flag, handle_pulse_reading_red_flag, handle_spo2_reading_red_flag, handle_temperature_reading_red_flag,
--   handle_symptom_red_flag, route_child_nutrition: 'vital_label' and 'level_label' from the clinician notification payload;
--   handle_emergency_event: 'source_label' from the clinician notification payload;
--   release_legacy_notice: the same keys, rebuilt from a held notice (the hold's payload_extra is now stored empty, and ignored on release).
-- 'patient_name' stays: it is an identity the template does not render and the console needs.
--
-- Not touched: private.raise_dangerous_reading_ai_suggestion (a patient's own in-app self-care card, a different template), the pathway,
-- template, priority and source columns, and every threshold, recipient and escalation rule. No behaviour changes except what the payload
-- contains.

do $$
declare
  fn record;
  v_def text;
  v_new text;
begin
  for fn in
    select p.oid, p.proname,
           case p.proname
             when 'handle_bp_reading_red_flag' then 1
             when 'handle_pulse_reading_red_flag' then 2
             when 'handle_spo2_reading_red_flag' then 2
             when 'handle_temperature_reading_red_flag' then 2
             when 'handle_symptom_red_flag' then 2
             when 'route_child_nutrition' then 3
             when 'handle_emergency_event' then 4
             when 'release_legacy_notice' then 5
           end as kind
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'private'
       and p.proname in ('handle_bp_reading_red_flag', 'handle_pulse_reading_red_flag', 'handle_spo2_reading_red_flag',
                         'handle_temperature_reading_red_flag', 'handle_symptom_red_flag', 'route_child_nutrition',
                         'handle_emergency_event', 'release_legacy_notice')
  loop
    v_def := pg_get_functiondef(fn.oid);
    v_new := v_def;
    if fn.kind = 1 then
      -- the payload handed to the legacy-notice hold, then the payload of the direct send
      v_new := regexp_replace(v_new, 'jsonb_build_object\(''vital_label'', ''blood pressure'', ''level_label'', v_level_label\)', '''{}''::jsonb');
      v_new := regexp_replace(v_new, ',\s*''vital_label'',\s*''[^'']*'',\s*''level_label'',\s*v_level_label', '');
    elsif fn.kind = 2 then
      v_new := regexp_replace(v_new, ',\s*''vital_label'',\s*''[^'']*'',\s*''level_label'',\s*v_level_label', '');
    elsif fn.kind = 3 then
      v_new := regexp_replace(v_new, ',\s*''vital_label'',\s*''child growth check'',\s*''level_label'',\s*v_label', '');
    elsif fn.kind = 4 then
      v_new := regexp_replace(v_new, 'jsonb_build_object\(''source_label'', new\.source::text\)', '''{}''::jsonb');
      v_new := regexp_replace(v_new, ',\s*''source_label'',\s*case when new\.source::text in \(''mental_health_screen'', ''intake_screen''\) then ''a check-in'' else new\.source::text end', '');
    else
      v_new := regexp_replace(v_new, '\s*\|\|\s*case when h\.kind = ''bp_red''[^;]*;', ';');
    end if;

    if v_new = v_def then
      raise exception 'INV-07 payload patch: % did not match the expected definition (it has drifted); nothing was changed', fn.proname;
    end if;
    -- a patch removes a few dozen characters; losing much more means a pattern ate code
    if length(v_new) < length(v_def) - 400 then
      raise exception 'INV-07 payload patch: % lost % characters, more than the labels account for', fn.proname, length(v_def) - length(v_new);
    end if;
    if v_new ~ '''(vital_label|level_label|source_label)''' then
      raise exception 'INV-07 payload patch: % still names a clinical label after the edit', fn.proname;
    end if;
    execute v_new;
  end loop;

  -- the end state is proven from the live definitions, not from the edits
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'private'
       and p.proname in ('handle_bp_reading_red_flag', 'handle_pulse_reading_red_flag', 'handle_spo2_reading_red_flag',
                         'handle_temperature_reading_red_flag', 'handle_symptom_red_flag', 'route_child_nutrition',
                         'handle_emergency_event', 'release_legacy_notice')
       and p.prosrc ~ '''(vital_label|level_label|source_label)'''
  ) then
    raise exception 'INV-07 payload patch: a clinician-alert handler still writes a clinical label';
  end if;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'private' and p.proname in ('handle_bp_reading_red_flag', 'handle_pulse_reading_red_flag', 'handle_spo2_reading_red_flag',
         'handle_temperature_reading_red_flag', 'handle_symptom_red_flag', 'route_child_nutrition', 'handle_emergency_event', 'release_legacy_notice')) <> 8 then
    raise exception 'INV-07 payload patch: expected to patch 8 functions';
  end if;
  -- ACLs are untouched by create or replace, but the security-relevant ones are re-asserted: no client can run a private handler.
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'private' and p.proname in ('handle_bp_reading_red_flag', 'handle_emergency_event', 'release_legacy_notice')
       and has_function_privilege('anon', p.oid, 'EXECUTE')
  ) then
    raise exception 'INV-07 payload patch: anon can execute a private handler';
  end if;
end $$;
