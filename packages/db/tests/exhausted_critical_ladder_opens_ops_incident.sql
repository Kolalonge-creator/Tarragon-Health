-- OQ-731 proof: a clinician's critical notice whose delivery ladder ran out opens an ops incident (the ops desk's phone call), not only an in-app alarm.
--
-- Proved in one rolled-back transaction, against the real engine:
--   1. an exhausted critical notice to a clinician writes its failure row, alerts the admins AND opens a sev1 ops incident with a reference unique to the notice;
--   2. the incident text names no person and no clinical label (INV-07), only the notice id;
--   3. CONTROL: an exhausted critical notice to a PATIENT, or to a TEST clinician, writes its failure row but opens no incident (a patient's ladder ends in the inbox);
--   4. running the engine again changes nothing (one incident, one failure row);
--   5. if opening the incident itself fails, an audit row says so, the failure row and the admin alarm are still written, and the engine does not raise;
--   6. SABOTAGE: with the new block removed from the function text, check 1's incident is missing, so it flips.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create function pg_temp.rec(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('real', p_name, p_expected, p_actual) $$;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;
create function pg_temp.setf(p text, p_v uuid) returns void language sql as $$ insert into fx values (p, p_v) on conflict (k) do update set v = excluded.v $$;
create function pg_temp.f(p text) returns uuid language sql as $$ select v from fx where k = p $$;

-- an exhausted critical notice: failed, last hop of the ladder, no source table the engine skips
create function pg_temp.exhausted(p_org uuid, p_recipient uuid, p_hop int) returns uuid language plpgsql as
$f$ declare v uuid;
begin
  insert into public.notifications (organisation_id, recipient_id, channel, template, payload, priority, status, escalation_hop, source_table)
  values (p_org, p_recipient, 'email', 'oq731_baseline_notice', '{}'::jsonb, 'critical', 'failed', p_hop, 'clinician_alerts')
  returning id into v;
  return v;
end $f$;
create function pg_temp.incidents(p_notice uuid) returns integer language sql as
$$ select count(*)::integer from public.ops_incidents where external_reference = 'critical_notice_exhausted:' || p_notice::text and status not in ('resolved', 'closed') $$;
create function pg_temp.failures(p_notice uuid) returns integer language sql as
$$ select count(*)::integer from public.notification_escalation_failures where notification_id = p_notice $$;

do $$
declare
  v_org uuid; v_staff uuid := gen_random_uuid(); v_patient uuid := gen_random_uuid(); v_admin uuid := gen_random_uuid();
  v_n_staff uuid; v_n_patient uuid; v_n_test uuid; v_test uuid := gen_random_uuid(); v_summary text; v_name text;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  if v_org is null then raise exception 'no organisation exists at all -- the core migrations did not run'; end if;
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data) values
    (v_staff, 'oq731-staff@example.invalid', 'x', now(), '{}', '{}'),
    (v_patient, 'oq731-patient@example.invalid', 'x', now(), '{}', '{}'),
    (v_admin, 'oq731-admin@example.invalid', 'x', now(), '{}', '{}'),
    (v_test, 'oq731-test@example.invalid', 'x', now(), '{}', '{}')
  on conflict (id) do nothing;
  insert into public.profiles (id, organisation_id, role, full_name) values
    (v_staff, v_org, 'clinician', 'Oqseven Clinician Zebra'),
    (v_patient, v_org, 'patient', 'Oqseven Patient Quokka'),
    (v_admin, v_org, 'admin', 'Oqseven Admin'),
    (v_test, v_org, 'clinician', 'Oqseven Test Clinician')
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, full_name = excluded.full_name;
  update public.profiles set is_test = true where id = v_test;
  perform pg_temp.setf('org', v_org); perform pg_temp.setf('staff', v_staff); perform pg_temp.setf('patient', v_patient);

  v_n_staff := pg_temp.exhausted(v_org, v_staff, 3);
  v_n_patient := pg_temp.exhausted(v_org, v_patient, 3);
  v_n_test := pg_temp.exhausted(v_org, v_test, 3);
  perform pg_temp.setf('n_staff', v_n_staff); perform pg_temp.setf('n_patient', v_n_patient);

  perform private.escalate_unconfirmed_critical_notifications();

  perform pg_temp.rec('a clinician''s exhausted notice writes its failure row', '1', pg_temp.failures(v_n_staff)::text);
  perform pg_temp.rec('...alerts the admins in-app', 'true',
    (exists (select 1 from public.notifications where template = 'critical_notification_escalation_exhausted' and payload ->> 'notification_id' = v_n_staff::text))::text);
  perform pg_temp.rec('...and opens one ops incident for it', '1', pg_temp.incidents(v_n_staff)::text);
  perform pg_temp.rec('...a sev1 clinical incident', 'sev1,clinical',
    (select severity::text || ',' || category::text from public.ops_incidents where external_reference = 'critical_notice_exhausted:' || v_n_staff::text));

  select summary || ' ' || title into v_summary from public.ops_incidents where external_reference = 'critical_notice_exhausted:' || v_n_staff::text;
  select full_name into v_name from public.profiles where id = v_staff;
  perform pg_temp.rec('the incident text names no person and no template', 'false',
    (v_summary like '%' || v_name || '%' or v_summary like '%Zebra%' or v_summary like '%oq731_baseline_notice%')::text);
  perform pg_temp.rec('...and it tells the ops person to phone', 'true', (v_summary like '%Phone the on-call clinician%')::text);

  perform pg_temp.rec('CONTROL: a test clinician''s exhausted notice writes its failure row', '1', pg_temp.failures(v_n_test)::text);
  perform pg_temp.rec('CONTROL: ...but a test clinician opens no ops incident', '0', pg_temp.incidents(v_n_test)::text);
  perform pg_temp.rec('CONTROL: a patient''s exhausted notice writes its failure row', '1', pg_temp.failures(v_n_patient)::text);
  perform pg_temp.rec('CONTROL: ...but opens no ops incident', '0', pg_temp.incidents(v_n_patient)::text);

  perform private.escalate_unconfirmed_critical_notifications();
  perform pg_temp.rec('running the engine again leaves one incident', '1', pg_temp.incidents(v_n_staff)::text);
  perform pg_temp.rec('...and one failure row', '1', pg_temp.failures(v_n_staff)::text);
