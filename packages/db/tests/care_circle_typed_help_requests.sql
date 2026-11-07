-- ===========================================================================
-- Proof: Care Circle typed help requests (P22 / PD-08)
--   20261107011314_care_circle_typed_help_requests.sql
--
--   A. The patient asks for a kind of help with a short note: the row stores both; a supporter holding red_alerts reads the type and the
--      note through circle_help_alert_view; the supporter's notification carries no note and no type (neutral, as before).
--   B. A supporter without red_alerts, and a stranger, are refused the view.
--   C. An unknown type and a note over 200 characters are refused (22023) and write nothing; the table CHECK refuses a bad type written
--      directly; a blank note is stored as NULL.
--   D. The untyped call still works (older app builds), and there is exactly one send_circle_help_alert (no ambiguous overload).
--   E. anon cannot execute the RPC nor read the table.
--   SABOTAGE (each row expects the broken outcome, so each proves its check can fail): the view's membership gate removed lets the
--   stranger read the request (flips B2); the type check removed from the RPC turns the 22023 refusal into the table CHECK error (flips C1).
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
create function pg_temp.q_anon(p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  set local role anon;
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlstate; end;
  reset role;
  return r;
end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text) returns uuid language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'cchr-' || p_label || '-' || substr(v::text, 1, 8) || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, 'patient'::public.user_role, 'Cchr ' || p_label, '+23481' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true)
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

do $$
declare
  v_org uuid := (select id from public.organisations order by created_at limit 1);
  pat uuid; sup uuid; sup2 uuid; stranger uuid; r text; v jsonb; d text; n integer;
  v_note text := 'Please can you drive me to the lab on Thursday morning';
