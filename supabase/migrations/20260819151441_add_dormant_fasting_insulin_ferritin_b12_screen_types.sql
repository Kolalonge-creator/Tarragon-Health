-- Tarragon Health — add Fasting Insulin, Ferritin, and Active B12 as real
-- screen_types rows, but deliberately DORMANT (is_active = false).
--
-- Context: building a public "what we measure" marketing page modelled on
-- a competitor's (dohealth.co) page. Founder reviewed dohealth's full
-- biomarker list and explicitly declined CRP, Uric Acid, and Homocysteine
-- (the "inflammation" panel), an ApoB add, and a general hormone panel
-- (Testosterone/Prolactin/FSH/LH/Oestradiol/SHBG/FAI) — none of those are
-- added here. Vitamin D was offered and not selected either. Fasting
-- Insulin + Ferritin + Active B12 were approved in principle, but no real
-- Nigerian private-lab price exists for any of the three yet, so — per
-- founder decision this session — they land as real catalogue rows,
-- intended for the Comprehensive Screen tier once priced, but:
--   * is_active = false, so private.calculate_due_screenings() and
--     screening-recommendations.ts (both read screen_types generically by
--     age/sex, no per-code branching) will never surface these as due.
--   * NOT added to any panel_bundles.test_codes array — screen_comprehensive
--     stays at its current, already-costed 149,000 naira composition.
--     Adding an unpriced test into a fixed-price bundle would silently
--     make that bundle undercost its own contents.
-- This mirrors the 'echo' (Echocardiogram) precedent from
-- 20260802212103_screening_ladder_core_advanced_comprehensive.sql, which
-- shipped as a real row, deliberately left out of every bundle's
-- test_codes, until a real trigger/price existed for it.
--
-- HOMA-IR (insulin resistance index) is explicitly NOT a screen_types row:
-- it's a calculation (fasting glucose x fasting insulin / 405), not a lab
-- assay, same "computed, not stored" pattern already used for BMI
-- (apps/web/src/lib/health-metrics/bmi.ts). Once Fasting Insulin has a real
-- price and is activated, HOMA-IR should be derived at display time from
-- that result plus the existing ogtt_fpg (Fasting Plasma Glucose) result —
-- no new table needed.
--
-- [LOCALISE] pending founder/lab-partner pricing before is_active flips to
-- true or either test is added to screen_comprehensive.test_codes.

insert into public.screen_types
  (code, name, sex_applicability, age_from, age_to, frequency_months, recommended_provider_type, is_active)
values
  ('fasting_insulin', 'Fasting Insulin', 'all', 18, null, 12, 'lab', false),
  ('ferritin',         'Ferritin',        'all', 18, null, 12, 'lab', false),
  ('active_b12',       'Active B12',      'all', 18, null, 12, 'lab', false)
on conflict (code) do nothing;

do $$
begin
  if not exists (select 1 from public.screen_types where code = 'fasting_insulin' and is_active = false) then
    raise exception 'FAIL: fasting_insulin screen_type missing or not dormant';
  end if;
  if not exists (select 1 from public.screen_types where code = 'ferritin' and is_active = false) then
    raise exception 'FAIL: ferritin screen_type missing or not dormant';
  end if;
  if not exists (select 1 from public.screen_types where code = 'active_b12' and is_active = false) then
    raise exception 'FAIL: active_b12 screen_type missing or not dormant';
  end if;
  if exists (
    select 1 from public.panel_bundles
    where 'fasting_insulin' = any(test_codes)
       or 'ferritin' = any(test_codes)
       or 'active_b12' = any(test_codes)
  ) then
    raise exception 'FAIL: a dormant/unpriced test_code leaked into a priced panel_bundles bundle';
  end if;
  raise notice 'PASS: fasting_insulin, ferritin, active_b12 exist as dormant screen_types and are in no priced bundle';
end $$;
