-- Tarragon Health
-- Fee-at-risk / outcomes-based B2B contract structure (Category 4) —
-- docs/FULL_SPECIFICATION_V4.md §5/§8 ("outcomes_contracts: organisation_id,
-- contract_type (capitation/fee_at_risk/flat), outcome_thresholds (JSON),
-- payout_terms" / "Optional fee-at-risk HMO contract structure").
--
-- Write access is service-role only, deliberately — no insert/update/delete
-- grant to `authenticated` at all, mirroring protocol_versions' pattern.
-- This is a negotiated business contract between TarragonHealth and an
-- HMO/corporate client: the client's own hmo_admin/corporate_admin must be
-- able to see their contract and current performance against it (the
-- "Capitation contract status" item already listed as coming-soon on the
-- HMO dashboard), but must not be able to self-configure the outcome
-- thresholds or payout terms that determine what Tarragon gets paid. There's
-- no TarragonHealth-internal ops role in this schema yet, so contract
-- creation/editing happens via a service-role script for now, same as the
-- screen_types global catalogue.
--
-- outcome_thresholds is a JSON array of { metric, label, target,
-- better_when: 'higher'|'lower' } objects rather than fixed columns, so new
-- metrics don't need a migration — the app only knows how to compute a
-- current value for a small registry of recognised metric keys
-- (screening_compliance_percent, bp_control_percent) and shows the
-- target/label as-is for anything else, rather than guessing.

create type public.outcomes_contract_type as enum ('capitation', 'fee_at_risk', 'flat');

create table public.outcomes_contracts (
  id                  uuid primary key default gen_random_uuid(),
  organisation_id     uuid not null references public.organisations (id) on delete restrict,
  contract_type       public.outcomes_contract_type not null,
  outcome_thresholds  jsonb not null default '[]'::jsonb,
  payout_terms        text,
  effective_from      date not null default current_date,
  created_at          timestamptz not null default now()
);

create index outcomes_contracts_org_idx on public.outcomes_contracts (organisation_id, effective_from desc);

alter table public.outcomes_contracts enable row level security;

create policy outcomes_contracts_select on public.outcomes_contracts
  for select to authenticated
  using (private.is_org_staff(organisation_id));

grant select on public.outcomes_contracts to authenticated;
