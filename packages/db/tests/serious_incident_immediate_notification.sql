-- Tarragon Health — proof for 20260829090000_serious_incident_immediate_notification.sql.
--
-- Cases:
--   1. Filing a HIGH severity incident notifies every active Clinical
--      Director in the org and every admin, in_app, content_class non_clinical.
--   2. Filing a CRITICAL severity incident does the same.
--   3. Filing a MEDIUM/LOW/near_miss incident notifies nobody — the trigger
--      only fires for high/critical.
--   4. The notification payload carries category/severity/incident_id but
--      never the free-text description (no PHI/narrative in the row).
--
-- Run: npx supabase db query --linked -f packages/db/tests/serious_incident_immediate_notification.sql

begin;

create temporary table test_result (
  case_num int, label text, outcome text, detail text
) on commit drop;

do $$
declare
  v_org           uuid := '00000000-0000-0000-0000-000000000001';
  v_director_prof uuid;
  v_reporter_prof uuid;
  v_admin_count   int;
  v_director_id   uuid;
  v_incident_id   uuid;
  v_notif_count   int;
  v_payload       jsonb;
begin
  select cs.profile_id into v_director_prof
  from public.clinical_staff cs
  where cs.organisation_id = v_org and cs.active and cs.is_clinical_director
  limit 1;

  select cs.profile_id into v_reporter_prof
  from public.clinical_staff cs
  where cs.organisation_id = v_org and cs.active
  limit 1;

  select count(*) into v_admin_count from public.profiles where role = 'admin';

  if v_director_prof is null or v_reporter_prof is null or v_admin_count = 0 then
    insert into test_result values (0, 'setup', 'SKIP', 'org missing a director/staff/admin fixture');
  else
    -- Case 1: HIGH severity notifies director + admins.
    insert into public.clinical_incident_reports (organisation_id, category, severity, description)
    values (v_org, 'medication_error', 'high', 'Test: wrong dose logged, caught before administration.')
    returning id into v_incident_id;

    select count(*) into v_notif_count
    from public.notifications
    where template = 'serious_clinical_incident_filed'
      and payload->>'incident_id' = v_incident_id::text;

    insert into test_result values (
      1, 'high severity notifies director + admins',
      case when v_notif_count >= 1 + v_admin_count then 'PASS' else 'FAIL' end,
      format('expected >= %s notifications, got %s', 1 + v_admin_count, v_notif_count)
    );

    select payload into v_payload
    from public.notifications
    where template = 'serious_clinical_incident_filed'
      and payload->>'incident_id' = v_incident_id::text
    limit 1;

    insert into test_result values (
      1, 'payload carries no free-text description',
      case when v_payload ? 'description' then 'FAIL' else 'PASS' end,
      v_payload::text
    );

    -- Case 2: CRITICAL severity also notifies.
    insert into public.clinical_incident_reports (organisation_id, category, severity, description)
    values (v_org, 'escalation_delay', 'critical', 'Test: emergency alert unacknowledged for 6 hours.')
    returning id into v_incident_id;

    select count(*) into v_notif_count
    from public.notifications
    where template = 'serious_clinical_incident_filed'
      and payload->>'incident_id' = v_incident_id::text;

    insert into test_result values (
      2, 'critical severity notifies director + admins',
      case when v_notif_count >= 1 + v_admin_count then 'PASS' else 'FAIL' end,
      format('expected >= %s notifications, got %s', 1 + v_admin_count, v_notif_count)
    );

    -- Case 3: MEDIUM/LOW/near_miss notify nobody.
    insert into public.clinical_incident_reports (organisation_id, category, severity, description)
    values (v_org, 'documentation_error', 'medium', 'Test: patient name typo caught on review.')
    returning id into v_incident_id;

    select count(*) into v_notif_count
    from public.notifications
    where template = 'serious_clinical_incident_filed'
      and payload->>'incident_id' = v_incident_id::text;

    insert into test_result values (
      3, 'medium severity notifies nobody',
      case when v_notif_count = 0 then 'PASS' else 'FAIL' end,
      format('expected 0, got %s', v_notif_count)
    );

    insert into public.clinical_incident_reports (organisation_id, category, severity, description)
    values (v_org, 'other', 'near_miss', 'Test: alert fired correctly, doctor responded in time.')
    returning id into v_incident_id;

    select count(*) into v_notif_count
    from public.notifications
    where template = 'serious_clinical_incident_filed'
      and payload->>'incident_id' = v_incident_id::text;

    insert into test_result values (
      3, 'near_miss notifies nobody',
      case when v_notif_count = 0 then 'PASS' else 'FAIL' end,
      format('expected 0, got %s', v_notif_count)
    );
  end if;
end $$;

select * from test_result order by case_num;

rollback;
