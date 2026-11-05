-- Tarragon Health 2.0, Phase 4b (founder decision T2-13, 2026-11-04, chat): when a Membership Plus year comes up for renewal it renews
-- as the 100,000 naira Membership. The renewal offer is the Membership, with a clear notice first. Nothing is charged without the
-- member's own action: automatic renewal is dormant (platform_modules.membership_auto_renew OFF), and if it is ever switched on a Plus
-- year may only be charged the Membership price, and only after the person was sent the notice that names that amount and their card.
--
-- Counted live before writing (2026-11-04): patient_memberships 2 rows, both test accounts (1 plus, 1 evergreen); rows with auto_renew 0;
-- saved cards 0; paid gift orders 0; founding discount codes 1 (FOUNDING, items membership_annual + membership_annual_no_panel).
-- So no real member is re-priced, nothing is charged and no booking moves. Existing Plus years are untouched until they end; no
-- historical row (memberships, orders, payments, prices, entitlements) is deleted or rewritten.
--
-- What already worked before this migration (read from the live bodies, not assumed): a Plus member who renews by hand can only buy
-- the Membership (Plus is inactive, create_order refuses it), and a Membership year paid while a Plus year still runs is QUEUED to start
-- the day the Plus year ends (private.membership_queue_applies). What was missing, and is added here:
--   1. private.renewal_item_code(): a retired Plus code maps to the Membership. Every place that prices or charges a renewal uses it
--      (service_prepare_membership_renewal, my_membership_renewal, queue_membership_renewal_reminders), and the stored renewal_item_code
--      of any Plus-era row is moved to the Membership with renewal_notified_kobo cleared, so no amount shown for Plus can authorise a
--      Membership charge.
--   2. The Plus notice. queue_membership_renewal_reminders sends a Plus member 'membership_plus_renews_as_membership' (renew by hand) or
--      'membership_plus_auto_renews_as_membership' (states the Membership amount and the card) instead of the plain reminder.
--   3. The charge gate. service_prepare_membership_renewal refuses a Plus year unless that auto notice was queued at least 2 days
--      earlier; without it the person is told to renew by hand (notify_renewal_blocked) and nothing is charged.
--   4. Sponsorship (brief section 10.2): the person who paid for a gifted Membership is reminded when it is ending (found by the
--      exact order link that respond_to_gifted_pack now records; a date match only for years accepted before this migration, and never
--      past a later order the person paid themselves)
--      ('membership_gift_renewal_reminder': first name and end date only, never anything clinical), and only while that person still
--      holds the beneficiary's own "pay for my care" Care Circle permission. Paying still grants no record access (unchanged).
--   5. Founding discount codes (and any other code) no longer name the retired Plus items: a new code may not name them, a founding code
--      is exactly the Membership, and existing codes are narrowed (the immutability guard allows removing a retired item and nothing
--      else; a code that named only retired items is ended, never widened to "every item").
--   6. The AI-023 evaluation case pricing_16 asks about the retired plan instead of comparing two plans that are no longer both sold.

create function pg_temp.t2p4b_patch_fn(p_sig regprocedure, p_pairs text[]) returns void language plpgsql as $f$
declare d text := pg_get_functiondef(p_sig); i integer := 1; n integer;
begin
  while i < array_length(p_pairs, 1) loop
    n := (length(d) - length(replace(d, p_pairs[i], ''))) / length(p_pairs[i]);
    if n <> 1 then raise exception 't2 phase 4b patch of % expected 1 match for [%], found %', p_sig, p_pairs[i], n; end if;
    d := replace(d, p_pairs[i], p_pairs[i + 1]);
    i := i + 2;
  end loop;
  execute d;
end $f$;

-- ---------------------------------------------------------------------------
-- 1. A retired Plus code renews as the Membership
-- ---------------------------------------------------------------------------
create function private.renewal_item_code(p_code text) returns text
language sql immutable set search_path = ''
as $$ select case when p_code in ('membership_annual', 'membership_upgrade_plus') then 'membership_annual_no_panel' else p_code end $$;
revoke all on function private.renewal_item_code(text) from public, anon, authenticated;

update public.patient_memberships
   set renewal_item_code = 'membership_annual_no_panel', renewal_notified_kobo = null, renewal_notified_at = null
 where renewal_item_code in ('membership_annual', 'membership_upgrade_plus');

