-- Tarragon Health — new outreach_trigger_type value for non-clinical
-- medication-engagement barriers (Engagement/Retention gap #1).
--
-- ALTER TYPE ... ADD VALUE cannot be used in the same transaction as a
-- statement that references the new value (Postgres restriction) — this is
-- deliberately its own migration, consumed by a later one.
--
-- Live enum_range check (2026-08-30, project koiplnmbgnqnbywhpjlf) confirmed
-- 14 existing values, several with no corresponding local migration file —
-- a known, already-tracked drift (see docs/CLAUDE.md's migration-drift
-- lessons). Not attempting to reconcile that here; only adding one new value.

alter type public.outreach_trigger_type add value if not exists 'medication_engagement_barrier';

do $$
begin
  if not exists (
    select 1 from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'outreach_trigger_type' and e.enumlabel = 'medication_engagement_barrier'
  ) then
    raise exception 'FAIL: outreach_trigger_type is missing medication_engagement_barrier';
  end if;
  raise notice 'PASS: outreach_trigger_type.medication_engagement_barrier added';
end $$;
