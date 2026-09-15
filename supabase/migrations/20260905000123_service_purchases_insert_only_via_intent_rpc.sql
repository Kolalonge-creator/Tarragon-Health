-- ===========================================================================
-- CRITICAL: a patient could grant themselves any paid service, free.
--
-- public.service_purchases' INSERT policy had a WITH CHECK of only
--
--   purchaser_profile_id = auth.uid() OR private.is_org_staff(organisation_id)
--
-- `patient_id`, `service_product_id`, `status`, `amount_kobo`, `purchased_at`
-- and `expires_at` were all unconstrained, and `authenticated` held a
-- column-level INSERT grant on every one of them. So any signed-in patient
-- could POST at /rest/v1/service_purchases with
--
--   { purchaser_profile_id: <self>, patient_id: <self or anyone>,
--     service_product_id: <the ₦50,000 12-week doctor-supported programme>,
--     status: 'active', amount_kobo: 0, purchased_at: now,
--     expires_at: <far future> }
--
-- and hold a live entitlement to doctor time, paid for by nobody — including
-- a senior_case_review_credit claim on senior clinician time, and (with
-- patient_id set to someone else) an entitlement granted to a third party.
-- service_purchases_activate_chronic_doctor_supported fires AFTER INSERT on
-- status, so the fake row also activates the programme track.
--
-- The decisive fact is that NOTHING in the codebase inserts here directly.
-- Every legitimate path goes through public.record_service_purchase_intent
-- (SECURITY DEFINER, owned by postgres, prices the row server-side from
-- service_products and authorises the caller against private.is_org_staff).
-- Verified by grepping the whole repo — apps/web, apps/mobile, packages,
-- scripts and supabase/functions — for `from("service_purchases")`: seven
-- hits, all of them SELECT or a service-role UPDATE, none an INSERT.
--
-- So the INSERT policy and the column grants are pure attack surface with no
-- legitimate consumer. They are removed. record_service_purchase_intent is
-- unaffected: public.service_purchases is owned by postgres and does not
-- have FORCE ROW LEVEL SECURITY, so a SECURITY DEFINER function owned by
-- postgres neither consults the policy nor needs the `authenticated` grant.
-- ===========================================================================

drop policy if exists service_purchases_insert on public.service_purchases;

revoke insert on public.service_purchases from authenticated;

-- ---------------------------------------------------------------------------
-- Prove "removed" rather than assume it.
-- ---------------------------------------------------------------------------
do $$
declare
  v_cols text;
begin
  if exists (
    select 1 from pg_policy p join pg_class c on c.oid = p.polrelid
    where c.relname = 'service_purchases' and p.polcmd in ('a', '*')
  ) then
    raise exception 'an INSERT-capable policy still exists on service_purchases';
  end if;

  select string_agg(a.attname, ', ' order by a.attname) into v_cols
  from pg_attribute a
  where a.attrelid = 'public.service_purchases'::regclass
    and a.attnum > 0 and not a.attisdropped
    and has_column_privilege('authenticated', a.attrelid, a.attnum, 'INSERT');

  if v_cols is not null then
    raise exception 'authenticated still holds INSERT on service_purchases columns: %', v_cols;
  end if;

  -- The one legitimate way in must still exist, or this migration has
  -- removed the feature rather than the hole.
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'record_service_purchase_intent'
      and p.prosecdef
  ) then
    raise exception 'public.record_service_purchase_intent is missing or is no longer SECURITY DEFINER';
  end if;

  if not exists (
    select 1 from pg_class c
    where c.oid = 'public.service_purchases'::regclass
      and c.relrowsecurity and not c.relforcerowsecurity
      and pg_get_userbyid(c.relowner) = 'postgres'
  ) then
    raise exception 'service_purchases ownership/FORCE RLS changed — record_service_purchase_intent may no longer be able to insert';
  end if;

  -- Patients must still be able to READ their own purchases (the dashboard,
  -- the entitlement check and the payment-failure banner all depend on it).
  if not exists (
    select 1 from pg_policy p join pg_class c on c.oid = p.polrelid
    where c.relname = 'service_purchases' and p.polcmd in ('r', '*')
  ) then
    raise exception 'service_purchases has no SELECT policy left — patients can no longer read their own purchases';
  end if;
end;
$$;
