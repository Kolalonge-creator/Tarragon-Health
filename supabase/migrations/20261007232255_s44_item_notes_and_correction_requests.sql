-- S44 (Module 2, interoperability), part 2 of 3: labels, dates and notes on any record item, and correction requests that point at an item (spec 2.14).
--
-- Why a separate table and not edits to the items themselves:
--   * A label, a note or "the date I think this was" is the person's OWN annotation. It never changes the clinical value, the date the item
--     was taken, its source, or anything a safety engine reads. So it is allowed on every item, including items the person cannot edit
--     (a device or wearable reading locked by enforce_vitals_reading_source_lock, a released lab result, a clinician's entry).
--   * Notes are private to the person. They are not in the FHIR export, the share link or the facility summary (tests prove this).
--   * Correcting a clinician-sourced, device-sourced or lab-sourced item is never an edit by the patient and never a silent delete: it is a
--     correction request (the existing data_correction_requests workflow) that now names the item, reviewed by staff. A manual vital the
--     person typed can still be edited through the existing update path, which the record_corrections trigger audits.
--   * Vitals, medications and allergies are deliberately NOT given a patient "delete": they feed alert, interaction and risk engines. Removing
--     them from those engines is a clinical decision (OQ-S44-6). Procedures and family history already have tombstones (S43).
--
-- Live counts before this migration: data_correction_requests rows are untouched (two nullable columns are added).

-- ---------------------------------------------------------------------------
-- 1. Which patient owns an item (a closed list, never a free table name)
-- ---------------------------------------------------------------------------
create or replace function private.item_owner(p_table text, p_id uuid) returns uuid
language plpgsql stable security definer set search_path = ''
as $$
declare v uuid;
begin
  if p_id is null then return null; end if;
  case p_table
    when 'vitals_readings'      then select patient_id into v from public.vitals_readings where id = p_id;
    when 'lab_results'          then select patient_id into v from public.lab_results where id = p_id;
    when 'lab_analyte_readings' then select patient_id into v from public.lab_analyte_readings where id = p_id;
    when 'medications'          then select patient_id into v from public.medications where id = p_id;
    when 'patient_conditions'   then select patient_id into v from public.patient_conditions where id = p_id;
    when 'patient_allergies'    then select patient_id into v from public.patient_allergies where id = p_id;
    when 'vaccination_records'  then select profile_id into v from public.vaccination_records where id = p_id;
    when 'symptoms'             then select patient_id into v from public.symptoms where id = p_id;
    when 'patient_documents'    then select patient_id into v from public.patient_documents where id = p_id;
    when 'procedures'           then select patient_id into v from public.procedures where id = p_id;
    when 'family_history'       then select patient_id into v from public.family_history where id = p_id;
    when 'external_records'     then select patient_id into v from public.external_records where id = p_id;
    else return null;
  end case;
  return v;
end;
$$;
revoke all on function private.item_owner(text, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. The annotation table
-- ---------------------------------------------------------------------------
create table public.patient_item_notes (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  patient_id      uuid not null references public.profiles (id) on delete cascade,
  item_table      text not null check (item_table in ('vitals_readings', 'lab_results', 'lab_analyte_readings', 'medications', 'patient_conditions',
                    'patient_allergies', 'vaccination_records', 'symptoms', 'patient_documents', 'procedures', 'family_history', 'external_records')),
  item_id         uuid not null,
  label           text check (label is null or char_length(btrim(label)) between 1 and 60),
  note            text check (note is null or char_length(note) <= 1000),
  -- The date the person says the item relates to. An annotation only: it never replaces taken_at, given_at or any clinical date.
  patient_date    date,
  is_test         boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (patient_id, item_table, item_id),
  check (label is not null or note is not null or patient_date is not null)
);
create index patient_item_notes_patient_idx on public.patient_item_notes (patient_id, updated_at desc);

alter table public.patient_item_notes enable row level security;
create policy patient_item_notes_select_own on public.patient_item_notes
  for select to authenticated using (patient_id = (select auth.uid()));
revoke all on public.patient_item_notes from anon, authenticated;
grant select on public.patient_item_notes to authenticated;

comment on table public.patient_item_notes is
  'A person''s own label, note and date on any record item. Private to the person; never exported or shared; never changes the item itself.';

create or replace function public.set_item_note(p_table text, p_id uuid, p_label text default null, p_note text default null, p_date date default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid;
  v_test boolean;
  v_label text := nullif(btrim(p_label), '');
  v_note text := nullif(btrim(p_note), '');
  v_id uuid;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select organisation_id, is_test into v_org, v_test from public.profiles where id = v_uid and role = 'patient';
  if v_org is null then raise exception 'this action is for patients' using errcode = '42501'; end if;
  -- an item you do not own is reported as not found: no hint that it exists
  if private.item_owner(p_table, p_id) is distinct from v_uid then raise exception 'item not found' using errcode = 'P0002'; end if;
  if v_label is null and v_note is null and p_date is null then
    delete from public.patient_item_notes where patient_id = v_uid and item_table = p_table and item_id = p_id;
    return jsonb_build_object('cleared', true);
  end if;
  insert into public.patient_item_notes (organisation_id, patient_id, item_table, item_id, label, note, patient_date, is_test)
  values (v_org, v_uid, p_table, p_id, v_label, v_note, p_date, coalesce(v_test, false))
  on conflict (patient_id, item_table, item_id)
  do update set label = excluded.label, note = excluded.note, patient_date = excluded.patient_date, updated_at = now()
  returning id into v_id;
  return jsonb_build_object('id', v_id);
end;
$$;

create or replace function public.my_item_notes(p_table text default null)
returns table (id uuid, item_table text, item_id uuid, label text, note text, patient_date date, updated_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select n.id, n.item_table, n.item_id, n.label, n.note, n.patient_date, n.updated_at
    from public.patient_item_notes n
   where n.patient_id = (select auth.uid()) and (p_table is null or n.item_table = p_table)
   order by n.updated_at desc limit 1000
$$;

revoke all on function public.set_item_note(text, uuid, text, text, date) from public, anon;
revoke all on function public.my_item_notes(text) from public, anon;
grant execute on function public.set_item_note(text, uuid, text, text, date) to authenticated;
grant execute on function public.my_item_notes(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Correction requests that name the item
-- ---------------------------------------------------------------------------
alter table public.data_correction_requests add column if not exists item_table text;
alter table public.data_correction_requests add column if not exists item_id uuid;
alter table public.data_correction_requests drop constraint if exists data_correction_requests_item_pair;
alter table public.data_correction_requests add constraint data_correction_requests_item_pair
  check ((item_table is null) = (item_id is null));

-- A request may only point at an item the requester owns, whichever way the row was inserted.
create or replace function private.enforce_correction_request_item_owner() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.item_id is not null and private.item_owner(new.item_table, new.item_id) is distinct from new.patient_id then
    raise exception 'item not found' using errcode = 'P0002';
  end if;
  return new;
end;
$$;
revoke all on function private.enforce_correction_request_item_owner() from public, anon, authenticated;
drop trigger if exists data_correction_requests_item_owner on public.data_correction_requests;
create trigger data_correction_requests_item_owner before insert on public.data_correction_requests
  for each row execute function private.enforce_correction_request_item_owner();

create or replace function public.request_item_correction(p_table text, p_id uuid, p_what_is_wrong text, p_requested_change text default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid;
  v_id uuid;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select organisation_id into v_org from public.profiles where id = v_uid and role = 'patient';
  if v_org is null then raise exception 'this action is for patients' using errcode = '42501'; end if;
  if p_what_is_wrong is null or char_length(btrim(p_what_is_wrong)) < 3 then raise exception 'say what looks wrong' using errcode = '22023'; end if;
  if private.item_owner(p_table, p_id) is distinct from v_uid then raise exception 'item not found' using errcode = 'P0002'; end if;
  insert into public.data_correction_requests (organisation_id, patient_id, record_description, what_is_wrong, requested_change, item_table, item_id)
  values (v_org, v_uid, 'Record item (' || p_table || ')', left(btrim(p_what_is_wrong), 2000), left(nullif(btrim(p_requested_change), ''), 2000), p_table, p_id)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'status', 'pending');
end;
$$;
revoke all on function public.request_item_correction(text, uuid, text, text) from public, anon;
grant execute on function public.request_item_correction(text, uuid, text, text) to authenticated;

do $$
begin
  if exists (select 1 from information_schema.role_table_grants where table_schema = 'public' and table_name = 'patient_item_notes'
              and grantee in ('anon', 'authenticated') and privilege_type in ('INSERT', 'UPDATE', 'DELETE')) then
    raise exception 'S44 assertion: a client role can write patient_item_notes directly';
  end if;
end $$;
