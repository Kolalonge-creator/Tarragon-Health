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
    (v_admin,   v_org, 'admin',   'S26 Admin')
  on conflict (id) do update
    set organisation_id = excluded.organisation_id, role = excluded.role, full_name = excluded.full_name;

  insert into public.catalog_items (id, organisation_id, code, kind, name_key, description_key, duration_days, active)
  values (v_item, v_org, 's26_test_pack', 'care_pack', 's26.test.name', 's26.test.description', 30, true);

  insert into public.prices (id, organisation_id, catalog_item_id, amount_kobo, components)
  values (v_price, v_org, v_item, 500000, '{}');

  insert into public.orders (id, organisation_id, buyer_profile_id, beneficiary_patient_id,
                             catalog_item_id, price_id, amount_kobo, fee_kobo, total_kobo, state, paid_at, paystack_reference, is_test)
  values
    (v_order,  v_org, v_patient, v_patient, v_item, v_price, 500000, 0, 500000, 'paid', now(), 's26-test-ref-1', true),
    (v_order2, v_org, v_patient, v_patient, v_item, v_price, 500000, 0, 500000, 'paid', now(), 's26-test-ref-2', true);

  insert into public.payments (organisation_id, order_id, provider, provider_reference, amount_kobo, total_kobo, status, source, is_test)
  values
    (v_org, v_order,  'paystack', 's26-test-ref-1', 500000, 500000, 'success', 'return', true),
    (v_org, v_order2, 'paystack', 's26-test-ref-2', 500000, 500000, 'success', 'return', true);

  insert into public.entitlements (id, organisation_id, patient_id, order_id, kind, starts_at, ends_at, remaining_uses, state, is_test)
  values
    (v_ent,  v_org, v_patient, v_order,  'care_pack', now() - interval '2 hours', now() - interval '1 hour', 3, 'active', true),
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
declare v_ent uuid; v_ent2 uuid; v_state text; v_state2 text;
begin
  select v into v_ent from s26_fixture where k = 'ent';
  select v into v_ent2 from s26_fixture where k = 'ent2';
  perform private.expire_entitlements();
  select state into v_state from public.entitlements where id = v_ent;
  select state into v_state2 from public.entitlements where id = v_ent2;
  insert into s26_result values ('expire_past_ent', 'postgres', v_state, 'expired', case when v_state = 'expired' then 'PASS' else 'FAIL' end);
  insert into s26_result values ('no_expire_future_ent', 'postgres', v_state2, 'active', case when v_state2 = 'active' then 'PASS' else 'FAIL' end);
end $$;

-- --------------------------------------------------------------------------
-- 3. Safety case 25: the 7-day reminder fires once, notifies only, never renews
-- --------------------------------------------------------------------------
do $$
declare
  v_ent2 uuid; v_patient uuid;
  v_first int; v_second int; v_notifs int; v_ends_before timestamptz; v_ends_after timestamptz; v_state text;
