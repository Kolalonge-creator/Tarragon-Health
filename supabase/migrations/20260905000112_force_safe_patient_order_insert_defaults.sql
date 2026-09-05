-- ===========================================================================
-- CRITICAL: a patient could create a lab order that was already "paid" — and
-- it transmitted to the partner laboratory.
--
-- public.lab_orders' INSERT policy is
--   private.is_org_staff(organisation_id)
--   OR (patient_id = auth.uid() AND origin = 'patient_initiated' AND ordered_by IS NULL)
-- which constrains nothing whatsoever about `status`, and `authenticated`
-- holds a column-level INSERT grant on `status`, `fulfilment`, `provider_id`
-- and every payment_provider* column. No BEFORE INSERT trigger forced the
-- status either, and private.queue_lab_order_transmission then did, on INSERT:
--
--   new.transmission := case when new.status = 'payment_confirmed'
--                            then 'queued' else 'awaiting_payment' end;
--
-- So a patient POSTing straight at /rest/v1/lab_orders with
-- status='payment_confirmed', fulfilment='partner' and a self_bookable panel
-- bundle got a real, priced, partner-cost-stamped order QUEUED FOR
-- TRANSMISSION to Synlab, having paid nothing. 22 self-bookable bundles are
-- exposed this way, up to ~₦246,500 each. That trigger's own comment claims
-- "no code path can create a paid partner order that skips the queue" — true
-- on UPDATE, exactly backwards on INSERT, because it trusts the status the
-- caller sent.
--
-- public.pharmacy_orders has the identical policy shape and the identical
-- gap. It is dormant today only because every pharmacy_partners row is
-- is_active = false; it is fixed here so it cannot wake up as a live hole.
--
-- FIX (the shape private.pin_video_visit_amount already uses on
-- video_visit_requests): a BEFORE INSERT trigger that, for any caller who is
-- NOT org staff, overwrites the money-and-state columns with the only values
-- a patient-created order may legitimately open in. Staff-created orders are
-- returned untouched — a clinician's order is server-authored already and
-- goes on being governed by private.enforce_lab_order_origin.
--
-- Deliberately a normalisation, not a rejection: every legitimate client call
-- site already sends exactly these values (see
-- apps/web/src/lib/queries/lab-orders.ts and
-- apps/web/src/app/(dashboard)/patient/lab-tests/actions.ts), so this is a
-- no-op for them and silently disarms every other value.
--
-- Trigger names are chosen so the new trigger sorts BEFORE
-- lab_orders_queue_transmission and lab_orders_stamp_payment_confirmed
-- (Postgres fires BEFORE triggers in trigger-name order): 'f' < 'q' and
-- 'f' < 's'. It sorts AFTER lab_orders_compute_review_price ('c') and
-- lab_orders_enforce_origin ('e'), which is what we want — the price is
-- computed authoritatively before we touch anything, and we do not touch it.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- lab_orders
-- ---------------------------------------------------------------------------
create or replace function private.force_safe_patient_lab_order_insert()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  -- Org staff author orders server-side under their own authority; nothing
  -- about their insert is client-controlled in the way a patient's is.
  if private.is_org_staff(new.organisation_id) then
    return new;
  end if;

  -- Payment state is never client input. It is set later, and only ever by
  -- the Paystack webhook (supabase/functions/paystack-webhook) against a
  -- pending_payment_provider_ref the checkout wrote server-side.
  new.payment_provider := null;
  new.payment_provider_ref := null;
  new.pending_payment_provider_ref := null;
  new.payment_confirmed_at := null;

  if new.fulfilment = 'partner' then
    -- Tarragon bills this one, so it opens unpaid and stays out of the
    -- transmission queue until the webhook confirms the charge.
    new.status := 'pending_payment';
    new.transmission := 'awaiting_payment';
  else
    -- Self-arranged: the patient takes the order to a lab of their own
    -- choosing. There is nothing to collect and nobody to transmit to.
    new.status := 'ordered';
    new.transmission := 'not_required';
  end if;

  return new;
end;
$$;

comment on function private.force_safe_patient_lab_order_insert() is
  'BEFORE INSERT on public.lab_orders. For a caller who is not private.is_org_staff, forces status/transmission/payment_provider* to the only values a patient-created order may open in. Closes the hole where a patient could insert status=''payment_confirmed'' + fulfilment=''partner'' and have the order queued to the partner laboratory unpaid.';

drop trigger if exists lab_orders_force_safe_patient_insert on public.lab_orders;
create trigger lab_orders_force_safe_patient_insert
  before insert on public.lab_orders
  for each row execute function private.force_safe_patient_lab_order_insert();

