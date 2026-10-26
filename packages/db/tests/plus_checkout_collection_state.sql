-- Proof: the Membership Plus checkout state (migration *_plus_checkout_collection_state.sql). Raises on any failed check. One rolled-back transaction.
--   1. While the two-tier module is OFF the state is ignored: nothing is required, nothing stored.
--   2. While it is ON: Plus and the upgrade need a state (plus_state_required), an approved one (plus_state_not_available for a dark or unknown state);
--      an approved state is stored on the order. Membership (no Plus) ignores the argument entirely, even a bad one.
--   3. Paying records the state on the membership (new row, and the upgrade); my_membership returns it; withdrawing the state afterwards does not change an order already made.
--   4. Only a real state can be stored (FK); anon cannot call create_order; the old six-argument create_order is gone.
--   5. Review fixes: a retry with another state is refused, Plus cannot be requested through a supporter's link, a withdrawn or missing state at payment
--      raises an incident, an accepted gift carries the state.
--   SABOTAGE: the approved-state check removed (check 2), and the replay guard removed (RF2); each must flip.
begin;

create function pg_temp.mkuser(p_label text, p_role text) returns uuid language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'pc-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, '00000000-0000-0000-0000-000000000001', p_role::public.user_role, 'PC ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'),
          (current_date - interval '45 years')::date, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true;
  return v;
end $f$;
create function pg_temp.q_as(p_uid uuid, p_sql text) returns text language plpgsql as $f$ declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlerrm; end;
  reset role; perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.sub', '', true); perform set_config('request.jwt.claim.role', '', true);
  return r;
end $f$;
create function pg_temp.svc(p_sql text) returns text language plpgsql as $f$ declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  perform set_config('request.jwt.claim.role', 'service_role', true);
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlerrm; end;
  perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.role', '', true);
  return r;
end $f$;
-- create an order as the patient; returns the reply (jsonb text) or 'ERR:...'
create function pg_temp.order_as(p_user uuid, p_code text, p_state text default null) returns text language plpgsql as $f$
begin
  return pg_temp.q_as(p_user, case when p_state is null
    then format($q$select public.create_order(%L, gen_random_uuid())::text$q$, p_code)
    else format($q$select public.create_order(%L, gen_random_uuid(), null, null, false, null, %L)::text$q$, p_code, p_state) end);
end $f$;
create function pg_temp.pay(p_ref text, p_amount bigint) returns jsonb language plpgsql as $f$ declare r text;
begin
  r := pg_temp.svc(format($q$select public.record_order_payment(%L, %s, 0, %s, 'NGN', 'success', 'webhook', %L, now(), '{}'::jsonb)::text$q$, p_ref, p_amount, p_amount, 'evt-' || p_ref));
  if r like 'ERR:%' then raise exception 'payment call failed: %', r; end if;
  return r::jsonb;
end $f$;

create temp table fx(k text primary key, v text) on commit drop;
grant all on fx to public;

do $$
declare ad uuid := pg_temp.mkuser('admin', 'admin');
begin
  insert into fx values ('ad', ad::text);
  update public.platform_modules set is_enabled = true, enabled_at = now(), enabled_by = ad, activation_note = 'proof' where key = 'v5_checkout';
  -- no lead-clinician slot is needed for what this proof checks (the state), so the capacity rule is switched off for these items inside the transaction
  update public.catalog_items set active = true, grants_lead = false where code in ('membership_annual', 'membership_annual_no_panel', 'membership_upgrade_plus');
  -- the proof's own approved states are the migration's launch states: Lagos, Oyo, Osun, Ogun are approved; Kano is dark
  if private.plus_collection_state_enabled('Kano') then raise exception 'FAIL fixture: Kano must not be approved'; end if;
  if not private.plus_collection_state_enabled('Oyo') then raise exception 'FAIL fixture: Oyo must be approved'; end if;
end $$;

-- 1. module OFF: ignored
do $$
declare p uuid := pg_temp.mkuser('off', 'patient'); r text; o jsonb;
begin
  if (select is_enabled from public.platform_modules where key = 'membership_two_member_tiers') then raise exception 'FAIL fixture: the tier module must start OFF'; end if;
  r := pg_temp.order_as(p, 'membership_annual');
  if r like 'ERR:%' then raise exception 'FAIL 1a: with the module off, a Membership order with no state was refused: %', r; end if;
  if (select collection_state from public.orders where id = (r::jsonb ->> 'order_id')::uuid) is not null then raise exception 'FAIL 1b: a state was stored with the module off'; end if;
  insert into fx values ('off_order', r::jsonb ->> 'order_id');
  r := pg_temp.order_as(pg_temp.mkuser('off2', 'patient'), 'membership_annual', 'Kano');
  if r like 'ERR:%' then raise exception 'FAIL 1c: with the module off a state argument must be ignored, got %', r; end if;
  if (select collection_state from public.orders where id = (r::jsonb ->> 'order_id')::uuid) is not null then raise exception 'FAIL 1d: a state was stored with the module off'; end if;
