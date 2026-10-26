-- Membership auto-renewal (founder decision 2026-10-26): a Member who ticks the consent box when paying by card has that card kept
-- by Paystack, and the Membership renews for another year unless they cancel. Cancelling is one tap, keeps the year already paid for,
-- and stops the next charge. The whole feature ships DORMANT behind public.platform_modules key 'membership_auto_renew' (OFF), the
-- same dormant-switch pattern the removed membership_instalments used, because:
--   * no code in this repo has ever charged a saved Paystack authorization, so the first real charge must be a deliberate, watched one;
--   * only cards Paystack marks `reusable` can be charged again (bank transfer and USSD never are), and Nigerian card eligibility has
--     to be confirmed with Paystack for this account before the switch is flipped;
--   * the public copy ("renews automatically" vs "does not renew by itself") reads this same switch, so it cannot say one thing while
--     the product does another.
--
-- WHAT IT DOES
--   1. Adds the switch and public.membership_auto_renew_enabled() (readable by anon so ISR marketing pages can follow it).
--   2. membership_cards: the saved Paystack authorization, one per patient. SERVICE ROLE ONLY (no policy, all privileges revoked).
--      It is deliberately NOT stored in payments.raw, which a patient can read through RLS.
--   3. Consent is recorded on the ORDER before payment (public.set_order_renewal_consent); the card is saved only after that order
--      is paid AND carries consent AND Paystack says the authorization is reusable (public.save_membership_card).
--   4. A daily sweep (cron -> membership-renewal edge function) charges memberships ending within 3 days, up to 3 tries, one a day.
--      Charging before ends_at makes the EXISTING record_order_payment extend from ends_at (greatest(ends_at, paid_at) + 365d), so no
--      day of the paid year is lost. Each renewal is an ordinary orders + payments row, so the ledger, refund window (21 days) and
--      receipts all work unchanged.
--   5. record_order_payment is rewritten from its LIVE definition (pg_get_functiondef, 2026-10-26) with one change: a renewal order
--      does not raise the 'order-membership-overlap' incident (expected for a renewal) and queues a 'membership_renewed' notice.
--   6. Patient RPCs: my_membership_renewal() (status) and cancel_membership_renewal() (cancel, delete the saved card).
--   7. Notices: membership_auto_renewal_notice replaces the "ends soon" reminder for people on auto-renewal; also
--      membership_renewed, membership_renewal_failed, membership_renewal_cancelled. Never SMS.
--
-- HONEST LIMITS: turning renewal back on after cancelling needs a new card payment with consent (Paystack must tokenise a card via a
-- real charge). A gift, an employer seat or a sponsor-funded order never auto-renews. Row counts at writing: 0 saved cards, 0
-- renewals; the Membership catalogue items are all inactive, so nothing live changes when this lands.
--
-- ROLLBACK: restore record_order_payment and queue_membership_renewal_reminders from 20261006204511 / 20261013010732; drop the four
-- new functions groups and tables below; drop the added columns; delete the platform_modules row and the templates; cron.unschedule.

-- ---------------------------------------------------------------------------
-- 1. The dormant switch
-- ---------------------------------------------------------------------------
insert into public.platform_modules (key, label, description)
values ('membership_auto_renew', 'Membership auto-renewal',
        'Renews a Member''s year by charging the card they chose to keep, unless they cancel. Defaults OFF. Do not enable until Paystack has confirmed reusable-authorization eligibility for this account and one real test charge (with its fee behaviour) has been watched end to end. The public renewal copy follows this switch.')
on conflict (key) do nothing;

create or replace function public.membership_auto_renew_enabled() returns boolean
language sql stable security definer set search_path = ''
as $$ select coalesce((select is_enabled from public.platform_modules where key = 'membership_auto_renew'), false) $$;
revoke all on function public.membership_auto_renew_enabled() from public;
grant execute on function public.membership_auto_renew_enabled() to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Columns and tables
-- ---------------------------------------------------------------------------
alter table public.patient_memberships
  add column auto_renew boolean not null default false,
  add column renewal_item_code text,
  add column renewal_consent_at timestamptz,
  add column renewal_cancelled_at timestamptz,
  -- the price the person was last SHOWN for the next renewal (at the first payment, then at each 30/14/7 day notice, then at each renewal
  -- charged). A renewal is charged only if the current price is no higher than this; a rise is told to them first, never charged.
  add column renewal_notified_kobo bigint check (renewal_notified_kobo is null or renewal_notified_kobo > 0),
  add column renewal_notified_at timestamptz;
alter table public.patient_memberships
  add constraint patient_memberships_auto_renew_needs_consent
  check (not auto_renew or (renewal_item_code is not null and renewal_consent_at is not null));

alter table public.orders
  add column renewal_consent_at timestamptz,
  add column renewal_card_result text check (renewal_card_result in ('saved', 'not_reusable', 'no_consent')),
  add column renews_membership_id uuid references public.patient_memberships (id) on delete restrict,
  add column renewal_term_ends_at timestamptz,
  add constraint orders_renewal_pair check ((renews_membership_id is null) = (renewal_term_ends_at is null));
-- Each renewal ATTEMPT is its own order (orders are immutable once created: reference, amount and quote cannot change, so a retry
-- cannot reuse one). Never two PAID orders for one term: service_prepare_membership_renewal refuses once one is paid, and the
-- edge function verifies earlier attempts with Paystack before it makes another.
create index orders_renewal_term_idx on public.orders (renews_membership_id, renewal_term_ends_at) where renews_membership_id is not null;

