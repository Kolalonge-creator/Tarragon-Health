-- Tarragon Health — Health Education: browsable category taxonomy + library RPC
--
-- Problem found 2026-08-10: a "Complete Care" patient with no diagnosed
-- chronic condition on file only ever qualified for the 14 condition=null
-- ("general") rows in health_education_content, and those are further
-- throttled by the weekly drip (health_education_unlock_week) — so on first
-- login a patient sees roughly 2 items, with the rest trickling out one a
-- week for twelve weeks. There is also no way for a patient to choose a
-- topic outside whatever the personalisation algorithm decided was relevant
-- — the founder ask this closes is a real, visible, browsable library the
-- patient controls, not just an engagement drip-feed.
--
-- What this migration does:
--   1. Adds a `category` taxonomy — broader than the clinical
--      `care_plan_condition` used for personalisation, so purely-interest
--      topics (nutrition, mental health, women's/men's health, etc.) get
--      their own browsable bucket instead of collapsing into one
--      undifferentiated "general" pile.
--   2. Backfills category on every existing active row.
--   3. Adds `health_education_library()` — a browse RPC that returns ALL
--      active content (optionally filtered by category), deliberately
--      ignoring condition-match, risk floor and drip pacing. The existing
--      `health_education_feed()` (personalised, paced "Recommended for
--      you") is untouched — browsing and the personalised rail are now two
--      different surfaces over the same table, matching how the patient UI
--      is being rebuilt (see health-education.tsx).
--   4. Corrects `gen_w10_health_wallet`, which still describes the Health
--      Wallet feature retired 2026-07-31 in favour of Care Vouchers — this
--      library is being made advertisement-grade, so stale product copy
--      gets fixed alongside it rather than left to confuse a patient.

-- ============================================================================
-- 1. Category taxonomy
-- ============================================================================
do $$ begin
  if not exists (select 1 from pg_type where typname = 'health_education_category') then
    create type public.health_education_category as enum (
      'hypertension',
      'diabetes',
      'weight',
      'heart',
      'kidney',
      'respiratory',
      'cancer_screening',
      'womens_health',
      'mens_health',
      'mental_health',
      'nutrition',
      'medicines',
      'family_child',
      'getting_started'
    );
  end if;
end $$;

alter table public.health_education_content
  add column if not exists category public.health_education_category;

-- Backfill every existing active/inactive row from its (condition, code).
update public.health_education_content set category = 'hypertension' where condition = 'hypertension' and category is null;
update public.health_education_content set category = 'diabetes'     where condition = 'diabetes'     and category is null;
update public.health_education_content set category = 'weight'       where condition = 'obesity'      and category is null;

update public.health_education_content set category = 'cancer_screening'
  where category is null and code in ('prev-why-screening', 'gen_w5_cancer_screening');
update public.health_education_content set category = 'family_child'
  where category is null and code in ('gen_w4_adult_vaccines');
update public.health_education_content set category = 'mental_health'
  where category is null and code in ('gen_w7_mental_health_basics');
-- Everything else condition=null is a "using Tarragon well" general topic.
update public.health_education_content set category = 'getting_started'
  where category is null and condition is null;

alter table public.health_education_content
  alter column category set not null;

create index if not exists health_education_content_category_idx
  on public.health_education_content (is_active, category, sort_order);

-- ============================================================================
-- 2. Correct stale Health Wallet copy — Care Vouchers replaced it 2026-07-31.
-- ============================================================================
update public.health_education_content
set
  title = 'Paying for care, small-small',
  summary = 'How Care Vouchers let you (or someone supporting you) pay toward a plan gradually instead of all at once.',
  body = E'Healthcare costs often arrive as one lump sum right when you need a plan, a test, or a referral most. Care Vouchers are built to soften that.\n\nPay toward a voucher in whatever amounts suit you, whenever you have it — the balance builds until it covers what it is set for. A family member, local or abroad, can pay toward it directly too, which is often easier than sending cash for a specific bill after the fact.\n\nOnce a voucher is fully funded, you redeem it toward the plan or care it was set up for. If you have not looked at yours yet, it is worth a glance — paying small-small, over weeks, is far easier for most people to manage than one large bill.',
  updated_at = now()
where code = 'gen_w10_health_wallet';

-- ============================================================================
-- 3. Library RPC — the full browsable catalogue, ungated by condition/risk/
--    drip. security definer only so it can attach the caller's own progress
--    (never anyone else's) in the same query; RLS already lets any
--    authenticated user read active rows directly, so this adds no new
--    read surface, just a friendlier shape for the patient UI.
-- ============================================================================
create or replace function public.health_education_library(p_category public.health_education_category default null)
returns table (
  content_id        uuid,
  code              text,
  title             text,
  summary           text,
  body              text,
  content_type      public.health_education_content_type,
  video_url         text,
  estimated_minutes integer,
  condition         public.care_plan_condition,
  category          public.health_education_category,
  clinician_reviewed boolean,
  reviewed_by_name  text,
  has_knowledge_check boolean,
  knowledge_check   jsonb,
  status            public.health_education_status,
  check_score       integer,
  check_total       integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    c.id,
    c.code,
    c.title,
    c.summary,
    c.body,
    c.content_type,
    c.video_url,
    c.estimated_minutes,
    c.condition,
    c.category,
    c.clinician_reviewed,
    c.reviewed_by_name,
    (c.knowledge_check is not null and jsonb_array_length(c.knowledge_check) > 0) as has_knowledge_check,
    c.knowledge_check,
    p.status,
    p.check_score,
    p.check_total
  from public.health_education_content c
  left join public.health_education_progress p
    on p.content_id = c.id and p.patient_id = (select auth.uid())
  where c.is_active
    and (p_category is null or c.category = p_category)
  order by c.sort_order, c.title;
$$;

revoke execute on function public.health_education_library(public.health_education_category) from public;
revoke execute on function public.health_education_library(public.health_education_category) from anon;
grant execute on function public.health_education_library(public.health_education_category) to authenticated;

-- ============================================================================
-- 4. Category counts RPC — powers the category picker's "N topics" chips
--    without pulling every row's body down first.
-- ============================================================================
create or replace function public.health_education_category_counts()
returns table (category public.health_education_category, item_count integer)
language sql
stable
security definer
set search_path = ''
as $$
  select c.category, count(*)::integer
  from public.health_education_content c
  where c.is_active
  group by c.category;
$$;

revoke execute on function public.health_education_category_counts() from public;
revoke execute on function public.health_education_category_counts() from anon;
grant execute on function public.health_education_category_counts() to authenticated;

-- ============================================================================
-- Assertions — prove the backfill left nothing behind and the new surface
-- actually returns rows before calling this migration done.
-- ============================================================================
do $$
declare
  uncategorised integer;
  library_rows integer;
begin
  select count(*) into uncategorised from public.health_education_content where category is null;
  if uncategorised > 0 then
    raise exception 'health_education_content has % row(s) with no category after backfill', uncategorised;
  end if;

  select count(*) into library_rows from public.health_education_content where is_active;
  if library_rows < 1 then
    raise exception 'expected at least one active health_education_content row';
  end if;
end $$;
