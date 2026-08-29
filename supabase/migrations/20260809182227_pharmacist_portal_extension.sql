-- Tarragon Health — pharmacist portal extension (dormant-until-real infra,
-- same status as pharmacy_partners generally: is_active = false for all rows
-- since 20260803124833_self_arranged_lab_fulfilment.sql, 0 live orders).
--
-- Rounds out the pharmacist surface (20260716178000_pharmacist_surface.sql)
-- with the three capabilities its worklist-only build never needed:
--   1. Reading/updating the pharmacist's OWN pharmacy_partners row — reads
--      were technically already open (pharmacy_partners is authenticated-read
--      global reference data), but writes are admin-only by RLS, so a
--      self-service profile edit needs a scoped SECURITY DEFINER RPC, same
--      shape as every other pharmacist capability.
--   2. A dispensing-history read, scoped the same way as the other three
--      pharmacist RPCs (pharmacy_order_dispenses RLS is patient-or-org-staff
--      only; a pharmacist is neither).
--   3. pharmacist_record_dispense never transitioned the order's own status —
--      it only inserted the dispense row, so an order stayed 'requested'/
--      'confirmed' forever even after being fully dispensed. Fixed so the
--      order lifecycle and the dispense log agree.

-- ---------------------------------------------------------------------------
-- 1. Profile read/update, scoped via private.pharmacist_partner() exactly
--    like the existing four RPCs.
-- ---------------------------------------------------------------------------
create or replace function public.pharmacist_profile()
returns table (
  name text,
  regions text[],
  city text,
  state text,
  contact_phone text,
  contact_email text,
  delivery boolean,
  license_number text,
  license_expires_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.name, p.regions, p.city, p.state, p.contact_phone, p.contact_email,
         p.delivery, p.license_number, p.license_expires_at
  from public.pharmacy_partners p
  where p.id = private.pharmacist_partner();
$$;

create or replace function public.pharmacist_update_profile(
  p_name text,
  p_regions text[],
  p_city text,
  p_state text,
  p_contact_phone text,
  p_contact_email text,
  p_delivery boolean,
  p_license_number text,
  p_license_expires_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_partner_id uuid := private.pharmacist_partner();
begin
  if v_partner_id is null then
    raise exception 'Not a partner pharmacy account' using errcode = '42501';
  end if;
  if coalesce(btrim(p_name), '') = '' then
    raise exception 'Pharmacy name is required' using errcode = '22023';
  end if;

  update public.pharmacy_partners
  set name = btrim(p_name),
      regions = coalesce(p_regions, '{}'),
      city = nullif(btrim(coalesce(p_city, '')), ''),
      state = nullif(btrim(coalesce(p_state, '')), ''),
      contact_phone = nullif(btrim(coalesce(p_contact_phone, '')), ''),
      contact_email = nullif(btrim(coalesce(p_contact_email, '')), ''),
      delivery = p_delivery,
      license_number = nullif(btrim(coalesce(p_license_number, '')), ''),
      license_expires_at = p_license_expires_at
  where id = v_partner_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Dispensing history — same cross-pharmacy isolation as the other four:
--    a non-pharmacist or a pharmacist reaching for another pharmacy's
--    dispenses gets zero rows.
-- ---------------------------------------------------------------------------
create or replace function public.pharmacist_dispense_history(p_limit int default 200)
returns table (
  dispense_id uuid,
  patient_name text,
  drug_name text,
  quantity text,
  dispensed_on date
)
language sql
stable
security definer
set search_path = ''
as $$
  select d.id, pr.full_name, d.drug_name, d.quantity, d.dispensed_on
  from public.pharmacy_order_dispenses d
  join public.pharmacy_orders o on o.id = d.pharmacy_order_id
  join public.profiles pr on pr.id = d.patient_id
  where private.pharmacist_partner() is not null
    and o.pharmacy_partner_id = private.pharmacist_partner()
  order by d.dispensed_on desc, d.created_at desc
  limit greatest(coalesce(p_limit, 200), 1);
$$;

-- ---------------------------------------------------------------------------
-- 3. Fix: recording a dispense now also moves the order to 'dispensed'
--    (unless it's already past that point in the fulfilment lifecycle, or
--    cancelled) — every pre-existing branch preserved byte-for-byte, only the
--    new UPDATE is added.
-- ---------------------------------------------------------------------------
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

  if v_order.status in ('requested', 'confirmed') then
    update public.pharmacy_orders set status = 'dispensed' where id = p_order_id;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants — a freshly created function carries an implicit PUBLIC execute
-- grant, which anon inherits through; revoke it explicitly before granting to
-- authenticated (see feedback_supabase_anon_execute_gotcha memory).
-- ---------------------------------------------------------------------------
revoke execute on function public.pharmacist_profile() from public;
revoke execute on function public.pharmacist_profile() from anon;
revoke execute on function public.pharmacist_update_profile(text, text[], text, text, text, text, boolean, text, timestamptz) from public;
revoke execute on function public.pharmacist_update_profile(text, text[], text, text, text, text, boolean, text, timestamptz) from anon;
revoke execute on function public.pharmacist_dispense_history(int) from public;
revoke execute on function public.pharmacist_dispense_history(int) from anon;

grant execute on function public.pharmacist_profile() to authenticated;
grant execute on function public.pharmacist_update_profile(text, text[], text, text, text, text, boolean, text, timestamptz) to authenticated;
grant execute on function public.pharmacist_dispense_history(int) to authenticated;

-- ---------------------------------------------------------------------------
-- The migration is the test.
-- ---------------------------------------------------------------------------
do $$
begin
  if has_function_privilege('anon', 'public.pharmacist_profile()', 'execute') then
    raise exception 'pharmacist_profile is still anon-executable';
  end if;
  if has_function_privilege('anon', 'public.pharmacist_update_profile(text, text[], text, text, text, text, boolean, text, timestamptz)', 'execute') then
    raise exception 'pharmacist_update_profile is still anon-executable';
  end if;
  if has_function_privilege('anon', 'public.pharmacist_dispense_history(int)', 'execute') then
    raise exception 'pharmacist_dispense_history is still anon-executable';
  end if;

  if pg_get_functiondef('public.pharmacist_record_dispense(uuid, text, text, date)'::regprocedure)
     not like '%status = ''dispensed''%' then
    raise exception 'pharmacist_record_dispense was not updated to transition order status';
  end if;
end;
$$;
