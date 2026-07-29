-- ---------------------------------------------------------------------------
-- Individual enrolment only.
--
-- Removal 4 of the four founder-approved narrowings (2026-07-29). One person,
-- one subscription. Family Lite/Plus/Premium, ParentCare and the per-extra-
-- member add-ons are deleted, and family_plan_members — the table that said
-- who was on somebody else's bill — goes with them.
--
-- What this does NOT remove is the ability for one person to look after
-- another's care. Two orthogonal models were tangled here and only one is a
-- billing construct:
--
--   family_plan_members  who is on the bill              <- deleted here
--   profile_access       who may see and act on a record <- kept, untouched
--
-- profile_access is consent-based and independent of payment. It already
-- carries consent-gated lipid visibility, child immunisation logging and the
-- reproductive-health surfaces, and its RLS already lets a record owner (and
-- only the record owner) grant, downgrade or revoke access to their own
-- record. That is the dependant model; it needed no billing relationship and
-- it does not acquire one now.
--
-- Row counts before this migration, which is why there is no data migration
-- step: family_plan_members 0, profile_access 0, subscriptions 0, and 0
-- subscription_add_ons on any extra-member add-on. Nothing is being taken away
-- from a paying customer.
--
-- Deletion order matters: 20260729140916 gave every diaspora row a
-- derived_from_code FK to its naira parent with ON DELETE RESTRICT, so the
-- GBP/USD rows must go before the naira rows they derive from.
-- ---------------------------------------------------------------------------

-- 1. Callers that resolved "may act for" through the bill ----------------------
-- These come first, before the table is dropped: patient_quarterly_reports_select
-- depends on family_plan_members, so Postgres refuses the DROP while the old
-- policy is still defined (and DROP ... CASCADE would silently leave the table
-- with one fewer policy than it needs, which is the wrong failure).
--
-- Both already accepted profile_access; they simply also accepted a shared
-- bill. Dropping the family_plan_members branch narrows them to consent alone,
-- which is the stricter of the two conditions, never the looser.

create or replace function private.can_fund_wallet(p_wallet uuid, p_payer uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.health_wallets w
    where w.id = p_wallet
      and (
        w.profile_id = p_payer
        or exists (
          select 1 from public.profile_access pa
          where pa.profile_id = w.profile_id and pa.grantee_user_id = p_payer
        )
      )
  );
$$;

comment on function private.can_fund_wallet(uuid, uuid) is
  'Who may top up a wallet: its owner, or someone the owner has granted '
  'profile_access. Not a diaspora-specific check and never was — a Lagos son '
  'funding his mother in Enugu passes it the same way.';

drop policy if exists patient_quarterly_reports_select on public.patient_quarterly_reports;
create policy patient_quarterly_reports_select on public.patient_quarterly_reports
  for select using (
    patient_id = (select auth.uid())
    or exists (
      select 1 from public.profile_access pa
      where pa.profile_id = patient_quarterly_reports.patient_id
        and pa.grantee_user_id = (select auth.uid())
    )
    or private.is_org_staff(organisation_id)
  );

-- 2. The membership table and its headcount trigger ---------------------------
-- validate_family_plan_member_count enforced the per-tier cap (4 on Family
-- Lite, more with the extra-member add-on, 2 on ParentCare). With no tier to
-- cap it is dead code, and leaving it behind is how the feature grows back.

drop trigger if exists family_plan_members_validate_count on public.family_plan_members;
drop function if exists private.validate_family_plan_member_count();
drop table if exists public.family_plan_members;

-- The relationship vocabulary existed only for that table. Removing the type
-- rather than orphaning it means re-introducing household billing now needs a
-- visible migration, the same discipline applied to outcomes_contract_type in
-- removal 1.
drop type if exists public.family_relationship;

-- 3. The plans themselves -------------------------------------------------------

delete from public.subscription_plans
 where derived_from_code is not null
   and (code like 'family%' or code like 'parentcare%');

delete from public.subscription_plans
 where code like 'family%' or code like 'parentcare%';

delete from public.add_ons
 where derived_from_code is not null
   and (code like 'extra-family-member%' or code like 'extra-parentcare-member%');

