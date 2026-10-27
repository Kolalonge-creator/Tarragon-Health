-- S76-S80 scribe gap closure (all dark: AI-017 stays disabled, runtime_governed stays false).
--
-- 1. public.scribe_signed_diffs (append-only, versioned per note): when a clinician signs a note that began as an AI scribe draft, one row links
--    the hash of the visit text, the model and prompt version, the AI draft text, the text actually signed (read from the note row by the
--    server, never supplied by the client) and a word-level diff. The draft hash must equal one already recorded in scribe_review_events for
--    the same note, so the two records cannot describe different drafts. Read: the clinician who wrote it, or the Chief Medical Officer for
--    audit. This stores AI draft text, which S35c deliberately did not; it exists only for notes that were then signed (INV-11).
-- 2. public.scribe_draft_reports (append-only): "Report a problem with this draft", a fixed taxonomy (invented content, omission, wrong
--    medicine or dose, wrong patient, other) over four draft kinds, with an optional short comment.
-- 3. Two CMO reads that give counts only: public.scribe_diff_edit_rates and public.scribe_problem_counts.
-- 4. A governed prompt for the three new draft kinds (letter, prescription proposal, follow-up tasks), inserted as an UNAPPROVED, INACTIVE
--    ai_prompt_versions row on AI-017. Nothing here approves or activates it: public.activate_ai_prompt_version, which only a Clinical
--    Director can run for a high-risk system, is the only way, and public.scribe_document_prompt() returns nothing until then, so the edge
--    function refuses those three kinds. A human's approval is not invented here.
--
-- Row counts at writing: scribe_review_events 0 and ai_drafted notes 0 (S35c migration header), so there is nothing to backfill.

