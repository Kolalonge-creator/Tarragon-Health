-- Closes the four gaps a diaspora sponsor hits on /patient/supporting.
--
-- Walked as a son abroad supporting a 68-year-old mother in Lagos:
--
-- 1. Her last BP read 156/96 on my screen as a flat, neutral number. The
--    platform had ALREADY raised "Blood pressure above target", clinician_review,
--    doctor due 3 Aug. I was never told. `clinician_alerts` even carries the
--    can_read_clinical clause, so I was permitted to know — the page simply
--    queried `escalations` (empty) and never `clinician_alerts` (where the
--    alert lives). The most reassuring fact in the product was one join away.
--
-- 2. I could not pay for her plan. Only a wallet top-up and eight lab bundles.
--    "Put my mother on Complete Care and bill my card monthly" is the single
--    most common diaspora ask and there was no path to it at all.
--
-- 3. I could not pay for her Amlodipine refill, which was due in five days and
--    visible in her own record, because nothing could turn a due refill into a
--    payable order.
--
-- 4. A video visit she had requested could not be settled by me either;
--    sponsor_payable_orders knew about labs, pharmacy and referrals but not
--    video_visit, which is the one order type most likely to need a sponsor.
--
-- The line every function here holds, unchanged from sponsor_payable_orders:
-- a sponsor sees CATEGORY and STATUS, never the item and never the reasoning.
-- "A doctor reviews this by Monday" is a status. "Blood pressure above target
-- — review adherence and titration" is a clinical judgement, and it stays with
-- the patient and their care team.

-- 1. WHO IS ACTUALLY PAYING ---------------------------------------------------
alter table public.subscriptions
  add column if not exists paid_by_profile_id uuid references public.profiles(id);

comment on column public.subscriptions.paid_by_profile_id is
  'The person whose card funds this plan, when that is not the subscriber. NULL means self-paid, which is every row that existed before sponsored plans. The subscriber always keeps their own account, their own record and their own consent — this column changes who is billed, nothing else.';

create index if not exists subscriptions_paid_by_idx
  on public.subscriptions (paid_by_profile_id) where paid_by_profile_id is not null;

-- A payer must be able to see the thing they are paying for. Added as its own
-- permissive policy rather than an edit to subscriptions_select, which other
-- migrations assert over.
drop policy if exists subscriptions_select_payer on public.subscriptions;
create policy subscriptions_select_payer on public.subscriptions
  for select using (paid_by_profile_id = (select auth.uid()));

