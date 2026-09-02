-- Caregiver Proxy Access, fix-forward: rename
-- private.can_read_clinical(uuid, caregiver_permission) to
-- private.can_read_clinical_permission(uuid, caregiver_permission), so it
-- stops sharing a name with private.can_read_clinical(uuid,
-- care_access_category).
--
-- Root cause of a recurring class of bug: PL/pgSQL function bodies and RLS
-- policy expressions written before this branch existed call
-- can_read_clinical(patient, 'some_literal') with an UNTYPED string
-- literal, relying on there being exactly one 2-arg overload for Postgres
-- to infer the type against. Once this branch's own
-- can_read_clinical(uuid, caregiver_permission) coexists as a second 2-arg
-- overload, every one of those untyped call sites becomes ambiguous
-- ("function private.can_read_clinical(uuid, unknown) is not unique",
-- 42725) the moment it actually runs — this already broke four live
-- callers once (fixed forward in this branch's own
-- 20260902224511_fix_can_read_clinical_overload_ambiguity_live_callers.sql)
-- and then broke a fifth: a main-dev commit unrelated to this branch
-- (16cd8ee on main-dev, "Fix 6 RLS policies still on the legacy 1-arg
-- can_read_clinical overload") rewrote vitals_readings_select and five
-- other policies with the same untyped-literal shape, correct on main-dev
-- alone (only one 2-arg overload exists there) but ambiguous the moment
-- it's tested against this branch's merge-ref state, and — critically —
-- unfixable by any migration positioned after it, since the ambiguous
-- statement is inside that migration's own body and the replay halts
-- there before ever reaching a later file.
--
-- The only fix that doesn't require chasing every future untyped call site
-- main-dev might add before this branch merges: give this branch's
-- overload a name of its own. ALTER FUNCTION ... RENAME is non-destructive
-- to every existing dependent — RLS policies and views reference a
-- function by OID, not by name, so every policy already created against
-- the old name (this branch's own care_plans_select, medications_select,
-- lab_orders_select, screening_results_select, lab_analyte_readings_select,
-- appointments_select, care_message_threads_select/insert,
-- care_messages_select/insert) keeps working with zero functional change,
-- confirmed live via pg_policies before/after. No PL/pgSQL function body
-- anywhere in the database calls the caregiver_permission-typed overload
-- (confirmed live via pg_get_functiondef search) — only RLS policies do —
-- so nothing else needs updating.
--
-- Applied directly to the live project (koiplnmbgnqnbywhpjlf) ahead of
-- this file's commit, per this branch's own established fix-forward
-- pattern for a live regression (20260902224511's header), because
-- main-dev's 16cd8ee had already made vitals_readings_select and its five
-- siblings ambiguous in the merge-ref state CI actually tests, and — see
-- 20260902233500_restore_caregiver_permission_clause_on_regressed_
-- policies.sql immediately after this one — a second, independently-pushed
-- attempt to fix that (also applied live) had silently dropped this
-- branch's own view_care_plan/view_medication/view_results clause from
-- three of those same policies while fixing the cast, which needed
-- reverting to the correct combined shape on the same live project this
-- migration touches.
--
-- Positioned after this branch's own last caregiver_permission call site
-- (20260902224442_caregiver_book_appointments.sql, appointments_select)
-- and before main-dev's 20260902232555, so a fresh replay binds every one
-- of this branch's own policies to the old name first (fine — RENAME
-- afterward doesn't disturb them) and no untyped literal anywhere ever
-- sees two candidates at once.
alter function private.can_read_clinical(uuid, public.caregiver_permission)
  rename to can_read_clinical_permission;

do $$
declare
  v_bad_policy text;
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = 'can_read_clinical_permission'
  ) then
    raise exception 'private.can_read_clinical_permission does not exist after the rename';
  end if;

  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = 'can_read_clinical'
      and pg_get_function_identity_arguments(p.oid) = 'p_patient uuid, p_permission caregiver_permission'
  ) then
    raise exception 'the old caregiver_permission-typed can_read_clinical(uuid, caregiver_permission) name still exists — the ambiguity this migration exists to remove is still present';
  end if;

  if has_function_privilege('anon', 'private.can_read_clinical_permission(uuid, public.caregiver_permission)', 'EXECUTE') then
    raise exception 'anon must not reach can_read_clinical_permission';
  end if;

  for v_bad_policy in
    select tablename || '.' || policyname
    from pg_policies
    where schemaname = 'public'
      and (coalesce(qual, '') || coalesce(with_check, '')) ~ 'can_read_clinical\([^)]*caregiver_permission\)'
  loop
    raise exception 'policy % still references the old can_read_clinical(uuid, caregiver_permission) shape', v_bad_policy;
  end loop;
end $$;
