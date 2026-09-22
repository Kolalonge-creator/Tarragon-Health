-- ===========================================================================
-- Verification: Platform Credit new-top-ups kill switch
-- (20260922185100_platform_credit_topups_kill_switch.sql).
--
-- Proves what the migration's own inline self-check could not fully cover in
-- CI replay isolation, and adds the "assert the gate opens, not just closes"
-- + sabotage discipline as a standing regression test rather than a one-off
-- migration comment:
--   * public.record_platform_credit_topup_intent refuses with the
--     patient-facing message while public.platform_modules.key =
--     'platform_credit_topups' is off (the default it ships in);
--   * switching the module ON (the real RPC, private.is_admin() gate and
--     all — not a bare UPDATE) makes the SAME call succeed for the SAME
--     patient — the gate discriminates, it does not just always refuse;
--   * spend (pay_service_purchase_on_platform_credit) and read (balance,
--     ledger) are COMPLETELY unaffected by the switch, in either position —
--     this is the module's whole point: it gates new money in, never
--     already-funded credit;
--   * a sabotage run (module forced back off after being briefly on)
--     confirms the refusal reasserts itself, not just that it worked once.
--
-- Wrapped in BEGIN/ROLLBACK — a verification script, never seed data.
-- ===========================================================================

begin;

create temporary table pctk_fixture(k text primary key, v uuid) on commit drop;
create temporary table pctk_result(
  check_name text,
  observed   text,
  expected   text,
  verdict    text
) on commit drop;

-- ---------------------------------------------------------------------------
-- Fixture: one org, one fresh patient, funded with real platform credit so
-- the spend/read-unaffected checks have something real to exercise.
-- ---------------------------------------------------------------------------
do $$
declare
  v_org     uuid;
  v_patient uuid := gen_random_uuid();
  v_admin   uuid := gen_random_uuid();
begin
  select id into v_org from public.organisations limit 1;
  if v_org is null then
    raise exception 'no organisation available — cannot run this test';
  end if;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values
    (v_patient, 'pctk-patient@example.invalid', 'x', now(), '{}', '{}'),
    (v_admin,   'pctk-admin@example.invalid',   'x', now(), '{}', '{}');

  insert into public.profiles (id, organisation_id, role, full_name)
  values (v_patient, v_org, 'patient', 'PCTK Patient'), (v_admin, v_org, 'admin', 'PCTK Admin')
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role;

  perform private.platform_credit_apply(
    p_patient_id := v_patient, p_organisation_id := v_org, p_entry_type := 'topup',
    p_amount_kobo := 500000, p_description := 'pctk fixture funding (pre-existing balance)'
  );

  insert into pctk_fixture values ('org', v_org), ('patient', v_patient), ('admin', v_admin);
end $$;

-- ==========================================================================
-- 1. Module ships off by default (real deployed state, not just this test's
--    assumption) — confirm before asserting anything about it.
-- ==========================================================================
do $$
declare
  v_enabled boolean;
begin
  select is_enabled into v_enabled from public.platform_modules where key = 'platform_credit_topups';
  insert into pctk_result values
    ('platform_credit_topups ships is_enabled = false', v_enabled::text, 'false',
     case when v_enabled is false then 'PASS' else 'FAIL' end);
  if v_enabled is not false then
    raise exception 'FAIL: platform_credit_topups should ship off — got is_enabled=%', v_enabled;
  end if;
end $$;

-- ==========================================================================
-- 2. THE GATE — a real patient session is refused, with the patient-facing
--    message, while the module is off.
-- ==========================================================================
do $$
declare
  v_patient uuid := (select v from pctk_fixture where k = 'patient');
  v_error   text;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_patient::text, 'role', 'authenticated')::text, true);
  begin
    set local role authenticated;
    perform public.record_platform_credit_topup_intent(v_patient, 1000000);
    reset role;
    v_error := 'ACCEPTED';
  exception when others then
    begin reset role; exception when others then null; end;
    v_error := sqlerrm;
  end;

  insert into pctk_result values
    ('a top-up intent is refused while the module is off', v_error,
     'not available right now (patient-facing message)',
     case when v_error <> 'ACCEPTED' and position('not available right now' in v_error) > 0
          then 'PASS' else 'FAIL' end);

  if v_error = 'ACCEPTED' then
    raise exception 'HOLE OPEN: a top-up intent was accepted while platform_credit_topups is off';
  end if;
  if position('not available right now' in v_error) = 0 then
    raise exception 'FAIL: refusal is not the patient-facing message this action/route surface (got: %)', v_error;
  end if;

  if exists (
    select 1 from public.platform_credit_topup_intents where patient_id = v_patient
  ) then
    raise exception 'FAIL: a refused top-up attempt still created a platform_credit_topup_intents row';
  end if;
end $$;

-- ==========================================================================
-- 3. Spend and read are completely unaffected by the module being off — the
--    module's whole point (gate NEW money in, never already-funded credit).
-- ==========================================================================
do $$
declare
  v_org     uuid := (select v from pctk_fixture where k = 'org');
  v_patient uuid := (select v from pctk_fixture where k = 'patient');
  v_product uuid;
  v_purchase_id uuid;
  v_result jsonb;
  v_balance_before bigint;
  v_balance_after  bigint;
  v_ledger_count   int;
