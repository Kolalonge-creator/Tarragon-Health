-- Catalogue rebuild, Phase 4: new products.
-- Plan: https://claude.ai/code/artifact/38c6998f-e41e-465e-9519-90047f8e44c8
-- Founder decisions 2026-09-03.

begin;

-- ============================================================
-- Essential Annual Health Check: Core Screen minus liver function. The buy-
-- first tier for a patient who hasn't screened before.
-- ============================================================
insert into public.panel_bundles (code, name, description, price_kobo, test_codes, is_active, self_bookable, is_screen_tier)
select
  'screen_essential',
  'Essential Screen',
  'Kidney function, HbA1c, lipids, urinalysis, full blood count and HIV. The Core Screen without liver function testing.',
  round(sc.total_cost_kobo * 1.3 / 50000) * 50000,
  array['kft','hba1c','lipid_panel','urinalysis','fbc','hiv'],
  true,
  true,
  true
from (
  select sum(lt.price_kobo) as total_cost_kobo
    from public.lab_tests lt
    join public.lab_providers lp on lp.id = lt.provider_id
   where lp.name = 'Synlab Nigeria' and lt.code in ('kft','hba1c','lipid_panel','urinalysis','fbc','hiv')
) sc
on conflict (code) do update
  set price_kobo = excluded.price_kobo,
      test_codes = excluded.test_codes,
      is_active = true,
      self_bookable = true;

-- ============================================================
-- Cancer screening, one-off. A service_products purchase that, on
-- activation, seeds public.screening_schedules -- the periodic screening
-- engine already owns recall/decline/refresh-on-result from there, so this
-- adds no parallel schedule table.
--
-- The HPV DNA co-test component of "30 and over" / "Women 45+" has no
-- lab_tests cost row and no screen_types cadence of its own -- Synlab's
-- price list gives a bundle price for "LBC + HPV DNA co-test" but not each
-- component separately, and this platform has no existing recall-interval
-- decision for HPV co-testing distinct from cytology-alone. Redemption below
-- schedules the existing `cervical_smear` screen_type (real, signed cadence)
-- and deliberately does NOT invent a second cadence for the HPV component --
-- same discipline as ahc_full_panel shipping its extra biomarkers unsigned
-- rather than guessing. Revisit once that's a real, separately-priced test.
-- ============================================================
insert into public.service_products (code, name, description, price_kobo, currency, access_duration_days, features, is_active)
values
  ('cancer_screen_cervical_under30', 'Cervical Cancer Screening (under 30)',
   'Liquid-based cytology, plus a doctor consult to walk through the result. Single-use -- redeems into your screening calendar the moment it''s paid for.',
   6200000, 'NGN', 365, '{}', true),
  ('cancer_screen_cervical_30plus', 'Cervical Cancer Screening (30 and over)',
   'Liquid-based cytology plus HPV DNA co-test, plus a doctor consult to walk through the result. Single-use -- redeems into your screening calendar the moment it''s paid for.',
   22250000, 'NGN', 365, '{}', true),
  ('cancer_screen_women_45plus', 'Cancer Screening -- Women 45+',
   'Cervical screening (LBC + HPV co-test) plus bowel screening (FIT), plus a doctor consult to walk through both results. Single-use -- redeems into your screening calendar the moment it''s paid for.',
   43250000, 'NGN', 365, '{}', true),
  ('cancer_screen_men_45plus', 'Cancer Screening -- Men 45+',
   'PSA with free-PSA ratio plus bowel screening (FIT), plus a doctor consult to walk through both results. Single-use -- redeems into your screening calendar the moment it''s paid for.',
   31050000, 'NGN', 365, '{}', true)
on conflict (code) do update
  set price_kobo = excluded.price_kobo,
      description = excluded.description,
      is_active = true;

