-- AI-003 (Patient result explainer) — register the guardrail that was
-- already true in the running system prompt but never recorded, now that
-- the medication-explanation path (kind = 'medication') is wired through
-- runGovernedAi like the other six kinds (see
-- docs/AI_002_015_EVALUATION_SCOPE.md's "real finding": this path was a
-- bare try/catch around a direct ChatAnthropic call with no kill switch, no
-- decideAiGovernance and no audit row -- switching AI-003 off in the
-- console did nothing to it).
--
-- No version approval, no evaluation run seeded here -- both are a human's
-- judgement, per CLAUDE.md's standing rule.

insert into public.ai_guardrails (ai_system_id, rule_code, kind, description, enforcement, config)
select s.id, 'no_medication_dose_change_suggestion', 'prohibited_prescribing'::public.ai_guardrail_kind,
  'The medication-explanation path (kind = medication) forbids suggesting a dose, frequency, or route change, or stopping the medication, even if the patient''s question implies wanting that -- tells the patient to ask their care team or pharmacist first before changing anything.',
  'blocking'::public.ai_guardrail_enforcement,
  '{"source":"apps/web/src/lib/patient-explainer/generate.ts"}'::jsonb
from public.ai_systems s
where s.system_code = 'AI-003'
on conflict (ai_system_id, rule_code) do nothing;

do $$
declare
  v_count int;
begin
  select count(*) into v_count
    from public.ai_guardrails g
    join public.ai_systems s on s.id = g.ai_system_id
    where s.system_code = 'AI-003' and g.is_active;
  if v_count <> 4 then
    raise exception 'expected 4 active guardrails for AI-003 after this migration, found %', v_count;
  end if;
end;
$$;
