-- Tarragon Health — lab partner scoped surface
--
-- A logged-in partner lab can, FOR AN ORDER ROUTED TO THEIR LAB:
--   • see their own order worklist (patient identity + what was ordered), and
--   • upload the result document directly.
-- They can do nothing else and can never see an order routed to another lab.
--
-- This is the "lab" counterpart of the pharmacist surface
-- (20260716178000_pharmacist_surface.sql) — same security model, same shape,
-- adapted to lab_orders/lab_providers. It sits ALONGSIDE the existing Lab
-- Liaison Officer path (20260720120000/20260720120100), not in place of it —
-- a lab that doesn't want its own login keeps emailing Tarragon's back office,
-- exactly as today; a lab that wants to log in and upload directly now can.
--
-- SECURITY MODEL: this is external-partner access to patient PHI, so it does
-- NOT open broad RLS grants on profiles/lab_orders/lab_result_documents. The
-- only access path is the three SECURITY DEFINER RPCs below, each of which
-- resolves the caller's lab via private.lab_partner_provider() and returns/
-- writes rows ONLY for orders whose provider_id matches. A non-lab-partner
-- (provider null) or a lab partner reaching for another lab's order gets zero
-- rows / a 42501. Cross-lab isolation is enforced in one place and must stay
-- that way.

alter table public.profiles
  add column if not exists lab_provider_id uuid references public.lab_providers (id) on delete set null;

-- The caller's lab — only for a 'lab_partner' account; null otherwise, which
-- makes every RPC below return/write nothing for non-lab-partners.
create or replace function private.lab_partner_provider()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select lab_provider_id
  from public.profiles
  where id = (select auth.uid()) and role = 'lab_partner';
$$;

-- 1. The lab partner's own order worklist. Unpaid orders (pending_payment)
-- are excluded — nothing for the lab to act on until the patient has paid.
create or replace function public.lab_partner_orders()
returns table (
  order_id uuid,
  order_number text,
  status text,
  patient_name text,
  patient_number text,
  panel_name text,
  ordered_at timestamptz,
  resulted_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select o.id, o.order_number, o.status::text, p.full_name, p.patient_number,
         pb.name, o.ordered_at, o.resulted_at
  from public.lab_orders o
  join public.profiles p on p.id = o.patient_id
  left join public.panel_bundles pb on pb.id = o.panel_bundle_id
  where private.lab_partner_provider() is not null
    and o.provider_id = private.lab_partner_provider()
    and o.status <> 'pending_payment'
  order by o.ordered_at desc;
$$;

-- 2. Resolve an order's patient_id for the caller's own lab — used by the app
-- layer to build the storage path *before* the file upload (the row insert
-- itself re-verifies ownership independently in function 3, so this lookup is
-- never trusted on its own for the write).
create or replace function public.lab_partner_order_patient(p_order_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select o.patient_id
  from public.lab_orders o
  where o.id = p_order_id and o.provider_id = private.lab_partner_provider();
$$;

-- 3. Upload a result for one of the lab partner's own orders. organisation_id/
-- patient_id are derived from the verified order row, never trusted from the
-- client. Reuses the existing lab_result_documents insert trigger (raises the
-- clinician_review alert + patient notification, same as every other source)
-- — no duplicated logic. Uploading the result also advances the order to
-- 'resulted' (unless already resulted/cancelled), since the result IS what
-- makes an order resulted; a lab partner never sets 'cancelled' directly.
create or replace function public.lab_partner_upload_result(
  p_order_id uuid,
  p_file_path text,
  p_original_filename text,
  p_mime_type text,
  p_file_size_bytes bigint,
  p_note text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.lab_orders%rowtype;
  v_doc_id uuid;
begin
  select * into v_order
  from public.lab_orders
  where id = p_order_id and provider_id = private.lab_partner_provider();

  if v_order.id is null then
    raise exception 'Order not found for this lab' using errcode = '42501';
  end if;
  if coalesce(btrim(p_file_path), '') = '' then
    raise exception 'File path is required' using errcode = '22023';
  end if;

  insert into public.lab_result_documents
    (organisation_id, patient_id, lab_order_id, file_path, original_filename,
     mime_type, file_size_bytes, source, note)
  values
    (v_order.organisation_id, v_order.patient_id, p_order_id, p_file_path,
     p_original_filename, p_mime_type, p_file_size_bytes, 'lab_partner',
     nullif(btrim(coalesce(p_note, '')), ''))
  returning id into v_doc_id;

  if v_order.status not in ('resulted', 'cancelled') then
    update public.lab_orders
    set status = 'resulted', resulted_at = coalesce(resulted_at, now())
    where id = p_order_id;
  end if;

  return v_doc_id;
end;
$$;

grant execute on function public.lab_partner_orders() to authenticated;
grant execute on function public.lab_partner_order_patient(uuid) to authenticated;
grant execute on function public.lab_partner_upload_result(uuid, text, text, text, bigint, text) to authenticated;

-- `revoke ... from public` does NOT strip anon's own EXECUTE grant on a
-- freshly created function in this project (Supabase grants EXECUTE ON ALL
-- FUNCTIONS to anon/authenticated/service_role independently of PUBLIC) — see
-- 20260724020855/20260724163357/20260720224204. Revoke from anon explicitly.
revoke execute on function public.lab_partner_orders() from anon;
revoke execute on function public.lab_partner_order_patient(uuid) from anon;
revoke execute on function public.lab_partner_upload_result(uuid, text, text, text, bigint, text) from anon;
