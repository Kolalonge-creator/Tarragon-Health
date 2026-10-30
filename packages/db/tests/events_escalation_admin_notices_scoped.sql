-- Tarragon Health: escalation notices to admins stay inside the alert's own organisation (2026-10-30)
--
-- Events harness sweep. The admin hop of private.escalate_unacknowledged_clinician_alerts (3x the acknowledgement timeout) and the tier-2
-- hop of private.escalate_overdue_clinician_alerts (24 hours past the SLA) selected every admin on the platform, with no organisation
-- filter. In production that sent 130 notices about the real organisation's alerts to the synthetic canary organisation's admin and 25
-- the other way (docs/design/EVENTS-HARNESS-NOTICE-SWEEP.md).
--
--   1  ladder hop 3   the admin of the alert's organisation is told; the admin of another organisation is not
--   2  SLA tier 2     same, and a person who is both a Chief Medical Officer and an admin sees the notice once, not twice
--                     (the duplicate in-app guard marks the second suppressed)
--
-- Fixtures built here, wrapped in BEGIN/ROLLBACK, raises on failure.
-- Run: psql "$DATABASE_URL" -f packages/db/tests/events_escalation_admin_notices_scoped.sql

begin;

create temp table fx (k text primary key, v uuid) on commit drop;
grant all on fx to public;
create function pg_temp.f(p text) returns uuid language sql as $$ select v from fx where k = p $$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'ev11-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'EV11 ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'),
          (current_date - interval '45 years')::date, true)
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, is_test = true, is_active = true, phone = excluded.phone;
  return v;
end $f$;
create function pg_temp.visible_to(p_recipient uuid, p_template text, p_alert uuid) returns integer language sql as
$$ select count(*)::integer from public.notifications
    where recipient_id = p_recipient and template = p_template and channel = 'in_app' and status not in ('failed', 'suppressed')
      and (payload->>'clinician_alert_id' = p_alert::text or source_id = p_alert) $$;

do $$
declare v_org uuid; v_org_b uuid; v_pat uuid; v_cmo_admin uuid; v_result uuid; v_alert uuid; v_timeout int;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  if v_org is null then raise exception 'no organisation exists, the core migrations did not run'; end if;
  insert into public.organisations (name, type) values ('EV11 other organisation', 'direct_consumer') returning id into v_org_b;
  insert into fx values ('org', v_org), ('orgB', v_org_b);

  insert into fx values ('adminA', pg_temp.mkuser(v_org, 'adminA', 'admin')), ('adminB', pg_temp.mkuser(v_org_b, 'adminB', 'admin'));
  v_pat := pg_temp.mkuser(v_org, 'pat', 'patient');
  insert into fx values ('pat', v_pat);

  -- a person who is both a Chief Medical Officer and an admin of the alert's organisation
  v_cmo_admin := pg_temp.mkuser(v_org, 'cmo-admin', 'admin');
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
  values (v_org, v_cmo_admin, 'EV11 cmo-admin', 'MDCN', 'EV11-' || substr(v_cmo_admin::text, 1, 8), true, 'active', now(), pg_temp.f('adminA'),
      'chief_medical_officer', 'contracted', 2, true, pg_temp.f('adminA'), true);
  insert into fx values ('cmo_admin', v_cmo_admin);

  -- an alert nobody acknowledges
  insert into public.screening_results (organisation_id, patient_id, result_status, screen_type_code, abnormal_flags)
  values (v_org, v_pat, 'critical', 'hba1c', array['glucose']) returning id into v_result;
  select id into v_alert from public.clinician_alerts where screening_result_id = v_result;
  if v_alert is null then raise exception 'FAIL setup: the critical result raised no alert'; end if;
  insert into fx values ('alert', v_alert);

  select (private.alert_rule_config(type_code)->>'ack_timeout_minutes')::integer into v_timeout from public.clinician_alerts where id = v_alert;
  if v_timeout is null or v_timeout <= 0 then raise exception 'FAIL setup: the alert type has no acknowledgement timeout'; end if;
  update public.clinician_alerts set created_at = now() - make_interval(mins => v_timeout * 3 + 1), sla_due_at = now() - interval '30 hours' where id = v_alert;
end $$;

-- ================================================================ 1 acknowledgement ladder, hop 3
do $$
declare v_alert uuid := pg_temp.f('alert');
begin
  perform private.escalate_unacknowledged_clinician_alerts();
  if pg_temp.visible_to(pg_temp.f('adminA'), 'clinician_alert_ack_timeout_admin', v_alert) <> 1 then
    raise exception 'FAIL 1: the admin of the alert''s own organisation was not told at hop 3';
  end if;
  if pg_temp.visible_to(pg_temp.f('adminB'), 'clinician_alert_ack_timeout_admin', v_alert) <> 0 then
    raise exception 'FAIL 1: the admin of ANOTHER organisation was told about this organisation''s alert';
  end if;
  if exists (select 1 from public.notifications n join public.profiles pr on pr.id = n.recipient_id
              where n.source_id = v_alert and pr.organisation_id is distinct from n.organisation_id) then
    raise exception 'FAIL 1: a notice about this alert went to someone outside its organisation';
  end if;
end $$;

-- ================================================================ 2 SLA breach, tier 2
do $$
declare v_alert uuid := pg_temp.f('alert');
begin
  perform private.escalate_overdue_clinician_alerts();
  if pg_temp.visible_to(pg_temp.f('adminA'), 'clinician_alert_sla_breach', v_alert) <> 1 then
    raise exception 'FAIL 2: the admin of the alert''s own organisation was not told of the SLA breach';
  end if;
  if pg_temp.visible_to(pg_temp.f('adminB'), 'clinician_alert_sla_breach', v_alert) <> 0 then
    raise exception 'FAIL 2: the admin of ANOTHER organisation was told of this organisation''s SLA breach';
  end if;
  if pg_temp.visible_to(pg_temp.f('cmo_admin'), 'clinician_alert_sla_breach', v_alert) <> 1 then
    raise exception 'FAIL 2: a person who is both CMO and admin sees the SLA breach % times, expected 1',
      pg_temp.visible_to(pg_temp.f('cmo_admin'), 'clinician_alert_sla_breach', v_alert);
  end if;
  if (select count(*) from public.notifications where recipient_id = pg_temp.f('cmo_admin') and template = 'clinician_alert_sla_breach'
       and payload->>'clinician_alert_id' = v_alert::text) < 2 then
    raise exception 'FAIL 2: the CMO-and-admin was only sent one row, so this no longer exercises the duplicate';
  end if;
end $$;

rollback;

select 'events_escalation_admin_notices_scoped: ok' as result;
