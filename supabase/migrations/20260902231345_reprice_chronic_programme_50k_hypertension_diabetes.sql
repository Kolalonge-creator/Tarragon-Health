-- Founder correction 2026-09-02, same day as the ₦40,000 repricing (20260902224633):
-- the 12-week doctor-supported programme moves to ₦50,000 and is scoped explicitly to
-- hypertension and diabetes (weight management stays free elsewhere and is folded into
-- either condition's review at no extra charge when relevant, rather than being a third
-- billed condition). The ₦10,000 above the three-review-plus-medication-review total
-- (₦40,000) covers ongoing coordination and monitoring across the twelve weeks -- see
-- PAID_SERVICES.breakdown in apps/web/src/app/(marketing)/_content/pricing.ts.

update public.service_products
   set price_kobo = 5000000, updated_at = now()
 where code = 'chronic_doctor_supported_pack';

do $$
declare
  v_price bigint;
begin
  select price_kobo into v_price from public.service_products where code = 'chronic_doctor_supported_pack';
  if v_price is distinct from 5000000 then
    raise exception 'FAIL: chronic_doctor_supported_pack price is % kobo, expected 5000000', v_price;
  end if;
end;
$$;
