-- Proof: review fixes for the Membership ladder (migration *_membership_ladder_review_fixes.sql). Raises on any failed check.
-- One rolled-back transaction:
--   A. A second upgrade order is refused while one is open (upgrade_already_open).
--   B. A second upgrade order that slips through (created directly) and is then paid after the member was upgraded is a payment MISMATCH
--      (upgrade_not_applicable): the order is not marked paid and nothing is posted. SABOTAGE: the guard removed; the check must flip.
--   C. The paid upgrade records the membership it upgraded. The refund puts back exactly that one: with the link cleared nothing moves.
--   D. The revenue schedule follows the upgraded membership, not a newer ended one.
--   E. Renewal in the grace creates a new membership at the tier of the item bought (a Plus holder who renews on Membership becomes Membership).
--   F. The voucher guard refuses a membership catalogue code, and does not refuse a name that merely mentions membership.
begin;

create function pg_temp.mkuser(p_label text, p_role text) returns uuid language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'rf-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, '00000000-0000-0000-0000-000000000001', p_role::public.user_role, 'RF ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'),
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
-- an open order for an item, made directly (the way a second open order could exist), returns its reference
create function pg_temp.mkorder(p_user uuid, p_code text) returns text language plpgsql as $f$
declare it uuid; pr uuid; amt bigint; ref text := 'rfo_' || replace(gen_random_uuid()::text, '-', '');
begin
  select id into it from public.catalog_items where code = p_code order by created_at limit 1;
  select id, amount_kobo into pr, amt from public.prices where catalog_item_id = it and valid_to is null;
  insert into public.orders (id, organisation_id, buyer_profile_id, beneficiary_patient_id, catalog_item_id, price_id, amount_kobo, paystack_reference, is_test, list_amount_kobo)
  values (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', p_user, p_user, it, pr, amt, ref, true, amt);
  return ref;
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
  update public.platform_modules set is_enabled = true, enabled_at = now(), enabled_by = ad, activation_note = 'proof' where key in ('v5_checkout', 'membership_two_member_tiers');
  update public.catalog_items set active = true where code in ('membership_upgrade_plus', 'membership_annual', 'membership_annual_no_panel');
end $$;

-- A. one open upgrade order at a time
do $$
declare ev uuid := pg_temp.mkuser('ev-a', 'patient'); r text;
begin
  insert into public.patient_memberships (organisation_id, patient_id, source, state, starts_at, ends_at, is_test, tier)
  values ('00000000-0000-0000-0000-000000000001', ev, 'purchase', 'active', now() - interval '100 days', now() + interval '265 days', true, 'evergreen');
  r := pg_temp.q_as(ev, $q$select public.create_order('membership_upgrade_plus', gen_random_uuid(), null, null, false, null, 'Oyo')::text$q$);
  if r like 'ERR:%' then raise exception 'FAIL first upgrade order refused: %', r; end if;
  r := pg_temp.q_as(ev, $q$select public.create_order('membership_upgrade_plus', gen_random_uuid())::text$q$);
  if r not like 'ERR:%upgrade_already_open%' then raise exception 'FAIL a second open upgrade order was accepted: %', r; end if;
end $$;

-- B, C, D. second order paid after the first; refund scope; schedule
do $$
declare ev uuid := pg_temp.mkuser('ev-b', 'patient'); ad uuid := (select v::uuid from fx where k = 'ad'); v_mem uuid; ref1 text; ref2 text;
        j jsonb; oid1 uuid; oid2 uuid; v_days integer; v_left integer; r text; v_refund uuid;
begin
  insert into public.patient_memberships (organisation_id, patient_id, source, state, starts_at, ends_at, is_test, tier)
  values ('00000000-0000-0000-0000-000000000001', ev, 'purchase', 'active', now() - interval '100 days', now() + interval '265 days', true, 'evergreen')
  returning id into v_mem;
  -- a NEWER ended membership with a short end date: the old schedule lookup (newest by start, any state) would have used this one
  insert into public.patient_memberships (organisation_id, patient_id, source, state, starts_at, ends_at, ended_at, end_reason, is_test, tier)
  values ('00000000-0000-0000-0000-000000000001', ev, 'purchase', 'ended', now() - interval '1 day', now() + interval '10 days', now(), 'proof decoy', true, 'evergreen');
  ref1 := pg_temp.mkorder(ev, 'membership_upgrade_plus');
  ref2 := pg_temp.mkorder(ev, 'membership_upgrade_plus');
  select id into oid1 from public.orders where paystack_reference = ref1;
  select id into oid2 from public.orders where paystack_reference = ref2;

  j := pg_temp.pay(ref1, 4500000);
  if j ->> 'result' <> 'paid' then raise exception 'FAIL first upgrade payment: %', j; end if;
  if (select upgraded_membership_id from public.orders where id = oid1) is distinct from v_mem then raise exception 'FAIL the order did not record the membership it upgraded'; end if;

  -- B. the second payment cannot buy anything
  j := pg_temp.pay(ref2, 4500000);
  if j ->> 'result' <> 'mismatch' or j ->> 'reason' <> 'upgrade_not_applicable' then raise exception 'FAIL a second upgrade payment was not refused as a mismatch: %', j; end if;
  if (select state from public.orders where id = oid2) = 'paid' then raise exception 'FAIL the second upgrade order was marked paid'; end if;
  if not exists (select 1 from public.payments where order_id = oid2 and status = 'mismatch' and mismatch_reason = 'upgrade_not_applicable') then raise exception 'FAIL the unusable payment was not recorded as a mismatch'; end if;
  if exists (select 1 from public.revenue_recognition_schedules where source_kind = 'order' and source_id = oid2) then raise exception 'FAIL deferred revenue booked for the unusable payment'; end if;

  -- D. schedule follows the upgraded membership
  perform private.post_order_to_ledger(oid1, true);
  select (s.period_end - s.period_start) into v_days from public.revenue_recognition_schedules s where s.source_kind = 'order' and s.source_id = oid1;
  select ((m.ends_at at time zone 'Africa/Lagos')::date - (now() at time zone 'Africa/Lagos')::date) into v_left from public.patient_memberships m where m.id = v_mem;
  if v_days is null or abs(v_days - v_left) > 1 then raise exception 'FAIL recognised over % days, % remain in the upgraded membership', v_days, v_left; end if;

  -- C. refund restores exactly the linked membership; with the link cleared nothing moves
  update public.orders set upgraded_membership_id = null where id = oid1;
  r := pg_temp.q_as(ev, format($q$select public.request_order_refund(%L, 'proof refund scope')::text$q$, oid1));
  v_refund := (r::jsonb ->> 'refund_id')::uuid;
  r := pg_temp.q_as(ad, format($q$select public.decide_order_refund(%L, true, 'approved in proof')::text$q$, v_refund));
  if r like 'ERR:%' then raise exception 'FAIL refund decision: %', r; end if;
  if (select tier from public.patient_memberships where id = v_mem) <> 'plus' then raise exception 'FAIL a refund with no linked membership changed a tier'; end if;
end $$;

do $$
declare ev uuid := pg_temp.mkuser('ev-c', 'patient'); ad uuid := (select v::uuid from fx where k = 'ad'); v_mem uuid; ref text; oid uuid; r text; v_refund uuid;
begin
  insert into public.patient_memberships (organisation_id, patient_id, source, state, starts_at, ends_at, is_test, tier)
  values ('00000000-0000-0000-0000-000000000001', ev, 'purchase', 'active', now() - interval '10 days', now() + interval '355 days', true, 'evergreen') returning id into v_mem;
  ref := pg_temp.mkorder(ev, 'membership_upgrade_plus');
  select id into oid from public.orders where paystack_reference = ref;
  perform pg_temp.pay(ref, 4500000);
  r := pg_temp.q_as(ev, format($q$select public.request_order_refund(%L, 'proof refund linked')::text$q$, oid));
  v_refund := (r::jsonb ->> 'refund_id')::uuid;
  r := pg_temp.q_as(ad, format($q$select public.decide_order_refund(%L, true, 'approved in proof')::text$q$, v_refund));
  if r like 'ERR:%' then raise exception 'FAIL refund decision: %', r; end if;
  if (select tier from public.patient_memberships where id = v_mem) <> 'evergreen' then raise exception 'FAIL the refund did not put back the upgraded membership'; end if;
end $$;

-- B sabotage: the payment-time guard removed; a second upgrade payment must then be accepted as paid (so the check above can fail)
do $$
declare d text; ev uuid := pg_temp.mkuser('ev-s', 'patient'); ref1 text; ref2 text; j jsonb;
begin
  d := pg_get_functiondef('public.record_order_payment(text,bigint,bigint,bigint,text,text,text,text,timestamptz,jsonb,bigint)'::regprocedure);
  d := replace(d, 'upgrade_not_applicable', 'upgrade_guard_disabled');
  d := replace(d, 'and m.tier = ''evergreen''
                        and m.ends_at is not null and m.ends_at > now()) then', 'and m.tier = ''evergreen''
                        and m.ends_at is not null and m.ends_at > now()) and false then');
  if d not like '%and false then%' then raise exception 'FAIL sabotage could not be applied (test is stale)'; end if;
  execute d;
  insert into public.patient_memberships (organisation_id, patient_id, source, state, starts_at, ends_at, is_test, tier)
  values ('00000000-0000-0000-0000-000000000001', ev, 'purchase', 'active', now() - interval '10 days', now() + interval '355 days', true, 'evergreen');
  ref1 := pg_temp.mkorder(ev, 'membership_upgrade_plus'); ref2 := pg_temp.mkorder(ev, 'membership_upgrade_plus');
  perform pg_temp.pay(ref1, 4500000);
  j := pg_temp.pay(ref2, 4500000);
  if j ->> 'result' = 'mismatch' then raise exception 'FAIL the mismatch check did not flip under sabotage'; end if;
