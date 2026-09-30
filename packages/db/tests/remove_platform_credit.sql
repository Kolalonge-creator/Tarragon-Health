-- ===========================================================================
-- Proof: 20260930093012_remove_platform_credit.sql (S01b, founder decision F-01, INV-09).
--
-- Platform Credit (a prepaid stored balance) is removed. This script proves, against the real migrated
-- schema:
--   1. every Platform Credit table, enum type, function and module flag is gone;
--   2. payment_provider was rebuilt WITHOUT the 'platform_credit' label (and still has paystack etc.), and
--      the old type was dropped, so a purchase can never be recorded as credit-funded again;
--   3. the surviving finance / receipts / guarantee functions still run (plpgsql resolves references at
--      execution, so this is a CONTROL that no caller was left pointing at a dropped object);
--   4. the three recreated functions kept their ACLs (anon never; fraud sweep service_role only);
--   5. retained history stays valid (finance_journal_entries.source still allows 'platform_credit');
--   6. SABOTAGE: the "no function references platform_credit" scan is proven to discriminate, by planting
--      a stray caller and confirming the scan catches it, so check 1 is not vacuous.
--
-- Wrapped in BEGIN/ROLLBACK. Service-purchase credits (private.enforce_*_credit,
-- redeem_available_service_purchase, claim_lab_result_consult_credit) and Care Vouchers are a different
-- feature and are deliberately asserted to STILL EXIST.
--
-- Run:  psql -f packages/db/tests/remove_platform_credit.sql  (CI: scripts/run-db-proofs.sh)
-- ===========================================================================

begin;

create temporary table _checks (n serial, msg text) on commit drop;

do $$
declare
  v_n integer;
  v_org uuid;
  v_admin uuid;
  v_patient uuid;
  v_res jsonb;
  v_caught boolean;
  v_labels text;
