-- Catalogue rebuild PR #469 fix-up, on reconciliation 2026-09-06.
--
-- The 2026-09-05 platform audit flagged the four cancer_screen_* service_products
-- rows (up to N432,500) as "referenced by zero code... contradicting the you-pay-
-- the-lab promise". That is a real defect, not just an unmerged branch: they were
-- built on the credit-redemption primitive (service_products/service_purchases +
-- redeem_cancer_screening_purchase), which only writes a screening_schedules
-- "due" row. It never creates a lab_orders row, so nothing is ever actually
-- dispatched to a lab -- a patient paying N432,500 would get a calendar entry
-- and no test. Every OTHER real lab product on this platform (screen_core,
-- blood_borne_virus_screen, mens/womens_health_check, ...) is a panel_bundles
-- row billed via createAndPayForPartnerLabOrder, which inserts a real lab_orders
-- row with fulfilment='partner' before checkout. This migration moves the four
-- cancer bundles onto that same, already-working path instead.
--
-- The HPV DNA co-test component (30+ and Women 45+) still has no lab_tests cost
-- row and no screen_types cadence -- same documented gap as the original phase-4
-- migration. test_codes below only reference the components this platform can
-- actually order (cervical_smear/psa/fit); the HPV premium stays folded into the
-- flat panel_bundles.price_kobo, same as before.
--
-- Also fixes a second, unrelated dangling row found in the same audit pass:
-- screen_types.chlamydia_gonorrhoea is_active=true with zero backing lab_tests
-- rows anywhere (the original phase-1 migration deleted the bad-cost lab_tests
-- rows entirely; something later created a screen_type for the code with no
-- price and no cost) -- an active, unbookable, unpriced screen a patient could
-- see recommended with no way to actually book it.

begin;

-- ---------------------------------------------------------------------------
-- Retire the credit-based cancer screening SKUs and the now-dead redemption path.
-- ---------------------------------------------------------------------------
update public.service_products
   set is_active = false
 where code in (
   'cancer_screen_cervical_under30', 'cancer_screen_cervical_30plus',
   'cancer_screen_women_45plus', 'cancer_screen_men_45plus'
 );

drop function if exists public.redeem_cancer_screening_purchase(uuid, text);

-- ---------------------------------------------------------------------------
-- Real cancer screening bundles: panel_bundles, billed the same way every
-- other lab product on this platform already is.
-- ---------------------------------------------------------------------------
insert into public.panel_bundles (code, name, description, price_kobo, test_codes, is_active, self_bookable, is_screen_tier)
values
  ('cancer_screen_cervical_under30', 'Cervical Cancer Screening (under 30)',
   'Liquid-based cytology, plus a doctor consult to walk through the result.',
   6200000, array['cervical_smear'], true, true, false),
  ('cancer_screen_cervical_30plus', 'Cervical Cancer Screening (30 and over)',
   'Liquid-based cytology plus HPV DNA co-test, plus a doctor consult to walk through the result. The HPV co-test is billed as part of this bundle''s price; it has no separate line item on the platform yet.',
   22250000, array['cervical_smear'], true, true, false),
  ('cancer_screen_women_45plus', 'Cancer Screening -- Women 45+',
   'Cervical screening (LBC + HPV co-test) plus bowel screening (FIT), plus a doctor consult to walk through both results.',
   43250000, array['cervical_smear', 'fit'], true, true, false),
  ('cancer_screen_men_45plus', 'Cancer Screening -- Men 45+',
   'PSA with free-PSA ratio plus bowel screening (FIT), plus a doctor consult to walk through both results.',
   31050000, array['psa', 'fit'], true, true, false)
on conflict (code) do update
  set price_kobo = excluded.price_kobo,
      description = excluded.description,
      test_codes = excluded.test_codes,
      is_active = true,
      self_bookable = true;

-- ---------------------------------------------------------------------------
-- Dangling, unbookable screen_type found in the same audit pass.
-- ---------------------------------------------------------------------------
update public.screen_types
   set is_active = false
 where code = 'chlamydia_gonorrhoea';

do $$
declare
  v_old_active int;
  v_new_bundles int;
  v_rpc_gone boolean;
  v_dangling_screen boolean;
begin
  select count(*) into v_old_active
    from public.service_products
   where code like 'cancer_screen_%' and is_active;
  if v_old_active <> 0 then
    raise exception 'FAIL: % old cancer_screen_* service_products row(s) still active', v_old_active;
  end if;

  select count(*) into v_new_bundles
    from public.panel_bundles
   where code like 'cancer_screen_%' and is_active and self_bookable
     and array_length(test_codes, 1) > 0;
  if v_new_bundles <> 4 then
    raise exception 'FAIL: expected 4 active self-bookable cancer_screen_* panel_bundles, found %', v_new_bundles;
  end if;

  select not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where p.proname = 'redeem_cancer_screening_purchase' and n.nspname = 'public'
  ) into v_rpc_gone;
  if not v_rpc_gone then
    raise exception 'FAIL: redeem_cancer_screening_purchase still exists';
  end if;

  select is_active into v_dangling_screen from public.screen_types where code = 'chlamydia_gonorrhoea';
  if v_dangling_screen then
    raise exception 'FAIL: chlamydia_gonorrhoea screen_type still active';
  end if;

  raise notice 'PASS: cancer screening bundles moved onto the real lab-order path; dangling chlamydia_gonorrhoea screen_type deactivated.';
end $$;

commit;
