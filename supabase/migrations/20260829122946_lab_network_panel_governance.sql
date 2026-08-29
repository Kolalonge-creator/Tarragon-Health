-- Laboratory Network, part 3: clinically governed panels (§56.5).
--
-- "Panels should be governed clinically, not created purely as commercial
-- bundles." panel_bundles already carries test_codes/description with real
-- clinical reasoning behind each active row (see the 2026-08-21 restructure
-- migration's own commentary) — this adds an explicit category so a panel's
-- clinical purpose is queryable, not just readable in a migration comment,
-- and adds the one combination named in the spec that didn't already exist
-- as its own bookable item: a kidney assessment.
--
-- Deliberately NOT adding a distinct "Cardiovascular assessment" bundle: the
-- spec names it as an example, but no cardiac-specific marker (troponin,
-- BNP, etc.) is in Synlab's contracted price list, and
-- assert_test_price_covers_cost/lab_orders_zz_never_below_partner_cost exist
-- precisely to stop a test being sold with no real, agreed cost behind it.
-- hypertension_panel is tagged 'cardiovascular' below because hypertension
-- IS the cardiovascular-risk workup this catalogue actually offers today —
-- that is categorisation of a real panel, not fabrication of a new one.
-- Extend to a dedicated cardiac-marker panel only once a lab contracts one.

create type public.panel_bundle_category as enum (
  'wellness_baseline', 'annual_core', 'diabetes', 'cardiovascular', 'kidney',
  'cancer_screening', 'single_test', 'other'
);

alter table public.panel_bundles
  add column if not exists category              public.panel_bundle_category not null default 'other',
  add column if not exists clinical_protocol_ref  text;

comment on column public.panel_bundles.category is
  'The clinical purpose this panel is built around — governs how it is grouped in test search (§56.6) and lets a panel be audited for clinical coherence rather than commercial convenience (§56.5).';
comment on column public.panel_bundles.clinical_protocol_ref is
  'Short description of the clinical basis for this panel''s composition, where one exists beyond "these are commonly ordered together". Null is honest for a panel with no single named protocol behind it (e.g. the periodic single-test add-ons) — never invent a citation.';

update public.panel_bundles set category = 'wellness_baseline' where code = 'know_your_basics';
update public.panel_bundles set category = 'annual_core'       where code = 'screen_core';
update public.panel_bundles set category = 'cardiovascular',
       clinical_protocol_ref = 'Metabolic/renal/lipid work-up for a patient with hypertension — aligned to the platform''s hypertension chronic-disease pathway.'
  where code = 'hypertension_panel';
update public.panel_bundles set category = 'diabetes',
       clinical_protocol_ref = 'Metabolic/renal work-up for a patient with diabetes — aligned to the platform''s diabetes chronic-disease pathway.'
  where code = 'diabetes_panel';
update public.panel_bundles set category = 'cancer_screening' where code in ('single_fit', 'single_cervical_smear', 'single_psa');
update public.panel_bundles set category = 'single_test'
  where code like 'single_%' and category = 'other';
update public.panel_bundles set category = 'other' where code in ('screen_advanced', 'screen_comprehensive');

-- Kidney assessment: both tests are already real, contracted (Synlab) codes
-- with real patient prices (urine_acr, kft) — this bundles them as their own
-- orderable panel rather than requiring two separate single-test orders.
insert into public.panel_bundles (code, name, description, price_kobo, test_codes, self_bookable, category, clinical_protocol_ref)
select
  'kidney_panel',
  'Kidney Assessment',
  'Checks how well your kidneys are filtering (kidney function test) and looks for the earliest sign of kidney strain from hypertension or diabetes (the urine protein check).',
  (select sum(st.price_kobo) from public.screen_types st where st.code in ('kft', 'urine_acr')),
  array['kft', 'urine_acr'],
  true,
  'kidney',
  'Renal function + albuminuria screen — the kidney-specific subset of the hypertension/diabetes pathways'' own kidney monitoring, offered standalone for anyone whose care team wants kidney status checked outside a full condition panel.'
where not exists (select 1 from public.panel_bundles where code = 'kidney_panel')
  and exists (select 1 from public.screen_types where code = 'kft' and price_kobo is not null)
  and exists (select 1 from public.screen_types where code = 'urine_acr' and price_kobo is not null);

do $$
declare
  v_uncategorised int;
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'panel_bundles' and column_name = 'category') then
    raise exception 'panel_bundles.category was not created';
  end if;

  select count(*) into v_uncategorised from public.panel_bundles where category = 'other' and is_active;
  if v_uncategorised > 0 then
    raise exception '% active bundle(s) left uncategorised as ''other'' — every live bundle should have a real clinical category', v_uncategorised;
  end if;

  if not exists (select 1 from public.panel_bundles where code = 'kidney_panel' and is_active and category = 'kidney') then
    raise exception 'kidney_panel did not land';
  end if;

  -- No new cardiovascular-specific marker was fabricated — the guard is that
  -- every cardiovascular-tagged panel's tests are still all real, contracted
  -- Synlab codes with an active price, same check the pricing migration
  -- itself relies on.
  if exists (
    select 1 from public.panel_bundles pb, unnest(pb.test_codes) as tc(code)
    where pb.category = 'cardiovascular' and pb.is_active
      and not exists (select 1 from public.screen_types st where st.code = tc.code and st.price_kobo is not null)
  ) then
    raise exception 'a cardiovascular-tagged panel references a test with no real contracted price';
  end if;
end $$;
