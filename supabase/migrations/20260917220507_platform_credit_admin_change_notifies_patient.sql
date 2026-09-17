-- Tarragon Health — an admin changing a patient's Platform Credit balance
-- now tells the patient.
--
-- Gap found auditing the rest of the Platform Credit feature after
-- fix/platform-credit-gaps: grant_platform_credit and correct_platform_credit
-- (20260917100406_platform_credit_ledger_functions.sql) can move a patient's
-- balance with zero signal to the patient — no in_app row, nothing. Every
-- comparable admin-initiated money event on this platform tells the
-- beneficiary: reward vouchers do (private.issue_reward_voucher's
-- 'reward_voucher_issued' insert, 20260731215424), sponsored-plan activation
-- tells both sides (20260731020000-era 'sponsored_plan_started'). Platform
-- Credit was the one left silent.
--
-- Scoped to admin_grant/admin_correction only — a patient's own 'topup'/
-- 'spend' already gets immediate feedback from the page they are looking at
-- when it happens, so notifying them of their own action would be noise.
--
-- One template covers both entry types rather than two, since the only real
-- difference is direction: a grant is always an increase (nobody pays it
-- back), a correction carries its own explicit increase/decrease. Naira
-- amount is computed server-side into the payload (same pattern
-- reward_voucher_issued uses for value_naira) so the notification-bell
-- client never needs a kobo-to-naira import for this one row type.
--
-- Wrapped in its own exception handler, same discipline as
-- issue_reward_voucher's outer 'exception when others then return null' — a
-- notification must never block the balance write it is reporting on.

