-- Proof: Evergreen to Evergreen Plus upgrade (migration *_membership_upgrade_order_and_tier_flag.sql). Raises on any failed check.
-- Proves in one rolled-back transaction:
--   * the module membership_two_member_tiers starts OFF; the upgrade item exists, is inactive and costs exactly 4,500,000 kobo, which is
--     the difference between the two tier prices
--   * create_order: refused while the module is off (even with the item switched on); with it on, refused for a Free person, for an
--     Evergreen Plus holder and for a gift; allowed for the Evergreen holder, charging exactly 4,500,000 kobo
--   * paying it flips the tier to plus, leaves the end date untouched, makes no entitlement and no second membership row, stores no
--     balance, and a replayed payment changes nothing
--   * the ledger recognises the amount over the days left in the membership, not 365
--   * the 21 day refund window runs from the top-up date, and an approved refund puts the tier back to evergreen without ending the membership
-- SABOTAGE: the refund patch is removed; the tier-back-to-evergreen check must flip.
begin;

create function pg_temp.mkuser(p_label text, p_role text) returns uuid language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'up-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, '00000000-0000-0000-0000-000000000001', p_role::public.user_role, 'UP ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'),
          (current_date - interval '45 years')::date, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true;
  return v;
end $f$;
create function pg_temp.act(p_uid uuid) returns void language plpgsql as $f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
end $f$;
create function pg_temp.back() returns void language plpgsql as $f$ begin
  reset role; perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.sub', '', true); perform set_config('request.jwt.claim.role', '', true);
end $f$;
create function pg_temp.q_as(p_uid uuid, p_sql text) returns text language plpgsql as $f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlerrm; end;
  perform pg_temp.back();
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

create temp table fx(k text primary key, v text) on commit drop;
grant all on fx to public;

do $$
declare v_org uuid := '00000000-0000-0000-0000-000000000001'; ev uuid := pg_temp.mkuser('evergreen', 'patient'); fr uuid := pg_temp.mkuser('free', 'patient');
        pl uuid := pg_temp.mkuser('plus', 'patient'); ad uuid := pg_temp.mkuser('admin', 'admin'); v_up uuid; v_plus_item uuid; v_eg_item uuid;
begin
  insert into fx values ('ev', ev::text), ('fr', fr::text), ('pl', pl::text), ('ad', ad::text);
  select id into v_up from public.catalog_items where code = 'membership_upgrade_plus' order by created_at limit 1;
  select id into v_plus_item from public.catalog_items where code = 'membership_annual' order by created_at limit 1;
  select id into v_eg_item from public.catalog_items where code = 'membership_annual_no_panel' order by created_at limit 1;
  if v_up is null then raise exception 'FAIL the upgrade item does not exist'; end if;
  if (select is_enabled from public.platform_modules where key = 'membership_two_member_tiers') is distinct from false then raise exception 'FAIL the tier module must start OFF'; end if;
  if (select active from public.catalog_items where id = v_up) then raise exception 'FAIL the upgrade item is active'; end if;
  if (select amount_kobo from public.prices where catalog_item_id = v_up and valid_to is null) <> 4500000 then raise exception 'FAIL upgrade price'; end if;
  if (select amount_kobo from public.prices where catalog_item_id = v_plus_item and valid_to is null)
     - (select amount_kobo from public.prices where catalog_item_id = v_eg_item and valid_to is null) <> 4500000 then raise exception 'FAIL not the tier difference'; end if;

  insert into public.patient_memberships (organisation_id, patient_id, source, state, starts_at, ends_at, is_test, tier)
  values (v_org, ev, 'purchase', 'active', now() - interval '100 days', now() + interval '265 days', true, 'evergreen');
  insert into public.patient_memberships (organisation_id, patient_id, source, state, starts_at, ends_at, is_test, tier)
  values (v_org, pl, 'purchase', 'active', now() - interval '100 days', now() + interval '265 days', true, 'plus');
  insert into fx select 'ends_before', ends_at::text from public.patient_memberships where patient_id = ev;
end $$;

-- create_order rules: switch checkout and the item on inside this transaction only
do $$
declare ev uuid := (select v::uuid from fx where k = 'ev'); fr uuid := (select v::uuid from fx where k = 'fr'); pl uuid := (select v::uuid from fx where k = 'pl');
        r text; o jsonb;
