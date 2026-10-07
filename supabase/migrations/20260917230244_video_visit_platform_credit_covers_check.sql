-- Tarragon Health — Platform Credit pays for Video Visit bookings, part 1:
-- a read-only affordability check, and the request-time "hold" that puts a
-- platform-credit-funded request in front of a doctor exactly like a
-- Paystack charge does, WITHOUT spending anything yet.
--
-- Design decision (founder/architecture call, not to be relitigated here):
-- unlike a Paystack charge, there is no external gateway to genuinely hold
-- money with, and a video visit request needs a doctor to accept before any
-- deliverable exists at all (see 20260723120000_video_visit_requests.sql's
-- own header — this is a HELD-payment model, not instant booking). So the
-- actual private.platform_credit_apply('spend') call is deliberately
-- deferred all the way to doctor acceptance (see the next migration in this
-- set, which touches accept_video_visit_request/
-- select_video_visit_alternate_slot) — the exact same activation-moment
-- pattern pay_service_purchase_on_platform_credit uses for a service
-- purchase going 'active'. Request time only ever CHECKS the balance here;
-- it never moves it. The upside this buys: a request that is declined or
-- simply expires before a doctor ever accepts needs NO refund logic on the
-- platform-credit path at all — the balance was never touched, unlike the
-- Paystack path's held real-money charge (see video-visit-refunds cron).

-- ---------------------------------------------------------------------------
-- check_platform_credit_covers_video_visit — pure read-only helper. Security
-- INVOKER deliberately: it runs under the caller's own RLS, so a patient
-- checking their own balance gets a truthful answer (the
-- platform_credit_balances_select policy already lets them see their own
-- row), and a patient probing someone else's patient_id just sees "no rows
-- visible" -> coalesced to 0 -> false, the same shape a genuine zero balance
-- would produce. No privilege escalation, nothing to revoke beyond the
-- ordinary anon lockout.
-- ---------------------------------------------------------------------------

create or replace function public.check_platform_credit_covers_video_visit(
  p_patient_id uuid,
  p_amount_kobo bigint
)
returns boolean
language sql
security invoker
set search_path = ''
stable
as $$
  select coalesce(
    (select balance_kobo from public.platform_credit_balances where patient_id = p_patient_id),
    0
  ) >= coalesce(p_amount_kobo, 0);
$$;

revoke execute on function public.check_platform_credit_covers_video_visit(uuid, bigint) from public, anon;
grant execute on function public.check_platform_credit_covers_video_visit(uuid, bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- confirm_video_visit_request_on_platform_credit — called right after the
-- ordinary patient-owned INSERT into video_visit_requests (same insert the
-- Paystack path already does; private.pin_video_visit_amount() has already
-- pinned amount_minor/currency from the price book by the time this runs).
-- Moves 'requested'/'pending_payment' -> 'payment_confirmed' with
-- payment_provider='platform_credit' and payment_provider_ref left NULL —
-- the NULL is deliberate and load-bearing: it's what tells
-- decline_video_visit_request and the refund cron "nothing was ever
-- charged, there is nothing to refund" (both already only act on a non-null
-- payment_provider_ref), and it's what private.pay_video_visit_request_on_
-- platform_credit (next migration) later stamps with the real ledger entry
-- id once a doctor actually accepts.
--
-- SECURITY DEFINER only to reach across a FOR UPDATE lock on the request row
-- cleanly; the function still enforces the caller owns the request itself
-- (patient_id = auth.uid()) rather than leaning on that privilege.
-- ---------------------------------------------------------------------------

create or replace function public.confirm_video_visit_request_on_platform_credit(
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_req public.video_visit_requests%rowtype;
  v_balance_kobo bigint := 0;
begin
  if v_caller is null then
    raise exception 'not authenticated';
  end if;

  select * into v_req from public.video_visit_requests where id = p_request_id for update;
  if not found then
    raise exception 'request not found';
  end if;
  if v_req.patient_id <> v_caller then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  if v_req.status not in ('requested', 'pending_payment') then
    return jsonb_build_object('ok', false, 'reason', 'not_payable', 'status', v_req.status);
  end if;
  -- Platform credit is an NGN-only balance (see platform_credit_topup_intents);
  -- a video visit priced in anything else can't be paid this way.
  if v_req.currency <> 'NGN' then
    return jsonb_build_object('ok', false, 'reason', 'unsupported_currency', 'currency', v_req.currency);
  end if;

  select balance_kobo into v_balance_kobo
    from public.platform_credit_balances where patient_id = v_req.patient_id;
  v_balance_kobo := coalesce(v_balance_kobo, 0);

  if v_balance_kobo < v_req.amount_minor then
    return jsonb_build_object(
      'ok', false,
      'reason', 'insufficient_balance',
      'balance_kobo', v_balance_kobo,
      'required_kobo', v_req.amount_minor,
      'shortfall_kobo', v_req.amount_minor - v_balance_kobo
    );
  end if;

  update public.video_visit_requests
    set status = 'payment_confirmed',
        payment_provider = 'platform_credit',
        payment_provider_ref = null,
        pending_payment_provider_ref = null
    where id = v_req.id;

  return jsonb_build_object('ok', true, 'request_id', v_req.id, 'amount_kobo', v_req.amount_minor);
end;
$$;

revoke execute on function public.confirm_video_visit_request_on_platform_credit(uuid) from public, anon;
grant execute on function public.confirm_video_visit_request_on_platform_credit(uuid) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.check_platform_credit_covers_video_visit(uuid,bigint)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute check_platform_credit_covers_video_visit';
  end if;
  if has_function_privilege('anon', 'public.confirm_video_visit_request_on_platform_credit(uuid)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute confirm_video_visit_request_on_platform_credit';
  end if;
  raise notice 'PASS: video-visit platform-credit affordability check + request-time hold in place';
end $$;
