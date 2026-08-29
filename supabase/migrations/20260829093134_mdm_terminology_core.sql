-- Tarragon Health — Health Data Architecture & MDM (spec §34.5, §34.6)
-- Central controlled dictionaries + a terminology service.
--
-- WHAT PROBLEM THIS SOLVES
-- The platform already stores clinical meaning as free text in several
-- places: patient_conditions.condition_name (with an OPTIONAL icd10_code
-- beside it), medications.drug_name, patient_allergies.allergen, and
-- lab_tests.code — which is not a clinical code at all, it is whatever
-- catalogue string one lab provider happens to use, unique only per
-- (provider_id, code). Two rows meaning "Type 2 diabetes" can be spelled
-- four ways and nothing joins them. §34.6 is explicit: where structured
-- data is needed, store a standardised clinical concept, not free text.
--
-- WHAT THIS MIGRATION DOES **NOT** DO — and why that is deliberate
-- It does not convert any existing column to a coded-only column, and it
-- does not delete a single free-text field. Two reasons, both real:
--   1. Nigeria has no HL7/FHIR interchange between labs or clinics (the
--      reasoning already written down at the top of
--      apps/web/src/lib/lab-reports/analyte-catalogue.ts). A clinician
--      typing what a paper referral letter says is a legitimate, and often
--      the ONLY, input. Forcing a code would mean either refusing the
--      entry or letting someone pick a near-enough code — the second is
--      how coded records quietly become wrong.
--   2. §34.11 requires BOTH structured and unstructured data. The free
--      text is the unstructured half; the concept link is the structured
--      half. They coexist by design.
-- The coded link itself (a nullable concept_id on the clinical tables) is
-- added in a later migration in this same build; this one only builds the
-- dictionary those columns point at.
--
-- WHY A CONCEPT TABLE AND NOT ONE ENUM PER DOMAIN
-- This codebase already has ~200 Postgres enums and they are the right
-- tool for a closed, code-relevant vocabulary (a status, a channel, a
-- role). A clinical terminology is the opposite shape: tens of thousands
-- of members, versioned by an external publisher, with deprecations,
-- synonyms and cross-system maps. An enum cannot deprecate a value, cannot
-- carry a display name in two languages, and cannot be extended without a
-- migration and a deploy. So: enums stay for platform state, concepts for
-- clinical meaning.
--
-- LICENCE POSTURE (why some systems are registered but not populated)
-- ICD-10 (WHO), LOINC (Regenstrief, free with attribution) and ATC (WHOCC
-- — free at the small scale used here) are seeded with the curated subset
-- this platform actually references. SNOMED CT and RxNorm are REGISTERED
-- as code systems with zero concepts on purpose: SNOMED CT needs a member
-- or affiliate licence and Nigeria's national member status is not
-- something this build can assert. Registering the system now means a
-- future licensed import is an INSERT, not a schema change; seeding
-- unlicensed content would be a compliance problem shipped as a
-- convenience. `is_licensed` + `licence_note` carry that state as data.

-- pg_trgm powers fuzzy term lookup (§34.6's "high blood pressure" -> a
-- standardised concept). Installed into `extensions`, and every call below
-- is schema-qualified — the same lesson pgvector taught this project: the
-- migration connection's search_path does not include `extensions`, so a
-- bare similarity() would replay-fail.
create extension if not exists pg_trgm with schema extensions;

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------

create type public.reference_concept_domain as enum (
  'condition',
  'medication',
  'lab_test',
  'lab_analyte',
  'procedure',
  'allergen',
  'vaccine',
  'unit',
  'country',
  'language'
);

create type public.reference_concept_status as enum ('active', 'deprecated', 'retired');

create type public.concept_map_equivalence as enum (
  'equivalent',
  'wider',
  'narrower',
  'inexact',
  'unmatched'
);

-- ---------------------------------------------------------------------------
-- reference_code_systems — who publishes a vocabulary
-- ---------------------------------------------------------------------------

create table public.reference_code_systems (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique,
  name          text not null,
  uri           text not null unique,
  version       text,
  is_licensed   boolean not null default false,
  licence_note  text,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint reference_code_systems_licence_note_required
    check (not is_licensed or licence_note is not null)
);

