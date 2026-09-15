-- Lets a patient close out their own abandoned checkout for real, instead of
-- the payment-failure-banner nagging forever. service_purchases_update only
-- allows org staff to write (20260831140512_service_products_and_purchases_core.sql),
-- so this is a SECURITY DEFINER RPC scoped to the row's own patient_id,
-- same shape as delete_wearable_connection_data
-- (20260829120000_wearable_granular_consent_and_patient_control.sql).
-- service_purchase_status already carries 'cancelled' -- no enum change needed.

create or replace function public.cancel_pending_service_purchase(p_service_purchase_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_patient_id uuid;
  v_status public.service_purchase_status;
begin
  select patient_id, status into v_patient_id, v_status
  from public.service_purchases
  where id = p_service_purchase_id
  for update;

  if v_patient_id is null then
    raise exception 'service purchase % not found', p_service_purchase_id;
  end if;

  if v_patient_id is distinct from auth.uid() then
    raise exception 'not authorised to cancel this purchase';
  end if;

  if v_status is distinct from 'pending_payment' then
    raise exception 'only a pending, unpaid purchase can be cancelled';
  end if;

  update public.service_purchases
  set status = 'cancelled', cancelled_at = now()
  where id = p_service_purchase_id;
end;
$$;

comment on function public.cancel_pending_service_purchase(uuid) is
  'Patient-initiated close of their own abandoned checkout (patient dashboard payment-failure banner "Not right now"): flips a still-pending_payment service_purchases row to cancelled. Callable only by the purchase''s own patient_id (auth.uid()), and only while it is still pending_payment -- never on an already-active/expired/refunded purchase.';

revoke all on function public.cancel_pending_service_purchase(uuid) from public, anon;
grant execute on function public.cancel_pending_service_purchase(uuid) to authenticated;

-- Provable, not hopeful ---------------------------------------------------
do $$
declare
  v_org uuid;
  v_patient uuid;
  v_purchase uuid;
begin
  if has_function_privilege('anon', 'public.cancel_pending_service_purchase(uuid)', 'EXECUTE') then
    raise exception 'anon can execute cancel_pending_service_purchase';
  end if;
  if not has_function_privilege('authenticated', 'public.cancel_pending_service_purchase(uuid)', 'EXECUTE') then
    raise exception 'authenticated cannot execute cancel_pending_service_purchase';
  end if;

  select id into v_org from public.organisations limit 1;
  if v_org is null then
    raise notice 'no organisation available; skipping behavioural assertions';
    return;
  end if;

  select id into v_patient from public.profiles where role = 'patient' limit 1;
  if v_patient is null then
    raise notice 'no patient profile available; skipping behavioural assertions';
    return;
  end if;

  insert into public.service_purchases (patient_id, purchaser_profile_id, organisation_id, service_product_id, amount_kobo, currency, status)
  select v_patient, v_patient, v_org, id, price_kobo, 'NGN', 'pending_payment'
  from public.service_products limit 1
  returning id into v_purchase;

  if v_purchase is null then
    raise notice 'no service_products row available; skipping behavioural assertions';
    return;
  end if;

  -- Sabotage control: a mismatched caller must be refused.
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
    set local role authenticated;
    perform public.cancel_pending_service_purchase(v_purchase);
    reset role;
    raise exception 'cancel_pending_service_purchase allowed a non-owner caller';
  exception
    when others then
      reset role;
      if sqlerrm = 'cancel_pending_service_purchase allowed a non-owner caller' then
        raise;
      end if;
      if sqlerrm not like 'not authorised to cancel this purchase%' then
        raise;
      end if;
  end;

  if (select status from public.service_purchases where id = v_purchase) is distinct from 'pending_payment' then
    raise exception 'sabotage control mutated the purchase it should have refused';
  end if;

  -- The real path: the owning patient cancels their own pending purchase.
  perform set_config('request.jwt.claims', json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.cancel_pending_service_purchase(v_purchase);
  reset role;

  if (select status from public.service_purchases where id = v_purchase) is distinct from 'cancelled' then
    raise exception 'cancel_pending_service_purchase did not cancel the purchase';
  end if;

  -- Cleanup: this DO block's own insert, not real patient data.
  delete from public.service_purchases where id = v_purchase;
end $$;
