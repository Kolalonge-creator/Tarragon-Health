-- S47 proof: hand-over at 18 with a 90-day grace period that ends by itself (migration *_s47_handover_grace_period_and_auto_end.sql).
-- One rolled-back transaction, simulated guardian JWT sessions with controls.
-- Proves:
--   1. At the 18th birthday the guardians are view-only; day 1 sends the first notice; a second sweep on the same day sends none; days 30, 60 and 85 each
--      send one; a missed notice is caught up once, not replayed; the notice text names no condition (INV-07), is queued as non_clinical on the patient's
--      own reminder channel (so quiet hours and discreet mode apply), and the event carries ids and a day number only.
--   2. Day 89 is still inside the grace (control: the guardian still reads). Day 90 ENDS every guardian's access when the young person has not chosen
--      (a simulated guardian JWT reads ZERO rows afterwards, ONE row before), is audited, emits one expired event with counts only, and closes the row.
--   3. A young person who did choose (complete_dependant_handover) keeps exactly the guardian they ticked, view-only, after day 90; the others are gone.
--   4. The emergency card is untouched by the expiry. Completing after expiry is refused. The sweep and the expiry are not callable by a session.
--   5. SABOTAGE: the expiry made a no-op, the grace stretched to a year, and the notice days emptied; the matching checks must flip.
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
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
end $f$;
create function pg_temp.back() returns void language plpgsql as
$f$ begin reset role; perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.role', '', true); end $f$;
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
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text, p_dob date default null) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid(); v_phone text := '+23481' || lpad((random() * 99999999)::int::text, 8, '0');
begin
  insert into auth.users (id, email, phone, phone_confirmed_at, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's42-' || p_label || '-' || v || '@example.invalid', v_phone, now(), 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'S42 ' || p_label || ' Person', v_phone, coalesce(p_dob, (current_date - interval '45 years')::date), true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, full_name = excluded.full_name, phone = excluded.phone, date_of_birth = excluded.date_of_birth;
  return v;
end $f$;
create function pg_temp.vitals_seen_by(p_uid uuid, p_patient uuid) returns text language sql as
$$ select pg_temp.q_as(p_uid, format('select count(*)::text from public.vitals_readings where patient_id = %L', p_patient)) $$;


create function pg_temp.setf(p text, p_v uuid) returns void language sql as
$$ insert into fx values (p, p_v) on conflict (k) do update set v = excluded.v $$;
create function pg_temp.mkchild(p_label text, p_org uuid, p_birthday_days_ago integer) returns uuid language plpgsql as
$f$ declare v uuid; g1 uuid; g2 uuid;
begin
  v := pg_temp.mkuser(p_org, p_label, 'patient', ((now() at time zone 'Africa/Lagos')::date - interval '18 years' - make_interval(days => p_birthday_days_ago))::date);
  update public.profiles set is_dependent_account = true, dependent_kind = 'minor_child' where id = v;
  g1 := pg_temp.mkuser(p_org, p_label || '-g1', 'patient'); g2 := pg_temp.mkuser(p_org, p_label || '-g2', 'patient');
  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by, created_at) values (v, g1, 'manage', g1, now() - interval '400 days'), (v, g2, 'manage', g2, now() - interval '400 days');   -- the guardians' era, long before the birthday
  -- an adult's record is read through a category grant, so the guardians hold the vitals category (the S42 proof grants it the same way)
  alter table public.profile_access_categories disable trigger user;   -- fixture only: the owner-only guard would refuse a seed written outside their session
  insert into public.profile_access_categories (profile_access_id, category) select pa.id, 'vitals_readings' from public.profile_access pa where pa.profile_id = v;
  alter table public.profile_access_categories enable trigger user;
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, weight_kg) values (p_org, v, 'weight', 50);
  perform pg_temp.setf(p_label, v); perform pg_temp.setf(p_label || '-g1', g1); perform pg_temp.setf(p_label || '-g2', g2);
  return v;
