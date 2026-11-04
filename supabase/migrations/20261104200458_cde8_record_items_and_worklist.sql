-- Clinical document engine, step 6: one read model for every uploaded document, and the shared queue for those awaiting a doctor.
--
-- Design: docs/plans/clinical-document-engine-2026-11-04.md §3.3, §6, §19 (as built).
--
--   1. public.clinical_record_items: one row per uploaded document of any kind (lab, S27 file, ECG, imaging, pathology, cervical,
--      narrative, or not yet sorted), with its kind and category, status, dates, where it came from, the file to open and whether a
--      doctor has reviewed it. security_invoker (the standing rule for a view over RLS tables), so a patient sees exactly the
--      documents RLS already shows them and a clinician exactly what their care tie allows; nothing is widened. The patient's My
--      Health Records hub and the doctor's Records tab both read it, so they cannot disagree about what exists.
--      important_finding is true when the document's review alert is urgent or an emergency, for a staff reader only: for the
--      patient themself it is always false, so the hub never labels a report important before a doctor has dealt with it (INV-03).
--   2. public.clinical_worklist gains 'uploaded_documents': an ECG, scan, letter, pathology or cervical upload waiting for a doctor,
--      or one no reader could handle, for real patients only (INV-13). Lab documents stay in 'lab_results'. Redefined from its live body (md5 ea4035bd2a10aa04e9605139e9e80554
--      checked against live 2026-11-04), one branch added.
--
-- Gates (G-01): none added.

create or replace view public.clinical_record_items
with (security_invoker = true) as
select
  cd.id,
  cd.organisation_id,
  cd.patient_id,
  cd.kind_code,
  k.label as kind_label,
  coalesce(k.pipeline, 'unsorted') as pipeline,
  coalesce(k.parent_code, cd.kind_code) as kind_group,
  cd.access_category,
  cd.status,
  cd.status_reason,
  cd.status_changed_at,
  cd.upload_channel,
  cd.created_at as uploaded_at,
  cd.investigation_date,
  cd.source_facility_name,
  cd.routed_table,
  cd.routed_id,
  cd.mime_type,
  coalesce(cd.original_filename, ld.original_filename, ed.original_filename, idoc.original_filename) as original_filename,
  -- The file to open, and its bucket. Each lookup goes through the reader's own RLS on that table. An S27 result file
  -- (lab_result_files) is server-only by design and opens from the result itself, so the view gives no path for it.
  case cd.routed_table
    when 'lab_result_files' then null
    when 'ecg_report_documents' then 'ecg-reports'
    when 'imaging_report_documents' then 'imaging-reports'
    else 'lab-result-documents'
  end as file_bucket,
  case cd.routed_table
    when 'lab_result_documents' then ld.file_path
    when 'lab_result_files' then null
    when 'ecg_report_documents' then ed.file_path
    when 'imaging_report_documents' then idoc.file_path
    else cd.file_path
  end as file_path,
  cd.is_superseded,
  cd.entered_by_hand,
  (cd.status = 'reviewed') as reviewed,
  -- Staff only: a patient can read their own alert rows (clinician_alerts_select), but the hub must not label a report
  -- "important" before a doctor has dealt with it (INV-03), so for the patient themself this is always false.
  cd.patient_id is distinct from (select auth.uid()) and exists (
    select 1 from public.clinician_alerts a
     where a.id in (cd.clinician_alert_id, ld.clinician_alert_id, ed.clinician_alert_id, idoc.clinician_alert_id)
       and a.level in ('urgent_escalation', 'emergency')
  ) as important_finding,
  cd.is_test
from public.clinical_documents cd
left join public.clinical_document_kinds k on k.code = cd.kind_code
left join public.lab_result_documents ld on cd.routed_table = 'lab_result_documents' and ld.id = cd.routed_id
left join public.ecg_report_documents ed on cd.routed_table = 'ecg_report_documents' and ed.id = cd.routed_id
left join public.imaging_report_documents idoc on cd.routed_table = 'imaging_report_documents' and idoc.id = cd.routed_id;

revoke all on public.clinical_record_items from anon, public;
grant select on public.clinical_record_items to authenticated;

