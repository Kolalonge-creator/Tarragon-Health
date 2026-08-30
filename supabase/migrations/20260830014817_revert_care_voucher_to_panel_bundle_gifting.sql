-- Episodic-fee rebuild, step 6/6 (part b).
--
-- public.purchase_care_voucher was replaced with a permanent stub on
-- 2026-08-03 (20260803134416_self_arranged_consistency_sweep.sql) because at
-- the time no panel_bundle was billed by Tarragon at all — every lab test was
-- self-arranged, so a prepaid voucher had nothing real to redeem against
-- ("Tests are paid straight to the laboratory, so there is nothing for us to
-- hold on your behalf"). That premise is now false: Synlab went live
-- 2026-08-21 (20260821193144_switch_on_synlab.sql), and self-bookable,
-- Tarragon-billed panel_bundles exist again. This restores the function's
-- pre-stub body verbatim from 20260731215226_care_vouchers_purchase_and_
-- layaway.sql — no schema change needed, care_vouchers.panel_bundle_id and
-- redeem_care_voucher() were never touched by the stub.
--
-- The subscription-voucher functions this stub was working around (added
-- 2026-08-03 in 20260803141409_subscription_care_vouchers.sql, once the only
-- purchasable SKU) are dropped outright rather than left as dead code: this
-- codebase's own removal playbook favours deleting over leaving stale paths
-- around, and confirmed zero real vouchers of either kind exist to migrate.

create or replace function public.purchase_care_voucher(
  p_beneficiary uuid,
  p_panel_bundle_id uuid,
  p_gift_message text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_org uuid;
  v_bundle public.panel_bundles%rowtype;
  v_id uuid;
  v_number text;
begin
  if v_caller is null then raise exception 'not authenticated'; end if;

  if not private.can_purchase_voucher_for(p_beneficiary, v_caller) then
    raise exception 'You can only buy care for yourself or someone who has linked you to their care'
      using errcode = '42501';
  end if;

  select * into v_bundle from public.panel_bundles where id = p_panel_bundle_id;
  if not found then raise exception 'that service is not in the catalogue'; end if;
  if not v_bundle.self_bookable then
    raise exception 'that service cannot be bought directly — your care team orders it when it is due';
  end if;
  if v_bundle.price_kobo is null or v_bundle.price_kobo <= 0 then
    raise exception 'that service has no price set';
  end if;

  select organisation_id into v_org from public.profiles where id = p_beneficiary;
  if v_org is null then raise exception 'that person has no organisation'; end if;

  v_number := private.next_voucher_number();

  insert into public.care_vouchers (
    organisation_id, voucher_number, kind,
    beneficiary_profile_id, purchaser_profile_id,
    panel_bundle_id, sku_code, sku_name,
    face_value_kobo, status, gift_message
  ) values (
    v_org, v_number, 'prepaid_service',
    p_beneficiary, v_caller,
    v_bundle.id, v_bundle.code, v_bundle.name,
    v_bundle.price_kobo, 'reserved', nullif(trim(coalesce(p_gift_message, '')), '')
  )
  returning id into v_id;

  insert into public.care_voucher_events (organisation_id, voucher_id, event_type, actor_profile_id, note)
  values (v_org, v_id, 'created', v_caller,
          case when p_beneficiary = v_caller then 'Voucher reserved' else 'Voucher bought as a gift' end);

  return jsonb_build_object(
    'ok', true,
    'voucher_id', v_id,
    'voucher_number', v_number,
    'face_value_kobo', v_bundle.price_kobo,
    'sku_name', v_bundle.name
  );
end;
$$;

revoke all on function public.purchase_care_voucher(uuid, uuid, text) from public;
revoke all on function public.purchase_care_voucher(uuid, uuid, text) from anon;
grant execute on function public.purchase_care_voucher(uuid, uuid, text) to authenticated;

drop function if exists public.redeem_subscription_voucher(uuid);
drop function if exists public.purchase_subscription_voucher(uuid, uuid, text);

do $$
begin
  if has_function_privilege('anon', 'public.purchase_care_voucher(uuid,uuid,text)', 'EXECUTE') then
    raise exception 'FAIL: anon must not be able to buy vouchers';
  end if;
  if not has_function_privilege('authenticated', 'public.purchase_care_voucher(uuid,uuid,text)', 'EXECUTE') then
    raise exception 'FAIL: authenticated must be able to buy a voucher';
  end if;
  if pg_get_functiondef('public.purchase_care_voucher(uuid,uuid,text)'::regprocedure) ~ 'nothing for us to hold' then
    raise exception 'FAIL: purchase_care_voucher is still the stub';
  end if;
  if exists (select 1 from pg_proc where proname = 'purchase_subscription_voucher') then
    raise exception 'FAIL: purchase_subscription_voucher was not dropped';
  end if;
  if exists (select 1 from pg_proc where proname = 'redeem_subscription_voucher') then
    raise exception 'FAIL: redeem_subscription_voucher was not dropped';
  end if;
end $$;