end $f$;
create function pg_temp.notice_days(p_pat uuid) returns text language sql as
$$ select coalesce((select string_agg((n.payload ->> 'day'), ',' order by n.created_at, (n.payload ->> 'day')::int) from public.notifications n where n.recipient_id = p_pat and n.template = 'dependant_handover_notice'), '') $$;
create function pg_temp.at_day(p_pat uuid, p_day integer) returns void language sql as
$$ update public.dependant_handovers set birthday_18 = (now() at time zone 'Africa/Lagos')::date - (p_day - 1) where patient_id = p_pat $$;

do $$
declare
  v_org uuid; a uuid; a1 uuid; a2 uuid; b uuid; b1 uuid; b2 uuid; c uuid; c1 uuid; c2 uuid; n integer; v_end date;
begin
  select id into v_org from public.organisations order by created_at limit 1;

  -- ===== A: never chooses =======================================================================================================
  a := pg_temp.mkchild('child-a', v_org, 0);  a1 := pg_temp.f('child-a-g1'); a2 := pg_temp.f('child-a-g2');
  insert into public.emergency_cards (patient_id, organisation_id, token, is_active) values (a, v_org, repeat('e', 40), true);
  perform pg_temp.ck('config: 90 days, notices on days 1, 30, 60, 85, PROPOSED', '90,{1,30,60,85},proposed',
    (select grace_days || ',' || notice_days::text || ',' || status from public.handover_config where is_active));
  perform private.sweep_dependant_handovers();
  perform pg_temp.ck('the row exists and is due', 'due', (select state from public.dependant_handovers where patient_id = a));
  perform pg_temp.ck('at 18 the guardians are view-only', 'view|view', (select string_agg(permission_level::text, '|') from public.profile_access where profile_id = a));
  perform pg_temp.ck('control: a guardian still reads on day 1', '1', pg_temp.vitals_seen_by(a1, a));
  perform pg_temp.ck('day 1 sends the first notice', '1', pg_temp.notice_days(a));
  perform private.sweep_dependant_handovers();
  perform pg_temp.ck('a second sweep on the same day sends none', '1', pg_temp.notice_days(a));
  perform pg_temp.ck('the notice is non_clinical, queued, for the young person, on one channel', '1,non_clinical,pending',
    (select count(*)::text || ',' || min(n.content_class::text) || ',' || min(n.status::text) from public.notifications n where n.recipient_id = a and n.template = 'dependant_handover_notice'));
  perform pg_temp.ck('INV-07: the notice text names no condition, reading, result or medicine', '0',
    (select coalesce(sum(cardinality(private.notification_text_violations(coalesce(l.subject, '') || ' ' || l.body))), 0)::text
       from public.notification_template_locales l where l.template_key = 'dependant_handover_notice'));
  perform pg_temp.ck('...and the template carries no clinical placeholder', 'false',
    (select bool_or(l.body ~* '\{\{\s*(condition|diagnosis|medicine|medication|result|reading)')::text from public.notification_template_locales l where l.template_key = 'dependant_handover_notice'));
  perform pg_temp.ck('the notice event carries an id and a day number only', 'day,handover_id',
    (select string_agg(k, ',' order by k) from (select distinct jsonb_object_keys(payload) k from public.domain_events e where e.event_type = 'dependant.handover_notice' and e.patient_id = a) x));
  perform pg_temp.ck('my_handover shows the end date and the days left', '90,' || ((now() at time zone 'Africa/Lagos')::date + 90)::text,
    pg_temp.q_as(a, $q$select (public.my_handover() ->> 'days_left') || ',' || (public.my_handover() ->> 'access_ends_on')$q$));
  -- day 30
  perform pg_temp.at_day(a, 30); perform private.sweep_dependant_handovers();
  perform pg_temp.ck('day 30 sends the second notice', '1,30', pg_temp.notice_days(a));
  perform pg_temp.at_day(a, 45); perform private.sweep_dependant_handovers();
  perform pg_temp.ck('day 45 sends nothing new', '1,30', pg_temp.notice_days(a));
  perform pg_temp.at_day(a, 60); perform private.sweep_dependant_handovers();
  perform pg_temp.at_day(a, 85); perform private.sweep_dependant_handovers();
  perform pg_temp.ck('days 60 and 85 send one each', '1,30,60,85', pg_temp.notice_days(a));
  -- on day 20 the young person lets someone in themselves (a grant made after the birthday, not a guardian's)
  perform pg_temp.setf('own-choice', pg_temp.mkuser(v_org, 'own-choice', 'patient'));
  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by, created_at) values (a, pg_temp.f('own-choice'), 'view', a, now());
  perform pg_temp.at_day(a, 89); perform private.sweep_dependant_handovers();
  perform pg_temp.ck('CONTROL day 89: still inside the grace, nothing ended, guardian still reads', 'due,3,1',
    (select state from public.dependant_handovers where patient_id = a) || ',' || (select count(*)::text from public.profile_access where profile_id = a) || ',' || pg_temp.vitals_seen_by(a1, a));
  -- day 90: the grace has run out
  perform pg_temp.at_day(a, 91); perform private.sweep_dependant_handovers();
  perform pg_temp.ck('once the 90 day grace has run out: access ENDS automatically (the guardians go, the person they let in themselves stays)', 'expired,1,2',
    (select state from public.dependant_handovers where patient_id = a) || ',' || (select count(*)::text from public.profile_access where profile_id = a) || ',' || (select guardians_ended::text from public.dependant_handovers where patient_id = a));
  perform pg_temp.ck('a simulated guardian JWT now reads ZERO rows (it read one before)', '0|0', pg_temp.vitals_seen_by(a1, a) || '|' || pg_temp.vitals_seen_by(a2, a));
  perform pg_temp.ck('a person the young person let in AFTER the birthday is theirs to keep: still there, untouched', '1,view',
    (select count(*)::text || ',' || min(permission_level::text) from public.profile_access where profile_id = a and grantee_user_id = pg_temp.f('own-choice')));
  perform pg_temp.ck('one expired event, counts only', '1,guardians_ended|handover_id',
    (select count(*)::text from public.domain_events where event_type = 'dependant.handover_expired' and patient_id = a) || ',' ||
    (select string_agg(k, '|' order by k) from (select distinct jsonb_object_keys(payload) k from public.domain_events e where e.event_type = 'dependant.handover_expired' and e.patient_id = a) x));
  perform pg_temp.ck('the expiry is audited', '1', (select count(*)::text from public.audit_log where action = 'dependant.handover_expired' and entity_id = a));
  perform pg_temp.ck('the emergency card is untouched', 'true,1',
    (select (is_active and revoked_at is null)::text from public.emergency_cards where patient_id = a) || ',' || (select count(*)::text from public.emergency_cards where patient_id = a));
  perform private.sweep_dependant_handovers();
  perform pg_temp.ck('a later sweep does nothing more (idempotent)', '1,1', (select count(*)::text from public.domain_events where event_type = 'dependant.handover_expired' and patient_id = a) || ',' || (select count(*)::text from public.audit_log where action = 'dependant.handover_expired' and entity_id = a));

  -- ===== B: the young person chose, keeping guardian two =============================================================================
  b := pg_temp.mkchild('child-b', v_org, 20); b1 := pg_temp.f('child-b-g1'); b2 := pg_temp.f('child-b-g2');
  perform private.sweep_dependant_handovers();   -- the row is made while they are still a dependant
  update public.profiles set is_dependent_account = false, dependent_kind = null where id = b;   -- then they claim their own login
  perform private.sweep_dependant_handovers();
  perform pg_temp.ck('child B: the choice is still open on day 21', 'due', (select state from public.dependant_handovers where patient_id = b));
  perform pg_temp.ck('child B completes the hand-over keeping guardian two', 'ok', pg_temp.try_as(b, format('select public.complete_dependant_handover(array[%L]::uuid[])', b2)));
  perform pg_temp.at_day(b, 120); perform private.sweep_dependant_handovers();
  perform pg_temp.ck('after day 90 the kept guardian is still there, view-only; the other is gone', '1,view,0',
    (select count(*)::text from public.profile_access where profile_id = b and grantee_user_id = b2) || ',' || (select permission_level::text from public.profile_access where profile_id = b and grantee_user_id = b2) || ',' ||
    (select count(*)::text from public.profile_access where profile_id = b and grantee_user_id = b1));
  perform pg_temp.ck('child B stays completed (never expired)', 'completed', (select state from public.dependant_handovers where patient_id = b));

  -- ===== C: has their own login but never chose ========================================================================================
  c := pg_temp.mkchild('child-c', v_org, 100); c1 := pg_temp.f('child-c-g1'); c2 := pg_temp.f('child-c-g2');
  update public.profiles set is_dependent_account = false, dependent_kind = null where id = c;
  insert into public.dependant_handovers (organisation_id, patient_id, birthday_18, is_test, notices_sent) values (v_org, c, (now() at time zone 'Africa/Lagos')::date - 100, true, array[1, 30, 60, 85]);   -- it HAS had its notices
  perform private.sweep_dependant_handovers();
  perform pg_temp.ck('child C never chose: every guardian ended when the grace ran out', 'expired,0',
    (select state from public.dependant_handovers where patient_id = c) || ',' || (select count(*)::text from public.profile_access where profile_id = c));
  perform pg_temp.ck('completing after expiry is refused', 'P0002', pg_temp.try_as(c, 'select public.complete_dependant_handover(''{}'')'));

  -- ===== late row: the grace period had ALREADY run out before the sweep first saw it. Nothing ends silently. ================================
  perform pg_temp.mkchild('child-late', v_org, 200);
  perform private.ensure_dependant_handover(pg_temp.f('child-late'));
  perform pg_temp.at_day(pg_temp.f('child-late'), 201);
  perform private.sweep_dependant_handovers();
  perform pg_temp.ck('late row: access did NOT end on the first sweep, a notice went out and a 30 day window was set', 'due,2,85,true',
    (select state from public.dependant_handovers where patient_id = pg_temp.f('child-late')) || ',' || (select count(*)::text from public.profile_access where profile_id = pg_temp.f('child-late')) || ',' ||
    pg_temp.notice_days(pg_temp.f('child-late')) || ',' || (select (expiry_not_before = (now() at time zone 'Africa/Lagos')::date + 30)::text from public.dependant_handovers where patient_id = pg_temp.f('child-late')));
  perform pg_temp.ck('late row: the guardian can still read during the window', '1', pg_temp.vitals_seen_by(pg_temp.f('child-late-g1'), pg_temp.f('child-late')));
  perform pg_temp.ck('late row: a second sweep the same day ends nothing and sends no second notice', 'due,2,85',
    (select state from public.dependant_handovers where patient_id = pg_temp.f('child-late')) || ',' || (select count(*)::text from public.profile_access where profile_id = pg_temp.f('child-late')) || ',' || pg_temp.notice_days(pg_temp.f('child-late')));
  update public.dependant_handovers set expiry_not_before = (now() at time zone 'Africa/Lagos')::date where patient_id = pg_temp.f('child-late');
  perform private.sweep_dependant_handovers();
  perform pg_temp.ck('late row: once the notice window has passed, access ends', 'expired,0',
    (select state from public.dependant_handovers where patient_id = pg_temp.f('child-late')) || ',' || (select count(*)::text from public.profile_access where profile_id = pg_temp.f('child-late')));
  -- ===== privileges ========================================================================================================================
  perform pg_temp.ck('a session cannot run the sweep or the expiry', 'false,false',
    has_function_privilege('authenticated', 'private.sweep_dependant_handovers()', 'EXECUTE')::text || ',' || has_function_privilege('authenticated', 'private.expire_dependant_handover(uuid)', 'EXECUTE')::text);
  perform pg_temp.ck('anon cannot read the config rows for write', 'false', has_table_privilege('anon', 'public.handover_config', 'SELECT')::text);
  perform pg_temp.setf('sab-pat', a);
