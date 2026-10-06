-- S35c: what the scribe review leaves behind, a hash of exactly what was signed, the patient's consent answer for the
-- clinician's screen, and two CMO quality reads.
--
-- 1. public.scribe_review_events (append-only): one row each time a clinician takes an AI draft into a note. It records
--    which model and prompt version produced the draft, a hash of the draft as generated, and for each section whether
--    the clinician left it unchanged, edited it, emptied it, or added text where the model wrote none, and whether it
--    was flagged as a possible omission. It stores NO draft text and no transcript: the AI output stays off the record
--    until the note is signed (INV-11). This is the data behind "edit rates by section".
-- 2. clinical_encounter_notes.signed_content_hash: stamped by trigger when a draft becomes finalized, sha256 of the
--    signed text fields. A finalized note cannot be edited (existing trigger), so the hash can be re-checked later with
--    public.note_content_matches_hash(note). Existing finalized notes keep a null hash (they were signed before this).
-- 3. public.scribe_consent_state(note): the PATIENT's in-app answer (S21), read for the clinician's screen: not_asked,
--    given or declined, so the scribe panel shows it instead of letting the clinician click "agree" for the patient (S21g
--    already refuses a granted row without the patient's answer; this makes the screen say so before the click).
-- 4. public.scribe_edit_rates(from, to) and public.scribe_audit_sample(n, from, to): CMO only. Rates are counts; the
--    sample returns note ids, author and date only (no text); reading a sampled note goes through the audited note read.
--
-- Row counts at writing: scribe_consents 0, ai_drafted notes 0, so there is nothing to backfill.

-- ---------------------------------------------------------------------------
-- 1. Review record
-- ---------------------------------------------------------------------------
create table public.scribe_review_events (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  note_id uuid not null references public.clinical_encounter_notes (id) on delete restrict,
  scribe_consent_id uuid not null references public.scribe_consents (id) on delete restrict,
  clinician_profile_id uuid not null references public.profiles (id) on delete restrict,
  model_id text not null check (char_length(model_id) between 1 and 100),
  prompt_version text not null check (char_length(prompt_version) between 1 and 40),
  draft_hash text not null check (draft_hash ~ '^[0-9a-f]{64}$'),
  source text not null check (source in ('stt', 'typed')),
  sections jsonb not null,
  is_test boolean not null default false,
  created_at timestamptz not null default now()
);
create index scribe_review_events_note_idx on public.scribe_review_events (note_id);
create index scribe_review_events_created_idx on public.scribe_review_events (created_at);
comment on table public.scribe_review_events is
  'S35c: one row per AI scribe draft taken into a note. Hash and per-section outcome only; no draft text, no transcript.';

alter table public.scribe_review_events enable row level security;
create policy scribe_review_events_read on public.scribe_review_events for select to authenticated
  using (clinician_profile_id = (select auth.uid()) or private.credential_is_cmo());
grant select on public.scribe_review_events to authenticated;
revoke insert, update, delete, truncate on public.scribe_review_events from authenticated, anon;

create function private.scribe_review_events_append_only() returns trigger
language plpgsql security definer set search_path = ''
as $$ begin raise exception 'scribe_review_events is append-only' using errcode = '42501'; end $$;
revoke all on function private.scribe_review_events_append_only() from public, anon, authenticated;
create trigger scribe_review_events_no_change before update or delete on public.scribe_review_events
  for each row execute function private.scribe_review_events_append_only();

create function private.scribe_sections_valid(p jsonb) returns boolean
language sql immutable set search_path = ''
as $$
  select jsonb_typeof(p) = 'object'
     and (select count(*) from jsonb_object_keys(p)) = 6
     and p ?& array['history', 'examination', 'assessment', 'plan', 'followUp', 'patientSummary']
     and not exists (
       select 1 from jsonb_each(p) e
        where jsonb_typeof(e.value) <> 'object'
           or e.value ->> 'state' not in ('unchanged', 'edited', 'emptied', 'added', 'empty_kept')
           or jsonb_typeof(e.value -> 'flagged_empty') <> 'boolean'
     );
$$;
revoke all on function private.scribe_sections_valid(jsonb) from public, anon, authenticated;

create function public.record_scribe_review(
  p_note uuid, p_consent uuid, p_model text, p_prompt_version text, p_draft_hash text, p_source text, p_sections jsonb)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_patient uuid;
  v_status text;
  v_org uuid;
  v_test boolean;
  c record;
  v_id uuid;
begin
  if not exists (select 1 from public.clinical_staff cs where cs.profile_id = (select auth.uid()) and cs.active) then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  v_patient := private.may_work_on_note(p_note);
  select n.status, n.organisation_id, n.is_test into v_status, v_org, v_test from public.clinical_encounter_notes n where n.id = p_note;
  if v_status <> 'draft' then
    raise exception 'This encounter note is finalized and cannot be edited.' using errcode = '42501';
  end if;
  select * into c from public.scribe_consents where id = p_consent;
  if c.id is null or not c.granted or c.revoked_at is not null
     or c.encounter_note_id is distinct from p_note or c.patient_id <> v_patient then
    raise exception 'Scribe consent is not active for this encounter.' using errcode = '42501';
  end if;
  if not private.scribe_sections_valid(p_sections) then
    raise exception 'The section outcomes are not in the expected shape.' using errcode = '22023';
  end if;
  insert into public.scribe_review_events (organisation_id, note_id, scribe_consent_id, clinician_profile_id, model_id, prompt_version,
                                            draft_hash, source, sections, is_test)
  values (v_org, p_note, p_consent, v_uid, p_model, p_prompt_version, p_draft_hash, p_source, p_sections, coalesce(v_test, false))
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.record_scribe_review(uuid, uuid, text, text, text, text, jsonb) from public, anon;
grant execute on function public.record_scribe_review(uuid, uuid, text, text, text, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Hash of exactly what was signed
-- ---------------------------------------------------------------------------
alter table public.clinical_encounter_notes add column signed_content_hash text
  check (signed_content_hash is null or signed_content_hash ~ '^[0-9a-f]{64}$');
comment on column public.clinical_encounter_notes.signed_content_hash is
  'S35c: sha256 of the signed text fields at the moment the note was finalized. Null for notes finalized before it existed.';

create function private.note_content_hash(n public.clinical_encounter_notes) returns text
language sql immutable set search_path = ''
as $$
  select encode(sha256(convert_to(jsonb_build_object(
    'reason', n.reason_for_encounter, 'history', n.history, 'examination', n.examination_findings,
    'assessment', n.assessment, 'diagnosis', n.diagnosis, 'plan', n.plan, 'follow_up', n.follow_up_instructions,
    'patient_summary', n.patient_summary, 'outcome', n.outcome::text)::text, 'utf8')), 'hex');
$$;
revoke all on function private.note_content_hash(public.clinical_encounter_notes) from public, anon, authenticated;

create function private.stamp_signed_content_hash() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if old.status = 'draft' and new.status = 'finalized' then
    new.signed_content_hash := private.note_content_hash(new);
  end if;
  return new;
end $$;
revoke all on function private.stamp_signed_content_hash() from public, anon, authenticated;
-- named to sort after clinical_encounter_notes_enforce_attribution, so it sees the row as it will be stored
create trigger clinical_encounter_notes_stamp_hash before update on public.clinical_encounter_notes
  for each row execute function private.stamp_signed_content_hash();

create function public.note_content_matches_hash(p_note uuid) returns boolean
language plpgsql stable security definer set search_path = ''
as $$
declare n public.clinical_encounter_notes;
begin
  if not exists (select 1 from public.clinical_staff cs where cs.profile_id = (select auth.uid()) and cs.active) then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  perform private.may_work_on_note(p_note);
  select * into n from public.clinical_encounter_notes where id = p_note;
  if n.signed_content_hash is null then return null; end if;
  return n.signed_content_hash = private.note_content_hash(n);
end $$;
revoke all on function public.note_content_matches_hash(uuid) from public, anon;
grant execute on function public.note_content_matches_hash(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. The patient's consent answer, for the clinician's screen
-- ---------------------------------------------------------------------------
create function public.scribe_consent_state(p_note uuid) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_patient uuid;
  n record;
  e record;
  c record;
begin
  if not exists (select 1 from public.clinical_staff cs where cs.profile_id = (select auth.uid()) and cs.active) then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  v_patient := private.may_work_on_note(p_note);
  select video_consultation_id into n from public.clinical_encounter_notes where id = p_note;
  select en.id, en.status into e from public.encounters en
   where en.patient_id = v_patient and en.clinician_id = v_uid
     and en.video_consultation_id is not null and en.video_consultation_id = n.video_consultation_id
   order by en.scheduled_at desc nulls last limit 1;
  if e.id is null then
    return jsonb_build_object('state', 'no_consultation');
  end if;
  select granted into c from public.consultation_scribe_consents where encounter_id = e.id;
  return jsonb_build_object(
    'state', case when c.granted is null then 'not_asked' when c.granted then 'given' else 'declined' end,
    'encounter_id', e.id,
    'live', e.status = 'in_progress',
    'may_start', public.scribe_may_start(e.id));
end $$;
revoke all on function public.scribe_consent_state(uuid) from public, anon;
grant execute on function public.scribe_consent_state(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. CMO quality reads: edit rates by section, and a random sample of AI-drafted signed notes
-- ---------------------------------------------------------------------------
create function public.scribe_edit_rates(p_from timestamptz default now() - interval '90 days', p_to timestamptz default now())
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_out jsonb;
begin
  if not private.credential_is_cmo() then
    raise exception 'only the Chief Medical Officer can read scribe quality' using errcode = '42501';
  end if;
  select jsonb_build_object(
           'reviews', (select count(*) from public.scribe_review_events r where r.created_at >= p_from and r.created_at <= p_to and not r.is_test),
           'sections', coalesce(jsonb_object_agg(s.section, s.counts), '{}'::jsonb))
    into v_out
    from (
      select k.section,
             jsonb_build_object(
               'unchanged', count(*) filter (where e.value ->> 'state' = 'unchanged'),
               'edited', count(*) filter (where e.value ->> 'state' = 'edited'),
               'emptied', count(*) filter (where e.value ->> 'state' = 'emptied'),
               'added', count(*) filter (where e.value ->> 'state' = 'added'),
               'empty_kept', count(*) filter (where e.value ->> 'state' = 'empty_kept'),
               'flagged_empty', count(*) filter (where (e.value ->> 'flagged_empty')::boolean)) as counts
        from public.scribe_review_events r
        cross join lateral jsonb_each(r.sections) e
        cross join lateral (select e.key as section) k
       where r.created_at >= p_from and r.created_at <= p_to and not r.is_test
       group by k.section
    ) s;
  return v_out;
end $$;
revoke all on function public.scribe_edit_rates(timestamptz, timestamptz) from public, anon;
grant execute on function public.scribe_edit_rates(timestamptz, timestamptz) to authenticated;

create function public.scribe_audit_sample(p_n integer default 10, p_from timestamptz default now() - interval '90 days', p_to timestamptz default now())
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.credential_is_cmo() then
    raise exception 'only the Chief Medical Officer can read scribe quality' using errcode = '42501';
  end if;
  if p_n is null or p_n < 1 or p_n > 50 then
    raise exception 'sample size must be between 1 and 50' using errcode = '22023';
  end if;
  return coalesce((select jsonb_agg(to_jsonb(s)) from (
    select n.id as note_id, n.finalized_at, n.authored_by_profile as author_profile_id, n.signed_content_hash is not null as has_hash
      from public.clinical_encounter_notes n
     where n.ai_drafted and n.status = 'finalized' and not n.is_test
       and n.finalized_at >= p_from and n.finalized_at <= p_to
     order by random() limit p_n) s), '[]'::jsonb);
end $$;
revoke all on function public.scribe_audit_sample(integer, timestamptz, timestamptz) from public, anon;
grant execute on function public.scribe_audit_sample(integer, timestamptz, timestamptz) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.record_scribe_review(uuid,uuid,text,text,text,text,jsonb)', 'EXECUTE')
     or has_function_privilege('anon', 'public.scribe_consent_state(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.scribe_edit_rates(timestamptz,timestamptz)', 'EXECUTE')
     or has_function_privilege('anon', 'public.scribe_audit_sample(integer,timestamptz,timestamptz)', 'EXECUTE')
     or has_function_privilege('anon', 'public.note_content_matches_hash(uuid)', 'EXECUTE') then
    raise exception 'S35c: anon can execute a scribe function';
  end if;
  if has_table_privilege('authenticated', 'public.scribe_review_events', 'INSERT') then
    raise exception 'S35c: authenticated can insert scribe_review_events directly';
  end if;
end $$;
