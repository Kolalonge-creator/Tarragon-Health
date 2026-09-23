-- Tarragon Health — fix: continuous_monitoring_90d was deliberately shipped
-- WITHOUT 'annual_review' in its features array
-- (20260922193500_fix_continuous_monitoring_90d_missing_doctor_time_
-- features.sql), on the stated reasoning that annual_review was "always a
-- 12-month-tier-only bonus" and no 12-month tier exists any more.
--
-- THAT REASONING RECREATES THE EXACT DEFECT
-- ------------------------------------------
-- packages/db/tests/doctor_time_entitlement_grantable_by_purchasable_
-- product.sql (registered in ci.manifest, added 2026-09-02) exists
-- specifically to fail loudly the moment no active, patient-purchasable
-- product grants 'annual_review' any more — its own header explains this
-- was a real, silent production defect once already
-- (private.queue_annual_reviews() scheduling nothing for anyone, with every
-- earlier test of the gate passing anyway because they proved CLOSED or
-- used a retired/unreachable fixture). continuous_monitoring_12m was the
-- only product that ever granted 'annual_review'. Retiring it
-- (20260922185200_continuous_monitoring_90d_single_tier.sql) without
-- placing that entitlement anywhere else makes it unreachable again,
-- platform-wide — confirmed live: this exact test now fails with "FAIL 1:
-- no product a patient can buy grants annual_review — the entitlement is
-- unreachable, which is exactly the 2026-09-02 defect."
--
-- Continuous Monitoring is now a single tier, not a ladder — there is no
-- other purchasable product for this entitlement to live on, and nothing in
-- the launch-scope reconciliation this branch implements ever discussed
-- dropping annual review access. The safe, conservative fix is to give the
-- one remaining Continuous Monitoring product every doctor-time benefit the
-- three tiers it replaces collectively offered, not just the base seven.

begin;

update public.service_products
   set features = array[
     'vitals_red_flag_doctor_escalation',
     'chronic_doctor_supported_track',
     'clinician_review',
     'doctor_checkin',
     'async_doctor_visit',
     'multi_condition_review',
     'result_document_review',
     'annual_review'
   ]
 where code = 'continuous_monitoring_90d';

-- ---------------------------------------------------------------------------
-- Proof: the array carries annual_review now, and — reproducing
-- doctor_time_entitlement_grantable_by_purchasable_product.sql's own
-- "resolve the product the way a paying patient does" method rather than a
-- bare array check — at least one ACTIVE, purchasable product grants it.
-- ---------------------------------------------------------------------------

do $$
declare
  v_features text[];
  v_grantor_exists boolean;
begin
  select features into v_features
    from public.service_products
   where code = 'continuous_monitoring_90d';

  if not ('annual_review' = any(v_features)) then
    raise exception 'FAIL: continuous_monitoring_90d still does not carry annual_review';
  end if;

  select exists(
    select 1
      from public.service_products
     where is_active
       and 'annual_review' = any(features)
  ) into v_grantor_exists;

  if not v_grantor_exists then
    raise exception 'FAIL: no active, purchasable product grants annual_review — the 2026-09-02 defect is still live';
  end if;

  raise notice 'PASS: annual_review is reachable again via continuous_monitoring_90d';
end $$;

commit;
