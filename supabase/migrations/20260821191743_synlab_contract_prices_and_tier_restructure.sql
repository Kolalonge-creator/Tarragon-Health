-- Synlab is contracted (founder, 2026-08-21). Real prices, and the tier
-- restructure that goes with them.
--
-- Two numbers per test from here on, and they are different things:
--   lab_tests.price_kobo    — what SYNLAB charges TARRAGON. Our cost. Money
--                             we owe them, not money we earn.
--   screen_types.price_kobo — what the PATIENT pays Tarragon. Cost plus
--                             margin, rounded to a figure a person can read.
-- The gap between them is the only revenue Tarragon takes on a test, and from
-- the collection migration onwards it is the only part of a payment posted as
-- income — the rest is a liability until Synlab is settled.
--
-- ARITHMETIC CHECK BEFORE USING THESE NUMBERS
-- -------------------------------------------
-- Every total in the founder's price list reproduces exactly from its own line
-- prices, except one:
--   Know Your Basics   cost 65,500 ok    patient 78,500 ok
--   Core Screen        cost 189,800 ok   patient 227,500, stated as 228,000
-- The line prices are authoritative rather than that total, and the founder's
-- own affordability table proves it: their year-2 figure of 421,500 is
-- 227,500 + 194,000 (Core + FIT), and their year-1 figure of 624,000 is
-- 78,500 + 227,500 + 194,000 + 72,000 + 52,000. Both reproduce to the naira
-- using 227,500. So 228,000 is a rounding slip in one total cell, not a price,
-- and Core Screen is priced here at the sum of its lines.
--
-- TWO PRICES ARE DERIVED, NOT QUOTED
-- ----------------------------------
-- urine_acr and ogtt_fpg never got their own row in the list; they appear only
-- inside the Hypertension and Diabetes panel totals. Solving those two panels
-- simultaneously gives urine_acr 19,300/23,000 and ogtt_fpg 13,300/16,000, and
-- both land inside the same 18-21% margin band as every quoted test, which is
-- good evidence the solution is right. They are marked
-- price_source = 'derived_from_panel_total' so they can be found and corrected
-- in one query the moment Synlab quotes them directly.
--
-- WHAT THE RESTRUCTURE ACTUALLY CHANGES
-- -------------------------------------
-- The old Core/Advanced/Comprehensive ladder charged a patient every year for
-- things that only need doing once or every few years. The new shape is:
--   Know Your Basics  — blood group, genotype, hep B, hep C. Once, ever.
--   Core Screen       — a true annual: LFT, KFT, HbA1c, lipids, urinalysis,
--                       FBC, HIV.
--   Periodic add-ons  — each on its own cadence, bought when due.
--   Condition panels  — hypertension and diabetes, triggered by diagnosis.
-- Advanced and Comprehensive go dormant: they are the thing being replaced.
-- Zero-row change (live before writing this: 1 lab_order, 0 screening_results),
-- so this is structural, not a data migration.

-- ---------------------------------------------------------------------------
-- 1. Two more hardcoded lists become data.
--
-- Same failure mode as the dormant array retired in the pricing migration: a
-- literal list of codes inside a function body that every future change has to
-- find and edit in lockstep. Retiring Advanced/Comprehensive and adding Know
-- Your Basics would have silently broken both of them.
-- ---------------------------------------------------------------------------
alter table public.screen_types
  add column if not exists once_per_lifetime boolean not null default false,
  add column if not exists is_optional       boolean not null default false,
  add column if not exists clinical_basis    text;

comment on column public.screen_types.once_per_lifetime is
  'Never re-sold once a result is on file. Replaces the hardcoded array in private.compute_screening_order_exclusions. Founder decision 2026-08-21 extends this beyond blood group and genotype to hepatitis B and C, as the "Know Your Basics, once, ever" tier.';
comment on column public.screen_types.is_optional is
  'Offered when due, never assumed. The patient opts in rather than finding it already inside their review.';
