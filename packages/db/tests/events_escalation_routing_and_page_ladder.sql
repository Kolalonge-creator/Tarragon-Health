-- Tarragon Health: escalation routing and the unacknowledged-alert ladder, end to end (2026-10-30)
--
-- Companion to events_reach_clinician_queue_end_to_end.sql (E1, E2). This one proves
--
--   E3  escalation routing    an escalation raised from an alert goes to that alert's owner;
--                             the assigned doctor sees it through the same join the dashboard
--                             uses; an owner on leave is skipped; when everyone is on leave
--                             the case still exists, unassigned, and org staff can still see it
--                             (it never disappears).
--   E4  unacknowledged page   an alert nobody acknowledges climbs the governed ladder on time:
--                             backup at 1x the rule's ack timeout, senior doctors at 2x, admins
--                             at 3x; each hop fires once only; an acknowledged alert never
--                             climbs; the sweep is actually scheduled.
--
-- Read through simulated sessions, fixtures built here, wrapped in BEGIN/ROLLBACK, raises on failure.
-- Run: psql "$DATABASE_URL" -f packages/db/tests/events_escalation_routing_and_page_ladder.sql

begin;

create temp table fx (k text primary key, v uuid) on commit drop;
grant all on fx to public;
create function pg_temp.f(p text) returns uuid language sql as $$ select v from fx where k = p $$;
create function pg_temp.act(p_uid uuid) returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
end $f$;
create function pg_temp.back() returns void language plpgsql as
$f$ begin reset role; perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.role', '', true); end $f$;
grant execute on function pg_temp.f(text), pg_temp.act(uuid), pg_temp.back() to public;

do $$
declare
  v_org uuid;
  v_doc uuid := gen_random_uuid();
  v_doc2 uuid := gen_random_uuid();
  v_pat uuid := gen_random_uuid();
  v_pat2 uuid := gen_random_uuid();
  v_admin uuid := gen_random_uuid();
begin
  select id into v_org from public.organisations order by created_at limit 1;
  if v_org is null then raise exception 'no organisation exists, the core migrations did not run'; end if;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values
    (v_doc, 'ev3-doc@example.invalid', 'x', now(), '{}', '{}'),
    (v_doc2, 'ev3-doc2@example.invalid', 'x', now(), '{}', '{}'),
    (v_pat, 'ev3-pat@example.invalid', 'x', now(), '{}', '{}'),
    (v_pat2, 'ev3-pat2@example.invalid', 'x', now(), '{}', '{}');

  insert into public.profiles (id, organisation_id, role, full_name, date_of_birth)
  values
    (v_doc, v_org, 'clinician', 'EV3 Doctor One', null),
    (v_doc2, v_org, 'clinician', 'EV3 Doctor Two', null),
    (v_pat, v_org, 'patient', 'EV3 Patient', date '1980-01-01'),
    (v_pat2, v_org, 'patient', 'EV3 Patient Two', date '1982-02-02')
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role,
    full_name = excluded.full_name, date_of_birth = excluded.date_of_birth;

  insert into public.clinical_staff (organisation_id, profile_id, full_name, doctor_tier, active, employment_type, license_verified_at)
  values
    (v_org, v_doc, 'EV3 Doctor One', 'senior_medical_officer', true, 'employed', now()),
    (v_org, v_doc2, 'EV3 Doctor Two', 'senior_medical_officer', true, 'employed', now());

  -- An admin of our own, so the 3x hop has a recipient and cannot pass for lack of one.
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v_admin, 'ev3-admin@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name)
  values (v_admin, v_org, 'admin', 'EV3 Admin')
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, full_name = excluded.full_name;

  insert into fx values ('org', v_org), ('doc', v_doc), ('doc2', v_doc2), ('pat', v_pat), ('pat2', v_pat2), ('admin', v_admin);
end $$;