end $$;

-- Sabotage ---------------------------------------------------------------------------------------------------------------------------------
-- A: the expiry made a no-op. A guardian must then still read after day 90 (the real check flips).
do $$
declare v_org uuid; d uuid; d1 uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  d := pg_temp.mkchild('child-d', v_org, 95); d1 := pg_temp.f('child-d-g1');
  create or replace function private.expire_dependant_handover(p_handover uuid) returns boolean language sql as $f$ select false $f$;
  perform private.sweep_dependant_handovers();
  insert into results values ('sabotaged', 'a simulated guardian JWT now reads ZERO rows (it read one before)', '0|0', pg_temp.vitals_seen_by(d1, d) || '|' || pg_temp.vitals_seen_by(pg_temp.f('child-d-g2'), d));
end $$;
-- B: the grace stretched to a year. Day 91 must then not end access (the real check flips).
do $$
declare v_org uuid; e uuid; e1 uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  update public.handover_config set grace_days = 365 where is_active;
  e := pg_temp.mkchild('child-e', v_org, 95); e1 := pg_temp.f('child-e-g1');
  perform private.sweep_dependant_handovers();
  insert into results values ('sabotaged', 'child C never chose: every guardian ended when the grace ran out', 'expired,0',
    (select state from public.dependant_handovers where patient_id = e) || ',' || (select count(*)::text from public.profile_access where profile_id = e));
