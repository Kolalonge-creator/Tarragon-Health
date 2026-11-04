-- ===========================================================================
-- Proof: Care Circle Phase 1 privacy fixes
--   20261104172930_care_circle_p1_consent_pause_rls_history.sql and 20261104180415_care_circle_p1_payer_accepts_and_note_waiting.sql
--   (docs/plans/care-circle-expansion-audit-and-plan-2026-11-04.md, section 5).
--
--   A. Consent everywhere: with the S42 consent "vitals x care_circle_sharing" in force a supporter sees doses, the BP trend and the
--      monthly report, gets the digest's dose and reading counts, and is nudged for a missed dose. After the patient withdraws it, all of
--      those stop: view blocks, monthly block, digest read, digest send, nudge sweep, nudge list. Appointments (not vitals) still show.
--   B. A therapy appointment, or one whose reason names a confidential matter, never shows (not its time, not as missed); an ordinary
--      appointment does.
--   C. Help alert while paused (D-help): the alert still reaches the supporter, and the supporter can open it.
--   D. A removed supporter cannot read their own revoked row; the patient still reads it.
--   E. Permission history: every change, with the true actor, including two changes inside an hour, a removal, a pause and a doctor-note
--      release. The patient reads it; a supporter reads none of it; nobody can change a row.
--   F. List readers ignore a supporter whose account is no longer active.
--   G. "A note from your doctor is waiting": told only when someone in the circle could receive it; the notice carries nothing.
--   SABOTAGE (each must flip a real check): the consent helper made to pass everything; the appointment filter made to pass everything;
--   the help-alert fallback removed; the old supporter policy restored; the members history trigger dropped.
-- BEGIN/ROLLBACK; mints its own fixtures.
-- ===========================================================================
begin;
create temp table results (phase text, check_name text, expected text, actual text);
grant all on results to public;

