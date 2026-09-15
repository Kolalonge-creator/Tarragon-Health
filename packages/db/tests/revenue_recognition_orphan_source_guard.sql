-- ===========================================================================
-- Verification: 20260905204245_reverse_phantom_service_purchase_revenue
--
-- THE GAP. revenue_recognition_schedules.source_id is polymorphic across
-- service_purchases, subscriptions and subscription_add_ons, so it carries no
-- foreign key, and nothing cancels a schedule when its source row is deleted.
-- private.finance_recognize_revenue -- run by the finance-revenue-recognition
-- -monthly cron on the 1st of every month -- selected on `status = 'active'`
-- alone and never asked whether the thing it was billing for still existed.
-- An orphaned schedule therefore posted Dr <deferred> / Cr <revenue> on the
-- next 1st, inventing revenue and driving the deferred-revenue liability
-- negative. That is not hypothetical: it was live, for 10,000 naira, due to
-- post on 1 October 2026, and it was the entire balance on both accounts.
--
-- This script proves, against the real function:
--   * CONTROL: a schedule whose source row still exists recognises normally;
--   * a schedule whose source row was deleted posts NOTHING, is moved to
--     'cancelled', and records a human-readable cancelled_reason rather than
--     being silently skipped on every future run;
--   * the orphan's revenue account is left completely untouched;
--   * SABOTAGE: with revrec_source_exists neutered to always return true --
--     i.e. the code as it stood before this migration -- the same orphan
--     immediately books phantom revenue again, so the checks above are
--     discriminating and not vacuously true.
--
-- Wrapped in BEGIN/ROLLBACK: it creates users, profiles, purchases, schedules
-- and journal entries, and redefines a function. The rollback undoes all of it.
-- ===========================================================================

begin;
create temporary table rv(check_name text, observed text, expected text, verdict text) on commit drop;
create temporary table rvf(k text primary key, v text) on commit drop;

-- --------------------------------------------------------------------------
-- Fixtures. Two purchases, two schedules: A stays, B is deleted out from
-- under its schedule. Accounts are resolved from finance_accounts rather than
-- hardcoded, so renaming the chart of accounts cannot turn this into a no-op.
-- --------------------------------------------------------------------------
do $$
declare
  v_org uuid; v_prod uuid; v_price bigint;
  v_pat uuid := gen_random_uuid();
  v_pur_a uuid := gen_random_uuid();
  v_pur_b uuid := gen_random_uuid();
  v_sch_a uuid := gen_random_uuid();
  v_sch_b uuid := gen_random_uuid();
  v_deferred text; v_revenue text;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  if v_org is null then raise exception 'no organisation exists at all -- the core migrations did not run'; end if;

  select id, price_kobo into v_prod, v_price from public.service_products
    where price_kobo > 0 and is_active order by code limit 1;
  if v_prod is null then raise exception 'no priced service_product to test against'; end if;

  select code into v_deferred from public.finance_accounts where code = '2000';
  select code into v_revenue  from public.finance_accounts where code = '4020';
  if v_deferred is null or v_revenue is null then
    raise exception 'the deferred/revenue accounts this proof needs do not exist';
  end if;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v_pat, 'revrec-orphan-patient@example.invalid', 'x', now(), '{}', '{}')
  on conflict (id) do nothing;

  insert into public.profiles (id, organisation_id, role, full_name)
  values (v_pat, v_org, 'patient', 'RevRec Orphan Guard Patient')
  on conflict (id) do update set organisation_id = excluded.organisation_id;

  -- payable_kobo is GENERATED; it must not be inserted. An 'active' purchase
  -- additionally needs purchased_at (service_purchases_active_has_purchased_at).
  insert into public.service_purchases
    (id, organisation_id, patient_id, purchaser_profile_id, service_product_id,
     status, amount_kobo, currency, purchased_at)
  values
    (v_pur_a, v_org, v_pat, v_pat, v_prod, 'active', v_price, 'NGN', now()),
    (v_pur_b, v_org, v_pat, v_pat, v_prod, 'active', v_price, 'NGN', now());

  -- Both schedules run over a period that has fully elapsed by the as-of date
  -- used below, so a working recogniser has something real to post for A.
  insert into public.revenue_recognition_schedules
    (id, source_kind, source_id, organisation_id, revenue_account_code,
     deferred_account_code, currency, total_minor, recognized_minor,
     period_start, period_end, status)
  values
    (v_sch_a, 'service_purchase', v_pur_a, v_org, v_revenue, v_deferred,
     'NGN', 1000000, 0, date '2026-01-01', date '2026-02-01', 'active'),
    (v_sch_b, 'service_purchase', v_pur_b, v_org, v_revenue, v_deferred,
     'NGN', 1000000, 0, date '2026-01-01', date '2026-02-01', 'active');

  -- B loses its source. This is exactly what happened on 2026-09-02.
  delete from public.service_purchases where id = v_pur_b;

  insert into rvf values ('org', v_org::text), ('sch_a', v_sch_a::text), ('sch_b', v_sch_b::text),
                         ('pur_a', v_pur_a::text), ('pur_b', v_pur_b::text),
                         ('deferred', v_deferred), ('revenue', v_revenue);
