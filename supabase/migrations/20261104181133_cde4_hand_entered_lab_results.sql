-- Clinical document engine, step 3: a Care Coordinator types in lab results by hand (decision CDE-02), for a laboratory that sent
-- values in an email or on paper rather than a report a patient could upload. Design: docs/plans/clinical-document-engine-2026-11-04.md
-- §5.2.
--
-- HOW: typed results become a DRAFT for a clinician, exactly like a reading by the AI reader, and go through the same machinery:
--   * a lab_result_documents row holds the source: the original report when the coordinator attaches it, otherwise a PDF the server
--     makes of what was typed (who, when, from where, every row), so the clinician always has a document to check against;
--   * a lab_report_extractions row holds the typed rows (validated by the same unit conversion and plausibility rules as an AI
--     reading, server side) with entry_method = 'manual', who typed them, the laboratory's own flag, specimen and comment per row,
--     and where the values came from;
--   * the clinician files it through the existing confirm_lab_report_extraction, so the S27 result engine, the CMO-signed ranges,
--     the abnormal-result alerts and the release machine all apply unchanged (T2-04/T2-07);
--   * a typed critical value raises the review alert to urgent at once (raise_lab_extraction_alert, the same escalation bridge an
--     AI reading uses), so it is never held quietly (CDE-02).
-- Hand-typed values are never treated as verified: nothing reaches the patient's record until a clinician files them.
--
-- WHAT CHANGES IN EXISTING OBJECTS (each redefined from its live body):
--   * lab_result_document_source gains 'care_coordinator'.
--   * private.handle_lab_result_document: a care_coordinator document always opens a review alert (whatever the plan) with its own
--     title. Nothing else changes.
--   * private.cde_on_lab_result_document maps 'care_coordinator' to its channel (so the CDE-08 values-free notice fires);
--     private.cde_on_lab_report_extraction does not count a hand-typed draft as a reader attempt.

alter type public.lab_result_document_source add value if not exists 'care_coordinator';

alter table public.lab_report_extractions
  add column entry_method text not null default 'ai' check (entry_method in ('ai', 'manual')),
  add column entered_by uuid references public.profiles (id) on delete restrict,
  -- Per typed row, in the same order as rows: the laboratory's own flag, the specimen and a comment, as typed.
  add column manual_details jsonb,
  -- Where the values came from ("Email from Synlab Ikeja, 3 Nov"), as typed.
  add column source_description text check (source_description is null or length(source_description) <= 300),
  add constraint lab_report_extractions_manual_provenance
    check (entry_method <> 'manual' or (entered_by is not null and source_description is not null));

alter table public.clinical_documents add column entered_by_hand boolean not null default false;

-- ---------------------------------------------------------------------------------------------------------------------------
-- 1. The upload trigger (live body, CDE-02 branch added)
-- ---------------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.handle_lab_result_document()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_alert_id uuid;
  v_has_review_access boolean;
  v_order_status public.lab_order_status;
begin
  if (select auth.uid()) is not null then new.uploaded_by := (select auth.uid()); end if;
  new.reviewed_by := null; new.reviewed_at := null; new.review_note := null;

  -- CDE-02: results the care team typed in by hand always need a clinician to check them against the source, whatever the
  -- patient's plan: until a clinician files them they are a proposal, and without the alert nobody would ever be asked to.
  if new.source::text = 'care_coordinator' then
    v_has_review_access := true;
  elsif new.lab_order_id is not null then
    select status into v_order_status from public.lab_orders where id = new.lab_order_id;
    v_has_review_access := v_order_status is not null and v_order_status not in ('pending_payment', 'cancelled');
    -- OD-05: a free outreach attendee's own upload is held for the abnormal-only screen (outreach_result_screenings).
    if v_has_review_access and new.source = 'patient' and private.is_free_outreach_order(new.lab_order_id) then
      v_has_review_access := false;
    end if;
  else
    v_has_review_access := exists (select 1 from public.programme_purchases pp where pp.patient_id = new.patient_id and pp.status = 'active' and pp.ends_at >= current_date);
  end if;

  if v_has_review_access then
    insert into public.clinician_alerts (organisation_id, patient_id, level, status, title, detail, escalation_level)
    values (new.organisation_id, new.patient_id, 'clinician_review', 'open',
      case when new.source::text = 'care_coordinator' then 'Lab results typed in by the care team: check them against the source'
           else 'Lab result document uploaded — review needed' end,
      format('A lab result document was uploaded (%s)%s. Review and record any clinical finding. (Uploading a file does not itself create a screening result.)',
        new.source, case when new.note is not null and length(btrim(new.note)) > 0 then format(' — %s', new.note) else '' end), 2)
    returning id into v_alert_id;
    new.clinician_alert_id := v_alert_id;
  else
    new.clinician_alert_id := null;
  end if;

  -- S27d (INV-03): the patient is NOT told on upload for a document someone else supplied. The older path announced it at once,
  -- before any clinician had looked. The document is also hidden from the patient until reviewed (policy above).

  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (new.organisation_id, new.uploaded_by, 'lab_result_document.uploaded', 'lab_result_documents', new.id,
          jsonb_build_object('source', new.source::text, 'clinician_alert_id', v_alert_id, 'review_gated_by_purchase', not v_has_review_access));
  return new;