CREATE OR REPLACE FUNCTION public.clinical_worklist()
 RETURNS TABLE(kind text, item_id uuid, patient_id uuid, patient_name text, patient_number text, item_label text, item_date timestamp with time zone, kind_total bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_org uuid;
begin
  select p.organisation_id into v_org from public.profiles p where p.id = (select auth.uid()) and p.role = 'clinician' and p.is_active;
  if v_org is null or not exists (select 1 from public.clinical_staff cs where cs.profile_id = (select auth.uid()) and cs.active and cs.doctor_tier <> 'care_coordinator') then
    raise exception 'only an active clinician can read the worklist' using errcode = '42501';
  end if;
  return query
  -- kind_total is the true size of the queue, so a caller can say when the 100 row cap cut the list.
  with items as (
    select 'lab_results'::text as k, d.id as i, d.patient_id as pid, 'Lab result document to action'::text as l, d.created_at as dt
      from public.lab_result_documents d where d.organisation_id = v_org and d.acknowledgement_status <> 'action_completed' and (d.superseded_by_document_id is null or d.reviewed_at is not null)
    union all
    select 'abnormal_screening', s.id, s.patient_id, 'Abnormal screening result without follow-up', s.created_at
      from public.screening_results s where s.organisation_id = v_org and s.result_status = 'abnormal' and s.follow_up_action is null
    union all
    select 'lifestyle_flags', f.id, f.patient_id, 'Lifestyle red flag', coalesce(f.opened_at, f.created_at)
      from public.lpe_red_flag_events f where f.organisation_id = v_org and f.status = 'open'
    union all
    select 'lifestyle_reviews', r.id, r.patient_id, 'Lifestyle review due', r.due_date::timestamptz
      from public.lpe_reviews r where r.organisation_id = v_org and r.status = 'pending'
    union all
    select 'annual_check_reviews', a.id, a.patient_id, 'Annual health check review requested', a.review_requested_at
      from public.annual_health_checks a where a.organisation_id = v_org and a.review_requested_at is not null and a.reviewed_at is null
    union all
    select 'therapy_approvals', t.id, t.patient_id, 'Therapy session awaiting approval', t.requested_at
      from public.therapy_sessions t where t.organisation_id = v_org and t.status = 'awaiting_clinician_approval'
    union all
    select 'vaccination_verification', v.id, v.profile_id, 'Vaccination record to verify', v.created_at
      from public.vaccination_records v where v.organisation_id = v_org and v.verification_status = 'pending_verification'
    union all
    select 'outside_records', o.id, o.patient_id, 'Outside record to check', o.created_at
      from public.patient_documents o where o.organisation_id = v_org and o.source = 'patient' and o.verification_status = 'unchecked'
    union all
    -- CDE step 6: an uploaded ECG, scan, letter, pathology or cervical report waiting for a doctor, or one no reader could handle.
    -- Lab documents are already in 'lab_results' above, so they are left out here and never counted twice.
    select 'uploaded_documents', c.id, c.patient_id, coalesce(k.label, 'Document') || ' to review', c.status_changed_at
      from public.clinical_documents c left join public.clinical_document_kinds k on k.code = c.kind_code
     where c.organisation_id = v_org and not c.is_superseded and not c.is_test
       and (c.routed_table is null or c.routed_table in ('ecg_report_documents', 'imaging_report_documents'))
       and c.status in ('doctor_review_required', 'processing_failed')
  ), ranked as (
    select i.*, row_number() over (partition by i.k order by i.dt asc nulls last) as rn, count(*) over (partition by i.k) as tot from items i
  )
  select r.k, r.i, r.pid, pr.full_name, pr.patient_number::text, r.l, r.dt, r.tot
    from ranked r join public.profiles pr on pr.id = r.pid and pr.organisation_id = v_org
   where r.rn <= 100
   order by r.k, r.dt asc nulls last;
end $function$;


do $$
begin
  if not coalesce((select 'security_invoker=true' = any (reloptions) from pg_class where oid = 'public.clinical_record_items'::regclass), false) then
    raise exception 'clinical_record_items must be security_invoker';
  end if;
  if has_table_privilege('anon', 'public.clinical_record_items', 'SELECT') then
    raise exception 'clinical_record_items is readable by anon';
  end if;
end;
$$;
