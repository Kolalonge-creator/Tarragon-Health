-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- Singleton config row (id is always `true`) — admin-editable conversion rate.
create table public.wellness_points_config (
  id                  boolean primary key default true check (id),
  points_to_kobo_rate numeric not null default 1, -- PLACEHOLDER: 1 point = ₦1 (founder to confirm)
  updated_at          timestamptz not null default now()
);
insert into public.wellness_points_config (id) values (true) on conflict (id) do nothing;

create table public.wellness_points_balances (
  patient_id      uuid primary key references public.profiles (id) on delete cascade,
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  balance         integer not null default 0 check (balance >= 0),
  lifetime_earned integer not null default 0 check (lifetime_earned >= 0),
  updated_at      timestamptz not null default now()
);

-- Append-only activity/audit log. Every earn AND every spend gets a row here
-- (spends carry negative points) — this is also what streak/badge criteria
-- read from, so "did something today" only ever needs one table.
create table public.wellness_points_ledger (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  patient_id      uuid not null references public.profiles (id) on delete cascade,
  points          integer not null check (points <> 0),
  balance_after   integer not null check (balance_after >= 0),
  reason          text not null,
  source_table    text,
  source_id       uuid,
  created_at      timestamptz not null default now()
);
create index wellness_points_ledger_patient_idx
  on public.wellness_points_ledger (patient_id, created_at desc);
-- Idempotency: at most one award per (patient, source row, reason) — a
-- retried trigger fire (e.g. a re-saved update) never double-pays.
create unique index wellness_points_ledger_dedupe
  on public.wellness_points_ledger (patient_id, source_table, source_id, reason)
  where source_table is not null and source_id is not null;

create table public.wellness_points_redemptions (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  patient_id      uuid not null references public.profiles (id) on delete cascade,
  points_redeemed integer not null check (points_redeemed > 0),
  kobo_credited   bigint not null check (kobo_credited > 0),
  wallet_ledger_id uuid,
  created_at      timestamptz not null default now()
);
create index wellness_points_redemptions_patient_idx
  on public.wellness_points_redemptions (patient_id, created_at desc);

-- Global badge catalogue (admin-managed, no organisation_id — same pattern
-- as lifestyle_programmes/health_education_content). criteria_type drives a
-- small, generic evaluator in private.check_and_award_wellness_badges — no
-- badge-specific code needed to add a new one.
create table public.wellness_badges (
  id                     uuid primary key default gen_random_uuid(),
  code                   text not null unique,
  name                   text not null,
  description            text,
  icon                   text not null default 'award',
  criteria_type          text not null check (
    criteria_type in ('points_total', 'entries_total', 'reason_count', 'streak_days', 'challenge_completions')
  ),
  criteria_reason        text, -- only meaningful for criteria_type = 'reason_count'
  criteria_threshold     integer not null check (criteria_threshold > 0),
  is_active              boolean not null default true,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create table public.patient_wellness_badges (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  patient_id      uuid not null references public.profiles (id) on delete cascade,
  badge_id        uuid not null references public.wellness_badges (id) on delete cascade,
  awarded_at      timestamptz not null default now(),
  unique (patient_id, badge_id)
);
create index patient_wellness_badges_patient_idx
  on public.patient_wellness_badges (patient_id, awarded_at desc);

drop trigger if exists wellness_points_config_set_updated_at on public.wellness_points_config;
create trigger wellness_points_config_set_updated_at
  before update on public.wellness_points_config
  for each row execute function private.set_updated_at();

drop trigger if exists wellness_badges_set_updated_at on public.wellness_badges;
create trigger wellness_badges_set_updated_at
  before update on public.wellness_badges
  for each row execute function private.set_updated_at();
;