end;
$function$;

-- ---------------------------------------------------------------------------------------------------------------------------
-- 2. Intake-record triggers (from 20261104160432; care_coordinator channel, manual drafts are not reader attempts)
-- ---------------------------------------------------------------------------------------------------------------------------
create or replace function private.cde_on_lab_result_document()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if tg_op = 'INSERT' then
    perform private.cde_open_intake(new.organisation_id, new.patient_id,
      case new.source::text
        when 'patient' then 'patient_app'
        when 'care_coordinator' then 'care_coordinator'
        when 'lab_liaison' then 'lab_liaison'
        when 'clinician' then 'clinician'
        when 'admin' then 'admin'
        when 'lab_partner' then 'partner_integration'
        else 'other'
      end,
      new.uploaded_by, new.content_sha256, new.mime_type, 'lab_result_documents', new.id);
  else
    perform private.cde_refresh('lab_result_documents', new.id);
  end if;
  return null;
end;
$function$;

create or replace function private.cde_on_lab_report_extraction()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_cd uuid;
begin
  select id into v_cd from public.clinical_documents
   where routed_table = 'lab_result_documents' and routed_id = new.document_id;
  if v_cd is null then return null; end if;
  -- A hand-typed draft is not an attempt by the automatic reader: it is never retried and never counts as a failure.
  if new.status in ('extracted', 'failed') and new.entry_method = 'ai' then
    insert into public.clinical_document_jobs (organisation_id, patient_id, document_id, step, outcome, error, model_id)
    values (new.organisation_id, new.patient_id, v_cd, 'extract',
            case when new.status = 'failed' then 'failed' else 'succeeded' end,
            case when new.status = 'failed' then left(coalesce(new.error_message, 'unknown error'), 500) end,
            new.model_id);
  end if;
  perform private.cde_refresh('lab_result_documents', new.document_id);
  return null;
end;
$function$;

revoke all on function private.cde_on_lab_result_document() from public;
revoke all on function private.cde_on_lab_report_extraction() from public;

-- ---------------------------------------------------------------------------------------------------------------------------
-- 3. The coordinator's hand entry
-- ---------------------------------------------------------------------------------------------------------------------------
create or replace function public.coordinator_submit_manual_results(
  p_patient uuid,
  p_identity jsonb,
  p_file jsonb,
  p_original_attached boolean,
  p_rows jsonb,
  p_manual_details jsonb,
  p_report_date date,
  p_source_description text,
  p_source_facility_id uuid default null,
  p_source_facility_name text default null,
  p_admin_note text default null)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid := private.cde_uploader_org();
  pr public.profiles;
  v_sha text := p_file ->> 'content_sha256';
  v_matched text[];
  v_doc uuid;
  v_ext uuid;
  v_n integer;
  v_lab_name text;
