-- Tarragon Health — close a real, currently-live PHI exposure: partner-
-- employee accounts (pharmacist, lab_partner) unintentionally passing
-- private.is_org_staff() whenever their profile happens to carry a non-null
-- organisation_id.
--
-- Both roles are documented (pharmacist_surface.sql, lab_partner_surface.sql)
-- as "external-partner access to patient PHI... does NOT open broad RLS
-- grants" — access is meant to be confined ENTIRELY to their own narrow
-- SECURITY DEFINER RPCs (pharmacist_orders/pharmacist_record_dispense/etc.,
-- lab_partner_orders/lab_partner_upload_result), never plain table RLS. But
-- private.is_org_staff() only ever excluded role = 'patient' — any other
-- non-patient role with organisation_id set to a real org passes it, which
-- is exactly what every other multi-tenant table's SELECT/UPDATE RLS policy
-- gates on. Confirmed live (rolled-back SELECT, not a hypothetical): the
-- existing 'Test Pharmacist' fixture (organisation_id = org 0001) can read a
-- REAL lab_orders row (LAB-000019) it has no legitimate reason to see, via a
-- plain `select * from lab_orders` under its own RLS-scoped session — total
-- bypass of the pharmacist-scoped-RPC-only design.
--
-- The admin member-provisioning UI's "Organisation (optional)" field doesn't
-- distinguish by role, so this is a realistic misconfiguration, not just a
-- contrived edge case — and it's exactly the same exposure this session's new
-- lab_partner role would carry if ever provisioned the same way.
--
-- Fix: exclude both partner-employee roles from is_org_staff's positive
-- branch. Every other role's behaviour is byte-identical to before (only the
-- role-list changed, nothing else) — verified neither pharmacist nor
-- lab_partner's own application code ever calls a direct
-- `.from(table)`/RLS-scoped read (both are 100% `.rpc(...)`-only), so this is
-- a pure hardening with zero legitimate-access regression for either role.
create or replace function private.is_org_staff(org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid())
      and role not in ('patient', 'pharmacist', 'lab_partner')
      and (role = 'admin' or organisation_id = org)
  );
$$;