begin
  update public.platform_modules set is_enabled = true, enabled_at = now(), enabled_by = (select v::uuid from fx where k = 'ad'), activation_note = 'proof' where key = 'v5_checkout';
  update public.catalog_items set active = true where code = 'membership_upgrade_plus';

  r := pg_temp.q_as(ev, $q$select public.create_order('membership_upgrade_plus', gen_random_uuid())::text$q$);
  if r not like 'ERR:%item_not_available%' then raise exception 'FAIL module off must refuse the upgrade, got %', r; end if;

  update public.platform_modules set is_enabled = true, enabled_at = now(), enabled_by = (select v::uuid from fx where k = 'ad'), activation_note = 'proof' where key = 'membership_two_member_tiers';

  r := pg_temp.q_as(fr, $q$select public.create_order('membership_upgrade_plus', gen_random_uuid())::text$q$);
  if r not like 'ERR:%upgrade_not_available%' then raise exception 'FAIL a Free person got the upgrade: %', r; end if;
  r := pg_temp.q_as(pl, $q$select public.create_order('membership_upgrade_plus', gen_random_uuid())::text$q$);
  if r not like 'ERR:%upgrade_not_available%' then raise exception 'FAIL a Plus holder got the upgrade: %', r; end if;
  r := pg_temp.q_as(fr, format($q$select public.create_order('membership_upgrade_plus', gen_random_uuid(), %L)::text$q$, ev));
  if r not like 'ERR:%' then raise exception 'FAIL a gift of the upgrade was accepted: %', r; end if;

  r := pg_temp.q_as(ev, $q$select public.create_order('membership_upgrade_plus', gen_random_uuid())::text$q$);
  if r like 'ERR:%' then raise exception 'FAIL the Evergreen holder could not create the upgrade order: %', r; end if;
  o := r::jsonb;
  if (o ->> 'amount_kobo')::bigint <> 4500000 then raise exception 'FAIL upgrade charged %', o ->> 'amount_kobo'; end if;
  insert into fx values ('order', o ->> 'order_id'), ('ref', o ->> 'reference');
end $$;

-- payment
do $$
declare ev uuid := (select v::uuid from fx where k = 'ev'); ref text := (select v from fx where k = 'ref'); oid uuid := (select v::uuid from fx where k = 'order');
        r text; ends_before timestamptz := (select v::timestamptz from fx where k = 'ends_before'); n integer;
begin
  r := pg_temp.svc(format($q$select public.record_order_payment(%L, 4500000, 0, 4500000, 'NGN', 'success', 'webhook', 'evt-up-1', now(), '{}'::jsonb)::text$q$, ref));
  if r like 'ERR:%' or (r::jsonb ->> 'result') <> 'paid' then raise exception 'FAIL payment result %', r; end if;
  if (r::jsonb ->> 'entitlement_id') is not null then raise exception 'FAIL the upgrade made an entitlement'; end if;
  if (select tier from public.patient_memberships where patient_id = ev and state = 'active') <> 'plus' then raise exception 'FAIL tier did not flip to plus'; end if;
  if (select ends_at from public.patient_memberships where patient_id = ev and state = 'active') <> ends_before then raise exception 'FAIL the end date moved'; end if;
  select count(*) into n from public.patient_memberships where patient_id = ev;
  if n <> 1 then raise exception 'FAIL % membership rows after the upgrade', n; end if;
  if exists (select 1 from public.entitlements where order_id = oid) then raise exception 'FAIL an entitlement row exists for the upgrade'; end if;
  if (select state from public.orders where id = oid) <> 'paid' then raise exception 'FAIL order not paid'; end if;
  if not private.patient_is_member(ev) then raise exception 'FAIL the upgraded person is not a Member'; end if;

  r := pg_temp.svc(format($q$select public.record_order_payment(%L, 4500000, 0, 4500000, 'NGN', 'success', 'webhook', 'evt-up-1', now(), '{}'::jsonb)::text$q$, ref));
  if (r::jsonb ->> 'result') <> 'replay' then raise exception 'FAIL replay result %', r; end if;
  select count(*) into n from public.patient_memberships where patient_id = ev;
  if n <> 1 then raise exception 'FAIL replay changed memberships'; end if;
end $$;

-- ledger: recognised over the days left, not 365
do $$
declare oid uuid := (select v::uuid from fx where k = 'order'); ev uuid := (select v::uuid from fx where k = 'ev'); v_entry uuid; v_days integer; v_left integer;
begin
  v_entry := private.post_order_to_ledger(oid, true);
  if v_entry is null then raise exception 'FAIL the upgrade could not be posted to the ledger'; end if;
  select (s.period_end - s.period_start) into v_days from public.revenue_recognition_schedules s where s.source_kind = 'order' and s.source_id = oid;
  select ((m.ends_at at time zone 'Africa/Lagos')::date - (now() at time zone 'Africa/Lagos')::date) into v_left from public.patient_memberships m where m.patient_id = ev and m.state = 'active';
  if v_days is null then raise exception 'FAIL no recognition schedule'; end if;
  if abs(v_days - v_left) > 1 or v_days > 300 then raise exception 'FAIL recognised over % days, % days remain', v_days, v_left; end if;