begin
  select v into v_ent2 from s26_fixture where k = 'ent2';
  select v into v_patient from s26_fixture where k = 'patient';
  select ends_at into v_ends_before from public.entitlements where id = v_ent2;

  v_first  := private.queue_entitlement_expiry_reminders();
  v_second := private.queue_entitlement_expiry_reminders();

  select count(*) into v_notifs from public.notifications
   where recipient_id = v_patient and template = 'entitlement_expiring_soon'
     and payload->>'entitlement_id' = v_ent2::text;
  select ends_at, state into v_ends_after, v_state from public.entitlements where id = v_ent2;

  insert into s26_result values ('reminder_sent_once', 'postgres',
    v_first || '/' || v_second || '/' || v_notifs, '1/0/1',
    case when v_first = 1 and v_second = 0 and v_notifs = 1 then 'PASS' else 'FAIL' end);
  insert into s26_result values ('reminder_never_renews', 'postgres',
    v_state || '/' || (v_ends_before = v_ends_after)::text, 'active/true',
    case when v_state = 'active' and v_ends_before = v_ends_after then 'PASS' else 'FAIL' end);
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
  insert into public.refunds (organisation_id, order_id, amount_kobo, reason, state, requested_by, is_test)
  values (
    (select v from s26_fixture where k = 'org'),
    v_order, 500000, 'S26 test reason', 'pending', v_patient, true
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

  reset role;
  perform set_config('request.jwt.claims', null, true);
  insert into s26_result values ('refund_rls_cross_patient', 'authenticated', v_count::text, '0', case when v_count = 0 then 'PASS' else 'FAIL' end);
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

  reset role;
  perform set_config('request.jwt.claims', null, true);
  insert into s26_result values ('refund_rls_own_patient', 'authenticated', v_count::text, '>=1', case when v_count >= 1 then 'PASS' else 'FAIL' end);
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
    insert into public.refunds (organisation_id, order_id, amount_kobo, reason, state, requested_by, is_test)
    values (v_org, v_order, 100000, 'S26 duplicate', 'pending', v_patient, true);
    insert into s26_result values ('one_live_refund_per_order', 'postgres', 'allowed duplicate', 'rejected duplicate', 'FAIL');
  exception when unique_violation then
    insert into s26_result values ('one_live_refund_per_order', 'postgres', 'rejected duplicate', 'rejected duplicate', 'PASS');
  end;
end $$;

-- --------------------------------------------------------------------------
-- 12. End-to-end RPC flow on order2: patient requests, duplicate is refused,
--     admin approves, entitlement is revoked and the order becomes refunded
-- --------------------------------------------------------------------------
do $$
declare
  v_patient uuid; v_admin uuid; v_order2 uuid; v_ent2 uuid;
  r1 jsonb; r2 jsonb; r3 jsonb;
  v_refund uuid; v_ent_state text; v_order_state text; v_refund_state text; v_self_blocked boolean;
begin
  select v into v_patient from s26_fixture where k = 'patient';
  select v into v_admin   from s26_fixture where k = 'admin';
  select v into v_order2  from s26_fixture where k = 'order2';
  select v into v_ent2    from s26_fixture where k = 'ent2';

  perform set_config('request.jwt.claims', json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  set local role authenticated;
  r1 := public.request_order_refund(v_order2, 'S26 changed my mind');
  r2 := public.request_order_refund(v_order2, 'S26 changed my mind again');
  reset role;

  insert into s26_result values ('rpc_request_then_duplicate', 'authenticated',
    (r1->>'result') || '/' || (r2->>'result'), 'requested/already_requested',
    case when r1->>'result' = 'requested' and r2->>'result' = 'already_requested' then 'PASS' else 'FAIL' end);

  v_refund := (r1->>'refund_id')::uuid;

  -- a non-admin patient must not be able to decide
  perform set_config('request.jwt.claims', json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.decide_order_refund(v_refund, true, 'self-approve');
    v_self_blocked := false;
  exception when others then
    v_self_blocked := true;
  end;
  reset role;
  insert into s26_result values ('patient_cannot_decide', 'authenticated',
    case when v_self_blocked then 'rejected' else 'allowed' end, 'rejected',
    case when v_self_blocked then 'PASS' else 'FAIL' end);

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  r3 := public.decide_order_refund(v_refund, true, 'S26 approve');
  reset role;
  perform set_config('request.jwt.claims', null, true);

  select state into v_ent_state    from public.entitlements where id = v_ent2;
  select state into v_order_state  from public.orders where id = v_order2;
  select state into v_refund_state from public.refunds where id = v_refund;

  insert into s26_result values ('approve_revokes_entitlement', 'authenticated',
    (r3->>'result') || '/' || v_refund_state || '/' || v_ent_state || '/' || v_order_state,
    'approved/approved/revoked/refunded',
    case when r3->>'result' = 'approved' and v_refund_state = 'approved'
          and v_ent_state = 'revoked' and v_order_state = 'refunded' then 'PASS' else 'FAIL' end);
end $$;

-- --------------------------------------------------------------------------
-- 13. Sabotage control: with the reminded_at stamp removed, the reminder fires
--     twice, proving check reminder_sent_once can actually fail. Rolled back.
-- --------------------------------------------------------------------------
do $$
declare v_ent2 uuid; v_first int; v_second int;
begin
  select v into v_ent2 from s26_fixture where k = 'ent2';
  update public.entitlements set reminded_at = null, state = 'active' where id = v_ent2;

  create or replace function private.queue_entitlement_expiry_reminders() returns integer
  language plpgsql security definer set search_path = '' as $f$
  declare r record; n integer := 0;
  begin
    for r in
      select e.id, e.patient_id, e.organisation_id, e.kind, e.ends_at
        from public.entitlements e
       where e.state = 'active' and e.ends_at is not null
         and e.ends_at > now() and e.ends_at <= now() + interval '7 days'
         and e.reminded_at is null
    loop
      n := n + 1;
    end loop;
    return n;
  end $f$;

  v_first  := private.queue_entitlement_expiry_reminders();
  v_second := private.queue_entitlement_expiry_reminders();
  insert into s26_result values ('sabotage_reminder_dup_detected', 'postgres',
    v_first || '/' || v_second, 'second call >= 1 when sabotaged',
    case when v_second >= 1 then 'PASS' else 'FAIL' end);
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
