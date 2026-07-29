-- Tarragon Health — Annual Health Review pathway
--
-- A once-a-year, whole-body "general workup" for patients subscribed to the
-- paid Annual Review programme. It is an ORCHESTRATION layer that sits ABOVE
-- the existing condition-specific reviews (medication_review_engine,
-- drug-class lab monitoring, preventive screening) — it NEVER replaces them.
-- Condition reviews keep their own cadence and worklists intact; the annual
-- review covers the aspects a condition review omits (e.g. an ECG / broad
-- bloods / cancer-screening prompts for a diabetic whose routine review only
-- touches glucose control), and ends with a doctor-led video consult that
-- walks the patient through their whole year on the platform + the plan ahead.
--
-- Pathway (the founder's ordered flow):
--   due -> questionnaire -> labs -> medication_review -> risk_score ->
--   care_plan -> video_consult -> completed
--
-- Model:
--   * annual_reviews — one orchestrating row per patient per cycle_year
--     (unique). Per-stage completion timestamps + FK links are all nullable
--     and null-gated in the UI (same posture as ReviewedByDoctor/YourCareTeam).
--     reviewed_by (-> clinical_staff) + completed_at are SERVER-STAMPED at
--     completion from the caller's own clinical_staff row, never client-
--     supplied — so "Reviewed by Dr X" can never be forged (same rule as
--     medication_reviews.reviewed_by / medications.last_confirmed_by).
--   * annual_review_workup_catalogue — global reference list of the general-
--     workup items an annual review can cover (ECG, FBC, U&E, LFTs, lipids…).
--   * annual_review_workup_items — the per-review checklist, each optionally
--     linking the lab_orders row that fulfils it. Abnormal workup labs still
--     flow through the existing abnormal-result Cat 2->1 pipeline untouched.
--   * Med-review reconciliation (founder decision): completing the annual
--     review's medication_review stage COMPLETES the patient's pending
--     medication_reviews, which rolls their next per-condition review via the
--     existing ensure_medication_review trigger. The annual review ADOPTS the
--     due condition review rather than creating a parallel one — no double
--     review, condition clock stays intact.
--   * Video consult reuses the existing Zoom video_consultations infra — a new
--     'annual_review' context, additive.
--   * queue_annual_reviews — daily cron opens a new review for every entitled
--     patient whose last review was >= ~11 months ago (or never), seeds its
--     workup items, and enqueues a reminder. Rolling yearly.
-- All idempotent-guarded.

-- ---------------------------------------------------------------------------
-- 1. Enums
-- ---------------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_type where typname = 'annual_review_status') then
    create type public.annual_review_status as enum (
      'pending', 'in_progress', 'completed', 'cancelled'
    );
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'annual_review_stage') then
    create type public.annual_review_stage as enum (
      'due', 'questionnaire', 'labs', 'medication_review',
      'risk_score', 'care_plan', 'video_consult', 'completed'
    );
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'annual_review_workup_status') then
    create type public.annual_review_workup_status as enum (
      'pending', 'ordered', 'completed', 'not_applicable'
    );
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. annual_reviews — the orchestrating row
-- ---------------------------------------------------------------------------
create table if not exists public.annual_reviews (
  id                          uuid primary key default gen_random_uuid(),
  organisation_id             uuid not null references public.organisations (id) on delete restrict,
  patient_id                  uuid not null references public.profiles (id) on delete cascade,
  cycle_year                  integer not null,
  status                      public.annual_review_status not null default 'pending',
  current_stage               public.annual_review_stage not null default 'due',
  due_date                    date not null,

  -- Ordered-flow completion stamps (all null-gated in the UI).
  questionnaire_completed_at  timestamptz,
  labs_completed_at           timestamptz,
  medication_review_completed_at timestamptz,
  risk_score_id               uuid references public.patient_risk_scores (id) on delete set null,
  risk_score_computed_at      timestamptz,
  care_plan_updated_at        timestamptz,
  video_consultation_id       uuid references public.video_consultations (id) on delete set null,
  video_completed_at          timestamptz,

  -- The doctor's whole-year summary discussed on the video consult.
  year_summary                text,
  notes                       text,

  -- Forge-proof completion attribution (server-stamped, see trigger below).
  reviewed_by                 uuid references public.clinical_staff (id) on delete set null,
  completed_at                timestamptz,

  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),

  -- One annual review per patient per year — the rolling scheduler relies on this.
  unique (patient_id, cycle_year)
);

create index if not exists annual_reviews_patient_idx on public.annual_reviews (patient_id);
create index if not exists annual_reviews_org_status_idx
  on public.annual_reviews (organisation_id, status, due_date);

drop trigger if exists annual_reviews_set_updated_at on public.annual_reviews;
create trigger annual_reviews_set_updated_at
  before update on public.annual_reviews
  for each row execute function private.set_updated_at();

alter table public.annual_reviews enable row level security;

drop policy if exists annual_reviews_select on public.annual_reviews;
create policy annual_reviews_select on public.annual_reviews
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

drop policy if exists annual_reviews_insert on public.annual_reviews;
create policy annual_reviews_insert on public.annual_reviews
  for insert to authenticated
  with check (private.is_org_staff(organisation_id));

