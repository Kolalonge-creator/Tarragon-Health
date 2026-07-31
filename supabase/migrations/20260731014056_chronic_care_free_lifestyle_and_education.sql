-- Tarragon Health
-- Chronic-care patients get lifestyle_coaching + health_education for free,
-- regardless of subscription tier. Founder decision 2026-07-31
-- (patient-experience review): these two features are core to managing a
-- chronic condition (diabetes/hypertension/etc.), not a premium add-on --
-- paywalling them worked against the "chronic care is the wedge" thesis.
-- "Chronic patient" = any active public.care_plans row, matching the
-- existing dual-state convention already used by getPatientPreventionStats()
-- (apps/web/src/app/(dashboard)/patient/summary.ts: "Any active care plan
-- means the patient is in a chronic programme").
--
-- Additive only -- the existing subscription/add-on resolution paths below
-- are byte-identical to the prior definition; this is a new early-return
-- clause, so a chronic patient who is ALSO paying for the feature via a
-- plan/add-on is unaffected, and a non-chronic patient's entitlement is
-- completely unaffected.
--
-- Verified live (rolled-back transaction against a real Free-tier patient
-- with no lifestyle_coaching/health_education grant): false before any
-- active care_plans row, true for both features once one exists, and an
-- unrelated feature (async_doctor_visit) stays false throughout -- proving
-- the clause is scoped to exactly these two feature keys, not a blanket
-- chronic-patient bypass.
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

  if feature in ('lifestyle_coaching', 'health_education') and exists (
    select 1 from public.care_plans
    where patient_id = (select auth.uid())
      and status = 'active'
  ) then
    return true;
  end if;

  return exists (
    select 1
    from public.subscriptions s
    join public.subscription_plans p on p.id = s.plan_id
    where s.subscriber_id = (select auth.uid())
      and s.status in ('active', 'trialing')
      and feature = any(p.features)
  ) or exists (
    select 1
    from public.subscription_add_ons sao
    join public.subscriptions s on s.id = sao.subscription_id
    join public.add_ons a on a.id = sao.add_on_id
    where s.subscriber_id = (select auth.uid())
      and sao.status in ('active', 'trialing')
      and feature = any(a.features)
  );
end;
$$;
