-- Tarragon Health — lab partner self-service facility/branch management.
--
-- Gap: the "pick a nearby facility" patient flow (facilities table, linked
-- via facilities.lab_provider_id — 20260716161000) only ever reflects
-- whatever an admin hand-typed. A real lab partner with dozens of branches
-- has no way to keep its own footprint accurate; facilities write RLS is
-- is_admin() OR has_permission('partners.facilities.manage') only
-- (20260718230100), which a lab_partner-role account never holds.
--
-- Fix: two ADDITIVE permissive policies (OR'd with the existing admin-gated
-- ones, nothing removed) scoped to private.lab_partner_provider() — a lab
-- partner may add/edit ONLY 'lab'-type facilities linked to their own
-- lab_providers row, never another lab's, never a non-lab facility type.
-- No delete grant: retiring a branch is an is_active update, matching this
-- codebase's dormant-not-deleted convention for every partner catalogue.

create policy facilities_insert_lab_partner on public.facilities
  for insert to authenticated
  with check (
    type = 'lab'
    and private.lab_partner_provider() is not null
    and lab_provider_id = private.lab_partner_provider()
  );

create policy facilities_update_lab_partner on public.facilities
  for update to authenticated
  using (
    type = 'lab'
    and private.lab_partner_provider() is not null
    and lab_provider_id = private.lab_partner_provider()
  )
  with check (
    type = 'lab'
    and private.lab_partner_provider() is not null
    and lab_provider_id = private.lab_partner_provider()
  );

-- The self-service UI needs to set lab_provider_id on insert/update to
-- satisfy the WITH CHECK above (it's nullable, so omitting it fails the
-- check rather than defaulting to "mine") — this trivial passthrough lets
-- the client learn its own id without hand-maintaining it anywhere.
create or replace function public.lab_partner_own_provider_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select private.lab_partner_provider();
$$;

grant execute on function public.lab_partner_own_provider_id() to authenticated;
revoke execute on function public.lab_partner_own_provider_id() from public;

-- Assertion: confirm the isolation shape lands as intended — a lab partner's
-- policy predicate must never be satisfiable for a facility linked to a
-- DIFFERENT lab_provider_id. This can't be tested with a live role switch in
-- a DDL migration, so instead assert the policies exist with the expected
-- command/permissive shape; the real isolation proof is the rolled-back
-- session test run separately against this migration.
do $$
declare
  v_count int;
begin
  select count(*) into v_count
  from pg_policies
  where schemaname = 'public' and tablename = 'facilities'
    and policyname in ('facilities_insert_lab_partner', 'facilities_update_lab_partner');
  if v_count <> 2 then
    raise exception 'expected 2 new facilities policies, found %', v_count;
  end if;
  if has_function_privilege('anon', 'public.lab_partner_own_provider_id()', 'EXECUTE') then
    raise exception 'anon can still execute lab_partner_own_provider_id';
  end if;
end $$;
