-- AI-011 (Nigerian meal plan generation) earns runtime_governed: the call site that
-- consults public.ai_runtime_config() via runGovernedAi (apps/web/src/app/(dashboard)/
-- patient/nutrition-actions.ts's generateMealPlanAction, PR #473) merges into main-dev
-- in the same change as this migration. Registered runtime_governed=false in
-- 20260903191922 (2026-09-03 full-platform audit) after being found set true with no
-- consulting call site in any merged or unmerged code at the time. Same pattern as the
-- AI-012 flip in 20260903201431: the registry's kill switch only earns its flag once a
-- real consulting call site ships alongside it.
-- Applied live 2026-09-06 as version 20260906140519 (filename pinned to the live version).

update public.ai_systems
   set runtime_governed = true
 where system_code = 'AI-011'
   and runtime_governed = false;

do $$
begin
  if not (select runtime_governed from public.ai_systems where system_code = 'AI-011') then
    raise exception 'FAIL: AI-011 runtime_governed flip did not take';
  end if;
  if not (public.ai_runtime_config('AI-011')->>'runtime_governed')::boolean then
    raise exception 'FAIL: ai_runtime_config(AI-011) does not report runtime governance';
  end if;
  raise notice 'PASS: AI-011 runtime-governed with a live consulting call site';
end $$;
