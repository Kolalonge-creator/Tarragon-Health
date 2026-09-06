-- Patient Health Record architecture review, round 3 — record reconciliation
-- on conflict (spec §1.15/§81.15: "External record -> Extract -> Match ->
-- Potential duplicate? -> Verify -> Add to record"). docs/PATIENT_HEALTH_
-- RECORD_ARCHITECTURE.md §1.22 found this genuinely MISSING: no allergy/
-- condition/medication table has a conflict-flag mechanism, and an uploaded
-- external document that contradicts existing structured data raised only a
-- generic "review needed" alert, not a conflict-aware one. Sequenced after
-- patient_documents (20260829221812) per that review's own note: "a
-- discrepancy needs two things to compare."
--
-- SCOPE: this is the "Verify" half of the spec's flow, not "Extract/Match".
-- No OCR/parsing/auto-matching engine exists anywhere on this platform (the
-- lab/ECG document pipelines are explicitly "AI drafts, never patient-
-- readable until a clinician confirms" for structured extraction — nothing
-- comparable exists for free-text document comparison), and building one is
-- far outside an additive schema pass. What's built here is the structured
-- queue a clinician uses once THEY notice a discrepancy while reviewing an
-- uploaded document against the existing record — a real, useful step up
-- from today's generic "review needed" alert, not a fully automated
-- reconciliation engine.
--
-- Deliberately clinician-flagged only (no patient insert): the spec's own
-- flow ends in "Verify", and verifying a clinical discrepancy is squarely
-- inside the "a patient should never simply edit a diagnosis" principle
-- already applied to patient_conditions (20260827195615) — this table can
-- point AT patient_conditions/patient_allergies/medications rows, so the
-- same restriction applies transitively.

do $$ begin
  if not exists (select 1 from pg_type where typname = 'record_conflict_type') then
    create type public.record_conflict_type as enum (
      'contradicts_existing', 'possible_duplicate', 'unreconciled_new_information'
    );
  end if;
  if not exists (select 1 from pg_type where typname = 'record_conflict_status') then
    create type public.record_conflict_status as enum (
      'open', 'under_review',
      'resolved_kept_existing', 'resolved_updated_record', 'resolved_duplicate_merged',
      'dismissed'
    );
  end if;
end $$;

create table public.record_conflicts (
  id                    uuid primary key default gen_random_uuid(),
  organisation_id       uuid not null references public.organisations (id) on delete restrict,
  patient_id            uuid not null references public.profiles (id) on delete cascade,
  -- The uploaded external record that surfaced the discrepancy, when there
  -- is one — a conflict can also be flagged between two existing structured
  -- rows (e.g. a suspected duplicate condition) with no document involved.
  source_document_id    uuid references public.patient_documents (id) on delete set null,
  -- The existing structured record this appears to conflict with. Free-text
  -- table name (not a FK — the target varies by table) + the row id.
  conflicting_table     text,
  conflicting_record_id uuid,
  conflict_type         public.record_conflict_type not null,
  description            text not null,
  status                public.record_conflict_status not null default 'open',
  flagged_by            uuid references public.profiles (id) on delete set null,
  flagged_at            timestamptz not null default now(),
  resolved_by           uuid references public.profiles (id) on delete set null,
  resolved_at           timestamptz,
  resolution_note       text,
  clinician_alert_id    uuid references public.clinician_alerts (id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint record_conflicts_references_something check (
    source_document_id is not null or conflicting_record_id is not null
  ),
  constraint record_conflicts_resolution_consistency check (
    (status in ('resolved_kept_existing', 'resolved_updated_record', 'resolved_duplicate_merged', 'dismissed')
      and resolved_by is not null and resolved_at is not null)
    or
    (status in ('open', 'under_review') and resolved_by is null and resolved_at is null)
  )
);

create index record_conflicts_patient_idx on public.record_conflicts (patient_id, created_at desc);
create index record_conflicts_org_idx on public.record_conflicts (organisation_id);
create index record_conflicts_open_idx on public.record_conflicts (organisation_id, created_at)
  where status in ('open', 'under_review');
create index record_conflicts_document_idx on public.record_conflicts (source_document_id);
create index record_conflicts_target_idx on public.record_conflicts (conflicting_table, conflicting_record_id);

create trigger record_conflicts_set_updated_at
  before update on public.record_conflicts
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS — org staff flag and resolve; patient reads their own (visibility that
-- something in their record is under review), never writes.
-- ---------------------------------------------------------------------------
alter table public.record_conflicts enable row level security;

create policy record_conflicts_select on public.record_conflicts
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

create policy record_conflicts_insert on public.record_conflicts
  for insert to authenticated
  with check (private.is_org_staff(organisation_id));

create policy record_conflicts_update on public.record_conflicts
  for update to authenticated
  using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));

grant select, insert, update on public.record_conflicts to authenticated;
revoke delete on public.record_conflicts from authenticated;
revoke all on public.record_conflicts from anon;

