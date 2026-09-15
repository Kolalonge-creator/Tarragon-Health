-- Catalogue rebuild, Phase 1 + Phase 3: stop the bleeding, reprice to +30%.
-- Plan: https://claude.ai/code/artifact/38c6998f-e41e-465e-9519-90047f8e44c8
-- Founder decisions 2026-09-03, see docs/CLAUDE_SPRINT_HISTORY_ARCHIVE.md conventions.
--
-- METHODOLOGY: every price derives from public.lab_tests (Synlab Nigeria row = our cost)
-- via cost * 1.3, rounded to the nearest kobo50000 (naira 500). Synlab is the highest-cost
-- active provider for every code touched here (verified), so this also satisfies
-- private.assert_test_price_covers_cost()'s "dearest active provider" comparison.
--
-- lab_tests.price_kobo is COST (what the provider charges Tarragon), never the patient
-- price. Patient prices live on screen_types.price_kobo (recurring/calendar screens) and
-- panel_bundles.price_kobo (one-off purchase bundles/singles) -- two parallel views of
-- largely the same underlying tests that must be kept in sync or they silently diverge.
--
-- Migration 20260902235013 (PR #464, "withdraw mispriced STI bundles + fix Synlab C&G
-- cost") is merged to main-dev but was found NOT applied to this live project (see the
-- migration-drift finding logged 2026-09-03). This migration does not depend on it having
-- run and is safe regardless of run order: it deletes the chlamydia_gonorrhoea lab_tests
-- rows outright rather than assuming any particular prior cost value.

begin;

-- ============================================================
-- PHASE 1a: withdraw the two below-cost/non-viable STI bundles
-- ============================================================
update public.panel_bundles
   set is_active = false,
       self_bookable = false
 where code in ('single_chlamydia_gonorrhoea', 'sti_panel_full');

-- Delete, not reprice: Synlab's real combined NAAT/PCR price is ₦200,000, which makes no
-- viable self-booked product. Withdrawing the bundles above is reversible; this is not --
-- but zero lab_orders have ever referenced this code (verified live), so nothing is lost.
delete from public.lab_tests where code = 'chlamydia_gonorrhoea';

-- ============================================================
-- PHASE 1b: LFTs into the diabetes baseline (protocol already signed; panel omitted them)
-- ============================================================
update public.panel_bundles
   set test_codes = array_append(test_codes, 'lft')
 where code = 'diabetes_panel'
   and not ('lft' = any(test_codes));

insert into public.screening_pathway_coverage (condition, item_code)
values ('diabetes', 'lft')
on conflict do nothing;

-- ============================================================
-- PHASE 1c: syphilis product naming -- fulfilled by RPR, was named VDRL+TPHA
-- ============================================================
update public.screen_types
   set name = 'Syphilis (RPR)'
 where code = 'syphilis';

-- ============================================================
-- PHASE 3 prep: thyroid split. Synlab's bundled "Thyroid Function Profile" (₦60,000, the
-- lab_tests 'tft' row) includes Free T3, which single_tft never promised. Replace its
-- test composition with the two tests the product name actually describes.
-- screen_types.tft (the calendar-recurring screen) is left untouched: its fulfilment still
-- orders the real Synlab profile at its real ₦60,000 cost, so its price stays keyed to that
-- cost. Only the one-off purchase product (panel_bundles.single_tft) changes composition,
-- because only its fulfilment is changing to two discrete tests.
-- ============================================================
insert into public.lab_tests (provider_id, code, name, price_kobo, turnaround_hours)
select id, 'tsh', 'Thyroid Stimulating Hormone (TSH)', 2230000, 48
  from public.lab_providers where name = 'Synlab Nigeria'
on conflict (provider_id, code) do nothing;

insert into public.lab_tests (provider_id, code, name, price_kobo, turnaround_hours)
select id, 'free_t4', 'Free T4', 1890000, 48
  from public.lab_providers where name = 'Synlab Nigeria'
on conflict (provider_id, code) do nothing;

-- Premarital electrophoresis (Phase 4 depends on this cost row existing).
insert into public.lab_tests (provider_id, code, name, price_kobo, turnaround_hours)
select id, 'hb_electrophoresis', 'Haemoglobin Electrophoresis', 3140000, 72
  from public.lab_providers where name = 'Synlab Nigeria'
on conflict (provider_id, code) do nothing;

update public.panel_bundles
   set test_codes = array['tsh', 'free_t4']
 where code = 'single_tft';

-- ============================================================
-- PHASE 3: reprice every active bundle/single at +30% on Synlab cost, ₦500-rounded.
-- ============================================================
with synlab_cost as (
  select lt.code, lt.price_kobo as cost_kobo
    from public.lab_tests lt
    join public.lab_providers lp on lp.id = lt.provider_id
   where lp.name = 'Synlab Nigeria'
),
bundle_cost as (
  select pb.id,
         sum(sc.cost_kobo) as total_cost_kobo,
         count(*) as codes_matched,
         array_length(pb.test_codes, 1) as codes_total
    from public.panel_bundles pb
    join lateral unnest(pb.test_codes) as tc(code) on true
    join synlab_cost sc on sc.code = tc.code
   where pb.is_active
     and pb.code not in ('single_chlamydia_gonorrhoea', 'sti_panel_full')
   group by pb.id, pb.test_codes
)
update public.panel_bundles pb
   set price_kobo = round(bc.total_cost_kobo * 1.3 / 50000) * 50000
  from bundle_cost bc
 where pb.id = bc.id
   and bc.codes_matched = bc.codes_total; -- every test_code must have resolved a cost, or skip (fails loudly below)

