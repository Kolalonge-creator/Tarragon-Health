-- S46d: completion of the yearly Tarragon Health Report (functions 3.12, 3.13, 3.15). NOT signatures and nothing is switched on.
--
--   1. public.sign_serology_rule_threshold(uuid): the CMO's door for the anti-HBs immunity threshold on the active serology rule. Until now nothing could
--      set serology_rule_versions.threshold_approved_by, so private.anti_hbs_threshold_confirmed() could never become true. Chief Medical Officer only,
--      active rule only, audited. Nothing calls it here.
--   2. lab_panel_versions membership_annual v3 = v2 plus ONE analyte, anti_hbs (qualitative, optional, addOn, orderedBy clinician). Founder decision
--      S46-1: anti-HBs is a clinician-set add-on to the annual draw and is never chosen by the patient. It is optional, so a result without it is not
--      incomplete. It carries no price: no price row exists or is written, and it is not in any patient-orderable list. PROPOSED, the CMO signs through
--      lab_panel_signoffs as for every panel change. NOTE: v3 becomes the ACTIVE panel version when this migration applies (a panel version is not gated by
--      the sign-off row; release stays governed by it, and a draft sign-off is created below for the CMO). Counts first (live 2026-10-20): 2 panel versions, v2 active; 0 lab results carry a panel version that
--      this changes (a result keeps the version it was judged under, INV-16).
--   3. health_report_config_versions v3 = v2 plus `retest` (suggested recheck weeks for a value that was off, blood pressure weeks, a mid-year line).
--      PROPOSED and UNSIGNED, placeholders for the CMO. v2 is untouched. Live 2026-10-20: 2 settings versions, 0 reports built.
--   4. Share link for the signed report: 'health_report' becomes a section of a record share. The body is built by private.health_report_share_body from
--      the LATEST SIGNED report only, with the report's own shared-copy exclusions applied in the database (heart risk band, questionnaires, reproductive
--      screening, the doctor's free-text summary and any count that would show a withheld item), and anything that looks like a blood-borne or sexual
--      health test dropped again (INV-04). create_record_share refuses the section while no signed report exists. record_share_by_token and
--      create_record_share are patched in place by anchor (live text read, each anchor must match exactly once), like 20261019200231.
--      Care Circle supporters are not touched: a share is created only by the patient and only the patient's own link carries it.

-- 1. ------------------------------------------------------------------------------------------------------------------------------
create function public.sign_serology_rule_threshold(p_id uuid) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_staff uuid; v_n integer;
begin
  select cs.id into v_staff from public.clinical_staff cs
   where cs.profile_id = (select auth.uid()) and cs.active and cs.status = 'active' and cs.doctor_tier = 'chief_medical_officer' limit 1;
  if v_staff is null then raise exception 'not authorised: only the active Chief Medical Officer can sign the anti-HBs threshold'; end if;
  if not exists (select 1 from public.serology_rule_versions where id = p_id and status = 'active') then
    raise exception 'The active serology rule version was not found';
  end if;
  -- already confirmed: nothing changes and no second signature is recorded
  if exists (select 1 from public.serology_rule_versions where id = p_id and threshold_approved_by is not null) then return p_id; end if;
  update public.serology_rule_versions set threshold_approved_by = v_staff, threshold_approved_at = now()
   where id = p_id and status = 'active' and threshold_approved_by is null;
  get diagnostics v_n = row_count;
  if v_n <> 1 then raise exception 'could not confirm the threshold'; end if;
  perform private.log_audit('serology_rule_threshold.signed', 'serology_rule_versions', p_id, '{}'::jsonb);
  return p_id;
end $$;
revoke all on function public.sign_serology_rule_threshold(uuid) from public, anon;
grant execute on function public.sign_serology_rule_threshold(uuid) to authenticated;

