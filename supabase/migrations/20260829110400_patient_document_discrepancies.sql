-- Tarragon Health — closes (partially — see the header note) §1.22 "Record
-- reconciliation on conflict", named in docs/PATIENT_HEALTH_RECORD_ARCHITECTURE.md
-- as blocked on §1.21's generic document table existing first ("a discrepancy
-- needs two things to compare"). §1.21 shipped 2026-08-29
-- (20260829093304_patient_documents_core.sql onward); this is the follow-up.
--
-- SCOPE: this is a CLINICIAN-FLAGGED discrepancy register, not an automated
-- NLP/structured-extraction conflict detector. §1.22's own gap analysis found
-- no existing table anywhere on the platform with a conflict-flag or
-- reconciliation-queue mechanism for allergies/conditions/medications —
-- building automated detection (comparing OCR-extracted document content
-- against structured clinical rows) is a substantially larger, separate
-- piece of work with real false-positive/false-negative risk in a clinical-
-- safety context, and is deliberately NOT attempted here. What this migration
-- gives the platform is the missing STRUCTURE: a real place for a clinician
-- who spots "this discharge summary says penicillin allergy, but there is no
-- allergy on file" to record that fact, route it for resolution, and have
-- both the conflicting document and the eventual resolution stay traceable —
-- which is what "a discrepancy needs two things to compare" was actually
-- blocked on. Wiring an OCR/AI detector into this table is a real future
-- step, not this one.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'document_discrepancy_status') then
    create type public.document_discrepancy_status as enum (
      'open',
      'document_confirmed_correct',   -- the existing structured record was wrong; update it separately
      'existing_confirmed_correct',   -- the document was wrong/outdated; no change to the record
      'both_valid',                   -- not actually a conflict (e.g. two real, non-contradictory facts)
      'dismissed'                     -- flagged in error
    );
  end if;
end $$;

create table if not exists public.patient_document_discrepancies (
  id                     uuid primary key default gen_random_uuid(),
  organisation_id        uuid not null references public.organisations (id) on delete restrict,
  patient_id             uuid not null references public.profiles (id) on delete cascade,
  -- The document that surfaced the conflict — always required; a discrepancy
  -- with no document behind it is a data-quality issue, not this feature.
  document_id            uuid not null references public.patient_documents (id) on delete restrict,
  -- The table/row the document disagrees with. Free-text table name rather
  -- than a typed FK union, matching the platform's existing source_table/
  -- source_id read-time-link convention (patient_timeline, patient_documents
  -- itself) — this register spans an open-ended set of clinical tables
  -- (allergies, medications, patient_conditions, …), not one fixed schema.
  -- Nullable: "the document states a fact with nothing on file to compare
  -- against" (a missing record) is itself a real discrepancy shape.
  conflicting_table      text,
  conflicting_record_id  uuid,
  -- What specifically conflicts, in the clinician's own words — this is a
  -- human judgment call, not a machine diff, so it is captured as text, not
  -- reconstructed from column values.
  field_description      text not null check (length(btrim(field_description)) > 0),
  existing_value         text,
  document_value         text,
  status                 public.document_discrepancy_status not null default 'open',
  -- Flagging a clinical discrepancy is itself a clinical judgment call (the
  -- same class of act as reviewing a document) — server-derived, never
  -- client-trusted, same as reviewed_by everywhere else on the platform.
  flagged_by             uuid not null references public.profiles (id) on delete restrict,
  flagged_at             timestamptz not null default now(),
  resolution_note        text,
  resolved_by            uuid references public.profiles (id) on delete set null,
  resolved_at            timestamptz,
  -- Set once, by the same insert that raises the flag — the discrepancy
  -- worklist and the emergency/escalation worklist are the same worklist.
  clinician_alert_id     uuid references public.clinician_alerts (id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint patient_document_discrepancies_resolution_requires_note check (
    status = 'open' or resolution_note is not null
  )
);

create index if not exists patient_document_discrepancies_patient_idx
  on public.patient_document_discrepancies (patient_id, flagged_at desc);
create index if not exists patient_document_discrepancies_org_idx
  on public.patient_document_discrepancies (organisation_id, flagged_at desc);
create index if not exists patient_document_discrepancies_document_idx
  on public.patient_document_discrepancies (document_id);
-- Worklist: open discrepancies nobody has resolved yet.
create index if not exists patient_document_discrepancies_open_idx
  on public.patient_document_discrepancies (organisation_id, flagged_at)
  where status = 'open';

drop trigger if exists patient_document_discrepancies_set_updated_at on public.patient_document_discrepancies;
create trigger patient_document_discrepancies_set_updated_at
  before update on public.patient_document_discrepancies
  for each row execute function private.set_updated_at();

comment on table public.patient_document_discrepancies is
  '§1.22. A clinician-flagged conflict between an uploaded document and the patient''s existing structured record (or the absence of one). Not an automated detector — see the migration header. Written only via public.flag_patient_document_discrepancy / public.resolve_patient_document_discrepancy, never a raw client insert of a resolution.';

alter table public.patient_document_discrepancies enable row level security;

-- Patient sees their own discrepancies — the same transparency the rest of
-- this module gives a patient about their own record (they can see a
-- document was flagged as conflicting, even though only staff can flag one).
drop policy if exists patient_document_discrepancies_select on public.patient_document_discrepancies;
create policy patient_document_discrepancies_select on public.patient_document_discrepancies
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

-- Deliberately broad at the RLS level (any org staff may insert) — same
-- reasoning as lab_result_documents' own INSERT policy: the Care Coordinator
-- non-clinical write guardrail (flagging/resolving a clinical discrepancy is
-- a clinical judgment call a Care Coordinator should not make) is enforced at
-- the app/server-action layer, matching the platform's standing pattern,
-- rather than a new RLS helper.
drop policy if exists patient_document_discrepancies_insert on public.patient_document_discrepancies;
create policy patient_document_discrepancies_insert on public.patient_document_discrepancies
  for insert to authenticated
  with check (private.is_org_staff(organisation_id));

drop policy if exists patient_document_discrepancies_update on public.patient_document_discrepancies;
create policy patient_document_discrepancies_update on public.patient_document_discrepancies
  for update to authenticated
  using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));

