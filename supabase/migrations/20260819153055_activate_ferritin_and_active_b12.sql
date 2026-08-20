-- Tarragon Health — activate Ferritin and Active B12, add to Comprehensive
-- Screen.
--
-- 20260819151310_add_dormant_ferritin_active_b12_screen_types.sql landed
-- both as real screen_types rows but deliberately dormant, pending real
-- Nigerian lab pricing. Founder decision this session: don't gate them
-- behind "coming soon" — activate now.
--
-- ASSUMPTION FLAGGED: no separate per-test price was given for either, so
-- this folds both into screen_comprehensive.test_codes at its EXISTING
-- price_kobo (14,900,000 = ₦149,000), unchanged. That price now covers two
-- more tests than it did before, with no stated cost check against what a
-- Nigerian lab actually charges for ferritin/active B12. If that turns out
-- to meaningfully eat into Comprehensive's margin, the fix is either a
-- price_kobo increase on screen_comprehensive or splitting these out as
-- their own single_ferritin/single_active_b12 self-bookable line items
-- (matching single_hba1c, single_lipid_panel, etc.) — not something this
-- migration can determine on its own.
--
-- Same precedent as 20260811233602_activate_abdominal_and_prostate_
-- ultrasound.sql: create dormant first, activate in a later migration once
-- the real decision lands, rather than rewriting the original insert.

update public.screen_types
set is_active = true
where code in ('ferritin', 'active_b12');

update public.panel_bundles
set test_codes = test_codes || array['ferritin', 'active_b12']::text[]
where code = 'screen_comprehensive'
  and not ('ferritin' = any(test_codes))
  and not ('active_b12' = any(test_codes));

do $$
begin
  if not exists (select 1 from public.screen_types where code = 'ferritin' and is_active = true) then
    raise exception 'FAIL: ferritin not active';
  end if;
  if not exists (select 1 from public.screen_types where code = 'active_b12' and is_active = true) then
    raise exception 'FAIL: active_b12 not active';
  end if;
  if not exists (
    select 1 from public.panel_bundles
    where code = 'screen_comprehensive'
      and 'ferritin' = any(test_codes)
      and 'active_b12' = any(test_codes)
  ) then
    raise exception 'FAIL: ferritin/active_b12 not both in screen_comprehensive.test_codes';
  end if;
  raise notice 'PASS: ferritin and active_b12 are active and in screen_comprehensive';
end $$;
