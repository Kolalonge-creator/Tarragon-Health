-- Principal or agent: the same money, presented two ways.
--
-- Proves the thing that actually matters about this choice — that it is ONLY
-- a presentation choice. Cash moved and money owed to Synlab must come out
-- identical under both treatments; only the profit-and-loss differs, and by
-- about five times.
--
-- Run inside a single transaction and ROLLED BACK.
--
-- To re-run:
--   npx supabase db query --linked -f packages/db/tests/partner_revenue_treatment.sql

begin;

create temporary table test_results (case_name text, passed boolean, detail text) on commit drop;

do $$
declare
  v_female uuid := gen_random_uuid();  -- was: '365067dc-7c0f-45e8-a807-8cd70f2da8dd'
  v_org    uuid := '00000000-0000-0000-0000-000000000001';
  v_core   uuid;
  v_syn    uuid;
  v_o1     uuid;
  v_o2     uuid;
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v_female, 'partner-revenue-treatment-test-patient@example.invalid', 'x', now(), '{}', '{}');
  update public.profiles set organisation_id = v_org, role = 'patient', full_name = 'Partner Revenue Treatment Test Patient'
    where id = v_female;

  select id into v_core from public.panel_bundles where code = 'screen_core';
  update public.lab_providers set is_active = true where name = 'Synlab Nigeria';
  select id into v_syn from public.lab_providers where name = 'Synlab Nigeria';

  insert into public.lab_orders (organisation_id, patient_id, panel_bundle_id, status, total_kobo,
    origin, investigation_tier, fulfilment, provider_id, partner_cost_kobo, partner_cost_provider_id)
  values (v_org, v_female, v_core, 'payment_confirmed', 22750000, 'patient_initiated', 1,
          'partner', v_syn, 18980000, v_syn)
  returning id into v_o1;

  insert into public.lab_orders (organisation_id, patient_id, panel_bundle_id, status, total_kobo,
    origin, investigation_tier, fulfilment, provider_id, partner_cost_kobo, partner_cost_provider_id)
  values (v_org, v_female, v_core, 'payment_confirmed', 22750000, 'patient_initiated', 1,
          'partner', v_syn, 18980000, v_syn)
  returning id into v_o2;

  update public.finance_partner_revenue_policy set treatment = 'net_agent' where id;
  insert into public.payment_transactions (organisation_id, provider, provider_event_id, event_type,
    amount_minor, currency, raw_payload, processed_at, booking_order_type, booking_order_id)
  values (v_org, 'paystack', 'test_net_treatment', 'charge.success', 22750000, 'NGN', '{}'::jsonb,
          now(), 'lab', v_o1);

  update public.finance_partner_revenue_policy set treatment = 'gross_principal' where id;
  insert into public.payment_transactions (organisation_id, provider, provider_event_id, event_type,
    amount_minor, currency, raw_payload, processed_at, booking_order_type, booking_order_id)
  values (v_org, 'paystack', 'test_gross_treatment', 'charge.success', 22750000, 'NGN', '{}'::jsonb,
          now(), 'lab', v_o2);
end $$;

-- Helper: total posted to one account under one probe.
create or replace function pg_temp.posted(p_event text, p_account text, p_side text)
returns bigint language sql stable as $$
  select coalesce(sum(case when p_side = 'dr' then jl.debit_minor else jl.credit_minor end), 0)
    from public.finance_journal_lines jl
    join public.finance_journal_entries je on je.id = jl.entry_id
   where je.source_ref = (select id::text from public.payment_transactions where provider_event_id = p_event)
     and jl.account_code = p_account;
$$;

insert into test_results
select 't1_cash_collected_is_identical',
       pg_temp.posted('test_net_treatment','1020','dr') = pg_temp.posted('test_gross_treatment','1020','dr')
         and pg_temp.posted('test_net_treatment','1020','dr') = 22750000,
       'both Dr 1020 ' || pg_temp.posted('test_net_treatment','1020','dr') / 100;

insert into test_results
select 't2_money_owed_to_synlab_is_identical',
       pg_temp.posted('test_net_treatment','2700','cr') = pg_temp.posted('test_gross_treatment','2700','cr')
         and pg_temp.posted('test_net_treatment','2700','cr') = 18980000,
       'both Cr 2700 ' || pg_temp.posted('test_net_treatment','2700','cr') / 100;

insert into test_results
select 't3_only_the_reported_revenue_differs',
       pg_temp.posted('test_net_treatment','4100','cr') = 3770000
         and pg_temp.posted('test_gross_treatment','4100','cr') = 22750000,
       'net ' || pg_temp.posted('test_net_treatment','4100','cr') / 100
         || ' vs gross ' || pg_temp.posted('test_gross_treatment','4100','cr') / 100;

insert into test_results
select 't4_and_gross_carries_the_lab_charge_as_a_cost',
       pg_temp.posted('test_gross_treatment','5100','dr') = 18980000
         and pg_temp.posted('test_net_treatment','5100','dr') = 0,
       'gross Dr 5100 ' || pg_temp.posted('test_gross_treatment','5100','dr') / 100
         || ' / net never touches it';

-- Whatever the presentation, the entry must balance.
insert into test_results
select 't5_both_entries_balance',
       (select bool_and(d = c) from (
          select sum(jl.debit_minor) d, sum(jl.credit_minor) c
            from public.finance_journal_lines jl
            join public.finance_journal_entries je on je.id = jl.entry_id
           where je.source_ref in (select id::text from public.payment_transactions
                                    where provider_event_id in ('test_net_treatment','test_gross_treatment'))
           group by je.id) x),
       null;

select case_name, passed, detail from test_results order by case_name;
select count(*) filter (where not passed) as failures, count(*) as total from test_results;

rollback;