grant select, insert, update on public.patient_document_discrepancies to authenticated;

-- Resolution attribution + immutability, same freeze shape as every other
-- reviewed_by/resolved_by column on the platform: everything about the
-- ORIGINAL flag is frozen; only the resolution fields may move, exactly once.
create or replace function private.enforce_patient_document_discrepancy_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.organisation_id       := old.organisation_id;
  new.patient_id            := old.patient_id;
  new.document_id           := old.document_id;
  new.conflicting_table     := old.conflicting_table;
  new.conflicting_record_id := old.conflicting_record_id;
  new.field_description     := old.field_description;
  new.existing_value        := old.existing_value;
  new.document_value        := old.document_value;
  new.flagged_by            := old.flagged_by;
  new.flagged_at            := old.flagged_at;
  new.clinician_alert_id    := old.clinician_alert_id;

  if old.resolved_at is not null then
    -- Once resolved, the resolution itself is frozen — a correction is a new
    -- discrepancy row referencing the same document, not a rewritten verdict.
    new.status          := old.status;
    new.resolution_note := old.resolution_note;
    new.resolved_by     := old.resolved_by;
    new.resolved_at     := old.resolved_at;
  elsif new.status <> 'open' then
    new.resolved_by := coalesce((select auth.uid()), new.resolved_by);
    new.resolved_at := now();
  end if;

  return new;
end;
$$;

drop trigger if exists patient_document_discrepancies_update_guard on public.patient_document_discrepancies;
create trigger patient_document_discrepancies_update_guard
  before update on public.patient_document_discrepancies
  for each row execute function private.enforce_patient_document_discrepancy_update();

-- Flag a discrepancy. Raises the same clinician_alerts worklist entry every
-- other "needs a human" event on the platform uses, so a discrepancy is never
-- a record that only shows up if someone happens to query this table.
create or replace function public.flag_patient_document_discrepancy(
  p_document_id           uuid,
  p_field_description     text,
  p_existing_value        text default null,
  p_document_value        text default null,
  p_conflicting_table     text default null,
  p_conflicting_record_id uuid default null
)
returns public.patient_document_discrepancies
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_doc   public.patient_documents;
  v_actor uuid := (select auth.uid());
  v_alert_id uuid;
  v_row   public.patient_document_discrepancies;
