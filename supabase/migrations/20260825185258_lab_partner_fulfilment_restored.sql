-- Restore partner-lab fulfilment for lab tests — Synlab Nigeria is now a real,
-- signed, nationwide lab partner.
--
-- WHY: the 2026-08-03 self-arranged-fulfilment decision (20260803124833) was
-- made because Tarragon had zero real contracted lab partners — every
-- lab_providers row was a placeholder with an .example contact, so "the
-- patient takes our request to any lab and pays them directly" was the only
-- honest posture. That migration's own header called this "sequencing, not a
-- business-model reversal": nothing was dropped, the partner catalogues went
-- is_active = false, and "contracting a real lab is then a single UPDATE, not
-- a migration." This is that UPDATE.
--
-- FOUNDER DECISION 2026-08-25: Synlab Nigeria is now a real signed partner,
-- covering every Synlab location nationwide (Lagos, Abuja, and elsewhere via
-- home collection — Synlab's home_collection flag is already true). Tarragon
-- goes back to booking and billing lab tests (commission to Synlab), exactly
-- as it worked before 2026-08-03.
--
-- SCOPE IS LABS ONLY. Pharmacy collection and specialist referrals are
-- deliberately untouched and remain self-arranged — pharmacy_partners and
-- specialist_providers are NOT reactivated here, enforce_referral_fulfilment
-- is not touched, and specialist_referrals.fulfilment keeps its
-- 'self_arranged' default. Reactivating service_regions nationwide is safe
-- for those other services precisely because their partner catalogues stay
-- dormant: region_service_available requires BOTH the state master switch
-- AND an active partner of that specific service type, so this migration
-- cannot silently unlock pharmacy/specialist/home_visit/delivery anywhere.
--
-- Reversible, like the migration it undoes: no enum value, table, column,
-- policy, or role is dropped. enforce_lab_order_origin and
-- enforce_lab_order_region need NO changes — both already fully support the
-- partner path (that's what they were written for originally), and
-- self-arranged stays legal-but-dormant for labs, same "dormant not deleted"
-- pattern this codebase already uses everywhere else.

-- ---------------------------------------------------------------------------
-- 1. New lab orders default to partner-fulfilled.
-- ---------------------------------------------------------------------------
alter table public.lab_orders
  alter column fulfilment set default 'partner';

comment on column public.lab_orders.fulfilment is
  'partner = Tarragon routes and bills it (Synlab Nigeria, restored 2026-08-25 — the default for new lab orders). self_arranged = patient uses any lab and uploads the result; carries no provider, no facility and no charge. Still legal but no longer offered by the app for new lab orders.';

-- ---------------------------------------------------------------------------
-- 2. Activate Synlab Nigeria, nationwide. Every other lab_providers row
--    (Cerba Lancet, Healthtracka, Afriglobal Medicare) stays dormant — only
--    Synlab is actually contracted.
-- ---------------------------------------------------------------------------
update public.lab_providers
set is_active = true,
    regions = array[
      'Abia','Adamawa','Akwa Ibom','Anambra','Bauchi','Bayelsa','Benue','Borno',
      'Cross River','Delta','Ebonyi','Edo','Ekiti','Enugu','Gombe','Imo','Jigawa',
      'Kaduna','Kano','Katsina','Kebbi','Kogi','Kwara','Lagos','Nasarawa','Niger',
      'Ogun','Ondo','Osun','Oyo','Plateau','Rivers','Sokoto','Taraba','Yobe',
      'Zamfara','Abuja'
    ]
where name = 'Synlab Nigeria';

-- Its physical facilities (Ikeja, Wuse) were never explicitly deactivated by
-- the 2026-08-03 migration (only lab_providers/pharmacy_partners were), but
-- this is idempotent insurance rather than an assumption.
update public.facilities f
set is_active = true
from public.lab_providers lp
where f.lab_provider_id = lp.id
  and lp.name = 'Synlab Nigeria'
  and not f.is_active;

-- ---------------------------------------------------------------------------
-- 3. Nationwide launch: flip every state's master switch on. Safe for
--    pharmacy/specialist/home_visit/delivery — see header note above.
-- ---------------------------------------------------------------------------
update public.service_regions
set is_active = true, activated_at = coalesce(activated_at, now())
where not is_active;

-- ---------------------------------------------------------------------------
-- 4. sponsor_book_care restored to the partner-priced version (from
--    20260731215735_retire_health_wallet.sql, the last definition before the
--    2026-08-03 sweep broke it), adapted so a facility is optional: with only
--    one active partner, the provider resolves to Synlab even when the
--    supporter doesn't pick a specific facility (home collection covers it).
--    The voucher-redemption tail is kept verbatim — inert today (no
--    prepaid_service voucher can be purchased while purchase_care_voucher
--    stays hard-failed, out of scope for this change), but ready the moment
--    that changes, same dormant-not-deleted posture as everything else here.
-- ---------------------------------------------------------------------------
create or replace function public.sponsor_book_care(
  p_beneficiary uuid,
  p_bundle_code text,
  p_facility_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_caller   uuid := auth.uid();
  v_org      uuid;
  v_bundle   uuid;
  v_price    bigint;
  v_provider uuid;
  v_order    uuid;
  v_voucher  uuid;
  v_paid     boolean := false;
begin
  if v_caller is null then raise exception 'not authenticated'; end if;

  if not exists (
    select 1 from public.profile_access pa
     where pa.profile_id = p_beneficiary
       and pa.grantee_user_id = v_caller
       and pa.permission_level = 'manage'
  ) then
    raise exception 'you do not have permission to book care for this person'
      using errcode = '42501';
  end if;

  -- Only ever the self-bookable catalogue. Same narrow door the patient's own
  -- booking card uses, not a general ordering power.
  select pb.id, pb.price_kobo into v_bundle, v_price
    from public.panel_bundles pb
   where pb.code = p_bundle_code and pb.self_bookable;
  if v_bundle is null then
    raise exception 'that check is not available to book directly' using errcode = '42501';
  end if;

  select organisation_id into v_org from public.profiles where id = p_beneficiary;
  if v_org is null then raise exception 'that person has no organisation on file'; end if;

  if p_facility_id is not null then
    select f.lab_provider_id into v_provider
      from public.facilities f
     where f.id = p_facility_id and f.is_active;
  end if;

  -- No facility chosen: fall back to the single active lab partner (Synlab)
  -- rather than leaving the order provider-less — home collection covers
  -- every state, so a facility pick is a convenience, not a requirement.
  if v_provider is null then
    select id into v_provider from public.lab_providers where is_active limit 1;
  end if;

  insert into public.lab_orders
    (organisation_id, patient_id, status, total_kobo, origin,
     panel_bundle_id, facility_id, provider_id)
  values
    (v_org, p_beneficiary, 'pending_payment', v_price, 'patient_initiated',
     v_bundle, p_facility_id, v_provider)
  returning id into v_order;

  -- Settle from an already-bought voucher for THIS service if one is waiting.
  -- Oldest expiry first, so the one closest to lapsing is used before a newer one.
  select id into v_voucher
    from public.care_vouchers
   where beneficiary_profile_id = p_beneficiary
     and kind = 'prepaid_service'
     and panel_bundle_id = v_bundle
     and status = 'active'
     and (expires_at is null or expires_at > now())
   order by expires_at nulls last, created_at
   limit 1;

  if v_voucher is not null then
    perform public.redeem_care_voucher(v_voucher, 'lab', v_order);
    v_paid := true;
  end if;

  return jsonb_build_object(
    'ok', true,
    'order_id', v_order,
    'paid', v_paid,
    'price_kobo', v_price,
    'voucher_id', v_voucher
  );
end;
$function$;

-- set_lab_order_facility and enforce_lab_order_origin/_region need NO
-- changes: set_lab_order_facility already works correctly for
-- fulfilment='partner' orders in 'pending_payment' (rewritten 2026-08-03 to
-- explain itself on self-arranged orders, otherwise untouched), and the two
-- guard triggers already branch on fulfilment exactly as this migration
-- needs. private.enqueue_lab_order_lab_notifications (fires on
-- status -> payment_confirmed) and the annual-health-check payment_confirmed
-- linkage branch (20260811225324, written "for the day a partner-billed path
-- is live again") also need no changes — they start firing again now that
-- payment_confirmed is reachable.

-- ---------------------------------------------------------------------------
-- The migration is the test.
-- ---------------------------------------------------------------------------
do $$
declare
  v_default text;
  v_synlab_active boolean;
  v_sponsor_def text;
  v_inactive_regions int;
begin
  select column_default into v_default
    from information_schema.columns
   where table_schema = 'public' and table_name = 'lab_orders' and column_name = 'fulfilment';
  if v_default not like '%partner%' then
    raise exception 'lab_orders.fulfilment default was not switched to partner';
  end if;

  select is_active into v_synlab_active from public.lab_providers where name = 'Synlab Nigeria';
  if not coalesce(v_synlab_active, false) then
    raise exception 'Synlab Nigeria is not active';
  end if;

  if not public.region_service_available('Lagos', 'lab') then
    raise exception 'lab is not available in Lagos post-migration';
  end if;
  if not public.region_service_available('Kano', 'lab') then
    raise exception 'lab is not nationwide — Kano is not covered';
  end if;

  -- Out of scope must stay dormant: no pharmacy/specialist service should
  -- have become available anywhere as a side effect of the regions flip.
  if public.region_service_available('Lagos', 'pharmacy') then
    raise exception 'pharmacy became available as a side effect — out of scope';
  end if;
  if public.region_service_available('Lagos', 'specialist') then
    raise exception 'specialist became available as a side effect — out of scope';
  end if;

  select count(*) into v_inactive_regions from public.service_regions where not is_active;
  if v_inactive_regions <> 0 then
    raise exception 'not every state was activated';
  end if;

  select pg_get_functiondef(oid) into v_sponsor_def
    from pg_proc where proname = 'sponsor_book_care' and pronamespace = 'public'::regnamespace;
  if v_sponsor_def like '%self_arranged%' then
    raise exception 'sponsor_book_care still issues a self-arranged order';
  end if;
  if v_sponsor_def not like '%pending_payment%' then
    raise exception 'sponsor_book_care does not restore the priced booking flow';
  end if;

  -- Reversibility: nothing was deleted.
  if (select count(*) from public.lab_providers) <> 4 then
    raise exception 'a lab provider row was deleted rather than left dormant';
  end if;
  if (select count(*) from public.lab_providers where is_active) <> 1 then
    raise exception 'more than one lab provider is active — only Synlab should be';
  end if;
end;
$$;
