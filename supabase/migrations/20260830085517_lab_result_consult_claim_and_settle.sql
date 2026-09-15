-- Tarragon Health — the DB-enforced gate itself: claim (or reject) a paid
-- lab-result consultation credit before a self-arranged upload is allowed to
-- proceed, and settle it afterwards. Founder rule, 2026-08-30.
--
-- Deliberately public.*, not private.*, despite the task note suggesting a
-- private.claim_lab_result_consult_credit name: this project's PostgREST
-- config (supabase/config.toml `schemas = ["public"]`) only exposes the
-- public schema over RPC, so a patient session calling
-- supabase.rpc('claim_lab_result_consult_credit', ...) can only ever reach a
-- public.* function — exactly why accept_video_visit_request,
-- decline_video_visit_request, select_video_visit_alternate_slot and
-- submit_consultation_prep are all public.* despite being
-- SECURITY DEFINER/forge-proof internally. private.* stays reserved for
-- functions only ever called FROM a trigger (e.g.
-- private.patient_has_feature_access), never directly by app code.
--
-- Two functions, not one, because of a genuine ordering constraint: the app
-- must be able to reject BEFORE it ever touches storage (so a patient who
-- hasn't paid never wastes an upload), which means the gate has to run
-- before the lab_result_documents row — and therefore its id — exists. A
-- foreign key from lab_result_consult_requests.lab_result_document_id to a
-- not-yet-inserted row is unsatisfiable, and claim/insert are two separate
-- calls from the app (not one Postgres transaction), so the real document id
-- can only be linked in a second step, after the insert succeeds.
--
--   1. public.claim_lab_result_consult_credit(p_patient_id, p_lab_order_id)
--      — called first. Atomically finds and reserves (status ->
--      'document_uploaded') an unclaimed, payment_confirmed request for this
--      patient, matching the same lab_order_id if one is named (else a
--      "loose" lab_order_id IS NULL credit). Raises with a stable,
--      machine-readable DETAIL ('CONSULT_FEE_REQUIRED') if none is found —
--      the upload action must treat this as "block the upload and tell the
--      patient to pay first," never fall through. Returns NULL (nothing to
--      claim, nothing owed) when the named lab_order_id belongs to a
--      network-billed (fulfilment='partner') order — that path is billed by
--      Tarragon directly and never needs this fee.
--
--   2. public.settle_lab_result_consult_claim(p_request_id, p_document_id)
--      — called once the document insert either succeeds (p_document_id =
--      the new row's id, links it and leaves status = 'document_uploaded')
--      or fails (p_document_id = null, reverts status back to
--      'payment_confirmed' so the patient's paid credit is not stranded by a
--      transient failure — mirrors the existing storage-object rollback the
--      upload action already does on a failed insert).
--
-- Both are SECURITY DEFINER (a patient session has no UPDATE policy on this
-- table at all — see lab_result_consult_requests_staff_update) and check
-- auth.uid() themselves rather than relying on RLS, per this codebase's
-- forge-proof-RPC pattern (accept_video_visit_request et al).
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

  if v_claimed_id is null then
    raise exception 'Pay the lab-result consultation fee before uploading this result.'
      using errcode = 'P0001', detail = 'CONSULT_FEE_REQUIRED';
  end if;

  return v_claimed_id;
end;
$$;

create or replace function public.settle_lab_result_consult_claim(
  p_request_id uuid,
  p_document_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_document_id is not null then
    update public.lab_result_consult_requests
    set lab_result_document_id = p_document_id
    where id = p_request_id
      and status = 'document_uploaded'
      and lab_result_document_id is null
      and ((select auth.uid()) is null or patient_id = (select auth.uid()));
  else
    update public.lab_result_consult_requests
    set status = 'payment_confirmed'
    where id = p_request_id
      and status = 'document_uploaded'
      and lab_result_document_id is null
      and ((select auth.uid()) is null or patient_id = (select auth.uid()));
  end if;
end;
$$;

-- anon inherits EXECUTE through the PUBLIC pseudo-role, not a direct grant —
-- must revoke from public, not merely omit a grant to anon (recurring gotcha
-- in this codebase, see CLAUDE.md). Mirrors accept_video_visit_request's own
-- revoke/grant pair exactly.
revoke execute on function public.claim_lab_result_consult_credit(uuid, uuid) from public, anon;
revoke execute on function public.settle_lab_result_consult_claim(uuid, uuid) from public, anon;
grant execute on function public.claim_lab_result_consult_credit(uuid, uuid) to authenticated;
grant execute on function public.settle_lab_result_consult_claim(uuid, uuid) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.claim_lab_result_consult_credit(uuid, uuid)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute claim_lab_result_consult_credit';
  end if;
  if has_function_privilege('anon', 'public.settle_lab_result_consult_claim(uuid, uuid)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute settle_lab_result_consult_claim';
  end if;
end $$;