begin
  pat := pg_temp.mkuser(v_org, 'patient'); sup := pg_temp.mkuser(v_org, 'daughter'); sup2 := pg_temp.mkuser(v_org, 'son');
  stranger := pg_temp.mkuser(v_org, 'stranger');
  perform pg_temp.join_with(pat, sup, array['red_alerts', 'appointments']);
  perform pg_temp.join_with(pat, sup2, array['appointments']);

  -- C first (nothing may be written by a refused call, and a written row would start the cooldown)
  perform pg_temp.ck('C1 an unknown kind of help is refused', 'ERR:22023',
    pg_temp.q_as(pat, $q$select public.send_circle_help_alert(null, null, null, 'diagnosis', null)::text$q$));
  perform pg_temp.ck('C2 a note over 200 characters is refused', 'ERR:22023',
    pg_temp.q_as(pat, format($q$select public.send_circle_help_alert(null, null, null, 'transport', %L)::text$q$, repeat('a', 201))));
  perform pg_temp.ck('C3 the refused calls wrote nothing', '0', (select count(*)::text from public.care_circle_help_alerts where patient_id = pat));
  begin
    insert into public.care_circle_help_alerts (organisation_id, patient_id, request_type, is_test) values (v_org, pat, 'diagnosis', true);
    r := 'inserted';
  exception when check_violation then r := 'ERR:23514';
  end;
  perform pg_temp.ck('C4 the table refuses a bad type written directly', 'ERR:23514', r);

  -- A. a typed request with a note
  delete from public.notifications where template = 'circle_help_tap' and recipient_id in (sup, sup2);
  r := pg_temp.q_as(pat, format($q$select public.send_circle_help_alert(null, null, null, 'transport', %L)::text$q$, '  ' || v_note || '  '));
  perform pg_temp.ck('A1 the request is sent to the one supporter who receives alerts', '1/transport', (r::jsonb ->> 'recipients_told') || '/' || (r::jsonb ->> 'request_type'));
  perform pg_temp.ck('A2 the row stores the type and the trimmed note', 'transport/' || v_note,
    (select request_type || '/' || request_note from public.care_circle_help_alerts where patient_id = pat order by created_at desc limit 1));
  v := pg_temp.q_as(sup, format('select public.circle_help_alert_view(%L::uuid)::text', pat))::jsonb;
  perform pg_temp.ck('A3 the supporter reads the type and the note', 'transport/' || v_note, (v ->> 'request_type') || '/' || (v ->> 'request_note'));
  perform pg_temp.ck('A4 the view carries nothing clinical (only these keys)', 'accuracy_m,alert_id,latitude,longitude,request_note,request_type,sent_at',
    (select string_agg(k, ',' order by k) from jsonb_object_keys(v) k));
  perform pg_temp.ck('A5 the supporter''s notifications carry neither the note nor the type', '0',
    (select count(*)::text from public.notifications where recipient_id = sup and template = 'circle_help_tap'
        and (coalesce(payload::text, '') ilike '%drive me%' or coalesce(payload::text, '') ilike '%transport%')));
  perform pg_temp.ck('A6 the supporter was told in the app', '1',
    (select count(*)::text from public.notifications where recipient_id = sup and template = 'circle_help_tap' and channel = 'in_app'));
  perform pg_temp.ck('A7 the audit names the type and that there was a note, never the note itself', 'true/0',
    coalesce((select (event ->> 'has_note') from public.audit_log where action = 'care_circle.help_alert_sent' and entity_id = (r::jsonb ->> 'alert_id')::uuid limit 1), 'missing')
    || '/' || (select count(*)::text from public.audit_log where entity_id = (r::jsonb ->> 'alert_id')::uuid and event::text ilike '%drive me%'));

  -- B. refusals
  perform pg_temp.ck('B1 a supporter without red_alerts cannot open it', 'ERR:42501', pg_temp.q_as(sup2, format('select public.circle_help_alert_view(%L::uuid)::text', pat)));
  perform pg_temp.ck('B2 a stranger cannot open it', 'ERR:42501', pg_temp.q_as(stranger, format('select public.circle_help_alert_view(%L::uuid)::text', pat)));
  perform pg_temp.ck('B3 a stranger cannot read the row directly', '0', pg_temp.q_as(stranger, 'select count(*)::text from public.care_circle_help_alerts where request_note is not null'));

  -- C5 blank note, D1 untyped call (clear the cooldown and the cap first)
  delete from public.care_circle_help_alerts where patient_id = pat;
  r := pg_temp.q_as(pat, $q$select public.send_circle_help_alert(null, null, null, 'call_me', '   ')::text$q$);
  perform pg_temp.ck('C5 a blank note is stored as nothing', 'call_me/null',
    (select request_type || '/' || coalesce(request_note, 'null') from public.care_circle_help_alerts where patient_id = pat order by created_at desc limit 1));
  delete from public.care_circle_help_alerts where patient_id = pat;
  r := pg_temp.q_as(pat, 'select public.send_circle_help_alert()::text');
  perform pg_temp.ck('D1 the untyped call still asks for help', 'false/null',
    (r::jsonb ->> 'already_sent') || '/' || coalesce((select request_type from public.care_circle_help_alerts where patient_id = pat order by created_at desc limit 1), 'null'));
  perform pg_temp.ck('D2 exactly one send_circle_help_alert exists', '1',
    (select count(*)::text from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname = 'send_circle_help_alert'));

  -- E. anon
  perform pg_temp.ck('E1 anon cannot ask for help', 'ERR:42501', pg_temp.q_anon($q$select public.send_circle_help_alert(null, null, null, 'call_me', null)::text$q$));
  perform pg_temp.ck('E2 anon cannot read the table', 'ERR:42501', pg_temp.q_anon('select count(*)::text from public.care_circle_help_alerts'));

  -- SABOTAGE 1: the membership gate removed from the view lets the stranger in (flips B2)
  begin
    select pg_get_functiondef('public.circle_help_alert_view(uuid)'::regprocedure) into d;
    d := replace(d, 'if m.id is null then raise exception ''you do not support this person'' using errcode = ''42501''; end if;', '');
    if d = pg_get_functiondef('public.circle_help_alert_view(uuid)'::regprocedure) then raise exception 'sabotage 1 did not change the function'; end if;
    execute d;
    r := pg_temp.q_as(stranger, format('select public.circle_help_alert_view(%L::uuid)::text', pat));
    raise exception using errcode = 'P0099';
  exception when sqlstate 'P0099' then null;
  end;
  perform pg_temp.sk('S1 gate removed: the stranger opens the request (flips B2)', 'true', (r like '{%')::text);

  -- SABOTAGE 2: the type check removed from the RPC (flips C1: the table CHECK raises 23514 instead of the clear 22023 refusal)
  delete from public.care_circle_help_alerts where patient_id = pat;
  begin
    select pg_get_functiondef('public.send_circle_help_alert(double precision, double precision, integer, text, text)'::regprocedure) into d;
    d := replace(d, 'if v_type is not null and v_type not in', 'if false and v_type not in');
    if d = pg_get_functiondef('public.send_circle_help_alert(double precision, double precision, integer, text, text)'::regprocedure) then raise exception 'sabotage 2 did not change the function'; end if;
    execute d;
    r := pg_temp.q_as(pat, $q$select public.send_circle_help_alert(null, null, null, 'diagnosis', null)::text$q$);
    raise exception using errcode = 'P0099';
  exception when sqlstate 'P0099' then null;
  end;
  perform pg_temp.sk('S2 type check removed: the clear 22023 refusal becomes the table CHECK error (flips C1)', 'ERR:23514', r);
end $$;

select phase, check_name, expected, actual, case when expected is not distinct from actual then 'PASS' else 'FAIL' end as verdict
  from results order by phase, check_name;
do $$
declare n integer; s integer;
begin
  -- Real rows expect the safe outcome; sabotaged rows expect the BROKEN outcome (the sabotage must really break what the check guards).
  select count(*) into n from results where expected is distinct from actual;
  if n > 0 then raise exception 'care_circle_typed_help_requests: % check(s) did not hold', n; end if;
  select count(*) into s from results where phase = 'sabotaged';
  if s < 2 then raise exception 'care_circle_typed_help_requests: the sabotage steps did not run'; end if;
  if (select count(*) from results where phase = 'real') < 18 then raise exception 'care_circle_typed_help_requests: fewer checks ran than expected'; end if;
end $$;
rollback;
