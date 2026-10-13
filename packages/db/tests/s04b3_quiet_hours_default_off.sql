-- S04b-3 proof: quiet hours default OFF, and turning them off releases only the caller's own held reminders
-- (migration 20261013183217_s04b3_quiet_hours_default_off.sql, needs the S13 migration).
--   1. The active rules row says quiet hours are off; the table column defaults to off.
--   2. set_my_notification_settings(null, ...) stores OFF (a missing value never turns quiet hours on).
--   3. A reminder held by quiet hours (it has a deferred_quiet event) is released when its owner turns quiet hours off;
--      someone else's held reminder, and the owner's own unrelated scheduled reminder, stay as they were.
--   4. A critical row is never touched. anon cannot run the function.
--   5. SABOTAGE: with the release step removed, the held reminder stays held (so check 3 can fail).
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;

create or replace function pg_temp.mkuser(p_org uuid, p_label text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's04b3-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, date_of_birth, is_test)
  values (v, p_org, 'patient'::public.user_role, 'S04b3 ' || p_label, (current_date - interval '45 years')::date, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true;
  return v;
end $f$;

create or replace function pg_temp.try(p_sql text) returns text
language plpgsql as $f$
begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $f$;

create or replace function pg_temp.held(p_org uuid, p_to uuid, p_priority text default 'routine', p_event boolean default true) returns uuid
language plpgsql as $f$
declare v uuid;
begin
  insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload, priority, send_after)
  values (p_org, p_to, 'push', 'pending', 'booking_reminder', '{}'::jsonb, p_priority::public.notification_priority, now() + interval '5 hours')
  returning id into v;
  if p_event then
    insert into public.notification_delivery_events (notification_id, organisation_id, event, provider) values (v, p_org, 'deferred_quiet', 'system');
  end if;
  return v;
end $f$;

do $$
declare
  v_org uuid; v_a uuid; v_b uuid;
  v_held_a uuid; v_sched_a uuid; v_crit_a uuid; v_held_b uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_a := pg_temp.mkuser(v_org, 'a');
  v_b := pg_temp.mkuser(v_org, 'b');

  insert into results values ('real', 'the active rules row has quiet hours off', 'false',
    (select (config -> 'quietHours' ->> 'enabled') from public.notification_rules_config where is_active));
  insert into results values ('real', 'exactly one active rules row', '1', (select count(*)::text from public.notification_rules_config where is_active));
  insert into results values ('real', 'the column default is off', 'false',
    (select (column_default)::text from information_schema.columns where table_name = 'notification_settings' and column_name = 'quiet_enabled'));

  v_held_a := pg_temp.held(v_org, v_a);
  v_sched_a := pg_temp.held(v_org, v_a, 'routine', false);
  v_crit_a := pg_temp.held(v_org, v_a, 'critical');
  v_held_b := pg_temp.held(v_org, v_b);

  perform set_config('request.jwt.claim.sub', v_a::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  set local role authenticated;

  insert into results values ('real', 'a null choice stores off', 'ok', pg_temp.try($q$select public.set_my_notification_settings(null, '22:00', '06:00', null)$q$));
  reset role;
  insert into results values ('real', 'the saved row is off', 'false', (select quiet_enabled::text from public.notification_settings where profile_id = v_a));
  insert into results values ('real', 'turning off released the caller''s held reminder', 'null',
    coalesce((select send_after::text from public.notifications where id = v_held_a), 'null'));
  insert into results values ('real', 'the caller''s own unrelated scheduled reminder stays scheduled', 'true',
    (select (send_after is not null)::text from public.notifications where id = v_sched_a));
  insert into results values ('real', 'a critical row is never touched', 'true',
    (select (send_after is not null)::text from public.notifications where id = v_crit_a));
  insert into results values ('real', 'someone else''s held reminder stays held', 'true',
    (select (send_after is not null)::text from public.notifications where id = v_held_b));

  set local role authenticated;
  perform pg_temp.try($q$select public.set_my_notification_settings(true, '21:00', '07:00', true)$q$);
  reset role;
  insert into results values ('real', 'turning on stores on, and discreet mode', 'true,true',
    (select quiet_enabled::text from public.notification_settings where profile_id = v_a) || ',' || (select discreet_mode::text from public.profiles where id = v_a));

  set local role authenticated;
  perform pg_temp.try($q$select public.set_my_notification_settings(null, '21:00', '07:00', null)$q$);
  reset role;
  insert into results values ('real', 'a null choice leaves an existing opt-in on', 'true',
    (select quiet_enabled::text from public.notification_settings where profile_id = v_a));

  v_held_a := pg_temp.held(v_org, v_a);
  set local role authenticated;
  perform pg_temp.try($q$select public.set_my_notification_settings(true, '21:00', '07:00', false)$q$);
  reset role;
  insert into results values ('real', 'a discreet-only save does not release a held reminder', 'true',
    (select (send_after is not null)::text from public.notifications where id = v_held_a));

  set local role anon;
  insert into results values ('real', 'anon cannot run the settings function', '42501', pg_temp.try($q$select public.set_my_notification_settings(true, '21:00', '07:00', true)$q$));
  reset role;

  -- SABOTAGE: drop the release step; the held reminder must stay held after turning off
  execute replace(pg_get_functiondef('public.set_my_notification_settings(boolean,time,time,boolean)'::regprocedure),
                  'update public.notifications n set send_after = null', 'update public.notifications n set send_after = n.send_after');
  perform set_config('request.jwt.claim.sub', v_b::text, true);
  set local role authenticated;
  perform pg_temp.try($q$select public.set_my_notification_settings(false, '22:00', '06:00', null)$q$);
  reset role;
  insert into results values ('sabotaged', 'with the release removed the held reminder is released', 'null',
    coalesce((select send_after::text from public.notifications where id = v_held_b), 'null'));
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S04b-3 proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ')
         from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught = 0 then raise exception 'VACUOUS TEST: removing the release step did not change the result'; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;

rollback;
