-- Tarragon Health — Specialist Referral Engine, part 7/7: the referral
-- feedback loop (task spec §11.14).
--
-- Confirmed before writing this: 20260827203614_provider_notifications.sql
-- notifies the assigned clinician when a referral is CREATED, and
-- 20260828015618's failed_referral generator fires when one is DECLINED —
-- but nothing notifies anyone when the specialist's outcome actually comes
-- back (treatment_plan_note transcribed, or the new outcome_document_path
-- uploaded), and nothing tells the patient their referral episode is done.
-- §11.14's "Specialist recommendation should automatically return to the
-- referring clinician... Care plan updated... Monitoring schedule updated"
-- has had no automatic return path at all until now. This closes it with
-- the same two building blocks the rest of the notification system already
-- uses: an in_app notifications row (NotificationBell already renders it —
-- see provider_notifications.sql's own header for why no new UI is needed)
-- and a patient_timeline entry.

-- ---------------------------------------------------------------------------
-- 1. Outcome recorded -> notify the referring/assigned clinician
-- ---------------------------------------------------------------------------
create or replace function private.notify_clinician_referral_outcome()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clinician_id uuid;
  v_outcome_just_recorded boolean;
begin
  v_outcome_just_recorded :=
    (new.treatment_plan_received_at is not null and old.treatment_plan_received_at is null)
    or (new.outcome_document_uploaded_at is not null and old.outcome_document_uploaded_at is null);

  if not v_outcome_just_recorded then
    return new;
  end if;

  -- Prefer the clinician who created the referral, same person who asked
  -- the clinical question in the first place; fall back to whoever is
  -- currently the patient's assigned clinician for trigger-created referrals
  -- with no referred_by on file.
  if new.referred_by is not null then
    select profile_id into v_clinician_id from public.clinical_staff where id = new.referred_by;
  end if;
  if v_clinician_id is null then
    select clinician_id into v_clinician_id
    from public.care_team_assignment
    where patient_id = new.patient_id;
  end if;

  if v_clinician_id is not null then
    insert into public.notifications
      (organisation_id, recipient_id, channel, status, template, payload)
    values (
      new.organisation_id, v_clinician_id, 'in_app', 'pending', 'clinician_referral_outcome_received',
      jsonb_build_object(
        'referral_id', new.id::text,
        'patient_id', new.patient_id::text,
        'specialist_type', new.specialist_type
      )
    );
  end if;

  perform private.record_timeline_event(
    new.organisation_id, new.patient_id, 'referral_outcome_recorded',
    'specialist_referrals', new.id,
    'Specialist outcome recorded',
    coalesce('Referral ' || nullif(new.referral_number, ''), 'Referral') || ' · outcome recorded',
    now(), null,
    jsonb_build_object('referral_number', new.referral_number, 'specialist_type', new.specialist_type)
  );

  return new;
end;
$$;

drop trigger if exists specialist_referrals_notify_outcome on public.specialist_referrals;
create trigger specialist_referrals_notify_outcome
  after update on public.specialist_referrals
  for each row execute function private.notify_clinician_referral_outcome();

-- ---------------------------------------------------------------------------
-- 2. Referral closed -> tell the patient their referral episode is done
-- ---------------------------------------------------------------------------
create or replace function private.notify_patient_referral_closed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status <> 'closed' or old.status = 'closed' then
    return new;
  end if;

  insert into public.notifications
    (organisation_id, recipient_id, channel, status, template, payload)
  values (
    new.organisation_id, new.patient_id, 'in_app', 'pending', 'referral_closed',
    jsonb_build_object('referral_id', new.id::text, 'specialist_type', new.specialist_type)
  );

  return new;
end;
$$;

drop trigger if exists specialist_referrals_notify_patient_closed on public.specialist_referrals;
create trigger specialist_referrals_notify_patient_closed
  after update on public.specialist_referrals
  for each row execute function private.notify_patient_referral_closed();

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'specialist_referrals_notify_outcome'
      and tgrelid = 'public.specialist_referrals'::regclass and not tgisinternal
  ) then
    raise exception 'specialist_referrals_notify_outcome trigger missing after migration';
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgname = 'specialist_referrals_notify_patient_closed'
      and tgrelid = 'public.specialist_referrals'::regclass and not tgisinternal
  ) then
    raise exception 'specialist_referrals_notify_patient_closed trigger missing after migration';
  end if;
  raise notice 'PASS: specialist_referrals feedback-loop notification triggers present';
end $$;
