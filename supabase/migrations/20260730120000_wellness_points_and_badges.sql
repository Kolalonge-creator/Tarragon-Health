-- Wellness gamification, part 1: points economy + badges (Healthy-365-style
-- engagement layer, explicit founder ask 2026-07-30).
--
-- Points reward ENGAGEMENT actions that currently earn nothing (logging,
-- streaks, education, challenges — wired in the companion
-- wellness_points_earning_triggers migration). Screening/vaccination/health-
-- check/referral events already pay real Health Wallet cash via
-- private.prevention_reward (20260723195211_referrals_and_prevention_rewards)
-- — deliberately NOT double-rewarded with points here, to avoid two parallel
-- incentive systems paying the same event.
--
-- Redemption is NOT a separate voucher/rewards-shop with its own funding
-- source (no such budget exists, and inventing one would be dishonest).
-- Points convert to Health Wallet balance at an admin-set rate, reusing the
-- wallet's existing ledger/spend machinery (private.wallet_apply) — a point
-- is only ever worth what it becomes in the wallet, spendable on real
-- Tarragon care exactly like every other wallet credit.
--
-- Balance uses a real mutable row + row lock (private.wellness_points_ledger
-- is append-only telemetry, same split as health_wallets/wallet_ledger) so
-- redemption can never double-spend under concurrent requests.

-- ---------------------------------------------------------------------------
-- Wallet plumbing: one new entry type for a traceable redemption line.
-- ---------------------------------------------------------------------------
alter type public.wallet_entry_type add value if not exists 'points_redemption';

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

-- ---------------------------------------------------------------------------
-- Helpers (private schema, unexposed)
-- ---------------------------------------------------------------------------