-- ---------------------------------------------------------------------------
-- pharmacy_orders — same class, currently dormant, fixed for the same reason.
-- ---------------------------------------------------------------------------
create or replace function private.force_safe_patient_pharmacy_order_insert()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  if private.is_org_staff(new.organisation_id) then
    return new;
  end if;

  new.payment_provider := null;
  new.payment_provider_ref := null;
  new.pending_payment_provider_ref := null;

  -- Refund state is a consequence of a pharmacist's decision or a
  -- cancellation, never something the ordering patient declares up front.
  new.refund_status := null;
  new.refund_ref := null;
  new.refund_amount_kobo := null;

  -- Every legitimate patient pharmacy order opens unpaid — see
  -- apps/web/src/lib/queries/pharmacy-orders.ts.
  new.status := 'pending_payment';

  return new;
end;
$$;

comment on function private.force_safe_patient_pharmacy_order_insert() is
  'BEFORE INSERT on public.pharmacy_orders. Patient-side twin of private.force_safe_patient_lab_order_insert — forces status and the payment/refund columns of a non-org-staff insert to their safe defaults so a patient cannot self-declare a paid order.';

drop trigger if exists pharmacy_orders_force_safe_patient_insert on public.pharmacy_orders;
create trigger pharmacy_orders_force_safe_patient_insert
  before insert on public.pharmacy_orders
  for each row execute function private.force_safe_patient_pharmacy_order_insert();

-- ---------------------------------------------------------------------------
-- Why there is no column-level REVOKE here, unlike the service_purchases
-- migration that lands alongside this one.
--
-- Two reasons, both established empirically against the live project rather
-- than assumed:
--
-- 1. `revoke insert (payment_provider_ref) on public.lab_orders from
--    authenticated` is a NO-OP while `authenticated` also holds a
--    table-level `INSERT` grant on the table — and it does. A table-level
--    grant confers the privilege on every column; a column-level revoke
--    cannot subtract from it. Confirmed by running exactly that revoke in a
--    rolled-back transaction and finding
--    has_column_privilege('authenticated','public.lab_orders','payment_provider_ref','INSERT')
--    still true immediately afterwards. Restricting columns would mean
--    revoking INSERT on the whole table and granting an explicit column
--    allowlist back.
--
-- 2. That allowlist would be wrong here. `authenticated` is the SAME role
--    for a patient and for a clinician — the account-role split was
--    deliberately retired (see CLAUDE.md, migration
--    20260731020000_merge_doctor_into_clinician.sql). Six-plus staff call
--    sites legitimately write columns a patient never should, so a
--    column allowlist tight enough to matter would break org staff, and one
--    loose enough not to would protect nothing.
--
-- The trigger above is therefore the whole fix, and it is the RIGHT shape
-- for this table precisely because it discriminates on
-- private.is_org_staff() rather than on a grant the two actors share. It
-- runs after RLS admits the row and before anything reads the status, so
-- there is no ordering in which a patient's claimed value survives.
--
-- public.service_purchases is different — nothing whatsoever inserts into it
-- from a client — so there the table-level grant is revoked outright.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Prove it, rather than hope it.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
    where c.relname = 'lab_orders' and t.tgname = 'lab_orders_force_safe_patient_insert'
      and t.tgtype & 4 = 4 and t.tgtype & 2 = 2   -- BEFORE, INSERT
  ) then
    raise exception 'lab_orders_force_safe_patient_insert is missing or is not a BEFORE INSERT trigger';
  end if;

  if not exists (
    select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
    where c.relname = 'pharmacy_orders' and t.tgname = 'pharmacy_orders_force_safe_patient_insert'
      and t.tgtype & 4 = 4 and t.tgtype & 2 = 2
  ) then
    raise exception 'pharmacy_orders_force_safe_patient_insert is missing or is not a BEFORE INSERT trigger';
  end if;

  -- Ordering matters: Postgres fires BEFORE triggers in trigger-name order,
  -- and this one must run before the trigger that derives `transmission`
  -- from `status`, or the fix is cosmetic.
  if 'lab_orders_force_safe_patient_insert' >= 'lab_orders_queue_transmission' then
    raise exception 'trigger name sorts after lab_orders_queue_transmission — the fix would not take effect';
  end if;
  if 'lab_orders_force_safe_patient_insert' >= 'lab_orders_stamp_payment_confirmed' then
    raise exception 'trigger name sorts after lab_orders_stamp_payment_confirmed — a forged paid order would still be stamped';
  end if;

  -- The legitimate call sites must still be able to send the columns they
  -- send today, or this migration has broken the feature instead of the hole.
  if not has_column_privilege('authenticated', 'public.lab_orders', 'status', 'INSERT')
     or not has_column_privilege('authenticated', 'public.lab_orders', 'fulfilment', 'INSERT') then
    raise exception 'authenticated lost INSERT on lab_orders.status/fulfilment — the live patient order paths send both';
  end if;
end;
$$;
