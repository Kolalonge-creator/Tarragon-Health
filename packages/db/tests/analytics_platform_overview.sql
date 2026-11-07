-- ===========================================================================
-- Proof: public.analytics_platform_overview(p_from, p_to), the superadmin console homepage reader
-- (docs/design/SUPERADMIN-CONSOLE.md, phase 2b).
--
-- What it proves, by adding known fixtures and measuring the DIFFERENCE they make (so whatever data already sits in
-- the database, seed or live, cannot make the test pass or fail by accident):
--   1. registrations count real patients created in the window and leave out a test patient;
--   2. a Membership counts in the window it started, split by source; an older one counts in the previous window;
--   3. collected and refunded come only from Paystack-confirmed events, NGN, no error; a test payment, an errored
--      charge and a USD charge are left out; failed charges are counted apart;
--   4. the live snapshot counts active Memberships by source, Free patients and Memberships ending within 30 days;
--   5. a patient session is refused with 42501 (never handed zeros), and a backwards range is refused with 22023;
--   6. SABOTAGE: with the analyst gate removed (inside this transaction only) the patient is no longer refused, so
--      check 5 really discriminates.
-- BEGIN/ROLLBACK: leaves the database as found.
-- ===========================================================================

begin;

create temporary table ov_fixture(k text primary key, v uuid) on commit drop;
create temporary table ov_result(check_name text, observed text, expected text, verdict text) on commit drop;

do $$
declare
  v_org uuid;
  r record;
begin
  insert into public.organisations (name, type) values ('Platform Overview Proof Org', 'clinic') returning id into v_org;
  insert into ov_fixture values ('org', v_org);
  for r in select * from (values ('admin', 'admin'), ('pat_a', 'patient'), ('pat_b', 'patient'), ('pat_test', 'patient'), ('pat_free', 'patient')) t(k, role_name) loop
    insert into ov_fixture values (r.k, gen_random_uuid());
    insert into auth.users (id, email) values ((select v from ov_fixture where k = r.k), format('overviewproof.%s@example.com', r.k));
    insert into public.profiles (id, organisation_id, role, full_name)
    values ((select v from ov_fixture where k = r.k), v_org, r.role_name::public.user_role, format('Overview Proof %s', r.k))
    on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, full_name = excluded.full_name;
  end loop;
end $$;

-- A reading before the fixtures that should move the figures; every check below is a difference from it.
create temporary table ov_read(k text primary key, j jsonb) on commit drop;

do $$
declare
  v_admin uuid := (select v from ov_fixture where k = 'admin');
  v_read jsonb;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_read := public.analytics_platform_overview(now() - interval '30 days', now() + interval '1 minute');
  reset role;
  insert into ov_read values ('before', v_read);
end $$;

-- Fixtures that should move the figures.
do $$
declare
  v_org uuid := (select v from ov_fixture where k = 'org');
  v_a uuid := (select v from ov_fixture where k = 'pat_a');
  v_b uuid := (select v from ov_fixture where k = 'pat_b');
  v_t uuid := (select v from ov_fixture where k = 'pat_test');
begin
  update public.profiles set is_test = true where id = v_t;
  -- A: bought a Membership 10 days ago (current window). B: voucher-sponsored, started 40 days ago (previous window),
  -- ends in 20 days. Test patient: a membership that must never count.
  insert into public.patient_memberships (organisation_id, patient_id, source, state, starts_at, ends_at, is_test)
  values (v_org, v_a, 'purchase', 'active', now() - interval '10 days', now() + interval '355 days', false),
         (v_org, v_b, 'voucher', 'active', now() - interval '40 days', now() + interval '20 days', false),
         (v_org, v_t, 'purchase', 'active', now() - interval '5 days', now() + interval '360 days', true);
  insert into public.payment_transactions (organisation_id, provider, provider_event_id, event_type, amount_minor, currency, error, raw_payload, created_at, is_test)
  values (v_org, 'paystack', 'ovproof-ok', 'charge.success', 100000, 'NGN', null, '{}', now() - interval '5 days', false),
         (v_org, 'paystack', 'ovproof-refund', 'refund.processed', 20000, 'NGN', null, '{}', now() - interval '2 days', false),
         (v_org, 'paystack', 'ovproof-failed', 'charge.failed', 100000, 'NGN', 'declined', '{}', now() - interval '3 days', false),
         (v_org, 'paystack', 'ovproof-test', 'charge.success', 500000, 'NGN', null, '{}', now() - interval '4 days', true),
         (v_org, 'paystack', 'ovproof-errored', 'charge.success', 700000, 'NGN', 'mismatch', '{}', now() - interval '4 days', false),
         (v_org, 'paystack', 'ovproof-usd', 'charge.success', 9900, 'USD', null, '{}', now() - interval '4 days', false),
         (v_org, 'paystack', 'ovproof-nocurrency', 'charge.success', 300000, null, null, '{}', now() - interval '4 days', false);
