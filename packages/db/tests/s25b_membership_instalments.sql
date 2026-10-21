-- S25b proof: pay the annual Membership in parts (migration *_s25b_membership_instalments.sql). One rolled-back transaction.
-- Proves:
--   1. DORMANT: the module defaults OFF; with it off a plan cannot be created and an ordinary Membership order still pays exactly as before
--      (no plan rows, one entitlement, no instalment side effect).
--   2. PLAN: the parts are integer kobo and add up to the price EXACTLY (the leftover kobo on the first part), the schedule comes from the
--      versioned config, a stale screen (wrong part count) is refused, a retry of the same tap returns the same plan, an item that is not a
--      Membership and a discounted order are refused; a deferred trigger refuses parts that do not add up.
--   3. FIRST PART: access unlocks (order paid, one entitlement, a membership row) and the 365 days run from the first part; every part gets
--      its due date from the offsets; replaying the same webhook any number of times credits nothing twice; a wrong amount, a wrong currency
--      and a part paid twice are visible mismatches plus incidents, never a quiet credit.
--   4. LAPSE: a part unpaid after due date plus grace lapses the plan, ends the entitlement and the membership, messages the patient once;
--      a part inside its grace does not lapse; a rerun lapses nothing twice.
--   5. RESTORE: paying the overdue part restores access to the original end date; with two parts overdue, one payment is not enough; a part
--      cannot be paid before an earlier one.
--   6. REMINDERS: 3 days before and on the due day, once each, on the channel private.patient_reminder_channel() picks.
--   7. MONEY: each part posts Dr 1020 / Cr 2000 with its own schedule to the end of access and posts once; the full-price posting skips a plan.
--   8. REFUND of a partly paid order: only what was paid comes back, one refund per paid part against its own charge; the unpaid parts are
--      never charged; a part paid between the request and the decision is refunded too; the deferred revenue released follows each part;
--      outside the window the refund is refused.
--   9. LATE FIRST PAYMENT on an expired order is honoured and flagged; ACCESS: nothing is writable directly, anon holds no function.
--  10. SABOTAGE: the part routing removed, the replay guards removed, the lapse sweep emptied, the sum trigger switched off, the refund claim
--      made to ignore the part. Each check must flip.
begin;

-- Two-tier: only the Membership may be on sale (catalog_items_only_membership_sellable). One check below needs a non-Membership item to
-- show a plan is refused for it, so the constraint is dropped here on purpose, inside this rolled-back transaction.
alter table public.catalog_items drop constraint catalog_items_only_membership_sellable;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;
create temp table tx(k text primary key, v text) on commit drop;
grant all on tx to public;

