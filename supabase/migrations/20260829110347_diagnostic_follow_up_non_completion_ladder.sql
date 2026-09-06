-- Tarragon Health — Diagnostic Safety Pathway, part 5/6: patient
-- non-completion escalation (60.11).
--
-- "Follow-up due -> Reminder -> Missed -> Second attempt -> Care
-- coordinator -> Clinical escalation where appropriate." Confirmed by audit
-- before writing this: nothing in the platform today escalates on PATIENT
-- inaction — every existing overdue mechanism (the alert ack-timeout
-- ladder, escalation_slas breach sweep, the six new alert generators)
-- escalates on a CLINICIAN or SYSTEM failing to act. This is the genuinely
-- new piece.
--
-- Deliberately reuses rather than duplicates: rung 3 (care coordinator)
-- raises a public.care_outreach_tasks row with the EXISTING
-- 'unactioned_abnormal' trigger_type (20260723010019_care_outreach_engine.sql)
-- rather than inventing a second coordinator worklist, and respects that
-- table's own one-live-task-per-(patient,trigger_type) unique index. Rung 4
-- (clinical escalation) reuses private.raise_clinician_alert() (the shared
-- helper from 20260828015618) with type_code='abnormal_result' — the same
-- type_code the original result used — rather than adding a new
-- alert_type_code: by the time this rung can fire (17+ days after a
-- follow-up came due), the original alert has long since been
-- resolved/closed, so the 24h dedup window in
-- private.classify_and_assign_clinician_alert() never treats this as a
-- duplicate of it.
--
-- "Overdue" is computed uniformly across both follow-up tracks a
-- diagnostic_episode can carry: a pending/patient_notified repeat-test
-- recall past its due_date, or a referral whose appointment_date has passed
-- without the referral reaching completed/declined (declined is already
-- covered by the existing failed_referral generator — a different failure
-- mode, provider-side, not patient non-attendance).

create table public.diagnostic_follow_up_escalations (
  id                      uuid primary key default gen_random_uuid(),
  diagnostic_episode_id   uuid not null references public.diagnostic_episodes (id) on delete cascade,
  hop                     smallint not null check (hop between 1 and 4),
  created_at              timestamptz not null default now(),
  unique (diagnostic_episode_id, hop)
);

comment on table public.diagnostic_follow_up_escalations is
  'Dedup + audit trail for private.escalate_diagnostic_follow_up_non_completion(): one row per diagnostic_episodes row per rung of the patient non-completion ladder it has climbed. hop 1 = first reminder, hop 2 = second attempt, hop 3 = care-coordinator outreach task raised, hop 4 = clinical escalation raised.';

alter table public.diagnostic_follow_up_escalations enable row level security;

create policy diagnostic_follow_up_escalations_select on public.diagnostic_follow_up_escalations
  for select to authenticated
  using (
    exists (
      select 1 from public.diagnostic_episodes de
      where de.id = diagnostic_episode_id and private.is_org_staff(de.organisation_id)
    )
  );

grant select on public.diagnostic_follow_up_escalations to authenticated;

create or replace function private.diagnostic_episode_overdue_since(p_episode public.diagnostic_episodes)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select min(d) from (
    select r.due_date as d
    from public.diagnostic_repeat_test_recalls r
    where r.diagnostic_episode_id = p_episode.id
      and r.status in ('pending', 'patient_notified')
      and r.due_date < current_date

    union all

    select sr.appointment_date::date as d
    from public.specialist_referrals sr
    where sr.id = p_episode.referral_id
      and sr.appointment_date is not null
      and sr.appointment_date < now()
      and sr.status not in ('completed', 'declined')
  ) overdue_dates;
$$;

comment on function private.diagnostic_episode_overdue_since(public.diagnostic_episodes) is
  '60.11: earliest date a required follow-up action (pending repeat-test recall, or a referral appointment that passed without the referral completing) went overdue for this episode, or null if nothing is overdue. Referral non-attendance only — a referral the provider declined already raises the existing failed_referral alert, a different (provider-side) failure this function does not also flag.';

revoke all on function private.diagnostic_episode_overdue_since(public.diagnostic_episodes) from public, anon;

create or replace function private.escalate_diagnostic_follow_up_non_completion()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.diagnostic_episodes;
  v_since date;
  v_days_overdue integer;
  v_message text;
