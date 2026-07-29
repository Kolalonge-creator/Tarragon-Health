-- Tarragon Health
-- Published, shareable outcome reports (docs/FULL_SPECIFICATION_V4.md
-- §2.4/§8 — "Published, shareable outcome reports (quarterly 'state of
-- workforce health,' anonymised) used in BD conversations the way
-- peer-reviewed studies are used by Omada").
--
-- snapshot is a point-in-time capture of the same anonymised cohort
-- analytics + outcomes-contract performance already shown live on the
-- corporate dashboard (see loadCohortAnalytics() in
-- apps/web/src/app/(dashboard)/dashboard/corporate/page.tsx and
-- lib/outcomes-contracts/get-contract-performance.ts) — no new PII
-- collection, this just freezes a period's numbers so they can be quoted
-- externally without the underlying data drifting under the reader's feet.
-- Append-only once generated (no update to snapshot/period, only to
-- `published`) — same "don't rewrite history" posture as protocol_versions.
--
-- Insert is org-staff-scoped (not service-role-only like outcomes_contracts)
-- because generating a report is the org's own staff snapshotting their own
-- already-visible dashboard data, not a negotiated term Tarragon sets
-- unilaterally.

create table public.outcome_reports (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete restrict,
  period_start     date not null,
  period_end       date not null,
  snapshot         jsonb not null,
  published        boolean not null default false,
  generated_by     uuid references public.profiles (id) on delete set null,
  generated_at     timestamptz not null default now(),
  constraint outcome_reports_period_valid check (period_end >= period_start)
);

create index outcome_reports_org_idx on public.outcome_reports (organisation_id, period_end desc);

alter table public.outcome_reports enable row level security;

create policy outcome_reports_select on public.outcome_reports
  for select to authenticated
  using (private.is_org_staff(organisation_id));
create policy outcome_reports_insert on public.outcome_reports
  for insert to authenticated
  with check (private.is_org_staff(organisation_id));
-- Publish/unpublish only — snapshot and period are fixed at creation time;
-- enforced by only exposing a `published` toggle from the app layer (RLS
-- itself can't easily pin "only this column changed" without a trigger, and
-- the org's own staff editing their own already-visible report's snapshot
-- isn't a meaningful integrity risk the way outcomes_contracts' payout
-- terms are).
create policy outcome_reports_update on public.outcome_reports
  for update to authenticated
  using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));

grant select, insert, update on public.outcome_reports to authenticated;