drop policy if exists annual_reviews_update on public.annual_reviews;
create policy annual_reviews_update on public.annual_reviews
  for update to authenticated
  using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));

grant select, insert, update on public.annual_reviews to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Workup catalogue + per-review checklist
-- ---------------------------------------------------------------------------
create table if not exists public.annual_review_workup_catalogue (
  code               text primary key,
  label              text not null,
  description        text,
  -- Seeded by default into every new review (a clinician can mark n/a).
  default_applicable boolean not null default true,
  sort_order         integer not null default 100,
  created_at         timestamptz not null default now()
);

-- The general-workup items an annual review covers that a condition review does
-- not. Deliberately broad-body, not condition-scoped.
insert into public.annual_review_workup_catalogue (code, label, description, default_applicable, sort_order) values
  ('bp_bmi_check',        'Blood pressure & BMI',           'Baseline vitals and weight review for the year.',                       true,  10),
  ('ecg',                 'ECG',                            'Resting 12-lead ECG — cardiac screen not part of routine condition reviews.', true, 20),
  ('fbc',                 'Full blood count',               'General haematology screen.',                                           true,  30),
  ('u_and_e',             'Urea & electrolytes / renal',    'Kidney function + electrolytes.',                                       true,  40),
  ('lfts',                'Liver function tests',           'General hepatic screen.',                                               true,  50),
  ('lipid_profile',       'Lipid profile',                  'Cardiovascular risk bloods.',                                           true,  60),
  ('glucose_or_hba1c',    'Fasting glucose / HbA1c',        'Metabolic screen (HbA1c if already diabetic, fasting glucose if not).', true,  70),
  ('tsh',                 'Thyroid function (TSH)',         'Thyroid screen.',                                                       true,  80),
  ('urinalysis',          'Urinalysis',                     'Dipstick + protein/creatinine where indicated.',                        true,  90),
  ('cancer_screening_review','Cancer screening review',     'Age/sex-appropriate screening prompts (cervical, breast, prostate, colorectal).', true, 100)
on conflict (code) do update
  set label = excluded.label,
      description = excluded.description,
      default_applicable = excluded.default_applicable,
      sort_order = excluded.sort_order;

alter table public.annual_review_workup_catalogue enable row level security;

drop policy if exists annual_review_workup_catalogue_select on public.annual_review_workup_catalogue;
create policy annual_review_workup_catalogue_select on public.annual_review_workup_catalogue
  for select to authenticated using (true);

grant select on public.annual_review_workup_catalogue to authenticated;

create table if not exists public.annual_review_workup_items (
  id                uuid primary key default gen_random_uuid(),
  annual_review_id  uuid not null references public.annual_reviews (id) on delete cascade,
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  code              text not null references public.annual_review_workup_catalogue (code) on delete restrict,
  label             text not null,
  status            public.annual_review_workup_status not null default 'pending',
  lab_order_id      uuid references public.lab_orders (id) on delete set null,
  result_summary    text,
  completed_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (annual_review_id, code)
);

create index if not exists annual_review_workup_items_review_idx
  on public.annual_review_workup_items (annual_review_id);

drop trigger if exists annual_review_workup_items_set_updated_at on public.annual_review_workup_items;
create trigger annual_review_workup_items_set_updated_at
  before update on public.annual_review_workup_items
  for each row execute function private.set_updated_at();

alter table public.annual_review_workup_items enable row level security;

-- Read follows the parent review (patient reads own, staff read org). Writes
-- are staff-only.
drop policy if exists annual_review_workup_items_select on public.annual_review_workup_items;
create policy annual_review_workup_items_select on public.annual_review_workup_items
  for select to authenticated
  using (
    exists (
      select 1 from public.annual_reviews ar
      where ar.id = annual_review_id
        and (ar.patient_id = (select auth.uid()) or private.is_org_staff(ar.organisation_id))
    )
  );

drop policy if exists annual_review_workup_items_insert on public.annual_review_workup_items;
create policy annual_review_workup_items_insert on public.annual_review_workup_items
  for insert to authenticated
  with check (private.is_org_staff(organisation_id));

drop policy if exists annual_review_workup_items_update on public.annual_review_workup_items;
create policy annual_review_workup_items_update on public.annual_review_workup_items
  for update to authenticated
  using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));

grant select, insert, update on public.annual_review_workup_items to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Video consult context — extend the shared Zoom infra
-- ---------------------------------------------------------------------------
alter type public.video_consultation_context add value if not exists 'annual_review';

alter table public.video_consultations
  add column if not exists annual_review_id uuid references public.annual_reviews (id) on delete set null;

create index if not exists video_consultations_annual_review_idx
  on public.video_consultations (annual_review_id);

-- NOTE: the context<->link CHECK constraint that USES the new 'annual_review'
-- enum value is relaxed in a SEPARATE migration (20260717121000_…): Postgres
-- forbids using a freshly-added enum value in the same transaction that adds
-- it, and each migration is its own transaction.

