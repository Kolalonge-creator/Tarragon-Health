-- W-19 (founder decision D-14, 2026-10-27): the PAYER of a gift sees the state of the gift, including 'declined' when it is not accepted.
--
-- This reverses S29/S29b's deliberate silence towards the payer on a decline. Trade-off, stated plainly: a payer who sees 'declined' may
-- guess a family disagreement; S29 chose silence to avoid conflict or coercion at home. The mitigations kept here: the payer sees ONLY the
-- state word (waiting, accepted, declined), never why, never when the person decided, never who else was involved, and the same word
-- covers an explicit "no thank you" and an unanswered gift swept after the decide window, so the payer cannot tell which it was.
-- Nobody but the payer gets the field: the person receiving the gift sees null.
--
-- How: public.my_orders (live body read 2026-10-27, unchanged except the one added key) returns `gift_state` for a row where the caller
-- is the buyer and the beneficiary is someone else. It is derived from entitlements.acceptance, which BOTH public.respond_to_gifted_pack
-- (the person's own answer) and private.expire_pending_gifts (the sweep) already set, so neither function needs to change and the
-- payer-facing word stays true for both paths. The payer is still not notified: they see it when they look.
-- Everything else about S29b is untouched: the person's yes, the finance incident to refund the payer, the sweep.

create or replace function public.my_orders() returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('order_id', o.id, 'state', o.state, 'amount_kobo', o.amount_kobo, 'fee_kobo', o.fee_kobo,
         'total_kobo', o.total_kobo, 'code', i.code, 'name_key', i.name_key, 'created_at', o.created_at, 'paid_at', o.paid_at,
         'sponsor_share_kobo', o.sponsor_share_kobo,
         'sponsor_name', (select so.name from public.sponsor_reservations sr join public.sponsor_programmes sp on sp.id = sr.programme_id
                           join public.organisations so on so.id = sp.sponsor_org_id where sr.order_id = o.id),
         'is_buyer', o.buyer_profile_id = (select auth.uid()),
         'refund_state', (select rf.state from public.refunds rf where rf.order_id = o.id order by rf.created_at desc limit 1),
         -- W-19: only the payer of a gift, only the state word
         'gift_state', case when o.buyer_profile_id = (select auth.uid()) and o.beneficiary_patient_id is not null
                                 and o.beneficiary_patient_id <> o.buyer_profile_id
                            then (select case e.acceptance when 'pending' then 'waiting' when 'accepted' then 'accepted' when 'declined' then 'declined' end
                                    from public.entitlements e where e.order_id = o.id and e.acceptance <> 'not_needed'
                                   order by e.created_at desc limit 1)
                       end) order by o.created_at desc), '[]'::jsonb)
    from public.orders o join public.catalog_items i on i.id = o.catalog_item_id
   where o.buyer_profile_id = (select auth.uid()) or o.beneficiary_patient_id = (select auth.uid())
$$;

do $$
begin
  if has_function_privilege('anon', 'public.my_orders()', 'EXECUTE') then
    raise exception 'W-19: my_orders must not be callable by anon';
  end if;
  raise notice 'PASS: W-19 payer sees the gift state';
end $$;
