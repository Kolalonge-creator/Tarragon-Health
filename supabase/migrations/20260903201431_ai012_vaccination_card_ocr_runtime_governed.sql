-- AI-012 (vaccination card OCR) earned runtime_governed: the call site that consults
-- public.ai_runtime_config() via decideAiGovernance (apps/web/src/lib/vaccination-cards/
-- extraction-actions.ts, PR #477) is merged and confirmed serving on the promoted Vercel
-- production deployment of main-dev commit 1b9d3c36. Registered runtime_governed=false in
-- 20260903191922 pending exactly this deploy, per the registry contract.
-- Applied live 2026-09-03 as version 20260903201431 (filename pinned to the live version).
update public.ai_systems
   set runtime_governed = true
 where system_code = 'AI-012'
   and runtime_governed = false;

do $$
begin
  if not (select runtime_governed from public.ai_systems where system_code = 'AI-012') then
    raise exception 'FAIL: AI-012 runtime_governed flip did not take';
  end if;
  if not (public.ai_runtime_config('AI-012')->>'runtime_governed')::boolean then
    raise exception 'FAIL: ai_runtime_config(AI-012) does not report runtime governance';
  end if;
  raise notice 'PASS: AI-012 runtime-governed with a live consulting call site';
end $$;
