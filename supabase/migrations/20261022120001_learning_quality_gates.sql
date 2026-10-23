-- Learning quality gates (S55 follow-up, item 12): (a) a reading-grade gate on publishing patient content, (b) a reviewed tap-to-define glossary,
-- (c) a private teach-back quiz at the end of a lesson. Part 1 of 2; part 2 (record-triggered lessons, the food portion guide, DRAFT seeds)
-- sorts after this file.
--
-- NOTHING IS SWITCHED ON, NOTHING IS APPROVED, NOTHING EXISTING IS CHANGED:
--   * The reading-grade gate only looks at an item as it moves to 'published'. The 235 items already published are not re-checked or edited (a
--     read-only report, learning_reading_grade_report(), lists which of them are above the PROPOSED maximum so the CMO can see the size of it).
--   * No glossary term is published. Eight DRAFT terms are seeded with no reviewer, so learning_glossary() returns nothing until the CMO publishes one.
--   * No lesson has a teach-back yet (column null everywhere). A result exists only after a person answers.
-- Rows affected: health_education_content gains nullable columns (0 rows change value); learning_config gains 2 rows (reading_grade, teachback);
-- 2 new patient/catalogue tables and 8 DRAFT glossary rows are inserted.
--
-- WHY THE GRADE IS COMPUTED IN THE DATABASE: the gate must not trust a number a client sends. private.reading_grade() repeats the formula in
-- packages/shared/src/learning/reading-grade.ts word for word; both are pinned by the same golden vectors (Jest and packages/db/tests/reading_grade_gate.sql).
-- Why a trigger and not a replacement of private.health_education_publish_gate(): that function has been patched by several migrations; a separate
-- trigger adds the rule without copying (and risking the deletion of) anyone's body.
--
-- GLOSSARY AND TEACH-BACK TABLES. The glossary is a global catalogue like health_education_content itself (admin-managed, shared by all
-- organisations), so it carries no organisation_id. The teach-back results are a patient's own rows and carry organisation_id and is_test.

-- ---------------------------------------------------------------------------
-- 1. Versioned configuration (PROPOSED; mirrored in packages/shared proposed-config, with a drift test)
-- ---------------------------------------------------------------------------
-- learning-reading-grade-begin
insert into public.learning_config (key, version, value, status, note) values
('reading_grade', 1, $json${"max_grade":8,"min_override_reason_chars":15}$json$::jsonb, 'proposed',
 'Quality gate 12a: highest Flesch-Kincaid grade patient content may have when it is published, and the shortest written reason a reviewer must give to override it. PROPOSED: the CMO sets it (OQ-S55-QG-01).')
on conflict (key, version) do nothing;
-- learning-reading-grade-end

-- learning-teachback-begin
insert into public.learning_config (key, version, value, status, note) values
('teachback', 1, $json${"min_questions":1,"max_questions":3,"min_options":2,"max_options":4}$json$::jsonb, 'proposed',
 'Quality gate 12c: one to three authored teach-back questions per lesson, two to four options each. PROPOSED (OQ-S55-QG-04).')
on conflict (key, version) do nothing;
-- learning-teachback-end

-- ---------------------------------------------------------------------------
-- 2. The reading grade (12a)
-- ---------------------------------------------------------------------------
create or replace function private.count_syllables(p_word text)
returns integer
language plpgsql
immutable
set search_path = ''
as $$
declare
  w text := regexp_replace(lower(coalesce(p_word, '')), '[^a-z]', '', 'g');
  n integer;
begin
  if length(w) = 0 then return 0; end if;
  if length(w) <= 3 then return 1; end if;
  w := regexp_replace(w, '(?:[^laeiouy]es|ed|[^laeiouy]e)$', '');
  w := regexp_replace(w, '^y', '');
  select count(*) into n from regexp_matches(w, '[aeiouy]{1,2}', 'g');
  return case when n = 0 then 1 else n end;
end;
$$;

create or replace function private.reading_grade(p_text text)
returns numeric
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_clean text := lower(regexp_replace(coalesce(p_text, ''), '[#*_`>|]', ' ', 'g'));
  v_sentences integer;
  v_words integer := 0;
  v_syllables integer := 0;
  w text;
  v_raw numeric;
begin
  select count(*) into v_sentences from regexp_split_to_table(v_clean, '[.!?]+|\n+') as s where s ~ '[a-z]';
  for w in select m[1] from regexp_matches(v_clean, '([a-z]+(?:''[a-z]+)?)', 'g') as m loop
    v_words := v_words + 1;
    v_syllables := v_syllables + private.count_syllables(w);
  end loop;
  if v_words = 0 or v_sentences = 0 then return 0; end if;
  v_raw := 0.39 * v_words / v_sentences + 11.8 * v_syllables / v_words - 15.59;
  return greatest(0, round(v_raw, 1));
