-- Tarragon Health
-- Diaspora doctor-retention pool — write RPCs.
--
-- Every write to doctor_retention_pledges/doctor_retention_allocations goes
-- through one of these, matching the care_voucher discipline: no direct
-- table write policy exists (enforced in 20260901120000's assertion block),
-- so this file is the entire write surface. Every RPC is gated on the same
-- 'doctor_retention_pool.manage' permission.

create or replace function public.record_doctor_retention_pledge(
  p_sponsor_name text,
  p_currency text,
  p_amount_minor bigint,
  p_sponsor_profile_id uuid default null,
  p_sponsor_contact text default null,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_org uuid;
  v_id uuid;
begin
  if v_caller is null then raise exception 'not authenticated'; end if;
  if not (private.is_admin() or private.has_permission('doctor_retention_pool.manage')) then
    raise exception 'not authorised to record a doctor retention pledge' using errcode = '42501';
  end if;
  if coalesce(trim(p_sponsor_name), '') = '' then
    raise exception 'a sponsor name is required';
  end if;
  if p_currency not in ('GBP', 'USD') then
    raise exception 'doctor retention pledges are recorded in hard currency (GBP or USD) only';
  end if;
  if p_amount_minor is null or p_amount_minor <= 0 then
    raise exception 'amount must be a positive amount';
  end if;

  v_org := private.current_org_id();
  if v_org is null then raise exception 'caller has no organisation'; end if;

  insert into public.doctor_retention_pledges (
    organisation_id, pledge_number, sponsor_name, sponsor_profile_id, sponsor_contact,
    currency, amount_minor, recorded_by, note
  ) values (
    v_org, private.next_doctor_retention_pledge_number(), trim(p_sponsor_name), p_sponsor_profile_id,
    nullif(trim(coalesce(p_sponsor_contact, '')), ''), p_currency::public.currency, p_amount_minor,
    v_caller, nullif(trim(coalesce(p_note, '')), '')
  )
  returning id into v_id;

  perform private.log_audit('doctor_retention_pledges.recorded', 'doctor_retention_pledges', v_id,
    jsonb_build_object('currency', p_currency, 'amount_minor', p_amount_minor));

  return v_id;
end;
$$;

create or replace function public.mark_doctor_retention_pledge_collected(
  p_pledge_id uuid,
  p_collection_method text default null,
  p_collection_reference text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_p public.doctor_retention_pledges%rowtype;
begin
  if v_caller is null then raise exception 'not authenticated'; end if;
  if not (private.is_admin() or private.has_permission('doctor_retention_pool.manage')) then
    raise exception 'not authorised to update a doctor retention pledge' using errcode = '42501';
  end if;

  select * into v_p from public.doctor_retention_pledges where id = p_pledge_id for update;
  if not found then raise exception 'pledge not found'; end if;
  if v_p.status <> 'pledged' then
    raise exception 'only a pledge still awaiting collection can be marked collected';
  end if;

  update public.doctor_retention_pledges
     set status = 'collected',
         collected_at = now(),
         collection_method = nullif(trim(coalesce(p_collection_method, '')), ''),
         collection_reference = nullif(trim(coalesce(p_collection_reference, '')), '')
   where id = p_pledge_id;

  perform private.log_audit('doctor_retention_pledges.collected', 'doctor_retention_pledges', p_pledge_id,
    jsonb_build_object('collection_method', p_collection_method));

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.cancel_doctor_retention_pledge(p_pledge_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_p public.doctor_retention_pledges%rowtype;
  v_active_allocations int;
begin
  if v_caller is null then raise exception 'not authenticated'; end if;
  if not (private.is_admin() or private.has_permission('doctor_retention_pool.manage')) then
    raise exception 'not authorised to cancel a doctor retention pledge' using errcode = '42501';
  end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'a reason is required'; end if;

  select * into v_p from public.doctor_retention_pledges where id = p_pledge_id for update;
  if not found then raise exception 'pledge not found'; end if;
  if v_p.status = 'cancelled' then raise exception 'this pledge is already cancelled'; end if;

  select count(*) into v_active_allocations
    from public.doctor_retention_allocations
    where pledge_id = p_pledge_id and status <> 'cancelled';
  if v_active_allocations > 0 then
    raise exception 'cancel or complete every allocation against this pledge before cancelling it';
  end if;

  update public.doctor_retention_pledges
     set status = 'cancelled', cancelled_at = now(), cancelled_reason = trim(p_reason)
   where id = p_pledge_id;

  perform private.log_audit('doctor_retention_pledges.cancelled', 'doctor_retention_pledges', p_pledge_id,
    jsonb_build_object('reason', p_reason));

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.allocate_doctor_retention_pledge(
  p_pledge_id uuid,
  p_clinical_staff_id uuid,
  p_period_start date,
  p_period_end date,
  p_amount_minor bigint,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_org uuid;
  v_id uuid;
begin
  if v_caller is null then raise exception 'not authenticated'; end if;
  if not (private.is_admin() or private.has_permission('doctor_retention_pool.manage')) then
    raise exception 'not authorised to allocate a doctor retention pledge' using errcode = '42501';
  end if;
  if p_amount_minor is null or p_amount_minor <= 0 then
    raise exception 'amount must be a positive amount';
  end if;

  select organisation_id into v_org from public.doctor_retention_pledges where id = p_pledge_id;
  if v_org is null then raise exception 'pledge not found'; end if;

  -- Balance/eligibility/currency-org-match checks live in the
  -- before-insert trigger (private.enforce_doctor_retention_allocation_balance)
  -- so they can never be bypassed by a caller other than this RPC.
  insert into public.doctor_retention_allocations (
    organisation_id, pledge_id, clinical_staff_id, period_start, period_end,
    amount_minor, allocated_by, note
  ) values (
    v_org, p_pledge_id, p_clinical_staff_id, p_period_start, p_period_end,
    p_amount_minor, v_caller, nullif(trim(coalesce(p_note, '')), '')
  )
  returning id into v_id;

  perform private.log_audit('doctor_retention_allocations.allocated', 'doctor_retention_allocations', v_id,
    jsonb_build_object('pledge_id', p_pledge_id, 'clinical_staff_id', p_clinical_staff_id,
                        'amount_minor', p_amount_minor));

  return v_id;
end;
$$;

create or replace function public.mark_doctor_retention_allocation_disbursed(
  p_allocation_id uuid,
  p_disbursement_reference text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_a public.doctor_retention_allocations%rowtype;
begin
  if v_caller is null then raise exception 'not authenticated'; end if;
  if not (private.is_admin() or private.has_permission('doctor_retention_pool.manage')) then
    raise exception 'not authorised to update a doctor retention allocation' using errcode = '42501';
  end if;

  select * into v_a from public.doctor_retention_allocations where id = p_allocation_id for update;
  if not found then raise exception 'allocation not found'; end if;
  if v_a.status <> 'allocated' then
    raise exception 'only an allocated (not yet disbursed) top-up can be marked disbursed';
  end if;

  update public.doctor_retention_allocations
     set status = 'disbursed',
         disbursed_at = now(),
         disbursed_by = v_caller,
         disbursement_reference = nullif(trim(coalesce(p_disbursement_reference, '')), '')
   where id = p_allocation_id;

  perform private.log_audit('doctor_retention_allocations.disbursed', 'doctor_retention_allocations',
    p_allocation_id, jsonb_build_object('disbursement_reference', p_disbursement_reference));

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.cancel_doctor_retention_allocation(p_allocation_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_a public.doctor_retention_allocations%rowtype;
begin
  if v_caller is null then raise exception 'not authenticated'; end if;
  if not (private.is_admin() or private.has_permission('doctor_retention_pool.manage')) then
    raise exception 'not authorised to cancel a doctor retention allocation' using errcode = '42501';
  end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'a reason is required'; end if;

  select * into v_a from public.doctor_retention_allocations where id = p_allocation_id for update;
  if not found then raise exception 'allocation not found'; end if;
  if v_a.status = 'disbursed' then
    raise exception 'a disbursed top-up cannot be cancelled — it has already been paid';
  end if;
  if v_a.status = 'cancelled' then raise exception 'this allocation is already cancelled'; end if;

  update public.doctor_retention_allocations
     set status = 'cancelled', cancelled_at = now(), cancelled_reason = trim(p_reason)
   where id = p_allocation_id;

  perform private.log_audit('doctor_retention_allocations.cancelled', 'doctor_retention_allocations',
    p_allocation_id, jsonb_build_object('reason', p_reason));

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.record_doctor_retention_pledge(text, text, bigint, uuid, text, text) from public;
revoke all on function public.record_doctor_retention_pledge(text, text, bigint, uuid, text, text) from anon;
revoke all on function public.mark_doctor_retention_pledge_collected(uuid, text, text) from public;
revoke all on function public.mark_doctor_retention_pledge_collected(uuid, text, text) from anon;
revoke all on function public.cancel_doctor_retention_pledge(uuid, text) from public;
revoke all on function public.cancel_doctor_retention_pledge(uuid, text) from anon;
revoke all on function public.allocate_doctor_retention_pledge(uuid, uuid, date, date, bigint, text) from public;
revoke all on function public.allocate_doctor_retention_pledge(uuid, uuid, date, date, bigint, text) from anon;
revoke all on function public.mark_doctor_retention_allocation_disbursed(uuid, text) from public;
revoke all on function public.mark_doctor_retention_allocation_disbursed(uuid, text) from anon;
revoke all on function public.cancel_doctor_retention_allocation(uuid, text) from public;
revoke all on function public.cancel_doctor_retention_allocation(uuid, text) from anon;

grant execute on function public.record_doctor_retention_pledge(text, text, bigint, uuid, text, text) to authenticated;
grant execute on function public.mark_doctor_retention_pledge_collected(uuid, text, text) to authenticated;
grant execute on function public.cancel_doctor_retention_pledge(uuid, text) to authenticated;
grant execute on function public.allocate_doctor_retention_pledge(uuid, uuid, date, date, bigint, text) to authenticated;
grant execute on function public.mark_doctor_retention_allocation_disbursed(uuid, text) to authenticated;
grant execute on function public.cancel_doctor_retention_allocation(uuid, text) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.record_doctor_retention_pledge(text,text,bigint,uuid,text,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.mark_doctor_retention_pledge_collected(uuid,text,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.cancel_doctor_retention_pledge(uuid,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.allocate_doctor_retention_pledge(uuid,uuid,date,date,bigint,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.mark_doctor_retention_allocation_disbursed(uuid,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.cancel_doctor_retention_allocation(uuid,text)', 'EXECUTE')
  then
    raise exception 'anon must not reach doctor retention pool administration';
  end if;
end $$;
