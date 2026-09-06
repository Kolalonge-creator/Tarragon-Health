-- What a sponsor may settle, without telling them what it is for.
--
-- sponsor_pay_booking_order takes an order id, but lab_orders, pharmacy_orders
-- and specialist_referrals are all readable only by the patient or org staff,
-- so a sponsor had no way to discover one. The pay path existed with no door
-- into it. This is the door.
--
-- Category only, never the specific item. "A lab test, ₦18,000" is a bill.
-- "Cervical smear, ₦18,000" is a health disclosure, and it would be one made to
-- somebody the patient consented to let ACT on their care, not to READ it.
-- Same line the spend receipt draws, drawn the same way.
--
-- 'manage' only, consistent with every other sponsor-acting function.
create or replace function public.sponsor_payable_orders(p_beneficiary uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_caller uuid := auth.uid();
  v_result jsonb;
begin
  if v_caller is null then raise exception 'not authenticated'; end if;

  if not exists (
    select 1 from public.profile_access pa
     where pa.profile_id = p_beneficiary
       and pa.grantee_user_id = v_caller
       and pa.permission_level = 'manage'
  ) then
    raise exception 'you do not have permission to see this person''s bills'
      using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(row order by (row->>'created_at') desc), '[]'::jsonb)
    into v_result
  from (
    select jsonb_build_object(
             'order_id', lo.id, 'order_type', 'lab', 'label', 'A lab test',
             'amount_kobo', lo.total_kobo, 'created_at', lo.created_at
           ) as row
      from public.lab_orders lo
     where lo.patient_id = p_beneficiary and lo.status = 'pending_payment'
       and lo.total_kobo > 0
    union all
    select jsonb_build_object(
             'order_id', po.id, 'order_type', 'pharmacy', 'label', 'Medication',
             'amount_kobo', po.total_kobo, 'created_at', po.created_at
           )
      from public.pharmacy_orders po
     where po.patient_id = p_beneficiary and po.status = 'pending_payment'
       and po.total_kobo > 0
    union all
    select jsonb_build_object(
             'order_id', sr.id, 'order_type', 'referral', 'label', 'A specialist referral',
             'amount_kobo', sr.referral_fee_kobo, 'created_at', sr.created_at
           )
      from public.specialist_referrals sr
     where sr.patient_id = p_beneficiary and sr.status = 'pending_payment'
       and sr.referral_fee_kobo > 0
  ) rows;

  return v_result;
end;
$$;

revoke all on function public.sponsor_payable_orders(uuid) from public, anon;
revoke all on function public.sponsor_payable_orders(uuid) from anon;
grant execute on function public.sponsor_payable_orders(uuid) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.sponsor_payable_orders(uuid)', 'EXECUTE') then
    raise exception 'anon must not be able to list anyone''s bills';
  end if;
end $$;