-- the ladder sweep must be scheduled, or hops 1 to 3 never happen on their own
do $$
begin
  if not exists (select 1 from cron.job where command ~ 'escalate_unacknowledged_clinician_alerts') then
    raise exception 'FAIL E4: nothing schedules private.escalate_unacknowledged_clinician_alerts, an unacknowledged alert never climbs';
  end if;
end $$;

-- ---------------------------------------------------------------- raise the alert (as the system)
do $$
declare v_result uuid; v_alert uuid;
begin
  insert into public.screening_results (organisation_id, patient_id, result_status, screen_type_code, abnormal_flags)
  values (pg_temp.f('org'), pg_temp.f('pat'), 'critical', 'hba1c', array['glucose'])
  returning id into v_result;
  select id into v_alert from public.clinician_alerts where screening_result_id = v_result;
  insert into fx values ('alert', v_alert);
  insert into fx select 'owner_profile', cs.profile_id
    from public.clinical_staff cs join public.clinician_alerts a on cs.id = a.responsible_clinician_id where a.id = v_alert;
  insert into fx select 'backup_profile', cs.profile_id
    from public.clinical_staff cs join public.clinician_alerts a on cs.id = a.backup_clinician_id where a.id = v_alert;
  if pg_temp.f('owner_profile') is null or pg_temp.f('backup_profile') is null
     or pg_temp.f('owner_profile') = pg_temp.f('backup_profile') then
    raise exception 'FAIL setup: the alert needs a distinct owner and backup (owner %, backup %)',
      pg_temp.f('owner_profile'), pg_temp.f('backup_profile');
  end if;
end $$;

-- ================================================================ E3 routing
-- continuity: the escalation raised from this alert goes to the alert's owner
do $$
declare v_esc uuid; v_assigned uuid;
begin
  insert into public.escalations (organisation_id, patient_id, clinician_alert_id, reason)
  values (pg_temp.f('org'), pg_temp.f('pat'), pg_temp.f('alert'), 'EV routing continuity')
  returning id, assigned_doctor_id into v_esc, v_assigned;
  insert into fx values ('esc1', v_esc);
  if v_assigned is distinct from pg_temp.f('owner_profile') then
    raise exception 'FAIL E3: escalation went to %, the alert owner is %', v_assigned, pg_temp.f('owner_profile');
  end if;
end $$;

-- the assigned doctor sees it through the dashboard's join, with level and due time to rank by
create function pg_temp.dashboard_view() returns void language plpgsql as
$f$
declare v_n integer; v_lvl text; v_due timestamptz;
begin
  perform pg_temp.act(pg_temp.f('owner_profile'));
  select count(*), min(ca.level::text), min(ca.sla_due_at) into v_n, v_lvl, v_due
    from public.escalations e
    left join public.clinician_alerts ca on ca.id = e.clinician_alert_id
   where e.status in ('open', 'under_review') and e.id = pg_temp.f('esc1');
  perform pg_temp.back();
  if v_n <> 1 then raise exception 'FAIL E3: the assigned doctor cannot see the escalation (% rows)', v_n; end if;
  if v_lvl is distinct from 'emergency' or v_due is null then
    raise exception 'FAIL E3: the dashboard join gives level % and due %, nothing to rank by', v_lvl, v_due;
  end if;
end $f$;
select pg_temp.dashboard_view();

-- owner goes on leave: the next escalation on the same alert must not follow continuity to them
do $$
declare v_assigned uuid;
begin
  insert into public.provider_time_off (organisation_id, clinician_id, kind, starts_at, ends_at, reason)
  values (pg_temp.f('org'), pg_temp.f('owner_profile'), 'leave', now() - interval '1 hour', now() + interval '1 day', 'EV leave');
  insert into public.escalations (organisation_id, patient_id, clinician_alert_id, reason)
  values (pg_temp.f('org'), pg_temp.f('pat'), pg_temp.f('alert'), 'EV owner on leave')
  returning assigned_doctor_id into v_assigned;
  if v_assigned = pg_temp.f('owner_profile') then
    raise exception 'FAIL E3: an escalation was routed to a doctor on leave';
  end if;
  if v_assigned is null then
    raise exception 'FAIL E3: another qualifying doctor was free but the escalation was left unassigned';
  end if;
  if not exists (select 1 from public.clinical_staff where profile_id = v_assigned and active) then
    raise exception 'FAIL E3: escalation routed to %, who is not an active clinician', v_assigned;
  end if;