-- 2. IS ANYONE ACTUALLY DOING SOMETHING? --------------------------------------
-- Gated on clinical_access, not 'manage': this is health visibility, so it
-- follows the patient's own consent switch, not their delegation of errands.
--
-- Returns counts and dates only. `title` and `detail` are deliberately never
-- selected — keeping interpretation out is structural here, not a UI promise.
create or replace function public.sponsor_care_status(p_beneficiary uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_caller uuid := auth.uid();
  v_open int;
  v_next_due timestamptz;
  v_last_reviewed timestamptz;
  v_overdue boolean;
begin
  if v_caller is null then raise exception 'not authenticated'; end if;

  if not exists (
    select 1 from public.profile_access pa
     where pa.profile_id = p_beneficiary
       and pa.grantee_user_id = v_caller
       and pa.clinical_access
  ) then
    raise exception 'this person has not shared their health information with you'
      using errcode = '42501';
  end if;

  select count(*) filter (where ca.status = 'open'),
         min(ca.sla_due_at) filter (where ca.status = 'open'),
         max(ca.acknowledged_at)
    into v_open, v_next_due, v_last_reviewed
    from public.clinician_alerts ca
   where ca.patient_id = p_beneficiary;

  v_overdue := v_next_due is not null and v_next_due < now();

  return jsonb_build_object(
    'open_count', coalesce(v_open, 0),
    'next_review_due', v_next_due,
    'review_overdue', coalesce(v_overdue, false),
    'last_reviewed_at', v_last_reviewed
  );
end;
$$;

revoke all on function public.sponsor_care_status(uuid) from public, anon;
revoke all on function public.sponsor_care_status(uuid) from anon;
grant execute on function public.sponsor_care_status(uuid) to authenticated;

-- 3. TURN A DUE REFILL INTO A PAYABLE BILL ------------------------------------
-- 'manage' only. Deliberately cannot invent a prescription: the medication must
-- already be active and clinician- or specialist-sourced, so this is a request
-- to dispense what a doctor already decided, never a new clinical decision.
-- enforce_pharmacy_order_origin still applies underneath and is not bypassed.
create or replace function public.sponsor_request_refill(
  p_beneficiary uuid,
  p_medication_id uuid
)
returns uuid
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_caller uuid := auth.uid();
  v_org uuid;
  v_drug text;
  v_med record;
  v_order_id uuid;
begin
  if v_caller is null then raise exception 'not authenticated'; end if;

  if not exists (
    select 1 from public.profile_access pa
     where pa.profile_id = p_beneficiary
       and pa.grantee_user_id = v_caller
       and pa.permission_level = 'manage'
  ) then
    raise exception 'you do not have permission to act for this person'
      using errcode = '42501';
  end if;

  select m.organisation_id, m.drug_name
    into v_org, v_drug
    from public.medications m
   where m.id = p_medication_id
     and m.patient_id = p_beneficiary
     and m.is_active
     and m.source in ('clinician', 'specialist');

  if v_drug is null then
    raise exception 'that is not a current prescribed medication for this person'
      using errcode = '22023';
  end if;

  -- Cheapest active listing of the same drug. If no partner stocks it we say so
  -- plainly rather than creating a zero-priced order that silently never
  -- appears as a bill.
  select pm.id, pm.drug_name, pm.pack_size, pm.price_kobo, pm.pharmacy_partner_id
    into v_med
    from public.pharmacy_medications pm
    join public.pharmacy_partners pp on pp.id = pm.pharmacy_partner_id
   where pm.drug_name ilike v_drug
     and pm.price_kobo > 0
     and pp.is_active
   order by pm.price_kobo asc
   limit 1;

  if v_med.id is null then
    raise exception 'no pharmacy in the network lists % yet', v_drug
      using errcode = '22023';
  end if;

  -- An unpaid refill request for the same drug is already waiting; hand back
  -- that one instead of stacking duplicate bills on the person you support.
  select po.id into v_order_id
    from public.pharmacy_orders po
   where po.patient_id = p_beneficiary
     and po.status = 'pending_payment'
     and po.items @> jsonb_build_array(jsonb_build_object('medication_id', v_med.id))
   limit 1;

  if v_order_id is not null then
    return v_order_id;
  end if;

  insert into public.pharmacy_orders (
    organisation_id, patient_id, pharmacy_partner_id, items, total_kobo,
    status, fulfilment_method
  ) values (
    v_org, p_beneficiary, v_med.pharmacy_partner_id,
    jsonb_build_array(jsonb_build_object(
      'medication_id', v_med.id,
      'drug_name', v_med.drug_name,
      'pack_size', v_med.pack_size,
      'price_kobo', v_med.price_kobo,
      'quantity', 1
    )),
    v_med.price_kobo, 'pending_payment', 'pickup'
  ) returning id into v_order_id;

  return v_order_id;
end;
$$;

revoke all on function public.sponsor_request_refill(uuid, uuid) from public, anon;
revoke all on function public.sponsor_request_refill(uuid, uuid) from anon;
grant execute on function public.sponsor_request_refill(uuid, uuid) to authenticated;

-- 4. VIDEO VISITS ARE PAYABLE TOO ---------------------------------------------
-- Same shape as before plus video_visit. A video visit is the order type most
-- likely to need someone else to settle it, and it was the one missing.
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
    union all
    select jsonb_build_object(
             'order_id', vv.id, 'order_type', 'video_visit', 'label', 'A video visit with a doctor',
             'amount_kobo', vv.amount_minor, 'created_at', vv.created_at
           )
      from public.video_visit_requests vv
     where vv.patient_id = p_beneficiary and vv.status = 'pending_payment'
       and vv.amount_minor > 0
  ) rows;

  return v_result;
end;
$$;

revoke all on function public.sponsor_payable_orders(uuid) from public, anon;
revoke all on function public.sponsor_payable_orders(uuid) from anon;
grant execute on function public.sponsor_payable_orders(uuid) to authenticated;

-- 5. ASSERT -------------------------------------------------------------------
do $$
begin
  if has_function_privilege('anon', 'public.sponsor_care_status(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.sponsor_request_refill(uuid,uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.sponsor_payable_orders(uuid)', 'EXECUTE') then
    raise exception 'anon must not reach any sponsor function';
  end if;

  -- sponsor_care_status must never be able to leak clinical reasoning.
  if pg_get_functiondef('public.sponsor_care_status(uuid)'::regprocedure) ~* '\mdetail\M'
     or pg_get_functiondef('public.sponsor_care_status(uuid)'::regprocedure) ~* 'ca\.title' then
    raise exception 'sponsor_care_status must return status only, never alert title or detail';
  end if;

  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'subscriptions'
       and policyname = 'subscriptions_select_payer'
  ) then
    raise exception 'a payer must be able to see the subscription they fund';
  end if;
end $$;
