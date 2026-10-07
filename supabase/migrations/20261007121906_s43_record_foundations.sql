-- S43 part 1 of 3: the health record foundations (spec Module 2: 2.1 timeline trust tier, 2.2 history, 2.3 photo capture, 2.4 symptom journal).
-- Design: docs/design/S43.md. Not applied to production by the session that wrote it.
--
-- Counted first (live, read-only, 2026-10-07): patient_documents 0 rows, family_history 0 rows, patient_timeline 13 rows (escalations 1,
-- care_messages 5, medications 6, pharmacy_order_dispenses 1), symptoms 1, vaccination_records 0. No `procedures` table exists. S09 (vitals and
-- prescription timeline triggers, record_shares) is ALREADY APPLIED to production (versions 20261005185500 and 20261005185600), contrary to the plan
-- document, so nothing here depends on an unapplied migration.
--
-- What this does:
--   1. Event types for the bus: document.uploaded, document.ocr_suggested, immunisation.recorded, share_link.accessed (ids only in payloads, INV-07/10).
--   2. Timeline: a `trust_tier` on every item (lab_pushed, clinician, device, patient, ocr_unconfirmed, ocr_confirmed, imported, system), set by a BEFORE
--      INSERT trigger and backfilled; two new event types (symptom_logged, procedure_recorded) and their triggers.
--   3. patient_documents: ocr_text, ocr_state, extracted jsonb (suggestions only). The OCR columns change only through SECURITY DEFINER functions
--      (suggestion: service role; confirm and reject: the patient). A rejected suggestion leaves NO text and NO values behind (the original photo stays).
--      Nothing outside this module reads `extracted` or `ocr_text`: an unconfirmed value can never reach escalation, risk or the clinical record.
--   4. procedures (new) and family_history upgrades: verified_by_clinician, tombstones (removed_at), patient-sourced rows cannot claim a clinician
--      source or a verification. Staff read both through an audited function (INV-10, INV-12).
--   5. symptoms.assessment_id (link to a checker session) and patient_symptom_journal() (the journal with its triage grade and session).
--   6. AI-018 (document capture reading) registered DISABLED (draft, not runtime_governed: it earns the flag after the call site is deployed and evaluated), and the go-live guard document_capture_enabled is OFF.

-- ---------------------------------------------------------------------------
-- 1. Bus event types
-- ---------------------------------------------------------------------------
insert into public.event_types (event_type, description, owner_section, is_urgent) values
  ('document.uploaded',      'A health document photo or file was added to the record', 'S43', false),
  ('document.ocr_suggested', 'Values were read from a document and wait for the patient to confirm them', 'S43', false),
  ('immunisation.recorded',  'A vaccination dose was added to a record', 'S43', false),
  ('share_link.accessed',    'A shared record link was opened', 'S43', false)
on conflict (event_type) do nothing;

insert into public.event_type_versions (event_type, version, required_keys) values
  ('document.uploaded',      1, array['document_id']),
  ('document.ocr_suggested', 1, array['document_id']),
  ('immunisation.recorded',  1, array['vaccination_record_id']),
  ('share_link.accessed',    1, array['share_id'])
on conflict (event_type, version) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Timeline: trust tier, two new event types
-- ---------------------------------------------------------------------------
alter type public.timeline_event_type add value if not exists 'symptom_logged';
alter type public.timeline_event_type add value if not exists 'procedure_recorded';

alter table public.patient_timeline add column if not exists trust_tier text;

alter table public.patient_timeline drop constraint if exists patient_timeline_trust_tier_check;
alter table public.patient_timeline add constraint patient_timeline_trust_tier_check
  check (trust_tier is null or trust_tier in ('lab_pushed', 'clinician', 'device', 'patient', 'ocr_unconfirmed', 'ocr_confirmed', 'imported', 'system'));

comment on column public.patient_timeline.trust_tier is
  'Who stands behind this item: lab_pushed (a laboratory sent it), clinician (a named clinician recorded it), device (a paired device or wearable), patient (the person typed it), ocr_unconfirmed (read from a photo, not yet confirmed), ocr_confirmed (read from a photo and confirmed by the patient), imported (an external record), system (the platform recorded it). Never inferred as clinician without a real actor.';

create or replace function private.timeline_trust_tier(p_event_type text, p_source_table text, p_metadata jsonb, p_actor uuid)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    -- an emitter may state the tier explicitly (the document trigger does), but only from the closed set
    when p_metadata ->> 'trust_tier' in ('ocr_unconfirmed', 'ocr_confirmed', 'imported') then p_metadata ->> 'trust_tier'
    -- a real, validated clinical_staff actor is the only route to the clinician tier
    when p_actor is not null then 'clinician'
    when p_event_type in ('lab_completed', 'lab_abnormal', 'imaging_report_uploaded') then 'lab_pushed'
    when p_source_table = 'vitals_readings' and lower(coalesce(p_metadata ->> 'source', '')) in ('device', 'wearable', 'cgm') then 'device'
    when p_source_table = 'vitals_readings' and lower(coalesce(p_metadata ->> 'source', '')) = 'fhir_import' then 'imported'
    when p_source_table in ('vitals_readings', 'symptoms', 'vaccination_records', 'patient_documents', 'procedures', 'family_history') then 'patient'
    else 'system'
  end