end;
$$;
revoke all on function private.count_syllables(text) from public, anon;
revoke all on function private.reading_grade(text) from public, anon;
grant execute on function private.count_syllables(text) to authenticated, service_role;
grant execute on function private.reading_grade(text) to authenticated, service_role;

-- A very short text (a one-line teaser, a stub body) is gated only when it has enough words to be a sentence: the formula over one or two words is
-- dominated by syllables per word (the single word "Teaser" scores 8.4), which is noise, not hard wording. Six words or more is graded in full.
create or replace function private.reading_grade_teaser(p_text text)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case when (select count(*) from regexp_matches(lower(coalesce(p_text, '')), '[a-z]+', 'g')) >= 6 then private.reading_grade(p_text) else 0::numeric end;
$$;
revoke all on function private.reading_grade_teaser(text) from public, anon;
grant execute on function private.reading_grade_teaser(text) to authenticated, service_role;

alter table public.health_education_content
  add column if not exists reading_grade numeric(4,1),
  add column if not exists reading_grade_checked_at timestamptz,
  add column if not exists reading_grade_override_reason text,
  add column if not exists reading_grade_override_by uuid references public.profiles(id) on delete restrict,
  add column if not exists reading_grade_override_at timestamptz,
  add column if not exists reading_grade_override_body_md5 text;
comment on column public.health_education_content.reading_grade is
  'Flesch-Kincaid grade of the body, kept true by the health_education_reading_grade_gate trigger on every write (a client value is overwritten). Null on rows not written since the gate was added.';
comment on column public.health_education_content.reading_grade_override_reason is
  'Why a reviewer let this item publish above the maximum grade. Written only by set_reading_grade_override(); valid only for the exact body it was recorded against (reading_grade_override_body_md5), so editing the text voids it.';

create or replace function private.health_education_reading_grade_gate()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_cfg jsonb;
  v_max numeric;
  v_min integer;
  v_grade numeric := private.reading_grade(new.body);
  v_sum_grade numeric := private.reading_grade_teaser(new.summary);
  v_gate numeric;
begin
  if tg_op = 'INSERT' or new.reading_grade is distinct from v_grade or new.reading_grade_checked_at is null then
    new.reading_grade_checked_at := now();
  end if;
  new.reading_grade := v_grade;

  -- The override columns change only through set_reading_grade_override().
  if coalesce(current_setting('tarragon.reading_grade_override', true), '') <> 'on' then
    if tg_op = 'INSERT' then
      if new.reading_grade_override_reason is not null or new.reading_grade_override_by is not null
         or new.reading_grade_override_at is not null or new.reading_grade_override_body_md5 is not null then
        raise exception 'A reading-grade override is recorded only through set_reading_grade_override()' using errcode = '42501';
      end if;
    elsif (new.reading_grade_override_reason, new.reading_grade_override_by, new.reading_grade_override_at, new.reading_grade_override_body_md5)
          is distinct from
          (old.reading_grade_override_reason, old.reading_grade_override_by, old.reading_grade_override_at, old.reading_grade_override_body_md5) then
      raise exception 'A reading-grade override is recorded only through set_reading_grade_override()' using errcode = '42501';
    end if;
  end if;

  -- The gate runs when an item becomes published AND whenever the graded text (body or summary) of an already published item changes, so an
  -- in-place edit cannot slip hard wording past it. The grade is the harder of the body and the summary.
  v_gate := greatest(private.reading_grade_teaser(new.body), v_sum_grade);
  if new.content_status = 'published'
     and (tg_op = 'INSERT' or old.content_status is distinct from 'published'
          or old.body is distinct from new.body or old.summary is distinct from new.summary)
     and not new.is_placeholder
     and new.reading_level is distinct from 'clinician' then
    v_cfg := private.learning_config('reading_grade');
    if v_cfg is null then
      raise exception 'The reading-grade limit is not configured, so patient content cannot be published' using errcode = '23514';
    end if;
    v_max := (v_cfg ->> 'max_grade')::numeric;
    v_min := (v_cfg ->> 'min_override_reason_chars')::integer;
    if v_gate > v_max then
      if new.reading_grade_override_reason is null
         or char_length(btrim(new.reading_grade_override_reason)) < v_min
         or new.reading_grade_override_body_md5 is distinct from md5(new.body || chr(31) || coalesce(new.summary, '')) then
        raise exception 'Reading grade % is above the maximum of % for patient content. Shorten the sentences and use simpler words, or a reviewer records an override reason first.', v_gate, v_max
          using errcode = '23514';
      end if;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.health_education_reading_grade_gate() from public, anon, authenticated;

