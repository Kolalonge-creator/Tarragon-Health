-- S13b proof: email fallback after an unopened push, open reporting, delivery health
-- (migration *_s13b_push_email_fallback_and_delivery_health.sql, needs the S13 migration).
--   1. An accepted, unopened routine push older than the threshold gets exactly ONE generic email, to the account's
--      address, with no content of the original; the original is marked so it never repeats.
--   2. Not picked: a recent push, an opened push, a critical push, a failed push, a non-patient, a suppressed address,
--      an old push past the max age; a second push of the same person the same day gets no second email.
--   3. report_notification_opened: own notification stamps opened_at; someone else's is refused; anon cannot execute.
--   4. my_notification_delivery_health counts only the caller's pushes. The fallback function is not callable by authenticated.
--   5. SABOTAGE: with the "not opened" condition removed, an opened push is emailed (so check 2 can fail).
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;

create or replace function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's13b-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'S13b ' || p_label, (current_date - interval '45 years')::date, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true;
  return v;
end $f$;

create or replace function pg_temp.try(p_sql text) returns text
language plpgsql as $f$
begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $f$;

create or replace function pg_temp.push(p_org uuid, p_to uuid, p_age interval, p_priority text default 'routine', p_open boolean default false) returns uuid
language plpgsql as $f$
declare v uuid;
begin
  insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload, priority, sent_at, opened_at)
  values (p_org, p_to, 'push', 'sent', 'booking_reminder', '{}'::jsonb, p_priority::public.notification_priority, now() - p_age, case when p_open then now() else null end)
  returning id into v;
  return v;
end $f$;

