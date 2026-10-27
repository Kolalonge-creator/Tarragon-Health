-- Proof: Membership ladder follow-ups (migration *_membership_ladder_followups.sql). Raises on any failed check. One rolled-back transaction.
--   * extension keeps the larger tier: an Membership holder who pays for Membership Plus is Plus with the end date extended; paying for
--     Membership never lowers a Plus holder
--   * a care voucher can never be a Membership
--   * renewal reminders carry the tier
--   * an organisation price cannot be set for Membership (no limits row for its code), only for Membership Plus, inside the floor/ceiling
--   * the admin grant with a tier choice
-- SABOTAGE: the extension patch is reversed; an Membership holder paying Plus must then stay Membership (the check above would flip).
begin;

create function pg_temp.mkuser(p_label text, p_role text) returns uuid language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'fu-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, '00000000-0000-0000-0000-000000000001', p_role::public.user_role, 'FU ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'),
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
create function pg_temp.try_owner(p_sql text) returns text language plpgsql as $f$ begin execute p_sql; return 'ok'; exception when others then return sqlstate || ':' || sqlerrm; end $f$;

-- pay an order for p_code for a patient who already holds a membership; returns the tier and end date afterwards
create function pg_temp.pay_for(p_patient uuid, p_code text) returns text language plpgsql as $f$
declare it uuid; pr uuid; oid uuid := gen_random_uuid(); ref text := 'tho_' || replace(gen_random_uuid()::text, '-', ''); r text; amt bigint;
begin
  select id into it from public.catalog_items where code = p_code order by created_at limit 1;
  select id, amount_kobo into pr, amt from public.prices where catalog_item_id = it and valid_to is null;
  insert into public.orders (id, organisation_id, buyer_profile_id, beneficiary_patient_id, catalog_item_id, price_id, amount_kobo, paystack_reference, is_test, list_amount_kobo)
  values (oid, '00000000-0000-0000-0000-000000000001', p_patient, p_patient, it, pr, amt, ref, true, amt);
  r := pg_temp.svc(format($q$select public.record_order_payment(%L, %s, 0, %s, 'NGN', 'success', 'webhook', %L, now(), '{}'::jsonb)::text$q$, ref, amt, amt, 'evt-' || ref));
  if r like 'ERR:%' then return r; end if;
  return (select tier || '|' || ends_at::date::text from public.patient_memberships where patient_id = p_patient and state = 'active');
end $f$;

create temp table fx(k text primary key, v text) on commit drop;
grant all on fx to public;

do $$
declare v_org uuid := '00000000-0000-0000-0000-000000000001'; a uuid := pg_temp.mkuser('eg-buys-plus', 'patient'); b uuid := pg_temp.mkuser('plus-buys-eg', 'patient');
        ad uuid := pg_temp.mkuser('admin', 'admin'); r text; v_end date; v_new date;
begin
  insert into fx values ('a', a::text), ('b', b::text), ('ad', ad::text);
  insert into public.patient_memberships (organisation_id, patient_id, source, state, starts_at, ends_at, is_test, tier)
  values (v_org, a, 'purchase', 'active', now() - interval '100 days', now() + interval '100 days', true, 'evergreen'),
         (v_org, b, 'purchase', 'active', now() - interval '100 days', now() + interval '100 days', true, 'plus');
  v_end := (now() + interval '100 days')::date;

  -- 1. extension keeps the larger tier
  r := pg_temp.pay_for(a, 'membership_annual');
  if r like 'ERR:%' then raise exception 'FAIL pay Plus for an Membership holder: %', r; end if;
  if split_part(r, '|', 1) <> 'plus' then raise exception 'FAIL an Membership holder who paid for Plus is still %', split_part(r, '|', 1); end if;
  v_new := split_part(r, '|', 2)::date;
  if v_new <= v_end + 300 then raise exception 'FAIL the end date was not extended (% -> %)', v_end, v_new; end if;
  r := pg_temp.pay_for(b, 'membership_annual_no_panel');
  if r like 'ERR:%' then raise exception 'FAIL pay Membership for a Plus holder: %', r; end if;
  if split_part(r, '|', 1) <> 'plus' then raise exception 'FAIL a Plus holder was lowered to %', split_part(r, '|', 1); end if;

  -- 3. a care voucher can never be a Membership
  r := pg_temp.try_owner($q$insert into public.care_vouchers (organisation_id, voucher_number, kind, sku_code, sku_name, face_value_kobo, status) values ('00000000-0000-0000-0000-000000000001', 'CV-FU-1', 'prepaid_service', 'membership_annual', 'Membership', 100000, 'reserved')$q$);
  if r not like '22023:%' then raise exception 'FAIL a Membership voucher was accepted: %', r; end if;

  -- 5. organisation prices per code
  r := pg_temp.try_owner(format($q$insert into public.organisation_member_prices (organisation_id, employer_organisation_id, catalog_item_id, amount_kobo, reason)
                                   select %L, null, id, 8400000, 'proof: an Membership only seat price' from public.catalog_items where code = 'membership_annual_no_panel'$q$, v_org));
  if r not like '22023:%' then raise exception 'FAIL an organisation price for Membership was accepted: %', r; end if;
