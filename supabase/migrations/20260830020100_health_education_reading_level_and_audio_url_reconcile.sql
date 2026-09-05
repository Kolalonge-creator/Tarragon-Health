-- Tarragon Health — Health Education: reconcile `reading_level`/`audio_url`
--
-- Found while fixing the CI "Supabase migration replay" job, which failed
-- with `type public.health_education_reading_level does not exist` while
-- applying 20260830020209_health_education_feed_language_age_literacy.sql
-- from a fresh database. That migration's own header already documents the
-- cause: `health_education_feed()`/`health_education_library()` were found
-- live carrying `audio_url`/`reading_level` columns applied directly to the
-- shared remote project by a concurrent session/worktree, with no local
-- migration file ever committed for them — the exact "live schema object
-- with no migration record at all" failure mode this file's CLAUDE.md
-- documents elsewhere. `category`/`min_age`/`max_age`, mentioned in that
-- same migration, are NOT part of this gap — those are already covered by
-- 20260810013703_health_education_categories_and_library.sql and
-- 20260830013215_health_education_governance_lifecycle.sql respectively.
--
-- Values/shape below are taken from the live project's actual
-- `pg_enum`/`information_schema.columns`, not guessed. Written to be a
-- no-op against the live database (which already has both) and to make a
-- from-scratch CI replay succeed.

do $$ begin
  if not exists (select 1 from pg_type where typname = 'health_education_reading_level') then
    create type public.health_education_reading_level as enum ('simple', 'detailed', 'clinician');
  end if;
end $$;

alter table public.health_education_content
  add column if not exists audio_url text,
  add column if not exists reading_level public.health_education_reading_level
    not null default 'simple';

comment on column public.health_education_content.reading_level is
  'Content complexity tier used by health_education_feed()''s low-health-literacy reordering (see health_literacy_assessments). ''simple'' is the default for all pre-existing content.';
comment on column public.health_education_content.audio_url is
  'Optional narrated-audio asset for the content item, alongside video_url. Nullable — most content has neither.';
