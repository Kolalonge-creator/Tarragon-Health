-- Tarragon Health
-- Re-enables public.purchase_care_voucher for partner-billed, self-bookable
-- panel bundles — the backend half of the diaspora "Gift a Health Check"
-- flow (docs/DIASPORA_HEALTH_CHECK_BUSINESS_MODEL_RECONCILIATION.md).
--
-- Context, found live while wiring the first real UI onto this RPC: it was
-- not dormant, it was deliberately stubbed to always fail by
-- 20260803134416_self_arranged_consistency_sweep.sql, back when every lab
-- was self-arranged and a prepaid voucher genuinely could never be redeemed
-- — the order it would settle was ₦0 and never reached pending_payment. That
-- migration's own comment flagged this explicitly for the founder:
-- "this leaves the prepaid-service voucher with NO purchasable SKU."
--
-- 20260821193144_switch_on_synlab.sql removed the premise for a self-
-- bookable, partner-billed bundle specifically: Synlab is a real, priced,
-- active partner now, and booking screen_core (or any self-bookable bundle)
-- produces exactly the real, payable pending_payment order this function
-- used to be unable to promise. Nobody revisited the stub when that
-- happened, so the RPC stayed hard-disabled for eight days after the
-- decision that justified disabling it stopped being true.
--
-- Restored to its original 20260731215226 body, plus two guards mirrored
-- from the real order-creation path (private.set_lab_order_computed_price,
-- private.enforce_lab_order_region) so nothing can be sold as a voucher that
-- the beneficiary could not actually redeem:
--   1. Region: if the beneficiary's state is on file and has no active lab
--      coverage, refuse — same predicate enforce_lab_order_region applies at
--      real order time (and the same leniency: a beneficiary with no state
--      on file yet is not blocked, matching how a real order isn't either).
--   2. Priceable: if every test in the bundle is already excluded for this
--      beneficiary (on file, wrong sex, an unmet gate), private.
--      compute_review_price would return priceable=false and the real order
--      could never be created — refuse the voucher for the same reason,
--      before money changes hands rather than after.
-- No change to what the voucher is priced at: it is still frozen from
-- panel_bundles.price_kobo, same as before 20260803134416. If the real
-- order's computed price differs by the time of redemption,
-- redeem_care_voucher's own design already absorbs that ("they bought the
-- service, not an amount of money"). untouched here.

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
  v_state text;
  v_bundle public.panel_bundles%rowtype;
  v_provider uuid;
  v_price jsonb;
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
  -- Only the self-bookable catalogue may be prepaid. Same guardrail
  -- enforce_lab_order_origin applies: ad hoc single tests still require a due
  -- screening or a clinician order, and a voucher must not become a way round
  -- that.
  if not v_bundle.self_bookable then
    raise exception 'that service cannot be bought directly — your care team orders it when it is due';
  end if;
  if v_bundle.price_kobo is null or v_bundle.price_kobo <= 0 then
    raise exception 'that service has no price set';
  end if;

  select organisation_id, state into v_org, v_state from public.profiles where id = p_beneficiary;
  if v_org is null then raise exception 'that person has no organisation'; end if;

  -- Guard 1: region. Mirrors private.enforce_lab_order_region exactly,
  -- including its leniency when the beneficiary has no state on file yet.
  if v_state is not null and not public.region_service_available(v_state, 'lab') then
    raise exception 'Lab booking is not yet available in % — TarragonHealth is coming soon there.', v_state
      using errcode = '23514';
  end if;

  -- Guard 2: a resolvable partner. Mirrors private.set_lab_order_computed_price.
  v_provider := private.resolve_lab_order_provider(null, null);
  if v_provider is null then
    raise exception 'No active partner laboratory can run this right now — try again later.'
      using errcode = '23514';
  end if;

  -- Guard 3: this beneficiary would actually be delivered something. Mirrors
  -- private.set_lab_order_computed_price's own priceable check — a bundle
  -- where every test is already on file, wrong sex, or gate-excluded for
  -- THIS person would produce a real order priced at nothing, which is the
  -- exact "sold and unfulfillable" failure this function was disabled over.
  v_price := private.compute_review_price(p_beneficiary, v_org, p_panel_bundle_id);
  if not coalesce((v_price ->> 'priceable')::boolean, false) then
    raise exception 'Every test in this check is already on file or does not apply — there is nothing left for this voucher to buy.'
      using errcode = '23514';
  end if;

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

do $$
declare
  v_def text;
begin
  select pg_get_functiondef(oid) into v_def from pg_proc
   where proname = 'purchase_care_voucher' and pronamespace = 'public'::regnamespace;

  if v_def not like '%insert into public.care_vouchers%' then
    raise exception 'purchase_care_voucher was not actually re-enabled';
  end if;
  if v_def not like '%region_service_available%' then
    raise exception 'purchase_care_voucher is missing the region guard';
  end if;
  if v_def not like '%resolve_lab_order_provider%' then
    raise exception 'purchase_care_voucher is missing the active-partner guard';
  end if;
  if v_def not like '%compute_review_price%' then
    raise exception 'purchase_care_voucher is missing the priceable guard';
  end if;

  if has_function_privilege('anon', 'public.purchase_care_voucher(uuid,uuid,text)', 'EXECUTE') then
    raise exception 'anon must not be able to buy vouchers';
  end if;
  if not has_function_privilege('authenticated', 'public.purchase_care_voucher(uuid,uuid,text)', 'EXECUTE') then
    raise exception 'authenticated must be able to buy a voucher';
  end if;
end $$;
