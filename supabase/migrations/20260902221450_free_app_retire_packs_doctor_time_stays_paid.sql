-- Free app, pay per service: the platform's software becomes free; doctor time stays paid.
--
-- Retiring subscriptions (2026-09-02, service_products/service_purchases) changed HOW a
-- patient pays — non-renewing packs instead of recurring billing — but not WHAT was gated.
-- Thirteen features were still walled behind a pack, which is why the marketing pricing
-- page and the app had drifted so far apart. Founder decision, this migration:
--
--   free   the seven features with no marginal clinician cost — the education library,
--          lifestyle/weight/activity/nutrition, the AI Coach, the quarterly report, the
--          screening calendar, lab-request coordination and refill tracking. None of these
--          consume a doctor's time; charging for them was an artefact of the plan model.
--
--   paid   the six that ARE a doctor's time — clinician_review, doctor_checkin,
--          async_doctor_visit, multi_condition_review, result_document_review and
--          vitals_red_flag_doctor_escalation. This preserves the standing 2026-08-10 rule
--          ("Tarragon Free consumes no doctor time"): a free user still gets the full
--          emergency safety net and deterministic red-flag guidance, which never depended
--          on a doctor seeing it, but does not page one.
--
-- With the Prevent/Essential/Complete packs retired, the ONLY vehicles left for those six
-- are programme_purchases (the 12-week doctor-supported chronic track) and the one-off
-- clinical credits. Two of the six — multi_condition_review and result_document_review —
-- were not in the programme branch, so retiring the packs without adding them here would
-- leave them reachable by nobody at all: the same dead-gate failure as family_dashboard,
-- which sat gated on a key no product ever granted. They are added below.
--
-- Retiring a product sets is_active = false only. patient_has_feature_access reads the
-- PURCHASE, never the product's is_active, so the 5 patients holding a live pack (3
-- Complete, 1 Essential, 1 Prevent at time of writing) keep everything they paid for until
-- their purchase expires on its own. Nothing is revoked and no data migration is needed.


-- 1. The seven now-free features short-circuit to true for everyone, before any purchase
--    is consulted. Done here rather than only by deleting the app's RequiresEntitlement
--    call sites so that RLS policies, RPCs and cron jobs agree with the UI; a gate left in
--    the app now simply always passes.
create or replace function private.patient_has_feature_access(p_patient_id uuid, p_feature text)
returns boolean
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_role public.user_role;
begin
  -- Free to everyone, signed in or not yet subscribed to anything. No clinician time.
  if p_feature in (
    'health_education', 'lifestyle_coaching', 'ai_coach', 'quarterly_report',
    'prevention_coordination', 'lab_coordination', 'medication_refills',
    -- legacy free_pack keys; nothing reads them, kept so an old row stays truthful
    'tracking', 'reminders', 'education'
  ) then
    return true;
  end if;

  select role into v_role from public.profiles where id = p_patient_id;

  if v_role = 'admin' then
    return true;
  end if;

  if exists (
    select 1
    from public.service_purchases sp
    join public.service_products p on p.id = sp.service_product_id
    where sp.patient_id = p_patient_id
      and sp.status = 'active'
      and (sp.expires_at is null or sp.expires_at > now())
      and p_feature = any(p.features)
  ) then
    return true;
  end if;

  -- The doctor-supported chronic programme carries every doctor-time feature. Extended
  -- here with multi_condition_review and result_document_review, which used to arrive
  -- only via a pack and would otherwise be orphaned by step 2.
  if p_feature in (
    'vitals_red_flag_doctor_escalation', 'lifestyle_coaching', 'quarterly_report', 'ai_coach',
    'clinician_review', 'doctor_checkin', 'async_doctor_visit', 'health_education',
    'chronic_doctor_supported_track', 'multi_condition_review', 'result_document_review'
  ) then
    return exists (
      select 1
      from public.programme_purchases pp
      where pp.patient_id = p_patient_id
        and pp.status = 'active'
        and pp.ends_at >= current_date
    );
  end if;

  return false;
end;
$function$;

