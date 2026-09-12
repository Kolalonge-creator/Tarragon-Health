-- Tarragon Health — fix stale product-code reference in the chronic
-- doctor-supported-track activation trigger.
--
-- private.activate_chronic_programme_doctor_supported_track() (added
-- 20260902210000) hardcoded a check for
-- service_products.code = 'chronic_doctor_supported_pack' before upgrading a
-- mid-programme enrolment from self_monitoring to doctor_supported. That
-- product was retired 8 days later (20260910014006_unbundle_chronic_pack.sql,
-- is_active = false) and the chronic_doctor_supported_track feature moved
-- onto the continuous_monitoring_3m/6m/12m products instead — but this
-- trigger was never updated to match. The result: even after fixing the app
-- code that calls purchaseServiceProduct to sell an active product again
-- (apps/web/.../chronic-programme-actions.ts, same PR), a patient who buys
-- Continuous Monitoring mid-programme would pay and see their enrolment stay
-- on self_monitoring forever — this trigger silently no-ops for any code
-- other than the retired one, per its own "where-clause guards, not an
-- exception, on purpose" design (a real, live, previously-undetected gap;
-- zero rows have ever hit this trigger's upgrade path, confirmed against
-- chronic_programme_enrolments before this fix).
--
-- Fixed at the root the same way private.patient_has_feature_access already
-- works: check the purchased product's `features` array for
-- 'chronic_doctor_supported_track' membership, not a specific product code.
-- This is exactly the class of drift this codebase has hit repeatedly when a
-- product/enum value is retired but a downstream check still hardcodes it
-- (see CLAUDE.md's is_clinical_director and reproductive_health entries) —
-- fixing it generically means the next repricing of this feature can't
-- silently reopen the same gap.

begin;

create or replace function private.activate_chronic_programme_doctor_supported_track()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_grants_track boolean;
begin
  if new.status <> 'active' or (tg_op = 'UPDATE' and old.status = 'active') then
    return new;
  end if;
  if new.scoped_entity_type is distinct from 'chronic_programme_enrolments' or new.scoped_entity_id is null then
    return new;
  end if;

  select 'chronic_doctor_supported_track' = any(features) into v_grants_track
    from public.service_products where id = new.service_product_id;
  if v_grants_track is not true then
    return new;
  end if;

  -- where-clause guards, not an exception, on purpose: an enrolment that has
  -- since withdrawn, or one already on doctor_supported, is a legitimate
  -- no-op here, not a failure of this purchase.
  update public.chronic_programme_enrolments
  set track = 'doctor_supported'
  where id = new.scoped_entity_id
    and status = 'enrolled'
    and track = 'self_monitoring';

  return new;
end;
$$;

revoke all on function private.activate_chronic_programme_doctor_supported_track() from public;

-- ---------------------------------------------------------------------------
-- Proof: a mid-programme purchase of the CURRENT active product
-- (continuous_monitoring_3m) upgrades the track and materialises the
-- doctor_checkin occurrences, the same behaviour the retired pack used to
-- drive. Same skip-gracefully convention as the migration that introduced
-- this trigger (20260902210000): only runs when a real patient/active
-- hypertension programme exists to test against.
-- ---------------------------------------------------------------------------

do $$
declare
  v_org            uuid;
  v_patient        uuid;
  v_product_id     uuid;
  v_enrolment      uuid;
  v_purchase_id    uuid;
  v_track          public.chronic_programme_track;
  v_checkin_count  integer;
begin
  select id into v_product_id from public.service_products
    where code = 'continuous_monitoring_3m' and is_active;

  select p.organisation_id into v_org
  from public.profiles p
  where p.role = 'patient'
    and not exists (
      select 1 from public.chronic_programme_enrolments e
      where e.patient_id = p.id and e.programme_id = (select id from public.chronic_condition_programmes where code = 'hypertension')
        and e.status = 'enrolled'
    )
  limit 1;
  select id into v_patient from public.profiles where organisation_id = v_org and role = 'patient'
    and not exists (
      select 1 from public.chronic_programme_enrolments e
      where e.patient_id = profiles.id and e.programme_id = (select id from public.chronic_condition_programmes where code = 'hypertension')
        and e.status = 'enrolled'
    )
  limit 1;

  if v_patient is null or v_product_id is null
     or not (select is_active from public.chronic_condition_programmes where code = 'hypertension') then
    raise notice 'SKIPPED behavioral proof: no patient/active hypertension programme/continuous_monitoring_3m row to test against';
  else
    insert into public.chronic_programme_enrolments (organisation_id, patient_id, programme_id, status)
    select v_org, v_patient, id, 'enrolled' from public.chronic_condition_programmes where code = 'hypertension'
    returning id, track into v_enrolment, v_track;

    if v_track is distinct from 'self_monitoring' then
      raise exception 'FAIL: fresh enrolment did not land on self_monitoring (got %)', v_track;
    end if;

    -- The bug scenario: buy Continuous Monitoring WHILE ALREADY ENROLLED.
    insert into public.service_purchases
      (organisation_id, patient_id, purchaser_profile_id, service_product_id, status,
       amount_kobo, currency, scoped_entity_type, scoped_entity_id, purchased_at, expires_at)
    values (v_org, v_patient, v_patient, v_product_id, 'active', 750000, 'NGN',
            'chronic_programme_enrolments', v_enrolment, now(), now() + interval '90 days')
    returning id into v_purchase_id;

    select track into v_track from public.chronic_programme_enrolments where id = v_enrolment;
    if v_track is distinct from 'doctor_supported' then
      raise exception 'FAIL: mid-programme continuous_monitoring_3m purchase did not upgrade the enrolment track (got %)', v_track;
    end if;

    select count(*) into v_checkin_count from public.chronic_programme_schedule_occurrences
      where enrolment_id = v_enrolment and occurrence_type = 'doctor_checkin';
    if v_checkin_count <> 3 then
      raise exception 'FAIL: mid-programme upgrade did not materialise the 3 doctor_checkin occurrences (got %)', v_checkin_count;
    end if;

    delete from public.service_purchases where id = v_purchase_id;
    delete from public.chronic_programme_schedule_occurrences where enrolment_id = v_enrolment;
    delete from public.chronic_programme_end_reviews where enrolment_id = v_enrolment;
    delete from public.chronic_programme_enrolments where id = v_enrolment;
  end if;

  raise notice 'PASS: activate_chronic_programme_doctor_supported_track now upgrades on any product carrying the chronic_doctor_supported_track feature, not a hardcoded retired product code';
end $$;

commit;