comment on column public.screen_types.clinical_basis is
  'Shown in patient-facing copy where the honest answer about WHY an item is offered is not "a guideline says so". Null means the ordinary evidence-based case applies and no caveat is needed.';

alter table public.panel_bundles
  add column if not exists is_screen_tier boolean not null default false;

comment on column public.panel_bundles.is_screen_tier is
  'A bundled review rather than a single item, so it gets exclusion annotation and the subscriber discount. Replaces the literal code list ("screen_core", "screen_advanced", "screen_comprehensive") hardcoded inside two trigger functions, which would have gone stale the moment the tiers were renamed.';

update public.screen_types set once_per_lifetime = true
 where code in ('blood_group', 'sickle_cell_genotype', 'hep_b', 'hep_c');

update public.screen_types set is_optional = true
 where code in ('psa', 'tft', 'vitamin_b12', 'ferritin', 'syphilis');

-- The founder's own note, kept as product copy rather than softened:
-- "No guideline mandates this at all - it's a market-expectation item, not
--  evidence-based. Worth saying so plainly in the product copy rather than
--  implying a clinical basis that doesn't exist."
update public.screen_types
   set clinical_basis = 'No screening guideline recommends routine thyroid testing for someone without symptoms. It is offered because people expect it, not because the evidence supports it. Skipping it is a reasonable choice and changes nothing else about your care.'
 where code = 'tft';

-- ---------------------------------------------------------------------------
-- 2. Cadences, corrected to the restructure.
-- ---------------------------------------------------------------------------
update public.screen_types set frequency_months = 12 where code = 'fit';             -- annual, 45-74
update public.screen_types set frequency_months = 36 where code = 'tft';             -- every 3 years
update public.screen_types set age_to = 65           where code = 'cervical_smear';  -- women 25-65

-- ---------------------------------------------------------------------------
-- 3. What Synlab charges Tarragon.
--
-- Replaces the placeholder rows seeded by 20260730222039 for every provider.
-- The other three providers' rows are left exactly as they are: they are still
-- placeholders and are still inactive, and pretending otherwise by deleting
-- them would hide that fact rather than record it.
-- ---------------------------------------------------------------------------
comment on column public.lab_tests.price_kobo is
  'What this provider charges TARRAGON for this test - our cost, not the patient price. The patient price lives on screen_types.price_kobo; the difference is Tarragon''s entire margin on a test, and is the only part of a payment recognised as revenue.';

insert into public.lab_tests (provider_id, code, name, price_kobo, turnaround_hours)
select p.id, t.code, t.name, t.price_kobo, t.turnaround_hours
from public.lab_providers p
join (values
  ('blood_group',          'Blood Group & Rhesus Factor',      1270000::bigint, 24),
  ('sickle_cell_genotype', 'Sickle Cell Genotype',             1850000::bigint, 24),
  ('hep_b',                'Hepatitis B Surface Antigen (STAT)',1530000::bigint, 24),
  ('hep_c',                'Hepatitis C (STAT)',               1900000::bigint, 24),
  ('lft',                  'Liver Function Test',              5040000::bigint, 48),
  ('kft',                  'Kidney Function Test',             3360000::bigint, 48),
  ('hba1c',                'HbA1c',                            3760000::bigint, 48),
  ('lipid_panel',          'Lipid Panel',                      3160000::bigint, 48),
  ('urinalysis',           'Urinalysis',                       1430000::bigint, 24),
  ('fbc',                  'Full Blood Count',                 1340000::bigint, 24),
  ('hiv',                  'HIV (STAT)',                        890000::bigint, 24),
  ('fit',                  'Faecal Immunochemical Test',      16160000::bigint, 96),
  ('tft',                  'Thyroid Function Test',            6000000::bigint, 48),
  ('psa',                  'Prostate-Specific Antigen',        4320000::bigint, 72),
  ('cervical_smear',       'Cervical Smear (LBC)',             4000000::bigint, 96),
  ('vitamin_b12',          'Vitamin B12',                      3550000::bigint, 72),
  ('ferritin',             'Ferritin',                         2400000::bigint, 72),
  ('syphilis',             'Syphilis (RPR)',                   1770000::bigint, 48),
  ('urine_acr',            'Urine Albumin:Creatinine Ratio',   1930000::bigint, 48),
  ('ogtt_fpg',             'Oral Glucose Tolerance Test',      1330000::bigint, 48)
) as t(code, name, price_kobo, turnaround_hours) on true
where p.name = 'Synlab Nigeria'
on conflict (provider_id, code) do update
  set price_kobo       = excluded.price_kobo,
      name             = excluded.name,
      turnaround_hours = excluded.turnaround_hours;

