-- Tarragon Health — population-data governance gates + national-network
-- schema + gated dataset-export preview (spec §12, internal-only slice).
--
-- Founder decision 2026-08-30: build the §12 external-data-monetisation /
-- national-network / research-export capability now, internally, so it is
-- ready to switch on quickly once the three gates at
-- docs/Tarragon_Health_Master_Operating_Plan_v4.md:378-382 are genuinely
-- met (sufficient real patient volume, NDPC registration + DPO
-- appointment, a reviewed anonymisation methodology) — but NOT to wire it
-- external-facing yet. As of this migration, live checks show none of the
-- three gates are met (18 real patients; NDPC/DPO still open per CLAUDE.md's
-- standing follow-ups; no anonymisation methodology has been specified or
-- reviewed) — so every piece below is deliberately inert: real logic,
-- reachable only by Tarragon staff (private.is_analyst()/private.is_admin()),
-- and hard-blocked by a governance-gate check rather than a comment saying
-- "don't call this yet." Turning it externally-facing is explicitly left
-- to the founder — this migration does not build any external delivery
-- mechanism (API, file handoff, partner integration).
--
-- Explicitly NOT covered here: clinical-trials patient matching. That
-- capability has its own, separate regulatory gate — Nigeria's ethics-
-- committee approval (NHREC or an equivalent Institutional Review Board)
-- for identifying/recruiting real patients into research — which has
-- nothing to do with NDPC/DPO or patient volume and has not been raised or
-- addressed at all. Building a dedicated "clinical trials matching" feature
-- behind the SAME three gates would misrepresent what those gates actually
-- clear. The general-purpose primitive for "find patients matching
-- criteria X" already exists (prevention_campaigns.eligibility_rule,
-- 20260827202346_prevention_campaigns.sql) and can be extended with a
-- clinical_trial action type once a real trial + ethics approval exists —
-- that is a founder decision for a later date, not a gap in this migration.

-- ---------------------------------------------------------------------------
-- 1. Governance gates — an admin-attested, auditable record of the three
--    conditions, replacing "check CLAUDE.md" folklore with a real, queryable
--    fact. Modeled on the protocol_versions sign-off pattern
--    (20260812034845_protocol_versions_self_attribution.sql): the caller can
--    request an attestation, but a trigger derives WHO and WHEN server-side,
--    never trusting client-supplied values.
-- ---------------------------------------------------------------------------

create type public.population_data_gate_key as enum (
  'sufficient_real_patient_volume',
  'ndpc_registration_and_dpo',
  'anonymisation_methodology_reviewed'
);

create table public.population_data_governance_gates (
  id            uuid primary key default gen_random_uuid(),
  gate_key      public.population_data_gate_key not null unique,
  met           boolean not null default false,
  evidence      text,
  attested_by   uuid references public.profiles (id) on delete set null,
  attested_at   timestamptz,
  updated_at    timestamptz not null default now()
);

comment on table public.population_data_governance_gates is
  'The 3 gates from docs/Tarragon_Health_Master_Operating_Plan_v4.md:378-382 '
  'that must ALL be met before analytics_population_dataset_preview() below '
  'returns real data instead of a blocked response. Only private.is_admin() '
  'can flip `met` — see attest_population_data_governance_gate() RPC, the '
  'only real write path.';

insert into public.population_data_governance_gates (gate_key, met) values
  ('sufficient_real_patient_volume', false),
  ('ndpc_registration_and_dpo', false),
  ('anonymisation_methodology_reviewed', false);

create trigger population_data_governance_gates_set_updated_at
  before update on public.population_data_governance_gates
  for each row execute function private.set_updated_at();

-- Server-derived attestation stamp — never trust a client-supplied
-- attested_by/attested_at, same discipline as
-- private.stamp_protocol_version_approver().
create or replace function private.stamp_population_data_gate_attestation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.met is distinct from old.met then
    new.attested_by := (select auth.uid());
    new.attested_at := now();
  end if;
  return new;
