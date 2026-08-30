-- Tarragon Health — Health Education: content localisation architecture (§79.9)
--
-- `profiles.language` (en/pcm/yo/ha/ig, 20260723201654_voice_reminders_and_language.sql)
-- already carries exactly the value set this item asks for, but per its own
-- column comment it was built for reminder/notification text only — "in-app
-- UI stays English for now" — and health_education_feed()/library() don't
-- read it at all. This migration adds the missing piece: a translations
-- table keyed to the same language enum, and the feed/library RPCs (next
-- migration) will coalesce to it when the caller's `profiles.language`
-- isn't 'en' and a translation exists, falling back to the English columns
-- otherwise.
--
-- Deliberately NOT seeded with machine- or model-generated Pidgin/Yoruba/
-- Hausa/Igbo translations of clinical content in this migration — getting
-- chronic-disease guidance subtly wrong in a second language is a real
-- patient-safety risk, and Claude Code is not a substitute for a fluent
-- clinical translator. This ships the pipeline + admin authoring surface;
-- populating real, human-translated rows is a founder/clinical-team task,
-- the same "[LOCALISE]" pattern already used throughout the pathway
-- gap-closure plans for facts needing human sign-off.

create table if not exists public.health_education_translations (
  id              uuid primary key default gen_random_uuid(),
  content_id      uuid not null references public.health_education_content (id) on delete cascade,
  language        text not null check (language in ('pcm', 'yo', 'ha', 'ig')), -- 'en' lives on the base row, never duplicated here
  title           text not null,
  summary         text,
  body            text not null,
  translated_by   text, -- admin-entered display name, library-level like reviewed_by_name
  translated_at   timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (content_id, language)
);

create index if not exists health_education_translations_content_idx
  on public.health_education_translations (content_id, language);

alter table public.health_education_translations enable row level security;

drop policy if exists health_education_translations_select on public.health_education_translations;
create policy health_education_translations_select on public.health_education_translations
  for select to authenticated
  using (true); -- same openness as health_education_content's is_active rows; joined only from content already visible

drop policy if exists health_education_translations_write on public.health_education_translations;
create policy health_education_translations_write on public.health_education_translations
  for all to authenticated
  using (private.is_admin())
  with check (private.is_admin());

grant select, insert, update, delete on public.health_education_translations to authenticated;

drop trigger if exists health_education_translations_set_updated_at on public.health_education_translations;
create trigger health_education_translations_set_updated_at
  before update on public.health_education_translations
  for each row execute function private.set_updated_at();