begin
  select * into v_doc from public.patient_documents where id = p_document_id;
  if v_doc.id is null then
    raise exception 'document % not found', p_document_id;
  end if;
  if v_actor is null or not private.is_org_staff(v_doc.organisation_id) then
    raise exception 'not authorised to flag a discrepancy on document %', p_document_id;
  end if;

  insert into public.clinician_alerts
    (organisation_id, patient_id, level, status, title, detail, escalation_level)
  values (
    v_doc.organisation_id,
    v_doc.patient_id,
    'clinician_review',
    'open',
    'Document conflicts with existing record — review needed',
    format('"%s" (%s): %s', v_doc.title, p_field_description,
      case
        when p_existing_value is not null and p_document_value is not null
          then format('on file "%s", document says "%s"', p_existing_value, p_document_value)
        else coalesce(p_document_value, p_existing_value, 'see discrepancy record')
      end),
    2
  )
  returning id into v_alert_id;

  insert into public.patient_document_discrepancies (
    organisation_id, patient_id, document_id, conflicting_table, conflicting_record_id,
    field_description, existing_value, document_value, flagged_by, clinician_alert_id
  )
  values (
    v_doc.organisation_id, v_doc.patient_id, p_document_id, p_conflicting_table, p_conflicting_record_id,
    p_field_description, p_existing_value, p_document_value, v_actor, v_alert_id
  )
  returning * into v_row;

  return v_row;
end;
$$;

comment on function public.flag_patient_document_discrepancy(uuid, text, text, text, text, uuid) is
  '§1.22. The only way to create a discrepancy row — always raises a matching clinician_alerts entry in the same call. Requires an authenticated org-staff session (never a service-role/automated call in this pass — see the migration header on scope).';

create or replace function public.resolve_patient_document_discrepancy(
  p_discrepancy_id uuid,
  p_status         public.document_discrepancy_status,
  p_resolution_note text
)
returns public.patient_document_discrepancies
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.patient_document_discrepancies;
begin
  if p_status = 'open' then
    raise exception 'resolve_patient_document_discrepancy cannot resolve to open';
  end if;
  if p_resolution_note is null or length(btrim(p_resolution_note)) = 0 then
    raise exception 'resolve_patient_document_discrepancy requires a resolution note';
  end if;

  select * into v_row from public.patient_document_discrepancies where id = p_discrepancy_id;
  if v_row.id is null then
    raise exception 'discrepancy % not found', p_discrepancy_id;
  end if;
  if v_row.resolved_at is not null then
    raise exception 'discrepancy % is already resolved', p_discrepancy_id;
  end if;
  if not private.is_org_staff(v_row.organisation_id) then
    raise exception 'not authorised to resolve discrepancy %', p_discrepancy_id;
  end if;

  update public.patient_document_discrepancies
    set status = p_status, resolution_note = p_resolution_note
    where id = p_discrepancy_id
    returning * into v_row;

  return v_row;
end;
$$;

comment on function public.resolve_patient_document_discrepancy(uuid, public.document_discrepancy_status, text) is
  '§1.22. Resolution is one-shot and requires a note — see enforce_patient_document_discrepancy_update for the freeze that makes it permanent.';

revoke execute on function public.flag_patient_document_discrepancy(uuid, text, text, text, text, uuid) from public;
revoke execute on function public.flag_patient_document_discrepancy(uuid, text, text, text, text, uuid) from anon;
grant execute on function public.flag_patient_document_discrepancy(uuid, text, text, text, text, uuid) to authenticated;

revoke execute on function public.resolve_patient_document_discrepancy(uuid, public.document_discrepancy_status, text) from public;
revoke execute on function public.resolve_patient_document_discrepancy(uuid, public.document_discrepancy_status, text) from anon;
grant execute on function public.resolve_patient_document_discrepancy(uuid, public.document_discrepancy_status, text) to authenticated;
