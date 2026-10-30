-- AI-017 (Scribe Draft) earns runtime_governed. The call site is supabase/functions/scribe-draft/index.ts: before any
-- model call, in every mode, it calls public.ai_runtime_config('AI-017') and returns { status: 'disabled' } when the
-- system is unregistered, the call fails or is_enabled is false (fail closed). Document mode adds a second gate,
-- public.scribe_document_prompt(), which returns nothing until the Clinical Director approves a prompt. The deployed
-- function (v22) was compared file by file with main-dev on 2026-10-30 and is identical.
--
-- This changes ONE flag and switches nothing on: is_enabled stays false and the acceptance gate is untouched. Turning
-- AI-017 on is public.set_ai_system_enabled(), a separate decision of the CMO.
--
-- The earlier scaffolding (20261006164342) said the flag is "earned after it is switched on and observed". The register's
-- own rule (docs/AI_GOVERNANCE_SPEC.md) is the narrower one: a call site that really consults ai_runtime_config(). That
-- is true here, so the flag now says so; it means "the switch is real", not "the system is live".

update public.ai_systems
   set runtime_governed = true
 where system_code = 'AI-017'
   and runtime_governed = false;

do $$
begin
  if not (select runtime_governed from public.ai_systems where system_code = 'AI-017') then
    raise exception 'FAIL: AI-017 runtime_governed flip did not take';
  end if;
  if (select is_enabled from public.ai_systems where system_code = 'AI-017') then
    raise exception 'FAIL: AI-017 was switched on; this migration must not do that';
  end if;
  if not (public.ai_runtime_config('AI-017')->>'runtime_governed')::boolean
     or (public.ai_runtime_config('AI-017')->>'enabled')::boolean then
    raise exception 'FAIL: ai_runtime_config(AI-017) should report governed and still off';
  end if;
  raise notice 'PASS: AI-017 runtime-governed, still off';
end $$;
