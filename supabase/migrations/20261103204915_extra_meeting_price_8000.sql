-- Extra online meeting: 5,000 naira -> 8,000 naira (founder decision 2026-11-03, docs/DECISIONS.md).
--
-- The price is the one service_products row `video_visit_credit` (Members only, decision 2026-10-29); the booking terms
-- (my_booking_terms / my_consultation_rule), the coordinator's terms note, the public price list and the older
-- video_visit_requests route (private.pin_video_visit_amount) all read it live, and every purchase pins the amount it was
-- paid at on its own service_purchases row. Live on 2026-11-03: one credit ever sold at 500,000 kobo, none unspent, so no
-- patient holds a 5,000 naira credit that this touches. The organisation-less video_visit_prices fallback row (a 2026-08-02
-- placeholder at 1,000,000 kobo, ranked below the product by pin_video_visit_amount) is aligned to the same figure so the
-- older route cannot quote a different price if the product row is ever switched off.
update public.service_products
   set price_kobo = 800000
 where code = 'video_visit_credit';

update public.video_visit_prices
   set amount_minor = 800000, updated_at = now()
 where organisation_id is null and currency = 'NGN';

do $$
begin
  if (select price_kobo from public.service_products where code = 'video_visit_credit') <> 800000 then
    raise exception 'FAIL: video_visit_credit is not 800000 kobo';
  end if;
  if (select is_active from public.service_products where code = 'video_visit_credit') is distinct from true then
    raise exception 'FAIL: video_visit_credit should still be on sale';
  end if;
  if exists (select 1 from public.video_visit_prices where organisation_id is null and currency = 'NGN' and amount_minor <> 800000) then
    raise exception 'FAIL: the organisation-less video_visit_prices fallback is not 800000';
  end if;
end $$;
