-- Tarragon Health — medication safety pathway 64.20/64.21: a new,
-- genuinely distinct alert_type_code for "the patient could not obtain or
-- afford a prescribed medication" — not the same event as pharmacy_problem
-- (a pharmacy_orders row stalled after being placed) or adherence_problem (a
-- missed-dose count), and not a stretch-fit onto either.
--
-- In its own migration, alone: ALTER TYPE ... ADD VALUE cannot run in the
-- same transaction as a later statement that uses the new value (see
-- 20260829142846_medication_log_status_delayed_not_available.sql for the
-- same rule applied earlier in this same pathway). The table + generator
-- that actually uses this value is the next migration.
--
-- Live-checked before writing this: alert_type_code currently carries 17
-- values (the original 16 from 20260828013011_alert_system_taxonomy_and_
-- governance.sql's "exactly 16" seed, plus a 'support_ticket_escalation'
-- value added since by other work on this project this branch predates
-- locally) — so this is the second addition to the taxonomy since that
-- governed v1 seed, not the first, and the "exactly N" assertion in that
-- original migration was a one-time apply-time check, not a live invariant.
do $$ begin
  alter type public.alert_type_code add value if not exists 'medication_access_barrier';
exception when duplicate_object then null; end $$;