begin
  for r in
    select de.*
    from public.diagnostic_episodes de
    where de.status = 'open'
      and (de.requires_referral or de.requires_repeat_test)
  loop
    v_since := private.diagnostic_episode_overdue_since(r);
    if v_since is null then
      continue;
    end if;

    v_days_overdue := current_date - v_since;
    v_message := format('Follow-up for a diagnostic episode (opened %s) is %s day(s) overdue.', r.opened_at::date, v_days_overdue);

    -- Hop 1: first patient reminder.
    if v_days_overdue >= 0
       and not exists (select 1 from public.diagnostic_follow_up_escalations where diagnostic_episode_id = r.id and hop = 1)
    then
      insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
      values (r.organisation_id, r.patient_id, 'whatsapp', 'pending', 'diagnostic_follow_up_reminder',
        jsonb_build_object('diagnostic_episode_id', r.id));
      insert into public.diagnostic_follow_up_escalations (diagnostic_episode_id, hop) values (r.id, 1);
      update public.diagnostic_episodes
        set follow_up_reminder_count = follow_up_reminder_count + 1, follow_up_last_reminded_at = now()
        where id = r.id;
    end if;

    -- Hop 2: second attempt, 5 days later.
    if v_days_overdue >= 5
       and not exists (select 1 from public.diagnostic_follow_up_escalations where diagnostic_episode_id = r.id and hop = 2)
    then
      insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
      values (r.organisation_id, r.patient_id, 'whatsapp', 'pending', 'diagnostic_follow_up_second_reminder',
        jsonb_build_object('diagnostic_episode_id', r.id));
      insert into public.diagnostic_follow_up_escalations (diagnostic_episode_id, hop) values (r.id, 2);
      update public.diagnostic_episodes
        set follow_up_reminder_count = follow_up_reminder_count + 1, follow_up_last_reminded_at = now()
        where id = r.id;
    end if;

    -- Hop 3: care coordinator, 10 days.
    if v_days_overdue >= 10
       and not exists (select 1 from public.diagnostic_follow_up_escalations where diagnostic_episode_id = r.id and hop = 3)
    then
      insert into public.care_outreach_tasks (organisation_id, patient_id, trigger_type, trigger_detail, priority)
      values (r.organisation_id, r.patient_id, 'unactioned_abnormal',
        jsonb_build_object('diagnostic_episode_id', r.id, 'days_overdue', v_days_overdue), 1)
      on conflict (patient_id, trigger_type) where status in ('open', 'in_progress', 'contacted') do nothing;
      insert into public.diagnostic_follow_up_escalations (diagnostic_episode_id, hop) values (r.id, 3);
      update public.diagnostic_episodes set follow_up_coordinator_escalated_at = now() where id = r.id;
    end if;

    -- Hop 4: clinical escalation, 17 days.
    if v_days_overdue >= 17
       and not exists (select 1 from public.diagnostic_follow_up_escalations where diagnostic_episode_id = r.id and hop = 4)
    then
      perform private.raise_clinician_alert(
        r.organisation_id, r.patient_id, 'urgent_escalation',
        'Diagnostic follow-up not completed',
        v_message, 'clinical', 'abnormal_result'
      );
      insert into public.diagnostic_follow_up_escalations (diagnostic_episode_id, hop) values (r.id, 4);
      update public.diagnostic_episodes set follow_up_clinically_escalated_at = now() where id = r.id;
    end if;
  end loop;
end;
$$;

comment on function private.escalate_diagnostic_follow_up_non_completion() is
  '60.11 sweep: an open diagnostic_episode with an overdue required follow-up action climbs a 4-rung ladder — patient reminder at day 0, second attempt at day 5, care-coordinator outreach task at day 10 (reuses care_outreach_tasks'' existing unactioned_abnormal trigger_type), clinical escalation at day 17 (reuses private.raise_clinician_alert with type_code=abnormal_result). Each rung fires at most once per episode (diagnostic_follow_up_escalations).';

revoke all on function private.escalate_diagnostic_follow_up_non_completion() from public, anon;

select cron.schedule(
  'diagnostic-follow-up-non-completion-escalation',
  '20 4 * * *',
  $$select private.escalate_diagnostic_follow_up_non_completion()$$
);

do $$
begin
  if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'diagnostic_follow_up_escalations') then
    raise exception 'diagnostic_follow_up_escalations was not created';
  end if;
  if not exists (select 1 from cron.job where jobname = 'diagnostic-follow-up-non-completion-escalation') then
    raise exception 'diagnostic-follow-up-non-completion-escalation cron job was not scheduled';
  end if;
  if has_function_privilege('anon', 'private.escalate_diagnostic_follow_up_non_completion()', 'EXECUTE') then
    raise exception 'FAIL: anon can execute private.escalate_diagnostic_follow_up_non_completion';
  end if;
  raise notice 'PASS: patient non-completion escalation ladder table + function + cron job all present, anon denied';
end $$;