end $$;

-- --------------------------------------------------------------------------
-- 1. Run the recogniser exactly as the cron does.
-- --------------------------------------------------------------------------
do $$
declare
  v_sch_a uuid := (select v from rvf where k='sch_a')::uuid;
  v_sch_b uuid := (select v from rvf where k='sch_b')::uuid;
  v_rev text := (select v from rvf where k='revenue');
  v_posted int;
  v_a_recognised bigint; v_a_status text;
  v_b_recognised bigint; v_b_status text; v_b_reason text;
  v_b_entries int; v_b_revenue bigint;
begin
  v_posted := private.finance_recognize_revenue(date '2026-03-01');

  select recognized_minor, status into v_a_recognised, v_a_status
    from public.revenue_recognition_schedules where id = v_sch_a;
  select recognized_minor, status, cancelled_reason into v_b_recognised, v_b_status, v_b_reason
    from public.revenue_recognition_schedules where id = v_sch_b;

  -- Everything the orphan could possibly have posted, found by its own
  -- source_ref prefix rather than by counting rows globally.
  select count(*) into v_b_entries from public.finance_journal_entries
   where source = 'revenue_recognition' and source_ref like 'revrec:' || v_sch_b::text || ':%';
  select coalesce(sum(l.credit_minor - l.debit_minor), 0) into v_b_revenue
    from public.finance_journal_lines l
    join public.finance_journal_entries e on e.id = l.entry_id
   where e.source_ref like 'revrec:' || v_sch_b::text || ':%' and l.account_code = v_rev;

  insert into rv values
    ('CONTROL: live source still recognises', v_a_recognised::text, '1000000',
      case when v_a_recognised = 1000000 then 'PASS' else 'FAIL' end),
    ('CONTROL: live schedule completes', v_a_status, 'completed',
      case when v_a_status = 'completed' then 'PASS' else 'FAIL' end),
    ('orphan recognises nothing', v_b_recognised::text, '0',
      case when v_b_recognised = 0 then 'PASS' else 'FAIL' end),
    ('orphan is cancelled, not left active', v_b_status, 'cancelled',
      case when v_b_status = 'cancelled' then 'PASS' else 'FAIL' end),
    ('orphan cancellation states a reason', coalesce(left(v_b_reason, 40), '<null>'), 'non-null',
      case when v_b_reason is not null and v_b_reason <> '' then 'PASS' else 'FAIL' end),
    ('orphan posts no journal entry', v_b_entries::text, '0',
      case when v_b_entries = 0 then 'PASS' else 'FAIL' end),
    ('orphan books no revenue', v_b_revenue::text, '0',
      case when v_b_revenue = 0 then 'PASS' else 'FAIL' end);

  -- A control that never fires would make every check above meaningless.
  if v_posted < 1 then
    raise exception 'VACUOUS TEST: the recogniser posted nothing at all, so "orphan posts nothing" proves nothing';
  end if;
end $$;

-- --------------------------------------------------------------------------
-- 2. SABOTAGE. Restore the pre-migration behaviour -- a source check that
--    always says yes -- and confirm the orphan immediately invents revenue.
--    Without this, every assertion above could be passing for the wrong
--    reason (e.g. the recogniser silently doing nothing at all).
-- --------------------------------------------------------------------------
do $$
declare
  v_sch_b uuid := (select v from rvf where k='sch_b')::uuid;
  v_rev text := (select v from rvf where k='revenue');
  v_b_revenue bigint;
begin
  create or replace function private.revrec_source_exists(p_kind text, p_id uuid)
  returns boolean language sql immutable set search_path to '' as $sab$ select true $sab$;

  update public.revenue_recognition_schedules
     set status = 'active', cancelled_reason = null
   where id = v_sch_b;

  perform private.finance_recognize_revenue(date '2026-03-01');

  select coalesce(sum(l.credit_minor - l.debit_minor), 0) into v_b_revenue
    from public.finance_journal_lines l
    join public.finance_journal_entries e on e.id = l.entry_id
   where e.source_ref like 'revrec:' || v_sch_b::text || ':%' and l.account_code = v_rev;

  insert into rv values
    ('SABOTAGE: guard removed books phantom revenue', v_b_revenue::text, '1000000',
      case when v_b_revenue = 1000000 then 'PASS' else 'FAIL' end);

  if v_b_revenue <> 1000000 then
    raise exception 'VACUOUS TEST: with the guard removed the orphan still posted no revenue (%), so the guard is not what is stopping it', v_b_revenue;
  end if;
end $$;

select * from rv order by check_name;

do $$
declare v_fail int;
begin
  select count(*) into v_fail from rv where verdict <> 'PASS';
  if v_fail > 0 then
    raise exception 'HOLE OPEN: % check(s) failed -- see the table above', v_fail;
  end if;
  raise notice 'revenue recognition orphan-source guard: all checks passed';
end $$;

rollback;
