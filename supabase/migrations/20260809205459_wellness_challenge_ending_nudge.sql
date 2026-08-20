-- Wellness gamification, part 4: "your challenge ends soon" nudge.
--
-- private.evaluate_wellness_challenges() (20260730025744_wellness_challenges.sql)
-- runs daily and silently marks an unfinished challenge 'expired' the moment
-- target_end_at passes -- nothing tells the patient beforehand that they
-- still have a shot at finishing it. Same reminder-only shape as every other
-- cron nudge in this codebase (queue_screening_reminders is the closest
-- template): fires once per enrolment, only while genuinely still
-- achievable, and never itself awards points or marks completion -- that
-- stays evaluate_wellness_challenges' job alone.

alter table public.patient_challenge_enrolments
  add column if not exists reminder_sent_at timestamptz;

create or replace function private.queue_wellness_challenge_ending_nudges()
returns void
language sql
security definer
set search_path = ''
as $$
  with candidates as (
    select
      e.id,
      e.organisation_id,
      e.patient_id,
      c.title,
      c.target_count,
      private.wellness_challenge_metric_count(
        e.patient_id, c.metric, e.started_at, least(now(), e.target_end_at)
      ) as progress
    from public.patient_challenge_enrolments e
    join public.wellness_challenges c on c.id = e.challenge_id
    where e.status = 'active'
      and e.reminder_sent_at is null
      and e.target_end_at > now()
      and e.target_end_at <= now() + interval '24 hours'
  ),
  -- Skip anyone who's already hit the target -- evaluate_wellness_challenges
  -- (a separate daily cron) marks these 'completed' on its own schedule, so
  -- a nudge here would land on someone who's already finished.
  due as (
    select * from candidates where progress < target_count
  ),
  queued as (
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    select
      organisation_id, patient_id, 'whatsapp', 'pending', 'wellness_challenge_ending',
      jsonb_build_object('challenge_title', title, 'progress', progress, 'target', target_count)
    from due
    returning id
  )
  update public.patient_challenge_enrolments e
    set reminder_sent_at = now()
  from due
  where e.id = due.id;
$$;

select cron.schedule(
  'wellness-challenge-ending-nudge-daily',
  '10 8 * * *',
  $$select private.queue_wellness_challenge_ending_nudges();$$
);

do $$
begin
  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = 'queue_wellness_challenge_ending_nudges'
  ) then
    raise exception 'queue_wellness_challenge_ending_nudges was not created';
  end if;

  if not exists (
    select 1 from cron.job where jobname = 'wellness-challenge-ending-nudge-daily'
  ) then
    raise exception 'wellness-challenge-ending-nudge-daily cron job was not registered';
  end if;
end $$;
