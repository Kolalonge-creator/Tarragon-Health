-- ===========================================================================
-- Proof: 20261107071746_finance_v2_membership_sponsor_employer_revenue.sql
--
-- WHAT IT PROVES.
--   * finance_membership_revenue counts paid Memberships in force by who paid (member,
--     family sponsor, employer) and keeps granted Memberships out of the paid count;
--     counts new paid Memberships, renewals, early endings, lapses and the 30-day expiry
--     window; the renewal rate is renewed / due, where only paid Memberships whose term
--     ended in the period are due; failed automatic renewals are counted.
--   * finance_memberships_list filters by payer type and expiry window, names the sponsor
--     apart from the beneficiary, and audits a read that returns rows.
--   * finance_sponsorships lists gifted orders and Care Vouchers bought for someone else,
--     not self-paid ones, with sponsor and beneficiary apart.
--   * finance_employer_revenue gives each employer's invoiced, paid, outstanding and
--     overdue amounts.
--   * a patient is refused every function (42501).
-- SABOTAGE. The payer-type helper is replaced with one that calls granted Memberships
-- paid; the paid count then includes the granted one and the check fails.
--
-- BEGIN/ROLLBACK; triggers off while fixtures are written.
-- Run: psql "$DB_URL" -v ON_ERROR_STOP=1 -f packages/db/tests/finance_membership_revenue.sql
-- ===========================================================================

begin;
create temporary table fmr_checks(msg text) on commit drop;
create temporary table fmr_fix(k text primary key, v uuid) on commit drop;
create temporary table fmr_out(k text primary key, v jsonb) on commit drop;
grant all on fmr_checks, fmr_fix, fmr_out to authenticated;

do $$
declare
  c_org constant uuid := (select id from public.organisations order by created_at limit 1);
  c_item constant uuid := (select id from public.catalog_items where kind = 'membership' order by created_at limit 1);
  c_price constant uuid := (select id from public.prices order by created_at limit 1);
  v_emp uuid := gen_random_uuid();
  v_fin uuid := gen_random_uuid();
  p uuid[] := array[gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid()];
  o_self uuid := gen_random_uuid(); o_gift uuid := gen_random_uuid(); o_due uuid := gen_random_uuid(); o_due2 uuid := gen_random_uuid(); o_renew uuid := gen_random_uuid(); o_fail uuid := gen_random_uuid();
  m_due uuid := gen_random_uuid(); m_due2 uuid := gen_random_uuid();
  v_today date := (now() at time zone 'Africa/Lagos')::date;
