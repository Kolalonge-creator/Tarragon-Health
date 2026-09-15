-- lab_specimens_select: add the delegated-clinical-access branch, via the
-- 2-arg, category-scoped can_read_clinical.
--
-- WHY THIS IS A SEPARATE MIGRATION rather than an edit to
-- 20260829123155_lab_network_specimen_tracking.sql, where the policy is
-- created. public.care_access_category and the 2-arg can_read_clinical
-- overload are created by 20260830103251_category_scoped_clinical_access_and_
-- emergency_access.sql, which sorts AFTER that file and drops the 1-arg
-- can_read_clinical(uuid) overload with no CASCADE. Two ways this can break
-- a replay from scratch, both hit in practice: writing the 2-arg call
-- straight into the 2026-08-29 migration is a forward reference that fails
-- with `type "public.care_access_category" does not exist` (SQLSTATE 42704)
-- before 20260830103251 ever runs; and leaving the 1-arg call in that same
-- migration instead makes 20260830103251's own `drop function
-- private.can_read_clinical(uuid)` fail with "cannot drop function ...
-- because other objects depend on it" (SQLSTATE 2BP01), since
-- lab_specimens_select would still be depending on it at that exact point
-- in the sequence. The original migration therefore omits the delegated-
-- access branch entirely (self/staff/lab-partner only in the interim), and
-- this migration adds it back in once the 2-arg form actually exists.
--
-- WHY IT MATTERS. lab_specimens is a table created after the category-scoped
-- access model landed, so it is not covered by
-- 20260902232555_fix_six_policies_still_on_legacy_can_read_clinical_overload.
-- Without this migration, a consent-graph reader granted access to a
-- different category would incorrectly have NO delegated read path onto
-- specimen rows at all in the interim window -- the same class of drift
-- CLAUDE.md records for the reproductive-health tables, just missing-access
-- rather than over-broad-access this time.

drop policy if exists lab_specimens_select on public.lab_specimens;

create policy lab_specimens_select on public.lab_specimens
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or private.can_read_clinical(patient_id, 'labs_results'::public.care_access_category)
    or (provider_id is not null and provider_id = private.lab_partner_provider())
  );

do $$
declare
  v_qual text;
begin
  select pg_get_expr(pol.polqual, pol.polrelid) into v_qual
    from pg_policy pol
    join pg_class c on c.oid = pol.polrelid
   where c.relname = 'lab_specimens' and pol.polname = 'lab_specimens_select';

  if v_qual is null then
    raise exception 'lab_specimens_select does not exist after this migration';
  end if;
  if v_qual not like '%labs_results%' then
    raise exception 'lab_specimens_select is not category-scoped to labs_results. Got: %', v_qual;
  end if;
end $$;