end $$;
-- C: the notice days emptied to a day that never comes. The day-1 notice must then not be sent.
do $$
declare v_org uuid; f uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  update public.handover_config set notice_days = array[999] where is_active;
  f := pg_temp.mkchild('child-f', v_org, 0);
  perform private.sweep_dependant_handovers();
  insert into results values ('sabotaged', 'day 1 sends the first notice', '1', pg_temp.notice_days(f));
end $$;

-- D (review fix): the late-row protection removed. A row first seen after its grace has run out must then end silently (the real check flips).
do $$
declare v_org uuid; g uuid; g1 uuid; v_def text;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  update public.handover_config set grace_days = 90, notice_days = array[1, 30, 60, 85] where is_active;
  create or replace function private.expire_dependant_handover(p_handover uuid) returns boolean language sql as $f$ select false $f$;
  v_def := pg_get_functiondef('private.sweep_dependant_handovers()'::regprocedure);
  v_def := replace(v_def, 'if cardinality(r.notices_sent) = 0 and r.expiry_not_before is null and v_today >= v_end then', 'if false then');
  execute v_def;
  g := pg_temp.mkchild('child-late2', v_org, 200); g1 := pg_temp.f('child-late2-g1');
  perform private.ensure_dependant_handover(g);
  perform pg_temp.at_day(g, 201);
  perform private.sweep_dependant_handovers();
  insert into results values ('sabotaged', 'late row: access did NOT end on the first sweep, a notice went out and a 30 day window was set', 'due,2,85,true',
    (select state from public.dependant_handovers where patient_id = g) || ',' || (select count(*)::text from public.profile_access where profile_id = g) || ',' || pg_temp.notice_days(g) || ',' ||
    coalesce((select (expiry_not_before is not null)::text from public.dependant_handovers where patient_id = g), 'null'));
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S47 proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ')
         from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 4 then raise exception 'VACUOUS TEST: the sabotage flipped % of 4 checks', v_caught; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;

rollback;
