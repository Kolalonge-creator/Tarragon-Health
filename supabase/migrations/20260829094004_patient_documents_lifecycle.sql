-- Tarragon Health — Document & Clinical Record Management, part 2/5: lifecycle,
-- versioning, and the write-side attribution/audit trail (§35.4, §35.9 human-
-- validation gate, §35.13 write half, §35.14).
--
-- Every state move below happens through a SECURITY DEFINER RPC or trigger,
-- never through a raw UPDATE from the client — the part 1 UPDATE policy is
-- deliberately wide (any owner of the row can hit it) precisely because these
-- guards are what keep that safe: a client-issued UPDATE can only ever change
-- the descriptive columns, no matter what it sends.

-- ---------------------------------------------------------------------------
-- 1. BEFORE INSERT — server-derive attribution, enforce confidentiality
--    provenance, seed the version chain, write the timeline event and the
--    audit-log row, and (patient self-upload of a clinical type only) raise a
--    review flag — same shape as private.handle_lab_result_document.
-- ---------------------------------------------------------------------------
create or replace function private.handle_patient_document_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- uploaded_by is server-derived from the session whenever there is one. A
  -- service-role staff upload (auth.uid() null) keeps the id the server
  -- action passed explicitly — same rule as lab_result_documents.
  if (select auth.uid()) is not null then
    new.uploaded_by := (select auth.uid());
  end if;

  -- 'patient_private' is a self-classification: only the patient may put their
  -- own upload beyond staff reach. A staff-sourced upload claiming it would be
  -- a doctor hiding a document from the rest of the care team.
  if new.confidentiality = 'patient_private' and new.source <> 'patient' then
    raise exception 'patient_private confidentiality may only be set on a patient-sourced document';
  end if;

  -- A fresh upload is never pre-validated or pre-reviewed, whatever the client
  -- sent — these move only through the RPCs below.
  new.status         := coalesce(new.status, 'uploaded');
  if new.status not in ('created', 'uploaded') then
    new.status := 'uploaded';
  end if;
  new.scan_status     := 'pending';
  new.scan_detail     := null;
  new.scanned_at      := null;
  new.validated_by    := null;
  new.validated_at    := null;
  new.available_at    := null;
  new.archived_at     := null;
  new.archived_by     := null;
  new.rejected_reason := null;

  -- Version 1 of a new family, unless this row is itself a correction
  -- (supersedes_id already set — see private.supersede_patient_document,
  -- which builds the new row directly and calls this same trigger path).
  if new.supersedes_id is null then
    new.version := 1;
    if new.document_family_id is null then
      new.document_family_id := gen_random_uuid();
    end if;
  end if;

  insert into public.patient_timeline
    (organisation_id, patient_id, event_type, source_table, source_id, title, summary, metadata)
  values (
    new.organisation_id,
    new.patient_id,
    'document_added',
    'patient_documents',
    new.id,
    new.title,
    format('%s uploaded', new.document_type::text),
    jsonb_build_object('document_type', new.document_type::text, 'source', new.source::text)
  );

  insert into public.audit_log
    (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (
    new.organisation_id,
    new.uploaded_by,
    'patient_document.uploaded',
    'patient_documents',
    new.id,
    jsonb_build_object(
      'document_type', new.document_type::text,
      'category', new.category::text,
      'confidentiality', new.confidentiality::text,
      'source', new.source::text
    )
  );

  -- Only a patient's own direct upload of a clinical type raises a review
  -- flag — staff already know about a document they filed themselves, and a
  -- document that already runs through its own pipeline (lab_result_documents,
  -- ecg_report_documents) is flagged by that pipeline, not this one; this
  -- table's source_table stays null for a genuinely new upload, so checking it
  -- is null is exactly "not already covered elsewhere".
  if new.source = 'patient' and new.category = 'clinical' and new.source_table is null then
    insert into public.clinician_alerts
      (organisation_id, patient_id, level, status, title, detail, escalation_level)
    values (
      new.organisation_id,
      new.patient_id,
      'clinician_review',
      'open',
      format('%s uploaded — review needed', new.document_type::text),
      format('A patient uploaded a %s (%s). Review and file any clinical finding.', new.document_type::text, new.title),
      2
    );
  end if;

  return new;
end;
$$;

drop trigger if exists patient_documents_on_insert on public.patient_documents;
create trigger patient_documents_on_insert
  before insert on public.patient_documents
  for each row execute function private.handle_patient_document_insert();

-- ---------------------------------------------------------------------------
-- 2. BEFORE UPDATE — freeze upload-time facts, and only let the lifecycle
--    fields move via the specific RPCs below (they call this same trigger
--    path, so the guard recognises their shape rather than special-casing
--    each caller).
-- ---------------------------------------------------------------------------
create or replace function private.enforce_patient_document_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Facts about the upload itself never change after the fact.
  new.organisation_id      := old.organisation_id;
  new.patient_id           := old.patient_id;
  new.document_type        := old.document_type;
  new.source               := old.source;
  new.uploaded_by          := old.uploaded_by;
  new.uploaded_at          := old.uploaded_at;
  new.file_path            := old.file_path;
  new.original_filename    := old.original_filename;
  new.mime_type            := old.mime_type;
  new.file_size_bytes      := old.file_size_bytes;
  new.checksum_sha256      := old.checksum_sha256;
  new.document_family_id   := old.document_family_id;
  new.version              := old.version;
  new.supersedes_id        := old.supersedes_id;
  new.source_table         := old.source_table;
  new.source_id            := old.source_id;

  -- Confidentiality provenance holds on update too — a document cannot be
  -- relabelled patient_private after the fact by anyone, including the
  -- patient, because staff who could already see it must not silently lose
  -- that ability (a downgrade of an existing grant needs the explicit
  -- revoke path in part 3, not a metadata edit).
  if new.confidentiality = 'patient_private' and old.confidentiality <> 'patient_private' then
    raise exception 'confidentiality may not be changed to patient_private after upload';
  end if;
  if old.confidentiality = 'patient_private' then
    new.confidentiality := old.confidentiality;
  end if;

  -- Lifecycle fields are frozen against direct client UPDATEs; they move only
  -- through private.validate_patient_document / archive_patient_document /
  -- supersede_patient_document below, which SET them via a plain UPDATE that
  -- reaches this same trigger — so those functions restore the intended
  -- values immediately below rather than being blocked by this freeze. A
  -- plain client UPDATE (the RLS policy's normal caller) can never move any
  -- of these — it can only touch title/description/document_date/etc.
  if not coalesce(current_setting('private.document_lifecycle_move', true), '') = 'true' then
    new.status          := old.status;
    new.scan_status      := old.scan_status;
    new.scan_detail      := old.scan_detail;
    new.scanned_at       := old.scanned_at;
    new.validated_by     := old.validated_by;
    new.validated_at     := old.validated_at;
    new.available_at     := old.available_at;
    new.archived_at      := old.archived_at;
    new.archived_by      := old.archived_by;
    new.archive_reason   := old.archive_reason;
    new.rejected_reason  := old.rejected_reason;
    new.superseded_by_id := old.superseded_by_id;
    new.supersede_reason := old.supersede_reason;
    -- Retention is policy-governed (part 5's document_retention_policies +
    -- private.apply_patient_document_retention), not something any org-staff
    -- account holding the ordinary UPDATE grant should be able to shorten or
    -- clear with a plain UPDATE. The retention trigger's own writes are
    -- unaffected by this freeze because every path that legitimately sets
    -- these fields (publish_patient_document, the retention sweep) already
    -- sets this same GUC for its own reasons.
    new.retention_until := old.retention_until;
    new.retention_basis := old.retention_basis;
  end if;

  return new;
end;
$$;

drop trigger if exists patient_documents_update_guard on public.patient_documents;
create trigger patient_documents_update_guard
  before update on public.patient_documents
  for each row execute function private.enforce_patient_document_update();

-- ---------------------------------------------------------------------------
-- 3. Lifecycle RPCs. Each sets the local GUC the trigger above checks, so the
--    freeze in part 2 only ever lifts for these specific, narrow moves.
-- ---------------------------------------------------------------------------

-- §35.16 — record a scan verdict. 'clean' advances uploaded -> validated
-- (§35.9's automatic classification/validation step); anything else moves the
-- document to 'rejected' and it can never become readable (see the part 1
-- CHECK). Called by the upload pipeline immediately after the scanner returns,
-- never by a patient or clinician directly — hence no is_org_staff gate here,
-- only "this document exists and is still awaiting a scan verdict".
create or replace function public.record_patient_document_scan(
  p_document_id uuid,
  p_scan_status public.patient_document_scan_status,
  p_detail      text default null
)
returns public.patient_documents
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.patient_documents;
begin
  select * into v_row from public.patient_documents where id = p_document_id;
  if v_row.id is null then
    raise exception 'document % not found', p_document_id;
  end if;
  if v_row.status <> 'uploaded' then
    raise exception 'document % has already left the scan step (status %)', p_document_id, v_row.status;
  end if;

  perform set_config('private.document_lifecycle_move', 'true', true);

  if p_scan_status = 'clean' then
    update public.patient_documents
      set scan_status = 'clean', scan_detail = p_detail, scanned_at = now(),
          status = 'validated', validated_at = now()
      where id = p_document_id
      returning * into v_row;
  else
    update public.patient_documents
      set scan_status = p_scan_status, scan_detail = p_detail, scanned_at = now(),
          status = 'rejected',
          rejected_reason = coalesce(p_detail, format('file scan returned %s', p_scan_status::text))
      where id = p_document_id
      returning * into v_row;

    insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
    values (v_row.organisation_id, null, 'patient_document.scan_rejected', 'patient_documents', v_row.id,
      jsonb_build_object('scan_status', p_scan_status::text, 'detail', p_detail));
  end if;

  return v_row;
end;
$$;

comment on function public.record_patient_document_scan(uuid, public.patient_document_scan_status, text) is
  '§35.16. The only path from uploaded to validated (clean) or rejected (anything else). A document that is never scanned can never become readable — see the part 1 CHECK constraint pairing status and scan_status.';

-- Validated -> available. Split from the scan step because §35.4 lists them as
-- two states and some document types genuinely need a human between them
-- (§35.9: "important classification should have confidence thresholds and
-- appropriate verification" — an OCR-classified document with low confidence,
-- flagged by part 4, is held at 'validated' until a person confirms it).
-- validated_by is server-derived from the calling session, never a passed
-- parameter — same forge-proof rule as uploaded_by/reviewed_by elsewhere.
-- Automatic promotion (the common case, no human classification step was
-- needed) is a service-role call with no session, so it stays null; a person
-- confirming an uncertain classification is recorded here.
create or replace function public.publish_patient_document(
  p_document_id uuid
)
returns public.patient_documents
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.patient_documents;
  v_actor uuid := (select auth.uid());
begin
  select * into v_row from public.patient_documents where id = p_document_id;
  if v_row.id is null then
    raise exception 'document % not found', p_document_id;
  end if;
  if v_row.status <> 'validated' then
    raise exception 'document % is not awaiting publish (status %)', p_document_id, v_row.status;
  end if;
  -- An authenticated caller must be org staff for this document; a
  -- service-role pipeline call (v_actor null) is the automatic-promotion path
  -- and needs no further check — it already only runs after a clean scan.
  if v_actor is not null and not private.is_org_staff(v_row.organisation_id) then
    raise exception 'not authorised to publish document %', p_document_id;
  end if;

  perform set_config('private.document_lifecycle_move', 'true', true);

  update public.patient_documents
    set status = 'available',
        available_at = now(),
        validated_by = v_actor
    where id = p_document_id
    returning * into v_row;

  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (v_row.organisation_id, v_actor, 'patient_document.published',
    'patient_documents', v_row.id, '{}'::jsonb);

  return v_row;
end;
$$;

comment on function public.publish_patient_document(uuid) is
  '§35.4/§35.9. Moves a validated document to available. p_validated_by is null-gated exactly like reviewed_by elsewhere: set only when a real person confirmed an uncertain classification, left null when the scan-clean path promoted it automatically.';

-- §35.17 archive. Retained, out of the working record. Reversible in data
-- (archived_at cleared) only by another explicit call — there is no separate
-- "unarchive" entry point because reviving an archived clinical document is
-- itself a decision that should leave the same kind of trail as archiving it.
create or replace function public.archive_patient_document(
  p_document_id uuid,
  p_reason      text
)
returns public.patient_documents
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.patient_documents;
  v_actor uuid := (select auth.uid());
begin
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'archive_patient_document requires a reason';
  end if;

  select * into v_row from public.patient_documents where id = p_document_id;
  if v_row.id is null then
    raise exception 'document % not found', p_document_id;
  end if;
  -- An authenticated caller must be org staff or the owning patient; a
  -- service-role/administrative call (v_actor null — no session, e.g. an
  -- ops script or the acceptance check) is trusted at the grant boundary,
  -- same reasoning as the null-actor branch in publish_patient_document.
  if v_actor is not null and not (private.is_org_staff(v_row.organisation_id) or v_row.patient_id = v_actor) then
    raise exception 'not authorised to archive document %', p_document_id;
  end if;

  perform set_config('private.document_lifecycle_move', 'true', true);

  update public.patient_documents
    set status = 'archived', archived_at = now(), archived_by = v_actor, archive_reason = p_reason
    where id = p_document_id
    returning * into v_row;

  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (v_row.organisation_id, v_actor, 'patient_document.archived', 'patient_documents', v_row.id,
    jsonb_build_object('reason', p_reason));

  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Versioning (§35.14) — "Report v1 -> Correction -> Report v2. Both
--    versions remain traceable."
-- ---------------------------------------------------------------------------
-- Takes the NEW file's storage path (already uploaded by the caller under the
-- same patient's folder) and the row it corrects, and creates the next version
-- in the family. The old row is marked superseded, never edited or deleted —
-- both versions stay independently readable at their original ids.
create or replace function public.supersede_patient_document(
  p_previous_id       uuid,
  p_file_path         text,
  p_original_filename text,
  p_mime_type         text,
  p_file_size_bytes   bigint,
  p_checksum_sha256   text,
  p_reason            text
)
returns public.patient_documents
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prev public.patient_documents;
  v_new  public.patient_documents;
  v_actor uuid := (select auth.uid());
begin
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'supersede_patient_document requires a reason';
  end if;

  select * into v_prev from public.patient_documents where id = p_previous_id;
  if v_prev.id is null then
    raise exception 'document % not found', p_previous_id;
  end if;
  if v_prev.status = 'superseded' then
    raise exception 'document % is already superseded — correct its successor instead', p_previous_id;
  end if;
  -- Same null-actor exception as archive/publish above: a service-role or
  -- unauthenticated-session call is a trusted server-side caller.
  if v_actor is not null and not (
    private.is_org_staff(v_prev.organisation_id)
    or (v_prev.patient_id = v_actor and v_prev.source = 'patient')
  ) then
    raise exception 'not authorised to supersede document %', p_previous_id;
  end if;

  insert into public.patient_documents (
    organisation_id, patient_id, document_type, confidentiality, source,
    title, description, author_profile_id, author_name, author_organisation,
    document_date, file_path, original_filename, mime_type, file_size_bytes,
    checksum_sha256, document_family_id, version, supersedes_id, supersede_reason,
    source_table, source_id
  )
  values (
    v_prev.organisation_id, v_prev.patient_id, v_prev.document_type, v_prev.confidentiality, v_prev.source,
    v_prev.title, v_prev.description, v_prev.author_profile_id, v_prev.author_name, v_prev.author_organisation,
    v_prev.document_date, p_file_path, p_original_filename, p_mime_type, p_file_size_bytes,
    p_checksum_sha256, v_prev.document_family_id, v_prev.version + 1, v_prev.id, p_reason,
    v_prev.source_table, v_prev.source_id
  )
  returning * into v_new;

  perform set_config('private.document_lifecycle_move', 'true', true);
  update public.patient_documents
    set status = 'superseded', superseded_by_id = v_new.id
    where id = v_prev.id;

  insert into public.patient_timeline
    (organisation_id, patient_id, event_type, source_table, source_id, title, summary, metadata)
  values (
    v_new.organisation_id, v_new.patient_id, 'document_added', 'patient_documents', v_new.id,
    v_new.title, format('Correction to v%s', v_prev.version),
    jsonb_build_object('supersedes_id', v_prev.id, 'version', v_new.version, 'reason', p_reason)
  );

  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (v_new.organisation_id, v_actor, 'patient_document.superseded', 'patient_documents', v_prev.id,
    jsonb_build_object('new_version_id', v_new.id, 'reason', p_reason));

  return v_new;
end;
$$;

comment on function public.supersede_patient_document(uuid, text, text, text, bigint, text, text) is
  '§35.14. Creates version N+1 in the same family and marks version N superseded (never edited, never deleted — both remain independently readable and both keep their own RLS/audit history). The new row starts its own scan/validate/publish lifecycle from part 2/3 exactly like a first upload; it does not inherit the previous version''s availability.';

-- public.* functions are born PUBLIC-executable (unlike private.*, which
-- 20260812003758 closed by schema-level default) — each needs its own
-- explicit revoke, same as every other public-schema RPC in this codebase.
revoke execute on function public.record_patient_document_scan(uuid, public.patient_document_scan_status, text) from public;
revoke execute on function public.record_patient_document_scan(uuid, public.patient_document_scan_status, text) from anon;
grant execute on function public.record_patient_document_scan(uuid, public.patient_document_scan_status, text) to service_role;

revoke execute on function public.publish_patient_document(uuid) from public;
revoke execute on function public.publish_patient_document(uuid) from anon;
grant execute on function public.publish_patient_document(uuid) to authenticated, service_role;

revoke execute on function public.archive_patient_document(uuid, text) from public;
revoke execute on function public.archive_patient_document(uuid, text) from anon;
grant execute on function public.archive_patient_document(uuid, text) to authenticated, service_role;

revoke execute on function public.supersede_patient_document(uuid, text, text, text, bigint, text, text) from public;
revoke execute on function public.supersede_patient_document(uuid, text, text, text, bigint, text, text) from anon;
grant execute on function public.supersede_patient_document(uuid, text, text, text, bigint, text, text) to authenticated, service_role;
