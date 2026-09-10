-- The doctor-time price ladder, re-laddered; Written Result Interpretation added;
-- Verified Digital Document split by document type.
-- Founder decision, 2026-09-10.
--
-- WHY NOW
-- -------
-- Two forcing reasons.
--
-- First, a live defect. A video visit has had two prices simultaneously:
-- public.video_visit_prices holds 10,000 and is what the booking screen reads
-- (useVideoVisitPrice in lib/queries/consult-slots.ts), while
-- service_products.video_visit_credit holds 5,000 and is what the public
-- pricing page, the FAQ and the gift page all advertise. A patient was quoted
-- 5,000 and met 10,000 at the point of booking. The founder has settled this at
-- 10,000, so the service_product moves to match the booking screen rather than
-- the other way round.
--
-- Second, the catalogue migration immediately before this one stopped Tarragon
-- selling laboratory tests. What replaces that revenue is reading the result --
-- so the interpretation product has to exist, be reachable without Tarragon
-- having ordered anything, and be priced sensibly against the rest of the
-- ladder. Unifying the video visit at 10,000 collided head-on with Result
-- Interpretation, which also sat at 10,000, which is what forces the re-ladder
-- rather than a one-line price change.
--
-- THE LADDER
-- ----------
--   Ask a Doctor (written)              2,500  unchanged -- see the note below
--   Prescription Renewal Review         3,500 -> 5,000
--   Written Result Interpretation          -- -> 7,500  NEW
--   Second Opinion Review               7,500 -> 10,000
--   Video or Audio Visit                5,000 -> 10,000  unifies with video_visit_prices
--   Result Consultation (video)        10,000 -> 15,000  renamed from Result Interpretation Session
--   Senior Case Review                 15,000 -> 25,000
--   Verified Digital Document           4,000 -> 7,500 / 10,000 / 15,000 by type
--
-- WHY ASK A DOCTOR STAYS AT 2,500, WHICH LOOKS LIKE AN OVERSIGHT AND IS NOT
-- -------------------------------------------------------------------------
-- Paystack waives its 100 naira flat fee entirely on local card transactions of
-- 2,500 naira or less, charging 1.5% alone. At exactly 2,500 the fee is 37.50;
-- at 2,501 it is 137.50. Raising this SKU by one naira nearly quadruples its
-- processing cost. Anyone repricing it later should move it well clear of the
-- cliff or not at all -- 2,600 is the worst possible number. The same applies to
-- confidential_message_credit, which is also 2,500 and also left alone.
--
-- MARKET ANCHORS (Nigeria, checked 2026-09-10)
-- --------------------------------------------
-- General practitioner consultation 5,000-10,000; specialist 10,000-20,000.
-- The ladder now spans that band properly instead of bunching at its floor.
-- Senior Case Review at 25,000 sits just above the specialist band, which is
-- right: it is Senior Medical Officer time across every condition a patient is
-- managing, delivered as a written plan, not a single consultation.

begin;

-- ---------------------------------------------------------------------------
-- 1. Reprice the existing ladder
-- ---------------------------------------------------------------------------

update public.service_products set price_kobo =   500000 where code = 'prescription_renewal_credit';
update public.service_products set price_kobo =  1000000 where code = 'second_opinion_credit';
update public.service_products set price_kobo =  1000000 where code = 'video_visit_credit';
update public.service_products set price_kobo =  2500000 where code = 'senior_case_review_credit';

update public.service_products
   set price_kobo   = 1500000,
       name         = 'Result Consultation',
       description  = 'A fifteen-minute video consultation in which a doctor takes you through a specific laboratory or imaging result: what each figure means, what it does and does not indicate, and what to do next.'
 where code = 'result_interpretation_credit';

-- ---------------------------------------------------------------------------
-- 2. Written Result Interpretation -- the commercial replacement for lab margin
--
-- Deliberately not tied to a Tarragon lab order. A patient uploads a result
-- from any laboratory in the country, or from a hospital, or a photograph of a
-- printed report, and a doctor writes back what it means. That makes it
-- sellable to someone who has never used Tarragon for anything else, and it is
-- the only paid product on the platform with no dependency on a partner,
-- a negotiated rate or a fulfilment chain.
-- ---------------------------------------------------------------------------