delete from public.add_ons
 where code like 'extra-family-member%' or code like 'extra-parentcare-member%';

-- 4. Feature keys the deleted tiers carried --------------------------------------
-- family_dashboard described a shared household view of a shared bill. There is
-- no such view any more, so the key is stripped from every remaining plan (it
-- should already be none) and must not be reintroduced.
--
-- dedicated_coordinator survives: it is still sold as the care-coordinator
-- add-on, which is what actually grants it outside the family tiers.
--
-- quarterly_report was granted only by Family Premium, ParentCare and Diaspora
-- Premium, so this removal would otherwise leave a built, working per-patient
-- PDF (its generator, its cron and its download route) reachable by nobody.
-- It moves to Complete Care, the comprehensive individual tier that already
-- carries annual_review and async_doctor_visit. That is a pricing judgement,
-- not a founder decision on record: reverse it by deleting this block.

update public.subscription_plans
   set features = array_remove(features, 'family_dashboard')
 where 'family_dashboard' = any(features);

update public.subscription_plans
   set features = array_append(features, 'quarterly_report')
 where derived_from_code is null
   and code in ('complete', 'complete_yearly')
   and not ('quarterly_report' = any(features));

update public.subscription_plans p
   set features = b.features
  from public.subscription_plans b
 where p.derived_from_code = b.code
   and p.derived_from_code in ('complete', 'complete_yearly')
   and p.features is distinct from b.features;

-- 5. Assertions -------------------------------------------------------------------
-- The migration is the test. If any part of household billing survived, this
-- block raises and the whole thing rolls back.

do $$
declare v_n int; v_bad text;
begin
  if to_regclass('public.family_plan_members') is not null then
    raise exception 'family_plan_members still exists';
  end if;
  if exists (select 1 from pg_type where typname = 'family_relationship') then
    raise exception 'family_relationship enum still exists';
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'private' and p.proname = 'validate_family_plan_member_count') then
    raise exception 'validate_family_plan_member_count still exists';
  end if;

  select count(*) into v_n from public.subscription_plans
   where code like 'family%' or code like 'parentcare%';
  if v_n <> 0 then raise exception '% family/ParentCare plan rows survived', v_n; end if;

  select count(*) into v_n from public.add_ons
   where code like 'extra-family-member%' or code like 'extra-parentcare-member%';
  if v_n <> 0 then raise exception '% extra-member add-on rows survived', v_n; end if;

  if exists (select 1 from public.subscription_plans where 'family_dashboard' = any(features)) then
    raise exception 'family_dashboard is still granted by a plan';
  end if;

  -- No function or policy may still resolve authority through the deleted table.
  select string_agg(n.nspname || '.' || p.proname, ', ') into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private') and p.prokind = 'f'
     and pg_get_functiondef(p.oid) ilike '%family_plan_members%';
  if v_bad is not null then raise exception 'functions still reference family_plan_members: %', v_bad; end if;

  select string_agg(c.relname || '.' || pol.polname, ', ') into v_bad
    from pg_policy pol join pg_class c on c.oid = pol.polrelid
   where pg_get_expr(pol.polqual, pol.polrelid) ilike '%family_plan_members%'
      or pg_get_expr(pol.polwithcheck, pol.polrelid) ilike '%family_plan_members%';
  if v_bad is not null then raise exception 'policies still reference family_plan_members: %', v_bad; end if;

  -- The dependant model must survive intact — this removal is not allowed to
  -- take consent-based record access with it.
  if to_regclass('public.profile_access') is null then
    raise exception 'profile_access was removed; the dependant model is gone';
  end if;
  select count(*) into v_n from pg_policy pol join pg_class c on c.oid = pol.polrelid
   where c.relname = 'profile_access';
  if v_n <> 4 then raise exception 'expected 4 profile_access policies, found %', v_n; end if;

  -- quarterly_report must still be reachable, or the report infrastructure is dead.
  select count(*) into v_n from public.subscription_plans where 'quarterly_report' = any(features);
  if v_n = 0 then raise exception 'no plan grants quarterly_report; the report cron has no audience'; end if;
end $$;
