-- Continuous Monitoring: the standing watch, sold prepaid for a fixed term.
-- Founder decision, 2026-09-10.
--
-- THE PROBLEM THIS SOLVES
-- -----------------------
-- private.patient_has_feature_access gates 'vitals_red_flag_doctor_escalation',
-- and until now exactly one product granted it: chronic_doctor_supported_pack,
-- the 50,000 naira twelve-week programme. Zero of those have ever been sold. So
-- the single capability that distinguishes this platform -- reading every vital
-- a patient logs against care protocols and putting a dangerous one in front of
-- a doctor -- was, in practice, available to nobody. A patient could spend
-- 15,000 naira on a Senior Case Review and still have no doctor alerted when
-- their blood pressure reading was dangerous.
--
-- It was also the wrong SHAPE. Escalation is not a course of treatment with an
-- end date. It is a standing watch whose marginal cost is close to zero,
-- because deterministic thresholds do the triage and a doctor only ever sees
-- the exceptions. Sold as twelve weeks it stops when the twelve weeks stop.
--
-- WHY A FIXED TERM AND NOT A MONTHLY SUBSCRIPTION
-- -----------------------------------------------
-- The public pricing page promises: nothing auto-renews, there is no
-- subscription, and nothing charges a card a second time on its own. That is a
-- trust commitment the founder has declined to trade away. So this is prepaid
-- for a fixed term and then it simply stops -- the patient is told before it
-- ends and buys again if they want to. No card is stored, nothing renews, and
-- there is no cancellation to remember. The pricing page needs no correction.
--
-- THE PRICES
-- ----------
--   3 months     7,500   (2,500 a month)
--   6 months    12,000   (2,000 a month)
--  12 months    18,000   (1,500 a month)
--
-- Anchored deliberately BELOW Nigerian retail health insurance rather than
-- against it. Reliance HMO's individual cover runs 3,500-6,000 naira a month,
-- 42,000-80,000 a year, and pays hospital bills, which this does not. Twelve
-- months of monitoring at 18,000 is under half the cheapest annual HMO premium,
-- which makes it something a person buys ALONGSIDE their HMO rather than
-- instead of it. That is the honest position and the one the marketing site's
-- own HMO comparison table already argues.
--
-- The longer terms are cheaper per month because the cost of a watch is almost
-- entirely the exceptions it raises, and those do not scale with term length.

begin;

insert into public.service_products
  (code, name, description, price_kobo, currency, access_duration_days, features, is_active)
values
  ('continuous_monitoring_3m',
   'Continuous Monitoring, 3 months',
   'For three months, every reading you log is checked against care protocols, and a dangerous one is put in front of a doctor on your care team rather than sitting on your record. You keep the emergency safety net either way; what this adds is a doctor who is told. Paid once, for three months. Nothing renews, and there is no card kept on file.',
   750000, 'NGN', 90,
   array['vitals_red_flag_doctor_escalation'], true),

  ('continuous_monitoring_6m',
   'Continuous Monitoring, 6 months',
   'Six months of the same standing watch: every reading you log checked against care protocols, and a dangerous one put in front of a doctor on your care team. Paid once, for six months. Nothing renews, and there is no card kept on file.',
   1200000, 'NGN', 180,
   array['vitals_red_flag_doctor_escalation'], true),

  ('continuous_monitoring_12m',
   'Continuous Monitoring, 12 months',
   'A full year of the standing watch: every reading you log checked against care protocols, and a dangerous one put in front of a doctor on your care team. Paid once, for a year, at the lowest monthly equivalent we offer. Nothing renews, and there is no card kept on file.',
   1800000, 'NGN', 365,
   array['vitals_red_flag_doctor_escalation'], true)

on conflict (code) do update
  set name                = excluded.name,
      description         = excluded.description,
      price_kobo          = excluded.price_kobo,
      access_duration_days = excluded.access_duration_days,
      features            = excluded.features,
      is_active           = true;

-- ---------------------------------------------------------------------------
-- Proof that the gate OPENS, not merely that it closes.
--
-- This platform has shipped a dead escalation gate before: the feature was
-- granted only by products that had been retired, so it resolved false for
-- every patient, and the tests stayed green because they only ever asserted
-- that an unentitled patient was refused. Asserting refusal proves nothing when
-- the gate is refusing everyone.
--
-- So this asserts both directions against a real patient, inside a subtransaction
-- that is deliberately rolled back by raising at the end and catching it, so no
-- test row survives the migration.
-- ---------------------------------------------------------------------------

do $$
declare
  v_patient   uuid;
  v_org       uuid;
  v_product   uuid;
  v_before    boolean;
  v_after     boolean;
  v_expired   boolean;
begin
  select id, organisation_id into v_patient, v_org
    from public.profiles where role = 'patient' limit 1;

  if v_patient is null then
    raise notice 'SKIP: no patient row to prove the gate against; structural checks only';
  else
    select id into v_product from public.service_products where code = 'continuous_monitoring_12m';

    begin
      v_before := private.patient_has_feature_access(v_patient, 'vitals_red_flag_doctor_escalation');

      insert into public.service_purchases
        (organisation_id, patient_id, service_product_id, status, amount_kobo, currency,
         purchased_at, expires_at)
      values
        (v_org, v_patient, v_product, 'active', 1800000, 'NGN', now(), now() + interval '365 days');

      v_after := private.patient_has_feature_access(v_patient, 'vitals_red_flag_doctor_escalation');

      -- And that an EXPIRED cover genuinely stops granting it.
      update public.service_purchases
         set expires_at = now() - interval '1 day'
       where patient_id = v_patient and service_product_id = v_product;

      v_expired := private.patient_has_feature_access(v_patient, 'vitals_red_flag_doctor_escalation');

      raise exception 'ROLLBACK_PROBE';
    exception when others then
      if sqlerrm <> 'ROLLBACK_PROBE' then
        raise;
      end if;
    end;

    if v_after is not true then
      raise exception 'FAIL: an active Continuous Monitoring purchase did NOT open the escalation gate. The gate is dead.';
    end if;
    if v_expired is not false then
      raise exception 'FAIL: an EXPIRED Continuous Monitoring purchase still opens the escalation gate.';
    end if;

    raise notice 'PASS: escalation gate closed before (%), open with active cover (%), closed again once expired (%)',
      v_before, v_after, v_expired;
  end if;

  if (select count(*) from public.service_products
       where code like 'continuous\_monitoring\_%' and is_active
         and 'vitals_red_flag_doctor_escalation' = any(features)) <> 3 then
    raise exception 'FAIL: expected 3 active Continuous Monitoring products carrying the escalation feature';
  end if;

  raise notice 'PASS: Continuous Monitoring live at 7,500 / 12,000 / 18,000 for 3 / 6 / 12 months';
end $$;

commit;