drop trigger if exists health_education_reading_grade_gate on public.health_education_content;
create trigger health_education_reading_grade_gate
  before insert or update on public.health_education_content
  for each row execute function private.health_education_reading_grade_gate();

-- A reviewer (the active Chief Medical Officer) lets one item publish above the maximum grade, with a written reason. Bound to the body as it is now.
create or replace function public.set_reading_grade_override(p_content_id uuid, p_reason text)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_org uuid;
  v_row public.health_education_content%rowtype;
  v_min integer := coalesce((private.learning_config('reading_grade') ->> 'min_override_reason_chars')::integer, 15);
begin
  if v_actor is null or not private.is_active_clinical_director() then
    raise exception 'Only the Chief Medical Officer may record a reading-grade override' using errcode = '42501';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) < v_min then
    raise exception 'Give a reason of at least % characters', v_min using errcode = '22023';
  end if;
  select * into v_row from public.health_education_content where id = p_content_id for update;
  if not found then raise exception 'Unknown content item' using errcode = 'P0002'; end if;
  if v_row.content_status = 'published' then
    raise exception 'Published content cannot be overridden: send it back for an update first' using errcode = '55000';
  end if;
  select organisation_id into v_org from public.profiles where id = v_actor;

  perform set_config('tarragon.reading_grade_override', 'on', true);
  update public.health_education_content
     set reading_grade_override_reason = btrim(p_reason),
         reading_grade_override_by = v_actor,
         reading_grade_override_at = now(),
         reading_grade_override_body_md5 = md5(v_row.body || chr(31) || coalesce(v_row.summary, ''))
   where id = p_content_id;
  perform set_config('tarragon.reading_grade_override', '', true);

  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (v_org, v_actor, 'learning.reading_grade_override', 'health_education_content', p_content_id,
          jsonb_build_object('grade', greatest(private.reading_grade_teaser(v_row.body), private.reading_grade_teaser(v_row.summary))));
  return greatest(private.reading_grade_teaser(v_row.body), private.reading_grade_teaser(v_row.summary));
end;
$$;
revoke execute on function public.set_reading_grade_override(uuid, text) from public, anon;
grant execute on function public.set_reading_grade_override(uuid, text) to authenticated;

