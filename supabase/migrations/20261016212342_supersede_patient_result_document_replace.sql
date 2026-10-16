-- Close the last in-place replace of a result document: a patient's "I attached the wrong file" now SUPERSEDES the document.
--
-- Background (docs/design/S05b.md): S05b made recorded values supersede-not-edit, but two application paths
-- (apps/web lib/lab-results/actions.ts replaceResultDocumentAsPatient and apps/web api/mobile/lab-result-replace) still swapped file_path
-- on the SAME lab_result_documents row, using the patient UPDATE policy and the file_path bypass that
-- 20260912220345_lab_result_documents_patient_self_replace.sql added. Both paths now call public.replace_my_result_document, below.
--
-- What the function does, in one transaction, for the caller's OWN, UNREVIEWED, patient-uploaded, not-yet-replaced document:
--   1. resolves the old review alert (resolution_outcome = no_action_needed, action text starting 'Handed over:') BEFORE the new row exists,
--      so the alert classifier does not flag the replacement's alert as a possible duplicate of it;
--   2. inserts a NEW lab_result_documents row (same patient, order, test code, screening completion; new file; the note is kept unless a new
--      one is given). The existing insert trigger private.handle_lab_result_document opens the review alert for it, exactly as for any
--      upload, so the abnormal-result review is created by the same code that creates it for every other upload;
--   3. if that insert opened NO alert (review not unlocked any more) the whole step is rolled back and the replace is REFUSED with a clear
--      message: the old alert is the only record that a review was wanted and its document would be hidden, so nothing is changed;
--   4. otherwise hands the priority over: the new alert takes the HIGHER effective level of the two (level, severity, escalation_level,
--      earliest SLA) and the old alert's detail trail, so replacing a file that looked critical cannot lower the review;
--   5. links the pair through the existing staff-side mechanism (setting supersedes_document_id makes
--      private.enforce_lab_result_document_update stamp superseded_by_document_id and superseded_at on the old row);
--   6. points an open paid result-consult request that was claimed against the old document at the new one;
--   7. writes one audit_log row (lab_result_document.superseded).
-- The old row and its stored file are KEPT (the application no longer deletes the object).
--
-- Read side: a restrictive SELECT policy hides a document that was superseded and never reviewed (nobody relied on it; its alert moved to the
-- replacement) from every authenticated reader: the patient, the tied clinician, the results inbox, the lab liaison counts. A reviewed
-- document stays visible after a later correction (module 57.14 "Amended"). Service role and the SECURITY DEFINER functions are unaffected,
-- so the original is retained and reachable for audit.
--
-- Closing the database side of the in-place path (patched from the live definition of private.enforce_lab_result_document_update so no other
-- branch of the trigger can drift):
--   * file_path is pinned to its stored value on every UPDATE for every role (the patient bypass of 20260912220345 is removed; the patient
--     can still edit her note);
--   * a signed-in user who is not org staff cannot set supersedes_document_id, superseded_by_document_id or superseded_at, otherwise a
--     patient could stamp her own unreviewed document as replaced and drop it out of the review queue now that replaced documents are hidden.
--     The only non-staff path is this function, which flags its own transaction (app.result_document_replace). Owner and service-role
--     sessions (no auth.uid) are unaffected, as is org-staff supersede (module 57.14).
--
-- Review-prompt side effect: private.reputation_review_on_clinician_alert_resolved enqueued a "how was your care" review prompt on ANY alert
-- resolution. A handover is a system action, not care delivered, so it is patched to skip resolutions whose action text starts 'Handed over:'.
--
-- Work queues: public.clinical_worklist() and public.org_open_work_counts() are SECURITY DEFINER and would still list a replaced, never-reviewed
-- document as work nobody can open; both are patched (from their live definitions) to skip it. Other definer readers of lab_result_documents
-- (care-gap and provenance functions) were not changed; see OQ-702.
--
-- The old document's AI extraction proposal (lab_report_extractions, status extracted) is marked discarded so values read from the file the
-- patient said was wrong cannot be confirmed into the record.
--
-- Counts: could not be read from production when this was written (the live project timed out on every query that session, see the PR).
-- The change adds one function and one policy and patches two trigger functions; no row is converted.

