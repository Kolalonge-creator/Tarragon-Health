-- S55 (Module 9, Health Learning Centre), part 1 of 2: foundation.
--
-- Builds on the F1 expiry gate (20261007002357); does not redo it. Adds, on top of the existing
-- health_education_* tables (spec names map onto them: content_items = health_education_content,
-- course_progress = health_education_progress + programme modules):
--   * versioned learning configuration (synonyms, micro-lesson shape, offline pack caps, search log rules)
--   * the "What can I do next?" self-care block, micro-lesson fields, audio clip id (S32 manifest seam),
--     a draft placeholder flag, a share flag and a creator credit on health_education_content
--   * learning_creators: invite-only, verified clinicians, credited by name (revenue share NOT built: OQ-S55-02)
--   * a publish gate: an item cannot reach 'published' without a named reviewer, a review date in the
--     future, a source, a self-care action, no placeholder flag, a verified creator (if credited) and the
--     micro-lesson shape (if a micro-lesson)
--   * the myth-busting series (kind 'series', inactive) with six DRAFT placeholder items, titles only
--   * learning_saved_for_consultation and learning_search_gaps (aggregate, no patient reference)
-- Rows affected: 0 existing content rows are changed (235 seeded published items stay as they are and are
-- reported by learning_readiness_report() in part 2). Six new draft placeholder rows and one inactive series
-- programme are inserted.

-- ---------------------------------------------------------------------------
-- 1. Versioned learning configuration (PROPOSED values; mirrored in packages/shared proposed-config)
-- ---------------------------------------------------------------------------
create table if not exists public.learning_config (
  id         uuid primary key default gen_random_uuid(),
  key        text not null check (key ~ '^[a-z_]+$'),
  version    integer not null check (version >= 1),
  value      jsonb not null,
  status     text not null default 'proposed' check (status in ('proposed', 'confirmed')),
  is_active  boolean not null default true,
  note       text,
  created_at timestamptz not null default now(),
  unique (key, version)
);
alter table public.learning_config enable row level security;
grant select on public.learning_config to authenticated;
revoke insert, update, delete on public.learning_config from authenticated;
drop policy if exists learning_config_read on public.learning_config;
create policy learning_config_read on public.learning_config for select to authenticated using (true);

comment on table public.learning_config is
  'S55: versioned PROPOSED values for the Learning Centre. Read by any signed-in user (the phone needs the offline caps and the synonym table); written only by migration or the service role. A new version supersedes an older one; never edit a row.';

create or replace function private.learning_config(p_key text)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select c.value from public.learning_config c
   where c.key = p_key and c.is_active
   order by c.version desc limit 1;
$$;
revoke execute on function private.learning_config(text) from public;
grant execute on function private.learning_config(text) to authenticated, service_role;

-- The seeds sit between the markers; packages/shared/src/proposed-config/learning-mirror.test.ts parses them
-- and fails if they drift from the registry.
-- learning-micro-lesson-begin
insert into public.learning_config (key, version, value, status, note) values
('micro_lesson', 1, $json${"max_minutes":5,"check_questions":1}$json$::jsonb, 'proposed',
 'Spec 9.2: a daily lesson takes under five minutes, asks for one action and ends in one check question.')
on conflict (key, version) do nothing;
-- learning-micro-lesson-end

-- learning-offline-pack-begin
insert into public.learning_config (key, version, value, status, note) values
('offline_pack', 1, $json${"max_total_bytes":25000000,"max_items":150,"audio_wifi_only":true}$json$::jsonb, 'proposed',
 'Spec 9.6: text plus audio downloads. Size cap for one phone, counted over text and audio together. Expired and unpublished items are never included.')
on conflict (key, version) do nothing;
-- learning-offline-pack-end

