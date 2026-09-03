-- Lifestyle Management Platform §18.14 — behavioural barriers.
--
-- Gap found by audit: zero hits anywhere in the codebase for a "what's
-- making this difficult" prompt or a barrier picker. social_history.
-- socioeconomic_barriers is the closest analogue but is a static,
-- continuously-edited free-text record, not a check-in a patient submits
-- against a specific lifestyle domain when a goal is proving hard.
--
-- lifestyle_domain deliberately reuses the spec's own §18.1 domain list
-- (nutrition/activity/weight/sleep/smoking/alcohol/stress) rather than the
-- Lifestyle Programme Engine's internal Module vocabulary
-- (diet/activity/behaviour/sleep/stress, packages/lifestyle-engine/src/
-- types/index.ts) — these are two different enums for two different
-- purposes; a barrier report isn't scoped to an LPE enrollment, a patient
-- can log one against smoking/alcohol/weight too, which the LPE doesn't
-- model as modules at all.

create type public.lifestyle_domain as enum (
  'nutrition', 'activity', 'weight', 'sleep', 'smoking', 'alcohol', 'stress'
);

create type public.lifestyle_barrier_code as enum (
  'cost', 'time', 'family', 'work', 'transport', 'motivation', 'symptoms', 'side_effects', 'access', 'other'
);

create table public.lifestyle_barrier_reports (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  patient_id        uuid not null references public.profiles (id) on delete cascade,
  domain            public.lifestyle_domain not null,
  barrier_codes     public.lifestyle_barrier_code[] not null default '{}',
  note              text,
  reported_at       timestamptz not null default now(),
  created_at        timestamptz not null default now(),
  constraint lifestyle_barrier_reports_needs_content
    check (array_length(barrier_codes, 1) is not null or coalesce(note, '') <> '')
);

comment on table public.lifestyle_barrier_reports is
  'Patient-submitted "what''s making this difficult?" check-ins (spec §18.14), one row per submission — a domain-tagged log, not a singleton, so a coach/clinician can see the pattern over time rather than just the latest answer.';

create index lifestyle_barrier_reports_patient_idx on public.lifestyle_barrier_reports (patient_id, reported_at desc);
create index lifestyle_barrier_reports_org_idx on public.lifestyle_barrier_reports (organisation_id);
create index lifestyle_barrier_reports_domain_idx on public.lifestyle_barrier_reports (domain);

alter table public.lifestyle_barrier_reports enable row level security;

create policy lifestyle_barrier_reports_select on public.lifestyle_barrier_reports
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));
create policy lifestyle_barrier_reports_insert on public.lifestyle_barrier_reports
  for insert to authenticated
  with check (
    (patient_id = (select auth.uid()) and organisation_id = private.current_org_id())
    or private.is_org_staff(organisation_id));
create policy lifestyle_barrier_reports_update on public.lifestyle_barrier_reports
  for update to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id))
  with check (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));
create policy lifestyle_barrier_reports_delete on public.lifestyle_barrier_reports
  for delete to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

grant select, insert, update, delete on public.lifestyle_barrier_reports to authenticated;
revoke all on public.lifestyle_barrier_reports from anon;

do $$
begin
  if not exists (select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'lifestyle_barrier_reports') then
    raise exception 'FAIL: lifestyle_barrier_reports was not created';
  end if;
  raise notice 'PASS: lifestyle behavioural barriers — table, RLS installed';
end $$;
