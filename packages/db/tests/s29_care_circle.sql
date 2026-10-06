-- S29 proof: Care Circle (migration *_s29_care_circle.sql). One rolled-back transaction.
-- Proves: the invite is a one-time hashed token bound to a verified contact and every failure looks the same; permissions are
-- off until ticked; SAFETY CASE 21 (a supporter without weekly_bp_trend cannot see readings through any API: not the raw tables,
-- not the views, not the supporter function) and a supporter with it still reads weekly averages only; revoke and expiry end access
-- at once; the neutral red alert reaches only members holding red_alerts, never anyone revoked or expired, and a failed alert
-- opens an incident without stopping the page; pay for a loved one needs pay_for_care and opens no record access; RLS, grants,
-- config validation.
-- SABOTAGE (each must flip a check): the weekly_bp_trend gate removed, the red_alerts filter removed, the pay_for_care gate removed.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;
create temp table fxt(k text primary key, v text) on commit drop;
grant all on fxt to public;

create function pg_temp.ck(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('real', p_name, p_expected, p_actual) $$;
create function pg_temp.f(p text) returns uuid language sql as $$ select v from fx where k = p $$;
create function pg_temp.setf(p text, p_v uuid) returns void language sql as
$$ insert into fx values (p, p_v) on conflict (k) do update set v = excluded.v $$;
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
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlerrm; end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.try_anon(p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  perform set_config('request.jwt.claim.role', 'anon', true);
  set local role anon;
  begin execute p_sql; r := 'ok'; exception when others then r := sqlstate; end;
  reset role;
  perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.role', '', true);
  return r;
end $f$;
create function pg_temp.svc(p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  perform set_config('request.jwt.claim.role', 'service_role', true);
  set local role service_role;
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlerrm; end;
  reset role;
  perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.role', '', true);
  return r;
end $f$;
-- a patient-role account (patients and supporters are both role patient); a supporter-only account has receives_care false
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text, p_support boolean default false) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's29-' || p_label || '-' || substr(v::text, 1, 8) || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'S29 ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone, full_name = excluded.full_name;
  if p_support then update public.profiles set receives_care = false where id = v; end if;
  return v;
end $f$;
create function pg_temp.email_of(p_uid uuid) returns text language sql as $$ select email from auth.users where id = p_uid $$;

-- create an invite as a patient and keep its token
create function pg_temp.invite(p_pat uuid, p_kind text, p_contact text, p_perms text[], p_label text) returns text language plpgsql as
$f$ declare r text; j jsonb;
begin
  r := pg_temp.q_as(p_pat, format($q$select public.create_care_circle_invite(%L, %L, 'Daughter', %L::text[])::text$q$, p_kind, p_contact, p_perms::text));
  if r like 'ERR:%' then return r; end if;
  j := r::jsonb;
  insert into fxt values ('tok-' || p_label, j ->> 'token') on conflict (k) do update set v = excluded.v;
  insert into fx values ('inv-' || p_label, (j ->> 'invite_id')::uuid) on conflict (k) do update set v = excluded.v;
  return 'ok';
end $f$;
create function pg_temp.tok(p_label text) returns text language sql as $$ select v from fxt where k = 'tok-' || p_label $$;
create function pg_temp.join_as(p_uid uuid, p_label text) returns text language sql as
$$ select pg_temp.q_as(p_uid, format($q$select public.accept_care_circle_invite(%L)::text$q$, pg_temp.tok(p_label))) $$;
create function pg_temp.view_as(p_uid uuid, p_patient uuid) returns text language sql as
$$ select pg_temp.q_as(p_uid, format($q$select public.circle_supporter_view(%L)::text$q$, p_patient)) $$;
create function pg_temp.member(p_pat uuid, p_sup uuid) returns uuid language sql as
$$ select id from public.care_circle_members where patient_id = p_pat and supporter_id = p_sup order by (state = 'active') desc, created_at desc limit 1 $$;
create function pg_temp.join_with(p_pat uuid, p_sup uuid, p_perms text[], p_label text) returns text language plpgsql as
$f$ declare r text;
begin
  r := pg_temp.invite(p_pat, 'email', pg_temp.email_of(p_sup), p_perms, p_label);
  if r <> 'ok' then return r; end if;
  return pg_temp.join_as(p_sup, p_label);
end $f$;

-- a fresh red triage event for a patient (a shadow event: a fixture, it never pages anyone by itself)
create function pg_temp.newte(p_patient uuid) returns uuid language plpgsql as
$f$ declare v_id uuid; v_rs record;
begin
  select id, code, version into v_rs from public.triage_rule_sets order by version desc limit 1;
  insert into public.triage_events (organisation_id, patient_id, trigger_type, trigger_id, grade, rule_id, rule_set_id, rule_set_code, rule_set_version, rule_set_status, actions, shadow, is_test, basis)
  select organisation_id, p_patient, 'observation', gen_random_uuid(), 'red', 'R1', v_rs.id, v_rs.code, v_rs.version, 'draft',
         '[{"kind":"page_on_call"}]'::jsonb, true, true, gen_random_uuid()::text from public.profiles where id = p_patient
  returning id into v_id;
  return v_id;
end $f$;
-- a root page (nobody on the rota: an escalation row at level 2) or a child of one
create function pg_temp.newpage(p_patient uuid, p_te uuid, p_parent uuid default null) returns uuid language plpgsql as
$f$ declare v_id uuid;
begin
  perform set_config('tarragon.paging_write', 'on', true);
  insert into public.pages (organisation_id, patient_id, triage_event_id, parent_page_id, role, escalation_level, config_version, is_test, no_cover)
  select organisation_id, p_patient, p_te, p_parent, 'escalation', 2, 1, true, p_parent is null from public.profiles where id = p_patient
  returning id into v_id;
  perform set_config('tarragon.paging_write', 'off', true);
  return v_id;
end $f$;

do $$
declare
  v_org uuid; v_admin uuid; v_pat uuid; v_pat2 uuid; v_a uuid; v_b uuid; v_c uuid; v_d uuid; v_other uuid; v_dep uuid; v_unverified uuid;
  v_ph uuid; v_e uuid; r text; v_swept integer; v_med uuid; v_te uuid; v_page uuid; v_item uuid; v_ref text; v_ord uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  v_pat := pg_temp.mkuser(v_org, 'patient', 'patient');
  v_pat2 := pg_temp.mkuser(v_org, 'patient2', 'patient');
  v_a := pg_temp.mkuser(v_org, 'sup-a', 'patient', true);
  v_b := pg_temp.mkuser(v_org, 'sup-b', 'patient', true);
  v_c := pg_temp.mkuser(v_org, 'sup-c', 'patient', true);
  v_d := pg_temp.mkuser(v_org, 'sup-d', 'patient', true);
  v_other := pg_temp.mkuser(v_org, 'other', 'patient', true);
  v_unverified := pg_temp.mkuser(v_org, 'unverified', 'patient', true);
  v_ph := pg_temp.mkuser(v_org, 'phone-sup', 'patient', true);
  v_dep := pg_temp.mkuser(v_org, 'child', 'patient');
  v_e := pg_temp.mkuser(v_org, 'sup-e', 'patient', true);
  perform pg_temp.setf('e', v_e);
  update public.profiles set is_dependent_account = true where id = v_dep;
  update auth.users set email_confirmed_at = null where id = v_unverified;
  update auth.users set phone = '2348031234567', phone_confirmed_at = now() where id = v_ph;
  perform pg_temp.setf('pat', v_pat); perform pg_temp.setf('a', v_a); perform pg_temp.setf('b', v_b); perform pg_temp.setf('c', v_c);
  perform pg_temp.setf('d', v_d); perform pg_temp.setf('other', v_other); perform pg_temp.setf('pat2', v_pat2); perform pg_temp.setf('org', v_org);
  perform pg_temp.setf('admin', v_admin);

  -- 1. Shape, grants, config ---------------------------------------------------------------------------------------
  perform pg_temp.ck('the circle tables have RLS on', '2',
    (select count(*)::text from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname in ('care_circle_invites', 'care_circle_members') and c.relrowsecurity));
  perform pg_temp.ck('anon holds nothing on the circle tables', '0',
    (select count(*)::text from information_schema.role_table_grants where table_schema = 'public' and table_name in ('care_circle_invites', 'care_circle_members', 'care_circle_config') and grantee in ('anon', 'PUBLIC')));
  perform pg_temp.ck('authenticated cannot write the circle tables', '0',
    (select count(*)::text from information_schema.role_table_grants where table_schema = 'public' and table_name in ('care_circle_invites', 'care_circle_members') and grantee = 'authenticated' and privilege_type <> 'SELECT'));
  perform pg_temp.ck('no hash column is readable by authenticated', 'false',
    (has_column_privilege('authenticated', 'public.care_circle_invites', 'token_hash', 'SELECT') or has_column_privilege('authenticated', 'public.care_circle_invites', 'invitee_hash', 'SELECT'))::text);
  perform pg_temp.ck('anon cannot create an invite', '42501', pg_temp.try_anon($q$select public.create_care_circle_invite('email', 'a@example.invalid', 'Son', array['red_alerts'])$q$));
  perform pg_temp.ck('anon cannot read the supporter view', '42501', pg_temp.try_anon(format($q$select public.circle_supporter_view(%L)$q$, v_pat)));
  perform pg_temp.ck('anon cannot accept an invite', '42501', pg_temp.try_anon($q$select public.accept_care_circle_invite('x')$q$));
  begin
    insert into public.care_circle_config (version, is_active, effective_from, rules) values (98, false, current_date, '{"invite_ttl_hours":72}');
    perform pg_temp.ck('an incomplete config is refused by the database', '23514', 'accepted');
  exception when check_violation then
    perform pg_temp.ck('an incomplete config is refused by the database', '23514', '23514');
  end;
  begin
    insert into public.care_circle_config (version, is_active, effective_from, rules)
      values (97, false, current_date, '{"invite_ttl_hours":0,"default_grant_days":365,"max_invites_per_day":5,"max_members":8,"max_attempts":5,"view_weeks":8}');
    perform pg_temp.ck('a zero limit is refused by the database', '23514', 'accepted');
  exception when check_violation then
    perform pg_temp.ck('a zero limit is refused by the database', '23514', '23514');
  end;

  -- 2. Making an invite --------------------------------------------------------------------------------------------
  perform pg_temp.ck('a supporter-only account cannot make invites', 'true',
    (pg_temp.invite(v_a, 'email', 'x@example.invalid', array['red_alerts'], 'sup') like '%circle_not_authorised%')::text);
  perform pg_temp.ck('a child account cannot make invites', 'true',
    (pg_temp.invite(v_dep, 'email', 'x@example.invalid', array['red_alerts'], 'dep') like '%circle_not_authorised%')::text);
  perform pg_temp.ck('permissions cannot be empty', 'true', (pg_temp.invite(v_pat, 'email', 'x@example.invalid', array[]::text[], 'e0') like '%invite_permissions_invalid%')::text);
  perform pg_temp.ck('a legacy or unknown permission is refused', 'true', (pg_temp.invite(v_pat, 'email', 'x@example.invalid', array['view_results'], 'e1') like '%invite_permissions_invalid%')::text);
  perform pg_temp.ck('a bad email is refused', 'true', (pg_temp.invite(v_pat, 'email', 'not-an-email', array['red_alerts'], 'e2') like '%invite_contact_invalid%')::text);
  perform pg_temp.ck('a bad phone is refused', 'true', (pg_temp.invite(v_pat, 'phone', '123', array['red_alerts'], 'e3') like '%invite_contact_invalid%')::text);
  perform pg_temp.ck('you cannot invite yourself', 'true', (pg_temp.invite(v_pat, 'email', pg_temp.email_of(v_pat), array['red_alerts'], 'e4') like '%invite_self%')::text);
  perform pg_temp.ck('nothing was stored by the refused attempts', '0', (select count(*)::text from public.care_circle_invites where patient_id = v_pat));

  perform pg_temp.ck('a valid invite is made', 'ok', pg_temp.invite(v_pat, 'email', pg_temp.email_of(v_a), array['adherence_summary'], 'a'));
  perform pg_temp.ck('the token is stored only as a hash', 'true',
    (select (token_hash = encode(extensions.digest(pg_temp.tok('a'), 'sha256'), 'hex') and token_hash <> pg_temp.tok('a')) from public.care_circle_invites where id = pg_temp.f('inv-a'))::text);
  perform pg_temp.ck('the contact is never stored in clear', 'false',
    (select (to_jsonb(i)::text like '%' || split_part(pg_temp.email_of(v_a), '@', 1) || '%') from public.care_circle_invites i where id = pg_temp.f('inv-a'))::text);
  perform pg_temp.ck('the patient cannot read the token hash', 'true',
    (pg_temp.q_as(v_pat, 'select token_hash from public.care_circle_invites limit 1') like '%permission denied%')::text);
  perform pg_temp.ck('the patient sees a pending invite with a masked hint only', 'true',
    (pg_temp.q_as(v_pat, $q$select public.my_care_circle()::text$q$) like '%"hint"%' and pg_temp.q_as(v_pat, $q$select public.my_care_circle()::text$q$) not like '%' || split_part(pg_temp.email_of(v_a), '@', 1) || '%')::text);
  perform pg_temp.ck('an invite expires in 72 hours', 'true',
    (select (expires_at between now() + interval '71 hours' and now() + interval '73 hours') from public.care_circle_invites where id = pg_temp.f('inv-a'))::text);
  perform pg_temp.ck('another patient cannot see the invite', '0', pg_temp.q_as(v_pat2, 'select count(*)::text from public.care_circle_invites'));

  -- 3. Preview and accept: every failure looks the same -----------------------------------------------------------------
  perform pg_temp.ck('the right account sees who invited and what is asked', 'true',
    (pg_temp.q_as(v_a, format($q$select public.preview_care_circle_invite(%L)::text$q$, pg_temp.tok('a'))) like '%"ok": true%'
     and pg_temp.q_as(v_a, format($q$select public.preview_care_circle_invite(%L)::text$q$, pg_temp.tok('a'))) like '%adherence_summary%')::text);
  perform pg_temp.ck('the preview shows no contact', 'false',
    (pg_temp.q_as(v_a, format($q$select public.preview_care_circle_invite(%L)::text$q$, pg_temp.tok('a'))) like '%example.invalid%')::text);
  perform pg_temp.ck('an unknown token returns the same bare failure', '{"ok": false}', pg_temp.q_as(v_a, $q$select public.preview_care_circle_invite('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')::text$q$));
  perform pg_temp.ck('a stranger holding the token gets the same bare failure', '{"ok": false}',
    pg_temp.q_as(v_other, format($q$select public.preview_care_circle_invite(%L)::text$q$, pg_temp.tok('a'))));
  perform pg_temp.ck('a wrong-account try is counted', '1', (select attempts::text from public.care_circle_invites where id = pg_temp.f('inv-a')));
  perform pg_temp.ck('the patient themselves cannot accept their own invite', '{"ok": false}', pg_temp.join_as(v_pat, 'a'));
  perform pg_temp.ck('an account with an unverified email cannot accept', '{"ok": false}', pg_temp.join_as(v_unverified, 'a'));
  for i in 1..5 loop perform pg_temp.join_as(v_other, 'a'); end loop;
  perform pg_temp.ck('after five wrong tries the right account is refused too', '{"ok": false}', pg_temp.join_as(v_a, 'a'));
  perform pg_temp.ck('no member was made by any failure', '0', (select count(*)::text from public.care_circle_members where patient_id = v_pat));

  perform pg_temp.ck('a new invite is made', 'ok', pg_temp.invite(v_pat, 'email', pg_temp.email_of(v_a), array['adherence_summary'], 'a2'));
  update public.care_circle_invites set expires_at = now() - interval '1 minute' where id = pg_temp.f('inv-a2');
  perform pg_temp.ck('an expired token is refused', '{"ok": false}', pg_temp.join_as(v_a, 'a2'));
  perform pg_temp.ck('a third invite is made', 'ok', pg_temp.invite(v_pat, 'email', pg_temp.email_of(v_a), array['adherence_summary'], 'a3'));
  perform pg_temp.ck('making a new invite for the same person cancels the old one', '0',
    (select count(*)::text from public.care_circle_invites where patient_id = v_pat and invitee_hint = (select invitee_hint from public.care_circle_invites where id = pg_temp.f('inv-a3')) and state = 'pending' and id <> pg_temp.f('inv-a3')));
  perform pg_temp.ck('the supporter accepts', 'true', (pg_temp.join_as(v_a, 'a3') like '%"ok": true%')::text);
  perform pg_temp.ck('exactly one active member exists', '1', (select count(*)::text from public.care_circle_members where patient_id = v_pat and state = 'active'));
  perform pg_temp.ck('the member holds only the ticked permission', '{adherence_summary}', (select permissions::text from public.care_circle_members where id = pg_temp.member(v_pat, v_a)));
  perform pg_temp.ck('the grant lasts a year by default', 'true',
    (select (expires_at between now() + interval '364 days' and now() + interval '366 days') from public.care_circle_members where id = pg_temp.member(v_pat, v_a))::text);
  perform pg_temp.ck('the same token cannot be used twice', '{"ok": false}', pg_temp.join_as(v_a, 'a3'));
  perform pg_temp.ck('the patient is told someone joined, in the app, with no name', '1',
    (select count(*)::text from public.notifications where recipient_id = v_pat and template = 'circle_joined' and channel = 'in_app' and payload = '{}'::jsonb));
  perform pg_temp.ck('the acceptance is audited for the patient', '1',
    (select count(*)::text from public.care_access_events where patient_id = v_pat and kind = 'granted' and scope = 'care_circle'));

  perform pg_temp.ck('a phone invite (a local number) is made', 'ok', pg_temp.invite(v_pat, 'phone', '0803 123 4567', array['red_alerts', 'pay_for_care'], 'ph'));
  perform pg_temp.ck('the phone owner accepts', 'true', (pg_temp.join_as(v_ph, 'ph') like '%"ok": true%')::text);
  perform pg_temp.ck('the hint masks the number', 'true',
    (select (invitee_hint like '+234%' and invitee_hint like '%4567' and invitee_hint like '%•%') from public.care_circle_invites where id = pg_temp.f('inv-ph'))::text);

  -- 4. SAFETY CASE 21 -----------------------------------------------------------------------------------------------------
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, taken_at, source)
  values (v_org, v_pat, 'blood_pressure', 133, 83, now() - interval '1 day', 'manual'),
         (v_org, v_pat, 'blood_pressure', 141, 91, now() - interval '2 days', 'manual'),
         (v_org, v_pat, 'blood_pressure', 149, 95, now() - interval '3 days', 'manual');
  insert into public.medications (organisation_id, patient_id, drug_name) values (v_org, v_pat, 'S29 proof medicine') returning id into v_med;
  insert into public.medication_logs (organisation_id, patient_id, medication_id, status, scheduled_for_date, scheduled_time, logged_at)
  select v_org, v_pat, v_med, s::public.medication_log_status, (now() at time zone 'Africa/Lagos')::date - d, '08:00', now()
    from (values ('taken', 0), ('taken', 1), ('taken', 2), ('missed', 3)) t(s, d);
  insert into public.appointments (organisation_id, patient_id, scheduled_for, status, appointment_type, consultation_method, ends_at, no_show_marked_at)
  values (v_org, v_pat, now() + interval '3 days', 'confirmed', 'gp', 'in_person', now() + interval '3 days 30 minutes', null),
         (v_org, v_pat, now() - interval '5 days', 'no_show', 'gp', 'in_person', now() - interval '5 days' + interval '30 minutes', now() - interval '5 days');

  perform pg_temp.ck('safety 21: a member without weekly_bp_trend reads no vitals_readings row', '0',
    pg_temp.q_as(v_a, format('select count(*)::text from public.vitals_readings where patient_id = %L', v_pat)));
  perform pg_temp.ck('safety 21: and no row through the observations view', '0',
    pg_temp.q_as(v_a, format('select count(*)::text from public.observations where patient_id = %L', v_pat)));
  perform pg_temp.ck('safety 21: and no timeline row', '0', pg_temp.q_as(v_a, format('select count(*)::text from public.patient_timeline where patient_id = %L', v_pat)));
  perform pg_temp.ck('safety 21: and no symptoms', '0', pg_temp.q_as(v_a, format('select count(*)::text from public.symptoms where patient_id = %L', v_pat)));
  perform pg_temp.ck('a member reads no dose rows', '0', pg_temp.q_as(v_a, format('select count(*)::text from public.medication_logs where patient_id = %L', v_pat)));
  perform pg_temp.ck('a member reads no medicines', '0', pg_temp.q_as(v_a, format('select count(*)::text from public.medications where patient_id = %L', v_pat)));
  perform pg_temp.ck('a member reads no appointment rows', '0', pg_temp.q_as(v_a, format('select count(*)::text from public.appointments where patient_id = %L', v_pat)));
  perform pg_temp.ck('a member reads no booking requests', '0', pg_temp.q_as(v_a, format('select count(*)::text from public.booking_requests where profile_id = %L', v_pat)));
  perform pg_temp.ck('a member reads no vaccination adverse events', '0', pg_temp.q_as(v_a, format('select count(*)::text from public.vaccination_adverse_events where patient_id = %L', v_pat)));
  perform pg_temp.ck('a member reads not even the patient profile row', '0', pg_temp.q_as(v_a, format('select count(*)::text from public.profiles where id = %L', v_pat)));
  r := pg_temp.view_as(v_a, v_pat);
  perform pg_temp.ck('safety 21: the supporter function has no blood pressure block without the permission', 'false', (r like '%bp_trend%')::text);
  perform pg_temp.ck('safety 21: and not one reading value', 'false', (r like '%"systolic"%' or r ~ ': (133|141|149)[,}]')::text);
  perform pg_temp.ck('the permitted adherence block is there: 3 of 4 doses taken, 75 percent', 'true',
    ((r::jsonb -> 'adherence' ->> 'taken') = '3' and (r::jsonb -> 'adherence' ->> 'due') = '4' and (r::jsonb -> 'adherence' ->> 'percent') = '75')::text);
  perform pg_temp.ck('and no appointment block without the permission', 'false', (r like '%"appointments"%')::text);
  perform pg_temp.ck('the adherence block names no medicine', 'false', (r like '%medicine%' or r like '%S29 proof%')::text);
  perform pg_temp.ck('every read is audited so the patient can see who looked', 'true',
    (select count(*) >= 1 from public.care_access_events where patient_id = v_pat and kind = 'record_viewed' and scope = 'care_circle' and actor_profile_id = v_a)::text);
  perform pg_temp.ck('the patient sees the view log with the viewer name', 'true',
    (pg_temp.q_as(v_pat, 'select public.circle_view_log()::text') like '%S29 sup-a%')::text);

  perform pg_temp.ck('the patient adds weekly_bp_trend and appointments', 'true',
    pg_temp.q_as(v_pat, format($q$select public.update_care_circle_member(%L, array['adherence_summary', 'weekly_bp_trend', 'appointments'])::text$q$, pg_temp.member(v_pat, v_a))));
  r := pg_temp.view_as(v_a, v_pat);
  perform pg_temp.ck('with the permission the function returns a weekly average (141 over 90, 3 readings)', 'true',
    (exists (select 1 from jsonb_array_elements(r::jsonb -> 'bp_trend' -> 'weeks') w where (w ->> 'systolic') = '141' and (w ->> 'diastolic') = '90' and (w ->> 'readings') = '3'))::text);
  perform pg_temp.ck('and still no single reading, time or note in it', 'false',
    (r ~ ': (133|149)[,}]' or r like '%taken_at%' or r like '%"note"%')::text);
  perform pg_temp.ck('with the permission the raw table is STILL empty to the supporter', '0',
    pg_temp.q_as(v_a, format('select count(*)::text from public.vitals_readings where patient_id = %L', v_pat)));
  perform pg_temp.ck('the appointment block counts the missed visit and has no reason', 'true',
    ((r::jsonb -> 'appointments' ->> 'missed_30d') = '1' and not ((r::jsonb -> 'appointments') ? 'reason'))::text);
  perform pg_temp.ck('a member of one patient sees nothing of another', 'ERR:circle_not_found', pg_temp.view_as(v_a, v_pat2));
  perform pg_temp.ck('a stranger gets not found', 'ERR:circle_not_found', pg_temp.view_as(v_other, v_pat));
  perform pg_temp.ck('a supporter cannot change their own permissions', 'false',
    pg_temp.q_as(v_a, format($q$select public.update_care_circle_member(%L, array['adherence_summary', 'weekly_bp_trend', 'appointments', 'red_alerts', 'pay_for_care'])::text$q$, pg_temp.member(v_pat, v_a))));
  perform pg_temp.ck('a supporter cannot write the member table', 'true',
    (pg_temp.q_as(v_a, format($q$update public.care_circle_members set permissions = array['red_alerts'] where id = %L$q$, pg_temp.member(v_pat, v_a))) like '%permission denied%')::text);
  perform pg_temp.ck('a supporter reads only their own membership row', '1', pg_temp.q_as(v_a, 'select count(*)::text from public.care_circle_members'));
  perform pg_temp.ck('a stranger reads no membership rows', '0', pg_temp.q_as(v_other, 'select count(*)::text from public.care_circle_members'));

  -- 5. Expiry and revoke end access at the next call -----------------------------------------------------------------------
  update public.care_circle_members set expires_at = now() - interval '1 minute' where id = pg_temp.member(v_pat, v_a);
  perform pg_temp.ck('an expired membership is no membership', 'ERR:circle_not_found', pg_temp.view_as(v_a, v_pat));
  perform pg_temp.ck('and it is not in the supporter list', '[]', pg_temp.q_as(v_a, 'select public.my_supported_people()::text'));
  v_swept := private.expire_care_circle();
  perform pg_temp.ck('the expiry sweep marks it and logs it', 'true',
    (v_swept >= 1 and exists (select 1 from public.care_access_events where patient_id = v_pat and kind = 'expired' and scope = 'care_circle'))::text);
  perform pg_temp.ck('the swept member row says expired', 'expired', (select state from public.care_circle_members where id = pg_temp.member(v_pat, v_a)));
  perform pg_temp.invite(v_pat, 'email', pg_temp.email_of(v_a), array['adherence_summary', 'weekly_bp_trend'], 'a4');
  perform pg_temp.ck('a sixth invite in a day is refused', 'true',
    (pg_temp.invite(v_pat, 'email', pg_temp.email_of(v_a), array['adherence_summary'], 'a4b') like '%invite_rate_limited%')::text);
  update public.care_circle_config set rules = jsonb_set(rules, '{max_invites_per_day}', '50') where is_active;
  perform pg_temp.invite(v_pat, 'email', pg_temp.email_of(v_a), array['adherence_summary', 'weekly_bp_trend'], 'a4');
  perform pg_temp.ck('the supporter rejoins', 'true', (pg_temp.join_as(v_a, 'a4') like '%"ok": true%')::text);
  perform pg_temp.ck('a third person cannot remove them', 'false', pg_temp.q_as(v_other, format($q$select public.revoke_care_circle_member(%L)::text$q$, pg_temp.member(v_pat, v_a))));
  perform pg_temp.ck('the patient removes them', 'true', pg_temp.q_as(v_pat, format($q$select public.revoke_care_circle_member(%L)::text$q$, pg_temp.member(v_pat, v_a))));
  perform pg_temp.ck('after removal the very next read fails', 'ERR:circle_not_found', pg_temp.view_as(v_a, v_pat));
  perform pg_temp.ck('a supporter the patient removes is told nothing (no conflict at home)', '0',
    (select count(*)::text from public.notifications where recipient_id = v_a and template in ('circle_left', 'circle_changed')));
  perform pg_temp.ck('removal is audited', 'true',
    (select count(*) >= 1 from public.care_access_events where patient_id = v_pat and kind = 'revoked' and scope = 'care_circle')::text);
  perform pg_temp.join_with(v_pat, v_a, array['adherence_summary'], 'a5');
  perform pg_temp.ck('a supporter can leave', 'true', pg_temp.q_as(v_a, format($q$select public.revoke_care_circle_member(%L)::text$q$, pg_temp.member(v_pat, v_a))));
  perform pg_temp.ck('when a supporter leaves the patient is told, in the app, with no name', '1',
    (select count(*)::text from public.notifications where recipient_id = v_pat and template = 'circle_left' and channel = 'in_app' and payload = '{}'::jsonb));

  -- 6. Neutral red alert -----------------------------------------------------------------------------------------------------
  perform pg_temp.ck('member B (red_alerts) joins', 'true', (pg_temp.join_with(v_pat, v_b, array['red_alerts'], 'b') like '%"ok": true%')::text);
  perform pg_temp.ck('member C (adherence only) joins', 'true', (pg_temp.join_with(v_pat, v_c, array['adherence_summary'], 'c') like '%"ok": true%')::text);
  perform pg_temp.ck('member D (red_alerts) joins', 'true', (pg_temp.join_with(v_pat, v_d, array['red_alerts'], 'd') like '%"ok": true%')::text);
  update public.care_circle_members set expires_at = now() - interval '1 hour' where id = pg_temp.member(v_pat, v_d);
  perform pg_temp.ck('member A (removed earlier) is no member', '0',
    (select count(*)::text from public.care_circle_members where patient_id = v_pat and supporter_id = v_a and state = 'active'));
  v_te := pg_temp.newte(v_pat);
  v_page := pg_temp.newpage(v_pat, v_te);
  perform pg_temp.ck('member B gets the alert in the app', '1',
    (select count(*)::text from public.notifications where recipient_id = v_b and template = 'circle_check_in' and channel = 'in_app'));
  perform pg_temp.ck('member B gets the alert as a push too', '1',
    (select count(*)::text from public.notifications where recipient_id = v_b and template = 'circle_check_in' and channel = 'push'));
  perform pg_temp.ck('the alert is critical so quiet hours never hold it', 'critical',
    (select priority::text from public.notifications where recipient_id = v_b and template = 'circle_check_in' and channel = 'push'));
  perform pg_temp.ck('the alert carries nothing (INV-07): an empty payload', '{}',
    (select payload::text from public.notifications where recipient_id = v_b and template = 'circle_check_in' and channel = 'push'));
  perform pg_temp.ck('a member without red_alerts gets nothing', '0', (select count(*)::text from public.notifications where recipient_id = v_c and template = 'circle_check_in'));
  perform pg_temp.ck('an expired member gets nothing', '0', (select count(*)::text from public.notifications where recipient_id = v_d and template = 'circle_check_in'));
  perform pg_temp.ck('a removed supporter gets nothing', '0', (select count(*)::text from public.notifications where recipient_id = v_a and template = 'circle_check_in'));
  perform pg_temp.ck('a stranger gets nothing', '0', (select count(*)::text from public.notifications where recipient_id = v_other and template = 'circle_check_in'));
  perform pg_temp.ck('only the two members holding red_alerts were told, once per channel', '4',
    (select count(*)::text from public.notifications where source_table = 'pages' and source_id = v_page and template = 'circle_check_in'));
  perform pg_temp.ck('what member B opens shows a name and nothing clinical', 'true',
    (pg_temp.q_as(v_b, 'select public.circle_open_alerts()::text') like '%S29 patient%' and pg_temp.q_as(v_b, 'select public.circle_open_alerts()::text') not like '%grade%'
     and pg_temp.q_as(v_b, 'select public.circle_open_alerts()::text') not like '%red%')::text);
  perform pg_temp.ck('a member without red_alerts opens an empty list', '[]', pg_temp.q_as(v_c, 'select public.circle_open_alerts()::text'));
  perform pg_temp.newpage(v_pat, v_te, v_page);
  perform pg_temp.ck('a child page (backup, escalation) does not alert the family a second time', '1',
    (select count(*)::text from public.notifications where recipient_id = v_b and template = 'circle_check_in' and channel = 'in_app'));
  -- a failure in the alert is an incident and never stops the page
  create function pg_temp.boom() returns trigger language plpgsql as $b$ begin raise exception 'boom'; end $b$;
  create trigger zz_boom before insert on public.notifications for each row when (new.template = 'circle_check_in') execute function pg_temp.boom();
  v_page := pg_temp.newpage(v_pat, pg_temp.newte(v_pat));
  drop trigger zz_boom on public.notifications;
  perform pg_temp.ck('a failed alert never stops the page being created', '1', (select count(*)::text from public.pages where id = v_page));
  perform pg_temp.ck('a failed alert opens an incident for each member it could not reach', '2',
    (select count(*)::text from public.ops_incidents where external_reference like 'circle_alert_failed:' || v_page || '%'));

  -- one bad recipient must not take the others' alerts down with them
  perform pg_temp.ck('member E (red_alerts) joins', 'true', (pg_temp.join_with(v_pat, v_e, array['red_alerts'], 'e') like '%"ok": true%')::text);
  create function pg_temp.boom_e() returns trigger language plpgsql as $b$ begin if new.recipient_id = pg_temp.f('e') then raise exception 'boom'; end if; return new; end $b$;
  create trigger zz_boom_e before insert on public.notifications for each row when (new.template = 'circle_check_in') execute function pg_temp.boom_e();
  v_page := pg_temp.newpage(v_pat, pg_temp.newte(v_pat));
  drop trigger zz_boom_e on public.notifications;
  perform pg_temp.ck('the member whose alert failed gets none', '0', (select count(*)::text from public.notifications where recipient_id = v_e and source_id = v_page));
  perform pg_temp.ck('but the other member still gets theirs', '2', (select count(*)::text from public.notifications where recipient_id = v_b and source_id = v_page));
  perform pg_temp.ck('and the failure is an incident naming that member', '1',
    (select count(*)::text from public.ops_incidents where external_reference = 'circle_alert_failed:' || v_page || ':' || v_e));

  -- a check-in request stays on screen only for the configured window
  perform pg_temp.ck('a fresh request shows for member B', 'true', (pg_temp.q_as(v_b, 'select public.circle_open_alerts()::text') like '%S29 patient%')::text);
  perform set_config('tarragon.paging_write', 'on', true);
  update public.pages set sent_at = now() - interval '4 hours' where patient_id = v_pat;
  perform set_config('tarragon.paging_write', 'off', true);
  perform pg_temp.ck('after the window it is gone', '[]', pg_temp.q_as(v_b, 'select public.circle_open_alerts()::text'));

  -- the patient is told once, a week before someone's access ends, so an alert does not stop in silence
  update public.care_circle_members set expires_at = now() + interval '3 days' where id = pg_temp.member(v_pat, v_c);
  v_swept := private.expire_care_circle();
  v_swept := private.expire_care_circle();
  perform pg_temp.ck('the patient is told once that an access ends soon', '1',
    (select count(*)::text from public.notifications where recipient_id = v_pat and template = 'circle_expiring' and payload = '{}'::jsonb));
  perform pg_temp.ck('a member with months left causes no notice', '1',
    (select count(*)::text from public.notifications where template = 'circle_expiring' and source_table = 'care_circle_members'));
  perform pg_temp.ck('the supporter is told nothing about it', '0', (select count(*)::text from public.notifications where recipient_id = v_c and template = 'circle_expiring'));
  perform pg_temp.ck('the patient renews with a new date', 'true',
    pg_temp.q_as(v_pat, format($q$select public.update_care_circle_member(%L, array['adherence_summary'], now() + interval '365 days')::text$q$, pg_temp.member(v_pat, v_c))));
  perform pg_temp.ck('the renewed date is a year out', 'true',
    (select expires_at > now() + interval '360 days' from public.care_circle_members where id = pg_temp.member(v_pat, v_c))::text);

  -- re-sending to someone already waiting never needs a free place; a new person does
  update public.care_circle_config set rules = jsonb_set(rules, '{max_invites_per_day}', '500') where is_active;
  perform pg_temp.invite(v_pat, 'email', 'cap-one@example.invalid', array['red_alerts'], 'cap1');
  update public.care_circle_config set rules = jsonb_set(rules, '{max_members}', to_jsonb((select count(*) from public.care_circle_members where patient_id = v_pat and state = 'active' and expires_at > now())
                                                                                          + (select count(*) from public.care_circle_invites where patient_id = v_pat and state = 'pending' and expires_at > now()))) where is_active;
  perform pg_temp.ck('at the cap, re-sending to the person already waiting works', 'ok', pg_temp.invite(v_pat, 'email', 'cap-one@example.invalid', array['red_alerts'], 'cap1b'));
  perform pg_temp.ck('at the cap, a new person is refused', 'true', (pg_temp.invite(v_pat, 'email', 'cap-two@example.invalid', array['red_alerts'], 'cap2') like '%circle_full%')::text);
  update public.care_circle_config set rules = jsonb_set(rules, '{max_members}', '8') where is_active;
  -- an existing member takes a changed invite: still one active row, new permissions
  perform pg_temp.invite(v_pat, 'email', pg_temp.email_of(v_b), array['red_alerts', 'adherence_summary'], 'b2');
  perform pg_temp.ck('an existing member accepts a changed invite', 'true', (pg_temp.join_as(v_b, 'b2') like '%"ok": true%')::text);
  perform pg_temp.ck('still exactly one active row for them', '1', (select count(*)::text from public.care_circle_members where patient_id = v_pat and supporter_id = v_b and state = 'active'));
  perform pg_temp.ck('and the permissions are the new ones', '{red_alerts,adherence_summary}', (select permissions::text from public.care_circle_members where id = pg_temp.member(v_pat, v_b)));

  -- 7. Pay for a loved one -------------------------------------------------------------------------------------------------
  insert into public.catalog_items (organisation_id, code, kind, name_key, description_key, uses, grants_lead, active)
  values (v_org, 's29_consult', 'consultation', 'catalog.proof.name', 'catalog.proof.description', 1, false, true) returning id into v_item;
  insert into public.prices (organisation_id, catalog_item_id, amount_kobo, components, reason)
  values (v_org, v_item, 500000, '{"partner_fee_kobo":300000,"tarragon_fee_kobo":200000}', 'proof');
  update public.platform_modules set is_enabled = true, enabled_at = now(), enabled_by = v_admin, activation_note = 'S29 proof run' where key = 'v5_checkout';

  perform pg_temp.ck('a member without pay_for_care cannot pay for the patient', 'true',
    (pg_temp.q_as(v_b, format($q$select public.create_order('s29_consult', gen_random_uuid(), %L)::text$q$, v_pat)) like '%order_beneficiary_not_allowed%')::text);
  perform pg_temp.ck('a stranger cannot pay for the patient', 'true',
    (pg_temp.q_as(v_other, format($q$select public.create_order('s29_consult', gen_random_uuid(), %L)::text$q$, v_pat)) like '%order_beneficiary_not_allowed%')::text);
  -- v_ph holds red_alerts and pay_for_care from the phone invite above
  perform pg_temp.ck('a member with pay_for_care pays for the patient', 'true',
    (pg_temp.q_as(v_ph, format($q$select public.create_order('s29_consult', gen_random_uuid(), %L)::text$q$, v_pat)) like '%"reference"%')::text);
  select id, paystack_reference into v_ord, v_ref from public.orders where buyer_profile_id = v_ph order by created_at desc limit 1;
  perform pg_temp.ck('the buyer is the supporter and the beneficiary the patient', 'true',
    (select (buyer_profile_id = v_ph and beneficiary_patient_id = v_pat) from public.orders where id = v_ord)::text);
  perform pg_temp.ck('a member cannot pay for a different patient', 'true',
    (pg_temp.q_as(v_ph, format($q$select public.create_order('s29_consult', gen_random_uuid(), %L)::text$q$, v_pat2)) like '%order_beneficiary_not_allowed%')::text);
  perform pg_temp.svc(format($q$select public.record_order_payment(%L, 500000, 150, 500150, 'NGN', 'success', 'webhook', 'evt-s29', now(), '{}'::jsonb)::text$q$, v_ref));
  perform pg_temp.svc(format($q$select public.record_order_payment(%L, 500000, 150, 500150, 'NGN', 'success', 'webhook', 'evt-s29', now(), '{}'::jsonb)::text$q$, v_ref));
  perform pg_temp.svc(format($q$select public.record_order_payment(%L, 500000, 150, 500150, 'NGN', 'success', 'return', null, now(), '{}'::jsonb)::text$q$, v_ref));
  perform pg_temp.ck('the entitlement belongs to the patient, once', '1',
    (select count(*)::text from public.entitlements where order_id = v_ord and patient_id = v_pat));
  perform pg_temp.ck('the patient is told someone paid, once, with no payer name or amount', '1',
    (select count(*)::text from public.notifications where recipient_id = v_pat and template = 'circle_paid_for_you' and payload = '{}'::jsonb));
  perform pg_temp.ck('the payer sees their own order', 'true', (pg_temp.q_as(v_ph, 'select public.my_orders()::text') like '%catalog.proof.name%')::text);
  perform pg_temp.ck('the payer sees only their own order rows', '1', pg_temp.q_as(v_ph, 'select count(*)::text from public.orders'));
  perform pg_temp.ck('paying gave the payer no entitlement row', '0', pg_temp.q_as(v_ph, 'select count(*)::text from public.entitlements'));
  perform pg_temp.ck('paying gave the payer no record access: the profile is still unreadable', '0', pg_temp.q_as(v_ph, format('select count(*)::text from public.profiles where id = %L', v_pat)));
  perform pg_temp.ck('and no readings', '0', pg_temp.q_as(v_ph, format('select count(*)::text from public.vitals_readings where patient_id = %L', v_pat)));
  perform pg_temp.ck('the patient sees the gift order', 'true', (pg_temp.q_as(v_pat, 'select public.my_orders()::text') like '%catalog.proof.name%')::text);
  update public.care_circle_members set expires_at = now() - interval '1 minute' where id = pg_temp.member(v_pat, v_ph);
  perform pg_temp.ck('an expired member cannot order for the patient', 'true',
    (pg_temp.q_as(v_ph, format($q$select public.create_order('s29_consult', gen_random_uuid(), %L)::text$q$, v_pat)) like '%order_beneficiary_not_allowed%')::text);
  update public.care_circle_members set expires_at = now() + interval '30 days' where id = pg_temp.member(v_pat, v_ph);
  perform pg_temp.ck('a supporter-only account cannot buy for itself', 'true',
    (pg_temp.q_as(v_ph, $q$select public.create_order('s29_consult', gen_random_uuid())::text$q$) like '%order_not_authorised%')::text);
  perform pg_temp.ck('a patient still orders for themselves as before', 'true',
    (pg_temp.q_as(v_pat, $q$select public.create_order('s29_consult', gen_random_uuid())::text$q$) like '%"reference"%')::text);
end $$;

-- ===========================================================================================================================
-- SABOTAGE: each gate removed in turn; the matching check must flip
-- ===========================================================================================================================
do $$
declare
  v_pat uuid := pg_temp.f('pat'); v_c uuid := pg_temp.f('c'); v_other uuid := pg_temp.f('other'); v_org uuid := pg_temp.f('org');
  d text; r text; v_page uuid; n integer;
begin
  -- (a) the weekly_bp_trend gate removed
  select pg_get_functiondef('public.circle_supporter_view(uuid)'::regprocedure) into d;
  d := replace(d, '''weekly_bp_trend'' = any (m.permissions)', 'true');
  if d = pg_get_functiondef('public.circle_supporter_view(uuid)'::regprocedure) then raise exception 'sabotage (a) did not change the function'; end if;
  execute d;
  r := pg_temp.view_as(v_c, v_pat);   -- member C holds adherence_summary only
  insert into results values ('sabotaged', 'SAFETY CASE 21: a member without weekly_bp_trend gets no blood pressure block', 'false', (r like '%bp_trend%')::text);

  -- (b) the red_alerts filter removed
  select pg_get_functiondef('private.notify_circle_red_alert()'::regprocedure) into d;
  d := replace(d, '''red_alerts'' = any (m.permissions)', 'true');
  if d = pg_get_functiondef('private.notify_circle_red_alert()'::regprocedure) then raise exception 'sabotage (b) did not change the function'; end if;
  execute d;
  v_page := pg_temp.newpage(v_pat, pg_temp.newte(v_pat));
  select count(*) into n from public.notifications where recipient_id = v_c and template = 'circle_check_in' and source_id = v_page;
  insert into results values ('sabotaged', 'a member without red_alerts gets no alert', '0', n::text);

  -- (c) the pay_for_care gate removed
  select pg_get_functiondef('private.circle_can_pay_for(uuid)'::regprocedure) into d;
  d := replace(d, 'select (private.circle_member_for(p_patient, ''pay_for_care'')).id is not null', 'select true');
  if d = pg_get_functiondef('private.circle_can_pay_for(uuid)'::regprocedure) then raise exception 'sabotage (c) did not change the function'; end if;
  execute d;
  r := pg_temp.q_as(v_other, format($q$select public.create_order('s29_consult', gen_random_uuid(), %L)::text$q$, v_pat));
  insert into results values ('sabotaged', 'a stranger cannot pay for the patient', 'true', (r like '%order_beneficiary_not_allowed%')::text);
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S29 proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ')
         from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 3 then raise exception 'VACUOUS TEST: the sabotage flipped % of 3 checks', v_caught; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;

rollback;
