-- Tarragon Health — Clinical Governance & Patient Safety spec §31.9
-- "Serious incident escalation" — a HIGH/CRITICAL clinical_incident_report
-- should trigger immediate notification and senior clinical review.
--
-- Confirmed as a genuine gap before writing this: 20260826225518's
-- clinical_incident_reports has an attribution-enforcement trigger but
-- nothing that reacts to severity — filing a critical incident today
-- creates the row and nothing else. A doctor or Care Coordinator files a
-- report and it simply sits until someone happens to open the log.
--
-- Recipients: every active Clinical Director in the reporting org (senior
-- clinical review, §31.9) and every admin (operational leadership, §31.9) —
-- same "for v_admin in select id from public.profiles where role = 'admin'"
-- shape as clinical_staff_indemnity_lapse_notify/license_expiry_tracking,
-- deliberately not organisation-filtered for admins (matching those two
-- precedents), but the notifications row itself still carries
-- organisation_id for scoping/display.
--
-- content_class = 'non_clinical' and the payload carries only category +
-- severity + the report id, never the free-text description — same "that
-- it happened, never what was found" posture as sponsor_care_reviewed
-- (20260801092000): a patient-identifying or clinically detailed incident
-- narrative does not belong in a notification payload row. The full report
-- is one click away at /clinician/incidents. content_class stays
-- non_clinical regardless of channel here since the only channel used is
-- in_app, but this keeps the row consistent with what it actually carries.
--
-- Deliberately an AFTER INSERT trigger, not a cron sweep like the breach-
-- deadline reminder: this is a one-time "something just happened" event,
-- not an ongoing deadline that needs repeated nudging.

create or replace function private.notify_serious_clinical_incident()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_recipient record;
begin
  if new.severity not in ('high', 'critical') then
    return new;
  end if;

  -- cs.profile_id is nullable (a clinical_staff row can exist without a
  -- linked login) but notifications.recipient_id is NOT NULL -- an
  -- unfiltered null here would abort this entire trigger, which runs in the
  -- same transaction as filing the incident report itself. Excluded rather
  -- than trusted to never occur.
  for v_recipient in
    select cs.profile_id as id
    from public.clinical_staff cs
    where cs.organisation_id = new.organisation_id
      and cs.active
      and cs.is_clinical_director
      and cs.profile_id is not null
    union
    select p.id
    from public.profiles p
    where p.role = 'admin'
  loop
    insert into public.notifications (
      recipient_id, organisation_id, channel, template, payload, status, content_class
    )
    values (
      v_recipient.id,
      new.organisation_id,
      'in_app',
      'serious_clinical_incident_filed',
      jsonb_build_object('incident_id', new.id, 'category', new.category, 'severity', new.severity),
      'pending',
      'non_clinical'
    );
  end loop;

  return new;
end;
$$;

comment on function private.notify_serious_clinical_incident() is
  'Spec §31.9: filing a high/critical clinical_incident_reports row immediately notifies every active Clinical Director in the org (senior clinical review) and every admin (operational leadership) via an in_app notification. Runs AFTER INSERT only — a status change on an existing report never re-notifies.';

create trigger clinical_incident_reports_notify_serious
  after insert on public.clinical_incident_reports
  for each row execute function private.notify_serious_clinical_incident();

revoke all on function private.notify_serious_clinical_incident() from public;

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.clinical_incident_reports'::regclass
      and tgname = 'clinical_incident_reports_notify_serious'
      and not tgisinternal
  ) then
    raise exception 'clinical_incident_reports_notify_serious trigger missing';
  end if;

  raise notice 'PASS: serious-incident notification trigger present';
end $$;