create table public.membership_cards (
  patient_id uuid primary key references public.profiles (id) on delete cascade,
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  authorization_code text not null,
  customer_code text,
  email text not null,
  signature text,
  brand text,
  last4 text,
  exp_month text,
  exp_year text,
  source_order_id uuid references public.orders (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.membership_cards enable row level security;
revoke all on public.membership_cards from public, anon, authenticated;

-- One row per run of the daily sweep, written by the edge function. The watchdog reads it: a sweep that never reports in is the failure
-- nobody would otherwise see (a missing secret answers 401 and renews nobody, silently).
create table public.membership_renewal_runs (
  id uuid primary key default gen_random_uuid(),
  ran_at timestamptz not null default clock_timestamp(),
  ok boolean not null,
  considered integer not null default 0,
  renewed integer not null default 0,
  failed integer not null default 0,
  pending integer not null default 0,
  skipped integer not null default 0,
  already_paid integer not null default 0
);
alter table public.membership_renewal_runs enable row level security;
revoke all on public.membership_renewal_runs from public, anon, authenticated;
create index membership_renewal_runs_ran_idx on public.membership_renewal_runs (ran_at desc);

create table public.membership_renewal_attempts (
  id uuid primary key default gen_random_uuid(),
  membership_id uuid not null references public.patient_memberships (id) on delete cascade,
  order_id uuid not null references public.orders (id) on delete cascade,
  term_ends_at timestamptz not null,
  attempt_no integer not null check (attempt_no between 1 and 3),
  reference text not null,
  outcome text not null default 'started' check (outcome in ('started', 'charged', 'failed', 'pending')),
  error text,
  created_at timestamptz not null default now(),
  unique (membership_id, term_ends_at, attempt_no)
);
alter table public.membership_renewal_attempts enable row level security;
revoke all on public.membership_renewal_attempts from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Consent on the order, and saving the card after payment
-- ---------------------------------------------------------------------------
create or replace function public.set_order_renewal_consent(p_order uuid, p_consent boolean) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid()); o public.orders%rowtype; it public.catalog_items%rowtype;
begin
  if v_uid is null then raise exception 'order_not_authorised' using errcode = '42501'; end if;
  if not public.membership_auto_renew_enabled() then return false; end if;
  select * into o from public.orders where id = p_order and buyer_profile_id = v_uid for update;
  if not found or o.state <> 'created' then return false; end if;
  -- only your own Membership; a gift is never renewed on the giver's card
  if o.buyer_profile_id <> o.beneficiary_patient_id then return false; end if;
  select * into it from public.catalog_items where id = o.catalog_item_id;
  if it.kind <> 'membership' or it.code = 'membership_upgrade_plus' then return false; end if;
  update public.orders set renewal_consent_at = case when coalesce(p_consent, false) then now() else null end where id = o.id;
  return coalesce(p_consent, false);
end $$;
revoke all on function public.set_order_renewal_consent(uuid, boolean) from public, anon;
grant execute on function public.set_order_renewal_consent(uuid, boolean) to authenticated, service_role;

create or replace function public.save_membership_card(
  p_reference text, p_authorization_code text, p_reusable boolean, p_signature text, p_brand text, p_last4 text,
  p_exp_month text, p_exp_year text, p_customer_code text, p_email text
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare o public.orders%rowtype; it public.catalog_items%rowtype; m public.patient_memberships%rowtype;
begin
  if (select auth.role()) is distinct from 'service_role' then raise exception 'order_not_authorised' using errcode = '42501'; end if;
  select * into o from public.orders where paystack_reference = p_reference for update;
  if not found or o.state <> 'paid' then return jsonb_build_object('result', 'not_paid'); end if;
  if o.renews_membership_id is not null then return jsonb_build_object('result', 'renewal_order'); end if;
  if o.renewal_consent_at is null then return jsonb_build_object('result', 'no_consent'); end if;
  if not public.membership_auto_renew_enabled() then return jsonb_build_object('result', 'module_off'); end if;
  select * into it from public.catalog_items where id = o.catalog_item_id;
  if it.kind <> 'membership' or o.buyer_profile_id <> o.beneficiary_patient_id then return jsonb_build_object('result', 'not_eligible'); end if;
  if not coalesce(p_reusable, false) or coalesce(p_authorization_code, '') = '' or coalesce(p_email, '') = '' then
    update public.orders set renewal_card_result = 'not_reusable' where id = o.id;
    return jsonb_build_object('result', 'not_reusable');
  end if;
  select * into m from public.patient_memberships
   where patient_id = o.beneficiary_patient_id and state = 'active' and source = 'purchase' order by starts_at desc limit 1 for update;
  if not found then return jsonb_build_object('result', 'no_membership'); end if;
  insert into public.membership_cards (patient_id, organisation_id, authorization_code, customer_code, email, signature, brand, last4, exp_month, exp_year, source_order_id)
  values (o.beneficiary_patient_id, o.organisation_id, p_authorization_code, p_customer_code, p_email, p_signature, p_brand, p_last4, p_exp_month, p_exp_year, o.id)
  on conflict (patient_id) do update set authorization_code = excluded.authorization_code, customer_code = excluded.customer_code,
    email = excluded.email, signature = excluded.signature, brand = excluded.brand, last4 = excluded.last4, exp_month = excluded.exp_month,
    exp_year = excluded.exp_year, source_order_id = excluded.source_order_id, updated_at = now();
  -- the baseline: the LIST price they saw and agreed to renew at (not a first-year discount)
  update public.patient_memberships set auto_renew = true, renewal_item_code = it.code, renewal_consent_at = o.renewal_consent_at, renewal_cancelled_at = null,
         renewal_notified_kobo = coalesce(o.list_amount_kobo, o.amount_kobo), renewal_notified_at = now() where id = m.id;
  update public.orders set renewal_card_result = 'saved' where id = o.id;
  return jsonb_build_object('result', 'saved', 'membership_id', m.id);
end $$;
revoke all on function public.save_membership_card(text, text, boolean, text, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.save_membership_card(text, text, boolean, text, text, text, text, text, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 4. The patient's view and the one-tap cancel
-- ---------------------------------------------------------------------------
create or replace function public.my_membership_renewal() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid()); m public.patient_memberships%rowtype; c public.membership_cards%rowtype; q jsonb; v_amount bigint;
begin
  if v_uid is null then raise exception 'order_not_authorised' using errcode = '42501'; end if;
  select * into m from public.patient_memberships where patient_id = v_uid and state = 'active' order by starts_at desc limit 1;
  if not found then return jsonb_build_object('enabled', public.membership_auto_renew_enabled(), 'auto_renew', false, 'has_membership', false); end if;
  select * into c from public.membership_cards where patient_id = v_uid;
  if m.auto_renew and m.renewal_item_code is not null then
    begin
      q := private.price_quote_calc(v_uid, v_uid, m.renewal_item_code, null, false);
      v_amount := (q ->> 'amount_due_kobo')::bigint;
    exception when others then v_amount := null;
    end;
  end if;
  return jsonb_build_object('enabled', public.membership_auto_renew_enabled(), 'has_membership', true, 'auto_renew', m.auto_renew,
    'ends_at', m.ends_at, 'cancelled_at', m.renewal_cancelled_at, 'amount_kobo', v_amount,
    'card', case when c.patient_id is null then null else jsonb_build_object('brand', c.brand, 'last4', c.last4, 'exp_month', c.exp_month, 'exp_year', c.exp_year) end);
end $$;
revoke all on function public.my_membership_renewal() from public, anon;
grant execute on function public.my_membership_renewal() to authenticated, service_role;

create or replace function public.cancel_membership_renewal() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid()); m public.patient_memberships%rowtype; pr public.profiles%rowtype;
begin
  if v_uid is null then raise exception 'order_not_authorised' using errcode = '42501'; end if;
  select * into m from public.patient_memberships where patient_id = v_uid and state = 'active' order by starts_at desc limit 1 for update;
  if not found then return jsonb_build_object('result', 'no_membership'); end if;
  delete from public.membership_cards where patient_id = v_uid;
  if not m.auto_renew then return jsonb_build_object('result', 'already_off', 'ends_at', m.ends_at); end if;
  update public.patient_memberships set auto_renew = false, renewal_cancelled_at = now() where id = m.id;
  select * into pr from public.profiles where id = v_uid;
  insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
  values (pr.organisation_id, v_uid, private.patient_reminder_channel(v_uid), 'pending', 'membership_renewal_cancelled',
          jsonb_build_object('membership_id', m.id, 'ends_at', to_char(m.ends_at at time zone 'Africa/Lagos', 'FMDD Mon YYYY')));
  return jsonb_build_object('result', 'cancelled', 'ends_at', m.ends_at);
end $$;
revoke all on function public.cancel_membership_renewal() from public, anon;
grant execute on function public.cancel_membership_renewal() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. The sweep: who is due, prepare one renewal order, record the outcome
-- ---------------------------------------------------------------------------
create or replace function public.service_due_membership_renewals(p_limit integer default 50) returns table (membership_id uuid)
language plpgsql security definer set search_path = ''
as $$
begin
  if (select auth.role()) is distinct from 'service_role' then raise exception 'order_not_authorised' using errcode = '42501'; end if;
  if not public.membership_auto_renew_enabled() then return; end if;
  return query
    select m.id from public.patient_memberships m
     where m.state = 'active' and m.auto_renew and m.ends_at is not null
       and m.ends_at > now() and m.ends_at <= now() + interval '3 days'
       and exists (select 1 from public.membership_cards c where c.patient_id = m.patient_id)
       and not exists (select 1 from public.orders o where o.renews_membership_id = m.id and o.renewal_term_ends_at = m.ends_at and o.state = 'paid')
     order by m.ends_at limit greatest(1, least(coalesce(p_limit, 50), 200));
end $$;
revoke all on function public.service_due_membership_renewals(integer) from public, anon, authenticated;
grant execute on function public.service_due_membership_renewals(integer) to service_role;

create or replace function public.service_prepare_membership_renewal(p_membership uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  m public.patient_memberships%rowtype; c public.membership_cards%rowtype; pr public.profiles%rowtype; it public.catalog_items%rowtype;
  o public.orders%rowtype; q jsonb; v_amount bigint; v_ref text; v_tries integer;
begin
  if (select auth.role()) is distinct from 'service_role' then raise exception 'order_not_authorised' using errcode = '42501'; end if;
  if not public.membership_auto_renew_enabled() then return jsonb_build_object('skip', 'module_off'); end if;
  select * into m from public.patient_memberships where id = p_membership for update;
  if not found or m.state <> 'active' or not m.auto_renew or m.ends_at is null then return jsonb_build_object('skip', 'not_eligible'); end if;
  if m.ends_at <= now() or m.ends_at > now() + interval '3 days' then return jsonb_build_object('skip', 'outside_window'); end if;
  select * into c from public.membership_cards where patient_id = m.patient_id;
  if not found then perform private.notify_renewal_blocked(m.id); return jsonb_build_object('skip', 'no_card'); end if;
  select * into pr from public.profiles where id = m.patient_id and is_active;
  if not found then perform private.notify_renewal_blocked(m.id); return jsonb_build_object('skip', 'inactive'); end if;
  select * into it from public.catalog_items where organisation_id = pr.organisation_id and code = m.renewal_item_code;
  if not found or not it.active or it.kind <> 'membership' then perform private.notify_renewal_blocked(m.id); return jsonb_build_object('skip', 'item_unavailable'); end if;

  if exists (select 1 from public.orders where renews_membership_id = m.id and renewal_term_ends_at = m.ends_at and state in ('paid', 'refunded')) then
    return jsonb_build_object('skip', 'already_renewed');
  end if;
  select count(*) into v_tries from public.membership_renewal_attempts where membership_id = m.id and term_ends_at = m.ends_at;
  if v_tries >= 3 then return jsonb_build_object('skip', 'attempts_exhausted'); end if;
  if exists (select 1 from public.membership_renewal_attempts where membership_id = m.id and term_ends_at = m.ends_at and created_at > now() - interval '20 hours') then
    return jsonb_build_object('skip', 'too_soon');
  end if;

  -- the price is whatever the Membership costs when the renewal falls due, with no discount and no points; a sponsor never renews on a card
  begin
    q := private.price_quote_calc(m.patient_id, m.patient_id, it.code, null, false);
  exception when others then
    -- e.g. membership_not_open (the billing guard is closed): do not charge, do not raise; the next daily run asks again
    perform private.notify_renewal_blocked(m.id); return jsonb_build_object('skip', 'quote_unavailable');
  end;
  v_amount := (q ->> 'amount_due_kobo')::bigint;
  -- the price may only stay the same or fall since the person was last shown it; a rise is told to them, never charged
  if v_amount is not null and v_amount > coalesce(m.renewal_notified_kobo, 0) then
    perform private.notify_renewal_price_changed(m.id, v_amount);
    return jsonb_build_object('skip', 'price_changed');
  end if;
  if coalesce((q ->> 'sponsor_share_kobo')::bigint, 0) > 0 or v_amount is null or v_amount <= 0 then perform private.notify_renewal_blocked(m.id); return jsonb_build_object('skip', 'not_chargeable'); end if;

  v_ref := 'ren_' || replace(gen_random_uuid()::text, '-', '');
  -- close any earlier open attempt for this year (the caller verified it with Paystack first); a late payment on it would still be honoured
  update public.orders set state = 'cancelled', cancelled_at = now(), failure_reason = 'superseded by a newer renewal attempt'
   where renews_membership_id = m.id and renewal_term_ends_at = m.ends_at and state = 'created';
  insert into public.orders (organisation_id, buyer_profile_id, beneficiary_patient_id, catalog_item_id, price_id, amount_kobo, components,
                             paystack_reference, client_key, is_test, list_amount_kobo, sponsor_share_kobo, discount_code_id, discount_kobo,
                             points_applied, points_reduction_kobo, price_book_entry_id, pricing_rules_version, quote,
                             renews_membership_id, renewal_term_ends_at, expires_at)
  values (pr.organisation_id, m.patient_id, m.patient_id, it.id, (q ->> 'price_id')::uuid, v_amount,
          (select components from public.prices where id = (q ->> 'price_id')::uuid),
          v_ref, null, coalesce(pr.is_test, false), (q ->> 'list_kobo')::bigint, 0, null, 0, 0, 0,
          (q ->> 'price_book_entry_id')::uuid, (q ->> 'pricing_rules_version')::integer, q,
          m.id, m.ends_at, now() + interval '1 day')
  returning * into o;
  insert into public.membership_renewal_attempts (membership_id, order_id, term_ends_at, attempt_no, reference)
  values (m.id, o.id, m.ends_at, v_tries + 1, v_ref);
  return jsonb_build_object('order_id', o.id, 'reference', v_ref, 'amount_kobo', v_amount, 'email', c.email,
                            'authorization_code', c.authorization_code, 'attempt_no', v_tries + 1);
end $$;
revoke all on function public.service_prepare_membership_renewal(uuid) from public, anon, authenticated;
grant execute on function public.service_prepare_membership_renewal(uuid) to service_role;

-- References of EARLIER attempts for this membership's current year that are not known to be paid: the sweep verifies each with Paystack
-- before it makes another attempt, so a charge that succeeded but never confirmed cannot be charged twice.
create or replace function public.service_renewal_open_references(p_membership uuid) returns table (reference text)
language plpgsql security definer set search_path = ''
as $$
begin
  if (select auth.role()) is distinct from 'service_role' then raise exception 'order_not_authorised' using errcode = '42501'; end if;
  return query
    select a.reference from public.membership_renewal_attempts a
      join public.orders o on o.id = a.order_id
      join public.patient_memberships m on m.id = a.membership_id
     where a.membership_id = p_membership and a.term_ends_at = m.ends_at and o.state <> 'paid' and a.outcome in ('started', 'pending', 'charged', 'failed')
     order by a.attempt_no;
end $$;
revoke all on function public.service_renewal_open_references(uuid) from public, anon, authenticated;
grant execute on function public.service_renewal_open_references(uuid) to service_role;

create or replace function public.service_record_renewal_attempt(p_reference text, p_outcome text, p_error text default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare a public.membership_renewal_attempts%rowtype; m public.patient_memberships%rowtype; pr public.profiles%rowtype;
begin
  if (select auth.role()) is distinct from 'service_role' then raise exception 'order_not_authorised' using errcode = '42501'; end if;
  if p_outcome not in ('charged', 'failed', 'pending') then raise exception 'bad outcome'; end if;
  select * into a from public.membership_renewal_attempts where reference = p_reference for update;
  if not found then return jsonb_build_object('result', 'not_found'); end if;
  update public.membership_renewal_attempts set outcome = p_outcome, error = left(p_error, 300) where id = a.id;
  if p_outcome = 'failed' then
    update public.orders set failure_reason = left(coalesce(p_error, 'renewal charge failed'), 200) where id = a.order_id and state <> 'paid';
    -- say so on the first miss and on the last, never a daily burst
    if a.attempt_no in (1, 3) then
      select * into m from public.patient_memberships where id = a.membership_id;
      select * into pr from public.profiles where id = m.patient_id;
      insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
      values (pr.organisation_id, m.patient_id, private.patient_reminder_channel(m.patient_id), 'pending', 'membership_renewal_failed',
              jsonb_build_object('membership_id', m.id, 'term', a.term_ends_at::text, 'ends_at', to_char(m.ends_at at time zone 'Africa/Lagos', 'FMDD Mon YYYY'),
                                 'final', a.attempt_no = 3));
    end if;
  end if;
  return jsonb_build_object('result', 'recorded', 'attempt_no', a.attempt_no);
end $$;
revoke all on function public.service_record_renewal_attempt(text, text, text) from public, anon, authenticated;
grant execute on function public.service_record_renewal_attempt(text, text, text) to service_role;

-- A renewal that cannot even be attempted (item closed, no quote, no card, a sponsor share) after the person was told it would renew is told
-- ONCE for that year, never silently. The same wording as a failed charge: renew by hand.
create or replace function private.notify_renewal_blocked(p_membership uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare m public.patient_memberships%rowtype; pr public.profiles%rowtype;
begin
  select * into m from public.patient_memberships where id = p_membership;
  if exists (select 1 from public.notifications n where n.recipient_id = m.patient_id and n.template = 'membership_renewal_failed'
                and n.payload ->> 'membership_id' = m.id::text and n.payload ->> 'term' = m.ends_at::text and (n.payload ->> 'final')::boolean) then return; end if;
  select * into pr from public.profiles where id = m.patient_id;
  insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
  values (pr.organisation_id, m.patient_id, private.patient_reminder_channel(m.patient_id), 'pending', 'membership_renewal_failed',
          jsonb_build_object('membership_id', m.id, 'term', m.ends_at::text, 'final', true, 'ends_at', to_char(m.ends_at at time zone 'Africa/Lagos', 'FMDD Mon YYYY')));
end $$;
revoke all on function private.notify_renewal_blocked(uuid) from public, anon, authenticated;

-- The price rose after the person was last shown it, so the card was NOT charged. Told once per year, with the new amount.
create or replace function private.notify_renewal_price_changed(p_membership uuid, p_amount_kobo bigint) returns void
language plpgsql security definer set search_path = ''
as $$
declare m public.patient_memberships%rowtype; pr public.profiles%rowtype;
begin
  select * into m from public.patient_memberships where id = p_membership;
  if exists (select 1 from public.notifications n where n.recipient_id = m.patient_id and n.template = 'membership_renewal_price_changed'
                and n.payload ->> 'membership_id' = m.id::text and n.payload ->> 'term' = m.ends_at::text) then return; end if;
  select * into pr from public.profiles where id = m.patient_id;
  insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
  values (pr.organisation_id, m.patient_id, private.patient_reminder_channel(m.patient_id), 'pending', 'membership_renewal_price_changed',
          jsonb_build_object('membership_id', m.id, 'term', m.ends_at::text, 'amount', to_char(p_amount_kobo / 100, 'FM999,999,999'),
                             'ends_at', to_char(m.ends_at at time zone 'Africa/Lagos', 'FMDD Mon YYYY')));
end $$;
revoke all on function private.notify_renewal_price_changed(uuid, bigint) from public, anon, authenticated;

-- The sweep reports every run, including a run with nothing due and a run that failed.
create or replace function public.service_record_renewal_run(p_ok boolean, p_summary jsonb default '{}'::jsonb) returns boolean
language plpgsql security definer set search_path = ''
as $$
begin
  if (select auth.role()) is distinct from 'service_role' then raise exception 'order_not_authorised' using errcode = '42501'; end if;
  insert into public.membership_renewal_runs (ok, considered, renewed, failed, pending, skipped, already_paid)
  values (coalesce(p_ok, false),
          coalesce((p_summary ->> 'considered')::integer, 0), coalesce((p_summary ->> 'renewed')::integer, 0), coalesce((p_summary ->> 'failed')::integer, 0),
          coalesce((p_summary ->> 'pending')::integer, 0), coalesce((p_summary ->> 'skipped')::integer, 0), coalesce((p_summary ->> 'alreadyPaid')::integer, 0));
  return true;
end $$;
revoke all on function public.service_record_renewal_run(boolean, jsonb) from public, anon, authenticated;
grant execute on function public.service_record_renewal_run(boolean, jsonb) to service_role;

-- The watchdog (daily, two hours after the sweep). Opens an ops incident, once per cause per day, when automatic renewal is ON and
--   (a) the sweep has not reported in 26 hours (a missing vault secret, a wrong secret, a crashed function, a cron that stopped),
--   (b) the last run failed outright or had failed charges, or
--   (c) a membership that should already have been attempted (ends within 2 days, card on file, no attempt, not paid, nobody told) was not.
-- It does nothing while the switch is OFF. Returns what it found, so a test can assert it.
create or replace function private.check_renewal_health() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_org uuid; v_last public.membership_renewal_runs%rowtype; v_overdue integer; v_missing boolean; v_failing boolean; v_day text := to_char(now() at time zone 'Africa/Lagos', 'YYYY-MM-DD');
begin
  if not public.membership_auto_renew_enabled() then return jsonb_build_object('skipped', true); end if;
  select organisation_id into v_org from public.catalog_items where code = 'membership_annual' order by created_at limit 1;
  select * into v_last from public.membership_renewal_runs order by ran_at desc limit 1;
  v_missing := not found or v_last.ran_at < now() - interval '26 hours';
  v_failing := found and (not v_last.ok or v_last.failed > 0) and v_last.ran_at >= now() - interval '26 hours';
  select count(*) into v_overdue from public.patient_memberships m
   where m.state = 'active' and m.auto_renew and m.ends_at is not null and m.ends_at > now() and m.ends_at <= now() + interval '2 days'
     and exists (select 1 from public.membership_cards c where c.patient_id = m.patient_id)
     and not exists (select 1 from public.membership_renewal_attempts a where a.membership_id = m.id and a.term_ends_at = m.ends_at)
     and not exists (select 1 from public.orders o where o.renews_membership_id = m.id and o.renewal_term_ends_at = m.ends_at and o.state in ('paid', 'refunded'))
     and not exists (select 1 from public.notifications n where n.recipient_id = m.patient_id and n.payload ->> 'membership_id' = m.id::text and n.payload ->> 'term' = m.ends_at::text);
  if v_missing then
    perform private.order_incident(v_org, 'membership-renewal-sweep-missing:' || v_day, 'The daily Membership renewal run has not reported in',
      'Automatic renewal is ON but the sweep has not reported in for over 26 hours, so nobody is being renewed. Check the membership_renewal_secret in Vault matches MEMBERSHIP_RENEWAL_SECRET on the function, that membership-renewal is deployed, and the cron job membership-auto-renew-daily.');
  end if;
  if v_failing then
    perform private.order_incident(v_org, 'membership-renewal-failures:' || v_day, 'Membership renewals are failing',
      'The last renewal run reported ' || v_last.failed || ' failed charge(s)' || case when not v_last.ok then ' and the run itself failed' else '' end || '. Look at membership_renewal_attempts and the payments for the affected members.');
  end if;
  if v_overdue > 0 then
    perform private.order_incident(v_org, 'membership-renewal-overdue:' || v_day, 'Membership renewals are overdue',
      v_overdue || ' membership(s) end within 2 days, have a saved card and renewal on, and have not been attempted or told anything.');
  end if;
  return jsonb_build_object('sweep_missing', v_missing, 'failures', v_failing, 'overdue', v_overdue);
end $$;
revoke all on function private.check_renewal_health() from public, anon, authenticated;
select cron.schedule('membership-renewal-watchdog', '0 8 * * *', $$ select private.check_renewal_health(); $$);

-- the "your Membership has renewed" notice, queued from record_order_payment so it fires whichever path (sweep, webhook, reconcile) confirms
create or replace function private.queue_membership_renewed_notice(p_order uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare o public.orders%rowtype; m public.patient_memberships%rowtype; c public.membership_cards%rowtype;
begin
  select * into o from public.orders where id = p_order;
  -- the patient's CURRENT membership: the same row after an on-time renewal, the new row after a late one
  select * into m from public.patient_memberships where patient_id = o.beneficiary_patient_id and state = 'active' order by starts_at desc limit 1;
  select * into c from public.membership_cards where patient_id = o.beneficiary_patient_id;
  insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
  values (o.organisation_id, o.beneficiary_patient_id, private.patient_reminder_channel(o.beneficiary_patient_id), 'pending', 'membership_renewed',
          jsonb_build_object('order_id', o.id, 'amount', to_char(o.amount_kobo / 100, 'FM999,999,999'), 'card_last4', coalesce(c.last4, ''),
                             'ends_at', to_char(m.ends_at at time zone 'Africa/Lagos', 'FMDD Mon YYYY')));
end $$;
revoke all on function private.queue_membership_renewed_notice(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. record_order_payment: the LIVE body, with the renewal change only
-- ---------------------------------------------------------------------------
create or replace function public.record_order_payment(p_reference text, p_amount_kobo bigint, p_fee_kobo bigint, p_total_kobo bigint, p_currency text, p_status text, p_source text, p_event_key text default null::text, p_paid_at timestamp with time zone default null::timestamp with time zone, p_raw jsonb default '{}'::jsonb, p_processor_fee_kobo bigint default null::bigint)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  o public.orders%rowtype;
  it public.catalog_items%rowtype;
  v_reason text;
  v_ent uuid;
  v_old public.patient_memberships%rowtype;
  v_start timestamptz := coalesce(p_paid_at, now());
begin
  if (select auth.role()) is distinct from 'service_role' then raise exception 'order_not_authorised' using errcode = '42501'; end if;
  select * into o from public.orders where paystack_reference = p_reference for update;
  if not found then return jsonb_build_object('result', 'not_found'); end if;

  if p_status is distinct from 'success' then return jsonb_build_object('result', 'not_paid', 'order_id', o.id); end if;
  if o.state in ('paid', 'refunded') and exists (select 1 from public.payments where provider = 'paystack' and provider_reference = p_reference and status = 'success') then
    return jsonb_build_object('result', 'replay', 'order_id', o.id);
  end if;

  v_reason := case
    when p_currency is distinct from 'NGN' then 'currency'
    when p_amount_kobo is distinct from o.amount_kobo then 'amount'
    when p_fee_kobo is null or p_fee_kobo < 0 or p_total_kobo is distinct from p_amount_kobo + p_fee_kobo then 'fee'
    when p_processor_fee_kobo is not null and p_fee_kobo > p_processor_fee_kobo then 'fee'
    else null end;
  if v_reason is not null then
    return private.record_order_mismatch(o, v_reason, p_amount_kobo, p_fee_kobo, p_total_kobo, p_source, p_event_key, p_raw);
  end if;

  insert into public.payments (organisation_id, order_id, provider_reference, amount_kobo, fee_kobo, total_kobo, status, source, event_key, raw, verified_at, is_test)
  values (o.organisation_id, o.id, p_reference, p_amount_kobo, p_fee_kobo, p_total_kobo, 'success', p_source, p_event_key, coalesce(p_raw, '{}'), now(), o.is_test)
  on conflict (provider, provider_reference) where status = 'success' do nothing;

  if o.state in ('created', 'failed', 'cancelled') then
    update public.orders set state = 'paid', paid_at = v_start, fee_kobo = p_fee_kobo, total_kobo = p_total_kobo, failure_reason = null where id = o.id;
    if o.state in ('failed', 'cancelled') then
      perform private.order_incident(o.organisation_id, 'order-late-payment:' || o.id, 'A payment arrived for a closed order',
        'Order ' || o.id || ' was ' || o.state || ' when a verified payment arrived. It was honoured as paid.');
    end if;
  end if;

  select * into it from public.catalog_items where id = o.catalog_item_id;
  -- Membership to Membership Plus: flip the tier of the current Membership membership, nothing else. No entitlement, no new membership row.
  if it.code = 'membership_upgrade_plus' then
    update public.patient_memberships set tier = 'plus'
     where patient_id = o.beneficiary_patient_id and state = 'active' and tier = 'evergreen' and (ends_at is null or ends_at > now());
    if not found then
      perform private.order_incident(o.organisation_id, 'order-upgrade-no-evergreen:' || o.id, 'An upgrade was paid with no Membership membership to upgrade',
        'Order ' || o.id || ' was paid but the patient has no current Membership membership, so nothing was upgraded. Refund the payment.');
    end if;
    perform private.emit_domain_event('order.paid', o.organisation_id,
      jsonb_build_object('order_id', o.id, 'kind', 'membership_upgrade', 'code', it.code),
      'order:' || o.id, o.beneficiary_patient_id, 'order', o.id);
    perform private.post_order_safely(o.id);
    return jsonb_build_object('result', 'paid', 'order_id', o.id, 'entitlement_id', null);
  end if;
  insert into public.entitlements (organisation_id, patient_id, order_id, kind, starts_at, ends_at, remaining_uses, is_test, acceptance)
  values (o.organisation_id, o.beneficiary_patient_id, o.id,
          case it.kind when 'consultation' then 'consultation_credit' else it.kind end, v_start,
          case when it.duration_days is not null then v_start + make_interval(days => it.duration_days) end,
          it.uses, o.is_test, case when (o.buyer_profile_id <> o.beneficiary_patient_id and it.grants_lead) then 'pending' else 'not_needed' end)
  on conflict (order_id) do nothing
  returning id into v_ent;

  if v_ent is not null and it.kind = 'membership' and not (o.buyer_profile_id <> o.beneficiary_patient_id and it.grants_lead) then
    -- a renewal that is confirmed AFTER the end date closes the old row and opens a new one; the new one must inherit the person's renewal
    -- choice as it stands NOW (a cancel in between is respected), or renewal would silently stop after the first late confirmation
    if o.renews_membership_id is not null then select * into v_old from public.patient_memberships where id = o.renews_membership_id; end if;
    update public.patient_memberships set state = 'ended', ended_at = now(), end_reason = 'Lapsed on its end date, closed automatically'
     where patient_id = o.beneficiary_patient_id and state = 'active' and ends_at is not null and ends_at <= now();
    if exists (select 1 from public.patient_memberships where patient_id = o.beneficiary_patient_id and state = 'active') then
      update public.patient_memberships
         set ends_at = greatest(ends_at, v_start) + make_interval(days => it.duration_days),
             tier = case when private.membership_tier_for_item(it.code) = 'plus' then 'plus' else tier end
       where patient_id = o.beneficiary_patient_id and state = 'active' and ends_at is not null;
      -- a renewal is EXPECTED to land on an active membership; only an unplanned overlap is an incident
      if o.renews_membership_id is null then
        perform private.order_incident(o.organisation_id, 'order-membership-overlap:' || o.id, 'A membership was paid for by someone who already had one',
          'Order ' || o.id || ' was paid while the patient already had an active membership. A dated one was extended by the paid period; check whether a refund is due.');
      end if;
    else
      insert into public.patient_memberships (organisation_id, patient_id, source, starts_at, ends_at, is_test, tier, auto_renew, renewal_item_code, renewal_consent_at)
      values (o.organisation_id, o.beneficiary_patient_id, 'purchase', v_start, v_start + make_interval(days => it.duration_days), o.is_test, private.membership_tier_for_item(it.code),
              coalesce(v_old.auto_renew, false),
              case when coalesce(v_old.auto_renew, false) then v_old.renewal_item_code end,
              case when coalesce(v_old.auto_renew, false) then v_old.renewal_consent_at end);
    end if;
    if o.renews_membership_id is not null then
      -- the next renewal's baseline is what they were just charged
      update public.patient_memberships set renewal_notified_kobo = o.amount_kobo, renewal_notified_at = now()
       where patient_id = o.beneficiary_patient_id and state = 'active' and auto_renew;
      perform private.queue_membership_renewed_notice(o.id);
    end if;
  end if;

  if v_ent is not null and it.grants_lead and not (o.buyer_profile_id <> o.beneficiary_patient_id and it.grants_lead) and not exists (select 1 from private.lead_candidates(o.beneficiary_patient_id, '{}', true)) then
    perform private.order_incident(o.organisation_id, 'order-no-lead-slot:' || o.id, 'A paid order has no lead clinician slot',
      'Order ' || o.id || ' was paid but no lead clinician has a free slot. Arrange a lead for this patient.');
  end if;

  perform private.emit_domain_event('order.paid', o.organisation_id,
    jsonb_build_object('order_id', o.id, 'care_pack', it.grants_lead and not (o.buyer_profile_id <> o.beneficiary_patient_id and it.grants_lead), 'gift_pending', (o.buyer_profile_id <> o.beneficiary_patient_id and it.grants_lead), 'kind', it.kind, 'code', it.code),
    'order:' || o.id, o.beneficiary_patient_id, 'order', o.id);

  if v_ent is not null then perform private.post_order_safely(o.id); end if;

  return jsonb_build_object('result', case when v_ent is null then 'replay' else 'paid' end, 'order_id', o.id, 'entitlement_id', v_ent);
end $function$;
revoke all on function public.record_order_payment(text, bigint, bigint, bigint, text, text, text, text, timestamp with time zone, jsonb, bigint) from public, anon, authenticated;
grant execute on function public.record_order_payment(text, bigint, bigint, bigint, text, text, text, text, timestamp with time zone, jsonb, bigint) to service_role;

-- ---------------------------------------------------------------------------
-- 7. Notices
-- ---------------------------------------------------------------------------
insert into public.notification_templates (key, category, business_priority, audience, default_channels, timing, description) values
  ('membership_auto_renewal_notice', 'operational', 'important', 'patient', '{in_app,push,email}', 'scheduled',
   'Sent 30, 14 and 7 days before a Membership year ends, to a Member who chose automatic renewal. States the date, the amount and the card, and how to cancel. Never SMS.'),
  ('membership_renewed', 'operational', 'important', 'patient', '{in_app,push,email}', 'immediate',
   'Sent when a Membership has renewed on the saved card. States the amount charged and the new end date.'),
  ('membership_renewal_failed', 'operational', 'important', 'patient', '{in_app,push,email}', 'immediate',
   'Sent when the renewal charge did not go through (first miss, and the last try). Access continues to the end date plus the grace period; the person can renew by hand.'),
  ('membership_renewal_price_changed', 'operational', 'important', 'patient', '{in_app,push,email}', 'immediate',
   'Sent when the Membership price rose after the person was last shown it, so their card was NOT charged. States the new amount and how to renew by hand. Never SMS.'),
  ('membership_renewal_cancelled', 'operational', 'important', 'patient', '{in_app,push,email}', 'immediate',
   'Confirms that automatic renewal is off, the saved card was deleted, and the paid year stays in full.')
on conflict (key) do nothing;
insert into public.notification_template_locales (template_key, locale, channel, subject, body) values
  ('membership_auto_renewal_notice', 'en', 'in_app', 'Your Membership renews soon', 'Your Membership renews on {{ends_at}}. We will charge ₦{{amount}} to your card ending {{card_last4}}. You can cancel renewal any time on the Membership page and keep the year you have paid for.'),
  ('membership_auto_renewal_notice', 'en', 'push', 'Your Membership renews soon', 'It renews on {{ends_at}} for ₦{{amount}}. Cancel any time on the Membership page.'),
  ('membership_auto_renewal_notice', 'en', 'email', 'Your TarragonHealth Membership renews on {{ends_at}}', E'Hi there,\n\nYour Membership renews on {{ends_at}}. We will charge ₦{{amount}} to your card ending {{card_last4}}.\n\nIf you would rather not renew, cancel renewal from the Membership page in the app. You keep the year you have already paid for, and nothing more is charged.\n\nYour records stay with you either way.'),
  ('membership_renewed', 'en', 'in_app', 'Your Membership has renewed', 'We charged ₦{{amount}} to your card ending {{card_last4}}. Your Membership now runs to {{ends_at}}. You can cancel renewal any time on the Membership page.'),
  ('membership_renewed', 'en', 'push', 'Your Membership has renewed', '₦{{amount}} charged. Your Membership now runs to {{ends_at}}.'),
  ('membership_renewed', 'en', 'email', 'Your TarragonHealth Membership has renewed', E'Hi there,\n\nYour Membership has renewed. We charged ₦{{amount}} to your card ending {{card_last4}}, and it now runs to {{ends_at}}.\n\nYou can cancel renewal any time from the Membership page. If something looks wrong, you can ask for a refund within the refund window shown there.'),
  ('membership_renewal_failed', 'en', 'in_app', 'We could not renew your Membership', 'The renewal charge did not go through. Your Membership stays active until {{ends_at}} and for 14 days after. You can renew by hand from the Membership page.'),
  ('membership_renewal_failed', 'en', 'push', 'We could not renew your Membership', 'The charge did not go through. You can renew from the Membership page.'),
  ('membership_renewal_failed', 'en', 'email', 'We could not renew your TarragonHealth Membership', E'Hi there,\n\nThe renewal charge did not go through. Your Membership stays active until {{ends_at}}, and for 14 days after that. You can renew by hand, with any card, from the Membership page in the app.\n\nYour records stay with you either way.'),
  ('membership_renewal_price_changed', 'en', 'in_app', 'The Membership price has changed', 'The price of Membership is now ₦{{amount}}, which is more than we last told you, so we have not charged your card. To keep your Membership, renew from the Membership page before {{ends_at}}. You keep your Member access for 14 days after it ends.'),
  ('membership_renewal_price_changed', 'en', 'push', 'The Membership price has changed', 'It is now ₦{{amount}}, so we have not charged your card. You can renew from the Membership page.'),
  ('membership_renewal_price_changed', 'en', 'email', 'The TarragonHealth Membership price has changed', E'Hi there,\n\nThe price of Membership is now ₦{{amount}}, which is more than we last told you. Because of that we have not charged your card, and nothing has been taken.\n\nIf you would like to keep your Membership, you can renew from the Membership page in the app before {{ends_at}}. You keep your Member access for 14 days after it ends, and your records stay with you either way.'),
  ('membership_renewal_cancelled', 'en', 'in_app', 'Automatic renewal is off', 'Your Membership will not renew. You keep the year you have paid for, until {{ends_at}}, and we have deleted the saved card.'),
  ('membership_renewal_cancelled', 'en', 'push', 'Automatic renewal is off', 'You keep your Membership until {{ends_at}}. Nothing more will be charged.'),
  ('membership_renewal_cancelled', 'en', 'email', 'Automatic renewal is off for your TarragonHealth Membership', E'Hi there,\n\nAutomatic renewal is off. You keep the year you have already paid for, until {{ends_at}}, and nothing more will be charged. We have deleted the saved card.\n\nYou can join again whenever you like from the Membership page.')
on conflict (template_key, locale, channel) do nothing;

-- the "ends soon" reminder: auto-renewal members get the renewal notice instead (live body, one branch changed)
create or replace function private.queue_membership_renewal_reminders() returns integer
 language plpgsql security definer set search_path to ''
as $function$
declare
  v_days integer[] := coalesce((select array(select jsonb_array_elements_text(rules -> 'reminder_days_before')::integer from public.membership_lapse_config where is_active)), '{30,14,7}');
  r record; v_due integer; n integer := 0; v_auto boolean; v_amount bigint; v_last4 text;
begin
  for r in
    select m.id, m.patient_id, m.organisation_id, m.ends_at, m.source, m.tier, m.auto_renew, m.renewal_item_code from public.patient_memberships m
     where m.state = 'active' and m.ends_at is not null and m.ends_at > now()
       and m.ends_at <= now() + make_interval(days => (select max(d) from unnest(v_days) d))
  loop
    select min(d) into v_due from unnest(v_days) d where r.ends_at <= now() + make_interval(days => d);
    -- one reminder per threshold; a membership found late sends only the nearest one, never a burst
    if exists (select 1 from public.membership_renewal_reminders x where x.membership_id = r.id and x.days_before <= v_due) then continue; end if;
    v_auto := r.auto_renew and r.source = 'purchase' and public.membership_auto_renew_enabled();
    v_amount := null; v_last4 := null;
    if v_auto then
      begin
        v_amount := (private.price_quote_calc(r.patient_id, r.patient_id, r.renewal_item_code, null, false) ->> 'amount_due_kobo')::bigint;
      exception when others then v_amount := null;
      end;
      select last4 into v_last4 from public.membership_cards where patient_id = r.patient_id;
      -- no amount or no card means we cannot honestly say "we will charge", so fall back to the plain reminder
      if v_amount is null or v_last4 is null then v_auto := false; end if;
    end if;
    -- the amount we are about to tell them is the amount they have been SHOWN; the charge may not exceed it
    if v_auto then update public.patient_memberships set renewal_notified_kobo = v_amount, renewal_notified_at = now() where id = r.id; end if;
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    values (r.organisation_id, r.patient_id, private.patient_reminder_channel(r.patient_id), 'pending',
            case when r.source = 'employer' then 'membership_employer_cover_ending'
                 when v_auto then 'membership_auto_renewal_notice'
                 else 'membership_renewal_reminder' end,
            jsonb_build_object('membership_id', r.id, 'ends_at', to_char(r.ends_at at time zone 'Africa/Lagos', 'FMDD Mon YYYY'), 'days_before', v_due, 'tier', r.tier)
              || case when v_auto then jsonb_build_object('amount', to_char(v_amount / 100, 'FM999,999,999'), 'card_last4', v_last4) else '{}'::jsonb end);
    insert into public.membership_renewal_reminders (membership_id, days_before)
      select r.id, d from unnest(v_days) d where d >= v_due on conflict do nothing;
    n := n + 1;
  end loop;
  return n;
end $function$;
revoke all on function private.queue_membership_renewal_reminders() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 8. Housekeeping and the schedules
-- ---------------------------------------------------------------------------
-- A saved card is kept only while its owner has an active membership on automatic renewal. A refund, a lapse or a cancel removes it.
create or replace function private.cleanup_membership_cards() returns integer
language plpgsql security definer set search_path = ''
as $$
declare n integer;
begin
  delete from public.membership_cards c
   where not exists (select 1 from public.patient_memberships m where m.patient_id = c.patient_id and m.state = 'active' and m.auto_renew);
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function private.cleanup_membership_cards() from public, anon, authenticated;
select cron.schedule('membership-card-cleanup', '40 2 * * *', $$ select private.cleanup_membership_cards(); $$);

-- Daily at 06:00 UTC (07:00 in Lagos): ask the membership-renewal edge function to run the sweep. Does nothing while the switch is OFF.
-- Fails closed until the Vault secret membership_renewal_secret exists and the function has the same value as MEMBERSHIP_RENEWAL_SECRET.
select cron.schedule(
  'membership-auto-renew-daily',
  '0 6 * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/membership-renewal',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'edge_function_publishable_key'),
      'x-membership-renewal-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'membership_renewal_secret'),
      'Content-Type', 'application/json'
    ),
    timeout_milliseconds := 55000
  ) as request_id
  where public.membership_auto_renew_enabled();
  $$
);

-- ---------------------------------------------------------------------------
-- Self-check: the switch is OFF, and nothing a patient can reach exposes a card
-- ---------------------------------------------------------------------------
do $$
begin
  if public.membership_auto_renew_enabled() then raise exception 'auto-renew: the switch must ship OFF'; end if;
  if has_table_privilege('authenticated', 'public.membership_cards', 'SELECT') or has_table_privilege('anon', 'public.membership_cards', 'SELECT') then
    raise exception 'auto-renew: a patient or anon can read saved cards';
  end if;
  if has_function_privilege('anon', 'public.cancel_membership_renewal()', 'EXECUTE') or has_function_privilege('anon', 'public.service_prepare_membership_renewal(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.service_prepare_membership_renewal(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.save_membership_card(text, text, boolean, text, text, text, text, text, text, text)', 'EXECUTE') then
    raise exception 'auto-renew: a renewal function is callable by the wrong role';
  end if;
  if not has_function_privilege('anon', 'public.membership_auto_renew_enabled()', 'EXECUTE') then
    raise exception 'auto-renew: the public copy cannot read the switch';
  end if;
end $$;
