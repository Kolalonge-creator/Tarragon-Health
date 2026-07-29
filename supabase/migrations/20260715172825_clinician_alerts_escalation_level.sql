-- Tarragon Health
-- escalation_level tracks which rung of the doctor-tier ladder
-- (docs/Tarragon_Health_Master_Operating_Plan_v4.md §4/§7) a worklist item
-- currently sits at — distinct from the existing alert_level (how
-- urgent/severe the finding is), not a rename of one field to the other. A
-- red-flag case can still be resolved at Tier 2 if it's clinically
-- straightforward, so severity and reviewing-tier are orthogonal.
--
-- Targets clinician_alerts, not nurse_alerts: that table was renamed by
-- 20260705211611_merge_nurse_into_clinician.sql, before this ladder work.
--
-- 1 = Tier 1, 2 = Tier 2, 3 = Tier 3, 4 = Tier 4 Senior Registrar,
-- 5 = Tier 5 Partner Specialist (referred). Backfill is a best-effort
-- linear mapping off the existing alert_level (routine=1,
-- clinician_review=2, urgent_escalation=3, emergency=4) — nothing
-- backfills to 5, since reaching Tier 5 requires an actual referral
-- action, not just alert severity. Left nullable: no UI reads or writes
-- this yet (the Tier 1-4 doctor dashboard is a follow-up build) — this
-- migration is schema foundation only, per master plan §17.

alter table public.clinician_alerts
  add column escalation_level smallint check (escalation_level between 1 and 5);

update public.clinician_alerts
  set escalation_level = case level
    when 'routine' then 1
    when 'clinician_review' then 2
    when 'urgent_escalation' then 3
    when 'emergency' then 4
  end;

create index clinician_alerts_escalation_level_idx
  on public.clinician_alerts (organisation_id, escalation_level) where status = 'open';
