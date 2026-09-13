-- Supervised Weight Management: activate the purchase, then actually deliver it.
--
-- THE GAP
-- -------
-- 20260910011851 built the product, the enrolment table, the dose-plan and
-- check-in machinery, and the supervision-only trigger -- but nothing anywhere
-- ever inserted a weight_management_enrolments row. A patient who paid
-- 75,000 / 132,000 / 240,000 naira for weight_management_3m/6m/12m had their
-- payment activate the service_purchases row exactly as designed
-- (private.apply_service_purchase_payment, 20260831143207) and then saw the
-- "Losing weight on medication?" empty state forever --
-- useMyWeightManagementEnrolment (apps/web/src/lib/queries/weight-management.ts)
-- found nothing, because nothing was ever written. Money changed hands and
-- nothing was delivered. Found in a 2026-09-10 audit.
--
-- THE FIX, AND WHY IT'S SHAPED THIS WAY
-- --------------------------------------
-- Same architectural pattern as the existing precedent for a service purchase
-- driving creation of a specific enrolment row --
-- private.activate_chronic_programme_doctor_supported_track
-- (20260902210000_fix_chronic_programme_two_track_gaps.sql): a dedicated
-- AFTER trigger on service_purchases itself, not a branch bolted onto
-- private.apply_service_purchase_payment. That keeps the payment trigger
-- generic (it knows nothing about any specific product) and lets each paid
-- product own its own activation side-effect independently, the same
-- separation of concerns already established for the chronic-programme
-- doctor-supported upgrade.
--
-- "after insert or update of status ... and (tg_op = 'update' and old.status
-- = 'active')" is the same guard the chronic-programme trigger uses, for the
-- same reason: it must fire on BOTH the ways a purchase can reach 'active' --
-- inserted-as-active outright (a free/voucher-covered product, not how this
-- one is priced today but the schema allows it) and the far more common path
-- here, updated to 'active' by apply_service_purchase_payment on confirmed
-- payment -- while never re-firing on an unrelated later update to an
-- already-active row (e.g. cancelled_at being set).
--
-- The created row is deliberately minimal: organisation_id, patient_id,
-- service_purchase_id, status = 'pending_eligibility', term_days derived from
-- the product code. Nothing else on weight_management_enrolments can be
-- known at purchase time -- obesity_assessment_id, supervising_clinician_id,
-- medication_id and eligibility_confirmed_by are all clinical judgements a
-- doctor makes later, and wme_active_needs_eligibility already refuses to let
-- this row reach 'active' without them. This trigger only starts the queue;
-- it does not, and must not, decide eligibility.
--
-- DUPLICATE PURCHASE IS A NO-OP, NOT A FAILED PAYMENT
-- ----------------------------------------------------
-- weight_management_enrolments_one_live_per_patient is a partial unique index
-- (patient_id) where status in ('pending_eligibility','active','paused'). A
-- patient who somehow buys a second weight-management product while one is
-- already live must not have their payment-activation trigger blow up on a
-- unique-constraint violation -- the payment already succeeded and
-- service_purchases must still end up 'active' regardless. So the insert is
-- guarded by a `where not exists (...)` against that same condition rather
-- than caught with an exception handler: a genuine no-op, matching the
-- "where-clause guards, not an exception" convention the chronic-programme
-- trigger above already established for exactly this kind of case.

begin;

create or replace function private.create_weight_management_enrolment_on_purchase()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_code text;
  v_term integer;
begin
  if new.status <> 'active' or (tg_op = 'UPDATE' and old.status = 'active') then
    return new;
  end if;

  select code into v_code from public.service_products where id = new.service_product_id;

  v_term := case v_code
    when 'weight_management_3m'  then 90
    when 'weight_management_6m'  then 180
    when 'weight_management_12m' then 365
    else null
  end;

  if v_term is null then
    return new;
  end if;

  insert into public.weight_management_enrolments
    (organisation_id, patient_id, service_purchase_id, status, term_days)
  select new.organisation_id, new.patient_id, new.id, 'pending_eligibility', v_term
  where not exists (
    select 1 from public.weight_management_enrolments e
     where e.patient_id = new.patient_id
       and e.status in ('pending_eligibility', 'active', 'paused')
  );

  return new;
end;
$function$;

