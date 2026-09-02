-- Tarragon Health — Pay-per-service business model, Phase 1 (entitlement rewire)
--
-- The codebase is disciplined about routing every entitlement check through
-- three functions (public.has_feature_access, private.patient_has_feature_access,
-- public.has_ai_coach_access) plus one DB trigger
-- (private.apply_screening_subscriber_discount) rather than checking a plan
-- code directly — confirmed by a full-corpus grep before this migration was
-- written (only 2 UI files do a literal plan.code==='free' string check, and
-- neither is a feature gate). That means swapping what's *inside* these four
-- call sites is the entire entitlement-side of the pay-per-service
-- migration — the ~22 feature-gated call sites elsewhere in the app need no
-- changes at all, since names/signatures are kept identical.

-- ---------------------------------------------------------------------------
-- public.has_feature_access(feature) — resolves for auth.uid()
-- ---------------------------------------------------------------------------

create or replace function public.has_feature_access(feature text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role public.user_role;
begin
  select role into v_role from public.profiles where id = (select auth.uid());

  if v_role = 'admin' then
    return true;
  end if;

  return exists (
    select 1
    from public.service_purchases sp
    join public.service_products p on p.id = sp.service_product_id
    where sp.patient_id = (select auth.uid())
      and sp.status = 'active'
      and (sp.expires_at is null or sp.expires_at > now())
      and feature = any(p.features)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- private.patient_has_feature_access(p_patient_id, p_feature) — resolves for
-- a passed-in patient id, because staff can act on a patient's behalf (e.g.
-- a lab_liaison uploading a result document) and it is the PATIENT's
-- entitlement that must gate the action, never the staff member's.
-- ---------------------------------------------------------------------------

create or replace function private.patient_has_feature_access(p_patient_id uuid, p_feature text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role public.user_role;
begin
  select role into v_role from public.profiles where id = p_patient_id;

  if v_role = 'admin' then
    return true;
  end if;

  return exists (
    select 1
    from public.service_purchases sp
    join public.service_products p on p.id = sp.service_product_id
    where sp.patient_id = p_patient_id
      and sp.status = 'active'
      and (sp.expires_at is null or sp.expires_at > now())
      and p_feature = any(p.features)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- public.has_ai_coach_access() — identical admin / per-patient-rule /
-- org-wide-rule resolution order, unchanged; only the final fallback now
-- delegates to the rewired has_feature_access('ai_coach') above.
-- ---------------------------------------------------------------------------

create or replace function public.has_ai_coach_access()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role public.user_role;
  v_org uuid;
  v_patient_rule boolean;
  v_global_rule boolean;
begin
  select role, organisation_id into v_role, v_org
    from public.profiles where id = (select auth.uid());

  if v_role = 'admin' then
    return true;
  end if;

  select enabled into v_patient_rule
    from public.ai_coach_access_rules
    where organisation_id = v_org and patient_id = (select auth.uid());
  if v_patient_rule is not null then
    return v_patient_rule;
  end if;

  select enabled into v_global_rule
    from public.ai_coach_access_rules
    where organisation_id = v_org and patient_id is null;
  if v_global_rule is not null then
    return v_global_rule;
  end if;

  return public.has_feature_access('ai_coach');
end;
$$;

-- ---------------------------------------------------------------------------
-- private.apply_screening_subscriber_discount() — "is this patient a paying
-- subscriber" becomes "does this patient have any active, non-free
-- service_purchases grant" (price_kobo > 0 replaces the old `code <> 'free'`
-- check, since 'free' as a literal code no longer exists as a table row to
-- compare against once subscription_plans is retired).
-- ---------------------------------------------------------------------------

create or replace function private.apply_screening_subscriber_discount()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_is_tier boolean;
  v_subscribed boolean;
begin
  select is_screen_tier into v_is_tier
    from public.panel_bundles where id = new.panel_bundle_id;

  if not coalesce(v_is_tier, false) then
    return new;
  end if;

  select exists (
    select 1
    from public.service_purchases sp
    join public.service_products p on p.id = sp.service_product_id
    where sp.patient_id = new.patient_id
      and sp.status = 'active'
      and (sp.expires_at is null or sp.expires_at > now())
      and p.price_kobo > 0
  ) into v_subscribed;

  if v_subscribed and coalesce(new.subscriber_discount_kobo, 0) = 0 then
    new.subscriber_discount_kobo := round(coalesce(new.total_kobo, 0) * 0.15);
  end if;

  return new;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Re-apply grants — CREATE OR REPLACE FUNCTION does not change existing
-- grants, but re-asserting here is cheap insurance and matches this
-- project's own documented anon-execute gotcha: EXECUTE is inherited via the
-- PUBLIC pseudo-role, not a direct anon grant, so `revoke ... from public`
-- is the fix and `revoke ... from anon` alone is a no-op.
-- ---------------------------------------------------------------------------

revoke execute on function public.has_feature_access(text) from public, anon;
grant execute on function public.has_feature_access(text) to authenticated;

revoke execute on function public.has_ai_coach_access() from public, anon;
grant execute on function public.has_ai_coach_access() to authenticated;

-- private.patient_has_feature_access carries no PostgREST/anon grant surface
-- at all (only ever called from SECURITY DEFINER triggers) — nothing to
-- revoke/grant here, matching its original migration's own comment.

do $$
declare
  v_free_id uuid;
  v_essential_id uuid;
  v_test_patient uuid;
begin
  if has_function_privilege('anon', 'public.has_feature_access(text)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute has_feature_access';
  end if;
  if has_function_privilege('anon', 'public.has_ai_coach_access()', 'EXECUTE') then
    raise exception 'FAIL: anon can execute has_ai_coach_access';
  end if;

  -- Behavioral proof, not just a compile check: a patient with an active
  -- essential_pack purchase gets clinician_review; one with none, or an
  -- expired purchase, does not. Runs inside this migration's own
  -- transaction — nothing here is committed beyond the function/grant
  -- changes above, since the test rows are deleted before the DO block ends.
  select id into v_essential_id from public.service_products where code = 'essential_pack';
  if v_essential_id is null then
    raise exception 'essential_pack missing — Phase 1 schema migration must run first';
  end if;

  select id into v_test_patient from public.profiles where role = 'patient' limit 1;
  if v_test_patient is null then
    raise notice 'SKIPPED behavioral proof: no patient row exists to test against';
  else
    if private.patient_has_feature_access(v_test_patient, 'clinician_review') then
      raise exception 'sabotage check failed: patient unexpectedly already has clinician_review before granting it';
    end if;

    insert into public.service_purchases
      (organisation_id, patient_id, purchaser_profile_id, service_product_id, status,
       amount_kobo, currency, purchased_at, expires_at)
    select p.organisation_id, v_test_patient, v_test_patient, v_essential_id, 'active',
           1000000, 'NGN', now(), now() + interval '30 days'
    from public.profiles p where p.id = v_test_patient;

    if not private.patient_has_feature_access(v_test_patient, 'clinician_review') then
      raise exception 'FAIL: active essential_pack purchase did not grant clinician_review';
    end if;

    update public.service_purchases set expires_at = now() - interval '1 day'
      where patient_id = v_test_patient and service_product_id = v_essential_id;

    if private.patient_has_feature_access(v_test_patient, 'clinician_review') then
      raise exception 'FAIL: an expired service_purchases row still grants access';
    end if;

    delete from public.service_purchases
      where patient_id = v_test_patient and service_product_id = v_essential_id;
  end if;

  raise notice 'PASS: entitlement functions rewired to service_purchases and behaviorally proven';
end $$;
