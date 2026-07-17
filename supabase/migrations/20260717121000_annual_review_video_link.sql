-- Tarragon Health — Annual Health Review: relax video_consultations CHECK
--
-- Separate migration (own transaction) from 20260717120000, which added the
-- 'annual_review' value to video_consultation_context: Postgres forbids using a
-- newly-added enum value in the same transaction that introduces it. Here the
-- value is already committed, so the CHECK can reference it safely.
--
-- Admits the annual-review context alongside the two existing ones so a routine
-- annual-review video consult reuses the same Zoom infra as pre-referral triage
-- and specialist consults.
alter table public.video_consultations
  drop constraint if exists video_consultations_context_link;

alter table public.video_consultations
  add constraint video_consultations_context_link check (
    (context = 'pre_referral_triage' and escalation_id is not null)
    or (context = 'specialist_consult' and specialist_referral_id is not null)
    or (context = 'annual_review' and annual_review_id is not null)
  );