begin
  if v_org is null then
    raise exception 'This action is for care coordinators' using errcode = '42501';
  end if;
  select * into pr from public.profiles where id = p_patient;
  if not found or pr.role <> 'patient' or not pr.is_active or pr.organisation_id is distinct from v_org then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  if v_sha is null or v_sha !~ '^[0-9a-f]{64}$' then
    raise exception 'lab_file_hash_invalid' using errcode = '22023';
  end if;
  if (p_file ->> 'file_path') is null or (p_file ->> 'file_path') not like p_patient::text || '/%' or (p_file ->> 'file_path') like '%..%' then
    raise exception 'lab_file_path_invalid' using errcode = '22023';
  end if;
  if p_original_attached is null then
    raise exception 'manual_original_flag_required' using errcode = '22023';
  end if;
  if p_report_date is null or p_report_date > (now() at time zone 'Africa/Lagos')::date then
    raise exception 'investigation_date_required' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_source_description, ''))) < 3 then
    raise exception 'manual_source_required' using errcode = '22023';
  end if;
  if p_source_facility_id is null and nullif(btrim(coalesce(p_source_facility_name, '')), '') is null then
    raise exception 'source_facility_required' using errcode = '22023';
  end if;

  -- The rows are a proposal a clinician checks one by one before anything is filed; this is a shape check, not trust.
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 or jsonb_array_length(p_rows) > 60 then
    raise exception 'manual_rows_required' using errcode = '22023';
  end if;
  select count(*) into v_n from jsonb_array_elements(p_rows) r
   where jsonb_typeof(r) <> 'object'
      or coalesce(r ->> 'reportedLabel', '') = ''
      or coalesce(r ->> 'status', '') not in ('ready', 'unknown_unit', 'implausible', 'unmapped', 'unreadable_value')
      or coalesce(r ->> 'confidence', '') <> 'high';
  if v_n > 0 then
    raise exception 'manual_rows_invalid' using errcode = '22023';
  end if;
  if p_manual_details is not null and (jsonb_typeof(p_manual_details) <> 'array' or jsonb_array_length(p_manual_details) <> jsonb_array_length(p_rows)) then
    raise exception 'manual_details_invalid' using errcode = '22023';
  end if;

  v_matched := private.cde_check_identity(pr, p_identity);

  v_lab_name := coalesce((select name from public.lab_providers where id = p_source_facility_id), nullif(btrim(p_source_facility_name), ''));

  insert into public.lab_result_documents (organisation_id, patient_id, file_path, original_filename, mime_type, file_size_bytes,
      source, uploaded_by, note, content_sha256)
  values (pr.organisation_id, p_patient, p_file ->> 'file_path', p_file ->> 'original_filename', p_file ->> 'mime_type',
      (p_file ->> 'file_size_bytes')::bigint, 'care_coordinator', v_uid,
      case when p_original_attached then 'Results typed in by hand; the original report is attached'
           else 'Results typed in by hand; no original report was attached (this file is what was typed)' end,
      v_sha)
  returning id into v_doc;

  insert into public.lab_report_extractions (organisation_id, patient_id, document_id, status, model_id, report_date, lab_name, rows,
      entry_method, entered_by, manual_details, source_description)
  values (pr.organisation_id, p_patient, v_doc, 'extracted', 'manual_entry', p_report_date, v_lab_name, p_rows,
      'manual', v_uid, p_manual_details, btrim(p_source_description))
  returning id into v_ext;

  update public.clinical_documents
     set entered_by_hand = true,
         identity_check = jsonb_build_object('matched_on', to_jsonb(v_matched), 'confirmed_by', v_uid, 'confirmed_at', now()),
         source_facility_id = p_source_facility_id,
         source_facility_name = case when p_source_facility_id is null then nullif(btrim(p_source_facility_name), '') end,
         investigation_date = p_report_date,
         admin_note = nullif(btrim(coalesce(p_admin_note, '')), '')
   where routed_table = 'lab_result_documents' and routed_id = v_doc;

  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, subject_patient_id, event)
  values (pr.organisation_id, v_uid, 'lab_results.entered_by_hand', 'lab_report_extractions', v_ext, p_patient,
          jsonb_build_object('document_id', v_doc, 'rows', jsonb_array_length(p_rows), 'original_attached', p_original_attached,
                             'matched_on', to_jsonb(v_matched)));

  return jsonb_build_object('ok', true, 'document_id', v_doc, 'extraction_id', v_ext);
end;
$function$;

revoke all on function public.coordinator_submit_manual_results(uuid, jsonb, jsonb, boolean, jsonb, jsonb, date, text, uuid, text, text) from public;
revoke all on function public.coordinator_submit_manual_results(uuid, jsonb, jsonb, boolean, jsonb, jsonb, date, text, uuid, text, text) from anon;
grant execute on function public.coordinator_submit_manual_results(uuid, jsonb, jsonb, boolean, jsonb, jsonb, date, text, uuid, text, text) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.coordinator_submit_manual_results(uuid,jsonb,jsonb,boolean,jsonb,jsonb,date,text,uuid,text,text)', 'EXECUTE') then
    raise exception 'coordinator_submit_manual_results must not be executable by anon';
  end if;
end $$;

select private.rebuild_analytics_clean_views();
