-- Proof: the Membership Plus checkout state (migration *_plus_checkout_collection_state.sql). Raises on any failed check. One rolled-back transaction.
--   1. While the two-tier module is OFF the state is ignored: nothing is required, nothing stored.
--   2. While it is ON: Plus and the upgrade need a state (plus_state_required), an approved one (plus_state_not_available for a dark or unknown state);
--      an approved state is stored on the order. Membership (no Plus) ignores the argument entirely, even a bad one.
--   3. Paying records the state on the membership (new row, and the upgrade); my_membership returns it; withdrawing the state afterwards does not change an order already made.
--   4. Only a real state can be stored (FK); anon cannot call create_order; the old six-argument create_order is gone.
--   SABOTAGE: the approved-state check removed; an unapproved state must then be accepted (so check 2 can fail).
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

select 'PASS plus_checkout_collection_state' as result;
rollback;
