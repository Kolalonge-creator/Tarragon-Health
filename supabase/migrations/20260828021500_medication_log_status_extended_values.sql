-- Tarragon Health — medication adherence: extended log statuses (13.5)
--
-- medication_log_status has only ever carried 'taken' | 'missed' | 'skipped'
-- (20260705211129_chronic_disease.sql). The medication-management spec asks
-- for a patient to also record: unable to obtain, vomited/other relevant
-- circumstance, a suspected side effect, or another reason entirely — each a
-- clinically distinct signal from a plain "skipped" (a deliberate choice).
-- Structuring these as their own status values (rather than free-texting them
-- into `reason`) is what lets 13.16's clinical-vs-access-non-adherence split
-- work: 'unable_to_obtain' IS the access-barrier signal, 'skipped' stays the
-- clinical-choice signal, and the two now drive genuinely different
-- follow-up without any new column.
--
-- Split into its own migration file (used by a later, separate migration)
-- because ALTER TYPE ... ADD VALUE cannot be used in the same transaction
-- that also references the new value in an expression of that type —
-- matching this codebase's own precedent (medication_source's 'specialist'
-- value was added in 20260716170000, then only consumed by later files).
-- Checking the value's existence via pg_enum (a plain text comparison, not
-- an expression of type medication_log_status) is safe even from within this
-- same transaction, so the assertion block below is not deferred.

do $$
begin
  if not exists (
    select 1 from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'medication_log_status' and e.enumlabel = 'unable_to_obtain'
  ) then
    alter type public.medication_log_status add value 'unable_to_obtain';
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'medication_log_status' and e.enumlabel = 'vomited'
  ) then
    alter type public.medication_log_status add value 'vomited';
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'medication_log_status' and e.enumlabel = 'side_effect'
  ) then
    alter type public.medication_log_status add value 'side_effect';
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'medication_log_status' and e.enumlabel = 'other'
  ) then
    alter type public.medication_log_status add value 'other';
  end if;
end $$;

do $$
begin
  if (select count(*) from pg_enum where enumtypid = 'public.medication_log_status'::regtype) <> 7 then
    raise exception 'medication_log_status must have exactly 7 values (taken, missed, skipped, unable_to_obtain, vomited, side_effect, other)';
  end if;
  raise notice 'PASS: medication_log_status extended to 7 values';
end $$;
