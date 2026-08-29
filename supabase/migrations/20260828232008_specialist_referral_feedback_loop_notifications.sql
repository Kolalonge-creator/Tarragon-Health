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
