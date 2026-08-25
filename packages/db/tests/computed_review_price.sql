-- Per-patient computed review pricing (20260821190935).
--
-- Proves the three things the founder actually decided on 2026-08-21:
--   * a review is priced from the tests THAT patient is getting, so a woman
--     is never charged for the prostate check nor a man for cervical
--     screening (the confirmed overcharge in the flat-bundle price);
--   * it comes out as ONE number;
--   * and the canonical "delivered set" that pricing reads is the SAME one
--     order-completeness reads — except for the single deliberate difference
--     around a PSA line still awaiting its shared-decision conversation,
--     which is asserted here in both directions so a later refactor cannot
--     quietly collapse it.
--
-- Run inside a single transaction and ROLLED BACK. Every negative is paired
-- with a positive control, because a check that only ever proves "nothing
-- happened" passes just as happily against a completely broken system.
--
-- To re-run:
--   npx supabase db query --linked -f packages/db/tests/computed_review_price.sql
--
-- Reuses the same three real patient fixtures as
-- packages/db/tests/screening_ladder_order_completeness.sql -- one with
-- sex=null (~41), one male (~66), one female (~71) -- swap the ids below if
-- any stops existing.

begin;

create temporary table test_results (case_name text, passed boolean, detail text) on commit drop;

do $$
declare
  v_patient uuid := 'bb707ae8-1d0b-49c2-b990-1950de601db4'; -- sex null, age ~41
  v_male    uuid := '04280ae6-f1bd-4fc9-a588-fac792e032af'; -- male, age ~66
  v_female  uuid := '365067dc-7c0f-45e8-a807-8cd70f2da8dd'; -- female, age ~71
  v_org     uuid := '00000000-0000-0000-0000-000000000001';
  v_comp    uuid;
  v_core    uuid;
  v_male_price   jsonb;
  v_female_price jsonb;
  v_before jsonb;
  v_after  jsonb;
  v_order  uuid;
  v_delivered text[];
  v_year int := extract(year from (now() at time zone 'Africa/Lagos'))::int;