end;
$$;

create trigger population_data_governance_gates_stamp_attestation
  before update on public.population_data_governance_gates
  for each row execute function private.stamp_population_data_gate_attestation();

alter table public.population_data_governance_gates enable row level security;

-- Any analyst/admin can see gate status (same visibility as the rest of the
-- analytics console); only an admin can write, and only through the RPC
-- below (no insert/delete policy at all — the 3 rows are seeded once by
-- this migration and never added to or removed from the app layer).
create policy population_data_governance_gates_select
  on public.population_data_governance_gates
  for select to authenticated
  using (private.is_analyst());

create policy population_data_governance_gates_update
  on public.population_data_governance_gates
  for update to authenticated
  using (private.is_admin())
  with check (private.is_admin());

grant select, update on public.population_data_governance_gates to authenticated;

-- The one real write path — the admin sets `met` and `evidence` (e.g. "NDPC
-- registration #X, DPO: name, appointed <date>"); the trigger above stamps
-- who/when. A thin RPC wrapper (rather than a raw table update from the
-- client) keeps this consistent with the rest of the console's RPC surface
-- and gives a single, auditable call site.
create or replace function public.attest_population_data_governance_gate(
  p_gate_key public.population_data_gate_key,
  p_met boolean,
  p_evidence text default null
)
returns public.population_data_governance_gates
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.population_data_governance_gates;
begin
  if not private.is_admin() then
    raise exception 'Only an admin may attest a population-data governance gate' using errcode = '42501';
  end if;

  update public.population_data_governance_gates
  set met = p_met, evidence = p_evidence
  where gate_key = p_gate_key
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.attest_population_data_governance_gate(public.population_data_gate_key, boolean, text) from public, anon;
grant execute on function public.attest_population_data_governance_gate(public.population_data_gate_key, boolean, text) to authenticated;

create or replace function private.population_data_governance_gates_met()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select count(*) = 3 from public.population_data_governance_gates where met;
$$;

revoke all on function private.population_data_governance_gates_met() from public, anon;

-- ---------------------------------------------------------------------------
-- 2. National-network partner tracking — internal relationship/BD record
--    only. Carries no patient data of any kind (no join to any patient-
--    scoped table), so it needs none of the 3 gates above; it exists purely
--    to give the "national-scale, multi-institution" side of §12 a starting
--    data model for what today is entirely offline (a founder conversation
--    or an email thread), not a live integration with any of these
--    organisations. Deliberately distinct from `organisations` (the
--    multi-tenant orgs actually operating on the platform) — a network
--    partner may never onboard as an `organisations` row at all (e.g. a
--    government programme Tarragon reports aggregate stats to, rather than
--    one whose staff log into the platform).
-- ---------------------------------------------------------------------------

create type public.network_partner_type as enum (
  'government', 'ngo', 'insurer', 'pharma', 'research_institution', 'development_organisation'
);
create type public.network_partner_relationship_status as enum (
  'prospecting', 'in_discussion', 'agreement_signed', 'integrated', 'inactive'
);

create table public.network_partner_organisations (
  id                    uuid primary key default gen_random_uuid(),
  name                  text not null,
  partner_type          public.network_partner_type not null,
  relationship_status   public.network_partner_relationship_status not null default 'prospecting',
  contact_name          text,
  contact_email         text,
  notes                 text,
  created_by            uuid references public.profiles (id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

comment on table public.network_partner_organisations is
  'Internal BD/relationship tracking for the §12 "national-scale, multi-'
  'institution" future state (governments, NGOs, insurers, pharma, research '
  'bodies) — no patient data, no live integration, no `organisations` FK. '
  'Purely descriptive; a row here does not grant its subject any access to '
  'the platform.';

create index network_partner_organisations_status_idx
  on public.network_partner_organisations (relationship_status);

create trigger network_partner_organisations_set_updated_at
  before update on public.network_partner_organisations
  for each row execute function private.set_updated_at();

alter table public.network_partner_organisations enable row level security;

create policy network_partner_organisations_select
  on public.network_partner_organisations
  for select to authenticated
  using (private.is_analyst());
create policy network_partner_organisations_insert
  on public.network_partner_organisations
  for insert to authenticated
  with check (private.is_admin());
create policy network_partner_organisations_update
  on public.network_partner_organisations
  for update to authenticated
  using (private.is_admin())
  with check (private.is_admin());
create policy network_partner_organisations_delete
  on public.network_partner_organisations
  for delete to authenticated
  using (private.is_admin());

grant select, insert, update, delete on public.network_partner_organisations to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Gated dataset-export preview — the real aggregation logic for what a
--    de-identified population dataset would contain, reusing the platform's
--    EXISTING, already-suppressed aggregates rather than querying patient
--    tables directly (no new raw-PHI aggregation surface). Hard-blocked
--    unless all 3 gates above are met. This is the "external data-
--    monetisation" / "research dataset export" capability from §12, built
--    as an INTERNAL preview only — nothing here transmits, exports, or
--    hands data to any external party. That step is explicitly left to the
--    founder once the gates are genuinely met.
-- ---------------------------------------------------------------------------

create or replace function public.analytics_population_dataset_preview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_gates_met boolean;
begin
  if not private.is_analyst() then
    return '{}'::jsonb;
  end if;

  select private.population_data_governance_gates_met() into v_gates_met;

  if not v_gates_met then
    return jsonb_build_object(
      'blocked', true,
      'reason', 'Population dataset preview is gated until all 3 governance gates are attested met — see population_data_governance_gates / attest_population_data_governance_gate().',
      'gates', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'gate_key', gate_key, 'met', met, 'evidence', evidence,
          'attested_by', attested_by, 'attested_at', attested_at
        ) order by gate_key), '[]'::jsonb)
        from public.population_data_governance_gates
      )
    );
  end if;

  -- Only reachable once every gate is genuinely attested. Composed entirely
  -- from the platform's existing, already-suppressed aggregate functions —
  -- this deliberately does not add a new raw-patient-table query path.
  return jsonb_build_object(
    'blocked', false,
    'generated_at', now(),
    'population_summary', public.analytics_population_summary(),
    'geographic_distribution', (
      select coalesce(jsonb_agg(to_jsonb(g)), '[]'::jsonb) from public.get_geo_health_aggregates() g
    ),
    'programme_funnel', public.analytics_programme_funnel(),
    'disease_surveillance', public.analytics_disease_surveillance('month')
  );