insert into public.service_products
  (code, name, description, price_kobo, currency, access_duration_days, features, is_active)
values
  ('written_result_interpretation',
   'Written Result Interpretation',
   'Upload any laboratory or imaging result, from any provider, and a doctor will read it and write back what it means in plain language: which figures are outside the normal range, what that does and does not indicate, and what you should do next. The result and the interpretation are both kept on your record, so next year''s result is a trend rather than another isolated number.',
   -- features is deliberately EMPTY, and this is load-bearing rather than an
   -- omission. public.redeem_available_service_purchase stamps redeemed_at but
   -- leaves status = 'active', and private.patient_has_feature_access checks
   -- status and expires_at WITHOUT checking redeemed_at. A feature listed on a
   -- consumable credit would therefore stay granted for the credit's whole
   -- lifetime after it had been spent -- 730 days, under the expiry change in
   -- the migration that follows. Consumable credits are enforced by their own
   -- redemption path; only duration products (the monitoring cover, the AI
   -- Coach pass, the chronic programme) may carry features.
   750000, 'NGN', 730,
   array[]::text[],
   true)
on conflict (code) do update
  set name                 = excluded.name,
      description          = excluded.description,
      price_kobo           = excluded.price_kobo,
      access_duration_days  = excluded.access_duration_days,
      features             = excluded.features,
      is_active            = true;

-- ---------------------------------------------------------------------------
-- 3. Verified Digital Document, split by type
--
-- One flat 4,000 price covered every document equally, which underpriced the
-- work on the harder ones and made the whole line read as a favour rather than
-- a product. Each type is now its own service_product so it can be priced, and
-- so the delivery-cost model added later in this series can attach a
-- minutes-per-unit and a required tier to each one individually.
--
-- On what these documents can and cannot be: see the enum migration
-- immediately before this one. Nothing here certifies fitness for employment
-- or supports an immigration application, and no future migration should add a
-- type that does.
-- ---------------------------------------------------------------------------

insert into public.service_products
  (code, name, description, price_kobo, currency, access_duration_days, features, is_active)
values
  ('verified_document_fit_to_work',
   'Fitness-to-Work Letter',
   'A doctor-signed letter confirming your fitness to work, or the adjustments you need, based on the condition we already manage for you. Because it draws on months of your own readings rather than a single appointment, it carries more evidence than a one-off note. It is not a pre-employment medical examination and does not replace one.',
   750000, 'NGN', 730, array[]::text[], true),

  ('verified_document_return_to_work',
   'Return-to-Work Letter',
   'A doctor-signed letter confirming you are well enough to return after an illness we have been tracking, with any adjustments your employer should make.',
   750000, 'NGN', 730, array[]::text[], true),

  ('verified_document_medication_carry_letter',
   'Medication Carry Letter',
   'A doctor-signed letter listing the medicines you carry, their doses and why you need them, for airport security, customs and border officials. Written in the form officials expect, and verifiable online by anyone who scans it.',
   750000, 'NGN', 730, array[]::text[], true),

  ('verified_document_school_health_form',
   'School Health Form',
   'A doctor-signed summary of your child''s health record and immunisation history for a school, nursery or sports club, drawn from the vaccination certificates already verified on their record.',
   750000, 'NGN', 730, array[]::text[], true),

  ('verified_document_travel_health_certificate',
   'Travel Health Letter',
   'A doctor-signed letter confirming your condition is stable enough for air travel, listing the medicines you carry and any assistance you need. Written for airlines and travel insurers. It is not an immigration or visa medical, which must come from a panel physician designated by the destination country.',
   1000000, 'NGN', 730, array[]::text[], true),

  ('verified_document_specialist_referral_letter',
   'Specialist Referral Letter',
   'A doctor-signed referral to a named specialist or hospital department, setting out your history, current medicines, recent results and the specific question being asked, so the specialist starts from your full record rather than from the beginning.',
   1000000, 'NGN', 730, array[]::text[], true),

  ('verified_document_insurance_medical_summary',
   'Insurance Medical Summary',
   'A doctor-signed summary of your medical record prepared for an insurer or health plan: diagnoses, current medicines, recent results and how well each condition is controlled. The most detailed of the documents we issue, and priced accordingly.',
   1500000, 'NGN', 730, array[]::text[], true)

