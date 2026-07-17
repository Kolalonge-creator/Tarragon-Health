-- Tarragon Health — Health Education pathway (engagement layer)
--
-- A personalised, condition-driven, clinician-reviewed learning surface that
-- sits INSIDE the patient dashboard and is entitlement-gated at the app layer
-- to complete/family/parentcare tiers + a health-education add-on for
-- essential patients (see 20260717151000_health_education_entitlement.sql).
--
-- Design (full detail in docs/HEALTH_EDUCATION_PATHWAY_SPEC.md):
--   • Content is a GLOBAL catalogue (no organisation_id) like lifestyle_programmes.
--   • Personalisation keys off the caller's active care_plans conditions
--     (primary) + latest patient_risk_scores.risk_level (secondary).
--   • "Clinician-reviewed" is a LIBRARY-LEVEL quality badge, never a per-patient
--     clinical attribution — so it does not touch the reviewed_by/reviewed_at
--     per-touchpoint attribution rule.
--   • NO behaviour-change table: impact is read from existing adherence/vitals
--     signals, never asserted here. A knowledge-check score is engagement
--     telemetry only, never clinical assessment, never feeds risk/escalation.
--
-- Patterns reused verbatim (no new pattern invented):
--   • global catalogue + admin-write RLS  → lifestyle_programmes / chronic_condition_programmes
--   • patient-owner + private.is_org_staff → every patient-owned table
--   • security-definer feed keyed to auth.uid() → public.has_feature_access
-- All idempotent-guarded.

-- ============================================================================
-- Enums
-- ============================================================================
do $$ begin
  if not exists (select 1 from pg_type where typname = 'health_education_content_type') then
    create type public.health_education_content_type as enum ('article', 'video');
  end if;
  if not exists (select 1 from pg_type where typname = 'health_education_status') then
    create type public.health_education_status as enum ('seen', 'understood', 'needs_review');
  end if;
end $$;

-- ============================================================================
-- 1. Content — global catalogue (admin-managed, shared across orgs)
-- ============================================================================
create table if not exists public.health_education_content (
  id                uuid primary key default gen_random_uuid(),
  code              text not null unique,
  title             text not null,
  summary           text,
  body              text not null,
  content_type      public.health_education_content_type not null default 'article',
  video_url         text,
  estimated_minutes integer check (estimated_minutes is null or estimated_minutes > 0),
  -- Personalisation tags. NULL condition = applies to everyone. NULL
  -- min_risk_level = no risk floor (shows regardless of risk).
  condition         public.care_plan_condition,
  min_risk_level    public.risk_level,
  -- Library-level review badge — NOT a per-patient clinical attribution.
  clinician_reviewed boolean not null default false,
  reviewed_by_name  text,
  reviewed_at       timestamptz,
  -- Optional inline knowledge check: [{question, options:[...], answer_index}].
  knowledge_check   jsonb,
  sort_order        integer not null default 100,
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists health_education_content_active_idx
  on public.health_education_content (is_active, condition, sort_order);

-- ============================================================================
-- 2. Progress — patient-owned per-item state ("seen / understood / needs review")
-- ============================================================================
create table if not exists public.health_education_progress (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  patient_id      uuid not null references public.profiles (id) on delete cascade,
  content_id      uuid not null references public.health_education_content (id) on delete cascade,
  status          public.health_education_status not null default 'seen',
  check_score     integer check (check_score is null or check_score >= 0),
  check_total     integer check (check_total is null or check_total >= 0),
  last_viewed_at  timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (patient_id, content_id)
);
create index if not exists health_education_progress_patient_idx
  on public.health_education_progress (patient_id, status);
create index if not exists health_education_progress_org_idx
  on public.health_education_progress (organisation_id);

-- ============================================================================
-- updated_at triggers
-- ============================================================================
do $$
declare t text;
begin
  foreach t in array array['health_education_content', 'health_education_progress'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_set_updated_at', t);
    execute format(
      'create trigger %I before update on public.%I for each row execute function private.set_updated_at()',
      t || '_set_updated_at', t);
  end loop;
end $$;

-- ============================================================================
-- RLS
-- ============================================================================
alter table public.health_education_content  enable row level security;
alter table public.health_education_progress enable row level security;

-- --- content: any signed-in user reads active rows; admin writes ------------
drop policy if exists health_education_content_select on public.health_education_content;
create policy health_education_content_select on public.health_education_content
  for select to authenticated
  using (is_active or private.is_admin());
drop policy if exists health_education_content_write on public.health_education_content;
create policy health_education_content_write on public.health_education_content
  for all to authenticated
  using (private.is_admin())
  with check (private.is_admin());

-- --- progress: patient self-manages own rows; org staff read ----------------
drop policy if exists health_education_progress_select on public.health_education_progress;
create policy health_education_progress_select on public.health_education_progress
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));
drop policy if exists health_education_progress_insert on public.health_education_progress;
create policy health_education_progress_insert on public.health_education_progress
  for insert to authenticated
  with check (patient_id = (select auth.uid()) and organisation_id = private.current_org_id());
