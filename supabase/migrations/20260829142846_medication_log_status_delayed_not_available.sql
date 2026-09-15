-- Tarragon Health — medication safety pathway 64.8: a dose response is one
-- of four states (Taken / Skipped / Delayed / Not available), not three.
--
-- medication_log_status has only ever carried ('taken', 'missed', 'skipped')
-- since the original chronic_disease migration. 'missed' already stands in
-- for a dose the patient never took; the spec asks for two further, distinct
-- states: 'delayed' (took it, just later than scheduled — not a miss) and
-- 'not_available' (couldn't take it because the medicine itself wasn't on
-- hand — an access-barrier signal, not a behavioural one).
--
-- In its own migration, alone: ALTER TYPE ... ADD VALUE cannot run in the
-- same transaction as a later statement that uses the new value (see
-- 20260821192305_emergency_source_exposure_report.sql for the same rule
-- applied to emergency_source). The follow-up migration that actually wires
-- 'not_available' into the adherence-escalation count is the next file.
do $$ begin
  alter type public.medication_log_status add value if not exists 'delayed';
exception when duplicate_object then null; end $$;

do $$ begin
  alter type public.medication_log_status add value if not exists 'not_available';
exception when duplicate_object then null; end $$;
