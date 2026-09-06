-- Episodic-fee rebuild, step 6/6 (part c).
--
-- Four new named, self-bookable Health Check bundles — the transactional
-- diagnostic-panel side of the episodic-fee model, partnered with Synlab
-- (the platform's sole active lab provider). Priced as the sum of their
-- component tests' screen_types.price_kobo, the same "headline price = sum of
-- applicable lines" convention every other screen-tier bundle already uses
-- (20260821191743_synlab_contract_prices_and_tier_restructure.sql) — never an
-- invented figure. This headline price is informational: the amount actually
-- charged at order time is computed dynamically by private.compute_review_
-- price from the same screen_types rows, so these bundles automatically track
-- future Synlab contract-price changes with no migration needed.
--
-- is_screen_tier = true (a multi-test bundled panel, like Know Your Basics or
-- Core Screen, not a single_* test) wires these into the existing PSA
-- shared-decision-making gate and lifetime-once dedup for free — that
-- exclusion logic runs off each test_code's own screen_types metadata
-- regardless of which bundle it's ordered through.

insert into public.panel_bundles (code, name, description, test_codes, self_bookable, is_screen_tier, price_kobo)
select
  v.code,
  v.name,
  v.description,
  v.test_codes,
  true,
  true,
  (select sum(st.price_kobo) from public.screen_types st where st.code = any(v.test_codes))
from (
  values
    ('diabetes_check', 'Diabetes Check',
     'HbA1c, an oral glucose tolerance test and a lipid panel — the core picture for anyone who wants to know their diabetes risk, not just someone already diagnosed.',
     array['hba1c', 'ogtt_fpg', 'lipid_panel']),
    ('heart_health_check', 'Heart Health Check',
     'Lipid panel, HbA1c and kidney function — the core cardiometabolic risk picture.',
     array['lipid_panel', 'hba1c', 'kft']),
    ('womens_health_check', 'Women''s Health Check',
     'Cervical screening, iron stores, a full blood count and a routine sexual-health check.',
     array['cervical_smear', 'ferritin', 'fbc', 'syphilis']),
    ('mens_health_check', 'Men''s Health Check',
     'Prostate screening, cholesterol, a full blood count and a routine sexual-health check.',
     array['psa', 'lipid_panel', 'fbc', 'syphilis'])
) as v(code, name, description, test_codes)
on conflict (code) do nothing;

do $$
declare
  v_bad text;
begin
  select string_agg(pb.code, ', ') into v_bad
    from public.panel_bundles pb
   where pb.code in ('diabetes_check', 'heart_health_check', 'womens_health_check', 'mens_health_check')
     and (
       pb.price_kobo is null or pb.price_kobo <= 0
       or exists (
         select 1 from unnest(pb.test_codes) as tc(code)
         where not exists (
           select 1 from public.screen_types st
           where st.code = tc.code and st.price_kobo is not null and st.is_active
         )
       )
     );
  if v_bad is not null then
    raise exception 'FAIL: Health Check bundle(s) have an unpriced or inactive component test: %', v_bad;
  end if;

  if (select count(*) from public.panel_bundles
       where code in ('diabetes_check', 'heart_health_check', 'womens_health_check', 'mens_health_check')) <> 4 then
    raise exception 'FAIL: not all four Health Check bundles were created';
  end if;
end $$;
