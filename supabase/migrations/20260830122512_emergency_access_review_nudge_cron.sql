-- Nudges the patient's home-org clinical director when a break-glass emergency-access grant
-- is approaching or past its own expiry and still sitting unreviewed -- the "nobody noticed"
-- gap. Modeled directly on private.escalate_overdue_clinician_alerts(): a dedup table keyed
-- (grant_id, notified_on) so a grant nudges at most once per calendar day, an in_app
-- notification to every active clinical director at the patient's home org, and an audit_log
-- row. Nothing security-relevant depends on this running -- a grant still stops granting
-- access at its own expires_at regardless -- this only makes an unreviewed grant visible
-- before it quietly ages out.

create table public.emergency_record_access_nudges (
  id        uuid primary key default gen_random_uuid(),
  grant_id  uuid not null references public.emergency_record_access_grants (id) on delete cascade,
  notified_on date not null default current_date,
  created_at timestamptz not null default now(),
  unique (grant_id, notified_on)
);

alter table public.emergency_record_access_nudges enable row level security;
-- No authenticated policy at all: this is purely an internal dedup ledger for the cron
-- function below, the same shape as clinician_alert_sla_breach_notifications.

create or replace function private.notify_unapproved_emergency_access_grants()
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  r record;
  v_director record;
  v_message text;
  v_minutes_to_expiry numeric;
begin
  for r in
    select g.id, g.patient_id, g.patient_org_id, g.requester_id, g.reason, g.expires_at,
           p.full_name as patient_name, req.full_name as requester_name
    from public.emergency_record_access_grants g
    join public.profiles p on p.id = g.patient_id
    join public.profiles req on req.id = g.requester_id
    where g.review_status = 'pending_review'
      and g.ended_at is null
      -- Nudge once the grant is within an hour of expiring, or already has -- not the moment
      -- it's created; a reviewer shouldn't be paged for something that just happened seconds ago.
      and g.expires_at < now() + interval '1 hour'
  loop
    insert into public.emergency_record_access_nudges (grant_id)
    values (r.id)
    on conflict (grant_id, notified_on) do nothing;

    if not found then
      continue;
    end if;

    v_minutes_to_expiry := extract(epoch from (r.expires_at - now())) / 60;
    v_message := format(
      '%s requested emergency access to %s''s record (%s) and it still needs your review — %s.',
      coalesce(r.requester_name, 'A clinician'), coalesce(r.patient_name, 'a patient'), r.reason,
      case when v_minutes_to_expiry > 0
        then format('expires in %s minutes', round(v_minutes_to_expiry))
        else 'already expired'
      end
    );

    for v_director in
      select cs.profile_id
      from public.clinical_staff cs
      where cs.organisation_id = r.patient_org_id
        and cs.is_clinical_director
        and cs.active
        and cs.profile_id is not null
    loop
      insert into public.notifications (recipient_id, organisation_id, channel, template, payload, status, content_class)
      values (v_director.profile_id, r.patient_org_id, 'in_app', 'emergency_access_review_due',
        jsonb_build_object('message', v_message, 'grant_id', r.id, 'patient_id', r.patient_id),
        'pending', 'clinical');
    end loop;

    insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
    values (r.patient_org_id, null, 'clinician.emergency_record_access_review_nudged', 'patient', r.patient_id,
      jsonb_build_object('grant_id', r.id, 'expires_at', r.expires_at));
  end loop;
end;
$function$;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'emergency-access-review-nudge') then
    perform cron.unschedule('emergency-access-review-nudge');
  end if;
end $$;

select cron.schedule(
  'emergency-access-review-nudge',
  '0 */4 * * *',
  $$ select private.notify_unapproved_emergency_access_grants(); $$
);

do $$
begin
  if not exists (select 1 from cron.job where jobname = 'emergency-access-review-nudge') then
    raise exception 'emergency-access-review-nudge cron job was not scheduled';
  end if;
  if not exists (select 1 from pg_proc where proname = 'notify_unapproved_emergency_access_grants' and pronamespace = 'private'::regnamespace) then
    raise exception 'private.notify_unapproved_emergency_access_grants was not created';
  end if;
end $$;
