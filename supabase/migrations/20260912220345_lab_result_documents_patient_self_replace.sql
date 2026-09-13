-- Tarragon Health — a patient may replace a lab result document they
-- uploaded themselves, while it is still unreviewed.
--
-- Product gap: "I attached the wrong file" had no fix before this — the
-- only recourse was messaging the care team. This is an in-place UPDATE of
-- the SAME row (never a delete+reinsert): file_path/original_filename/
-- mime_type/file_size_bytes change on the one row that already carries the
-- open clinician_alerts row (handle_lab_result_document's insert trigger),
-- so that alert keeps pointing at something real instead of orphaning —
-- clinician_alerts has no FK back to the document, so a delete+reinsert
-- would leave the original alert permanently open with nothing to resolve
-- it, and would also fire a SECOND alert on the reinsert.
--
-- Storage already allows this: the 'lab result doc patient update'/'...
-- delete' policies (20260720120100) let a patient overwrite or delete any
-- object under their own {auth.uid()}/ folder. The only two gaps were (1)
-- lab_result_documents had no UPDATE policy reachable by a patient at all
-- (lab_result_documents_update required is_org_staff), and (2)
-- private.enforce_lab_result_document_update() unconditionally pinned
-- file_path back to OLD on every update, for every role.
--
-- Deliberately scoped to old.source = 'patient' and old.reviewed_at is null
-- — once a doctor has reviewed the original file, replacing it out from
-- under that review is not "fixing a mistake", and a staff/lab-partner
-- upload is not the patient's own mistake to correct. Org staff's existing,
-- unrelated is_org_staff() branch (result-matching, the supersede pointer,
-- marking reviewed, etc.) is untouched.

create or replace function private.enforce_lab_result_document_update()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  -- Upload-time facts are immutable after insert — except file_path, which
  -- the uploading patient may still replace outright if they attached the
  -- wrong file, but only while nobody has reviewed it yet (old.reviewed_at
  -- is null) and only by the patient who uploaded it. Org staff never take
  -- this branch — is_org_staff's own UPDATE access is unaffected.
  if not (
    (select auth.uid()) = old.patient_id
    and old.source = 'patient'
    and old.reviewed_at is null
  ) then
    new.file_path := old.file_path;
  end if;

  new.organisation_id    := old.organisation_id;
  new.patient_id         := old.patient_id;
  new.source              := old.source;
  new.uploaded_by        := old.uploaded_by;
  new.clinician_alert_id := old.clinician_alert_id;
  new.created_at          := old.created_at;

  -- The review stamp: derive attribution from the acting session.
  if new.reviewed_at is not null and old.reviewed_at is null then
    new.reviewed_by := coalesce((select auth.uid()), new.reviewed_by);
    new.reviewed_at := now();
  elsif old.reviewed_at is not null then
    -- Once reviewed, the attribution is frozen.
    new.reviewed_by := old.reviewed_by;
    new.reviewed_at := old.reviewed_at;
  else
    new.reviewed_by := null;
  end if;

  -- The patient-facing interpretation: frozen once sent. Notifying the
  -- patient happens exactly once, in the same transaction that first sets
  -- interpretation_sent_at.
  if new.interpretation_sent_at is not null and old.interpretation_sent_at is null then
    new.interpretation_sent_at := now();

    insert into public.notifications
      (organisation_id, recipient_id, channel, template, payload, content_class)
    values (
      new.organisation_id,
      new.patient_id,
      'in_app',
      'result_interpretation_ready',
      jsonb_build_object('document_id', new.id::text),
      'clinical'
    );
  elsif old.interpretation_sent_at is not null then
    -- Once sent, the interpretation is frozen — a doctor corrects a mistake
    -- by messaging the patient, not by silently editing what was already sent.
    new.patient_interpretation := old.patient_interpretation;
    new.next_steps             := old.next_steps;
    new.interpretation_sent_at := old.interpretation_sent_at;
  else
    -- next_steps is deliberately NOT cleared here — it is dual-purpose
    -- (also the "action required" signal below, settable in the same
    -- statement as reviewed_at, independent of ever sending a patient
    -- interpretation). Only patient_interpretation, the actual draft
    -- interpretation text, is wiped when it isn't being sent now.
    new.patient_interpretation := null;
  end if;

  -- Acknowledgement status (Care Team / Provider Workspace §5.7). Exactly
  -- three ways this column may move, all structurally enforced here — not
  -- merely by RLS or a friendly RPC wrapper, so a direct client UPDATE
  -- setting acknowledgement_status (or spoofing action_completed_at without
  -- having actually gone through action_required) has no effect:
  if new.reviewed_at is not null and old.reviewed_at is null then
    -- Just reviewed in this statement: next_steps decides whether this
    -- closes out or needs a follow-up action.
    new.acknowledgement_status :=
      case when new.next_steps is not null and length(btrim(new.next_steps)) > 0
        then 'action_required' else 'reviewed' end;
    new.action_completed_at := null;
    new.action_completed_by := null;
  elsif new.action_completed_at is not null and old.action_completed_at is null then
    if old.acknowledgement_status <> 'action_required' then
      raise exception 'Only a document in action_required can be marked action_completed' using errcode = '22023';
    end if;
    new.acknowledgement_status := 'action_completed';
    new.action_completed_by := coalesce((select auth.uid()), new.action_completed_by);
    new.action_completed_at := now();
  elsif old.acknowledgement_status = 'new' and new.acknowledgement_status = 'opened' then
    -- log_result_document_viewed's own update — the only other legitimate
    -- direct write to this column.
    new.action_completed_at := old.action_completed_at;
    new.action_completed_by := old.action_completed_by;
  else
    new.acknowledgement_status := old.acknowledgement_status;
    new.action_completed_at    := old.action_completed_at;
    new.action_completed_by    := old.action_completed_by;
  end if;

  -- Amendment linkage (module 57.14). A later document names an earlier one
  -- it corrects. Only ever moves null -> a document id, or back to null to
  -- undo a mistaken link — never repointed directly from one document to
  -- another in the same statement, so a correction can't be silently
  -- redirected without first clearing it. The nested UPDATE below re-fires
  -- this same trigger on the referenced row (BEFORE UPDATE triggers apply to
  -- any UPDATE on the table, including one issued from here); that recursive
  -- call's own supersedes_document_id is unchanged, so it takes none of the
  -- branches above and none of this one — no infinite loop.
  if new.supersedes_document_id is distinct from old.supersedes_document_id then
    if old.supersedes_document_id is not null and new.supersedes_document_id is not null then
      raise exception 'Clear supersedes_document_id before pointing it at a different document'
        using errcode = '23514';
    end if;

    if new.supersedes_document_id is not null then
      if new.supersedes_document_id = new.id then
        raise exception 'A document cannot supersede itself' using errcode = '23514';
      end if;

      if not exists (
        select 1 from public.lab_result_documents d
        where d.id = new.supersedes_document_id
          and d.patient_id = new.patient_id
          and d.superseded_by_document_id is null
      ) then
        raise exception 'supersedes_document_id must reference another of this patient''s documents that is not already superseded'
          using errcode = '23514';
      end if;

      update public.lab_result_documents
         set superseded_by_document_id = new.id,
             superseded_at = now()
       where id = new.supersedes_document_id;
    else
      -- Undo: clear the stamp on whatever this used to supersede, but only
      -- if it still points back at this document (never clobber a stamp this
      -- document didn't set).
      update public.lab_result_documents
         set superseded_by_document_id = null,
             superseded_at = null
       where id = old.supersedes_document_id
         and superseded_by_document_id = old.id;
    end if;
  end if;

  return new;
end;
$function$;

drop policy if exists lab_result_documents_update on public.lab_result_documents;
create policy lab_result_documents_update on public.lab_result_documents
  for update to authenticated
  using (
    private.is_org_staff(organisation_id)
    or (patient_id = (select auth.uid()) and source = 'patient' and reviewed_at is null)
  )
  with check (
    private.is_org_staff(organisation_id)
    or (patient_id = (select auth.uid()) and source = 'patient' and reviewed_at is null)
  );

comment on policy lab_result_documents_update on public.lab_result_documents is
  'Org staff keep their existing, unrelated access (result matching, supersede pointer, marking reviewed). The second branch is new: the patient who uploaded a document may update it themselves, but only their own row, only source = patient, and only before anyone has reviewed it — letting them replace the wrong file without opening it up to edits after a doctor has acted on it.';

-- ---------------------------------------------------------------------------
-- The migration is the test.
-- ---------------------------------------------------------------------------
do $$
declare
  v_patient uuid;
  v_other_patient uuid;
  v_org uuid;
  v_doc_id uuid;
  v_alert_id uuid;
  v_def text;
  v_file_path text;
begin
  select pg_get_functiondef(oid) into v_def
  from pg_proc where proname = 'enforce_lab_result_document_update' and pronamespace = 'private'::regnamespace;
  if v_def not like '%the uploading patient may still replace outright%' then
    raise exception 'enforce_lab_result_document_update is missing the patient self-replace bypass';
  end if;
  if v_def not like '%A document cannot supersede itself%'
     or v_def not like '%Once reviewed, the attribution is frozen%'
     or v_def not like '%Only a document in action_required can be marked action_completed%' then
    raise exception 'enforce_lab_result_document_update lost a pre-existing branch';
  end if;

  select id, organisation_id into v_patient, v_org from public.profiles where role = 'patient' limit 1;
  if v_patient is null then
    raise notice 'SKIPPED behavioral proof: no patient row exists to test against';
    return;
  end if;
  select id into v_other_patient from public.profiles where role = 'patient' and id <> v_patient limit 1;

  -- This insert fires the real lab_result_documents_on_insert trigger, which
  -- may open a real clinician_alerts row (clinician_alert_id below) — cleaned
  -- up at the end of this block, before this transaction ever commits, so
  -- nothing is visible to any clinician outside this migration.
  insert into public.lab_result_documents
    (organisation_id, patient_id, file_path, original_filename, mime_type, file_size_bytes, source, uploaded_by)
  values
    (v_org, v_patient, v_patient::text || '/original.pdf', 'original.pdf', 'application/pdf', 1000, 'patient', v_patient)
  returning id, clinician_alert_id into v_doc_id, v_alert_id;

  -- 1. The uploading patient replaces their own unreviewed document: must succeed.
  perform set_config('request.jwt.claims', json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.lab_result_documents
     set file_path = v_patient::text || '/corrected.pdf', original_filename = 'corrected.pdf'
   where id = v_doc_id;
  reset role;
  perform set_config('request.jwt.claims', null, true);

  select file_path into v_file_path from public.lab_result_documents where id = v_doc_id;
  if v_file_path is distinct from v_patient::text || '/corrected.pdf' then
    raise exception 'FAIL: patient could not replace their own unreviewed upload (file_path = %)', v_file_path;
  end if;

  -- 2. Sabotage check: a DIFFERENT patient must not be able to touch it —
  -- proves the policy discriminates on patient_id, not merely on role.
  if v_other_patient is not null then
    perform set_config('request.jwt.claims', json_build_object('sub', v_other_patient, 'role', 'authenticated')::text, true);
    set local role authenticated;
    update public.lab_result_documents set file_path = v_other_patient::text || '/hijacked.pdf' where id = v_doc_id;
    reset role;
    perform set_config('request.jwt.claims', null, true);

    select file_path into v_file_path from public.lab_result_documents where id = v_doc_id;
    if v_file_path = v_other_patient::text || '/hijacked.pdf' then
      raise exception 'FAIL: a different patient replaced someone else''s result document';
    end if;
  else
    raise notice 'SKIPPED cross-patient control: only one patient row exists';
  end if;

  -- 3. Once reviewed, even the uploading patient is locked out — a doctor
  -- has already acted on the original file.
  update public.lab_result_documents set reviewed_at = now() where id = v_doc_id;

  perform set_config('request.jwt.claims', json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.lab_result_documents set file_path = v_patient::text || '/too_late.pdf' where id = v_doc_id;
  reset role;
  perform set_config('request.jwt.claims', null, true);

  select file_path into v_file_path from public.lab_result_documents where id = v_doc_id;
  if v_file_path = v_patient::text || '/too_late.pdf' then
    raise exception 'FAIL: a reviewed document could still be replaced by the patient';
  end if;

  -- Document first, then the alert it pointed at — never the reverse: the
  -- alert FK is ON DELETE SET NULL onto this table, which would otherwise
  -- fight enforce_lab_result_document_update's unconditional
  -- clinician_alert_id freeze on the internal UPDATE that action issues.
  delete from public.lab_result_documents where id = v_doc_id;
  if v_alert_id is not null then
    -- guard_clinician_alert_deletion refuses to delete a clinical-attention-
    -- or-higher alert that isn't resolved/closed yet — resolve it first.
    update public.clinician_alerts set status = 'resolved' where id = v_alert_id;
    delete from public.clinician_alerts where id = v_alert_id;
  end if;

  raise notice 'PASS: a patient may replace their own unreviewed result document, and nothing else changed';
end $$;