$$;

create or replace function private.set_patient_timeline_trust_tier()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Always derived here, never trusted from an insert: the tier is a statement about provenance, not a free label.
  new.trust_tier := private.timeline_trust_tier(new.event_type::text, new.source_table, new.metadata, new.actor_clinical_staff_id);
  return new;
end;
$$;
revoke all on function private.set_patient_timeline_trust_tier() from public, anon, authenticated;

drop trigger if exists patient_timeline_set_trust_tier on public.patient_timeline;
create trigger patient_timeline_set_trust_tier
  before insert on public.patient_timeline
  for each row execute function private.set_patient_timeline_trust_tier();

-- Backfill (13 rows live). The table is append-only for every role that can reach it; this runs as the migration owner.
update public.patient_timeline
   set trust_tier = private.timeline_trust_tier(event_type::text, source_table, metadata, actor_clinical_staff_id)
 where trust_tier is null;

alter table public.patient_timeline alter column trust_tier set not null;

-- ---------------------------------------------------------------------------
-- 3. patient_documents: suggestions only, confirmed per field
-- ---------------------------------------------------------------------------
alter table public.patient_documents
  add column if not exists ocr_state text,
  add column if not exists ocr_text text,
  add column if not exists extracted jsonb,
  add column if not exists ocr_model_id text,
  add column if not exists ocr_confirmed_at timestamptz;

alter table public.patient_documents drop constraint if exists patient_documents_ocr_state_check;
alter table public.patient_documents add constraint patient_documents_ocr_state_check
  check (ocr_state is null or ocr_state in ('pending', 'suggested', 'confirmed', 'rejected', 'failed'));

-- The shapes that matter: a rejected or failed document holds no text and no values; a confirmed one holds no raw text.
alter table public.patient_documents drop constraint if exists patient_documents_ocr_rejected_leaves_nothing;
alter table public.patient_documents add constraint patient_documents_ocr_rejected_leaves_nothing
  check (ocr_state is null or ocr_state not in ('rejected', 'failed') or (ocr_text is null and extracted is null));
alter table public.patient_documents drop constraint if exists patient_documents_ocr_confirmed_no_raw_text;
alter table public.patient_documents add constraint patient_documents_ocr_confirmed_no_raw_text
  check (ocr_state is distinct from 'confirmed' or (ocr_text is null and ocr_confirmed_at is not null));

comment on column public.patient_documents.extracted is
  'Suggested fields read from the photo: {"fields":[{"key","label","value","unit","confidence","state"}],"unreadable_reason"}. Suggestions until the patient confirms each one; nothing else reads this column (INV-02, INV-11 spirit: never treated as the record).';
comment on column public.patient_documents.ocr_state is
  'null = no reading requested; pending = waiting for the reader; suggested = values wait for the patient; confirmed = patient confirmed the kept fields; rejected / failed = nothing kept.';

-- The OCR columns change only inside the S43 functions (they set the flag in their own transaction). A client update, or a staff update through the existing policy, cannot forge a suggestion or a confirmation.
create or replace function private.enforce_patient_document_ocr_columns()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.ocr_state is not null and new.ocr_state <> 'pending' then
      raise exception 'a new document may only start with no reading or a pending one' using errcode = '42501';
    end if;
    if new.ocr_text is not null or new.extracted is not null or new.ocr_model_id is not null or new.ocr_confirmed_at is not null then
      raise exception 'suggested values cannot be inserted with a document' using errcode = '42501';
    end if;
    return new;
  end if;
  if coalesce(current_setting('tarragon.document_ocr', true), '') <> 'on'
     and (new.ocr_state is distinct from old.ocr_state or new.ocr_text is distinct from old.ocr_text or new.extracted is distinct from old.extracted
          or new.ocr_model_id is distinct from old.ocr_model_id or new.ocr_confirmed_at is distinct from old.ocr_confirmed_at) then
    raise exception 'document reading columns change only through the capture functions' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function private.enforce_patient_document_ocr_columns() from public, anon, authenticated;

drop trigger if exists patient_documents_ocr_columns_guard on public.patient_documents;
create trigger patient_documents_ocr_columns_guard
  before insert or update on public.patient_documents
  for each row execute function private.enforce_patient_document_ocr_columns();

-- Timeline row for a document: the tier says whether values were read from the photo and are still unconfirmed.
create or replace function private.timeline_from_patient_document()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.record_timeline_event(
    new.organisation_id, new.patient_id, 'document_uploaded',
    'patient_documents', new.id,
    'Document added to your record',
    replace(new.document_type::text, '_', ' ') || coalesce(' · ' || nullif(new.original_filename, ''), ''),
    new.created_at,
    private.timeline_staff_from_profile(new.uploaded_by, new.organisation_id),
    jsonb_build_object('document_type', new.document_type, 'source', new.source)
      || case when new.ocr_state = 'pending' then jsonb_build_object('trust_tier', 'ocr_unconfirmed') else '{}'::jsonb end
  );
  return new;