-- ---------------------------------------------------------------------------
-- redeem_cancer_screening_purchase -- spends an available credit for one of
-- the four codes above and schedules the screen_type(s) it covers, due
-- today. Idempotent: has_available_service_purchase returns false once
-- redeemed, so a repeat call (the calling card re-checking after a page
-- revisit) is a no-op, same contract as apply_full_panel_to_review.
-- Patient-callable directly (not a webhook/trigger): the checkout callback
-- page calls this once it observes the purchase went active, running as the
-- patient's own authenticated session -- deliberately not wired as a
-- SECURITY DEFINER trigger on service_purchases, because
-- redeem_available_service_purchase requires a real auth.uid() and a
-- payment-webhook execution context has none.
-- ---------------------------------------------------------------------------
create or replace function public.redeem_cancer_screening_purchase(p_patient_id uuid, p_product_code text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_org uuid;
  v_screen_codes text[];
  v_code text;
  v_screen_type_id uuid;
  v_new_schedule_id uuid;
  v_purchase_id uuid;
  v_seeded boolean := false;
begin
  if v_caller is null then raise exception 'not authenticated'; end if;

  select organisation_id into v_org from public.profiles where id = p_patient_id;
  if v_org is null then raise exception 'patient not found'; end if;

  if v_caller <> p_patient_id and not private.is_org_staff(v_org) then
    raise exception 'not authorised to spend this patient''s credit' using errcode = '42501';
  end if;

  v_screen_codes := case p_product_code
    when 'cancer_screen_cervical_under30' then array['cervical_smear']
    when 'cancer_screen_cervical_30plus'  then array['cervical_smear']
    when 'cancer_screen_women_45plus'     then array['cervical_smear', 'fit']
    when 'cancer_screen_men_45plus'       then array['psa', 'fit']
    else null
  end;
  if v_screen_codes is null then
    raise exception 'unknown cancer screening product %', p_product_code;
  end if;

  if not public.has_available_service_purchase(p_patient_id, p_product_code) then
    return false;
  end if;

  foreach v_code in array v_screen_codes loop
    select id into v_screen_type_id from public.screen_types where code = v_code;
    if v_screen_type_id is null then
      continue;
    end if;

    insert into public.screening_schedules (organisation_id, patient_id, screen_type_id, due_date, status)
    values (v_org, p_patient_id, v_screen_type_id, current_date, 'pending')
    returning id into v_new_schedule_id;

    v_seeded := true;

    if v_purchase_id is null then
      begin
        v_purchase_id := public.redeem_available_service_purchase(
          p_patient_id, p_product_code, 'screening_schedule', v_new_schedule_id
        );
      exception when others then
        -- Nothing left to redeem (raced with another call) -- the schedule
        -- row above still stands, which is fine: worst case is one extra
        -- pending screening row, never a lost purchase.
        return v_seeded;
      end;
    end if;
  end loop;

  return v_seeded;
end;
$$;

revoke all on function public.redeem_cancer_screening_purchase(uuid, text) from public, anon;
grant execute on function public.redeem_cancer_screening_purchase(uuid, text) to authenticated;
revoke execute on function public.redeem_cancer_screening_purchase(uuid, text) from anon;

do $$
declare
  v_missing int;
  v_essential_price bigint;
begin
  select count(*) into v_missing
    from (values
      ('cancer_screen_cervical_under30'), ('cancer_screen_cervical_30plus'),
      ('cancer_screen_women_45plus'), ('cancer_screen_men_45plus')
    ) as expected(code)
   where not exists (
     select 1 from public.service_products sp
      where sp.code = expected.code and sp.is_active
   );
  if v_missing <> 0 then
    raise exception 'FAIL: % cancer screening product(s) missing/inactive', v_missing;
  end if;

  select price_kobo into v_essential_price from public.panel_bundles where code = 'screen_essential';
  if v_essential_price <> 18100000 then
    raise exception 'FAIL: screen_essential priced %, expected 18100000 (₦181,000)', v_essential_price;
  end if;

  if has_function_privilege('anon', 'public.redeem_cancer_screening_purchase(uuid, text)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute redeem_cancer_screening_purchase';
  end if;

  raise notice 'PASS: cancer screening products + essential AHC variant seeded.';
end $$;

commit;