create or replace function public.replace_my_result_document(
  p_document_id uuid,
  p_file_path text,
  p_original_filename text,
  p_mime_type text,
  p_file_size_bytes bigint,
  p_note text default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_old public.lab_result_documents%rowtype;
  v_new uuid;
  v_new_alert uuid;
  v_oa public.clinician_alerts%rowtype;
  v_na public.clinician_alerts%rowtype;
  v_handover boolean := false;
  v_eff public.alert_level;
begin
  if v_uid is null then
    raise exception 'sign in required' using errcode = '28000';
  end if;

  select * into v_old from public.lab_result_documents where id = p_document_id for update;
  if not found or v_old.patient_id <> v_uid or v_old.source <> 'patient' then
    raise exception 'That upload isn''t yours to replace.' using errcode = '42501';
  end if;
  if v_old.reviewed_at is not null then
    raise exception 'Your care team has already reviewed this one. Message them instead.' using errcode = '55000';
  end if;
  if v_old.superseded_by_document_id is not null then
    raise exception 'That upload was already replaced.' using errcode = '55000';
  end if;
  if p_file_path is null or p_file_path not like v_uid::text || '/%' or p_file_path = v_old.file_path then
    raise exception 'The replacement file must be a new file in your own folder.' using errcode = '22023';
  end if;
  if p_mime_type is null or p_file_size_bytes is null or p_file_size_bytes <= 0 then
    raise exception 'The replacement file details are missing.' using errcode = '22023';
  end if;

  -- Tells private.enforce_lab_result_document_update that this transaction is the sanctioned replace (transaction-local).
  perform set_config('app.result_document_replace', 'on', true);

  begin
    if v_old.clinician_alert_id is not null then
      select * into v_oa from public.clinician_alerts where id = v_old.clinician_alert_id for update;
      if found and v_oa.status not in ('resolved', 'closed') then
        v_handover := true;
        update public.clinician_alerts
           set status = 'resolved',
               resolution_action = 'Handed over: the patient replaced the uploaded file before review. The review continues on the replacement document''s alert.',
               resolution_outcome = 'no_action_needed',
               detail = coalesce(detail, '') || E'\n\nResolved automatically: the patient replaced the uploaded file. The review continues on the replacement document.'
         where id = v_oa.id;
      end if;
    end if;

    insert into public.lab_result_documents
      (organisation_id, patient_id, lab_order_id, screening_completion_id, file_path, original_filename, mime_type, file_size_bytes,
       source, uploaded_by, note, test_code)
    values
      (v_old.organisation_id, v_old.patient_id, v_old.lab_order_id, v_old.screening_completion_id, p_file_path, p_original_filename,
       p_mime_type, p_file_size_bytes, 'patient', v_uid, coalesce(nullif(btrim(p_note), ''), v_old.note), v_old.test_code)
    returning id, clinician_alert_id into v_new, v_new_alert;

    if v_handover and v_new_alert is null then
      -- nothing to hand the review to: undo the resolve and the insert, then refuse (handler below)
      raise exception 'replacement opened no review alert' using errcode = 'RP001';
    end if;
  exception when sqlstate 'RP001' then
    raise exception 'Your care team cannot review a new file for this upload right now. Message them instead.' using errcode = '55000';
  end;

  -- the existing mechanism stamps the old row (superseded_by_document_id, superseded_at)
  update public.lab_result_documents set supersedes_document_id = v_old.id where id = v_new;

  -- values read from the file the patient said was wrong must not be confirmable into the record
  update public.lab_report_extractions set status = 'discarded' where document_id = v_old.id and status = 'extracted';

  if v_handover then
    select * into v_na from public.clinician_alerts where id = v_new_alert for update;
    v_eff := greatest(coalesce(v_na.override_level, v_na.level), coalesce(v_oa.override_level, v_oa.level));
    update public.clinician_alerts
       set level = v_eff,
           severity = case v_eff when 'emergency' then 4 when 'urgent_escalation' then 3 when 'clinician_review' then 2 when 'routine' then 1 else severity end,
           escalation_level = greatest(coalesce(v_na.escalation_level, 0), coalesce(v_oa.escalation_level, 0)),
           sla_due_at = case when v_na.sla_due_at is null then v_oa.sla_due_at when v_oa.sla_due_at is null then v_na.sla_due_at
                             else least(v_na.sla_due_at, v_oa.sla_due_at) end,
           detail = coalesce(v_na.detail, '') || E'\n\nThis replaces an earlier upload that the patient swapped for this file. Earlier alert detail: '
                    || coalesce(v_oa.detail, '(none)')
     where id = v_new_alert;
  end if;

  -- an open paid consult request claimed against the old document follows the new file
  update public.lab_result_consult_requests
     set lab_result_document_id = v_new
   where lab_result_document_id = v_old.id and patient_id = v_uid and status not in ('expired', 'cancelled', 'refunded');

  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, subject_patient_id, event)
  values (v_old.organisation_id, v_uid, 'lab_result_document.superseded', 'lab_result_documents', v_new, v_uid,
          jsonb_build_object('supersedes_document_id', v_old.id, 'old_alert_id', v_old.clinician_alert_id, 'new_alert_id', v_new_alert,
                             'alert_handed_over', v_handover));

  perform set_config('app.result_document_replace', 'off', true);
  return v_new;
