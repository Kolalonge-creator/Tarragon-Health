-- Tarragon Health — Sprint 1 foundation
-- 03 · Preventative Medicine (Category 2)
--
-- screen_types (reference catalogue), personalised screening schedules,
-- results, the abnormal-result -> Category 1 upgrade audit trail, annual
-- health checks, specialist referrals, and family-plan membership.
--
-- The abnormal-result event is the highest-priority business event in the
-- platform (CLAUDE.md, ARCHITECTURE.md §7). Sprint 2 adds the Edge Function
-- (AbnormalResultHandler) that drafts care plans and sends WhatsApp alerts;
-- this migration installs the DB-level safety net so the event is recorded
-- and a Priority-1 nurse alert is raised the instant the row lands — it can
-- never be silently dropped even before the Edge Function exists.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type public.screen_applicability as enum ('all', 'male', 'female');

create type public.screening_status as enum (
  'pending', 'booked', 'completed', 'overdue', 'cancelled'
);

create type public.result_status as enum (
  'normal', 'borderline', 'abnormal', 'critical'
);

create type public.upgrade_condition as enum (
  'hypertension', 'diabetes', 'cancer_referral', 'other'
);

create type public.annual_check_status as enum (
  'pending', 'in_progress', 'completed'
);

create type public.specialist_type as enum (
  'urologist', 'oncologist', 'ob_gyn', 'cardiology', 'endocrinology',
  'nephrology', 'ophthalmology', 'dietetics', 'podiatry', 'other'
);

create type public.referral_status as enum (
  'pending', 'booked', 'confirmed', 'completed', 'declined'
);

create type public.family_relationship as enum (
  'spouse', 'parent', 'child', 'sibling', 'other'
);

-- ---------------------------------------------------------------------------
-- screen_types (global reference catalogue — no organisation_id)
-- ---------------------------------------------------------------------------

