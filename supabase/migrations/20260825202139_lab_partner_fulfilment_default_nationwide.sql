-- Founder decision 2026-08-25: labs go back to partner fulfilment, nationwide,
-- now that the real partner-billing engine exists (see the reconciliation
-- migration immediately before this one). Scope is labs only — pharmacy
-- collection and specialist referrals stay self-arranged, untouched.
--
-- Everything the patient-facing flow needs (pricing, provider-cost
-- calculation, the below-cost guard, transmission queuing) already exists and
-- is exercised correctly by the reconciled trigger chain. This migration is
-- deliberately small: it only flips what was never switched on —
-- lab_orders.fulfilment's default, Synlab's coverage, and the region gate —
-- plus one RPC (sponsor_book_care) that still issued a self-arranged order.

-- ---------------------------------------------------------------------------
-- 1. New lab orders default to partner-fulfilled.
-- ---------------------------------------------------------------------------
alter table public.lab_orders
  alter column fulfilment set default 'partner';

-- ---------------------------------------------------------------------------
-- 2. Synlab Nigeria, nationwide. Every other lab_providers row stays
--    dormant — only Synlab is actually contracted.
-- ---------------------------------------------------------------------------
update public.lab_providers
set regions = array[
      'Abia','Adamawa','Akwa Ibom','Anambra','Bauchi','Bayelsa','Benue','Borno',
      'Cross River','Delta','Ebonyi','Edo','Ekiti','Enugu','Gombe','Imo','Jigawa',
      'Kaduna','Kano','Katsina','Kebbi','Kogi','Kwara','Lagos','Nasarawa','Niger',
      'Ogun','Ondo','Osun','Oyo','Plateau','Rivers','Sokoto','Taraba','Yobe',
      'Zamfara','Abuja'
    ]
where name = 'Synlab Nigeria' and is_active;

-- ---------------------------------------------------------------------------
-- 3. Nationwide launch: flip every state's master switch on. Safe for
--    pharmacy/specialist/home_visit/delivery — region_service_available also
--    requires an active partner of that specific service type, and those
--    catalogues stay dormant, so this alone cannot unlock them.
-- ---------------------------------------------------------------------------
update public.service_regions
set is_active = true, activated_at = coalesce(activated_at, now())
where not is_active;

-- ---------------------------------------------------------------------------
-- 4. sponsor_book_care: issues a partner-fulfilled order instead of a
--    self-arranged one. Deliberately minimal — total_kobo, partner_cost_kobo,
--    partner_cost_provider_id and transmission are all computed by the
--    trigger chain reconciled in the previous migration
--    (lab_orders_compute_review_price / _zz_never_below_partner_cost /
--    _queue_transmission), not set here. A facility is optional: with only
--    one active partner, private.resolve_lab_order_provider falls back to it
--    even when the supporter doesn't pick one (home collection covers it).
-- ---------------------------------------------------------------------------
create or replace function public.sponsor_book_care(
  p_beneficiary uuid,
  p_bundle_code text,
  p_facility_id uuid default null::uuid
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
  v_provider uuid;
  v_order    public.lab_orders%rowtype;
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
  select pb.id into v_bundle
    from public.panel_bundles pb
   where pb.code = p_bundle_code and pb.self_bookable;
  if v_bundle is null then
    raise exception 'that check is not available to book directly' using errcode = '42501';
  end if;

  select organisation_id into v_org from public.profiles where id = p_beneficiary;
  if v_org is null then raise exception 'that person has no organisation on file'; end if;

  -- provider_id (routing) is deliberately set from the facility here, same as
  -- set_lab_order_facility does post-creation — it is NOT the same column the
  -- pricing trigger fills in (partner_cost_provider_id, cost accounting
  -- only). Left null when no facility is named, exactly like a self-service
  -- booking with no facility chosen: ChooseLabFacility/set_lab_order_facility
  -- fills it in later.
  if p_facility_id is not null then
    select lab_provider_id into v_provider from public.facilities where id = p_facility_id and is_active;
  end if;

  insert into public.lab_orders
    (organisation_id, patient_id, status, origin, panel_bundle_id, fulfilment, facility_id, provider_id)
  values
    (v_org, p_beneficiary, 'pending_payment', 'patient_initiated', v_bundle, 'partner', p_facility_id, v_provider)
  returning * into v_order;

  return jsonb_build_object(
    'ok', true,
    'order_id', v_order.id,
    'total_kobo', v_order.total_kobo,
    'paid', false
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- The migration is the test.
-- ---------------------------------------------------------------------------
do $$
declare
  v_default text;
  v_synlab_regions int;
  v_inactive_regions int;
  v_sponsor_def text;
begin
  select column_default into v_default
    from information_schema.columns
   where table_schema = 'public' and table_name = 'lab_orders' and column_name = 'fulfilment';
  if v_default not like '%partner%' then
    raise exception 'lab_orders.fulfilment default was not switched to partner';
  end if;

  select array_length(regions, 1) into v_synlab_regions
    from public.lab_providers where name = 'Synlab Nigeria';
  if coalesce(v_synlab_regions, 0) < 37 then
    raise exception 'Synlab is not nationwide';
  end if;

  if not public.region_service_available('Lagos', 'lab') then
    raise exception 'lab is not available in Lagos post-migration';
  end if;
  if not public.region_service_available('Kano', 'lab') then
    raise exception 'lab is not nationwide — Kano is not covered';
  end if;
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
end;
$$;