end $$;

-- 2 and 3. module ON
do $$
declare ad uuid := (select v::uuid from fx where k = 'ad'); p uuid := pg_temp.mkuser('plus', 'patient'); e uuid := pg_temp.mkuser('eg', 'patient');
        u uuid := pg_temp.mkuser('up', 'patient'); r text; o jsonb; j jsonb; mem jsonb; v_end timestamptz;
begin
  update public.platform_modules set is_enabled = true, enabled_at = now(), enabled_by = ad, activation_note = 'proof' where key = 'membership_two_member_tiers';

  r := pg_temp.order_as(p, 'membership_annual');
  if r not like 'ERR:%plus_state_required%' then raise exception 'FAIL 2a: Plus with no state was accepted: %', r; end if;
  r := pg_temp.order_as(p, 'membership_annual', 'Kano');
  if r not like 'ERR:%plus_state_not_available%' then raise exception 'FAIL 2b: Plus for a dark state was accepted: %', r; end if;
  r := pg_temp.order_as(p, 'membership_annual', 'Atlantis');
  if r not like 'ERR:%plus_state_not_available%' then raise exception 'FAIL 2c: Plus for an unknown state was accepted: %', r; end if;
  r := pg_temp.order_as(p, 'membership_annual', 'Oyo');
  if r like 'ERR:%' then raise exception 'FAIL 2d: Plus for an approved state was refused: %', r; end if;
  o := r::jsonb;
  if (select collection_state from public.orders where id = (o ->> 'order_id')::uuid) <> 'Oyo' then raise exception 'FAIL 2e: the state was not stored on the order'; end if;

  -- Membership (no Plus) ignores the argument, even a bad one
  r := pg_temp.order_as(e, 'membership_annual_no_panel', 'Atlantis');
  if r like 'ERR:%' then raise exception 'FAIL 2f: Membership was refused over a state it does not use: %', r; end if;
  if (select collection_state from public.orders where id = (r::jsonb ->> 'order_id')::uuid) is not null then raise exception 'FAIL 2g: Membership stored a state'; end if;

  -- 3. paying records the state on the new membership; withdrawing the state afterwards changes nothing already made
  update public.service_regions set plus_collection_enabled = false where state = 'Oyo';
  j := pg_temp.pay(o ->> 'reference', (o ->> 'amount_kobo')::bigint);
  if j ->> 'result' <> 'paid' then raise exception 'FAIL 3a: payment result %', j; end if;
  if (select collection_state from public.patient_memberships where patient_id = p and state = 'active') is distinct from 'Oyo' then raise exception 'FAIL 3b: the membership did not record the state'; end if;
  mem := pg_temp.q_as(p, 'select public.my_membership()::text')::jsonb;
  if mem ->> 'collection_state' is distinct from 'Oyo' then raise exception 'FAIL 3c: my_membership does not show the state: %', mem; end if;
  update public.service_regions set plus_collection_enabled = true where state = 'Oyo';

  -- the upgrade needs a state too, and writes it on the upgraded membership
  insert into public.patient_memberships (organisation_id, patient_id, source, state, starts_at, ends_at, is_test, tier)
  values ('00000000-0000-0000-0000-000000000001', u, 'purchase', 'active', now() - interval '10 days', now() + interval '355 days', true, 'evergreen');
  r := pg_temp.order_as(u, 'membership_upgrade_plus');
  if r not like 'ERR:%plus_state_required%' then raise exception 'FAIL 3d: the upgrade with no state was accepted: %', r; end if;
  r := pg_temp.order_as(u, 'membership_upgrade_plus', 'Ogun');
  if r like 'ERR:%' then raise exception 'FAIL 3e: the upgrade for an approved state was refused: %', r; end if;
  o := r::jsonb;
  j := pg_temp.pay(o ->> 'reference', (o ->> 'amount_kobo')::bigint);
  if j ->> 'result' <> 'paid' then raise exception 'FAIL 3f: upgrade payment %', j; end if;
  if (select tier || '|' || coalesce(collection_state, '-') from public.patient_memberships where patient_id = u and state = 'active') <> 'plus|Ogun' then raise exception 'FAIL 3g: the upgraded membership does not carry the state'; end if;