-- learning-search-gap-begin
insert into public.learning_config (key, version, value, status, note) values
('search_gap_log', 1, $json${"enabled":false,"max_query_chars":60,"max_words":6,"min_count_to_show":3,"retention_days":180,"max_rows":5000}$json$::jsonb, 'proposed',
 'Spec 9.3: zero-result searches are logged for content planning. OFF (enabled false) until the founder and the DPO confirm it (OQ-S55-05); only a search the person submitted is ever logged. No patient or organisation reference is stored; a phrase is shown to admins only once it has been searched at least min_count_to_show times (searches, not distinct people: see OQ-S55-05), and no new phrase is added once max_rows exist.')
on conflict (key, version) do nothing;
-- learning-search-gap-end

-- learning-synonyms-begin
insert into public.learning_config (key, version, value, status, note) values
('search_synonyms', 1, $json$[
  {"terms":["bp","blood pressure","pressure","high blood","hypertension","bp reading"]},
  {"terms":["sugar","diabetes","blood sugar","glucose","sugar level","high sugar"]},
  {"terms":["belle","pregnancy","pregnant","antenatal","expecting"]},
  {"terms":["heart","cardiac"]},
  {"terms":["drug","drugs","medicine","medicines","medication","tablets","pills"]},
  {"terms":["kidney","kidneys","kidney disease","ckd"]},
  {"terms":["hot body","fever","high temperature"]},
  {"terms":["weight","overweight","belly fat","obesity"]},
  {"terms":["sleep","insomnia","cannot sleep","sleeping"]},
  {"terms":["salt","sodium"]},
  {"terms":["exercise","workout","walking","physical activity"]},
  {"terms":["vaccine","vaccines","vaccination","immunisation","immunization"]},
  {"terms":["tired","fatigue","weak body"]},
  {"terms":["herb","herbs","herbal","local medicine","agbo"]}
]$json$::jsonb, 'proposed',
 'Spec 9.3: everyday and local words people type, grouped so that any one finds the others. Search expansion only; it never says one condition is another. Some entries are Nigerian everyday words, not a translation: see OQ-S55-01.')
on conflict (key, version) do nothing;
-- learning-synonyms-end

-- ---------------------------------------------------------------------------
-- 2. Creators: invite-only verified clinicians (admin invites a clinician profile; nobody self-registers)
-- ---------------------------------------------------------------------------
create table if not exists public.learning_creators (
  id                   uuid primary key default gen_random_uuid(),
  organisation_id      uuid not null references public.organisations(id) on delete restrict,
  profile_id           uuid not null unique references public.profiles(id) on delete restrict,
  display_name         text not null check (char_length(btrim(display_name)) between 2 and 120),
  mdcn_number          text,
  credential_evidence  text,
  indemnity_confirmed  boolean not null default false,
  status               text not null default 'invited'
                         check (status in ('invited', 'pending_verification', 'verified', 'suspended', 'declined')),
  invited_by           uuid references public.profiles(id) on delete restrict,
  invited_at           timestamptz not null default now(),
  verified_by          uuid references public.profiles(id) on delete restrict,
  verified_at          timestamptz,
  status_note          text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint learning_creators_verified_needs_evidence check (
    status <> 'verified'
    or (mdcn_number is not null and char_length(btrim(mdcn_number)) >= 4
        and credential_evidence is not null and char_length(btrim(credential_evidence)) >= 10
        and indemnity_confirmed
        and verified_by is not null and verified_at is not null)
  )
);
create index if not exists learning_creators_status_idx on public.learning_creators (status);
alter table public.learning_creators enable row level security;
grant select, insert, update, delete on public.learning_creators to authenticated;

drop policy if exists learning_creators_admin on public.learning_creators;
create policy learning_creators_admin on public.learning_creators for all to authenticated
  using (private.is_admin()) with check (private.is_admin());
drop policy if exists learning_creators_own_read on public.learning_creators;
create policy learning_creators_own_read on public.learning_creators for select to authenticated
  using (profile_id = (select auth.uid()));

comment on table public.learning_creators is
  'S55 (spec 9.7): invite-only clinician creators. Only an admin creates a row (by inviting an existing clinician login). Verification needs an MDCN number, credential evidence and an indemnity confirmation, by a different admin from the creator. Credited by display_name on the items they author. Revenue share is NOT built (OQ-S55-02).';