end $$;

create temporary table ov_amount(amount bigint) on commit drop;

-- Catalogue orders (the current checkout, Membership included) never reach payment_transactions: their confirmed charge
-- is a public.payments row. One real paid order, one test-flagged paid order, one failed order.
do $$
declare
  v_org uuid := (select v from ov_fixture where k = 'org');
  v_a uuid := (select v from ov_fixture where k = 'pat_a');
  v_item uuid;
  v_price uuid;
  v_amount bigint;
  r record;
begin
  select id into v_item from public.catalog_items where code = 'membership_annual_no_panel' order by created_at limit 1;
  select id, amount_kobo into v_price, v_amount from public.prices where catalog_item_id = v_item and valid_to is null limit 1;
  if v_item is null or v_price is null then
    raise exception 'fixture: seeded catalogue item membership_annual_no_panel or its current price is missing';
  end if;
  for r in select * from (values ('paid', false), ('paidtest', true), ('failed', false)) t(kind, test) loop
    insert into ov_fixture values ('order_' || r.kind, gen_random_uuid());
    insert into public.orders (id, organisation_id, buyer_profile_id, beneficiary_patient_id, catalog_item_id, price_id, amount_kobo,
                               paystack_reference, state, paid_at, fee_kobo, total_kobo, is_test)
    values ((select v from ov_fixture where k = 'order_' || r.kind), v_org, v_a, v_a, v_item, v_price, v_amount,
            'ovproof_' || r.kind || '_' || replace(gen_random_uuid()::text, '-', ''),
            case when r.kind = 'failed' then 'failed' else 'paid' end,
            case when r.kind = 'failed' then null else now() - interval '1 day' end,
            case when r.kind = 'failed' then null else 0 end,
            case when r.kind = 'failed' then null else v_amount end,
            r.test);
    if r.kind <> 'failed' then
      insert into public.payments (organisation_id, order_id, provider_reference, amount_kobo, fee_kobo, total_kobo, status, source, verified_at, is_test)
      values (v_org, (select v from ov_fixture where k = 'order_' || r.kind), 'ovproof_pay_' || r.kind, v_amount, 0, v_amount, 'success', 'webhook', now() - interval '1 day', r.test);
    end if;
  end loop;
  insert into ov_amount values (v_amount);
end $$;

do $$
declare
  v_admin uuid := (select v from ov_fixture where k = 'admin');
  v_read jsonb;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_read := public.analytics_platform_overview(now() - interval '30 days', now() + interval '1 minute');
  reset role;
  insert into ov_read values ('after', v_read);
end $$;

