-- The laboratory catalogue stops being commerce and becomes guidance.
-- Founder decision, 2026-09-10.
--
-- WHY
-- ---
-- public.lab_tests.price_kobo was recorded as "what SynLab charges Tarragon"
-- (see 20260821191743). It is, in fact, SynLab's own published consumer price.
-- Verified 2026-09-10 against SynLab Nigeria's public Nigerian price list on
-- eleven tests, several matching to the naira:
--
--     HbA1c 37,600 · Lipid profile 31,600 · PSA 43,200 · LBC 40,000
--     FBC 13,400 · Vitamin B12 35,500 · Ferritin 24,000 · Blood group 12,700
--     FIT 161,600 · TSH 22,300 · Genotype (Hb electrophoresis) 31,400
--
-- Every patient price on this platform derives from those figures via
-- cost * 1.3 (20260903001226). So a patient buying an HbA1c through Tarragon
-- pays 49,000 for a test they can walk into SynLab and buy for 37,600. That is
-- true of the entire catalogue, and it is one price-check away from being
-- discovered. There is no marketing answer to it.
--
-- WHAT CHANGES
-- ------------
-- Tarragon stops selling tests. Deciding WHICH tests a patient needs stays
-- free, as it already is. Reading the result becomes the paid product
-- (public.service_products.written_result_interpretation, added in the
-- doctor-time migration that follows this one).
--
-- Mechanically: every panel_bundle and every priced screen_type becomes
-- guidance_only — a recommendation carrying an indicative price and where to
-- obtain it, not a thing with a checkout. self_bookable goes false across the
-- board, which is what every existing purchase surface already filters on
-- (annual-health-check-booking, cancer-screening-card, sti-testing-panel,
-- vouchers, screening-days), so nothing can be bought through an existing code
-- path from the moment this lands. The UI change that follows replaces those
-- now-empty lists with the guidance presentation.
--
-- THIS ALSO CLOSES A LIVE CLINICAL EXPOSURE
-- -----------------------------------------
-- Three cancer bundles billed for tests the platform cannot order. Cervical
-- Cancer Screening (30 and over) sold at 222,500 promising "liquid-based
-- cytology plus HPV DNA co-test", with test_codes = ARRAY['cervical_smear'].
-- HPV DNA has no row in lab_tests, so no lab_order could ever contain it. A
-- woman paying that price would reasonably believe she had been co-tested. The
-- same gap existed on Cancer Screening -- Women 45+ (432,500) and, for the
-- free-PSA ratio, on Men 45+ (310,500). Under guidance_only none of the three
-- is purchasable, and their descriptions are rewritten below to describe what
-- to ask a laboratory for rather than what Tarragon will do.
--
-- INDICATIVE PRICES ARE THE ONE VERIFIED NUMBER, NOT AN INVENTED RANGE
-- -------------------------------------------------------------------
-- indicative_price_kobo is populated from the dearest ACTIVE provider in
-- lab_tests, which is SynLab and which is a real published figure. It is
-- deliberately a single number with a source and a checked-on date rather than
-- a min/max band: a lower bound would have to be invented, and an invented
-- number on a patient-facing page is exactly the failure this migration exists
-- to correct. Patient-facing copy pairs it with "smaller laboratories often
-- charge less", which is true and does not require a figure.
--
-- ZERO-ROW CHECK (live, before writing this): 4 lab_orders, 0 screening_results,
-- 0 programme_purchases, 9 service_purchases. Nothing in flight depends on a
-- bundle staying purchasable, so this is structural rather than a data
-- migration.

begin;

-- ---------------------------------------------------------------------------
-- 1. Guidance columns
-- ---------------------------------------------------------------------------

alter table public.panel_bundles
  add column if not exists guidance_only              boolean not null default false,
  add column if not exists indicative_price_kobo      bigint,
  add column if not exists indicative_price_source    text,
  add column if not exists indicative_price_checked_on date,
  add column if not exists where_to_get               text;

alter table public.screen_types
  add column if not exists guidance_only              boolean not null default false,
  add column if not exists indicative_price_kobo      bigint,
  add column if not exists indicative_price_source    text,
  add column if not exists indicative_price_checked_on date,
  add column if not exists where_to_get               text;

comment on column public.panel_bundles.guidance_only is
  'True means Tarragon recommends this but does not sell it. The patient takes the request to a laboratory of their choice and pays that laboratory directly. Set platform-wide 2026-09-10 when the catalogue stopped being commerce: Tarragon''s recorded cost was the laboratory''s own retail price, so any markup made Tarragon dearer than the laboratory performing the test. Never set this false for a lab product without first proving a negotiated rate genuinely below public list.';
