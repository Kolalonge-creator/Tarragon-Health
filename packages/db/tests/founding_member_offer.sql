-- Founding member offer proof (migration *_founding_member_offer.sql).
-- Proves in one rolled-back transaction:
--   * a code's badge is part of what it gives: set at creation through admin_create_discount_code (the old 12-argument calls still
--     resolve, to the one remaining signature), immutable afterwards, only 'founding_member' allowed, one live founding code at a time
--   * founding_offer_status: anon and authenticated can read it; it returns only open, places_total, places_left, and while open the
--     code and its percent; nothing when there is no offer; a test admin's code is never the public offer; a place is taken only by
--     a redeemed use (a paid order), never by an unpaid one; a full offer closes and stops showing its code
--   * my_founding_badge: true only for the BENEFICIARY of a paid order using a founding code; not the gift buyer, not a refunded
--     order, not an unpaid order, not another patient; anon cannot call it
-- SABOTAGE: the guard without badge, the status counting unpaid uses, the status returning an extra field, the status allowing a test
-- code, and the badge counting refunded orders; each must flip its check.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;

create function pg_temp.ck(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('real', p_name, p_expected, p_actual) $$;
create function pg_temp.sab(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('sabotaged', p_name, p_expected, p_actual) $$;
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
create function pg_temp.q_anon(p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  perform set_config('request.jwt.claim.role', 'anon', true);
  set local role anon;
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlstate; end;
  reset role;
  perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.role', '', true);
  return r;
end $f$;
create function pg_temp.owner_sql(p_sql text) returns text language plpgsql as
$f$ begin execute p_sql; return 'ok'; exception when others then return sqlerrm; end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text, p_test boolean) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'fmo-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'FMO ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '40 years')::date, p_test)
  on conflict (id) do update set role = excluded.role, is_test = excluded.is_test, is_active = true, phone = excluded.phone;
  return v;