-- ---------------------------------------------------------------------------
-- 5. Completion attribution (server-derived reviewed_by)
-- ---------------------------------------------------------------------------
create or replace function private.stamp_annual_review_completion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff_id uuid;
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    select id into v_staff_id
    from public.clinical_staff
    where profile_id = (select auth.uid())
      and organisation_id = new.organisation_id
      and active;
    new.completed_at := coalesce(new.completed_at, now());
    new.reviewed_by := v_staff_id;
    new.current_stage := 'completed';
  end if;
  return new;
end;
$$;

drop trigger if exists annual_reviews_stamp_completion on public.annual_reviews;
create trigger annual_reviews_stamp_completion
  before update on public.annual_reviews
  for each row execute function private.stamp_annual_review_completion();

-- ---------------------------------------------------------------------------
-- 6. Med-review reconciliation — annual review ADOPTS pending condition reviews
-- ---------------------------------------------------------------------------
-- When the annual review's medication_review stage is completed, complete the
-- patient's still-pending medication_reviews. The existing
-- medication_reviews_stamp_completion + ensure_medication_review triggers then
-- stamp reviewed_by (from the same caller) and roll the next per-condition
-- review — so the annual review satisfies + rolls the condition clock instead
-- of running a parallel review. Only fires on the null->set transition.
create or replace function private.reconcile_annual_medication_reviews()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.medication_review_completed_at is not null
     and old.medication_review_completed_at is null then
    update public.medication_reviews
      set status = 'completed'
      where patient_id = new.patient_id
        and status = 'pending';
  end if;
  return new;
end;
$$;

drop trigger if exists annual_reviews_reconcile_med_reviews on public.annual_reviews;
create trigger annual_reviews_reconcile_med_reviews
  after update on public.annual_reviews
  for each row execute function private.reconcile_annual_medication_reviews();

-- ---------------------------------------------------------------------------
-- 7. Scheduler — open a review for every entitled patient, rolling yearly
-- ---------------------------------------------------------------------------
-- Entitlement mirrors public.has_feature_access('annual_review') but resolved
-- across all patients server-side: an active/trialing base plan OR add-on whose
-- features[] contains 'annual_review'. A review is opened when the patient has
-- no pending/in_progress review AND their most recent review (if any) either
-- completed or was due >= 11 months ago.
create or replace function private.queue_annual_reviews()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_year integer := extract(year from current_date);
  r record;
  v_review_id uuid;
begin
  for r in
    select distinct s.subscriber_id as patient_id, p.organisation_id
    from public.subscriptions s
    join public.profiles p on p.id = s.subscriber_id
    left join public.subscription_plans pl on pl.id = s.plan_id
    where s.status in ('active', 'trialing')
      and p.role = 'patient'
      and (
        (pl.features is not null and 'annual_review' = any(pl.features))
        or exists (
          select 1
          from public.subscription_add_ons sao
          join public.add_ons a on a.id = sao.add_on_id
          where sao.subscription_id = s.id
            and sao.status in ('active', 'trialing')
            and 'annual_review' = any(a.features)
        )
      )
  loop
    -- Skip if there is already an open review, or a recent one (< 11 months).
    if exists (
      select 1 from public.annual_reviews ar
      where ar.patient_id = r.patient_id
        and (
          ar.status in ('pending', 'in_progress')
          or ar.due_date > current_date - interval '11 months'
        )
    ) then
      continue;
    end if;

    insert into public.annual_reviews (organisation_id, patient_id, cycle_year, due_date)
    values (r.organisation_id, r.patient_id, v_year, current_date)
    on conflict (patient_id, cycle_year) do nothing
    returning id into v_review_id;

    if v_review_id is null then
      continue;
    end if;

    -- Seed the default workup checklist from the catalogue.
    insert into public.annual_review_workup_items
      (annual_review_id, organisation_id, code, label)
    select v_review_id, r.organisation_id, c.code, c.label
    from public.annual_review_workup_catalogue c
    where c.default_applicable
    on conflict (annual_review_id, code) do nothing;

    -- Reminder notification (WhatsApp is a notification layer only).
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    values (
      r.organisation_id, r.patient_id, 'whatsapp', 'pending', 'annual_review_due',
      jsonb_build_object('cycle_year', v_year)
    );
  end loop;
end;
$$;

select cron.schedule(
  'annual-reviews-daily',
  '30 6 * * *',
  $$select private.queue_annual_reviews();$$
);

-- ---------------------------------------------------------------------------
-- 8. Entitlement — grant 'annual_review' to the comprehensive paid plans
-- ---------------------------------------------------------------------------
-- Features-only update (never touches price/currency/interval), so the
-- price-lock trigger does not block it even for plans with active subscribers.
-- A standalone à-la-carte add-on can be introduced later if the programme is
-- sold separately from the tiers.
update public.subscription_plans
  set features = (
    select array(select distinct unnest(coalesce(features, '{}') || array['annual_review']))
  )
  where code in (
    'complete', 'complete_yearly',
    'family', 'family_yearly',
    'family_plus', 'family_premium',
    'parentcare', 'parentcare_yearly'
  )
  and not ('annual_review' = any(coalesce(features, '{}')));