-- 2. ------------------------------------------------------------------------------------------------------------------------------
do $$
declare v2 public.lab_panel_versions%rowtype;
begin
  select * into v2 from public.lab_panel_versions where panel_code = 'membership_annual' and version = 2;
  if not found then raise exception 'S46d: membership_annual v2 not found'; end if;
  if exists (select 1 from public.lab_panel_versions where panel_code = 'membership_annual' and version >= 3) then raise exception 'S46d: membership_annual already has a version 3'; end if;
  if exists (select 1 from jsonb_array_elements(v2.analytes) a where a ->> 'code' = 'anti_hbs') then raise exception 'S46d: anti_hbs is already on the panel'; end if;
  update public.lab_panel_versions set is_active = false where id = v2.id;
  insert into public.lab_panel_versions (panel_code, version, is_active, analytes, note)
  values ('membership_annual', 3, true,
    v2.analytes || $json$[{"code":"anti_hbs","label":"Hepatitis B surface antibody (anti-HBs)","kind":"qualitative","unit":"","optional":true,"addOn":true,"orderedBy":"clinician","holdForReview":true}]$json$::jsonb,
    'v2 plus anti-HBs as a clinician-set add-on (founder decision S46-1): optional, never chosen by the patient, no price, and every result held for a clinician (holdForReview). PROPOSED, not signed; the CMO signs through lab_panel_signoffs.');
end $$;

-- 3. ------------------------------------------------------------------------------------------------------------------------------
-- health-report-config-v3-begin
insert into public.health_report_config_versions (version, notes, config)
select 3,
  'PROPOSED, UNSIGNED. Version 2 plus a suggested-recheck block (S46d). The weeks are placeholders for the CMO, not clinical decisions: offValueWeeks for a laboratory value outside its own range, bpWeeks for a home blood pressure average above target, byAnalyte to replace the default for one analyte, midYearMonths for a mid-year retest line shown only when something was off.',
  v.config || jsonb_build_object(
    'retest', jsonb_build_object('offValueWeeks', 12, 'bpWeeks', 4, 'byAnalyte', '{}'::jsonb, 'midYearMonths', 6),
    'productRules', coalesce(v.config -> 'productRules', '[]'::jsonb) || '["retest"]'::jsonb)
  from public.health_report_config_versions v where v.version = 2;
-- health-report-config-v3-end

do $$
begin
  if not exists (select 1 from public.health_report_config_versions where version = 3) then raise exception 'S46d: report settings v3 was not created (v2 missing?)'; end if;
end $$;

-- A draft lab sign-off for the CMO to sign with panel v3 in view (the same step S27g took for its panel change). It carries the same release policy as the
-- latest sign-off; it is NOT signed and NOT active, so which sign-off governs result release does not change.
do $$
declare v_n integer;
begin
  -- copy the release policy from the SIGNED, ACTIVE sign-off only (never from an unsigned draft, which may hold unreviewed edits)
  insert into public.lab_panel_signoffs (version, is_active, config, notes)
  select (select max(version) from public.lab_panel_signoffs) + 1, false, l.config,
         'S46d: panel membership_annual v3 adds the optional anti-HBs add-on (every result held for a clinician). Same release policy as the signed sign-off version ' || l.version || '. PROPOSED, unsigned: sign_lab_panels() by the CMO.'
    from public.lab_panel_signoffs l where l.is_active and l.approved_by is not null;
  get diagnostics v_n = row_count;
  -- Production has one signed, active sign-off. A fresh database (CI replay, a local reset) has none, because signing is the CMO's act and nothing here signs: skip with a notice rather than stop the whole replay. More than one cannot happen (one active row).
  if v_n = 0 then
    raise notice 'S46d: no signed active lab sign-off here (a fresh database); no draft sign-off created. The CMO signs one before panel v3 releases results.';
  elsif v_n <> 1 then
    raise exception 'S46d: expected at most one signed active lab sign-off to copy the release policy from, found %', v_n;
  end if;
end $$;