end $$;

-- REVIEW FIXES: replay with another state, payment request, withdrawn or missing state at payment, gift accepted later
do $$
declare ad uuid := (select v::uuid from fx where k = 'ad'); p uuid := pg_temp.mkuser('rp', 'patient'); q uuid := pg_temp.mkuser('pr', 'patient'); w uuid := pg_temp.mkuser('wd', 'patient');
        n uuid := pg_temp.mkuser('nostate', 'patient'); b uuid := pg_temp.mkuser('gb', 'patient'); g uuid := pg_temp.mkuser('gr', 'patient');
        ck uuid := gen_random_uuid(); r text; o jsonb; eid uuid;
begin
  -- a retry with the SAME key but another state must not replay the order made for the first state
  r := pg_temp.q_as(p, format($q$select public.create_order('membership_annual', %L, null, null, false, null, 'Lagos')::text$q$, ck));
  if r like 'ERR:%' then raise exception 'FAIL RF1: first order refused: %', r; end if;
  r := pg_temp.q_as(p, format($q$select public.create_order('membership_annual', %L, null, null, false, null, 'Oyo')::text$q$, ck));
  if r not like 'ERR:%plus_state_changed%' then raise exception 'FAIL RF2: a retry with another state replayed the old order: %', r; end if;
  r := pg_temp.q_as(p, format($q$select public.create_order('membership_annual', %L, null, null, false, null, 'Lagos')::text$q$, ck));
  if r like 'ERR:%' or (r::jsonb ->> 'replay') is distinct from 'true' then raise exception 'FAIL RF3: the same state on a retry must replay: %', r; end if;

  -- Plus cannot be requested through a supporter's link (the supporter cannot choose the state)
  r := pg_temp.q_as(q, $q$select public.create_payment_request('membership_annual')::text$q$);
  if r not like 'ERR:%plus_needs_direct_checkout%' then raise exception 'FAIL RF4: a payment request for Plus was accepted: %', r; end if;

  -- an order made for a state that is withdrawn before the payment arrives: paid, but a person is told
  r := pg_temp.order_as(w, 'membership_annual', 'Osun');
  o := r::jsonb;
  update public.service_regions set plus_collection_enabled = false where state = 'Osun';
  perform pg_temp.pay(o ->> 'reference', (o ->> 'amount_kobo')::bigint);
  if not exists (select 1 from public.ops_incidents where external_reference = 'order-plus-state-withdrawn:' || (o ->> 'order_id')) then raise exception 'FAIL RF5: no incident for a state withdrawn before payment'; end if;
  update public.service_regions set plus_collection_enabled = true where state = 'Osun';

  -- a Plus order opened while the module was off, paid after it was switched on: paid, but a person is told
  update public.platform_modules set is_enabled = false where key = 'membership_two_member_tiers';
  r := pg_temp.order_as(n, 'membership_annual');
  o := r::jsonb;
  update public.platform_modules set is_enabled = true where key = 'membership_two_member_tiers';
  perform pg_temp.pay(o ->> 'reference', (o ->> 'amount_kobo')::bigint);
  if not exists (select 1 from public.ops_incidents where external_reference = 'order-plus-no-state:' || (o ->> 'order_id')) then raise exception 'FAIL RF6: no incident for a Plus order paid with no state'; end if;

  -- a gift of Plus carries the buyer's chosen state to the membership when the recipient accepts
  -- (created directly: buying for someone else needs a Care Circle grant, which is not what this checks; the order carries the state the buyer chose)
  declare v_it uuid; v_pr uuid; v_amt bigint; v_ref text := 'pcg_' || replace(gen_random_uuid()::text, '-', '');
  begin
    select id into v_it from public.catalog_items where code = 'membership_annual' order by created_at limit 1;
    select id, amount_kobo into v_pr, v_amt from public.prices where catalog_item_id = v_it and valid_to is null;
    insert into public.orders (id, organisation_id, buyer_profile_id, beneficiary_patient_id, catalog_item_id, price_id, amount_kobo, paystack_reference, is_test, list_amount_kobo, collection_state)
    values (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', b, g, v_it, v_pr, v_amt, v_ref, true, v_amt, 'Ogun');
    o := jsonb_build_object('reference', v_ref, 'amount_kobo', v_amt, 'order_id', (select id from public.orders where paystack_reference = v_ref));
  end;
  -- a gift waits for acceptance only for an item that grants a lead clinician: switch that back on for this step
  update public.catalog_items set grants_lead = true where code = 'membership_annual';
  perform pg_temp.pay(o ->> 'reference', (o ->> 'amount_kobo')::bigint);
  select e.id into eid from public.entitlements e where e.order_id = (o ->> 'order_id')::uuid;
  if (select acceptance from public.entitlements where id = eid) <> 'pending' then raise exception 'FAIL RF8 fixture: the gift is not waiting for acceptance'; end if;
  r := pg_temp.q_as(g, format($q$select public.respond_to_gifted_pack(%L, true)::text$q$, eid));
  if r like 'ERR:%' then raise exception 'FAIL RF9: acceptance failed: %', r; end if;
  update public.catalog_items set grants_lead = false where code = 'membership_annual';
  if (select collection_state from public.patient_memberships where patient_id = g and state = 'active') is distinct from 'Ogun' then raise exception 'FAIL RF10: the accepted gift did not carry the state'; end if;

  -- the sponsor-covered path copies the state too (checked in the function body: a sponsor programme fixture is not built here)
  if position('o.collection_state' in pg_get_functiondef('private.settle_sponsor_order(uuid)'::regprocedure)) = 0 then raise exception 'FAIL RF11: settle_sponsor_order does not copy the state'; end if;
end $$;

-- 4. integrity and closure
do $$
declare p uuid := pg_temp.mkuser('fk', 'patient'); r text;
begin
  begin
    insert into public.patient_memberships (organisation_id, patient_id, source, state, starts_at, ends_at, is_test, tier, collection_state)
    values ('00000000-0000-0000-0000-000000000001', p, 'purchase', 'active', now(), now() + interval '365 days', true, 'plus', 'Atlantis');
    raise exception 'FAIL 4a: a membership was stored with a state that does not exist';
  exception when foreign_key_violation then null; end;
  if to_regprocedure('public.create_order(text,uuid,uuid,text,boolean,bigint)') is not null then raise exception 'FAIL 4b: the old six-argument create_order still exists'; end if;
  if has_function_privilege('anon', 'public.create_order(text,uuid,uuid,text,boolean,bigint,text)', 'EXECUTE') then raise exception 'FAIL 4c: anon can call create_order'; end if;
  if not has_function_privilege('authenticated', 'public.create_order(text,uuid,uuid,text,boolean,bigint,text)', 'EXECUTE') then raise exception 'FAIL 4d: signed-in users cannot call create_order'; end if;
end $$;

-- SABOTAGE: the approved-state check removed; a dark state must then be accepted
do $$
declare d text; p uuid := pg_temp.mkuser('sab', 'patient'); r text;
begin
  d := pg_get_functiondef('public.create_order(text,uuid,uuid,text,boolean,bigint,text)'::regprocedure);
  if position('if not private.plus_collection_state_enabled(v_state) then' in d) = 0 then raise exception 'FAIL sabotage cannot apply, test is stale'; end if;
  execute replace(d, 'if not private.plus_collection_state_enabled(v_state) then', 'if false and not private.plus_collection_state_enabled(v_state) then');
  r := pg_temp.order_as(p, 'membership_annual', 'Kano');
  if r like 'ERR:%plus_state_not_available%' then raise exception 'FAIL the approved-state check did not flip under sabotage'; end if;
end $$;

-- SABOTAGE: the replay guard removed; a retry with another state must then replay the old order (so RF2 can fail)
do $$
declare d text; p uuid := pg_temp.mkuser('sab2', 'patient'); ck uuid := gen_random_uuid(); r text;
begin
  d := pg_get_functiondef('public.create_order(text,uuid,uuid,text,boolean,bigint,text)'::regprocedure);
  if position('raise exception ''plus_state_changed''' in d) = 0 then raise exception 'FAIL sabotage 2 cannot apply, test is stale'; end if;
  execute replace(d, 'raise exception ''plus_state_changed''', 'perform 1; --');
  r := pg_temp.q_as(p, format($q$select public.create_order('membership_annual', %L, null, null, false, null, 'Lagos')::text$q$, ck));
  r := pg_temp.q_as(p, format($q$select public.create_order('membership_annual', %L, null, null, false, null, 'Oyo')::text$q$, ck));
  if r like 'ERR:%plus_state_changed%' then raise exception 'FAIL the replay guard did not flip under sabotage'; end if;
end $$;

select 'PASS plus_checkout_collection_state' as result;
rollback;