end $$;

-- everyone qualifying is on leave: the case still exists, unassigned, and staff can see it
do $$
declare v_esc uuid; v_assigned uuid;
begin
  insert into public.provider_time_off (organisation_id, clinician_id, kind, starts_at, ends_at, reason)
  select cs.organisation_id, cs.profile_id, 'leave', now() - interval '1 hour', now() + interval '1 day', 'EV all out'
    from public.clinical_staff cs
   where cs.organisation_id = pg_temp.f('org') and cs.active and cs.profile_id is not null
     and cs.profile_id <> pg_temp.f('owner_profile');
  insert into public.escalations (organisation_id, patient_id, clinician_alert_id, reason)
  values (pg_temp.f('org'), pg_temp.f('pat'), pg_temp.f('alert'), 'EV nobody free')
  returning id, assigned_doctor_id into v_esc, v_assigned;
  insert into fx values ('esc3', v_esc);
  if v_assigned is not null then
    raise exception 'FAIL E3: with every doctor on leave the escalation was assigned to % anyway', v_assigned;
  end if;
end $$;

create function pg_temp.unassigned_visible() returns void language plpgsql as
$f$
declare v_n integer;
begin
  perform pg_temp.act(pg_temp.f('doc2'));
  select count(*) into v_n from public.escalations where id = pg_temp.f('esc3') and status = 'open';
  perform pg_temp.back();
  if v_n <> 1 then raise exception 'FAIL E3: an unassigned open escalation is invisible to org staff, it has disappeared'; end if;
end $f$;
select pg_temp.unassigned_visible();

-- ================================================================ E4 ladder
do $$
declare
  v_alert uuid := pg_temp.f('alert');
  v_timeout integer; v_n integer; v_seniors integer; v_admins integer; v_cnt integer;