drop trigger if exists learning_creators_set_updated_at on public.learning_creators;
create trigger learning_creators_set_updated_at before update on public.learning_creators
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. Content columns
-- ---------------------------------------------------------------------------
alter table public.health_education_content
  add column if not exists audio_clip_id    text,
  add column if not exists self_care_action text,
  add column if not exists is_micro_lesson  boolean not null default false,
  add column if not exists lesson_action    text,
  add column if not exists is_placeholder   boolean not null default false,
  add column if not exists share_enabled    boolean not null default true,
  add column if not exists creator_id       uuid references public.learning_creators(id) on delete restrict;

alter table public.health_education_content
  drop constraint if exists health_education_content_audio_clip_id_check;
alter table public.health_education_content
  add constraint health_education_content_audio_clip_id_check
  check (audio_clip_id is null or audio_clip_id ~ '^[A-Z]{3}-[A-Z0-9]+$');
alter table public.health_education_content
  drop constraint if exists health_education_content_placeholder_stays_draft;
alter table public.health_education_content
  add constraint health_education_content_placeholder_stays_draft
  check (not is_placeholder or content_status = 'draft');

create index if not exists health_education_content_micro_idx
  on public.health_education_content (sort_order) where is_micro_lesson;
create index if not exists health_education_content_creator_idx
  on public.health_education_content (creator_id) where creator_id is not null;

comment on column public.health_education_content.audio_clip_id is
  'S32 audio manifest clip id for a spoken version of this item (seam; the phone plays it through the audio service and always shows the text).';
comment on column public.health_education_content.self_care_action is
  'The authored self-care step in the required "What can I do next?" block (spec 9.4). The ask-your-care-team, book and emergency actions are fixed by the template, not authored.';
comment on column public.health_education_content.is_placeholder is
  'DRAFT placeholder: structure only, no clinical content. Cannot leave draft. Clearing the flag needs a named clinical author and a real body.';

-- ---------------------------------------------------------------------------
-- 4. The publish gate (on insert as published, and on any move to published)
-- ---------------------------------------------------------------------------
create or replace function private.health_education_publish_gate()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_micro  jsonb;
  v_status text;
  v_today  date := (now() at time zone 'Africa/Lagos')::date;
begin
  -- placeholder flag: only a clinical author can clear it
  if tg_op = 'UPDATE' and old.is_placeholder and not new.is_placeholder then
    if new.clinical_author_name is null or char_length(btrim(new.clinical_author_name)) < 3 then
      raise exception 'A placeholder needs a named clinical author before it can become real content' using errcode = '23514';
    end if;
    if new.body ilike 'DRAFT PLACEHOLDER%' then
      raise exception 'Replace the placeholder body with clinical content before clearing the placeholder flag' using errcode = '23514';
    end if;
  end if;

  if new.content_status = 'published'
     and (tg_op = 'INSERT' or old.content_status is distinct from 'published') then
    if new.is_placeholder then
      raise exception 'A draft placeholder cannot be published: it needs a clinical author and clinical approval' using errcode = '23514';
    end if;
    if coalesce(new.clinician_reviewed, false) is not true
       or new.reviewed_by_name is null or char_length(btrim(new.reviewed_by_name)) < 3
       or new.reviewed_at is null then
      raise exception 'Publishing needs a named clinical reviewer and a review date' using errcode = '23514';
    end if;
    if (new.source_reference is null or char_length(btrim(new.source_reference)) < 3)
       and (new.evidence_source is null or char_length(btrim(new.evidence_source)) < 3) then
      raise exception 'Publishing needs a source (source_reference or evidence_source)' using errcode = '23514';
    end if;
    if new.next_review_due is null or new.next_review_due <= v_today then
      raise exception 'Publishing needs a next_review_due in the future' using errcode = '23514';
    end if;
    if new.self_care_action is null or char_length(btrim(new.self_care_action)) < 5 then
      raise exception 'Publishing needs the "What can I do next?" self-care action' using errcode = '23514';
    end if;
    if new.creator_id is not null then
      select c.status into v_status from public.learning_creators c where c.id = new.creator_id;
      if v_status is distinct from 'verified' then
        raise exception 'The credited creator is not verified' using errcode = '23514';
      end if;
    end if;
    if new.is_micro_lesson then
      v_micro := private.learning_config('micro_lesson');
      if new.estimated_minutes is null or new.estimated_minutes < 1
         or new.estimated_minutes > (v_micro ->> 'max_minutes')::integer then
        raise exception 'A micro-lesson must take no more than % minutes', v_micro ->> 'max_minutes' using errcode = '23514';
      end if;
      if new.lesson_action is null or char_length(btrim(new.lesson_action)) < 5 then
        raise exception 'A micro-lesson needs its one action' using errcode = '23514';
      end if;
      if jsonb_typeof(new.knowledge_check) is distinct from 'array'
         or jsonb_array_length(new.knowledge_check) <> (v_micro ->> 'check_questions')::integer then
        raise exception 'A micro-lesson ends in exactly % check question(s)', v_micro ->> 'check_questions' using errcode = '23514';
      end if;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists health_education_publish_gate on public.health_education_content;
