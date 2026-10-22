-- S62 follow-up: schedule the two pathway sweeps (13.16, 13.18).
--
-- sweep_pathway_reviews() adds the monthly or quarterly clinician review milestone and task; sweep_pathway_scheduled_tests() adds the
-- eye, foot and kidney due dates for diabetes. Both were built in 20261007190627_s61_s62_pathway_engine.sql and deliberately left
-- unscheduled ("decide the schedule with the other sweeps", OQ "S61/S62 scheduling"). This migration only schedules them.
--
-- Why this is safe to switch on now:
--   * Both only touch enrolments with status 'enrolled'. A real patient cannot be enrolled in a pathway while its guard (pathway_<code>)
--     is off (chronic_programme_enrolments_pathway_guard), and all ten guards are off, so today both sweeps find nothing and return 0.
--   * sweep_pathway_reviews also re-checks private.go_live_open_patient for each enrolment, so switching a guard off again stops it.
--   * Both are idempotent: a milestone is unique on (enrolment, cycle, code) and the review task has a dedup key, so a repeated or
--     overlapping run adds nothing.
--   * A paused enrolment is skipped. Pausing never stops grading or paging of a reading; it only stops these scheduled items.
--
-- Cadence: once a day. The review cadence is measured in days (weekly automated, monthly or quarterly clinician review) and the
-- scheduled-test intervals in days, so a daily run is the finest grain either needs. Times are UTC and sit beside the other daily
-- morning sweeps (06:xx UTC is 07:xx in Lagos). A failed run raises, so cron.job_run_details shows it and record-cron-failures sees it.
--
-- The functions refuse any caller but the service role; pg_cron runs them as the database owner, where auth.uid() is null and
-- auth.role() is empty, which their guard (service_role, or no signed-in user) accepts.

select cron.schedule('pathway-review-sweep-daily', '8 6 * * *', $$ select public.sweep_pathway_reviews(); $$);
select cron.schedule('pathway-scheduled-tests-sweep-daily', '18 6 * * *', $$ select public.sweep_pathway_scheduled_tests(); $$);

do $$
begin
  if (select count(*) from cron.job where jobname in ('pathway-review-sweep-daily', 'pathway-scheduled-tests-sweep-daily')) <> 2 then
    raise exception 'S62 sweeps: a pathway sweep job is missing';
  end if;
  -- Nothing is switched on by scheduling: every pathway guard is still whatever it was.
  if exists (select 1 from public.go_live_guards where key like 'pathway\_%' escape '\' and is_on) then
    raise notice 'S62 sweeps: a pathway guard is on; the sweeps will now act on its enrolments';
  end if;
end $$;
