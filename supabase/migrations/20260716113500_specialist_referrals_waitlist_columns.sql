-- Tarragon Health
-- Waitlist handling — columns + guardrail
--
-- No real-time slot/cancellation system exists anywhere in this codebase
-- — waitlist surfacing (see the /clinician/referrals/waitlisted tab) is
-- polling-based, not push-notified. A true event-driven "specialist
-- became available -> notify waitlisted patients" pipeline is a
-- deliberate scope gap, matching the Weight Scale BLE gap's documented
-- posture (CLAUDE.md), not an oversight.
--
-- The CHECK constraint enforces the master plan's "doctor must document
-- an interim management plan before waitlisting" requirement at the DB
-- level, not just app-layer — matching this repo's posture for regulated
-- clinical actions (same idiom as the indemnity CHECK constraints).

alter table public.specialist_referrals
  add column interim_management_plan text,
  add column waitlisted_at timestamptz;

alter table public.specialist_referrals
  add constraint specialist_referrals_waitlist_requires_plan
  check (status <> 'waitlisted' or interim_management_plan is not null);
