-- Health library provenance and review gate (website upgrade Phase 4, 2026-11-05;
-- docs/plans/website-redesign/00-phase0-plan.md section 6).
--
-- Founder decisions this rests on (2026-11-05, in chat):
--   * From now on a health article cannot be PUBLISHED without a named clinical reviewer and a review date.
--   * The 18 articles already live without a recorded review stay live, unlabelled (grandfathered): the gate
--     fires only when an article moves to published (insert as published, or unpublished -> published), never
--     on an edit of an article that is already live.
--   * An article with no author shows "Tarragon Health editorial team" (a display fallback in the page code;
--     nothing is written here, so a real author can be set at any time).
--
-- What this adds (additive only; no existing row's content changes):
--   1. author_name, source_references (a JSON array of {label, url}), next_review_at, publish_at (scheduled publishing).
--   2. next_review_at defaults to reviewed_at + 1 year when a review is recorded and no date is given.
--   3. A BEFORE trigger refusing a move to published without reviewed_by_name and reviewed_at
--      (errcode 23514, message 'clinical_review_required').
--   4. marketing_resource_revisions: the previous version of a row on every update or delete, written by a
--      SECURITY DEFINER trigger; admins can read it, nobody can write it directly, anon cannot see it.
--   5. Scheduled publishing: the anon and authenticated read policies also require publish_at to have passed.
--      The anon policy keeps its own shape with no is_admin() call (marketing_resources_anon_select_without_is_admin.sql).
--
-- Row counts at authoring (live, 2026-11-05): 42 articles, 42 published, 24 with a recorded review, 18 published
-- without one (the grandfathered set). None has publish_at, so nothing disappears from the site.

alter table public.marketing_resources
  add column if not exists author_name text,
  add column if not exists source_references jsonb not null default '[]'::jsonb,
  add column if not exists next_review_at timestamptz,
  add column if not exists publish_at timestamptz;

alter table public.marketing_resources
  drop constraint if exists marketing_resources_source_references_is_array;
alter table public.marketing_resources
  add constraint marketing_resources_source_references_is_array check (jsonb_typeof(source_references) = 'array');

-- Backfill: every article with a recorded review gets its next review a year on. Done before the revision
-- trigger exists (no 24 noise revisions) and with set_updated_at paused, so "Last updated" dates and the
-- sitemap's lastmod do not all jump to today for a change no reader can see.
alter table public.marketing_resources disable trigger marketing_resources_set_updated_at;
update public.marketing_resources
   set next_review_at = reviewed_at + interval '1 year'
 where reviewed_at is not null and next_review_at is null;
alter table public.marketing_resources enable trigger marketing_resources_set_updated_at;

-- 2 + 3. One BEFORE trigger: default the next review, then gate a move to published.
create or replace function private.marketing_resources_review_gate()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.reviewed_by_name is not null and btrim(new.reviewed_by_name) = '' then
    new.reviewed_by_name := null;
  end if;

  -- Next review: a year after the review, unless an editor set a date. A fresh review (reviewed_at changes)
  -- moves it on too, unless the same save also changed next_review_at on purpose.
  if new.reviewed_at is not null and (
       new.next_review_at is null
       or (tg_op = 'UPDATE' and new.reviewed_at is distinct from old.reviewed_at
           and new.next_review_at is not distinct from old.next_review_at)
     ) then
    new.next_review_at := new.reviewed_at + interval '1 year';
  end if;

  -- A live article that has a review cannot lose it and stay live (the grandfathered set never had one).
  if tg_op = 'UPDATE' and old.is_published and new.is_published
     and old.reviewed_by_name is not null
     and (new.reviewed_by_name is null or new.reviewed_at is null) then
    raise exception 'clinical_review_required'
      using errcode = '23514',
            hint = 'A published article cannot have its clinical review removed. Unpublish it first.';
  end if;

  if new.is_published
     and (tg_op = 'INSERT' or not old.is_published)
     and (new.reviewed_by_name is null or new.reviewed_at is null) then
    raise exception 'clinical_review_required'
      using errcode = '23514',
            hint = 'A health article can only be published once a clinical reviewer and review date are recorded.';
  end if;
  return new;
end;
$$;

revoke all on function private.marketing_resources_review_gate() from public;

drop trigger if exists marketing_resources_review_gate on public.marketing_resources;
create trigger marketing_resources_review_gate
  before insert or update on public.marketing_resources
  for each row execute function private.marketing_resources_review_gate();

-- 4. Revision history.
create table if not exists public.marketing_resource_revisions (
  id uuid primary key default gen_random_uuid(),
  resource_id uuid not null,
  slug text not null,
  operation text not null check (operation in ('UPDATE', 'DELETE')),
  snapshot jsonb not null,
  changed_by uuid,
  changed_at timestamptz not null default now()
);

create index if not exists marketing_resource_revisions_resource_idx
  on public.marketing_resource_revisions (resource_id, changed_at desc);

alter table public.marketing_resource_revisions enable row level security;

revoke all on table public.marketing_resource_revisions from anon;
revoke all on table public.marketing_resource_revisions from authenticated;
grant select on table public.marketing_resource_revisions to authenticated;

drop policy if exists marketing_resource_revisions_admin_select on public.marketing_resource_revisions;
create policy marketing_resource_revisions_admin_select
  on public.marketing_resource_revisions
  for select to authenticated
  using (private.is_admin());

create or replace function private.marketing_resources_keep_revision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.marketing_resource_revisions (resource_id, slug, operation, snapshot, changed_by)
  values (old.id, old.slug, tg_op, to_jsonb(old), auth.uid());
  return null;
end;
$$;

revoke all on function private.marketing_resources_keep_revision() from public;

drop trigger if exists marketing_resources_keep_revision on public.marketing_resources;
create trigger marketing_resources_keep_revision
  after update or delete on public.marketing_resources
  for each row execute function private.marketing_resources_keep_revision();

-- 5. Scheduled publishing in the read policies.
drop policy if exists marketing_resources_anon_select on public.marketing_resources;
create policy marketing_resources_anon_select
  on public.marketing_resources
  for select to anon
  using (is_published and (publish_at is null or publish_at <= now()));

drop policy if exists marketing_resources_authenticated_select on public.marketing_resources;
create policy marketing_resources_authenticated_select
  on public.marketing_resources
  for select to authenticated
  using ((is_published and (publish_at is null or publish_at <= now())) or private.is_admin());

-- Assertions: provable, not hopeful.
do $$
begin
  if exists (select 1 from pg_trigger where tgname = 'marketing_resources_set_updated_at' and tgenabled = 'D') then
    raise exception 'ASSERT: set_updated_at was left disabled after the backfill';
  end if;
  if exists (select 1 from public.marketing_resources where reviewed_at is not null and next_review_at is null) then
    raise exception 'ASSERT: a reviewed article has no next review date after the backfill';
  end if;
  if exists (select 1 from public.marketing_resources where publish_at is not null) then
    raise exception 'ASSERT: an existing article was given a publish_at and could vanish from the site';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'marketing_resources_review_gate') then
    raise exception 'ASSERT: review gate trigger missing';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'marketing_resources_keep_revision') then
    raise exception 'ASSERT: revision trigger missing';
  end if;
  if has_table_privilege('anon', 'public.marketing_resource_revisions', 'SELECT') then
    raise exception 'ASSERT: anon can read revision history';
  end if;
  if has_table_privilege('authenticated', 'public.marketing_resource_revisions', 'INSERT') then
    raise exception 'ASSERT: authenticated can write revision history directly';
  end if;
  if has_function_privilege('anon', 'private.marketing_resources_keep_revision()', 'EXECUTE') then
    raise exception 'ASSERT: anon can execute the revision trigger function';
  end if;
end;
$$;
