-- Tarragon Health
-- Data Architecture Gaps Build Plan §1 (docs/DATA_ARCHITECTURE_GAPS_BUILD_PLAN.md), closing a real,
-- documented Phase 1 limitation found by /code-review high on the original FHIR import migration
-- (20260918091524's review pass, "known Phase 1 limitations" section of the build-plan doc): the
-- LOINC-code-to-vital_type mapping that drives Observation parsing (apps/web/src/lib/integrations/
-- fhir/parse-resource.ts) was a hardcoded TypeScript object, even though this platform already has a
-- proven, working pattern for exactly this "which codes mean what" decision class elsewhere
-- (triage_protocols, escalation_slas, and -- closer still -- parseImmunization's own live
-- vaccination_catalog lookup one function away in the same file). A real partner's Observation
-- resources using a locally-common LOINC variant not in the hardcoded list would silently land in
-- skip_reasons until an engineer noticed, wrote a PR, and redeployed -- an ops/config change
-- masquerading as a code change.
--
-- This does NOT require a real FHIR partner or a data warehouse to be worth doing now (per the build
-- plan's own Phase gates for those two other gaps) -- it is a pure architecture correction to code
-- that already ships and already works, making the FHIR import pipeline genuinely closer to
-- partner-onboarding-ready rather than adding new surface area.
--
-- Mirrors vaccination_catalog's own shape exactly (public.vaccination_catalog,
-- 20260706084920_vaccination_registry.sql): a global reference table, no organisation_id, any
-- authenticated user reads, only private.is_admin() writes. Seeded with the exact 16 mappings the
-- code previously hardcoded (OBSERVATION_LOINC_VITAL_TYPE in parse-resource.ts) -- this migration
-- changes WHERE the mapping lives, not what it says; parse-resource.ts is updated in the same PR to
-- query this table instead of the static object.

create table public.fhir_loinc_vital_type_mappings (
  loinc_code   text primary key,
  vital_type   public.vital_type not null,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now()
);

comment on table public.fhir_loinc_vital_type_mappings is
  'Global reference table: which LOINC code means which of this platform''s vital_type values, for FHIR Observation import parsing (apps/web/src/lib/integrations/fhir/parse-resource.ts). Widening this for a real partner''s locally-common LOINC variant is now an admin data change, not a code deploy -- see docs/DATA_ARCHITECTURE_GAPS_BUILD_PLAN.md §1. Mirrors public.vaccination_catalog''s shape (global, admin-managed, no organisation_id).';

insert into public.fhir_loinc_vital_type_mappings (loinc_code, vital_type) values
  ('8867-4', 'pulse'),
  ('2339-0', 'glucose'),
  ('41653-7', 'glucose'),
  ('15074-8', 'glucose'),
  ('14749-6', 'glucose'),
  ('29463-7', 'weight'),
  ('3141-9', 'weight'),
  ('8310-5', 'temperature'),
  ('8331-1', 'temperature'),
  ('59408-5', 'spo2'),
  ('2708-6', 'spo2'),
  ('56086-2', 'waist_circumference'),
  ('8280-0', 'waist_circumference'),
  ('9279-1', 'respiratory_rate'),
  ('33452-4', 'peak_flow'),
  ('19935-6', 'peak_flow')
on conflict (loinc_code) do nothing;

alter table public.fhir_loinc_vital_type_mappings enable row level security;

create policy fhir_loinc_vital_type_mappings_select on public.fhir_loinc_vital_type_mappings
  for select to authenticated using (true);
create policy fhir_loinc_vital_type_mappings_insert on public.fhir_loinc_vital_type_mappings
  for insert to authenticated with check (private.is_admin());
create policy fhir_loinc_vital_type_mappings_update on public.fhir_loinc_vital_type_mappings
  for update to authenticated using (private.is_admin()) with check (private.is_admin());
create policy fhir_loinc_vital_type_mappings_delete on public.fhir_loinc_vital_type_mappings
  for delete to authenticated using (private.is_admin());

-- A freshly created table needs its own explicit grant -- default privileges
-- grant authenticated=arwd (all four verbs); RLS already blocks insert/
-- update/delete for a non-admin in practice, but the grant should say what's
-- intended rather than rely on RLS as the only barrier (same discipline the
-- fhir_import_batches/fhir_import_proposed_resources migration used).
revoke insert, update, delete on public.fhir_loinc_vital_type_mappings from authenticated;
grant select on public.fhir_loinc_vital_type_mappings to authenticated;
-- Deliberately no grant to anon: this is clinical-parsing configuration, not
-- public-facing content (unlike vaccination_catalog, which a patient-facing
-- vaccination-history UI may read as an unauthenticated preview elsewhere --
-- no equivalent anonymous read case exists here).

do $$
declare
  v_count integer;
begin
  select count(*) into v_count from public.fhir_loinc_vital_type_mappings;
  if v_count <> 16 then
    raise exception 'expected exactly 16 seeded LOINC mappings, found %', v_count;
  end if;

  if has_table_privilege('authenticated', 'public.fhir_loinc_vital_type_mappings', 'INSERT') then
    raise exception 'authenticated must not hold INSERT on fhir_loinc_vital_type_mappings';
  end if;
  if not has_table_privilege('authenticated', 'public.fhir_loinc_vital_type_mappings', 'SELECT') then
    raise exception 'authenticated must hold SELECT on fhir_loinc_vital_type_mappings';
  end if;
  if has_table_privilege('anon', 'public.fhir_loinc_vital_type_mappings', 'SELECT') then
    raise exception 'anon must not have SELECT on fhir_loinc_vital_type_mappings';
  end if;

  raise notice 'PASS: fhir_loinc_vital_type_mappings created, 16 mappings seeded, RLS + grants confirmed (any authenticated user reads, only private.is_admin() writes)';
end $$;