-- Hold an analyte that asks for it: holdForReview makes any value, including a negative, wait for a clinician (the generic "nothing to do" text would be wrong
-- for a hepatitis B antibody result). Patched in place by anchor; it must match exactly once.
do $$
declare
  v_oid oid; v_def text; v_n integer := 0;
  c_old constant text := E'    if v_flag not in (''normal'', ''negative'') then v_any_abn := true; end if;';
  c_new constant text := E'    if v_flag not in (''normal'', ''negative'') or coalesce((v_def ->> ''holdForReview'')::boolean, false) then v_any_abn := true; end if;';
begin
  for v_oid in select p.oid from pg_proc p where p.proname = 'classify_lab_result' and p.pronamespace = 'private'::regnamespace loop
    v_def := pg_get_functiondef(v_oid);
    if (length(v_def) - length(replace(v_def, c_old, ''))) / length(c_old) <> 1 then
      raise exception 'classify_lab_result (%): the anchor is missing or repeated, refusing to guess', v_oid::regprocedure;
    end if;
    execute replace(v_def, c_old, c_new);
    v_n := v_n + 1;
  end loop;
  if v_n <> 1 then raise exception 'classify_lab_result: expected exactly one function, found %', v_n; end if;
end $$;

-- 4. ------------------------------------------------------------------------------------------------------------------------------
alter table public.record_shares drop constraint record_shares_sections_valid;
alter table public.record_shares add constraint record_shares_sections_valid
  check (sections <@ array['vitals', 'medications', 'conditions', 'allergies', 'lab_results', 'vaccinations', 'emergency_info', 'health_report']::text[]);

-- The shared body of the latest signed report. Fail closed: no signed report, no body.
create function private.health_report_share_body(p_patient uuid) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  r public.health_reports%rowtype;
  c jsonb;
  repro text[];