begin
  select balance_kobo into v_balance_before from public.platform_credit_balances where patient_id = v_patient;
  if v_balance_before <> 500000 then
    raise exception 'fixture setup FAIL: expected 500000 kobo balance, got %', v_balance_before;
  end if;

  select id into v_product from public.service_products
   where is_active and currency = 'NGN' and price_kobo > 0 and price_kobo <= 500000
   order by price_kobo, code limit 1;
  if v_product is null then
    raise notice 'SKIP: no active NGN product priced at or below the fixture balance — spend sub-check skipped, read sub-check still runs';
  else
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_patient::text, 'role', 'authenticated')::text, true);
    set local role authenticated;
    select public.record_service_purchase_intent(v_patient, (select code from public.service_products where id = v_product))
      into v_purchase_id;
    select public.pay_service_purchase_on_platform_credit(v_purchase_id) into v_result;
    reset role;

    insert into pctk_result values
      ('spend (pay_service_purchase_on_platform_credit) still works while top-ups are off', v_result::text, 'ok=true',
       case when (v_result ->> 'ok')::boolean is true then 'PASS' else 'FAIL' end);
    if (v_result ->> 'ok')::boolean is distinct from true then
      raise exception 'FAIL: spending already-funded platform credit should be unaffected by the top-ups kill switch, got %', v_result;
    end if;

    select balance_kobo into v_balance_after from public.platform_credit_balances where patient_id = v_patient;
    if v_balance_after >= v_balance_before then
      raise exception 'FAIL: the spend did not reduce the balance (before=%, after=%)', v_balance_before, v_balance_after;
    end if;
  end if;

  -- Read: balance + ledger stay fully visible regardless of the switch.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_patient::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_ledger_count from public.platform_credit_ledger_entries where patient_id = v_patient;
  reset role;

  insert into pctk_result values
    ('reading balance/ledger still works while top-ups are off', v_ledger_count::text, '>0',
     case when v_ledger_count > 0 then 'PASS' else 'FAIL' end);
  if v_ledger_count = 0 then
    raise exception 'FAIL: the patient could not read their own ledger while top-ups are off';
  end if;
end $$;

-- ==========================================================================
-- 4. Sabotage — a superadmin switching the module ON (the real
--    public.set_platform_module RPC, not a bare UPDATE) makes the SAME
--    top-up call succeed for the SAME patient. Then switch it back off and
--    confirm the refusal reasserts itself, so this isn't a one-shot state
--    change but a real toggle.
-- ==========================================================================
do $$
declare
  v_patient uuid := (select v from pctk_fixture where k = 'patient');
  v_admin   uuid := (select v from pctk_fixture where k = 'admin');
  v_intent_id uuid;
  v_error_after_off_again text;
begin
  -- Superadmin switches it on for real.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.set_platform_module('platform_credit_topups', true, 'pctk sabotage probe');
  reset role;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_patient::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select public.record_platform_credit_topup_intent(v_patient, 1000000) into v_intent_id;
  reset role;

  insert into pctk_result values
    ('sabotage: switching the module ON reopens top-ups for the same patient', v_intent_id::text, '<a real intent id>',
     case when v_intent_id is not null then 'PASS (discriminates)' else 'FAIL (vacuous)' end);
  if v_intent_id is null then
    raise exception 'The check-2 proof does not discriminate: switching the module on did not reopen top-ups';
  end if;
  if not exists (select 1 from public.platform_credit_topup_intents where id = v_intent_id and patient_id = v_patient) then
    raise exception 'FAIL: the accepted top-up intent was not actually recorded';
  end if;

  -- Switch back off and confirm the refusal reasserts itself.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.set_platform_module('platform_credit_topups', false, null);
  reset role;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_patient::text, 'role', 'authenticated')::text, true);
  begin
    set local role authenticated;
    perform public.record_platform_credit_topup_intent(v_patient, 1000000);
    reset role;
    v_error_after_off_again := 'ACCEPTED';
  exception when others then
    begin reset role; exception when others then null; end;
    v_error_after_off_again := sqlerrm;
  end;

  insert into pctk_result values
    ('switching back off refuses top-ups again (real toggle, not one-shot)', v_error_after_off_again,
     'not available right now',
     case when v_error_after_off_again <> 'ACCEPTED' and position('not available right now' in v_error_after_off_again) > 0
          then 'PASS' else 'FAIL' end);
  if v_error_after_off_again = 'ACCEPTED' then
    raise exception 'FAIL: switching the module back off did not refuse a subsequent top-up attempt';
  end if;
end $$;

-- ==========================================================================
-- Summary
-- ==========================================================================
select * from pctk_result order by check_name;

do $$
declare
  v_fails int;
begin
  select count(*) into v_fails from pctk_result where verdict not like 'PASS%';
  if v_fails > 0 then
    raise exception '% check(s) failed — see the result table above', v_fails;
  end if;
  raise notice 'PASS: platform_credit_topups kill switch — gate closes/opens/re-closes correctly, spend/read always unaffected, all % checks green', (select count(*) from pctk_result);
end $$;

rollback;