-- commission_rate is meaningless under this model and is cleared rather than
-- left holding a number nothing reads. Tarragon does not take a commission on
-- a Synlab test; it buys the test at cost and sells the review at a margin.
update public.lab_tests lt
   set commission_rate = null
  from public.lab_providers p
 where p.id = lt.provider_id and p.name = 'Synlab Nigeria';

-- Synlab's price list is now EXACTLY the contracted list, and nothing else.
--
-- This migration's own margin assertion caught why that matters: the seed had
-- left Synlab a resting-ECG row at 6,000 that is not in the signed price list,
-- and the earlier pricing migration had derived the PATIENT price for
-- ecg_resting from it — giving a test Tarragon would have sold at exactly what
-- it cost, zero margin, without anything flagging it. A stale row is worse
-- than a missing one: private.compute_partner_cost would happily quote a cost
-- the laboratory never agreed to, and the first anyone would know is an
-- invoice that does not match.
delete from public.lab_tests lt
 using public.lab_providers p
 where p.id = lt.provider_id
   and p.name = 'Synlab Nigeria'
   and lt.code not in (
     'blood_group', 'sickle_cell_genotype', 'hep_b', 'hep_c', 'lft', 'kft', 'hba1c',
     'lipid_panel', 'urinalysis', 'fbc', 'hiv', 'fit', 'tft', 'psa', 'cervical_smear',
     'vitamin_b12', 'ferritin', 'syphilis', 'urine_acr', 'ogtt_fpg');

-- And any patient price whose only basis was a placeholder provider's row goes
-- back to unpriced rather than pretending to be a contracted number. Unpriced
-- is a state the engine already handles safely — it refuses to bill a review
-- containing the test and says which one — whereas a number with nothing
-- behind it is exactly the failure this whole layer exists to prevent.
update public.screen_types st
   set price_kobo = null, price_source = null
 where st.price_source = 'lab_price_list'
   and not exists (
     select 1 from public.lab_tests lt
     join public.lab_providers p on p.id = lt.provider_id
     where lt.code = st.code and p.name = 'Synlab Nigeria');

-- ---------------------------------------------------------------------------
-- 4. What the patient pays.
-- ---------------------------------------------------------------------------
update public.screen_types st
   set price_kobo   = v.price_kobo,
       price_source = v.src::public.screen_price_source
  from (values
    ('blood_group',          1500000::bigint, 'contracted'),
    ('sickle_cell_genotype', 2200000::bigint, 'contracted'),
    ('hep_b',                1850000::bigint, 'contracted'),
    ('hep_c',                2300000::bigint, 'contracted'),
    ('lft',                  6050000::bigint, 'contracted'),
    ('kft',                  4050000::bigint, 'contracted'),
    ('hba1c',                4500000::bigint, 'contracted'),
    ('lipid_panel',          3800000::bigint, 'contracted'),
    ('urinalysis',           1700000::bigint, 'contracted'),
    ('fbc',                  1600000::bigint, 'contracted'),
    ('hiv',                  1050000::bigint, 'contracted'),
    ('fit',                 19400000::bigint, 'contracted'),
    ('tft',                  7200000::bigint, 'contracted'),
    ('psa',                  5200000::bigint, 'contracted'),
    ('cervical_smear',       4800000::bigint, 'contracted'),
    ('vitamin_b12',          4250000::bigint, 'contracted'),
    ('ferritin',             2900000::bigint, 'contracted'),
    ('syphilis',             2100000::bigint, 'contracted'),
    ('urine_acr',            2300000::bigint, 'derived_from_panel_total'),
    ('ogtt_fpg',             1600000::bigint, 'derived_from_panel_total')
  ) as v(code, price_kobo, src)
 where v.code = st.code;