end;
$$;

-- The bus event on upload (ids only).
create or replace function private.emit_document_uploaded()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.emit_domain_event('document.uploaded', new.organisation_id,
    jsonb_build_object('document_id', new.id), 'document.uploaded:' || new.id::text,
    new.patient_id, 'patient_document', new.id);
  return new;
end;
$$;
revoke all on function private.emit_document_uploaded() from public, anon, authenticated;
drop trigger if exists patient_documents_emit_uploaded on public.patient_documents;
create trigger patient_documents_emit_uploaded
  after insert on public.patient_documents
  for each row execute function private.emit_document_uploaded();

-- 3a. The reader records its suggestions (service role only; the server action has already checked who is asking and the kill switch).
create or replace function public.record_document_suggestion(
  p_document uuid, p_ocr_text text, p_extracted jsonb, p_model text, p_failed boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.patient_documents%rowtype;
  v_fields jsonb;
begin
  select * into d from public.patient_documents where id = p_document for update;
  if not found then
    raise exception 'document not found' using errcode = 'P0002';
  end if;
  if d.ocr_state is distinct from 'pending' then
    raise exception 'document is not waiting for a reading' using errcode = '22023';
  end if;
  -- INV-14: the feature is off until its guard is on (a test patient may exercise it).
  if not private.go_live_open_patient('document_capture_enabled', d.patient_id) then
    raise exception 'document capture is not open' using errcode = '55000';
  end if;

  perform set_config('tarragon.document_ocr', 'on', true);
  if p_failed then
    update public.patient_documents
       set ocr_state = 'failed', ocr_text = null, extracted = null, ocr_model_id = nullif(btrim(p_model), '')
     where id = p_document;
    perform set_config('tarragon.document_ocr', 'off', true);
    return jsonb_build_object('state', 'failed');
  end if;

  if p_extracted is null or jsonb_typeof(p_extracted) <> 'object' or jsonb_typeof(p_extracted -> 'fields') <> 'array' then
    raise exception 'suggestions must be an object with a fields array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_extracted -> 'fields') > 80 then
    raise exception 'too many suggested fields' using errcode = '22023';
  end if;
  -- every suggestion starts as "suggested" whatever the reader claimed, and carries a key and a value as text
  select coalesce(jsonb_agg(jsonb_build_object(
           'key', f ->> 'key', 'label', coalesce(f ->> 'label', f ->> 'key'),
           'value', f ->> 'value', 'unit', f ->> 'unit',
           'confidence', case when f ->> 'confidence' in ('low', 'medium', 'high') then f ->> 'confidence' else 'low' end,
           'state', 'suggested')), '[]'::jsonb)
    into v_fields
    from jsonb_array_elements(p_extracted -> 'fields') f
   where nullif(btrim(f ->> 'key'), '') is not null and f ->> 'value' is not null and length(f ->> 'value') <= 400;

  update public.patient_documents
     set ocr_state = 'suggested',
         ocr_text = left(p_ocr_text, 20000),
         extracted = jsonb_build_object('fields', v_fields, 'unreadable_reason', nullif(btrim(p_extracted ->> 'unreadable_reason'), '')),
         ocr_model_id = nullif(btrim(p_model), '')
   where id = p_document;

  perform private.emit_domain_event('document.ocr_suggested', d.organisation_id,
    jsonb_build_object('document_id', d.id), 'document.ocr_suggested:' || d.id::text, d.patient_id, 'patient_document', d.id);
  perform set_config('tarragon.document_ocr', 'off', true);
  return jsonb_build_object('state', 'suggested', 'fields', jsonb_array_length(v_fields));
end;
$$;

-- 3b. The patient confirms field by field. p_fields: [{"key": "...", "accept": true, "value": "optional edit"}]. A field not named, or accepted = false, is dropped.
create or replace function public.confirm_document_extraction(p_document uuid, p_fields jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  d public.patient_documents%rowtype;
  v_keep jsonb;
  v_kept integer;
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if p_fields is null or jsonb_typeof(p_fields) <> 'array' then
    raise exception 'say which fields you confirm' using errcode = '22023';
  end if;
  if jsonb_array_length(p_fields) > 80 then
    raise exception 'too many fields' using errcode = '22023';
  end if;
  select * into d from public.patient_documents where id = p_document and patient_id = v_uid for update;
  if not found then
    raise exception 'document not found' using errcode = 'P0002';
  end if;
  if d.ocr_state is distinct from 'suggested' then
    raise exception 'there is nothing waiting for you to confirm' using errcode = '22023';
  end if;

  -- keep only fields the patient accepted; an edited value replaces the suggestion; the key must exist in the suggestion
  select coalesce(jsonb_agg(jsonb_build_object(
           'key', s ->> 'key', 'label', s ->> 'label',
           'value', coalesce(nullif(btrim(c ->> 'value'), ''), s ->> 'value'),
           'unit', s ->> 'unit', 'confidence', s ->> 'confidence',
           'edited', coalesce(nullif(btrim(c ->> 'value'), ''), s ->> 'value') is distinct from (s ->> 'value'),
           'state', 'confirmed')), '[]'::jsonb)
    into v_keep
    from jsonb_array_elements(d.extracted -> 'fields') s
    join jsonb_array_elements(p_fields) c on c ->> 'key' = s ->> 'key' and coalesce((c ->> 'accept')::boolean, false)
   where length(coalesce(nullif(btrim(c ->> 'value'), ''), s ->> 'value')) <= 400;
  v_kept := jsonb_array_length(v_keep);
  if v_kept = 0 then
    raise exception 'confirm at least one field, or reject the reading' using errcode = '22023';
  end if;

  perform set_config('tarragon.document_ocr', 'on', true);
  update public.patient_documents
     set ocr_state = 'confirmed', ocr_text = null, ocr_confirmed_at = now(),
         extracted = jsonb_build_object('fields', v_keep, 'unreadable_reason', null)
   where id = p_document;

  perform private.record_timeline_event(d.organisation_id, d.patient_id, 'document_uploaded', 'patient_documents', d.id,
    'Details confirmed from your photo', v_kept || ' details you confirmed', now(), null,
    jsonb_build_object('document_type', d.document_type, 'trust_tier', 'ocr_confirmed'));
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event, subject_patient_id)
  values (d.organisation_id, v_uid, 'document.ocr_confirmed', 'patient_documents', d.id,
          jsonb_build_object('kept', v_kept), d.patient_id);
  perform set_config('tarragon.document_ocr', 'off', true);
  return jsonb_build_object('state', 'confirmed', 'kept', v_kept);
end;
$$;

-- 3c. The patient rejects the reading. The photo stays; the text and the values go.
create or replace function public.reject_document_extraction(p_document uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  d public.patient_documents%rowtype;
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  select * into d from public.patient_documents where id = p_document and patient_id = v_uid for update;
  if not found then
    raise exception 'document not found' using errcode = 'P0002';
  end if;
  if d.ocr_state not in ('pending', 'suggested') then
    raise exception 'there is nothing waiting for you to confirm' using errcode = '22023';
  end if;
  perform set_config('tarragon.document_ocr', 'on', true);
  update public.patient_documents
     set ocr_state = 'rejected', ocr_text = null, extracted = null, ocr_model_id = null
   where id = p_document;
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event, subject_patient_id)
  values (d.organisation_id, v_uid, 'document.ocr_rejected', 'patient_documents', d.id, '{}'::jsonb, d.patient_id);
  perform set_config('tarragon.document_ocr', 'off', true);
  return jsonb_build_object('state', 'rejected');
end;
$$;

revoke all on function public.record_document_suggestion(uuid, text, jsonb, text, boolean) from public, anon, authenticated;
grant execute on function public.record_document_suggestion(uuid, text, jsonb, text, boolean) to service_role;
revoke all on function public.confirm_document_extraction(uuid, jsonb) from public, anon;
grant execute on function public.confirm_document_extraction(uuid, jsonb) to authenticated;
revoke all on function public.reject_document_extraction(uuid) from public, anon;
grant execute on function public.reject_document_extraction(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. History: procedures (new) and family_history upgrades
-- ---------------------------------------------------------------------------
create table if not exists public.procedures (
  id                   uuid primary key default gen_random_uuid(),
  organisation_id      uuid not null references public.organisations (id) on delete restrict,
  patient_id           uuid not null references public.profiles (id) on delete cascade,
  name                 text not null check (char_length(btrim(name)) between 1 and 200),
  performed_on         date check (performed_on is null or performed_on <= current_date),
  approximate_year     integer check (approximate_year is null or approximate_year between 1900 and 2100),
  facility             text check (facility is null or char_length(facility) <= 200),
  notes                text check (notes is null or char_length(notes) <= 2000),
  source               public.record_source not null default 'patient',
  recorded_by          uuid references public.profiles (id) on delete set null,
  source_document_id   uuid references public.patient_documents (id) on delete set null,
  verified_by_clinician boolean not null default false,
  verified_by          uuid references public.profiles (id) on delete set null,
  verified_at          timestamptz,
  removed_at           timestamptz,
  removed_by           uuid references public.profiles (id) on delete set null,
  removal_reason       text,
  is_test              boolean not null default false,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint procedures_verified_has_who check (not verified_by_clinician or (verified_by is not null and verified_at is not null)),
  constraint procedures_removed_has_who check (removed_at is null or removed_by is not null)
);
create index if not exists procedures_patient_idx on public.procedures (patient_id, coalesce(performed_on, make_date(coalesce(approximate_year, 1900), 1, 1)) desc);
create index if not exists procedures_org_idx on public.procedures (organisation_id);

create trigger procedures_set_updated_at before update on public.procedures for each row execute function private.set_updated_at();

alter table public.procedures enable row level security;

-- The patient reads their own live rows; a caregiver reads through the medical_history category grant (explicit cast: can_read_clinical has three overloads).
-- Staff have NO direct read: they use read_patient_history_audited (INV-10, INV-12).
create policy procedures_select on public.procedures for select to authenticated
  using (removed_at is null
         and (patient_id = (select auth.uid()) or private.can_read_clinical(patient_id, 'medical_history'::public.care_access_category)));
-- The patient adds their own; the guard trigger fixes source and verification.
create policy procedures_insert on public.procedures for insert to authenticated
  with check (patient_id = (select auth.uid()) and removed_at is null);
-- Edits by the patient go through the same row (never a delete); removal is a tombstone through remove_history_item().
create policy procedures_update on public.procedures for update to authenticated
  using (patient_id = (select auth.uid()) and removed_at is null)
  with check (patient_id = (select auth.uid()) and removed_at is null);

grant select, insert, update on public.procedures to authenticated;
revoke delete on public.procedures from authenticated;
revoke all on public.procedures from anon;

-- family_history: verification, tombstone, and a closed source for a patient writer.
alter table public.family_history
  add column if not exists verified_by_clinician boolean not null default false,
  add column if not exists verified_by uuid references public.profiles (id) on delete set null,
  add column if not exists verified_at timestamptz,
  add column if not exists removed_at timestamptz,
  add column if not exists removed_by uuid references public.profiles (id) on delete set null,
  add column if not exists removal_reason text;
alter table public.family_history drop constraint if exists family_history_verified_has_who;
alter table public.family_history add constraint family_history_verified_has_who
  check (not verified_by_clinician or (verified_by is not null and verified_at is not null));

-- The flag is switched off again before each function returns (set_config is transaction-local, so without that reset a later statement in the same
-- transaction would still count as "inside the function").
-- One guard for both tables. A patient writer cannot claim a clinician source, cannot set a verification, cannot tombstone by a plain update;
-- the SECURITY DEFINER functions below set tarragon.history_write = 'on' in their own transaction.
create or replace function private.enforce_history_item_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_via_function boolean := coalesce(current_setting('tarragon.history_write', true), '') = 'on';
begin
  if v_via_function then
    return new;
  end if;
  if tg_op = 'INSERT' then
    -- a patient writing their own row is the patient source; any other signed-in writer is the clinician source (today's policies admit no
    -- such direct insert, S05f closed it, so this is defence in depth); a context with no signed-in user (service role, migrations) keeps
    -- what it set. A row is never verified by its own insert.
    if (select auth.uid()) is not null then
      new.source := case when (select auth.uid()) = new.patient_id then 'patient' else 'clinician' end;
    end if;
    new.recorded_by := coalesce((select auth.uid()), new.recorded_by);
    new.verified_by_clinician := false; new.verified_by := null; new.verified_at := null;
    new.removed_at := null; new.removed_by := null; new.removal_reason := null;
    return new;
  end if;
  -- UPDATE by a direct session: provenance and verification are frozen, and the row stays in the state the function path set.
  new.source := old.source;
  new.recorded_by := old.recorded_by;
  new.verified_by_clinician := old.verified_by_clinician; new.verified_by := old.verified_by; new.verified_at := old.verified_at;
  new.removed_at := old.removed_at; new.removed_by := old.removed_by; new.removal_reason := old.removal_reason;
  -- Changing what was verified un-verifies it: the clinician confirmed the earlier text, not the new one.
  if tg_table_name = 'procedures' then
    if (new.name, new.performed_on, new.approximate_year, new.facility) is distinct from (old.name, old.performed_on, old.approximate_year, old.facility) then
      new.verified_by_clinician := false; new.verified_by := null; new.verified_at := null;
    end if;
  else
    if (new.condition_name, new.relationship, new.age_of_onset_years, new.is_deceased) is distinct from (old.condition_name, old.relationship, old.age_of_onset_years, old.is_deceased) then
      new.verified_by_clinician := false; new.verified_by := null; new.verified_at := null;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.enforce_history_item_write() from public, anon, authenticated;

drop trigger if exists procedures_write_guard on public.procedures;
create trigger procedures_write_guard before insert or update on public.procedures
  for each row execute function private.enforce_history_item_write();
drop trigger if exists family_history_write_guard on public.family_history;
create trigger family_history_write_guard before insert or update on public.family_history
  for each row execute function private.enforce_history_item_write();

-- family_history: a tombstoned row is hidden from the patient's own reads, and a patient hard delete is allowed only for a row they wrote
-- themselves that no clinician verified (a clinician-sourced or verified row is removed by tombstone, so the record keeps what a clinician stood behind).
drop policy if exists family_history_select on public.family_history;
create policy family_history_select on public.family_history for select to authenticated
  using (patient_id = (select auth.uid()) and removed_at is null);
drop policy if exists family_history_delete on public.family_history;
create policy family_history_delete on public.family_history for delete to authenticated
  using (patient_id = (select auth.uid()) and source = 'patient' and not verified_by_clinician);
drop policy if exists family_history_update on public.family_history;
create policy family_history_update on public.family_history for update to authenticated
  using (patient_id = (select auth.uid()) and removed_at is null)
  with check (patient_id = (select auth.uid()) and removed_at is null);

-- 4a. Timeline row for a procedure.
create or replace function private.timeline_from_procedure()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.record_timeline_event(new.organisation_id, new.patient_id, 'procedure_recorded', 'procedures', new.id,
    'Procedure added to your history', new.name,
    coalesce(new.performed_on::timestamptz, make_date(coalesce(new.approximate_year, extract(year from now())::integer), 1, 1)::timestamptz, new.created_at),
    private.timeline_staff_from_profile(case when new.source = 'clinician' then new.recorded_by end, new.organisation_id),
    jsonb_build_object('source', new.source::text, 'verified', new.verified_by_clinician));
  return new;
end;
$$;
revoke all on function private.timeline_from_procedure() from public, anon, authenticated;
drop trigger if exists procedures_timeline on public.procedures;
create trigger procedures_timeline after insert on public.procedures for each row execute function private.timeline_from_procedure();

-- Audit and correction trail, same as every clinical-core table.
drop trigger if exists audit_row_change_trg on public.procedures;
create trigger audit_row_change_trg after insert or update or delete on public.procedures for each row execute function private.audit_row_change();
drop trigger if exists capture_record_correction_trg on public.procedures;
create trigger capture_record_correction_trg after update or delete on public.procedures for each row execute function private.capture_record_correction();

-- 4b. Remove an item the patient entered (tombstone, never a silent delete). A clinician-sourced or verified item can be removed from the
-- patient's view, but the row stays for the audit trail.
create or replace function public.remove_history_item(p_kind text, p_id uuid, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_n integer;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if p_kind not in ('procedure', 'family_history') then raise exception 'unknown history kind' using errcode = '22023'; end if;
  perform set_config('tarragon.history_write', 'on', true);
  if p_kind = 'procedure' then
    update public.procedures set removed_at = now(), removed_by = v_uid, removal_reason = left(btrim(p_reason), 500)
     where id = p_id and patient_id = v_uid and removed_at is null;
  else
    update public.family_history set removed_at = now(), removed_by = v_uid, removal_reason = left(btrim(p_reason), 500)
     where id = p_id and patient_id = v_uid and removed_at is null;
  end if;
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'item not found' using errcode = 'P0002'; end if;
  perform set_config('tarragon.history_write', 'off', true);
  return jsonb_build_object('removed', true);
end;
$$;

-- 4c. A clinician records a procedure for a patient they hold an active tie to (INV-12), source clinician, audited.
create or replace function public.clinician_record_procedure(
  p_patient uuid, p_name text, p_performed_on date, p_facility text, p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid;
  v_id uuid;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if p_reason is null or char_length(btrim(p_reason)) < 10 then
    raise exception 'a reason of at least 10 characters is required' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles where id = v_uid and role = 'clinician') or not private.clinician_is_eligible(v_uid) then
    raise exception 'this action is for clinicians' using errcode = '42501';
  end if;
  -- a refusal RETURNS (it does not raise), so the denied audit row is kept
  if not private.can_staff_read_clinical(p_patient, 'medical_history'::public.care_access_category) then
    perform private.audit_chart_read(p_patient, array['procedures'], p_reason, 'denied');
    return jsonb_build_object('status', 'denied');
  end if;
  select organisation_id into v_org from public.profiles where id = p_patient;
  perform set_config('tarragon.history_write', 'on', true);
  insert into public.procedures (organisation_id, patient_id, name, performed_on, facility, source, recorded_by, verified_by_clinician, verified_by, verified_at, is_test)
  values (v_org, p_patient, btrim(p_name), p_performed_on, nullif(btrim(p_facility), ''), 'clinician', v_uid, true, v_uid, now(),
          coalesce((select is_test from public.profiles where id = p_patient), false))
  returning id into v_id;
  perform private.audit_chart_read(p_patient, array['procedures'], p_reason, 'success');
  perform set_config('tarragon.history_write', 'off', true);
  return jsonb_build_object('status', 'ok', 'id', v_id);
end;
$$;

-- 4d. A clinician verifies a history item the patient entered (same gate, audited). Verification is of the text as it stands now.
create or replace function public.verify_history_item(p_kind text, p_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_patient uuid;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if p_kind not in ('procedure', 'family_history') then raise exception 'unknown history kind' using errcode = '22023'; end if;
  if p_reason is null or char_length(btrim(p_reason)) < 10 then
    raise exception 'a reason of at least 10 characters is required' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles where id = v_uid and role = 'clinician') or not private.clinician_is_eligible(v_uid) then
    raise exception 'this action is for clinicians' using errcode = '42501';
  end if;
  if p_kind = 'procedure' then
    select patient_id into v_patient from public.procedures where id = p_id and removed_at is null;
  else
    select patient_id into v_patient from public.family_history where id = p_id and removed_at is null;
  end if;
  if v_patient is null then raise exception 'item not found' using errcode = 'P0002'; end if;
  if not private.can_staff_read_clinical(v_patient, 'medical_history'::public.care_access_category) then
    perform private.audit_chart_read(v_patient, array['procedures', 'family_history'], p_reason, 'denied');
    return jsonb_build_object('status', 'denied');
  end if;
  perform set_config('tarragon.history_write', 'on', true);
  if p_kind = 'procedure' then
    update public.procedures set verified_by_clinician = true, verified_by = v_uid, verified_at = now() where id = p_id;
  else
    update public.family_history set verified_by_clinician = true, verified_by = v_uid, verified_at = now() where id = p_id;
  end if;
  perform private.audit_chart_read(v_patient, array[case when p_kind = 'procedure' then 'procedures' else 'family_history' end], p_reason, 'success');
  perform set_config('tarragon.history_write', 'off', true);
  return jsonb_build_object('status', 'ok', 'verified', true);
end;
$$;

-- 4e. Staff read of the history tables (procedures and family history with verification and tombstones). One audit row per call.
create or replace function public.read_patient_history_audited(p_patient uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_page constant integer := 500;                      -- technical page size, not a clinical value
begin
  if p_reason is null or char_length(btrim(p_reason)) < 10 then
    raise exception 'a reason of at least 10 characters is required' using errcode = '22023';
  end if;
  if exists (select 1 from public.profiles where id = (select auth.uid()) and role = 'patient') then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  if not private.can_staff_read_clinical(p_patient, 'medical_history'::public.care_access_category) then
    perform private.audit_chart_read(p_patient, array['procedures', 'family_history'], p_reason, 'denied');
    return jsonb_build_object('status', 'denied');
  end if;
  perform private.audit_chart_read(p_patient, array['procedures', 'family_history'], p_reason, 'success');
  return jsonb_build_object('status', 'ok',
    'procedures', coalesce((select jsonb_agg(to_jsonb(x)) from (
       select id, name, performed_on, approximate_year, facility, notes, source, recorded_by, verified_by_clinician, verified_at,
              removed_at, removal_reason, created_at
         from public.procedures where patient_id = p_patient order by created_at desc limit c_page) x), '[]'::jsonb),
    'family_history', coalesce((select jsonb_agg(to_jsonb(x)) from (
       select id, condition_name, relationship, relationship_detail, age_of_onset_years, is_deceased, source, recorded_by,
              verified_by_clinician, verified_at, removed_at, removal_reason, created_at
         from public.family_history where patient_id = p_patient order by created_at desc limit c_page) x), '[]'::jsonb));
end;
$$;

revoke all on function public.remove_history_item(text, uuid, text) from public, anon;
revoke all on function public.clinician_record_procedure(uuid, text, date, text, text) from public, anon;
revoke all on function public.verify_history_item(text, uuid, text) from public, anon;
revoke all on function public.read_patient_history_audited(uuid, text) from public, anon;
grant execute on function public.remove_history_item(text, uuid, text) to authenticated;
grant execute on function public.clinician_record_procedure(uuid, text, date, text, text) to authenticated;
grant execute on function public.verify_history_item(text, uuid, text) to authenticated;
grant execute on function public.read_patient_history_audited(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Symptom journal: link to a checker session, a timeline entry, and the journal read
-- ---------------------------------------------------------------------------
alter table public.symptoms
  add column if not exists assessment_id uuid references public.symptom_triage_assessments (id) on delete set null;
create index if not exists symptoms_assessment_idx on public.symptoms (assessment_id) where assessment_id is not null;

create or replace function private.timeline_from_symptom()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.record_timeline_event(new.organisation_id, new.patient_id, 'symptom_logged', 'symptoms', new.id,
    'Symptom noted', 'In your symptom journal', coalesce(new.reported_at, new.created_at), null,
    jsonb_build_object('source', new.source::text));
  return new;
end;
$$;
revoke all on function private.timeline_from_symptom() from public, anon, authenticated;
drop trigger if exists symptoms_timeline on public.symptoms;
create trigger symptoms_timeline after insert on public.symptoms for each row execute function private.timeline_from_symptom();

-- The journal: the person's own entries, newest first, each with the grade the triage produced and the checker session it came from, if any.
-- A patient reads their own; no staff path (staff use the audited chart read).
create or replace function public.patient_symptom_journal(p_limit integer default 100)
returns table (symptom_id uuid, reported_at timestamptz, symptom_type text, free_text text, severity integer, source text,
               assessment_id uuid, assessment_category text, triage_grade text)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, s.reported_at, s.symptom_type::text, s.description, s.severity, s.source::text,
         s.assessment_id, a.category::text,
         (select t.grade from public.triage_events t where t.trigger_type = 'symptom' and t.trigger_id = s.id and not coalesce(t.shadow, false)
           order by t.created_at desc limit 1)
    from public.symptoms s
    left join public.symptom_triage_assessments a on a.id = s.assessment_id
   where s.patient_id = (select auth.uid())
   order by s.reported_at desc
   limit least(greatest(coalesce(p_limit, 100), 1), 500)
$$;
revoke all on function public.patient_symptom_journal(integer) from public, anon;
grant execute on function public.patient_symptom_journal(integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. AI-018 registration and the go-live guard
-- ---------------------------------------------------------------------------
insert into public.ai_systems (
  system_code, name, purpose, owner_role, vendor_id, risk_class, autonomy_level,
  clinically_meaningful, lifecycle_status, is_enabled, runtime_governed, fallback_behaviour,
  code_reference, review_interval_days, next_review_due
)
select 'AI-018', 'Health document capture reading',
       'Reads a photo or scan of a patient''s own paper result, prescription or discharge summary and drafts the fields it can read, for the patient to confirm one by one. Nothing it reads enters the record unconfirmed and nothing it reads reaches escalation or risk.',
       'Clinical Director',
       (select id from public.ai_vendors where name = 'Anthropic'),
       'moderate'::public.ai_risk_class,
       'assist'::public.ai_autonomy_level,
       true, 'draft', false, false,
       'The photo is kept as an uploaded document and the patient types the details by hand. Nothing downstream depends on the reading succeeding.',
       'apps/web/src/lib/document-capture/extract.ts', 365, current_date + 365
where not exists (select 1 from public.ai_systems where system_code = 'AI-018');

insert into public.ai_system_versions (
  ai_system_id, version, model_identifier, training_data_description, intended_population, excluded_population, validation_summary, change_summary
)
select s.id, 'v1', 'claude-sonnet-5',
       'General-purpose vision-capable foundation model, no Tarragon fine-tuning.',
       'Patients photographing their own paper health documents for their own record.',
       'Anyone photographing another person''s documents; any document the reader cannot transcribe faithfully.',
       'No validation has been carried out. Approval requires a passing run of every required evaluation suite.',
       'First registration (S43).'
from public.ai_systems s
where s.system_code = 'AI-018'
  and not exists (select 1 from public.ai_system_versions x where x.ai_system_id = s.id and x.version = 'v1');

insert into public.ai_guardrails (ai_system_id, rule_code, kind, description, enforcement, config)
select s.id, g.rule_code, g.kind::public.ai_guardrail_kind, g.description, g.enforcement::public.ai_guardrail_enforcement, g.config::jsonb
from public.ai_systems s
join (values
  ('transcribes_printed_values_only', 'prohibited_diagnosis',
   'Transcribes what is printed. Never interprets a value, never says whether it is normal, never advises.', 'blocking', '{}'),
  ('confirm_before_entering_record', 'mandatory_human_review',
   'Every suggested field is confirmed or dropped by the patient. Unconfirmed values are never stored as part of the record and never read by escalation or risk.', 'blocking', '{}'),
  ('max_autonomy', 'max_autonomy', 'Performs part of the workflow; what enters the record stays with a person.', 'blocking', '{"max_level":"assist"}')
) as g(rule_code, kind, description, enforcement, config) on true
where s.system_code = 'AI-018'
  and not exists (select 1 from public.ai_guardrails x where x.ai_system_id = s.id and x.rule_code = g.rule_code);

insert into public.go_live_guards (key, label, blocks, condition_text, switch_role, enforced_in, not_enforced_in)
select 'document_capture_enabled', 'Photo capture reading', 'Reading values from a photo of a health document',
       'AI-018 evaluated and approved by the Chief Medical Officer; the founder confirms the vendor terms for patient documents', 'admin',
       array['record_document_suggestion (the reader''s write)', 'document capture screen'],
       'Switching it on needs its conditions added to private.go_live_conditions first; until then it reports "no defined condition" and cannot be switched on.'
where not exists (select 1 from public.go_live_guards where key = 'document_capture_enabled');

-- ---------------------------------------------------------------------------
-- Self-checks
-- ---------------------------------------------------------------------------
do $$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'public.record_document_suggestion(uuid, text, jsonb, text, boolean)', 'public.confirm_document_extraction(uuid, jsonb)',
    'public.reject_document_extraction(uuid)', 'public.remove_history_item(text, uuid, text)',
    'public.clinician_record_procedure(uuid, text, date, text, text)', 'public.verify_history_item(text, uuid, text)',
    'public.read_patient_history_audited(uuid, text)', 'public.patient_symptom_journal(integer)'] loop
    if has_function_privilege('anon', v_fn::regprocedure, 'EXECUTE') then
      raise exception 'S43 self-check: anon can execute %', v_fn;
    end if;
  end loop;
  if has_function_privilege('authenticated', 'public.record_document_suggestion(uuid, text, jsonb, text, boolean)'::regprocedure, 'EXECUTE') then
    raise exception 'S43 self-check: authenticated can execute the reader write';
  end if;
  if exists (select 1 from public.patient_timeline where trust_tier is null) then
    raise exception 'S43 self-check: a timeline row has no trust tier';
  end if;
  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'procedures' and cmd = 'SELECT' and qual ilike '%is_org_staff%') <> 0 then
    raise exception 'S43 self-check: procedures admits org staff directly';
  end if;
  if not exists (select 1 from public.ai_systems where system_code = 'AI-018') then
    raise exception 'S43 self-check: AI-018 is not registered';
  end if;
  if exists (select 1 from public.go_live_guards where key = 'document_capture_enabled' and is_on) then
    raise exception 'S43 self-check: the capture guard must start off';
  end if;
end $$;
