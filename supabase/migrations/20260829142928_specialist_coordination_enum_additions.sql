-- Tarragon Health — Specialist Care Coordination & Continuity Engine, part 3/7
-- Enum additions, split into their own migration/transaction because
-- Postgres forbids using a newly added enum value inside the same
-- transaction that added it (error 55P04) — same discipline
-- 20260716113000_referral_status_add_waitlisted.sql and
-- 20260827235757_consultation_system_enum_additions.sql already document.
--
-- Three additions, all routing specialist-referral continuity work into
-- engines that already own that kind of work — "never build a parallel
-- worklist", same discipline as consultation_follow_ups' own header note:
--
--   * outreach_trigger_type gains 'specialist_action_pending' (a specialist's
--     recommended repeat test / investigation / follow-up appointment is
--     Care Coordinator logistics -> lands on the existing outreach worklist,
--     same shape as 'consultation_follow_up') and 'referral_stalled' (an
--     automatically-detected stuck referral -> the same worklist, so a
--     coordinator sees it right alongside every other patient-facing task
--     instead of a new dashboard nobody remembers to check).
--
--   * care_plan_review_trigger_event gains 'specialist_recommendation' (a
--     specialist recommending a medication review or care-plan change is a
--     clinical decision, not logistics -> the existing care_plan_review_prompts
--     doctor worklist, never a direct care_plans write, per CLAUDE.md's "a
--     doctor authors every care-plan change").
--
--   * A new, narrower enum: specialist_referral_action_item_type. Not reusing
--     consultation_follow_ups.action_type's text CHECK vocabulary because
--     that table is tightly coupled to clinical_encounter_notes (its INSERT
--     trigger requires encounter_note_id to resolve to a real row) — a
--     specialist's report has no encounter note, it has a referral. Same
--     "genuinely separate, not a kind column" reasoning as keeping
--     ecg_report_documents separate from lab_result_documents.

alter type public.outreach_trigger_type add value if not exists 'specialist_action_pending';
alter type public.outreach_trigger_type add value if not exists 'referral_stalled';

alter type public.care_plan_review_trigger_event add value if not exists 'specialist_recommendation';

do $$
begin
  if not exists (select 1 from pg_type where typname = 'specialist_referral_action_item_type') then
    create type public.specialist_referral_action_item_type as enum (
      'repeat_test',
      'investigation',
      'follow_up_appointment',
      'medication_review',
      'care_plan_review',
      'other'
    );
  end if;
end $$;
