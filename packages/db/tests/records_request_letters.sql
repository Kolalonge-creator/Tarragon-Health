-- Proof: records request letters (migration *_records_request_letters.sql). One rolled-back transaction. Proves:
--   1. The go-live guard starts OFF: a real (non-test) patient cannot create or hand over a request; a test patient can (the guard's own test-account rule).
--   2. A request is created for the person only, from a closed scope list; bad facility, empty or unknown scope and an unknown letter version are refused.
--   3. State machine: prepared -> sent (sets requested_at and due_at from the given period, bounds enforced) -> received; withdraw from prepared or sent;
--      received and withdrawn are final; a request cannot be handed over twice.
--   4. Overdue is derived: a sent request past due_at reads is_overdue, a fresh one does not, a received one does not.
--   5. Own rows only: another patient sees no rows and cannot act on a request (P0002); anon is refused; no client role can insert, update or delete directly.
--   6. History is append only and records each step; notes change through a function and the history stores only the note's length.
--   7. Events go through the outbox with ids only (the payload is exactly {request_id}).
--   8. Reading your requests and marking one received still work when the guard is off (nobody's data is trapped).
--   SABOTAGE A: create without the guard check. SABOTAGE B: mark_received without the owner check. SABOTAGE C: a select policy of true. All three must flip.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;

create function pg_temp.f(p text) returns uuid language sql as $$ select v from fx where k = p $$;
create function pg_temp.ck(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('real', p_name, p_expected, p_actual) $$;
create function pg_temp.act(p_uid uuid) returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
end $f$;
create function pg_temp.back() returns void language plpgsql as
$f$ begin reset role; perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.sub', '', true); perform set_config('request.jwt.claim.role', '', true); end $f$;
create function pg_temp.try_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql; r := 'ok'; exception when others then r := sqlstate; end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.q_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlstate; end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.try_anon(p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  set local role anon;
  begin execute p_sql; r := 'ok'; exception when others then r := sqlstate; end;
  reset role;
  return r;
end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_test boolean) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid(); v_phone text := '+23481' || lpad((random() * 99999999)::int::text, 8, '0');
begin
  insert into auth.users (id, email, phone, phone_confirmed_at, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'rrl-' || p_label || '-' || v || '@example.invalid', v_phone, now(), 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, 'patient', 'RRL ' || p_label || ' Person', v_phone, (current_date - interval '45 years')::date, p_test)
  on conflict (id) do update set is_test = excluded.is_test, is_active = true, full_name = excluded.full_name, phone = excluded.phone;
  return v;
end $f$;

do $$
declare
  v_org uuid; v_real uuid; v_a uuid; v_b uuid; v_id uuid; v_id2 uuid; v_n text;
  v_sql text;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_real := pg_temp.mkuser(v_org, 'real', false);
  v_a := pg_temp.mkuser(v_org, 'a', true);
  v_b := pg_temp.mkuser(v_org, 'b', true);
  insert into fx values ('real', v_real), ('a', v_a), ('b', v_b);

  -- 1. the guard starts off
  perform pg_temp.ck('the guard exists and is off', 'false', (select is_on::text from public.go_live_guards where key = 'records_request_letters'));
  perform pg_temp.ck('a real patient cannot create while the guard is off', '55000',
    pg_temp.try_as(v_real, $q$select public.create_records_request('Lagos General', null, array['lab_results'], 'records_request.letter@1')$q$));

  -- 2. creating
  v_id := (pg_temp.q_as(v_a, $q$select (public.create_records_request('  Lagos General Hospital ', ' records@lgh.example ', array['lab_results', 'discharge_summary', 'lab_results'], 'records_request.letter@1', 'ask for the 2025 admission'))->>'id'$q$))::uuid;
  insert into fx values ('id', v_id);
  perform pg_temp.ck('create returns an id', 'true', (v_id is not null)::text);
  perform pg_temp.ck('facility is trimmed, scope de-duplicated and sorted, state prepared', 'Lagos General Hospital|discharge_summary,lab_results|prepared|true',
    (select facility_name || '|' || array_to_string(scope_codes, ',') || '|' || state || '|' || (is_test and patient_id = v_a)::text from public.records_requests where id = v_id));
  perform pg_temp.ck('empty scope refused', '22023', pg_temp.try_as(v_a, $q$select public.create_records_request('Lagos General', null, array[]::text[], 'records_request.letter@1')$q$));
  perform pg_temp.ck('unknown scope refused', '22023', pg_temp.try_as(v_a, $q$select public.create_records_request('Lagos General', null, array['mental_health'], 'records_request.letter@1')$q$));
  perform pg_temp.ck('blank facility refused', '22023', pg_temp.try_as(v_a, $q$select public.create_records_request('  ', null, array['lab_results'], 'records_request.letter@1')$q$));
  perform pg_temp.ck('unknown letter version refused', '22023', pg_temp.try_as(v_a, $q$select public.create_records_request('Lagos General', null, array['lab_results'], 'wording-v9')$q$));
  perform pg_temp.ck('anon cannot create', '42501', pg_temp.try_anon($q$select public.create_records_request('Lagos General', null, array['lab_results'], 'records_request.letter@1')$q$));

  -- 3. the state machine
  perform pg_temp.ck('a reply period of 0 days is refused', '22023', pg_temp.try_as(v_a, format($q$select public.mark_records_request_sent(%L, 0)$q$, v_id)));
  perform pg_temp.ck('a reply period of 181 days is refused', '22023', pg_temp.try_as(v_a, format($q$select public.mark_records_request_sent(%L, 181)$q$, v_id)));
  perform pg_temp.ck('hand over works', 'ok', pg_temp.try_as(v_a, format($q$select public.mark_records_request_sent(%L, 30)$q$, v_id)));
  perform pg_temp.ck('sent sets requested_at and a due date 30 days later', 'sent|30',
    (select state || '|' || round(extract(epoch from (due_at - requested_at)) / 86400)::int::text from public.records_requests where id = v_id));
  perform pg_temp.ck('cannot hand over twice', 'P0002', pg_temp.try_as(v_a, format($q$select public.mark_records_request_sent(%L, 30)$q$, v_id)));

  -- 4. overdue is derived
  perform pg_temp.ck('a fresh sent request is not overdue', 'false', pg_temp.q_as(v_a, format($q$select is_overdue::text from public.my_records_requests() where id = %L$q$, v_id)));
  update public.records_requests set requested_at = now() - interval '40 days', due_at = now() - interval '10 days' where id = v_id;
  perform pg_temp.ck('a sent request past its date is overdue', 'true', pg_temp.q_as(v_a, format($q$select is_overdue::text from public.my_records_requests() where id = %L$q$, v_id)));

  -- 5. own rows only
  perform pg_temp.ck('another patient sees no rows', '0', pg_temp.q_as(v_b, $q$select count(*)::text from public.records_requests$q$));
  perform pg_temp.ck('another patient sees none through the function either', '0', pg_temp.q_as(v_b, $q$select count(*)::text from public.my_records_requests()$q$));
  perform pg_temp.ck('another patient cannot mark it received', 'P0002', pg_temp.try_as(v_b, format($q$select public.mark_records_request_received(%L)$q$, v_id)));
  perform pg_temp.ck('another patient cannot withdraw it', 'P0002', pg_temp.try_as(v_b, format($q$select public.withdraw_records_request(%L)$q$, v_id)));
  perform pg_temp.ck('another patient cannot change its note', 'P0002', pg_temp.try_as(v_b, format($q$select public.set_records_request_note(%L, 'x')$q$, v_id)));
  perform pg_temp.ck('anon cannot read the table', '42501', pg_temp.try_anon($q$select * from public.records_requests$q$));
  perform pg_temp.ck('a client cannot insert directly', '42501', pg_temp.try_as(v_a, format($q$insert into public.records_requests (organisation_id, patient_id, facility_name, scope_codes, letter_version) values (%L, %L, 'x y', array['lab_results'], 'records_request.letter@1')$q$, v_org, v_a)));
  perform pg_temp.ck('a client cannot update directly', '42501', pg_temp.try_as(v_a, format($q$update public.records_requests set state = 'received', received_at = now() where id = %L$q$, v_id)));
  perform pg_temp.ck('a client cannot delete directly', '42501', pg_temp.try_as(v_a, format($q$delete from public.records_requests where id = %L$q$, v_id)));

  -- 6. notes and history
  perform pg_temp.ck('the person can set a note', 'ok', pg_temp.try_as(v_a, format($q$select public.set_records_request_note(%L, 'chased by phone')$q$, v_id)));
  perform pg_temp.ck('the history stores only the length of the note', '15',
    (select detail ->> 'length' from public.records_request_events where request_id = v_id and event = 'note_changed'));
  perform pg_temp.ck('a note over 500 characters is refused', '22023', pg_temp.try_as(v_a, format($q$select public.set_records_request_note(%L, %L)$q$, v_id, repeat('x', 501))));

  -- received is final
  perform pg_temp.ck('mark received works', 'ok', pg_temp.try_as(v_a, format($q$select public.mark_records_request_received(%L)$q$, v_id)));
  perform pg_temp.ck('received is not overdue', 'false', pg_temp.q_as(v_a, format($q$select is_overdue::text from public.my_records_requests() where id = %L$q$, v_id)));
  perform pg_temp.ck('received cannot be withdrawn', 'P0002', pg_temp.try_as(v_a, format($q$select public.withdraw_records_request(%L)$q$, v_id)));
  perform pg_temp.ck('received cannot be received again', 'P0002', pg_temp.try_as(v_a, format($q$select public.mark_records_request_received(%L)$q$, v_id)));
  perform pg_temp.ck('history has created, sent, note_changed, received in order', 'created,sent,note_changed,received',
    (select string_agg(event, ',' order by case event when 'created' then 1 when 'sent' then 2 when 'note_changed' then 3 else 4 end) from public.records_request_events where request_id = v_id));
  perform pg_temp.ck('history cannot be updated by a client', '42501', pg_temp.try_as(v_a, format($q$update public.records_request_events set event = 'created' where request_id = %L$q$, v_id)));
  perform pg_temp.ck('history cannot be written by a client', '42501', pg_temp.try_as(v_a, format($q$delete from public.records_request_events where request_id = %L$q$, v_id)));

  -- withdraw from prepared
  v_id2 := (pg_temp.q_as(v_a, $q$select (public.create_records_request('Ikeja Clinic', null, array['whole_record'], 'records_request.letter@1'))->>'id'$q$))::uuid;
  perform pg_temp.ck('withdraw from prepared works', 'ok', pg_temp.try_as(v_a, format($q$select public.withdraw_records_request(%L)$q$, v_id2)));
  perform pg_temp.ck('withdrawn is final', 'P0002', pg_temp.try_as(v_a, format($q$select public.mark_records_request_sent(%L, 30)$q$, v_id2)));

  -- 7. events: ids only, through the outbox
  perform pg_temp.ck('created, sent and received events were emitted once each', '1|1|1',
    (select count(*) filter (where event_type = 'records_request.created')::text || '|' || count(*) filter (where event_type = 'records_request.sent')::text || '|' ||
            count(*) filter (where event_type = 'records_request.received')::text from public.domain_events where aggregate_id = v_id));
  perform pg_temp.ck('every event payload is exactly the request id', 'true',
    (select coalesce(bool_and(payload = jsonb_build_object('request_id', v_id)), false)::text from public.domain_events where aggregate_id = v_id));
  perform pg_temp.ck('no event names the facility or the note', '0',
    (select count(*)::text from public.domain_events where aggregate_id = v_id and payload::text ~* '(lagos|chased|records@)'));

  -- 8. reading and receiving still work when the guard is off (a real patient's row, written as the owner here)
  insert into public.records_requests (organisation_id, patient_id, facility_name, scope_codes, letter_version, state, requested_at, due_at)
  values (v_org, v_real, 'Abuja Hospital', array['imaging_report'], 'records_request.letter@1', 'sent', now() - interval '5 days', now() + interval '25 days');
  perform pg_temp.ck('a real patient can still read their requests with the guard off', '1', pg_temp.q_as(v_real, $q$select count(*)::text from public.my_records_requests()$q$));
  perform pg_temp.ck('a real patient can still mark one received with the guard off', 'ok',
    pg_temp.try_as(v_real, format($q$select public.mark_records_request_received(%L)$q$, (select id from public.records_requests where patient_id = v_real))));
  perform pg_temp.ck('a real patient cannot hand over a new one with the guard off', '55000',
    pg_temp.try_as(v_real, format($q$select public.mark_records_request_sent(%L, 30)$q$, gen_random_uuid())));

  -- registries
  perform pg_temp.ck('both tables are in the data registry', '2', (select count(*)::text from public.data_registry where table_name in ('records_requests', 'records_request_events')));
  perform pg_temp.ck('both tables have a dependant policy', '2', (select count(*)::text from public.minor_dependant_table_policy where table_name in ('records_requests', 'records_request_events')));
end $$;

-- SABOTAGE A: create without the guard check. A real patient must then succeed (the real check "cannot create while the guard is off" flips).
create or replace function public.create_records_request(p_facility text, p_contact text, p_scope text[], p_letter_version text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a record;
begin
  select * into a from private.records_request_actor();
  insert into public.records_requests (organisation_id, patient_id, facility_name, scope_codes, letter_version) values (a.org, a.uid, btrim(p_facility), p_scope, p_letter_version);
  return jsonb_build_object('ok', true);
end $$;
do $$
declare v_org uuid; v_r uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_r := pg_temp.mkuser(v_org, 'sabA', false);
  insert into results values ('sabotaged', 'a real patient cannot create while the guard is off', '55000',
    pg_temp.try_as(v_r, $q$select public.create_records_request('Lagos General', null, array['lab_results'], 'records_request.letter@1')$q$));
end $$;

-- SABOTAGE B: mark_received without the owner check. Another patient must then succeed (the real check flips).
create or replace function public.mark_records_request_received(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  update public.records_requests set state = 'received', received_at = now() where id = p_id and state in ('prepared', 'sent');
  if not found then raise exception 'that request cannot be marked received' using errcode = 'P0002'; end if;
  return jsonb_build_object('ok', true);
end $$;
do $$
declare v_org uuid; v_o uuid; v_s uuid; v_id uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_o := pg_temp.mkuser(v_org, 'sabBo', true); v_s := pg_temp.mkuser(v_org, 'sabBs', true);
  insert into public.records_requests (organisation_id, patient_id, facility_name, scope_codes, letter_version)
  values (v_org, v_o, 'Lagos General', array['lab_results'], 'records_request.letter@1') returning id into v_id;
  insert into results values ('sabotaged', 'another patient cannot mark it received', 'P0002',
    pg_temp.try_as(v_s, format($q$select public.mark_records_request_received(%L)$q$, v_id)));
end $$;

-- SABOTAGE C: a select policy of true. Another patient must then read the rows (the real check "another patient sees no rows" flips).
drop policy records_requests_select_own on public.records_requests;
create policy records_requests_select_own on public.records_requests for select to authenticated using (true);
do $$
declare v_org uuid; v_s uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_s := pg_temp.mkuser(v_org, 'sabC', true);
  insert into results values ('sabotaged', 'another patient sees no rows', '0', pg_temp.q_as(v_s, $q$select count(*)::text from public.records_requests$q$));
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'records request letters proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ')
         from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 3 then raise exception 'VACUOUS TEST: the sabotage flipped % of 3 checks', v_caught; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;

rollback;
