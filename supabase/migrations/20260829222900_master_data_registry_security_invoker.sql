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
alter view public.master_data_registry set (security_invoker = true);

do $$
declare
  v_invoker text;
begin
  select reloptions::text into v_invoker
  from pg_class where relname = 'master_data_registry';

  if v_invoker is null or v_invoker not like '%security_invoker=true%' then
    raise exception 'master_data_registry did not pick up security_invoker=true: %', v_invoker;
  end if;
end $$;
