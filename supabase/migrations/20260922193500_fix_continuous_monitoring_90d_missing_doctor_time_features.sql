-- Tarragon Health — fix: continuous_monitoring_90d shipped with only
-- 'vitals_red_flag_doctor_escalation' in its features array, silently
-- dropping the six other doctor-time features the retired
-- continuous_monitoring_3m/6m tiers actually carried live.
--
-- FOUND BY /code-review high on the 20260922185200_continuous_monitoring_
-- 90d_single_tier.sql migration (launch-scope audit reconciliation), before
-- that PR was opened. Real, live gap, not just a documentation mismatch: a
-- patient buying the new 90-day tier to get entry to the chronic programme's
-- doctor-supported track — exactly what pricing.ts's own copy for this
-- product promises ("It also carries entry to the doctor-supported track of
-- the chronic programme if you are managing hypertension or diabetes") —
-- would pay 30,000 naira and get nothing: private.activate_chronic_
-- programme_doctor_supported_track()'s `'chronic_doctor_supported_track' =
-- any(features)` check (20260911211641_fix_stale_chronic_doctor_supported_
-- track_activation_check.sql) would resolve false, so the trigger's
-- where-clause update silently no-ops, and private.patient_has_feature_
-- access's direct service_purchases-features branch would likewise refuse
-- clinician_review/doctor_checkin/async_doctor_visit/multi_condition_review/
-- result_document_review for that purchase (its separate programme_purchases
-- fallback branch is a different, largely-unused legacy path — see that
-- function's own live definition — not something a continuous_monitoring_90d
-- buyer would have).
--
-- ROOT CAUSE
-- ----------
-- 20260922185200_continuous_monitoring_90d_single_tier.sql (this same PR)
-- copied the features array from the ORIGINAL 2026-09-10
-- 20260910011849_continuous_monitoring_cover.sql migration FILE, which only
-- ever inserted `array['vitals_red_flag_doctor_escalation']` — but the LIVE
-- row had since been expanded to seven features by a later migration
-- (verified live: continuous_monitoring_3m/6m both carry
-- vitals_red_flag_doctor_escalation, chronic_doctor_supported_track,
-- clinician_review, doctor_checkin, async_doctor_visit,
-- multi_condition_review, result_document_review; continuous_monitoring_12m
-- carries those seven plus annual_review, which was always the 12-month-only
-- bonus). Reading a migration file's committed body is not the same as
-- checking the live row it produced after later migrations touched it —
-- exactly the trap CLAUDE.md's Diaspora reconciliation entry warns about
-- for purchase_care_voucher, recurring here for the same reason.
--
-- THE FIX
-- -------
-- Give continuous_monitoring_90d the same seven features the 3-month tier it
-- replaces carried (NOT the 12-month tier's extra 'annual_review' — that was
-- deliberately a 12-month-only bonus, and pricing.ts's rewritten copy for
-- this product already dropped any annual-review mention when the three
-- tiers collapsed into one).

begin;

update public.service_products
   set features = array[
     'vitals_red_flag_doctor_escalation',
     'chronic_doctor_supported_track',
     'clinician_review',
     'doctor_checkin',
     'async_doctor_visit',
     'multi_condition_review',
     'result_document_review'
   ]
 where code = 'continuous_monitoring_90d';

-- ---------------------------------------------------------------------------
-- Proof: not just that the array now matches, but that the real downstream
-- consumer (the chronic-doctor-supported-track trigger) actually flips a
-- real enrolment on a real purchase of this product — the exact failure
-- mode a bare array-equality check would miss if the trigger's own check
-- were ever rewritten to key off something else again.
-- ---------------------------------------------------------------------------

do $$
declare
  v_features text[];
  v_org            uuid;
  v_patient        uuid;
  v_product_id     uuid;
  v_enrolment      uuid;
  v_track_before   public.chronic_programme_track;
  v_track_after    public.chronic_programme_track;
  v_has_clinician_review boolean;
begin
  select features into v_features from public.service_products where code = 'continuous_monitoring_90d';
  if not (
    'chronic_doctor_supported_track' = any(v_features)
    and 'clinician_review' = any(v_features)
    and 'doctor_checkin' = any(v_features)
    and 'async_doctor_visit' = any(v_features)
    and 'multi_condition_review' = any(v_features)
    and 'result_document_review' = any(v_features)
    and 'vitals_red_flag_doctor_escalation' = any(v_features)
  ) then
    raise exception 'FAIL: continuous_monitoring_90d is still missing one or more of the seven expected doctor-time features (got: %)', v_features;
  end if;
  if 'annual_review' = any(v_features) then
    raise exception 'FAIL: continuous_monitoring_90d should NOT carry annual_review — that stays a 12-month-tier-only bonus, and no 12-month tier exists any more';
  end if;

  select id into v_product_id from public.service_products where code = 'continuous_monitoring_90d';

  select p.organisation_id, p.id into v_org, v_patient
    from public.profiles p
    where p.role = 'patient'
      and exists (
        select 1 from public.chronic_programme_enrolments e
        where e.patient_id = p.id and e.status = 'enrolled' and e.track = 'self_monitoring'
      )
    limit 1;

  if v_patient is null then
    raise notice 'SKIP: no patient with a real self_monitoring chronic-programme enrolment to prove the trigger against; array-shape checks above still ran';
  else
    select e.id, e.track into v_enrolment, v_track_before
      from public.chronic_programme_enrolments e
      where e.patient_id = v_patient and e.status = 'enrolled' and e.track = 'self_monitoring'
      limit 1;

    begin
      insert into public.service_purchases
        (organisation_id, patient_id, service_product_id, status, amount_kobo, currency,
         scoped_entity_type, scoped_entity_id, purchased_at, expires_at)
      values
        (v_org, v_patient, v_product_id, 'active', 3000000, 'NGN',
         'chronic_programme_enrolments', v_enrolment, now(), now() + interval '90 days');

      select track into v_track_after from public.chronic_programme_enrolments where id = v_enrolment;
      v_has_clinician_review := private.patient_has_feature_access(v_patient, 'clinician_review');

      raise exception 'ROLLBACK_PROBE';
    exception when others then
      if sqlerrm <> 'ROLLBACK_PROBE' then
        raise;
      end if;
    end;

    if v_track_after is distinct from 'doctor_supported' then
      raise exception 'FAIL: buying continuous_monitoring_90d scoped to a self_monitoring enrolment did not flip it to doctor_supported (still %)', v_track_after;
    end if;
    if v_has_clinician_review is not true then
      raise exception 'FAIL: an active continuous_monitoring_90d purchase does not grant clinician_review via private.patient_has_feature_access';
    end if;

    raise notice 'PASS: continuous_monitoring_90d now carries the full doctor-time feature set and genuinely flips a self_monitoring enrolment to doctor_supported (was %, now %)', v_track_before, v_track_after;
  end if;

  raise notice 'PASS: continuous_monitoring_90d features array fixed (7 doctor-time features, no annual_review)';
end $$;

commit;
