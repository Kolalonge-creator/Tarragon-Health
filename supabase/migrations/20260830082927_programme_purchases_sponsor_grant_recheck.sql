-- Episodic-fee rebuild — closes the accepted gap flagged in
-- sponsored-programme-purchase-checkout.ts: unlike
-- private.activate_sponsored_subscription's explicit re-check ("the sponsor
-- must still hold a manage grant at the moment money lands"), the programme-
-- purchase activation path only ever checked private.can_purchase_voucher_for
-- once, at INSERT time (via RLS), before checkout even started. A grant
-- revoked in the seconds between checkout and the Paystack webhook could
-- still activate. This closes it the same way the subscription path does:
-- re-verify at the moment payment is confirmed, not just at purchase time.
--
-- purchased_by is new and distinct from patient_id (the beneficiary) — it
-- records who actually inserted the row (self, or a sponsor), so activation
-- has something to re-check against. Self-purchases are patient_id =
-- purchased_by and are trivially unaffected: can_purchase_voucher_for(x, x)
-- is always true, so this adds a no-op check for the common case and a real
-- one only for a sponsor purchase.

alter table public.programme_purchases
  add column if not exists purchased_by uuid references public.profiles (id) on delete set null;

comment on column public.programme_purchases.purchased_by is
  'Who actually inserted this row — the patient themself, or a sponsor buying on their behalf. Distinct from patient_id (the beneficiary). Server-derived from auth.uid() at insert time, re-checked against patient_id at activation to catch a sponsor grant revoked mid-checkout.';

create or replace function private.set_programme_purchase_computed_price()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_programme public.chronic_condition_programmes%rowtype;
begin
  select * into v_programme
    from public.chronic_condition_programmes
   where id = new.programme_id;

  if v_programme.id is null then
    raise exception 'that programme does not exist' using errcode = '23514';
  end if;
  if not v_programme.is_active then
    raise exception 'this programme is not currently available for purchase' using errcode = '23514';
  end if;
  if v_programme.price_kobo is null or v_programme.price_kobo <= 0 then
    raise exception 'this programme''s pricing is not yet configured' using errcode = '23514';
  end if;
  if v_programme.default_duration_weeks is null then
    raise exception 'this programme''s duration is not yet configured' using errcode = '23514';
  end if;

  new.organisation_id := (select organisation_id from public.profiles where id = new.patient_id);
  if new.organisation_id is null then
    raise exception 'patient has no organisation on file' using errcode = '23514';
  end if;

  new.purchased_by := coalesce((select auth.uid()), new.patient_id);
  new.price_kobo := v_programme.price_kobo;
  new.duration_weeks := v_programme.default_duration_weeks;
  new.status := 'pending_payment';
  new.enrolment_id := null;
  new.care_plan_id := null;
  new.starts_at := null;
  new.ends_at := null;
  new.purchased_at := null;

  return new;
end;
$$;

create or replace function private.activate_programme_purchase_from_transaction()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind text;
  v_ref text;
  v_purchase public.programme_purchases%rowtype;
begin
  if new.event_type not in ('charge.success', 'checkout.session.completed') then
    return new;
  end if;

  v_kind := coalesce(
    new.raw_payload -> 'data' -> 'metadata' ->> 'kind',
    new.raw_payload -> 'data' -> 'object' -> 'metadata' ->> 'kind'
  );
  if v_kind is distinct from 'programme_purchase' then return new; end if;

  v_ref := coalesce(
    new.raw_payload -> 'data' ->> 'reference',
    new.raw_payload -> 'data' -> 'object' ->> 'id'
  );
  if v_ref is null then return new; end if;

  begin
    select * into v_purchase from public.programme_purchases
     where pending_payment_provider_ref = v_ref and status = 'pending_payment' for update;
    if not found then return new; end if;

    -- The sponsor must still hold the grant at the moment money lands — same
    -- reasoning as activate_sponsored_subscription. A self-purchase
    -- (purchased_by = patient_id) always passes this trivially.
    if v_purchase.purchased_by is not null
       and v_purchase.purchased_by is distinct from v_purchase.patient_id
       and not private.can_purchase_voucher_for(v_purchase.patient_id, v_purchase.purchased_by)
    then
      update public.programme_purchases
         set status = 'cancelled',
             cancelled_at = now(),
             cancelled_reason = 'Sponsor''s permission to buy for this person was revoked before payment was confirmed.',
             pending_payment_provider_ref = null
       where id = v_purchase.id;
      return new;
    end if;

    update public.programme_purchases
       set status = 'active',
           starts_at = current_date,
           ends_at = current_date + (duration_weeks || ' weeks')::interval,
           purchased_at = now(),
           payment_provider = 'paystack',
           payment_provider_ref = v_ref,
           pending_payment_provider_ref = null
     where id = v_purchase.id;

    perform private.enrol_patient_in_purchased_programme(v_purchase.id);
  exception when others then
    return new;
  end;

  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'programme_purchases' and column_name = 'purchased_by'
  ) then
    raise exception 'FAIL: purchased_by column missing';
  end if;
  if pg_get_functiondef('private.activate_programme_purchase_from_transaction()'::regprocedure)
     !~ 'can_purchase_voucher_for' then
    raise exception 'FAIL: activation trigger does not re-check the sponsor grant';
  end if;
end $$;