comment on column public.panel_bundles.indicative_price_kobo is
  'What a patient should expect to pay the LABORATORY, not Tarragon. Taken from the dearest active provider in lab_tests, which is a published figure. Guidance for a patient budgeting, never a price Tarragon charges or guarantees.';
comment on column public.panel_bundles.indicative_price_source is
  'Where indicative_price_kobo came from, so a reader can judge how much to trust it and re-check it.';
comment on column public.panel_bundles.where_to_get is
  'Plain-language answer to "so where do I actually go?". Must never name a single provider as the only option.';

comment on column public.screen_types.guidance_only is
  'See panel_bundles.guidance_only. Same platform-wide decision, 2026-09-10.';
comment on column public.screen_types.indicative_price_kobo is
  'See panel_bundles.indicative_price_kobo.';
comment on column public.screen_types.indicative_price_source is
  'See panel_bundles.indicative_price_source.';
comment on column public.screen_types.where_to_get is
  'See panel_bundles.where_to_get.';

-- ---------------------------------------------------------------------------
-- 2. Nothing in the laboratory catalogue is purchasable any more
-- ---------------------------------------------------------------------------

update public.panel_bundles
   set self_bookable = false,
       guidance_only = true;

update public.screen_types
   set guidance_only = true
 where price_kobo is not null
   and price_kobo > 0;

-- ---------------------------------------------------------------------------
-- 3. Indicative prices, from the dearest ACTIVE provider
--
-- A bundle's indicative price is the sum of its component tests. Where a
-- component has no active provider row the sum would understate, so those are
-- left null rather than shown wrong -- a missing price reads as "ask the
-- laboratory", an understated one reads as a quote Tarragon cannot honour.
-- ---------------------------------------------------------------------------

with component_cost as (
  select b.id,
         count(*) filter (where lt.code is null)      as missing,
         coalesce(sum(lt.price_kobo), 0)              as total_kobo
    from public.panel_bundles b
    cross join lateral unnest(b.test_codes) as tc(code)
    left join lateral (
      select max(lt.price_kobo) as price_kobo, min(lt.code) as code
        from public.lab_tests lt
        join public.lab_providers lp on lp.id = lt.provider_id
       where lt.code = tc.code
         and lt.is_active
         and lp.is_active
    ) lt on true
   group by b.id
)
update public.panel_bundles b
   set indicative_price_kobo       = c.total_kobo,
       indicative_price_source     = 'SYNLAB Nigeria published price list, sum of component tests',
       indicative_price_checked_on = date '2026-09-10'
  from component_cost c
 where c.id = b.id
   and c.missing = 0
   and c.total_kobo > 0;

update public.screen_types s
   set indicative_price_kobo       = lt.price_kobo,
       indicative_price_source     = 'SYNLAB Nigeria published price list',
       indicative_price_checked_on = date '2026-09-10'
  from public.lab_tests lt
  join public.lab_providers lp on lp.id = lt.provider_id
 where lt.code = s.code
   and lt.is_active
   and lp.is_active;

-- ---------------------------------------------------------------------------
-- 4. Where to get it -- category-level, never a single named provider
-- ---------------------------------------------------------------------------

update public.panel_bundles
   set where_to_get = coalesce(where_to_get,
     'Any registered medical laboratory. Take the request we write for you, and pay the laboratory directly at their price. Larger private laboratories tend to be dearer than smaller ones for the same test, so it is worth asking two.');

update public.screen_types
   set where_to_get = coalesce(where_to_get,
     'Any registered medical laboratory. Take the request we write for you, and pay the laboratory directly at their price.')
 where guidance_only;

-- Imaging and physical checks do not come from a laboratory at all, and
-- Tarragon has no active imaging partner (0 imaging_orders ever placed), so
-- their prices were never derived from anything real. They stay visible as
-- recommendations with an honest answer about where to go.
update public.screen_types
   set where_to_get = 'A radiology or diagnostic imaging centre, or the imaging department of a general hospital. Tarragon does not arrange or price imaging; ask the centre for their current fee when you book.',
       indicative_price_kobo = null,
       indicative_price_source = null,
       indicative_price_checked_on = null,
       guidance_only = true
 where code in ('mammography', 'breast_imaging', 'abdominal_ultrasound',
                'prostate_ultrasound', 'echo', 'bone_density', 'colonoscopy',
                'ecg_resting');

