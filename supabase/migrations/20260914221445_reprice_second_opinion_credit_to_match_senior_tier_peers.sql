-- Second Opinion Review (second_opinion_credit) was priced at par with
-- Medical-Officer-tier one-offs (Specialist Referral Letter, Video Visit,
-- Travel Letter — all NGN 10,000) despite being the one one-off product
-- delivered by a Senior Medical Officer, the more expensive tier.
-- service_product_margins showed it carrying the thinnest contribution
-- margin in the whole active catalogue (~39%, vs 58-80% for every other
-- one-off), not because its per-minute cost is unusual (~NGN 235/min, the
-- same as every other senior-tier product) but because its markup over cost
-- ran ~64% where comparable senior-tier one-offs (Medication Review, Senior
-- Case Review, Insurance Medical Summary) run 71-94%.
--
-- Medication Review has an almost identical cost profile — senior tier, 25
-- expected minutes, NGN 6,195 delivery+fee cost vs Second Opinion's NGN
-- 6,099 — and is priced at NGN 12,000. Repricing Second Opinion to match it
-- is the smallest change that brings its margin in line with its nearest
-- peer rather than inventing a new number.
update public.service_products
set price_kobo = 1200000
where code = 'second_opinion_credit';

do $$
declare
  v_price bigint;
begin
  select price_kobo into v_price from public.service_products where code = 'second_opinion_credit';
  if v_price is distinct from 1200000 then
    raise exception 'second_opinion_credit price_kobo is % after update, expected 1200000', v_price;
  end if;
end $$;
