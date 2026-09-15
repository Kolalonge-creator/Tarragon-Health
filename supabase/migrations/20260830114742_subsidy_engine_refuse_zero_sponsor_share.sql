-- create_transaction_subsidy previously allowed a "subsidy" whose sponsor
-- share came out to zero (no active subsidy_split_rules row covers this
-- organisation/order-type combination) to be created anyway, leaving the
-- patient owing the full amount through the subsidy_contributions path
-- instead of the ordinary direct-payment path, and leaving the order
-- structurally locked out of the normal booking payment flow (the unique
-- (order_type, order_id) constraint on transaction_subsidies) for no real
-- benefit. Refusing outright when the computed sponsor share is zero is
-- more correct: it tells the caller plainly that nothing is configured to
-- split here, instead of silently creating a subsidy record that subsidizes
-- nothing.
--
-- Verified in a rolled-back transaction before applying: a rule scoped to
-- 'pharmacy' only leaves a lab order's computed sponsor share at zero, and
-- attempting to subsidize that lab order is now refused with no orphaned
-- transaction_subsidies row left behind; a genuinely matching rule still
-- produces a real subsidy (regression check).
create or replace function public.create_transaction_subsidy(
  p_order_type text, p_order_id uuid, p_sponsor_profile_id uuid
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_caller uuid := auth.uid();
  v_patient uuid;
  v_org uuid;
  v_status text;
  v_payable bigint;
  v_split record;
  v_subsidy_id uuid;
  v_sponsor_contribution_id uuid;
  v_patient_contribution_id uuid;
begin
  if v_caller is null then raise exception 'not authenticated'; end if;
  if p_order_type not in ('lab', 'pharmacy', 'referral') then
    raise exception 'subsidies can only be applied to lab, pharmacy, or referral orders';
  end if;
  if v_caller <> p_sponsor_profile_id then
    raise exception 'only the sponsor themselves can initiate a subsidized checkout' using errcode = '42501';
  end if;

  if p_order_type = 'lab' then
    select patient_id, organisation_id, status::text, payable_kobo into v_patient, v_org, v_status, v_payable
      from public.lab_orders where id = p_order_id for update;
  elsif p_order_type = 'pharmacy' then
    select patient_id, organisation_id, status::text, payable_kobo into v_patient, v_org, v_status, v_payable
      from public.pharmacy_orders where id = p_order_id for update;
  else
    select patient_id, organisation_id, status::text, payable_kobo into v_patient, v_org, v_status, v_payable
      from public.specialist_referrals where id = p_order_id for update;
  end if;

  if v_patient is null then raise exception 'order not found'; end if;
  if v_status <> 'pending_payment' then raise exception 'that order is not awaiting payment'; end if;
  if v_payable is null or v_payable <= 0 then raise exception 'that order has nothing left to pay'; end if;

  if not exists (
    select 1 from public.profile_access pa
    where pa.profile_id = v_patient and pa.grantee_user_id = p_sponsor_profile_id and pa.permission_level = 'manage'
  ) then
    raise exception 'you are not authorised to sponsor this person''s care' using errcode = '42501';
  end if;

  if exists (select 1 from public.transaction_subsidies where order_type = p_order_type and order_id = p_order_id) then
    raise exception 'this order already has a subsidy in progress';
  end if;

  select * into v_split from private.compute_transaction_subsidy(v_org, p_order_type, v_payable);

  if v_split.sponsor_amount_kobo <= 0 then
    raise exception 'no subsidy is configured for this organisation and order type — pay the full bill directly instead';
  end if;

  insert into public.transaction_subsidies
    (organisation_id, beneficiary_profile_id, sponsor_profile_id, order_type, order_id,
     gross_amount_kobo, sponsor_amount_kobo, patient_amount_kobo, currency, split_rule_id)
  values (v_org, v_patient, p_sponsor_profile_id, p_order_type, p_order_id,
          v_payable, v_split.sponsor_amount_kobo, v_split.patient_amount_kobo, 'NGN', v_split.rule_id)
  returning id into v_subsidy_id;

  insert into public.subsidy_contributions
    (transaction_subsidy_id, role, payer_profile_id, amount_minor, currency, organisation_id)
  values (v_subsidy_id, 'sponsor', p_sponsor_profile_id, v_split.sponsor_amount_kobo, 'NGN', v_org)
  returning id into v_sponsor_contribution_id;

  if v_split.patient_amount_kobo > 0 then
    insert into public.subsidy_contributions
      (transaction_subsidy_id, role, payer_profile_id, amount_minor, currency, organisation_id)
    values (v_subsidy_id, 'patient', v_patient, v_split.patient_amount_kobo, 'NGN', v_org)
    returning id into v_patient_contribution_id;
  end if;

  return jsonb_build_object(
    'ok', true, 'subsidy_id', v_subsidy_id,
    'sponsor_amount_kobo', v_split.sponsor_amount_kobo, 'patient_amount_kobo', v_split.patient_amount_kobo,
    'sponsor_contribution_id', v_sponsor_contribution_id, 'patient_contribution_id', v_patient_contribution_id
  );
end;
$$;
revoke all on function public.create_transaction_subsidy(text, uuid, uuid) from public;
grant execute on function public.create_transaction_subsidy(text, uuid, uuid) to authenticated;

do $$
begin
  if (select count(*) from pg_proc where proname = 'create_transaction_subsidy') <> 1 then
    raise exception 'create_transaction_subsidy has more than one overload';
  end if;
end $$;