-- Differences the fixtures made.
insert into ov_result
select c.name, c.observed::text, c.expected::text, case when c.observed = c.expected then 'PASS' else 'FAIL' end
from (
  select 'memberships started this window (+1, purchase)' name,
         ((a.j->'current'->>'memberships_started')::int - (b.j->'current'->>'memberships_started')::int) observed, 1 expected
    from ov_read a, ov_read b where a.k = 'after' and b.k = 'before'
  union all
  select 'started by source: purchase (+1, test member left out)',
         (coalesce((a.j->'current'->'started_by_source'->>'purchase')::int, 0) - coalesce((b.j->'current'->'started_by_source'->>'purchase')::int, 0)), 1
    from ov_read a, ov_read b where a.k = 'after' and b.k = 'before'
  union all
  select 'membership started 40 days ago counts in the previous window (+1)',
         ((a.j->'previous'->>'memberships_started')::int - (b.j->'previous'->>'memberships_started')::int), 1
    from ov_read a, ov_read b where a.k = 'after' and b.k = 'before'
  union all
  select 'collected: Paystack-confirmed charge (100000) + the real paid order; test, errored, USD, no-currency left out',
         ((a.j->'current'->>'collected_kobo')::bigint - (b.j->'current'->>'collected_kobo')::bigint)::bigint, 100000 + (select amount from ov_amount)
    from ov_read a, ov_read b where a.k = 'after' and b.k = 'before'
  union all
  select 'refunded apart from collected (+20000)',
         ((a.j->'current'->>'refunded_kobo')::bigint - (b.j->'current'->>'refunded_kobo')::bigint)::int, 20000
    from ov_read a, ov_read b where a.k = 'after' and b.k = 'before'
  union all
  select 'failed payments: one failed charge and one failed order (+2)',
         ((a.j->'current'->>'failed_payments')::int - (b.j->'current'->>'failed_payments')::int), 2
    from ov_read a, ov_read b where a.k = 'after' and b.k = 'before'
  union all
  select 'snapshot: active Memberships (+2)',
         ((a.j->'snapshot'->>'active_memberships')::int - (b.j->'snapshot'->>'active_memberships')::int), 2
    from ov_read a, ov_read b where a.k = 'after' and b.k = 'before'
  union all
  select 'snapshot: active voucher (sponsored) Memberships (+1)',
         (coalesce((a.j->'snapshot'->'active_by_source'->>'voucher')::int, 0) - coalesce((b.j->'snapshot'->'active_by_source'->>'voucher')::int, 0)), 1
    from ov_read a, ov_read b where a.k = 'after' and b.k = 'before'
  union all
  select 'snapshot: ending within 30 days (+1)',
         ((a.j->'snapshot'->>'ending_next_30d')::int - (b.j->'snapshot'->>'ending_next_30d')::int), 1
    from ov_read a, ov_read b where a.k = 'after' and b.k = 'before'
  union all
  -- Two patients became members and one became a test account: Free falls by 3.
  select 'snapshot: Free patients (-3: two joined, one marked test)',
         ((a.j->'snapshot'->>'free_patients')::int - (b.j->'snapshot'->>'free_patients')::int), -3
    from ov_read a, ov_read b where a.k = 'after' and b.k = 'before'
  union all
  select 'registrations this window (-1: the test patient leaves the count)',
         ((a.j->'current'->>'registrations')::int - (b.j->'current'->>'registrations')::int), -1
    from ov_read a, ov_read b where a.k = 'after' and b.k = 'before'
  union all
  select 'snapshot: registered patients (-1: the test patient leaves the count)',
         ((a.j->'snapshot'->>'registered_patients')::int - (b.j->'snapshot'->>'registered_patients')::int), -1
    from ov_read a, ov_read b where a.k = 'after' and b.k = 'before'
) c;

-- Refusals.
do $$
declare
  v_pat uuid := (select v from ov_fixture where k = 'pat_free');
  v_admin uuid := (select v from ov_fixture where k = 'admin');
  v_state text := 'none';
begin
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.analytics_platform_overview(now() - interval '7 days', now());
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
  end;
  reset role;
  insert into ov_result values ('patient session refused with 42501', v_state, '42501', case when v_state = '42501' then 'PASS' else 'FAIL' end);

  v_state := 'none';
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.analytics_platform_overview(now(), now() - interval '7 days');
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
  end;
  reset role;
  insert into ov_result values ('backwards range refused with 22023', v_state, '22023', case when v_state = '22023' then 'PASS' else 'FAIL' end);
end $$;

-- SABOTAGE: remove the analyst gate (this transaction only) and show the patient gets through, so the refusal check
-- above is not passing vacuously.
do $$
declare
  v_def text;
  v_pat uuid := (select v from ov_fixture where k = 'pat_free');
  v_state text := 'none';
begin
  v_def := pg_get_functiondef('public.analytics_platform_overview(timestamptz, timestamptz)'::regprocedure);
  v_def := replace(v_def, 'if not private.is_analyst() then', 'if false then');
  execute v_def;
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.analytics_platform_overview(now() - interval '7 days', now());
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
  end;
  reset role;
  insert into ov_result values ('SABOTAGE: ungated function lets the patient in', v_state, 'none', case when v_state = 'none' then 'PASS' else 'FAIL' end);
end $$;

do $$
begin
  if exists (select 1 from ov_result where verdict <> 'PASS') then
    raise exception 'analytics_platform_overview proof failed: %', (select string_agg(check_name || ' observed=' || observed || ' expected=' || expected, '; ') from ov_result where verdict <> 'PASS');
  end if;
end $$;

select check_name, observed, expected, verdict from ov_result order by check_name;

rollback;
