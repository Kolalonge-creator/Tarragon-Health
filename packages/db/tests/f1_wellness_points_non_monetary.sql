-- Proof (F1 fix 2, OQ-08): wellness points are non-monetary. Redeeming writes nothing and issues nothing;
-- no rate column exists; the redemptions table refuses any new row; the legacy history columns remain.
-- Sabotage 1: the insert-refusing trigger is dropped and an insert must then succeed (the refusal is what blocks it).
-- Sabotage 2: the RPC is replaced with a version that spends points; the detection logic must flag the balance change.
-- Wrapped in BEGIN/ROLLBACK; fails loudly with raise exception.
begin;

do $$
declare
  v_patient uuid;
  v_org     uuid;
  v_res     jsonb;
  v_bal     integer;
  v_ledger  integer;
  v_vouch   integer;
  v_redeem  integer;
  v_caught  boolean;
begin
  select id, organisation_id into v_patient, v_org from public.profiles where role = 'patient' limit 1;
  if v_patient is null then raise exception 'fixtures unavailable: need a patient profile'; end if;

  insert into public.wellness_points_balances (patient_id, organisation_id, balance, lifetime_earned)
  values (v_patient, v_org, 500, 500)
  on conflict (patient_id) do update set balance = 500, lifetime_earned = 500;

  select count(*) into v_ledger from public.wellness_points_ledger where patient_id = v_patient;
  select count(*) into v_vouch  from public.care_vouchers where beneficiary_profile_id = v_patient;
  select count(*) into v_redeem from public.wellness_points_redemptions where patient_id = v_patient;

  -- 1. Redeeming is refused with a calm result and changes nothing.
  perform set_config('request.jwt.claims', json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_res := public.redeem_wellness_points(100);
  reset role;
  if (v_res ->> 'ok')::boolean is not false or v_res ->> 'code' <> 'redemption_unavailable' then
    raise exception 'FAIL 1a: redeem should be refused, got %', v_res;
  end if;
  if v_res ? 'kobo_credited' or v_res ? 'voucher_id' then
    raise exception 'FAIL 1b: the result still carries a money field: %', v_res;
  end if;
  select balance into v_bal from public.wellness_points_balances where patient_id = v_patient;
  if v_bal <> 500 then raise exception 'FAIL 1c: balance changed to %', v_bal; end if;
  if (select count(*) from public.wellness_points_ledger where patient_id = v_patient) <> v_ledger then
    raise exception 'FAIL 1d: a ledger row was written';
  end if;
  if (select count(*) from public.care_vouchers where beneficiary_profile_id = v_patient) <> v_vouch then
    raise exception 'FAIL 1e: a voucher was issued';
  end if;
  if (select count(*) from public.wellness_points_redemptions where patient_id = v_patient) <> v_redeem then
    raise exception 'FAIL 1f: a redemption row was written';
  end if;

  -- 2. Anonymous callers cannot execute it at all.
  if has_function_privilege('anon', 'public.redeem_wellness_points(integer)', 'EXECUTE') then
    raise exception 'FAIL 2: anon can execute redeem_wellness_points';
  end if;

  -- 3. No conversion rate anywhere.
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'wellness_points_config'
                and column_name = 'points_to_kobo_rate') then
    raise exception 'FAIL 3a: points_to_kobo_rate still exists';
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname in ('public', 'private')
                and (p.prosrc ilike '%points_to_kobo_rate%'
                     or (p.proname = 'redeem_wellness_points' and p.prosrc ilike '%issue_reward_voucher%'))) then
    raise exception 'FAIL 3b: a function still converts points to money';
  end if;

  -- 4. The redemptions table refuses any new row, even from the table owner.
  v_caught := false;
  begin
    insert into public.wellness_points_redemptions (organisation_id, patient_id, points_redeemed, kobo_credited)
    values (v_org, v_patient, 10, 500);
  exception when check_violation then v_caught := true;
  end;
  if not v_caught then raise exception 'FAIL 4: a redemption row could be inserted'; end if;

  -- 5. SABOTAGE 1: drop the refusing trigger; the same insert must now succeed.
  drop trigger wellness_points_redemptions_refuse_insert on public.wellness_points_redemptions;
  insert into public.wellness_points_redemptions (organisation_id, patient_id, points_redeemed, kobo_credited)
  values (v_org, v_patient, 10, 500);
  if (select count(*) from public.wellness_points_redemptions where patient_id = v_patient) <> v_redeem + 1 then
    raise exception 'FAIL (sabotage 1): insert did not succeed with the trigger dropped; the refusal test is vacuous';
  end if;

  -- 6. SABOTAGE 2: a spending RPC must trip the same balance/ledger detection used in step 1.
  create or replace function public.redeem_wellness_points(p_points integer)
  returns jsonb language plpgsql security definer set search_path = '' as $f$
  begin
    update public.wellness_points_balances set balance = balance - p_points where patient_id = auth.uid();
    return jsonb_build_object('ok', true);
  end $f$;
  perform set_config('request.jwt.claims', json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_res := public.redeem_wellness_points(100);
  reset role;
  select balance into v_bal from public.wellness_points_balances where patient_id = v_patient;
  if v_bal = 500 then
    raise exception 'FAIL (sabotage 2): a spending RPC left the balance untouched; the balance check is vacuous';
  end if;

  raise notice 'PASS: wellness points are non-monetary; redemption disabled, no rate, no new redemption rows';
end $$;

rollback;
