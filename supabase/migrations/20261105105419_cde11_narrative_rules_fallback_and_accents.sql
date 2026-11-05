-- CDE-11: two follow-ups to CDE-10 (the CMO-signed narrative urgent-finding rules), founder ask 2026-11-05.
--
-- 1. Never notify no one. When the alert router assigns nobody (every doctor on leave, or no doctor at the tier), CDE-10 opened or
--    raised the alert but told no one. Now the finding goes to the organisation's active Chief Medical Officer, and with no CMO to every
--    active doctor. The assignment is left to the router and the CMO's reassignment (changing it here would be refused for the AI path).
--    Never a test staff account for a real patient. Who was newly told is recorded on the finding (notified_profile_ids): empty when the
--    alert was already at or above the tier, or, the one remaining "nobody" case, when the organisation has no active doctor at all.
-- 2. Accented letters. The two matchers disagreed on a word boundary next to an accented letter (Postgres \y counts "é" as part of a
--    word, JavaScript \b does not), so "examéno pneumothorax" was negated in one and raised in the other. Both now remove accents first
--    (NFD, combining marks stripped: "carcinóma" reads as "carcinoma") and use the same explicit ASCII boundary ([a-z0-9_]).
--    narrative-rules.ts changes in the same commit; the shared cases gain accented examples and run against both.
--
-- Both functions are redefined from their LIVE bodies (md5 checked 2026-11-05: apply 19fac4b0..., term c218e608..., identical to
-- migration 20261105092459).

alter table public.narrative_urgent_findings add column notified_profile_ids uuid[] not null default '{}';
comment on column public.narrative_urgent_findings.notified_profile_ids is
  'CDE-11: the profiles newly told about this finding (the alert owner, else the CMO, else every active doctor; never a test staff account for a real patient). Empty when the alert was already at or above the tier (alert_action already_at_or_above, nobody newly told) or the organisation had no active doctor.';

create or replace function private.narrative_term_found(p_text text, p_terms jsonb, p_rules jsonb) returns text
language plpgsql immutable set search_path = '' as $$
declare
  -- Accents are removed first ("carcinóma" reads as "carcinoma"), the same way narrative-rules.ts does, so both matchers see the
  -- same ASCII text and agree on where a word starts.
  v_lower text := lower(regexp_replace(normalize(coalesce(p_text, ''), NFD), '[\u0300-\u036f]', '', 'g'));
  v_before text;
  v_after text;
  v_term text;
  v_t text;
  v_from integer;
  v_pos integer;
  v_start integer;
  v_prev text;
  v_next text;
  v_clause text;
  v_rest text;
begin
  if v_lower = '' or p_terms is null then return null; end if;
  v_before := '(?:(?:^|[^a-z0-9_])(?:'
    || (select string_agg(private.narrative_re_escape(lower(x)), '|') from jsonb_array_elements_text(p_rules->'negation_words_before') x)
    || ')(?:\s+[a-z0-9-]+)?|(?:^|[^a-z0-9_])(?:'
    || (select string_agg(private.narrative_re_escape(lower(x)), '|') from jsonb_array_elements_text(p_rules->'negation_phrases_before') x)
    || ')(?:\s+[a-z0-9-]+){0,3})\s*$';
  v_after := '^\s*(?:'
    || (select string_agg(private.narrative_re_escape(lower(x)), '|') from jsonb_array_elements_text(p_rules->'negations_after') x)
    || ')(?![a-z0-9_])';
  for v_term in select x from jsonb_array_elements_text(p_terms) x loop
    v_t := lower(regexp_replace(normalize(v_term, NFD), '[\u0300-\u036f]', '', 'g'));
    v_from := 1;
    loop
      v_pos := strpos(substr(v_lower, v_from), v_t);
      exit when v_pos = 0;
      v_start := v_from + v_pos - 1;
      v_prev := case when v_start > 1 then substr(v_lower, v_start - 1, 1) else '' end;
      v_next := substr(v_lower, v_start + length(v_t), 1);
      if v_prev !~ '[a-z0-9]' and v_next !~ '[a-z0-9]' then
        -- the clause: everything since the last . ; : or line break before the term
        v_clause := regexp_replace(substr(v_lower, 1, v_start - 1), '^.*[.;:\n]', '');
        v_rest := substr(v_lower, v_start + length(v_t));
        if v_clause !~ v_before and v_rest !~ v_after then
          return v_term;
        end if;
      end if;
      v_from := v_start + 1;
    end loop;
  end loop;
  return null;
