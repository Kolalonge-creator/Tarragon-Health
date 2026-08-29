-- Laboratory Network, part 7: turnaround-time delay alerts (§56.11).
--
-- lab_provider_turnaround_stats/lab_partner_turnaround_stats (20260730215234)
-- already answer "how is this lab doing on average" — an aggregate a person
-- has to go and look at. This is the other half the spec asks for:
-- "persistent delays should generate operational alerts" — a specific order
-- past its expected turnaround gets its own row the moment it happens,
-- without anyone needing to query for it.
--
-- Deliberately just a table + RLS here. The sweep that populates it
-- (comparing each open specimen's elapsed time against lab_tests.
-- turnaround_hours and inserting a row) runs as a Vercel Cron TypeScript
-- route on a service-role client — the same shape as every other sweep in
-- apps/web/src/app/api/cron/ (video-visit-refunds, wearable-sync), not a
-- SECURITY DEFINER SQL function. That keeps the scheduling/auth story
-- (CRON_SECRET bearer, vercel.json) identical to every other periodic job in
-- this codebase instead of introducing a second pattern for one feature.

create table public.lab_turnaround_alerts (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  lab_order_id    uuid not null references public.lab_orders (id) on delete cascade,
  specimen_id     uuid references public.lab_specimens (id) on delete cascade,
  provider_id     uuid references public.lab_providers (id) on delete set null,
  expected_hours  numeric not null,
  elapsed_hours   numeric not null,
  severity        text not null default 'warning' check (severity in ('warning', 'critical')),
  created_at      timestamptz not null default now(),
  acknowledged_at timestamptz,
  acknowledged_by uuid references public.profiles (id) on delete set null,
  constraint lab_turnaround_alerts_ack_together
    check ((acknowledged_at is null) = (acknowledged_by is null))
);

create index lab_turnaround_alerts_provider_idx on public.lab_turnaround_alerts (provider_id, created_at desc);
create index lab_turnaround_alerts_org_idx on public.lab_turnaround_alerts (organisation_id);
-- One open alert per specimen — the sweep checks this before inserting, and
-- the constraint makes that a guarantee rather than a convention a future
-- edit to the sweep could quietly break.
create unique index lab_turnaround_alerts_one_open_per_specimen
  on public.lab_turnaround_alerts (specimen_id)
  where acknowledged_at is null;

alter table public.lab_turnaround_alerts enable row level security;

-- Ops-facing, not patient-facing — a patient already sees their own
-- specimen's status; a raw "you are delayed" alert row is for the people who
-- can act on it. Same shape as lab_specimens_select minus the patient branch.
create policy lab_turnaround_alerts_select on public.lab_turnaround_alerts
  for select to authenticated
  using (
    private.is_org_staff(organisation_id)
    or (provider_id is not null and provider_id = private.lab_partner_provider())
  );

create policy lab_turnaround_alerts_update on public.lab_turnaround_alerts
  for update to authenticated
  using (
    private.is_org_staff(organisation_id)
    or (provider_id is not null and provider_id = private.lab_partner_provider())
  )
  with check (
    private.is_org_staff(organisation_id)
    or (provider_id is not null and provider_id = private.lab_partner_provider())
  );

-- Insert is service-role only (the cron sweep) — no authenticated grant.
-- Update is scoped to acknowledging an alert (the only mutation a human
-- should ever make to a row this table generates for itself).
grant select, update on public.lab_turnaround_alerts to authenticated;

do $$
begin
  if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'lab_turnaround_alerts') then
    raise exception 'lab_turnaround_alerts was not created';
  end if;
  if not has_table_privilege('authenticated', 'public.lab_turnaround_alerts', 'SELECT') then
    raise exception 'authenticated must be able to read lab_turnaround_alerts';
  end if;
  if has_table_privilege('authenticated', 'public.lab_turnaround_alerts', 'INSERT') then
    raise exception 'authenticated must not be able to insert lab_turnaround_alerts directly — only the service-role cron sweep does';
  end if;
end $$;