end $$;

-- 5. opening the incident fails: an audit row says so, the rest is still written, the engine does not raise
do $$
declare v_org uuid := pg_temp.f('org'); v_staff uuid := pg_temp.f('staff'); v_n uuid; v_res text := 'ok';
begin
  create or replace function private.page_incident(p_org uuid, p_ref text, p_title text, p_summary text) returns void
  language plpgsql security definer set search_path to '' as $f$ begin raise exception 'oq731 simulated incident failure'; end $f$;
  v_n := pg_temp.exhausted(v_org, v_staff, 3);
  begin
    perform private.escalate_unconfirmed_critical_notifications();
  exception when others then v_res := sqlstate;
  end;
  perform pg_temp.rec('when opening the incident fails the engine does not raise', 'ok', v_res);
  perform pg_temp.rec('...the failure row and the admin alarm are still written', '1,true', pg_temp.failures(v_n)::text || ',' ||
    (exists (select 1 from public.notifications where template = 'critical_notification_escalation_exhausted' and payload ->> 'notification_id' = v_n::text))::text);
  perform pg_temp.rec('...and an audit row records the failure', '1',
    (select count(*)::text from public.audit_log where action = 'critical_notification.exhausted_incident_error' and entity_id = v_n));
end $$;

-- 6. SABOTAGE: the new block removed from the function text. A fresh staff notice must now open no incident, so the matching check flips.
do $$
declare
  v_def text := pg_get_functiondef('private.escalate_unconfirmed_critical_notifications()'::regprocedure);
  v_org uuid := pg_temp.f('org'); v_staff uuid := pg_temp.f('staff'); v_n uuid;
  v_start integer; v_end integer;
begin
  -- the sabotage run needs the real incident function back, then removes the block between its two markers
  create or replace function private.page_incident(p_org uuid, p_ref text, p_title text, p_summary text) returns void
  language plpgsql security definer set search_path to '' as $f$
  begin
    if exists (select 1 from public.ops_incidents where external_reference = p_ref and status not in ('resolved', 'closed')) then
      update public.ops_incidents set summary = p_summary where external_reference = p_ref and status not in ('resolved', 'closed');
    else
      insert into public.ops_incidents (organisation_id, category, severity, title, summary, external_reference, ack_due_at, resolve_due_at)
      values (p_org, 'clinical', 'sev1', p_title, p_summary, p_ref, now(), now());
    end if;
  end $f$;
  v_start := position('-- OQ-731: a clinician''s notice' in v_def);
  v_end := position('      continue;' in substr(v_def, v_start)) + v_start - 1;
  if v_start = 0 or v_end <= v_start then raise exception 'sabotage anchors not found: the fix is not in the live body'; end if;
  execute substr(v_def, 1, v_start - 1) || substr(v_def, v_end);
  v_n := pg_temp.exhausted(v_org, v_staff, 3);
  perform private.escalate_unconfirmed_critical_notifications();
  insert into results values ('sabotaged', '...and opens one ops incident for it', '1', pg_temp.incidents(v_n)::text);
  insert into results values ('sabotaged', 'a clinician''s exhausted notice writes its failure row', '1', pg_temp.failures(v_n)::text);
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'OQ-731 proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ')
         from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected is distinct from actual;
  if v_caught < 1 then raise exception 'VACUOUS TEST: the sabotage flipped % of 1 checks', v_caught; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
  from results where phase = 'real' order by check_name;

rollback;
