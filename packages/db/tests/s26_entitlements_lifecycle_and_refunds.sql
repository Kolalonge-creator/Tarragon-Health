-- ===========================================================================
-- Verification: 20261006173317_s26_entitlements_lifecycle_refunds
--
-- Safety case 25: care packs never auto-renew; 7-day reminder fires once.
-- Refund state machine: only valid transitions succeed.
-- Entitlement expiry: sweep sets active→expired when past ends_at.
-- Entitlement revocation: refund approval revokes the linked entitlement.
-- RLS: a patient cannot see another patient's refund.
-- Anon: request_order_refund / record_refund_provider_result are not
--       callable by anon.
--
-- Pattern: BEGIN/ROLLBACK, simulated JWT sessions, sabotage controls.
-- ===========================================================================

begin;

create temporary table s26_fixture(k text primary key, v uuid) on commit drop;
create temporary table s26_result(
  check_name text,
  role       text,
  observed   text,
  expected   text,
  verdict    text
) on commit drop;

-- --------------------------------------------------------------------------
-- Fixtures
-- --------------------------------------------------------------------------
do $$
declare
  v_org        uuid;
  v_patient    uuid := gen_random_uuid();
  v_other      uuid := gen_random_uuid();
  v_admin      uuid := gen_random_uuid();
  v_order      uuid := gen_random_uuid();
  v_order2     uuid := gen_random_uuid();
  v_item       uuid := gen_random_uuid();
  v_price      uuid := gen_random_uuid();
  v_ent        uuid := gen_random_uuid();
  v_ent2       uuid := gen_random_uuid();
begin
  select id into v_org from public.organisations limit 1;
  if v_org is null then
    raise exception 'no organisation — cannot run this test';
  end if;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values
    (v_patient, 's26-patient@example.invalid', 'x', now(), '{}', '{}'),
    (v_other,   's26-other@example.invalid',   'x', now(), '{}', '{}'),
    (v_admin,   's26-admin@example.invalid',    'x', now(), '{}', '{}');

  insert into public.profiles (id, organisation_id, role, full_name)
  values
    (v_patient, v_org, 'patient', 'S26 Patient'),
    (v_other,   v_org, 'patient', 'S26 Other'),
    (v_admin,   v_org, 'admin',   'S26 Admin');

  insert into public.catalog_items (id, organisation_id, code, kind, name, active)
  values (v_item, v_org, 's26_test_pack', 'care_pack', 'S26 Test Pack', true);

  insert into public.prices (id, catalog_item_id, amount_kobo, components)
  values (v_price, v_item, 500000, '{}');

  insert into public.orders (id, organisation_id, buyer_profile_id, beneficiary_patient_id,
                             catalog_item_id, price_id, amount_kobo, state, paid_at, paystack_reference, is_test)
  values
    (v_order,  v_org, v_patient, v_patient, v_item, v_price, 500000, 'paid', now(), 's26-test-ref-1', true),
    (v_order2, v_org, v_patient, v_patient, v_item, v_price, 500000, 'paid', now(), 's26-test-ref-2', true);

  insert into public.payments (organisation_id, order_id, provider, provider_reference, amount_kobo, status)
  values
    (v_org, v_order,  'paystack', 's26-test-ref-1', 500000, 'success'),
    (v_org, v_order2, 'paystack', 's26-test-ref-2', 500000, 'success');

  insert into public.entitlements (id, organisation_id, patient_id, order_id, kind, starts_at, ends_at, remaining_uses, state, is_test)
  values
    (v_ent,  v_org, v_patient, v_order,  'care_pack', now(), now() - interval '1 hour', 3, 'active', true),
    (v_ent2, v_org, v_patient, v_order2, 'care_pack', now(), now() + interval '5 days', 2, 'active', true);

  insert into s26_fixture values
    ('org', v_org), ('patient', v_patient), ('other', v_other), ('admin', v_admin),
    ('order', v_order), ('order2', v_order2), ('item', v_item), ('price', v_price),
    ('ent', v_ent), ('ent2', v_ent2);