-- ---------------------------------------------------------------------------
-- BEFORE INSERT: derive flagged_by, raise a clinician_review alert so this
-- surfaces on the same worklist as any other review-needed item.
-- ---------------------------------------------------------------------------
create or replace function private.handle_record_conflict_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_alert_id uuid;
begin
  new.flagged_by := coalesce((select auth.uid()), new.flagged_by);
  new.flagged_at := now();
  new.status := 'open';
  new.resolved_by := null;
  new.resolved_at := null;
  new.resolution_note := null;

  insert into public.clinician_alerts
    (organisation_id, patient_id, level, status, title, detail, escalation_level)
  values (
    new.organisation_id,
    new.patient_id,
    'clinician_review',
    'open',
    'Record conflict flagged — verification needed',
    format('%s: %s', new.conflict_type, new.description),
    2
  )
  returning id into v_alert_id;

  new.clinician_alert_id := v_alert_id;

  insert into public.audit_log
    (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (
    new.organisation_id, new.flagged_by, 'record_conflict.flagged',
    'record_conflicts', new.id,
    jsonb_build_object('conflict_type', new.conflict_type::text, 'conflicting_table', new.conflicting_table)
  );

  return new;
end;
$$;

create trigger record_conflicts_on_insert
  before insert on public.record_conflicts
  for each row execute function private.handle_record_conflict_insert();

-- ---------------------------------------------------------------------------
-- BEFORE UPDATE: creation facts immutable; server-derive resolution stamp
-- on the transition into a terminal status. Once resolved, frozen — a
-- mis-resolved conflict gets reopened as status = 'under_review' by staff
-- (allowed, since the resolution-consistency CHECK only fires on terminal
-- statuses) rather than silently rewritten in place.
-- ---------------------------------------------------------------------------
create or replace function private.enforce_record_conflict_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.organisation_id    := old.organisation_id;
  new.patient_id         := old.patient_id;
  new.source_document_id := old.source_document_id;
  new.flagged_by         := old.flagged_by;
  new.flagged_at         := old.flagged_at;
  new.clinician_alert_id := old.clinician_alert_id;
  new.created_at          := old.created_at;

  if new.status in ('resolved_kept_existing', 'resolved_updated_record', 'resolved_duplicate_merged', 'dismissed') then
    if old.status in ('open', 'under_review') then
      new.resolved_by := coalesce((select auth.uid()), new.resolved_by);
      new.resolved_at := now();
    else
      -- Already resolved/dismissed, moving to another terminal status
      -- (or re-saved as the same one): the original resolution is frozen.
      new.resolved_by := old.resolved_by;
      new.resolved_at := old.resolved_at;
      new.resolution_note := old.resolution_note;
    end if;
  else
    -- new.status is 'open' or 'under_review' — never leave a stamp behind,
    -- both to satisfy the resolution-consistency CHECK and because a
    -- reopened conflict has no resolution yet.
    new.resolved_by := null;
    new.resolved_at := null;
  end if;

  return new;
end;
$$;

create trigger record_conflicts_update_guard
  before update on public.record_conflicts
  for each row execute function private.enforce_record_conflict_update();

-- ---------------------------------------------------------------------------
-- Timeline: flagged on insert, resolved on the transition into a terminal
-- status.
-- ---------------------------------------------------------------------------
create or replace function private.timeline_from_record_conflict()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform private.record_timeline_event(
      new.organisation_id, new.patient_id, 'record_conflict_flagged',
      'record_conflicts', new.id,
      'Possible record conflict flagged',
      new.description,
      new.flagged_at,
      private.timeline_staff_from_profile(new.flagged_by, new.organisation_id),
      jsonb_build_object('conflict_type', new.conflict_type)
    );
  elsif tg_op = 'UPDATE' and new.resolved_at is not null and old.resolved_at is null then
    perform private.record_timeline_event(
      new.organisation_id, new.patient_id, 'record_conflict_resolved',
      'record_conflicts', new.id,
      'Record conflict resolved',
      coalesce(nullif(new.resolution_note, ''), replace(new.status::text, '_', ' ')),
      new.resolved_at,
      private.timeline_staff_from_profile(new.resolved_by, new.organisation_id),
      jsonb_build_object('status', new.status)
    );
  end if;
  return new;
end;
$$;

create trigger record_conflicts_timeline_insert
  after insert on public.record_conflicts
  for each row execute function private.timeline_from_record_conflict();

create trigger record_conflicts_timeline_resolve
  after update of status on public.record_conflicts
  for each row execute function private.timeline_from_record_conflict();

-- ---------------------------------------------------------------------------
-- Attach the two existing generic clinical-core triggers directly.
-- ---------------------------------------------------------------------------
create trigger audit_row_change_trg
  after insert or update or delete on public.record_conflicts
  for each row execute function private.audit_row_change();

create trigger capture_record_correction_trg
  after update or delete on public.record_conflicts
  for each row execute function private.capture_record_correction();

-- ---------------------------------------------------------------------------
-- Assertions
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'record_conflicts') then
    raise exception 'FAIL: record_conflicts table was not created';
  end if;

  if not exists (
    select 1 from pg_trigger tg join pg_class c on c.oid = tg.tgrelid
    where c.relname = 'record_conflicts' and tg.tgname = 'audit_row_change_trg' and not tg.tgisinternal
  ) then
    raise exception 'FAIL: record_conflicts is missing audit_row_change_trg';
  end if;

  if not exists (
    select 1 from pg_trigger tg join pg_class c on c.oid = tg.tgrelid
    where c.relname = 'record_conflicts' and tg.tgname = 'capture_record_correction_trg' and not tg.tgisinternal
  ) then
    raise exception 'FAIL: record_conflicts is missing capture_record_correction_trg';
  end if;

  raise notice 'PASS: record_conflicts_reconciliation — table, RLS, alert, timeline, and audit wiring installed';
end $$;
