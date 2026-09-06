-- Tarragon Health — Full Panel Annual Health Check upsell.
--
-- docs/FULL_SPECIFICATION_V4.md's competitor-teardown table lists "Full
-- Panel AHC, whole-body MRI referral -> ADD-ON" as an idea, never built.
-- Founder decision 2026-09-01: ship the Full Panel half as a real
-- purchasable add-on over the standard Annual Health Check bundle. Per the
-- explicit CLAUDE.md rule, this does NOT rebuild the Annual Health Review as
-- a parallel record — it adds extra rows to the SAME
-- annual_review_workup_items checklist private.queue_annual_reviews()
-- already seeds from annual_review_workup_catalogue (20260717120000), using
-- the single-use credit primitive built for pay-per-service
-- (redeem_available_service_purchase, 20260831162837). No real extra-
-- biomarker list has been clinically signed off yet, so the new catalogue
-- rows ship with clinical_signoff_at = null — gated exactly like the BLE
-- "supported devices" list, per the founder's chosen scaffold-first
-- approach — and apply_full_panel_to_review() only ever adds SIGNED-OFF
-- items, so an unsigned catalogue row can never silently appear on a real
-- checklist even if seeded.
--
-- Fixes a real bug found while reading this path: private.queue_annual_reviews()
-- still joins subscriptions/subscription_plans/subscription_add_ons/add_ons,
-- all retired 2026-08-31 in favour of service_purchases/service_products
-- (same class of stale-entitlement-check bug as get_ai_coach_daily_limit
-- and private.apply_screening_subscriber_discount, both already rewired) —
-- meaning NO annual review has been queued for anyone since that migration
-- landed. Rewired to private.patient_has_feature_access('annual_review'),
-- the same helper every other rewired entitlement check now uses.

alter table public.annual_review_workup_catalogue
  add column is_full_panel_addon boolean not null default false,
  add column clinical_signoff_at timestamptz,
  add column clinical_signoff_by uuid references public.clinical_staff (id) on delete set null;

insert into public.annual_review_workup_catalogue
  (code, label, description, default_applicable, is_full_panel_addon, sort_order)
values
  ('vitamin_d',            'Vitamin D',                    'Vitamin D sufficiency screen — not part of the standard bundle.', false, true, 110),
  ('b12_folate',           'Vitamin B12 & folate',         'Deficiency screen beyond the standard FBC.',                      false, true, 120),
  ('iron_studies',         'Iron studies / ferritin',      'Anaemia work-up beyond the standard FBC.',                        false, true, 130),
  ('hs_crp',               'hs-CRP',                       'High-sensitivity inflammation marker, cardiovascular-risk-adjacent.', false, true, 140),
  ('coagulation_profile',  'Coagulation profile (PT/INR)', 'Clotting screen not part of the standard bundle.',                false, true, 150),
  ('tumour_marker_screen', 'Age/sex-appropriate tumour marker screen', 'PSA or CA-125 depending on age/sex — an extra prompt on top of the standard cancer-screening review.', false, true, 160)
on conflict (code) do update
  set label = excluded.label,
      description = excluded.description,
      is_full_panel_addon = excluded.is_full_panel_addon,
      sort_order = excluded.sort_order;

