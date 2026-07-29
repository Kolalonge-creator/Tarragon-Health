-- Tarragon Health — Emergency escalation pathway
--
-- TarragonHealth is a doctor-led coordination platform with NO owned clinics and
-- explicitly does NOT provide emergency care (CLAUDE.md: "Tarragon should never
-- attempt emergency management"). This migration builds the founder-specified
-- pathway for when a patient reports danger symptoms:
--
--   danger symptoms -> immediate triage -> emergency advice -> go to the nearest
--   emergency department -> notify the emergency contact if the patient is not
--   responding -> follow-up after discharge
--
-- Design notes:
--  * `emergency_events` is the single owner of an emergency-tier clinician_alert.
--    Its BEFORE INSERT trigger raises the alert (level 'emergency', 2-hour SLA),
--    mirroring handle_symptom_red_flag()/handle_abnormal_screening_result() so an
--    emergency can never be silently dropped by a buggy/missing app-layer check.
--  * The existing symptom red-flag trigger is re-routed to insert an
--    emergency_events row (instead of its own direct clinician_alerts insert) so
--    a graded symptom that crosses the emergency threshold gets the same
--    patient-facing acknowledge-gated pathway — with no double alert.
--  * Auto-notify is acknowledge-gated: a pg_cron job messages the patient's
--    emergency contact only if the event is still un-acknowledged ~10 minutes
--    after it was raised. Acknowledging ("I'm getting help") suppresses it.
--  * WhatsApp/SMS here is a one-way alert layer only (CLAUDE.md non-negotiable
--    rule) — never a data-entry channel.

-- ---------------------------------------------------------------------------
-- 1. Emergency contact / next-of-kin on profiles
-- ---------------------------------------------------------------------------
-- Additive, nullable columns (same discipline as profiles.state/city/area). The
-- auto-notify simply cannot fire without a saved emergency_contact_phone; no
-- value is ever inferred. Existing profiles RLS (patient reads/updates own row)
-- covers these — no new policy.
alter table public.profiles
  add column if not exists emergency_contact_name         text,
  add column if not exists emergency_contact_phone        text,
  add column if not exists emergency_contact_relationship text,
  add column if not exists next_of_kin_name               text,
  add column if not exists next_of_kin_phone              text,
  -- The patient must confirm their emergency contact has agreed to be contacted
  -- by TarragonHealth in an emergency. We only ever message a contact with this
  -- consent on record (enforced in notify_unacknowledged_emergencies + the
  -- alert-now action); consent_at stamps when it was given.
  add column if not exists emergency_contact_consent      boolean not null default false,
  add column if not exists emergency_contact_consent_at   timestamptz;

do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_emergency_contact_phone_e164'
  ) then
    alter table public.profiles
      add constraint profiles_emergency_contact_phone_e164
      check (emergency_contact_phone is null or emergency_contact_phone ~ '^\+[1-9][0-9]{7,14}$');
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_next_of_kin_phone_e164'
  ) then
    alter table public.profiles
      add constraint profiles_next_of_kin_phone_e164
      check (next_of_kin_phone is null or next_of_kin_phone ~ '^\+[1-9][0-9]{7,14}$');
  end if;
end $$;

comment on column public.profiles.emergency_contact_phone is 'E.164 phone messaged automatically if the patient does not acknowledge an active emergency event. Nullable — no auto-notify without it.';