drop policy if exists health_education_progress_update on public.health_education_progress;
create policy health_education_progress_update on public.health_education_progress
  for update to authenticated
  using (patient_id = (select auth.uid()))
  with check (patient_id = (select auth.uid()));

grant select, insert, update, delete on public.health_education_content to authenticated;
grant select, insert, update on public.health_education_progress to authenticated;

-- ============================================================================
-- Feed RPC — the "picks the next item" engine, keyed to auth.uid().
--   Returns active content that matches the caller's active care-plan
--   conditions (or has no condition) AND clears the caller's risk floor,
--   left-joined to their progress, ordered needs_review → un-started →
--   understood, then by sort_order. security definer so it can read the
--   caller's care_plans/risk without exposing them, resolves for auth.uid()
--   only (no spoofing surface) — same shape as public.has_feature_access.
-- ============================================================================
create or replace function public.health_education_feed()
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
  with me as (
    select (select auth.uid()) as uid
  ),
  my_conditions as (
    select distinct cp.condition
    from public.care_plans cp, me
    where cp.patient_id = me.uid and cp.status = 'active'
  ),
  -- Most severe risk_level the caller currently has any score for; a patient
  -- with no scores is treated as 'low' so only no-floor / low-floor content shows.
  my_risk as (
    select coalesce(max(prs.risk_level), 'low'::public.risk_level) as risk_level
    from public.patient_risk_scores prs, me
    where prs.patient_id = me.uid
  )
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
    c.clinician_reviewed,
    c.reviewed_by_name,
    (c.knowledge_check is not null and jsonb_array_length(c.knowledge_check) > 0) as has_knowledge_check,
    c.knowledge_check,
    p.status,
    p.check_score,
    p.check_total
  from public.health_education_content c
  cross join my_risk
  left join public.health_education_progress p
    on p.content_id = c.id and p.patient_id = (select auth.uid())
  where c.is_active
    and (c.condition is null or c.condition in (select condition from my_conditions))
    and (c.min_risk_level is null or c.min_risk_level <= my_risk.risk_level)
  order by
    case coalesce(p.status, 'seen')
      when 'needs_review' then 0
      else 1
    end,
    case when p.status is null then 0 else 1 end,           -- un-started before touched
    case when p.status = 'understood' then 1 else 0 end,    -- understood sinks to the bottom
    c.sort_order,
    c.title;
$$;

revoke execute on function public.health_education_feed() from public;
revoke execute on function public.health_education_feed() from anon;
grant execute on function public.health_education_feed() to authenticated;

-- ============================================================================
-- Seed: a small honest starter library. Placeholder copy pending a real
-- clinician-vetted, Nigeria-relevant content pass. Brand voice: calm, plain,
-- no fear-based urgency. Knowledge checks are optional per item.
-- ============================================================================
insert into public.health_education_content
  (code, title, summary, body, content_type, estimated_minutes, condition, min_risk_level,
   clinician_reviewed, reviewed_by_name, reviewed_at, knowledge_check, sort_order)
