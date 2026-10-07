-- Tarragon Health — the one-off ₦ lab-result consultation fee no longer
-- gates the upload itself. Founder decision, 2026-09-22: a free patient must
-- be able to upload any result (lab, ECG, imaging) and get an automated read
-- for free — "a good reason to upload on the free version." The fee stays
-- exactly what it always priced: a paid doctor walkthrough of the result,
-- booked separately (requestLabResultConsult) and offered as a next step
-- from the automated summary, never a precondition to uploading.
--
-- public.claim_lab_result_consult_credit is changed from "raise
-- (CONSULT_FEE_REQUIRED) when there is nothing to claim" to "return NULL
-- when there is nothing to claim" — every other branch (ownership check,
-- network-billed/partner short-circuit, atomic claim-and-flip) is untouched.
-- A patient who HAS already paid still gets that credit claimed and linked
-- exactly as before; a patient who hasn't just uploads for free with nothing
-- linked. settle_lab_result_consult_claim is untouched — a null
-- claimedRequestId already short-circuits every call site's own settle call.
--
-- This is a DB-level change because the gate itself was DB-enforced (the app
-- code only ever propagated whatever this function decided); removing the
-- gate here is what actually removes it, not a client-side patch that a
-- second call site could forget.
create or replace function public.claim_lab_result_consult_credit(
  p_patient_id uuid,
  p_lab_order_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fulfilment text;
  v_claimed_id uuid;
begin
  if (select auth.uid()) is not null and (select auth.uid()) <> p_patient_id then
    raise exception 'cannot claim a lab-result consultation credit for another patient'
      using errcode = '42501';
  end if;

  if p_lab_order_id is not null then
    select fulfilment::text into v_fulfilment
    from public.lab_orders
    where id = p_lab_order_id;

    if v_fulfilment = 'partner' then
      -- Network-billed: Tarragon already bills this booking directly, no
      -- separate consultation fee applies. Nothing to claim, nothing owed.
      return null;
    end if;
  end if;

  update public.lab_result_consult_requests
  set status = 'document_uploaded'
  where id = (
    select id
    from public.lab_result_consult_requests
    where patient_id = p_patient_id
      and status = 'payment_confirmed'
      and lab_result_document_id is null
      -- NULL = NULL is deliberately true here: a request paid with no
      -- lab_order_id only satisfies an upload with no lab_order_id, and one
      -- paid against a specific order only satisfies an upload naming that
      -- exact order — no cross-matching either direction.
      and lab_order_id is not distinct from p_lab_order_id
    order by created_at asc
    limit 1
    for update skip locked
  )
  returning id into v_claimed_id;

  -- Nothing paid and unclaimed for this patient (and this lab_order_id, if
  -- named): the upload proceeds anyway, simply with no consult credit
  -- linked. This function no longer gates anything — it only OPTIONALLY
  -- links an existing paid credit when one happens to exist.
  return v_claimed_id;
end;
$$;

-- anon inherits EXECUTE through the PUBLIC pseudo-role, not a direct grant —
-- must revoke from public, not merely omit a grant to anon (recurring gotcha
-- in this codebase, see CLAUDE.md). Re-asserted here since create or replace
-- does not touch existing grants, but stating it again costs nothing and
-- keeps this migration self-verifying.
revoke execute on function public.claim_lab_result_consult_credit(uuid, uuid) from public, anon;
grant execute on function public.claim_lab_result_consult_credit(uuid, uuid) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.claim_lab_result_consult_credit(uuid, uuid)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute claim_lab_result_consult_credit';
  end if;
end $$;