select pg_temp.t2p4b_patch_fn('public.service_prepare_membership_renewal(uuid)'::regprocedure, array[
  'and code = m.renewal_item_code;', 'and code = private.renewal_item_code(m.renewal_item_code);',
  $r$  if not found or not it.active or it.kind <> 'membership' then perform private.notify_renewal_blocked(m.id); return jsonb_build_object('skip', 'item_unavailable'); end if;
$r$,
  $r$  if not found or not it.active or it.kind <> 'membership' then perform private.notify_renewal_blocked(m.id); return jsonb_build_object('skip', 'item_unavailable'); end if;
  -- T2-13: a Plus year renews as the Membership, and only after the person was sent the notice naming that amount and their card, at
  -- least two days earlier. Without it nothing is charged; they are told to renew by hand.
  if m.tier = 'plus' and not exists (select 1 from public.notifications n
                                      where n.recipient_id = m.patient_id and n.template = 'membership_plus_auto_renews_as_membership'
                                        and n.payload ->> 'membership_id' = m.id::text and n.created_at <= now() - interval '2 days') then
    perform private.notify_renewal_blocked(m.id); return jsonb_build_object('skip', 'plus_notice_pending');
  end if;
$r$]);
revoke all on function public.service_prepare_membership_renewal(uuid) from public, anon, authenticated;
grant execute on function public.service_prepare_membership_renewal(uuid) to service_role;

select pg_temp.t2p4b_patch_fn('public.my_membership_renewal()'::regprocedure, array[
  'q := private.price_quote_calc(v_uid, v_uid, m.renewal_item_code, null, false);',
  'q := private.price_quote_calc(v_uid, v_uid, private.renewal_item_code(m.renewal_item_code), null, false);',
  $r$'ends_at', m.ends_at, 'cancelled_at', m.renewal_cancelled_at, 'amount_kobo', v_amount,$r$,
  $r$'ends_at', m.ends_at, 'cancelled_at', m.renewal_cancelled_at, 'amount_kobo', v_amount, 'tier', m.tier,
    'renews_as', case when m.tier = 'plus' then 'membership_annual_no_panel' end,$r$]);
revoke all on function public.my_membership_renewal() from public, anon;
grant execute on function public.my_membership_renewal() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. The Plus notice and the sponsor reminder
-- ---------------------------------------------------------------------------
-- Queues the notice a Plus member gets instead of the plain reminder. Returns false (so the caller sends the plain reminder) only when
-- there is no amount to state honestly.
create function private.queue_plus_renewal_notice(p_membership uuid, p_days_before integer, p_auto boolean, p_amount_kobo bigint, p_last4 text)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare m public.patient_memberships%rowtype; v_kobo bigint;
begin
  select * into m from public.patient_memberships where id = p_membership;
  if not found then return false; end if;
  if p_auto then
    v_kobo := p_amount_kobo;
  else
    -- What renewing by hand costs before any code, resolved exactly as checkout resolves it: price_quote_calc reads the catalogue of
    -- the PATIENT'S profile organisation, not the membership row's (an employer or voucher year can sit in another organisation, whose
    -- own catalogue is empty). Only if no quote can be made (e.g. the billing guard is closed) is the list price read from that same
    -- catalogue.
    begin
      v_kobo := (private.price_quote_calc(m.patient_id, m.patient_id, 'membership_annual_no_panel', null, false) ->> 'amount_due_kobo')::bigint;
    exception when others then v_kobo := null;
    end;
    if v_kobo is null then
      v_kobo := (private.current_price((select ci.id from public.catalog_items ci join public.profiles pr on pr.organisation_id = ci.organisation_id
                                         where pr.id = m.patient_id and ci.code = 'membership_annual_no_panel' and ci.active))).amount_kobo;
    end if;
  end if;
  if v_kobo is null or v_kobo <= 0 or (p_auto and p_last4 is null) then return false; end if;
  insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
  values (m.organisation_id, m.patient_id, private.patient_reminder_channel(m.patient_id), 'pending',
          case when p_auto then 'membership_plus_auto_renews_as_membership' else 'membership_plus_renews_as_membership' end,
          jsonb_build_object('membership_id', m.id, 'ends_at', to_char(m.ends_at at time zone 'Africa/Lagos', 'FMDD Mon YYYY'),
                             'days_before', p_days_before, 'tier', m.tier, 'renews_as', 'membership_annual_no_panel',
                             'amount', to_char(v_kobo / 100, 'FM999,999,999'))
            || case when p_auto then jsonb_build_object('card_last4', p_last4) else '{}'::jsonb end);
  return true;
