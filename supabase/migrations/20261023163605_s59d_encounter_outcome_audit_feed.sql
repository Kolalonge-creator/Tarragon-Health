-- S59d part 2 of 4: the clinician's SIGNED diagnosis feeds the symptom checker accuracy audit automatically.
--
-- WHY. Until now the audit's clinician side (public.symptom_reviews) existed only when a clinician opened a review and typed a final
-- diagnosis code and an agreement flag. Most checks end in a booked consultation instead. When the person chose to send a symptom
-- summary to their care team and booked a consultation (S59 hand-off), the consultation's SIGNED encounter note is already the
-- clinician's own judgement. This migration lets that signed note feed the audit, with no extra work for the clinician beyond the ICD-10
-- code on the note, and with nothing that can change what the patient was told or what any clinician decided.
--
-- THE CHAIN (all ids, no free text is copied):
--   symptom_triage_assessments -> symptom_session_summaries.appointment_id -> appointments.video_consultation_id
--   -> encounters (S21) with status 'completed' -> clinical_encounter_notes (same video consultation, status 'finalized' = signed,
--   with a diagnosis_code) -> one row in public.symptom_encounter_outcomes.
-- The row is written when BOTH the encounter is completed and a signed note with a code exists, whichever happens last (two AFTER triggers
-- that call the same function). It is idempotent (unique per assessment and note, and one active row per assessment).
--
-- WHAT COUNTS. Only a SIGNED note counts. When a signed amendment of that note is signed, the original's row is RETRACTED (status
-- 'retracted', never deleted) and, if the amendment carries its own code, a new row is written from it. A note without a code writes
-- nothing. A manual symptom_reviews row for the same assessment wins: an assessment is counted once, never twice.
--
-- agrees. Same rule as a manual review: it is true when the category the diagnosis maps to equals the category the patient was
-- actually given, coalesce(override_category, category). The map from a diagnosis code to an urgency category is
-- public.symptom_diagnosis_urgency_maps: version 1 is an UNSIGNED, INACTIVE DRAFT of PROPOSED values for the Chief Medical Officer.
-- Until the CMO confirms a version through confirm_symptom_diagnosis_urgency_map(), every row stores the diagnosis code with
-- mapped_category, mapping_version and agrees all NULL ("not computed"), and the audit never counts such a row. Confirming a version fills
-- the NULLs of the active rows once. Nothing in this migration confirms anything.
--
-- WHO SEES WHAT (INV-10, INV-12). The table has RLS enabled and NO policy and NO grant for any API role: not the patient, not staff,
-- not an admin. A reviewing clinician (senior or above) reads the outcome of ONE assessment through read_symptom_outcome_audited(),
-- which applies the per-patient tie (private.can_staff_read_clinical, medical_history) and writes an audit row for every read, allowed
-- or denied. There is no staff-wide list. private.is_org_staff() is not used anywhere here. An admin or the CMO sees only the
-- aggregate report (symptom_accuracy_reports), which has no person in it.
--
-- THE AUDIT (replaces the S60 function, same name and signature). The base of the monthly report is now manual completed reviews PLUS
-- active auto-fed outcomes with a computed category, each assessment once. A new dimension 'source' ('manual_review', 'encounter_auto')
-- shows the breakdown, with the same Wilson intervals, minimum cell size and complementary suppression as every other dimension.
-- Reports stay immutable and never publishable; the first report with anything in it stays the baseline. A retraction after a report
-- was generated does not rewrite that report (reports are permanent); it removes the row from later runs only.
--
-- EVENTS (S10 outbox, ids only, INV-07): symptom_outcome.recorded, symptom_outcome.retracted. A failure to write one is audited and
-- opens an incident; it never rolls back the outcome, the note signature or the encounter completion.
--
-- NEVER BLOCKS CARE. Both triggers swallow their own errors (audit_log + incident). Signing a note and completing a consultation work
-- exactly as before whether or not this feed succeeds. The feed writes only to its own table and the outbox.
--
-- ROWS AFFECTED: none changed. One new column on clinical_encounter_notes (nullable, no backfill), two new tables (empty / one draft
-- config row), two triggers, new functions, two S60 functions replaced.
-- GRANT NOTE: new tables get an `authenticated` default grant, so it is revoked; every function revokes from PUBLIC (anon inherits it).

-- ---------------------------------------------------------------------------
-- 1. Events (data, per S10)
-- ---------------------------------------------------------------------------
insert into public.event_types (event_type, description, owner_section, is_urgent)
values ('symptom_outcome.recorded', 'A signed consultation diagnosis was linked to a symptom check for the accuracy audit', 'S59d', false)
on conflict (event_type) do nothing;
insert into public.event_type_versions (event_type, version, required_keys)
values ('symptom_outcome.recorded', 1, array['outcome_id', 'assessment_id'])
on conflict (event_type, version) do nothing;
insert into public.event_types (event_type, description, owner_section, is_urgent)
values ('symptom_outcome.retracted', 'A linked consultation diagnosis was withdrawn because its note was amended', 'S59d', false)
on conflict (event_type) do nothing;
insert into public.event_type_versions (event_type, version, required_keys)
values ('symptom_outcome.retracted', 1, array['outcome_id', 'assessment_id'])
on conflict (event_type, version) do nothing;

-- ---------------------------------------------------------------------------
-- 2. The ICD-10 code on a signed note
-- ---------------------------------------------------------------------------
-- Nullable, set on a DRAFT note before it is signed, frozen by the existing finalized-note immutability. Same shape as symptom_reviews.
alter table public.clinical_encounter_notes
  add column if not exists diagnosis_code text
  check (diagnosis_code is null or diagnosis_code ~ '^[A-TV-Z][0-9][0-9AB](\.[0-9A-Z]{1,4})?$');
comment on column public.clinical_encounter_notes.diagnosis_code is
  'S59d: the ICD-10 code of the note''s diagnosis, set by the author while the note is a draft. It is what feeds the symptom checker accuracy audit once the note is signed. Free-text `diagnosis` stays as it is.';