create function pg_temp.ck(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('real', p_name, p_expected, p_actual) $$;
create function pg_temp.sk(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('sabotaged', p_name, p_expected, p_actual) $$;
create function pg_temp.act(p_uid uuid) returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
end $f$;
create function pg_temp.back() returns void language plpgsql as
$f$ begin reset role; perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.sub', '', true); perform set_config('request.jwt.claim.role', '', true); end $f$;
create function pg_temp.q_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlstate; end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text) returns uuid language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'ccp1-' || p_label || '-' || substr(v::text, 1, 8) || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, 'patient'::public.user_role, 'Ccp ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone, full_name = excluded.full_name;
  update public.profiles set organisation_id = p_org where id = v;
  return v;
end $f$;
-- a real invite and a real acceptance, so the membership is made exactly the way the product makes it
create function pg_temp.join_with(p_pat uuid, p_sup uuid, p_perms text[]) returns uuid language plpgsql as $f$
declare r text; v_tok text;
begin
  r := pg_temp.q_as(p_pat, format($q$select public.create_care_circle_invite('email', %L, 'Daughter', %L::text[])::text$q$,
                                  (select email from auth.users where id = p_sup), p_perms::text));
  if r like 'ERR:%' then raise exception 'fixture: invite failed %', r; end if;
  v_tok := r::jsonb ->> 'token';
  r := pg_temp.q_as(p_sup, format($q$select public.accept_care_circle_invite(%L)::text$q$, v_tok));
  if r like 'ERR:%' then raise exception 'fixture: accept failed %', r; end if;
  return (select id from public.care_circle_members where patient_id = p_pat and supporter_id = p_sup and state = 'active');
end $f$;
create function pg_temp.module(p_key text, p_on boolean, p_by uuid) returns void language sql as
$$ update public.platform_modules set is_enabled = p_on, enabled_at = case when p_on then now() end, enabled_by = case when p_on then p_by end,
          activation_note = case when p_on then 'care_circle_p1 proof' end where key = p_key $$;
create function pg_temp.consent(p_pat uuid, p_on boolean) returns void language sql as
$$ select private.record_consent_cell(p_pat, (select organisation_id from public.profiles where id = p_pat), true, 'vitals', 'care_circle_sharing',
                                     p_on, 'patient', null, p_pat) $$;
create function pg_temp.view(p_sup uuid, p_pat uuid) returns jsonb language sql as
$$ select pg_temp.q_as(p_sup, format('select public.circle_supporter_view(%L::uuid)::text', p_pat))::jsonb $$;
create function pg_temp.digest(p_sup uuid, p_pat uuid) returns jsonb language sql as
$$ select pg_temp.q_as(p_sup, format('select public.circle_weekly_digest(%L::uuid)::text', p_pat))::jsonb $$;
create function pg_temp.hist(p_member uuid) returns text language sql as
$$ select string_agg(array_to_string(changes, '+') || ':' || actor_role, ',' order by created_at, id) from public.care_circle_permission_history where member_id = p_member $$;

do $$
declare
  v_org uuid := (select id from public.organisations order by created_at limit 1);
  v_lagos date := (now() at time zone 'Africa/Lagos')::date;
  pat uuid; sup uuid; sup2 uuid; m uuid; m2 uuid; v_med uuid; v_staff uuid; v_appt uuid; v jsonb; r text; d text; v_n integer;
  v_all text[] := array['adherence_summary', 'weekly_bp_trend', 'appointments', 'red_alerts', 'doctor_note'];
begin
  pat := pg_temp.mkuser(v_org, 'patient'); sup := pg_temp.mkuser(v_org, 'daughter'); sup2 := pg_temp.mkuser(v_org, 'son');
  m := pg_temp.join_with(pat, sup, v_all);
  perform pg_temp.module('care_circle_digest', true, pat);
  perform pg_temp.module('care_circle_missed_dose_alert', true, pat);
  perform pg_temp.module('care_circle_checkin_window', false, pat);
  -- fixtures: doses, readings, a monthly report, an ordinary future appointment
  insert into public.medications (organisation_id, patient_id, drug_name, dose, frequency, is_active, source, schedule_times, created_at)
  values (v_org, pat, 'Ccp Test Drug', '5mg', 'once daily', true, 'clinician', '["10:00"]'::jsonb, now() - interval '5 days') returning id into v_med;
  insert into public.medication_logs (organisation_id, patient_id, medication_id, status, scheduled_for_date, scheduled_time)
  values (v_org, pat, v_med, 'taken', v_lagos - 1, '10:00'), (v_org, pat, v_med, 'taken', v_lagos - 2, '10:00');
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, taken_at, source)
  values (v_org, pat, 'blood_pressure', 130, 85, now() - interval '1 day', 'device'), (v_org, pat, 'blood_pressure', 132, 84, now() - interval '2 days', 'device');
  insert into public.monthly_reports (organisation_id, patient_id, month, payload, config_version, is_test)
  values (v_org, pat, date_trunc('month', v_lagos)::date, '{"enough_readings": true, "average": {"systolic": 131, "diastolic": 84}, "adherence_pct": 90}'::jsonb, 1, true);
  update public.care_circle_members set monthly_report_shared = true, monthly_report_shared_at = now(), missed_dose_alert = true where id = m;
  insert into public.appointments (organisation_id, patient_id, scheduled_for, ends_at, status, appointment_type, consultation_method)
  values (v_org, pat, now() + interval '3 days', now() + interval '3 days 30 minutes', 'scheduled', 'gp', 'telemedicine');

  -- A. consent in force: everything flows
  perform pg_temp.consent(pat, true);
  v := pg_temp.view(sup, pat);
  perform pg_temp.ck('A1 consent on: view has doses, BP trend and the monthly report', 'true/true/1',
    (v ? 'adherence')::text || '/' || (v ? 'bp_trend')::text || '/' || jsonb_array_length(coalesce(v -> 'monthly', '[]'))::text);
  v := pg_temp.digest(sup, pat);
  perform pg_temp.ck('A2 consent on: digest has doses and readings', 'true/true', (v ? 'doses')::text || '/' || (v ? 'readings')::text);
  perform pg_temp.ck('A3 consent on: the missed-dose sweep nudges', '1', private.sweep_circle_missed_doses((v_lagos + time '10:35'))::text);
  perform pg_temp.ck('A4 consent on: the supporter sees the nudge in their list', '1',
    jsonb_array_length(pg_temp.q_as(sup, 'select public.circle_recent_nudges()::text')::jsonb)::text);

  -- A. the patient withdraws the sharing consent
  perform pg_temp.consent(pat, false);
  v := pg_temp.view(sup, pat);
  perform pg_temp.ck('A5 consent withdrawn: no doses, no BP trend, no monthly report in the view', 'false/false/false',
    (v ? 'adherence')::text || '/' || (v ? 'bp_trend')::text || '/' || (v ? 'monthly')::text);
  perform pg_temp.ck('A6 consent withdrawn: appointments (not vitals) still shown', 'true', (v ? 'appointments')::text);
  v := pg_temp.digest(sup, pat);
  perform pg_temp.ck('A7 consent withdrawn: digest has no doses and no readings', 'false/false', (v ? 'doses')::text || '/' || (v ? 'readings')::text);
  perform pg_temp.ck('A8 consent withdrawn: the nudge list is empty', '[]', pg_temp.q_as(sup, 'select public.circle_recent_nudges()::text'));
  delete from public.care_circle_missed_dose_alerts where member_id = m;
  delete from public.notifications where template = 'circle_gentle_nudge' and recipient_id = sup;
  perform pg_temp.ck('A9 consent withdrawn: the sweep sends no nudge', '0', private.sweep_circle_missed_doses((v_lagos + time '10:35'))::text);
  -- a member who may see only vitals-derived blocks gets no weekly notice at all (nothing would be in it)
  m2 := pg_temp.join_with(pat, sup2, array['weekly_bp_trend']);
  perform pg_temp.consent(pat, false);   -- an accepted invite records consent again (existing S42 behaviour); withdraw once more
  delete from public.notifications where template = 'circle_digest';
  perform private.send_circle_digests();
  perform pg_temp.ck('A10 consent withdrawn: a BP-only supporter gets no weekly notice; the other still does', '0/1',
    (select count(*)::text from public.notifications where template = 'circle_digest' and recipient_id = sup2) || '/' ||
    (select count(*)::text from public.notifications where template = 'circle_digest' and recipient_id = sup and channel = 'in_app'));
  perform pg_temp.ck('A11 the weekly notice names a real source table and carries nothing', 'care_circle_members/{}',
    (select source_table || '/' || payload::text from public.notifications where template = 'circle_digest' and recipient_id = sup limit 1));

  -- B. sensitive appointments
  perform pg_temp.consent(pat, true);
  insert into public.appointments (organisation_id, patient_id, scheduled_for, ends_at, status, appointment_type, consultation_method)
  values (v_org, pat, now() + interval '1 day', now() + interval '1 day 30 minutes', 'scheduled', 'therapy', 'telemedicine');
  insert into public.appointments (organisation_id, patient_id, scheduled_for, ends_at, status, appointment_type, consultation_method, reason)
  values (v_org, pat, now() + interval '2 days', now() + interval '2 days 30 minutes', 'scheduled', 'gp', 'telemedicine', 'contraception review');
  v := pg_temp.view(sup, pat);
  perform pg_temp.ck('B1 the next appointment shown is the ordinary one (day 3), not therapy (day 1) or contraception (day 2)', 'true',
    ((v #>> '{appointments,next_at}')::timestamptz > now() + interval '2 days 12 hours')::text);
  v := pg_temp.digest(sup, pat);
  perform pg_temp.ck('B2 the digest shows the same ordinary appointment', 'true', ((v #>> '{appointments,next_at}')::timestamptz > now() + interval '2 days 12 hours')::text);
  insert into public.appointments (organisation_id, patient_id, scheduled_for, ends_at, status, appointment_type, consultation_method, no_show_marked_at)
  values (v_org, pat, now() - interval '3 days', now() - interval '3 days' + interval '30 minutes', 'no_show', 'therapy', 'telemedicine', now() - interval '3 days');
  perform pg_temp.ck('B3 a missed therapy appointment is not counted as missed', '0', pg_temp.view(sup, pat) #>> '{appointments,missed_30d}');

  -- C. help alert while the circle's alerts are paused. First, an alert sent BEFORE the pause stays hidden by the pause (review fix).
  r := pg_temp.q_as(pat, 'select public.send_circle_help_alert()::text');
  update public.care_circle_help_alerts set created_at = now() - interval '20 minutes' where id = (r::jsonb ->> 'alert_id')::uuid;
  perform pg_temp.q_as(pat, 'select public.pause_care_circle(true)::text');
  perform pg_temp.ck('C0 an alert sent before the pause cannot be opened while paused', 'ERR:42501',
    pg_temp.q_as(sup, format('select public.circle_help_alert_view(%L::uuid)::text', pat)));
  delete from public.notifications where template = 'circle_help_tap';
  r := pg_temp.q_as(pat, 'select public.send_circle_help_alert()::text');
  perform pg_temp.ck('C1 paused: the help alert is still sent, and says the circle is paused', '1/true',
    (r::jsonb ->> 'recipients_told') || '/' || (r::jsonb ->> 'circle_paused'));
  perform pg_temp.ck('C2 paused: the supporter is told', '1', (select count(*)::text from public.notifications where recipient_id = sup and template = 'circle_help_tap' and channel = 'in_app'));
  r := pg_temp.q_as(sup, format('select public.circle_help_alert_view(%L::uuid)::text', pat));
  perform pg_temp.ck('C3 paused: the supporter can open the alert they were told about', 'true', (r like '{%')::text);
  perform pg_temp.ck('C4 paused: the son (no red_alerts) still cannot', 'ERR:42501', pg_temp.q_as(sup2, format('select public.circle_help_alert_view(%L::uuid)::text', pat)));
  perform pg_temp.ck('C5 paused: the rest of the circle stays hidden', 'ERR:P0002', pg_temp.q_as(sup, format('select public.circle_weekly_digest(%L::uuid)::text', pat)));
  perform pg_temp.q_as(pat, 'select public.resume_care_circle()::text');

  -- D. a removed supporter cannot read their own row
  perform pg_temp.ck('D1 an active supporter reads their own row', '1', pg_temp.q_as(sup2, 'select count(*)::text from public.care_circle_members'));
  perform pg_temp.q_as(pat, format('select public.revoke_care_circle_member(%L::uuid)::text', m2));
  perform pg_temp.ck('D2 once removed, the supporter reads nothing', '0', pg_temp.q_as(sup2, 'select count(*)::text from public.care_circle_members'));
  perform pg_temp.ck('D3 the patient still reads the removed row', '1',
    pg_temp.q_as(pat, format('select count(*)::text from public.care_circle_members where id = %L and state = ''revoked''', m2)));

  -- E. permission history
  perform pg_temp.q_as(pat, format('select public.update_care_circle_member(%L::uuid, %L::text[])::text', m, array['appointments', 'red_alerts', 'doctor_note', 'adherence_summary']));
  perform pg_temp.q_as(pat, format('select public.update_care_circle_member(%L::uuid, %L::text[])::text', m, array['appointments', 'red_alerts', 'doctor_note']));
  perform pg_temp.ck('E1 the daughter''s history: added by her acceptance, two changes by the patient inside one hour, both kept', 'true',
    (pg_temp.hist(m) like 'added:supporter,%permissions_changed%:patient,permissions_changed%:patient')::text);
  perform pg_temp.ck('E2 the son''s history: added, then revoked by the patient', 'added:supporter,revoked:patient', pg_temp.hist(m2));
  perform pg_temp.ck('E3 the previous permissions are kept with each change', 'appointments,red_alerts,doctor_note,adherence_summary',
    (select array_to_string(previous_permissions, ',') from public.care_circle_permission_history where member_id = m order by created_at desc, id desc limit 1));
  perform pg_temp.ck('E4 the pause and the resume are recorded as the patient''s', 'paused:patient,resumed:patient',
    (select string_agg(array_to_string(changes, '+') || ':' || actor_role, ',' order by created_at, id) from public.care_circle_permission_history where patient_id = pat and member_id is null and note_id is null));
  v_n := (select count(*) from public.care_circle_permission_history where patient_id = pat);
  perform pg_temp.ck('E5 the patient reads their whole history', v_n::text,
    jsonb_array_length(pg_temp.q_as(pat, 'select public.my_circle_sharing_history(200)::text')::jsonb)::text);
  perform pg_temp.ck('E6 a supporter reads none of it, by table or by function', '0/[]',
    pg_temp.q_as(sup, 'select count(*)::text from public.care_circle_permission_history') || '/' || pg_temp.q_as(sup, 'select public.my_circle_sharing_history()::text'));
  perform pg_temp.ck('E7 nobody can change a history row', 'ERR:42501',
    pg_temp.q_as(pat, format('update public.care_circle_permission_history set actor_role = ''system'' where patient_id = %L returning ''x''', pat)));
  begin
    update public.care_circle_permission_history set actor_role = 'system' where patient_id = pat;
    r := 'changed';
  exception when others then r := 'ERR:' || sqlstate;
  end;
  perform pg_temp.ck('E8 not even the database owner', 'ERR:42501', r);
  perform pg_temp.ck('E9 anon cannot read the history', 'false', has_table_privilege('anon', 'public.care_circle_permission_history', 'SELECT')::text);

  -- F. list readers ignore an inactive supporter account
  insert into public.care_circle_check_ins (organisation_id, patient_id, requested_by, state, attempts, requested_at, window_ends_at, resolved_at, is_test, called_by)
  values (v_org, pat, sup, 'escalated', 1, now() - interval '10 minutes', now() - interval '5 minutes', now() - interval '5 minutes', true, '{}');
  perform pg_temp.ck('F1 an active supporter sees the unanswered check-in', '1', jsonb_array_length(pg_temp.q_as(sup, 'select public.circle_unanswered_check_ins()::text')::jsonb)::text);
  update public.profiles set is_active = false where id = sup;
  perform pg_temp.ck('F2 the same supporter, account no longer active, sees nothing', '[]', pg_temp.q_as(sup, 'select public.circle_unanswered_check_ins()::text'));
  update public.profiles set is_active = true where id = sup;

  -- G. "a note from your doctor is waiting" (written as the table owner, so the author policy is not in play; every trigger runs)
  insert into public.clinical_staff (organisation_id, full_name, active) values (v_org, 'Ccp Doctor', false) returning id into v_staff;
  select id into v_appt from public.appointments where patient_id = pat and appointment_type = 'gp' order by scheduled_for desc limit 1;
  insert into public.family_doctor_notes (organisation_id, patient_id, author_staff_id, appointment_id, body, is_test)
  values (v_org, pat, v_staff, v_appt, 'Ccp note for the family.', true);
  perform pg_temp.ck('G1 the patient is told a note is waiting (in-app and push), and the notice carries nothing', '2/{}',
    (select count(*)::text from public.notifications where recipient_id = pat and template = 'family_note_waiting') || '/' ||
    (select string_agg(distinct payload::text, ',') from public.notifications where recipient_id = pat and template = 'family_note_waiting'));
  update public.care_circle_members set permissions = array_remove(permissions, 'doctor_note') where id = m;
  insert into public.family_doctor_notes (organisation_id, patient_id, author_staff_id, appointment_id, body, is_test)
  values (v_org, pat, v_staff, v_appt, 'Ccp second note.', true);
  perform pg_temp.ck('G2 with nobody able to receive a note, the patient is not told again', '2',
    (select count(*)::text from public.notifications where recipient_id = pat and template = 'family_note_waiting'));
  update public.care_circle_members set permissions = permissions || array['doctor_note'] where id = m;
  r := pg_temp.q_as(pat, format('select public.set_family_note_shared(%L::uuid, true)::text',
                                (select id from public.family_doctor_notes where patient_id = pat order by created_at limit 1)));
  perform pg_temp.ck('G3 releasing a note to the circle is recorded in the history', 'true/doctor_note_shared:patient', r || '/' ||
    (select array_to_string(changes, '+') || ':' || actor_role from public.care_circle_permission_history where patient_id = pat and note_id is not null));

  -- ---------------- SABOTAGE: each block undoes itself by raising ----------------
  perform pg_temp.consent(pat, false);
  -- m now holds appointments, red_alerts, doctor_note; give it adherence again for a meaningful sabotage
  update public.care_circle_members set permissions = permissions || array['adherence_summary'] where id = m;
  begin
    create or replace function private.circle_consented_permissions(p_patient uuid, p_permissions text[]) returns text[]
      language sql stable security definer set search_path = '' as $f$ select p_permissions $f$;
    v := pg_temp.digest(sup, pat);
    raise exception using errcode = 'P0099';
  exception when sqlstate 'P0099' then null;
  end;
  perform pg_temp.sk('S1 consent helper passes everything: withdrawn consent still shows doses (flips A7)', 'true', (v ? 'doses')::text);
  perform pg_temp.ck('S1 after undo the doses are hidden again', 'false', (pg_temp.digest(sup, pat) ? 'doses')::text);
  perform pg_temp.consent(pat, true);
  begin
    create or replace function private.circle_appointment_shareable(p_type public.appointment_type, p_reason text, p_service text) returns boolean
      language sql immutable set search_path = '' as $f$ select true $f$;
    v := pg_temp.view(sup, pat);
    raise exception using errcode = 'P0099';
  exception when sqlstate 'P0099' then null;
  end;
  perform pg_temp.sk('S2 appointment filter passes everything: the therapy appointment IS shown (flips B1)', 'true',
    ((v #>> '{appointments,next_at}')::timestamptz < now() + interval '1 day 12 hours')::text);
  perform pg_temp.q_as(pat, 'select public.pause_care_circle(true)::text');
  begin
    select pg_get_functiondef('public.circle_help_alert_view(uuid)'::regprocedure) into d;
    d := replace(d, 'if m.id is null and a.id is not null', 'if false and a.id is not null');
    if d = pg_get_functiondef('public.circle_help_alert_view(uuid)'::regprocedure) then raise exception 'sabotage S3 did not change the function'; end if;
    execute d;
    r := pg_temp.q_as(sup, format('select public.circle_help_alert_view(%L::uuid)::text', pat));
    raise exception using errcode = 'P0099';
  exception when sqlstate 'P0099' then null;
  end;
  perform pg_temp.sk('S3 help-alert fallback removed: the paused supporter cannot open the alert (flips C3)', 'ERR:42501', r);
  perform pg_temp.q_as(pat, 'select public.resume_care_circle()::text');
  begin
    drop policy care_circle_members_own on public.care_circle_members;
    create policy care_circle_members_own on public.care_circle_members for select to authenticated
      using (patient_id = (select auth.uid()) or supporter_id = (select auth.uid()));
    r := pg_temp.q_as(sup2, 'select count(*)::text from public.care_circle_members');
    raise exception using errcode = 'P0099';
  exception when sqlstate 'P0099' then null;
  end;
  perform pg_temp.sk('S4 old policy restored: the removed supporter reads their revoked row (flips D2)', '1', r);
  begin
    drop trigger care_circle_members_history on public.care_circle_members;
    perform pg_temp.q_as(pat, format('select public.update_care_circle_member(%L::uuid, %L::text[])::text', m, array['appointments']));
    r := (select count(*)::text from public.care_circle_permission_history where member_id = m and 'appointments' = all (permissions) and cardinality(permissions) = 1);
    raise exception using errcode = 'P0099';
  exception when sqlstate 'P0099' then null;
  end;
  perform pg_temp.sk('S5 history trigger dropped: a permission change leaves no history row', '0', r);
end $$;

select phase, check_name, expected, actual, case when expected is not distinct from actual then 'PASS' else 'FAIL' end as verdict
  from results order by phase, check_name;
do $$
declare n integer;
begin
  select count(*) into n from results where expected is distinct from actual;
  if n > 0 then raise exception 'care_circle_p1_privacy: % check(s) did not hold', n; end if;
  if (select count(*) from results) < 40 then raise exception 'care_circle_p1_privacy: fewer checks ran than expected'; end if;
end $$;
rollback;