end $$;
revoke all on function private.queue_plus_renewal_notice(uuid, integer, boolean, bigint, text) from public, anon, authenticated;

-- The person who paid for a gifted Membership is reminded it is ending, so they can give another year. Billing facts only (first name,
-- end date), and only while they still hold the beneficiary's own "pay for my care" permission: someone the patient removed is not
-- contacted about them.
create function private.queue_gift_renewal_reminder(p_membership uuid, p_days_before integer) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare m public.patient_memberships%rowtype; v_buyer uuid; v_first text;
begin
  select * into m from public.patient_memberships where id = p_membership and source = 'purchase' and ends_at is not null;
  if not found then return false; end if;
  if m.order_id is not null then
    -- the exact link: the order this year was paid by (a gift accepted since this migration, or a queued year)
    select o.buyer_profile_id into v_buyer from public.orders o
     where o.id = m.order_id and o.state = 'paid' and o.beneficiary_patient_id = m.patient_id and o.buyer_profile_id <> m.patient_id;
  else
    -- no link (a year started before this migration): an accepted gift whose year ends within a day of this one, and only if that gift is
    -- the person's MOST RECENT paid Membership order, so a year they later bought for themselves never reminds an earlier sponsor
    select o.buyer_profile_id into v_buyer
      from public.entitlements e
      join public.orders o on o.id = e.order_id
      join public.catalog_items i on i.id = o.catalog_item_id and i.kind = 'membership'
     where e.patient_id = m.patient_id and e.acceptance = 'accepted' and o.state = 'paid'
       and o.beneficiary_patient_id = m.patient_id and o.buyer_profile_id <> m.patient_id
       and abs(extract(epoch from (e.ends_at - m.ends_at))) < 86400
       and o.id = (select x.id from public.orders x join public.catalog_items xi on xi.id = x.catalog_item_id and xi.kind = 'membership'
                    where x.beneficiary_patient_id = m.patient_id and x.state = 'paid' order by x.paid_at desc nulls last limit 1)
     order by o.paid_at desc limit 1;
  end if;
  if v_buyer is null then return false; end if;
  if not exists (select 1 from public.care_circle_members c join public.profiles s on s.id = c.supporter_id and s.is_active
                  where c.patient_id = m.patient_id and c.supporter_id = v_buyer and c.state = 'active' and c.expires_at > now()
                    and 'pay_for_care' = any (c.permissions)) then
    return false;
  end if;
  select coalesce(nullif(split_part(btrim(coalesce(full_name, '')), ' ', 1), ''), 'them') into v_first from public.profiles where id = m.patient_id;
  insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
  values (m.organisation_id, v_buyer, private.patient_reminder_channel(v_buyer), 'pending', 'membership_gift_renewal_reminder',
          jsonb_build_object('first_name', v_first, 'ends_at', to_char(m.ends_at at time zone 'Africa/Lagos', 'FMDD Mon YYYY'),
                             'days_before', p_days_before));
  return true;
end $$;
revoke all on function private.queue_gift_renewal_reminder(uuid, integer) from public, anon, authenticated;