values
  ('welcome-your-numbers', 'Making sense of your health numbers',
   'A gentle orientation to the readings your care team follows and why they matter.',
   E'Your care team follows a few key numbers over time — things like your blood pressure, blood sugar, and weight. No single reading tells the whole story; what matters is the pattern across weeks and months.\n\nLogging steadily, even when you feel fine, is what lets your doctor spot a change early. This is the quiet work that keeps care ahead of problems rather than chasing them.',
   'article', 4, null, null,
   true, 'The Tarragon clinical team', now(), null, 10),

  ('htn-understanding-bp', 'Understanding your blood pressure',
   'What the two numbers mean, and the everyday habits that help most.',
   E'Blood pressure is written as two numbers — the top (systolic) is the push when your heart beats, the bottom (diastolic) is the rest between beats. For most adults, a healthy target is around 120/80, but your own target is set with your doctor.\n\nSmall, steady habits move it most: less added salt, regular movement, taking your medicine at the same time each day, and enough sleep. You do not need to change everything at once — one habit at a time is enough.',
   'article', 5, 'hypertension', null,
   true, 'The Tarragon clinical team', now(),
   '[{"question": "Which number is the systolic (top) reading?", "options": ["The push when the heart beats", "The rest between beats", "The pulse rate"], "answer_index": 0}, {"question": "Which habit helps lower blood pressure?", "options": ["More added salt", "Regular movement", "Skipping sleep"], "answer_index": 1}]'::jsonb,
   20),

  ('htn-salt-everyday', 'Lowering salt without losing flavour',
   'Practical swaps for everyday Nigerian meals.',
   E'Most of the salt we eat is hidden in seasoning cubes, tinned foods, and processed snacks rather than the salt shaker. Cutting back does not mean bland food.\n\nTry: using more fresh pepper, ginger, garlic, and herbs; rinsing tinned beans; choosing fresh over processed meat where you can; and tasting before you add extra salt. Your palate adjusts within a couple of weeks.',
   'article', 4, 'hypertension', 'moderate',
   true, 'The Tarragon clinical team', now(), null, 30),

  ('dm-understanding-sugar', 'Understanding your blood sugar',
   'What HbA1c and daily readings tell you, in plain language.',
   E'Blood sugar rises and falls through the day around what you eat and how active you are. A single high reading is not a crisis — the trend is what your care team watches.\n\nHbA1c is a longer-term average over about three months, which is why your doctor checks it periodically rather than daily. Steady meals, movement after eating, and taking medicine as prescribed keep the trend where you want it.',
   'article', 5, 'diabetes', null,
   true, 'The Tarragon clinical team', now(),
   '[{"question": "What does HbA1c roughly measure?", "options": ["Today''s sugar level", "An average over about three months", "Your blood pressure"], "answer_index": 1}]'::jsonb,
   20),

  ('dm-foot-care', 'Looking after your feet',
   'A short daily routine that prevents most diabetes foot problems.',
   E'Higher blood sugar over time can reduce feeling in the feet, so a small injury can go unnoticed. A quick daily check prevents most problems.\n\nEach day: look over both feet (use a mirror or ask someone for the soles), keep them clean and dry, moisturise but not between the toes, and wear comfortable closed shoes. Tell your care team about any sore, cut, or colour change that is not healing.',
   'article', 4, 'diabetes', 'moderate',
   true, 'The Tarragon clinical team', now(), null, 30),

  ('prev-why-screening', 'Why screening is worth it',
   'Catching things early is easier and cheaper than treating them late.',
   E'Screening looks for problems before you feel anything — which is exactly when they are most treatable. Many serious conditions give no warning signs in their early, most fixable stage.\n\nYour screening calendar is built around your age, sex, and history. Keeping to it is one of the highest-value things you can do for your long-term health, and your care team handles the booking and follow-up with you.',
   'article', 3, null, null,
   true, 'The Tarragon clinical team', now(), null, 40)
on conflict (code) do nothing;
