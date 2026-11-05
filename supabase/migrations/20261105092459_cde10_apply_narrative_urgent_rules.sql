-- CDE-10: apply the CMO-signed narrative urgent-finding rules (CDE-09, documents.narrative_urgent_rules v1, confirmed 2026-11-05).
--
-- Where: in the database, like every other abnormal-result pathway on this platform, so it fires the same way whichever screen or AI
-- wrote the row. Four sources:
--   1. pathology_reports (a doctor files a histopathology, cytology, cervical or HPV result as printed)
--   2. imaging_reports (a doctor files BI-RADS and the impression as printed)
--   3. ecg_parameter_readings (a clinician confirms the QTc and the machine's printed rhythm statement)
--   4. the AI readings: imaging_report_documents.ai_impression_text (AI-016) and ecg_report_documents.ai_rhythm_statement
--
-- What a match does: the doctor review becomes urgent at the CMO's tier for that rule (paging_tier_by_rule): ECG and radiology at
-- 'emergency', mammography, cervical, HPV and pathology at 'urgent_escalation'. The SLA is read from escalation_slas (pathway
-- screening_abnormal_result), never written here. The assigned doctor is notified through private.notify_clinician_alert with the
-- values-free 'abnormal_result_clinician_alert' template, which also starts the acknowledgement-timeout ladder.
--
-- Never lower, never lost:
--   * an open review alert that already exists for THIS document is RAISED, never lowered, keeps its owner and is retitled;
--   * a document alert a clinician has overridden is left alone (the override was their judgement on what they had then; clearing it
--     would also be refused for the AI path by private.enforce_alert_override_clinical_only): a new alert opens instead;
--   * otherwise a new alert opens. It is never merged into another document's alert. If the classifier marks it a suppressed
--     duplicate of some other open alert for the patient, it is unsuppressed: an urgent finding is never hidden.
--
-- Only the signed value acts: the rules are copied here with the fingerprint the CMO confirmed (hashConfigValue of the registry
-- value). private.narrative_rules_in_force() returns them only while the newest decision on that key and version is 'confirmed' with
-- that same fingerprint. A changed registry value needs a new row here and a new confirmation before anything acts on it; until then
-- nothing is raised (and the hub shows the value as waiting). A Jest test keeps this copy and the registry identical.
--
-- The matcher mirrors apps/web/src/lib/clinical-documents/narrative-rules.ts term for term (word-bounded, case-insensitive, a negation
-- only inside the same clause). The shared cases in narrative-rules.cases.json are run against both (Jest and the proof).

-- 1. The signed rule values -------------------------------------------------------------------------------------------------------
create table public.narrative_urgent_rule_sets (
  version integer primary key check (version > 0),
  value jsonb not null,
  value_hash text not null check (value_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now()
);
comment on table public.narrative_urgent_rule_sets is
  'CDE-10: copies of documents.narrative_urgent_rules (registry) with the fingerprint the CMO confirms. Read only through private.narrative_rules_in_force(), which requires a matching confirmed sign-off. Written only by migrations.';
alter table public.narrative_urgent_rule_sets enable row level security;
revoke all on public.narrative_urgent_rule_sets from public, anon, authenticated;

insert into public.narrative_urgent_rule_sets (version, value, value_hash)
values (1, '{"birads_urgent":["0","4","4A","4B","4C","5","6"],"cervical_cytology_urgent":["HSIL","high-grade squamous intraepithelial lesion","ASC-H","atypical squamous cells, cannot exclude HSIL","AGC","atypical glandular cells","squamous cell carcinoma","adenocarcinoma","invasive"],"hpv_genotypes_urgent":["16","18"],"pathology_urgent_terms":["carcinoma","adenocarcinoma","malignant","malignancy","sarcoma","lymphoma","melanoma","leukaemia","leukemia","metastatic","metastasis","high-grade dysplasia","carcinoma in situ"],"ecg_urgent_terms":["ventricular tachycardia","ventricular fibrillation","complete heart block","third degree av block","third-degree av block","mobitz ii","second degree av block type ii","st elevation","stemi","acute myocardial infarction","acute mi"],"ecg_qtc_urgent_ms":500,"imaging_urgent_terms":["pneumothorax","pulmonary embolism","aortic dissection","pneumoperitoneum","free air","intracranial haemorrhage","intracranial hemorrhage","cord compression","ectopic pregnancy","bowel obstruction","suspicious for malignancy","highly suggestive of malignancy"],"negation_words_before":["no","not","without"],"negation_phrases_before":["negative for","no evidence of","free of"],"negations_after":["ruled out","excluded","is ruled out","has been excluded"],"paging_tier_by_rule":{"birads":"urgent_escalation","cervical_cytology":"urgent_escalation","hpv_genotype":"urgent_escalation","pathology":"urgent_escalation","ecg":"emergency","ecg_qtc":"emergency","imaging":"emergency"}}'::jsonb, 'bc189513be094bc8ed3ae05a4e75919c9ed319c5d2627d666827640ec20e3feb');

-- 2. The record of every finding raised (idempotence and audit) -------------------------------------------------------------------
create table public.narrative_urgent_findings (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id),
  patient_id uuid not null references public.profiles(id) on delete cascade,
  source_table text not null check (source_table in ('pathology_reports', 'imaging_reports', 'ecg_report_documents', 'imaging_report_documents')),
  source_id uuid not null,
  origin text not null check (origin in ('doctor', 'ai')),
  access_category public.care_access_category not null,
  rule_set_version integer not null references public.narrative_urgent_rule_sets(version),
  matches jsonb not null check (jsonb_typeof(matches) = 'array' and jsonb_array_length(matches) > 0),
  tier public.alert_level not null check (tier in ('emergency', 'urgent_escalation')),
  clinician_alert_id uuid not null references public.clinician_alerts(id) on delete cascade,
  alert_action text not null check (alert_action in ('opened', 'raised', 'already_at_or_above')),
  created_at timestamptz not null default now()
);
create index narrative_urgent_findings_source_idx on public.narrative_urgent_findings (source_table, source_id);
create index narrative_urgent_findings_patient_idx on public.narrative_urgent_findings (patient_id);
create index narrative_urgent_findings_alert_idx on public.narrative_urgent_findings (clinician_alert_id);
comment on table public.narrative_urgent_findings is
  'CDE-10: one row each time a report matched the signed narrative urgent-finding rules, with the alert it opened or raised. Staff read only, in their organisation. Written only by private.apply_narrative_urgent_rules.';
alter table public.narrative_urgent_findings enable row level security;
revoke all on public.narrative_urgent_findings from public, anon, authenticated;
grant select on public.narrative_urgent_findings to authenticated;
create policy narrative_urgent_findings_staff_read on public.narrative_urgent_findings
  for select to authenticated
  using (private.staff_may_read(patient_id, organisation_id, access_category));

insert into public.data_registry (table_name, patient_expr, retention_class, end_of_retention, in_export, reviewed, notes)
values ('narrative_urgent_findings', 'patient_id', 'clinical_record', 'review', true, false,
        'Each time a filed or AI-read report matched the CMO-signed narrative urgent-finding rules, with the alert it opened or raised (CDE-10). Class assigned by the migration author, not yet reviewed by the CMO and DPO.')
on conflict (table_name) do nothing;
insert into public.staff_read_scope (table_name, mode, patient_expr, category, reason)
values ('narrative_urgent_findings', 'tied', 'patient_id', 'labs_results', 'The row carries its source report''s category (cervical and HPV: reproductive_health); the policy reads it.')
on conflict (table_name) do nothing;

-- 3. The rules in force -----------------------------------------------------------------------------------------------------------
create or replace function private.narrative_rules_in_force() returns jsonb
language sql stable security definer set search_path = '' as $$
  select r.value || jsonb_build_object('_version', r.version)
  from public.narrative_urgent_rule_sets r
  where (
    select s.decision = 'confirmed' and s.value_hash = r.value_hash and s.owner = 'CMO'
    from public.proposed_config_signoffs s
    where s.config_key = 'documents.narrative_urgent_rules' and s.config_version = r.version
    order by s.id desc
    limit 1
  )
  order by r.version desc
  limit 1
$$;
comment on function private.narrative_rules_in_force() is
  'CDE-10: the newest narrative urgent-finding rule set whose newest CMO decision is a confirmation of exactly this value, or null (nothing acts).';

-- 4. The matcher (mirrors narrative-rules.ts) -------------------------------------------------------------------------------------
create or replace function private.narrative_re_escape(p text) returns text
language sql immutable set search_path = '' as $$
  select regexp_replace(p, '([.*+?^$(){}|\[\]\\])', '\\\1', 'g')
$$;

create or replace function private.narrative_term_found(p_text text, p_terms jsonb, p_rules jsonb) returns text
language plpgsql immutable set search_path = '' as $$
declare
  v_lower text := lower(coalesce(p_text, ''));
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
  v_before := '(?:\y(?:'
    || (select string_agg(private.narrative_re_escape(lower(x)), '|') from jsonb_array_elements_text(p_rules->'negation_words_before') x)
    || ')(?:\s+[a-z0-9-]+)?|\y(?:'
    || (select string_agg(private.narrative_re_escape(lower(x)), '|') from jsonb_array_elements_text(p_rules->'negation_phrases_before') x)
    || ')(?:\s+[a-z0-9-]+){0,3})\s*$';
  v_after := '^\s*(?:'
    || (select string_agg(private.narrative_re_escape(lower(x)), '|') from jsonb_array_elements_text(p_rules->'negations_after') x)
    || ')\y';
  for v_term in select x from jsonb_array_elements_text(p_terms) x loop
    v_t := lower(v_term);
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

create or replace function private.match_narrative_rules(p_fields jsonb, p_rules jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare
  v_out jsonb := '[]'::jsonb;
  v text;
  v_hit text;
  v_qtc numeric;
begin
  for v in select upper(btrim(x)) from jsonb_array_elements_text(coalesce(p_fields->'birads', '[]'::jsonb)) x loop
    if v <> '' and (p_rules->'birads_urgent') ? v then
      v_out := v_out || jsonb_build_array(jsonb_build_object('rule', 'birads', 'matched', v));
      exit;
    end if;
  end loop;
  v_hit := private.narrative_term_found(p_fields->>'cervicalCytology', p_rules->'cervical_cytology_urgent', p_rules);
  if v_hit is not null then v_out := v_out || jsonb_build_array(jsonb_build_object('rule', 'cervical_cytology', 'matched', v_hit)); end if;
  if nullif(p_fields->>'hpvGenotypes', '') is not null then
    select m[1] into v_hit
    from regexp_matches(p_fields->>'hpvGenotypes', '\d+', 'g') with ordinality as t(m, n)
    where (p_rules->'hpv_genotypes_urgent') ? m[1]
    order by n
    limit 1;
    if v_hit is not null then v_out := v_out || jsonb_build_array(jsonb_build_object('rule', 'hpv_genotype', 'matched', v_hit)); end if;
  end if;
  v_hit := private.narrative_term_found(p_fields->>'pathologyDiagnosis', p_rules->'pathology_urgent_terms', p_rules);
  if v_hit is not null then v_out := v_out || jsonb_build_array(jsonb_build_object('rule', 'pathology', 'matched', v_hit)); end if;
  v_hit := private.narrative_term_found(p_fields->>'ecgInterpretation', p_rules->'ecg_urgent_terms', p_rules);
  if v_hit is not null then v_out := v_out || jsonb_build_array(jsonb_build_object('rule', 'ecg', 'matched', v_hit)); end if;
  if jsonb_typeof(p_fields->'ecgQtcMs') = 'number' then
    v_qtc := (p_fields->>'ecgQtcMs')::numeric;
    if v_qtc >= (p_rules->>'ecg_qtc_urgent_ms')::numeric then
      v_out := v_out || jsonb_build_array(jsonb_build_object('rule', 'ecg_qtc', 'matched', 'QTc ' || trim_scale(v_qtc)::text || ' ms'));
    end if;
  end if;
  v_hit := private.narrative_term_found(p_fields->>'imagingImpression', p_rules->'imaging_urgent_terms', p_rules);
  if v_hit is not null then v_out := v_out || jsonb_build_array(jsonb_build_object('rule', 'imaging', 'matched', v_hit)); end if;
  return v_out;
end $$;

-- 5. Raise or open the alert ------------------------------------------------------------------------------------------------------
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

  -- responsible_clinician_id is a clinical_staff id; the notification goes to that person's profile.
  if v_action in ('opened', 'raised') and v_owner is not null then
    select cs.profile_id into v_owner from public.clinical_staff cs where cs.id = v_owner;
    if v_owner is not null then
      perform private.notify_clinician_alert(v_alert, v_owner, 'abnormal_result_clinician_alert', '{}'::jsonb);
    end if;
  end if;

  insert into public.narrative_urgent_findings
    (organisation_id, patient_id, source_table, source_id, origin, access_category, rule_set_version, matches, tier, clinician_alert_id, alert_action)
  values
    (p_org, p_patient, p_source, p_source_id, p_origin, p_access_category, (v_rules->>'_version')::integer, v_matches, v_tier, v_alert, v_action);

  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (p_org, (select auth.uid()), 'narrative_urgent_finding.' || v_action, p_source, p_source_id,
          jsonb_build_object('alert_id', v_alert, 'tier', v_tier, 'origin', p_origin, 'rules', (v_rules->>'_version')::integer,
                             'rules_matched', (select jsonb_agg(m->>'rule') from jsonb_array_elements(v_matches) m)));
  return v_alert;
end $$;
comment on function private.apply_narrative_urgent_rules(uuid, uuid, text, uuid, jsonb, text, public.care_access_category, uuid) is
  'CDE-10: match the signed narrative rules against the fields of one report and open or raise (never lower) the urgent review alert at the CMO tier, notifying its owner. Does nothing while the rules are unsigned. Errors are not swallowed: a failure aborts the filing.';

-- 6. The four sources -------------------------------------------------------------------------------------------------------------
create or replace function private.narrative_rules_on_pathology_report() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.apply_narrative_urgent_rules(
    new.organisation_id, new.patient_id, 'pathology_reports', new.id,
    jsonb_build_object(
      'pathologyDiagnosis', new.diagnosis_as_printed,
      'cervicalCytology', new.cytology_category_as_printed,
      -- the genotypes line only counts when the test was not printed as negative ("16 and 18 not detected")
      'hpvGenotypes', case when new.hpv_result_as_printed = 'negative' then null else new.hpv_genotypes_as_printed end),
    'doctor', new.access_category);
  return null;
end $$;
create trigger pathology_reports_narrative_rules after insert on public.pathology_reports
  for each row execute function private.narrative_rules_on_pathology_report();

-- Named to run after imaging_reports_after_insert (triggers fire in name order), so the review alert it opens is the one raised.
create or replace function private.narrative_rules_on_imaging_report() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.apply_narrative_urgent_rules(
    new.organisation_id, new.patient_id, 'imaging_reports', new.id,
    jsonb_build_object(
      'birads', jsonb_build_array(new.birads_left_as_printed, new.birads_right_as_printed, new.birads_overall_as_printed),
      'imagingImpression', new.impression),
    'doctor', new.access_category,
    (select r.clinician_alert_id from public.imaging_reports r where r.id = new.id));
  return null;
end $$;
create trigger imaging_reports_zz_narrative_rules after insert on public.imaging_reports
  for each row execute function private.narrative_rules_on_imaging_report();

create or replace function private.narrative_rules_on_ecg_reading() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_fields jsonb;
begin
  if new.ecg_report_document_id is null then return null; end if;
  if new.code = 'qtc_interval' and new.value is not null then
    v_fields := jsonb_build_object('ecgQtcMs',
      case when lower(coalesce(new.unit, 'ms')) in ('s', 'sec', 'secs') then new.value * 1000 else new.value end);
  elsif new.code = 'machine_rhythm_statement' and nullif(new.value_text, '') is not null then
    v_fields := jsonb_build_object('ecgInterpretation', new.value_text);
  else
    return null;
  end if;
  perform private.apply_narrative_urgent_rules(
    new.organisation_id, new.patient_id, 'ecg_report_documents', new.ecg_report_document_id, v_fields, 'doctor', 'labs_results',
    (select d.clinician_alert_id from public.ecg_report_documents d where d.id = new.ecg_report_document_id));
  return null;
end $$;
create trigger ecg_parameter_readings_narrative_rules after insert on public.ecg_parameter_readings
  for each row execute function private.narrative_rules_on_ecg_reading();

create or replace function private.narrative_rules_on_ai_reading() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'imaging_report_documents' then
    if new.ai_impression_text is null or new.ai_impression_text is not distinct from old.ai_impression_text then return null; end if;
    perform private.apply_narrative_urgent_rules(new.organisation_id, new.patient_id, 'imaging_report_documents', new.id,
      jsonb_build_object('imagingImpression', new.ai_impression_text), 'ai', new.access_category, new.clinician_alert_id);
  else
    if new.ai_rhythm_statement is null or new.ai_rhythm_statement is not distinct from old.ai_rhythm_statement then return null; end if;
    perform private.apply_narrative_urgent_rules(new.organisation_id, new.patient_id, 'ecg_report_documents', new.id,
      jsonb_build_object('ecgInterpretation', new.ai_rhythm_statement), 'ai', 'labs_results', new.clinician_alert_id);
  end if;
  return null;
end $$;
create trigger imaging_report_documents_narrative_rules after update of ai_impression_text on public.imaging_report_documents
  for each row execute function private.narrative_rules_on_ai_reading();
create trigger ecg_report_documents_narrative_rules after update of ai_rhythm_statement on public.ecg_report_documents
  for each row execute function private.narrative_rules_on_ai_reading();

-- 7. Privileges: nothing callable by a browser session. anon inherits execute through PUBLIC; authenticated gets execute on every new
--    private function by the schema's default privilege (needed for RLS helpers), so these are revoked from it by name.
revoke all on function private.narrative_rules_in_force() from public, authenticated;
revoke all on function private.narrative_re_escape(text) from public, authenticated;
revoke all on function private.narrative_term_found(text, jsonb, jsonb) from public, authenticated;
revoke all on function private.match_narrative_rules(jsonb, jsonb) from public, authenticated;
revoke all on function private.apply_narrative_urgent_rules(uuid, uuid, text, uuid, jsonb, text, public.care_access_category, uuid) from public, authenticated;
revoke all on function private.narrative_rules_on_pathology_report() from public, authenticated;
revoke all on function private.narrative_rules_on_imaging_report() from public, authenticated;
revoke all on function private.narrative_rules_on_ecg_reading() from public, authenticated;
revoke all on function private.narrative_rules_on_ai_reading() from public, authenticated;

do $$
begin
  if has_function_privilege('anon', 'private.apply_narrative_urgent_rules(uuid, uuid, text, uuid, jsonb, text, public.care_access_category, uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.apply_narrative_urgent_rules(uuid, uuid, text, uuid, jsonb, text, public.care_access_category, uuid)', 'EXECUTE') then
    raise exception 'a browser session can execute apply_narrative_urgent_rules';
  end if;
  if has_table_privilege('anon', 'public.narrative_urgent_findings', 'SELECT') then raise exception 'anon can read findings'; end if;
  if has_table_privilege('authenticated', 'public.narrative_urgent_rule_sets', 'SELECT') then raise exception 'rule sets readable'; end if;
  if (select count(*) from public.narrative_urgent_rule_sets) <> 1 then raise exception 'expected one rule set'; end if;
end $$;