begin
  -- ====== 1. The feature is gone ============================================
  select count(*) into v_n from pg_class where relnamespace = 'public'::regnamespace and relname like 'platform_credit%';
  if v_n <> 0 then raise exception 'FAIL 1: % platform_credit relation(s) remain', v_n; end if;
  select count(*) into v_n from pg_type where typnamespace = 'public'::regnamespace and typname like 'platform_credit%';
  if v_n <> 0 then raise exception 'FAIL 1: % platform_credit type(s) remain', v_n; end if;
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private') and p.proname like '%platform_credit%';
  if v_n <> 0 then raise exception 'FAIL 1: % function(s) still named platform_credit', v_n; end if;
  if exists (select 1 from public.platform_modules where key = 'platform_credit_topups') then
    raise exception 'FAIL 1: platform_credit_topups module flag remains';
  end if;
  insert into _checks (msg) values ('PASS 1: no platform_credit table, type, function or module flag remains');

  -- ====== 2. The enum VALUE is deleted ======================================
  select string_agg(enumlabel, ',' order by enumlabel) into v_labels from pg_enum where enumtypid = 'public.payment_provider'::regtype;
  if v_labels is distinct from 'employer,paystack,stripe,voucher,wallet' then
    raise exception 'FAIL 2: payment_provider labels are %, expected employer,paystack,stripe,voucher,wallet', v_labels;
  end if;
  begin
    perform 'platform_credit'::public.payment_provider;
    raise exception 'FAIL 2: payment_provider still accepts platform_credit';
  exception when invalid_text_representation then
    null;
  end;
  if exists (select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = 'payment_provider_old') then
    raise exception 'FAIL 2: payment_provider_old was not dropped';
  end if;
  insert into _checks (msg) values ('PASS 2: payment_provider rebuilt without platform_credit; the old type is gone');

  -- ====== 3. CONTROL: surviving functions still run =========================
  select id, organisation_id into v_admin, v_org from public.profiles where role = 'admin' limit 1;
  select id into v_patient from public.profiles where role = 'patient' limit 1;
  if v_admin is null or v_patient is null then raise exception 'fixture FAIL: need an admin and a patient profile'; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform count(*) from public.finance_unified_ledger(p_organisation_id := v_org, p_limit := 5);
  perform public.finance_revenue_by_funding_source(current_date - 30, current_date, 'NGN');
  reset role;
  insert into _checks (msg) values ('PASS 3a: finance_unified_ledger and finance_revenue_by_funding_source run without the credit tables');

  perform set_config('request.jwt.claims', json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_res := public.patient_receipts();
  if jsonb_typeof(v_res) is distinct from 'array' then raise exception 'FAIL 3b: patient_receipts did not return an array, got %', v_res; end if;
  v_res := public.request_purchase_guarantee_refund(gen_random_uuid());
  if (v_res ->> 'reason') is distinct from 'not_found' then raise exception 'FAIL 3b: guarantee request for an unknown purchase should be not_found, got %', v_res; end if;
  reset role;
  insert into _checks (msg) values ('PASS 3b: patient_receipts and request_purchase_guarantee_refund run and answer correctly');

  perform count(*) from public.payments_with_payer_for_fraud_sweep(now() - interval '1 day', now());
  insert into _checks (msg) values ('PASS 3c: payments_with_payer_for_fraud_sweep (recreated on the new enum) runs');

  -- Different features that merely share the word "credit" must still exist.
  if not exists (select 1 from pg_proc where proname = 'redeem_available_service_purchase' and pronamespace = 'public'::regnamespace)
     or not exists (select 1 from pg_proc where proname = 'claim_lab_result_consult_credit' and pronamespace = 'public'::regnamespace)
     or not exists (select 1 from pg_class where relname = 'care_vouchers' and relnamespace = 'public'::regnamespace) then
    raise exception 'FAIL 3d: service-purchase credits or Care Vouchers were removed by mistake';
  end if;
  insert into _checks (msg) values ('PASS 3d: service-purchase credits and Care Vouchers are untouched');

  -- ====== 4. Recreated functions kept their ACLs ============================
  if has_function_privilege('anon', 'public.record_voucher_payment_intent(uuid,bigint,text,bigint,public.payment_provider,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.record_screening_day_payment_intent(uuid,bigint,text,bigint,public.payment_provider,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.payments_with_payer_for_fraud_sweep(timestamptz,timestamptz)', 'EXECUTE') then
    raise exception 'FAIL 4: anon can EXECUTE a recreated function';
  end if;
  if not has_function_privilege('authenticated', 'public.record_voucher_payment_intent(uuid,bigint,text,bigint,public.payment_provider,text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.record_screening_day_payment_intent(uuid,bigint,text,bigint,public.payment_provider,text)', 'EXECUTE') then
    raise exception 'FAIL 4: authenticated lost EXECUTE on a payment-intent function (the gate must open as well as close)';
  end if;
  if has_function_privilege('authenticated', 'public.payments_with_payer_for_fraud_sweep(timestamptz,timestamptz)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.payments_with_payer_for_fraud_sweep(timestamptz,timestamptz)', 'EXECUTE') then
    raise exception 'FAIL 4: the fraud-sweep function must be service_role only';
  end if;
  insert into _checks (msg) values ('PASS 4: recreated functions kept their ACLs (anon never; fraud sweep service_role only)');

  -- ====== 5. Retained history stays valid ===================================
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.finance_journal_entries'::regclass and conname = 'finance_journal_entries_source_check'
      and pg_get_constraintdef(oid) ilike '%platform_credit%'
  ) then
    raise exception 'FAIL 5: the journal source CHECK no longer allows retained platform_credit history rows';
  end if;
  insert into _checks (msg) values ('PASS 5: retained GL history (source = platform_credit) is still valid under its CHECK');

  -- ====== 6. SABOTAGE: prove the stray-caller scan discriminates ============
  create function private.zz_s01b_stray_caller() returns void language plpgsql as
    $f$ begin perform 1 from public.platform_credit_balances; end $f$;
  select count(*) > 0 into v_caught
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private', 'analytics') and p.prosrc ilike '%platform_credit%'
    and not (n.nspname = 'public' and p.proname in ('finance_unified_ledger', 'finance_revenue_by_funding_source'));
  drop function private.zz_s01b_stray_caller();
  if not v_caught then raise exception 'VACUOUS: the function scan did not catch a planted platform_credit caller'; end if;
  select count(*) into v_n
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private', 'analytics') and p.prosrc ilike '%platform_credit%'
    and not (n.nspname = 'public' and p.proname in ('finance_unified_ledger', 'finance_revenue_by_funding_source'));
  if v_n <> 0 then raise exception 'FAIL 6: % function(s) still reference platform_credit', v_n; end if;
  insert into _checks (msg) values ('PASS 6: the scan catches a planted caller, and with it removed no function references platform_credit');
end $$;

select msg from _checks order by n;

rollback;