comment on table public.reference_code_systems is
  'Publishers of clinical vocabularies (§34.6). A system may be registered with zero concepts — see is_licensed/licence_note.';

create trigger reference_code_systems_set_updated_at
  before update on public.reference_code_systems
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- reference_concepts — the concepts themselves
-- ---------------------------------------------------------------------------

create table public.reference_concepts (
  id              uuid primary key default gen_random_uuid(),
  code_system_id  uuid not null references public.reference_code_systems (id) on delete restrict,
  domain          public.reference_concept_domain not null,
  code            text not null,
  display         text not null,
  definition      text,
  status          public.reference_concept_status not null default 'active',
  parent_id       uuid references public.reference_concepts (id) on delete set null,
  attributes      jsonb not null default '{}'::jsonb,
  valid_from      date,
  valid_to        date,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint reference_concepts_valid_window check (valid_to is null or valid_from is null or valid_to >= valid_from),
  constraint reference_concepts_not_own_parent check (parent_id is null or parent_id <> id),
  unique (code_system_id, code)
);

create index reference_concepts_domain_idx on public.reference_concepts (domain, status);
create index reference_concepts_parent_idx on public.reference_concepts (parent_id) where parent_id is not null;
create index reference_concepts_display_trgm_idx
  on public.reference_concepts using gin (display extensions.gin_trgm_ops);

create trigger reference_concepts_set_updated_at
  before update on public.reference_concepts
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- reference_concept_synonyms — how humans actually write it
-- ---------------------------------------------------------------------------

create table public.reference_concept_synonyms (
  id           uuid primary key default gen_random_uuid(),
  concept_id   uuid not null references public.reference_concepts (id) on delete cascade,
  term         text not null,
  language     text not null default 'en',
  created_at   timestamptz not null default now()
);

create unique index reference_concept_synonyms_unique_term_idx
  on public.reference_concept_synonyms (concept_id, lower(term), language);
