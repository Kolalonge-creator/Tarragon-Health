-- Tarragon Health — rename the screen_types row 'active_b12' to
-- 'vitamin_b12', to match the platform's real, already-grounded pipeline
-- rather than dohealth.co's exact test name.
--
-- Found while grounding the new "what we measure" marketing pages: this
-- platform has two independent code namespaces for a lab test —
-- screen_types.code (what gets scheduled/ordered) and the analyte
-- catalogue in apps/web/src/lib/lab-reports/analyte-catalogue.ts (what a
-- lab report's printed value resolves to for extraction), with the
-- interpretation layer in reference-ranges.ts keyed off the SECOND
-- namespace. The analyte catalogue already has a real, sourced,
-- fully-tested entry for 'vitamin_b12' (Total B12: aliases "vitamin b12",
-- "b12", "cobalamin", "vit b12"; reference band 200-900 pg/mL,
-- borderlineLow 300) — but nothing for 'active_b12' (Active B12 /
-- holotranscobalamin, a distinct, less common assay with its own
-- pmol/L-scale reference range that Total B12's band cannot substitute
-- for without misinterpreting the result). Extraction's alias matching
-- would not resolve an "Active B12" line on a lab report to anything, so
-- a patient's result would fall through to fully manual review with none
-- of the automated interpretation every other catalogue test gets.
--
-- Renaming to the test the platform can actually schedule, extract, AND
-- interpret end-to-end, rather than building new clinical infrastructure
-- (a new analyte code + sourced pmol/L reference band) for an assay that,
-- like Fasting Insulin, may not be readily available at Nigerian labs
-- either — standard Total B12 is the far more commonly stocked test.
--
-- screening-recommendations.ts reads screen_types generically by
-- age/sex/frequency (no per-code branching), so this rename needs no
-- application code change on the scheduling side.

update public.screen_types
set code = 'vitamin_b12', name = 'Vitamin B12'
where code = 'active_b12';

update public.panel_bundles
set test_codes = array_replace(test_codes, 'active_b12', 'vitamin_b12')
where 'active_b12' = any(test_codes);

do $$
begin
  if exists (select 1 from public.screen_types where code = 'active_b12') then
    raise exception 'FAIL: active_b12 still present after rename';
  end if;
  if not exists (select 1 from public.screen_types where code = 'vitamin_b12' and is_active = true) then
    raise exception 'FAIL: vitamin_b12 missing or not active';
  end if;
  if exists (
    select 1 from public.panel_bundles where 'active_b12' = any(test_codes)
  ) then
    raise exception 'FAIL: a bundle still references active_b12';
  end if;
  if not exists (
    select 1 from public.panel_bundles
    where code = 'screen_comprehensive' and 'vitamin_b12' = any(test_codes)
  ) then
    raise exception 'FAIL: screen_comprehensive missing vitamin_b12';
  end if;
  raise notice 'PASS: active_b12 renamed to vitamin_b12 in screen_types and panel_bundles';
end $$;
