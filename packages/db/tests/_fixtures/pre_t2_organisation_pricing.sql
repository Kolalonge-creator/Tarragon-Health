-- Fixture, included with \ir by proofs that test the ORIGINAL organisation seat pricing on the Plus item (two_tier_membership_pricing,
-- membership_ladder_followups, employer_seat_pilot_kit). T2-05/T2-09 (2026-11-04) moved seats to the Membership item at 90,000 naira:
-- limits v2, a 9,000,000 default on membership_annual_no_panel, and the three seat-price functions renamed to that item. These proofs
-- restore the launch rules INSIDE their own (rolled-back) transaction: limits v1 active, the default back on the Plus item at the
-- launch 10,000,000, and the functions pointing at membership_annual again. The new rules are proven by t2_one_membership.sql.
do $$
declare
  d text;
  s regprocedure;
  plus public.catalog_items%rowtype;
begin
  foreach s in array array[
    'private.set_organisation_member_price_core(uuid,bigint,text,timestamp with time zone)'::regprocedure,
    'public.clear_organisation_member_price(uuid,text,timestamp with time zone)'::regprocedure,
    'public.organisation_seat_summary(uuid)'::regprocedure,
    'public.admin_organisation_prices()'::regprocedure]
  loop
    d := replace(pg_get_functiondef(s), '''membership_annual_no_panel''', '''membership_annual''');
    execute d;
  end loop;

  update public.organisation_price_limits set is_active = false where is_active;
  update public.organisation_price_limits set is_active = true where version = 1;

  select * into plus from public.catalog_items where code = 'membership_annual';
  update public.organisation_member_prices set valid_to = now() - interval '1 second'
   where employer_organisation_id is null and valid_from < now() - interval '1 second' and (valid_to is null or valid_to > now() - interval '1 second');
  insert into public.organisation_member_prices (organisation_id, employer_organisation_id, catalog_item_id, amount_kobo, valid_from, reason)
  -- one second back: the seat-price functions close the current default at a new row's start, and a row that opened at exactly now()
  -- would then close at the instant it opened
  values (plus.organisation_id, null, plus.id, 10000000, now() - interval '1 second', 'proof fixture: the launch default seat price (rolled back)');
end $$;