end;
$function$;

revoke all on function public.replace_my_result_document(uuid, text, text, text, bigint, text) from public, anon;
grant execute on function public.replace_my_result_document(uuid, text, text, text, bigint, text) to authenticated;

-- Hide a superseded, never-reviewed document from every authenticated reader.
create policy lab_result_documents_hide_replaced on public.lab_result_documents
  as restrictive for select to authenticated
  using (superseded_by_document_id is null or reviewed_at is not null);

comment on policy lab_result_documents_hide_replaced on public.lab_result_documents is
  'A document that was superseded before anyone reviewed it (the patient replaced the wrong file; its alert moved to the replacement) is hidden from patients and staff alike. A reviewed document stays visible after a correction. Service role and SECURITY DEFINER functions still see every row, so the original is retained.';

-- Patch the update trigger from its live definition: file_path pin, and the supersede stamp reserved to org staff or the sanctioned replace.
do $$
declare
  v_def text;
  v_new text;
  v_block constant text := E'  if not (\n    (select auth.uid()) = old.patient_id\n    and old.source = ''patient''\n    and old.reviewed_at is null\n  ) then\n    new.file_path := old.file_path;\n  end if;';
  v_repl constant text := E'  -- file_path is never changed by an UPDATE. A replacement file is a new superseding document (public.replace_my_result_document).\n  new.file_path := old.file_path;\n  -- The supersede link and stamp belong to org staff (module 57.14) and to the sanctioned replace. A signed-in non-staff user cannot set them:\n  -- replaced documents are hidden from every reader, so a patient could otherwise drop her own unreviewed document out of the review queue.\n  if (select auth.uid()) is not null\n     and coalesce(current_setting(''app.result_document_replace'', true), '''') <> ''on''\n     and not private.is_org_staff(old.organisation_id) then\n    new.supersedes_document_id := old.supersedes_document_id;\n    new.superseded_by_document_id := old.superseded_by_document_id;\n    new.superseded_at := old.superseded_at;\n  end if;';
begin
  select pg_get_functiondef('private.enforce_lab_result_document_update()'::regprocedure) into v_def;
  if position(v_block in v_def) = 0 then
    raise exception 'enforce_lab_result_document_update no longer has the expected file_path bypass block; review before patching';
  end if;
  v_new := replace(v_def, v_block, v_repl);
  execute v_new;
  if position('app.result_document_replace' in pg_get_functiondef('private.enforce_lab_result_document_update()'::regprocedure)) = 0 then
    raise exception 'patch of enforce_lab_result_document_update did not apply';
  end if;
end $$;

-- Patch the review-prompt trigger: a handover is a system action, not care delivered.
do $$
declare
  v_def text;
  v_new text;
  v_old constant text := E'if new.status in (''resolved'', ''closed'') and old.status not in (''resolved'', ''closed'') then';
  v_repl constant text := E'if new.status in (''resolved'', ''closed'') and old.status not in (''resolved'', ''closed'')\n     and coalesce(new.resolution_action, '''') not like ''Handed over:%'' then';
