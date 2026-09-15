-- Founder decision, taken as clinical director, in the same conversation that
-- produced "One review, adapted": Hypertension Panel does not need OGTT.
-- HbA1c is already in the panel and is an equally valid diagnostic tool for
-- comorbid diabetes (ADA), so a second glucose test alongside it is
-- redundant, not more thorough. An earlier draft of this restructure (the
-- version the sibling session read before this correction was given) added
-- OGTT to Hypertension Panel for comorbid diabetes case-finding; this
-- reverses that specific addition. Diabetes Panel was never affected — it
-- never carried ogtt_fpg.
--
-- price_kobo is recomputed the same way 20260821181701 computed it — summed
-- from screen_types.price_kobo over the surviving test_codes — rather than
-- hand-typed, so it can't drift from what the panel actually contains.

update public.panel_bundles
   set test_codes  = array['hba1c', 'lipid_panel', 'kft', 'urinalysis', 'urine_acr'],
       description = 'The work-up for someone already living with high blood pressure: blood sugar, cholesterol, kidney function, urine, and the kidney protein check.'
 where code = 'hypertension_panel';

update public.panel_bundles pb
   set price_kobo = coalesce((
         select sum(st.price_kobo)
         from unnest(pb.test_codes) as tc(code)
         join public.screen_types st on st.code = tc.code
         where st.price_kobo is not null and st.fulfilment_dormant = false
       ), pb.price_kobo)
 where pb.code = 'hypertension_panel';

do $$
declare
  v_codes text[];
  v_desc  text;
begin
  select test_codes, description into v_codes, v_desc
    from public.panel_bundles where code = 'hypertension_panel';

  if 'ogtt_fpg' = any(v_codes) then
    raise exception 'ogtt_fpg still in hypertension_panel.test_codes';
  end if;
  if v_desc ilike '%glucose tolerance%' then
    raise exception 'hypertension_panel description still promises a glucose tolerance test it no longer contains';
  end if;
  if not (v_codes @> array['hba1c','lipid_panel','kft','urinalysis','urine_acr']
          and array_length(v_codes, 1) = 5) then
    raise exception 'hypertension_panel.test_codes is not exactly the expected five, found %', v_codes;
  end if;
end $$;
