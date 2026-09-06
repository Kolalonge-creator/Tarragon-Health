-- Fix-up for 20260828231600_diagnostic_reports_and_abnormal_result_hook:
-- clinician_alerts.diagnostic_report_id must be DEFERRABLE INITIALLY
-- DEFERRED — private.handle_diagnostic_report_insert() inserts the
-- clinician_alerts row referencing NEW.id from inside diagnostic_reports'
-- own BEFORE INSERT trigger, before that row exists in the table. Caught by
-- a functional smoke test before any real data was written. See the
-- corrected column comment in the source migration file for the full
-- reasoning; this migration only fixes what's already live.

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
