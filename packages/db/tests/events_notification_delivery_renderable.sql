-- Tarragon Health: every push and email the event machinery queues has something to send it with (2026-10-30)
--
-- E7 of the events harness. The earlier proofs show an event queues notifications for the right people. This one asks
-- the next question: can the sender actually turn each queued push or email into a message? The sender
-- (supabase/functions/send-pending-notifications) renders a row from the code map TEMPLATE_MAP, or failing that from an
-- active English row in notification_template_locales for that template and channel. A row with neither fails with
-- "unknown template" and the recipient is never told, with no error anywhere a person would look.
--
-- Driven here, as the real functions fire them:
--   a patient sends an emergency-keyword care message   -> private.after_care_message_insert_safety_screen
--   a critical screening result nobody acknowledges     -> private.escalate_unacknowledged_clinician_alerts (hops 1, 2, 3)
--
-- Every push or email row those two events queue must be renderable. The templates the sender renders from code are listed
-- on the E7_TS_RENDERED line below; packages/notifications/src/events-delivery-renderable.test.ts reads that line and proves
-- each one really renders, with an email body, from TEMPLATE_MAP. Anything not on the line must have an active locale row.
--
-- E7_TS_RENDERED: care_message_safety_flag, clinician_alert_ack_timeout_backup, clinician_alert_ack_timeout_senior, clinician_alert_ack_timeout_admin
--
-- Fixtures built here, wrapped in BEGIN/ROLLBACK, raises on failure.
-- Run: psql "$DATABASE_URL" -f packages/db/tests/events_notification_delivery_renderable.sql

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
    (v_doc, 'ev7-doc@example.invalid', 'x', now(), '{}', '{}'),
    (v_doc2, 'ev7-doc2@example.invalid', 'x', now(), '{}', '{}'),
    (v_pat, 'ev7-pat@example.invalid', 'x', now(), '{}', '{}'),
    (v_pat2, 'ev7-pat2@example.invalid', 'x', now(), '{}', '{}'),
    (v_admin, 'ev7-admin@example.invalid', 'x', now(), '{}', '{}');

  insert into public.profiles (id, organisation_id, role, full_name, date_of_birth)
  values
    (v_doc, v_org, 'clinician', 'EV7 Doctor One', null),
    (v_doc2, v_org, 'clinician', 'EV7 Doctor Two', null),
    (v_pat, v_org, 'patient', 'EV7 Patient', date '1980-01-01'),
    (v_pat2, v_org, 'patient', 'EV7 Patient Two', date '1982-02-02'),
    (v_admin, v_org, 'admin', 'EV7 Admin', null)
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role,
    full_name = excluded.full_name, date_of_birth = excluded.date_of_birth;

  insert into public.clinical_staff (organisation_id, profile_id, full_name, doctor_tier, active, employment_type, license_verified_at)
  values
    (v_org, v_doc, 'EV7 Doctor One', 'senior_medical_officer', true, 'employed', now()),
    (v_org, v_doc2, 'EV7 Doctor Two', 'senior_medical_officer', true, 'employed', now());

  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id)
  values (v_org, v_pat, v_doc);

  insert into fx values ('org', v_org), ('doc', v_doc), ('doc2', v_doc2), ('pat', v_pat), ('pat2', v_pat2), ('admin', v_admin);
end $$;

-- ---------------------------------------------------------------- event 1: an emergency-keyword care message
create function pg_temp.patient_sends() returns void language plpgsql as
$f$
declare v_thread uuid;
begin
  perform pg_temp.act(pg_temp.f('pat'));
  v_thread := public.start_care_thread('EV7 emergency', 'I have crushing chest pain and cannot breathe', null, null, null, 'clinical');
  perform pg_temp.back();
  insert into fx values ('thread', v_thread);
end $f$;
select pg_temp.patient_sends();

-- ---------------------------------------------------------------- event 2: a critical result nobody acknowledges
do $$
declare v_result uuid; v_alert uuid; v_timeout int;
begin
  insert into public.screening_results (organisation_id, patient_id, result_status, screen_type_code, abnormal_flags)
  values (pg_temp.f('org'), pg_temp.f('pat2'), 'critical', 'hba1c', array['glucose'])
  returning id into v_result;
  select id into v_alert from public.clinician_alerts where screening_result_id = v_result;
  if v_alert is null then raise exception 'FAIL setup: the critical result raised no alert'; end if;
  insert into fx values ('alert', v_alert);

  select (private.alert_rule_config(type_code)->>'ack_timeout_minutes')::integer into v_timeout
    from public.clinician_alerts where id = v_alert;
  if v_timeout is null or v_timeout <= 0 then raise exception 'FAIL setup: the alert type has no acknowledgement timeout'; end if;

  update public.clinician_alerts set created_at = now() - make_interval(mins => v_timeout + 1) where id = v_alert;
  perform private.escalate_unacknowledged_clinician_alerts();
  update public.clinician_alerts set created_at = now() - make_interval(mins => v_timeout * 2 + 1) where id = v_alert;
  perform private.escalate_unacknowledged_clinician_alerts();
  update public.clinician_alerts set created_at = now() - make_interval(mins => v_timeout * 3 + 1) where id = v_alert;
  perform private.escalate_unacknowledged_clinician_alerts();
end $$;

-- ---------------------------------------------------------------- the check
do $$
declare
  v_ts_rendered text[] := array[
    'care_message_safety_flag', 'clinician_alert_ack_timeout_backup', 'clinician_alert_ack_timeout_senior', 'clinician_alert_ack_timeout_admin'];
  r record;
  v_bad text := '';
  v_n int;
begin
  -- The proof is only meaningful if both events really queued push and email rows. Without that a rename would
  -- empty the loop below and it would pass having checked nothing.
  select count(*) into v_n from public.notifications
   where template = 'care_message_safety_flag' and channel in ('push', 'email') and recipient_id in (pg_temp.f('doc'), pg_temp.f('doc2'));
  if v_n = 0 then raise exception 'FAIL setup: the emergency message queued no push or email row for a doctor'; end if;

  select count(*) into v_n from public.notifications
   where source_id = pg_temp.f('alert') and template like 'clinician_alert_ack_timeout%' and channel = 'email';
  if v_n = 0 then raise exception 'FAIL setup: the ladder queued no email row'; end if;

  for r in
    select distinct n.template, n.channel::text as channel
      from public.notifications n
     where n.channel <> 'in_app'
       and ((n.template = 'care_message_safety_flag' and n.organisation_id = pg_temp.f('org') and n.created_at >= now() - interval '1 hour'
             and n.recipient_id in (pg_temp.f('doc'), pg_temp.f('doc2'), pg_temp.f('admin')))
            or n.source_id = pg_temp.f('alert'))
  loop
    if r.template = any (v_ts_rendered) then continue; end if;
    if exists (select 1 from public.notification_template_locales l
                where l.template_key = r.template and l.channel::text = r.channel and l.locale = 'en' and l.is_active) then
      continue;
    end if;
    v_bad := v_bad || format(' %s/%s', r.template, r.channel);
  end loop;

  if v_bad <> '' then
    raise exception 'FAIL E7: the sender has nothing to render these queued rows with, so they fail as "unknown template" and nobody is told:%', v_bad;
  end if;
end $$;

rollback;

select 'events_notification_delivery_renderable: ok' as result;