end $$;

-- refund: window from the top-up date; approval puts the tier back and keeps the membership
do $$
declare ev uuid := (select v::uuid from fx where k = 'ev'); ad uuid := (select v::uuid from fx where k = 'ad'); oid uuid := (select v::uuid from fx where k = 'order');
        r text; v_ref uuid;
begin
  r := pg_temp.q_as(ev, format($q$select public.request_order_refund(%L, 'changed my mind about the panel')::text$q$, oid));
  if r like 'ERR:%' or (r::jsonb ->> 'result') <> 'requested' then raise exception 'FAIL refund request %', r; end if;
  v_ref := (r::jsonb ->> 'refund_id')::uuid;
  update public.orders set paid_at = now() - interval '30 days', updated_at = now() where id = oid;
  insert into fx values ('refund', v_ref::text);
  r := pg_temp.q_as(ad, format($q$select public.decide_order_refund(%L, true, 'approved in proof')::text$q$, v_ref));
  if r like 'ERR:%' or (r::jsonb ->> 'result') <> 'approved' then raise exception 'FAIL refund decision %', r; end if;
  if (select tier from public.patient_memberships where patient_id = ev and state = 'active') is distinct from 'evergreen' then raise exception 'FAIL refund did not put the tier back'; end if;
  if (select count(*) from public.patient_memberships where patient_id = ev and state = 'active') <> 1 then raise exception 'FAIL the refund ended the membership'; end if;
  if (r::jsonb ->> 'membership_ended')::boolean then raise exception 'FAIL decide_order_refund reports the membership ended'; end if;
end $$;

-- SABOTAGE: the refund restore is reversed; a full second upgrade-and-refund cycle must then leave the tier at plus (the check above would flip)
create function pg_temp.cycle(p_label text) returns text language plpgsql as $f$
declare u uuid := pg_temp.mkuser(p_label, 'patient'); ad uuid := (select v::uuid from fx where k = 'ad'); it uuid; pr uuid; oid uuid := gen_random_uuid();
        ref text := 'tho_' || replace(gen_random_uuid()::text, '-', ''); r text; v_ref uuid;
begin
  select id into it from public.catalog_items where code = 'membership_upgrade_plus' order by created_at limit 1;
  select id into pr from public.prices where catalog_item_id = it and valid_to is null;
  insert into public.patient_memberships (organisation_id, patient_id, source, state, starts_at, ends_at, is_test, tier)
  values ('00000000-0000-0000-0000-000000000001', u, 'purchase', 'active', now() - interval '10 days', now() + interval '355 days', true, 'evergreen');
  insert into public.orders (id, organisation_id, buyer_profile_id, beneficiary_patient_id, catalog_item_id, price_id, amount_kobo, paystack_reference, is_test, list_amount_kobo)
  values (oid, '00000000-0000-0000-0000-000000000001', u, u, it, pr, 4500000, ref, true, 4500000);
  r := pg_temp.svc(format($q$select public.record_order_payment(%L, 4500000, 0, 4500000, 'NGN', 'success', 'webhook', %L, now(), '{}'::jsonb)::text$q$, ref, 'evt-' || ref));
  if r like 'ERR:%' then return r; end if;
  r := pg_temp.q_as(u, format($q$select public.request_order_refund(%L, 'proof cycle refund')::text$q$, oid));
  v_ref := (r::jsonb ->> 'refund_id')::uuid;
  r := pg_temp.q_as(ad, format($q$select public.decide_order_refund(%L, true, 'approved in proof')::text$q$, v_ref));
  if r like 'ERR:%' then return r; end if;
  return (select tier from public.patient_memberships where patient_id = u and state = 'active');
end $f$;

do $$
declare d text; t_real text; t_sab text;
begin
  t_real := pg_temp.cycle('cycle-real');
  if t_real is distinct from 'evergreen' then raise exception 'FAIL a clean upgrade and refund cycle left tier %', t_real; end if;
  d := pg_get_functiondef('public.decide_order_refund(uuid,boolean,text)'::regprocedure);
  d := replace(d, 'set tier = ''evergreen''', 'set tier = ''plus''');
  execute d;
  t_sab := pg_temp.cycle('cycle-sab');
  if t_sab is not distinct from 'evergreen' then raise exception 'FAIL the tier-back check did not flip under sabotage'; end if;
end $$;

select 'PASS membership_upgrade_order' as result;
rollback;
