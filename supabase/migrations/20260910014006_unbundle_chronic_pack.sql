-- The 12-week doctor-supported pack is unbundled into the parts it was always
-- made of, and the result-interpretation price spine is unified.
-- Founder decision, 2026-09-10.
--
-- WHY UNBUNDLE
-- ------------
-- The cost model added earlier in this series put a number on something that
-- had never had one. chronic_doctor_supported_pack sells at 50,000 naira and
-- models at roughly 40,760 of clinical time -- about 17% contribution, by a wide
-- margin the worst product on the platform, and the one the marketing site
-- leads with. Everything else on the ladder sits between 39% and 80%.
--
-- It is also the wrong shape commercially. Its own public description already
-- itemises it as three doctor reviews at 10,000 each, one medication review at
-- 10,000, and ongoing coordination and monitoring at 10,000. That is not a
-- programme, it is four things sold together at a discount, with a 50,000 naira
-- entry price standing in front of a patient who has never bought anything.
-- Annualised it is roughly 217,000 a year, against a Reliance HMO individual
-- premium of 42,000-80,000 that also pays hospital bills -- and the marketing
-- site's own HMO comparison table invites exactly that arithmetic.
--
-- Unbundled, the same twelve weeks costs a patient 7,500 for the monitoring
-- plus 7,500 per review as they need them, the entry price falls from 50,000 to
-- 7,500, the margin on each part sits in the normal band, and the relationship
-- does not end on a fixed date.
--
-- WHAT REPLACES IT CLINICALLY -- NOTHING IS LOST
-- ----------------------------------------------
-- The chronic pathway itself is not a product and is not being retired.
-- chronic_condition_programmes, chronic_programme_enrolments and the schedule
-- templates all stay exactly as they are, and the self-monitoring track stays
-- free. What changes is only how the doctor-supported track is paid for:
-- Continuous Monitoring carries entry to the track, and each review is bought
-- as it falls due. So the 'chronic_doctor_supported_track' feature moves onto
-- the monitoring products, and 'annual_review' onto the twelve-month one --
-- which is a real reason to choose the longer term rather than a discount.
--
-- programme_purchases is untouched. private.patient_has_feature_access has a
-- second branch that grants the whole doctor-time feature set from an active
-- programme_purchases row, and anyone who bought that way keeps everything they
-- bought.
--
-- AND ONE PRICE SPINE THAT HAD QUIETLY FORKED
-- -------------------------------------------
-- Writing the Written Result Interpretation product surfaced that this platform
-- ALREADY charges to have a result read: public.lab_result_consult_prices holds
-- 10,000 and gates public.claim_lab_result_consult_credit, which runs before a
-- patient is even allowed to upload. That is the same product under a different
-- name, priced in a different table -- the identical fork that had a patient
-- quoted 5,000 for a video visit and charged 10,000. It is aligned to 7,500
-- here and asserted equal, so the two cannot drift again while both exist.
-- Collapsing them to one mechanism is app work and follows separately.

begin;

-- ---------------------------------------------------------------------------
-- 1. The parts, sold individually
-- ---------------------------------------------------------------------------

insert into public.service_products
  (code, name, description, price_kobo, currency, access_duration_days, features, is_active)
values
  ('chronic_care_review_credit',
   'Chronic Care Review',
   'A doctor reviews the readings you have logged since your last review, checks them against your care plan and the protocol for your condition, adjusts the plan where it needs adjusting, and writes back what changed and why. This is the review that sits at the centre of managing hypertension or diabetes well, and you buy one when it falls due rather than a block of them in advance.',
   750000, 'NGN', 730, array[]::text[], true),

  ('medication_review_credit',
   'Medication Review',
   'A senior doctor reviews everything you are taking together: whether each medicine is still the right one, whether the doses still match your numbers, whether anything interacts, and whether something should start or stop. Priced above a standard review because it requires a doctor with prescribing authority.',
   1200000, 'NGN', 730, array[]::text[], true)

on conflict (code) do update
  set name                 = excluded.name,
      description          = excluded.description,
      price_kobo           = excluded.price_kobo,
      access_duration_days = excluded.access_duration_days,
      is_active            = true;

-- ---------------------------------------------------------------------------
-- 2. Monitoring carries entry to the doctor-supported track
-- ---------------------------------------------------------------------------

update public.service_products
   set features = array['vitals_red_flag_doctor_escalation', 'chronic_doctor_supported_track']
 where code in ('continuous_monitoring_3m', 'continuous_monitoring_6m');