end $$;

create or replace function private.apply_narrative_urgent_rules(
  p_org uuid, p_patient uuid, p_source text, p_source_id uuid, p_fields jsonb, p_origin text,
  p_access_category public.care_access_category, p_existing_alert uuid default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_rules jsonb;
  v_matches jsonb;
  v_tier public.alert_level;
  v_esc smallint;
  v_sev smallint;
  v_due timestamptz;
  v_summary text;
  v_label text;
  v_line text;
  v_alert uuid;
  v_effective public.alert_level;
  v_action text;
  v_owner uuid;
  v_notify uuid[];
  v_recipient uuid;
  -- a real patient's finding never goes to a test staff account; a test patient's may
  v_test_patient boolean := coalesce((select pr.is_test from public.profiles pr where pr.id = p_patient), false);
begin
  v_rules := private.narrative_rules_in_force();
  if v_rules is null then return null; end if;
  v_matches := private.match_narrative_rules(p_fields, v_rules);
  if jsonb_array_length(v_matches) = 0 then return null; end if;

  -- The same finding on the same source is raised once.
  if exists (select 1 from public.narrative_urgent_findings f
             where f.source_table = p_source and f.source_id = p_source_id and f.origin = p_origin and f.matches = v_matches) then
    return (select f.clinician_alert_id from public.narrative_urgent_findings f
            where f.source_table = p_source and f.source_id = p_source_id and f.origin = p_origin and f.matches = v_matches
            order by f.created_at limit 1);
  end if;

  -- A tier that is missing or not one of the two known values pages at the critical tier: higher, never lower.
  v_tier := case when exists (select 1 from jsonb_array_elements(v_matches) m
                              where coalesce(v_rules->'paging_tier_by_rule'->>(m->>'rule'), '') <> 'urgent_escalation')
                 then 'emergency' else 'urgent_escalation' end;
  v_esc := case when v_tier = 'emergency' then 4 else 3 end;
  v_sev := v_esc;
  v_due := now() + private.escalation_sla_minutes('screening_abnormal_result', v_tier) * interval '1 minute';
  v_summary := (select string_agg(m->>'matched', ', ') from jsonb_array_elements(v_matches) m);
  v_label := case p_source
    when 'pathology_reports' then 'pathology or cervical result'
    when 'imaging_reports' then 'imaging report'
    when 'ecg_report_documents' then 'ECG'
    else 'imaging report' end;
  v_line := format('Urgent finding on the %s (%s, narrative urgent-finding rules v%s, signed by the CMO): %s.',
                   v_label,
                   case p_origin when 'ai' then 'found in the AI reading, not yet confirmed against the report' else 'as filed' end,
                   v_rules->>'_version', v_summary);

  -- Which alert carries it: this document's own open review alert (not one a clinician has overridden), else an earlier open finding
  -- alert for this same source, else a new one. Never another document's alert.
  select a.id into v_alert from public.clinician_alerts a
   where a.id = p_existing_alert and a.status in ('open', 'acknowledged', 'snoozed') and a.override_level is null;
  if v_alert is null then
    select a.id into v_alert
      from public.narrative_urgent_findings f join public.clinician_alerts a on a.id = f.clinician_alert_id
     where f.source_table = p_source and f.source_id = p_source_id and a.status in ('open', 'acknowledged', 'snoozed')
       and a.override_level is null
     order by f.created_at desc limit 1;
  end if;

  if v_alert is not null then
    select a.level, a.responsible_clinician_id into v_effective, v_owner
      from public.clinician_alerts a where a.id = v_alert;
    if v_effective < v_tier then
      update public.clinician_alerts
         set level = v_tier,
             title = case when v_tier = 'emergency' then 'Priority 1: urgent finding' else 'Urgent finding' end || ' (' || title || ')',
             escalation_level = greatest(coalesce(escalation_level, 0), v_esc),
             severity = greatest(coalesce(severity, 0), v_sev),
             sla_due_at = least(coalesce(sla_due_at, v_due), v_due),
             status = case when status = 'snoozed' then 'open'::public.alert_status else status end,
             snoozed_until = case when status = 'snoozed' then null else snoozed_until end,
             detail = coalesce(detail || E'\n\n', '') || v_line
       where id = v_alert;
      v_action := 'raised';
    else
      update public.clinician_alerts set detail = coalesce(detail || E'\n\n', '') || v_line where id = v_alert;
      v_action := 'already_at_or_above';
    end if;
  else
    insert into public.clinician_alerts
      (organisation_id, patient_id, level, status, title, detail, category, type_code, escalation_level, sla_due_at, imaging_report_id)
    values
      (p_org, p_patient, v_tier, 'open',
       case when v_tier = 'emergency' then 'Priority 1: urgent finding on a report' else 'Urgent finding on a report' end,
       v_line, 'clinical', 'abnormal_result', v_esc, v_due,
       case when p_source = 'imaging_reports' then p_source_id else null end)
    returning id, responsible_clinician_id into v_alert, v_owner;
    -- The classifier may mark it a suppressed duplicate of another open abnormal_result alert for this patient; an urgent finding is
    -- never hidden, so unsuppress it (duplicate_of stays as a pointer).
    update public.clinician_alerts
       set suppressed = false, suppressed_reason = null
     where id = v_alert and suppressed;
    v_action := 'opened';
  end if;

  -- responsible_clinician_id is a clinical_staff id; the notification goes to that person's profile. CDE-11: when the router assigned
  -- nobody (every doctor on leave, or none at the tier), the finding is never sent to no one: it goes to the organisation's active
  -- Chief Medical Officer, and with none, to every active doctor. The assignment itself is left to the router and the CMO.
  if v_action in ('opened', 'raised') then
    if v_owner is not null then
      select array_agg(cs.profile_id) into v_notify from public.clinical_staff cs where cs.id = v_owner and cs.profile_id is not null;
    end if;
    if v_notify is null then
      select array_agg(distinct cs.profile_id) into v_notify from public.clinical_staff cs
       where cs.organisation_id = p_org and cs.active and cs.status = 'active' and cs.profile_id is not null
         and cs.doctor_tier = 'chief_medical_officer' and (v_test_patient or not cs.is_test);
    end if;
    if v_notify is null then
      select array_agg(distinct cs.profile_id) into v_notify from public.clinical_staff cs
       where cs.organisation_id = p_org and cs.active and cs.status = 'active' and cs.profile_id is not null
         and cs.doctor_tier in ('senior_medical_officer', 'chief_medical_officer') and (v_test_patient or not cs.is_test);
    end if;
    foreach v_recipient in array coalesce(v_notify, array[]::uuid[]) loop
      perform private.notify_clinician_alert(v_alert, v_recipient, 'abnormal_result_clinician_alert', '{}'::jsonb);
    end loop;
  end if;

  insert into public.narrative_urgent_findings
    (organisation_id, patient_id, source_table, source_id, origin, access_category, rule_set_version, matches, tier, clinician_alert_id,
     alert_action, notified_profile_ids)
  values
    (p_org, p_patient, p_source, p_source_id, p_origin, p_access_category, (v_rules->>'_version')::integer, v_matches, v_tier, v_alert,
     v_action, coalesce(v_notify, array[]::uuid[]));

  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (p_org, (select auth.uid()), 'narrative_urgent_finding.' || v_action, p_source, p_source_id,
          jsonb_build_object('alert_id', v_alert, 'tier', v_tier, 'origin', p_origin, 'rules', (v_rules->>'_version')::integer,
                             'rules_matched', (select jsonb_agg(m->>'rule') from jsonb_array_elements(v_matches) m)));
  return v_alert;
end $$;

revoke all on function private.narrative_term_found(text, jsonb, jsonb) from public, authenticated;
revoke all on function private.apply_narrative_urgent_rules(uuid, uuid, text, uuid, jsonb, text, public.care_access_category, uuid) from public, authenticated;

do $$
begin
  if has_function_privilege('authenticated', 'private.apply_narrative_urgent_rules(uuid, uuid, text, uuid, jsonb, text, public.care_access_category, uuid)', 'EXECUTE') then
    raise exception 'a browser session can execute apply_narrative_urgent_rules';
  end if;
  if private.narrative_term_found('Carcinóma ductal', '["carcinoma"]', (select value from public.narrative_urgent_rule_sets where version = 1)) is null then
    raise exception 'accent folding does not work';
  end if;
end $$;