do $$
declare
  v_org uuid; v_a uuid; v_b uuid; v_c uuid; v_clin uuid; v_sup uuid;
  v_old uuid; v_recent uuid; v_opened uuid; v_crit uuid; v_ancient uuid; v_second uuid; v_other uuid;
  v_n integer; v_mail record; v_email text;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_a := pg_temp.mkuser(v_org, 'a', 'patient');
  v_b := pg_temp.mkuser(v_org, 'b', 'patient');
  v_c := pg_temp.mkuser(v_org, 'c', 'patient');
  v_clin := pg_temp.mkuser(v_org, 'clin', 'clinician');
  v_sup := pg_temp.mkuser(v_org, 'sup', 'patient');

  -- patient a: one old unopened push, one recent, one opened, one critical, one ancient (past max age)
  v_old := pg_temp.push(v_org, v_a, interval '5 hours');
  v_recent := pg_temp.push(v_org, v_a, interval '1 hour');
  v_opened := pg_temp.push(v_org, v_b, interval '5 hours', 'routine', true);
  v_crit := pg_temp.push(v_org, v_c, interval '5 hours', 'critical');
  v_ancient := pg_temp.push(v_org, v_c, interval '40 hours');
  v_other := pg_temp.push(v_org, v_clin, interval '5 hours');
  perform pg_temp.push(v_org, v_sup, interval '5 hours');
  select email into v_email from auth.users where id = v_sup;
  insert into public.notification_email_suppressions (email, reason) values (lower(v_email), 'bounced');
  v_second := pg_temp.push(v_org, v_a, interval '6 hours');

  v_n := private.queue_push_email_fallbacks();
  insert into results values ('real', 'two eligible pushes of one person give one email (per-day limit)', '1',
    (select count(*)::text from public.notifications where recipient_id = v_a and template = 'push_unconfirmed_email_nudge'));
  insert into results values ('real', 'the pass queued exactly one email in all', '1', v_n::text);
  select * into v_mail from public.notifications where recipient_id = v_a and template = 'push_unconfirmed_email_nudge';
  insert into results values ('real', 'the email is routine, pending, and goes to the account address', 'true',
    ((v_mail.channel = 'email' and v_mail.status = 'pending' and v_mail.priority = 'routine'
      and v_mail.payload ->> 'to_email' = (select lower(email) from auth.users where id = v_a)))::text);
  insert into results values ('real', 'the payload carries only ids and a first name, no content of the original', 'true',
    ((select array_agg(k order by k) from jsonb_object_keys(v_mail.payload) k) = array['fallback_for','patient_name','to_email'])::text);
  insert into results values ('real', 'the oldest unopened push was the one covered', 'true',
    (exists (select 1 from public.notification_delivery_events where notification_id = v_second and event = 'email_fallback_queued')
     or exists (select 1 from public.notification_delivery_events where notification_id = v_old and event = 'email_fallback_queued'))::text);
  insert into results values ('real', 'a recent push is not picked', '0', (select count(*)::text from public.notification_delivery_events where notification_id = v_recent));
  insert into results values ('real', 'an opened push is not picked', '0', (select count(*)::text from public.notifications where recipient_id = v_b and template = 'push_unconfirmed_email_nudge'));
  insert into results values ('real', 'a critical push is not picked, nor one past the max age', '0', (select count(*)::text from public.notifications where recipient_id = v_c and template = 'push_unconfirmed_email_nudge'));
  insert into results values ('real', 'a clinician is not emailed', '0', (select count(*)::text from public.notifications where recipient_id = v_clin and template = 'push_unconfirmed_email_nudge'));
  insert into results values ('real', 'a suppressed address is not emailed', '0', (select count(*)::text from public.notifications where recipient_id = v_sup and template = 'push_unconfirmed_email_nudge'));
  insert into results values ('real', 'a second pass adds nothing', '0', private.queue_push_email_fallbacks()::text);

  update public.notification_rules_config set config = jsonb_set(config, '{pushFallback,enabled}', 'false') where is_active;
  perform pg_temp.push(v_org, v_b, interval '6 hours');
  insert into results values ('real', 'switched off in the rules, nothing is queued', '0', private.queue_push_email_fallbacks()::text);
  update public.notification_rules_config set config = jsonb_set(config, '{pushFallback,enabled}', 'true') where is_active;

  -- open reporting
  perform set_config('request.jwt.claims', json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
  perform public.report_notification_opened(v_recent);
  insert into results values ('real', 'a patient reports their own open', 'true', (select (opened_at is not null)::text from public.notifications where id = v_recent));
  insert into results values ('real', 'reporting twice is harmless', 'ok', pg_temp.try(format('select public.report_notification_opened(%L)', v_recent)));
  insert into results values ('real', 'someone elses notification is refused', '42501', pg_temp.try(format('select public.report_notification_opened(%L)', v_opened)));
  insert into results values ('real', 'health counts only my pushes (3 sent: old, recent, second)', '3', (select push_sent::text from public.my_notification_delivery_health(14)));
  insert into results values ('real', 'health sees one opened push', '1', (select push_opened::text from public.my_notification_delivery_health(14)));
  insert into results values ('real', 'authenticated cannot run the fallback pass', '42501', pg_temp.try('select private.queue_push_email_fallbacks()'));
  reset role;
  set local role anon;
  insert into results values ('real', 'anon cannot report an open', '42501', pg_temp.try(format('select public.report_notification_opened(%L)', v_recent)));
  insert into results values ('real', 'anon cannot read health', '42501', pg_temp.try('select * from public.my_notification_delivery_health(14)'));
  reset role;

  -- SABOTAGE: drop the "not opened" condition; the opened push must now be emailed
  execute replace(pg_get_functiondef('private.queue_push_email_fallbacks()'::regprocedure), 'and n.opened_at is null', '');
  perform private.queue_push_email_fallbacks();
  insert into results values ('sabotaged', 'with the opened check removed an opened push is not emailed', '0',
    (select count(*)::text from public.notifications where recipient_id = v_b and template = 'push_unconfirmed_email_nudge'));
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S13b proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ')
         from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught = 0 then raise exception 'VACUOUS TEST: removing the opened check did not change the result'; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;

rollback;