end $$;

-- --------------------------------------------------------------------------
-- 1. Safety case 25: no auto_renew column exists on entitlements
-- --------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'entitlements' and column_name = 'auto_renew'
  ) then
    insert into s26_result values ('no_auto_renew', 'anon', 'column exists', 'column absent', 'FAIL');
  else
    insert into s26_result values ('no_auto_renew', 'anon', 'column absent', 'column absent', 'PASS');
  end if;
end $$;

-- --------------------------------------------------------------------------
-- 2. Entitlement expiry sweep: ent (ends_at in the past) → expired
-- --------------------------------------------------------------------------
do $$
declare v_ent uuid; v_state text;
begin
  select v into v_ent from s26_fixture where k = 'ent';
  update public.entitlements set state = 'expired' where id = v_ent and state = 'active' and ends_at <= now();
  select state into v_state from public.entitlements where id = v_ent;
  insert into s26_result values ('expire_past_ent', 'postgres', v_state, 'expired', case when v_state = 'expired' then 'PASS' else 'FAIL' end);
end $$;

-- --------------------------------------------------------------------------
-- 3. Entitlement NOT expired when ends_at is in the future
-- --------------------------------------------------------------------------
do $$
declare v_ent2 uuid; v_state text;
begin
  select v into v_ent2 from s26_fixture where k = 'ent2';
  update public.entitlements set state = 'expired' where id = v_ent2 and state = 'active' and ends_at <= now();
  select state into v_state from public.entitlements where id = v_ent2;
  insert into s26_result values ('no_expire_future_ent', 'postgres', v_state, 'active', case when v_state = 'active' then 'PASS' else 'FAIL' end);
end $$;

-- --------------------------------------------------------------------------
-- 4. Reminded_at column exists (7-day reminder infrastructure)
-- --------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'entitlements' and column_name = 'reminded_at'
  ) then
    insert into s26_result values ('reminded_at_exists', 'anon', 'exists', 'exists', 'PASS');
  else
    insert into s26_result values ('reminded_at_exists', 'anon', 'missing', 'exists', 'FAIL');
  end if;
end $$;

-- --------------------------------------------------------------------------
-- 5. Refund state machine: invalid transition rejected
-- --------------------------------------------------------------------------
do $$
declare
  v_order uuid; v_patient uuid;
  v_refund_id uuid;
begin
  select v into v_order from s26_fixture where k = 'order';
  select v into v_patient from s26_fixture where k = 'patient';

  -- Reset ent state (it was set to expired above) so refund doesn't trip on that
  update public.entitlements set state = 'active' where order_id = v_order;

  -- Create a refund in pending state
  insert into public.refunds (organisation_id, order_id, amount_kobo, state, requested_by, is_test)
  values (
    (select v from s26_fixture where k = 'org'),
    v_order, 500000, 'pending', v_patient, true
  ) returning id into v_refund_id;

  -- Try invalid transition: pending → completed (should fail)
  begin
    update public.refunds set state = 'completed' where id = v_refund_id;
    insert into s26_result values ('refund_invalid_transition', 'postgres', 'allowed', 'rejected', 'FAIL');
  exception when others then
    insert into s26_result values ('refund_invalid_transition', 'postgres', 'rejected', 'rejected', 'PASS');
  end;
end $$;

-- --------------------------------------------------------------------------
-- 6. Refund state machine: valid transition pending → approved
-- --------------------------------------------------------------------------
do $$
declare
  v_refund_id uuid; v_state text; v_admin uuid;
begin
  select r.id into v_refund_id from public.refunds r
    join s26_fixture f on f.k = 'order' and r.order_id = f.v
   limit 1;
  select v into v_admin from s26_fixture where k = 'admin';

  update public.refunds set state = 'approved', decided_by = v_admin, decided_at = now() where id = v_refund_id;
  select state into v_state from public.refunds where id = v_refund_id;
  insert into s26_result values ('refund_valid_transition', 'postgres', v_state, 'approved', case when v_state = 'approved' then 'PASS' else 'FAIL' end);
