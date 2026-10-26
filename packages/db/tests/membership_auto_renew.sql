-- Membership auto-renewal proof (migration *_membership_auto_renew.sql).
-- Proves in one rolled-back transaction:
--   * the switch ships OFF; nothing is due while it is off; anon can read the switch and nothing else
--   * a saved card needs ALL of: the order is paid, the buyer ticked consent on that order, the module is on, Paystack says reusable
--   * the card is unreachable to a patient (no select, no function), the status RPC shows only brand, last 4 and expiry
--   * the sweep: due only inside 3 days of the end; one renewal order per year; a retry reuses it with a new reference; at most 3
--     tries, one a day; the first miss and the last are told to the person, the second is not
--   * a renewal payment extends from the OLD end date (no day of the paid year lost), leaves one active membership, raises NO
--     overlap incident, queues one "renewed" notice, and a replay extends nothing twice
--   * cancelling keeps the paid year, deletes the card, stops the sweep and tells the person once; a second cancel is a no-op
--   * the 30/14/7 reminder becomes the renewal notice (with amount and card) only for a person on auto-renewal, plain otherwise
--   * housekeeping deletes a card whose owner no longer has an auto-renewing membership
-- SABOTAGE: the consent check removed from save_membership_card; the renewal exemption removed from the overlap incident. Both
-- must flip a check.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;

