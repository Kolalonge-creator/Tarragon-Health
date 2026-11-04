-- Proof: T2-01/T2-02/T2-05/T2-09 (migration *_t2_one_membership_100k_plus_retired.sql). One annual Membership at 100,000 naira,
-- Membership Plus retired, no new public testing day, employer seats on the Membership at 90,000 naira.
--   1. Catalogue: the Membership is on sale at 10,000,000 kobo; Membership Plus and the upgrade are not in the public catalogue.
--   2. Checkout (v5_checkout and the tier module on, as live): a Free patient's order for the Membership is created at 10,000,000 kobo;
--      an order for Plus or the upgrade is refused (item_not_available).
--   3. Employer seats: the default seat price is 9,000,000 kobo on the Membership item; an admin can set a per-organisation price on it
--      inside the limits; a seat price on the retired Plus item is refused; the seat summary reports the Membership item.
--   4. A membership granted with no tier is the Membership (evergreen).
--   5. A new public testing day is refused (testing_public_days_closed); an employer visit is not affected by that rule.
--   6. SABOTAGE (automatic): put Plus back on sale in this transaction and the catalogue check fails, so 1 is not vacuous.

begin;

create temp table fx(k text primary key, v text) on commit drop;
grant all on fx to public;
create function pg_temp.mkuser(p_label text, p_role text) returns uuid language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 't2m-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, '00000000-0000-0000-0000-000000000001', p_role::public.user_role, 'T2M ' || p_label, '+23481' || lpad((random() * 99999999)::int::text, 8, '0'),
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
  reset role;
  perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.sub', '', true); perform set_config('request.jwt.claim.role', '', true);
  return r;
end $f$;

do $$
declare
  v_admin uuid := pg_temp.mkuser('admin', 'admin');
  v_free uuid := pg_temp.mkuser('free', 'patient');
  v_eg uuid; v_plus uuid; v_up uuid; v_org uuid := '00000000-0000-0000-0000-000000000001';
  v_emp uuid;
  r text; o jsonb; v_n integer;
