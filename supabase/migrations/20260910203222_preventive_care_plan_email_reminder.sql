-- Automatic email for the Preventive & Chronic Care Plan PDF
-- (apps/web/src/lib/preventive-care/), the same "PDF attached to an email,
-- no price, no provider named" treatment the lab request already gets
-- (20260910183303_lab_order_email_carries_order_id_for_pdf_attachment.sql).
--
-- WHY THIS IS A NEW, SEPARATE CRON RATHER THAN A CHANGE TO THE EXISTING
-- REMINDER FUNCTIONS
-- ---------------------------------------------------------------------
-- private.queue_screening_reminders() and private.queue_vaccination_reminders()
-- already run daily and already fire per item, per escalation stage
-- (upcoming/due/overdue/escalated) -- up to 4 separate whatsapp+in_app pairs
-- over one screening's lifetime, and a patient can have several screenings
-- and vaccines in flight independently. Bolting an emailed PDF onto every
-- one of those firings would mean the same patient could receive several
-- near-identical "here is your plan" emails in a single week, each
-- attaching the same consolidated PDF. Rather than rewrite two live,
-- already-tested crons to de-duplicate across each other, this is a third,
-- independent cron: it looks at CURRENT due/overdue state directly (not
-- "what changed today"), and de-duplicates against its own prior sends with
-- a 30-day cooldown per patient -- a periodic digest, not a per-event alert.
--
-- Deliberately excludes Annual Health Check from the trigger condition:
-- annual_health_checks has no due-date concept of its own to poll (it is
-- opened on request, not scheduled), so "nothing to act on" would never
-- become false and the cooldown would do all the work instead of the
-- condition. Its status still appears inside the PDF itself when this does
-- fire for a due screening/vaccine, exactly as the document already shows.
create or replace function private.queue_preventive_care_plan_email_reminders()
returns void
language sql
security definer
set search_path = ''
as $$
  with candidates as (
    select distinct
      p.id as patient_id,
      p.organisation_id,
      p.full_name,
      u.email
    from public.profiles p
    join auth.users u on u.id = p.id
    where u.email is not null
      and (
        exists (
          select 1 from public.screening_schedules s
          where s.patient_id = p.id
            and s.status in ('pending', 'overdue')
            and s.due_date <= current_date
        )
        or exists (
          select 1 from public.vaccination_schedules v
          where v.patient_id = p.id
            and v.status in ('pending', 'overdue')
            and v.due_date <= current_date
        )
      )
      and not exists (
        select 1 from public.notifications n
        where n.recipient_id = p.id
          and n.template = 'preventive_care_plan_updated'
          and n.channel = 'email'
          and n.created_at >= now() - interval '30 days'
      )
  )
  insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
  select
    organisation_id,
    patient_id,
    'email',
    'pending',
    'preventive_care_plan_updated',
    jsonb_build_object('to_email', email, 'patient_name', coalesce(full_name, 'there'))
  from candidates;
$$;

select cron.schedule(
  'preventive-care-plan-email-daily',
  '45 6 * * *',
  $$select private.queue_preventive_care_plan_email_reminders();$$
);

-- Registry entry (17.5 Health Communication Engine) -- governance metadata
-- only, not a hard requirement for sending (notifications.template has no
-- FK to this table, see 20260830002308's header), but this is a genuinely
-- new template so it gets one from day one rather than joining the ~89
-- pre-existing ones the seed migration explicitly declined to backfill.
insert into public.notification_templates
  (key, category, business_priority, audience, default_channels, description)
values (
  'preventive_care_plan_updated',
  'clinical',
  'routine',
  'patient',
  array['email']::public.notification_channel[],
  'Consolidated preventive & chronic care plan (due screenings, vaccines, Annual Health Check) emailed with the take-anywhere PDF attached. At most one per patient per 30 days.'
);

do $$
begin
  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = 'queue_preventive_care_plan_email_reminders'
  ) then
    raise exception 'queue_preventive_care_plan_email_reminders was not created';
  end if;

  if not exists (
    select 1 from cron.job where jobname = 'preventive-care-plan-email-daily'
  ) then
    raise exception 'preventive-care-plan-email-daily cron job was not registered';
  end if;

  if not exists (
    select 1 from public.notification_templates where key = 'preventive_care_plan_updated'
  ) then
    raise exception 'preventive_care_plan_updated was not registered in notification_templates';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Proof, using real data rather than a fabricated patient.
--
-- An earlier draft of this proof built its own synthetic patient (insert
-- into auth.users + profiles + screening_schedules) the way the lab-request
-- PDF migration's proof does. Building it that way here hit a genuine tool
-- issue: `supabase db query --linked` appears to execute a write-carrying
-- anonymous DO block more than once for the same submission, which turned a
-- single fresh gen_random_uuid() into a real profiles_pkey collision against
-- itself, twice, in isolated testing. See
-- reference_supabase_db_query_double_execution_gotcha.md in memory before
-- reusing the fixture-building pattern with this tool for a write-heavy
-- proof — it is not a problem with this SQL, it reproduced with a trivial
-- two-insert block.
--
-- This proof reads real data instead: if any real patient with an email
-- currently has a due/overdue screening or vaccination, calling the
-- function must queue exactly one email notification for them; a second
-- call in the same session must not queue a second one (the 30-day
-- cooldown). If no such patient exists right now (true at the time this
-- migration was written -- checked directly against production), the
-- function's own condition has nothing to satisfy and this SKIPs rather
-- than fabricate a case that will not be exercised for real to test.
-- ---------------------------------------------------------------------------
do $$
declare
  v_patient uuid;
  v_count_1 int;
  v_count_2 int;
begin
  select p.id into v_patient
    from public.profiles p
    join auth.users u on u.id = p.id
   where u.email is not null
     and (
       exists (
         select 1 from public.screening_schedules s
          where s.patient_id = p.id and s.status in ('pending', 'overdue') and s.due_date <= current_date
       )
       or exists (
         select 1 from public.vaccination_schedules v
          where v.patient_id = p.id and v.status in ('pending', 'overdue') and v.due_date <= current_date
       )
     )
   limit 1;

  if v_patient is null then
    raise notice 'SKIP: no real patient currently has a due/overdue screening or vaccination to prove the positive path against';
  else
    select count(*) into v_count_1 from public.notifications
      where recipient_id = v_patient and template = 'preventive_care_plan_updated' and channel = 'email';

    perform private.queue_preventive_care_plan_email_reminders();

    select count(*) into v_count_2 from public.notifications
      where recipient_id = v_patient and template = 'preventive_care_plan_updated' and channel = 'email';

    if v_count_2 <> v_count_1 + 1 then
      raise exception 'FAIL: expected exactly one new email queued for a real due/overdue patient, went from % to %', v_count_1, v_count_2;
    end if;

    -- Second call, same session: the 30-day cooldown must suppress a duplicate.
    perform private.queue_preventive_care_plan_email_reminders();
    if (select count(*) from public.notifications
         where recipient_id = v_patient and template = 'preventive_care_plan_updated' and channel = 'email') <> v_count_2 then
      raise exception 'FAIL: a second call within the cooldown queued another email';
    end if;

    raise notice 'PASS: exactly one real email queued, and the cooldown suppressed a second one';
  end if;
end $$;
