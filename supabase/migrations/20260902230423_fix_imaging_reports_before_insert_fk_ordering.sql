-- Tarragon Health — fix a live bug that made EVERY imaging_reports INSERT
-- fail, unconditionally, since the Imaging & Diagnostic Procedure Platform
-- shipped (20260902220000_imaging_reports.sql, PR #324).
--
-- ROOT CAUSE. private.handle_imaging_report_abnormal_pathway() ran as a
-- BEFORE INSERT trigger on imaging_reports, and inside it inserted a
-- clinician_alerts row referencing `new.id`:
--
--   insert into public.clinician_alerts (..., imaging_report_id) values (..., new.id)
--
-- new.id already has a value at that point (the gen_random_uuid() column
-- default resolves before BEFORE triggers run), but the imaging_reports row
-- itself has NOT been written to the table yet -- that only happens after
-- every BEFORE trigger returns. clinician_alerts.imaging_report_id is a
-- plain (non-deferrable, confirmed live via pg_constraint) foreign key to
-- imaging_reports(id), so this insert unconditionally failed with
-- "insert or update on table clinician_alerts violates foreign key
-- constraint... Key (imaging_report_id)=(...) is not present in table
-- imaging_reports". Found while adapting
-- packages/db/tests/patient_health_record_round3.sql to the new schema --
-- every insert this session attempted hit it, with no code path around it.
--
-- FIX. Split the one BEFORE INSERT trigger into two:
--   - private.derive_imaging_report_upload_fields() stays BEFORE INSERT --
--     only the NEW-column mutations that must happen before the row is
--     written (uploaded_by, nulling reviewed_by/reviewed_at) plus the
--     imaging_orders existence/org/patient validation, which still needs to
--     run before the row is written so a bad reference blocks the insert
--     entirely (an exception raised here, same as before, aborts the whole
--     statement).
--   - private.raise_imaging_report_abnormal_pathway() is now AFTER INSERT --
--     everything that references the now-real imaging_reports row: the
--     clinician_alerts insert (imaging_report_id now valid), the parent
--     order's status advance, the patient notification, and the audit_log
--     entry. Computes the same level/escalation/SLA mapping from NEW
--     (available, just not mutable, in an AFTER trigger) as before.
--
-- Setting imaging_reports.clinician_alert_id now happens via a real UPDATE
-- from the AFTER trigger rather than a NEW-mutation (AFTER triggers can't
-- mutate NEW). That UPDATE itself fires imaging_reports_update_guard
-- (enforce_imaging_report_update, BEFORE UPDATE), which unconditionally
-- froze clinician_alert_id back to old.clinician_alert_id (null, right
-- after insert) -- so the guard is relaxed to freeze it only once already
-- set, the same "freeze after first set" shape already used for
-- reviewed_at/reviewed_by two branches down in the same function.
--
-- Checked application code (apps/web/src/lib/imaging-reports/actions.ts):
-- the insert only ever `.select("id")`s, never clinician_alert_id, and every
-- later read of clinician_alert_id is a separate subsequent query -- so
-- deferring it to an AFTER trigger changes nothing observable, it just
-- makes the insert possible at all.

create or replace function private.derive_imaging_report_upload_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order_org     uuid;
  v_order_patient uuid;
begin
  select organisation_id, patient_id into v_order_org, v_order_patient
  from public.imaging_orders where id = new.imaging_order_id;

  if v_order_org is null then
    raise exception 'imaging_orders row % not found', new.imaging_order_id;
  end if;
  if v_order_org <> new.organisation_id or v_order_patient <> new.patient_id then
    raise exception 'imaging_reports.organisation_id/patient_id must match the referenced imaging_orders row';
  end if;

  if new.uploaded_by is null then
    new.uploaded_by := (select auth.uid());
  end if;
  new.reviewed_by := null;
  new.reviewed_at := null;

  return new;
end;
$$;

comment on function private.derive_imaging_report_upload_fields() is
  'BEFORE INSERT half of the imaging-report pathway: validates the referenced imaging_orders row and derives NEW-column values that must be set before the row is written. Split from the original private.handle_imaging_report_abnormal_pathway() 2026-09-02 -- see 20260902230423_fix_imaging_reports_before_insert_fk_ordering.sql -- because the clinician_alerts insert half needs the row to already exist (its imaging_report_id FK), which only the AFTER-trigger half (private.raise_imaging_report_abnormal_pathway) can guarantee.';

create or replace function private.raise_imaging_report_abnormal_pathway()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_alert_id  uuid;
  v_level     public.alert_level;
  v_esc_level smallint;
  v_sla       interval;
begin
  if not new.is_abnormal then
    v_level := 'routine'; v_esc_level := 1; v_sla := null;
  elsif new.urgency = 'critical' then
    v_level := 'emergency'; v_esc_level := 4; v_sla := interval '2 hours';
  elsif new.urgency = 'urgent' then
    v_level := 'urgent_escalation'; v_esc_level := 3; v_sla := interval '24 hours';
  else
    v_level := 'clinician_review'; v_esc_level := 2; v_sla := null;
  end if;

  insert into public.clinician_alerts
    (organisation_id, patient_id, level, status, title, detail, category, type_code,
     escalation_level, sla_due_at, imaging_report_id)
  values (
    new.organisation_id, new.patient_id, v_level, 'open',
    case when new.is_abnormal
      then format('Abnormal imaging finding — %s %s', new.modality::text, new.body_region)
      else format('Imaging report filed — %s %s (review needed)', new.modality::text, new.body_region)
    end,
    format('%s%s', new.impression, case when new.is_abnormal then ' Requires clinician review and patient follow-up per the abnormal-imaging pathway.' else '' end),
    'clinical', 'abnormal_result', v_esc_level,
    case when v_sla is not null then now() + v_sla else null end,
    new.id
  )
  returning id into v_alert_id;

  update public.imaging_reports
  set clinician_alert_id = v_alert_id
  where id = new.id;

  update public.imaging_orders
  set status = 'reported'
  where id = new.imaging_order_id and status not in ('reported', 'result_returned', 'reviewed', 'cancelled');

  insert into public.notifications (organisation_id, recipient_id, channel, template, payload)
  values
    (new.organisation_id, new.patient_id, 'whatsapp', 'result_document_available', jsonb_build_object('source', 'imaging_report')),
    (new.organisation_id, new.patient_id, 'email', 'result_document_available', jsonb_build_object('source', 'imaging_report'));

  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (
    new.organisation_id, new.uploaded_by, 'imaging_report.filed', 'imaging_reports', new.id,
    jsonb_build_object('is_abnormal', new.is_abnormal, 'urgency', new.urgency::text, 'clinician_alert_id', v_alert_id)
  );

  return null;
end;
$$;

comment on function private.raise_imaging_report_abnormal_pathway() is
  'AFTER INSERT half of the imaging-report pathway (spec §59.10/§59.13): raises the clinician_alerts row, advances the parent order to reported, notifies the patient, and audit-logs -- everything that needs the imaging_reports row to already exist. Split from private.handle_imaging_report_abnormal_pathway() 2026-09-02, see this migration''s header.';

drop trigger if exists imaging_reports_on_insert on public.imaging_reports;
create trigger imaging_reports_before_insert
  before insert on public.imaging_reports
  for each row execute function private.derive_imaging_report_upload_fields();
create trigger imaging_reports_after_insert
  after insert on public.imaging_reports
  for each row execute function private.raise_imaging_report_abnormal_pathway();

drop function if exists private.handle_imaging_report_abnormal_pathway();

-- ---------------------------------------------------------------------------
-- Relax the update guard: clinician_alert_id freezes only once it's actually
-- set, so the AFTER-insert trigger's own backfill UPDATE (null -> alert id)
-- isn't immediately reverted by this same guard.
-- ---------------------------------------------------------------------------
create or replace function private.enforce_imaging_report_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.organisation_id  := old.organisation_id;
  new.patient_id       := old.patient_id;
  new.imaging_order_id := old.imaging_order_id;
  new.source           := old.source;
  new.uploaded_by      := old.uploaded_by;
  new.created_at        := old.created_at;

  if old.clinician_alert_id is not null then
    new.clinician_alert_id := old.clinician_alert_id;
  end if;

  if new.reviewed_at is not null and old.reviewed_at is null then
    new.reviewed_by := coalesce((select auth.uid()), new.reviewed_by);
    new.reviewed_at := now();
  elsif old.reviewed_at is not null then
    new.reviewed_by := old.reviewed_by;
    new.reviewed_at := old.reviewed_at;
  end if;

  return new;
end;
$$;

comment on function private.enforce_imaging_report_update() is
  'BEFORE UPDATE guard on imaging_reports: freezes filing-time facts and the review stamp exactly as before, plus (2026-09-02) clinician_alert_id -- but only once it is already set, so the AFTER-insert trigger''s one-time null-to-value backfill is not immediately reverted by this same guard. See 20260902230423_fix_imaging_reports_before_insert_fk_ordering.sql.';

-- ===========================================================================
-- Self-assertions. A full end-to-end insert-through-the-real-trigger proof
-- (provider -> study -> order -> report, confirming clinician_alert_id gets
-- backfilled) lives in packages/db/tests/patient_health_record_round3.sql,
-- run separately and non-destructively (begin/rollback) rather than as
-- real, undeletable rows written by this migration itself.
-- ===========================================================================
do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.imaging_reports'::regclass
      and tgname = 'imaging_reports_before_insert' and not tgisinternal
  ) then
    raise exception 'imaging_reports_before_insert trigger was not created';
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.imaging_reports'::regclass
      and tgname = 'imaging_reports_after_insert' and not tgisinternal
  ) then
    raise exception 'imaging_reports_after_insert trigger was not created';
  end if;
  if exists (
    select 1 from pg_trigger
    where tgrelid = 'public.imaging_reports'::regclass
      and tgname = 'imaging_reports_on_insert' and not tgisinternal
  ) then
    raise exception 'FAIL: the old single imaging_reports_on_insert trigger is still present';
  end if;
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = 'handle_imaging_report_abnormal_pathway'
  ) then
    raise exception 'FAIL: private.handle_imaging_report_abnormal_pathway was not dropped';
  end if;

  -- The AFTER trigger's clinician_alerts insert (referencing new.id) can
  -- only be correct if it fires AFTER, not BEFORE.
  if not exists (
    select 1 from pg_trigger t
    where t.tgrelid = 'public.imaging_reports'::regclass
      and t.tgname = 'imaging_reports_after_insert'
      and (t.tgtype & 2) = 0 -- bit 2 (TRIGGER_TYPE_BEFORE) must be unset -> AFTER
  ) then
    raise exception 'FAIL: imaging_reports_after_insert is not actually an AFTER trigger';
  end if;

  raise notice 'PASS: imaging_reports insert pathway split into BEFORE (validate/derive) and AFTER (alert/order/notify/audit) triggers; old single trigger and function removed';
end $$;