comment on function private.create_weight_management_enrolment_on_purchase() is
  'Delivers what a weight_management_3m/6m/12m purchase actually paid for. Without this, apply_service_purchase_payment activated service_purchases and nothing else ever happened -- found by a 2026-09-10 audit as the single most commercially serious gap in the B2C revenue reset. Inserts pending_eligibility only; wme_active_needs_eligibility (20260910011851) still requires a doctor to record the assessment and confirm suitability before this can become active.';

drop trigger if exists service_purchases_create_weight_management_enrolment on public.service_purchases;
create trigger service_purchases_create_weight_management_enrolment
  after insert or update of status on public.service_purchases
  for each row execute function private.create_weight_management_enrolment_on_purchase();

revoke all on function private.create_weight_management_enrolment_on_purchase() from public;

-- ---------------------------------------------------------------------------
-- Assertion: simulate a weight-management purchase activating (the payment-
-- confirmation path, the common real one) and prove the enrolment appears
-- with the right shape. Rolled back to a savepoint via the sentinel-exception
-- convention this migration series already uses (20260910011851's own
-- supervision-only probe), so nothing here survives the migration.
-- ---------------------------------------------------------------------------

do $$
declare
  v_patient   uuid;
  v_org       uuid;
  v_product   uuid;
  v_purchase  uuid;
  v_enrolment record;
  v_dupe_count integer;
begin
  select id, organisation_id into v_patient, v_org from public.profiles where role = 'patient' limit 1;

  if v_patient is null then
    raise notice 'SKIP: no patient row to prove the weight-management enrolment trigger against';
  else
    begin
      select id into v_product from public.service_products where code = 'weight_management_3m';
      if v_product is null then
        raise exception 'FAIL: weight_management_3m service_product not found';
      end if;

      -- The real path: inserted pending_payment (as record_service_purchase_intent
      -- does), then flipped to active by an UPDATE (as
      -- private.apply_service_purchase_payment does on charge.success).
      insert into public.service_purchases
        (organisation_id, patient_id, purchaser_profile_id, service_product_id, status,
         amount_kobo, currency)
      values (v_org, v_patient, v_patient, v_product, 'pending_payment', 7500000, 'NGN')
      returning id into v_purchase;

      update public.service_purchases
         set status = 'active', purchased_at = now(), expires_at = now() + interval '90 days'
       where id = v_purchase;

      select * into v_enrolment from public.weight_management_enrolments
        where service_purchase_id = v_purchase;

      if v_enrolment.id is null then
        raise exception 'FAIL: activating a weight_management_3m purchase created no enrolment row';
      end if;
      if v_enrolment.status <> 'pending_eligibility' then
        raise exception 'FAIL: new enrolment status was %, expected pending_eligibility', v_enrolment.status;
      end if;
      if v_enrolment.term_days <> 90 then
        raise exception 'FAIL: new enrolment term_days was %, expected 90 for the 3-month product', v_enrolment.term_days;
      end if;
      if v_enrolment.patient_id <> v_patient or v_enrolment.organisation_id <> v_org then
        raise exception 'FAIL: new enrolment patient_id/organisation_id did not match the purchase';
      end if;

      -- A second purchase while the first is still live must not error the
      -- activation, and must not create a second row.
      insert into public.service_purchases
        (organisation_id, patient_id, purchaser_profile_id, service_product_id, status,
         amount_kobo, currency)
      values (v_org, v_patient, v_patient,
              (select id from public.service_products where code = 'weight_management_6m'),
              'pending_payment', 13200000, 'NGN')
      returning id into v_purchase;

      update public.service_purchases
         set status = 'active', purchased_at = now(), expires_at = now() + interval '180 days'
       where id = v_purchase;

      select count(*) into v_dupe_count from public.weight_management_enrolments
        where patient_id = v_patient
          and status in ('pending_eligibility', 'active', 'paused');
      if v_dupe_count <> 1 then
        raise exception 'FAIL: duplicate purchase while already enrolled produced % live enrolments, expected 1', v_dupe_count;
      end if;

      raise exception 'ROLLBACK_PROBE';
    exception when others then
      if sqlerrm <> 'ROLLBACK_PROBE' then raise; end if;
    end;
    raise notice 'PASS: activating a weight-management purchase creates a pending_eligibility enrolment with the right term_days; a duplicate purchase is a no-op, not a second row or a failed payment';
  end if;
end $$;

commit;