end $$;

-- E. renewal in the grace is a new membership at the bought tier
do $$
declare pl uuid := pg_temp.mkuser('pl-e', 'patient'); ref text; j jsonb;
begin
  -- a Plus year that ended 3 days ago (inside the 14 day grace), still marked active until the renewal closes it
  insert into public.patient_memberships (organisation_id, patient_id, source, state, starts_at, ends_at, is_test, tier)
  values ('00000000-0000-0000-0000-000000000001', pl, 'purchase', 'active', now() - interval '368 days', now() - interval '3 days', true, 'plus');
  ref := pg_temp.mkorder(pl, 'membership_annual_no_panel');
  j := pg_temp.pay(ref, 8400000);
  if j ->> 'result' <> 'paid' then raise exception 'FAIL renewal payment: %', j; end if;
  if (select tier from public.patient_memberships where patient_id = pl and state = 'active') is distinct from 'evergreen' then
    raise exception 'FAIL a Plus holder who renewed on Membership kept Plus'; end if;
  if (select count(*) from public.patient_memberships where patient_id = pl and state = 'active') <> 1 then raise exception 'FAIL not exactly one active membership after the renewal'; end if;
end $$;

-- F. voucher guard by catalogue code
do $$
declare r text;
begin
  begin
    insert into public.care_vouchers (organisation_id, voucher_number, kind, sku_code, sku_name, face_value_kobo, status)
    values ('00000000-0000-0000-0000-000000000001', 'CV-RF-1', 'prepaid_service', 'membership_annual', 'Care voucher', 100000, 'reserved');
    r := 'ok';
  exception when others then r := sqlstate; end;
  if r <> '22023' then raise exception 'FAIL a voucher for a membership catalogue code was not refused: %', r; end if;
  begin
    insert into public.care_vouchers (organisation_id, voucher_number, kind, sku_code, sku_name, face_value_kobo, status)
    values ('00000000-0000-0000-0000-000000000001', 'CV-RF-2', 'prepaid_service', 'some_care_service', 'A gift for a Membership holder', 100000, 'reserved');
    r := 'ok';
  exception when others then r := sqlstate; end;
  if r = '22023' then raise exception 'FAIL a voucher was refused only because its name mentions membership'; end if;
end $$;

select 'PASS membership_ladder_review_fixes' as result;
rollback;
