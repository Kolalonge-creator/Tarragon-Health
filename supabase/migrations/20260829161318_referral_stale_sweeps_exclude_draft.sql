-- Tarragon Health — the three live staleness sweeps
-- (private.remind_patients_stale_referrals / raise_stale_referral_outreach_tasks
-- / raise_stale_urgent_referral_alerts, 20260828232027) filter on
-- `status not in ('closed', 'declined')` and measure age from created_at.
-- The 'draft' status added in this series (20260829160521) sits outside
-- that exclusion — a referral a clinician leaves unsubmitted for 14+ days
-- would otherwise get a patient-facing "see your specialist" reminder for
-- an episode the patient doesn't even know exists yet (drafts are excluded
-- from every patient-facing view). CREATE OR REPLACE, same three function
-- bodies with `and sr.status <> 'draft'` added to each filter — no other
-- behaviour changes.

create or replace function private.remind_patients_stale_referrals()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.notifications (organisation_id, recipient_id, channel, template, payload)
  select
    sr.organisation_id, sr.patient_id, 'in_app', 'referral_reminder',
    jsonb_build_object('referral_id', sr.id::text, 'specialist_type', sr.specialist_type)
  from public.specialist_referrals sr
  where sr.status not in ('closed', 'declined', 'draft')
    and sr.treatment_plan_received_at is null
    and sr.outcome_document_path is null
    and sr.created_at < now() - interval '14 days'
    and not exists (
      select 1 from public.notifications n
      where n.recipient_id = sr.patient_id
        and n.template = 'referral_reminder'
        and n.payload ->> 'referral_id' = sr.id::text
        and n.created_at > now() - interval '13 days'
    );
end;
$$;

create or replace function private.raise_stale_referral_outreach_tasks()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.care_outreach_tasks (organisation_id, patient_id, trigger_type, trigger_detail, priority)
  select
    sr.organisation_id, sr.patient_id, 'referral_follow_up',
    jsonb_build_object(
      'referral_id', sr.id::text,
      'specialist_type', sr.specialist_type,
      'referral_number', sr.referral_number,
      'created_at', sr.created_at
    ),
    case when sr.urgency in ('urgent', 'priority') then 1 else 2 end
  from public.specialist_referrals sr
  where sr.status not in ('closed', 'declined', 'draft')
    and sr.treatment_plan_received_at is null
    and sr.outcome_document_path is null
    and sr.created_at < now() - interval '30 days'
  on conflict (patient_id, trigger_type) where status in ('open', 'in_progress', 'contacted') do nothing;
end;
$$;

create or replace function private.raise_stale_urgent_referral_alerts()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.raise_clinician_alert(
    sr.organisation_id, sr.patient_id,
    case when sr.urgency = 'urgent' then 'urgent_escalation' else 'clinician_review' end,
    'Referral needs follow-up',
    format('A %s referral (%s) has had no specialist outcome recorded since %s.',
      sr.urgency, sr.specialist_type, to_char(sr.created_at, 'YYYY-MM-DD')),
    'care_management', 'failed_referral'
  )
  from public.specialist_referrals sr
  where sr.status not in ('closed', 'declined', 'draft')
    and sr.urgency in ('urgent', 'priority')
    and sr.treatment_plan_received_at is null
    and sr.outcome_document_path is null
    and sr.created_at < now() - interval '7 days'
    and not exists (
      select 1 from public.clinician_alerts ca
      where ca.type_code = 'failed_referral' and ca.patient_id = sr.patient_id
        and ca.status in ('open', 'acknowledged') and ca.created_at > now() - interval '20 hours'
    );
end;
$$;

revoke all on function private.remind_patients_stale_referrals() from public, anon;
revoke all on function private.raise_stale_referral_outreach_tasks() from public, anon;
revoke all on function private.raise_stale_urgent_referral_alerts() from public, anon;

do $$
begin
  if pg_get_functiondef('private.remind_patients_stale_referrals()'::regprocedure) not like '%draft%' then
    raise exception 'remind_patients_stale_referrals still does not exclude draft';
  end if;
  if pg_get_functiondef('private.raise_stale_referral_outreach_tasks()'::regprocedure) not like '%draft%' then
    raise exception 'raise_stale_referral_outreach_tasks still does not exclude draft';
  end if;
  if pg_get_functiondef('private.raise_stale_urgent_referral_alerts()'::regprocedure) not like '%draft%' then
    raise exception 'raise_stale_urgent_referral_alerts still does not exclude draft';
  end if;
  raise notice 'PASS: all three referral staleness sweeps now exclude draft';
end $$;
