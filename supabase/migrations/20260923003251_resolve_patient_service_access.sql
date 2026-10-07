-- A founder-commissioned launch-scope audit (a local document, not tracked in
-- this repo -- see the PR description for the one seen when this was written)
-- calls for a single server-side read model that answers "what clinician-
-- backed service does this patient currently have, if any" -- so the app
-- never has to infer that from scattered entitlement tables, and so a patient
-- is never shown (or led to believe) a monitoring relationship that isn't
-- actually funded.
--
-- Deliberately NOT a new "journey" table: this codebase has a standing rule
-- against parallel state tables that re-derive what an existing table already
-- owns (see CLAUDE.md's Annual Health Review rule and the wearables "no dual
-- source of truth" rule). Every fact this function returns is read live from
-- service_purchases + service_products, the general doctor-time-entitlement
-- ledger that already is the source of truth. "Active" = status = 'active'
-- AND (expires_at IS NULL OR expires_at > now()) -- the exact predicate
-- private.patient_has_feature_access and public.has_feature_access already
-- use, copied here rather than reinvented.
--
-- Deliberately does NOT touch annual_health_checks yet: a first version of
-- this migration also classified a "review_in_progress" state from
-- annual_health_checks.review_requested_at/.reviewed_at, but that column pair
-- is owned by the still-unmerged Preventive Health Check Review SKU work
-- (fix/launch-scope-reconciliation-20260922, not yet in main-dev) -- this
-- branch has no migration that creates it, so a fresh `supabase db reset`
-- replay of this branch alone would fail with "column does not exist" even
-- though it appeared to work when tested live against the shared project
-- (which already carries that other branch's schema). Caught by code review
-- before merge. Add that state back in a follow-up once the owning branch
-- merges, rather than duplicating its column here.
--
-- Access model copied from public.care_receipt (20260807012000_care_receipt.sql):
-- the caller may read a patient's own status, a caregiver holding a live
-- (non-expired) profile_access grant on that patient, or org staff of the
-- patient's own organisation. private.is_org_staff(org uuid) takes the org
-- explicitly (confirmed live via pg_proc -- it is not a bare no-arg check), so
-- this resolves the patient's organisation_id from public.profiles.

create or replace function public.resolve_patient_service_access(p_patient_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := (select auth.uid());
  v_authorized boolean := false;
  v_patient_org uuid;
  v_monitoring_code text;
  v_monitoring_expires_at timestamptz;
  v_has_other_active_purchase boolean;
  v_status text;
begin
  if v_caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  if v_caller = p_patient_id then
    v_authorized := true;
  end if;

  if not v_authorized then
    select exists(
      select 1 from public.profile_access
       where profile_id = p_patient_id
         and grantee_user_id = v_caller
         and (expires_at is null or expires_at > now())
    ) into v_authorized;
  end if;

  if not v_authorized then
    select organisation_id into v_patient_org
      from public.profiles
     where id = p_patient_id;

    if v_patient_org is not null then
      select private.is_org_staff(v_patient_org) into v_authorized;
    end if;
  end if;

  if not v_authorized then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select prod.code, sp.expires_at
    into v_monitoring_code, v_monitoring_expires_at
    from public.service_purchases sp
    join public.service_products prod on prod.id = sp.service_product_id
   where sp.patient_id = p_patient_id
     and sp.status = 'active'
     and (sp.expires_at is null or sp.expires_at > now())
     and prod.code like 'continuous_monitoring_%'
   order by sp.expires_at desc nulls last
   limit 1;

  select exists(
    select 1 from public.service_purchases sp
     where sp.patient_id = p_patient_id
       and sp.status = 'active'
       and (sp.expires_at is null or sp.expires_at > now())
       and sp.service_product_id != all(
         array(
           select prod.id from public.service_products prod
            where prod.code like 'continuous_monitoring_%'
         )
       )
  ) into v_has_other_active_purchase;

  if v_monitoring_code is not null then
    v_status := 'monitoring_active';
  elsif v_has_other_active_purchase then
    v_status := 'service_active';
  else
    v_status := 'self_tracking';
  end if;

  return jsonb_build_object(
    'status', v_status,
    'monitoringExpiresAt', v_monitoring_expires_at,
    'resolvedAt', now()
  );
end;
$$;

revoke all on function public.resolve_patient_service_access(uuid) from public, anon;
grant execute on function public.resolve_patient_service_access(uuid) to authenticated;
