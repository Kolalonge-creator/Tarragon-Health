-- Fix-up for 20260828231600_diagnostic_reports_and_abnormal_result_hook:
-- clinician_alerts.diagnostic_report_id must be DEFERRABLE INITIALLY
-- DEFERRED. private.handle_diagnostic_report_insert() (that migration's
-- section 5) inserts a clinician_alerts row referencing
-- diagnostic_report_id = NEW.id from INSIDE diagnostic_reports' own BEFORE
-- INSERT trigger — NEW.id already has its gen_random_uuid() default at that
-- point, but the diagnostic_reports row itself is not yet present in the
-- table (a BEFORE trigger runs before the row is actually inserted). A
-- NOT DEFERRABLE (the default) FK check fails that INSERT immediately;
-- DEFERRABLE INITIALLY DEFERRED defers the check to end of transaction, by
-- which point the diagnostic_reports row exists. screening_result_id/
-- vital_reading_id never needed this because their own raising triggers run
-- AFTER their source row's insert, not before it — this is a genuinely new
-- ordering this feature introduces.
--
-- Caught by a functional smoke test (Request -> Book -> Report -> Abnormal
-- Review -> Action, run in a rolled-back transaction) before any real data
-- was ever written through the broken path — see the test file added
-- alongside this migration.

alter table public.clinician_alerts
  drop constraint clinician_alerts_diagnostic_report_id_fkey;

alter table public.clinician_alerts
  add constraint clinician_alerts_diagnostic_report_id_fkey
  foreign key (diagnostic_report_id) references public.diagnostic_reports (id)
  on delete set null
  deferrable initially deferred;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'clinician_alerts_diagnostic_report_id_fkey'
      and condeferrable and condeferred
  ) then
    raise exception 'FAIL: clinician_alerts_diagnostic_report_id_fkey is not deferrable-initially-deferred';
  end if;
  raise notice 'PASS: diagnostic_report_id FK is now deferrable';
end $$;