create table public.screen_types (
  id                          uuid primary key default gen_random_uuid(),
  code                        text not null unique,
  name                        text not null,
  sex_applicability           public.screen_applicability not null default 'all',
  age_from                    integer,
  age_to                      integer,
  frequency_months            integer,
  commission_rate             numeric(5, 4),   -- fraction, e.g. 0.2000 = 20%
  recommended_provider_type   public.organisation_type,
  is_active                   boolean not null default true,
  created_at                  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- screening_schedules (patient's personalised screening calendar)
-- ---------------------------------------------------------------------------

create table public.screening_schedules (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  patient_id        uuid not null references public.profiles (id) on delete cascade,
  screen_type_id    uuid not null references public.screen_types (id) on delete restrict,
  status            public.screening_status not null default 'pending',
  due_date          date not null,
  next_due_date     date,
  reminder_sent_at  timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index screening_schedules_patient_idx on public.screening_schedules (patient_id, due_date);
create index screening_schedules_org_status_idx on public.screening_schedules (organisation_id, status);
create index screening_schedules_screen_type_idx on public.screening_schedules (screen_type_id);

create trigger screening_schedules_set_updated_at
  before update on public.screening_schedules
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- screening_results (lab_order_id FK is added in migration 04)
-- ---------------------------------------------------------------------------

create table public.screening_results (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  patient_id        uuid not null references public.profiles (id) on delete cascade,
  schedule_id       uuid references public.screening_schedules (id) on delete set null,
  lab_order_id      uuid,
  result_status     public.result_status not null,
  result_summary    text,
  abnormal_flags    text[] not null default '{}',
  created_at        timestamptz not null default now()
);

create index screening_results_patient_idx on public.screening_results (patient_id, created_at desc);
create index screening_results_org_idx on public.screening_results (organisation_id);
create index screening_results_status_idx on public.screening_results (result_status);
create index screening_results_schedule_idx on public.screening_results (schedule_id);

-- ---------------------------------------------------------------------------
-- screening_upgrades (permanent audit of every abnormal -> Cat 1 upgrade)
-- ---------------------------------------------------------------------------

create table public.screening_upgrades (
  id                  uuid primary key default gen_random_uuid(),
  organisation_id     uuid not null references public.organisations (id) on delete restrict,
  patient_id          uuid not null references public.profiles (id) on delete cascade,
  screening_result_id uuid not null references public.screening_results (id) on delete cascade,
  condition_triggered public.upgrade_condition not null default 'other',
  action_taken        text,
  handled_by_nurse_id uuid references public.profiles (id) on delete set null,
  upgrade_at          timestamptz not null default now()
);

create index screening_upgrades_patient_idx on public.screening_upgrades (patient_id);
create index screening_upgrades_org_idx on public.screening_upgrades (organisation_id);
create index screening_upgrades_result_idx on public.screening_upgrades (screening_result_id);
create index screening_upgrades_nurse_idx on public.screening_upgrades (handled_by_nurse_id);

-- ---------------------------------------------------------------------------
-- annual_health_checks (highest-LTV Category 2 product; cost in kobo)
-- ---------------------------------------------------------------------------

create table public.annual_health_checks (
  id                        uuid primary key default gen_random_uuid(),
  organisation_id           uuid not null references public.organisations (id) on delete restrict,
  patient_id                uuid not null references public.profiles (id) on delete cascade,
  year                      integer not null,
  status                    public.annual_check_status not null default 'pending',
  completion_pct            integer not null default 0 check (completion_pct between 0 and 100),
  total_cost_kobo           bigint not null default 0,
  tests_completed           jsonb not null default '{}'::jsonb,
  gender_screens_completed  jsonb not null default '{}'::jsonb,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  unique (patient_id, year)
);

create index annual_health_checks_org_idx on public.annual_health_checks (organisation_id);

create trigger annual_health_checks_set_updated_at
  before update on public.annual_health_checks
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- specialist_referrals (fee in kobo)
-- ---------------------------------------------------------------------------

create table public.specialist_referrals (
  id                    uuid primary key default gen_random_uuid(),
  organisation_id       uuid not null references public.organisations (id) on delete restrict,
  patient_id            uuid not null references public.profiles (id) on delete cascade,
  screening_upgrade_id  uuid references public.screening_upgrades (id) on delete set null,
  specialist_type       public.specialist_type not null,
  referral_reason       text,
  status                public.referral_status not null default 'pending',
  referral_fee_kobo     bigint not null default 0,
  booking_confirmed_at  timestamptz,
  appointment_date      timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index specialist_referrals_patient_idx on public.specialist_referrals (patient_id);
create index specialist_referrals_org_status_idx on public.specialist_referrals (organisation_id, status);
create index specialist_referrals_upgrade_idx on public.specialist_referrals (screening_upgrade_id);

create trigger specialist_referrals_set_updated_at
  before update on public.specialist_referrals
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- family_plan_members (plan_id FK to subscriptions added in migration 04)
-- ---------------------------------------------------------------------------

create table public.family_plan_members (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  plan_id           uuid,
  plan_owner_id     uuid not null references public.profiles (id) on delete cascade,
  member_id         uuid not null references public.profiles (id) on delete cascade,
  relationship      public.family_relationship not null default 'other',
  conditions        text[] not null default '{}',
  onboarded_at      timestamptz not null default now(),
  created_at        timestamptz not null default now()
);

create index family_plan_members_owner_idx on public.family_plan_members (plan_owner_id);
create index family_plan_members_member_idx on public.family_plan_members (member_id);
create index family_plan_members_org_idx on public.family_plan_members (organisation_id);

-- ---------------------------------------------------------------------------
-- Abnormal-result safety net
-- On INSERT of an abnormal|critical screening_results row, immediately and
-- atomically: (1) record the screening_upgrades audit row, and (2) raise a
-- Priority-1 nurse alert with a 4-hour contact SLA. Runs in the same
-- transaction as the insert, so the event can never be lost.
-- ---------------------------------------------------------------------------

create or replace function private.handle_abnormal_screening_result()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_condition public.upgrade_condition := 'other';
  v_upgrade_id uuid;
begin
  if new.result_status not in ('abnormal', 'critical') then
    return new;
  end if;

  -- Best-effort condition inference from abnormal_flags (Sprint 2 Edge
  -- Function refines this and drafts the matching care plan / referral).
  if new.abnormal_flags && array['bp', 'blood_pressure', 'hypertension'] then
    v_condition := 'hypertension';
  elsif new.abnormal_flags && array['glucose', 'hba1c', 'diabetes'] then
    v_condition := 'diabetes';
  elsif new.abnormal_flags && array['psa', 'cancer', 'mammography', 'cervical', 'fit'] then
    v_condition := 'cancer_referral';
  end if;

  insert into public.screening_upgrades
    (organisation_id, patient_id, screening_result_id, condition_triggered)
  values
    (new.organisation_id, new.patient_id, new.id, v_condition)
  returning id into v_upgrade_id;

  insert into public.nurse_alerts
    (organisation_id, patient_id, level, status, title, detail, sla_due_at)
  values (
    new.organisation_id,
    new.patient_id,
    'doctor_escalation',
    'open',
    'Priority 1: abnormal screening result',
    format('Screening result %s flagged %s; condition inferred: %s.',
           new.id, coalesce(array_to_string(new.abnormal_flags, ', '), 'none'), v_condition),
    now() + interval '4 hours'
  );

  return new;
end;
$$;

create trigger screening_results_abnormal_handler
  after insert on public.screening_results
  for each row execute function private.handle_abnormal_screening_result();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.screen_types           enable row level security;
alter table public.screening_schedules    enable row level security;
alter table public.screening_results      enable row level security;
alter table public.screening_upgrades     enable row level security;
alter table public.annual_health_checks   enable row level security;
alter table public.specialist_referrals   enable row level security;
alter table public.family_plan_members    enable row level security;

-- screen_types: global catalogue — any authenticated user reads; admins write.
create policy screen_types_select on public.screen_types
  for select to authenticated using (true);
create policy screen_types_insert on public.screen_types
  for insert to authenticated with check (private.is_admin());
create policy screen_types_update on public.screen_types
  for update to authenticated using (private.is_admin()) with check (private.is_admin());
create policy screen_types_delete on public.screen_types
  for delete to authenticated using (private.is_admin());

-- Patient reads own rows; staff manage org rows.
do $$
declare t text;
begin
  foreach t in array array[
    'screening_schedules', 'screening_results', 'screening_upgrades',
    'annual_health_checks', 'specialist_referrals'
  ]
  loop
    execute format($f$
      create policy %1$s_select on public.%1$I
        for select to authenticated
        using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));
      create policy %1$s_insert on public.%1$I
        for insert to authenticated
        with check (private.is_org_staff(organisation_id));
      create policy %1$s_update on public.%1$I
        for update to authenticated
        using (private.is_org_staff(organisation_id))
        with check (private.is_org_staff(organisation_id));
      create policy %1$s_delete on public.%1$I
        for delete to authenticated
        using (private.is_org_staff(organisation_id));
    $f$, t);
  end loop;
end;
$$;

-- family_plan_members: the plan owner and the member both see their row;
-- staff manage org rows.
create policy family_plan_members_select on public.family_plan_members
  for select to authenticated
  using (
    plan_owner_id = (select auth.uid())
    or member_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
  );
create policy family_plan_members_insert on public.family_plan_members
  for insert to authenticated
  with check (plan_owner_id = (select auth.uid()) or private.is_org_staff(organisation_id));
create policy family_plan_members_update on public.family_plan_members
  for update to authenticated
  using (plan_owner_id = (select auth.uid()) or private.is_org_staff(organisation_id))
  with check (plan_owner_id = (select auth.uid()) or private.is_org_staff(organisation_id));
create policy family_plan_members_delete on public.family_plan_members
  for delete to authenticated
  using (plan_owner_id = (select auth.uid()) or private.is_org_staff(organisation_id));

grant select on public.screen_types to authenticated;
grant insert, update, delete on public.screen_types to authenticated;
grant select, insert, update, delete on public.screening_schedules to authenticated;
grant select, insert, update, delete on public.screening_results to authenticated;
grant select, insert, update, delete on public.screening_upgrades to authenticated;
grant select, insert, update, delete on public.annual_health_checks to authenticated;
grant select, insert, update, delete on public.specialist_referrals to authenticated;
grant select, insert, update, delete on public.family_plan_members to authenticated;