update public.screen_types
   set where_to_get = 'A dentist, optometrist or audiologist. Tarragon does not arrange or price these; ask the practice for their current fee.',
       indicative_price_kobo = null,
       indicative_price_source = null,
       indicative_price_checked_on = null,
       guidance_only = true
 where code in ('dental_check', 'vision_check', 'hearing_check');

-- ---------------------------------------------------------------------------
-- 5. The three cancer bundles: descriptions rewritten to match reality
--
-- Each previously described what Tarragon would deliver, including components
-- that have no line item on this platform. They now describe what to ask a
-- laboratory for. The HPV DNA and free-PSA figures below are SynLab's own
-- published prices, checked 2026-09-10.
-- ---------------------------------------------------------------------------

update public.panel_bundles
   set description = 'Recommended from age 30: liquid-based cytology together with an HPV DNA co-test, which detects the virus that causes almost all cervical cancer. Ask your laboratory for "LBC and HPV" as a single request rather than the smear alone. At a major private laboratory the combined test is around 163,300 naira; a smear on its own is around 40,000. Bring the result back and a doctor will read it with you.'
 where code = 'cancer_screen_cervical_30plus';

update public.panel_bundles
   set description = 'Recommended from age 45 for women: cervical screening (liquid-based cytology with an HPV DNA co-test) together with bowel screening. Ask your laboratory for "LBC and HPV" and, separately, a faecal test for hidden blood. Bring both results back and a doctor will read them with you.'
 where code = 'cancer_screen_women_45plus';

update public.panel_bundles
   set description = 'Recommended from age 45 for men: a PSA test, ideally with the free-PSA ratio, together with bowel screening by a faecal test for hidden blood. Ask your laboratory for the free-PSA ratio explicitly, as it is not always included. Bring both results back and a doctor will read them with you.'
 where code = 'cancer_screen_men_45plus';

-- Bowel screening: FIT is genuinely 161,600 at SynLab (confirmed against the
-- published list, so not the data error it resembles), while Faecal Occult
-- Blood sits at 15,400 in the same document. FIT is the better test. At ten
-- times the price it has no Nigerian self-pay market, and pretending otherwise
-- on a patient-facing page helps nobody.
update public.panel_bundles
   set description = 'A faecal test for blood that cannot be seen, which is how bowel cancer is most often caught early. Two versions exist and the price difference is large: the faecal immunochemical test (FIT) is more accurate and costs around 161,600 naira at a major private laboratory, while a faecal occult blood test costs around 15,400. Either is far better than not testing. Ask your doctor which is right for you.'
 where code = 'single_fit';

update public.screen_types
   set clinical_basis = 'Two versions exist at very different prices. The faecal immunochemical test (FIT) is more accurate; a faecal occult blood test is roughly a tenth of the cost. Both detect blood that cannot be seen. Discuss which is appropriate with your doctor.'
 where code = 'fit';

-- ---------------------------------------------------------------------------
-- 6. Assertions
-- ---------------------------------------------------------------------------

do $$
declare
  v_bookable        int;
  v_not_guidance    int;
  v_priced_no_guide int;
  v_no_where        int;
begin
  select count(*) into v_bookable
    from public.panel_bundles where self_bookable;
  if v_bookable <> 0 then
    raise exception 'FAIL: % panel_bundles row(s) still self_bookable', v_bookable;
  end if;

  select count(*) into v_not_guidance
    from public.panel_bundles where not guidance_only;
  if v_not_guidance <> 0 then
    raise exception 'FAIL: % panel_bundles row(s) not marked guidance_only', v_not_guidance;
  end if;

  select count(*) into v_priced_no_guide
    from public.screen_types
   where price_kobo is not null and price_kobo > 0 and not guidance_only;
  if v_priced_no_guide <> 0 then
    raise exception 'FAIL: % priced screen_types row(s) not marked guidance_only', v_priced_no_guide;
  end if;

  select count(*) into v_no_where
    from public.panel_bundles where where_to_get is null;
  if v_no_where <> 0 then
    raise exception 'FAIL: % panel_bundles row(s) have no where_to_get answer', v_no_where;
  end if;

  raise notice 'PASS: laboratory catalogue is guidance, not commerce (% bundles, % screens)',
    (select count(*) from public.panel_bundles),
    (select count(*) from public.screen_types where guidance_only);
end $$;

commit;
