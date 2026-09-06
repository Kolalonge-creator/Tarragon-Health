-- Diagnostic Ordering & Investigation Management (module 57) — closing the
-- real gaps against the already-mature lab_orders/panel_bundles/
-- lab_result_documents foundation (care_coordination.sql onward), not
-- rebuilding it.
--
-- WHAT THIS ADDS, additively, onto existing tables:
--   1. urgency (57.5) + clinical_indication (57.3) on lab_orders. Urgency is a
--      genuinely new column; clinical_indication is required only for a
--      clinician-generated order (private.enforce_lab_order_origin's
--      non-self-service branch) — the self-service due-screening path's
--      indication is already implicit in the screening_schedule it's linked to.
--   2. preparation_instructions (57.9) on panel_bundles — the catalogue, not
--      the order, since it's a fact about the test/bundle. Seeded only for the
--      two bundles where fasting is an unambiguous, well-established clinical
--      fact (a fasting lipid panel, a fasting glucose test) — every other
--      bundle is left null rather than guessed.
--   3. An unmatched-results index + amendment/supersede columns on
--      lab_result_documents (57.12/57.13/57.14). Matching a document to its
--      lab_order was already a plain, staff-permitted UPDATE of the existing
--      nullable lab_order_id column (confirmed live: no RLS or trigger change
--      needed there) — the real gap was surfacing "which documents have no
--      order yet" as a worklist, and having no way at all to record that one
--      uploaded report corrects an earlier one while keeping the original
--      traceable. Duplicate-investigation CDS (57.7/57.8) is deliberately NOT
--      a DB change — apps/web/src/lib/rules/drug-safety.ts is this codebase's
--      established pattern for advisory clinical checks (pure app-layer
--      function, never a DB trigger), and the new lab-order-safety.ts mirrors
--      it in the same app-layer change.
--
-- Every function below is reproduced from its CURRENT LIVE definition
-- (pg_get_functiondef, pulled fresh right before writing this migration —
-- per this file's own standing lesson that a committed migration can drift
-- from what's actually live) with new logic added, not rewritten from the
-- last-known-committed version.

-- ---------------------------------------------------------------------------
-- 1. Urgency
-- ---------------------------------------------------------------------------
create type public.lab_order_urgency as enum ('routine', 'urgent');

alter table public.lab_orders
  add column urgency public.lab_order_urgency not null default 'routine';

comment on column public.lab_orders.urgency is
  'routine (default) or urgent. Advisory triage set by the ordering clinician, not a clinical acuity score — surfaced via lab_orders_urgent_open_idx as an operational queue (module 57.5), never auto-derived.';

-- "Urgent orders should enter appropriate operational queues" (57.5): a
-- partial index is the queue — cheap to scan, and open-ended enough for
-- whichever worklist page reads it, rather than a bespoke table.
create index lab_orders_urgent_open_idx
  on public.lab_orders (organisation_id, ordered_at)
  where urgency = 'urgent' and status not in ('resulted', 'cancelled');

-- ---------------------------------------------------------------------------
-- 2. Clinical indication
-- ---------------------------------------------------------------------------
alter table public.lab_orders
  add column clinical_indication text;

comment on column public.lab_orders.clinical_indication is
  'Why this investigation was ordered (module 57.3). Required for a clinician-generated order — see private.enforce_lab_order_origin. Left null on the patient self-service due-screening path, where the linked screening_schedule already is the indication.';

create or replace function private.enforce_lab_order_origin()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_schedule public.screening_schedules%rowtype;
  v_screen_type_code text;
begin
  -- Fulfilment guard, deliberately ORTHOGONAL to origin and evaluated before
  -- the origin branching below (which early-returns for self-bookable bundles).
  -- Both a patient self-serving a Screen and a clinician ordering a test are
  -- legitimately self_arranged: what makes it self-arranged is that the patient
  -- takes it to a lab of their own choosing, not who decided it was needed.
  if new.fulfilment = 'self_arranged' then
    if new.provider_id is not null or new.facility_id is not null then
      raise exception 'A self-arranged lab order cannot name a partner provider or facility — the patient chooses their own lab'
        using errcode = '23514';
    end if;
    if coalesce(new.total_kobo, 0) <> 0 then
      raise exception 'A self-arranged lab order is not billed by Tarragon — the patient pays the lab directly (total_kobo must be 0)'
        using errcode = '23514';
    end if;
    if new.status = 'pending_payment' then
      raise exception 'A self-arranged lab order is never pending_payment — there is nothing for Tarragon to collect'
        using errcode = '23514';
    end if;
  end if;

  if new.origin = 'patient_initiated' then
    if new.ordered_by is not null then
      raise exception 'patient_initiated lab_orders cannot set ordered_by' using errcode = '23514';
    end if;

    -- Prevention front-door exception: an explicitly self-bookable bundle
    -- needs no schedule and must not carry one — the due-screening path below
    -- stays the only schedule-linked route.
    if exists (
      select 1 from public.panel_bundles pb
      where pb.id = new.panel_bundle_id
        and pb.self_bookable
    ) then
      if new.screening_schedule_id is not null then
        raise exception 'Self-bookable bundles are ordered without a screening_schedule link' using errcode = '23514';
      end if;
      return new;
    end if;

    if new.screening_schedule_id is null then
      raise exception 'Self-service lab orders must be linked to a due screening_schedule — ad hoc tests require a clinician order'
        using errcode = '23514';
    end if;

    select * into v_schedule
    from public.screening_schedules
    where id = new.screening_schedule_id;

    if v_schedule.id is null or v_schedule.patient_id is distinct from new.patient_id then
      raise exception 'screening_schedule_id does not belong to this patient' using errcode = '23514';
    end if;

    if v_schedule.status not in ('pending', 'overdue') or v_schedule.due_date > current_date then
      raise exception 'This screening is not currently due for self-service booking' using errcode = '23514';
    end if;

    select code into v_screen_type_code
    from public.screen_types
    where id = v_schedule.screen_type_id;

    if not exists (
      select 1 from public.panel_bundles pb
      where pb.id = new.panel_bundle_id
        and pb.test_codes = array[v_screen_type_code]
    ) then
      raise exception 'panel_bundle_id must be the single-test bundle matching the due screening' using errcode = '23514';
    end if;
  else
    if new.ordered_by is null then
      raise exception 'Non-self-service lab_orders must set ordered_by to the clinician who generated the order'
        using errcode = '23514';
    end if;

    if not exists (
      select 1 from public.clinical_staff cs
      where cs.id = new.ordered_by
        and cs.organisation_id = new.organisation_id
        and cs.active
    ) then
      raise exception 'ordered_by must reference an active clinical_staff member of the same organisation' using errcode = '23514';
    end if;

    -- New: module 57.3 — a clinician-generated order must record why. The
    -- self-service branch above never reaches here, so the due-screening path
    -- is untouched by this requirement.
    if new.clinical_indication is null or length(btrim(new.clinical_indication)) = 0 then
      raise exception 'Clinician-generated lab_orders must record a clinical_indication' using errcode = '23514';
    end if;
  end if;

  return new;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 3. Preparation instructions (catalogue-level — a fact about the test, not
--    the order). Seeded ONLY where fasting is unambiguous, standard clinical
--    knowledge; every other bundle stays null rather than guessed. Bundles
--    that mix a fasting-sensitive test with non-fasting ones say so
--    explicitly, so the instruction is never overread as covering the whole
--    panel.
-- ---------------------------------------------------------------------------
alter table public.panel_bundles
  add column preparation_instructions text;

comment on column public.panel_bundles.preparation_instructions is
  'Shown to the patient once an order for this bundle is placed (module 57.9). Null means no special preparation is required or known — never inferred, only ever set here from an established clinical fact, per this migration''s own header.';

update public.panel_bundles
set preparation_instructions =
  'This panel includes a lipid (cholesterol) test — fast for 9-12 hours beforehand (water is fine) for an accurate reading. The other tests in this panel do not require fasting.'
where code in ('single_lipid_panel', 'screen_core', 'diabetes_panel', 'hypertension_panel')
  and 'lipid_panel' = any (test_codes);

update public.panel_bundles
set preparation_instructions =
  'Fast for 8-12 hours before this test (water is fine) — it measures your fasting blood sugar, so eating or drinking anything but water beforehand will affect the result.'
where code = 'single_ogtt_fpg';

-- ---------------------------------------------------------------------------
-- 4. Result matching worklist + amendment/supersede (57.12/57.13/57.14)
-- ---------------------------------------------------------------------------
-- "Send to a reconciliation queue" (57.13): the queue is this partial index —
-- lab_order_id was already nullable and already a plain staff-permitted
-- UPDATE (verified against the live lab_result_documents_update policy and
-- private.enforce_lab_result_document_update, which never locks lab_order_id).
-- No column changes needed there; this makes the worklist cheap to query.
create index lab_result_documents_unmatched_idx
  on public.lab_result_documents (organisation_id, created_at)
  where lab_order_id is null;

alter table public.lab_result_documents
  add column supersedes_document_id uuid references public.lab_result_documents (id) on delete set null,
  add column superseded_by_document_id uuid references public.lab_result_documents (id) on delete set null,
  add column superseded_at timestamptz;

comment on column public.lab_result_documents.supersedes_document_id is
  'Set by org staff, after both documents exist, when this one is a corrected/amended report for an earlier one (module 57.14). private.enforce_lab_result_document_update stamps the referenced document''s superseded_by_document_id/superseded_at automatically.';
comment on column public.lab_result_documents.superseded_by_document_id is
  'Which later document corrected this one, if any. A pointer, never a delete — the original stays fully visible and traceable.';
comment on column public.lab_result_documents.superseded_at is
  'Paired with superseded_by_document_id.';

create index lab_result_documents_supersedes_idx
  on public.lab_result_documents (supersedes_document_id) where supersedes_document_id is not null;

create or replace function private.enforce_lab_result_document_update()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
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

  -- New: amendment linkage (module 57.14). A later document names an
  -- earlier one it corrects. Only ever moves null -> a document id, or back
  -- to null to undo a mistaken link — never repointed directly from one
  -- document to another in the same statement, so a correction can't be
  -- silently redirected without first clearing it. The nested UPDATE below
  -- re-fires this same trigger on the referenced row (BEFORE UPDATE triggers
  -- apply to any UPDATE on the table, including one issued from here); that
  -- recursive call's own supersedes_document_id is unchanged, so it takes
  -- none of the branches above and none of this one — no infinite loop.
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

-- ---------------------------------------------------------------------------
-- 5. The migration is the test.
-- ---------------------------------------------------------------------------
do $$
declare
  v_origin_def text;
  v_update_def text;
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'lab_orders' and column_name = 'urgency'
  ) then
    raise exception 'lab_orders.urgency was not created';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'lab_orders' and column_name = 'clinical_indication'
  ) then
    raise exception 'lab_orders.clinical_indication was not created';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'panel_bundles' and column_name = 'preparation_instructions'
  ) then
    raise exception 'panel_bundles.preparation_instructions was not created';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'lab_result_documents' and column_name = 'supersedes_document_id'
  ) then
    raise exception 'lab_result_documents.supersedes_document_id was not created';
  end if;

  select pg_get_functiondef(oid) into v_origin_def
  from pg_proc where proname = 'enforce_lab_order_origin' and pronamespace = 'private'::regnamespace;
  if v_origin_def not like '%Clinician-generated lab_orders must record a clinical_indication%' then
    raise exception 'enforce_lab_order_origin is missing the clinical_indication guard';
  end if;
  -- Every pre-existing branch must survive the rewrite.
  if v_origin_def not like '%self-arranged lab order cannot name a partner%'
     or v_origin_def not like '%ad hoc tests require a clinician order%'
     or v_origin_def not like '%must reference an active clinical_staff member%' then
    raise exception 'enforce_lab_order_origin lost a pre-existing branch';
  end if;

  select pg_get_functiondef(oid) into v_update_def
  from pg_proc where proname = 'enforce_lab_result_document_update' and pronamespace = 'private'::regnamespace;
  if v_update_def not like '%A document cannot supersede itself%' then
    raise exception 'enforce_lab_result_document_update is missing the supersede guard';
  end if;
  if v_update_def not like '%Once reviewed, the attribution is frozen%'
     or v_update_def not like '%Only a document in action_required can be marked action_completed%' then
    raise exception 'enforce_lab_result_document_update lost a pre-existing branch';
  end if;

  -- Prep instructions were seeded, not left to guesswork on every bundle.
  if not exists (
    select 1 from public.panel_bundles where code = 'single_lipid_panel' and preparation_instructions is not null
  ) then
    raise exception 'single_lipid_panel preparation_instructions was not seeded';
  end if;
  if exists (
    select 1 from public.panel_bundles where code = 'single_fbc' and preparation_instructions is not null
  ) then
    raise exception 'a non-fasting bundle (single_fbc) unexpectedly got preparation_instructions';
  end if;
end $$;