begin
  set local session_replication_role = replica;
  insert into public.organisations (id, name, type, is_active) values (v_emp, 'FMR Employer Ltd', 'corporate', true);
  insert into auth.users (id, email, aud, role)
  select x, x::text || '@fmr.test', 'authenticated', 'authenticated' from unnest(p || v_fin) x;
  insert into public.profiles (id, organisation_id, role, full_name, is_active, is_test)
  select x, c_org, 'patient', 'FMR Person ' || i, true, false from unnest(p) with ordinality t(x, i)
  on conflict (id) do update set role = 'patient', full_name = excluded.full_name, is_test = false, is_active = true, organisation_id = excluded.organisation_id;
  insert into public.profiles (id, organisation_id, role, full_name, is_active, is_test) values (v_fin, c_org, 'finance', 'FMR Finance', true, false)
  on conflict (id) do update set role = 'finance', is_active = true, is_test = false;

  -- p1 bought for themself; p2 bought by p3 (sponsor); p4 employer seat; p5 granted
  insert into public.orders (id, organisation_id, buyer_profile_id, beneficiary_patient_id, catalog_item_id, price_id, amount_kobo, fee_kobo, total_kobo, state, paid_at, paystack_reference, is_test) values
    (o_self, c_org, p[1], p[1], c_item, c_price, 10000000, 150000, 10150000, 'paid', now() - interval '10 days', 'FMRREF0001', false),
    (o_gift, c_org, p[3], p[2], c_item, c_price, 10000000, 0, 10000000, 'paid', now() - interval '9 days', 'FMRREF0002', false),
    (o_due,  c_org, p[6], p[6], c_item, c_price, 10000000, 0, 10000000, 'paid', now() - interval '370 days', 'FMRREF0003', false),
    (o_due2, c_org, p[7], p[7], c_item, c_price, 10000000, 0, 10000000, 'paid', now() - interval '370 days', 'FMRREF0004', false);
  insert into public.patient_memberships (organisation_id, patient_id, source, state, starts_at, ends_at, order_id, is_test, tier, auto_renew, renewal_item_code, renewal_consent_at) values
    (c_org, p[1], 'purchase', 'active', now() - interval '10 days', now() + interval '20 days', o_self, false, 'evergreen', true, 'membership_annual', now()),
    (c_org, p[2], 'purchase', 'active', now() - interval '9 days', now() + interval '356 days', o_gift, false, 'evergreen', false, null, null),
    (v_emp, p[4], 'employer', 'active', now() - interval '30 days', now() + interval '335 days', null, false, 'evergreen', false, null, null);
  insert into public.patient_memberships (organisation_id, patient_id, source, state, starts_at, ends_at, granted_by, grant_reason, is_test, tier) values
    (c_org, p[5], 'granted', 'active', now() - interval '5 days', now() + interval '360 days', v_fin, 'staff courtesy membership', false, 'evergreen');
  -- two paid Memberships whose year ended 5 days ago: one renewed, one lapsed
  insert into public.patient_memberships (id, organisation_id, patient_id, source, state, starts_at, ends_at, ended_at, end_reason, order_id, is_test, tier) values
    (m_due,  c_org, p[6], 'purchase', 'ended',  now() - interval '370 days', now() - interval '5 days', now() - interval '5 days', 'term ended and renewed', o_due,  false, 'evergreen'),
    (m_due2, c_org, p[7], 'purchase', 'lapsed', now() - interval '370 days', now() - interval '5 days', null, null, o_due2, false, 'evergreen');
  insert into public.orders (id, organisation_id, buyer_profile_id, beneficiary_patient_id, catalog_item_id, price_id, amount_kobo, fee_kobo, total_kobo, state, paid_at, paystack_reference, is_test, renews_membership_id, renewal_term_ends_at)
  values (o_renew, c_org, p[6], p[6], c_item, c_price, 10000000, 0, 10000000, 'paid', now() - interval '6 days', 'FMRREF0005', false, m_due, now() + interval '360 days');
  insert into public.orders (id, organisation_id, buyer_profile_id, beneficiary_patient_id, catalog_item_id, price_id, amount_kobo, state, paystack_reference, is_test, renews_membership_id, renewal_term_ends_at)
  values (o_fail, c_org, p[7], p[7], c_item, c_price, 10000000, 'failed', 'FMRREF0006', false, m_due2, now() + interval '360 days');
  insert into public.membership_renewal_attempts (membership_id, order_id, term_ends_at, attempt_no, reference, outcome, error, created_at)
  values (m_due2, o_fail, now() - interval '5 days', 1, 'FMRREF0006', 'failed', 'card declined', now() - interval '6 days');

  -- a Care Voucher bought by p3 for p2, and one p1 bought for themself (not a sponsorship)
  insert into public.care_vouchers (organisation_id, voucher_number, kind, beneficiary_profile_id, purchaser_profile_id, service_product_id, sku_code, face_value_kobo, amount_paid_kobo, status, created_at) values
    (c_org, 'FMRV-0001', 'prepaid_service', p[2], p[3], (select id from public.service_products order by created_at limit 1), 'fmr_sku', 2500000, 2500000, 'active', now() - interval '8 days'),
    (c_org, 'FMRV-0002', 'prepaid_service', p[1], p[1], (select id from public.service_products order by created_at limit 1), 'fmr_sku', 2500000, 2500000, 'active', now() - interval '8 days');

  -- employer: one paid invoice, one issued and overdue
  insert into public.corporate_contracts (organisation_id, name, status, effective_from, effective_to, employee_count, per_employee_per_year_kobo)
  values (v_emp, 'FMR annual seats', 'active', v_today - 30, v_today + 40, 10, 9000000);
  insert into public.employer_invoices (organisation_id, period_start, period_end, billing_model, amount_kobo, status, issued_at, paid_at, due_at) values
    (v_emp, v_today - 30, v_today + 335, 'per_employee', 45000000, 'paid', now() - interval '30 days', now() - interval '20 days', now() - interval '15 days'),
    (v_emp, v_today - 29, v_today + 336, 'per_employee', 45000000, 'issued', now() - interval '30 days', null, now() - interval '2 days');
  -- a gift that was refunded (left out of sponsorships), and a test seat pilot's invoice (left out of employer totals)
  insert into public.orders (organisation_id, buyer_profile_id, beneficiary_patient_id, catalog_item_id, price_id, amount_kobo, fee_kobo, total_kobo, state, paid_at, paystack_reference, is_test)
  values (c_org, p[3], p[5], c_item, c_price, 10000000, 0, 10000000, 'refunded', now() - interval '7 days', 'FMRREF0007', false);
  with inv as (
    insert into public.employer_invoices (organisation_id, period_start, period_end, billing_model, amount_kobo, status, issued_at, due_at)
    values (v_emp, v_today - 28, v_today + 337, 'per_employee', 77700000, 'issued', now() - interval '3 days', now() + interval '20 days') returning id)
  , pkg as (insert into public.employer_benefit_packages (organisation_id, name, catalog_item_id) values (v_emp, 'FMR test package', c_item) returning id)
  insert into public.employer_seat_pilots (organisation_id, benefit_package_id, seat_price_id, seats_purchased, seat_price_kobo, total_kobo, starts_on, ends_on, terms_version, state, invoice_id, is_test)
  select v_emp, pkg.id, c_price, 1, 77700000, 77700000, v_today, v_today + 365, 'test', 'invoiced', inv.id, true from inv, pkg;
  set local session_replication_role = origin;

  insert into fmr_fix values ('fin', v_fin), ('pat', p[1]), ('emp', v_emp);