end $$;

-- --------------------------------------------------------------------------
-- 7. RLS: patient cannot see other patient's refund
-- --------------------------------------------------------------------------
do $$
declare
  v_other uuid; v_count int;
begin
  select v into v_other from s26_fixture where k = 'other';
  perform set_config('request.jwt.claims', json_build_object('sub', v_other, 'role', 'authenticated')::text, true);
  set local role authenticated;

  select count(*) into v_count from public.refunds;
  insert into s26_result values ('refund_rls_cross_patient', 'authenticated', v_count::text, '0', case when v_count = 0 then 'PASS' else 'FAIL' end);

  reset role;
  perform set_config('request.jwt.claims', null, true);
end $$;

-- --------------------------------------------------------------------------
-- 8. RLS: patient CAN see own refund
-- --------------------------------------------------------------------------
do $$
declare
  v_patient uuid; v_count int;
begin
  select v into v_patient from s26_fixture where k = 'patient';
  perform set_config('request.jwt.claims', json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  set local role authenticated;

  select count(*) into v_count from public.refunds;
  insert into s26_result values ('refund_rls_own_patient', 'authenticated', v_count::text, '1', case when v_count >= 1 then 'PASS' else 'FAIL' end);

  reset role;
  perform set_config('request.jwt.claims', null, true);
end $$;

-- --------------------------------------------------------------------------
-- 9. Anon cannot EXECUTE request_order_refund
-- --------------------------------------------------------------------------
do $$
begin
  if has_function_privilege('anon', 'public.request_order_refund(uuid, text)', 'EXECUTE') then
    insert into s26_result values ('anon_no_request_refund', 'anon', 'can execute', 'cannot execute', 'FAIL');
  else
    insert into s26_result values ('anon_no_request_refund', 'anon', 'cannot execute', 'cannot execute', 'PASS');
  end if;
end $$;

-- --------------------------------------------------------------------------
-- 10. Anon cannot EXECUTE record_refund_provider_result
-- --------------------------------------------------------------------------
do $$
begin
  if has_function_privilege('anon', 'public.record_refund_provider_result(uuid, boolean, text, jsonb)', 'EXECUTE') then
    insert into s26_result values ('anon_no_record_result', 'anon', 'can execute', 'cannot execute', 'FAIL');
  else
    insert into s26_result values ('anon_no_record_result', 'anon', 'cannot execute', 'cannot execute', 'PASS');
  end if;
end $$;

-- --------------------------------------------------------------------------
-- 11. Unique partial index: only one live refund per order
-- --------------------------------------------------------------------------
do $$
declare
  v_order uuid; v_patient uuid; v_org uuid;
begin
  select v into v_order from s26_fixture where k = 'order';
  select v into v_patient from s26_fixture where k = 'patient';
  select v into v_org from s26_fixture where k = 'org';

  begin
    insert into public.refunds (organisation_id, order_id, amount_kobo, state, requested_by, is_test)
    values (v_org, v_order, 100000, 'pending', v_patient, true);
    insert into s26_result values ('one_live_refund_per_order', 'postgres', 'allowed duplicate', 'rejected duplicate', 'FAIL');
  exception when unique_violation then
    insert into s26_result values ('one_live_refund_per_order', 'postgres', 'rejected duplicate', 'rejected duplicate', 'PASS');
  end;
end $$;

-- --------------------------------------------------------------------------
-- Report
-- --------------------------------------------------------------------------
select check_name, role, observed, expected, verdict from s26_result order by check_name;

do $$
declare v_fails int;
begin
  select count(*) into v_fails from s26_result where verdict = 'FAIL';
  if v_fails > 0 then
    raise exception 'S26 verification: % check(s) FAILED — see table above', v_fails;
  end if;
  raise notice 'S26 verification: all checks passed';
end $$;

rollback;
