-- Tarragon Health — the 90-Day Health Reset, built for real.
--
-- The pricing page has long promised "The Tarragon 90-Day Health Reset" as
-- INCLUDED on every plan, plus a milestone free trial on completion — with
-- nothing behind either promise. This makes both real, on the same discipline
-- as every other derived-read-model feature in this codebase (patient_timeline,
-- patient_care_gaps): no invented progress, no new source of truth for
-- anything the platform already tracks. Milestones are computed live from
-- real data (prevention_risk_scores, vitals_readings, care_plans,
-- screening_schedules, preventive_programme_enrolments, health_education_progress),
-- never stored as separately-stamped flags that could drift from reality.

create table if not exists public.patient_health_resets (
  id                   uuid primary key default gen_random_uuid(),
  patient_id           uuid not null unique references public.profiles (id) on delete cascade,
  organisation_id      uuid not null references public.organisations (id) on delete restrict,
  started_at           timestamptz not null default now(),
  completed_at         timestamptz,
  trial_claimed_at     timestamptz,
  trial_subscription_id uuid references public.subscriptions (id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index if not exists patient_health_resets_org_idx on public.patient_health_resets (organisation_id);

drop trigger if exists patient_health_resets_set_updated_at on public.patient_health_resets;
create trigger patient_health_resets_set_updated_at
  before update on public.patient_health_resets
  for each row execute function private.set_updated_at();

alter table public.patient_health_resets enable row level security;

drop policy if exists patient_health_resets_select on public.patient_health_resets;
create policy patient_health_resets_select on public.patient_health_resets
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

-- No direct insert/update policy for anyone — this row is entirely system-
-- managed (the onboarding trigger below creates it, the nightly completion
-- sweep and the claim RPC below are the only writers, both SECURITY DEFINER).

-- ---------------------------------------------------------------------------
-- Start the reset the instant onboarding completes (free on every plan,
-- including Tarragon Free — no purchase, no admin action needed).
-- ---------------------------------------------------------------------------
create or replace function private.start_health_reset_on_onboarding()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.role = 'patient'
     and new.onboarding_completed_at is not null
     and (tg_op = 'INSERT' or old.onboarding_completed_at is null)
     and new.organisation_id is not null
  then
    insert into public.patient_health_resets (patient_id, organisation_id, started_at)
    values (new.id, new.organisation_id, new.onboarding_completed_at)
    on conflict (patient_id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists start_health_reset_on_onboarding on public.profiles;
create trigger start_health_reset_on_onboarding
  after insert or update of onboarding_completed_at on public.profiles
  for each row execute function private.start_health_reset_on_onboarding();

-- Backfill: every patient who already completed onboarding before this
-- migration gets a reset dated from their real onboarding completion, not
-- from today — an existing patient shouldn't lose progress they've already made.
insert into public.patient_health_resets (patient_id, organisation_id, started_at)
select p.id, p.organisation_id, p.onboarding_completed_at
from public.profiles p
where p.role = 'patient'
  and p.onboarding_completed_at is not null
  and p.organisation_id is not null
on conflict (patient_id) do nothing;

-- ---------------------------------------------------------------------------
-- Live progress, read-time only — the same "derived read-model, no new
-- source of truth" discipline as patient_timeline / patient_care_gaps.
-- ---------------------------------------------------------------------------
create or replace function public.patient_health_reset_progress()
returns table (
  reset_id           uuid,
  started_at         timestamptz,
  day_number         integer,
  baseline_done      boolean,
  programme_set_done boolean,
  consistency_done   boolean,
  completed_at       timestamptz,
  trial_claimed_at   timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    r.id,
    r.started_at,
    greatest(1, (extract(day from now() - r.started_at))::int + 1),
    exists(select 1 from public.prevention_risk_scores prs where prs.profile_id = r.patient_id)
      and exists(select 1 from public.vitals_readings vr where vr.patient_id = r.patient_id),
    exists(select 1 from public.care_plans cp where cp.patient_id = r.patient_id and cp.status = 'active')
      or exists(select 1 from public.screening_schedules ss where ss.patient_id = r.patient_id)
      or exists(select 1 from public.preventive_programme_enrolments ppe where ppe.patient_id = r.patient_id and ppe.status = 'enrolled'),
    (select count(distinct date_trunc('week', vr.taken_at)) from public.vitals_readings vr where vr.patient_id = r.patient_id) >= 4
      or (select count(*) from public.health_education_progress hep where hep.patient_id = r.patient_id and hep.status in ('seen', 'understood')) >= 2,
    r.completed_at,
    r.trial_claimed_at
  from public.patient_health_resets r
  where r.patient_id = (select auth.uid());
$$;

revoke execute on function public.patient_health_reset_progress() from public, anon;
revoke execute on function public.patient_health_reset_progress() from anon;
grant execute on function public.patient_health_reset_progress() to authenticated;

-- ---------------------------------------------------------------------------
-- Nightly completion sweep — the same two real milestones, checked once a
-- day; a reset that's overdue on 90 days but hasn't genuinely engaged just
-- stays open and is re-checked tomorrow, never marked complete on a clock
-- alone. On the transition it queues exactly one in-app nudge (never
-- WhatsApp/SMS/email — engagement nudges stay in-app only, per the founder
-- correction on the education-unlock nudge).
-- ---------------------------------------------------------------------------
create or replace function private.run_health_reset_completion()
returns void
language sql
security definer
set search_path = ''
as $$
  with progress as (
    select
      r.id,
      r.patient_id,
      r.organisation_id,
      exists(select 1 from public.prevention_risk_scores prs where prs.profile_id = r.patient_id)
        and exists(select 1 from public.vitals_readings vr where vr.patient_id = r.patient_id)
        as baseline_done,
      exists(select 1 from public.care_plans cp where cp.patient_id = r.patient_id and cp.status = 'active')
        or exists(select 1 from public.screening_schedules ss where ss.patient_id = r.patient_id)
        or exists(select 1 from public.preventive_programme_enrolments ppe where ppe.patient_id = r.patient_id and ppe.status = 'enrolled')
        as programme_set_done
    from public.patient_health_resets r
    where r.completed_at is null
      and r.started_at <= now() - interval '90 days'
  ),
  newly_completed as (
    update public.patient_health_resets r
      set completed_at = now()
      from progress p
      where r.id = p.id and p.baseline_done and p.programme_set_done
      returning r.id, r.patient_id, r.organisation_id
  )
  insert into public.notifications (organisation_id, recipient_id, channel, template, payload)
  select organisation_id, patient_id, 'in_app', 'health_reset_complete', jsonb_build_object('reset_id', id)
  from newly_completed;
$$;

revoke execute on function private.run_health_reset_completion() from public, anon;
revoke execute on function private.run_health_reset_completion() from anon;
revoke execute on function private.run_health_reset_completion() from authenticated, anon;

select cron.schedule(
  'health-reset-completion-daily',
  '55 6 * * *',
  $$select private.run_health_reset_completion();$$
);

-- ---------------------------------------------------------------------------
-- Claim the milestone trial. Idempotent (raises once already claimed), and
-- refuses a patient who is already active/trialing on a real paid plan — the
-- trial is for the Free/Prevent-tier patient the pricing page actually
-- promises it to, not a way to double-discount an existing subscriber.
-- Grants status='trialing', cancel_at_period_end=true so the existing
-- 20260724094137 sweeper naturally reverts them to Free after 30 days with
-- zero new expiry logic needed.
-- ---------------------------------------------------------------------------
create or replace function public.claim_health_reset_trial()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reset public.patient_health_resets;
  v_already_paid boolean;
  v_currency public.currency;
  v_plan_code text;
  v_plan_id uuid;
  v_sub_id uuid;
  v_period_end timestamptz := now() + interval '30 days';
begin
  select * into v_reset from public.patient_health_resets where patient_id = (select auth.uid());
  if v_reset.id is null then
    raise exception 'No health reset found for this account' using errcode = 'check_violation';
  end if;
  if v_reset.completed_at is null then
    raise exception 'Your 90-Day Health Reset is not complete yet' using errcode = 'check_violation';
  end if;
  if v_reset.trial_claimed_at is not null then
    raise exception 'You have already claimed this trial' using errcode = 'check_violation';
  end if;

  select exists(
    select 1
    from public.subscriptions s
    join public.subscription_plans p on p.id = s.plan_id
    where s.subscriber_id = (select auth.uid())
      and s.status in ('active', 'trialing')
      and p.code not in ('free')
  ) into v_already_paid;
  if v_already_paid then
    raise exception 'You already have an active paid plan' using errcode = 'check_violation';
  end if;

  select coalesce(
    (select currency from public.subscriptions where subscriber_id = (select auth.uid()) order by created_at desc limit 1),
    'NGN'
  ) into v_currency;

  v_plan_code := case v_currency
    when 'GBP' then 'complete_gbp'
    when 'USD' then 'complete_usd'
    else 'complete'
  end;

  select id into v_plan_id from public.subscription_plans where code = v_plan_code and is_active limit 1;
  if v_plan_id is null then
    raise exception 'The trial plan is not currently available' using errcode = 'check_violation';
  end if;

  insert into public.subscriptions (
    organisation_id, subscriber_id, plan_id, status, currency, amount_minor,
    interval, current_period_end, cancel_at_period_end
  )
  values (
    v_reset.organisation_id, (select auth.uid()), v_plan_id, 'trialing', v_currency, 0,
    'monthly', v_period_end, true
  )
  returning id into v_sub_id;

  update public.patient_health_resets
    set trial_claimed_at = now(), trial_subscription_id = v_sub_id
    where id = v_reset.id;

  return jsonb_build_object('subscription_id', v_sub_id, 'current_period_end', v_period_end);
end;
$$;

revoke execute on function public.claim_health_reset_trial() from public, anon;
revoke execute on function public.claim_health_reset_trial() from anon;
grant execute on function public.claim_health_reset_trial() to authenticated;

-- ---------------------------------------------------------------------------
-- Assertions — the migration is the test.
-- ---------------------------------------------------------------------------
do $$
declare
  v_anon_progress boolean;
  v_anon_claim boolean;
begin
  select has_function_privilege('anon', 'public.patient_health_reset_progress()', 'EXECUTE') into v_anon_progress;
  select has_function_privilege('anon', 'public.claim_health_reset_trial()', 'EXECUTE') into v_anon_claim;
  if v_anon_progress or v_anon_claim then
    raise exception 'anon must not be able to execute the health-reset RPCs (progress=%, claim=%)', v_anon_progress, v_anon_claim;
  end if;

  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise exception 'pg_cron missing — health-reset-completion-daily cannot be scheduled';
  end if;
  if not exists (select 1 from cron.job where jobname = 'health-reset-completion-daily') then
    raise exception 'health-reset-completion-daily cron job was not created';
  end if;
end $$;