-- ---------------------------------------------------------------------------
-- 5. The tiers.
-- ---------------------------------------------------------------------------
insert into public.panel_bundles (code, name, description, price_kobo, test_codes, self_bookable, is_screen_tier)
values (
  'know_your_basics',
  'Know Your Basics',
  'Blood group, genotype and hepatitis B and C. Facts about your body that do not change, so you do these once and they stay on your record for life. You will never be asked to pay for them again.',
  7850000,
  array['blood_group', 'sickle_cell_genotype', 'hep_b', 'hep_c'],
  true,
  true
)
on conflict (code) do update
  set name          = excluded.name,
      description   = excluded.description,
      price_kobo    = excluded.price_kobo,
      test_codes    = excluded.test_codes,
      self_bookable = excluded.self_bookable,
      is_screen_tier= excluded.is_screen_tier,
      is_active     = true;

update public.panel_bundles
   set name        = 'Core Screen',
       description = 'Your once-a-year look at the things worth checking every year: liver, kidneys, blood sugar, cholesterol, urine, blood count and HIV status. A doctor reads every result with you, including the all-clear ones.',
       test_codes  = array['lft', 'kft', 'hba1c', 'lipid_panel', 'urinalysis', 'fbc', 'hiv'],
       is_screen_tier = true,
       is_active   = true
 where code = 'screen_core';

-- Advanced and Comprehensive are the thing being replaced, not a thing being
-- kept alongside. Deactivated rather than deleted: the rows carry order
-- history shape and a `drop` would need a data migration to say the same
-- thing. Zero live orders reference either.
update public.panel_bundles set is_active = false
 where code in ('screen_advanced', 'screen_comprehensive');

update public.panel_bundles
   set test_codes = array['hba1c', 'lipid_panel', 'kft', 'urinalysis', 'urine_acr', 'ogtt_fpg'],
       description = 'The work-up for someone already living with high blood pressure: blood sugar, cholesterol, kidney function, urine, the kidney protein check, and a glucose tolerance test.'
 where code = 'hypertension_panel';

-- The founder's own note: this panel's contents had drifted from its own
-- description, which promised a kidney protein check the test_codes did not
-- contain. Fixed to match what it says it is.
update public.panel_bundles
   set test_codes = array['hba1c', 'lipid_panel', 'kft', 'urine_acr'],
       description = 'The work-up for someone already living with diabetes: blood sugar, cholesterol, kidney function and the kidney protein check.'
 where code = 'diabetes_panel';

-- Periodic add-ons: each is bought on its own cadence when it comes due, which
-- is the whole point of the restructure. A one-test bundle is how this schema
-- represents a single orderable item (lab_orders has no per-test junction).
insert into public.panel_bundles (code, name, description, price_kobo, test_codes, self_bookable)
values
  ('single_fit',          'Bowel Screening (FIT)', 'A home sample that checks for hidden blood in stool. Recommended every year between 45 and 74.', 19400000, array['fit'], true),
  ('single_tft',          'Thyroid Function Test', 'Checks how your thyroid is working.', 7200000, array['tft'], true),
  ('single_vitamin_b12',  'Vitamin B12',           'Checks your B12 level.', 4250000, array['vitamin_b12'], true),
  ('single_ferritin',     'Ferritin (iron stores)','Checks your iron stores, which a normal blood count can still miss.', 2900000, array['ferritin'], true),
  ('single_syphilis',     'Syphilis Screening',    'A routine sexual-health check.', 2100000, array['syphilis'], true),
  ('single_urine_acr',    'Kidney Protein Check',  'Looks for small amounts of protein leaking into urine - the earliest sign that blood pressure or diabetes is affecting the kidneys.', 2300000, array['urine_acr'], false),
  ('single_kft',          'Kidney Function Test',  'Checks how well your kidneys are filtering.', 4050000, array['kft'], false),
  ('single_lft',          'Liver Function Test',   'Checks how your liver is working.', 6050000, array['lft'], false),
  ('single_fbc',          'Full Blood Count',      'A general look at your blood cells.', 1600000, array['fbc'], false),
  ('single_urinalysis',   'Urinalysis',            'A general urine test.', 1700000, array['urinalysis'], false),
  ('single_ogtt_fpg',     'Glucose Tolerance Test','Measures how your body handles sugar over a couple of hours.', 1600000, array['ogtt_fpg'], false)
