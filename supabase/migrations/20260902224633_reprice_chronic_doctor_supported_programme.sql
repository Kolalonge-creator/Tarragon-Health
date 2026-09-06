-- Founder decision 2026-09-02: the 12-week doctor-supported programme was live at a
-- ₦15,000/84-day placeholder pending sign-off (see 20260902221450). Real structure:
-- three doctor reviews across the twelve weeks at ₦10,000 each, plus one medication
-- review at ₦10,000. Total ₦40,000. The essential pre-programme bloods stay on the
-- standard "you pay the lab" basis like every other test on the platform -- optional,
-- no Tarragon fee, so they carry no price of their own here.

update public.service_products
   set price_kobo = 4000000, updated_at = now()
 where code = 'chronic_doctor_supported_pack';

do $$
declare
  v_price bigint;
  v_active boolean;
  v_duration int;
begin
  select price_kobo, is_active, access_duration_days
    into v_price, v_active, v_duration
    from public.service_products
   where code = 'chronic_doctor_supported_pack';

  if v_price is distinct from 4000000 then
    raise exception 'FAIL: chronic_doctor_supported_pack price is % kobo, expected 4000000', v_price;
  end if;
  if not v_active then
    raise exception 'FAIL: chronic_doctor_supported_pack is not active -- the six doctor-time features would be unreachable';
  end if;
  if v_duration is distinct from 84 then
    raise exception 'FAIL: chronic_doctor_supported_pack access_duration_days is %, expected 84 (12 weeks)', v_duration;
  end if;
end;
$$;