-- Read-only: how every live and draft item grades today (admin or CMO). Does not write or publish anything.
create or replace function public.learning_reading_grade_report()
returns table (code text, title text, content_status public.health_education_content_status, grade numeric, over_maximum boolean, has_valid_override boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_max numeric := (private.learning_config('reading_grade') ->> 'max_grade')::numeric;
begin
  if not (private.is_admin() or private.is_active_clinical_director()) then
    raise exception 'Admin or Chief Medical Officer only' using errcode = '42501';
  end if;
  return query
    select c.code, c.title, c.content_status, greatest(private.reading_grade_teaser(c.body), private.reading_grade_teaser(c.summary)),
           greatest(private.reading_grade_teaser(c.body), private.reading_grade_teaser(c.summary)) > v_max,
           (c.reading_grade_override_body_md5 is not distinct from md5(c.body || chr(31) || coalesce(c.summary, '')) and c.reading_grade_override_reason is not null)
      from public.health_education_content c
     where not c.is_placeholder and c.reading_level is distinct from 'clinician'
     order by greatest(private.reading_grade_teaser(c.body), private.reading_grade_teaser(c.summary)) desc, c.code;
end;
$$;
revoke execute on function public.learning_reading_grade_report() from public, anon;
grant execute on function public.learning_reading_grade_report() to authenticated;

-- ---------------------------------------------------------------------------
-- 3. The glossary (12b): plain-language definitions, owned and reviewed like content
-- ---------------------------------------------------------------------------
create table if not exists public.learning_glossary_terms (
  id                  uuid primary key default gen_random_uuid(),
  term                text not null check (char_length(btrim(term)) between 2 and 60),
  definition          text not null check (char_length(btrim(definition)) between 10 and 240),
  aliases             text[] not null default '{}',
  status              text not null default 'draft' check (status in ('draft', 'published', 'retired')),
  clinical_owner_name text,
  reviewed_by         uuid references public.profiles(id) on delete restrict,
  reviewed_by_name    text,
  reviewed_at         timestamptz,
  source_reference    text,
  next_review_due     date,
  created_by          uuid references public.profiles(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create unique index if not exists learning_glossary_term_lower_idx on public.learning_glossary_terms (lower(btrim(term)));
alter table public.learning_glossary_terms enable row level security;
revoke all on public.learning_glossary_terms from anon, authenticated;
grant select on public.learning_glossary_terms to authenticated;
drop policy if exists learning_glossary_staff_read on public.learning_glossary_terms;
create policy learning_glossary_staff_read on public.learning_glossary_terms for select to authenticated
  using (private.is_admin() or private.is_active_clinical_director());
comment on table public.learning_glossary_terms is
  'Quality gate 12b. Global catalogue (no organisation_id, like health_education_content). Written only by the glossary functions. A person sees a term only through learning_glossary(), which returns published, in-date, named-reviewer terms and nothing else.';

drop trigger if exists learning_glossary_set_updated_at on public.learning_glossary_terms;
create trigger learning_glossary_set_updated_at before update on public.learning_glossary_terms
  for each row execute function private.set_updated_at();

create or replace function private.learning_glossary_gate()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Africa/Lagos')::date;
  v_max numeric := (private.learning_config('reading_grade') ->> 'max_grade')::numeric;
begin
  -- checked on every move to published and every re-affirmation (the CMO publishing again, which stamps a new reviewed_at)
  if new.status = 'published' and (tg_op = 'INSERT' or old.status is distinct from 'published' or new.reviewed_at is distinct from old.reviewed_at) then
    if new.clinical_owner_name is null or char_length(btrim(new.clinical_owner_name)) < 3 then
      raise exception 'A glossary term needs a named clinical owner before it is published' using errcode = '23514';
    end if;
    if new.reviewed_by is null or new.reviewed_by_name is null or char_length(btrim(new.reviewed_by_name)) < 3 or new.reviewed_at is null then
      raise exception 'A glossary term needs a named reviewer and a review date before it is published' using errcode = '23514';
    end if;
    if new.source_reference is null or char_length(btrim(new.source_reference)) < 3 then
      raise exception 'A glossary term needs a source before it is published' using errcode = '23514';
    end if;
    if new.next_review_due is null or new.next_review_due <= v_today then
      raise exception 'A glossary term needs a next_review_due in the future before it is published' using errcode = '23514';
    end if;
    if v_max is not null and private.reading_grade(new.definition) > v_max then
      raise exception 'The definition reads at grade % which is above the maximum of %: use simpler words', private.reading_grade(new.definition), v_max using errcode = '23514';
    end if;
  end if;
  -- A published term is not edited in place: its wording is what was reviewed.
  if tg_op = 'UPDATE' and old.status = 'published' and new.status = 'published'
     and (new.term is distinct from old.term or new.definition is distinct from old.definition or new.aliases is distinct from old.aliases) then
    raise exception 'A published glossary term cannot be edited: send it back to draft first' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function private.learning_glossary_gate() from public, anon, authenticated;
drop trigger if exists learning_glossary_gate on public.learning_glossary_terms;
create trigger learning_glossary_gate before insert or update on public.learning_glossary_terms
  for each row execute function private.learning_glossary_gate();

-- Admin or the CMO writes a draft (a new term, or new wording for an existing one, which sends a published term back to draft and clears its review).
create or replace function public.save_glossary_draft(p_term text, p_definition text, p_aliases text[] default '{}', p_owner text default null, p_source text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_id uuid;
  v_aliases text[];
begin
  if v_actor is null or not (private.is_admin() or private.is_active_clinical_director()) then
    raise exception 'Admin or Chief Medical Officer only' using errcode = '42501';
  end if;
  select coalesce(array_agg(distinct btrim(a)) filter (where btrim(a) <> ''), '{}') into v_aliases from unnest(coalesce(p_aliases, '{}')) a;
  select id into v_id from public.learning_glossary_terms where lower(btrim(term)) = lower(btrim(p_term));
  if v_id is null then
    insert into public.learning_glossary_terms (term, definition, aliases, clinical_owner_name, source_reference, created_by)
    values (btrim(p_term), btrim(p_definition), v_aliases, nullif(btrim(p_owner), ''), nullif(btrim(p_source), ''), v_actor)
    returning id into v_id;
  else
    update public.learning_glossary_terms
       set definition = btrim(p_definition), aliases = v_aliases,
           clinical_owner_name = coalesce(nullif(btrim(p_owner), ''), clinical_owner_name),
           source_reference = coalesce(nullif(btrim(p_source), ''), source_reference),
           status = 'draft', reviewed_by = null, reviewed_by_name = null, reviewed_at = null, next_review_due = null
     where id = v_id;
  end if;
  return v_id;
end;
$$;

-- The active CMO reviews and publishes. The reviewer's name comes from the signed-in account, never from a typed value.
create or replace function public.publish_glossary_term(p_id uuid, p_next_review_due date)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_name text;
begin
  if v_actor is null or not private.is_active_clinical_director() then
    raise exception 'Only the Chief Medical Officer may publish a glossary term' using errcode = '42501';
  end if;
  select full_name into v_name from public.profiles where id = v_actor;
  update public.learning_glossary_terms
     set status = 'published', reviewed_by = v_actor, reviewed_by_name = v_name, reviewed_at = now(), next_review_due = p_next_review_due
   where id = p_id and status in ('draft', 'retired', 'published');
  return found;
end;
$$;

create or replace function public.retire_glossary_term(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not (private.is_admin() or private.is_active_clinical_director()) then
    raise exception 'Admin or Chief Medical Officer only' using errcode = '42501';
  end if;
  update public.learning_glossary_terms set status = 'retired' where id = p_id and status = 'published';
  return found;
end;
$$;

-- What a signed-in person is shown: published, named reviewer, review date not passed. Nothing else leaves the database.
create or replace function public.learning_glossary()
returns table (term text, definition text, aliases text[])
language sql
stable
security definer
set search_path = ''
as $$
  select g.term, g.definition, g.aliases
    from public.learning_glossary_terms g
   where (select auth.uid()) is not null
     and g.status = 'published'
     and g.reviewed_by is not null and g.reviewed_by_name is not null and g.reviewed_at is not null
     and g.clinical_owner_name is not null
     and g.next_review_due is not null
     and g.next_review_due > (now() at time zone 'Africa/Lagos')::date
   order by g.term;
$$;

revoke execute on function public.save_glossary_draft(text, text, text[], text, text) from public, anon;
revoke execute on function public.publish_glossary_term(uuid, date) from public, anon;
revoke execute on function public.retire_glossary_term(uuid) from public, anon;
revoke execute on function public.learning_glossary() from public, anon;
grant execute on function public.save_glossary_draft(text, text, text[], text, text) to authenticated;
grant execute on function public.publish_glossary_term(uuid, date) to authenticated;
grant execute on function public.retire_glossary_term(uuid) to authenticated;
grant execute on function public.learning_glossary() to authenticated;

-- DRAFT terms: plain wording written for review. No owner, no reviewer, no source, status draft: none can be shown until the CMO publishes it.
insert into public.learning_glossary_terms (term, definition, aliases) values
  ('hypertension', 'Blood pressure that stays too high for too long. It often has no signs, so the only way to know is to measure it.', array['high blood pressure']),
  ('systolic', 'The top number of a blood pressure reading. It is the pressure when your heart squeezes.', '{}'),
  ('diastolic', 'The bottom number of a blood pressure reading. It is the pressure when your heart rests between beats.', '{}'),
  ('HbA1c', 'A blood test that shows your average blood sugar over the last two to three months.', array['A1c']),
  ('blood glucose', 'The amount of sugar in your blood at the time you test.', array['blood sugar']),
  ('hypoglycaemia', 'Blood sugar that has dropped too low. You may feel shaky, sweaty or confused.', array['low blood sugar']),
  ('cholesterol', 'A fatty substance in your blood. Too much of the harmful kind can block blood vessels over time.', '{}'),
  ('creatinine', 'A waste product that your kidneys clean from your blood. A blood test for it shows how well your kidneys are working.', '{}')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 4. Teach-back (12c): authored per lesson, private to the person
-- ---------------------------------------------------------------------------
alter table public.health_education_content add column if not exists teachback jsonb;
comment on column public.health_education_content.teachback is
  'Quality gate 12c: [{question, options[], answer_index, explanation}], one to three questions (versioned config learning_config teachback). Separate from knowledge_check on purpose: finishing or failing a teach-back never changes a lesson''s progress status or a course''s completion.';

create or replace function private.teachback_validate(p_value jsonb)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  v_cfg jsonb := private.learning_config('teachback');
  q jsonb;
  v_n integer;
  v_opts integer;
  v_ans jsonb;
begin
  if p_value is null then return; end if;
  if v_cfg is null then raise exception 'The teach-back limits are not configured' using errcode = '23514'; end if;
  if jsonb_typeof(p_value) <> 'array' then raise exception 'Teach-back must be a list of questions' using errcode = '23514'; end if;
  v_n := jsonb_array_length(p_value);
  if v_n < (v_cfg ->> 'min_questions')::integer or v_n > (v_cfg ->> 'max_questions')::integer then
    raise exception 'A teach-back has % to % questions', v_cfg ->> 'min_questions', v_cfg ->> 'max_questions' using errcode = '23514';
  end if;
  for q in select * from jsonb_array_elements(p_value) loop
    if jsonb_typeof(q) <> 'object'
       or coalesce(btrim(q ->> 'question'), '') = '' or coalesce(btrim(q ->> 'explanation'), '') = ''
       or jsonb_typeof(q -> 'options') is distinct from 'array' then
      raise exception 'Each teach-back question needs a question, options and an explanation' using errcode = '23514';
    end if;
    v_opts := jsonb_array_length(q -> 'options');
    if v_opts < (v_cfg ->> 'min_options')::integer or v_opts > (v_cfg ->> 'max_options')::integer then
      raise exception 'Each teach-back question has % to % options', v_cfg ->> 'min_options', v_cfg ->> 'max_options' using errcode = '23514';
    end if;
    if exists (select 1 from jsonb_array_elements(q -> 'options') o where jsonb_typeof(o) <> 'string' or btrim(o #>> '{}') = '') then
      raise exception 'Teach-back options must be non-empty text' using errcode = '23514';
    end if;
    v_ans := q -> 'answer_index';
    if jsonb_typeof(v_ans) is distinct from 'number' or (v_ans #>> '{}') !~ '^[0-9]+$' or (v_ans #>> '{}')::integer >= v_opts then
      raise exception 'Each teach-back question needs the number of the right option' using errcode = '23514';
    end if;
  end loop;
end;
$$;
revoke all on function private.teachback_validate(jsonb) from public, anon, authenticated;

create or replace function private.health_education_teachback_gate()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.teachback is not null and (tg_op = 'INSERT' or new.teachback is distinct from old.teachback) then
    perform private.teachback_validate(new.teachback);
  end if;
  -- The questions are part of what the reviewer approved: no in-place edit once live.
  if tg_op = 'UPDATE' and old.content_status = 'published' and new.content_status = 'published' and new.teachback is distinct from old.teachback then
    raise exception 'The teach-back of a published lesson cannot be edited: send the lesson back for an update first' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function private.health_education_teachback_gate() from public, anon, authenticated;
drop trigger if exists health_education_teachback_gate on public.health_education_content;
create trigger health_education_teachback_gate before insert or update on public.health_education_content
  for each row execute function private.health_education_teachback_gate();

-- Author (admin or CMO) sets the questions on a lesson that is not live.
create or replace function public.set_lesson_teachback(p_content_id uuid, p_teachback jsonb)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not (private.is_admin() or private.is_active_clinical_director()) then
    raise exception 'Admin or Chief Medical Officer only' using errcode = '42501';
  end if;
  update public.health_education_content set teachback = p_teachback where id = p_content_id;
  return found;
end;
$$;
revoke execute on function public.set_lesson_teachback(uuid, jsonb) from public, anon;
grant execute on function public.set_lesson_teachback(uuid, jsonb) to authenticated;

create table if not exists public.learning_teachback_results (
  id                    uuid primary key default gen_random_uuid(),
  organisation_id       uuid not null references public.organisations(id) on delete restrict,
  patient_id            uuid not null references public.profiles(id) on delete cascade,
  content_id            uuid not null references public.health_education_content(id) on delete cascade,
  total                 integer not null check (total between 1 and 10),
  correct_count         integer not null check (correct_count >= 0),
  per_question          boolean[] not null,
  taken_at              timestamptz not null default now(),
  shared_with_care_team boolean not null default false,
  shared_at             timestamptz,
  is_test               boolean not null default false,
  unique (patient_id, content_id),
  check (correct_count <= total),
  check (cardinality(per_question) = total),
  check (shared_with_care_team = (shared_at is not null))
);
create index if not exists learning_teachback_patient_idx on public.learning_teachback_results (patient_id, taken_at desc);
alter table public.learning_teachback_results enable row level security;
revoke all on public.learning_teachback_results from anon, authenticated;
grant select on public.learning_teachback_results to authenticated;
drop policy if exists learning_teachback_own_read on public.learning_teachback_results;
create policy learning_teachback_own_read on public.learning_teachback_results for select to authenticated
  using (patient_id = (select auth.uid()));
comment on table public.learning_teachback_results is
  'Quality gate 12c. A person''s latest teach-back result for one lesson: counts only (no streak, no history, no ranking, no public score). Private to the person. Written only by record_teachback_result(); shared_with_care_team is set only by share_teachback_with_care_team() and a clinician reads it only through consultation_shared_teachbacks() (tie check plus audit).';

-- What the person is shown BEFORE answering: the questions and options only. The right answers and the explanations stay in the database until
-- the person has answered (record_teachback_result returns them), so a client never holds the answer key for a lesson it has not been marked on.
create or replace function public.lesson_teachback(p_code text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select (select jsonb_agg(jsonb_build_object('question', t.q ->> 'question', 'options', t.q -> 'options') order by t.ord)
            from jsonb_array_elements(c.teachback) with ordinality as t(q, ord))
    from public.health_education_content c
   where (select auth.uid()) is not null
     and c.code = p_code and not c.is_placeholder and c.teachback is not null
     and private.learning_age_ok(c.min_age, c.max_age)
     and not private.learning_creator_locked(c.creator_id)
     and private.health_education_is_servable(c.is_active, c.content_status, c.next_review_due);
$$;

-- The person answers. Marking happens here, from the stored answers, so a client cannot store a result it did not earn.
-- Finishing, skipping or failing the quiz changes nothing about the lesson: this function never touches health_education_progress.
create or replace function public.record_teachback_result(p_code text, p_picks integer[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
  v_org uuid;
  v_test boolean;
  c public.health_education_content%rowtype;
  v_marks jsonb := '[]'::jsonb;
  v_flags boolean[] := '{}';
  q jsonb;
  i integer := 0;
  v_pick integer;
  v_ok boolean;
  v_correct integer := 0;
begin
  if v_me is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  select organisation_id, coalesce(is_test, false) into v_org, v_test from public.profiles where id = v_me;
  select * into c from public.health_education_content x
   where x.code = p_code and not x.is_placeholder and x.teachback is not null
     and private.learning_age_ok(x.min_age, x.max_age)
     and not private.learning_creator_locked(x.creator_id)
     and private.health_education_is_servable(x.is_active, x.content_status, x.next_review_due);
  if not found then return null; end if;

  for q in select * from jsonb_array_elements(c.teachback) loop
    v_pick := p_picks[i + 1];
    v_ok := v_pick is not null and v_pick = (q ->> 'answer_index')::integer;
    v_flags := v_flags || v_ok;
    if v_ok then v_correct := v_correct + 1; end if;
    v_marks := v_marks || jsonb_build_object('correct', v_ok, 'correct_index', (q ->> 'answer_index')::integer, 'explanation', q ->> 'explanation');
    i := i + 1;
  end loop;

  -- A retake replaces the earlier result and starts private again: the person chooses to share each time.
  insert into public.learning_teachback_results (organisation_id, patient_id, content_id, total, correct_count, per_question, is_test)
  values (v_org, v_me, c.id, i, v_correct, v_flags, v_test)
  on conflict (patient_id, content_id) do update
    set total = excluded.total, correct_count = excluded.correct_count, per_question = excluded.per_question,
        taken_at = now(), shared_with_care_team = false, shared_at = null;

  return jsonb_build_object('total', i, 'correct', v_correct, 'marks', v_marks);
end;
$$;

-- Share or stop sharing. Sharing uses the existing "ask your care team" save (the lesson is saved for the next consultation) so there is
-- one mechanism, one place the person can undo it (delete the saved lesson), and one audited clinician read.
create or replace function public.share_teachback_with_care_team(p_code text, p_share boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
  v_content uuid;
begin
  if v_me is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  select r.content_id into v_content
    from public.learning_teachback_results r join public.health_education_content c on c.id = r.content_id
   where r.patient_id = v_me and c.code = p_code;
  if v_content is null then return false; end if;
  if p_share then
    if not public.save_lesson_for_consultation(p_code) then return false; end if;
    update public.learning_teachback_results set shared_with_care_team = true, shared_at = now() where patient_id = v_me and content_id = v_content;
  else
    update public.learning_teachback_results set shared_with_care_team = false, shared_at = null where patient_id = v_me and content_id = v_content;
  end if;
  return true;
end;
$$;

-- A tied clinician reads only what the person shared AND still has saved for the consultation. Counts only. Audited (INV-10).
create or replace function public.consultation_shared_teachbacks(p_patient uuid)
returns table (code text, title text, total integer, correct_count integer, per_question boolean[], taken_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.clinician_has_patient_access(p_patient) then
    perform private.audit_denied_read('learning_teachback.read', 'learning_teachback_results', p_patient,
      'No active task, assignment or consultation ties this clinician to the patient');
    return;
  end if;
  perform private.audit_patient_read(p_patient, 'learning_teachback_results', null,
    'Viewed the teach-back results the patient chose to share', 'learning_teachback.read');
  return query
    select c.code, c.title, r.total, r.correct_count, r.per_question, r.taken_at
      from public.learning_teachback_results r
      join public.health_education_content c on c.id = r.content_id
      join public.learning_saved_for_consultation s on s.patient_id = r.patient_id and s.content_id = r.content_id
     where r.patient_id = p_patient and r.shared_with_care_team
       -- a share counts only for the save it was made with: removing the saved lesson and saving it again later (for another visit)
       -- does not carry the old consent over
       and r.shared_at is not null and r.shared_at >= s.saved_at
       and private.health_education_is_servable(c.is_active, c.content_status, c.next_review_due)
     order by r.taken_at desc;
end;
$$;

revoke execute on function public.lesson_teachback(text) from public, anon;
revoke execute on function public.record_teachback_result(text, integer[]) from public, anon;
revoke execute on function public.share_teachback_with_care_team(text, boolean) from public, anon;
revoke execute on function public.consultation_shared_teachbacks(uuid) from public, anon;
grant execute on function public.lesson_teachback(text) to authenticated;
grant execute on function public.record_teachback_result(text, integer[]) to authenticated;
grant execute on function public.share_teachback_with_care_team(text, boolean) to authenticated;
grant execute on function public.consultation_shared_teachbacks(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Registries the standing proofs check
-- ---------------------------------------------------------------------------
insert into public.data_registry (table_name, patient_expr, retention_class, end_of_retention, in_export, notes)
select t.table_name, 'patient_id', private.retention_class_for(t.table_name),
       case when private.retention_class_for(t.table_name) = 'operational' then 'delete' else 'review' end,
       private.retention_class_for(t.table_name) <> 'audit',
       'Learning quality gates 2026-10-22: PROPOSED classification, to be confirmed by the CMO and DPO.'
  from unnest(array['learning_teachback_results']) as t(table_name)
on conflict (table_name) do nothing;

select private.guard_minor_dependant_table('learning_teachback_results', 'patient_id');

-- ---------------------------------------------------------------------------
-- Self-checks (a failure aborts the migration)
-- ---------------------------------------------------------------------------
do $$
declare
  f text;
  t text;
begin
  foreach t in array array['learning_glossary_terms', 'learning_teachback_results'] loop
    if not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = t and c.relrowsecurity) then
      raise exception 'quality gates self-check: % has no row level security', t;
    end if;
    if has_table_privilege('anon', 'public.' || t, 'SELECT') or has_table_privilege('authenticated', 'public.' || t, 'INSERT')
       or has_table_privilege('authenticated', 'public.' || t, 'UPDATE') or has_table_privilege('authenticated', 'public.' || t, 'DELETE') then
      raise exception 'quality gates self-check: % allows anon to read or a client to write directly', t;
    end if;
    if not has_table_privilege('authenticated', 'public.' || t, 'SELECT') then
      raise exception 'quality gates self-check: authenticated cannot read %', t;
    end if;
  end loop;
  if not exists (select 1 from public.data_registry where table_name = 'learning_teachback_results') then
    raise exception 'quality gates self-check: learning_teachback_results is not in the data registry';
  end if;
  if not exists (select 1 from public.minor_dependant_table_policy where table_name = 'learning_teachback_results') then
    raise exception 'quality gates self-check: learning_teachback_results has no dependant policy';
  end if;
  foreach f in array array[
    'public.set_reading_grade_override(uuid, text)', 'public.learning_reading_grade_report()', 'public.save_glossary_draft(text, text, text[], text, text)',
    'public.publish_glossary_term(uuid, date)', 'public.retire_glossary_term(uuid)', 'public.learning_glossary()', 'public.set_lesson_teachback(uuid, jsonb)',
    'public.lesson_teachback(text)', 'public.record_teachback_result(text, integer[])', 'public.share_teachback_with_care_team(text, boolean)', 'public.consultation_shared_teachbacks(uuid)'] loop
    if has_function_privilege('anon', f, 'EXECUTE') then raise exception 'quality gates self-check: anon can execute %', f; end if;
    if not has_function_privilege('authenticated', f, 'EXECUTE') then raise exception 'quality gates self-check: authenticated cannot execute %', f; end if;
  end loop;
  -- the formula and the golden vectors of packages/shared learning/reading-grade.ts
  if private.reading_grade('Take your tablet each morning. Sit and rest for five minutes. Then check your blood pressure.') <> 1.2
     or private.reading_grade('Hypertension is a chronic cardiovascular condition characterised by persistently elevated arterial pressure.') <> 21.5
     or private.reading_grade('') <> 0 then
    raise exception 'quality gates self-check: reading_grade does not match the golden vectors';
  end if;
  if exists (select 1 from public.learning_glossary_terms where status <> 'draft') then
    raise exception 'quality gates self-check: a glossary term was seeded as something other than draft';
  end if;
end $$;
