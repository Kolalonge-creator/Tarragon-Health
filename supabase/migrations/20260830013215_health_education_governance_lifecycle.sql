-- Tarragon Health — Health Education: clinical-governance lifecycle (§79.10/§79.11)
--
-- Today `health_education_content` carries only `clinician_reviewed` /
-- `reviewed_by_name` / `reviewed_at` / `is_active` — documented as a "thin
-- slice" in docs/archive/HEALTH_EDUCATION_PATHWAY_SPEC.md §7, not full
-- governance. This migration adds the missing fields (author, version,
-- next review date, source/reference, and a real status) plus a state
-- machine and an audit trail of every transition.
--
-- `is_active` (used by every existing RLS policy and RPC WHERE clause) is
-- kept as the single source of visibility truth and is now DERIVED from
-- `content_status` by trigger, rather than being a second, independently-set
-- flag — 'published' and 'review_due' are visible; every other status is
-- not. This means no existing policy/RPC needs to change to respect the
-- new lifecycle.
--
-- Also adds `min_age`/`max_age` (nullable) — real §79.5 "age" input for the
-- recommendation engine, wired into `health_education_feed()` in a later
-- migration once the columns exist.

do $$ begin
  if not exists (select 1 from pg_type where typname = 'health_education_content_status') then
    create type public.health_education_content_status as enum (
      'draft', 'clinical_review', 'approved', 'published', 'review_due', 'updated'
    );
  end if;
end $$;

alter table public.health_education_content
  add column if not exists content_status public.health_education_content_status
    not null default 'draft',
  add column if not exists author_name  text,
  add column if not exists content_version integer not null default 1 check (content_version > 0),
  add column if not exists source_reference text,
  add column if not exists next_review_due date,
  add column if not exists min_age integer check (min_age is null or min_age >= 0),
  add column if not exists max_age integer check (max_age is null or max_age >= min_age);

comment on column public.health_education_content.content_status is
  'Governance lifecycle: draft -> clinical_review -> approved -> published -> review_due -> updated -> (back to clinical_review). Drives is_active by trigger.';
comment on column public.health_education_content.author_name is
  'Admin-entered display name of the content author. Distinct from reviewed_by_name (the clinical reviewer).';
comment on column public.health_education_content.next_review_due is
  'Date this content is next due a clinical re-review. A daily job moves published content past this date into review_due.';

-- Backfill: existing rows are the live, already-shipped library — treat them
-- as already published (is_active=true) or draft (is_active=false, none
-- exist today but handled for safety).
update public.health_education_content
  set content_status = (case when is_active then 'published' else 'draft' end)::public.health_education_content_status
  where content_status = 'draft'; -- only rows still at the just-added default

-- ============================================================================
-- is_active follows content_status, not the other way around.
-- ============================================================================
create or replace function private.health_education_content_sync_is_active()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.is_active := new.content_status in ('published', 'review_due');
  return new;
end;
$$;

drop trigger if exists health_education_content_sync_is_active on public.health_education_content;
create trigger health_education_content_sync_is_active
  before insert or update of content_status on public.health_education_content
  for each row execute function private.health_education_content_sync_is_active();

-- Run once now so existing rows' is_active matches the status we just backfilled.
update public.health_education_content
  set is_active = content_status in ('published', 'review_due');

-- ============================================================================
-- Status history — the audit trail governance needs (who moved what, when, why).
-- ============================================================================
create table if not exists public.health_education_content_status_history (
  id            uuid primary key default gen_random_uuid(),
  content_id    uuid not null references public.health_education_content (id) on delete cascade,
  from_status   public.health_education_content_status,
  to_status     public.health_education_content_status not null,
  actor_id      uuid references public.profiles (id) on delete set null,
  note          text,
  created_at    timestamptz not null default now()
);
create index if not exists health_education_content_status_history_content_idx
  on public.health_education_content_status_history (content_id, created_at desc);

alter table public.health_education_content_status_history enable row level security;

drop policy if exists health_education_content_status_history_select on public.health_education_content_status_history;
create policy health_education_content_status_history_select on public.health_education_content_status_history
  for select to authenticated
  using (private.is_admin());

grant select on public.health_education_content_status_history to authenticated;

-- ============================================================================
-- Transition RPC — the only sanctioned way to move a content row's status.
-- Enforces the legal edges of the state machine and always writes history.
-- ============================================================================
create or replace function public.set_health_education_content_status(
  p_content_id uuid,
  p_new_status public.health_education_content_status,
  p_note text default null
)
returns public.health_education_content_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current public.health_education_content_status;
  v_actor uuid := (select auth.uid());
  v_legal boolean := false;
begin
  if not private.is_admin() then
    raise exception 'Only an admin may change health-education content status';
  end if;

  select content_status into v_current
    from public.health_education_content where id = p_content_id for update;
  if v_current is null then
    raise exception 'Unknown health_education_content id %', p_content_id;
  end if;

  v_legal := case
    when v_current = 'draft' and p_new_status = 'clinical_review' then true
    when v_current = 'clinical_review' and p_new_status in ('approved', 'draft') then true
    when v_current = 'approved' and p_new_status in ('published', 'clinical_review') then true
    when v_current = 'published' and p_new_status in ('review_due', 'updated') then true
    when v_current = 'review_due' and p_new_status in ('updated', 'published') then true
    when v_current = 'updated' and p_new_status = 'clinical_review' then true
    else false
  end;
  if not v_legal then
    raise exception 'Illegal health-education status transition: % -> %', v_current, p_new_status;
  end if;

  update public.health_education_content
    set content_status = p_new_status,
        content_version = case when p_new_status = 'updated' then content_version + 1 else content_version end,
        clinician_reviewed = case when p_new_status = 'approved' then true else clinician_reviewed end,
        reviewed_at = case when p_new_status = 'approved' then now() else reviewed_at end
    where id = p_content_id;

  insert into public.health_education_content_status_history (content_id, from_status, to_status, actor_id, note)
  values (p_content_id, v_current, p_new_status, v_actor, p_note);

  return p_new_status;
end;
$$;

revoke execute on function public.set_health_education_content_status(uuid, public.health_education_content_status, text) from public;
revoke execute on function public.set_health_education_content_status(uuid, public.health_education_content_status, text) from anon;
grant execute on function public.set_health_education_content_status(uuid, public.health_education_content_status, text) to authenticated;

-- ============================================================================
-- Daily job: published/updated-and-republished content past its review date
-- ages into review_due. Content STAYS visible (review_due keeps is_active
-- true) — a stale-but-live article is not the same failure as a wrong one,
-- and unpublishing on a timer would be a worse patient experience than
-- flagging it for a human. See §79.12 for the protocol-driven version of
-- this same idea.
-- ============================================================================
create or replace function private.health_education_flag_overdue_reviews()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  with due as (
    update public.health_education_content
    set content_status = 'review_due'
    where content_status = 'published'
      and next_review_due is not null
      and next_review_due <= current_date
    returning id
  )
  insert into public.health_education_content_status_history (content_id, from_status, to_status, note)
  select id, 'published', 'review_due', 'Automatic: next_review_due date passed' from due;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create extension if not exists pg_cron;

select cron.schedule(
  'health-education-flag-overdue-reviews',
  '0 3 * * *',
  $$select private.health_education_flag_overdue_reviews();$$
);
