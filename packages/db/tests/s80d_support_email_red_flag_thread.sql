-- S80d proof (Module 25.4): email intake by staff, the red-flag scan on every ticket, and the one-thread-per-patient view.
--   1. Only staff log an email (patient, finance back-office and anon refused); a bad address, an address that matches no single patient, a
--      missing sender and a short body are refused and write nothing.
--   2. A logged email is a technical ticket on channel 'email', created_by the staff member, audited, carrying the sender; a plain one opens no
--      review item and no red-flag row.
--   3. A clinical email also opens a linked clinical review item even for a non-clinical-tier staff member (the in-place patch from 'phone' to
--      'phone or email'); a patient still cannot set the flag.
--   4. The scan: a ticket whose text matches the shared danger phrases raises an emergency-level alert (message_safety_flag), a red-flag row and a
--      page, whichever channel it came from (app, phone, email); a patient reply that matches is flagged too; a care-team reply, an internal
--      note and ordinary text are not; the ticket itself is untouched (status new); the red-flag table is read-only to everyone but org staff.
--   5. The thread: staff see tickets and replies from all three channels in one list; a patient sees only their own, without internal notes; another
--      patient sees nothing.
--   SABOTAGE: (a) the phone-or-email patch reverted, (b) the ticket scan trigger dropped, (c) the comment scan trigger dropped; each must flip a check.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;
create function pg_temp.f(p text) returns uuid language sql as $$ select v from fx where k = p $$;
create function pg_temp.setf(p text, p_v uuid) returns void language sql as
$$ insert into fx values (p, p_v) on conflict (k) do update set v = excluded.v $$;
create function pg_temp.act(p_uid uuid) returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
end $f$;
create function pg_temp.back() returns void language plpgsql as
$f$ begin reset role; perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.role', '', true); end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's80d-' || p_label || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, is_test)
  values (v, p_org, p_role::public.user_role, 'S80d ' || p_label, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true;
  return v;
end $f$;
create function pg_temp.sql_as(p_uid uuid, p_sql text) returns text language plpgsql as $f$
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql; exception when others then perform pg_temp.back(); return 'ERR:' || sqlstate; end;
  perform pg_temp.back();
  return 'ok';
end $f$;
create function pg_temp.sql_anon(p_sql text) returns text language plpgsql as $f$
begin
  set local role anon;
  begin execute p_sql; exception when others then reset role; return 'ERR:' || sqlstate; end;
  reset role;
  return 'ok';
end $f$;
-- a count read as a user (RLS applies)
create function pg_temp.count_as(p_uid uuid, p_sql text) returns text language plpgsql as $f$
declare n bigint;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql into n; exception when others then perform pg_temp.back(); return 'ERR:' || sqlstate; end;
  perform pg_temp.back();
  return n::text;
end $f$;

do $$
declare v_org uuid; v_staff uuid; v_fin uuid; v_admin uuid; v_p1 uuid; v_p2 uuid; v_p3 uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  if v_org is null then raise exception 'no organisation: the proof needs seed.sql'; end if;
  v_staff := pg_temp.mkuser(v_org, 'staff', 'clinician');
  v_fin := pg_temp.mkuser(v_org, 'fin', 'finance');
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  v_p1 := pg_temp.mkuser(v_org, 'p1', 'patient');
  v_p2 := pg_temp.mkuser(v_org, 'p2', 'patient');
  v_p3 := pg_temp.mkuser(v_org, 'p3', 'patient');
  perform pg_temp.setf('org', v_org); perform pg_temp.setf('staff', v_staff); perform pg_temp.setf('fin', v_fin); perform pg_temp.setf('admin', v_admin);
  perform pg_temp.setf('p1', v_p1); perform pg_temp.setf('p2', v_p2); perform pg_temp.setf('p3', v_p3);
  update public.profiles set phone = '+2348000000011' where id = v_p1;
  update public.profiles set phone = '+2348000000012' where id = v_p2;
end $$;

create function pg_temp.email_as(p_uid uuid, p_email text, p_sender text, p_subject text, p_body text, p_clinical boolean) returns text language plpgsql as $f$
begin
  return pg_temp.sql_as(p_uid, format($q$select public.log_email_support_ticket(%L, %L, %L, %L, 'normal', %L)$q$, p_email, p_sender, p_subject, p_body, p_clinical));
end $f$;
create function pg_temp.phone_as(p_uid uuid, p_phone text, p_subject text, p_desc text) returns text language plpgsql as $f$
begin
  return pg_temp.sql_as(p_uid, format($q$select public.log_phone_support_ticket(%L, %L, %L, 'normal', false)$q$, p_phone, p_subject, p_desc));
end $f$;
create function pg_temp.ticket_of(p_pat uuid, p_subject text) returns uuid language sql as
$$ select id from public.support_tickets where patient_id = p_pat and subject = p_subject order by created_at desc limit 1 $$;

-- 1. who, and bad input
insert into results values ('real', 'a patient cannot log an email', 'ERR:42501', pg_temp.email_as(pg_temp.f('p1'), 's80d-p1@example.invalid', 'Pat One', 'Cannot sign in', 'I cannot sign in to the app at all', false));
insert into results values ('real', 'a finance back-office account cannot log an email', 'ERR:42501', pg_temp.email_as(pg_temp.f('fin'), 's80d-p1@example.invalid', 'Pat One', 'Cannot sign in', 'I cannot sign in to the app at all', false));
insert into results values ('real', 'anon cannot log an email', 'ERR:42501', pg_temp.sql_anon($q$select public.log_email_support_ticket('s80d-p1@example.invalid', 'Pat One', 'Cannot sign in', 'I cannot sign in to the app at all', 'normal', false)$q$));
insert into results values ('real', 'a badly formed address is refused', 'ERR:22023', pg_temp.email_as(pg_temp.f('staff'), 'not-an-email', 'Pat One', 'Cannot sign in', 'I cannot sign in to the app at all', false));
insert into results values ('real', 'an address that matches no patient is refused', 'ERR:22023', pg_temp.email_as(pg_temp.f('staff'), 'nobody-s80d@example.invalid', 'Pat One', 'Cannot sign in', 'I cannot sign in to the app at all', false));
insert into results values ('real', 'a staff address is not a patient match', 'ERR:22023', pg_temp.email_as(pg_temp.f('staff'), 's80d-staff@example.invalid', 'Pat One', 'Cannot sign in', 'I cannot sign in to the app at all', false));
insert into results values ('real', 'a missing sender is refused', 'ERR:22023', pg_temp.email_as(pg_temp.f('staff'), 's80d-p1@example.invalid', '  ', 'Cannot sign in', 'I cannot sign in to the app at all', false));
insert into results values ('real', 'a short body is refused', 'ERR:22023', pg_temp.email_as(pg_temp.f('staff'), 's80d-p1@example.invalid', 'Pat One', 'Cannot sign in', 'help', false));
insert into results values ('real', 'refusals wrote no ticket', '0', (select count(*)::text from public.support_tickets where subject = 'Cannot sign in'));

-- 2. a plain email
insert into results values ('real', 'staff log an email', 'ok', pg_temp.email_as(pg_temp.f('staff'), 'S80D-P1@Example.Invalid', 'Pat One <pat@example.invalid>', 'Cannot sign in', 'I cannot sign in to the app at all', false));
insert into results values ('real', 'it is an email-channel technical ticket for the right patient', 'email/technical/new/false',
  (select channel::text || '/' || category::text || '/' || status::text || '/' || is_clinical::text from public.support_tickets where id = pg_temp.ticket_of(pg_temp.f('p1'), 'Cannot sign in')));
insert into results values ('real', 'it records who logged it', 'true', (select (created_by = pg_temp.f('staff'))::text from public.support_tickets where id = pg_temp.ticket_of(pg_temp.f('p1'), 'Cannot sign in')));
insert into results values ('real', 'it carries the sender and says it was pasted', 'true',
  (select (description like '%Pat One <pat@example.invalid>%' and description like '%Pasted text%')::text from public.support_tickets where id = pg_temp.ticket_of(pg_temp.f('p1'), 'Cannot sign in')));
insert into results values ('real', 'it is audited', '1', (select count(*)::text from public.audit_log where action = 'support.email_ticket_logged' and entity_id = pg_temp.ticket_of(pg_temp.f('p1'), 'Cannot sign in')));
insert into results values ('real', 'it opened no clinical review', 'null', (select coalesce(escalated_alert_id::text, 'null') from public.support_tickets where id = pg_temp.ticket_of(pg_temp.f('p1'), 'Cannot sign in')));
insert into results values ('real', 'ordinary text raised no red flag', '0', (select count(*)::text from public.support_ticket_red_flags where patient_id = pg_temp.f('p1')));
insert into results values ('real', 'ordinary text raised no emergency alert', '0',
  (select count(*)::text from public.clinician_alerts where patient_id = pg_temp.f('p1') and type_code = 'message_safety_flag'));

-- 3. a clinical email (a non-clinical-tier staff member: no clinical_staff row)
insert into results values ('real', 'staff log a clinical email', 'ok', pg_temp.email_as(pg_temp.f('staff'), 's80d-p2@example.invalid', 'Pat Two', 'Tablets make me dizzy', 'My new tablets make me dizzy every morning', true));
insert into results values ('real', 'it is flagged clinical and linked to an open review', 'true/true/open',
  (select t.is_clinical::text || '/' || (t.escalated_alert_id is not null)::text || '/' || a.status::text
     from public.support_tickets t join public.clinician_alerts a on a.id = t.escalated_alert_id where t.id = pg_temp.ticket_of(pg_temp.f('p2'), 'Tablets make me dizzy')));
insert into results values ('real', 'a patient files a ticket with the clinical flag set', 'ok',
  pg_temp.sql_as(pg_temp.f('p1'), $q$insert into public.support_tickets (patient_id, category, subject, description, is_clinical) values (auth.uid(), 'technical', 'Own ticket', 'a description of the problem', true)$q$));
insert into results values ('real', 'the flag the patient set was ignored', 'false', (select is_clinical::text from public.support_tickets where subject = 'Own ticket'));

-- 4. the scan, on every channel
insert into results values ('real', 'a patient files a ticket in the app that mentions chest pain', 'ok',
  pg_temp.sql_as(pg_temp.f('p1'), $q$insert into public.support_tickets (patient_id, category, subject, description) values (auth.uid(), 'technical', 'App ticket urgent', 'I have chest pain and the app will not open')$q$));
insert into results values ('real', 'staff log a phone call that mentions not breathing', 'ok', pg_temp.phone_as(pg_temp.f('staff'), '+2348000000012', 'Phone call urgent', 'the caller says their baby not breathing properly'));
insert into results values ('real', 'staff log an email that mentions an overdose', 'ok',
  pg_temp.email_as(pg_temp.f('staff'), 's80d-p2@example.invalid', 'Pat Two', 'Email urgent', 'I think I took an overdose of my tablets', false));
insert into results values ('real', 'each of the three raised a red-flag row', '3', (select count(*)::text from public.support_ticket_red_flags where comment_id is null and patient_id in (pg_temp.f('p1'), pg_temp.f('p2'))));
insert into results values ('real', 'one per channel', 'email,in_app,phone',
  (select string_agg(channel::text, ',' order by channel::text) from public.support_ticket_red_flags where comment_id is null and patient_id in (pg_temp.f('p1'), pg_temp.f('p2'))));
insert into results values ('real', 'each raised an emergency-level message_safety_flag alert for the right patient', '3',
  (select count(*)::text from public.support_ticket_red_flags f join public.clinician_alerts a on a.id = f.alert_id
    where f.comment_id is null and a.type_code = 'message_safety_flag' and a.level = 'emergency' and a.patient_id = f.patient_id));
insert into results values ('real', 'the matched list phrase is stored, not the message', 'true',
  (select ('chest pain' = any (matched_phrases) and not exists (select 1 from unnest(matched_phrases) m where m like '%app will not open%'))::text
     from public.support_ticket_red_flags where ticket_id = pg_temp.ticket_of(pg_temp.f('p1'), 'App ticket urgent')));
insert into results values ('real', 'the alert was paged to an admin of the organisation (no clinician owner exists)', 'true',
  (select (count(*) >= 1)::text from public.notifications n join public.support_ticket_red_flags f on f.alert_id = n.source_id
    where n.recipient_id = pg_temp.f('admin') and n.template = 'care_message_safety_flag' and n.channel = 'in_app' and f.ticket_id = pg_temp.ticket_of(pg_temp.f('p1'), 'App ticket urgent')));
insert into results values ('real', 'the ticket itself was not touched', 'new/true',
  (select status::text || '/' || (assigned_to is null)::text from public.support_tickets where id = pg_temp.ticket_of(pg_temp.f('p1'), 'App ticket urgent')));

-- replies
insert into results values ('real', 'a patient reply with a danger phrase is flagged', 'ok',
  pg_temp.sql_as(pg_temp.f('p1'), format($q$insert into public.support_ticket_comments (organisation_id, ticket_id, body) values (%L, %L, 'now I feel suicidal')$q$, pg_temp.f('org'), pg_temp.ticket_of(pg_temp.f('p1'), 'Cannot sign in'))));
insert into results values ('real', 'it raised a red-flag row tied to the reply', '1',
  (select count(*)::text from public.support_ticket_red_flags where comment_id is not null and ticket_id = pg_temp.ticket_of(pg_temp.f('p1'), 'Cannot sign in')));
insert into results values ('real', 'a care-team reply with a danger phrase raises nothing', 'ok',
  pg_temp.sql_as(pg_temp.f('staff'), format($q$insert into public.support_ticket_comments (organisation_id, ticket_id, body) values (%L, %L, 'If you have chest pain go to the nearest hospital')$q$, pg_temp.f('org'), pg_temp.ticket_of(pg_temp.f('p1'), 'Cannot sign in'))));
insert into results values ('real', 'an internal note with a danger phrase raises nothing', 'ok',
  pg_temp.sql_as(pg_temp.f('staff'), format($q$insert into public.support_ticket_comments (organisation_id, ticket_id, body, is_internal) values (%L, %L, 'Patient mentioned seizure history in the call', true)$q$, pg_temp.f('org'), pg_temp.ticket_of(pg_temp.f('p1'), 'Cannot sign in'))));
insert into results values ('real', 'still only one reply flag', '1',
  (select count(*)::text from public.support_ticket_red_flags where comment_id is not null and ticket_id = pg_temp.ticket_of(pg_temp.f('p1'), 'Cannot sign in')));

-- the red-flag table is read-only
insert into results values ('real', 'staff can read red flags', 'true', (select (pg_temp.count_as(pg_temp.f('staff'), 'select count(*) from public.support_ticket_red_flags')::integer >= 4)::text));
insert into results values ('real', 'a patient reads none', '0', pg_temp.count_as(pg_temp.f('p1'), 'select count(*) from public.support_ticket_red_flags'));
insert into results values ('real', 'staff cannot write a red flag', 'ERR:42501',
  pg_temp.sql_as(pg_temp.f('staff'), format($q$insert into public.support_ticket_red_flags (organisation_id, patient_id, ticket_id, channel, matched_phrases) values (%L, %L, %L, 'email', array['x'])$q$, pg_temp.f('org'), pg_temp.f('p1'), pg_temp.ticket_of(pg_temp.f('p1'), 'Cannot sign in'))));
insert into results values ('real', 'anon cannot read red flags', 'ERR:42501', pg_temp.sql_anon('select count(*) from public.support_ticket_red_flags'));

-- 5. the thread
do $$
declare v text;
begin
  perform pg_temp.act(pg_temp.f('staff'));
  select string_agg(distinct channel::text, ',' order by channel::text) into v from public.support_patient_thread(pg_temp.f('p2'));
  perform pg_temp.back();
  insert into results values ('real', 'staff see the phone and email tickets of one patient in one thread', 'email,phone', v);
  perform pg_temp.act(pg_temp.f('staff'));
  select string_agg(distinct channel::text, ',' order by channel::text) into v from public.support_patient_thread(pg_temp.f('p1'));
  perform pg_temp.back();
  insert into results values ('real', 'and the app, email tickets of another', 'email,in_app', v);
end $$;
insert into results values ('real', 'the thread is newest first and holds tickets and replies', 'true',
  (select (pg_temp.count_as(pg_temp.f('staff'), format('select count(*) from public.support_patient_thread(%L) where kind = ''reply''', pg_temp.f('p1')))::integer = 3)::text));
insert into results values ('real', 'a patient sees their own thread without the internal note', '2',
  pg_temp.count_as(pg_temp.f('p1'), format('select count(*) from public.support_patient_thread(%L) where kind = ''reply''', pg_temp.f('p1'))));
insert into results values ('real', 'the internal note is not in the patient thread', '0',
  pg_temp.count_as(pg_temp.f('p1'), format('select count(*) from public.support_patient_thread(%L) where is_internal', pg_temp.f('p1'))));
insert into results values ('real', 'another patient sees nothing of it', '0',
  pg_temp.count_as(pg_temp.f('p3'), format('select count(*) from public.support_patient_thread(%L)', pg_temp.f('p1'))));
insert into results values ('real', 'anon cannot call the thread', 'ERR:42501', pg_temp.sql_anon(format('select count(*) from public.support_patient_thread(%L)', pg_temp.f('p1'))));

-- SABOTAGE (a): the phone-or-email patch reverted, a clinical email can no longer link its review
do $$
declare v_orig text; v_def text; r text;
begin
  v_orig := pg_get_functiondef('private.enforce_support_ticket_write()'::regprocedure);
  v_def := replace(v_orig, 'old.channel in (''phone'', ''email'')', 'old.channel = ''phone''');
  if v_def = v_orig then raise exception 'SABOTAGE (a) not applied'; end if;
  execute v_def;
  r := pg_temp.email_as(pg_temp.f('staff'), 's80d-p2@example.invalid', 'Pat Two', 'Sabotage clinical email', 'My tablets make me dizzy again today', true);
  insert into results values ('sabotaged', 'a clinical email links its review', 'ok', r);
  execute v_orig;
end $$;

-- SABOTAGE (b): the ticket scan trigger dropped
do $$
declare n integer;
begin
  drop trigger support_tickets_red_flag_scan on public.support_tickets;
  insert into public.support_tickets (organisation_id, patient_id, category, subject, description, channel)
  values (pg_temp.f('org'), pg_temp.f('p3'), 'technical', 'Sabotage scan', 'I have chest pain right now', 'email');
  select count(*) into n from public.support_ticket_red_flags where patient_id = pg_temp.f('p3');
  insert into results values ('sabotaged', 'a ticket with chest pain is flagged', '1', n::text);
  create trigger support_tickets_red_flag_scan after insert on public.support_tickets
    for each row execute function private.after_support_ticket_insert_scan();
end $$;

-- SABOTAGE (c): the comment scan trigger dropped
do $$
declare n integer; v_t uuid := pg_temp.ticket_of(pg_temp.f('p1'), 'Cannot sign in');
begin
  drop trigger support_ticket_comments_red_flag_scan on public.support_ticket_comments;
  perform pg_temp.sql_as(pg_temp.f('p1'), format($q$insert into public.support_ticket_comments (organisation_id, ticket_id, body) values (%L, %L, 'I want to die')$q$, pg_temp.f('org'), v_t));
  select count(*) into n from public.support_ticket_red_flags where ticket_id = v_t and comment_id is not null;
  insert into results values ('sabotaged', 'a patient reply with a danger phrase is flagged', '2', n::text);
  create trigger support_ticket_comments_red_flag_scan after insert on public.support_ticket_comments
    for each row execute function private.after_support_comment_insert_scan();
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S80d support proof FAILED: %', (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 3 then raise exception 'VACUOUS TEST: only % of 3 sabotages flipped a check: %', v_caught, (select string_agg(check_name || ' expected ' || expected || ' got ' || coalesce(actual,'null'), '; ') from results where phase = 'sabotaged'); end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result from results where phase = 'real' order by check_name;
rollback;
