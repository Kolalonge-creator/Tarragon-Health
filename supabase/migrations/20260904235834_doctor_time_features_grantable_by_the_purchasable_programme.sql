-- Doctor-time entitlement was gated on a table no purchase path ever writes.
--
-- 20260902221450_free_app_retire_packs_doctor_time_stays_paid.sql retired the
-- Prevent/Essential/Complete packs (the only products whose features[] carried
-- 'vitals_red_flag_doctor_escalation' and friends) and left the six doctor-time
-- features reachable only through this branch of
-- private.patient_has_feature_access:
--
--     return exists (select 1 from public.programme_purchases pp where ...);
--
-- public.programme_purchases has 0 rows, has never had a row, and nothing in
-- apps/web/src writes to it (grep returns type definitions and DB tests only).
-- The real, live purchase path is public.service_purchases —
-- apps/web/src/lib/billing/purchase-service-product.ts and
-- apps/web/src/app/(dashboard)/patient/chronic-programme-actions.ts both sell
-- 'chronic_doctor_supported_pack', the one recurring paid product — and that
-- product was seeded in 20260831140512_service_products_and_purchases_core.sql
-- with features = array['chronic_doctor_supported_track'] and never amended.
--
-- So every doctor-time feature has been ungrantable to every real patient since
-- 2026-09-02. The consequence is not commercial-only: the seven live red-flag
-- handlers (handle_bp_reading_red_flag, handle_spo2_reading_red_flag,
-- handle_temperature_reading_red_flag, handle_pulse_reading_red_flag,
-- handle_symptom_red_flag, handle_symptom_triage_assessment,
-- handle_emergency_event) all consult
-- private.patient_has_feature_access(patient, 'vitals_red_flag_doctor_escalation')
-- before raising a clinician_alerts row. A patient who paid ₦50,000 for the
-- doctor-supported programme evaluated to false, so a dangerous BP reading paged
-- nobody, for anybody, platform-wide.
--
-- The patient-facing emergency safety net is untouched by this and always was:
-- emergency_events (acknowledge-gated hospital guidance, emergency-contact
-- notify, post-discharge check-in) fires before the feature check and is
-- plan-independent on every plan. This migration changes only the doctor-paging
-- half. No clinical threshold is touched.
--
-- WHY THIS DIRECTION (features on the purchasable product) RATHER THAN MAKING
-- THE PURCHASE PATH WRITE programme_purchases:
--   * service_purchases is the shipped billing path — Paystack init/verify,
--     voucher application (voucher_covered_kobo/applied_voucher_id), the
--     activation trigger in 20260902210000_fix_chronic_programme_two_track_gaps.sql,
--     and the patient UI all run through it. It has 9 rows, 4 active.
--   * programme_purchases is per-CONDITION (programme_id ->
--     chronic_condition_programmes) and every chronic_condition_programmes row
--     still has price_kobo = null, so its own price trigger
--     (private.set_programme_purchase_computed_price) fails closed. It is not a
--     purchasable thing today at all.
--   * Routing the pack's payment into programme_purchases would mean building a
--     SECOND billing path for a product that already sells, and would leave the
--     features[] column of the product a patient sees lying about what it grants.
--   * patient_has_feature_access already reads service_purchases first, so this
--     needs no change to the gate's structure — only to the product's own
--     description of itself. The programme_purchases branch is deliberately
--     LEFT IN PLACE as the fallback it already is (it costs nothing, and
--     20260831190512's reconciliation test depends on it).
--
-- Also fixed here: 'annual_review' appeared in NEITHER the free list nor the
-- programme list of patient_has_feature_access, so it returned false for every
-- patient on the platform including admins-by-purchase — which means
-- private.queue_annual_reviews() has been iterating an empty set and
-- /clinician/annual-reviews drains permanently to zero. It was bundled into
-- Complete Care by 20260731023001_complete_care_rebundle_annual_review.sql; with
-- Complete Care retired, the successor product for ongoing doctor-managed care is
-- the 12-week doctor-supported programme, so that is where it goes. It is doctor
-- time (a review consult plus workup), so it belongs on the paid side, not in the
-- free short-circuit list.


-- 1. The purchasable product now actually carries what it sells. Written as a
--    distinct-union so re-running or a later re-seed cannot duplicate an entry,
--    and so nothing already present is dropped.
update public.service_products
   set features = (
         select array(
           select distinct unnest(
             coalesce(features, '{}') || array[
               'vitals_red_flag_doctor_escalation',
               'clinician_review',
               'doctor_checkin',
               'async_doctor_visit',
               'multi_condition_review',
               'result_document_review',
               'annual_review',
               'chronic_doctor_supported_track'
             ]
           )
         )
       ),
       updated_at = now()
 where code = 'chronic_doctor_supported_pack';

-- Deliberately NOT touched: the one-off clinical credits
-- (async_consult_credit, video_visit_credit, second_opinion_credit,
-- verified_document_credit, senior_case_review_credit,
-- result_interpretation_credit, prescription_renewal_credit) keep features =
-- '{}'. They are consumed by redemption (service_purchases.redeemed_entity_*,
-- useHasAvailableServicePurchase), not by a standing feature flag; giving them a
-- feature key would turn a single consumable into unlimited standing access.
-- Also NOT touched: 'priority_escalation', which belonged to Complete Care only
-- and is asserted absent for programme holders by
-- packages/db/tests/feature_access_reconciliation.sql.


-- 2. Add 'annual_review' to the doctor-time list. Everything else in this
--    function is byte-identical to the live definition read with
--    pg_get_functiondef before this migration was written.
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

  -- The doctor-supported chronic programme carries every doctor-time feature.
  -- 'annual_review' added 2026-09-04: it was in neither list, so it resolved
  -- false for everyone and private.queue_annual_reviews() scheduled nothing.
  if p_feature in (
    'vitals_red_flag_doctor_escalation', 'lifestyle_coaching', 'quarterly_report', 'ai_coach',
    'clinician_review', 'doctor_checkin', 'async_doctor_visit', 'health_education',
    'chronic_doctor_supported_track', 'multi_condition_review', 'result_document_review',
    'annual_review'
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


-- 3. One source of truth for the app layer.
--
--    apps/web/src/lib/clinical/vitals-escalation-access.ts re-derived this
--    function in TypeScript for the glucose RED/AMBER path (the one red-flag
--    pathway that is not a DB trigger), because private.* is not
--    PostgREST-exposed. Its own header says: "Never duplicate this logic a third
--    time — if another gate like this turns up, call
--    private.patient_has_feature_access via an RPC instead of re-deriving it."
--    That duplicate had no programme_purchases branch at all, so it dead-ended by
--    a second, independent route. This is the RPC; the TS duplicate is deleted in
--    the same change.
--
--    public.has_feature_access(text) already exists but resolves auth.uid(), so
--    it cannot answer for an arbitrary patient from a service-role server action.
--    This overload takes the patient explicitly and is authorisation-checked:
--    the patient themselves, staff of the patient's organisation, or a
--    service_role caller. Anyone else gets an ERROR, never a quiet false — a
--    silent false is exactly the failure mode this migration exists to fix.
create or replace function public.patient_has_feature_access(p_patient_id uuid, p_feature text)
returns boolean
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_org uuid;
begin
  if p_patient_id is null or p_feature is null then
    return false;
  end if;

  select organisation_id into v_org from public.profiles where id = p_patient_id;

  if not (
    (select auth.uid()) = p_patient_id
    or coalesce((select auth.jwt() ->> 'role'), '') = 'service_role'
    or (v_org is not null and private.is_org_staff(v_org))
  ) then
    raise exception 'not authorised to read entitlements for this patient'
      using errcode = '42501';
  end if;

  return private.patient_has_feature_access(p_patient_id, p_feature);
end;
$function$;

comment on function public.patient_has_feature_access(uuid, text) is
  'Entitlement check for an explicit patient. The single source of truth for any '
  'server-side (service-role) gate; public.has_feature_access(text) remains the '
  'auth.uid() form for in-session RLS/UI checks. Raises 42501 rather than '
  'returning false when the caller may not ask.';

-- anon inherits EXECUTE through the PUBLIC pseudo-role, so the revoke must name
-- public, not anon (see feedback_supabase_anon_execute_gotcha).
revoke all on function public.patient_has_feature_access(uuid, text) from public;
grant execute on function public.patient_has_feature_access(uuid, text) to authenticated, service_role;


-- 4. Prove it in BOTH directions, with a fixture, inside a subtransaction that
--    is unwound before this migration commits.
--
--    20260902221450's own closing assertions only ever proved the gate is CLOSED
--    for an unentitled patient, and separately that the pack row is is_active.
--    Neither is a claim that any patient can OPEN it — which is why the defect
--    above shipped and sat live. A structural check on features[] plus a
--    functional check that a real active purchase of the real purchasable
--    product returns true is what was missing.
--
--    The inner block raises a private SQLSTATE after asserting; that unwinds the
--    fixture rows while PL/pgSQL variables (which are not transactional) carry
--    the verdict out.
do $$
declare
  v_fail   text;
  v_pack   uuid;
  v_feats  text[];
  v_k      text;
  v_org    uuid;
  v_paid   uuid := gen_random_uuid();
  v_free   uuid := gen_random_uuid();
begin
  -- 4a. structural: the product a patient can actually buy grants the keys
  select id, features into v_pack, v_feats
    from public.service_products
   where code = 'chronic_doctor_supported_pack' and is_active;
  if v_pack is null then
    raise exception 'FAIL: chronic_doctor_supported_pack is not on sale — the doctor-time features have no vehicle at all';
  end if;
  foreach v_k in array array[
    'vitals_red_flag_doctor_escalation', 'clinician_review', 'doctor_checkin',
    'async_doctor_visit', 'multi_condition_review', 'result_document_review',
    'annual_review', 'chronic_doctor_supported_track'
  ] loop
    if not (v_k = any(v_feats)) then
      raise exception 'FAIL: the purchasable programme does not grant %', v_k;
    end if;
  end loop;

  -- 4b. functional, both directions, against a real purchase of that product
  select organisation_id into v_org
    from public.profiles where role = 'patient' and organisation_id is not null limit 1;

  if v_org is null then
    raise notice 'no organisation has patient profiles; structural check only';
  else
    begin
      insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
      values
        (v_paid, 'dtf-paid@example.invalid', 'x', now(), '{}', '{}'),
        (v_free, 'dtf-free@example.invalid', 'x', now(), '{}', '{}');

      -- auth.users' own new-user trigger already creates a profiles row, hence
      -- the upsert rather than a plain insert.
      insert into public.profiles (id, organisation_id, role, full_name)
      values
        (v_paid, v_org, 'patient', 'DTF Paid Patient'),
        (v_free, v_org, 'patient', 'DTF Free Patient')
      on conflict (id) do update
        set organisation_id = excluded.organisation_id,
            role = excluded.role,
            full_name = excluded.full_name;

      insert into public.service_purchases
        (organisation_id, patient_id, purchaser_profile_id, service_product_id,
         status, amount_kobo, currency, purchased_at, expires_at)
      values
        (v_org, v_paid, v_paid, v_pack, 'active',
         (select price_kobo from public.service_products where id = v_pack),
         'NGN', now(), now() + interval '84 days');

      foreach v_k in array array[
        'vitals_red_flag_doctor_escalation', 'clinician_review', 'doctor_checkin',
        'async_doctor_visit', 'multi_condition_review', 'result_document_review',
        'annual_review'
      ] loop
        -- OPENS for the entitled patient (the direction never previously proven)
        if not private.patient_has_feature_access(v_paid, v_k) then
          v_fail := format('FAIL: a patient holding an active chronic_doctor_supported_pack purchase is denied %s', v_k);
          exit;
        end if;
        -- and stays CLOSED for the unentitled one
        if private.patient_has_feature_access(v_free, v_k) then
          v_fail := format('FAIL: a patient with no purchase at all was granted %s', v_k);
          exit;
        end if;
      end loop;

      raise exception using errcode = 'TG777', message = 'unwind fixture';
    exception
      when sqlstate 'TG777' then null;
    end;
  end if;

  if v_fail is not null then
    raise exception '%', v_fail;
  end if;

  raise notice 'PASS: the purchasable 12-week programme grants every doctor-time feature, and a patient with no purchase still gets none of them';
end;
$$;