insert into public.service_products (code, name, description, price_kobo, currency, access_duration_days, features, is_active)
values (
  'ahc_full_panel',
  'Annual Health Check — Full Panel',
  'Adds vitamin D, B12/folate, iron studies, hs-CRP, coagulation profile, and an age/sex-appropriate tumour marker screen to your next Annual Health Check. Single-use — applies to your next review, buy again for the following year.',
  1000000, -- placeholder ₦10,000 — founder to confirm real price
  'NGN',
  365, -- generous redemption window so buying ahead of the review date still counts
  '{}',
  false -- inactive: the extra biomarker list has no Clinical Director sign-off yet, see clinical_signoff_at above
)
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- apply_full_panel_to_review — idempotent: spends an available Full Panel
-- credit against this review (if one exists and isn't already spent) and
-- adds only the SIGNED-OFF full-panel catalogue rows to the checklist.
-- Safe to call repeatedly (e.g. every time the patient opens their AHC
-- page) — redeem_available_service_purchase's own unique index means a
-- second call simply finds nothing left to redeem.
-- ---------------------------------------------------------------------------

create or replace function public.apply_full_panel_to_review(p_review_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_patient uuid;
  v_org uuid;
  v_purchase_id uuid;
begin
  if v_caller is null then raise exception 'not authenticated'; end if;

  select patient_id, organisation_id into v_patient, v_org
    from public.annual_reviews where id = p_review_id;
  if v_patient is null then raise exception 'annual review not found'; end if;

  if v_caller <> v_patient and not private.is_org_staff(v_org) then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  if not public.has_available_service_purchase(v_patient, 'ahc_full_panel') then
    return false;
  end if;

  begin
    v_purchase_id := public.redeem_available_service_purchase(v_patient, 'ahc_full_panel', 'annual_review', p_review_id);
  exception when others then
    -- Already redeemed against this review (or genuinely nothing left) —
    -- either way there's nothing new to apply.
    return false;
  end;

  insert into public.annual_review_workup_items (annual_review_id, organisation_id, code, label)
  select p_review_id, v_org, c.code, c.label
  from public.annual_review_workup_catalogue c
  where c.is_full_panel_addon and c.clinical_signoff_at is not null
  on conflict (annual_review_id, code) do nothing;

  return true;
end;
$$;

revoke all on function public.apply_full_panel_to_review(uuid) from public, anon;
grant execute on function public.apply_full_panel_to_review(uuid) to authenticated;
revoke execute on function public.apply_full_panel_to_review(uuid) from anon;

-- ---------------------------------------------------------------------------
-- queue_annual_reviews — rewired entitlement (the real bug fix) + apply any
-- already-purchased Full Panel credit to a newly-opened review.
-- ---------------------------------------------------------------------------

create or replace function private.queue_annual_reviews()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_year integer := extract(year from current_date);
  r record;
  v_review_id uuid;
begin
  for r in
    select p.id as patient_id, p.organisation_id
    from public.profiles p
    where p.role = 'patient'
      and private.patient_has_feature_access(p.id, 'annual_review')
  loop
    if exists (
      select 1 from public.annual_reviews ar
      where ar.patient_id = r.patient_id
        and (
          ar.status in ('pending', 'in_progress')
          or ar.due_date > current_date - interval '11 months'
        )
    ) then
      continue;
    end if;

    insert into public.annual_reviews (organisation_id, patient_id, cycle_year, due_date)
    values (r.organisation_id, r.patient_id, v_year, current_date)
    on conflict (patient_id, cycle_year) do nothing
    returning id into v_review_id;

    if v_review_id is null then
      continue;
    end if;

    insert into public.annual_review_workup_items
      (annual_review_id, organisation_id, code, label)
    select v_review_id, r.organisation_id, c.code, c.label
    from public.annual_review_workup_catalogue c
    where c.default_applicable
    on conflict (annual_review_id, code) do nothing;

    perform public.apply_full_panel_to_review(v_review_id);

    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    values (
      r.organisation_id, r.patient_id, 'whatsapp', 'pending', 'annual_review_due',
      jsonb_build_object('cycle_year', v_year)
    );
  end loop;
end;
$$;

do $$
declare
  v_full_panel_id uuid;
begin
  select id into v_full_panel_id from public.service_products where code = 'ahc_full_panel';
  if v_full_panel_id is null then
    raise exception 'FAIL: ahc_full_panel was not seeded';
  end if;
  if (select count(*) from public.annual_review_workup_catalogue where is_full_panel_addon) <> 6 then
    raise exception 'FAIL: expected 6 full-panel catalogue rows, got %',
      (select count(*) from public.annual_review_workup_catalogue where is_full_panel_addon);
  end if;
  if exists (
    select 1 from public.annual_review_workup_catalogue
    where is_full_panel_addon and clinical_signoff_at is not null
  ) then
    raise exception 'FAIL: full-panel items must ship unsigned until the founder/Clinical Director confirms the panel';
  end if;
  if has_function_privilege('anon', 'public.apply_full_panel_to_review(uuid)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute apply_full_panel_to_review';
  end if;
  -- The stale-entitlement-check regression this migration fixes: confirm
  -- the retired tables are genuinely gone from the function body.
  if pg_get_functiondef('private.queue_annual_reviews()'::regprocedure) ~ 'from public\.subscriptions' then
    raise exception 'FAIL: queue_annual_reviews still reads the retired subscriptions table';
  end if;
  raise notice 'PASS: Full Panel AHC upsell scaffolded + queue_annual_reviews entitlement fixed';
end $$;