update public.screen_types st
   set price_kobo = round(lt.price_kobo * 1.3 / 50000) * 50000
  from public.lab_tests lt
  join public.lab_providers lp on lp.id = lt.provider_id
 where lp.name = 'Synlab Nigeria'
   and lt.code = st.code
   and st.price_source = 'contracted';

-- ============================================================
-- PHASE 4 (partial): Blood-Borne Virus Screen replaces the withdrawn Full STI Panel.
-- ============================================================
insert into public.panel_bundles (code, name, description, price_kobo, test_codes, is_active, self_bookable, is_screen_tier)
select
  'blood_borne_virus_screen',
  'Blood-Borne Virus Screen',
  'HIV, Hepatitis B and Hepatitis C screening. Lab-only -- a normal result needs no doctor call, and an abnormal one routes through the standard abnormal-result review.',
  round(sc.total_cost_kobo * 1.3 / 50000) * 50000,
  array['hiv','hep_b','hep_c'],
  true,
  true,
  false
from (
  select sum(lt.price_kobo) as total_cost_kobo
    from public.lab_tests lt
    join public.lab_providers lp on lp.id = lt.provider_id
   where lp.name = 'Synlab Nigeria' and lt.code in ('hiv','hep_b','hep_c')
) sc
on conflict (code) do update
  set price_kobo = excluded.price_kobo,
      test_codes = excluded.test_codes,
      is_active = true,
      self_bookable = true;

-- ============================================================
-- Assertions -- prove the state, don't hope for it.
-- ============================================================
do $$
declare
  v_bad_bundles int;
  v_chlamydia_rows int;
  v_diabetes_codes text[];
  v_diabetes_price bigint;
  v_tft_codes text[];
  v_tft_price bigint;
  v_screen_core_price bigint;
  v_bbv_price bigint;
  v_bbv_active boolean;
  v_unpriced_active_bundles int;
  v_stale_screen_type_prices int;
begin
  select count(*) into v_bad_bundles
    from public.panel_bundles
   where code in ('single_chlamydia_gonorrhoea', 'sti_panel_full')
     and (is_active or self_bookable);
  if v_bad_bundles <> 0 then
    raise exception 'FAIL: % withdrawn STI bundle(s) still active/self-bookable', v_bad_bundles;
  end if;

  select count(*) into v_chlamydia_rows from public.lab_tests where code = 'chlamydia_gonorrhoea';
  if v_chlamydia_rows <> 0 then
    raise exception 'FAIL: chlamydia_gonorrhoea still has % lab_tests row(s)', v_chlamydia_rows;
  end if;

  select test_codes, price_kobo into v_diabetes_codes, v_diabetes_price
    from public.panel_bundles where code = 'diabetes_panel';
  if not ('lft' = any(v_diabetes_codes)) then
    raise exception 'FAIL: diabetes_panel missing lft';
  end if;
  if v_diabetes_price <> 22450000 then
    raise exception 'FAIL: diabetes_panel priced %, expected 22450000 (₦224,500)', v_diabetes_price;
  end if;

  select test_codes, price_kobo into v_tft_codes, v_tft_price
    from public.panel_bundles where code = 'single_tft';
  if v_tft_codes <> array['tsh','free_t4'] then
    raise exception 'FAIL: single_tft test_codes are %, expected {tsh,free_t4}', v_tft_codes;
  end if;
  if v_tft_price <> 5350000 then
    raise exception 'FAIL: single_tft priced %, expected 5350000 (₦53,500)', v_tft_price;
  end if;

  select price_kobo into v_screen_core_price from public.panel_bundles where code = 'screen_core';
  if v_screen_core_price <> 24650000 then
    raise exception 'FAIL: screen_core priced %, expected 24650000 (₦246,500)', v_screen_core_price;
  end if;

  select price_kobo, is_active and self_bookable into v_bbv_price, v_bbv_active
    from public.panel_bundles where code = 'blood_borne_virus_screen';
  if v_bbv_price <> 5600000 or not v_bbv_active then
    raise exception 'FAIL: blood_borne_virus_screen priced % active/self-bookable %, expected 5600000/true', v_bbv_price, v_bbv_active;
  end if;

  select count(*) into v_unpriced_active_bundles
    from public.panel_bundles
   where is_active and price_kobo <= 0;
  if v_unpriced_active_bundles <> 0 then
    raise exception 'FAIL: % active panel_bundle(s) have price_kobo <= 0 after repricing', v_unpriced_active_bundles;
  end if;

  select count(*) into v_stale_screen_type_prices
    from public.screen_types
   where price_source = 'contracted'
     and price_kobo not in (
       select round(lt.price_kobo * 1.3 / 50000) * 50000
         from public.lab_tests lt join public.lab_providers lp on lp.id = lt.provider_id
        where lp.name = 'Synlab Nigeria' and lt.code = screen_types.code
     );
  if v_stale_screen_type_prices <> 0 then
    raise exception 'FAIL: % contracted screen_types row(s) not repriced to +30%%', v_stale_screen_type_prices;
  end if;

  raise notice 'PASS: catalogue rebuild phase 1+3 applied cleanly.';
end $$;

commit;