end $f$;
-- an order and its redemption, written directly (fixture only): the checkout path is proved by the S73 proof; this proof is about
-- what the founding functions read. Triggers are bypassed so the fixture needs no live catalogue, price or capacity state.
create function pg_temp.mkorder(p_code uuid, p_buyer uuid, p_ben uuid, p_state text, p_redemption text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  set local session_replication_role = replica;
  insert into public.orders (id, organisation_id, buyer_profile_id, beneficiary_patient_id, catalog_item_id, price_id, amount_kobo, state, paystack_reference,
                             paid_at, fee_kobo, total_kobo, discount_code_id, discount_kobo)
  values (v, pg_temp.f('org'), p_buyer, p_ben, gen_random_uuid(), gen_random_uuid(), 90000, p_state, 'fmo_' || replace(v::text, '-', ''),
          case when p_state in ('paid', 'refunded') then now() end, case when p_state in ('paid', 'refunded') then 100 end,
          case when p_state in ('paid', 'refunded') then 90100 end, p_code, 10000);
  insert into public.discount_redemptions (organisation_id, discount_code_id, order_id, beneficiary_id, reduction_kobo, state, is_test)
  values (pg_temp.f('org'), p_code, v, p_ben, 10000, p_redemption, false);
  set local session_replication_role = origin;
  return v;
end $f$;
create function pg_temp.status_anon() returns jsonb language sql as $$ select pg_temp.q_anon('select public.founding_offer_status()::text')::jsonb $$;
create function pg_temp.badge_of(p_uid uuid) returns text language sql as $$ select pg_temp.q_as(p_uid, 'select public.my_founding_badge()::text') $$;
create function pg_temp.keys(j jsonb) returns text language sql as $$ select string_agg(k, ',' order by k) from jsonb_object_keys(j) k $$;

-- Fixtures: a real admin, a test admin, patients ---------------------------------------------------------------------------------
do $$
declare v_org uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  perform pg_temp.setf('org', v_org);
  perform pg_temp.setf('admin', pg_temp.mkuser(v_org, 'admin', 'admin', false));
  perform pg_temp.setf('tadmin', pg_temp.mkuser(v_org, 'tadmin', 'admin', true));
  perform pg_temp.setf('paid', pg_temp.mkuser(v_org, 'paid', 'patient', false));
  perform pg_temp.setf('buyer', pg_temp.mkuser(v_org, 'buyer', 'patient', false));
  perform pg_temp.setf('gifted', pg_temp.mkuser(v_org, 'gifted', 'patient', false));
  perform pg_temp.setf('unpaid', pg_temp.mkuser(v_org, 'unpaid', 'patient', false));
  perform pg_temp.setf('refunded', pg_temp.mkuser(v_org, 'refunded', 'patient', false));
  perform pg_temp.setf('other', pg_temp.mkuser(v_org, 'other', 'patient', false));
  -- start from no live founding code, whatever the database already holds
  perform pg_temp.owner_sql($q$update public.discount_codes set status = 'ended' where badge is not null and status <> 'ended'$q$);
end $$;

-- 1. Creating a founding code ---------------------------------------------------------------------------------------------------
do $$
declare v_admin uuid := pg_temp.f('admin'); r text;
begin
  perform pg_temp.ck('admin_create_discount_code has exactly one signature', '1',
    (select count(*)::text from pg_proc where proname = 'admin_create_discount_code' and pronamespace = 'public'::regnamespace));
  perform pg_temp.ck('with no founding code the offer is closed and says nothing else', '{"open": false}', pg_temp.status_anon()::text);
  r := pg_temp.q_as(v_admin, $q$select public.admin_create_discount_code('FMOPLAIN', 'percent', 5, null, null, '{}', null, 10, 1, now() - interval '1 day', now() + interval '30 days', 'proof')->>'code'$q$);
  perform pg_temp.ck('a 12-argument call still resolves', 'FMOPLAIN', r);
  perform pg_temp.ck('a code made without a badge has none', 'none', (select coalesce(badge, 'none') from public.discount_codes where code = 'FMOPLAIN'));
  perform pg_temp.ck('an unknown badge is refused', 'true',
    (pg_temp.q_as(v_admin, $q$select public.admin_create_discount_code('FMOBAD', 'percent', 10, null, null, '{}', null, 100, 1, now() - interval '1 day', now() + interval '365 days', 'proof', 'vip')::text$q$) like '%discount_code_invalid%')::text);
  r := pg_temp.q_as(v_admin, $q$select public.admin_create_discount_code('FOUNDING10', 'percent', 10, null, null, '{membership_annual,membership_annual_no_panel}', null, 100, 1, now() - interval '1 day', now() + interval '365 days', 'proof', 'founding_member')->>'code'$q$);
  perform pg_temp.ck('a founding code limited to nothing (so also the upgrade) is refused', 'true',
    (pg_temp.q_as(v_admin, $q$select public.admin_create_discount_code('FMOALL', 'percent', 10, null, null, '{}', null, 100, 1, now() - interval '1 day', now() + interval '365 days', 'proof', 'founding_member')::text$q$) like '%founding_items_invalid%')::text);
  perform pg_temp.ck('a founding code that includes the upgrade is refused', 'true',
    (pg_temp.q_as(v_admin, $q$select public.admin_create_discount_code('FMOUPG', 'percent', 10, null, null, '{membership_annual,membership_annual_no_panel,membership_upgrade_plus}', null, 100, 1, now() - interval '1 day', now() + interval '365 days', 'proof', 'founding_member')::text$q$) like '%founding_items_invalid%')::text);
  perform pg_temp.ck('admin creates the founding code with the badge', 'FOUNDING10', r);
  perform pg_temp.setf('code', (select id from public.discount_codes where code = 'FOUNDING10'));
  perform pg_temp.ck('the badge is stored on the code', 'founding_member', (select badge from public.discount_codes where code = 'FOUNDING10'));
  perform pg_temp.ck('a second live founding code is refused', 'true',
    (pg_temp.q_as(v_admin, $q$select public.admin_create_discount_code('FOUNDING2', 'percent', 10, null, null, '{membership_annual,membership_annual_no_panel}', null, 100, 1, now() - interval '1 day', now() + interval '365 days', 'proof', 'founding_member')::text$q$) like '%founding_offer_exists%')::text);
  perform pg_temp.ck('the badge cannot be removed once the code exists', 'true',
    (pg_temp.owner_sql(format($q$update public.discount_codes set badge = null where id = %L$q$, pg_temp.f('code'))) like '%discount_code_immutable%')::text);
  perform pg_temp.ck('the badge cannot be added to an existing code', 'true',
    (pg_temp.owner_sql($q$update public.discount_codes set badge = 'founding_member' where code = 'FMOPLAIN'$q$) like '%discount_code_immutable%')::text);
  perform pg_temp.ck('the admin list shows the badge', 'founding_member',
    (select c ->> 'badge' from jsonb_array_elements((pg_temp.q_as(v_admin, 'select public.admin_pricing_overview()::text')::jsonb) -> 'codes') c where c ->> 'code' = 'FOUNDING10'));
  perform pg_temp.ck('anon cannot create a code', 'ERR:42501',
    pg_temp.q_anon($q$select public.admin_create_discount_code('ANONFMO', 'percent', 10, null, null, '{}', null, 5, 1, now(), now() + interval '1 day', 'x', 'founding_member')::text$q$));
end $$;

-- 2. The public figure ----------------------------------------------------------------------------------------------------------
do $$
declare v_code uuid := pg_temp.f('code'); s jsonb;
begin
  s := pg_temp.status_anon();
  perform pg_temp.ck('anon reads the offer: open', 'true', s ->> 'open');
  perform pg_temp.ck('anon gets only the offer fields', 'code,open,percent,places_left,places_total', pg_temp.keys(s));
  perform pg_temp.ck('places total is the code''s cap', '100', s ->> 'places_total');
  perform pg_temp.ck('the code and percent come from the code itself', 'FOUNDING10 10', (s ->> 'code') || ' ' || (s ->> 'percent'));
  perform pg_temp.ck('a signed-in person reads the same figure', s::text, pg_temp.q_as(pg_temp.f('other'), 'select public.founding_offer_status()::text'));
  -- an unpaid order (its use only reserved) takes no place
  perform pg_temp.setf('o_unpaid', pg_temp.mkorder(v_code, pg_temp.f('unpaid'), pg_temp.f('unpaid'), 'created', 'reserved'));
  perform pg_temp.ck('an unpaid order does not take a place', '100', pg_temp.status_anon() ->> 'places_left');
  -- a paid order for oneself, and a gift: the buyer applied the code, the place and the badge are the beneficiary's
  perform pg_temp.setf('o_paid', pg_temp.mkorder(v_code, pg_temp.f('paid'), pg_temp.f('paid'), 'paid', 'redeemed'));
  perform pg_temp.setf('o_gift', pg_temp.mkorder(v_code, pg_temp.f('buyer'), pg_temp.f('gifted'), 'paid', 'redeemed'));
  perform pg_temp.ck('each paid order takes a place, a gift included', '98', pg_temp.status_anon() ->> 'places_left');
  perform pg_temp.setf('o_refunded', pg_temp.mkorder(v_code, pg_temp.f('refunded'), pg_temp.f('refunded'), 'refunded', 'redeemed'));
  perform pg_temp.ck('a refunded order keeps its place, as the checkout cap counts it', '97', pg_temp.status_anon() ->> 'places_left');
end $$;

-- 3. The badge ------------------------------------------------------------------------------------------------------------------
do $$
begin
  perform pg_temp.ck('the beneficiary of a paid founding order has the badge', 'true', pg_temp.badge_of(pg_temp.f('paid')));
  perform pg_temp.ck('the person given a founding Membership has the badge', 'true', pg_temp.badge_of(pg_temp.f('gifted')));
  perform pg_temp.ck('the gift buyer does not get the badge for someone else''s year', 'false', pg_temp.badge_of(pg_temp.f('buyer')));
  perform pg_temp.ck('an unpaid order gives no badge', 'false', pg_temp.badge_of(pg_temp.f('unpaid')));
  perform pg_temp.ck('a refunded order loses the badge', 'false', pg_temp.badge_of(pg_temp.f('refunded')));
  perform pg_temp.ck('another patient has no badge', 'false', pg_temp.badge_of(pg_temp.f('other')));
  perform pg_temp.ck('a paid order with a plain code gives no badge', 'false',
    (select case when pg_temp.mkorder((select id from public.discount_codes where code = 'FMOPLAIN'), pg_temp.f('other'), pg_temp.f('other'), 'paid', 'redeemed') is not null
                 then pg_temp.badge_of(pg_temp.f('other')) end));
  perform pg_temp.ck('anon cannot ask for a badge', 'ERR:42501', pg_temp.q_anon('select public.my_founding_badge()::text'));
end $$;

-- 4. A test code is never the public offer; a full offer closes ----------------------------------------------------------------
do $$
declare v_t text; s jsonb;
begin
  v_t := pg_temp.q_as(pg_temp.f('tadmin'), $q$select public.admin_create_discount_code('FMOTEST10', 'percent', 10, null, null, '{membership_annual,membership_annual_no_panel}', null, 100, 1, now() - interval '1 day', now() + interval '365 days', 'proof', 'founding_member')->>'code'$q$);
  perform pg_temp.ck('a test admin can rehearse a founding code beside the real one', 'FMOTEST10', v_t);
  perform pg_temp.ck('the rehearsal code is a test code', 'true', (select is_test::text from public.discount_codes where code = 'FMOTEST10'));
  perform pg_temp.owner_sql(format($q$update public.discount_codes set status = 'paused' where id = %L$q$, pg_temp.f('code')));
  perform pg_temp.ck('with the real code paused, a live test code is never the public offer', '{"open": false}', pg_temp.status_anon()::text);
  perform pg_temp.owner_sql(format($q$update public.discount_codes set status = 'ended' where id = %L$q$, pg_temp.f('code')));
  perform pg_temp.ck('a fresh one-place offer can start once the old one ended', 'FMOONE',
    pg_temp.q_as(pg_temp.f('admin'), $q$select public.admin_create_discount_code('FMOONE', 'percent', 10, null, null, '{membership_annual_no_panel,membership_annual}', null, 1, 1, now() - interval '1 day', now() + interval '365 days', 'proof', 'founding_member')->>'code'$q$));
  perform pg_temp.mkorder((select id from public.discount_codes where code = 'FMOONE'), pg_temp.f('other'), pg_temp.f('other'), 'paid', 'redeemed');
  s := pg_temp.status_anon();
  perform pg_temp.ck('a full offer is closed with no places left', 'false 0', (s ->> 'open') || ' ' || (s ->> 'places_left'));
  perform pg_temp.ck('a full offer no longer shows its code', 'false', (s ? 'code')::text);
end $$;

-- SABOTAGE ----------------------------------------------------------------------------------------------------------------------
-- put the real FOUNDING10 back on for the status checks (owner, rolled back; the ended rule is lifted with the guard below)
do $$
declare v_code uuid := pg_temp.f('code'); s jsonb;
begin
  update public.discount_codes set status = 'ended' where code = 'FMOONE';
  -- (a) the guard without badge: the badge can then be removed
  create or replace function private.discount_codes_guard() returns trigger language plpgsql set search_path = '' as $g$
  begin
    if tg_op = 'DELETE' then raise exception 'discount_code_immutable' using errcode = 'P0001'; end if;
    if new.code is distinct from old.code or new.kind is distinct from old.kind or new.percent is distinct from old.percent then
      raise exception 'discount_code_immutable' using errcode = 'P0001';
    end if;
    return new;
  end $g$;
  perform pg_temp.sab('the badge cannot be removed once the code exists', 'true',
    (pg_temp.owner_sql($q$update public.discount_codes set badge = null where code = 'FMOPLAIN'$q$) like '%discount_code_immutable%')::text);
  update public.discount_codes set status = 'active' where id = v_code;
  update public.discount_codes set status = 'ended' where code = 'FMOTEST10';
  perform pg_temp.ck('the reopened real offer counts three paid places', '97', pg_temp.status_anon() ->> 'places_left');

  -- (b) the status counting unpaid (reserved) uses too
  create or replace function public.founding_offer_status() returns jsonb language plpgsql stable security definer set search_path = '' as $g$
  declare dc public.discount_codes%rowtype; v_taken integer;
  begin
    select * into dc from public.discount_codes d where d.badge = 'founding_member' and d.status = 'active' and not d.is_test order by d.created_at desc limit 1;
    if not found then return jsonb_build_object('open', false); end if;
    select count(*) into v_taken from public.discount_redemptions r where r.discount_code_id = dc.id and r.state in ('reserved', 'redeemed');
    return jsonb_build_object('open', true, 'places_total', dc.max_total_uses, 'places_left', dc.max_total_uses - v_taken, 'code', dc.code, 'percent', dc.percent, 'note', dc.note);
  end $g$;
  s := pg_temp.status_anon();
  perform pg_temp.sab('an unpaid order does not take a place', '97', s ->> 'places_left');
  -- (c) the same sabotaged function also returns an extra field
  perform pg_temp.sab('anon gets only the offer fields', 'code,open,percent,places_left,places_total', pg_temp.keys(s));

  -- (d) the status allowing a test code: pause the real one, reactivate the rehearsal
  create or replace function public.founding_offer_status() returns jsonb language plpgsql stable security definer set search_path = '' as $g$
  declare dc public.discount_codes%rowtype;
  begin
    select * into dc from public.discount_codes d where d.badge = 'founding_member' and d.status = 'active' order by d.created_at desc limit 1;
    if not found then return jsonb_build_object('open', false); end if;
    return jsonb_build_object('open', true, 'places_total', dc.max_total_uses, 'places_left', dc.max_total_uses, 'code', dc.code, 'percent', dc.percent);
  end $g$;
  update public.discount_codes set status = 'paused' where id = v_code;
  update public.discount_codes set status = 'active' where code = 'FMOTEST10';
  perform pg_temp.sab('with the real code paused, a live test code is never the public offer', '{"open": false}', pg_temp.status_anon()::text);

  -- (e) the badge counting refunded orders
  create or replace function public.my_founding_badge() returns boolean language sql stable security definer set search_path = '' as $g$
    select exists (select 1 from public.orders o join public.discount_codes d on d.id = o.discount_code_id
                    where o.beneficiary_patient_id = (select auth.uid()) and o.state in ('paid', 'refunded') and d.badge = 'founding_member')
  $g$;
  perform pg_temp.sab('a refunded order loses the badge', 'false', pg_temp.badge_of(pg_temp.f('refunded')));
end $$;

do $$
declare v_bad integer; v_caught integer; v_real integer; v_sab integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'Founding offer proof did not hold: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ')
         from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_real from results where phase = 'real';
  if v_real < 30 then raise exception 'VACUOUS TEST: only % checks ran', v_real; end if;
  select count(*) into v_sab from results where phase = 'sabotaged';
  select count(*) into v_caught from results where phase = 'sabotaged' and expected is distinct from actual;
  if v_sab < 5 or v_caught < v_sab then raise exception 'VACUOUS TEST: the sabotage flipped % of % checks', v_caught, v_sab; end if;
end $$;

select check_name, expected, actual from results where phase = 'real' order by check_name;

rollback;
