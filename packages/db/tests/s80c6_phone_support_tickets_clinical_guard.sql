-- S80 C6 proof (S-23, 25.4): phone intake for support tickets and the clinical-ticket close guard.
--   1. Only staff log a phone call (patient, finance back-office and anon refused); bad phone, unmatched phone, a phone shared by two
--      patients and a short description are refused and write nothing.
--   2. A logged call is a technical ticket on channel 'phone', created_by the staff member, audited; the whatsapp value stays removed.
--   3. A clinical call also opens an open clinician review item and links it; the patient cannot set or clear is_clinical.
--   4. A clinical ticket cannot be resolved without a 10+ character outcome note, nor while its linked review is unfinished, and
--      cannot be un-flagged; once the review is done and the note written it resolves and closes. A non-clinical ticket is unaffected.
--   SABOTAGE: (a) the outcome-note check removed, (b) the unfinished-review check removed; each must flip a check.
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
  values (v, 's80c6-' || p_label || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, is_test)
  values (v, p_org, p_role::public.user_role, 'S80c6 ' || p_label, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true;
  return v;
end $f$;
-- run a statement as a user: 'ok' or 'ERR:sqlstate'
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
create function pg_temp.status_of(p_uid uuid, p_table text, p_id uuid) returns text language plpgsql as $f$
declare r text;
begin
  perform pg_temp.act(p_uid);
  begin
    select l.status into r from public.directory_freshness_list() l where l.listing_table = p_table and l.listing_id = p_id;
  exception when others then perform pg_temp.back(); return 'ERR:' || sqlstate; end;
  perform pg_temp.back();
  return coalesce(r, 'absent');
end $f$;

do $$
declare v_org uuid; v_staff uuid; v_fin uuid; v_p1 uuid; v_p2 uuid; v_p3 uuid; v_p4 uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  if v_org is null then raise exception 'no organisation: the proof needs seed.sql'; end if;
  v_staff := pg_temp.mkuser(v_org, 'staff', 'clinician');
  v_fin := pg_temp.mkuser(v_org, 'fin', 'finance');
  v_p1 := pg_temp.mkuser(v_org, 'p1', 'patient');
  v_p2 := pg_temp.mkuser(v_org, 'p2', 'patient');
  v_p3 := pg_temp.mkuser(v_org, 'p3', 'patient');
  v_p4 := pg_temp.mkuser(v_org, 'p4', 'patient');
  update public.profiles set phone = '+2348000000001' where id = v_p1;
  update public.profiles set phone = '+2348000000002' where id = v_p2;
  update public.profiles set phone = '+2348000000003' where id in (v_p3, v_p4);
  perform pg_temp.setf('staff', v_staff); perform pg_temp.setf('fin', v_fin); perform pg_temp.setf('p1', v_p1); perform pg_temp.setf('p2', v_p2);
end $$;

create function pg_temp.log_as(p_uid uuid, p_phone text, p_desc text, p_clinical boolean) returns text language plpgsql as $f$
begin
  return pg_temp.sql_as(p_uid, format($q$select public.log_phone_support_ticket(%L, 'Caller could not log in', %L, 'normal', %L)$q$, p_phone, p_desc, p_clinical));
end $f$;
create function pg_temp.ticket_of(p_pat uuid, p_subject text default 'Caller could not log in') returns uuid language sql as
$$ select id from public.support_tickets where patient_id = p_pat and subject = p_subject order by created_at desc limit 1 $$;
create function pg_temp.adv_as(p_uid uuid, p_ticket uuid, p_to text, p_note text) returns text language plpgsql as $f$
begin
  return pg_temp.sql_as(p_uid, format($q$select public.advance_support_ticket_status(%L, %L::public.support_ticket_status, %L)$q$, p_ticket, p_to, p_note));
end $f$;

-- 1. who, and bad input
insert into results values ('real', 'a patient cannot log a call', 'ERR:42501', pg_temp.log_as(pg_temp.f('p1'), '+2348000000001', 'the caller could not sign in at all', false));
insert into results values ('real', 'a finance back-office account cannot log a call', 'ERR:42501', pg_temp.log_as(pg_temp.f('fin'), '+2348000000001', 'the caller could not sign in at all', false));
insert into results values ('real', 'anon cannot log a call', 'ERR:42501', pg_temp.sql_anon($q$select public.log_phone_support_ticket('+2348000000001', 'x y z', 'the caller could not sign in', 'normal', false)$q$));
insert into results values ('real', 'a badly formed phone number is refused', 'ERR:22023', pg_temp.log_as(pg_temp.f('staff'), '0800 000 0001', 'the caller could not sign in at all', false));
insert into results values ('real', 'a phone that matches no patient is refused', 'ERR:22023', pg_temp.log_as(pg_temp.f('staff'), '+2348999999999', 'the caller could not sign in at all', false));
insert into results values ('real', 'a phone shared by two patients is refused', 'ERR:22023', pg_temp.log_as(pg_temp.f('staff'), '+2348000000003', 'the caller could not sign in at all', false));
insert into results values ('real', 'a short description is refused', 'ERR:22023', pg_temp.log_as(pg_temp.f('staff'), '+2348000000001', 'short', false));
insert into results values ('real', 'refusals wrote no ticket', '0', (select count(*)::text from public.support_tickets where subject = 'Caller could not log in'));

-- 2. a plain phone ticket
insert into results values ('real', 'staff log a phone call', 'ok', pg_temp.log_as(pg_temp.f('staff'), '+2348000000001', 'the caller could not sign in at all', false));
insert into results values ('real', 'it is a phone-channel technical ticket for the right patient', 'phone/technical/new/false',
  (select channel::text || '/' || category::text || '/' || status::text || '/' || is_clinical::text from public.support_tickets where id = pg_temp.ticket_of(pg_temp.f('p1'))));
insert into results values ('real', 'it records who logged it', 'true', (select (created_by = pg_temp.f('staff'))::text from public.support_tickets where id = pg_temp.ticket_of(pg_temp.f('p1'))));
insert into results values ('real', 'it is audited', '1', (select count(*)::text from public.audit_log where action = 'support.phone_ticket_logged' and entity_id = pg_temp.ticket_of(pg_temp.f('p1'))));
insert into results values ('real', 'it opened no clinical review', 'null', (select coalesce(escalated_alert_id::text, 'null') from public.support_tickets where id = pg_temp.ticket_of(pg_temp.f('p1'))));
insert into results values ('real', 'the whatsapp channel value stays removed', '0',
  (select count(*)::text from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'support_ticket_channel' and e.enumlabel = 'whatsapp'));

-- 3. a clinical call
insert into results values ('real', 'staff log a clinical call', 'ok', pg_temp.log_as(pg_temp.f('staff'), '+2348000000002', 'the caller says the new tablets make them dizzy', true));
insert into results values ('real', 'the ticket is flagged clinical and linked to an open review', 'true/true/open',
  (select t.is_clinical::text || '/' || (t.escalated_alert_id is not null)::text || '/' || a.status::text
     from public.support_tickets t join public.clinician_alerts a on a.id = t.escalated_alert_id where t.id = pg_temp.ticket_of(pg_temp.f('p2'))));
insert into results values ('real', 'the review is for the same patient', 'true',
  (select (a.patient_id = pg_temp.f('p2'))::text from public.support_tickets t join public.clinician_alerts a on a.id = t.escalated_alert_id where t.id = pg_temp.ticket_of(pg_temp.f('p2'))));
insert into results values ('real', 'a patient cannot clear the clinical flag', 'ERR:42501',
  pg_temp.sql_as(pg_temp.f('p2'), format($q$update public.support_tickets set is_clinical = false where id = %L$q$, pg_temp.ticket_of(pg_temp.f('p2')))));
insert into results values ('real', 'a patient files a ticket with the clinical flag set', 'ok',
  pg_temp.sql_as(pg_temp.f('p1'), $q$insert into public.support_tickets (patient_id, category, subject, description, is_clinical) values (auth.uid(), 'technical', 'Own ticket', 'a description of the problem', true)$q$));
insert into results values ('real', 'the flag the patient set was ignored', 'false', (select is_clinical::text from public.support_tickets where subject = 'Own ticket'));
insert into results values ('real', 'staff try to un-flag a clinical ticket', 'ok',
  pg_temp.sql_as(pg_temp.f('staff'), format($q$update public.support_tickets set is_clinical = false where id = %L$q$, pg_temp.ticket_of(pg_temp.f('p2')))));
insert into results values ('real', 'it is still flagged clinical', 'true', (select is_clinical::text from public.support_tickets where id = pg_temp.ticket_of(pg_temp.f('p2'))));

-- 4. the close guard (a ticket must be assigned before it can be resolved)
insert into results values ('real', 'staff assign the clinical ticket', 'ok', pg_temp.adv_as(pg_temp.f('staff'), pg_temp.ticket_of(pg_temp.f('p2')), 'assigned', null));
insert into results values ('real', 'staff assign the plain ticket', 'ok', pg_temp.adv_as(pg_temp.f('staff'), pg_temp.ticket_of(pg_temp.f('p1')), 'assigned', null));
insert into results values ('real', 'a clinical ticket cannot be resolved with a short note', 'ERR:23514', pg_temp.adv_as(pg_temp.f('staff'), pg_temp.ticket_of(pg_temp.f('p2')), 'resolved', 'done'));
insert into results values ('real', 'nor with a good note while the review is still open', 'ERR:23514',
  pg_temp.adv_as(pg_temp.f('staff'), pg_temp.ticket_of(pg_temp.f('p2')), 'resolved', 'Spoke to the caller and advised them to book a review'));
insert into results values ('real', 'the ticket is still open after the refusals', 'assigned',
  (select status::text from public.support_tickets where id = pg_temp.ticket_of(pg_temp.f('p2'))));
insert into results values ('real', 'control: a non-clinical ticket resolves with an ordinary note', 'ok',
  pg_temp.adv_as(pg_temp.f('staff'), pg_temp.ticket_of(pg_temp.f('p1')), 'resolved', 'Reset the login for the caller'));
-- finish the clinical review (as the table owner, documenting it the way the alert constraint wants)
update public.clinician_alerts set status = 'resolved', resolved_at = now(), resolution_action = 'Phoned the patient and reviewed the medicine', resolution_outcome = 'true_positive'
 where id = (select escalated_alert_id from public.support_tickets where id = pg_temp.ticket_of(pg_temp.f('p2')));
insert into results values ('real', 'still refused with a short note after the review is done', 'ERR:23514', pg_temp.adv_as(pg_temp.f('staff'), pg_temp.ticket_of(pg_temp.f('p2')), 'resolved', 'done'));
insert into results values ('real', 'resolves once the review is done and the outcome is written', 'ok',
  pg_temp.adv_as(pg_temp.f('staff'), pg_temp.ticket_of(pg_temp.f('p2')), 'resolved', 'Spoke to the caller and advised them to book a review'));
insert into results values ('real', 'and then closes', 'ok', pg_temp.adv_as(pg_temp.f('staff'), pg_temp.ticket_of(pg_temp.f('p2')), 'closed', null));

-- SABOTAGE (a): the outcome-note check removed
do $$
declare v_orig text; v_def text; v_t uuid;
begin
  v_orig := pg_get_functiondef('private.enforce_support_ticket_write()'::regprocedure);
  v_def := replace(v_orig, 'if new.resolution_note is null or char_length(btrim(new.resolution_note)) < 10 then', 'if false then');
  if v_def = v_orig then raise exception 'SABOTAGE (a) not applied'; end if;
  execute v_def;
  perform pg_temp.log_as(pg_temp.f('staff'), '+2348000000001', 'second call: tablets give the caller a rash', true);
  v_t := (select id from public.support_tickets where patient_id = pg_temp.f('p1') and subject = 'Caller could not log in' order by created_at desc limit 1);
  update public.clinician_alerts set status = 'resolved', resolved_at = now(), resolution_action = 'reviewed', resolution_outcome = 'true_positive'
   where id = (select escalated_alert_id from public.support_tickets where id = v_t);
  perform pg_temp.adv_as(pg_temp.f('staff'), v_t, 'assigned', null);
  insert into results values ('sabotaged', 'a clinical ticket cannot be resolved with a short note', 'ERR:23514', pg_temp.adv_as(pg_temp.f('staff'), v_t, 'resolved', 'done'));
  execute v_orig;
end $$;

-- SABOTAGE (b): the unfinished-review check removed
do $$
declare v_orig text; v_def text; v_t uuid;
begin
  v_orig := pg_get_functiondef('private.enforce_support_ticket_write()'::regprocedure);
  v_def := replace(v_orig, 'if new.escalated_alert_id is not null and not exists (', 'if false and not exists (');
  if v_def = v_orig then raise exception 'SABOTAGE (b) not applied'; end if;
  execute v_def;
  perform pg_temp.log_as(pg_temp.f('staff'), '+2348000000002', 'third call: chest pain after the new tablets', true);
  v_t := (select id from public.support_tickets where patient_id = pg_temp.f('p2') and subject = 'Caller could not log in' order by created_at desc limit 1);
  perform pg_temp.adv_as(pg_temp.f('staff'), v_t, 'assigned', null);
  insert into results values ('sabotaged', 'nor with a good note while the review is still open', 'ERR:23514',
    pg_temp.adv_as(pg_temp.f('staff'), v_t, 'resolved', 'Spoke to the caller and advised them to book a review'));
  execute v_orig;
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S80 C6 proof FAILED: %', (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 2 then raise exception 'VACUOUS TEST: only % of 2 sabotages flipped a check: %', v_caught, (select string_agg(check_name || ' expected ' || expected || ' got ' || coalesce(actual,'null'), '; ') from results where phase = 'sabotaged'); end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result from results where phase = 'real' order by check_name;
rollback;