create function pg_temp.f(p text) returns uuid language sql as $$ select v from fx where k = p $$;
create function pg_temp.setf(p text, p_v uuid) returns void language sql as
$$ insert into fx values (p, p_v) on conflict (k) do update set v = excluded.v $$;
create function pg_temp.t(p text) returns text language sql as $$ select v from tx where k = p $$;
create function pg_temp.sett(p text, p_v text) returns void language sql as
$$ insert into tx values (p, p_v) on conflict (k) do update set v = excluded.v $$;
create function pg_temp.ck(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('real', p_name, p_expected, p_actual) $$;
create function pg_temp.act(p_uid uuid) returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
end $f$;
create function pg_temp.back() returns void language plpgsql as
$f$ begin reset role; perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.sub', '', true); perform set_config('request.jwt.claim.role', '', true); end $f$;
create function pg_temp.q_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlerrm; end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.try_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql; r := 'ok'; exception when others then r := sqlstate; end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.try_anon(p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  perform set_config('request.jwt.claim.role', 'anon', true);
  set local role anon;
  begin execute p_sql; r := 'ok'; exception when others then r := sqlstate; end;
  reset role;
  perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.role', '', true);
  return r;
end $f$;
-- the service role: the webhook, the return page and the sweeper call record_order_payment this way
create function pg_temp.svc(p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('request.jwt.claim.role', 'service_role', true);
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlerrm; end;
  perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.role', '', true);
  return r;
end $f$;
create function pg_temp.try_sql(p_sql text) returns text language plpgsql as
$f$ begin execute p_sql; return 'ok'; exception when others then return sqlerrm; end $f$;
create function pg_temp.q(p_sql text) returns text language plpgsql as
$f$ declare r text; begin execute p_sql into r; return r; end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's25b-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'S25b ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone, date_of_birth = excluded.date_of_birth;
  return v;
end $f$;
-- pay a reference as the service role: amount, fee. total = amount + fee.
create function pg_temp.pay(p_ref text, p_amount bigint, p_fee bigint default 100, p_cur text default 'NGN') returns jsonb language sql as
$$ select pg_temp.svc(format($q$select public.record_order_payment(%L, %s, %s, %s, %L, 'success', 'webhook', 'evt-1', now(), '{}'::jsonb)::text$q$,
                              p_ref, p_amount, p_fee, p_amount + p_fee, p_cur))::jsonb $$;
create function pg_temp.res(p jsonb) returns text language sql as $$ select p ->> 'result' $$;
-- the open attempt reference of one part of a plan
create function pg_temp.ref_of(p_order uuid, p_seq int) returns text language sql as
$$ select a.reference from public.order_instalment_attempts a join public.order_instalments i on i.id = a.instalment_id
    where i.order_id = p_order and i.seq = p_seq and a.state = 'open' order by a.created_at desc limit 1 $$;
create function pg_temp.part(p_order uuid, p_seq int) returns uuid language sql as
$$ select id from public.order_instalments where order_id = p_order and seq = p_seq $$;
create function pg_temp.amt(p_order uuid, p_seq int) returns bigint language sql as
$$ select amount_kobo from public.order_instalments where order_id = p_order and seq = p_seq $$;
create function pg_temp.notifs(p_patient uuid, p_template text) returns bigint language sql as
$$ select count(*) from public.notifications where recipient_id = p_patient and template = p_template $$;
-- a plan order, created the way the app creates it (as the patient)
create function pg_temp.mkplan(p_pat uuid) returns uuid language plpgsql as $f$
declare r text;
begin
  r := pg_temp.q_as(p_pat, format($q$select (public.create_instalment_order('s25b_member', gen_random_uuid(), 3))->>'order_id'$q$));
  if r like 'ERR:%' then raise exception 'mkplan failed: %', r; end if;
  return r::uuid;
end $f$;
-- age a plan: move first-payment dates back by p_days (as the owner) so that dates fall where a test needs them
create function pg_temp.age_part_due(p_order uuid, p_seq int, p_days_from_now numeric) returns void language sql as
$$ update public.order_instalments set due_at = now() + make_interval(secs => p_days_from_now * 86400) where order_id = p_order and seq = p_seq $$;

-- Insert a three-part plan for a 900 kobo order whose last part is p_last, then force the deferred sum check. Returns the error or 'accepted'.
-- Everything it does is undone by its own exception block, so it leaves nothing behind either way.
create function pg_temp.sum_probe(p_last bigint) returns text language plpgsql as $f$
declare o uuid := gen_random_uuid(); pl uuid := gen_random_uuid(); src public.orders%rowtype;
begin
  select * into src from public.orders where id = pg_temp.f('plan_order');
  insert into public.orders (id, organisation_id, buyer_profile_id, beneficiary_patient_id, catalog_item_id, price_id, amount_kobo, paystack_reference, is_test)
  values (o, src.organisation_id, src.buyer_profile_id, src.beneficiary_patient_id, src.catalog_item_id, src.price_id, 900, 'tho_s25b_sum_' || replace(o::text, '-', ''), true);
  insert into public.order_instalment_plans (id, organisation_id, order_id, patient_id, parts, price_kobo, schedule, schedule_version, is_test)
  values (pl, src.organisation_id, o, src.buyer_profile_id, 3, 900, '{}', 1, true);
  insert into public.order_instalments (organisation_id, plan_id, order_id, seq, amount_kobo, is_test) values
    (src.organisation_id, pl, o, 1, 300, true), (src.organisation_id, pl, o, 2, 300, true), (src.organisation_id, pl, o, 3, p_last, true);
  set constraints all immediate;
  set constraints all deferred;
  raise exception 'accepted';
exception when others then
  return sqlerrm;
end $f$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------------------------------------------------------------
do $$
declare
  v_org uuid; v_admin uuid; v_item uuid := gen_random_uuid(); v_price uuid := gen_random_uuid(); v_pack uuid := gen_random_uuid(); v_pack_price uuid := gen_random_uuid();
begin
  select id into v_org from public.organisations limit 1;
  if v_org is null then raise exception 'no organisation: cannot run this proof'; end if;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  perform pg_temp.setf('org', v_org); perform pg_temp.setf('admin', v_admin);
  perform pg_temp.setf('pat', pg_temp.mkuser(v_org, 'patient', 'patient'));
  perform pg_temp.setf('pat2', pg_temp.mkuser(v_org, 'patient2', 'patient'));
  perform pg_temp.setf('pat3', pg_temp.mkuser(v_org, 'patient3', 'patient'));
  perform pg_temp.setf('pat4', pg_temp.mkuser(v_org, 'patient4', 'patient'));
  perform pg_temp.setf('pat5', pg_temp.mkuser(v_org, 'patient5', 'patient'));
  perform pg_temp.setf('pat6', pg_temp.mkuser(v_org, 'patient6', 'patient'));
  perform pg_temp.setf('pat7', pg_temp.mkuser(v_org, 'patient7', 'patient'));
  perform pg_temp.setf('pat8', pg_temp.mkuser(v_org, 'patient8', 'patient'));
  perform pg_temp.setf('pat9', pg_temp.mkuser(v_org, 'patient9', 'patient'));
  perform pg_temp.setf('pat10', pg_temp.mkuser(v_org, 'patient10', 'patient'));
  perform pg_temp.setf('pat11', pg_temp.mkuser(v_org, 'patient11', 'patient'));
  perform pg_temp.setf('pat12', pg_temp.mkuser(v_org, 'patient12', 'patient'));
  perform pg_temp.setf('pat13', pg_temp.mkuser(v_org, 'patient13', 'patient'));
  perform pg_temp.setf('pat14', pg_temp.mkuser(v_org, 'patient14', 'patient'));
  perform pg_temp.setf('pat15', pg_temp.mkuser(v_org, 'patient15', 'patient'));
  perform pg_temp.setf('pat16', pg_temp.mkuser(v_org, 'patient16', 'patient'));
  perform pg_temp.setf('other', pg_temp.mkuser(v_org, 'other', 'patient'));
  -- a Membership priced so that the price does not divide by three (10,000,000 kobo = 3 x 3,333,333 + 1)
  insert into public.catalog_items (id, organisation_id, code, kind, name_key, description_key, duration_days, uses, grants_lead, active)
  values (v_item, v_org, 's25b_member', 'membership', 's25b.member.name', 's25b.member.desc', 365, null, false, true);
  insert into public.prices (id, organisation_id, catalog_item_id, amount_kobo, components) values (v_price, v_org, v_item, 10000000, '{}');
  insert into public.catalog_items (id, organisation_id, code, kind, name_key, description_key, duration_days, uses, grants_lead, active)
  values (v_pack, v_org, 's25b_pack', 'care_pack', 's25b.pack.name', 's25b.pack.desc', 90, null, false, true);
  insert into public.prices (id, organisation_id, catalog_item_id, amount_kobo, components) values (v_pack_price, v_org, v_pack, 500000, '{}');
  perform pg_temp.setf('item', v_item);
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 1. Dormant
-- ---------------------------------------------------------------------------------------------------------------------------------
do $$
declare v_pat uuid := pg_temp.f('pat'); v_admin uuid := pg_temp.f('admin'); r text; o uuid; ref text; n_before bigint;
begin
  update public.platform_modules set is_enabled = true, enabled_at = now(), enabled_by = v_admin, activation_note = 'S25b proof run' where key = 'v5_checkout';
  perform pg_temp.ck('the module defaults OFF', 'false', (select is_enabled::text from public.platform_modules where key = 'membership_instalments'));
  perform pg_temp.ck('the public policy says closed', 'false', pg_temp.q_as(v_pat, $q$select (public.instalment_policy_public()->>'open')$q$));
  perform pg_temp.ck('the shipped schedule is 3 parts at 0, 30 and 60 days, 5 days of grace', '3/[0, 30, 60]/5',
    pg_temp.q_as(v_pat, $q$select (public.instalment_policy_public()->>'parts') || '/' || (public.instalment_policy_public()->'due_offsets_days')::text || '/' || (public.instalment_policy_public()->>'grace_days')$q$));
  perform pg_temp.ck('with the module off a plan cannot be created', 'ERR:instalments_not_open',
    pg_temp.q_as(v_pat, $q$select public.create_instalment_order('s25b_member', gen_random_uuid(), 3)::text$q$));
  -- flag-off behaviour unchanged: an ordinary Membership order still pays in full, one entitlement, no plan
  ref := pg_temp.q_as(pg_temp.f('pat7'), $q$select (public.create_order('s25b_member', gen_random_uuid()))->>'reference'$q$);
  perform pg_temp.ck('an ordinary membership order is created as before', 'true', (ref like 'tho_%')::text);
  o := (select id from public.orders where paystack_reference = ref);
  perform pg_temp.ck('and pays in full as before', 'paid', pg_temp.res(pg_temp.pay(ref, 10000000, 150)));
  perform pg_temp.ck('one entitlement, ending 365 days on', '1/365', (select count(*)::text || '/' || extract(day from max(ends_at) - max(starts_at))::int from public.entitlements where order_id = o));
  perform pg_temp.ck('no plan rows exist for an ordinary order', '0', (select count(*)::text from public.order_instalment_plans where order_id = o));
  perform private.post_order_to_ledger(o, true);
  perform pg_temp.ck('the ordinary order is still posted at full price', '1', (select count(*)::text from public.finance_journal_entries where source = 'payment' and source_ref = 'order:' || o));
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 2. Creating a plan
-- ---------------------------------------------------------------------------------------------------------------------------------
do $$
declare
  v_pat uuid := pg_temp.f('pat'); v_admin uuid := pg_temp.f('admin'); o uuid; k uuid := gen_random_uuid(); r1 text; r2 text; pl uuid;
begin
  update public.platform_modules set is_enabled = true, enabled_at = now(), enabled_by = v_admin, activation_note = 'S25b proof run' where key = 'membership_instalments';
  perform pg_temp.ck('the public policy says open once the module is on', 'true', pg_temp.q_as(v_pat, $q$select (public.instalment_policy_public()->>'open')$q$));
  perform pg_temp.ck('a stale screen (wrong part count) is refused', 'ERR:instalment_schedule_invalid',
    pg_temp.q_as(v_pat, $q$select public.create_instalment_order('s25b_member', gen_random_uuid(), 4)::text$q$));
  perform pg_temp.ck('no part count at all is refused', 'ERR:instalment_schedule_invalid',
    pg_temp.q_as(v_pat, $q$select public.create_instalment_order('s25b_member', gen_random_uuid())::text$q$));
  perform pg_temp.ck('only a Membership can be paid in parts', 'ERR:instalment_not_available',
    pg_temp.q_as(v_pat, $q$select public.create_instalment_order('s25b_pack', gen_random_uuid(), 3)::text$q$));
  perform pg_temp.ck('anon cannot create a plan', '42501', pg_temp.try_anon($q$select public.create_instalment_order('s25b_member', gen_random_uuid(), 3)$q$));

  r1 := pg_temp.q_as(v_pat, format($q$select public.create_instalment_order('s25b_member', %L, 3)::text$q$, k));
  perform pg_temp.ck('the plan order is created', 'true', (r1 not like 'ERR:%')::text);
  o := (r1::jsonb ->> 'order_id')::uuid;
  perform pg_temp.setf('plan_order', o);
  perform pg_temp.ck('the reply carries the first part, under its own thi_ reference', 'true/3333334',
    ((r1::jsonb ->> 'reference') like 'thi_%')::text || '/' || (r1::jsonb ->> 'amount_kobo'));
  perform pg_temp.ck('the parts are integer kobo and add up to the price EXACTLY', '10000000/3',
    (select sum(amount_kobo)::text || '/' || count(*) from public.order_instalments where order_id = o));
  perform pg_temp.ck('the leftover kobo are on the first part only', '3333334/3333333/3333333',
    pg_temp.amt(o, 1) || '/' || pg_temp.amt(o, 2) || '/' || pg_temp.amt(o, 3));
  perform pg_temp.ck('the plan snapshots the schedule version and the price', '1/10000000/awaiting_first',
    (select schedule_version || '/' || price_kobo || '/' || state from public.order_instalment_plans where order_id = o));
  perform pg_temp.ck('nothing is unlocked before the first part is paid', 'created/0/false',
    (select state from public.orders where id = o) || '/' || (select count(*)::text from public.entitlements where order_id = o) || '/' || private.patient_is_member(v_pat)::text);
  perform pg_temp.ck('no due dates yet', '0', (select count(*)::text from public.order_instalments where order_id = o and due_at is not null));
  -- a retry of the same tap answers with the same plan
  r2 := pg_temp.q_as(v_pat, format($q$select public.create_instalment_order('s25b_member', %L, 3)::text$q$, k));
  perform pg_temp.ck('a retry returns the same order and reference', 'true', ((r2::jsonb ->> 'order_id') = (r1::jsonb ->> 'order_id') and (r2::jsonb ->> 'reference') = (r1::jsonb ->> 'reference'))::text);
  perform pg_temp.ck('and made no second plan', '1', (select count(*)::text from public.order_instalment_plans where patient_id = v_pat));
  -- an ordinary order made with the same key is not silently turned into a plan
  perform pg_temp.ck('an ordinary order is never mistaken for a plan', 'ERR:instalment_order_mismatch',
    pg_temp.q_as(pg_temp.f('pat7'), format($q$select public.create_instalment_order('s25b_member', %L, 3)::text$q$, (select client_key from public.orders where buyer_profile_id = pg_temp.f('pat7') limit 1))));
  perform pg_temp.ck('parts that do not add up are refused when the transaction ends', 'true', (pg_temp.sum_probe(299) like 'instalment_sum_mismatch%')::text);
  perform pg_temp.ck('parts that do add up are accepted', 'accepted', pg_temp.sum_probe(300));
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 3. The first part
-- ---------------------------------------------------------------------------------------------------------------------------------
do $$
declare
  v_pat uuid := pg_temp.f('pat'); o uuid := pg_temp.f('plan_order'); ref text := pg_temp.ref_of(pg_temp.f('plan_order'), 1); a jsonb; i int; v_start timestamptz;
begin
  a := pg_temp.pay(ref, pg_temp.amt(o, 1), 100);
  perform pg_temp.ck('the first part is recorded as paid', 'paid', pg_temp.res(a));
  perform pg_temp.ck('the order is paid and carries the first part fee', 'paid/100/10000100',
    (select state || '/' || fee_kobo || '/' || total_kobo from public.orders where id = o));
  perform pg_temp.ck('one entitlement, active', '1/active/membership', (select count(*)::text || '/' || min(state) || '/' || min(kind) from public.entitlements where order_id = o));
  perform pg_temp.ck('the 365 days run from the first part', '365',
    (select extract(day from ends_at - starts_at)::int::text from public.entitlements where order_id = o));
  perform pg_temp.ck('the patient is now a Member', 'true', private.patient_is_member(v_pat)::text);
  perform pg_temp.ck('the membership row runs the same 365 days', '365',
    (select extract(day from ends_at - starts_at)::int::text from public.patient_memberships where patient_id = v_pat and state = 'active'));
  select first_paid_at into v_start from public.order_instalment_plans where order_id = o;
  perform pg_temp.ck('the plan is active and the due dates come from the offsets', 'active/0/30/60',
    (select pl.state from public.order_instalment_plans pl where pl.order_id = o) || '/' ||
    (select string_agg(round(extract(epoch from (due_at - v_start)) / 86400)::int::text, '/' order by seq) from public.order_instalments where order_id = o));
  perform pg_temp.ck('one payment row, for the part', '1/' || pg_temp.amt(o, 1),
    (select count(*)::text || '/' || sum(amount_kobo) from public.payments where order_id = o and status = 'success'));
  perform pg_temp.ck('one order.paid event with no amount in it', '1',
    (select count(*)::text from public.domain_events where event_type = 'order.paid' and aggregate_id = o and payload ?& array['order_id'] and not payload ? 'amount_kobo'));
  perform pg_temp.ck('no full-price journal entry exists for the plan order', '0', (select count(*)::text from public.finance_journal_entries where source = 'payment' and source_ref = 'order:' || o));
  perform pg_temp.ck('the full-price posting refuses a plan order', 'null', coalesce(private.post_order_to_ledger(o, true)::text, 'null'));

  -- replaying the same webhook credits nothing twice (safety case 24, for a part)
  for i in 1 .. 3 loop
    perform pg_temp.ck('replay ' || i || ' of the same payment', 'replay', pg_temp.res(pg_temp.pay(ref, pg_temp.amt(o, 1), 100)));
  end loop;
  perform pg_temp.ck('still one payment, one entitlement, one membership, one event', '1/1/1/1',
    (select count(*)::text from public.payments where order_id = o and status = 'success') || '/' ||
    (select count(*)::text from public.entitlements where order_id = o) || '/' ||
    (select count(*)::text from public.patient_memberships where patient_id = v_pat and state = 'active') || '/' ||
    (select count(*)::text from public.domain_events where event_type = 'order.paid' and aggregate_id = o));
  perform pg_temp.ck('the order fee was not added again by the replays', '100', (select fee_kobo::text from public.orders where id = o));
end $$;

do $$
declare
  v_pat uuid := pg_temp.f('pat'); o uuid := pg_temp.f('plan_order'); r text; ref2 text;
begin
  r := pg_temp.q_as(v_pat, format($q$select (public.prepare_instalment_payment(%L))->>'reference'$q$, pg_temp.part(o, 2)));
  perform pg_temp.ck('the patient can prepare the next part', 'true', (r like 'thi_%')::text);
  ref2 := r;
  perform pg_temp.sett('ref2', ref2);
  perform pg_temp.ck('preparing again before a hosted page exists opens another attempt', 'true',
    (pg_temp.q_as(v_pat, format($q$select (public.prepare_instalment_payment(%L))->>'reference'$q$, pg_temp.part(o, 2))) <> ref2)::text);
  perform pg_temp.ck('the hosted page is kept against an attempt', 'true', pg_temp.svc(format($q$select public.set_order_checkout_url(%L, 'https://checkout.example/pay')::text$q$, ref2)));
  perform pg_temp.ck('and an attempt with a page is reused, not duplicated', ref2,
    pg_temp.q_as(v_pat, format($q$select (public.prepare_instalment_payment(%L))->>'reference'$q$, pg_temp.part(o, 2))));
  perform pg_temp.ck('part 3 cannot be paid before part 2', 'ERR:pay_earlier_part_first',
    pg_temp.q_as(v_pat, format($q$select public.prepare_instalment_payment(%L)::text$q$, pg_temp.part(o, 3))));
  perform pg_temp.ck('another patient cannot prepare someone else''s part', 'ERR:instalment_not_found',
    pg_temp.q_as(pg_temp.f('other'), format($q$select public.prepare_instalment_payment(%L)::text$q$, pg_temp.part(o, 2))));
  perform pg_temp.ck('a wrong amount is a mismatch, not a payment', 'mismatch',
    pg_temp.res(pg_temp.pay(ref2, pg_temp.amt(o, 2) + 1, 100)));
  perform pg_temp.ck('a wrong currency is a mismatch', 'mismatch', pg_temp.res(pg_temp.pay(ref2, pg_temp.amt(o, 2), 100, 'USD')));
  perform pg_temp.ck('and part 2 is still unpaid', 'pending', (select state from public.order_instalments where id = pg_temp.part(o, 2)));
  perform pg_temp.ck('a mismatch opens an incident', '1', (select count(*)::text from public.ops_incidents where external_reference = 'order-mismatch:' || o and status not in ('resolved', 'closed')));
  perform pg_temp.ck('a mismatch leaves a visible payment row', 'true', (select (count(*) >= 1)::text from public.payments where order_id = o and status = 'mismatch'));
  perform pg_temp.ck('only the service role can record a payment', '42501',
    pg_temp.try_as(v_pat, format($q$select public.record_order_payment(%L, 1, 0, 1, 'NGN', 'success', 'webhook')$q$, ref2)));
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 4. Lapse
-- ---------------------------------------------------------------------------------------------------------------------------------
do $$
declare
  v_pat uuid := pg_temp.f('pat'); o uuid := pg_temp.f('plan_order'); n integer;
begin
  -- inside the grace (due 2 days ago, grace 5): nothing happens
  perform pg_temp.age_part_due(o, 2, -2);
  n := private.sweep_instalment_lapses();
  perform pg_temp.ck('a part inside its grace does not lapse the plan', '0/active/true',
    n || '/' || (select state from public.order_instalment_plans where order_id = o) || '/' || private.patient_is_member(v_pat)::text);
  -- past due plus grace (due 6 days ago)
  perform pg_temp.age_part_due(o, 2, -6);
  n := private.sweep_instalment_lapses();
  perform pg_temp.ck('a part past its due date plus grace lapses the plan', '1/lapsed', n || '/' || (select state from public.order_instalment_plans where order_id = o));
  perform pg_temp.ck('the entitlement is ended', 'revoked', (select state from public.entitlements where order_id = o));
  perform pg_temp.ck('the patient is no longer a Member', 'false', private.patient_is_member(v_pat)::text);
  perform pg_temp.ck('the membership row is ended', 'ended', (select state from public.patient_memberships where patient_id = v_pat order by created_at desc limit 1));
  perform pg_temp.ck('the patient is told once', '1', pg_temp.notifs(v_pat, 'instalment_lapsed')::text);
  perform pg_temp.ck('a rerun lapses nothing twice and tells nobody twice', '0/1', private.sweep_instalment_lapses() || '/' || pg_temp.notifs(v_pat, 'instalment_lapsed'));
  perform pg_temp.ck('nothing was deleted: the paid part is still paid', 'paid', (select state from public.order_instalments where id = pg_temp.part(o, 1)));
  perform pg_temp.ck('a lapsed entitlement gives no doctor time', 'not_active', pg_temp.svc(format($q$select public.consume_entitlement(%L)->>'result'$q$, (select id from public.entitlements where order_id = o))));
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 5. Restore
-- ---------------------------------------------------------------------------------------------------------------------------------
do $$
declare
  v_pat uuid := pg_temp.f('pat'); o uuid := pg_temp.f('plan_order'); ref2 text := pg_temp.t('ref2'); a jsonb; v_end timestamptz;
begin
  select ends_at into v_end from public.entitlements where order_id = o;
  a := pg_temp.pay(ref2, pg_temp.amt(o, 2), 100);
  perform pg_temp.ck('paying the overdue part is recorded', 'paid', pg_temp.res(a));
  perform pg_temp.ck('and says it restored access', 'true', coalesce(a ->> 'restored', 'false'));
  perform pg_temp.ck('the plan is active again', 'active', (select state from public.order_instalment_plans where order_id = o));
  perform pg_temp.ck('the entitlement is active again with its original end', 'active/true',
    (select state || '/' || (ends_at = v_end)::text from public.entitlements where order_id = o));
  perform pg_temp.ck('the patient is a Member again, to the original end date', 'true/true',
    private.patient_is_member(v_pat)::text || '/' || (select (ends_at = v_end)::text from public.patient_memberships where patient_id = v_pat and state = 'active'));
  perform pg_temp.ck('the patient is told', '1', pg_temp.notifs(v_pat, 'instalment_restored')::text);
  perform pg_temp.ck('the order fee is the sum of the parts paid so far', '200', (select fee_kobo::text from public.orders where id = o));
  perform pg_temp.ck('a part already paid cannot be prepared again', 'ERR:instalment_closed', pg_temp.q_as(v_pat, format($q$select public.prepare_instalment_payment(%L)::text$q$, pg_temp.part(o, 2))));
  -- the same part charged twice (a second attempt) is money to give back, not a second credit
  insert into public.order_instalment_attempts (reference, organisation_id, instalment_id) values ('thi_s25b_dup_attempt_0001', pg_temp.f('org'), pg_temp.part(o, 2));
  perform pg_temp.ck('a part paid twice is a mismatch', 'mismatch', pg_temp.res(pg_temp.pay('thi_s25b_dup_attempt_0001', pg_temp.amt(o, 2), 100)));
  perform pg_temp.ck('and is counted once', '1', (select count(*)::text from public.payments where order_id = o and amount_kobo = pg_temp.amt(o, 2) and status = 'success'));
end $$;

-- an item that grants a lead clinician: the event says so (so S18 assigns one) and a missing slot is told to a person, exactly as for an ordinary order
do $$
declare
  v_pat uuid := pg_temp.f('pat13'); o uuid;
begin
  o := pg_temp.mkplan(v_pat);
  update public.catalog_items set grants_lead = true where id = pg_temp.f('item');
  perform pg_temp.pay(pg_temp.ref_of(o, 1), pg_temp.amt(o, 1));
  update public.catalog_items set grants_lead = false where id = pg_temp.f('item');
  perform pg_temp.ck('a plan on an item that grants a lead clinician emits the same care_pack event as an ordinary order', 'true',
    (select (payload ->> 'care_pack')::text from public.domain_events where event_type = 'order.paid' and aggregate_id = o));
  perform pg_temp.ck('and a missing lead slot is raised to a person (and only then)', 'true',
    ((select count(*) from public.ops_incidents where external_reference = 'order-no-lead-slot:' || o) =
     (case when exists (select 1 from private.lead_candidates(v_pat, '{}', true)) then 0 else 1 end))::text);
end $$;

-- two parts overdue: one payment is not enough; the last payment completes the plan
do $$
declare
  v_pat uuid := pg_temp.f('pat2'); o uuid; a jsonb; r text; n integer;
begin
  o := pg_temp.mkplan(v_pat);
  perform pg_temp.pay(pg_temp.ref_of(o, 1), pg_temp.amt(o, 1));
  perform pg_temp.age_part_due(o, 2, -7); perform pg_temp.age_part_due(o, 3, -7);
  n := private.sweep_instalment_lapses();
  perform pg_temp.ck('a second plan lapses with two parts overdue', 'true/lapsed/none', (n >= 1)::text || '/' || (select state from public.order_instalment_plans where order_id = o)
    || '/' || coalesce((select summary from public.ops_incidents where external_reference = 'instalment-lapse:' || (select id from public.order_instalment_plans where order_id = o)), 'none'));
  r := pg_temp.q_as(v_pat, format($q$select (public.prepare_instalment_payment(%L))->>'reference'$q$, pg_temp.part(o, 2)));
  a := pg_temp.pay(r, pg_temp.amt(o, 2));
  perform pg_temp.ck('one payment is not enough while another part is still overdue', 'paid/lapsed/false',
    pg_temp.res(a) || '/' || (select state from public.order_instalment_plans where order_id = o) || '/' || private.patient_is_member(v_pat)::text);
  r := pg_temp.q_as(v_pat, format($q$select (public.prepare_instalment_payment(%L))->>'reference'$q$, pg_temp.part(o, 3)));
  a := pg_temp.pay(r, pg_temp.amt(o, 3));
  perform pg_temp.ck('the last payment restores access', 'true/true', coalesce(a ->> 'restored', 'false') || '/' || private.patient_is_member(v_pat)::text);
  perform pg_temp.ck('and the plan is completed, with the fee totals of all three parts', 'completed/300',
    (select pl.state from public.order_instalment_plans pl where pl.order_id = o) || '/' || (select fee_kobo::text from public.orders where id = o));
  perform pg_temp.ck('a completed plan has no part left to pay', '0', (select count(*)::text from public.order_instalments where order_id = o and state = 'pending'));
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 6. Reminders
-- ---------------------------------------------------------------------------------------------------------------------------------
do $$
declare
  v_pat uuid := pg_temp.f('pat3'); o uuid;
begin
  o := pg_temp.mkplan(v_pat);
  perform pg_temp.pay(pg_temp.ref_of(o, 1), pg_temp.amt(o, 1));
  perform pg_temp.age_part_due(o, 2, 20); perform pg_temp.age_part_due(o, 3, 50);
  perform pg_temp.ck('no reminder while the due date is far off', '0', private.queue_instalment_reminders() || '');
  perform pg_temp.age_part_due(o, 2, 2.5);
  perform pg_temp.ck('inside 3 days a reminder is sent', '1', private.queue_instalment_reminders() || '');
  perform pg_temp.ck('a rerun sends nothing more', '0/1', private.queue_instalment_reminders() || '/' || pg_temp.notifs(v_pat, 'instalment_reminder'));
  perform pg_temp.ck('the reminder says the amount and date and names no service', 'true',
    (select (payload ->> 'when' = 'due in 3 days' and payload ? 'amount' and payload ? 'due_on' and not payload::text ilike '%member%')::text from public.notifications where recipient_id = v_pat and template = 'instalment_reminder'));
  perform pg_temp.ck('it uses the channel the patient reminder helper picks', private.patient_reminder_channel(v_pat)::text,
    (select channel::text from public.notifications where recipient_id = v_pat and template = 'instalment_reminder'));
  perform pg_temp.age_part_due(o, 2, -0.01);
  perform pg_temp.ck('on the due day the second reminder is sent', '1/2', private.queue_instalment_reminders() || '/' || pg_temp.notifs(v_pat, 'instalment_reminder'));
  perform pg_temp.ck('a rerun on the due day sends nothing more', '0/2', private.queue_instalment_reminders() || '/' || pg_temp.notifs(v_pat, 'instalment_reminder'));
  perform pg_temp.ck('a paid part is never reminded', '0',
    (select count(*)::text from public.order_instalment_reminders r where r.instalment_id = pg_temp.part(o, 1)));
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 7. Money
-- ---------------------------------------------------------------------------------------------------------------------------------
do $$
declare
  o uuid := pg_temp.f('plan_order'); p1 uuid; p2 uuid; e1 uuid; e2 uuid; v_end date; s record;
begin
  select payment_id into p1 from public.order_instalments where order_id = o and seq = 1;
  select payment_id into p2 from public.order_instalments where order_id = o and seq = 2;
  e1 := private.post_instalment_to_ledger(p1, true);
  perform pg_temp.ck('a paid part posts an entry', 'true', (e1 is not null)::text);
  perform pg_temp.ck('Dr 1020 / Cr 2000 for exactly the part', pg_temp.amt(o, 1)::text || '/' || pg_temp.amt(o, 1)::text,
    (select coalesce(sum(debit_minor) filter (where account_code = '1020'), 0)::text || '/' || coalesce(sum(credit_minor) filter (where account_code = '2000'), 0)::text
       from public.finance_journal_lines where entry_id = e1));
  perform pg_temp.ck('posting twice posts once', 'true', (private.post_instalment_to_ledger(p1, true) = e1)::text);
  select (ends_at at time zone 'Africa/Lagos')::date into v_end from public.entitlements where order_id = o;
  select * into s from public.revenue_recognition_schedules where source_kind = 'order' and source_id = p1;
  perform pg_temp.ck('the part has its own schedule, to the end of access, for the part only', pg_temp.amt(o, 1)::text || '/' || v_end::text,
    s.total_minor::text || '/' || s.period_end::text);
  perform pg_temp.ck('a second post makes no second schedule', '1', (select count(*)::text from public.revenue_recognition_schedules where source_kind = 'order' and source_id = p1));
  e2 := private.post_instalment_to_ledger(p2, true);
  perform pg_temp.ck('the second part posts its own entry', 'true', (e2 is not null and e2 <> e1)::text);
  perform pg_temp.ck('revenue is scheduled only for cash received', (pg_temp.amt(o, 1) + pg_temp.amt(o, 2))::text,
    (select sum(total_minor)::text from public.revenue_recognition_schedules where source_kind = 'order' and source_id in (p1, p2)));
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 8. Refund of a partly paid order
-- ---------------------------------------------------------------------------------------------------------------------------------
do $$
declare
  v_pat uuid := pg_temp.f('pat4'); v_admin uuid := pg_temp.f('admin'); o uuid; r text; g uuid; cl jsonb; rf record; v_total bigint;
begin
  o := pg_temp.mkplan(v_pat);
  perform pg_temp.setf('plan4', o);
  perform pg_temp.pay(pg_temp.ref_of(o, 1), pg_temp.amt(o, 1));
  r := pg_temp.q_as(v_pat, format($q$select (public.prepare_instalment_payment(%L))->>'reference'$q$, pg_temp.part(o, 2)));
  perform pg_temp.pay(r, pg_temp.amt(o, 2));
  perform private.post_instalment_to_ledger((select payment_id from public.order_instalments where order_id = o and seq = 1), true);
  perform private.post_instalment_to_ledger((select payment_id from public.order_instalments where order_id = o and seq = 2), true);
  v_total := pg_temp.amt(o, 1) + pg_temp.amt(o, 2);

  r := pg_temp.q_as(v_pat, format($q$select (public.request_order_refund(%L, 'I changed my mind about the plan'))->>'result'$q$, o));
  perform pg_temp.ck('a partly paid order can be refunded inside the window', 'requested', r);
  perform pg_temp.ck('one refund per paid part, and only the paid parts', '2/' || v_total,
    (select count(*)::text || '/' || sum(amount_kobo) from public.refunds where order_id = o));
  perform pg_temp.ck('the refunds are one group, each against its own payment', '1/2',
    (select count(distinct refund_group)::text || '/' || count(distinct payment_id) from public.refunds where order_id = o));
  perform pg_temp.ck('asking again is refused', 'already_requested',
    pg_temp.q_as(v_pat, format($q$select (public.request_order_refund(%L, 'I changed my mind about the plan'))->>'result'$q$, o)));
  perform pg_temp.ck('the patient is told once about the whole request', '1', (select count(*)::text from public.notifications where recipient_id = v_pat and template = 'order_refund_requested'));
  perform pg_temp.ck('and the message states the whole amount', 'NGN ' || to_char(v_total / 100.0, 'FM999,999,999,990.00'),
    (select payload ->> 'amount' from public.notifications where recipient_id = v_pat and template = 'order_refund_requested'));

  -- a part paid AFTER the request and before the decision is refunded too
  r := pg_temp.q_as(v_pat, format($q$select (public.prepare_instalment_payment(%L))->>'reference'$q$, pg_temp.part(o, 3)));
  perform pg_temp.pay(r, pg_temp.amt(o, 3));
  perform pg_temp.ck('a part paid while the request waits is recorded', '3', (select count(*)::text from public.payments where order_id = o and status = 'success'));

  g := (select refund_group from public.refunds where order_id = o limit 1);
  perform pg_temp.ck('a patient cannot decide', '42501', pg_temp.try_as(v_pat, format($q$select public.decide_order_refund(%L, true)$q$, g)));
  r := pg_temp.q_as(v_admin, format($q$select (public.decide_order_refund(%L, true, 'Approved inside the window'))->>'result'$q$, g));
  perform pg_temp.ck('the admin approves the group', 'approved', r);
  perform pg_temp.ck('every payment ends up with a refund of exactly what it paid', '3/10000000/3',
    (select count(*)::text || '/' || sum(amount_kobo) || '/' || count(distinct payment_id) from public.refunds where order_id = o and state = 'approved'));
  perform pg_temp.ck('the order is refunded and access ended (every part was paid, so the plan stays completed)', 'refunded/completed/revoked/false',
    (select state from public.orders where id = o) || '/' || (select state from public.order_instalment_plans where order_id = o) || '/' ||
    (select state from public.entitlements where order_id = o) || '/' || private.patient_is_member(v_pat)::text);
  perform pg_temp.ck('the approval message states the whole amount', 'NGN 100,000.00',
    (select payload ->> 'amount' from public.notifications where recipient_id = v_pat and template = 'order_refund_approved'));

  -- each refund is sent against its own charge, for its own amount
  for rf in select id, payment_id, amount_kobo from public.refunds where order_id = o order by created_at, id loop
    cl := pg_temp.svc(format($q$select public.claim_refund_for_provider(%L)::text$q$, rf.id))::jsonb;
    perform pg_temp.ck('the refund of one part is claimed against that part''s charge ' || rf.amount_kobo, 'claimed/true/' || rf.amount_kobo,
      (cl ->> 'result') || '/' || ((cl ->> 'charge_reference') = (select provider_reference from public.payments where id = rf.payment_id))::text || '/' || (cl ->> 'amount_kobo'));
    perform pg_temp.svc(format($q$select public.record_refund_provider_result(%L, true, 'rf-s25b')::text$q$, rf.id));
  end loop;
  perform pg_temp.ck('all three are completed', '3', (select count(*)::text from public.refunds where order_id = o and state = 'completed'));
  perform private.refund_catch_up();
  perform pg_temp.ck('each posted part released its own unrecognised deferred revenue', '2',
    (select count(*)::text from public.finance_journal_entries where source = 'adjustment'
        and source_ref in (select 'refund_deferred_release:' || id from public.refunds where order_id = o)));
  perform pg_temp.ck('and the part schedules are cancelled', '2', (select count(*)::text from public.revenue_recognition_schedules where source_kind = 'order' and status = 'cancelled'
        and source_id in (select payment_id from public.refunds where order_id = o)));
end $$;

-- a refund stops further charging: a payment for a part of a closed plan is not a credit
do $$
declare
  v_pat uuid := pg_temp.f('pat12'); v_admin uuid := pg_temp.f('admin'); o uuid; r text; g uuid;
begin
  o := pg_temp.mkplan(v_pat);
  perform pg_temp.pay(pg_temp.ref_of(o, 1), pg_temp.amt(o, 1));
  perform pg_temp.q_as(v_pat, format($q$select (public.request_order_refund(%L, 'I changed my mind about the plan'))->>'result'$q$, o));
  g := (select refund_group from public.refunds where order_id = o limit 1);
  perform pg_temp.q_as(v_admin, format($q$select (public.decide_order_refund(%L, true))->>'result'$q$, g));
  perform pg_temp.ck('the unpaid parts are cancelled, never charged', 'cancelled/cancelled', (select min(state) || '/' || max(state) from public.order_instalments where order_id = o and seq > 1));
  insert into public.order_instalment_attempts (reference, organisation_id, instalment_id) values ('thi_s25b_closed_plan_001', pg_temp.f('org'), pg_temp.part(o, 2));
  perform pg_temp.ck('a payment for a part of a closed plan is a mismatch, not a credit', 'mismatch', pg_temp.res(pg_temp.pay('thi_s25b_closed_plan_001', pg_temp.amt(o, 2))));
  perform pg_temp.ck('and nothing was credited', '1', (select count(*)::text from public.payments where order_id = o and status = 'success'));
  perform pg_temp.ck('a part of a closed plan cannot be prepared', 'ERR:instalment_closed', pg_temp.q_as(v_pat, format($q$select public.prepare_instalment_payment(%L)::text$q$, pg_temp.part(o, 2))));
end $$;

-- outside the window, a partly paid order cannot be refunded
do $$
declare
  v_pat uuid := pg_temp.f('pat5'); o uuid;
begin
  o := pg_temp.mkplan(v_pat);
  perform pg_temp.pay(pg_temp.ref_of(o, 1), pg_temp.amt(o, 1));
  update public.orders set paid_at = now() - interval '30 days' where id = o;
  perform pg_temp.ck('outside the window a partly paid order is not refundable', 'outside_refund_window',
    pg_temp.q_as(v_pat, format($q$select (public.request_order_refund(%L, 'It is too late but I am asking'))->>'result'$q$, o)));
  perform pg_temp.ck('and nothing was written', '0', (select count(*)::text from public.refunds where order_id = o));
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 9. A late first payment, the sweeper's view, access
-- ---------------------------------------------------------------------------------------------------------------------------------
do $$
declare
  v_pat uuid := pg_temp.f('pat6'); v_admin uuid := pg_temp.f('admin'); o uuid; ref text; a jsonb; v_list text;
begin
  o := pg_temp.mkplan(v_pat);
  ref := pg_temp.ref_of(o, 1);
  update public.order_instalment_attempts set created_at = now() - interval '5 minutes' where reference = ref;
  v_list := pg_temp.svc($q$select string_agg(reference, ',') from public.orders_needing_reconcile(200)$q$);
  perform pg_temp.ck('the sweeper lists the part reference, not the unused order reference', 'true/false',
    (v_list like '%' || ref || '%')::text || '/' || (v_list like '%' || (select paystack_reference from public.orders where id = o) || '%')::text);
  perform pg_temp.ck('the sweeper closes an expired first part', 'true',
    pg_temp.svc(format($q$select public.close_unpaid_order(%L, 'expired')::text$q$, ref)));
  perform pg_temp.ck('which cancels the order and the plan', 'cancelled/cancelled/cancelled',
    (select state from public.orders where id = o) || '/' || (select state from public.order_instalment_plans where order_id = o) || '/' || (select min(state) from public.order_instalments where order_id = o and seq > 1));
  a := pg_temp.pay(ref, pg_temp.amt(o, 1));
  perform pg_temp.ck('a verified payment that arrives late is honoured', 'paid', pg_temp.res(a));
  perform pg_temp.ck('the order is paid, the plan alive and the other parts due again', 'paid/active/pending/true',
    (select state from public.orders where id = o) || '/' || (select state from public.order_instalment_plans where order_id = o) || '/' ||
    (select min(state) from public.order_instalments where order_id = o and seq > 1) || '/' || private.patient_is_member(v_pat)::text);
  perform pg_temp.ck('and a person is told about the late payment', '1', (select count(*)::text from public.ops_incidents where external_reference = 'order-late-payment:' || o));
  perform pg_temp.ck('the return page reads the part by its reference and says paid', 'paid',
    pg_temp.q_as(v_pat, format($q$select public.order_for_checkout(%L)->>'state'$q$, ref)));
  perform pg_temp.ck('another patient cannot read it', 'null', coalesce(pg_temp.q_as(pg_temp.f('other'), format($q$select public.order_for_checkout(%L)::text$q$, ref)), 'null'));

  perform pg_temp.ck('my plans lists the plan with its parts and the next one to pay', '3/' || pg_temp.amt(o, 1)::text || '/true',
    pg_temp.q_as(v_pat, format($q$select (p->>'parts') || '/' || (p->'instalments'->0->>'amount_kobo') || '/' || ((p->>'next_instalment_id') = %L)::text from jsonb_array_elements(public.my_instalment_plans()) p where p->>'order_id' = %L$q$, pg_temp.part(o, 2)::text, o::text)));
  perform pg_temp.ck('another patient sees no plans', '[]', pg_temp.q_as(pg_temp.f('other'), 'select public.my_instalment_plans()::text'));
  perform pg_temp.ck('the admin overview answers', 'true', pg_temp.q_as(v_admin, $q$select ((public.admin_instalment_overview()->'plans') is not null)::text$q$));
  perform pg_temp.ck('a patient cannot read the admin overview', '42501', pg_temp.try_as(v_pat, 'select public.admin_instalment_overview()'));

  perform pg_temp.ck('a patient cannot write a plan', '42501', pg_temp.try_as(v_pat, format($q$update public.order_instalment_plans set state = 'completed' where order_id = %L$q$, o)));
  perform pg_temp.ck('a patient cannot write a part', '42501', pg_temp.try_as(v_pat, format($q$update public.order_instalments set amount_kobo = 1 where order_id = %L$q$, o)));
  perform pg_temp.ck('a patient cannot read the attempts table', '42501', pg_temp.try_as(v_pat, 'select * from public.order_instalment_attempts'));
  perform pg_temp.ck('a part''s amount never changes', 'true', (pg_temp.try_sql(format($q$update public.order_instalments set amount_kobo = 1 where order_id = %L$q$, o)) like 'instalment_immutable%')::text);
  perform pg_temp.ck('a part is never deleted', 'true', (pg_temp.try_sql(format($q$delete from public.order_instalments where order_id = %L$q$, o)) like 'instalment_immutable%')::text);
  perform pg_temp.ck('a paid part cannot go back to pending', 'true', (pg_temp.try_sql(format($q$update public.order_instalments set state = 'pending' where id = %L$q$, pg_temp.part(o, 1))) like 'instalment_bad_transition%')::text);
  perform pg_temp.ck('anon holds no instalment function', 'false/false/false/false/false',
    has_function_privilege('anon', 'public.create_instalment_order(text, uuid, integer)', 'EXECUTE')::text || '/' ||
    has_function_privilege('anon', 'public.prepare_instalment_payment(uuid)', 'EXECUTE')::text || '/' ||
    has_function_privilege('anon', 'public.my_instalment_plans()', 'EXECUTE')::text || '/' ||
    has_function_privilege('anon', 'public.admin_instalment_overview()', 'EXECUTE')::text || '/' ||
    has_function_privilege('authenticated', 'private.sweep_instalment_lapses()', 'EXECUTE')::text);
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 9b. Found in review: the order's own reference, closing paths, a lapse that did not end the entitlement, group notices, reconcile, catch-up
-- ---------------------------------------------------------------------------------------------------------------------------------
do $$
declare
  v_pat uuid := pg_temp.f('pat14'); o uuid; o2 uuid; ordref text; r text; k uuid; ref1 text;
begin
  -- a charge on the plan order's own reference (it was never offered to Paystack) is never a paid order
  o := pg_temp.mkplan(v_pat);
  ordref := (select paystack_reference from public.orders where id = o);
  perform pg_temp.ck('a charge on a plan order''s own reference is a mismatch, never a paid order', 'mismatch/created/0',
    pg_temp.res(pg_temp.pay(ordref, 10000000)) || '/' || (select state from public.orders where id = o) || '/' || (select count(*)::text from public.entitlements where order_id = o));
  perform pg_temp.ck('and a person is told', 'true', (select (count(*) >= 1)::text from public.ops_incidents where external_reference = 'order-mismatch:' || o));

  -- cancelling an unpaid plan order closes the plan, its parts and its attempts, and nothing can then be paid
  k := (select client_key from public.orders where id = o);
  perform pg_temp.ck('the patient cancels the unpaid plan order', 'true', pg_temp.q_as(v_pat, format($q$select public.cancel_order(%L)::text$q$, o)));
  perform pg_temp.ck('which cancels the plan, every part and every open attempt', 'cancelled/cancelled/cancelled/0',
    (select state from public.order_instalment_plans where order_id = o) || '/' || (select min(state) from public.order_instalments where order_id = o) || '/' ||
    (select max(state) from public.order_instalments where order_id = o) || '/' ||
    (select count(*)::text from public.order_instalment_attempts a join public.order_instalments i on i.id = a.instalment_id where i.order_id = o and a.state = 'open'));
  perform pg_temp.ck('a part of a cancelled order cannot be prepared', 'ERR:instalment_closed', pg_temp.q_as(v_pat, format($q$select public.prepare_instalment_payment(%L)::text$q$, pg_temp.part(o, 1))));
  r := pg_temp.q_as(v_pat, format($q$select public.create_instalment_order('s25b_member', %L, 3)::text$q$, k));
  perform pg_temp.ck('a retry of a closed plan answers with a reference and the order''s state, not an error', 'true/cancelled',
    ((r::jsonb ->> 'reference') like 'thi_%')::text || '/' || (r::jsonb ->> 'state'));

  -- a failed first part closes the plan too (the patient starts again with a new one); a late verified payment still revives it
  o2 := pg_temp.mkplan(v_pat);
  ref1 := pg_temp.ref_of(o2, 1);
  perform pg_temp.svc(format($q$select public.close_unpaid_order(%L, 'abandoned')::text$q$, ref1));
  perform pg_temp.ck('an abandoned first part closes the order and the plan together', 'failed/cancelled/cancelled',
    (select state from public.orders where id = o2) || '/' || (select state from public.order_instalment_plans where order_id = o2) || '/' || (select min(state) from public.order_instalments where order_id = o2));
  r := pg_temp.res(pg_temp.pay(ref1, pg_temp.amt(o2, 1)));
  perform pg_temp.ck('and a verified late payment on it is still honoured', 'paid/active',
    r || '/' || (select state from public.order_instalment_plans where order_id = o2));
end $$;

-- a reference already recorded as paid is a replay for the sweeper's mismatch call, not a new problem
do $$
declare o uuid := pg_temp.f('plan_order'); ref1 text; before_n bigint;
begin
  select a.reference into ref1 from public.order_instalment_attempts a join public.order_instalments i on i.id = a.instalment_id where i.order_id = o and i.seq = 1;
  select count(*) into before_n from public.payments where order_id = o and status = 'mismatch';
  perform pg_temp.ck('a mismatch call for a part that is already paid is a replay', 'replay/true',
    pg_temp.res(pg_temp.svc(format($q$select public.flag_order_payment_mismatch(%L, 'fee', 1, 1, 'sweep')::text$q$, ref1))::jsonb) || '/' ||
    ((select count(*) from public.payments where order_id = o and status = 'mismatch') = before_n)::text);
end $$;

-- a restore reopens only what the lapse closed
do $$
declare
  v_pat uuid := pg_temp.f('pat15'); o uuid; r text; a jsonb; n integer;
begin
  o := pg_temp.mkplan(v_pat);
  perform pg_temp.pay(pg_temp.ref_of(o, 1), pg_temp.amt(o, 1));
  update public.entitlements set state = 'revoked' where order_id = o;   -- closed for some other reason before the lapse
  perform pg_temp.age_part_due(o, 2, -7);
  n := private.sweep_instalment_lapses();
  perform pg_temp.ck('a plan whose entitlement was already closed lapses without claiming it', 'lapsed/false',
    (select state || '/' || lapse_revoked::text from public.order_instalment_plans where order_id = o));
  r := pg_temp.q_as(v_pat, format($q$select (public.prepare_instalment_payment(%L))->>'reference'$q$, pg_temp.part(o, 2)));
  a := pg_temp.pay(r, pg_temp.amt(o, 2));
  perform pg_temp.ck('paying the overdue part does not reopen an entitlement the lapse did not close', 'paid/revoked/false',
    pg_temp.res(a) || '/' || (select state from public.entitlements where order_id = o) || '/' || private.patient_is_member(v_pat)::text);
  perform pg_temp.ck('a plan whose entitlement the lapse closed remembers it', 'true',
    (select lapse_revoked::text from public.order_instalment_plans where order_id = pg_temp.f('plan_order')));
end $$;

-- a refund of several parts is one refund to the patient: told complete only when every part is, told at once when one fails; reconcile uses each part's own charge
do $$
declare
  v_pat uuid := pg_temp.f('pat16'); v_admin uuid := pg_temp.f('admin'); o uuid; r text; g uuid; ids uuid[]; v_pay1 text; v_pay2 text; rid2 uuid;
begin
  o := pg_temp.mkplan(v_pat);
  perform pg_temp.pay(pg_temp.ref_of(o, 1), pg_temp.amt(o, 1));
  r := pg_temp.q_as(v_pat, format($q$select (public.prepare_instalment_payment(%L))->>'reference'$q$, pg_temp.part(o, 2)));
  perform pg_temp.pay(r, pg_temp.amt(o, 2));
  perform pg_temp.q_as(v_pat, format($q$select (public.request_order_refund(%L, 'I changed my mind about the plan'))->>'result'$q$, o));
  g := (select refund_group from public.refunds where order_id = o limit 1);
  perform pg_temp.q_as(v_admin, format($q$select (public.decide_order_refund(%L, true))->>'result'$q$, g));
  update public.refunds set is_test = false where order_id = o;
  select array_agg(id order by (id = g) desc, id) into ids from public.refunds where order_id = o;
  rid2 := ids[2];
  select p.provider_reference into v_pay2 from public.refunds rf join public.payments p on p.id = rf.payment_id where rf.id = rid2;
  perform pg_temp.svc(format($q$select public.claim_refund_for_provider(%L)::text$q$, ids[1]));
  perform pg_temp.svc(format($q$select public.claim_refund_for_provider(%L)::text$q$, ids[2]));
  perform pg_temp.ck('the reconcile list checks each part against its own charge', v_pay2,
    pg_temp.svc(format($q$select charge_reference from public.refunds_needing_reconcile(500) where id = %L$q$, rid2)));
  perform pg_temp.svc(format($q$select public.record_refund_provider_result(%L, true, 'rf-a')::text$q$, ids[1]));
  perform pg_temp.ck('one part sent is not "your refund has been sent"', '0', (select count(*)::text from public.notifications where recipient_id = v_pat and template = 'order_refund_completed'));
  perform pg_temp.svc(format($q$select public.record_refund_provider_result(%L, false, '', '{"error_code":"insufficient_balance"}'::jsonb)::text$q$, ids[2]));
  perform pg_temp.ck('a part that fails is told from its own row, under the group', '1/true',
    (select count(*)::text from public.notifications where recipient_id = v_pat and template = 'order_refund_problem') || '/' ||
    (select exists (select 1 from public.refund_status_events where refund_id = g and step = 'problem')::text));
  perform pg_temp.ck('the failed part is back in the queue after an admin retries it', 'requeued',
    (pg_temp.q_as(v_admin, format($q$select public.retry_failed_refund(%L)->>'result'$q$, ids[2]))));
  perform pg_temp.ck('and the patient is told it is being retried', 'true', (select exists (select 1 from public.refund_status_events where refund_id = g and step = 'retrying')::text));
  perform pg_temp.svc(format($q$select public.claim_refund_for_provider(%L)::text$q$, ids[2]));
  perform pg_temp.svc(format($q$select public.record_refund_provider_result(%L, true, 'rf-b')::text$q$, ids[2]));
  perform pg_temp.ck('the whole refund is told complete once, when the last part is sent, for the whole amount', '1/NGN ' || to_char((pg_temp.amt(o, 1) + pg_temp.amt(o, 2)) / 100.0, 'FM999,999,999,990.00'),
    (select count(*)::text || '/' || max(payload ->> 'amount') from public.notifications where recipient_id = v_pat and template = 'order_refund_completed'));
end $$;

-- the hourly order catch-up leaves plan orders to their parts
do $$
declare n integer; n_expected integer;
begin
  select count(*) into n_expected from (
    select o.id from public.orders o
     where o.state in ('paid', 'refunded')
       and not exists (select 1 from public.order_instalment_plans pl where pl.order_id = o.id)
       and not exists (select 1 from public.finance_journal_entries e where e.source = 'payment' and e.source_ref = 'order:' || o.id)
     order by o.paid_at limit 200) x;
  perform pg_temp.ck('plan orders exist that have no full-price entry', 'true',
    (exists (select 1 from public.orders o join public.order_instalment_plans pl on pl.order_id = o.id where o.state = 'paid'))::text);
  n := private.post_unposted_orders(true);
  perform pg_temp.ck('the hourly catch-up counts only ordinary orders, never plan orders', n_expected::text, n::text);
  perform pg_temp.ck('a part that cannot be posted is not counted as done', 'null',
    coalesce(private.post_instalment_to_ledger(gen_random_uuid(), true)::text, 'null'));
  perform pg_temp.ck('the safe wrapper says false for it', 'false', private.post_instalment_safely(gen_random_uuid())::text);
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 10. SABOTAGE: each safeguard removed in turn; the check that guards it must flip
-- ---------------------------------------------------------------------------------------------------------------------------------
do $$
declare
  o uuid; ref text; v_def text; v_new text;
begin
  -- (a) the part routing removed from record_order_payment: a part reference is no longer recognised
  o := pg_temp.mkplan(pg_temp.f('pat8'));
  ref := pg_temp.ref_of(o, 1);
  v_def := pg_get_functiondef('public.record_order_payment(text, bigint, bigint, bigint, text, text, text, text, timestamptz, jsonb, bigint)'::regprocedure);
  v_new := replace(v_def, 'v_part := private.record_instalment_payment(', 'v_part := null; -- ');
  if v_new = v_def then raise exception 'VACUOUS: the routing line was not found in the definition'; end if;
  execute v_new;
  insert into results values ('sabotaged', 'routing: a first part is recorded as paid', 'paid', coalesce(pg_temp.res(pg_temp.pay(ref, pg_temp.amt(o, 1))), 'none'));
  execute v_def;
end $$;

do $$
declare
  o uuid;
begin
  -- (c) the lapse sweep emptied: an overdue plan stays active
  o := pg_temp.mkplan(pg_temp.f('pat10'));
  perform pg_temp.pay(pg_temp.ref_of(o, 1), pg_temp.amt(o, 1));
  perform pg_temp.age_part_due(o, 2, -9);
  create or replace function private.sweep_instalment_lapses() returns integer language sql set search_path = '' as $f$ select 0 $f$;
  perform private.sweep_instalment_lapses();
  insert into results values ('sabotaged', 'lapse: an overdue plan lapses', 'lapsed', (select state from public.order_instalment_plans where order_id = o));
end $$;

do $$
begin
  -- (d) the sum trigger switched off: parts that do not add up are accepted
  set constraints all immediate;   -- settle every pending deferred check first (ALTER TABLE refuses while some are queued)
  set constraints all deferred;
  alter table public.order_instalments disable trigger order_instalments_sum_check;
  insert into results values ('sabotaged', 'sum: parts that do not add up are refused', 'true', (pg_temp.sum_probe(299) like 'instalment_sum_mismatch%')::text);
  alter table public.order_instalments enable trigger order_instalments_sum_check;
end $$;

do $$
declare
  o uuid; r text; g uuid; v_def text; v_new text;
begin
  -- (e) the refund claim made to ignore the part: both refunds are sent against the same charge
  o := pg_temp.mkplan(pg_temp.f('pat11'));
  perform pg_temp.pay(pg_temp.ref_of(o, 1), pg_temp.amt(o, 1));
  r := pg_temp.q_as(pg_temp.f('pat11'), format($q$select (public.prepare_instalment_payment(%L))->>'reference'$q$, pg_temp.part(o, 2)));
  perform pg_temp.pay(r, pg_temp.amt(o, 2));
  perform pg_temp.q_as(pg_temp.f('pat11'), format($q$select (public.request_order_refund(%L, 'I changed my mind about the plan'))->>'result'$q$, o));
  g := (select refund_group from public.refunds where order_id = o limit 1);
  perform pg_temp.q_as(pg_temp.f('admin'), format($q$select (public.decide_order_refund(%L, true))->>'result'$q$, g));
  v_def := pg_get_functiondef('public.claim_refund_for_provider(uuid)'::regprocedure);
  v_new := replace(v_def, 'and (r.payment_id is null or p.id = r.payment_id)', '');
  if v_new = v_def then raise exception 'VACUOUS: the claim filter was not found'; end if;
  execute v_new;
  insert into results values ('sabotaged', 'refund: each part is refunded against its own charge', '2',
    (select count(distinct pg_temp.svc(format($q$select (public.claim_refund_for_provider(%L)::jsonb ->> 'charge_reference')$q$, x.id)))::text
       from (select id from public.refunds where order_id = o) x));
end $$;

do $$
declare
  o uuid; ref text; v_def text; v_new text;
begin
  -- (b) the replay guards removed: the same payment credits twice. Done last because it drops the unique index and the transaction is
  -- rolled back anyway.
  o := pg_temp.mkplan(pg_temp.f('pat9'));
  ref := pg_temp.ref_of(o, 1);
  v_def := pg_get_functiondef('private.record_instalment_payment(text, bigint, bigint, bigint, text, text, text, text, timestamptz, jsonb, bigint)'::regprocedure);
  v_new := replace(replace(replace(v_def,
      'if exists (select 1 from public.payments where provider = ''paystack'' and provider_reference = p_ref and status = ''success'') then', 'if false then'),
      'if i.state = ''paid'' then v_reason := ''duplicate_part'';', 'if false then v_reason := ''duplicate_part'';'),
      'on conflict (provider, provider_reference) where status = ''success'' do nothing', '');
  if v_new = v_def then raise exception 'VACUOUS: no replay guard was found'; end if;
  drop index public.payments_one_success;
  execute v_new;
  perform pg_temp.pay(ref, pg_temp.amt(o, 1));
  perform pg_temp.pay(ref, pg_temp.amt(o, 1));
  insert into results values ('sabotaged', 'replay: one payment row per reference', '1',
    (select count(*)::text from public.payments where provider_reference = ref and status = 'success'));
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S25b proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ')
         from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 5 then
    raise exception 'VACUOUS TEST: the sabotage flipped % of 5 checks: %', v_caught,
      (select string_agg(check_name || ' => ' || actual, '; ') from results where phase = 'sabotaged');
  end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;

rollback;
