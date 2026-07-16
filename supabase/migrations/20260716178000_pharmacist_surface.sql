-- Tarragon Health — pharmacist scoped surface (medication pathway, Phase 8b)
--
-- A logged-in partner pharmacist can, FOR AN ORDER ROUTED TO THEIR PHARMACY:
--   • see the patient's allergy status and current (active) medications, and
--   • record what they dispensed (drug / quantity / date).
-- They can do nothing else and can never see a patient who has not ordered from
-- their pharmacy. No stock/inventory (founder constraint).
--
-- SECURITY MODEL: this is external-partner access to patient PHI, so it does
-- NOT open broad RLS grants on profiles/patient_allergies/medications. The only
-- access path is the four SECURITY DEFINER RPCs below, each of which resolves
-- the caller's pharmacy via private.pharmacist_partner() and returns rows ONLY
-- for orders whose pharmacy_partner_id matches. A non-pharmacist (partner null)
-- or a pharmacist reaching for another pharmacy's order gets zero rows.
-- Cross-pharmacy isolation is enforced in one place and must stay that way.

alter table public.profiles
  add column if not exists pharmacy_partner_id uuid references public.pharmacy_partners (id) on delete set null;

-- The caller's pharmacy — only for a 'pharmacist' account; null otherwise, which
-- makes every RPC below return nothing for non-pharmacists.
create or replace function private.pharmacist_partner()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select pharmacy_partner_id
  from public.profiles
  where id = (select auth.uid()) and role = 'pharmacist';
$$;

-- 1. The pharmacist's own order worklist (patient name/number for identity check).
create or replace function public.pharmacist_orders()
returns table (
  order_id uuid,
  order_number text,
  status text,
  patient_name text,
  patient_number text,
  items jsonb,
  requested_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select o.id, o.order_number, o.status::text, p.full_name, p.patient_number, o.items, o.requested_at
  from public.pharmacy_orders o
  join public.profiles p on p.id = o.patient_id
  where private.pharmacist_partner() is not null
    and o.pharmacy_partner_id = private.pharmacist_partner()
  order by o.requested_at desc;
$$;

-- 2. Allergy status for one of the pharmacist's orders (empty if not theirs).
create or replace function public.pharmacist_order_allergies(p_order_id uuid)
returns table (allergen text, reaction text, severity text)
language sql
stable
security definer
set search_path = ''
as $$
  select a.allergen, a.reaction, a.severity::text
  from public.patient_allergies a
  where a.patient_id = (
    select o.patient_id from public.pharmacy_orders o
    where o.id = p_order_id and o.pharmacy_partner_id = private.pharmacist_partner()
  )
  order by a.allergen;
$$;

-- 3. Current (active) medications for one of the pharmacist's orders.
create or replace function public.pharmacist_order_medications(p_order_id uuid)
returns table (drug_name text, dose text, frequency text)
language sql
stable
security definer
set search_path = ''
as $$
  select m.drug_name, m.dose, m.frequency
  from public.medications m
  where m.is_active
    and m.patient_id = (
      select o.patient_id from public.pharmacy_orders o
      where o.id = p_order_id and o.pharmacy_partner_id = private.pharmacist_partner()
    )
  order by m.drug_name;
$$;

-- 4. Record a dispense — org/patient are derived from the (verified) order, not
-- trusted from the client; recorded_by is the caller; source is always 'pharmacy'.
create or replace function public.pharmacist_record_dispense(
  p_order_id uuid,
  p_drug_name text,
  p_quantity text,
  p_dispensed_on date
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.pharmacy_orders%rowtype;
begin
  select * into v_order
  from public.pharmacy_orders
  where id = p_order_id and pharmacy_partner_id = private.pharmacist_partner();

  if v_order.id is null then
    raise exception 'Order not found for this pharmacy' using errcode = '42501';
  end if;
  if coalesce(btrim(p_drug_name), '') = '' then
    raise exception 'Drug name is required' using errcode = '22023';
  end if;

  insert into public.pharmacy_order_dispenses
    (organisation_id, patient_id, pharmacy_order_id, drug_name, quantity, dispensed_on, source, recorded_by)
  values
    (v_order.organisation_id, v_order.patient_id, p_order_id, btrim(p_drug_name),
     nullif(btrim(coalesce(p_quantity, '')), ''), coalesce(p_dispensed_on, current_date),
     'pharmacy', (select auth.uid()));
end;
$$;

grant execute on function public.pharmacist_orders() to authenticated;
grant execute on function public.pharmacist_order_allergies(uuid) to authenticated;
grant execute on function public.pharmacist_order_medications(uuid) to authenticated;
grant execute on function public.pharmacist_record_dispense(uuid, text, text, date) to authenticated;