update public.service_products
   set features = array['vitals_red_flag_doctor_escalation', 'chronic_doctor_supported_track', 'annual_review'],
       description = 'A full year of the standing watch: every reading you log checked against care protocols, and a dangerous one put in front of a doctor on your care team. Includes your annual review, and entry to the doctor-supported track of the chronic programme if you are managing hypertension or diabetes. Paid once, for a year, at the lowest monthly equivalent we offer. Nothing renews, and there is no card kept on file.'
 where code = 'continuous_monitoring_12m';

-- The annual review is real doctor time and has to be costed, or the
-- twelve-month tier silently gives away work the model cannot see.
insert into public.service_delivery_cost_model
  (service_product_code, component, expected_minutes, delivered_by_tier, coordination_minutes, units_per_term, notes)
values
  ('continuous_monitoring_12m', 'annual_review', 30, 'medical_officer', 10, 1,
   'The annual review carried by the twelve-month tier. Not carried by 3m or 6m.'),
  ('chronic_care_review_credit', 'delivery', 20, 'medical_officer', 8, 1,
   'Protocol-driven review of logged readings against the care plan. Medical Officer tier: confirming and continuing an existing plan, not initiating a medicine.'),
  ('medication_review_credit', 'delivery', 25, 'senior_medical_officer', 5, 1,
   'Whole-list review with authority to start or stop. Senior tier by necessity, per private.has_prescribing_authority.')
on conflict (service_product_code, component) do update
  set expected_minutes     = excluded.expected_minutes,
      delivered_by_tier    = excluded.delivered_by_tier,
      coordination_minutes = excluded.coordination_minutes,
      units_per_term       = excluded.units_per_term,
      notes                = excluded.notes;

-- ---------------------------------------------------------------------------
-- 3. Retire the pack
--
-- Deactivated rather than deleted. Nobody has ever bought one (zero
-- service_purchases against this code, verified live), so nothing is stranded --
-- but the code stays resolvable so any historical reference reads as a retired
-- product rather than a missing one.
-- ---------------------------------------------------------------------------

update public.service_products
   set is_active   = false,
       description = 'Retired 2026-09-10 and unbundled into its parts: Continuous Monitoring for the watch and the coordination, Chronic Care Review for each doctor review, and Medication Review for the medicines. The same twelve weeks costs the same money bought separately, at an entry price of 7,500 rather than 50,000. The chronic pathway itself is unchanged and the self-monitoring track remains free.'
 where code = 'chronic_doctor_supported_pack';

-- ---------------------------------------------------------------------------
-- 4. One price for having a result read
-- ---------------------------------------------------------------------------

update public.lab_result_consult_prices
   set amount_minor = 750000
 where is_enabled;

-- ---------------------------------------------------------------------------
-- 5. Assertions
-- ---------------------------------------------------------------------------

do $$
declare
  v_pack_sales int;
  v_track      int;
  v_consult    bigint;
  v_written    bigint;
  v_pack_live  boolean;
begin
  select count(*) into v_pack_sales
    from public.service_purchases sp
    join public.service_products p on p.id = sp.service_product_id
   where p.code = 'chronic_doctor_supported_pack';
  if v_pack_sales > 0 then
    raise warning 'Retired chronic_doctor_supported_pack with % existing purchase(s). They keep their entitlement via the service_purchases branch of patient_has_feature_access until they expire.', v_pack_sales;
  end if;

  select is_active into v_pack_live from public.service_products where code = 'chronic_doctor_supported_pack';
  if v_pack_live then
    raise exception 'FAIL: the 12-week pack is still active';
  end if;

  -- The doctor-supported track must still be reachable, or unbundling has
  -- quietly closed a clinical pathway rather than repriced it. This is the
  -- same class of mistake as a gate that resolves false for everybody.
  select count(*) into v_track
    from public.service_products
   where is_active and 'chronic_doctor_supported_track' = any(features);
  if v_track = 0 then
    raise exception 'FAIL: no active product grants chronic_doctor_supported_track. The doctor-supported track is now unreachable.';
  end if;

  select amount_minor into v_consult from public.lab_result_consult_prices where is_enabled limit 1;
  select price_kobo   into v_written from public.service_products where code = 'written_result_interpretation';
  -- A fresh environment may have no enabled consult price row at all, which is
  -- not a fork -- it is the absence of one. Only assert when both exist.
  if v_consult is not null and v_consult is distinct from v_written then
    raise exception 'FAIL: having a result read has two prices again -- lab_result_consult_prices % vs written_result_interpretation %',
      v_consult, v_written;
  end if;

  raise notice 'PASS: pack unbundled; % product(s) carry the doctor-supported track; result interpretation at % (consult price row: %)',
    v_track, v_written / 100, coalesce((v_consult / 100)::text, 'none');
end $$;

commit;
