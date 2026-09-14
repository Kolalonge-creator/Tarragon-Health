-- Closes a real catalogue gap: no active panel_bundle carried ecg_resting,
-- so the ECG upload path (EcgReportUpload, ecg_report_documents, the
-- includesEcg branch in annual-health-check-booking.tsx/lab-orders-list.tsx)
-- was fully built but dormant -- nothing a patient could actually order
-- would ever trigger it. Founder decision 2026-09-14: fold the heart tracing
-- into Heart Health Check (already self_bookable, already the cardiovascular
-- risk panel an ECG belongs next to) rather than inventing a new standalone
-- self-bookable product.

update panel_bundles
set
  test_codes = array['lipid_panel', 'hba1c', 'kft', 'ecg_resting'],
  description = 'Lipid panel, HbA1c, kidney function and a resting 12-lead ECG: the core cardiometabolic risk picture, heart rhythm included.'
where code = 'heart_health_check';

-- A standalone, browsable (not self-bookable) single-test entry, matching
-- the existing single_hba1c/single_lipid_panel/single_fbc convention: those
-- exist in the catalogue for reference even though self_bookable=false means
-- a patient requests them as part of a panel, not this quick-list page.
insert into panel_bundles (
  code, name, description, price_kobo, test_codes, is_active,
  commission_rate_type, self_bookable, review_discount_bp, is_screen_tier,
  category, guidance_only, indicative_price_kobo, indicative_price_source,
  indicative_price_checked_on, where_to_get
)
select
  'single_ecg_resting', 'Heart Tracing (ECG)',
  'Single test: a resting 12-lead ECG, a quick trace of your heart''s electrical rhythm.',
  0, array['ecg_resting'], true,
  'percentage', false, 0, false,
  'single_test', true, null, null,
  null,
  'A radiology or diagnostic imaging centre, or the imaging department of a general hospital. Tarragon does not arrange or price imaging; ask the centre for their current fee when you book.'
where not exists (select 1 from panel_bundles where code = 'single_ecg_resting');

do $$
declare
  hhc_test_codes text[];
  ecg_bundle_count int;
begin
  select test_codes into hhc_test_codes from panel_bundles where code = 'heart_health_check';
  if not ('ecg_resting' = any(hhc_test_codes)) then
    raise exception 'add_ecg_to_catalogue: heart_health_check does not carry ecg_resting after update';
  end if;

  select count(*) into ecg_bundle_count from panel_bundles where 'ecg_resting' = any(test_codes) and is_active = true;
  if ecg_bundle_count < 1 then
    raise exception 'add_ecg_to_catalogue: no active panel_bundles row carries ecg_resting';
  end if;
end $$;