end;
$$;

comment on function public.analytics_population_dataset_preview() is
  'Analytics-console-only (private.is_analyst()) preview of the §12 population '
  'dataset — blocked (returns {blocked:true, reason, gates}) unless every row '
  'in population_data_governance_gates is met=true. Never exports, transmits, '
  'or hands data to any external party; this is the internal preview only.';

revoke all on function public.analytics_population_dataset_preview() from public, anon;
grant execute on function public.analytics_population_dataset_preview() to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.attest_population_data_governance_gate(public.population_data_gate_key, boolean, text)', 'EXECUTE') then
    raise exception 'anon can still execute attest_population_data_governance_gate';
  end if;
  if has_function_privilege('anon', 'private.population_data_governance_gates_met()', 'EXECUTE') then
    raise exception 'anon can still execute population_data_governance_gates_met';
  end if;
  if has_function_privilege('anon', 'public.analytics_population_dataset_preview()', 'EXECUTE') then
    raise exception 'anon can still execute analytics_population_dataset_preview';
  end if;
  if (select count(*) from public.population_data_governance_gates where met) <> 0 then
    raise exception 'expected all 3 governance gates to seed as met=false';
  end if;
  if (select private.population_data_governance_gates_met()) is not false then
    raise exception 'expected population_data_governance_gates_met() to be false with no gates attested';
  end if;
  raise notice 'PASS: population-data governance gates seeded false, dataset preview correctly gated, anon denied on all 3 new functions';
end $$;
