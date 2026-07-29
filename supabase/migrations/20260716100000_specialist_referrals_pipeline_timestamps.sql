-- Tarragon Health
-- Referral pipeline timestamps
--
-- Backs the last two stages of the visible referral pipeline
-- (docs/Tarragon_Health_Master_Operating_Plan_v4.md §7 Level 5b:
-- Treatment Plan Received, Monitoring Continues) with real fields — the
-- other stages already derive from existing columns (screening_upgrades,
-- specialist_referrals.status/urgency/booking_confirmed_at). Specialists
-- have no platform login, so treatment_plan_note is manually transcribed
-- by org staff from whatever the specialist sends back externally.

alter table public.specialist_referrals
  add column treatment_plan_received_at timestamptz,
  add column treatment_plan_note text,
  add column shared_care_handback_at timestamptz;
