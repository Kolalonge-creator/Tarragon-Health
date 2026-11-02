-- AI-023 (Front Desk website receptionist) earns runtime_governed. The call site is apps/web/src/lib/frontdesk/receptionist.ts:
-- both model calls go through runGovernedAi (lines ~110 and ~147), which fetches public.ai_runtime_config('AI-023') first and
-- runs the fallback when the system is disabled, so the kill switch is real. The register's own rule (docs/AI_GOVERNANCE_SPEC.md)
-- is that this flag tracks whether a call site really consults ai_runtime_config(): it does, and the flag now says so.
--
-- This changes ONE flag. It does not enable, approve or sign anything: is_enabled is left exactly as it is (the CMO switched
-- AI-023 on earlier on 2026-11-02 through set_ai_system_enabled; a false flag here misreported a governed live system on the hub).

update public.ai_systems
   set runtime_governed = true
 where system_code = 'AI-023'
   and runtime_governed = false;

do $$
begin
  if not (select runtime_governed from public.ai_systems where system_code = 'AI-023') then
    raise exception 'FAIL: AI-023 runtime_governed flip did not take';
  end if;
  if not (public.ai_runtime_config('AI-023')->>'runtime_governed')::boolean then
    raise exception 'FAIL: ai_runtime_config(AI-023) should report governed';
  end if;
end $$;