begin
  select id into v_comp from public.panel_bundles where code = 'screen_comprehensive';
  select id into v_core from public.panel_bundles where code = 'screen_core';

  delete from public.annual_health_checks
   where patient_id in (v_patient, v_male, v_female) and year = v_year;

  -- -----------------------------------------------------------------------
  -- 1. The delivered set is sex-aware in both directions.
  -- -----------------------------------------------------------------------
  v_delivered := private.patient_delivered_test_codes(
    v_female, v_org, (select test_codes from public.panel_bundles where id = v_comp));

  insert into test_results select 'p1_female_review_has_no_prostate_lines',
    not (v_delivered && array['psa', 'prostate_ultrasound']),
    array_to_string(v_delivered, ',');

  insert into test_results select 'p1b_female_review_does_include_her_own_screens',
    v_delivered @> array['breast_imaging'],
    null;

  -- Age gating is live too, and this fixture is the case that proves it:
  -- she is ~71 and screen_types.cervical_smear.age_to is 64, so cervical
  -- screening is correctly NOT in her review and correctly not billed to
  -- her. (A woman aged 25-64 would have it; this assertion deliberately
  -- pins the boundary rather than the happy path.)
  insert into test_results select 'p1c_age_gated_line_is_excluded_at_the_boundary',
    not (v_delivered && array['cervical_smear'])
    and (select age_to = 64 from public.screen_types where code = 'cervical_smear'),
    null;

  v_delivered := private.patient_delivered_test_codes(
    v_male, v_org, (select test_codes from public.panel_bundles where id = v_comp));

  insert into test_results select 'p2_male_review_has_no_cervical_or_breast_lines',
    not (v_delivered && array['cervical_smear', 'breast_imaging']),
    array_to_string(v_delivered, ',');

  insert into test_results select 'p2b_male_review_does_include_psa',
    v_delivered @> array['psa'],
    null;

  -- -----------------------------------------------------------------------
  -- 2. The price follows the delivered set, and is one number.
  -- -----------------------------------------------------------------------
  v_male_price   := private.compute_review_price(v_male,   v_org, v_comp);
  v_female_price := private.compute_review_price(v_female, v_org, v_comp);

  insert into test_results select 'p3_price_is_a_single_number',
    jsonb_typeof(v_male_price -> 'total_kobo') = 'number'
      and (v_male_price ->> 'total_kobo')::bigint > 0,
    v_male_price ->> 'total_kobo';

  insert into test_results select 'p4_man_and_woman_are_priced_differently',
    (v_male_price ->> 'total_kobo') is distinct from (v_female_price ->> 'total_kobo'),
    (v_male_price ->> 'total_kobo') || ' vs ' || (v_female_price ->> 'total_kobo');

  -- The actual overcharge, stated as a price rather than as a test list:
  -- neither total may contain the other sex's line.
  insert into test_results select 'p5_no_cross_sex_line_in_either_price',
    not exists (
      select 1 from jsonb_array_elements(v_male_price -> 'lines') l
       where l ->> 'code' in ('cervical_smear', 'breast_imaging'))
    and not exists (
      select 1 from jsonb_array_elements(v_female_price -> 'lines') l
       where l ->> 'code' in ('psa', 'prostate_ultrasound')),
    null;

  -- Positive control for p5: the flat bundle price -- what the platform
  -- charged before this migration -- is genuinely the same for both, which
  -- is exactly the bug. If this control ever fails, p5 is passing for the
  -- wrong reason.
  insert into test_results select 'p5_control_flat_price_was_sex_blind',
    (v_male_price ->> 'headline_price_kobo') = (v_female_price ->> 'headline_price_kobo'),
    null;

  -- -----------------------------------------------------------------------
  -- 3. Year two costs less than year one: the lifetime-once items drop out
  --    of the delivered set once they are on file, so they stop being
  --    billed. This is the "month 13 costs less than month 1" promise.
  -- -----------------------------------------------------------------------
  v_before := private.compute_review_price(v_female, v_org, v_core);

  insert into public.screening_results (organisation_id, patient_id, screen_type_code, result_status)
  values (v_org, v_female, 'blood_group', 'normal'),
         (v_org, v_female, 'sickle_cell_genotype', 'normal');

  v_after := private.compute_review_price(v_female, v_org, v_core);

  insert into test_results select 'p6_second_year_review_costs_less',
    (v_after ->> 'total_kobo')::bigint < (v_before ->> 'total_kobo')::bigint,
    (v_before ->> 'total_kobo') || ' -> ' || (v_after ->> 'total_kobo');

  insert into test_results select 'p6b_lifetime_items_gone_from_the_lines',
    not exists (
      select 1 from jsonb_array_elements(v_after -> 'lines') l
       where l ->> 'code' in ('blood_group', 'sickle_cell_genotype')),
    null;

  -- -----------------------------------------------------------------------
  -- 4. A PSA line awaiting its shared-decision conversation is a GATE, not
  --    an exclusion. It stays required for completeness and stays in the
  --    price. This is the one place the two callers deliberately agree to
  --    keep a code that compute_screening_order_exclusions reports.
  -- -----------------------------------------------------------------------
  insert into test_results select 'p7_psa_priced_even_before_the_sdm_conversation',
    exists (select 1 from jsonb_array_elements(v_male_price -> 'lines') l
             where l ->> 'code' = 'psa')
    and not exists (select 1 from public.patient_shared_decisions
                     where patient_id = v_male and screen_type_code = 'psa'),
    null;

  insert into public.lab_orders
    (organisation_id, patient_id, panel_bundle_id, status, total_kobo, origin, investigation_tier)
  values (v_org, v_male, v_comp, 'ordered', 0, 'patient_initiated', 1)
  returning id into v_order;

  insert into public.screening_results (organisation_id, patient_id, lab_order_id, screen_type_code, result_status)
  values
    (v_org, v_male, v_order, 'hba1c', 'normal'),
    (v_org, v_male, v_order, 'lipid_panel', 'normal'),
    (v_org, v_male, v_order, 'fbc', 'normal'),
    (v_org, v_male, v_order, 'lft', 'normal'),
    (v_org, v_male, v_order, 'kft', 'normal'),
    (v_org, v_male, v_order, 'tft', 'normal'),
    (v_org, v_male, v_order, 'urinalysis', 'normal'),
    (v_org, v_male, v_order, 'hiv', 'normal'),
    (v_org, v_male, v_order, 'hep_b', 'normal'),
    (v_org, v_male, v_order, 'hep_c', 'normal'),
    (v_org, v_male, v_order, 'urine_acr', 'normal'),
    (v_org, v_male, v_order, 'ogtt_fpg', 'normal'),
    (v_org, v_male, v_order, 'ecg_resting', 'normal'),
    (v_org, v_male, v_order, 'fit', 'normal'),
    (v_org, v_male, v_order, 'syphilis', 'normal'),
    (v_org, v_male, v_order, 'blood_group', 'normal'),
    (v_org, v_male, v_order, 'sickle_cell_genotype', 'normal'),
    (v_org, v_male, v_order, 'abdominal_ultrasound', 'normal'),
    (v_org, v_male, v_order, 'prostate_ultrasound', 'normal'),
    (v_org, v_male, v_order, 'ferritin', 'normal'),
    (v_org, v_male, v_order, 'vitamin_b12', 'normal');

  insert into test_results select 'p8_order_stays_open_while_psa_awaits_its_conversation',
    (select status = 'ordered' from public.lab_orders where id = v_order),
    (select status::text from public.lab_orders where id = v_order);

  insert into public.patient_shared_decisions (organisation_id, patient_id, screen_type_code, notes)
  values (v_org, v_male, 'psa', 'computed_review_price test fixture');

  insert into public.screening_results (organisation_id, patient_id, lab_order_id, screen_type_code, result_status)
  values (v_org, v_male, v_order, 'psa', 'normal');

  insert into test_results select 'p8b_control_order_resolves_once_psa_is_in',
    (select status = 'resulted' from public.lab_orders where id = v_order),
    (select status::text from public.lab_orders where id = v_order);

  -- -----------------------------------------------------------------------
  -- 5. A review containing nothing for this patient is refused, not sold
  --    for zero. single_cervical_smear against a male patient is the real
  --    shape of this: every line excluded on sex.
  -- -----------------------------------------------------------------------
  insert into test_results select 'p9_empty_review_is_not_priceable',
    (private.compute_review_price(
       v_female, v_org,
       (select id from public.panel_bundles where code = 'single_psa')
     ) ->> 'priceable')::boolean = false,
    null;

  insert into test_results select 'p9_control_same_review_is_priceable_for_a_man',
    (private.compute_review_price(
       v_male, v_org,
       (select id from public.panel_bundles where code = 'single_psa')
     ) ->> 'priceable')::boolean = true,
    null;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Order-level: a self-arranged order is still not billed at all, and a