end $$;

select set_config('request.jwt.claims', json_build_object('sub', (select v from fmr_fix where k = 'fin'), 'role', 'authenticated')::text, true);
set local role authenticated;
insert into fmr_out select 'rev', public.finance_membership_revenue(((now() at time zone 'Africa/Lagos')::date - 14), (now() at time zone 'Africa/Lagos')::date);
insert into fmr_out select 'list_sponsor', public.finance_memberships_list(p_payer_types => array['family_sponsor'], p_search => 'FMR Person');
insert into fmr_out select 'list_expiring', public.finance_memberships_list(p_expiring_within_days => 30, p_search => 'FMR Person');
insert into fmr_out select 'spons', public.finance_sponsorships(((now() at time zone 'Africa/Lagos')::date - 14), (now() at time zone 'Africa/Lagos')::date);
insert into fmr_out select 'emp', public.finance_employer_revenue();
reset role;

select set_config('request.jwt.claims', json_build_object('sub', (select v from fmr_fix where k = 'pat'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare n int := 0;
begin
  begin perform public.finance_membership_revenue(current_date - 1, current_date); exception when insufficient_privilege then n := n + 1; end;
  begin perform public.finance_memberships_list(); exception when insufficient_privilege then n := n + 1; end;
  begin perform public.finance_sponsorships(current_date - 1, current_date); exception when insufficient_privilege then n := n + 1; end;
  begin perform public.finance_employer_revenue(); exception when insufficient_privilege then n := n + 1; end;
  if n <> 4 then raise exception 'FAIL: a patient reached % of 4 finance revenue functions', 4 - n; end if;
  insert into fmr_checks values ('PASS: a patient is refused all four functions (42501)');
end $$;
reset role;

create or replace function pg_temp.fmr_assert_counts() returns void language plpgsql as $$
declare r jsonb := (select v from fmr_out where k = 'rev');
begin
  -- Other proofs and seed data may add Memberships; these fixtures add exactly these, so compare to at least / exact deltas where safe.
  if (r -> 'in_force' ->> 'individual')::int < 1 or (r -> 'in_force' ->> 'family_sponsor')::int < 1
     or (r -> 'in_force' ->> 'employer')::int < 1 or (r -> 'in_force' ->> 'granted')::int < 1 then
    raise exception 'FAIL in_force split: %', r -> 'in_force';
  end if;
  if (r -> 'in_force' ->> 'paid')::int <> (r -> 'in_force' ->> 'individual')::int + (r -> 'in_force' ->> 'family_sponsor')::int + (r -> 'in_force' ->> 'employer')::int then
    raise exception 'FAIL: the paid count includes granted Memberships: %', r -> 'in_force';
  end if;
end $$;

do $$
declare r jsonb := (select v from fmr_out where k = 'rev');
begin
  perform pg_temp.fmr_assert_counts();
  if (r ->> 'new_paid')::int < 2 or (r ->> 'renewals')::int < 1 or (r ->> 'lapsed')::int < 1
     or (r ->> 'expiring_30d')::int < 1 or (r ->> 'expiring_30d_auto_renew')::int < 1 or (r ->> 'failed_renewal_charges')::int < 1 then
    raise exception 'FAIL movement counts: %', r;
  end if;
  if (r ->> 'renewal_due')::int < 2 or (r ->> 'renewal_renewed')::int < 1
     or (r ->> 'renewal_rate')::numeric <> round((r ->> 'renewal_renewed')::numeric / (r ->> 'renewal_due')::numeric, 4) then
    raise exception 'FAIL renewal rate: due % renewed % rate %', r ->> 'renewal_due', r ->> 'renewal_renewed', r ->> 'renewal_rate';
  end if;
  insert into fmr_checks values ('PASS: in-force split by payer, granted kept out of paid, movements, expiry window and renewal rate are right');

  if not exists (select 1 from jsonb_array_elements((select v from fmr_out where k = 'list_sponsor') -> 'rows') x
                  where x ->> 'beneficiary' = 'FMR Person 2' and x ->> 'sponsor' = 'FMR Person 3')
     or exists (select 1 from jsonb_array_elements((select v from fmr_out where k = 'list_sponsor') -> 'rows') x where x ->> 'payer_type' <> 'family_sponsor')
     or not exists (select 1 from jsonb_array_elements((select v from fmr_out where k = 'list_expiring') -> 'rows') x where x ->> 'beneficiary' = 'FMR Person 1') then
    raise exception 'FAIL memberships list filters or sponsor/beneficiary split';
  end if;
  if not exists (select 1 from public.audit_log where action = 'finance.memberships.listed' and actor_id = (select v from fmr_fix where k = 'fin')) then
    raise exception 'FAIL: memberships list read was not audited';
  end if;
  insert into fmr_checks values ('PASS: the Memberships list filters, separates sponsor from beneficiary, and is audited');

  if not exists (select 1 from jsonb_array_elements((select v from fmr_out where k = 'spons') -> 'rows') x
                  where x ->> 'reference' = 'FMRREF0002' and x ->> 'sponsor' = 'FMR Person 3' and x ->> 'beneficiary' = 'FMR Person 2')
     or not exists (select 1 from jsonb_array_elements((select v from fmr_out where k = 'spons') -> 'rows') x where x ->> 'reference' = 'FMRV-0001')
     or exists (select 1 from jsonb_array_elements((select v from fmr_out where k = 'spons') -> 'rows') x
                 where x ->> 'reference' in ('FMRREF0001', 'FMRV-0002', 'FMRREF0007')) then
    raise exception 'FAIL sponsorships: %', (select v -> 'rows' from fmr_out where k = 'spons');
  end if;
  insert into fmr_checks values ('PASS: sponsorships list gifts and vouchers bought for others, never self-paid or refunded ones');

  if not exists (select 1 from jsonb_array_elements((select v from fmr_out where k = 'emp')) x
                  where x ->> 'organisation_id' = (select v::text from fmr_fix where k = 'emp')
                    and (x ->> 'invoiced_minor')::bigint = 90000000 and (x ->> 'paid_minor')::bigint = 45000000
                    and (x ->> 'outstanding_minor')::bigint = 45000000 and (x ->> 'overdue_minor')::bigint = 45000000
                    and (x ->> 'members_in_force')::int = 1 and (x ->> 'renewal_within_60d')::boolean) then
    raise exception 'FAIL employer revenue: %', (select v from fmr_out where k = 'emp');
  end if;
  insert into fmr_checks values ('PASS: employer invoiced, paid, outstanding, overdue, members and renewal window are right; a test pilot''s invoice is left out');
end $$;

-- ---- SABOTAGE: granted counted as paid -----------------------------------------------
create or replace function private.membership_payer_type(p_source text, p_buyer uuid, p_beneficiary uuid)
returns text language sql immutable set search_path to '' as $$
  select case when p_source = 'employer' then 'employer'
              when p_buyer is not null and p_buyer is distinct from p_beneficiary then 'family_sponsor'
              else 'individual' end;
$$;
select set_config('request.jwt.claims', json_build_object('sub', (select v from fmr_fix where k = 'fin'), 'role', 'authenticated')::text, true);
set local role authenticated;
update fmr_out set v = public.finance_membership_revenue(((now() at time zone 'Africa/Lagos')::date - 14), (now() at time zone 'Africa/Lagos')::date) where k = 'rev';
reset role;
do $$
begin
  perform pg_temp.fmr_assert_counts();
  raise exception 'FAIL: with granted counted as paid the check still passed';
exception when raise_exception then
  if sqlerrm like 'FAIL: with granted%' then raise; end if;
  insert into fmr_checks values ('PASS: sabotage (granted counted as paid) is caught: ' || sqlerrm);
end $$;

select msg from fmr_checks;
rollback;