create function pg_temp.ck(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('real', p_name, p_expected, p_actual) $$;
create function pg_temp.f(p text) returns uuid language sql as $$ select v from fx where k = p $$;
create function pg_temp.setf(p text, p_v uuid) returns void language sql as
$$ insert into fx values (p, p_v) on conflict (k) do update set v = excluded.v $$;
create function pg_temp.act(p_uid uuid) returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
end $f$;
create function pg_temp.svc() returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  perform set_config('request.jwt.claim.role', 'service_role', true);
  set local role service_role;
end $f$;
create function pg_temp.anon() returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  perform set_config('request.jwt.claim.role', 'anon', true);
  set local role anon;
end $f$;
create function pg_temp.back() returns void language plpgsql as
$f$ begin reset role; perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.sub', '', true); perform set_config('request.jwt.claim.role', '', true); end $f$;
-- run one statement as a patient / as the service role / as anon, returning its text or 'ERR:' + the message
create function pg_temp.q_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlerrm; end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.q_svc(p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.svc();
  -- a service-role call is never expected to fail in this proof: surface the real error instead of hiding it in a result
  begin execute p_sql into r; exception when others then perform pg_temp.back(); raise exception 'service call failed: % [%]', sqlerrm, left(p_sql, 200); end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.q_anon(p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.anon();
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlerrm; end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text) returns uuid language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'ar-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, 'patient'::public.user_role, 'AR ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true)
  on conflict (id) do update set role = excluded.role, organisation_id = excluded.organisation_id, is_test = true, is_active = true, phone = excluded.phone;
  return v;
end $f$;
-- a paid Membership purchase (order paid through record_order_payment, so the real membership row appears), optionally with consent
create function pg_temp.buy(p_patient uuid, p_consent boolean) returns text language plpgsql as $f$
declare v_org uuid := pg_temp.f('org'); v_item uuid := pg_temp.f('item'); q jsonb; v_amt bigint; v_ref text := 'tho_' || replace(gen_random_uuid()::text, '-', '');
begin
  q := private.price_quote_calc(p_patient, p_patient, 'membership_annual', null, false);
  v_amt := (q ->> 'amount_due_kobo')::bigint;
  insert into public.orders (organisation_id, buyer_profile_id, beneficiary_patient_id, catalog_item_id, price_id, amount_kobo, components, paystack_reference, is_test,
                             list_amount_kobo, sponsor_share_kobo, discount_kobo, points_applied, points_reduction_kobo, price_book_entry_id, pricing_rules_version, quote, renewal_consent_at)
  values (v_org, p_patient, p_patient, v_item, (q ->> 'price_id')::uuid, v_amt, (select components from public.prices where id = (q ->> 'price_id')::uuid), v_ref, true,
          (q ->> 'list_kobo')::bigint, 0, 0, 0, 0, (q ->> 'price_book_entry_id')::uuid, (q ->> 'pricing_rules_version')::integer, q, case when p_consent then now() end);
  perform pg_temp.q_svc(format($q$select public.record_order_payment(%L, %s, 0, %s, 'NGN', 'success', 'sweep')::text$q$, v_ref, v_amt, v_amt));
  return v_ref;
end $f$;

do $$
declare v_org uuid; v_item uuid;
begin
  select organisation_id, id into v_org, v_item from public.catalog_items where code = 'membership_annual' order by created_at limit 1;
  perform pg_temp.setf('org', v_org);
  perform pg_temp.setf('item', v_item);
  for i in 1..14 loop perform pg_temp.setf('p' || i, pg_temp.mkuser(v_org, 'p' || i)); end loop;
  update public.catalog_items set active = true where id = v_item;
end $$;

-- 1. It ships off, and off means nothing happens ----------------------------------------------------------------------------
do $$
declare v_p1 uuid := pg_temp.f('p1'); v_ref text;
begin
  perform pg_temp.ck('the switch ships OFF', 'false', public.membership_auto_renew_enabled()::text);
  perform pg_temp.ck('anon can read the switch (the public copy follows it)', 'false', pg_temp.q_anon('select public.membership_auto_renew_enabled()::text'));
  perform pg_temp.ck('anon cannot read anything else about renewal', 'true',
    (pg_temp.q_anon('select count(*)::text from public.membership_cards') like 'ERR:%')::text);
  -- paying with consent while the switch is off saves no card
  v_ref := pg_temp.buy(v_p1, true);
  perform pg_temp.ck('while OFF, a paid consenting order saves no card', 'module_off',
    (pg_temp.q_svc(format($q$select public.save_membership_card(%L, 'AUTH_x', true, 'sig', 'visa', '4081', '12', '2030', 'CUS_x', 'p1@example.invalid')::text$q$, v_ref))::jsonb ->> 'result'));
  perform pg_temp.ck('while OFF, the sweep finds nothing', '0', pg_temp.q_svc('select count(*)::text from public.service_due_membership_renewals(10)'));
  perform pg_temp.ck('while OFF, consent cannot be recorded', 'false',
    pg_temp.q_as(v_p1, format($q$select public.set_order_renewal_consent((select id from public.orders where paystack_reference = %L), true)::text$q$, v_ref)));
  update public.platform_modules set is_enabled = true, enabled_at = now(), enabled_by = v_p1, activation_note = 'switched on inside the auto-renew proof' where key = 'membership_auto_renew';
  perform pg_temp.ck('the switch can be turned on', 'true', public.membership_auto_renew_enabled()::text);
end $$;

-- 2. A card is saved only with consent, on a paid order, and only if Paystack says reusable --------------------------------------
do $$
declare v_p2 uuid := pg_temp.f('p2'); v_p3 uuid := pg_temp.f('p3'); v_p4 uuid := pg_temp.f('p4'); v_ref text; v_order uuid; r text;
begin
  -- p2: consent + reusable card -> saved
  v_ref := pg_temp.buy(v_p2, true);
  perform pg_temp.ck('a consenting, reusable, paid order saves the card', 'saved',
    (pg_temp.q_svc(format($q$select public.save_membership_card(%L, 'AUTH_p2', true, 'sig2', 'visa', '4081', '12', '2030', 'CUS_p2', 'p2@example.invalid')::text$q$, v_ref))::jsonb ->> 'result'));
  perform pg_temp.ck('and the membership is on auto-renew with its item and consent time', 'true/membership_annual/true',
    (select auto_renew::text || '/' || renewal_item_code || '/' || (renewal_consent_at is not null)::text from public.patient_memberships where patient_id = v_p2));
  perform pg_temp.q_svc(format($q$select public.save_membership_card(%L, 'AUTH_p2', true, 'sig2', 'visa', '4081', '12', '2030', 'CUS_p2', 'p2@example.invalid')::text$q$, v_ref));
  perform pg_temp.ck('exactly one card row exists for p2', '1', (select count(*)::text from public.membership_cards where patient_id = v_p2));

  -- p3: consent but Paystack says not reusable (a transfer or a prepaid card) -> no card, not on auto-renew
  v_ref := pg_temp.buy(v_p3, true);
  perform pg_temp.ck('a non-reusable authorization saves nothing', 'not_reusable',
    (pg_temp.q_svc(format($q$select public.save_membership_card(%L, 'AUTH_p3', false, null, null, null, null, null, null, 'p3@example.invalid')::text$q$, v_ref))::jsonb ->> 'result'));
  perform pg_temp.ck('and the membership is not on auto-renew, the order says why', 'false/not_reusable',
    (select m.auto_renew::text || '/' || o.renewal_card_result from public.patient_memberships m, public.orders o where m.patient_id = v_p3 and o.paystack_reference = v_ref));

  -- p4: paid with a reusable card but never ticked the box -> no card
  v_ref := pg_temp.buy(v_p4, false);
  perform pg_temp.ck('no consent, no card', 'no_consent',
    (pg_temp.q_svc(format($q$select public.save_membership_card(%L, 'AUTH_p4', true, 'sig4', 'visa', '1111', '01', '2031', 'CUS_p4', 'p4@example.invalid')::text$q$, v_ref))::jsonb ->> 'result'));
  perform pg_temp.ck('and p4 has no card and is not on auto-renew', '0/false',
    (select count(*)::text from public.membership_cards where patient_id = v_p4) || '/' || (select auto_renew::text from public.patient_memberships where patient_id = v_p4));

  -- the card is out of a patient's reach
  perform pg_temp.ck('a patient cannot select the cards table', 'true', (pg_temp.q_as(v_p2, 'select count(*)::text from public.membership_cards') like 'ERR:%')::text);
  perform pg_temp.ck('a patient cannot call save_membership_card', 'true',
    (pg_temp.q_as(v_p2, $q$select public.save_membership_card('x', 'a', true, null, null, null, null, null, null, 'e')::text$q$) like 'ERR:%')::text);
  r := pg_temp.q_as(v_p2, 'select public.my_membership_renewal()::text');
  perform pg_temp.ck('the status RPC shows brand, last 4 and expiry', 'visa/4081/2030', (r::jsonb -> 'card' ->> 'brand') || '/' || (r::jsonb -> 'card' ->> 'last4') || '/' || (r::jsonb -> 'card' ->> 'exp_year'));
  perform pg_temp.ck('and never the authorization code', 'false', (r like '%AUTH_p2%')::text);
end $$;

-- 3. The sweep: window, one order a year, three tries one a day, who is told ----------------------------------------------------
do $$
declare v_p2 uuid := pg_temp.f('p2'); v_m uuid; r jsonb; v_o1 uuid; v_ref1 text; v_ref2 text; v_n integer;
begin
  select id into v_m from public.patient_memberships where patient_id = v_p2;
  perform pg_temp.ck('a membership with a year to run is not due', '0', pg_temp.q_svc('select count(*)::text from public.service_due_membership_renewals(10)'));
  update public.patient_memberships set ends_at = now() + interval '2 days' where id = v_m;
  perform pg_temp.ck('inside 3 days of the end it is due', '1', pg_temp.q_svc('select count(*)::text from public.service_due_membership_renewals(10)'));

  r := pg_temp.q_svc(format($q$select public.service_prepare_membership_renewal(%L)::text$q$, v_m))::jsonb;
  perform pg_temp.ck('prepare returns an order, a reference, the price, the card and attempt 1', 'true/1',
    ((r ->> 'order_id') is not null and (r ->> 'reference') like 'ren\_%' and (r ->> 'authorization_code') = 'AUTH_p2' and (r ->> 'amount_kobo')::bigint > 0)::text || '/' || (r ->> 'attempt_no'));
  v_ref1 := r ->> 'reference'; v_o1 := (r ->> 'order_id')::uuid;
  perform pg_temp.ck('a patient cannot prepare a renewal', 'true',
    (pg_temp.q_as(v_p2, format($q$select public.service_prepare_membership_renewal(%L)::text$q$, v_m)) like 'ERR:%')::text);
  perform pg_temp.ck('a second prepare the same day is refused (too soon)', 'too_soon',
    (pg_temp.q_svc(format($q$select public.service_prepare_membership_renewal(%L)::text$q$, v_m))::jsonb ->> 'skip'));

  -- a miss: first failure is told to the person
  perform pg_temp.q_svc(format($q$select public.service_record_renewal_attempt(%L, 'failed', 'insufficient funds')::text$q$, v_ref1));
  perform pg_temp.ck('the first miss is told to the person', '1', (select count(*)::text from public.notifications where recipient_id = v_p2 and template = 'membership_renewal_failed'));
  update public.membership_renewal_attempts set created_at = now() - interval '21 hours' where membership_id = v_m;
  r := pg_temp.q_svc(format($q$select public.service_prepare_membership_renewal(%L)::text$q$, v_m))::jsonb;
  perform pg_temp.ck('the retry is a NEW order with a NEW reference, attempt 2, and the old open one is cancelled', 'true/true/2/cancelled',
    ((r ->> 'order_id')::uuid <> v_o1)::text || '/' || ((r ->> 'reference') <> v_ref1)::text || '/' || (r ->> 'attempt_no') || '/' || (select state from public.orders where id = v_o1));
  v_ref2 := r ->> 'reference';
  perform pg_temp.q_svc(format($q$select public.service_record_renewal_attempt(%L, 'failed', 'declined')::text$q$, v_ref2));
  perform pg_temp.ck('the second miss is NOT told (no daily burst)', '1', (select count(*)::text from public.notifications where recipient_id = v_p2 and template = 'membership_renewal_failed'));
  update public.membership_renewal_attempts set created_at = now() - interval '21 hours' where membership_id = v_m;
  r := pg_temp.q_svc(format($q$select public.service_prepare_membership_renewal(%L)::text$q$, v_m))::jsonb;
  perform pg_temp.q_svc(format($q$select public.service_record_renewal_attempt(%L, 'failed', 'declined')::text$q$, r ->> 'reference'));
  perform pg_temp.ck('the last miss is told, and says it is the last', '2/true',
    (select count(*)::text from public.notifications where recipient_id = v_p2 and template = 'membership_renewal_failed') || '/'
    || (select bool_or((payload ->> 'final')::boolean)::text from public.notifications where recipient_id = v_p2 and template = 'membership_renewal_failed'));
  update public.membership_renewal_attempts set created_at = now() - interval '21 hours' where membership_id = v_m;
  perform pg_temp.ck('a fourth try is refused', 'attempts_exhausted',
    (pg_temp.q_svc(format($q$select public.service_prepare_membership_renewal(%L)::text$q$, v_m))::jsonb ->> 'skip'));
  perform pg_temp.ck('the open-references function lists the three earlier attempts of this year, in order', '3',
    pg_temp.q_svc(format($q$select count(*)::text from public.service_renewal_open_references(%L)$q$, v_m)));
  perform pg_temp.ck('and a patient cannot call it', 'true',
    (pg_temp.q_as(v_p2, format($q$select count(*)::text from public.service_renewal_open_references(%L)$q$, v_m)) like 'ERR:%')::text);
  perform pg_temp.ck('three attempts made three orders, and only the last is still open', '3/1',
    (select count(*)::text from public.orders where renews_membership_id = v_m) || '/' || (select count(*)::text from public.orders where renews_membership_id = v_m and state = 'created'));
  perform pg_temp.ck('and the membership itself was never touched by the failures', 'active', (select state from public.patient_memberships where id = v_m));
end $$;

-- 4. A renewal that is paid extends from the OLD end date, once ---------------------------------------------------------------
do $$
declare v_p5 uuid := pg_temp.f('p5'); v_ref text; v_m uuid; v_end timestamptz; r jsonb; v_amt bigint; v_order uuid; v_inc integer; v_res text;
begin
  v_ref := pg_temp.buy(v_p5, true);
  perform pg_temp.q_svc(format($q$select public.save_membership_card(%L, 'AUTH_p5', true, 'sig5', 'mastercard', '5555', '06', '2032', 'CUS_p5', 'p5@example.invalid')::text$q$, v_ref));
  select id into v_m from public.patient_memberships where patient_id = v_p5;
  update public.patient_memberships set ends_at = now() + interval '2 days' where id = v_m;
  select ends_at into v_end from public.patient_memberships where id = v_m;

  r := pg_temp.q_svc(format($q$select public.service_prepare_membership_renewal(%L)::text$q$, v_m))::jsonb;
  v_amt := (r ->> 'amount_kobo')::bigint; v_order := (r ->> 'order_id')::uuid;
  v_res := pg_temp.q_svc(format($q$select public.record_order_payment(%L, %s, 0, %s, 'NGN', 'success', 'sweep')::text$q$, r ->> 'reference', v_amt, v_amt))::jsonb ->> 'result';
  perform pg_temp.ck('the renewal charge is recorded as paid', 'paid', v_res);
  perform pg_temp.ck('the new end is exactly the OLD end plus 365 days (no paid day lost)', 'true',
    ((select ends_at from public.patient_memberships where id = v_m) = v_end + interval '365 days')::text);
  perform pg_temp.ck('there is still exactly one active membership', '1', (select count(*)::text from public.patient_memberships where patient_id = v_p5 and state = 'active'));
  perform pg_temp.ck('a renewal raises NO overlap incident', '0', (select count(*)::text from public.ops_incidents where external_reference = 'order-membership-overlap:' || v_order));
  perform pg_temp.ck('the person gets one "renewed" notice with the amount and card', '1/5555',
    (select count(*)::text || '/' || max(payload ->> 'card_last4') from public.notifications where recipient_id = v_p5 and template = 'membership_renewed'));
  perform pg_temp.ck('the renewal is an ordinary paid order with a payment row', '1/paid',
    (select count(*)::text from public.payments where order_id = v_order and status = 'success') || '/' || (select state from public.orders where id = v_order));
  -- replay (the webhook and the sweep both confirm)
  v_res := pg_temp.q_svc(format($q$select public.record_order_payment(%L, %s, 0, %s, 'NGN', 'success', 'sweep')::text$q$, r ->> 'reference', v_amt, v_amt))::jsonb ->> 'result';
  perform pg_temp.ck('a paid renewal sets the next baseline to what was charged', v_amt::text,
    (select renewal_notified_kobo::text from public.patient_memberships where id = v_m));
  perform pg_temp.ck('a replay is a replay', 'replay', v_res);
  perform pg_temp.ck('and extends nothing a second time', 'true',
    ((select ends_at from public.patient_memberships where id = v_m) = v_end + interval '365 days')::text);
  perform pg_temp.ck('and sends no second notice', '1', (select count(*)::text from public.notifications where recipient_id = v_p5 and template = 'membership_renewed'));
  perform pg_temp.ck('and the sweep skips it', 'outside_window', (pg_temp.q_svc(format($q$select public.service_prepare_membership_renewal(%L)::text$q$, v_m))::jsonb ->> 'skip'));
end $$;

-- 5. Cancelling: keep the paid year, drop the card, stop the sweep ------------------------------------------------------------
do $$
declare v_p5 uuid := pg_temp.f('p5'); v_end timestamptz; r text;
begin
  select ends_at into v_end from public.patient_memberships where patient_id = v_p5;
  r := pg_temp.q_as(v_p5, 'select public.cancel_membership_renewal()::text');
  perform pg_temp.ck('cancel answers cancelled', 'cancelled', (r::jsonb ->> 'result'));
  perform pg_temp.ck('the paid year is untouched', 'true', ((select ends_at from public.patient_memberships where patient_id = v_p5) = v_end)::text);
  perform pg_temp.ck('and still an active Member', 'true', private.patient_is_member(v_p5)::text);
  perform pg_temp.ck('renewal is off and the time is recorded', 'false/true',
    (select auto_renew::text || '/' || (renewal_cancelled_at is not null)::text from public.patient_memberships where patient_id = v_p5));
  perform pg_temp.ck('the saved card is deleted', '0', (select count(*)::text from public.membership_cards where patient_id = v_p5));
  perform pg_temp.ck('the person is told once', '1', (select count(*)::text from public.notifications where recipient_id = v_p5 and template = 'membership_renewal_cancelled'));
  perform pg_temp.ck('a second cancel is a harmless no-op', 'already_off', (pg_temp.q_as(v_p5, 'select public.cancel_membership_renewal()::text')::jsonb ->> 'result'));
  perform pg_temp.ck('and sends no second notice', '1', (select count(*)::text from public.notifications where recipient_id = v_p5 and template = 'membership_renewal_cancelled'));
  perform pg_temp.ck('anon cannot cancel', 'true', (pg_temp.q_anon('select public.cancel_membership_renewal()::text') like 'ERR:%')::text);
  update public.patient_memberships set ends_at = now() + interval '2 days' where patient_id = v_p5;
  perform pg_temp.ck('a cancelled membership is never due, even inside the window', '0',
    pg_temp.q_svc(format($q$select count(*)::text from public.service_due_membership_renewals(100) d where d.membership_id = %L$q$, (select id from public.patient_memberships where patient_id = v_p5))));
end $$;

-- 6. The reminder becomes the renewal notice only for a person on auto-renewal ------------------------------------------------
do $$
declare v_p6 uuid := pg_temp.f('p6'); v_p7 uuid := pg_temp.f('p7'); v_ref text; r jsonb;
begin
  v_ref := pg_temp.buy(v_p6, true);
  perform pg_temp.q_svc(format($q$select public.save_membership_card(%L, 'AUTH_p6', true, 'sig6', 'visa', '4081', '12', '2030', 'CUS_p6', 'p6@example.invalid')::text$q$, v_ref));
  v_ref := pg_temp.buy(v_p7, false);
  update public.patient_memberships set ends_at = now() + interval '20 days' where patient_id in (v_p6, v_p7);
  perform private.queue_membership_renewal_reminders();
  perform pg_temp.ck('p6, on auto-renewal, gets the renewal notice with amount and card', 'membership_auto_renewal_notice/4081/true',
    (select template || '/' || (payload ->> 'card_last4') || '/' || ((payload ->> 'amount') ~ '^[0-9,]+$')::text from public.notifications where recipient_id = v_p6 and template like 'membership%'));
  perform pg_temp.ck('p7, not on auto-renewal, gets the plain reminder with no amount', 'membership_renewal_reminder/false',
    (select template || '/' || (payload ? 'amount')::text from public.notifications where recipient_id = v_p7 and template like 'membership%'));
  perform pg_temp.ck('the amount in the notice is the amount recorded as shown to them', 'true',
    ((select renewal_notified_kobo from public.patient_memberships where patient_id = v_p6 and state = 'active')::text
       = replace((select payload ->> 'amount' from public.notifications where recipient_id = v_p6 and template = 'membership_auto_renewal_notice'), ',', '') || '00')::text);
  perform pg_temp.ck('the renewal notice tells them how to cancel and never mentions a clinical thing', 'true',
    (select bool_and(body ~* 'cancel' and body !~* '(blood|pressure|diabet|result|medic)') from public.notification_template_locales where template_key = 'membership_auto_renewal_notice')::text);
  perform pg_temp.ck('no renewal notice was ever an SMS', '0', (select count(*)::text from public.notifications where template like 'membership_%renew%' and channel::text = 'sms'));
end $$;

-- 7. Housekeeping: a card outlives nobody's consent ----------------------------------------------------------------------------
do $$
declare v_p8 uuid := pg_temp.f('p8'); v_p6 uuid := pg_temp.f('p6'); v_n integer;
begin
  insert into public.membership_cards (patient_id, organisation_id, authorization_code, email, last4)
  values (v_p8, pg_temp.f('org'), 'AUTH_orphan', 'p8@example.invalid', '0000');
  v_n := private.cleanup_membership_cards();
  perform pg_temp.ck('a card with no auto-renewing membership behind it is deleted', '1', v_n::text);
  perform pg_temp.ck('and p6, still on auto-renewal, keeps theirs', '1', (select count(*)::text from public.membership_cards where patient_id = v_p6));
end $$;

-- 6b. A renewal confirmed AFTER the end date keeps the person's choice; one cancelled in between does not renew -------------------------------
do $$
declare v_p9 uuid := pg_temp.f('p9'); v_p10 uuid := pg_temp.f('p10'); v_ref text; v_m uuid; r jsonb; v_amt bigint; v_new timestamptz; v_note text;
begin
  -- p9: renewing, the confirmation lands a day after the year ended
  v_ref := pg_temp.buy(v_p9, true);
  perform pg_temp.q_svc(format($q$select public.save_membership_card(%L, 'AUTH_p9', true, 'sig9', 'visa', '9999', '03', '2031', 'CUS_p9', 'p9@example.invalid')::text$q$, v_ref));
  select id into v_m from public.patient_memberships where patient_id = v_p9;
  update public.patient_memberships set ends_at = now() + interval '2 days' where id = v_m;
  r := pg_temp.q_svc(format($q$select public.service_prepare_membership_renewal(%L)::text$q$, v_m))::jsonb;
  v_amt := (r ->> 'amount_kobo')::bigint;
  update public.patient_memberships set starts_at = now() - interval '400 days', ends_at = now() - interval '1 day' where id = v_m;
  perform pg_temp.q_svc(format($q$select public.record_order_payment(%L, %s, 0, %s, 'NGN', 'success', 'sweep')::text$q$, r ->> 'reference', v_amt, v_amt));
  perform pg_temp.ck('a late-confirmed renewal leaves exactly one active membership, and the old one is ended', '1/ended',
    (select count(*)::text from public.patient_memberships where patient_id = v_p9 and state = 'active') || '/' || (select state from public.patient_memberships where id = v_m));
  perform pg_temp.ck('the NEW membership inherits auto-renew, the item and the consent time', 'true/membership_annual/true',
    (select auto_renew::text || '/' || renewal_item_code || '/' || (renewal_consent_at is not null)::text from public.patient_memberships where patient_id = v_p9 and state = 'active'));
  select ends_at into v_new from public.patient_memberships where patient_id = v_p9 and state = 'active';
  v_note := (select payload ->> 'ends_at' from public.notifications where recipient_id = v_p9 and template = 'membership_renewed');
  perform pg_temp.ck('and the renewed notice shows the NEW end date, not the old one', to_char(v_new at time zone 'Africa/Lagos', 'FMDD Mon YYYY'), v_note);
  perform pg_temp.ck('the saved card survives the next housekeeping run', '1', (private.cleanup_membership_cards() * 0 + (select count(*) from public.membership_cards where patient_id = v_p9))::text);

  -- p10: cancels after the charge was prepared; the late confirmation must not switch renewal back on
  v_ref := pg_temp.buy(v_p10, true);
  perform pg_temp.q_svc(format($q$select public.save_membership_card(%L, 'AUTH_p10', true, 'sig10', 'visa', '1010', '03', '2031', 'CUS_p10', 'p10@example.invalid')::text$q$, v_ref));
  select id into v_m from public.patient_memberships where patient_id = v_p10;
  update public.patient_memberships set ends_at = now() + interval '2 days' where id = v_m;
  r := pg_temp.q_svc(format($q$select public.service_prepare_membership_renewal(%L)::text$q$, v_m))::jsonb;
  v_amt := (r ->> 'amount_kobo')::bigint;
  perform pg_temp.q_as(v_p10, 'select public.cancel_membership_renewal()::text');
  update public.patient_memberships set starts_at = now() - interval '400 days', ends_at = now() - interval '1 day' where id = v_m;
  perform pg_temp.q_svc(format($q$select public.record_order_payment(%L, %s, 0, %s, 'NGN', 'success', 'sweep')::text$q$, r ->> 'reference', v_amt, v_amt));
  perform pg_temp.ck('a person who cancelled in between is NOT put back on auto-renew by the late confirmation', 'false/0',
    (select auto_renew::text from public.patient_memberships where patient_id = v_p10 and state = 'active') || '/' || (select count(*)::text from public.membership_cards where patient_id = v_p10));
end $$;

-- 6c. A renewal that cannot even be attempted is told once, never silently --------------------------------------------------------------
do $$
declare v_p11 uuid := pg_temp.f('p11'); v_ref text; v_m uuid; v_item uuid := pg_temp.f('item');
begin
  v_ref := pg_temp.buy(v_p11, true);
  perform pg_temp.q_svc(format($q$select public.save_membership_card(%L, 'AUTH_p11', true, 'sig11', 'visa', '1111', '03', '2031', 'CUS_p11', 'p11@example.invalid')::text$q$, v_ref));
  select id into v_m from public.patient_memberships where patient_id = v_p11;
  update public.patient_memberships set ends_at = now() + interval '2 days' where id = v_m;
  update public.catalog_items set active = false where id = v_item;
  perform pg_temp.ck('with the item closed the renewal is skipped', 'item_unavailable',
    (pg_temp.q_svc(format($q$select public.service_prepare_membership_renewal(%L)::text$q$, v_m))::jsonb ->> 'skip'));
  perform pg_temp.q_svc(format($q$select public.service_prepare_membership_renewal(%L)::text$q$, v_m));
  perform pg_temp.ck('and the person is told ONCE that it could not renew, not twice', '1',
    (select count(*)::text from public.notifications where recipient_id = v_p11 and template = 'membership_renewal_failed'));
  perform pg_temp.ck('no order and no charge was made', '0', (select count(*)::text from public.orders where renews_membership_id = v_m));
  update public.catalog_items set active = true where id = v_item;
end $$;


-- 6d. A price rise since the person was last shown the price is told, never charged -------------------------------------------------------
do $$
declare v_p12 uuid := pg_temp.f('p12'); v_p13 uuid := pg_temp.f('p13'); v_ref text; v_m uuid; r jsonb; v_amt bigint;
begin
  -- p12 was shown 100,000 kobo less than the price is now
  v_ref := pg_temp.buy(v_p12, true);
  perform pg_temp.q_svc(format($q$select public.save_membership_card(%L, 'AUTH_p12', true, 'sig12', 'visa', '1212', '03', '2031', 'CUS_p12', 'p12@example.invalid')::text$q$, v_ref));
  perform pg_temp.ck('the first payment records the list price they agreed to as the baseline', 'true',
    ((select renewal_notified_kobo from public.patient_memberships where patient_id = v_p12) = (select list_amount_kobo from public.orders where paystack_reference = v_ref))::text);
  select id into v_m from public.patient_memberships where patient_id = v_p12;
  update public.patient_memberships set ends_at = now() + interval '2 days', renewal_notified_kobo = renewal_notified_kobo - 100000 where id = v_m;
  perform pg_temp.ck('a price higher than the one last shown is NOT charged', 'price_changed',
    (pg_temp.q_svc(format($q$select public.service_prepare_membership_renewal(%L)::text$q$, v_m))::jsonb ->> 'skip'));
  perform pg_temp.q_svc(format($q$select public.service_prepare_membership_renewal(%L)::text$q$, v_m));
  perform pg_temp.ck('the person is told once, with the new amount', '1/true',
    (select count(*)::text from public.notifications where recipient_id = v_p12 and template = 'membership_renewal_price_changed') || '/'
    || (select ((payload ->> 'amount') ~ '^[0-9,]+$')::text from public.notifications where recipient_id = v_p12 and template = 'membership_renewal_price_changed'));
  perform pg_temp.ck('and no order and no attempt was made', '0/0',
    (select count(*)::text from public.orders where renews_membership_id = v_m) || '/' || (select count(*)::text from public.membership_renewal_attempts where membership_id = v_m));
  -- once they have been shown the new price (a later notice records it), the same renewal goes ahead
  update public.patient_memberships set renewal_notified_kobo = renewal_notified_kobo + 100000 where id = v_m;
  r := pg_temp.q_svc(format($q$select public.service_prepare_membership_renewal(%L)::text$q$, v_m))::jsonb;
  perform pg_temp.ck('after they were shown the current price the charge is prepared', 'true', ((r ->> 'reference') is not null)::text);

  -- p13 was shown MORE than the price is now: a fall is charged at the lower, current price
  v_ref := pg_temp.buy(v_p13, true);
  perform pg_temp.q_svc(format($q$select public.save_membership_card(%L, 'AUTH_p13', true, 'sig13', 'visa', '1313', '03', '2031', 'CUS_p13', 'p13@example.invalid')::text$q$, v_ref));
  select id into v_m from public.patient_memberships where patient_id = v_p13;
  update public.patient_memberships set ends_at = now() + interval '2 days', renewal_notified_kobo = renewal_notified_kobo + 1000000 where id = v_m;
  r := pg_temp.q_svc(format($q$select public.service_prepare_membership_renewal(%L)::text$q$, v_m))::jsonb;
  v_amt := (r ->> 'amount_kobo')::bigint;
  perform pg_temp.ck('a price that fell is charged at the current, lower price', 'true',
    (v_amt = (private.price_quote_calc(v_p13, v_p13, 'membership_annual', null, false) ->> 'amount_due_kobo')::bigint and v_amt < (select renewal_notified_kobo from public.patient_memberships where id = v_m))::text);
end $$;

-- 6e. The watchdog: a sweep that silently stops, a failing sweep, and a membership nobody attempted ------------------------------------------
do $$
declare v_p14 uuid := pg_temp.f('p14'); v_ref text; v_m uuid; h jsonb; v_before integer; v_after integer; v_admin uuid := pg_temp.f('p1');
begin
  -- the switch was only just turned on in this proof: no 'missing' alarm yet
  perform pg_temp.ck('on the day the switch is turned on there is no false sweep-missing alarm', 'false',
    (private.check_renewal_health() ->> 'sweep_missing'));
  update public.platform_modules set enabled_at = now() - interval '48 hours' where key = 'membership_auto_renew';
  h := private.check_renewal_health();
  perform pg_temp.ck('with the switch ON and no run ever reported, the watchdog says the sweep is missing and opens an incident', 'true/1',
    (h ->> 'sweep_missing') || '/' || (select count(*)::text from public.ops_incidents where external_reference like 'membership-renewal-sweep-missing:%'));
  perform private.check_renewal_health();
  perform pg_temp.ck('running it again the same day does not open a second incident', '1',
    (select count(*)::text from public.ops_incidents where external_reference like 'membership-renewal-sweep-missing:%'));
  perform pg_temp.q_svc($q$select public.service_record_renewal_run(true, '{"considered":3,"renewed":3,"failed":0,"pending":0,"skipped":0,"alreadyPaid":0}'::jsonb)::text$q$);
  h := private.check_renewal_health();
  perform pg_temp.ck('after a good run is reported, the sweep is no longer missing and nothing is failing', 'false/false',
    (h ->> 'sweep_missing') || '/' || (h ->> 'failures'));
  perform pg_temp.q_svc($q$select public.service_record_renewal_run(true, '{"considered":3,"renewed":1,"failed":2}'::jsonb)::text$q$);
  h := private.check_renewal_health();
  perform pg_temp.ck('a run with failed charges is reported as failing, with an incident', 'true/1',
    (h ->> 'failures') || '/' || (select count(*)::text from public.ops_incidents where external_reference like 'membership-renewal-failures:%'));
  perform pg_temp.q_svc($q$select public.service_record_renewal_run(false, '{}'::jsonb)::text$q$);
  perform pg_temp.ck('a run that failed outright is also failing', 'true', (private.check_renewal_health() ->> 'failures'));
  perform pg_temp.q_svc($q$select public.service_record_renewal_run(true, '{"considered":0}'::jsonb)::text$q$);
  perform pg_temp.ck('and a clean run afterwards clears it', 'false', (private.check_renewal_health() ->> 'failures'));
  update public.membership_renewal_runs set ran_at = now() - interval '30 hours';
  perform pg_temp.ck('a last run older than 26 hours counts as missing again', 'true', (private.check_renewal_health() ->> 'sweep_missing'));
  perform pg_temp.q_svc($q$select public.service_record_renewal_run(true, '{"considered":0}'::jsonb)::text$q$);

  -- a membership ending tomorrow, card on file, never attempted
  v_ref := pg_temp.buy(v_p14, true);
  perform pg_temp.q_svc(format($q$select public.save_membership_card(%L, 'AUTH_p14', true, 'sig14', 'visa', '1414', '03', '2031', 'CUS_p14', 'p14@example.invalid')::text$q$, v_ref));
  select id into v_m from public.patient_memberships where patient_id = v_p14;
  update public.patient_memberships set ends_at = now() + interval '1 day' where id = v_m;
  v_before := (private.check_renewal_health() ->> 'overdue')::integer;
  perform pg_temp.ck('a membership due within 2 days that nobody attempted is overdue', 'true', (v_before >= 1)::text);
  perform pg_temp.q_svc(format($q$select public.service_prepare_membership_renewal(%L)::text$q$, v_m));
  v_after := (private.check_renewal_health() ->> 'overdue')::integer;
  perform pg_temp.ck('once it has been attempted it is no longer overdue', '1', (v_before - v_after)::text);

  perform pg_temp.ck('a patient cannot report a run', 'true', (pg_temp.q_as(v_p14, $q$select public.service_record_renewal_run(true, '{}'::jsonb)::text$q$) like 'ERR:%')::text);
  perform pg_temp.ck('and cannot read the run log', 'true', (pg_temp.q_as(v_p14, 'select count(*)::text from public.membership_renewal_runs') like 'ERR:%')::text);

  -- with the switch OFF the watchdog is silent
  update public.platform_modules set is_enabled = false where key = 'membership_auto_renew';
  perform pg_temp.ck('with the switch OFF the watchdog does nothing', 'true', (private.check_renewal_health() ->> 'skipped'));
  update public.platform_modules set is_enabled = true, enabled_at = now(), enabled_by = v_admin, activation_note = 'switched back on inside the auto-renew proof' where key = 'membership_auto_renew';
end $$;


-- SABOTAGE 1: take the consent check out of save_membership_card; an order with no consent must now save a card
do $$
declare d text; v_p4 uuid := pg_temp.f('p4'); v_ref text;
begin
  d := replace(pg_get_functiondef('public.save_membership_card(text, text, boolean, text, text, text, text, text, text, text)'::regprocedure),
               $s$if o.renewal_consent_at is null then return jsonb_build_object('result', 'no_consent'); end if;$s$, '');
  if d = pg_get_functiondef('public.save_membership_card(text, text, boolean, text, text, text, text, text, text, text)'::regprocedure) then raise exception 'VACUOUS TEST: sabotage text 1 not found'; end if;
  execute d;
  select paystack_reference into v_ref from public.orders where beneficiary_patient_id = v_p4 order by created_at limit 1;
  begin
    insert into results values ('sabotaged', 'no consent, no card', 'no_consent',
      (pg_temp.q_svc(format($q$select public.save_membership_card(%L, 'AUTH_p4', true, 'sig4', 'visa', '1111', '01', '2031', 'CUS_p4', 'p4@example.invalid')::text$q$, v_ref))::jsonb ->> 'result'));
  exception when others then
    -- the table CHECK (auto_renew needs a consent time) is a second line of defence; either way the changed behaviour is visible
    insert into results values ('sabotaged', 'no consent, no card', 'no_consent', 'refused later by the table check: ' || left(sqlerrm, 80));
  end;
end $$;

-- SABOTAGE 2: remove the renewal exemption from the overlap incident; a renewal must now raise one
do $$
declare d text; v_p6 uuid := pg_temp.f('p6'); v_m uuid; r jsonb; v_amt bigint; v_order uuid;
begin
  d := replace(pg_get_functiondef('public.record_order_payment(text, bigint, bigint, bigint, text, text, text, text, timestamp with time zone, jsonb, bigint)'::regprocedure),
               'if o.renews_membership_id is null then', 'if true then');
  if d = pg_get_functiondef('public.record_order_payment(text, bigint, bigint, bigint, text, text, text, text, timestamp with time zone, jsonb, bigint)'::regprocedure) then raise exception 'VACUOUS TEST: sabotage text 2 not found'; end if;
  execute d;
  select id into v_m from public.patient_memberships where patient_id = v_p6;
  update public.patient_memberships set ends_at = now() + interval '2 days' where id = v_m;
  r := pg_temp.q_svc(format($q$select public.service_prepare_membership_renewal(%L)::text$q$, v_m))::jsonb;
  v_amt := (r ->> 'amount_kobo')::bigint; v_order := (r ->> 'order_id')::uuid;
  perform pg_temp.q_svc(format($q$select public.record_order_payment(%L, %s, 0, %s, 'NGN', 'success', 'sweep')::text$q$, r ->> 'reference', v_amt, v_amt));
  insert into results values ('sabotaged', 'a renewal raises no overlap incident', '0',
    (select count(*)::text from public.ops_incidents where external_reference = 'order-membership-overlap:' || v_order));
end $$;

-- SABOTAGE 3: take the price-rise check out of prepare; a person shown a lower price must now be prepared for a HIGHER charge
do $$
declare d text; v_p12 uuid := pg_temp.f('p12'); v_m uuid; r jsonb;
begin
  d := replace(pg_get_functiondef('public.service_prepare_membership_renewal(uuid)'::regprocedure),
               'if v_amount is not null and v_amount > coalesce(m.renewal_notified_kobo, 0) then', 'if false then');
  if d = pg_get_functiondef('public.service_prepare_membership_renewal(uuid)'::regprocedure) then raise exception 'VACUOUS TEST: sabotage text 3 not found'; end if;
  execute d;
  -- a fresh patient shown 1 kobo less than the price
  perform pg_temp.setf('p15', pg_temp.mkuser(pg_temp.f('org'), 'p15'));
  perform pg_temp.q_svc(format($q$select public.save_membership_card(%L, 'AUTH_p15', true, 'sig15', 'visa', '1515', '03', '2031', 'CUS_p15', 'p15@example.invalid')::text$q$, pg_temp.buy(pg_temp.f('p15'), true)));
  select id into v_m from public.patient_memberships where patient_id = pg_temp.f('p15');
  update public.patient_memberships set ends_at = now() + interval '2 days', renewal_notified_kobo = renewal_notified_kobo - 1 where id = v_m;
  r := pg_temp.q_svc(format($q$select public.service_prepare_membership_renewal(%L)::text$q$, v_m))::jsonb;
  insert into results values ('sabotaged', 'a price rise since the last notice is not charged', 'price_changed', coalesce(r ->> 'skip', 'charged'));
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'membership auto-renew proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ')
         from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 3 then raise exception 'VACUOUS TEST: the sabotage flipped % of 3 checks', v_caught; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;

rollback;