create or replace function private.ensure_wellness_points_balance(p_patient uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  if exists (select 1 from public.wellness_points_balances where patient_id = p_patient) then
    return;
  end if;
  select organisation_id into v_org from public.profiles where id = p_patient;
  if v_org is null then return; end if;
  insert into public.wellness_points_balances (patient_id, organisation_id)
  values (p_patient, v_org)
  on conflict (patient_id) do nothing;
end;
$$;

-- Badge evaluation: a small generic engine over the ledger + related tables.
-- Never blocks a caller — swallows its own errors.
create or replace function private.check_and_award_wellness_badges(p_patient uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_badge record;
  v_org uuid;
  v_qualifies boolean;
  v_lifetime integer;
  v_entries integer;
begin
  select organisation_id into v_org from public.profiles where id = p_patient;
  if v_org is null then return; end if;

  select lifetime_earned into v_lifetime
    from public.wellness_points_balances where patient_id = p_patient;
  select count(*) into v_entries
    from public.wellness_points_ledger where patient_id = p_patient and points > 0;

  for v_badge in select * from public.wellness_badges where is_active loop
    if exists (
      select 1 from public.patient_wellness_badges
      where patient_id = p_patient and badge_id = v_badge.id
    ) then
      continue;
    end if;

    v_qualifies := false;
    if v_badge.criteria_type = 'points_total' then
      v_qualifies := coalesce(v_lifetime, 0) >= v_badge.criteria_threshold;
    elsif v_badge.criteria_type = 'entries_total' then
      v_qualifies := coalesce(v_entries, 0) >= v_badge.criteria_threshold;
    elsif v_badge.criteria_type = 'reason_count' then
      v_qualifies := (
        select count(*) from public.wellness_points_ledger
        where patient_id = p_patient and points > 0 and reason = v_badge.criteria_reason
      ) >= v_badge.criteria_threshold;
    elsif v_badge.criteria_type = 'challenge_completions' then
      v_qualifies := (
        select count(*) from public.patient_challenge_enrolments
        where patient_id = p_patient and status = 'completed'
      ) >= v_badge.criteria_threshold;
    elsif v_badge.criteria_type = 'streak_days' then
      -- Every day in the last N (including today) has at least one earn row.
      v_qualifies := not exists (
        select 1 from generate_series(0, v_badge.criteria_threshold - 1) as gs (n)
        where not exists (
          select 1 from public.wellness_points_ledger
          where patient_id = p_patient and points > 0
            and created_at::date = current_date - gs.n
        )
      );
    end if;

    if v_qualifies then
      insert into public.patient_wellness_badges (organisation_id, patient_id, badge_id)
      values (v_org, p_patient, v_badge.id)
      on conflict (patient_id, badge_id) do nothing;
    end if;
  end loop;
exception when others then
  null;
end;
$$;

-- The single write path for every points EARN. Locks the balance row,
-- computes the candidate new balance, then attempts the idempotent ledger
-- insert BEFORE committing the balance change — a duplicate (patient,
-- source, reason) event leaves the balance untouched. Never raises: a
-- gamification failure must never block the underlying write it hangs off.
create or replace function private.award_wellness_points(
  p_patient uuid,
  p_points integer,
  p_reason text,
  p_source_table text default null,
  p_source_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bal public.wellness_points_balances%rowtype;
  v_new_balance integer;
begin
  if p_patient is null or p_points is null or p_points <= 0 then return; end if;
  perform private.ensure_wellness_points_balance(p_patient);

  select * into v_bal from public.wellness_points_balances where patient_id = p_patient for update;
  if not found then return; end if;
  v_new_balance := v_bal.balance + p_points;

  begin
    insert into public.wellness_points_ledger
      (organisation_id, patient_id, points, balance_after, reason, source_table, source_id)
    values
      (v_bal.organisation_id, p_patient, p_points, v_new_balance, p_reason, p_source_table, p_source_id);
  exception when unique_violation then
    return; -- already awarded for this exact event
  end;

  update public.wellness_points_balances
    set balance = v_new_balance, lifetime_earned = lifetime_earned + p_points, updated_at = now()
    where patient_id = p_patient;

  perform private.check_and_award_wellness_badges(p_patient);
exception when others then
  null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Public RPCs
-- ---------------------------------------------------------------------------

create or replace function public.redeem_wellness_points(p_points integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_bal public.wellness_points_balances%rowtype;
  v_rate numeric;
  v_kobo bigint;
  v_wallet uuid;
  v_ledger_id uuid;
begin
  if v_caller is null then raise exception 'not authenticated'; end if;
  if p_points is null or p_points <= 0 then
    return jsonb_build_object('ok', false, 'error', 'Enter a positive number of points.');
  end if;

  select * into v_bal from public.wellness_points_balances where patient_id = v_caller for update;
  if not found or v_bal.balance < p_points then
    return jsonb_build_object('ok', false, 'error', 'You don''t have enough points for that yet.');
  end if;

  select points_to_kobo_rate into v_rate from public.wellness_points_config where id = true;
  v_kobo := round(p_points * coalesce(v_rate, 1));
  if v_kobo <= 0 then
    return jsonb_build_object('ok', false, 'error', 'Redemption isn''t available right now.');
  end if;

  update public.wellness_points_balances
    set balance = balance - p_points, updated_at = now()
    where patient_id = v_caller;

  insert into public.wellness_points_ledger
    (organisation_id, patient_id, points, balance_after, reason)
  values (v_bal.organisation_id, v_caller, -p_points, v_bal.balance - p_points, 'redeemed_to_wallet');

  v_wallet := private.ensure_wallet(v_caller);
  v_ledger_id := private.wallet_apply(
    v_wallet, v_kobo, 'points_redemption', v_caller, 'Wellness points redeemed to wallet');

  insert into public.wellness_points_redemptions
    (organisation_id, patient_id, points_redeemed, kobo_credited, wallet_ledger_id)
  values (v_bal.organisation_id, v_caller, p_points, v_kobo, v_ledger_id);

  return jsonb_build_object(
    'ok', true, 'balance', v_bal.balance - p_points, 'kobo_credited', v_kobo);
end;
$$;

revoke execute on function public.redeem_wellness_points(integer) from public, anon;
grant execute on function public.redeem_wellness_points(integer) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.wellness_points_config enable row level security;
alter table public.wellness_points_balances enable row level security;
alter table public.wellness_points_ledger enable row level security;
alter table public.wellness_points_redemptions enable row level security;
alter table public.wellness_badges enable row level security;
alter table public.patient_wellness_badges enable row level security;

create policy wellness_points_config_select on public.wellness_points_config
  for select to authenticated using (true);
create policy wellness_points_config_write on public.wellness_points_config
  for update to authenticated using (private.is_admin()) with check (private.is_admin());

create policy wellness_points_balances_select on public.wellness_points_balances
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

create policy wellness_points_ledger_select on public.wellness_points_ledger
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

create policy wellness_points_redemptions_select on public.wellness_points_redemptions
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

create policy wellness_badges_select on public.wellness_badges
  for select to authenticated using (is_active or private.is_admin());
create policy wellness_badges_write on public.wellness_badges
  for all to authenticated using (private.is_admin()) with check (private.is_admin());

create policy patient_wellness_badges_select on public.patient_wellness_badges
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

grant select on public.wellness_points_config to authenticated;
grant update on public.wellness_points_config to authenticated;
grant select on public.wellness_points_balances to authenticated;
grant select on public.wellness_points_ledger to authenticated;
grant select on public.wellness_points_redemptions to authenticated;
grant select, insert, update, delete on public.wellness_badges to authenticated;
grant select on public.patient_wellness_badges to authenticated;

-- ---------------------------------------------------------------------------
-- Seed: a small, honest v1 badge set.
-- ---------------------------------------------------------------------------
insert into public.wellness_badges (code, name, description, icon, criteria_type, criteria_reason, criteria_threshold) values
  ('first_step',        'First Step',        'Logged your first wellness activity.',            'award',  'entries_total',       null,                          1),
  ('streak_7',          '7-Day Streak',      'Logged something every day for a week.',           'flame',  'streak_days',         null,                          7),
  ('streak_30',         '30-Day Streak',     'Logged something every day for a month.',          'flame',  'streak_days',         null,                          30),
  ('meal_logger',       'Meal Logger',       'Logged 10 meals.',                                  'utensils', 'reason_count',      'meal_logged',                 10),
  ('vitals_champion',   'Vitals Champion',   'Logged 20 vitals readings.',                        'heart',  'reason_count',        'vitals_logged',               20),
  ('lesson_learner',    'Lesson Learner',    'Completed 5 health education lessons.',             'book',   'reason_count',        'education_lesson_completed',  5),
  ('goal_getter',       'Goal Getter',       'Achieved a lifestyle goal.',                        'target', 'reason_count',        'lpe_goal_achieved',           1),
  ('challenge_champion','Challenge Champion','Completed a wellness challenge.',                   'trophy', 'challenge_completions', null,                        1),
  ('points_500',        '500 Points',        'Earned 500 wellness points.',                       'star',   'points_total',        null,                          500),
  ('points_2000',       '2,000 Points',      'Earned 2,000 wellness points.',                     'star',   'points_total',        null,                          2000)
on conflict (code) do nothing;
