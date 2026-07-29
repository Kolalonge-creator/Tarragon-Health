-- Tarragon Health
-- Referral urgency + structured clinical summary
--
-- specialist_referrals.referral_reason has always been free text only
-- (auto-populated by the abnormal-result-handler Edge Function, or typed
-- by a clinician) — there's no structured urgency (routine/priority/
-- urgent, per docs/Tarragon_Health_Master_Operating_Plan_v4.md §7 Level 4)
-- and no assembled clinical summary (vitals/meds/triggering result) a
-- specialist could actually use, since specialists have no platform login
-- and referral_reason is the only thing that ever reaches them.
--
-- urgency stays nullable and is never inferred/defaulted here — same
-- null-gating posture CLAUDE.md already requires for doctor_tier and
-- reviewed_by/reviewed_at. clinical_summary is a point-in-time jsonb
-- snapshot (matches the existing lab_result_interpretations.interpretation
-- jsonb convention) because it must reflect the patient's state *at
-- referral time*, not a live join that would drift after the fact.

create type public.referral_urgency as enum ('routine', 'priority', 'urgent');

alter table public.specialist_referrals
  add column urgency public.referral_urgency,
  add column clinical_summary jsonb,
  add column set_by uuid references public.profiles (id) on delete set null;
