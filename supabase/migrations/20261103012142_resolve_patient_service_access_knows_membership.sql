-- public.resolve_patient_service_access() is the one read model behind the Home page's "what clinician-backed service do I have"
-- card (ServiceStatusCard). It was written on 2026-09-23 against service_purchases only, three weeks before the Membership model
-- (patient_memberships, 20261006104506) became the product Tarragon actually sells. Found 2026-11-03 on the founder's own test
-- account: an active Membership Plus, bought 2026-10-30, while Home said "Self-tracking: this account does not include a clinician
-- monitoring service" and the Vitals page, one tap away, said "As a Member, a doctor on your care team is told when one of your
-- readings is dangerous". Two screens, two answers.
--
-- This redefinition keeps the live body verbatim (read with pg_get_functiondef before writing, not from the 20260923 file) and adds
-- one branch in front: a Membership that public.my_membership() would call current (state = 'active', started, not past its end
-- plus the grace window from private.membership_grace_days()) resolves to 'membership_active', carrying the tier and the end date.
-- Membership wins over a continuous-monitoring purchase because it is the broader relationship; the rest of the ladder is unchanged.
-- Access rules (self, a live profile_access grantee, org staff of the patient's own organisation) are untouched.

create or replace function public.resolve_patient_service_access(p_patient_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_caller uuid := (select auth.uid());
  v_authorized boolean := false;
  v_patient_org uuid;
  v_monitoring_code text;
  v_monitoring_expires_at timestamptz;
  v_has_other_active_purchase boolean;
  v_status text;
  v_membership_tier text;
  v_membership_ends_at timestamptz;
  v_has_membership boolean := false;
  v_grace integer := private.membership_grace_days();
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

  -- The same predicate public.my_membership() uses to call a Membership current, so Home and the Membership page can never disagree.
  select m.tier, m.ends_at
    into v_membership_tier, v_membership_ends_at
    from public.patient_memberships m
   where m.patient_id = p_patient_id
     and m.state = 'active'
     and m.starts_at <= now()
     and (m.ends_at is null or m.ends_at + make_interval(days => v_grace) > now())
   order by m.starts_at desc
   limit 1;
  v_has_membership := found;

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

  if v_has_membership then
    v_status := 'membership_active';
  elsif v_monitoring_code is not null then
    v_status := 'monitoring_active';
  elsif v_has_other_active_purchase then
    v_status := 'service_active';
  else
    v_status := 'self_tracking';
  end if;

  return jsonb_build_object(
    'status', v_status,
    'monitoringExpiresAt', v_monitoring_expires_at,
    'membershipTier', v_membership_tier,
    'membershipEndsAt', v_membership_ends_at,
    'resolvedAt', now()
  );
end;
$function$;

comment on function public.resolve_patient_service_access(uuid) is
  'One read model for "what clinician-backed service does this patient have": membership_active (patient_memberships, same predicate as my_membership), else monitoring_active / service_active (service_purchases), else self_tracking. Callable by the patient, a live profile_access grantee, or org staff.';

-- Self-check: the function must still exist with its single-argument signature and the grants must be unchanged (execute for
-- authenticated, nothing for anon through PUBLIC).
do $$
begin
  if not has_function_privilege('authenticated', 'public.resolve_patient_service_access(uuid)', 'EXECUTE') then
    raise exception 'authenticated lost EXECUTE on resolve_patient_service_access';
  end if;
  if has_function_privilege('anon', 'public.resolve_patient_service_access(uuid)', 'EXECUTE') then
    raise exception 'anon can execute resolve_patient_service_access';
  end if;
end $$;
