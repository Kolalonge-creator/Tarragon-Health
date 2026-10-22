-- S62 follow-up proof: the two pathway sweeps are scheduled (migration *_s62_schedule_pathway_sweeps.sql).
--
-- Proves in one rolled-back transaction:
--   1. Both cron jobs exist, run daily, and call the right function (so a rename or a copy-paste of the wrong function is caught).
--   2. Run the way pg_cron runs them (as the database owner, no signed-in user) both sweeps succeed and, with no enrolled real patient,
--      do nothing: they return 0 and add no milestone.
--   3. They are still refused to an ordinary signed-in user (the schedule did not loosen the service-role gate).
--   4. SABOTAGE: with a job unscheduled, the matching check flips.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create function pg_temp.rec(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('real', p_name, p_expected, p_actual) $$;
create function pg_temp.try(p_sql text) returns text language plpgsql as
$f$ begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $f$;

do $$
declare
  v_before integer := (select count(*) from public.pathway_milestones);
  v_reviews integer;
  v_tests integer;
begin
  perform pg_temp.rec('review job scheduled daily', '8 6 * * *', (select schedule from cron.job where jobname = 'pathway-review-sweep-daily'));
  perform pg_temp.rec('tests job scheduled daily', '18 6 * * *', (select schedule from cron.job where jobname = 'pathway-scheduled-tests-sweep-daily'));
  perform pg_temp.rec('review job calls the review sweep', 'true',
    coalesce((select (command like '%public.sweep_pathway_reviews()%')::text from cron.job where jobname = 'pathway-review-sweep-daily'), 'missing'));
  perform pg_temp.rec('tests job calls the scheduled-tests sweep', 'true',
    coalesce((select (command like '%public.sweep_pathway_scheduled_tests()%')::text from cron.job where jobname = 'pathway-scheduled-tests-sweep-daily'), 'missing'));

  -- As pg_cron runs them: owner, no signed-in user.
  select public.sweep_pathway_reviews() into v_reviews;
  select public.sweep_pathway_scheduled_tests() into v_tests;
  perform pg_temp.rec('review sweep runs as the job owner and finds nothing', '0', v_reviews::text);
  perform pg_temp.rec('tests sweep runs as the job owner and finds nothing', '0', v_tests::text);
  perform pg_temp.rec('the sweeps added no milestone', '0', ((select count(*) from public.pathway_milestones) - v_before)::text);
end $$;

-- A signed-in user is still refused.
do $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', (gen_random_uuid())::text, true);
end $$;
set local role authenticated;
select pg_temp.rec('a signed-in user cannot run the review sweep', '42501', pg_temp.try('select public.sweep_pathway_reviews()'));
select pg_temp.rec('a signed-in user cannot run the tests sweep', '42501', pg_temp.try('select public.sweep_pathway_scheduled_tests()'));
reset role;

-- SABOTAGE: unschedule each job; the matching check must flip.
select cron.unschedule('pathway-review-sweep-daily');
select cron.unschedule('pathway-scheduled-tests-sweep-daily');
insert into results values
  ('sabotaged', 'review job scheduled daily', '8 6 * * *', (select schedule from cron.job where jobname = 'pathway-review-sweep-daily')),
  ('sabotaged', 'tests job scheduled daily', '18 6 * * *', (select schedule from cron.job where jobname = 'pathway-scheduled-tests-sweep-daily'));

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S62 sweeps proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected is distinct from actual;
  if v_caught < 2 then
    raise exception 'VACUOUS TEST: only % of 2 sabotage steps changed the matching check', v_caught;
  end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;

rollback;
