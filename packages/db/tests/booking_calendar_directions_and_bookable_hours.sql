-- Proof: booking calendar (migration *_booking_calendar_directions_and_bookable_hours.sql).
-- 1. Directions on a testing day: only someone who manages testing days can set them; a Member reads them, with the closing
--    time, on the listing and on their own booking; anon never calls the setter.
-- 2. A doctor's declared bookable consultation hours appear on the reviewers' confirm list (they used to be left off, so no
--    screen could confirm them and patients saw no times), and confirming makes them confirmed.
-- One rolled-back transaction. Ends with a SABOTAGE section: the old on-call-only list and an unguarded setter must flip checks.
begin;
-- T2-02 (2026-11-04) closed new public testing days; this proof still tests how existing public-day bookings work, so it opens
-- the legacy path for this transaction only (create_testing_event honours it for a direct postgres session, never an API request).
select set_config('tarragon.allow_legacy_public_testing_day', 'on', true);

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;

create function pg_temp.f(p text) returns uuid language sql as $$ select v from fx where k = p $$;
create function pg_temp.setf(p text, p_v uuid) returns void language sql as
$$ insert into fx values (p, p_v) on conflict (k) do update set v = excluded.v $$;
create function pg_temp.ck(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('real', p_name, p_expected, p_actual) $$;
create function pg_temp.q_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlerrm; end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.role', '', true);
  return r;
end $f$;
create function pg_temp.rpc(p_uid uuid, p_call text) returns text language sql as
$$ select pg_temp.q_as(p_uid, 'select (' || p_call || ')::text') $$;
create function pg_temp.err(p_text text) returns text language sql as
$$ select case when p_text like 'ERR:%' then substr(p_text, 5) else 'ok' end $$;
create function pg_temp.try_anon(p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
  begin execute p_sql; r := 'ok'; exception when others then r := sqlstate; end;
  reset role;
  return r;
end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'bc-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'BC ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true)
  on conflict (id) do update set role = excluded.role, organisation_id = excluded.organisation_id, is_test = true, is_active = true, phone = excluded.phone;
  return v;
end $f$;

-- Fixtures -------------------------------------------------------------------------------------------------------------
do $$
declare v_org uuid; v_admin uuid; v_lab uuid; v_member uuid; v_doc uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  perform pg_temp.setf('org', v_org);
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  perform pg_temp.setf('admin', v_admin);
  perform pg_temp.setf('coord', pg_temp.mkuser(v_org, 'coord', 'care_coordinator'));
  v_member := pg_temp.mkuser(v_org, 'member', 'patient');
  perform pg_temp.setf('member', v_member);
  insert into public.patient_memberships (organisation_id, patient_id, source, state, starts_at, granted_by, grant_reason, is_test)
  values (v_org, v_member, 'granted', 'active', now() - interval '1 day', v_admin, 'booking calendar proof member', true);
  insert into public.lab_providers (name, is_active, license_number, license_verified_at, license_expires_at, accreditation)
  values ('BC Lab', true, 'BC-PROOF-1', now(), now() + interval '1 year', 'ISO 15189') returning id into v_lab;
  perform pg_temp.setf('lab', v_lab);
  v_doc := pg_temp.mkuser(v_org, 'doc', 'clinician');
  perform pg_temp.setf('doc', v_doc);
end $$;

-- 1. Directions -------------------------------------------------------------------------------------------------------------
do $$
declare v_admin uuid := pg_temp.f('admin'); v_ev uuid; v_day jsonb; v_booking jsonb;
begin
  v_ev := pg_temp.rpc(v_admin, format($q$public.create_testing_event('public_day', current_date + 14, '09:00', '15:30', 'Ikeja Hall', '4 Allen Avenue', 'Ikeja', null, 'Lagos', 5, %L)$q$, pg_temp.f('lab')))::uuid;
  perform pg_temp.setf('ev', v_ev);
  perform pg_temp.ck('anon cannot set directions', '42501',
    pg_temp.try_anon(format($q$select public.set_testing_event_directions(%L, 'x')$q$, v_ev)));
  perform pg_temp.ck('a Member cannot set directions', 'not authorised',
    pg_temp.err(pg_temp.rpc(pg_temp.f('member'), format($q$public.set_testing_event_directions(%L, 'x')$q$, v_ev))));
  perform pg_temp.ck('a coordinator without the permission cannot set directions', 'not authorised',
    pg_temp.err(pg_temp.rpc(pg_temp.f('coord'), format($q$public.set_testing_event_directions(%L, 'x')$q$, v_ev))));
  perform pg_temp.ck('an admin sets directions', 'ok',
    pg_temp.err(pg_temp.rpc(v_admin, format($q$public.set_testing_event_directions(%L, '  Opposite the bank, first floor  ')$q$, v_ev))));
  perform pg_temp.ck('directions are trimmed', 'Opposite the bank, first floor', (select directions from public.testing_events where id = v_ev));
  perform pg_temp.ck('directions longer than 500 characters are refused', 'true',
    (pg_temp.err(pg_temp.rpc(v_admin, format('public.set_testing_event_directions(%L, %L)', v_ev, repeat('x', 501)))) like '%check%')::text);
  perform pg_temp.ck('the change is audited', 'true',
    exists (select 1 from public.audit_log where action = 'testing_event.directions_set' and entity_id = v_ev)::text);

  perform pg_temp.rpc(v_admin, format('public.approve_testing_event_venue(%L)', v_ev));
  perform pg_temp.rpc(v_admin, format('public.set_testing_event_status(%L, %L)', v_ev, 'open'));
  select x into v_day from jsonb_array_elements(pg_temp.rpc(pg_temp.f('member'), 'public.list_testing_days()')::jsonb) x where x ->> 'id' = v_ev::text;
  perform pg_temp.ck('a Member sees the directions on the listing', 'Opposite the bank, first floor', v_day ->> 'directions');
  perform pg_temp.ck('a Member sees the closing time on the listing', '15:30:00', v_day ->> 'ends_at');

  perform pg_temp.rpc(pg_temp.f('member'), format('public.book_testing_day(%L)', v_ev));
  select x into v_booking from jsonb_array_elements(pg_temp.rpc(pg_temp.f('member'), 'public.my_testing_bookings()')::jsonb) x where x ->> 'event_id' = v_ev::text;
  perform pg_temp.ck('the booking carries directions, closing time and state', 'Opposite the bank, first floor|15:30:00|Lagos|confirmed',
    concat_ws('|', v_booking ->> 'directions', v_booking ->> 'ends_at', v_booking ->> 'state_name', v_booking ->> 'state'));

  select x into v_day from jsonb_array_elements(pg_temp.rpc(v_admin, 'public.list_testing_events_for_staff()')::jsonb) x where x ->> 'id' = v_ev::text;
  perform pg_temp.ck('staff see directions and times', 'Opposite the bank, first floor|09:00:00|15:30:00',
    concat_ws('|', v_day ->> 'directions', v_day ->> 'starts_at', v_day ->> 'ends_at'));

  -- two statements: a query does not see a change made by a function it calls itself
  perform pg_temp.ck('an empty box is accepted', 'ok',
    pg_temp.err(pg_temp.rpc(v_admin, format($q$public.set_testing_event_directions(%L, '   ')$q$, v_ev))));
  perform pg_temp.ck('...and clears the directions', 'true', (select (directions is null)::text from public.testing_events where id = v_ev));
  perform pg_temp.rpc(v_admin, format('public.set_testing_event_status(%L, %L)', v_ev, 'cancelled'));
  perform pg_temp.ck('a cancelled day cannot be edited', 'testing_event_not_found_or_not_editable',
    pg_temp.err(pg_temp.rpc(v_admin, format($q$public.set_testing_event_directions(%L, 'x')$q$, v_ev))));
end $$;

-- 2. Bookable consultation hours reach the confirm list ------------------------------------------------------------------------
do $$
declare v_org uuid := pg_temp.f('org'); v_doc uuid := pg_temp.f('doc'); v_book uuid; v_call uuid; v_list jsonb;
begin
  -- Fixture rows straight into the table: the declare path's own eligibility rules are proven elsewhere (s18 proof).
  set local session_replication_role = replica;
  insert into public.availability_blocks (organisation_id, clinician_id, starts_at, ends_at, kind, is_test)
  values (v_org, v_doc, now() + interval '2 days', now() + interval '2 days 3 hours', 'bookable_consultations', true) returning id into v_book;
  insert into public.availability_blocks (organisation_id, clinician_id, starts_at, ends_at, kind, is_test)
  values (v_org, v_doc, now() + interval '3 days', now() + interval '3 days 8 hours', 'on_call', true) returning id into v_call;
  set local session_replication_role = origin;
  perform pg_temp.setf('book', v_book);
  perform pg_temp.setf('call', v_call);

  v_list := pg_temp.rpc(pg_temp.f('admin'), 'public.rota_overview()')::jsonb -> 'pending_blocks';
  perform pg_temp.ck('declared bookable hours are on the confirm list', 'bookable_consultations',
    (select x ->> 'kind' from jsonb_array_elements(v_list) x where x ->> 'id' = v_book::text));
  perform pg_temp.ck('declared on-call hours are still on it', 'on_call',
    (select x ->> 'kind' from jsonb_array_elements(v_list) x where x ->> 'id' = v_call::text));
  perform pg_temp.ck('each block says whether it is a test block', 'true',
    (select x ->> 'is_test' from jsonb_array_elements(v_list) x where x ->> 'id' = v_book::text));
  perform pg_temp.ck('a patient cannot read the confirm list', 'not authorised', pg_temp.err(pg_temp.rpc(pg_temp.f('member'), 'public.rota_overview()')));
  perform pg_temp.ck('the admin confirms the bookable hours', 'ok',
    pg_temp.err(pg_temp.rpc(pg_temp.f('admin'), format('public.confirm_availability_block(%L)', v_book))));
  perform pg_temp.ck('they are now confirmed and off the list', 'confirmed|0',
    (select state from public.availability_blocks where id = v_book) || '|' ||
    (select count(*)::text from jsonb_array_elements(pg_temp.rpc(pg_temp.f('admin'), 'public.rota_overview()')::jsonb -> 'pending_blocks') x where x ->> 'id' = v_book::text));
end $$;

-- SABOTAGE -----------------------------------------------------------------------------------------------------------------
-- (a) Put back the old on-call-only filter: a fresh bookable block must vanish from the list.
do $$
declare v_def text; v_book uuid;
begin
  v_def := pg_get_functiondef('public.rota_overview(timestamptz, timestamptz)'::regprocedure);
  execute replace(v_def, $q$b.kind in ('on_call', 'bookable_consultations')$q$, $q$b.kind = 'on_call'$q$);
  set local session_replication_role = replica;
  insert into public.availability_blocks (organisation_id, clinician_id, starts_at, ends_at, kind, is_test)
  values (pg_temp.f('org'), pg_temp.f('doc'), now() + interval '5 days', now() + interval '5 days 2 hours', 'bookable_consultations', true) returning id into v_book;
  set local session_replication_role = origin;
  insert into results values ('sabotaged', 'declared bookable hours are on the confirm list', 'bookable_consultations',
    (select x ->> 'kind' from jsonb_array_elements(pg_temp.rpc(pg_temp.f('admin'), 'public.rota_overview()')::jsonb -> 'pending_blocks') x where x ->> 'id' = v_book::text));
end $$;

-- (b) Drop the permission check from the setter: a Member must then be able to write directions.
create or replace function public.set_testing_event_directions(p_event uuid, p_directions text) returns void
language plpgsql security definer set search_path to '' as
$f$ begin update public.testing_events set directions = p_directions where id = p_event; end $f$;
do $$
begin
  insert into results values ('sabotaged', 'a Member cannot set directions', 'not authorised',
    pg_temp.err(pg_temp.rpc(pg_temp.f('member'), format($q$public.set_testing_event_directions(%L, 'x')$q$, pg_temp.f('ev')))));
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'booking calendar proof FAILED: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ')
         from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected is distinct from actual;
  if v_caught < 2 then raise exception 'VACUOUS TEST: the sabotage flipped % of the 2 checks that should flip', v_caught; end if;
end $$;

-- a sabotaged check is meant to differ; the runner reads any FAIL in the output as a failed proof
select phase, check_name, expected, actual,
       case when phase = 'sabotaged' then case when expected is distinct from actual then 'CAUGHT' else 'MISSED' end
            when expected = actual then 'PASS' else 'FAIL' end as result
from results order by phase, check_name;

rollback;
