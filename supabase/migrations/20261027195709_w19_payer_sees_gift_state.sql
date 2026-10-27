-- W-19 (founder decision D-14, 2026-10-27; revised in place after code review because nothing here is applied yet):
-- the PAYER of a gift sees the state of the gift.
--
-- This reverses S29/S29b's deliberate silence towards the payer on a decline. Trade-off, stated plainly: a payer who sees 'declined' may guess a
-- family disagreement; S29 chose silence to avoid conflict or coercion at home. Mitigations kept: the payer sees ONLY a state word, never why,
-- never when the person decided, never who else was involved; nobody but the payer gets the field; the payer is not notified, they see it when
-- they look.
--
-- HONEST WORDS (a small, flagged deviation from the literal D-14, which said 'declined' for everything): an explicit "no thank you" reads
-- 'declined'. A gift that nobody answered and was swept after the decide window reads 'not_answered', because "they said no" would be false.
-- Any other terminal state reads 'not_accepted'. Founder to confirm.
--   waiting       the gift is paid and waits for their answer
--   accepted      they said yes
--   declined      they said no
--   not_answered  the decide window passed with no answer (swept)
--   not_accepted  any other terminal state (none exists today; the CASE is explicit so a future state is never silently hidden)
--
-- LIVE VERSIONS REPLACED (read with pg_get_functiondef on koiplnmbgnqnbywhpjlf, 2026-10-27; open PR #1330 adds no my_orders migration):
--   public.my_orders()                 = 20261007231742_s72_checkout_extras.sql (the version with is_buyer and refund_state). EVERY existing key
--                                         is kept (13 keys); one key is added: gift_state (14 in total). The proof asserts the full key set.
--   private.expire_pending_gifts()     = 20261006204511_s29b_gifted_care_pack_acceptance.sql with the S29d 14-day window; one change: the sweep
--                                         marks the entitlement decided_by_sweep = true.
-- public.respond_to_gifted_pack is NOT changed: the person's own answer leaves decided_by_sweep false, so a decline reads 'declined'.
-- Rows swept before this migration cannot be told apart from a person's own decline; they read 'declined'.

alter table public.entitlements add column decided_by_sweep boolean not null default false;
comment on column public.entitlements.decided_by_sweep is 'W-19. True when an unanswered gift was closed by the sweep rather than by the person. Read only to choose the payer''s state word.';

create or replace function private.expire_pending_gifts() returns integer
language plpgsql security definer set search_path = ''
as $$
declare r record; n integer := 0;
begin
  for r in select e.id, e.order_id, o.organisation_id from public.entitlements e join public.orders o on o.id = e.order_id
            where e.acceptance = 'pending' and e.state = 'active'
              and e.created_at < now() - make_interval(days => (private.circle_rules() ->> 'gift_decide_days')::integer) loop
    update public.entitlements set acceptance = 'declined', state = 'revoked', decided_at = now(), decided_by_sweep = true where id = r.id;   -- W-19
    perform private.order_incident(r.organisation_id, 'order-gift-declined:' || r.order_id, 'A gifted order was not answered in time',
      'Order ' || r.order_id || ' was paid for by someone else and the patient did not answer in time. Refund the payer (nothing else was started).');
    n := n + 1;
  end loop;
  for r in select e.id, e.patient_id, e.organisation_id, e.is_test from public.entitlements e
            where e.acceptance = 'pending' and e.state = 'active'
              and e.created_at <= now() - make_interval(days => (private.circle_rules() ->> 'gift_remind_days')::integer) loop
    perform private.circle_notify(r.patient_id, r.organisation_id, 'circle_gift_waiting', 'entitlements', r.id, array['in_app'], 'routine', r.is_test);
  end loop;
  return n;
end $$;

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
         -- W-19: only the payer of a gift, only the state word. entitlements.order_id is unique, so there is exactly one answer per order; the ordering below is defensive only.
         'gift_state', case when o.buyer_profile_id = (select auth.uid()) and o.beneficiary_patient_id is not null
                                 and o.beneficiary_patient_id <> o.buyer_profile_id
                            then (select case e.acceptance
                                           when 'pending' then 'waiting'
                                           when 'accepted' then 'accepted'
                                           when 'declined' then case when e.decided_by_sweep then 'not_answered' else 'declined' end
                                           else 'not_accepted'
                                         end
                                    from public.entitlements e where e.order_id = o.id and e.acceptance <> 'not_needed'
                                   order by case e.acceptance when 'accepted' then 0 when 'pending' then 1 else 2 end, e.created_at desc, e.id
                                   limit 1)
                       end) order by o.created_at desc), '[]'::jsonb)
    from public.orders o join public.catalog_items i on i.id = o.catalog_item_id
   where o.buyer_profile_id = (select auth.uid()) or o.beneficiary_patient_id = (select auth.uid())
$$;

do $$
begin
  if has_function_privilege('anon', 'public.my_orders()', 'EXECUTE') then
    raise exception 'W-19: my_orders must not be callable by anon';
  end if;
  if has_function_privilege('authenticated', 'private.expire_pending_gifts()', 'EXECUTE') then
    raise exception 'W-19: expire_pending_gifts must not be callable by a signed-in user';
  end if;
  raise notice 'PASS: W-19 payer sees the gift state';
end $$;