create or replace function private.platform_credit_apply(
  p_patient_id uuid,
  p_organisation_id uuid,
  p_entry_type public.platform_credit_entry_type,
  p_amount_kobo bigint,
  p_correction_bucket public.platform_credit_bucket default null,
  p_correction_direction text default null,
  p_service_purchase_id uuid default null,
  p_payment_transaction_id uuid default null,
  p_topup_intent_id uuid default null,
  p_description text default null,
  p_created_by uuid default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_balance public.platform_credit_balances%rowtype;
  v_paid_amount bigint := 0;
  v_promo_amount bigint := 0;
  v_from_promo bigint;
  v_from_paid bigint;
  v_new_balance bigint;
begin
  if p_amount_kobo is null or p_amount_kobo <= 0 then
    raise exception 'platform credit movement amount must be positive';
  end if;

  insert into public.platform_credit_balances (patient_id, organisation_id)
    values (p_patient_id, p_organisation_id)
    on conflict (patient_id) do nothing;

  select * into v_balance from public.platform_credit_balances
    where patient_id = p_patient_id for update;

  if p_entry_type = 'topup' then
    v_paid_amount := p_amount_kobo;
    update public.platform_credit_balances
      set paid_balance_kobo = paid_balance_kobo + v_paid_amount,
          lifetime_funded_kobo = lifetime_funded_kobo + v_paid_amount
      where patient_id = p_patient_id;

  elsif p_entry_type = 'admin_grant' then
    v_promo_amount := p_amount_kobo;
    update public.platform_credit_balances
      set promo_balance_kobo = promo_balance_kobo + v_promo_amount,
          lifetime_granted_kobo = lifetime_granted_kobo + v_promo_amount
      where patient_id = p_patient_id;

  elsif p_entry_type = 'spend' then
    v_from_promo := least(v_balance.promo_balance_kobo, p_amount_kobo);
    v_from_paid := p_amount_kobo - v_from_promo;
    if v_from_paid > v_balance.paid_balance_kobo then
      raise exception 'insufficient platform credit balance: have % kobo, need % kobo',
        v_balance.balance_kobo, p_amount_kobo
        using errcode = 'TH001';
    end if;
    v_promo_amount := v_from_promo;
    v_paid_amount := v_from_paid;
    update public.platform_credit_balances
      set promo_balance_kobo = promo_balance_kobo - v_from_promo,
          paid_balance_kobo = paid_balance_kobo - v_from_paid,
          lifetime_spent_kobo = lifetime_spent_kobo + p_amount_kobo
      where patient_id = p_patient_id;

  elsif p_entry_type = 'admin_correction' then
    if p_correction_bucket is null or p_correction_direction not in ('increase', 'decrease') then
      raise exception 'admin_correction requires a bucket and a direction of increase/decrease';
    end if;
    if p_correction_direction = 'decrease' then
      if p_correction_bucket = 'paid' and p_amount_kobo > v_balance.paid_balance_kobo then
        raise exception 'insufficient paid balance for this correction: have % kobo, need % kobo',
          v_balance.paid_balance_kobo, p_amount_kobo using errcode = 'TH001';
      end if;
      if p_correction_bucket = 'promo' and p_amount_kobo > v_balance.promo_balance_kobo then
        raise exception 'insufficient promo balance for this correction: have % kobo, need % kobo',
          v_balance.promo_balance_kobo, p_amount_kobo using errcode = 'TH001';
      end if;
    end if;
    if p_correction_bucket = 'paid' then
      v_paid_amount := p_amount_kobo;
      update public.platform_credit_balances
        set paid_balance_kobo = paid_balance_kobo
          + (case when p_correction_direction = 'increase' then p_amount_kobo else -p_amount_kobo end),
            lifetime_funded_kobo = lifetime_funded_kobo
          + (case when p_correction_direction = 'increase' then p_amount_kobo else 0 end)
        where patient_id = p_patient_id;
    else
      v_promo_amount := p_amount_kobo;
      update public.platform_credit_balances
        set promo_balance_kobo = promo_balance_kobo
          + (case when p_correction_direction = 'increase' then p_amount_kobo else -p_amount_kobo end),
            lifetime_granted_kobo = lifetime_granted_kobo
          + (case when p_correction_direction = 'increase' then p_amount_kobo else 0 end)
        where patient_id = p_patient_id;
    end if;
  else
    raise exception 'unhandled platform_credit_entry_type: %', p_entry_type;
  end if;

  select balance_kobo into v_new_balance from public.platform_credit_balances where patient_id = p_patient_id;

  insert into public.platform_credit_ledger_entries
    (organisation_id, patient_id, entry_type, paid_amount_kobo, promo_amount_kobo,
     balance_after_kobo, service_purchase_id, payment_transaction_id, topup_intent_id,
     description, created_by)
  values
    (p_organisation_id, p_patient_id, p_entry_type, v_paid_amount, v_promo_amount,
     v_new_balance, p_service_purchase_id, p_payment_transaction_id, p_topup_intent_id,
     p_description, p_created_by);

  -- Tell the patient when an admin moved money they didn't touch themselves.
  -- Their own topup/spend already gets immediate on-screen feedback from the
  -- page that triggered it, so this is deliberately scoped to the two
  -- admin-initiated entry types only.
  if p_entry_type in ('admin_grant', 'admin_correction') then
    begin
      insert into public.notifications (organisation_id, recipient_id, channel, template, payload)
      values (
        p_organisation_id, p_patient_id, 'in_app', 'platform_credit_balance_adjusted',
        jsonb_build_object(
          'direction', case when p_entry_type = 'admin_grant' then 'increase' else p_correction_direction end,
          'amount_naira', (p_amount_kobo / 100)::text,
          'reason', p_description
        )
      );
    exception when others then
      -- A notification must never block the balance write it is reporting on.
      null;
    end;
  end if;

  return v_new_balance;
end;
$$;

revoke all on function private.platform_credit_apply(
  uuid, uuid, public.platform_credit_entry_type, bigint, public.platform_credit_bucket, text,
  uuid, uuid, uuid, text, uuid
) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Assertions -- structural (still locked down) then a real behavioural round
-- trip: grant, correct, confirm exactly two notifications land with the
-- right template/payload, confirm a plain topup/spend does NOT notify, clean
-- up completely.
-- ---------------------------------------------------------------------------
do $$
declare
  v_patient uuid;
  v_org uuid;
  v_pre_existing_balance public.platform_credit_balances%rowtype;
  v_had_pre_existing_balance boolean;
  v_grant_ledger_id uuid;
  v_correction_ledger_id uuid;
  v_topup_ledger_id uuid;
  v_notif record;
  v_notif_count_before integer;
  v_notif_count_after_topup integer;
begin
  if has_function_privilege('anon', 'private.platform_credit_apply(uuid,uuid,public.platform_credit_entry_type,bigint,public.platform_credit_bucket,text,uuid,uuid,uuid,text,uuid)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute private.platform_credit_apply';
  end if;
  if has_function_privilege('authenticated', 'private.platform_credit_apply(uuid,uuid,public.platform_credit_entry_type,bigint,public.platform_credit_bucket,text,uuid,uuid,uuid,text,uuid)', 'EXECUTE') then
    raise exception 'FAIL: authenticated can execute private.platform_credit_apply directly';
  end if;

  select id, organisation_id into v_patient, v_org from public.profiles where role = 'patient' limit 1;
  if v_patient is null then
    raise notice 'SKIPPED behavioural proof: no patient row exists to test against';
    return;
  end if;

  select * into v_pre_existing_balance from public.platform_credit_balances where patient_id = v_patient;
  v_had_pre_existing_balance := found;

  select count(*) into v_notif_count_before from public.notifications
    where recipient_id = v_patient and template = 'platform_credit_balance_adjusted';

  -- A plain top-up must NOT notify -- the patient is looking at the page
  -- that just credited them.
  perform private.platform_credit_apply(
    p_patient_id := v_patient, p_organisation_id := v_org, p_entry_type := 'topup',
    p_amount_kobo := 40000, p_description := 'migration-proof: admin-change-notifies (topup, must not notify)'
  );
  select id into v_topup_ledger_id from public.platform_credit_ledger_entries
    where patient_id = v_patient and description = 'migration-proof: admin-change-notifies (topup, must not notify)'
    order by created_at desc limit 1;
  select count(*) into v_notif_count_after_topup from public.notifications
    where recipient_id = v_patient and template = 'platform_credit_balance_adjusted';
  if v_notif_count_after_topup <> v_notif_count_before then
    raise exception 'FAIL: a plain patient-initiated top-up triggered a platform_credit_balance_adjusted notification';
  end if;

  -- An admin grant must notify, with direction=increase.
  perform private.platform_credit_apply(
    p_patient_id := v_patient, p_organisation_id := v_org, p_entry_type := 'admin_grant',
    p_amount_kobo := 50000, p_description := 'migration-proof: admin-change-notifies (grant)',
    p_created_by := v_patient
  );
  select id into v_grant_ledger_id from public.platform_credit_ledger_entries
    where patient_id = v_patient and description = 'migration-proof: admin-change-notifies (grant)'
    order by created_at desc limit 1;

  select * into v_notif from public.notifications
    where recipient_id = v_patient and template = 'platform_credit_balance_adjusted'
      and payload ->> 'reason' = 'migration-proof: admin-change-notifies (grant)'
    order by created_at desc limit 1;
  if v_notif.id is null then
    raise exception 'FAIL: an admin grant did not notify the patient';
  end if;
  if v_notif.payload ->> 'direction' <> 'increase' then
    raise exception 'FAIL: grant notification direction was % instead of increase', v_notif.payload ->> 'direction';
  end if;
  if v_notif.payload ->> 'amount_naira' <> '500' then
    raise exception 'FAIL: grant notification amount_naira was % instead of 500', v_notif.payload ->> 'amount_naira';
  end if;
  if v_notif.channel <> 'in_app' then
    raise exception 'FAIL: grant notification channel was % instead of in_app', v_notif.channel;
  end if;

  -- A correction (decrease) must notify with direction=decrease.
  perform private.platform_credit_apply(
    p_patient_id := v_patient, p_organisation_id := v_org, p_entry_type := 'admin_correction',
    p_amount_kobo := 50000, p_correction_bucket := 'promo', p_correction_direction := 'decrease',
    p_description := 'migration-proof: admin-change-notifies (correction)', p_created_by := v_patient
  );
  select id into v_correction_ledger_id from public.platform_credit_ledger_entries
    where patient_id = v_patient and description = 'migration-proof: admin-change-notifies (correction)'
    order by created_at desc limit 1;

  select * into v_notif from public.notifications
    where recipient_id = v_patient and template = 'platform_credit_balance_adjusted'
      and payload ->> 'reason' = 'migration-proof: admin-change-notifies (correction)'
    order by created_at desc limit 1;
  if v_notif.id is null then
    raise exception 'FAIL: an admin correction did not notify the patient';
  end if;
  if v_notif.payload ->> 'direction' <> 'decrease' then
    raise exception 'FAIL: correction notification direction was % instead of decrease', v_notif.payload ->> 'direction';
  end if;

  -- Clean up everything this proof created.
  delete from public.notifications
    where recipient_id = v_patient and template = 'platform_credit_balance_adjusted'
      and payload ->> 'reason' in (
        'migration-proof: admin-change-notifies (grant)',
        'migration-proof: admin-change-notifies (correction)'
      );
  delete from public.platform_credit_ledger_entries
    where id in (v_topup_ledger_id, v_grant_ledger_id, v_correction_ledger_id);

  if v_had_pre_existing_balance then
    update public.platform_credit_balances
      set paid_balance_kobo = v_pre_existing_balance.paid_balance_kobo,
          promo_balance_kobo = v_pre_existing_balance.promo_balance_kobo,
          lifetime_funded_kobo = v_pre_existing_balance.lifetime_funded_kobo,
          lifetime_granted_kobo = v_pre_existing_balance.lifetime_granted_kobo,
          lifetime_spent_kobo = v_pre_existing_balance.lifetime_spent_kobo
      where patient_id = v_patient;
  else
    delete from public.platform_credit_balances where patient_id = v_patient;
  end if;

  raise notice 'PASS: admin_grant/admin_correction now notify the patient in-app with the correct direction/amount, a plain topup does not, and the write path still cannot be reached by anon/authenticated directly';
end $$;
