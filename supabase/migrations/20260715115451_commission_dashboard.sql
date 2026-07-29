-- Tarragon Health — Care Coordination Build 6: commission dashboard write path.
--
-- commissions has been pure schema since Sprint 1 — nothing inserts into it.
-- This migration adds the missing commission-rate data (panel_bundles has no
-- commission columns at all; pharmacy_medications has the columns but every
-- seeded row is null) and three triggers that auto-record a commission row
-- the moment an order transitions into payment_confirmed, regardless of
-- which of the app's four different call sites drives that transition
-- (booking-checkout.ts's capitated branch, the Paystack webhook, the Stripe
-- webhook, or useAssignSpecialistProvider()'s inline capitated branch).
-- Commission is Tarragon's cut of the *partner's* revenue, earned whether
-- the patient paid directly or the order was capitated — so every path into
-- payment_confirmed must be covered, which a trigger does for free.

-- ---------------------------------------------------------------------------
-- panel_bundles: no commission columns existed at all (lab_orders only
-- stores panel_bundle_id, not which lab_tests rows were involved, and a
-- bundle's price is deliberately provider-independent per Build 4) — give
-- the bundle itself a commission rate, mirroring lab_tests/pharmacy_medications/
-- specialist_providers. Seeded at 0.20, matching the modal lab_tests rate.
-- ---------------------------------------------------------------------------

alter table public.panel_bundles
  add column commission_rate_type public.commission_rate_type not null default 'percentage',
  add column commission_rate numeric(5, 4),
  add column commission_flat_kobo bigint;

update public.panel_bundles set commission_rate = 0.20 where commission_rate is null;

-- ---------------------------------------------------------------------------
-- pharmacy_medications already has the commission columns (Build 2) but
-- every seeded row is null — placeholder rate pending real partner terms,
-- same posture as specialist_providers' 0.15 placeholder.
-- ---------------------------------------------------------------------------

update public.pharmacy_medications set commission_rate = 0.12 where commission_rate is null;

-- ---------------------------------------------------------------------------
-- Commission-recording triggers — one per order table, firing once per order
-- (status only ever transitions into payment_confirmed once in the current
-- lifecycle, so OLD.status IS DISTINCT FROM NEW.status is a sufficient
-- idempotency guard with no separate dedupe check needed).
-- ---------------------------------------------------------------------------

create or replace function private.record_lab_commission()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  bundle record;
  provider_name text;
  computed_amount bigint;
begin
  select commission_rate_type, commission_rate, commission_flat_kobo
  into bundle
  from public.panel_bundles
  where id = new.panel_bundle_id;

  select name into provider_name from public.lab_providers where id = new.provider_id;

  if bundle.commission_rate_type = 'flat' then
    computed_amount := coalesce(bundle.commission_flat_kobo, 0);
  else
    computed_amount := round(new.total_kobo * coalesce(bundle.commission_rate, 0));
  end if;

  insert into public.commissions (
    organisation_id, commission_type, source_id, source_reference,
    partner_name, amount_kobo, rate, rate_type
  ) values (
    new.organisation_id, 'lab', new.id, new.order_number,
    provider_name, computed_amount, bundle.commission_rate, coalesce(bundle.commission_rate_type, 'percentage')
  );

  return new;
end;
$$;

create trigger lab_orders_record_commission
  after update on public.lab_orders
  for each row
  when (old.status is distinct from new.status and new.status = 'payment_confirmed')
  execute function private.record_lab_commission();

create or replace function private.record_pharmacy_commission()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  partner_name_val text;
  item record;
  med record;
  total_amount bigint := 0;
  distinct_rate_types int;
  single_rate_type public.commission_rate_type;
begin
  select name into partner_name_val from public.pharmacy_partners where id = new.pharmacy_partner_id;

  -- items snapshot is patient-facing (medication_id, drug_name, pack_size,
  -- price_kobo, quantity) — commission_rate is looked up live from
  -- pharmacy_medications at recognition time, not locked at booking time
  -- (the catalogue's current partner-agreed rate, same as lab/referral).
  for item in
    select * from jsonb_to_recordset(new.items) as x(medication_id uuid, price_kobo bigint, quantity int)
  loop
    select commission_rate_type, commission_rate, commission_flat_kobo
    into med
    from public.pharmacy_medications
    where id = item.medication_id;

    if found then
      if med.commission_rate_type = 'flat' then
        total_amount := total_amount + coalesce(med.commission_flat_kobo, 0) * coalesce(item.quantity, 1);
      else
        total_amount := total_amount + round(item.price_kobo * item.quantity * coalesce(med.commission_rate, 0));
      end if;
    end if;
  end loop;

  -- rate_type/rate: today's UI only ever creates single-item orders, so this
  -- is almost always exact. A hypothetical multi-item order with mixed
  -- percentage/flat medications has no single "rate" to report — left null
  -- in that case, defaulting the label to 'percentage' rather than guessing.
  select count(distinct commission_rate_type) into distinct_rate_types
  from public.pharmacy_medications pm
  where pm.id in (
    select (elem->>'medication_id')::uuid from jsonb_array_elements(new.items) elem
  );

  if distinct_rate_types = 1 then
    select commission_rate_type into single_rate_type
    from public.pharmacy_medications pm
    where pm.id in (
      select (elem->>'medication_id')::uuid from jsonb_array_elements(new.items) elem
    )
    limit 1;
  else
    single_rate_type := 'percentage';
  end if;

  insert into public.commissions (
    organisation_id, commission_type, source_id, source_reference,
    partner_name, amount_kobo, rate, rate_type
  ) values (
    new.organisation_id, 'pharmacy', new.id, new.order_number,
    partner_name_val, total_amount, null, single_rate_type
  );

  return new;
end;
$$;

create trigger pharmacy_orders_record_commission
  after update on public.pharmacy_orders
  for each row
  when (old.status is distinct from new.status and new.status = 'payment_confirmed')
  execute function private.record_pharmacy_commission();

create or replace function private.record_referral_commission()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  provider record;
  computed_amount bigint;
begin
  select name, commission_rate_type, commission_rate, commission_flat_kobo
  into provider
  from public.specialist_providers
  where id = new.specialist_provider_id;

  if provider.commission_rate_type = 'flat' then
    computed_amount := coalesce(provider.commission_flat_kobo, 0);
  else
    computed_amount := round(coalesce(new.referral_fee_kobo, 0) * coalesce(provider.commission_rate, 0));
  end if;

  insert into public.commissions (
    organisation_id, commission_type, source_id, source_reference,
    partner_name, amount_kobo, rate, rate_type
  ) values (
    new.organisation_id, 'referral', new.id, new.referral_number,
    provider.name, computed_amount, provider.commission_rate, coalesce(provider.commission_rate_type, 'percentage')
  );

  return new;
end;
$$;

create trigger specialist_referrals_record_commission
  after update on public.specialist_referrals
  for each row
  when (old.status is distinct from new.status and new.status = 'payment_confirmed')
  execute function private.record_referral_commission();
