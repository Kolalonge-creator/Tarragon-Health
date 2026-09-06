-- Tarragon Health — fix a real logic bug caught by testing, not production.
--
-- private.enforce_lab_result_document_update (just applied for the first
-- time this session, see 20260828002130) has two blocks that both touch
-- next_steps: the interpretation_sent_at block's "else" branch unconditionally
-- wiped next_steps to null (a leftover from when next_steps was only ever
-- the patient-facing interpretation's own field, before this same migration
-- repurposed it as a dual-purpose "action required" signal too), and it runs
-- BEFORE the acknowledgement_status block that reads next_steps to decide
-- reviewed vs action_required. The result: acknowledgement_status could
-- never actually reach 'action_required' through any real call path — a
-- smoke test setting reviewed_at + next_steps together (exactly the
-- documented "Action required" flow) landed on 'reviewed' instead every
-- time. This plausibly explains why the whole migration was never actually
-- deployed despite being fully written and committed.
--
-- Fix: the interpretation_sent_at "else" branch now only clears
-- patient_interpretation (the actual draft text that shouldn't linger
-- unsent); next_steps is left for the acknowledgement_status block below it
-- to read and for a completed review to keep, matching the migration's own
-- documented mapping ("Action required -> reviewed_at goes non-null WITH a
-- non-empty next_steps").

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

  return new;
end;
$$;

do $$
declare
  v_def text;
begin
  select pg_get_functiondef(oid) into v_def
  from pg_proc where proname = 'enforce_lab_result_document_update' and pronamespace = 'private'::regnamespace;
  if v_def like '%new.next_steps             := null;%' then
    raise exception 'FAIL: the next_steps wipe bug is still present';
  end if;
  raise notice 'PASS: enforce_lab_result_document_update no longer wipes next_steps before acknowledgement_status can read it';
end $$;