begin
  select id into v_eg from public.catalog_items where code = 'membership_annual_no_panel';
  select id into v_plus from public.catalog_items where code = 'membership_annual';
  select id into v_up from public.catalog_items where code = 'membership_upgrade_plus';

  -- the platform as it is live: checkout and the tier module on
  update public.platform_modules set is_enabled = true, enabled_at = now(), enabled_by = v_admin, activation_note = 't2 proof'
   where key in ('v5_checkout', 'membership_two_member_tiers');
  r := pg_temp.q_as(v_admin, $q$select public.attest_go_live_condition('membership_billing_enabled', 'refund_path_tested', true, 'T2 proof: refund path tested')$q$);
  r := pg_temp.q_as(v_admin, $q$select public.set_go_live_guard('membership_billing_enabled', true, 'T2 proof: Membership on sale as live')$q$);
  if r like 'ERR:%' then raise exception 'SETUP: could not open membership billing: %', r; end if;

  -- a Membership needs a doctor with a free lead slot (create_order: no_capacity otherwise); one test doctor, as s25 does
  declare v_doc uuid := pg_temp.mkuser('lead', 'clinician'); v_cs uuid; c text;
  begin
    insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
        license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, is_test)
    values (v_org, v_doc, 'T2M lead', 'MDCN', 'T2M-' || substr(v_doc::text, 1, 8), true, 'active', now(), v_admin,
        'senior_medical_officer', 'employed', 2, false, true)
    returning id into v_cs;
    foreach c in array array['adult_general', 'hypertension', 'lead_clinician'] loop
      insert into public.clinician_competencies (organisation_id, clinical_staff_id, competency_code, granted_by, is_test) values (v_org, v_cs, c, v_admin, true);
    end loop;
  end;

  -- 1. catalogue
  if (private.current_price(v_eg)).amount_kobo is distinct from 10000000 then raise exception 'FAIL 1: the Membership is not 100,000 naira'; end if;
  r := pg_temp.q_as(v_free, $q$select string_agg(x ->> 'code', ',' order by x ->> 'code') from jsonb_array_elements(to_jsonb(public.catalogue())) x where x ->> 'code' like 'membership%'$q$);
  if r is distinct from 'membership_annual_no_panel' then raise exception 'FAIL 1: the patient catalogue offers %, expected only the Membership', r; end if;

  -- 2. checkout
  r := pg_temp.q_as(v_free, $q$select public.create_order('membership_annual_no_panel', gen_random_uuid())::text$q$);
  if r like 'ERR:%' then raise exception 'FAIL 2: a Free patient could not order the Membership: %', r; end if;
  o := r::jsonb;
  if (o ->> 'amount_kobo')::bigint is distinct from 10000000
     or (select amount_kobo from public.orders where id = (o ->> 'order_id')::uuid) is distinct from 10000000 then
    raise exception 'FAIL 2: the Membership order is not 10,000,000 kobo: %', o;
  end if;
  r := pg_temp.q_as(pg_temp.mkuser('free2', 'patient'), $q$select public.create_order('membership_annual', gen_random_uuid())::text$q$);
  if r not like 'ERR:%item_not_available%' then raise exception 'FAIL 2: Membership Plus can still be ordered: %', r; end if;
  r := pg_temp.q_as(pg_temp.mkuser('free3', 'patient'), $q$select public.create_order('membership_upgrade_plus', gen_random_uuid())::text$q$);
  if r not like 'ERR:%item_not_available%' and r not like 'ERR:%upgrade_not_available%' then raise exception 'FAIL 2: the Plus upgrade can still be ordered: %', r; end if;

  -- 3. employer seats
  if (select amount_kobo from private.organisation_member_price(gen_random_uuid(), v_eg)) is distinct from 9000000 then
    raise exception 'FAIL 3: the default seat price on the Membership item is not 90,000 naira';
  end if;
  insert into public.organisations (name, type) values ('T2M Employer', 'corporate') returning id into v_emp;
  r := pg_temp.q_as(v_admin, format($q$select public.set_organisation_member_price(%L, 8500000, 'T2 proof negotiated seat price')::text$q$, v_emp));
  if r like 'ERR:%' then raise exception 'FAIL 3: an admin could not set a Membership seat price inside the limits: %', r; end if;
  if (select amount_kobo from private.organisation_member_price(v_emp, v_eg)) is distinct from 8500000 then
    raise exception 'FAIL 3: the per-organisation Membership seat price did not take effect';
  end if;
  begin
    insert into public.organisation_member_prices (organisation_id, employer_organisation_id, catalog_item_id, amount_kobo, valid_from, reason)
    values (v_org, v_emp, v_plus, 9000000, now() + interval '1 day', 'T2 proof: a seat on the retired Plus item');
    raise exception 'FAIL 3: a seat price on the retired Plus item was accepted';
  exception when others then
    if sqlerrm like 'FAIL 3:%' then raise; end if;
  end;
  r := pg_temp.q_as(v_admin, format($q$select public.organisation_seat_summary(%L)::text$q$, v_emp));
  if r like 'ERR:%' or position(v_eg::text in r) = 0 then raise exception 'FAIL 3: the seat summary does not report the Membership item: %', r; end if;

  -- 4. default tier
  declare v_g uuid := pg_temp.mkuser('granted', 'patient');
  begin
    insert into public.patient_memberships (organisation_id, patient_id, source, state, starts_at, ends_at, is_test)
    values (v_org, v_g, 'purchase', 'active', now() - interval '1 day', now() + interval '300 days', true);
    v_n := case when (select tier from public.patient_memberships where patient_id = v_g) = 'evergreen' then 1 else 0 end;
  end;
  if v_n <> 1 then
    raise exception 'FAIL 4: a membership with no stated tier is not the Membership';
  end if;

  -- 5. no new public testing day
  r := pg_temp.q_as(v_admin, $q$select public.create_testing_event('public_day', current_date + 30, '09:00', '13:00', 'Hall', '1 Road', 'Lagos', 'Ikeja', 'Lagos', 50, null)::text$q$);
  if r not like 'ERR:%testing_public_days_closed%' then raise exception 'FAIL 5: a new public testing day was not refused: %', r; end if;
  r := pg_temp.q_as(v_admin, $q$select public.create_testing_event('employer_visit', current_date + 30, '09:00', '13:00', 'Office', '1 Road', 'Lagos', 'Ikeja', 'Lagos', 50, null)::text$q$);
  if r like 'ERR:%testing_public_days_closed%' then raise exception 'FAIL 5: an employer visit was refused by the public-day rule'; end if;

  -- 6. SABOTAGE: Plus back on sale -> the catalogue check must fail
  update public.catalog_items set active = true where id = v_plus;
  r := pg_temp.q_as(v_free, $q$select string_agg(x ->> 'code', ',' order by x ->> 'code') from jsonb_array_elements(to_jsonb(public.catalogue())) x where x ->> 'code' like 'membership%'$q$);
  if r is not distinct from 'membership_annual_no_panel' then raise exception 'FAIL 6 (sabotage): with Plus on sale the catalogue check still passes, so check 1 is vacuous'; end if;
  update public.catalog_items set active = false where id = v_plus;

  raise notice 'ALL CHECKS PASSED';
end $$;

rollback;