-- ---------------------------------------------------------------------------
-- 2. Enums
-- ---------------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_type where typname = 'emergency_source') then
    create type public.emergency_source as enum (
      'danger_symptom_checklist', 'symptom_log', 'ai_coach'
    );
  end if;
  if not exists (select 1 from pg_type where typname = 'emergency_event_status') then
    create type public.emergency_event_status as enum (
      'active', 'acknowledged', 'resolved'
    );
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. emergency_events (patient-authored, org-scoped, RLS-gated)
-- ---------------------------------------------------------------------------
create table if not exists public.emergency_events (
  id                  uuid primary key default gen_random_uuid(),
  organisation_id     uuid not null references public.organisations (id) on delete restrict,
  patient_id          uuid not null references public.profiles (id) on delete cascade,
  source              public.emergency_source not null,
  trigger_detail      text,
  status              public.emergency_event_status not null default 'active',
  -- Patient pressed "I'm getting help" — cancels the auto-notify.
  acknowledged_at     timestamptz,
  acknowledged_by     uuid references public.profiles (id) on delete set null,
  -- Set once the emergency contact has actually been messaged (auto or manual).
  contact_notified_at timestamptz,
  -- The emergency-tier alert this event raised (set by the BEFORE INSERT trigger).
  clinician_alert_id  uuid references public.clinician_alerts (id) on delete set null,
  -- Follow-up-after-discharge check-in.
  follow_up_due_at    timestamptz not null default (now() + interval '2 days'),
  follow_up_notified_at timestamptz,
  followed_up_at      timestamptz,
  followed_up_by      uuid references public.clinical_staff (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists emergency_events_patient_idx
  on public.emergency_events (patient_id, created_at desc);
create index if not exists emergency_events_org_idx
  on public.emergency_events (organisation_id);
-- Drives the every-5-min auto-notify scan and the patient-facing active alert.
create index if not exists emergency_events_active_idx
  on public.emergency_events (created_at)
  where status = 'active' and acknowledged_at is null and contact_notified_at is null;

drop trigger if exists emergency_events_set_updated_at on public.emergency_events;
create trigger emergency_events_set_updated_at
  before update on public.emergency_events
  for each row execute function private.set_updated_at();

alter table public.emergency_events enable row level security;

-- Patient manages their own events (report + acknowledge); org clinical staff
-- read all and resolve / record follow-up. Idempotent drop-then-create.
drop policy if exists emergency_events_select on public.emergency_events;
create policy emergency_events_select on public.emergency_events
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));
drop policy if exists emergency_events_insert on public.emergency_events;
create policy emergency_events_insert on public.emergency_events
  for insert to authenticated
  with check (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));
