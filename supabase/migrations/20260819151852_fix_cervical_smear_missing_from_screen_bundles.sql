-- Tarragon Health — fix cervical_smear missing from screen_advanced /
-- screen_comprehensive.test_codes.
--
-- Found while grounding a new "what we measure" marketing section
-- (/annual-health-check) in the real panel_bundles data. That same page's
-- own copy has always promised gender-symmetric cancer screening —
-- "cervical screening for women, prostate (PSA) for men... included from
-- Advanced Screen up" (WHATS_INCLUDED) and "the cancer screening that fits
-- your age and sex (cervical screening or PSA)" (tier card copy) — but
-- 20260802212103_screening_ladder_core_advanced_comprehensive.sql's actual
-- test_codes arrays only ever added 'psa', never 'cervical_smear', to
-- either screen_advanced or screen_comprehensive. cervical_smear has only
-- ever been reachable as its own standalone booking (single_cervical_smear,
-- 18,000 naira, self_bookable) — never as part of a paid tier, despite the
-- tier copy saying otherwise since the ladder shipped.
--
-- This corrects the oversight to match the page's existing, already-shipped
-- promise, not a new product decision: cervical_smear joins psa in both
-- bundles' test_codes, same tier (Advanced) psa already sits at, same
-- pattern used for every other age/sex-triggered test in this table. Bundle
-- prices (screen_advanced 95,000 naira, screen_comprehensive 149,000 naira)
-- are left unchanged — the marketing copy already priced this test in, it
-- just never actually landed in the array driving fulfilment/tracking.

update public.panel_bundles
set test_codes = array_append(test_codes, 'cervical_smear')
where code in ('screen_advanced', 'screen_comprehensive')
  and not ('cervical_smear' = any(test_codes));

do $$
begin
  if exists (
    select 1 from public.panel_bundles
    where code in ('screen_advanced', 'screen_comprehensive')
      and not ('cervical_smear' = any(test_codes))
  ) then
    raise exception 'FAIL: cervical_smear still missing from an Advanced/Comprehensive bundle';
  end if;
  if exists (
    select 1 from public.panel_bundles
    where code = 'screen_core' and 'cervical_smear' = any(test_codes)
  ) then
    raise exception 'FAIL: cervical_smear leaked into screen_core, which was never promised it';
  end if;
  raise notice 'PASS: cervical_smear now present in screen_advanced and screen_comprehensive, matching the page''s existing promise';
end $$;