create trigger health_education_publish_gate
  before insert or update on public.health_education_content
  for each row execute function private.health_education_publish_gate();

-- ---------------------------------------------------------------------------
-- 5. Series flag on programmes, and the myth-busting series with six DRAFT placeholders
-- ---------------------------------------------------------------------------
alter table public.health_education_programmes
  add column if not exists kind text not null default 'course' check (kind in ('course', 'series'));

insert into public.health_education_programmes (code, title, description, category, is_active, sort_order, kind)
values ('myth_busting', 'Common health myths',
        'A clinician-authored series on common myths. INACTIVE until a clinical author has written and the Chief Medical Officer has approved every item.',
        'getting_started', false, 900, 'series')
on conflict (code) do nothing;

do $$
declare
  v_prog uuid;
  v_id   uuid;
  v_row  record;
  v_n    integer := 0;
begin
  select id into v_prog from public.health_education_programmes where code = 'myth_busting';
  for v_row in
    select * from (values
      (1, 'myth-draft-01', 'Myth series, draft 1: herbal remedies and your prescribed medicines (needs clinical author)', 'medicines'::public.health_education_category),
      (2, 'myth-draft-02', 'Myth series, draft 2: stopping medicine when you feel well (needs clinical author)', 'medicines'),
      (3, 'myth-draft-03', 'Myth series, draft 3: sugar and diabetes (needs clinical author)', 'diabetes'),
      (4, 'myth-draft-04', 'Myth series, draft 4: age and blood pressure (needs clinical author)', 'hypertension'),
      (5, 'myth-draft-05', 'Myth series, draft 5: salt and seasoning in everyday cooking (needs clinical author)', 'nutrition'),
      (6, 'myth-draft-06', 'Myth series, draft 6: vaccines and injections (needs clinical author)', 'vaccination')
    ) as t(n, code, title, category)
  loop
    insert into public.health_education_content (code, title, summary, body, category, content_status, is_placeholder, sort_order)
    values (v_row.code, v_row.title,
            'Needs a clinical author. No clinical content has been written.',
            'DRAFT PLACEHOLDER. This topic needs a clinical author. Nothing here is medical guidance and it cannot be shown to patients until a clinician has written it and it has been clinically approved.',
            v_row.category, 'draft', true, 900 + v_row.n)
    on conflict (code) do nothing
    returning id into v_id;
    if v_id is null then
      select id into v_id from public.health_education_content where code = v_row.code;
    else
      v_n := v_n + 1;
    end if;
    insert into public.health_education_programme_modules (programme_id, content_id, module_number, title)
    values (v_prog, v_id, v_row.n, v_row.title)
    on conflict (programme_id, module_number) do nothing;
  end loop;
  raise notice 'S55: % placeholder rows inserted', v_n;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Zero-result search log: aggregate only, no patient or organisation reference