on conflict (code) do update
  set name          = excluded.name,
      description   = excluded.description,
      price_kobo    = excluded.price_kobo,
      test_codes    = excluded.test_codes,
      self_bookable = excluded.self_bookable,
      is_active     = true;

-- ---------------------------------------------------------------------------
-- 6. Every active bundle is priced at exactly the sum of its own lines.
--
-- Which retires the review discount rather than recalibrating it: the
-- founder's price list has no bundle discount in it, so review_discount_bp
-- goes to zero and the patient's number IS the sum of the tests they are
-- getting. Computed rather than typed, so a bundle whose contents change can
-- never keep a stale total.
--
-- This has to run AFTER section 4, or a bundle would be re-priced against the
-- old placeholder test prices.
-- ---------------------------------------------------------------------------
update public.panel_bundles pb
   set price_kobo = coalesce((
         select sum(st.price_kobo)
         from unnest(pb.test_codes) as tc(code)
         join public.screen_types st on st.code = tc.code
         where st.price_kobo is not null and st.fulfilment_dormant = false
       ), pb.price_kobo),
       review_discount_bp = 0
 where pb.is_active;

-- ---------------------------------------------------------------------------
-- 7. The lifetime-once list stops being a literal.
--
-- Supersedes the copy in the recheck-cadence migration. Every reason, branch
-- and ordering is preserved; the only change is that the two hardcoded codes
-- become a lookup on screen_types.once_per_lifetime, which now covers four.
-- Without this, adding hepatitis B and C to "once, ever" would have shown a
-- patient a Know Your Basics tier promising it was never repurchased while the
-- exclusion engine happily let them buy it again.
-- ---------------------------------------------------------------------------
create or replace function private.compute_screening_order_exclusions(
  p_patient_id uuid,
  p_organisation_id uuid,
  p_test_codes text[]
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_code text;
  v_result jsonb := '[]'::jsonb;
  v_hbv public.hbv_status;
  v_hcv public.hcv_status;
  v_hiv public.hiv_status;
  v_has_sdm boolean;
  v_reason text;
  v_owning_condition public.care_plan_condition;
  v_pathway_interval int;
  v_recent boolean;
  v_once boolean;
begin
  select hbv_status, hcv_status, hiv_status
    into v_hbv, v_hcv, v_hiv
    from public.profiles where id = p_patient_id;

  foreach v_code in array p_test_codes loop
    v_reason := null;

    -- Lifetime-once items already on file.
    select coalesce(st.once_per_lifetime, false) into v_once
      from public.screen_types st where st.code = v_code;

    if coalesce(v_once, false) and exists (
      select 1 from public.screening_results sr
      where sr.patient_id = p_patient_id and sr.screen_type_code = v_code
    ) then
      v_reason := 'lifetime_once_on_file';
    end if;

    -- Terminal serology states — never re-test.
    if v_reason is null and v_code = 'hep_b' and v_hbv = 'chronic_hbv' then
      v_reason := 'terminal_serology_state';
    end if;
    if v_reason is null and v_code = 'hep_c' and v_hcv in ('hcv_rna_pending', 'hcv_active') then
      v_reason := 'terminal_serology_state';
    end if;
    if v_reason is null and v_code = 'hiv' and v_hiv = 'hiv_positive' then
      v_reason := 'terminal_serology_state';
    end if;

    -- PSA needs a recorded shared decision before it can be resulted.
    if v_reason is null and v_code = 'psa' then
      select exists (
        select 1 from public.patient_shared_decisions
        where patient_id = p_patient_id and screen_type_code = 'psa'
      ) into v_has_sdm;
      if not v_has_sdm then
        v_reason := 'pending_shared_decision';
      end if;
    end if;

    -- Owned by an active chronic pathway that already covers it recently.
    if v_reason is null then
      select spc.condition into v_owning_condition
        from public.screening_pathway_coverage spc
        join public.care_plans cp
          on cp.condition = spc.condition
         and cp.patient_id = p_patient_id
         and cp.status = 'active'
        where spc.item_code = v_code
        limit 1;

      if v_owning_condition is not null then
        select csc.interval_months into v_pathway_interval
          from public.condition_screen_cadences csc
         where csc.condition = v_owning_condition
           and csc.screen_type_code = v_code
           and csc.control_state = coalesce(
                 private.patient_chronic_control_state(p_patient_id, v_owning_condition),
                 'not_yet_established'
               );

        if v_pathway_interval is null then
          select interval_months into v_pathway_interval
            from public.medication_review_cadences
            where condition = v_owning_condition;
        end if;

        select exists (
          select 1 from public.screening_results sr
          where sr.patient_id = p_patient_id
            and sr.screen_type_code = v_code
            and sr.created_at > now() - make_interval(months => coalesce(v_pathway_interval, 6))
        ) into v_recent;

        if v_recent then
          v_reason := 'owned_by_pathway:' || v_owning_condition::text;
        end if;
      end if;
    end if;

    if v_reason is not null then
      v_result := v_result || jsonb_build_object('item_code', v_code, 'reason', v_reason);
    end if;
  end loop;

  return v_result;
end;
$$;

revoke all on function private.compute_screening_order_exclusions(uuid, uuid, text[]) from public;

-- ---------------------------------------------------------------------------
-- 8. And so do the two bundle-code literals.
--
-- Both of these read `code in ('screen_core','screen_advanced',
-- 'screen_comprehensive')`. After section 5 that list names one live bundle,
-- one that no longer exists under that meaning, and one that is dormant —
-- while Know Your Basics, a real bundled review, was in neither.
-- ---------------------------------------------------------------------------
create or replace function private.annotate_screening_order_exclusions()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_bundle public.panel_bundles%rowtype;
begin
  if new.panel_bundle_id is null then
    return new;
  end if;

  select * into v_bundle from public.panel_bundles where id = new.panel_bundle_id;

  if not coalesce(v_bundle.is_screen_tier, false) then
    return new;
  end if;

  new.excluded_test_codes := private.compute_screening_order_exclusions(
    new.patient_id, new.organisation_id, v_bundle.test_codes
  );

  return new;
end;
$function$;

create or replace function private.apply_screening_subscriber_discount()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_is_tier boolean;
  v_subscribed boolean;
begin
  select is_screen_tier into v_is_tier
    from public.panel_bundles where id = new.panel_bundle_id;

  if not coalesce(v_is_tier, false) then
    return new;
  end if;

  select exists (
    select 1
    from public.subscriptions s
    join public.subscription_plans pl on pl.id = s.plan_id
    where s.subscriber_id = new.patient_id
      and s.status in ('active', 'trialing')
      and pl.code <> 'free'
  ) into v_subscribed;

  if v_subscribed and coalesce(new.subscriber_discount_kobo, 0) = 0 then
    new.subscriber_discount_kobo := round(coalesce(new.total_kobo, 0) * 0.15);
  end if;

  return new;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 9. Never sell a test for less than it costs.
--
-- Two prices in two tables that must move together: editing one without the
-- other is the easiest way to quietly sell a review at a loss, and nothing
-- else in the system would notice — the patient's price would still look like
-- a real number and the order would go through. Guarded on both sides so it
-- cannot happen from either direction.
--
-- Scoped to ACTIVE providers, which is also why it does not fire during this
-- migration: Synlab is not switched on yet. The activation gate is where the
-- whole price list gets checked at once before anything goes live.
-- ---------------------------------------------------------------------------
create or replace function private.assert_test_price_covers_cost()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code     text;
  v_patient  bigint;
  v_cost     bigint;
  v_provider text;
begin
  -- Both tables key a test by `code`, so one trigger function serves both.
  v_code := new.code;

  select st.price_kobo into v_patient
    from public.screen_types st where st.code = v_code;

  select lt.price_kobo, p.name into v_cost, v_provider
    from public.lab_tests lt
    join public.lab_providers p on p.id = lt.provider_id
   where lt.code = v_code and p.is_active
   order by lt.price_kobo desc
   limit 1;

  if v_patient is not null and v_cost is not null and v_patient < v_cost then
    raise exception 'Patient price for % (%) is below what % charges us (%). Tarragon would pay to run this test.',
      v_code, v_patient, v_provider, v_cost
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function private.assert_test_price_covers_cost() from public;

drop trigger if exists screen_types_price_covers_cost on public.screen_types;
create trigger screen_types_price_covers_cost
  after insert or update of price_kobo on public.screen_types
  for each row execute function private.assert_test_price_covers_cost();

drop trigger if exists lab_tests_price_covers_cost on public.lab_tests;
create trigger lab_tests_price_covers_cost
  after insert or update of price_kobo on public.lab_tests
  for each row execute function private.assert_test_price_covers_cost();

-- ---------------------------------------------------------------------------
-- 10. Assertions.
--
-- The founder's price list is treated here as a specification to be met, not
-- as numbers to be typed in and hoped over. Each tier total is re-derived from
-- the individual test prices this migration wrote, so a mistyped line price
-- fails the migration rather than quietly shipping a wrong total.
-- ---------------------------------------------------------------------------
do $$
declare
  v_bad  text;
  v_sum  bigint;
  v_lo   numeric;
  v_hi   numeric;
begin
  -- 10a. Tier totals, re-derived from the lines.
  select sum(price_kobo) into v_sum from public.screen_types
   where code in ('blood_group', 'sickle_cell_genotype', 'hep_b', 'hep_c');
  if v_sum <> 7850000 then
    raise exception 'Know Your Basics should total 78,500 NGN, got %', v_sum / 100;
  end if;

  select sum(price_kobo) into v_sum from public.screen_types
   where code in ('lft', 'kft', 'hba1c', 'lipid_panel', 'urinalysis', 'fbc', 'hiv');
  if v_sum <> 22750000 then
    raise exception 'Core Screen should total 227,500 NGN (the sum of its lines, not the 228,000 in the source table), got %', v_sum / 100;
  end if;

  select sum(price_kobo) into v_sum from public.screen_types
   where code in ('hba1c', 'lipid_panel', 'kft', 'urinalysis', 'urine_acr', 'ogtt_fpg');
  if v_sum <> 17950000 then
    raise exception 'Hypertension Panel should total 179,500 NGN, got %', v_sum / 100;
  end if;

  select sum(price_kobo) into v_sum from public.screen_types
   where code in ('hba1c', 'lipid_panel', 'kft', 'urine_acr');
  if v_sum <> 14650000 then
    raise exception 'Diabetes Panel should total 146,500 NGN, got %', v_sum / 100;
  end if;

  -- 10b. Cost totals, the other half of the same list.
  select sum(lt.price_kobo) into v_sum
    from public.lab_tests lt join public.lab_providers p on p.id = lt.provider_id
   where p.name = 'Synlab Nigeria'
     and lt.code in ('blood_group', 'sickle_cell_genotype', 'hep_b', 'hep_c');
  if v_sum <> 6550000 then
    raise exception 'Know Your Basics cost should be 65,500 NGN, got %', v_sum / 100;
  end if;

  select sum(lt.price_kobo) into v_sum
    from public.lab_tests lt join public.lab_providers p on p.id = lt.provider_id
   where p.name = 'Synlab Nigeria'
     and lt.code in ('lft', 'kft', 'hba1c', 'lipid_panel', 'urinalysis', 'fbc', 'hiv');
  if v_sum <> 18980000 then
    raise exception 'Core Screen cost should be 189,800 NGN, got %', v_sum / 100;
  end if;

  -- 10c. Every Synlab test is sold above cost, and inside a sane margin band.
  -- The upper bound matters as much as the lower one: a 200% "margin" is far
  -- more likely to be a mistyped price than a pricing decision.
  select string_agg(lt.code || ' (' || round((st.price_kobo - lt.price_kobo) * 100.0 / lt.price_kobo, 1) || '%)', ', ')
    into v_bad
    from public.lab_tests lt
    join public.lab_providers p on p.id = lt.provider_id
    join public.screen_types st on st.code = lt.code
   where p.name = 'Synlab Nigeria'
     and st.price_kobo is not null
     and (st.price_kobo < lt.price_kobo
          or (st.price_kobo - lt.price_kobo) * 100.0 / lt.price_kobo > 40);
  if v_bad is not null then
    raise exception 'margin outside the expected band for: %', v_bad;
  end if;

  select min((st.price_kobo - lt.price_kobo) * 100.0 / lt.price_kobo),
         max((st.price_kobo - lt.price_kobo) * 100.0 / lt.price_kobo)
    into v_lo, v_hi
    from public.lab_tests lt
    join public.lab_providers p on p.id = lt.provider_id
    join public.screen_types st on st.code = lt.code
   where p.name = 'Synlab Nigeria' and st.price_kobo is not null;
  if v_lo < 15 or v_hi > 25 then
    raise exception 'Synlab margin band is %..%%%, expected roughly 18-21%%', round(v_lo,1), round(v_hi,1);
  end if;

  -- 10d. No active bundle carries a total that is not the sum of its lines.
  select string_agg(pb.code, ', ') into v_bad
    from public.panel_bundles pb
   where pb.is_active
     and pb.price_kobo is distinct from (
       select sum(st.price_kobo) from unnest(pb.test_codes) as tc(code)
       join public.screen_types st on st.code = tc.code
       where st.price_kobo is not null and st.fulfilment_dormant = false);
  if v_bad is not null then
    raise exception 'bundle total does not match its own lines: %', v_bad;
  end if;

  -- 10e. The restructure actually happened.
  if exists (select 1 from public.panel_bundles
              where code in ('screen_advanced', 'screen_comprehensive') and is_active) then
    raise exception 'the replaced Screen tiers are still active';
  end if;
  if not exists (select 1 from public.panel_bundles
                  where code = 'know_your_basics' and is_active and is_screen_tier) then
    raise exception 'Know Your Basics did not land';
  end if;
  if (select array_length(test_codes, 1) from public.panel_bundles where code = 'screen_core') <> 7 then
    raise exception 'Core Screen should be the 7-test annual';
  end if;

  -- 10f. "Once, ever" is real for all four, not just the original two.
  select string_agg(code, ', ') into v_bad
    from public.screen_types
   where code in ('blood_group', 'sickle_cell_genotype', 'hep_b', 'hep_c')
     and not once_per_lifetime;
  if v_bad is not null then
    raise exception 'not marked once-per-lifetime: %', v_bad;
  end if;
  if pg_get_functiondef('private.compute_screening_order_exclusions(uuid,uuid,text[])'::regprocedure)
       not like '%once_per_lifetime%' then
    raise exception 'the exclusion engine is still using a hardcoded lifetime list';
  end if;

  -- 10g. Neither bundle-code literal survives.
  if pg_get_functiondef('private.annotate_screening_order_exclusions()'::regprocedure) like '%screen_comprehensive%'
   or pg_get_functiondef('private.apply_screening_subscriber_discount()'::regprocedure) like '%screen_comprehensive%' then
    raise exception 'a hardcoded Screen-tier code list survived';
  end if;
end $$;
