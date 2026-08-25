-- Tarragon Health — add Ferritin and Active B12 as real screen_types rows,
-- but deliberately DORMANT (is_active = false).
--
-- Context: building a public "what we measure" marketing page modelled on
-- a competitor's (dohealth.co) page. Founder reviewed dohealth's full
-- biomarker list and explicitly declined CRP, Uric Acid, and Homocysteine
-- (the "inflammation" panel), an ApoB add, a general hormone panel
-- (Testosterone/Prolactin/FSH/LH/Oestradiol/SHBG/FAI), and Vitamin D —
-- none of those are added here.
--
-- Fasting Insulin was also proposed and rejected: founder confirmed it
-- isn't readily available at Nigerian labs (only Fasting Glucose/OGTT is —
-- already live as the ogtt_fpg screen_type), so it never became a row here.
-- HOMA-IR (insulin resistance index, = fasting glucose x fasting insulin /
-- 405) falls with it — it has no real Fasting Insulin input to compute
-- from in this market, so there is nothing to derive and display. Do not
-- re-propose Fasting Insulin/HOMA-IR without first confirming a Nigerian
-- lab partner actually offers the fasting insulin assay.
--
-- Ferritin + Active B12 were approved in principle, but no real Nigerian
-- private-lab price exists for either yet, so — per founder decision this
-- session — they land as real catalogue rows, intended for the
-- Comprehensive Screen tier once priced, but:
--   * is_active = false, so private.calculate_due_screenings() and
--     screening-recommendations.ts (both read screen_types generically by
--     age/sex, no per-code branching) will never surface these as due.
--   * NOT added to any panel_bundles.test_codes array — screen_comprehensive
--     stays at its current, already-costed ₦149,000 composition. Adding an
--     unpriced test into a fixed-price bundle would silently make that
--     bundle undercost its own contents.
-- This mirrors the 'echo' (Echocardiogram) precedent from
-- 20260802212103_screening_ladder_core_advanced_comprehensive.sql, which
-- shipped as a real row, deliberately left out of every bundle's
-- test_codes, until a real trigger/price existed for it.
--
-- [LOCALISE] pending founder/lab-partner pricing before is_active flips to
-- true or either test is added to screen_comprehensive.test_codes.

insert into public.screen_types
  (code, name, sex_applicability, age_from, age_to, frequency_months, recommended_provider_type, is_active)
values
  ('ferritin',   'Ferritin',   'all', 18, null, 12, 'lab', false),
  ('active_b12', 'Active B12', 'all', 18, null, 12, 'lab', false)
on conflict (code) do nothing;

do $$
begin
  if not exists (select 1 from public.screen_types where code = 'ferritin' and is_active = false) then
    raise exception 'FAIL: ferritin screen_type missing or not dormant';
  end if;
  if not exists (select 1 from public.screen_types where code = 'active_b12' and is_active = false) then
    raise exception 'FAIL: active_b12 screen_type missing or not dormant';
  end if;
  if exists (select 1 from public.screen_types where code = 'fasting_insulin') then
    raise exception 'FAIL: fasting_insulin exists but was rejected as unavailable in Nigeria';
  end if;
  if exists (
    select 1 from public.panel_bundles
    where 'ferritin' = any(test_codes)
       or 'active_b12' = any(test_codes)
  ) then
    raise exception 'FAIL: a dormant/unpriced test_code leaked into a priced panel_bundles bundle';
  end if;
  raise notice 'PASS: ferritin, active_b12 exist as dormant screen_types and are in no priced bundle; fasting_insulin correctly absent';
end $$;