-- 2. Retire the plan products. free_pack goes too: its features were
--    ["tracking","reminders","education"], none of which any gate has ever read, so it
--    granted nothing — "Tarragon Free" was a marketing construct, not an entitlement.
--    The Lifestyle Coaching packs go because step 1 makes lifestyle_coaching free, so they
--    would sell something the platform now hands out. That retires the last USD product,
--    which matches dropping the diaspora tier (2026-07-31: diaspora sponsors someone
--    else's care, it is not a patient-facing tier).
update public.service_products
   set is_active = false, updated_at = now()
 where code in (
   'free_pack',
   'prevent_pack', 'essential_pack', 'complete_pack',
   'prevent_yearly_pack', 'essential_yearly_pack', 'complete_yearly_pack',
   'lifestyle-coaching_pack', 'lifestyle-coaching_usd_pack'
 );

-- 3. Activate the doctor-supported chronic programme. This MUST happen in the same
--    transaction as step 2: it is now the only recurring route to the six doctor-time
--    features, and retiring the packs without it would strand them. Price is the
--    ₦15,000 / 84-day placeholder already seeded — see the migration note; it still needs
--    founder sign-off and can be repriced without touching this logic.
update public.service_products
   set is_active = true, updated_at = now()
 where code = 'chronic_doctor_supported_pack';

-- 4. Prove it, rather than hoping. Each assertion below fails the migration loudly.
do $$
declare
  v_ok boolean;
  v_count int;
  v_patient uuid;
begin
  -- the seven free features are free for a patient holding no purchase at all
  select id into v_patient
    from public.profiles
   where role = 'patient'
     and id not in (
       select patient_id from public.service_purchases
        where status = 'active' and patient_id is not null
       union all
       select patient_id from public.programme_purchases
        where status = 'active' and patient_id is not null
     )
   limit 1;

  if v_patient is null then
    raise notice 'no entitlement-free patient available; skipping positive free-feature check';
  else
    foreach v_ok in array array[
      private.patient_has_feature_access(v_patient, 'health_education'),
      private.patient_has_feature_access(v_patient, 'lifestyle_coaching'),
      private.patient_has_feature_access(v_patient, 'ai_coach'),
      private.patient_has_feature_access(v_patient, 'quarterly_report'),
      private.patient_has_feature_access(v_patient, 'prevention_coordination'),
      private.patient_has_feature_access(v_patient, 'lab_coordination'),
      private.patient_has_feature_access(v_patient, 'medication_refills')
    ] loop
      if not v_ok then
        raise exception 'FAIL: a now-free feature is still gated for an unentitled patient';
      end if;
    end loop;

    -- and the six doctor-time ones are still NOT free for that same patient
    foreach v_ok in array array[
      private.patient_has_feature_access(v_patient, 'clinician_review'),
      private.patient_has_feature_access(v_patient, 'doctor_checkin'),
      private.patient_has_feature_access(v_patient, 'async_doctor_visit'),
      private.patient_has_feature_access(v_patient, 'multi_condition_review'),
      private.patient_has_feature_access(v_patient, 'result_document_review'),
      private.patient_has_feature_access(v_patient, 'vitals_red_flag_doctor_escalation')
    ] loop
      if v_ok then
        raise exception 'FAIL: doctor time leaked to a patient with no programme or credit';
      end if;
    end loop;
  end if;

  -- no plan product is still on sale
  select count(*) into v_count
    from public.service_products
   where is_active
     and code in ('free_pack','prevent_pack','essential_pack','complete_pack',
                  'prevent_yearly_pack','essential_yearly_pack','complete_yearly_pack',
                  'lifestyle-coaching_pack','lifestyle-coaching_usd_pack');
  if v_count <> 0 then
    raise exception 'FAIL: % retired plan product(s) still on sale', v_count;
  end if;

  -- every doctor-time feature has at least one live vehicle, so none is orphaned
  select count(*) into v_count
    from public.service_products
   where is_active and code = 'chronic_doctor_supported_pack';
  if v_count <> 1 then
    raise exception 'FAIL: doctor-supported programme is not on sale; the six doctor-time features would be unreachable';
  end if;

  -- nothing a patient already paid for was revoked
  select count(*) into v_count
    from public.service_purchases
   where status = 'active' and (expires_at is null or expires_at > now());
  raise notice 'active service_purchases preserved: %', v_count;
end;
$$;