begin
  select * into r from public.health_reports
   where patient_id = p_patient and status = 'signed' and signed_by is not null and signed_at is not null
   order by year desc, version desc limit 1;
  if not found then return null; end if;
  c := coalesce(r.composed, '{}'::jsonb) - 'templateSummary' - 'summary';

  -- fail closed: an entry with no explicit reproductive = false is treated as reproductive and left out
  select coalesce(array_agg(s.x ->> 'code'), '{}') into repro
    from (select jsonb_array_elements(coalesce(c #> '{screening,done}', '[]'::jsonb)) as x
          union all select jsonb_array_elements(coalesce(c #> '{screening,due}', '[]'::jsonb))) s
   where coalesce((s.x ->> 'reproductive')::boolean, true);

  c := jsonb_set(c, '{risk}', '{"state":"not_assessed"}'::jsonb);
  c := jsonb_set(c, '{questionnaires}', '[]'::jsonb);
  c := jsonb_set(c, '{screening}', jsonb_build_object(
    'done', coalesce((select jsonb_agg(x order by o) from jsonb_array_elements(coalesce(c #> '{screening,done}', '[]'::jsonb)) with ordinality t(x, o)
                       where not coalesce((x ->> 'reproductive')::boolean, true) and not private.report_excluded_code(x ->> 'code')), '[]'::jsonb),
    'due', coalesce((select jsonb_agg(x order by o) from jsonb_array_elements(coalesce(c #> '{screening,due}', '[]'::jsonb)) with ordinality t(x, o)
                      where not coalesce((x ->> 'reproductive')::boolean, true) and not private.report_excluded_code(x ->> 'code')), '[]'::jsonb)));
  -- the reason a blood pressure target is lower would reveal a health condition, so a shared copy carries the neutral source name
  c := jsonb_set(c, '{items}', coalesce((
    select jsonb_agg(case when x #>> '{target,source}' = 'higher_risk' then jsonb_set(x, '{target,source}', '"report_settings"') else x end order by o)
      from jsonb_array_elements(coalesce(c -> 'items', '[]'::jsonb)) with ordinality t(x, o)
     where not (x ->> 'kind' = 'screening' and (x ->> 'code') = any(repro)) and not private.report_excluded_code(x ->> 'code')), '[]'::jsonb));
  -- the mid-year line may stand only while an item that remains in this copy needs attention (it must not reveal a withheld one)
  if not exists (select 1 from jsonb_array_elements(c -> 'items') x where x ->> 'state' = 'needs_attention') then c := c - 'midYearRetestMonths'; end if;
  c := jsonb_set(c, '{priorities}', coalesce((
    select jsonb_agg(x order by o) from jsonb_array_elements(coalesce(c -> 'priorities', '[]'::jsonb)) with ordinality t(x, o)
     where x ->> 'category' <> 'risk' and not (x ->> 'category' = 'screening' and replace(x ->> 'id', 'screening:', '') = any(repro))
       and not private.report_excluded_code(replace(x ->> 'id', 'lab:', ''))), '[]'::jsonb));
  c := jsonb_set(c, '{alsoWorthKnowing}', coalesce((
    select jsonb_agg(x order by o) from jsonb_array_elements(coalesce(c -> 'alsoWorthKnowing', '[]'::jsonb)) with ordinality t(x, o)
     where x ->> 'category' <> 'risk' and not (x ->> 'category' = 'screening' and replace(x ->> 'id', 'screening:', '') = any(repro))
       and not private.report_excluded_code(replace(x ->> 'id', 'lab:', ''))), '[]'::jsonb));
  c := jsonb_set(c, '{trends}', coalesce((
    select jsonb_agg(x order by o) from jsonb_array_elements(coalesce(c -> 'trends', '[]'::jsonb)) with ordinality t(x, o)
     where not private.report_excluded_code(x ->> 'code')), '[]'::jsonb));

  -- a WHITELIST: the shared copy is built from named fields only, so a field added to the stored report later cannot reach a public link by default
  return jsonb_build_object('year', r.year, 'version', r.version, 'signed_at', r.signed_at, 'signer_name', r.signer_name,
    'signer_registration', r.signer_registration,
    'composed', jsonb_build_object(
      'schema', c -> 'schema', 'year', c -> 'year', 'items', c -> 'items', 'priorities', c -> 'priorities', 'alsoWorthKnowing', c -> 'alsoWorthKnowing',
      'risk', c -> 'risk', 'screening', c -> 'screening', 'trends', c -> 'trends', 'questionnaires', c -> 'questionnaires',
      'devices', coalesce(c -> 'devices', '{"manual":0,"device":0,"wearable":0}'::jsonb), 'weight', null,
      'midYearRetestMonths', c -> 'midYearRetestMonths', 'statementKey', c -> 'statementKey', 'statementApprovedByCmo', coalesce(c -> 'statementApprovedByCmo', 'false'::jsonb),
      'minBpReadings', c -> 'minBpReadings', 'minBpDays', c -> 'minBpDays'));
end $$;
revoke all on function private.health_report_share_body(uuid) from public, anon, authenticated;

do $$
declare
  v_oid oid; v_def text; v_new text; v_n integer := 0;
  -- create_record_share
  c_allowed constant text := E'array[''vitals'', ''medications'', ''conditions'', ''allergies'', ''lab_results'', ''vaccinations'', ''emergency_info''];';
  c_allowed_new constant text := E'array[''vitals'', ''medications'', ''conditions'', ''allergies'', ''lab_results'', ''vaccinations'', ''emergency_info'', ''health_report''];';
  c_msg constant text := 'lab_results, vaccinations, emergency_info''';
  c_msg_new constant text := 'lab_results, vaccinations, emergency_info, health_report''';
  c_cfg constant text := E'  if v_cfg is null or v_cfg ->> ''default_expiry_hours'' is null then raise exception ''sharing config missing''; end if;';
  c_cfg_new constant text := E'  if ''health_report'' = any(p_sections) and not exists (select 1 from public.health_reports hr where hr.patient_id = v_patient_id and hr.status = ''signed'' and hr.signed_by is not null and hr.signed_at is not null) then\n    raise exception ''there is no signed yearly report to share'';\n  end if;\n' || c_cfg;
  cnt integer;
begin
  for v_oid in select p.oid from pg_proc p where p.proname = 'create_record_share' and p.pronamespace = 'public'::regnamespace loop
    v_def := pg_get_functiondef(v_oid);
    foreach cnt in array array[(length(v_def) - length(replace(v_def, c_allowed, ''))) / length(c_allowed),
                               (length(v_def) - length(replace(v_def, c_msg, ''))) / length(c_msg),
                               (length(v_def) - length(replace(v_def, c_cfg, ''))) / length(c_cfg)] loop
      if cnt <> 1 then raise exception 'create_record_share (%): an anchor is missing or repeated, refusing to guess', v_oid::regprocedure; end if;
    end loop;
    v_new := replace(replace(replace(v_def, c_allowed, c_allowed_new), c_msg, c_msg_new), c_cfg, c_cfg_new);
    execute v_new;
    v_n := v_n + 1;
  end loop;
  if v_n = 0 then raise exception 'create_record_share not found'; end if;
end $$;

do $$
declare
  v_oid oid; v_def text; v_n integer := 0;
  c_old constant text := E'  if ''emergency_info'' = any(v_share.sections) then\n';
  -- a yearly report cannot be trimmed to a date window, so a link limited to recent dates never carries it (the patient limited what a stranger may see)
  c_new constant text := E'  if ''health_report'' = any(v_share.sections) and v_share.window_days is null then\n    v_result := v_result || jsonb_build_object(''health_report'', private.health_report_share_body(v_share.patient_id));\n  end if;\n\n' || c_old;
begin
  for v_oid in select p.oid from pg_proc p where p.proname = 'record_share_by_token' and p.pronamespace = 'public'::regnamespace loop
    v_def := pg_get_functiondef(v_oid);
    if (length(v_def) - length(replace(v_def, c_old, ''))) / length(c_old) <> 1 then
      raise exception 'record_share_by_token (%): the anchor is missing or repeated, refusing to guess', v_oid::regprocedure;
    end if;
    execute replace(v_def, c_old, c_new);
    v_n := v_n + 1;
  end loop;
  if v_n = 0 then raise exception 'record_share_by_token not found'; end if;
end $$;

-- Self-checks ---------------------------------------------------------------------------------------------------------------------
do $$
begin
  if has_function_privilege('anon', 'public.sign_serology_rule_threshold(uuid)', 'EXECUTE') then raise exception 'S46d self-check: anon can sign the threshold'; end if;
  if has_function_privilege('anon', 'private.health_report_share_body(uuid)', 'EXECUTE') or has_function_privilege('authenticated', 'private.health_report_share_body(uuid)', 'EXECUTE') then
    raise exception 'S46d self-check: the shared body builder is reachable';
  end if;
  if not has_function_privilege('anon', 'public.record_share_by_token(text,text,text)', 'EXECUTE') then raise exception 'S46d self-check: the share door must stay anon-executable'; end if;
  if pg_get_functiondef('public.record_share_by_token(text,text,text)'::regprocedure) not like '%health_report_share_body%' then raise exception 'S46d self-check: the door was not patched'; end if;
  if (select count(*) from public.lab_panel_versions where is_active) <> 1 then raise exception 'S46d self-check: expected one active panel version'; end if;
  if (select jsonb_array_length(analytes) from public.lab_panel_versions where is_active) <> 19 then raise exception 'S46d self-check: expected 19 analytes'; end if;
  if pg_get_functiondef('private.classify_lab_result(uuid,jsonb,uuid)'::regprocedure) not like '%holdForReview%' then raise exception 'S46d self-check: the classifier was not patched'; end if;
  -- the draft exists only where there was a signed active sign-off to copy (production); a fresh database has none and creates none
  if exists (select 1 from public.lab_panel_signoffs where is_active and approved_by is not null)
     and not exists (select 1 from public.lab_panel_signoffs where not is_active and approved_by is null and notes like 'S46d:%') then raise exception 'S46d self-check: no draft lab sign-off'; end if;
  if exists (select 1 from public.health_report_config_versions where version = 3 and (is_active or approved_by is not null)) then raise exception 'S46d self-check: report settings v3 must be unsigned'; end if;
end $$;