-- ---------------------------------------------------------------------------
-- 1. Signed diff record
-- ---------------------------------------------------------------------------
create function private.scribe_text_sections_valid(p jsonb) returns boolean
language sql immutable set search_path = ''
as $$
  select jsonb_typeof(p) = 'object'
     and (select count(*) from jsonb_object_keys(p)) = 6
     and p ?& array['history', 'examination', 'assessment', 'plan', 'followUp', 'patientSummary']
     and not exists (select 1 from jsonb_each(p) e where jsonb_typeof(e.value) <> 'string' or char_length(e.value #>> '{}') > 20000);
$$;
revoke all on function private.scribe_text_sections_valid(jsonb) from public, anon, authenticated;

create function private.scribe_diff_valid(p jsonb) returns boolean
language sql immutable set search_path = ''
as $$
  select jsonb_typeof(p) = 'object'
     and (select count(*) from jsonb_object_keys(p)) = 6
     and p ?& array['history', 'examination', 'assessment', 'plan', 'followUp', 'patientSummary']
     and not exists (
       select 1 from jsonb_each(p) e
        where jsonb_typeof(e.value) <> 'object'
           or jsonb_typeof(e.value -> 'ops') <> 'array'
           or jsonb_typeof(e.value -> 'draft_words') <> 'number'
           or jsonb_typeof(e.value -> 'signed_words') <> 'number'
           or jsonb_typeof(e.value -> 'words_added') <> 'number'
           or jsonb_typeof(e.value -> 'words_removed') <> 'number'
           or (e.value ->> 'draft_words')::numeric < 0 or (e.value ->> 'signed_words')::numeric < 0
           or (e.value ->> 'words_added')::numeric < 0 or (e.value ->> 'words_removed')::numeric < 0
           or (e.value ->> 'draft_words')::numeric <> trunc((e.value ->> 'draft_words')::numeric)
           or (e.value ->> 'signed_words')::numeric <> trunc((e.value ->> 'signed_words')::numeric)
           or (e.value ->> 'words_added')::numeric <> trunc((e.value ->> 'words_added')::numeric)
           or (e.value ->> 'words_removed')::numeric <> trunc((e.value ->> 'words_removed')::numeric)
     );
$$;
revoke all on function private.scribe_diff_valid(jsonb) from public, anon, authenticated;

create table public.scribe_signed_diffs (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  note_id uuid not null references public.clinical_encounter_notes (id) on delete restrict,
  version integer not null check (version >= 1),
  scribe_consent_id uuid not null references public.scribe_consents (id) on delete restrict,
  clinician_profile_id uuid not null references public.profiles (id) on delete restrict,
  transcript_hash text not null check (transcript_hash ~ '^[0-9a-f]{64}$'),
  model_id text not null check (char_length(model_id) between 1 and 100),
  prompt_version text not null check (char_length(prompt_version) between 1 and 40),
  draft_hash text not null check (draft_hash ~ '^[0-9a-f]{64}$'),
  source text not null check (source in ('stt', 'typed')),
  ai_draft jsonb not null check (private.scribe_text_sections_valid(ai_draft)),
  signed_text jsonb not null check (private.scribe_text_sections_valid(signed_text)),
  diff jsonb not null check (private.scribe_diff_valid(diff)),
  draft_words integer not null check (draft_words >= 0),
  words_added integer not null check (words_added >= 0),
  words_removed integer not null check (words_removed >= 0),
  is_test boolean not null default false,
  created_at timestamptz not null default now(),
  constraint scribe_signed_diffs_note_version unique (note_id, version)
);
create index scribe_signed_diffs_created_idx on public.scribe_signed_diffs (created_at);
comment on table public.scribe_signed_diffs is
  'S76-S80: one row per AI scribe draft taken into a note that is then signed. Hash of the visit text, model and prompt version, the AI draft, the signed text and a word-level diff. Append-only; clinician-own read plus CMO audit read.';

alter table public.scribe_signed_diffs enable row level security;
-- Own rows only. The row holds the full AI draft and the signed note text (clinical content), so the CMO gets no direct read: the S39 rule is that
-- a staff read of clinical text is tied to a reason and audited. The CMO sees edit rates through scribe_diff_edit_rates (counts only).
create policy scribe_signed_diffs_read on public.scribe_signed_diffs for select to authenticated
  using (clinician_profile_id = (select auth.uid()));
grant select on public.scribe_signed_diffs to authenticated;
revoke insert, update, delete, truncate on public.scribe_signed_diffs from authenticated, anon;

create function private.scribe_append_only_guard() returns trigger
language plpgsql security definer set search_path = ''
as $$ begin raise exception '% is append-only', tg_table_name using errcode = '42501'; end $$;
revoke all on function private.scribe_append_only_guard() from public, anon, authenticated;
create trigger scribe_signed_diffs_no_change before update or delete on public.scribe_signed_diffs
  for each row execute function private.scribe_append_only_guard();

create function public.record_scribe_signed_diff(
  p_note uuid, p_consent uuid, p_transcript_hash text, p_model text, p_prompt_version text, p_draft_hash text,
  p_source text, p_ai_draft jsonb, p_diff jsonb)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_patient uuid;
  n public.clinical_encounter_notes;
  c record;
  v_version integer;
  v_signed jsonb;
  v_draft_words integer;
  v_added integer;
  v_removed integer;
  v_id uuid;
begin
  if not exists (select 1 from public.clinical_staff cs where cs.profile_id = (select auth.uid()) and cs.active) then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  v_patient := private.may_work_on_note(p_note);
  select * into n from public.clinical_encounter_notes where id = p_note;
  if n.status <> 'draft' then
    raise exception 'This encounter note is finalized and cannot be edited.' using errcode = '42501';
  end if;
  select * into c from public.scribe_consents where id = p_consent;
  if c.id is null or not c.granted or c.revoked_at is not null
     or c.encounter_note_id is distinct from p_note or c.patient_id <> v_patient then
    raise exception 'Scribe consent is not active for this encounter.' using errcode = '42501';
  end if;
  if p_transcript_hash is null or p_transcript_hash !~ '^[0-9a-f]{64}$' or p_draft_hash is null or p_draft_hash !~ '^[0-9a-f]{64}$'
     or p_source not in ('stt', 'typed') or p_model is null or p_prompt_version is null then
    raise exception 'The diff record is not in the expected shape.' using errcode = '22023';
  end if;
  if not private.scribe_text_sections_valid(p_ai_draft) or not private.scribe_diff_valid(p_diff) then
    raise exception 'The diff record is not in the expected shape.' using errcode = '22023';
  end if;
  -- the draft being diffed must be the one already recorded for this note by record_scribe_review
  if not exists (select 1 from public.scribe_review_events r where r.note_id = p_note and r.draft_hash = p_draft_hash) then
    raise exception 'No review record for this draft on this note.' using errcode = '42501';
  end if;
  -- the signed text is what the note holds now, read here, never supplied by the caller
  v_signed := jsonb_build_object(
    'history', coalesce(n.history, ''), 'examination', coalesce(n.examination_findings, ''), 'assessment', coalesce(n.assessment, ''),
    'plan', coalesce(n.plan, ''), 'followUp', coalesce(n.follow_up_instructions, ''), 'patientSummary', coalesce(n.patient_summary, ''));
  select coalesce(sum((e.value ->> 'draft_words')::integer), 0), coalesce(sum((e.value ->> 'words_added')::integer), 0),
         coalesce(sum((e.value ->> 'words_removed')::integer), 0)
    into v_draft_words, v_added, v_removed from jsonb_each(p_diff) e;
  select coalesce(max(d.version), 0) + 1 into v_version from public.scribe_signed_diffs d where d.note_id = p_note;
  insert into public.scribe_signed_diffs (organisation_id, note_id, version, scribe_consent_id, clinician_profile_id, transcript_hash, model_id,
      prompt_version, draft_hash, source, ai_draft, signed_text, diff, draft_words, words_added, words_removed, is_test)
  values (n.organisation_id, p_note, v_version, p_consent, v_uid, p_transcript_hash, p_model, p_prompt_version, p_draft_hash, p_source,
      p_ai_draft, v_signed, p_diff, v_draft_words, v_added, v_removed, coalesce(n.is_test, false))
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.record_scribe_signed_diff(uuid, uuid, text, text, text, text, text, jsonb, jsonb) from public, anon;
grant execute on function public.record_scribe_signed_diff(uuid, uuid, text, text, text, text, text, jsonb, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. "Report a problem with this draft"
-- ---------------------------------------------------------------------------
create table public.scribe_draft_reports (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  note_id uuid not null references public.clinical_encounter_notes (id) on delete restrict,
  scribe_consent_id uuid references public.scribe_consents (id) on delete restrict,
  clinician_profile_id uuid not null references public.profiles (id) on delete restrict,
  draft_kind text not null check (draft_kind in ('note', 'letter', 'prescription_proposal', 'follow_up_tasks')),
  section text check (section is null or section in ('history', 'examination', 'assessment', 'plan', 'followUp', 'patientSummary')),
  category text not null check (category in ('invented_content', 'omission', 'wrong_medicine_or_dose', 'wrong_patient', 'other')),
  comment text check (comment is null or char_length(comment) <= 500),
  is_test boolean not null default false,
  created_at timestamptz not null default now()
);
create index scribe_draft_reports_created_idx on public.scribe_draft_reports (created_at);
create index scribe_draft_reports_note_idx on public.scribe_draft_reports (note_id);
comment on table public.scribe_draft_reports is
  'S76-S80: a clinician''s report of a problem with an AI scribe draft, fixed taxonomy. Append-only; reporter-own read plus CMO read.';

alter table public.scribe_draft_reports enable row level security;
create policy scribe_draft_reports_read on public.scribe_draft_reports for select to authenticated
  using (clinician_profile_id = (select auth.uid()) or (private.credential_is_cmo() and organisation_id = private.current_org_id()));
grant select on public.scribe_draft_reports to authenticated;
revoke insert, update, delete, truncate on public.scribe_draft_reports from authenticated, anon;
create trigger scribe_draft_reports_no_change before update or delete on public.scribe_draft_reports
  for each row execute function private.scribe_append_only_guard();

create function public.report_scribe_draft_problem(
  p_note uuid, p_consent uuid, p_kind text, p_section text, p_category text, p_comment text default null)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_patient uuid;
  v_org uuid;
  v_test boolean;
  c record;
  v_id uuid;
begin
  if not exists (select 1 from public.clinical_staff cs where cs.profile_id = (select auth.uid()) and cs.active) then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  v_patient := private.may_work_on_note(p_note);
  select n.organisation_id, n.is_test into v_org, v_test from public.clinical_encounter_notes n where n.id = p_note;
  if p_consent is not null then
    select * into c from public.scribe_consents where id = p_consent;
    if c.id is null or c.encounter_note_id is distinct from p_note or c.patient_id <> v_patient then
      raise exception 'That scribe consent does not belong to this encounter.' using errcode = '42501';
    end if;
  end if;
  insert into public.scribe_draft_reports (organisation_id, note_id, scribe_consent_id, clinician_profile_id, draft_kind, section, category, comment, is_test)
  values (v_org, p_note, p_consent, v_uid, p_kind, p_section, p_category, nullif(btrim(coalesce(p_comment, '')), ''), coalesce(v_test, false))
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.report_scribe_draft_problem(uuid, uuid, text, text, text, text) from public, anon;
grant execute on function public.report_scribe_draft_problem(uuid, uuid, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. CMO reads: counts only
-- ---------------------------------------------------------------------------
create function public.scribe_diff_edit_rates(p_from timestamptz default now() - interval '90 days', p_to timestamptz default now())
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_out jsonb;
begin
  if not private.credential_is_cmo() then
    raise exception 'only the Chief Medical Officer can read scribe quality' using errcode = '42501';
  end if;
  select jsonb_build_object(
           'drafts', (select count(*) from public.scribe_signed_diffs d where d.organisation_id = private.current_org_id() and d.created_at >= p_from and d.created_at <= p_to and not d.is_test),
           'draft_words', (select coalesce(sum(d.draft_words), 0) from public.scribe_signed_diffs d where d.organisation_id = private.current_org_id() and d.created_at >= p_from and d.created_at <= p_to and not d.is_test),
           'words_added', (select coalesce(sum(d.words_added), 0) from public.scribe_signed_diffs d where d.organisation_id = private.current_org_id() and d.created_at >= p_from and d.created_at <= p_to and not d.is_test),
           'words_removed', (select coalesce(sum(d.words_removed), 0) from public.scribe_signed_diffs d where d.organisation_id = private.current_org_id() and d.created_at >= p_from and d.created_at <= p_to and not d.is_test),
           'sections', coalesce(jsonb_object_agg(s.section, s.counts), '{}'::jsonb))
    into v_out
    from (
      select e.key as section,
             jsonb_build_object(
               'drafts_changed', count(*) filter (where (e.value ->> 'words_added')::integer > 0 or (e.value ->> 'words_removed')::integer > 0),
               'draft_words', coalesce(sum((e.value ->> 'draft_words')::integer), 0),
               'words_added', coalesce(sum((e.value ->> 'words_added')::integer), 0),
               'words_removed', coalesce(sum((e.value ->> 'words_removed')::integer), 0)) as counts
        from public.scribe_signed_diffs d
        cross join lateral jsonb_each(d.diff) e
       where d.organisation_id = private.current_org_id() and d.created_at >= p_from and d.created_at <= p_to and not d.is_test
       group by e.key
    ) s;
  return v_out;
end $$;
revoke all on function public.scribe_diff_edit_rates(timestamptz, timestamptz) from public, anon;
grant execute on function public.scribe_diff_edit_rates(timestamptz, timestamptz) to authenticated;

create function public.scribe_problem_counts(p_from timestamptz default now() - interval '90 days', p_to timestamptz default now())
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.credential_is_cmo() then
    raise exception 'only the Chief Medical Officer can read scribe quality' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'total', (select count(*) from public.scribe_draft_reports r where r.organisation_id = private.current_org_id() and r.created_at >= p_from and r.created_at <= p_to and not r.is_test),
    'by_category', coalesce((select jsonb_object_agg(x.category, x.n) from (
        select r.category, count(*) as n from public.scribe_draft_reports r
         where r.organisation_id = private.current_org_id() and r.created_at >= p_from and r.created_at <= p_to and not r.is_test group by r.category) x), '{}'::jsonb),
    'by_kind', coalesce((select jsonb_object_agg(x.draft_kind, x.n) from (
        select r.draft_kind, count(*) as n from public.scribe_draft_reports r
         where r.organisation_id = private.current_org_id() and r.created_at >= p_from and r.created_at <= p_to and not r.is_test group by r.draft_kind) x), '{}'::jsonb));
end $$;
revoke all on function public.scribe_problem_counts(timestamptz, timestamptz) from public, anon;
grant execute on function public.scribe_problem_counts(timestamptz, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Governed prompt for the new draft kinds: UNAPPROVED and INACTIVE
-- ---------------------------------------------------------------------------
-- Text mirrors DOCUMENT_COMMON_PROMPT and DOCUMENT_KIND_INSTRUCTIONS in supabase/functions/_shared/scribe/documents.ts
-- (scribe-documents-mirror.test.ts compares them). approved_by, approved_at, activated_by, activated_at stay null and is_active false.
insert into public.ai_prompt_versions (ai_system_id, version, system_prompt, safety_instructions, retrieval_config, output_constraints, model_config, change_summary, is_active)
select s.id,
       coalesce((select max(pv.version) from public.ai_prompt_versions pv where pv.ai_system_id = s.id), 0) + 1,
       $p$You write drafts for a clinician at TarragonHealth, a Nigerian digital health platform.
You receive a list of facts the clinician has already confirmed from a consultation, each with an id.
Use ONLY those facts. Never add a finding, diagnosis, medicine, dose or date that is not in them. If a fact is missing, leave the field out.
Everything you write is a draft for the clinician to check and change. It is not a prescription, an order or a letter that has been sent.
Respond with the JSON object only.$p$,
       $p$A prescription proposal is a proposal only. It never creates, changes or stops a medicine. A follow-up task is created only when the clinician accepts it. Every output is marked AI-drafted, unsigned.$p$,
       '{}'::jsonb,
       jsonb_build_object(
         'prompt_version', 'scribe-documents-v1',
         'kinds', jsonb_build_object(
           'letter', $p$Write a short, plain letter from the clinician about this consultation, for the patient or for another clinician. Warm, clear, no jargon, no more than 250 words. Do not state a medicine or dose unless a confirmed fact states it.$p$,
           'prescription_proposal', $p$List only medicines that a confirmed fact says were discussed or planned. For each give medicine, dose, frequency, duration and the reason, copied from the facts; use an empty string for anything the facts do not say. Cite the id of the fact each item comes from. Propose nothing that is not in the facts.$p$,
           'follow_up_tasks', $p$List the follow-up actions a confirmed fact says were planned (a review, a test, a call, a referral to chase). For each give a short description, how many days from today it is due, and the id of the fact it comes from. If the facts give no timing, use 14.$p$)),
       '{"model": "claude-sonnet-5-5", "max_tokens": 4096}'::jsonb,
       'S76-S80 draft kinds (letter, prescription proposal, follow-up tasks). UNAPPROVED: needs the Clinical Director to review the text and activate it with activate_ai_prompt_version. Not approved by this migration.',
       false
  from public.ai_systems s
 where s.system_code = 'AI-017'
   and not exists (select 1 from public.ai_prompt_versions pv where pv.ai_system_id = s.id and pv.output_constraints ->> 'prompt_version' = 'scribe-documents-v1');

-- The edge function asks here. Null until a human has approved and activated a prompt that carries the kinds.
create function public.scribe_document_prompt() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v jsonb;
begin
  if not exists (select 1 from public.clinical_staff cs where cs.profile_id = (select auth.uid()) and cs.active) then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  v := private.active_ai_prompt('AI-017');
  if v is null or not (v -> 'output_constraints' ? 'kinds') then
    return null;
  end if;
  return v;
end $$;
revoke all on function public.scribe_document_prompt() from public, anon;
grant execute on function public.scribe_document_prompt() to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.record_scribe_signed_diff(uuid,uuid,text,text,text,text,text,jsonb,jsonb)', 'EXECUTE')
     or has_function_privilege('anon', 'public.report_scribe_draft_problem(uuid,uuid,text,text,text,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.scribe_diff_edit_rates(timestamptz,timestamptz)', 'EXECUTE')
     or has_function_privilege('anon', 'public.scribe_problem_counts(timestamptz,timestamptz)', 'EXECUTE')
     or has_function_privilege('anon', 'public.scribe_document_prompt()', 'EXECUTE') then
    raise exception 'S76: anon can execute a scribe function';
  end if;
  if has_table_privilege('authenticated', 'public.scribe_signed_diffs', 'INSERT') or has_table_privilege('authenticated', 'public.scribe_draft_reports', 'INSERT') then
    raise exception 'S76: authenticated can insert a scribe record directly';
  end if;
  if exists (select 1 from public.ai_prompt_versions pv join public.ai_systems s on s.id = pv.ai_system_id
              where s.system_code = 'AI-017' and pv.output_constraints ->> 'prompt_version' = 'scribe-documents-v1'
                and (pv.is_active or pv.approved_at is not null or pv.approved_by is not null or pv.activated_at is not null)) then
    raise exception 'S76: the document prompt must be inserted unapproved and inactive';
  end if;
end $$;
