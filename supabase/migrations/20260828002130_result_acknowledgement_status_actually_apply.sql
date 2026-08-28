-- Tarragon Health — result acknowledgement workflow (Care Team / Provider
-- Workspace §5.7: New -> Opened -> Reviewed -> Action required -> Action
-- completed), for real this time.
--
-- This content was already committed to git as
-- 20260827204355_result_acknowledgement_status.sql, and recorded as
-- "shipped" in the project's own history, but a live-state check (done
-- while building the Abnormal Result Engine — §7.3 "Result status" and
-- §7.10 "Result acknowledgement" of that spec are exactly what this
-- migration already implements, so finding it broken here is directly in
-- scope) found it was never actually applied to production:
-- lab_result_documents had no acknowledgement_status/action_completed_at/
-- action_completed_by columns, private.enforce_lab_result_document_update
-- was still the pre-this-migration definition, and log_result_document_
-- viewed/mark_result_document_action_completed didn't exist at all —
-- meaning /clinician/results-inbox (already-shipped app code that queries
-- and writes all of these) has been broken in production. The committed
-- file itself is correct (checked directly — no bug in it); why it was
-- never actually run is unknown. Content below is byte-identical to that
-- committed file; this migration exists only because a version already
-- recorded as applied cannot be re-applied under its original name/version,
-- so this reapplies the same content under a fresh version instead of
-- rewriting migration history.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'result_document_acknowledgement_status') then
    create type public.result_document_acknowledgement_status as enum (
      'new', 'opened', 'reviewed', 'action_required', 'action_completed'
    );
  end if;
end $$;

alter table public.lab_result_documents
  add column if not exists acknowledgement_status public.result_document_acknowledgement_status
    not null default 'new',
  add column if not exists action_completed_at timestamptz,
  add column if not exists action_completed_by uuid references public.profiles (id) on delete set null;

-- ---------------------------------------------------------------------------
-- Extend the existing review-stamp trigger. Byte-identical to the live
-- definition (20260810022117_lab_result_document_patient_interpretation.sql)
-- through the interpretation_sent_at block; only the new block at the end is
-- added.
-- ---------------------------------------------------------------------------
create or replace function private.enforce_lab_result_document_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Upload-time facts are immutable after insert.
  new.organisation_id    := old.organisation_id;
  new.patient_id         := old.patient_id;
  new.file_path          := old.file_path;
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
    new.patient_interpretation := null;
    new.next_steps             := null;
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

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- log_result_document_viewed (20260827202722): extended to also flip
-- new -> opened. Byte-identical otherwise.
-- ---------------------------------------------------------------------------
create or replace function public.log_result_document_viewed(p_document_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_org        uuid;
  v_patient_id uuid;
begin
  select organisation_id, patient_id into v_org, v_patient_id
  from public.lab_result_documents where id = p_document_id;

  if v_org is null or not private.is_org_staff(v_org) then
    raise exception 'not authorised';
  end if;

  update public.lab_result_documents
  set acknowledgement_status = 'opened'
  where id = p_document_id and acknowledgement_status = 'new';

  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (
    v_org, auth.uid(), 'clinician.result_document_viewed', 'lab_result_document', p_document_id,
    jsonb_build_object('patient_id', v_patient_id)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- "Action completed" — the one genuinely new manual action.
-- ---------------------------------------------------------------------------
create or replace function public.mark_result_document_action_completed(p_document_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_org    uuid;
  v_status public.result_document_acknowledgement_status;
begin
  select organisation_id, acknowledgement_status into v_org, v_status
  from public.lab_result_documents where id = p_document_id;

  if v_org is null or not private.is_org_staff(v_org) then
    raise exception 'not authorised';
  end if;
  if v_status is distinct from 'action_required' then
    raise exception 'Only a document in action_required can be marked action_completed' using errcode = '22023';
  end if;

  update public.lab_result_documents
  set action_completed_at = now()
  where id = p_document_id;
end;
$$;

comment on function public.mark_result_document_action_completed(uuid) is
  'Explicit "the follow-up actually happened" signal, distinct from next_steps (what was asked '
  'for) — see 20260827204355_result_acknowledgement_status.sql. The action_required guard is '
  'enforced twice: here for a clean error message, and again inside '
  'enforce_lab_result_document_update as the real structural gate.';

revoke all on function public.mark_result_document_action_completed(uuid) from public;
grant execute on function public.mark_result_document_action_completed(uuid) to authenticated;
revoke execute on function public.mark_result_document_action_completed(uuid) from anon;

-- ---------------------------------------------------------------------------
-- Proof, not hope.
-- ---------------------------------------------------------------------------
do $$
declare
  v_def text;
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'lab_result_documents'
      and column_name = 'acknowledgement_status'
  ) then
    raise exception 'lab_result_documents.acknowledgement_status was not added';
  end if;

  select pg_get_functiondef(oid) into v_def
  from pg_proc where proname = 'enforce_lab_result_document_update' and pronamespace = 'private'::regnamespace;
  if v_def not like '%action_required%' then
    raise exception 'enforce_lab_result_document_update is missing the acknowledgement-status block';
  end if;
  if v_def not like '%interpretation_sent_at%' or v_def not like '%Once reviewed, the attribution is frozen%' then
    raise exception 'enforce_lab_result_document_update lost a pre-existing branch';
  end if;

  if has_function_privilege('anon', 'public.mark_result_document_action_completed(uuid)', 'EXECUTE') then
    raise exception 'FAIL: mark_result_document_action_completed is EXECUTE-able by anon — ACL did not land as intended';
  end if;
  if not has_function_privilege('authenticated', 'public.mark_result_document_action_completed(uuid)', 'EXECUTE') then
    raise exception 'FAIL: mark_result_document_action_completed is NOT EXECUTE-able by authenticated — grant failed';
  end if;
end $$;
