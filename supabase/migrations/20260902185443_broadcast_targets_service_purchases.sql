-- Fix: admin broadcast "subscribers_by_plan" targeting is dead post pay-per-
-- service cutover (2026-08-31, migration
-- 20260831140512_service_products_core / 20260831141943_rewire_feature_access_
-- to_service_purchases). private.broadcast_targets() still joined
-- public.subscriptions -> public.subscription_plans to resolve this audience
-- — patient subscriptions were retired, so that exists() clause matches zero
-- rows and the "Subscribers on a plan" broadcast option silently reaches
-- nobody.
--
-- service_products/service_purchases is a clean like-for-like replacement:
-- service_products.code plays the same role subscription_plans.code did (the
-- audience_filter's existing plan_code key is left unchanged so the composer
-- UI needs no contract change, only its data source and copy), and
-- "active service" is the natural post-cutover equivalent of "active
-- subscription". The active-access predicate
-- (status = 'active' and (expires_at is null or expires_at > now())) is
-- copied verbatim from the canonical entitlement resolvers
-- (public.has_feature_access / private.patient_has_feature_access, added in
-- 20260831141943) rather than trusting status alone — spot-checked live and
-- 4 of 5 status='active' service_purchases rows were already past their
-- expires_at, so a status-only check would have over-included lapsed access.
--
-- No signature change (still 4 args incl. p_marketing from
-- 20260830002411_broadcast_marketing_consent.sql) — plain CREATE OR REPLACE.
create or replace function private.broadcast_targets(
  p_audience public.broadcast_audience,
  p_filter   jsonb,
  p_admin_id uuid,
  p_marketing boolean default false
)
returns table (
  recipient_id    uuid,
  organisation_id uuid,
  email           text,
  phone           text,
  is_partner      boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.organisation_id, u.email, p.phone, false
  from public.profiles p
  join auth.users u on u.id = p.id
  where p.role = 'patient'
    and p_audience in ('all_patients', 'patients_by_state', 'subscribers_by_plan')
    and ((p_filter->>'state') is null or p.state = (p_filter->>'state'))
    and (not p_marketing or p.marketing_opt_in)
    and (
      p_audience <> 'subscribers_by_plan'
      or exists (
        select 1
        from public.service_purchases sp
        join public.service_products spr on spr.id = sp.service_product_id
        where sp.patient_id = p.id
          and sp.status = 'active'
          and (sp.expires_at is null or sp.expires_at > now())
          and ((p_filter->>'plan_code') is null or spr.code = (p_filter->>'plan_code'))
      )
    )

  union all

  select p_admin_id, null::uuid, ph.contact_email, ph.contact_phone, true
  from public.pharmacy_partners ph
  where ph.is_active
    and (
      p_audience = 'all_partners'
      or (p_audience = 'partners_by_type' and (p_filter->>'partner_type') = 'pharmacy')
    )

  union all

  select p_admin_id, null::uuid, sp.contact_email, sp.contact_phone, true
  from public.specialist_providers sp
  where sp.is_active
    and (
      p_audience = 'all_partners'
      or (p_audience = 'partners_by_type' and (p_filter->>'partner_type') = 'specialist')
    );
$$;

comment on function private.broadcast_targets(public.broadcast_audience, jsonb, uuid, boolean) is
  'Audience resolver for notification_broadcasts. subscribers_by_plan now resolves against service_purchases/service_products (pay-per-service model, 2026-08-31) instead of the retired subscriptions/subscription_plans tables — plan_code in audience_filter matches service_products.code. p_marketing=true excludes any patient recipient with marketing_opt_in=false (17.4); partner rows are never filtered by it. SECURITY DEFINER, admin-gated by every caller.';

revoke all on function private.broadcast_targets(public.broadcast_audience, jsonb, uuid, boolean) from public, anon;

do $$
declare
  v_active_service_recipients integer;
begin
  -- Prove the fix actually resolves to a non-empty, plausible set rather than
  -- just "compiles" — mirrors the pattern this repo's migrations use for
  -- self-verifying DO blocks (see CLAUDE.md's "reusable pattern for removing
  -- a shipped feature").
  select count(*) into v_active_service_recipients
  from private.broadcast_targets('subscribers_by_plan'::public.broadcast_audience, '{}'::jsonb, gen_random_uuid(), false) t
  where t.email is not null or t.phone is not null;

  if v_active_service_recipients = 0 then
    raise warning 'subscribers_by_plan resolved to 0 recipients on this environment — expected on a fresh/empty DB, but verify against a real project before trusting the fix.';
  end if;
end $$;
