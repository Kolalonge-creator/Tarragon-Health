-- One source for the extra online meeting price on the older video-visit request route.
--
-- Found 2026-11-03 while raising the price to 8,000 naira: the older request screen (web `useVideoVisitPrice`, mobile
-- `loadVideoVisitPrice`) showed the price from `video_visit_prices` (organisation row, else the organisation-less row), while
-- the charge trigger `private.pin_video_visit_amount` ranks organisation row > `service_products.video_visit_credit` >
-- organisation-less row. Since 2026-08-31 the product row sat in the middle, so a patient was shown 10,000 naira and charged
-- 5,000 (the organisation-less row was never moved). 0 requests have ever been made on this route, so nobody paid a wrong
-- amount. 20261103204915 aligned the numbers; this removes the second reading so they cannot drift again.
--
--   private.video_visit_price(org)   the ranking, written once (unchanged from the live trigger body).
--   private.pin_video_visit_amount() calls it; every other line of the live body is kept as it was.
--   public.my_video_visit_price()    the caller's price as {amount_minor, currency}, or null when none is set or it is off.
--                                    Readable by any signed-in person, the same exposure as the table the screens read before
--                                    (its select policy is `using (true)` for authenticated). Members-only is enforced where it
--                                    matters, at insert, by the trigger.

create or replace function private.video_visit_price(p_org uuid)
 returns table (amount_minor bigint, currency text, is_enabled boolean)
 language sql
 stable security definer
 set search_path to ''
as $function$
  select p.amount_minor, p.currency, p.is_enabled
  from (
    select v.amount_minor, v.currency, v.is_enabled, 0 as pri
    from public.video_visit_prices v where v.organisation_id = p_org
    union all
    select s.price_kobo::bigint, s.currency::text, s.is_active, 1
    from public.service_products s where s.code = 'video_visit_credit'
    union all
    select v.amount_minor, v.currency, v.is_enabled, 2
    from public.video_visit_prices v where v.organisation_id is null
  ) p
  order by p.pri
  limit 1
$function$;

revoke all on function private.video_visit_price(uuid) from public, anon, authenticated;

create or replace function private.pin_video_visit_amount()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_price record;
begin
  select * into v_price from private.video_visit_price(new.organisation_id);

  if v_price.amount_minor is null or not v_price.is_enabled then
    raise exception 'video visits are not available right now';
  end if;
  -- An extra online meeting is for paid Members (decision 2026-10-29), by whichever route it is asked for.
  if not coalesce(private.patient_is_member(new.patient_id), false) then
    raise exception 'An extra online meeting is part of Membership. Join to add one.' using errcode = 'P0001', detail = 'MEMBERSHIP_REQUIRED';
  end if;
  new.amount_minor := v_price.amount_minor;
  new.currency := v_price.currency;
  new.status := 'requested';
  new.origin := 'patient_initiated';
  new.payment_provider := null;
  new.payment_provider_ref := null;
  new.pending_payment_provider_ref := null;
  new.refund_status := null;
  new.refund_ref := null;
  return new;
end;
$function$;

create or replace function public.my_video_visit_price()
 returns jsonb
 language sql
 stable security definer
 set search_path to ''
as $function$
  select case when p.amount_minor is null or not p.is_enabled then null
              else jsonb_build_object('amount_minor', p.amount_minor, 'currency', p.currency) end
  from (select 1) one
  left join lateral private.video_visit_price(
    (select me.organisation_id from public.profiles me where me.id = (select auth.uid()))
  ) p on true
  where (select auth.uid()) is not null
$function$;

revoke all on function public.my_video_visit_price() from public, anon;
grant execute on function public.my_video_visit_price() to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.my_video_visit_price()', 'EXECUTE') then
    raise exception 'FAIL: anon can run my_video_visit_price';
  end if;
  if has_function_privilege('authenticated', 'private.video_visit_price(uuid)', 'EXECUTE') then
    raise exception 'FAIL: authenticated can run private.video_visit_price directly';
  end if;
  if pg_get_functiondef('private.pin_video_visit_amount'::regproc) not like '%private.video_visit_price(new.organisation_id)%' then
    raise exception 'FAIL: the charge trigger does not read the single price function';
  end if;
end $$;
