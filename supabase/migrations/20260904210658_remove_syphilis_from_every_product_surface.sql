-- Tarragon Health — remove syphilis from every product surface.
--
-- Founder decision 2026-09-04. Raised first as a naming defect: the screen type
-- was named "Syphilis (VDRL with TPHA confirmation)" while the only fulfilling
-- lab_tests row was RPR Agglutination at NGN 17,700 — a real test, but not the
-- confirmatory pair the name promised (Synlab's VDRL is NGN 124,500 and TPHA
-- NGN 100,400, and neither was ever ordered). The recommendation was to rename
-- to "Syphilis (RPR)" and keep the test. The founder chose removal instead, and
-- confirmed "everywhere" when asked whether that meant the STI panel only.
--
-- ZERO patient rows are affected, so this is a pure structural change with no
-- data-migration step. Counted immediately before writing this migration:
--   screening_schedules for syphilis .... 0
--   screening_results for syphilis ...... 0
--   screening_completions (all) ......... 0
--   sexual_health_screens (all) ......... 0
--   lab_orders (all, any test) .......... 3
--
-- Deactivation rather than DELETE, deliberately. Every other retired product on
-- this platform uses is_active = false (screen_advanced, screen_comprehensive,
-- health_check_basic, the pack products); syphilis is catalogue DATA, not an
-- enum value, so CLAUDE.md's "delete the enum VALUE so it cannot grow back"
-- guidance does not apply here. What does apply is the same intent: syphilis is
-- stripped from the test_codes of EVERY bundle including already-inactive ones,
-- so that reactivating screen_comprehensive later cannot silently reintroduce a
-- test the founder removed.
--
-- Two ACTIVE bundles lose a component here and keep their price:
--   womens_health_check  cost 95,100 -> 77,400, still sells at 114,000
--   mens_health_check    cost 105,900 -> 88,200, still sells at 127,000
-- That moves both from the catalogue-wide +20% to roughly +45%. Deliberately NOT
-- corrected in this migration: repricing is a separate decision covering the
-- whole catalogue (the agreed move to +30%), and folding it in here would hide a
-- pricing change inside a removal. Flagged to the founder in the same breath.

-- ---------------------------------------------------------------------------
-- 1. Strip syphilis from every bundle that references it.
--    array_remove is idempotent, so a re-run (or a concurrent session touching
--    the same bundles) cannot corrupt the array.
--    single_syphilis is excluded on purpose: emptying its test_codes would
--    leave a zero-test bundle, which reads as corruption rather than as a
--    retired product. It is deactivated whole in step 2 instead.
-- ---------------------------------------------------------------------------
update public.panel_bundles
   set test_codes = array_remove(test_codes, 'syphilis')
 where 'syphilis' = any (test_codes)
   and code <> 'single_syphilis';

-- ---------------------------------------------------------------------------
-- 2. Retire the standalone product.
-- ---------------------------------------------------------------------------
update public.panel_bundles
   set is_active = false,
       self_bookable = false
 where code = 'single_syphilis';

-- ---------------------------------------------------------------------------
-- 3. Retire the screen type, so the preventive cadence engine stops scheduling
--    it. frequency_months stays as-is: it records what the cadence WAS, and an
--    inactive screen_type is never picked up by the scheduler regardless.
-- ---------------------------------------------------------------------------
update public.screen_types
   set is_active = false
 where code = 'syphilis';

-- ---------------------------------------------------------------------------
-- 4. Retire the fulfilling lab tests across all four providers, so no order can
--    route to a syphilis assay even if a bundle reference is missed somewhere.
-- ---------------------------------------------------------------------------
update public.lab_tests
   set is_active = false
 where code = 'syphilis';

-- ---------------------------------------------------------------------------
-- 5. Prove it. "Removed" should be provable, not hopeful.
-- ---------------------------------------------------------------------------
do $$
declare
  v_active_bundles int;
  v_any_ref        int;
  v_single_active  boolean;
  v_screen_active  boolean;
  v_lab_active     int;
begin
  select count(*) into v_active_bundles
    from public.panel_bundles where is_active and 'syphilis' = any (test_codes);
  if v_active_bundles <> 0 then
    raise exception 'FAIL: % active bundle(s) still reference syphilis', v_active_bundles;
  end if;

  select count(*) into v_any_ref
    from public.panel_bundles
   where 'syphilis' = any (test_codes) and code <> 'single_syphilis';
  if v_any_ref <> 0 then
    raise exception 'FAIL: % bundle(s) still reference syphilis (inactive ones count - they can be reactivated)', v_any_ref;
  end if;

  select is_active into v_single_active from public.panel_bundles where code = 'single_syphilis';
  if v_single_active is not false then
    raise exception 'FAIL: single_syphilis is not deactivated (is_active = %)', v_single_active;
  end if;

  select is_active into v_screen_active from public.screen_types where code = 'syphilis';
  if v_screen_active is not false then
    raise exception 'FAIL: the syphilis screen_type is not deactivated (is_active = %)', v_screen_active;
  end if;

  select count(*) into v_lab_active from public.lab_tests where code = 'syphilis' and is_active;
  if v_lab_active <> 0 then
    raise exception 'FAIL: % syphilis lab_tests row(s) still active', v_lab_active;
  end if;

  raise notice 'PASS: syphilis removed from every bundle, product, screen type and lab test';
end $$;
