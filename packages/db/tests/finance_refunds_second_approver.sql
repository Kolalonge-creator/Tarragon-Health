-- ===========================================================================
-- Proof: 20261107035055_finance_v2_refunds_workspace_and_second_approver.sql
--
-- WHAT IT PROVES.
--   * With no threshold set, one approval approves a refund (today's behaviour is kept).
--   * The finance role, an admin and a member granted finance.refunds.approve may decide;
--     a finance.view-only member and a patient may not (42501).
--   * Only an admin sets the threshold, with a reason, and it is audited; finance cannot.
--   * A refund held for a second approval stays held if the threshold is later cleared.
--   * Only someone who can decide sees a patient's free-text reason.
--   * At or above the threshold the first approval leaves the refund pending
--     ('awaiting_second_approval'); the same person approving again is refused
--     ('same_approver'); a different person's approval approves it, and both are audited.
--   * Below the threshold one approval is still enough.
--   * Nobody decides a refund they requested ('own_request').
--   * The table refuses the same person as first approver and decider.
--   * The shared queue is readable by finance (with can_decide false for view-only) and
--     refused to a patient.
--   * A refund paid from a legacy refund queue is linked to its charge: the directory
--     shows the payment as refunded, and refunded_at, not a later updated_at, dates it.
--   * orders.failed_at is stamped when an order fails.
-- SABOTAGE. The threshold lookup is replaced with one that always returns null; the
-- large refund is then approved by one person and the second-approver check fails.
--
-- Fixtures in March 2020; triggers off while fixtures are written. BEGIN/ROLLBACK.
-- Run: psql "$DB_URL" -v ON_ERROR_STOP=1 -f packages/db/tests/finance_refunds_second_approver.sql
-- ===========================================================================

begin;
create temporary table frs_checks(msg text) on commit drop;
create temporary table frs_fix(k text primary key, v uuid) on commit drop;
create temporary table frs_out(k text primary key, v jsonb) on commit drop;
grant all on frs_checks, frs_fix, frs_out to authenticated;

do $$
declare
  c_org constant uuid := (select id from public.organisations order by created_at limit 1);
  c_item constant uuid := (select id from public.catalog_items where kind = 'membership' order by created_at limit 1);
  c_price constant uuid := (select id from public.prices order by created_at limit 1);
  c_product constant uuid := (select id from public.service_products order by created_at limit 1);
  v_admin uuid := gen_random_uuid();
  v_fin uuid := gen_random_uuid();
  v_granted uuid := gen_random_uuid();
  v_viewer uuid := gen_random_uuid();
  v_pat uuid := gen_random_uuid();
  v_o uuid[] := array[gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid()];
  v_r uuid[] := array[gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid()];
  v_sp uuid := gen_random_uuid();
  v_ptx uuid := gen_random_uuid();
  i int;
begin
  set local session_replication_role = replica;
  insert into auth.users (id, email, aud, role)
  select x, x::text || '@frs.test', 'authenticated', 'authenticated' from unnest(array[v_admin, v_fin, v_granted, v_viewer, v_pat]) x;
  insert into public.profiles (id, organisation_id, role, full_name, is_active, is_test) values
    (v_admin,   c_org, 'admin',   'FRS Admin',   true, false),
    (v_fin,     c_org, 'finance', 'FRS Finance', true, false),
    (v_granted, c_org, 'patient', 'FRS Granted', true, false),
    (v_viewer,  c_org, 'patient', 'FRS Viewer',  true, false),
    (v_pat,     c_org, 'patient', 'FRS Patient', true, false)
  on conflict (id) do update set role = excluded.role, full_name = excluded.full_name, is_active = true, is_test = false,
    organisation_id = excluded.organisation_id;
  insert into public.user_permission_grants (profile_id, permission_key) values
    (v_granted, 'finance.refunds.approve'), (v_granted, 'finance.view'), (v_viewer, 'finance.view');

  for i in 1..4 loop
    insert into public.orders (id, organisation_id, buyer_profile_id, beneficiary_patient_id, catalog_item_id, price_id,
                               amount_kobo, fee_kobo, total_kobo, state, paid_at, paystack_reference, is_test)
    values (v_o[i], c_org, v_pat, v_pat, c_item, c_price, case when i = 3 then 1000000 else 10000000 end, 0,
            case when i = 3 then 1000000 else 10000000 end, 'paid', '2020-03-01 10:00+01', 'FRSREF000' || i, false);
    insert into public.refunds (id, organisation_id, order_id, amount_kobo, reason, state, provider, requested_by, is_test)
    values (v_r[i], c_org, v_o[i], case when i = 3 then 1000000 else 10000000 end, 'fixture refund ' || i, 'pending', 'paystack',
            case when i = 4 then v_fin else v_pat end, false);
  end loop;

  -- a legacy doctor-service charge, refunded through the guarantee queue
  if c_product is not null then
    insert into public.service_purchases (id, organisation_id, patient_id, service_product_id, amount_kobo, currency)
    values (v_sp, c_org, v_pat, c_product, 2500000, 'NGN');
    insert into public.payment_transactions (id, organisation_id, provider, provider_event_id, event_type, amount_minor, currency, raw_payload, created_at, is_test)
    values (v_ptx, c_org, 'paystack', 'frs-evt', 'charge.success', 2500000, 'NGN',
            '{"data":{"reference":"FRSPTX1","metadata":{"kind":"service_purchase"}}}', '2020-03-02 10:00+01', false);
    insert into public.service_purchase_guarantee_claims (id, organisation_id, patient_id, service_purchase_id, status)
    values (v_ptx, c_org, v_pat, v_sp, 'approved');
    insert into public.service_purchase_refund_queue (service_purchase_id, guarantee_claim_id, provider, provider_reference, amount_minor, currency, status, updated_at)
    values (v_sp, v_ptx, 'paystack', 'FRSPTX1', 2500000, 'NGN', 'due', '2020-03-03 10:00+01');
  end if;
  set local session_replication_role = origin;

  -- the queue row is refunded now: refunded_at is stamped by the trigger
  update public.service_purchase_refund_queue set status = 'refunded' where service_purchase_id = v_sp;

  insert into frs_fix values ('admin', v_admin), ('fin', v_fin), ('granted', v_granted), ('viewer', v_viewer), ('pat', v_pat),
    ('r1', v_r[1]), ('r2', v_r[2]), ('r3', v_r[3]), ('r4', v_r[4]), ('ptx', v_ptx), ('sp', v_sp);
end $$;

create or replace function pg_temp.frs_as(p_key text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', (select v from frs_fix where k = p_key), 'role', 'authenticated')::text, true);
end $$;
create or replace function pg_temp.frs_try(p_refund text, p_ok boolean, p_note text default null) returns text language plpgsql as $$
begin
  return public.decide_order_refund((select v from frs_fix where k = p_refund), p_ok, p_note) ->> 'result';
exception when insufficient_privilege then
  return 'refused';
end $$;

-- 1. no threshold: finance approves refund 1 in one step
select pg_temp.frs_as('fin'); set local role authenticated;
insert into frs_out select 'r1', to_jsonb(pg_temp.frs_try('r1', true));
-- view-only and patient refused
reset role; select pg_temp.frs_as('viewer'); set local role authenticated;
insert into frs_out select 'viewer_decide', to_jsonb(pg_temp.frs_try('r2', true));
insert into frs_out select 'viewer_queue', public.finance_refund_queue();
create or replace function pg_temp.frs_set(p bigint, p_reason text) returns text language plpgsql as $$
begin
  perform public.finance_set_refund_second_approval_threshold(p, p_reason);
  return 'set';
exception when insufficient_privilege then return 'refused';
end $$;
insert into frs_out select 'viewer_set', to_jsonb(pg_temp.frs_set(5000000, 'viewer should not set this'));
reset role; select pg_temp.frs_as('pat'); set local role authenticated;
insert into frs_out select 'pat_decide', to_jsonb(pg_temp.frs_try('r2', true));
do $$ begin
  perform public.finance_refund_queue();
  insert into frs_out values ('pat_queue', '"allowed"');
exception when insufficient_privilege then insert into frs_out values ('pat_queue', '"refused"');
end $$;

-- 2. finance may not set the threshold; an admin sets 50,000 naira
reset role; select pg_temp.frs_as('fin'); set local role authenticated;
insert into frs_out select 'fin_set', to_jsonb(pg_temp.frs_set(5000000, 'finance trying to set the rule it is bound by'));
reset role; select pg_temp.frs_as('admin'); set local role authenticated;
do $$ begin
  perform public.finance_set_refund_second_approval_threshold(5000000, 'short');
  insert into frs_out values ('no_reason', '"accepted"');
exception when invalid_parameter_value then insert into frs_out values ('no_reason', '"refused"');
end $$;
insert into frs_out select 'admin_set', to_jsonb(pg_temp.frs_set(5000000, 'Two people approve refunds of 50,000 naira or more'));

-- 3. refund 2 (100,000 naira): finance first, finance again, then admin
reset role; select pg_temp.frs_as('fin'); set local role authenticated;
insert into frs_out select 'r2_first', to_jsonb(pg_temp.frs_try('r2', true, 'checked the charge'));
insert into frs_out select 'r2_again', to_jsonb(pg_temp.frs_try('r2', true));
-- refund 4 was requested by finance: finance cannot decide it
insert into frs_out select 'r4_own', to_jsonb(pg_temp.frs_try('r4', true));
reset role; select pg_temp.frs_as('admin'); set local role authenticated;
insert into frs_out select 'r2_second', to_jsonb(pg_temp.frs_try('r2', true, 'second check'));
-- 4. refund 3 (10,000 naira, below the threshold): the granted member approves alone
reset role; select pg_temp.frs_as('granted'); set local role authenticated;
insert into frs_out select 'r3', to_jsonb(pg_temp.frs_try('r3', true));
insert into frs_out select 'granted_queue', public.finance_refund_queue();
-- directory, for the legacy refund link
insert into frs_out select 'dir', public.finance_transactions_list('2020-03-01', '2026-12-31', p_event_kinds => array['payment']);
reset role;

-- ---- assertions -------------------------------------------------------------
create or replace function pg_temp.frs_out(p text) returns text language sql as $$ select v #>> '{}' from frs_out where k = p $$;

do $$
begin
  if pg_temp.frs_out('r1') <> 'approved' then raise exception 'FAIL: with no threshold one approval should approve (got %)', pg_temp.frs_out('r1'); end if;
  insert into frs_checks values ('PASS: with no threshold set, one approval approves (today''s behaviour)');

  if pg_temp.frs_out('viewer_decide') <> 'refused' or pg_temp.frs_out('pat_decide') <> 'refused'
     or pg_temp.frs_out('viewer_set') <> 'refused' or pg_temp.frs_out('pat_queue') <> 'refused' then
    raise exception 'FAIL: view-only or patient access: % % % %', pg_temp.frs_out('viewer_decide'), pg_temp.frs_out('pat_decide'),
      pg_temp.frs_out('viewer_set'), pg_temp.frs_out('pat_queue');
  end if;
  if ((select v from frs_out where k = 'viewer_queue') ->> 'can_decide')::boolean then
    raise exception 'FAIL: the queue tells a view-only member they can decide';
  end if;
  insert into frs_checks values ('PASS: view-only and patient cannot decide or set the threshold; view-only reads the queue with can_decide false; patient refused the queue');

  if pg_temp.frs_out('no_reason') <> 'refused' or pg_temp.frs_out('fin_set') <> 'refused' or pg_temp.frs_out('admin_set') <> 'set'
     or not exists (select 1 from public.audit_log where action = 'finance.refund_threshold.set' and actor_id = (select v from frs_fix where k = 'admin')) then
    raise exception 'FAIL: threshold setting (reason rule, admin-only, audit): % % %', pg_temp.frs_out('no_reason'), pg_temp.frs_out('fin_set'), pg_temp.frs_out('admin_set');
  end if;
  insert into frs_checks values ('PASS: only an admin sets the threshold, with a reason, and it is audited');

  if pg_temp.frs_out('r4_own') <> 'own_request' then raise exception 'FAIL: a requester decided their own refund'; end if;
  insert into frs_checks values ('PASS: nobody decides a refund they requested');

  if (select ((select v from frs_out where k = 'granted_queue') -> 'refunds') @> '[{"state":"approved"}]') is not true then
    raise exception 'FAIL: the queue does not list approved refunds';
  end if;
  if pg_temp.frs_out('r3') <> 'approved' then raise exception 'FAIL: a below-threshold refund needed two approvals'; end if;
  insert into frs_checks values ('PASS: a granted member approves a below-threshold refund alone');

  if (select v from frs_out where k = 'dir') is null
     or (select (r ->> 'refunded_minor')::bigint from jsonb_array_elements((select v from frs_out where k = 'dir') -> 'rows') r
          where r ->> 'reference' = 'FRSPTX1') is distinct from 2500000 then
    raise exception 'FAIL: the legacy charge is not shown as refunded: %',
      (select r from jsonb_array_elements((select v from frs_out where k = 'dir') -> 'rows') r where r ->> 'reference' = 'FRSPTX1');
  end if;
  if (select refunded_at from public.service_purchase_refund_queue where service_purchase_id = (select v from frs_fix where k = 'sp')) is null then
    raise exception 'FAIL: refunded_at was not stamped';
  end if;
  insert into frs_checks values ('PASS: a legacy queue refund is linked to its charge, and refunded_at dates it');
end $$;

create or replace function pg_temp.frs_assert_two_approvers() returns void language plpgsql as $$
declare r public.refunds;
begin
  select * into r from public.refunds where id = (select v from frs_fix where k = 'r2');
  if pg_temp.frs_out('r2_first') <> 'awaiting_second_approval' then
    raise exception 'FAIL: a large refund was not held for a second approver (got %)', pg_temp.frs_out('r2_first');
  end if;
  if pg_temp.frs_out('r2_again') <> 'same_approver' then raise exception 'FAIL: the first approver approved twice'; end if;
  if pg_temp.frs_out('r2_second') <> 'approved' or r.state <> 'approved'
     or r.first_approved_by <> (select v from frs_fix where k = 'fin') or r.decided_by <> (select v from frs_fix where k = 'admin') then
    raise exception 'FAIL: second approval did not approve with two different people recorded';
  end if;
  if (select count(*) from public.audit_log where entity_id = r.id and action in ('refund.first_approval', 'refund.approved')) <> 2 then
    raise exception 'FAIL: the two approvals were not both audited';
  end if;
end $$;
select pg_temp.frs_assert_two_approvers();
insert into frs_checks values ('PASS: a large refund needs two different approvers, and both are audited');

do $$
begin
  begin
    update public.refunds set decided_by = first_approved_by where id = (select v from frs_fix where k = 'r2');
    raise exception 'FAIL: the table accepted the same person as first approver and decider';
  exception when check_violation then null;
  end;
  insert into frs_checks values ('PASS: the table refuses the same first approver and decider');
end $$;

do $$
declare v_fail uuid := gen_random_uuid();
begin
  set local session_replication_role = replica;
  insert into public.orders (id, organisation_id, buyer_profile_id, beneficiary_patient_id, catalog_item_id, price_id, amount_kobo, state, paystack_reference, is_test)
  values (v_fail, (select id from public.organisations order by created_at limit 1), (select v from frs_fix where k = 'pat'), (select v from frs_fix where k = 'pat'),
          (select id from public.catalog_items where kind = 'membership' order by created_at limit 1), (select id from public.prices order by created_at limit 1),
          10000000, 'created', 'FRSFAIL01', false);
  set local session_replication_role = origin;
  update public.orders set state = 'failed' where id = v_fail;
  if (select failed_at from public.orders where id = v_fail) is null then raise exception 'FAIL: failed_at not stamped'; end if;
  insert into frs_checks values ('PASS: orders.failed_at is stamped when an order fails');
end $$;

-- ---- a held refund stays held when the threshold is cleared -------------------------
do $$
declare v_o uuid := gen_random_uuid(); v_r uuid := gen_random_uuid();
begin
  set local session_replication_role = replica;
  insert into public.orders (id, organisation_id, buyer_profile_id, beneficiary_patient_id, catalog_item_id, price_id, amount_kobo, fee_kobo, total_kobo, state, paid_at, paystack_reference, is_test)
  values (v_o, (select id from public.organisations order by created_at limit 1), (select v from frs_fix where k = 'pat'), (select v from frs_fix where k = 'pat'),
          (select id from public.catalog_items where kind = 'membership' order by created_at limit 1), (select id from public.prices order by created_at limit 1),
          10000000, 0, 10000000, 'paid', now(), 'FRSHOLD01', false);
  insert into public.refunds (id, organisation_id, order_id, amount_kobo, reason, state, provider, requested_by, is_test)
  values (v_r, (select id from public.organisations order by created_at limit 1), v_o, 10000000, 'held refund', 'pending', 'paystack', (select v from frs_fix where k = 'pat'), false);
  set local session_replication_role = origin;
  insert into frs_fix values ('held', v_r);
end $$;
select pg_temp.frs_as('fin'); set local role authenticated;
insert into frs_out select 'held_first', to_jsonb(pg_temp.frs_try('held', true));
reset role; select pg_temp.frs_as('admin'); set local role authenticated;
insert into frs_out select 'admin_clear', to_jsonb(pg_temp.frs_set(null, 'Clearing the rule after a first approval'));
reset role; select pg_temp.frs_as('fin'); set local role authenticated;
insert into frs_out select 'held_again', to_jsonb(pg_temp.frs_try('held', true));
reset role;
do $$
begin
  if pg_temp.frs_out('held_first') <> 'awaiting_second_approval' or pg_temp.frs_out('admin_clear') <> 'set'
     or pg_temp.frs_out('held_again') <> 'same_approver'
     or (select state from public.refunds where id = (select v from frs_fix where k = 'held')) <> 'pending' then
    raise exception 'FAIL: clearing the threshold let the first approver finish a held refund alone: % % %',
      pg_temp.frs_out('held_first'), pg_temp.frs_out('admin_clear'), pg_temp.frs_out('held_again');
  end if;
  insert into frs_checks values ('PASS: a held refund still needs a different second approver after the threshold is cleared');
end $$;
-- restore the threshold for the sabotage step
select pg_temp.frs_as('admin'); set local role authenticated;
select pg_temp.frs_set(5000000, 'Restoring the rule for the sabotage step');
reset role;

-- ---- view-only cannot see the patient's reason -----------------------------------------
do $$
begin
  if exists (select 1 from jsonb_array_elements((select v from frs_out where k = 'viewer_queue') -> 'refunds') r where r ->> 'reason' is not null) then
    raise exception 'FAIL: a view-only member saw a patient''s refund reason';
  end if;
  if not exists (select 1 from jsonb_array_elements((select v from frs_out where k = 'granted_queue') -> 'refunds') r where r ->> 'reason' is not null) then
    raise exception 'FAIL: a decider cannot see refund reasons';
  end if;
  insert into frs_checks values ('PASS: only someone who can decide sees the patient''s reason');
end $$;

-- ---- SABOTAGE: no threshold lookup ---------------------------------------------------
create or replace function private.refund_second_approval_threshold(p_currency text default 'NGN')
returns bigint language sql stable security definer set search_path to '' as $$ select null::bigint $$;
do $$
declare v_o uuid := gen_random_uuid(); v_r uuid := gen_random_uuid();
begin
  set local session_replication_role = replica;
  insert into public.orders (id, organisation_id, buyer_profile_id, beneficiary_patient_id, catalog_item_id, price_id, amount_kobo, fee_kobo, total_kobo, state, paid_at, paystack_reference, is_test)
  values (v_o, (select id from public.organisations order by created_at limit 1), (select v from frs_fix where k = 'pat'), (select v from frs_fix where k = 'pat'),
          (select id from public.catalog_items where kind = 'membership' order by created_at limit 1), (select id from public.prices order by created_at limit 1),
          10000000, 0, 10000000, 'paid', now(), 'FRSSAB001', false);
  insert into public.refunds (id, organisation_id, order_id, amount_kobo, reason, state, provider, requested_by, is_test)
  values (v_r, (select id from public.organisations order by created_at limit 1), v_o, 10000000, 'sabotage refund', 'pending', 'paystack', (select v from frs_fix where k = 'pat'), false);
  set local session_replication_role = origin;
  update frs_fix set v = v_r where k = 'r2';
end $$;
select pg_temp.frs_as('fin'); set local role authenticated;
update frs_out set v = to_jsonb(pg_temp.frs_try('r2', true)) where k = 'r2_first';
reset role;
do $$
begin
  perform pg_temp.frs_assert_two_approvers();
  raise exception 'FAIL: with no threshold lookup the second-approver check still passed';
exception when raise_exception then
  if sqlerrm like 'FAIL: with no threshold lookup%' then raise; end if;
  insert into frs_checks values ('PASS: sabotage (threshold ignored) is caught: ' || sqlerrm);
end $$;

select msg from frs_checks;
rollback;