create index reference_concept_synonyms_term_trgm_idx
  on public.reference_concept_synonyms using gin (term extensions.gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- reference_concept_maps — cross-system translation
-- ---------------------------------------------------------------------------

create table public.reference_concept_maps (
  id                 uuid primary key default gen_random_uuid(),
  source_concept_id  uuid not null references public.reference_concepts (id) on delete cascade,
  target_concept_id  uuid not null references public.reference_concepts (id) on delete cascade,
  equivalence        public.concept_map_equivalence not null,
  note               text,
  created_at         timestamptz not null default now(),
  constraint reference_concept_maps_distinct check (source_concept_id <> target_concept_id),
  unique (source_concept_id, target_concept_id)
);

create index reference_concept_maps_target_idx on public.reference_concept_maps (target_concept_id);

-- ---------------------------------------------------------------------------
-- The terminology service
-- ---------------------------------------------------------------------------

create or replace function private.normalise_term(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(btrim(regexp_replace(lower(coalesce(p_text, '')), '[^a-z0-9]+', ' ', 'g')), '');
$$;

comment on function private.normalise_term(text) is
  'Lower-cases, strips punctuation and collapses whitespace. IMMUTABLE — safe in an expression index. Returns null for text with no alphanumerics.';

create or replace function public.lookup_concept(
  p_domain public.reference_concept_domain,
  p_text text,
  p_min_score numeric default 0.35,
  p_limit integer default 10
)
returns table (
  concept_id       uuid,
  code             text,
  display          text,
  code_system      text,
  code_system_uri  text,
  status           public.reference_concept_status,
  score            numeric,
  matched_on       text
)
language sql
stable
set search_path = ''
as $$
  with needle as (
    select private.normalise_term(p_text) as n, btrim(coalesce(p_text, '')) as raw
  ),
  scored as (
    select
      c.id,
      c.code,
      c.display,
      cs.code as system_code,
      cs.uri  as system_uri,
      c.status,
      case
        when upper(c.code) = upper((select raw from needle)) then 1.00
        when private.normalise_term(c.display) = (select n from needle) then 0.99
        when exists (
          select 1 from public.reference_concept_synonyms s
          where s.concept_id = c.id
            and private.normalise_term(s.term) = (select n from needle)
        ) then 0.98
        else greatest(
          extensions.similarity(private.normalise_term(c.display), (select n from needle)),
          coalesce((
            select max(extensions.similarity(private.normalise_term(s.term), (select n from needle)))
            from public.reference_concept_synonyms s
            where s.concept_id = c.id
          ), 0)
        )::numeric
      end as sc,
      case
        when upper(c.code) = upper((select raw from needle)) then 'code'
        when private.normalise_term(c.display) = (select n from needle) then 'display'
        when exists (
          select 1 from public.reference_concept_synonyms s
          where s.concept_id = c.id
            and private.normalise_term(s.term) = (select n from needle)
        ) then 'synonym'
        else 'fuzzy'
      end as how
    from public.reference_concepts c
    join public.reference_code_systems cs on cs.id = c.code_system_id
    where c.domain = p_domain
      and c.status <> 'retired'
      and (select n from needle) is not null
  )
  select id, code, display, system_code, system_uri, status, round(sc, 3), how
  from scored
  where sc >= p_min_score
  order by sc desc, display asc
  limit greatest(p_limit, 1);
$$;

comment on function public.lookup_concept is
  'Terminology lookup (§34.6). Returns ranked candidates with their real match score; never auto-selects. matched_on is one of code/display/synonym/fuzzy.';

create or replace function public.translate_concept(
  p_concept_id uuid,
  p_target_system text
)
returns table (
  concept_id       uuid,
  code             text,
  display          text,
  code_system      text,
  code_system_uri  text,
  equivalence      public.concept_map_equivalence
)
language sql
stable
set search_path = ''
as $$
  select t.id, t.code, t.display, cs.code, cs.uri, m.equivalence
  from public.reference_concept_maps m
  join public.reference_concepts t on t.id = m.target_concept_id
  join public.reference_code_systems cs on cs.id = t.code_system_id
  where m.source_concept_id = p_concept_id
    and cs.code = p_target_system
    and t.status <> 'retired'
  union all
  select s.id, s.code, s.display, cs.code, cs.uri,
    case m.equivalence
      when 'wider' then 'narrower'::public.concept_map_equivalence
      when 'narrower' then 'wider'::public.concept_map_equivalence
      else m.equivalence
    end
  from public.reference_concept_maps m
  join public.reference_concepts s on s.id = m.source_concept_id
  join public.reference_code_systems cs on cs.id = s.code_system_id
  where m.target_concept_id = p_concept_id
    and cs.code = p_target_system
    and s.status <> 'retired';
$$;

comment on function public.translate_concept is
  'Cross-system concept translation (§34.6/§34.19). Bidirectional: a stored A->B map answers B->A too, with wider/narrower inverted.';

-- ---------------------------------------------------------------------------
-- master_data_registry — one place that names every master dictionary
-- ---------------------------------------------------------------------------

create view public.master_data_registry as
select * from (
  values
    ('medications',   'reference_concepts (domain=medication)',    'ATC',            'concept'),
    ('diagnoses',     'reference_concepts (domain=condition)',     'ICD10',          'concept'),
    ('lab_tests',     'reference_concepts (domain=lab_analyte)',   'TARRAGON/LOINC', 'concept'),
    ('procedures',    'reference_concepts (domain=procedure)',     'TARRAGON',       'concept'),
    ('allergens',     'reference_concepts (domain=allergen)',      'TARRAGON',       'concept'),
    ('vaccines',      'vaccination_catalog',                       'TARRAGON',       'operational'),
    ('units',         'units_of_measure',                          'UCUM',           'operational'),
    ('countries',     'reference_concepts (domain=country)',       'ISO3166-1',      'concept'),
    ('languages',     'reference_concepts (domain=language)',      'ISO639-1',       'concept'),
    ('providers',     'lab_providers / pharmacy_partners / specialist_providers / home_visit_providers', 'internal', 'operational'),
    ('organisations', 'organisations',                             'internal',       'operational'),
    ('locations',     'facilities / lab_provider_locations / pharmacy_partner_locations / service_regions', 'internal', 'operational'),
    ('services',      'screen_types / subscription_plans / add_ons / panel_bundles', 'internal', 'operational')
) as t (dictionary, governing_table, code_system, kind);

comment on view public.master_data_registry is
  'Spec §34.5 dictionary index: which table governs each controlled list, and whether it is a terminology concept domain or an operational master table.';

-- ---------------------------------------------------------------------------
-- RLS — global reference data: readable by every authenticated user,
-- writable by admins only.
-- ---------------------------------------------------------------------------

alter table public.reference_code_systems enable row level security;
alter table public.reference_concepts enable row level security;
alter table public.reference_concept_synonyms enable row level security;
alter table public.reference_concept_maps enable row level security;

create policy reference_code_systems_select on public.reference_code_systems
  for select to authenticated using (true);
create policy reference_code_systems_insert on public.reference_code_systems
  for insert to authenticated with check (private.is_admin());
create policy reference_code_systems_update on public.reference_code_systems
  for update to authenticated using (private.is_admin()) with check (private.is_admin());
create policy reference_code_systems_delete on public.reference_code_systems
  for delete to authenticated using (private.is_admin());

create policy reference_concepts_select on public.reference_concepts
  for select to authenticated using (true);
create policy reference_concepts_insert on public.reference_concepts
  for insert to authenticated with check (private.is_admin());
create policy reference_concepts_update on public.reference_concepts
  for update to authenticated using (private.is_admin()) with check (private.is_admin());
create policy reference_concepts_delete on public.reference_concepts
  for delete to authenticated using (private.is_admin());

create policy reference_concept_synonyms_select on public.reference_concept_synonyms
  for select to authenticated using (true);
create policy reference_concept_synonyms_insert on public.reference_concept_synonyms
  for insert to authenticated with check (private.is_admin());
create policy reference_concept_synonyms_update on public.reference_concept_synonyms
  for update to authenticated using (private.is_admin()) with check (private.is_admin());
create policy reference_concept_synonyms_delete on public.reference_concept_synonyms
  for delete to authenticated using (private.is_admin());

create policy reference_concept_maps_select on public.reference_concept_maps
  for select to authenticated using (true);
create policy reference_concept_maps_insert on public.reference_concept_maps
  for insert to authenticated with check (private.is_admin());
create policy reference_concept_maps_update on public.reference_concept_maps
  for update to authenticated using (private.is_admin()) with check (private.is_admin());
create policy reference_concept_maps_delete on public.reference_concept_maps
  for delete to authenticated using (private.is_admin());

grant select, insert, update, delete on public.reference_code_systems to authenticated;
grant select, insert, update, delete on public.reference_concepts to authenticated;
grant select, insert, update, delete on public.reference_concept_synonyms to authenticated;
grant select, insert, update, delete on public.reference_concept_maps to authenticated;
grant select on public.master_data_registry to authenticated;

revoke all on public.reference_code_systems from anon;
revoke all on public.reference_concepts from anon;
revoke all on public.reference_concept_synonyms from anon;
revoke all on public.reference_concept_maps from anon;
revoke all on public.master_data_registry from anon;
revoke execute on function public.lookup_concept(public.reference_concept_domain, text, numeric, integer) from public;
revoke execute on function public.translate_concept(uuid, text) from public;
grant execute on function public.lookup_concept(public.reference_concept_domain, text, numeric, integer) to authenticated, service_role;
grant execute on function public.translate_concept(uuid, text) to authenticated, service_role;

do $$
begin
  if has_function_privilege('anon', 'public.lookup_concept(public.reference_concept_domain, text, numeric, integer)', 'EXECUTE') then
    raise exception 'FAIL: anon still holds EXECUTE on public.lookup_concept';
  end if;
  if has_function_privilege('anon', 'public.translate_concept(uuid, text)', 'EXECUTE') then
    raise exception 'FAIL: anon still holds EXECUTE on public.translate_concept';
  end if;
  if has_table_privilege('anon', 'public.reference_concepts', 'SELECT') then
    raise exception 'FAIL: anon still holds SELECT on public.reference_concepts';
  end if;
end;
$$;
