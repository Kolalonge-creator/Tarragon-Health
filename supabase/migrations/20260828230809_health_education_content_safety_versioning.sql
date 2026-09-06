-- Module 20 (Health Education Platform) §20.5 reading levels, §20.8 content safety,
-- §20.9 versioning, §20.11 audio.
--
-- §20.5 Health literacy: each content row now carries a reading level. This is a tag on
-- the row, not a per-patient toggle stored server-side — a topic that needs more than one
-- level gets multiple rows sharing a `topic_group_code`, and the patient UI switches
-- between them client-side (no new patient preference to store or gate).
--
-- §20.8 Content safety: every clinical content item should have a clinical author,
-- reviewer, evidence/source, version, approval date, review date. `clinician_reviewed` /
-- `reviewed_by_name` / `reviewed_at` already cover "reviewer" + "approval date" (shipped
-- 20260717150000) — this adds the rest: `clinical_author_name` (distinct from the
-- reviewer), `evidence_source`, `version`, and `review_due_at` (the next scheduled
-- review, distinct from `reviewed_at`, the last one).
--
-- §20.9 Versioning: "never silently change clinical information... old versions should
-- remain auditable." `health_education_content_versions` is a snapshot-on-change audit
-- trail, populated by a BEFORE UPDATE trigger that fires only when a *clinical* field
-- changes (body/title/summary/content_type/knowledge_check/reading_level/
-- clinician_reviewed/reviewed_by_name/evidence_source/clinical_author_name) — not on an
-- operational toggle like is_active/sort_order/drip_week/review_due_at, which aren't a
-- change to the clinical content itself.
--
-- §20.11 Audio: `audio_url`, same shape as the existing `video_url` — a link to a hosted
-- file, not a TTS-generation feature (TTS/voice stays out of scope per the founder's
-- 2026-08-03 English-only decision in CLAUDE.md; this is unrelated, it's just a URL
-- field for an uploaded/hosted audio file, same as video_url already is for video).

create type public.health_education_reading_level as enum ('simple', 'detailed', 'clinician');

alter table public.health_education_content
  add column reading_level public.health_education_reading_level not null default 'simple',
  add column topic_group_code text,
  add column clinical_author_name text,
  add column evidence_source text,
  add column version integer not null default 1,
  add column approved_at timestamptz,
  add column review_due_at timestamptz,
  add column audio_url text;

create index health_education_content_topic_group_idx
  on public.health_education_content (topic_group_code)
  where topic_group_code is not null;

create index health_education_content_review_due_idx
  on public.health_education_content (review_due_at)
  where review_due_at is not null and is_active;

-- ---------------------------------------------------------------------------------
-- §20.9 versioning: audit table + snapshot-on-clinical-change trigger.
-- ---------------------------------------------------------------------------------

create table public.health_education_content_versions (
  id                  uuid primary key default gen_random_uuid(),
  content_id          uuid not null references public.health_education_content (id) on delete cascade,
  version             integer not null,
  code                text not null,
  title               text not null,
  summary             text,
  body                text not null,
  content_type        public.health_education_content_type not null,
  reading_level       public.health_education_reading_level not null,
  category            public.health_education_category not null,
  condition           public.care_plan_condition,
  min_risk_level      public.risk_level,
  clinician_reviewed  boolean not null,
  reviewed_by_name    text,
  reviewed_at         timestamptz,
  clinical_author_name text,
  evidence_source     text,
  approved_at         timestamptz,
  review_due_at       timestamptz,
  knowledge_check     jsonb,
  video_url           text,
  audio_url           text,
  changed_by          uuid references public.profiles (id),
  superseded_at       timestamptz not null default now(),
  unique (content_id, version)
);

create index health_education_content_versions_content_idx
  on public.health_education_content_versions (content_id, version desc);

alter table public.health_education_content_versions enable row level security;

-- Audit trail — same admin-only visibility as the catalogue's write surface. Not
-- patient- or org-staff-readable; this is a governance record, not patient content.
create policy health_education_content_versions_select on public.health_education_content_versions
  for select to authenticated using (private.is_admin());

grant select on public.health_education_content_versions to authenticated;

create or replace function private.snapshot_health_education_content_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if row(old.body, old.title, old.summary, old.content_type, old.reading_level,
         old.knowledge_check, old.clinician_reviewed, old.reviewed_by_name,
         old.evidence_source, old.clinical_author_name)
     is distinct from
     row(new.body, new.title, new.summary, new.content_type, new.reading_level,
         new.knowledge_check, new.clinician_reviewed, new.reviewed_by_name,
         new.evidence_source, new.clinical_author_name)
  then
    insert into public.health_education_content_versions (
      content_id, version, code, title, summary, body, content_type, reading_level,
      category, condition, min_risk_level, clinician_reviewed, reviewed_by_name,
      reviewed_at, clinical_author_name, evidence_source, approved_at, review_due_at,
      knowledge_check, video_url, audio_url, changed_by
    ) values (
      old.id, old.version, old.code, old.title, old.summary, old.body, old.content_type,
      old.reading_level, old.category, old.condition, old.min_risk_level,
      old.clinician_reviewed, old.reviewed_by_name, old.reviewed_at,
      old.clinical_author_name, old.evidence_source, old.approved_at, old.review_due_at,
      old.knowledge_check, old.video_url, old.audio_url, (select auth.uid())
    );
    new.version := old.version + 1;
  end if;
  return new;
end;
$$;

create trigger health_education_content_version_snapshot
  before update on public.health_education_content
  for each row execute function private.snapshot_health_education_content_version();

do $$
begin
  if not has_table_privilege('authenticated', 'public.health_education_content_versions', 'SELECT') then
    raise exception 'health_education_content_versions: authenticated grant did not take';
  end if;
end $$;