begin
  select pg_get_functiondef('private.reputation_review_on_clinician_alert_resolved()'::regprocedure) into v_def;
  if position(v_old in v_def) = 0 then
    raise exception 'reputation_review_on_clinician_alert_resolved no longer has the expected condition; review before patching';
  end if;
  v_new := replace(v_def, v_old, v_repl);
  execute v_new;
  if position('Handed over:' in pg_get_functiondef('private.reputation_review_on_clinician_alert_resolved()'::regprocedure)) = 0 then
    raise exception 'patch of reputation_review_on_clinician_alert_resolved did not apply';
  end if;
end $$;

-- Patch the two SECURITY DEFINER work-queue readers so a replaced, never-reviewed document is not counted as work.
do $$
declare
  v_def text;
  v_new text;
begin
  select pg_get_functiondef('public.clinical_worklist()'::regprocedure) into v_def;
  if position('d.acknowledgement_status <> ''action_completed''' in v_def) = 0 then
    raise exception 'clinical_worklist no longer has the expected lab_result_documents filter; review before patching';
  end if;
  v_new := replace(v_def, 'd.acknowledgement_status <> ''action_completed''', 'd.acknowledgement_status <> ''action_completed'' and (d.superseded_by_document_id is null or d.reviewed_at is not null)');
  execute v_new;

  select pg_get_functiondef('public.org_open_work_counts()'::regprocedure) into v_def;
  if position('from public.lab_result_documents where organisation_id = v_org and acknowledgement_status <> ''action_completed''' in v_def) = 0 then
    raise exception 'org_open_work_counts no longer has the expected lab_result_documents filter; review before patching';
  end if;
  v_new := replace(v_def, 'from public.lab_result_documents where organisation_id = v_org and acknowledgement_status <> ''action_completed''',
                   'from public.lab_result_documents where organisation_id = v_org and acknowledgement_status <> ''action_completed'' and (superseded_by_document_id is null or reviewed_at is not null)');
  execute v_new;
  if position('superseded_by_document_id' in pg_get_functiondef('public.clinical_worklist()'::regprocedure)) = 0
     or position('superseded_by_document_id' in pg_get_functiondef('public.org_open_work_counts()'::regprocedure)) = 0 then
    raise exception 'patch of the work-queue functions did not apply';
  end if;
end $$;

do $$
begin
  if has_function_privilege('anon', 'public.replace_my_result_document(uuid,text,text,text,bigint,text)', 'execute') then
    raise exception 'anon can execute replace_my_result_document';
  end if;
  if not has_function_privilege('authenticated', 'public.replace_my_result_document(uuid,text,text,text,bigint,text)', 'execute') then
    raise exception 'authenticated cannot execute replace_my_result_document';
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'lab_result_documents'
                  and policyname = 'lab_result_documents_hide_replaced' and permissive = 'RESTRICTIVE') then
    raise exception 'lab_result_documents_hide_replaced is missing or not restrictive';
  end if;
end $$;