--    partner order carries the computed number rather than the flat one.
-- ---------------------------------------------------------------------------
do $$
declare
  v_female uuid := '365067dc-7c0f-45e8-a807-8cd70f2da8dd';
  v_org    uuid := '00000000-0000-0000-0000-000000000001';
  v_core   uuid;
  v_order  uuid;
  v_computed bigint;
  v_headline bigint;
  v_actual   bigint;
  v_state    text;
begin
  select id, price_kobo into v_core, v_headline
    from public.panel_bundles where code = 'screen_core';

  insert into public.lab_orders
    (organisation_id, patient_id, panel_bundle_id, status, total_kobo, origin, investigation_tier)
  values (v_org, v_female, v_core, 'ordered', 0, 'patient_initiated', 1)
  returning id into v_order;

  insert into test_results select 'p10_self_arranged_order_still_costs_nothing',
    (select total_kobo = 0 from public.lab_orders where id = v_order),
    null;

  v_computed := (private.compute_review_price(v_female, v_org, v_core) ->> 'total_kobo')::bigint;

  -- Partner fulfilment is region-gated and dormant everywhere today
  -- (private.enforce_lab_order_region -> public.region_service_available:
  -- zero active lab_providers, zero active lab facilities). That gate is
  -- correct and is left alone -- it is switched on here, inside the rolled-
  -- back transaction only, so the pricing trigger can actually be reached.
  -- Without this the partner branch is unreachable and would silently go
  -- untested.
  select state into v_state from public.profiles where id = v_female;
  update public.service_regions set is_active = true where state = v_state;
  if not found then
    insert into public.service_regions (state, is_active) values (v_state, true);
  end if;
  update public.lab_providers set is_active = true, regions = array[v_state]
   where name = 'Synlab Nigeria';

  begin
    insert into public.lab_orders
      (organisation_id, patient_id, panel_bundle_id, status, total_kobo, origin,
       investigation_tier, fulfilment)
    values (v_org, v_female, v_core, 'ordered', 9999999, 'patient_initiated', 1, 'partner')
    returning id into v_order;

    select total_kobo into v_actual from public.lab_orders where id = v_order;

    -- The caller handed in a junk price on purpose: no caller anywhere gets
    -- to price a review.
    insert into test_results select 'p11_partner_order_is_priced_by_the_engine_not_the_caller',
      v_actual = v_computed,
      v_actual || ' (computed ' || v_computed || ', caller said 9999999)';

    insert into test_results select 'p11b_and_that_is_not_the_flat_bundle_price',
      v_actual is distinct from v_headline,
      v_actual || ' vs flat ' || v_headline;
  exception when others then
    insert into test_results select 'p11_partner_order_is_priced_by_the_engine_not_the_caller',
      false, 'insert rejected: ' || sqlerrm;
  end;
end $$;

select case_name, passed, detail from test_results order by case_name;

select count(*) filter (where not passed) as failures,
       count(*) as total
from test_results;

rollback;
