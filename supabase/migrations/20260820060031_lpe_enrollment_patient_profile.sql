-- A patient's own answer to a short, one-time "how does your routine work"
-- question (currently just a rough morning/evening preference) -- stored on
-- the enrolment itself (not the AI coach's ai_conversations blob, which is
-- an unstructured chat-turn array, a poor fit for durable, queryable
-- profile data). No new table: still the same "no dual source of truth"
-- convention every other LPE addition in this codebase follows.
--
-- Deliberately does NOT touch apps/web/src/lib/ai-coach/graph.ts. That file
-- is a safety-critical LangGraph turn (deterministic keyword emergency
-- guardrail -> structured Claude tiering -> escalation logging) -- adding a
-- conversational onboarding step there risks the emergency-detection path
-- for a feature that doesn't need it. A plain one-time form captures the
-- same preference with no change to that state machine at all.
--
-- Column only, no new RLS policy: lpe_enrollments_update (20260719120001)
-- already allows `patient_id = (select auth.uid())`, which covers a patient
-- setting their own profile the same way they already update their own
-- enrolment today.

alter table public.lpe_enrollments
  add column if not exists patient_profile jsonb;

comment on column public.lpe_enrollments.patient_profile is
  'Patient-supplied routine preferences captured once via a short form (see routine-profile-prompt.tsx), e.g. {"routine": "morning" | "evening" | "varies"}. Not an AI-conversation transcript -- see the migration header for why this isn''t on ai_conversations.';

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'lpe_enrollments' and column_name = 'patient_profile'
  ) then
    raise exception 'lpe_enrollments.patient_profile was not created';
  end if;
end;
$$;