create or replace function public.set_encounter_note_diagnosis_code(p_note uuid, p_code text) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_status text;
  v_code text := nullif(upper(btrim(p_code)), '');
begin
  perform private.may_work_on_note(p_note);
  select status into v_status from public.clinical_encounter_notes where id = p_note;
  if v_status <> 'draft' then
    raise exception 'This encounter note is finalized and cannot be edited.' using errcode = '42501';
  end if;
  if v_code is not null and v_code !~ '^[A-TV-Z][0-9][0-9AB](\.[0-9A-Z]{1,4})?$' then
    raise exception 'That is not an ICD-10 code (for example B50.9)' using errcode = '22023';
  end if;
  update public.clinical_encounter_notes set diagnosis_code = v_code where id = p_note;
end $$;
revoke all on function public.set_encounter_note_diagnosis_code(uuid, text) from public;
grant execute on function public.set_encounter_note_diagnosis_code(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. The diagnosis-to-urgency map (PROPOSED, unsigned, inactive until the CMO confirms a version)
-- ---------------------------------------------------------------------------
create table public.symptom_diagnosis_urgency_maps (
  version      integer primary key check (version >= 1),
  config       jsonb not null check (jsonb_typeof(config) = 'object'),
  notes        text,
  is_active    boolean not null default false,
  confirmed_by uuid references public.profiles (id) on delete restrict,
  confirmed_at timestamptz,
  created_at   timestamptz not null default now(),
  constraint symptom_urgency_map_active_needs_confirmation check (not is_active or (confirmed_by is not null and confirmed_at is not null))
);
create unique index symptom_diagnosis_urgency_maps_one_active on public.symptom_diagnosis_urgency_maps ((true)) where is_active;
alter table public.symptom_diagnosis_urgency_maps enable row level security;
revoke all on public.symptom_diagnosis_urgency_maps from public, anon, authenticated;
create policy symptom_diagnosis_urgency_maps_read on public.symptom_diagnosis_urgency_maps
  for select to authenticated using (private.is_admin() or private.credential_is_cmo());
grant select on public.symptom_diagnosis_urgency_maps to authenticated;

-- Mirrors the PROPOSED `symptom.diagnosis_urgency_map` entry in packages/shared (a Jest test fails if they drift). Every entry is a
-- placeholder for the CMO to confirm, replace or delete: which urgency a diagnosis "deserved" at presentation is a clinical judgement.
-- urgency-map-begin
insert into public.symptom_diagnosis_urgency_maps (version, config, notes, is_active)
values (1, $json$
{"entries": [
 {"prefix": "I21", "category": "emergency", "label": "Acute myocardial infarction"},
 {"prefix": "I20", "category": "urgent", "label": "Angina"},
 {"prefix": "I16", "category": "emergency", "label": "Hypertensive crisis"},
 {"prefix": "I10", "category": "routine", "label": "Essential hypertension"},
 {"prefix": "I60", "category": "emergency", "label": "Subarachnoid haemorrhage"},
 {"prefix": "I61", "category": "emergency", "label": "Intracerebral haemorrhage"},
 {"prefix": "I63", "category": "emergency", "label": "Cerebral infarction"},
 {"prefix": "I64", "category": "emergency", "label": "Stroke, not specified"},
 {"prefix": "G00", "category": "emergency", "label": "Bacterial meningitis"},
 {"prefix": "G03", "category": "emergency", "label": "Meningitis of other causes"},
 {"prefix": "G43", "category": "routine", "label": "Migraine"},
 {"prefix": "R51", "category": "routine", "label": "Headache"},
 {"prefix": "B50", "category": "urgent", "label": "Plasmodium falciparum malaria"},
 {"prefix": "B51", "category": "urgent", "label": "Plasmodium vivax malaria"},
 {"prefix": "B54", "category": "urgent", "label": "Malaria, unspecified"},
 {"prefix": "A01", "category": "urgent", "label": "Typhoid and paratyphoid fevers"},
 {"prefix": "A09", "category": "routine", "label": "Gastroenteritis and colitis"},
 {"prefix": "R50", "category": "routine", "label": "Fever of other and unknown origin"},
 {"prefix": "K35", "category": "emergency", "label": "Acute appendicitis"},
 {"prefix": "J45", "category": "urgent", "label": "Asthma"},
 {"prefix": "J18", "category": "urgent", "label": "Pneumonia, organism unspecified"},
 {"prefix": "J06", "category": "self_management", "label": "Acute upper respiratory infection"},
 {"prefix": "J00", "category": "self_management", "label": "Acute nasopharyngitis (common cold)"},
 {"prefix": "N39", "category": "routine", "label": "Urinary tract infection"},
 {"prefix": "E10", "category": "routine", "label": "Type 1 diabetes"},
 {"prefix": "E11", "category": "routine", "label": "Type 2 diabetes"},
 {"prefix": "E101", "category": "emergency", "label": "Type 1 diabetes with ketoacidosis"},
 {"prefix": "E111", "category": "emergency", "label": "Type 2 diabetes with ketoacidosis"},
 {"prefix": "E16", "category": "urgent", "label": "Other disorders of pancreatic internal secretion (includes hypoglycaemia)"},
 {"prefix": "O14", "category": "emergency", "label": "Pre-eclampsia"},
 {"prefix": "O15", "category": "emergency", "label": "Eclampsia"},
 {"prefix": "O20", "category": "urgent", "label": "Haemorrhage in early pregnancy"},
 {"prefix": "O46", "category": "emergency", "label": "Antepartum haemorrhage"},
 {"prefix": "M54", "category": "routine", "label": "Dorsalgia (back pain)"}
]}
$json$::jsonb, 'PROPOSED, not signed, not active. Mirrors the symptom.diagnosis_urgency_map entry in packages/shared/src/proposed-config/registry.ts. The CMO confirms, edits or replaces it.', false);
-- urgency-map-end

create or replace function private.symptom_urgency_map_valid(p_config jsonb) returns boolean
language sql immutable set search_path = ''
as $$
  select case when jsonb_typeof(p_config -> 'entries') = 'array' and jsonb_array_length(p_config -> 'entries') > 0 then
           not exists (
             select 1 from jsonb_array_elements(p_config -> 'entries') e
              where jsonb_typeof(e) <> 'object'
                 or (e ->> 'prefix') is null or (e ->> 'prefix') !~ '^[A-TV-Z][0-9][0-9AB][0-9A-Z]{0,4}$'
                 or (e ->> 'category') is null or (e ->> 'category') not in ('emergency', 'urgent', 'routine', 'self_management'))
           and not exists (select 1 from jsonb_array_elements(p_config -> 'entries') e group by e ->> 'prefix' having count(*) > 1)
         else false end
$$;
revoke all on function private.symptom_urgency_map_valid(jsonb) from public, anon, authenticated;

-- Longest matching prefix of the ACTIVE, confirmed map wins. No active map, or no match, gives no row (not computed).
create or replace function private.map_diagnosis_to_category(p_code text)
returns table (category public.triage_category, version integer)
language sql stable security definer set search_path = ''
as $$
  select (e ->> 'category')::public.triage_category, m.version
    from public.symptom_diagnosis_urgency_maps m
   cross join lateral jsonb_array_elements(m.config -> 'entries') e
   where m.is_active and m.confirmed_at is not null
     and replace(upper(btrim(p_code)), '.', '') like (e ->> 'prefix') || '%'
   order by length(e ->> 'prefix') desc
   limit 1
$$;
revoke all on function private.map_diagnosis_to_category(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. The outcome table
-- ---------------------------------------------------------------------------
create table public.symptom_encounter_outcomes (
  id                  uuid primary key default gen_random_uuid(),
  organisation_id     uuid not null references public.organisations (id) on delete restrict,
  assessment_id       uuid not null references public.symptom_triage_assessments (id) on delete cascade,
  patient_id          uuid not null references public.profiles (id) on delete cascade,
  summary_id          uuid references public.symptom_session_summaries (id) on delete set null,
  appointment_id      uuid references public.appointments (id) on delete set null,
  encounter_id        uuid references public.encounters (id) on delete set null,
  note_id             uuid not null references public.clinical_encounter_notes (id) on delete cascade,
  -- provenance (clinical-table convention): where the row came from and the clinician whose signature it rests on
  source              text not null default 'encounter_auto' check (source = 'encounter_auto'),
  recorded_by         uuid not null references public.profiles (id) on delete restrict,
  diagnosis_code      text not null check (diagnosis_code ~ '^[A-TV-Z][0-9][0-9AB](\.[0-9A-Z]{1,4})?$'),
  -- what the checker said, and what the patient was actually shown (the clinician override when there was one)
  checker_category    public.triage_category not null,
  given_category      public.triage_category not null,
  -- the CMO-confirmed map; all three NULL means "not computed" and the audit never counts the row
  mapped_category     public.triage_category,
  mapping_version     integer references public.symptom_diagnosis_urgency_maps (version) on delete restrict,
  agrees              boolean,
  protocol_version    integer not null references public.triage_protocols (version) on delete restrict,
  outcome_at          timestamptz not null,
  status              text not null default 'active' check (status in ('active', 'retracted')),
  retracted_at        timestamptz,
  retracted_reason    text check (retracted_reason is null or retracted_reason = 'note_amended'),
  retracted_by_note_id uuid,
  is_test             boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint symptom_encounter_outcomes_mapping_all_or_none
    check ((mapped_category is null) = (mapping_version is null) and (mapped_category is null) = (agrees is null)),
  constraint symptom_encounter_outcomes_retraction_pair
    check ((status = 'retracted') = (retracted_at is not null) and (status = 'retracted') = (retracted_reason is not null)),
  constraint symptom_encounter_outcomes_one_per_note unique (assessment_id, note_id)
);
create unique index symptom_encounter_outcomes_one_active on public.symptom_encounter_outcomes (assessment_id) where status = 'active';
create index symptom_encounter_outcomes_audit_idx on public.symptom_encounter_outcomes (organisation_id, outcome_at)
  where status = 'active' and mapped_category is not null;
create index symptom_encounter_outcomes_note_idx on public.symptom_encounter_outcomes (note_id);

alter table public.symptom_encounter_outcomes enable row level security;
revoke all on public.symptom_encounter_outcomes from public, anon, authenticated;
-- deliberately NO policy and NO grant: see the header. Reads go through read_symptom_outcome_audited only.

create trigger symptom_encounter_outcomes_set_updated_at
  before update on public.symptom_encounter_outcomes
  for each row execute function private.set_updated_at();

-- A row is a clinical record: never deleted (a cascade from a deleted patient is the only exception) and changed in exactly two ways:
-- active -> retracted (with its pair of fields), and the mapping fields filled once from NULL when the CMO confirms a map.
create or replace function private.symptom_encounter_outcomes_guard() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  c_free constant text[] := array['status', 'retracted_at', 'retracted_reason', 'retracted_by_note_id', 'mapped_category', 'mapping_version', 'agrees', 'updated_at'];
  -- the three link columns are plain references for navigation: the foreign keys set them to NULL (ON DELETE SET NULL) when an
  -- encounter, appointment or summary is deleted, so that change must always be allowed (deletes, erasure and test purges rely on it)
  c_fk constant text[] := array['summary_id', 'appointment_id', 'encounter_id'];
begin
  if tg_op = 'DELETE' then
    -- a delete that arrives from a foreign-key cascade runs one trigger level deeper than a direct statement
    if pg_trigger_depth() <= 1 then
      raise exception 'a symptom outcome cannot be deleted' using errcode = '42501';
    end if;
    return old;
  end if;
  if (to_jsonb(new) - c_free - c_fk) is distinct from (to_jsonb(old) - c_free - c_fk) then
    raise exception 'a symptom outcome cannot be changed except to retract it or to fill its map' using errcode = '42501';
  end if;
  -- a link column may only be cleared, never re-pointed
  if (new.summary_id is distinct from old.summary_id and new.summary_id is not null)
     or (new.appointment_id is distinct from old.appointment_id and new.appointment_id is not null)
     or (new.encounter_id is distinct from old.encounter_id and new.encounter_id is not null) then
    raise exception 'a symptom outcome cannot be re-pointed to another summary, appointment or encounter' using errcode = '42501';
  end if;
  if old.status = 'retracted' and (to_jsonb(new) - c_fk - 'updated_at') is distinct from (to_jsonb(old) - c_fk - 'updated_at') then
    raise exception 'a retracted symptom outcome cannot be changed' using errcode = '42501';
  end if;
  if old.mapped_category is not null
     and (new.mapped_category is distinct from old.mapped_category or new.mapping_version is distinct from old.mapping_version or new.agrees is distinct from old.agrees) then
    raise exception 'a computed symptom outcome mapping cannot be changed' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function private.symptom_encounter_outcomes_guard() from public, anon, authenticated;
create trigger symptom_encounter_outcomes_00_guard
  before update or delete on public.symptom_encounter_outcomes
  for each row execute function private.symptom_encounter_outcomes_guard();

-- the data registry (S39d) and the under-18 scope guard (S04b-1) both require every patient-keyed table to be classified
insert into public.data_registry (table_name, patient_expr, retention_class, end_of_retention, in_export, notes)
select t.table_name, 'patient_id', private.retention_class_for(t.table_name),
       case when private.retention_class_for(t.table_name) = 'operational' then 'delete' else 'review' end,
       private.retention_class_for(t.table_name) <> 'audit',
       'Registered with the default S39d classification when S59d was added; awaiting review.'
  from unnest(array['symptom_encounter_outcomes']) as t(table_name)
 where to_regclass('public.' || t.table_name) is not null
on conflict (table_name) do nothing;
select private.guard_minor_dependant_table('symptom_encounter_outcomes', 'patient_id');

-- ---------------------------------------------------------------------------
-- 5. Linking a signed note to the symptom check (the feed)
-- ---------------------------------------------------------------------------
-- The video consultation a note belongs to: its own, or the one of the note it amends (up to ten steps up).
create or replace function private.note_consultation_id(p_note uuid) returns uuid
language sql stable security definer set search_path = ''
as $$
  with recursive chain(id, vc, amends, depth) as (
    select n.id, n.video_consultation_id, n.amends_note_id, 1
      from public.clinical_encounter_notes n where n.id = p_note
    union all
    select n.id, n.video_consultation_id, n.amends_note_id, c.depth + 1
      from chain c join public.clinical_encounter_notes n on n.id = c.amends
     where c.vc is null and c.depth < 10)
  select vc from chain where vc is not null order by depth limit 1
$$;
revoke all on function private.note_consultation_id(uuid) from public, anon, authenticated;

-- Write the outcome row(s) for one signed note. Returns how many rows were created. Writes nothing unless EVERY link holds.
create or replace function private.record_symptom_outcomes_for_note(p_note uuid) returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  n public.clinical_encounter_notes%rowtype;
  v_vc uuid;
  v_appt public.appointments%rowtype;
  v_enc public.encounters%rowtype;
  v_signer uuid;
  v_test boolean;
  s record;
  v_given public.triage_category;
  v_map record;
  v_id uuid;
  v_count integer := 0;
begin
  select * into n from public.clinical_encounter_notes where id = p_note;
  if not found or n.status <> 'finalized' or n.diagnosis_code is null then return 0; end if;
  -- a note that has itself been amended by a signed note no longer speaks for the clinician
  if exists (select 1 from public.clinical_encounter_notes x where x.amends_note_id = n.id and x.status = 'finalized') then return 0; end if;
  v_vc := private.note_consultation_id(n.id);
  if v_vc is null then return 0; end if;
  select * into v_appt from public.appointments where video_consultation_id = v_vc and patient_id = n.patient_id limit 1;
  if not found then return 0; end if;
  select * into v_enc from public.encounters where appointment_id = v_appt.id and status = 'completed' limit 1;
  if not found then return 0; end if;
  select cs.profile_id into v_signer from public.clinical_staff cs where cs.id = n.finalized_by_staff;
  v_signer := coalesce(v_signer, n.authored_by_profile);
  if v_signer is null then return 0; end if;
  select coalesce(p.is_test, false) into v_test from public.profiles p where p.id = n.patient_id;

  for s in
    select sm.id as summary_id, a.id as assessment_id, a.organisation_id, a.category, a.override_category, a.protocol_version
      from public.symptom_session_summaries sm
      join public.symptom_triage_assessments a on a.id = sm.assessment_id
     where sm.appointment_id = v_appt.id and sm.patient_id = n.patient_id and a.patient_id = n.patient_id
  loop
    v_given := coalesce(s.override_category, s.category);
    select * into v_map from private.map_diagnosis_to_category(n.diagnosis_code);
    v_id := null;
    insert into public.symptom_encounter_outcomes
      (organisation_id, assessment_id, patient_id, summary_id, appointment_id, encounter_id, note_id, recorded_by, diagnosis_code,
       checker_category, given_category, mapped_category, mapping_version, agrees, protocol_version, outcome_at, is_test)
    values
      (s.organisation_id, s.assessment_id, n.patient_id, s.summary_id, v_appt.id, v_enc.id, n.id, v_signer, n.diagnosis_code,
       s.category, v_given, v_map.category, v_map.version,
       case when v_map.category is null then null else v_map.category = v_given end,
       s.protocol_version, coalesce(n.finalized_at, now()), coalesce(v_test, false))
    on conflict do nothing
    returning id into v_id;
    if v_id is not null then
      v_count := v_count + 1;
      begin
        perform private.emit_domain_event('symptom_outcome.recorded', s.organisation_id,
          jsonb_build_object('outcome_id', v_id, 'assessment_id', s.assessment_id), 'symptom_outcome.recorded:' || v_id,
          n.patient_id, 'symptom_encounter_outcome', v_id, 'normal');
      exception when others then
        insert into public.audit_log (organisation_id, action, entity_type, entity_id, event)
          values (s.organisation_id, 'symptom_outcome.event_error', 'symptom_encounter_outcome', v_id, jsonb_build_object('error', sqlerrm));
        perform private.page_incident(s.organisation_id, 'symptom_outcome_event_failed:' || v_id, 'A symptom outcome event could not be written',
          'The outcome row was recorded; only the symptom_outcome.recorded event failed. See audit_log action symptom_outcome.event_error.');
      end;
    end if;
  end loop;
  return v_count;
end $$;
revoke all on function private.record_symptom_outcomes_for_note(uuid) from public, anon, authenticated;

-- A signed amendment withdraws the original note's contribution. Returns how many rows were retracted.
create or replace function private.retract_symptom_outcomes_for_amendment(p_amending uuid) returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_orig uuid;
  r record;
  v_count integer := 0;
begin
  select amends_note_id into v_orig from public.clinical_encounter_notes where id = p_amending and status = 'finalized';
  if v_orig is null then return 0; end if;
  for r in
    with u as (
      update public.symptom_encounter_outcomes
         set status = 'retracted', retracted_at = now(), retracted_reason = 'note_amended', retracted_by_note_id = p_amending
       where note_id = v_orig and status = 'active'
      returning id, organisation_id, patient_id, assessment_id)
    select * from u
  loop
    v_count := v_count + 1;
    begin
      perform private.emit_domain_event('symptom_outcome.retracted', r.organisation_id,
        jsonb_build_object('outcome_id', r.id, 'assessment_id', r.assessment_id), 'symptom_outcome.retracted:' || r.id,
        r.patient_id, 'symptom_encounter_outcome', r.id, 'normal');
    exception when others then
      insert into public.audit_log (organisation_id, action, entity_type, entity_id, event)
        values (r.organisation_id, 'symptom_outcome.event_error', 'symptom_encounter_outcome', r.id, jsonb_build_object('error', sqlerrm));
      perform private.page_incident(r.organisation_id, 'symptom_outcome_event_failed:' || r.id, 'A symptom outcome event could not be written',
        'The outcome row was retracted; only the symptom_outcome.retracted event failed. See audit_log action symptom_outcome.event_error.');
    end;
  end loop;
  return v_count;
end $$;
revoke all on function private.retract_symptom_outcomes_for_amendment(uuid) from public, anon, authenticated;

-- Trigger 1: a note is signed. NEVER raises: the signature must not depend on this feed.
create or replace function private.symptom_outcome_from_note() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_go boolean;
begin
  -- OLD is only referenced for an UPDATE (it is not assigned in an INSERT trigger)
  if tg_op = 'INSERT' then
    v_go := new.status = 'finalized';
  else
    v_go := new.status = 'finalized' and old.status is distinct from 'finalized';
  end if;
  if v_go then
    begin
      if new.amends_note_id is not null then
        perform private.retract_symptom_outcomes_for_amendment(new.id);
      end if;
      perform private.record_symptom_outcomes_for_note(new.id);
    exception when others then
      -- nothing in this handler may raise: a failing audit insert or incident must never block the signature
      begin
        insert into public.audit_log (organisation_id, action, entity_type, entity_id, event)
          values (new.organisation_id, 'symptom_outcome.link_error', 'clinical_encounter_note', new.id, jsonb_build_object('error', sqlerrm));
      exception when others then null;
      end;
      begin
        perform private.page_incident(new.organisation_id, 'symptom_outcome_link_failed:' || new.id, 'A signed note could not be linked to a symptom check',
          'The note was signed normally; only the accuracy audit link failed. See audit_log action symptom_outcome.link_error.');
      exception when others then null;
      end;
    end;
  end if;
  return null;
end $$;
revoke all on function private.symptom_outcome_from_note() from public, anon, authenticated;
drop trigger if exists clinical_encounter_notes_zz_symptom_outcome on public.clinical_encounter_notes;
create trigger clinical_encounter_notes_zz_symptom_outcome
  after insert or update of status on public.clinical_encounter_notes
  for each row execute function private.symptom_outcome_from_note();

-- Trigger 2: the consultation is completed, after the note was already signed. NEVER raises.
create or replace function private.symptom_outcome_from_encounter() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  r record;
begin
  if new.status = 'completed' and old.status is distinct from 'completed' and new.video_consultation_id is not null then
    for r in
      select n.id from public.clinical_encounter_notes n
       where n.patient_id = new.patient_id and n.status = 'finalized' and n.diagnosis_code is not null
         and private.note_consultation_id(n.id) = new.video_consultation_id
       order by n.finalized_at, n.id
    loop
      -- one failing note never stops the next, and nothing here may raise: a failing audit insert must never block the completion
      begin
        perform private.record_symptom_outcomes_for_note(r.id);
      exception when others then
        begin
          insert into public.audit_log (organisation_id, action, entity_type, entity_id, event)
            values (new.organisation_id, 'symptom_outcome.link_error', 'clinical_encounter_note', r.id, jsonb_build_object('error', sqlerrm, 'encounter_id', new.id));
        exception when others then null;
        end;
        begin
          perform private.page_incident(new.organisation_id, 'symptom_outcome_link_failed:' || r.id, 'A completed consultation could not be linked to a symptom check',
            'The consultation was completed normally; only the accuracy audit link failed. See audit_log action symptom_outcome.link_error.');
        exception when others then null;
        end;
      end;
    end loop;
  end if;
  return null;
end $$;
revoke all on function private.symptom_outcome_from_encounter() from public, anon, authenticated;
drop trigger if exists encounters_zz_symptom_outcome on public.encounters;
create trigger encounters_zz_symptom_outcome
  after update of status on public.encounters
  for each row execute function private.symptom_outcome_from_encounter();

-- ---------------------------------------------------------------------------
-- 6. The CMO confirms a map (fills the NULLs of active rows once); nothing else changes a row
-- ---------------------------------------------------------------------------
create or replace function private.apply_urgency_map_to_outcomes() returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_n integer;
begin
  update public.symptom_encounter_outcomes o
     set mapped_category = x.category, mapping_version = x.version, agrees = (x.category = o.given_category)
    from (select o2.id, mp.category, mp.version
            from public.symptom_encounter_outcomes o2
           cross join lateral private.map_diagnosis_to_category(o2.diagnosis_code) mp
           where o2.status = 'active' and o2.mapped_category is null) x
   where o.id = x.id;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function private.apply_urgency_map_to_outcomes() from public, anon, authenticated;

create or replace function public.confirm_symptom_diagnosis_urgency_map(p_version integer) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  m public.symptom_diagnosis_urgency_maps%rowtype;
  v_n integer;
begin
  if v_uid is null or not private.credential_is_cmo() then
    raise exception 'only the Chief Medical Officer can confirm the diagnosis to urgency map' using errcode = '42501';
  end if;
  select * into m from public.symptom_diagnosis_urgency_maps where version = p_version for update;
  if not found then raise exception 'unknown map version' using errcode = '22023'; end if;
  if not private.symptom_urgency_map_valid(m.config) then
    raise exception 'this map is not valid: every entry needs an ICD-10 prefix and one of the four categories, with no prefix twice' using errcode = '22023';
  end if;
  update public.symptom_diagnosis_urgency_maps set is_active = false where is_active and version <> p_version;
  update public.symptom_diagnosis_urgency_maps set is_active = true, confirmed_by = v_uid, confirmed_at = now() where version = p_version;
  v_n := private.apply_urgency_map_to_outcomes();
  perform private.log_audit('symptom_urgency_map.confirmed', 'symptom_diagnosis_urgency_map', null, jsonb_build_object('version', p_version, 'outcomes_mapped', v_n));
  return jsonb_build_object('ok', true, 'version', p_version, 'outcomes_mapped', v_n);
end $$;
revoke all on function public.confirm_symptom_diagnosis_urgency_map(integer) from public;
grant execute on function public.confirm_symptom_diagnosis_urgency_map(integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. The audited, tied read of ONE assessment's outcome (no staff-wide list exists)
-- ---------------------------------------------------------------------------
create or replace function public.read_symptom_outcome_audited(p_assessment uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_patient uuid;
  v_complaint text;
  v_repro boolean;
  v_rows jsonb;
begin
  if p_reason is null or char_length(btrim(p_reason)) < 10 then
    raise exception 'a reason of at least 10 characters is required' using errcode = '22023';
  end if;
  if (select auth.uid()) is null or not private.is_reviewing_clinician() then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  select patient_id, presenting_complaint_key into v_patient, v_complaint from public.symptom_triage_assessments where id = p_assessment;
  if v_patient is null then
    -- even "no such assessment" is audited (there is no patient to name, so the assessment id and the reason go in the event)
    perform private.log_audit('symptom_outcome.read_not_found', 'symptom_assessment', p_assessment, jsonb_build_object('reason', p_reason));
    return jsonb_build_object('status', 'not_found');
  end if;
  -- reproductive_health is never available through break-glass (private.has_emergency_access excludes it), so a pregnancy pathway
  -- session, or any outcome with a pregnancy ICD-10 code (chapter O), is read under that category: the per-patient tie and nothing else
  v_repro := v_complaint = 'pregnancy_danger_signs'
             or exists (select 1 from public.symptom_encounter_outcomes o where o.assessment_id = p_assessment and o.diagnosis_code like 'O%');
  if not private.can_staff_read_clinical(v_patient,
       case when v_repro then 'reproductive_health'::public.care_access_category else 'medical_history'::public.care_access_category end) then
    perform private.audit_chart_read(v_patient, array['symptom_outcome'], p_reason, 'denied');
    return jsonb_build_object('status', 'denied');
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', o.id, 'status', o.status, 'diagnosis_code', o.diagnosis_code, 'checker_category', o.checker_category,
           'given_category', o.given_category, 'mapped_category', o.mapped_category, 'mapping_version', o.mapping_version,
           'agrees', o.agrees, 'computed', o.mapped_category is not null, 'outcome_at', o.outcome_at,
           'retracted_at', o.retracted_at, 'retracted_reason', o.retracted_reason) order by o.outcome_at), '[]'::jsonb)
    into v_rows
    from public.symptom_encounter_outcomes o where o.assessment_id = p_assessment;
  perform private.audit_chart_read(v_patient, array['symptom_outcome'], p_reason, 'success');
  return jsonb_build_object('status', 'ok', 'outcomes', v_rows);
end $$;
revoke all on function public.read_symptom_outcome_audited(uuid, text) from public;
grant execute on function public.read_symptom_outcome_audited(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 8a. A report says when it includes auto-fed rows, and why that is not like-for-like
alter table public.symptom_accuracy_reports
  add column if not exists includes_auto_outcomes boolean not null default false,
  add column if not exists caveat text;
comment on column public.symptom_accuracy_reports.caveat is
  'S59d: set when the report includes auto-fed outcomes. They exist only for people who sent a summary and booked a consultation, a selected group, so the figures are not comparable with manual reviews and are not an accuracy claim.';

-- 8. The monthly audit now includes the auto-fed rows, with a source breakdown (replaces the S60 function, same signature)
-- ---------------------------------------------------------------------------
create or replace function private.run_symptom_accuracy_audit(p_org uuid, p_month date, p_include_test boolean default false, p_by uuid default null)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_start date := date_trunc('month', p_month::timestamp)::date;
  v_end date := (date_trunc('month', p_month::timestamp) + interval '1 month')::date;
  -- month boundaries are Africa/Lagos midnights, whatever the session time zone
  v_start_ts timestamptz := (date_trunc('month', p_month::timestamp)) at time zone 'Africa/Lagos';
  v_end_ts timestamptz := (date_trunc('month', p_month::timestamp) + interval '1 month') at time zone 'Africa/Lagos';
  cfg public.symptom_accuracy_config%rowtype;
  v_min integer;
  v_conf numeric;
  v_bands jsonb;
  v_cells jsonb;
  v_total integer;
  v_auto integer;
  v_id uuid;
begin
  select id into v_id from public.symptom_accuracy_reports
   where organisation_id = p_org and period_start = v_start and includes_test_accounts = p_include_test;
  if v_id is not null then return v_id; end if;

  select * into cfg from public.symptom_accuracy_config where is_active;
  if not found then raise exception 'no active symptom_accuracy_config' using errcode = 'P0001'; end if;
  v_min := (cfg.config ->> 'min_cell_size')::integer;
  v_conf := (cfg.config ->> 'confidence_level')::numeric;
  v_bands := cfg.config -> 'age_bands';
  if v_min is null or v_min < 5 then raise exception 'min_cell_size must be at least 5' using errcode = '22023'; end if;

  with src as (
    -- (1) a clinician's manual review
    select r.assessment_id, a.category as checker_cat, r.clinician_category as clin_cat, r.patient_id, r.reviewed_at as at_ts,
           'manual_review'::text as source
      from public.symptom_reviews r
      join public.symptom_triage_assessments a on a.id = r.assessment_id
      join public.profiles p on p.id = r.patient_id
     where r.organisation_id = p_org and r.status = 'completed'
       and r.reviewed_at >= v_start_ts and r.reviewed_at < v_end_ts
       and (p_include_test or (not r.is_test and not coalesce(p.is_test, false)))
    union all
    -- (2) a signed consultation diagnosis, only when the CMO-confirmed map gave it a category, and never for an assessment that
    -- also has a completed manual review (an assessment is counted once; the manual review wins)
    select o.assessment_id, a.category, o.mapped_category, o.patient_id, o.outcome_at, 'encounter_auto'::text
      from public.symptom_encounter_outcomes o
      join public.symptom_triage_assessments a on a.id = o.assessment_id
      join public.profiles p on p.id = o.patient_id
     where o.organisation_id = p_org and o.status = 'active' and o.mapped_category is not null
       and o.outcome_at >= v_start_ts and o.outcome_at < v_end_ts
       and (p_include_test or (not o.is_test and not coalesce(p.is_test, false)))
       and not exists (select 1 from public.symptom_reviews r2 where r2.assessment_id = o.assessment_id and r2.status = 'completed')
  ),
  base as (
    select
      (s.checker_cat = s.clin_cat) as matched,
      (private.triage_rank(s.checker_cat) < private.triage_rank(s.clin_cat)) as is_under,
      (private.triage_rank(s.checker_cat) > private.triage_rank(s.clin_cat)) as is_over,
      coalesce((select (b ->> 0) || '-' || (b ->> 1)
                  from jsonb_array_elements(v_bands) b
                 where p.date_of_birth is not null
                   and extract(year from age((s.at_ts at time zone 'Africa/Lagos')::date, p.date_of_birth))::integer between (b ->> 0)::integer and (b ->> 1)::integer
                 limit 1), 'unknown') as age_band,
      coalesce(p.sex::text, 'unknown') as sex,
      coalesce(nullif(btrim(p.state), ''), 'unknown') as region,
      s.source
    from src s
    join public.profiles p on p.id = s.patient_id
  ),
  dims as (
    select 'overall'::text as dimension, 'all'::text as grp, count(*)::integer n,
           count(*) filter (where matched)::integer n_matched, count(*) filter (where is_under)::integer n_under, count(*) filter (where is_over)::integer n_over from base
    union all select 'age_band', age_band, count(*)::integer, count(*) filter (where matched)::integer, count(*) filter (where is_under)::integer, count(*) filter (where is_over)::integer from base group by age_band
    union all select 'sex', sex, count(*)::integer, count(*) filter (where matched)::integer, count(*) filter (where is_under)::integer, count(*) filter (where is_over)::integer from base group by sex
    union all select 'region', region, count(*)::integer, count(*) filter (where matched)::integer, count(*) filter (where is_under)::integer, count(*) filter (where is_over)::integer from base group by region
    union all select 'source', source, count(*)::integer, count(*) filter (where matched)::integer, count(*) filter (where is_under)::integer, count(*) filter (where is_over)::integer from base group by source
  ),
  flagged as (
    select d.*,
           (d.n < v_min) as small,
           count(*) filter (where d.n < v_min) over (partition by d.dimension) as small_in_dim,
           row_number() over (partition by d.dimension, (d.n < v_min) order by d.n, d.grp) as rn_in_class
      from dims d
  ),
  decided as (
    select f.*,
           -- complementary suppression: one suppressed cell is recoverable by subtraction, so suppress the smallest remaining one too
           (f.small or (f.dimension <> 'overall' and f.small_in_dim = 1 and not f.small and f.rn_in_class = 1)) as suppress
      from flagged f
  )
  select coalesce(jsonb_agg(
           case when d.suppress then
             jsonb_build_object('dimension', d.dimension, 'group', d.grp, 'suppressed', true)
           else
             jsonb_build_object('dimension', d.dimension, 'group', d.grp, 'suppressed', false, 'n', d.n,
               'matched', d.n_matched, 'under', d.n_under, 'over', d.n_over,
               'match_rate', round(d.n_matched::numeric / d.n, 4), 'under_rate', round(d.n_under::numeric / d.n, 4), 'over_rate', round(d.n_over::numeric / d.n, 4),
               'match_low', (private.wilson_interval(d.n_matched, d.n, v_conf))[1], 'match_high', (private.wilson_interval(d.n_matched, d.n, v_conf))[2],
               'under_low', (private.wilson_interval(d.n_under, d.n, v_conf))[1], 'under_high', (private.wilson_interval(d.n_under, d.n, v_conf))[2],
               'over_low', (private.wilson_interval(d.n_over, d.n, v_conf))[1], 'over_high', (private.wilson_interval(d.n_over, d.n, v_conf))[2])
           end order by d.dimension, d.grp), '[]'::jsonb),
         coalesce(max(d.n) filter (where d.dimension = 'overall'), 0),
         coalesce(max(d.n) filter (where d.dimension = 'source' and d.grp = 'encounter_auto'), 0)
    into v_cells, v_total, v_auto
    from decided d;

  insert into public.symptom_accuracy_reports
    (organisation_id, period_start, period_end, config_version, is_baseline, includes_test_accounts, reviewed_total, cells, generated_by, includes_auto_outcomes, caveat)
  values
    (p_org, v_start, v_end, cfg.version,
     -- the baseline is the first report that has something in it, per basis (real accounts, or test accounts deliberately included).
     -- An empty month is recorded but is never the baseline: an empty record must not read as a baseline in the go-live condition.
     v_total > 0 and not exists (select 1 from public.symptom_accuracy_reports x
                                  where x.organisation_id = p_org and x.is_baseline and x.includes_test_accounts = p_include_test),
     p_include_test, v_total, v_cells, p_by, v_auto > 0,
     case when v_auto > 0 then 'Includes outcomes fed automatically from signed consultation diagnoses. These exist only for people who sent a summary and booked a consultation, a selected group, so the figures are not comparable with manual reviews and are not an accuracy claim.' end)
  on conflict (organisation_id, period_start, includes_test_accounts) do nothing
  returning id into v_id;
  if v_id is null then
    select id into v_id from public.symptom_accuracy_reports
     where organisation_id = p_org and period_start = v_start and includes_test_accounts = p_include_test;
  end if;
  return v_id;
end $$;
revoke all on function private.run_symptom_accuracy_audit(uuid, date, boolean, uuid) from public, anon, authenticated;

-- The scheduled monthly job: the previous month, every organisation with a manual review OR a computed auto-fed outcome.
create or replace function private.run_symptom_accuracy_audit_monthly() returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_month date := (date_trunc('month', now() at time zone 'Africa/Lagos') - interval '1 month')::date;
  v_from timestamptz := (date_trunc('month', now() at time zone 'Africa/Lagos') - interval '1 month') at time zone 'Africa/Lagos';
  v_to timestamptz := date_trunc('month', now() at time zone 'Africa/Lagos') at time zone 'Africa/Lagos';
  r record;
  v_n integer := 0;
begin
  for r in
    select distinct x.organisation_id from (
      select s.organisation_id
        from public.symptom_reviews s
        join public.profiles p on p.id = s.patient_id
       where s.status = 'completed' and not s.is_test and not coalesce(p.is_test, false)
         and s.reviewed_at >= v_from and s.reviewed_at < v_to
      union
      select o.organisation_id
        from public.symptom_encounter_outcomes o
        join public.profiles p on p.id = o.patient_id
       where o.status = 'active' and o.mapped_category is not null and not o.is_test and not coalesce(p.is_test, false)
         and o.outcome_at >= v_from and o.outcome_at < v_to
    ) x
  loop
    begin
      perform private.run_symptom_accuracy_audit(r.organisation_id, v_month, false, null);
      v_n := v_n + 1;
    exception when others then
      insert into public.audit_log (organisation_id, action, entity_type, event)
        values (r.organisation_id, 'symptom_accuracy_audit.error', 'symptom_accuracy_report', jsonb_build_object('month', v_month, 'error', sqlerrm));
      perform private.page_incident(r.organisation_id, 'symptom_accuracy_audit_failed:' || v_month, 'The monthly symptom checker audit failed',
        'The monthly accuracy audit could not be produced; see audit_log action symptom_accuracy_audit.error.');
    end;
  end loop;
  return v_n;
end $$;
revoke all on function private.run_symptom_accuracy_audit_monthly() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 9. Closing assertions
-- ---------------------------------------------------------------------------
do $$
declare
  v_fn text;
begin
  if (select count(*) from public.symptom_diagnosis_urgency_maps where is_active or confirmed_at is not null) <> 0 then
    raise exception 'S59d assertion: a diagnosis to urgency map is active or confirmed';
  end if;
  if not private.symptom_urgency_map_valid((select config from public.symptom_diagnosis_urgency_maps where version = 1)) then
    raise exception 'S59d assertion: the draft map v1 is not valid';
  end if;
  if exists (select 1 from private.map_diagnosis_to_category('I21.9')) then
    raise exception 'S59d assertion: a diagnosis was mapped while no map is confirmed';
  end if;
  if has_table_privilege('authenticated', 'public.symptom_encounter_outcomes', 'SELECT')
     or has_table_privilege('authenticated', 'public.symptom_encounter_outcomes', 'INSERT')
     or has_table_privilege('authenticated', 'public.symptom_encounter_outcomes', 'UPDATE')
     or has_table_privilege('authenticated', 'public.symptom_encounter_outcomes', 'DELETE')
     or has_table_privilege('anon', 'public.symptom_encounter_outcomes', 'SELECT') then
    raise exception 'S59d assertion: an API role can reach symptom_encounter_outcomes directly';
  end if;
  if exists (select 1 from pg_policy where polrelid = 'public.symptom_encounter_outcomes'::regclass) then
    raise exception 'S59d assertion: symptom_encounter_outcomes has a policy; reads must go through the audited function';
  end if;
  foreach v_fn in array array[
    'public.read_symptom_outcome_audited(uuid,text)', 'public.confirm_symptom_diagnosis_urgency_map(integer)',
    'public.set_encounter_note_diagnosis_code(uuid,text)', 'private.run_symptom_accuracy_audit(uuid,date,boolean,uuid)',
    'private.record_symptom_outcomes_for_note(uuid)', 'private.apply_urgency_map_to_outcomes()'] loop
    if has_function_privilege('anon', v_fn, 'EXECUTE') then raise exception 'S59d assertion: anon can execute %', v_fn; end if;
  end loop;
  foreach v_fn in array array[
    'private.record_symptom_outcomes_for_note(uuid)', 'private.retract_symptom_outcomes_for_amendment(uuid)',
    'private.apply_urgency_map_to_outcomes()', 'private.map_diagnosis_to_category(text)'] loop
    if has_function_privilege('authenticated', v_fn, 'EXECUTE') then raise exception 'S59d assertion: authenticated can execute %', v_fn; end if;
  end loop;
  if not exists (select 1 from pg_trigger where tgname = 'clinical_encounter_notes_zz_symptom_outcome' and not tgisinternal)
     or not exists (select 1 from pg_trigger where tgname = 'encounters_zz_symptom_outcome' and not tgisinternal) then
    raise exception 'S59d assertion: a feed trigger is missing';
  end if;
  if exists (select 1 from private.minor_guard_gaps() g where g.table_name = 'symptom_encounter_outcomes') then
    raise exception 'S59d assertion: symptom_encounter_outcomes escapes the under-18 scope guard';
  end if;
end $$;