drop policy if exists emergency_events_update on public.emergency_events;
create policy emergency_events_update on public.emergency_events
  for update to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id))
  with check (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

grant select, insert, update, delete on public.emergency_events to authenticated;

-- ---------------------------------------------------------------------------
-- 4. BEFORE INSERT: raise the emergency clinician_alert + audit
-- ---------------------------------------------------------------------------
-- Raises the emergency-tier alert for an event. Runs SECURITY DEFINER so the
-- alert is written even for a patient-initiated row (clinician_alerts is
-- staff-write), exactly like handle_symptom_red_flag()/
-- handle_abnormal_screening_result(). If the caller already supplied a
-- clinician_alert_id (the AI-Coach path, which raises its own emergency alert +
-- escalations row via logAiCoachEscalation), the event reuses it instead of
-- raising a duplicate alert — so emergency_events is the single patient-facing
-- record without double-alerting the care team.
create or replace function private.handle_emergency_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_alert_id uuid;
  v_c_name  text;
  v_c_rel   text;
  v_c_phone text;
  v_contact_line text := '';
begin
  -- Surface WHO the patient's emergency contact is (and their relationship) to
  -- the care team, so a doctor reviewing the Priority-1 alert knows who to
  -- expect / who was messaged. Read here (SECURITY DEFINER) from the patient's
  -- profile; omitted cleanly if no contact is on file.
  select emergency_contact_name, emergency_contact_relationship, emergency_contact_phone
    into v_c_name, v_c_rel, v_c_phone
  from public.profiles where id = new.patient_id;
  if v_c_phone is not null then
    v_contact_line := format(' Emergency contact: %s%s — %s.',
      coalesce(v_c_name, 'on file'),
      case when v_c_rel is not null then ' (' || v_c_rel || ')' else '' end,
      v_c_phone);
  end if;

  if new.clinician_alert_id is null then
    insert into public.clinician_alerts
      (organisation_id, patient_id, level, status, title, detail, sla_due_at, escalation_level)
    values (
      new.organisation_id,
      new.patient_id,
      'emergency',
      'open',
      'Priority 1: emergency reported',
      format('Emergency event (source: %s).%s%s',
             new.source,
             case when new.trigger_detail is not null then ' ' || new.trigger_detail else '' end,
             v_contact_line),
      now() + interval '2 hours',
      4
    )
    returning id into v_alert_id;

    -- id is already populated (column default fires before BEFORE triggers).
    new.clinician_alert_id := v_alert_id;
  end if;

  insert into public.audit_log
    (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (
    new.organisation_id,
    new.patient_id,
    'emergency_event.created',
    'emergency_events',
    new.id,
    jsonb_build_object('source', new.source, 'clinician_alert_id', new.clinician_alert_id)
  );

  return new;
end;
$$;

drop trigger if exists emergency_events_raise_alert on public.emergency_events;
create trigger emergency_events_raise_alert
  before insert on public.emergency_events
  for each row execute function private.handle_emergency_event();

-- ---------------------------------------------------------------------------
-- 5. BEFORE UPDATE guard: a patient session may only acknowledge
-- ---------------------------------------------------------------------------
-- A patient (RLS session) can flip their own event to 'acknowledged' but must
-- not be able to spoof staff-owned fields (followed_up_*, contact_notified_at,
-- clinician_alert_id, follow_up timing). Service-role (auth.uid() null) and org
-- staff bypass the guard — mirrors private.enforce_medication_confirm_only.
create or replace function private.enforce_emergency_event_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is not null
     and not private.is_org_staff(new.organisation_id) then
    -- Patient session: preserve every staff/system-owned field.
    new.clinician_alert_id    := old.clinician_alert_id;
    new.contact_notified_at   := old.contact_notified_at;
    new.follow_up_due_at      := old.follow_up_due_at;
    new.follow_up_notified_at := old.follow_up_notified_at;
    new.followed_up_at        := old.followed_up_at;
    new.followed_up_by        := old.followed_up_by;
    new.source                := old.source;
    new.organisation_id       := old.organisation_id;
    new.patient_id            := old.patient_id;
    -- Acknowledging stamps the actor as the patient themselves.
    if new.acknowledged_at is not null and old.acknowledged_at is null then
      new.acknowledged_by := (select auth.uid());
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists emergency_events_update_guard on public.emergency_events;
create trigger emergency_events_update_guard
  before update on public.emergency_events
  for each row execute function private.enforce_emergency_event_update();

-- ---------------------------------------------------------------------------
-- 6. Re-route symptom red-flags through emergency_events
-- ---------------------------------------------------------------------------
-- The emergency tier now inserts an emergency_events row (which raises the
-- clinician_alert via the trigger above) instead of a direct clinician_alerts
-- insert — so a graded symptom that crosses the emergency threshold gets the
-- same patient-facing acknowledge-gated pathway, with no double alert. The
-- lower severity>=5 clinician_review branch is unchanged (not an emergency).
create or replace function private.handle_symptom_red_flag()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_low_threshold_types public.symptom_type[] := array['breathlessness', 'palpitations', 'swelling'];
  v_is_red_flag boolean;
begin
  v_is_red_flag := (
    new.severity >= 8
    or (new.symptom_type = any (v_low_threshold_types) and new.severity >= 6)
  );
  new.is_red_flag := v_is_red_flag;

  if v_is_red_flag then
    insert into public.emergency_events
      (organisation_id, patient_id, source, trigger_detail, status)
    values (
      new.organisation_id,
      new.patient_id,
      'symptom_log',
      format('Patient reported %s at severity %s/10.%s',
             new.symptom_type, new.severity,
             case when new.description is not null then ' Note: ' || new.description else '' end),
      'active'
    );
  elsif new.severity >= 5 then
    insert into public.clinician_alerts
      (organisation_id, patient_id, level, status, title, detail)
    values (
      new.organisation_id,
      new.patient_id,
      'clinician_review',
      'open',
      format('Symptom check: %s', new.symptom_type),
      format('Patient reported %s at severity %s/10.%s',
             new.symptom_type, new.severity,
             case when new.description is not null then ' Note: ' || new.description else '' end)
    );
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Acknowledge-gated auto-notify of the emergency contact
-- ---------------------------------------------------------------------------
-- Runs every 5 min. Messages the emergency contact ONLY when the event is still
-- active + un-acknowledged ~10 min after it was raised and the patient has a
-- saved contact phone. Stamps contact_notified_at so it fires exactly once. A
-- patient acknowledging in-window suppresses it entirely.
create or replace function private.notify_unacknowledged_emergencies()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event   public.emergency_events%rowtype;
  v_patient public.profiles%rowtype;
begin
  for v_event in
    select * from public.emergency_events e
    where e.status = 'active'
      and e.acknowledged_at is null
      and e.contact_notified_at is null
      and e.created_at < now() - interval '10 minutes'
      and e.created_at > now() - interval '1 day'
  loop
    select * into v_patient from public.profiles where id = v_event.patient_id;
    -- Only ever message a contact the patient confirmed has agreed to be
    -- contacted (emergency_contact_consent) — never without recorded consent.
    if v_patient.emergency_contact_phone is not null and v_patient.emergency_contact_consent then
      -- SMS (reliable) + WhatsApp (dispatcher falls back to SMS if unapproved).
      insert into public.notifications
        (organisation_id, recipient_id, channel, status, template, payload)
      values
        (v_event.organisation_id, v_event.patient_id, 'sms', 'pending',
         'emergency_contact_alert',
         jsonb_build_object(
           'to_phone', v_patient.emergency_contact_phone,
           'contact_name', coalesce(v_patient.emergency_contact_name, 'there'),
           'contact_relationship', v_patient.emergency_contact_relationship,
           'patient_name', coalesce(v_patient.full_name, 'someone who lists you as their emergency contact'))),
        (v_event.organisation_id, v_event.patient_id, 'whatsapp', 'pending',
         'emergency_contact_alert',
         jsonb_build_object(
           'to_phone', v_patient.emergency_contact_phone,
           'contact_name', coalesce(v_patient.emergency_contact_name, 'there'),
           'patient_name', coalesce(v_patient.full_name, 'someone who lists you as their emergency contact')));

      update public.emergency_events
        set contact_notified_at = now()
        where id = v_event.id;
    end if;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Follow-up-after-discharge check-in
-- ---------------------------------------------------------------------------
-- Runs daily. Nudges the patient to tell their care team how they are once the
-- follow-up window has passed. Fires once per event (follow_up_notified_at).
create or replace function private.notify_emergency_followups()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event   public.emergency_events%rowtype;
  v_patient public.profiles%rowtype;
begin
  for v_event in
    select * from public.emergency_events e
    where e.follow_up_notified_at is null
      and e.followed_up_at is null
      and e.follow_up_due_at < now()
      and e.status <> 'resolved'
  loop
    select * into v_patient from public.profiles where id = v_event.patient_id;
    insert into public.notifications
      (organisation_id, recipient_id, channel, status, template, payload)
    values (
      v_event.organisation_id, v_event.patient_id, 'whatsapp', 'pending',
      'emergency_followup',
      jsonb_build_object('patient_name', coalesce(v_patient.full_name, 'there'))
    );
    update public.emergency_events
      set follow_up_notified_at = now()
      where id = v_event.id;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. Schedule the cron jobs (pattern: 20260706091332_schedule_notification_sender)
-- ---------------------------------------------------------------------------
-- Unschedule-then-schedule so a re-apply doesn't error on a duplicate jobname.
do $$ begin
  if exists (select 1 from cron.job where jobname = 'emergency-contact-notify') then
    perform cron.unschedule('emergency-contact-notify');
  end if;
  if exists (select 1 from cron.job where jobname = 'emergency-followup-daily') then
    perform cron.unschedule('emergency-followup-daily');
  end if;
end $$;

select cron.schedule(
  'emergency-contact-notify',
  '*/5 * * * *',
  $$ select private.notify_unacknowledged_emergencies(); $$
);

select cron.schedule(
  'emergency-followup-daily',
  '0 8 * * *',
  $$ select private.notify_emergency_followups(); $$
);
