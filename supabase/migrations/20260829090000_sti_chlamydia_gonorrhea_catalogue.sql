-- Sexual & Reproductive Health platform, 1/8: close a real catalogue gap.
--
-- Chlamydia and gonorrhoea are the two most common curable STIs and neither
-- has ever existed anywhere in this schema (confirmed by a full-repo search
-- before writing this) — HIV, Hepatitis B/C and syphilis are all real,
-- self-bookable screen_types today; chlamydia/gonorrhoea are not. Modelled
-- identically to syphilis's own addition (20260802212103): a screen_types
-- row marked sensitive, lab_tests rows for the 4 existing providers, and a
-- self-bookable panel_bundles entry. In practice a chlamydia/gonorrhoea
-- check is one NAAT swab/urine sample testing for both organisms at once, so
-- one combined screen_type + one combined bundle, not two separate orders.
--
-- Prices are PLACEHOLDER (same convention as
-- 20260724020715_self_bookable_blood_group_genotype_hep_c) — founder to
-- confirm real contracted rates; illustrative NAAT pricing used here.

insert into public.screen_types
  (code, name, sex_applicability, age_from, age_to, frequency_months, sensitive)
values
  ('chlamydia_gonorrhoea', 'Chlamydia & Gonorrhoea (NAAT)', 'all', 18, null, 12, true)
on conflict (code) do nothing;

insert into public.lab_tests (provider_id, code, name, price_kobo, commission_rate, turnaround_hours)
select p.id, t.code, t.name, t.price_kobo, t.commission_rate, t.turnaround_hours
from public.lab_providers p
join (values
  ('Synlab Nigeria',      'chlamydia_gonorrhoea', 'Chlamydia & Gonorrhoea NAAT', 950000::bigint, 0.2000, 48),
  ('Cerba Lancet',        'chlamydia_gonorrhoea', 'Chlamydia & Gonorrhoea NAAT', 1000000::bigint, 0.2000, 48),
  ('Healthtracka',        'chlamydia_gonorrhoea', 'Chlamydia & Gonorrhoea NAAT', 900000::bigint, 0.2200, 48),
  ('Afriglobal Medicare', 'chlamydia_gonorrhoea', 'Chlamydia & Gonorrhoea NAAT', 900000::bigint, 0.2000, 48)
) as t(provider_name, code, name, price_kobo, commission_rate, turnaround_hours)
  on t.provider_name = p.name
on conflict (provider_id, code) do nothing;

insert into public.panel_bundles (code, name, description, price_kobo, test_codes, self_bookable)
values
  ('single_chlamydia_gonorrhoea', 'Chlamydia & Gonorrhoea Screening',
   'A confidential combined swab/urine test for the two most common curable STIs. Doctor-reviewed, and treatment is arranged directly with you if the result needs it.',
   950000, array['chlamydia_gonorrhoea'], true),
  ('sti_panel_full', 'Full STI Panel',
   'A confidential one-stop sexual-health check: HIV, syphilis, hepatitis B, hepatitis C, chlamydia and gonorrhoea. Doctor-reviewed, with same-week follow-up if anything needs treatment.',
   4200000, array['hiv', 'syphilis', 'hep_b', 'hep_c', 'chlamydia_gonorrhoea'], true)
on conflict (code) do nothing;

-- Reopened by a reported sexual exposure alongside hep_b/hep_c/hiv/syphilis —
-- NAAT sensitivity for chlamydia/gonorrhoea is high from about 2 weeks post-
-- exposure, with no useful later "definitive" repeat the way serology has a
-- window/exclusion pattern, so definitive_test_days is left null.
insert into public.exposure_retest_rules
  (exposure_code, screen_type_code, earliest_test_days, definitive_test_days, basis) values
  ('sexual_exposure', 'chlamydia_gonorrhoea', 14, null,
   'NAAT is highly sensitive for both organisms from about 2 weeks post-exposure; unlike serology there is no later confirmatory window to schedule.')
on conflict (exposure_code, screen_type_code) do nothing;

do $$
begin
  if not exists (select 1 from public.screen_types where code = 'chlamydia_gonorrhoea' and sensitive) then
    raise exception 'FAIL: chlamydia_gonorrhoea screen_type missing or not marked sensitive';
  end if;
  if (select count(*) from public.lab_tests where code = 'chlamydia_gonorrhoea') <> 4 then
    raise exception 'FAIL: expected 4 lab_tests rows (one per provider) for chlamydia_gonorrhoea';
  end if;
  if not exists (select 1 from public.panel_bundles where code = 'single_chlamydia_gonorrhoea' and self_bookable) then
    raise exception 'FAIL: single_chlamydia_gonorrhoea bundle missing or not self-bookable';
  end if;
  if not exists (select 1 from public.panel_bundles where code = 'sti_panel_full' and self_bookable) then
    raise exception 'FAIL: sti_panel_full bundle missing or not self-bookable';
  end if;
  if not exists (
    select 1 from public.exposure_retest_rules
    where exposure_code = 'sexual_exposure' and screen_type_code = 'chlamydia_gonorrhoea'
  ) then
    raise exception 'FAIL: sexual_exposure does not reopen chlamydia_gonorrhoea';
  end if;
  raise notice 'PASS: chlamydia/gonorrhoea are real, self-bookable, sensitive-gated screen_types';
end $$;