select pg_temp.t2p4b_patch_fn('private.queue_membership_renewal_reminders()'::regprocedure, array[
  'v_amount := (private.price_quote_calc(r.patient_id, r.patient_id, r.renewal_item_code, null, false) ->> ''amount_due_kobo'')::bigint;',
  'v_amount := (private.price_quote_calc(r.patient_id, r.patient_id, private.renewal_item_code(r.renewal_item_code), null, false) ->> ''amount_due_kobo'')::bigint;',
  $r$    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    values (r.organisation_id, r.patient_id, private.patient_reminder_channel(r.patient_id), 'pending',
            case when r.source = 'employer'$r$,
  $r$    -- T2-13: a Plus year is told it renews as the Membership, at the Membership price
    if r.tier = 'plus' and r.source <> 'employer' and private.queue_plus_renewal_notice(r.id, v_due, v_auto, v_amount, v_last4) then
      null;
    else
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    values (r.organisation_id, r.patient_id, private.patient_reminder_channel(r.patient_id), 'pending',
            case when r.source = 'employer'$r$,
  $r$    insert into public.membership_renewal_reminders (membership_id, days_before)$r$,
  $r$    end if;
    -- T2-13 / brief 10.2: the person who paid for a gifted year is reminded too (billing facts only)
    perform private.queue_gift_renewal_reminder(r.id, v_due);
    insert into public.membership_renewal_reminders (membership_id, days_before)$r$]);
revoke all on function private.queue_membership_renewal_reminders() from public, anon, authenticated;

insert into public.notification_templates (key, category, business_priority, audience, default_channels, timing, description) values
  ('membership_plus_renews_as_membership', 'operational', 'important', 'patient', '{in_app,push,email}', 'scheduled',
   'T2-13: sent 30, 14 and 7 days before a Membership Plus year ends, instead of the plain reminder. Plus is retired, so renewing gives the Membership at its current price. Nothing is charged unless the person renews. Never SMS.'),
  ('membership_plus_auto_renews_as_membership', 'operational', 'important', 'patient', '{in_app,push,email}', 'scheduled',
   'T2-13: sent 30, 14 and 7 days before a Membership Plus year ends to someone on automatic renewal. States that it renews as the Membership, the Membership amount and the card. A Plus year is never charged without this notice. Never SMS.'),
  ('membership_gift_renewal_reminder', 'operational', 'routine', 'patient', '{in_app,push,email}', 'scheduled',
   'Brief 10.2: sent to the person who paid for someone else''s Membership, 30, 14 and 7 days before it ends, while they still hold that person''s pay-for-care permission. First name and end date only; never anything about their health.')
on conflict (key) do nothing;
insert into public.notification_template_locales (template_key, locale, channel, subject, body) values
  ('membership_plus_renews_as_membership', 'en', 'in_app', 'Your Membership Plus year ends soon',
   'Your Membership Plus year ends on {{ends_at}}. Membership Plus has been retired, so if you renew you will have the Membership, ₦{{amount}} for a year. Nothing is charged unless you choose to renew from the Membership page. Your records stay with you either way.'),
  ('membership_plus_renews_as_membership', 'en', 'push', 'Your Membership Plus year ends soon',
   'It ends on {{ends_at}}. You can renew as the Membership, ₦{{amount}} a year, from the Membership page.'),
  ('membership_plus_renews_as_membership', 'en', 'email', 'Your TarragonHealth Membership Plus year ends on {{ends_at}}',
   E'Hi there,\n\nYour Membership Plus year ends on {{ends_at}}, and you keep everything it includes until then.\n\nMembership Plus has been retired. If you would like to carry on, you can renew from the Membership page in the app as the Membership, ₦{{amount}} for a year.\n\nNothing is charged unless you choose to renew. For 14 days after your year ends you keep your Member access, and your records stay with you either way.\n\nYour care team'),
  ('membership_plus_auto_renews_as_membership', 'en', 'in_app', 'Your Membership renews soon, as the Membership',
   'Your Membership Plus year ends on {{ends_at}}. Membership Plus has been retired, so it will renew as the Membership: we will charge ₦{{amount}} to your card ending {{card_last4}}, not the Plus price. You can cancel renewal any time on the Membership page and keep the year you have paid for.'),
  ('membership_plus_auto_renews_as_membership', 'en', 'push', 'Your Membership renews soon, as the Membership',
   'It renews on {{ends_at}} as the Membership, for ₦{{amount}}. Cancel any time on the Membership page.'),
  ('membership_plus_auto_renews_as_membership', 'en', 'email', 'Your TarragonHealth Membership renews on {{ends_at}}, as the Membership',
   E'Hi there,\n\nYour Membership Plus year ends on {{ends_at}}. Membership Plus has been retired, so your automatic renewal will renew you as the Membership. We will charge ₦{{amount}} to your card ending {{card_last4}}, not the Plus price.\n\nIf you would rather not renew, cancel renewal from the Membership page in the app. You keep the year you have already paid for, and nothing more is charged.\n\nYour records stay with you either way.'),
  ('membership_gift_renewal_reminder', 'en', 'in_app', 'A Membership you gave ends soon',
   'The Membership you gave {{first_name}} ends on {{ends_at}}. Once it ends you can give another year from People you support, and they choose whether to accept it. Nothing renews by itself.'),
  ('membership_gift_renewal_reminder', 'en', 'push', 'A Membership you gave ends soon',
   'The Membership you gave {{first_name}} ends on {{ends_at}}. You can give another year from People you support.'),
  ('membership_gift_renewal_reminder', 'en', 'email', 'The Membership you gave {{first_name}} ends on {{ends_at}}',
   E'Hi there,\n\nThe Membership you gave {{first_name}} ends on {{ends_at}}. Once it ends you can give another year from People you support in the app. They choose whether to accept it, and nothing renews by itself.\n\nPaying for someone''s Membership never gives you access to their health records; they decide what, if anything, to share with you in their Care Circle.')
on conflict (template_key, locale, channel) do nothing;

-- A gift accepted from now on records its order on the new Membership row, so the sponsor is found by an exact link, not a date.
-- From the LIVE body (2026-11-04); only the new-row insert gains order_id. A refund reads order_id only for state = 'scheduled', so an
-- active row carrying it changes no refund path.
select pg_temp.t2p4b_patch_fn('public.respond_to_gifted_pack(uuid,boolean)'::regprocedure, array[
  $r$        insert into public.patient_memberships (organisation_id, patient_id, source, starts_at, ends_at, is_test, tier, collection_state)
        values (o.organisation_id, e.patient_id, 'purchase', now(), now() + make_interval(days => it.duration_days), o.is_test, private.membership_tier_for_item(it.code), o.collection_state);$r$,
  $r$        insert into public.patient_memberships (organisation_id, patient_id, source, starts_at, ends_at, is_test, tier, collection_state, order_id)
        values (o.organisation_id, e.patient_id, 'purchase', now(), now() + make_interval(days => it.duration_days), o.is_test, private.membership_tier_for_item(it.code), o.collection_state, o.id);$r$]);
revoke all on function public.respond_to_gifted_pack(uuid, boolean) from public, anon;
grant execute on function public.respond_to_gifted_pack(uuid, boolean) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Discount codes never name the retired Plus items
-- ---------------------------------------------------------------------------
-- From the LIVE guard body (2026-11-04, unchanged since 20261104010159): item_codes may change only by removing retired Plus items, and
-- never down to an empty list (empty means "every item", which would widen the code).
create or replace function private.discount_codes_guard()
 returns trigger
 language plpgsql
 set search_path to ''
as $function$
begin
  if tg_op = 'DELETE' then raise exception 'discount_code_immutable' using errcode = 'P0001'; end if;
  if new.code is distinct from old.code or new.kind is distinct from old.kind or new.percent is distinct from old.percent
     or new.fixed_kobo is distinct from old.fixed_kobo or new.max_discount_kobo is distinct from old.max_discount_kobo
     or (new.item_codes is distinct from old.item_codes
         and not (new.item_codes = array(select c from unnest(old.item_codes) with ordinality u(c, n)
                                          where c not in ('membership_annual', 'membership_upgrade_plus') order by n)
                  and cardinality(new.item_codes) >= 1))
     or new.cohort_id is distinct from old.cohort_id
     or new.max_total_uses is distinct from old.max_total_uses or new.max_uses_per_person is distinct from old.max_uses_per_person
     or new.valid_from is distinct from old.valid_from or new.organisation_id is distinct from old.organisation_id
     or new.is_test is distinct from old.is_test or new.valid_to > old.valid_to
     or new.badge is distinct from old.badge then
    raise exception 'discount_code_immutable' using errcode = 'P0001';
  end if;
  if old.status = 'ended' and new.status <> 'ended' then raise exception 'discount_code_ended' using errcode = 'P0001'; end if;
  return new;
end $function$;
revoke all on function private.discount_codes_guard() from public, anon, authenticated;

select pg_temp.t2p4b_patch_fn('public.admin_create_discount_code(text,text,integer,bigint,bigint,text[],uuid,integer,integer,timestamp with time zone,timestamp with time zone,text,text)'::regprocedure, array[
  $r$  if p_code is not null and (v_code is null or char_length(v_code) not between 4 and 24) then raise exception 'discount_code_invalid' using errcode = '22023'; end if;$r$,
  $r$  -- T2-01/T2-13: Membership Plus and the upgrade are retired; no new code may name them
  if coalesce(p_item_codes, '{}') && array['membership_annual', 'membership_upgrade_plus'] then raise exception 'retired_item' using errcode = '22023'; end if;
  if p_code is not null and (v_code is null or char_length(v_code) not between 4 and 24) then raise exception 'discount_code_invalid' using errcode = '22023'; end if;$r$,
  $r$is distinct from array['membership_annual', 'membership_annual_no_panel'] then$r$,
  $r$is distinct from array['membership_annual_no_panel'] then$r$]);
revoke all on function public.admin_create_discount_code(text, text, integer, bigint, bigint, text[], uuid, integer, integer, timestamptz, timestamptz, text, text) from public, anon;
grant execute on function public.admin_create_discount_code(text, text, integer, bigint, bigint, text[], uuid, integer, integer, timestamptz, timestamptz, text, text) to authenticated, service_role;

-- existing codes: drop the retired items; a code that named only retired items cannot be used for anything, so it is ended
update public.discount_codes
   set item_codes = array(select c from unnest(item_codes) with ordinality u(c, n) where c not in ('membership_annual', 'membership_upgrade_plus') order by n)
 where item_codes && array['membership_annual', 'membership_upgrade_plus']
   and exists (select 1 from unnest(item_codes) c where c not in ('membership_annual', 'membership_upgrade_plus'));
update public.discount_codes set status = 'ended'
 where status <> 'ended' and cardinality(item_codes) >= 1
   and not exists (select 1 from unnest(item_codes) c where c not in ('membership_annual', 'membership_upgrade_plus'));

-- ---------------------------------------------------------------------------
-- 4. AI-023 evaluation case pricing_16 (apps/web/src/lib/frontdesk/eval/cases.ts): the scenario only, never a run or a result
-- ---------------------------------------------------------------------------
update public.ai_evaluation_cases set scenario = 'Is Membership Plus still available?'
 where case_code = 'pricing_16' and scenario = 'What is the difference between Membership and Membership Plus?';

-- ---------------------------------------------------------------------------
-- Assertions
-- ---------------------------------------------------------------------------
do $$
begin
  if private.renewal_item_code('membership_annual') <> 'membership_annual_no_panel' or private.renewal_item_code('membership_annual_no_panel') <> 'membership_annual_no_panel' then
    raise exception 'FAIL: a Plus renewal does not map to the Membership';
  end if;
  if exists (select 1 from public.patient_memberships where renewal_item_code in ('membership_annual', 'membership_upgrade_plus')) then
    raise exception 'FAIL: a membership still renews onto a retired Plus item';
  end if;
  if position('plus_notice_pending' in pg_get_functiondef('public.service_prepare_membership_renewal(uuid)'::regprocedure)) = 0 then
    raise exception 'FAIL: the renewal charge does not wait for the Plus notice';
  end if;
  if position('queue_plus_renewal_notice' in pg_get_functiondef('private.queue_membership_renewal_reminders()'::regprocedure)) = 0
     or position('queue_gift_renewal_reminder' in pg_get_functiondef('private.queue_membership_renewal_reminders()'::regprocedure)) = 0 then
    raise exception 'FAIL: the reminders do not send the Plus notice or the sponsor reminder';
  end if;
  if exists (select 1 from public.discount_codes where status <> 'ended' and item_codes && array['membership_annual', 'membership_upgrade_plus']) then
    raise exception 'FAIL: a live discount code still names a retired Plus item';
  end if;
  if has_function_privilege('anon', 'private.queue_gift_renewal_reminder(uuid,integer)', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.queue_plus_renewal_notice(uuid,integer,boolean,bigint,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.renewal_item_code(text)', 'EXECUTE') then
    raise exception 'FAIL: a new private function is executable by a client role';
  end if;
  raise notice 'PASS: t2-13 a Plus year renews as the Membership, after notice';
end $$;