-- ---------------------------------------------------------------------------
create table if not exists public.learning_search_gaps (
  query_norm text primary key check (char_length(query_norm) between 2 and 120),
  hit_count  integer not null default 1 check (hit_count >= 1),
  first_seen date not null default ((now() at time zone 'Africa/Lagos')::date),
  last_seen  date not null default ((now() at time zone 'Africa/Lagos')::date)
);
create index if not exists learning_search_gaps_last_seen_idx on public.learning_search_gaps (last_seen);
alter table public.learning_search_gaps enable row level security;
grant select on public.learning_search_gaps to authenticated;
revoke insert, update, delete on public.learning_search_gaps from authenticated;
drop policy if exists learning_search_gaps_admin_read on public.learning_search_gaps;
create policy learning_search_gaps_admin_read on public.learning_search_gaps for select to authenticated
  using (private.is_admin());

comment on table public.learning_search_gaps is
  'S55 (spec 9.3): searches that found nothing, for content planning. A normalised phrase and a count only: no user, organisation, device or time of day. Rows are written only by search_health_education(), skip anything that looks like an identifier, and are deleted after the configured retention.';

-- ---------------------------------------------------------------------------
-- 7. Lessons a patient saved to talk about at the next consultation
-- ---------------------------------------------------------------------------
create table if not exists public.learning_saved_for_consultation (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete restrict,
  patient_id      uuid not null references public.profiles(id) on delete cascade,
  content_id      uuid not null references public.health_education_content(id) on delete cascade,
  saved_at        timestamptz not null default now(),
  discussed_at    timestamptz,
  unique (patient_id, content_id)
);
create index if not exists learning_saved_patient_idx on public.learning_saved_for_consultation (patient_id, saved_at desc);
alter table public.learning_saved_for_consultation enable row level security;
grant select, delete on public.learning_saved_for_consultation to authenticated;
revoke insert, update on public.learning_saved_for_consultation from authenticated;
drop policy if exists learning_saved_own_read on public.learning_saved_for_consultation;
create policy learning_saved_own_read on public.learning_saved_for_consultation for select to authenticated
  using (patient_id = (select auth.uid()));
drop policy if exists learning_saved_own_delete on public.learning_saved_for_consultation;
create policy learning_saved_own_delete on public.learning_saved_for_consultation for delete to authenticated
  using (patient_id = (select auth.uid()));

comment on table public.learning_saved_for_consultation is
  'S55 (spec 9.4): "ask your care team" saves a lesson here. Written only by save_lesson_for_consultation(). A clinician reads it only through consultation_saved_lessons(), which needs a tie to the patient and writes an audit row (INV-10, INV-12).';

-- ---------------------------------------------------------------------------
-- 8. Events (ids only, INV-07)
-- ---------------------------------------------------------------------------
insert into public.event_types (event_type, description, owner_section, is_urgent) values
  ('lesson.completed', 'A patient completed a learning lesson (marked understood)', 'S55', false),
  ('course.completed', 'A patient completed every lesson of a learning course', 'S55', false)
on conflict (event_type) do nothing;
insert into public.event_type_versions (event_type, version, required_keys) values
  ('lesson.completed', 1, array['content_id', 'content_code']),
  ('course.completed', 1, array['programme_id', 'programme_code'])
on conflict (event_type, version) do nothing;

-- ---------------------------------------------------------------------------
-- self-check
-- ---------------------------------------------------------------------------
do $$
begin
  if (select count(*) from public.health_education_content where is_placeholder) < 6 then
    raise exception 'S55: the six placeholders are missing';
  end if;
  if exists (select 1 from public.health_education_content where is_placeholder and (is_active or content_status <> 'draft')) then
    raise exception 'S55: a placeholder is live';
  end if;
  if (select count(*) from public.learning_config where is_active) < 4 then
    raise exception 'S55: config seeds missing';
  end if;
  if has_table_privilege('anon', 'public.learning_creators', 'SELECT')
     or has_table_privilege('anon', 'public.learning_search_gaps', 'SELECT')
     or has_table_privilege('anon', 'public.learning_saved_for_consultation', 'SELECT') then
    raise exception 'S55: anon can read a learning table';
  end if;
end $$;
