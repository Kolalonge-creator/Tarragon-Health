-- Tarragon Health — reprice Men's and Women's Health Check after syphilis removal.
--
-- The 2026-09-04 syphilis removal (migration
-- 20260904210658_remove_syphilis_from_every_product_surface.sql) stripped
-- syphilis from both bundles' test_codes but deliberately left price_kobo
-- untouched, per that migration's own header: repricing belongs with the
-- catalogue-wide +30% pass, not hidden inside a removal.
--
-- That catalogue-wide pass already happened (branch
-- worktree-catalogue-rebuild-30pct, live before this migration), and it
-- priced both bundles at +30% over their cost AT THE TIME, which still
-- included syphilis (Synlab RPR, NGN 17,700). With syphilis now gone, that
-- price is stale relative to the bundle's actual remaining cost:
--
--   womens_health_check  cervical_smear + ferritin + fbc
--     cost   95,100 (with syphilis) -> 77,400 (without)
--     was  123,500 (+30% of 95,100) -> should be 100,500 (+30% of 77,400)
--   mens_health_check  psa + lipid_panel + fbc
--     cost  105,900 (with syphilis) -> 88,200 (without)
--     was  137,500 (+30% of 105,900) -> should be 114,500 (+30% of 88,200)
--
-- Both figures verified against live lab_tests costs for Synlab Nigeria
-- (provider name), not hand-typed from the spreadsheet, and dry-run in a
-- rolled-back transaction before this migration was written: 100,500/77,400
-- and 114,500/88,200 both land at 29.8%, i.e. +30% rounded to the nearest 500.

update public.panel_bundles
   set price_kobo = 10050000
 where code = 'womens_health_check';

update public.panel_bundles
   set price_kobo = 11450000
 where code = 'mens_health_check';

do $$
declare
  v_womens_price bigint;
  v_mens_price   bigint;
begin
  select price_kobo into v_womens_price from public.panel_bundles where code = 'womens_health_check';
  if v_womens_price <> 10050000 then
    raise exception 'FAIL: womens_health_check price_kobo is % (expected 10050000)', v_womens_price;
  end if;

  select price_kobo into v_mens_price from public.panel_bundles where code = 'mens_health_check';
  if v_mens_price <> 11450000 then
    raise exception 'FAIL: mens_health_check price_kobo is % (expected 11450000)', v_mens_price;
  end if;

  raise notice 'PASS: both bundles repriced to +30%% of their post-syphilis-removal cost';
end $$;
