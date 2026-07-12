-- Tarragon Health
-- protocol_versions: makes "protocols supervised by Dr. X" literally
-- auditable, not just a claim — docs/CLINICAL_TRUST_MODEL_SPEC.md §1/§4/§5.
-- Append-only ledger, one row per signed version of a named protocol
-- (protocol_id is a stable slug, e.g. 'hypertension_escalation_thresholds'
-- — there's no separate protocols master table, this table's rows *are*
-- the record). Internal governance data only, not shown to patients
-- directly (the patient-facing claim is the static clinical_staff badge —
-- see YourCareTeam), so RLS is staff-only, unlike clinical_staff itself.
--
-- approved_by references clinical_staff, not profiles (contrast
-- escalations.reviewed_by) — per spec §4 this is deliberately about which
-- named, credentialed clinical_staff record signed the protocol, not which
-- login session did the clicking. on delete restrict: a Clinical Director's
-- clinical_staff record can't be hard-deleted once it has signed a
-- protocol (deactivate via `active = false` instead) — the same
-- no-retroactive-attribution spirit as escalations.reviewed_by.

create table public.protocol_versions (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  protocol_id       text not null,
  version_number    integer not null,
  title             text not null,
  change_summary    text not null,
  content           jsonb not null default '{}'::jsonb,
  approved_by       uuid not null references public.clinical_staff (id) on delete restrict,
  approved_at       timestamptz not null default now(),
  created_at        timestamptz not null default now(),
  constraint protocol_versions_unique_version unique (organisation_id, protocol_id, version_number)
);

create index protocol_versions_org_protocol_idx
  on public.protocol_versions (organisation_id, protocol_id, version_number desc);
create index protocol_versions_approved_by_idx on public.protocol_versions (approved_by);

alter table public.protocol_versions enable row level security;

create policy protocol_versions_select on public.protocol_versions
  for select to authenticated
  using (private.is_org_staff(organisation_id));

create policy protocol_versions_insert on public.protocol_versions
  for insert to authenticated
  with check (private.is_org_staff(organisation_id));

-- No update/delete policy: signed versions are immutable by design (§5 —
-- no retroactive attribution). Correcting a mistake means signing a new
-- version, not editing history.

grant select, insert on public.protocol_versions to authenticated;