on conflict (code) do update
  set name                 = excluded.name,
      description          = excluded.description,
      price_kobo           = excluded.price_kobo,
      access_duration_days  = excluded.access_duration_days,
      is_active            = true;

-- The flat product is retired rather than deleted: nine service_purchases exist
-- live, and an unredeemed credit against this code must keep working. The
-- trigger below falls back to it for exactly that reason.
update public.service_products
   set is_active   = false,
       description = 'Retired 2026-09-10, replaced by a priced product for each document type. Credits already bought against this code are still honoured; see private.enforce_verified_document_credit.'
 where code = 'verified_document_credit';

-- ---------------------------------------------------------------------------
-- 4. The credit trigger learns about document types
--
-- Previously it demanded 'verified_document_credit' regardless of what was
-- being requested. It now demands the credit matching the requested type, and
-- falls back to a legacy flat credit if the patient still holds one, so nobody
-- who bought under the old model loses what they paid for.
-- ---------------------------------------------------------------------------

create or replace function private.enforce_verified_document_credit()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_code text;
begin
  new.id := coalesce(new.id, gen_random_uuid());
  v_code := 'verified_document_' || new.document_type::text;

  -- Preferred: the credit for this specific document type.
  begin
    perform public.redeem_available_service_purchase(
      new.patient_id, v_code, 'verified_document', new.id
    );
    return new;
  exception when others then
    if sqlerrm not like 'no available%' then
      raise;
    end if;
  end;

  -- Fallback: a flat credit bought before 2026-09-10, when one product covered
  -- every document type. Honoured for as long as any remain unredeemed.
  begin
    perform public.redeem_available_service_purchase(
      new.patient_id, 'verified_document_credit', 'verified_document', new.id
    );
    return new;
  exception when others then
    if sqlerrm like 'no available%' then
      raise exception 'Buy the credit for this document type to request it.'
        using errcode = 'P0001', detail = 'VERIFIED_DOCUMENT_CREDIT_REQUIRED';
    end if;
    raise;
  end;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 5. Assertions
-- ---------------------------------------------------------------------------

do $$
declare
  v_video_product bigint;
  v_video_booking bigint;
  v_doc_products  int;
  v_dupe          int;
begin
  select price_kobo into v_video_product
    from public.service_products where code = 'video_visit_credit';
  select amount_minor into v_video_booking
    from public.video_visit_prices where organisation_id is null and is_enabled;

  if v_video_product is distinct from v_video_booking then
    raise exception 'FAIL: video visit still has two prices -- product % vs booking screen %',
      v_video_product, v_video_booking;
  end if;

  select count(*) into v_doc_products
    from public.service_products
   where code like 'verified_document\_%' and is_active;
  if v_doc_products <> 7 then
    raise exception 'FAIL: expected 7 active verified document products, found %', v_doc_products;
  end if;

  -- Every active document type must have a product, or requesting it 500s.
  select count(*) into v_dupe
    from unnest(enum_range(null::public.verified_document_type)) t
   where not exists (
     select 1 from public.service_products p
      where p.code = 'verified_document_' || t::text and p.is_active
   );
  if v_dupe <> 0 then
    raise exception 'FAIL: % verified_document_type value(s) have no priced product', v_dupe;
  end if;

  if not exists (select 1 from public.service_products
                  where code = 'written_result_interpretation' and is_active and price_kobo = 750000) then
    raise exception 'FAIL: Written Result Interpretation is not live at 7,500';
  end if;

  raise notice 'PASS: ladder re-priced, video visit unified at %, % document products live',
    v_video_product / 100, v_doc_products;
end $$;

commit;