end $$;

-- 4. reminders carry the tier; 6. the admin grant (pay-in-parts was removed by founder decision 2026-10-21, so there is nothing to refuse any more)
do $$
declare v_org uuid := '00000000-0000-0000-0000-000000000001'; ad uuid := (select v::uuid from fx where k = 'ad'); c uuid := pg_temp.mkuser('reminded', 'patient');
        g uuid := pg_temp.mkuser('granted', 'patient'); r text; n integer;
begin
  update public.platform_modules set is_enabled = true, enabled_at = now(), enabled_by = ad, activation_note = 'proof' where key = 'membership_two_member_tiers';

  insert into public.patient_memberships (organisation_id, patient_id, source, state, starts_at, ends_at, is_test, tier)
  values (v_org, c, 'purchase', 'active', now() - interval '336 days', now() + interval '29 days', true, 'evergreen');
  perform private.queue_membership_renewal_reminders();
  select count(*) into n from public.notifications where recipient_id = c and template = 'membership_renewal_reminder' and payload ->> 'tier' = 'evergreen';
  if n <> 1 then raise exception 'FAIL the reminder did not carry the tier (found %)', n; end if;

  r := pg_temp.q_as(ad, format($q$select public.grant_membership_tier(%L, 'evergreen', 'proof grant of Membership')::text$q$, g));
  if r like 'ERR:%' then raise exception 'FAIL admin grant of Membership: %', r; end if;
  if (select tier from public.patient_memberships where patient_id = g and state = 'active') <> 'evergreen' then raise exception 'FAIL granted tier'; end if;
  r := pg_temp.q_as(ad, format($q$select public.grant_membership_tier(%L, 'gold', 'proof grant of gold tier')::text$q$, pg_temp.mkuser('granted2', 'patient')));
  if r not like 'ERR:%membership_tier_invalid%' then raise exception 'FAIL a bad tier was accepted: %', r; end if;
  r := pg_temp.q_as(c, format($q$select public.grant_membership_tier(%L, 'plus', 'proof self grant attempt')::text$q$, c));
  if r not like 'ERR:%' then raise exception 'FAIL a patient granted themselves a tier: %', r; end if;
end $$;

-- SABOTAGE: the extension patch reversed; an Membership holder paying for Plus must then stay Membership
do $$
declare d text; x uuid := pg_temp.mkuser('sab', 'patient'); r text;
begin
  d := pg_get_functiondef('public.record_order_payment(text,bigint,bigint,bigint,text,text,text,text,timestamptz,jsonb,bigint)'::regprocedure);
  d := replace(d, 'tier = case when private.membership_tier_for_item(it.code) = ''plus'' then ''plus'' else tier end', 'tier = tier');
  execute d;
  insert into public.patient_memberships (organisation_id, patient_id, source, state, starts_at, ends_at, is_test, tier)
  values ('00000000-0000-0000-0000-000000000001', x, 'purchase', 'active', now() - interval '100 days', now() + interval '100 days', true, 'evergreen');
  r := pg_temp.pay_for(x, 'membership_annual');
  if split_part(r, '|', 1) = 'plus' then raise exception 'FAIL the extension check did not flip under sabotage'; end if;
end $$;

select 'PASS membership_ladder_followups' as result;
rollback;