begin
  -- the timeout in force is read, never hardcoded
  select (private.alert_rule_config(type_code)->>'ack_timeout_minutes')::integer into v_timeout
    from public.clinician_alerts where id = v_alert;
  if v_timeout is null or v_timeout <= 0 then
    raise exception 'FAIL E4: the alert type has no acknowledgement timeout, it can never climb';
  end if;

  select count(*) into v_seniors from public.clinical_staff
   where organisation_id = pg_temp.f('org') and active and profile_id is not null
     and doctor_tier in ('senior_medical_officer', 'chief_medical_officer');
  select count(*) into v_admins from public.profiles where role = 'admin';

  -- under 1x: nothing climbs
  update public.clinician_alerts set created_at = now() - make_interval(mins => v_timeout - 5) where id = v_alert;
  perform private.escalate_unacknowledged_clinician_alerts();
  select count(*) into v_n from public.clinician_alert_ack_escalations where clinician_alert_id = v_alert;
  if v_n <> 0 then raise exception 'FAIL E4: the alert climbed % hops before its timeout', v_n; end if;

  -- 1x: backup only
  update public.clinician_alerts set created_at = now() - make_interval(mins => v_timeout + 1) where id = v_alert;
  perform private.escalate_unacknowledged_clinician_alerts();
  if not exists (select 1 from public.clinician_alert_ack_escalations
                  where clinician_alert_id = v_alert and hop = 1 and notified_role = 'backup') then
    raise exception 'FAIL E4: no backup hop at 1x the timeout';
  end if;
  if exists (select 1 from public.clinician_alert_ack_escalations where clinician_alert_id = v_alert and hop > 1) then
    raise exception 'FAIL E4: the alert climbed past the backup at 1x';
  end if;
  select count(*) into v_n from public.notifications
   where source_id = v_alert and template = 'clinician_alert_ack_timeout_backup'
     and recipient_id = pg_temp.f('backup_profile');
  if v_n < 1 then raise exception 'FAIL E4: the backup clinician was never told'; end if;

  -- 2x: every senior doctor
  update public.clinician_alerts set created_at = now() - make_interval(mins => v_timeout * 2 + 1) where id = v_alert;
  perform private.escalate_unacknowledged_clinician_alerts();
  select count(distinct recipient_id) into v_n from public.notifications
   where source_id = v_alert and template = 'clinician_alert_ack_timeout_senior';
  if v_n <> v_seniors then raise exception 'FAIL E4: % of % senior doctors were told at 2x', v_n, v_seniors; end if;

  -- each hop fires once only
  select count(*) into v_cnt from public.notifications
   where source_id = v_alert and template like 'clinician_alert_ack_timeout%';
  perform private.escalate_unacknowledged_clinician_alerts();
  perform private.escalate_unacknowledged_clinician_alerts();
  select count(*) into v_n from public.notifications
   where source_id = v_alert and template like 'clinician_alert_ack_timeout%';
  if v_n <> v_cnt then raise exception 'FAIL E4: re-running the sweep sent % more notifications', v_n - v_cnt; end if;

  -- 3x: admins
  update public.clinician_alerts set created_at = now() - make_interval(mins => v_timeout * 3 + 1) where id = v_alert;
  perform private.escalate_unacknowledged_clinician_alerts();
  select count(distinct recipient_id) into v_n from public.notifications
   where source_id = v_alert and template = 'clinician_alert_ack_timeout_admin';
  if v_admins < 1 then raise exception 'FAIL E4 setup: no admin exists, the 3x hop would pass vacuously'; end if;
  if v_n <> v_admins then raise exception 'FAIL E4: % of % admins were told at 3x', v_n, v_admins; end if;
  if not exists (select 1 from public.clinician_alert_ack_escalations
                  where clinician_alert_id = v_alert and hop = 3 and notified_role = 'admin') then
    raise exception 'FAIL E4: no admin hop row at 3x the timeout';
  end if;
end $$;

-- an acknowledged alert never climbs (control: the unacknowledged one above did)
do $$
declare v_result uuid; v_alert2 uuid;
begin
  insert into public.screening_results (organisation_id, patient_id, result_status, screen_type_code, abnormal_flags)
  values (pg_temp.f('org'), pg_temp.f('pat2'), 'critical', 'hba1c', array['glucose'])
  returning id into v_result;
  select id into v_alert2 from public.clinician_alerts where screening_result_id = v_result;
  insert into fx values ('alert2', v_alert2);
end $$;

create function pg_temp.acknowledge() returns void language plpgsql as
$f$
begin
  perform pg_temp.act(pg_temp.f('doc2'));
  update public.clinician_alerts
     set status = 'acknowledged', acknowledged_by = pg_temp.f('doc2'), acknowledged_at = now()
   where id = pg_temp.f('alert2');
  perform pg_temp.back();
end $f$;
select pg_temp.acknowledge();

do $$
declare v_timeout integer; v_n integer;
begin
  select (private.alert_rule_config(type_code)->>'ack_timeout_minutes')::integer into v_timeout
    from public.clinician_alerts where id = pg_temp.f('alert2');
  update public.clinician_alerts set created_at = now() - make_interval(mins => v_timeout * 4)
   where id = pg_temp.f('alert2');
  if (select status::text from public.clinician_alerts where id = pg_temp.f('alert2')) <> 'acknowledged' then
    raise exception 'FAIL E4 setup: the acknowledgement did not take, this check would pass vacuously';
  end if;
  perform private.escalate_unacknowledged_clinician_alerts();
  select count(*) into v_n from public.clinician_alert_ack_escalations where clinician_alert_id = pg_temp.f('alert2');
  if v_n <> 0 then raise exception 'FAIL E4: an acknowledged alert climbed % hops', v_n; end if;
end $$;

select 'events_escalation_routing_and_page_ladder: all checks passed' as result;

rollback;
