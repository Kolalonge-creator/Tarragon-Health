-- WP1b proof: points spent on an order come back when it is refunded, in proportion to the money refunded, exactly once
-- (migration *_wp1b_points_return_on_refund_proportional.sql; builds on S58b's full-refund branch).
-- Proves in one rolled-back transaction:
--   * a full refund (through a refund row, as the approval function does) returns exactly what was spent, once, with a 'release' ledger row keyed to the refund
--   * a partial refund returns floor(spent * refunded / charged), not more; the order flipping to 'refunded' afterwards adds nothing
--   * replaying the same refund is a no-op; a second refund of the rest returns only what is still outstanding; a third returns nothing
--   * rounding is down (5 points spent, a third refunded: 1 point back)
--   * a route that flips an order to 'refunded' with no refund row still gets the full return (S58b behaviour kept), once
--   * an order that spent nothing, and a rejected refund, return nothing
--   * a points failure never blocks approving a refund; it is logged with the organisation
--   * ledger only: the balance table holds no kobo column; the helper functions cannot be called by a signed-in user
-- SABOTAGE: the refund hook dropped, the proportional rule removed, and the "no refund row" guard removed; each check must flip.
begin;

create temp table results(n serial, phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
grant all on results_n_seq to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;
create function pg_temp.f(p text) returns uuid language sql as $$ select v from fx where k = p $$;
create function pg_temp.setf(p text, p_v uuid) returns void language sql as $$ insert into fx values (p, p_v) on conflict (k) do update set v = excluded.v $$;
create function pg_temp.ck(p_name text, p_expected text, p_actual text) returns void language sql as $$ insert into results(phase, check_name, expected, actual) values ('real', p_name, p_expected, p_actual) $$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'wp1b-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, is_test)
  values (v, p_org, p_role::public.user_role, 'WP1b ' || p_label, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true;
  update public.profiles set date_of_birth = current_date - interval '35 years' where id = v;
  return v;
end $f$;
create function pg_temp.bal(p uuid) returns integer language sql as $$ select coalesce((select balance from public.wellness_points_balances where patient_id = p), 0) $$;
create function pg_temp.back(p uuid) returns integer language sql as
$$ select coalesce((select sum(points)::integer from public.wellness_points_ledger where patient_id = p and reason = 'order_refunded' and kind = 'release'), 0) $$;
-- a paid order that charged 475,000 kobo and spent p_points points (the balance is given first so the payment can spend them)
create function pg_temp.paid_order(p_org uuid, p_buyer uuid, p_points integer, p_ref text, p_balance integer default 1000) returns uuid language plpgsql as $f$
declare v_item uuid := gen_random_uuid(); v_price uuid := gen_random_uuid(); v_o uuid := gen_random_uuid();
begin
  insert into public.wellness_points_balances (patient_id, organisation_id, balance, lifetime_earned) values (p_buyer, p_org, p_balance, p_balance)
  on conflict (patient_id) do update set balance = p_balance, lifetime_earned = p_balance;
  insert into public.catalog_items (id, organisation_id, code, kind, name_key, description_key, uses)
  values (v_item, p_org, 'wp1b_' || substr(replace(v_item::text, '-', ''), 1, 12), 'consultation', 'n', 'd', 1);
  insert into public.prices (id, organisation_id, catalog_item_id, amount_kobo) values (v_price, p_org, v_item, 475000);
  insert into public.orders (id, organisation_id, buyer_profile_id, beneficiary_patient_id, catalog_item_id, price_id, amount_kobo, list_amount_kobo,
                             points_applied, points_reduction_kobo, paystack_reference, is_test)
  values (v_o, p_org, p_buyer, p_buyer, v_item, v_price, 475000, case when p_points > 0 then 500000 else 475000 end, p_points, case when p_points > 0 then 25000 else 0 end, 'wp1b-ref-' || p_ref, true);
  update public.orders set state = 'paid', paid_at = now(), fee_kobo = 0, total_kobo = amount_kobo where id = v_o;
  return v_o;
end $f$;
-- a refund row for an order, approved the way the approval function does it: the refund first, then the order
create function pg_temp.refund(p_order uuid, p_amount bigint, p_admin uuid, p_approve boolean default true, p_flip_order boolean default true) returns uuid language plpgsql as $f$
declare v_org uuid; v_r uuid := gen_random_uuid();
begin
  select organisation_id into v_org from public.orders where id = p_order;
  insert into public.refunds (id, organisation_id, order_id, amount_kobo, reason, requested_by, is_test) values (v_r, v_org, p_order, p_amount, 'Proof refund', p_admin, true);
  if p_approve then
    update public.refunds set state = 'approved', decided_by = p_admin, decided_at = now() where id = v_r;
    if p_flip_order then update public.orders set state = 'refunded' where id = p_order; end if;
  else
    update public.refunds set state = 'rejected', decided_by = p_admin, decided_at = now() where id = v_r;
  end if;
  return v_r;
end $f$;

do $$
declare
  v_org uuid; v_admin uuid; v_a uuid; v_b uuid; v_c uuid; v_d uuid; v_e uuid; v_g uuid; v_o uuid; v_r uuid; v_r2 uuid; v_n integer;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  v_a := pg_temp.mkuser(v_org, 'a', 'patient'); v_b := pg_temp.mkuser(v_org, 'b', 'patient'); v_c := pg_temp.mkuser(v_org, 'c', 'patient');
  v_d := pg_temp.mkuser(v_org, 'd', 'patient'); v_e := pg_temp.mkuser(v_org, 'e', 'patient'); v_g := pg_temp.mkuser(v_org, 'g', 'patient');
  perform pg_temp.setf('org', v_org); perform pg_temp.setf('admin', v_admin); perform pg_temp.setf('b', v_b);

  -- the pure rule
  perform pg_temp.ck('rule: a full refund returns everything', '500', private.points_return_for_refund(500, 475000, 475000)::text);
  perform pg_temp.ck('rule: a quarter refund returns a quarter', '125', private.points_return_for_refund(500, 118750, 475000)::text);
  perform pg_temp.ck('rule: rounding is down', '1', private.points_return_for_refund(5, 158333, 475000)::text);
  perform pg_temp.ck('rule: a refund above the charge cannot return more than was spent', '500', private.points_return_for_refund(500, 9999999, 475000)::text);
  perform pg_temp.ck('rule: nothing spent or nothing refunded returns nothing', '0|0|0', private.points_return_for_refund(0, 1, 1) || '|' || private.points_return_for_refund(5, 0, 10) || '|' || private.points_return_for_refund(5, 1, 0));

  -- A. a full refund through a refund row
  v_o := pg_temp.paid_order(v_org, v_a, 500, 'WP1B-A');
  perform pg_temp.ck('A payment spent the points once', '500', pg_temp.bal(v_a)::text);
  v_r := pg_temp.refund(v_o, 475000, v_admin);
  perform pg_temp.ck('A a full refund returns exactly what was spent', '1000', pg_temp.bal(v_a)::text);
  perform pg_temp.ck('A and it is one release row keyed to the refund, not to the order', '1|0',
    (select count(*) from public.wellness_points_ledger where patient_id = v_a and source_table = 'refunds' and source_id = v_r and reason = 'order_refunded' and kind = 'release' and points = 500)
    || '|' || (select count(*) from public.wellness_points_ledger where patient_id = v_a and source_table = 'orders' and reason = 'order_refunded'));
  perform pg_temp.ck('A lifetime earned is not changed by the return', '1000', (select lifetime_earned::text from public.wellness_points_balances where patient_id = v_a));
  perform pg_temp.ck('A replaying the same refund return is a no-op', '0|1000', private.return_points_for_order(v_o, 'refunds', v_r, 475000)::text || '|' || pg_temp.bal(v_a)::text);

  -- B. a partial refund of a quarter, then the rest in two steps
  v_o := pg_temp.paid_order(v_org, v_b, 500, 'WP1B-B');
  v_r := pg_temp.refund(v_o, 118750, v_admin);
  perform pg_temp.ck('B a quarter refund returns a quarter of the points', '125', pg_temp.back(v_b)::text);
  perform pg_temp.ck('B the order flipping to refunded afterwards added nothing (a refund row exists)', '625', pg_temp.bal(v_b)::text);
  perform pg_temp.ck('B replaying that refund returns nothing more', '0|125', private.return_points_for_order(v_o, 'refunds', v_r, 118750)::text || '|' || pg_temp.back(v_b)::text);
  -- the first refund failed at the provider, so a second, real refund row for the other three quarters can be made (one live refund per order)
  update public.refunds set state = 'failed' where id = v_r;
  v_r2 := pg_temp.refund(v_o, 356250, v_admin, true, false);
  perform pg_temp.ck('B a second refund of the other three quarters returns only what is outstanding (375)', '375',
    (select points::text from public.wellness_points_ledger where source_table = 'refunds' and source_id = v_r2 and reason = 'order_refunded'));
  perform pg_temp.ck('B the total returned is exactly what was spent', '500|1000', pg_temp.back(v_b)::text || '|' || pg_temp.bal(v_b)::text);
  update public.refunds set state = 'failed' where id = v_r2;
  v_r2 := pg_temp.refund(v_o, 475000, v_admin, true, false);
  perform pg_temp.ck('B a third refund finds nothing outstanding', '0|500|1000',
    (select count(*)::text from public.wellness_points_ledger where source_table = 'refunds' and source_id = v_r2) || '|' || pg_temp.back(v_b)::text || '|' || pg_temp.bal(v_b)::text);

  -- C. rounding down
  v_o := pg_temp.paid_order(v_org, v_c, 5, 'WP1B-C');
  perform pg_temp.refund(v_o, 158333, v_admin, true, false);
  perform pg_temp.ck('C a third refunded of 5 points returns 1', '1', pg_temp.back(v_c)::text);

  -- D. a route that flips the order with no refund row keeps the full return, once
  v_o := pg_temp.paid_order(v_org, v_d, 500, 'WP1B-D');
  update public.orders set state = 'refunded' where id = v_o;
  perform pg_temp.ck('D no refund row: the order flip returns everything spent', '500|1000', pg_temp.back(v_d)::text || '|' || pg_temp.bal(v_d)::text);
  perform pg_temp.ck('D a refund row approved afterwards for that order adds nothing', '0',
    private.return_points_for_order(v_o, 'refunds', gen_random_uuid(), 475000)::text);

  -- E. nothing spent, and a rejected refund
  v_o := pg_temp.paid_order(v_org, v_e, 0, 'WP1B-E', 300);
  perform pg_temp.refund(v_o, 475000, v_admin);
  perform pg_temp.ck('E an order that spent nothing returns nothing', '0|300', pg_temp.back(v_e)::text || '|' || pg_temp.bal(v_e)::text);
  v_o := pg_temp.paid_order(v_org, v_g, 500, 'WP1B-G');
  perform pg_temp.refund(v_o, 475000, v_admin, false);
  perform pg_temp.ck('E a rejected refund returns nothing', '0|500', pg_temp.back(v_g)::text || '|' || pg_temp.bal(v_g)::text);
end $$;

-- F. a points failure never blocks a refund, and is logged with the organisation
do $$
declare v_org uuid := pg_temp.f('org'); v_admin uuid := pg_temp.f('admin'); v_h uuid := pg_temp.mkuser(pg_temp.f('org'), 'h', 'patient'); v_o uuid; v_r uuid; v_before integer;
begin
  create function pg_temp.refuse_ledger() returns trigger language plpgsql as $f$ begin raise exception 'ledger_write_blocked'; end $f$;
  create trigger wp1b_refuse_ledger before insert on public.wellness_points_ledger for each row when (new.reason = 'order_refunded') execute function pg_temp.refuse_ledger();
  select count(*) into v_before from public.audit_log where action = 'refund_points_return.error';
  v_o := pg_temp.paid_order(v_org, v_h, 500, 'WP1B-H');
  v_r := pg_temp.refund(v_o, 475000, v_admin);
  perform pg_temp.ck('F the refund is approved even though the points could not be returned', 'approved', (select state from public.refunds where id = v_r));
  perform pg_temp.ck('F the order is refunded', 'refunded', (select state::text from public.orders where id = v_o));
  perform pg_temp.ck('F the failure is recorded with the organisation', (v_before + 1)::text || '|' || v_org::text,
    (select count(*)::text from public.audit_log where action = 'refund_points_return.error') || '|' || (select organisation_id::text from public.audit_log where action = 'refund_points_return.error' order by created_at desc limit 1));
  perform pg_temp.ck('F no points came back (they can be returned by hand from the ledger)', '500', pg_temp.bal(v_h)::text);
  drop trigger wp1b_refuse_ledger on public.wellness_points_ledger;
end $$;

-- G. ledger only, and the helpers are private
do $$
begin
  perform pg_temp.ck('G the balance table holds no kobo column (INV-09)', '0',
    (select count(*)::text from information_schema.columns where table_schema = 'public' and table_name = 'wellness_points_balances' and column_name like '%kobo%'));
  perform pg_temp.ck('G a signed-in user cannot call the helpers', 'false|false|false',
    has_function_privilege('authenticated', 'private.return_points_for_order(uuid,text,uuid,bigint)', 'EXECUTE')::text || '|' ||
    has_function_privilege('authenticated', 'private.return_points_on_refund_approved()', 'EXECUTE')::text || '|' ||
    has_function_privilege('anon', 'private.points_return_for_refund(integer,bigint,bigint)', 'EXECUTE')::text);
  perform pg_temp.ck('G the points switch and values are untouched', 'false|100|5000|5',
    (select (rules -> 'points' ->> 'enabled') || '|' || (rules -> 'points' ->> 'points_per_step') || '|' || (rules -> 'points' ->> 'reduction_per_step_kobo') || '|' || (rules -> 'points' ->> 'max_steps_per_order')
       from public.pricing_config where is_active));
end $$;

-- SABOTAGE: three protections removed; each check must flip ---------------------------------------------------------------------------
-- (a) the refund hook dropped: a partial refund returns nothing
drop trigger refunds_return_points on public.refunds;
-- (b) the proportional rule removed: everything comes back whatever was refunded
create or replace function private.points_return_for_refund(p_spent integer, p_refund_kobo bigint, p_order_kobo bigint) returns integer language sql immutable set search_path = '' as $f$ select greatest(coalesce(p_spent, 0), 0) $f$;
do $$
declare v_org uuid := pg_temp.f('org'); v_admin uuid := pg_temp.f('admin'); v_p uuid := pg_temp.mkuser(pg_temp.f('org'), 'sab1', 'patient'); v_o uuid;
begin
  v_o := pg_temp.paid_order(v_org, v_p, 500, 'WP1B-SAB1');
  perform pg_temp.refund(v_o, 118750, v_admin, true, false);
  insert into results(phase, check_name, expected, actual) values ('sabotaged', 'a quarter refund returns a quarter of the points (hook and rule intact)', '125', pg_temp.back(v_p)::text);
end $$;
-- put the hook back with the rule still broken: now the full amount comes back for a quarter refund
create trigger refunds_return_points after update of state on public.refunds
  for each row when (old.state = 'pending' and new.state = 'approved') execute function private.return_points_on_refund_approved();
do $$
declare v_org uuid := pg_temp.f('org'); v_admin uuid := pg_temp.f('admin'); v_p uuid := pg_temp.mkuser(pg_temp.f('org'), 'sab2', 'patient'); v_o uuid;
begin
  v_o := pg_temp.paid_order(v_org, v_p, 500, 'WP1B-SAB2');
  perform pg_temp.refund(v_o, 118750, v_admin, true, false);
  insert into results(phase, check_name, expected, actual) values ('sabotaged', 'a quarter refund does not return all the points', '125', pg_temp.back(v_p)::text);
end $$;
-- (c) the "no refund row" guard removed from the order branch: a partial refund that flips the order returns the lot
do $$
declare v_def text := pg_get_functiondef('private.orders_pricing_effects()'::regprocedure);
begin
  v_def := replace(v_def, 'if not exists (select 1 from public.refunds r where r.order_id = new.id) then', 'if true then');
  execute v_def;
end $$;
create or replace function private.points_return_for_refund(p_spent integer, p_refund_kobo bigint, p_order_kobo bigint) returns integer language sql immutable set search_path = '' as $f$
  select case when coalesce(p_spent, 0) <= 0 or coalesce(p_refund_kobo, 0) <= 0 or coalesce(p_order_kobo, 0) <= 0 then 0 else ((p_spent::bigint * least(p_refund_kobo, p_order_kobo)) / p_order_kobo)::integer end $f$;
do $$
declare v_org uuid := pg_temp.f('org'); v_admin uuid := pg_temp.f('admin'); v_p uuid := pg_temp.mkuser(pg_temp.f('org'), 'sab3', 'patient'); v_o uuid;
begin
  v_o := pg_temp.paid_order(v_org, v_p, 500, 'WP1B-SAB3');
  perform pg_temp.refund(v_o, 118750, v_admin, true, true);
  insert into results(phase, check_name, expected, actual) values ('sabotaged', 'the order flipping after a partial refund adds nothing', '125', pg_temp.back(v_p)::text);
end $$;

do $$
declare v_bad integer; v_caught integer; v_real integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'WP1b proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_real from results where phase = 'real';
  if v_real < 28 then raise exception 'VACUOUS TEST: only % checks ran', v_real; end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 3 then raise exception 'VACUOUS TEST: the sabotage flipped % of 3 checks', v_caught; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result from results where phase = 'real' order by n;
select phase, check_name, expected, actual, case when expected = actual then 'NOT FLIPPED' else 'FLIPPED' end as result from results where phase = 'sabotaged' order by n;

rollback;
