-- Tarragon Health
-- public.master_data_registry was flagged by Supabase's security advisor as a
-- security_definer_view: a plain view with no explicit security_invoker setting runs with the
-- privileges of its owner (postgres) rather than the querying role. Investigated live 2026-08-29:
-- the view is a static VALUES-based reference dictionary (dictionary/governing_table/code_system/
-- kind metadata for medications/diagnoses/lab_tests/etc.) that selects from no real table at all,
-- so there is no PHI or access-control bypass risk today, but leaving a view definer-style with no
-- documented reason is exactly the kind of "undocumented, no migration record" drift this project's
-- history has been bitten by before (see CLAUDE.md's guard_profiles_self_update() precedent). This
-- migration makes it explicit and correct: query as the caller's own privileges, matching every
-- other view in this schema that doesn't have a deliberate reason to run as the owner.
--
-- Guarded rather than unconditional: the view's own CREATE VIEW migration is itself an instance of
-- exactly the drift this comment describes — it was applied live to koiplnmbgnqnbywhpjlf by a
-- concurrent session but never committed to main-dev, and is only recovered (as part of a much
-- larger 165-migration drift-recovery effort) on the still-open, not-yet-green PR #313
-- ("Recover 165 migrations applied live but missing from repo history"). On the live project this
-- migration's ALTER runs immediately (the view already exists there — verified 2026-08-29). On a
-- fresh replay (CI, local `db reset`, disaster recovery) before PR #313 lands, the view does not
-- exist yet, so this is a no-op rather than a hard failure — don't remove this guard just because
-- it looks unnecessary against the live database.
do $$
begin
  if to_regclass('public.master_data_registry') is not null then
    execute 'alter view public.master_data_registry set (security_invoker = true)';
  end if;
end $$;

do $$
declare
  v_invoker text;
begin
  if to_regclass('public.master_data_registry') is null then
    return;
  end if;

  select reloptions::text into v_invoker
  from pg_class where relname = 'master_data_registry';

  if v_invoker is null or v_invoker not like '%security_invoker=true%' then
    raise exception 'master_data_registry did not pick up security_invoker=true: %', v_invoker;
  end if;
end $$;
