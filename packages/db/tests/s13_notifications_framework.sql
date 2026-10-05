-- S13 proof: notifications framework with the INV-07 lint (migration *_s13_notifications_framework.sql).
--
-- One rolled-back transaction:
--   1. The term function flags terms, stems, forbidden placeholders, a BP pair and a unit; leaves neutral text alone.
--   2. The locale trigger refuses an active row naming clinical content (insert and update), allows an inactive one.
--   3. Live data: no active locale row names clinical content; no active patient sms row.
--   4. Quiet hours and discreet mode: a patient writes only through the RPC, reads only their own row, two equal
--      times are refused, discreet_mode is written, anon cannot execute, another patient sees nothing.
--   5. Delivery events: append only; delivered and opened stamp the notification; token_dead disables the
--      subscription; a bounce suppresses the address; the receipt claim returns old unresolved tickets only;
--      patients cannot read events or call the recorder; admin can read.
--   6. Rules config: one active row.
--   7. SABOTAGE: with the locale trigger dropped a clinical row is accepted (so check 2 can fail).
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;

create or replace function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's13-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'S13 ' || p_label, (current_date - interval '45 years')::date, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true;
  return v;
end $f$;

create or replace function pg_temp.try(p_sql text) returns text
language plpgsql as $f$
begin
  execute p_sql;
  return 'ok';
exception when others then
  return sqlstate;
end $f$;

do $$
declare
  v_org uuid; v_p uuid; v_p2 uuid; v_admin uuid; v_n uuid; v_sub uuid; v_k integer; v_t text; v_cnt integer;
  v_buf text[] := '{}';
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_p := pg_temp.mkuser(v_org, 'p1', 'patient');
  v_p2 := pg_temp.mkuser(v_org, 'p2', 'patient');
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');

  -- 1. term function ---------------------------------------------------------------------------
  insert into results values ('real', 'neutral text has no violation', '0',
    cardinality(private.notification_text_violations('Hi, a reminder is waiting for you. Open the Tarragon Health app.'))::text);
  insert into results values ('real', 'a condition is flagged', 'true', ('term:diabet*' = any (private.notification_text_violations('Your diabetes check is due')))::text);
  insert into results values ('real', 'a stem matches an ending', 'true', ('term:medication*' = any (private.notification_text_violations('Your medications are ready')))::text);
  insert into results values ('real', 'a clinical placeholder is flagged by name', 'true', ('param:drug_name' = any (private.notification_text_violations('Take {{drug_name}}')))::text);
  insert into results values ('real', 'a placeholder value is not a term', '0', cardinality(private.notification_text_violations('Hi {{patient_name}}, an order is ready'))::text);
  insert into results values ('real', 'a BP pair is flagged', 'true', ('number:pair' = any (private.notification_text_violations('You logged 150/95 today')))::text);
  insert into results values ('real', 'a unit is flagged', 'true', ('number:unit' = any (private.notification_text_violations('Level 7.2 mmol/L')))::text);
  insert into results values ('real', 'a word inside another word is not flagged (scanned)', '0', cardinality(private.notification_text_violations('Your card was scanned'))::text);

  -- 2. locale trigger -----------------------------------------------------------------------------
  insert into public.notification_templates (key, category, business_priority, audience, default_channels, description)
  values ('s13_probe', 'operational', 'routine', 'patient', array['in_app']::public.notification_channel[], 'S13 proof');
  insert into results values ('real', 'an active row naming a condition is refused', '23514',
    pg_temp.try($q$insert into public.notification_template_locales (template_key, locale, channel, body) values ('s13_probe', 'en', 'in_app', 'Your diabetes check is due')$q$));
  insert into results values ('real', 'an active row reading a clinical placeholder is refused', '23514',
    pg_temp.try($q$insert into public.notification_template_locales (template_key, locale, channel, body) values ('s13_probe', 'en', 'in_app', 'Time for {{drug_name}}')$q$));
  insert into results values ('real', 'a neutral row is accepted', 'ok',
    pg_temp.try($q$insert into public.notification_template_locales (template_key, locale, channel, body) values ('s13_probe', 'en', 'in_app', 'Something is waiting in your app')$q$));
  insert into results values ('real', 'updating a row to clinical wording is refused', '23514',
    pg_temp.try($q$update public.notification_template_locales set body = 'Your blood pressure is high' where template_key = 's13_probe'$q$));
  insert into results values ('real', 'an inactive row may hold any text', 'ok',
    pg_temp.try($q$insert into public.notification_template_locales (template_key, locale, channel, body, is_active) values ('s13_probe', 'en', 'email', 'Your diabetes check is due', false)$q$));
  insert into results values ('real', 'turning that inactive row on is refused', '23514',
    pg_temp.try($q$update public.notification_template_locales set is_active = true where template_key = 's13_probe' and channel = 'email'$q$));

  -- 3. live data ---------------------------------------------------------------------------------
  select count(*) into v_cnt from public.notification_template_locales l
   where l.is_active and cardinality(private.notification_text_violations(coalesce(l.subject, '') || ' ' || l.body)) > 0;
  insert into results values ('real', 'no active locale row names clinical content', '0', v_cnt::text);
  select count(*) into v_cnt from public.notification_template_locales l join public.notification_templates t on t.key = l.template_key
   where l.is_active and l.channel = 'sms' and t.audience <> 'clinician';
  insert into results values ('real', 'no active patient-facing sms row (INV-08)', '0', v_cnt::text);

  -- 6. rules config -------------------------------------------------------------------------------
  select count(*) into v_cnt from public.notification_rules_config where is_active;
  insert into results values ('real', 'exactly one active rules row', '1', v_cnt::text);
  insert into results values ('real', 'a second active rules row is refused', '23505',
    pg_temp.try($q$insert into public.notification_rules_config (version, is_active, config) values (9999, true, '{}'::jsonb)$q$));

  -- 4. settings -----------------------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_p, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
  perform public.set_my_notification_settings(true, '22:00', '06:30', true);
  insert into results values ('real', 'patient reads own settings row', '1', (select count(*)::text from public.notification_settings));
  insert into results values ('real', 'quiet end saved', '06:30:00', (select quiet_end::text from public.notification_settings));
  insert into results values ('real', 'discreet mode written to the profile', 'true', (select discreet_mode::text from public.profiles where id = v_p));
  insert into results values ('real', 'equal start and end refused', '22023', pg_temp.try($q$select public.set_my_notification_settings(true, '08:00', '08:00', null)$q$));
  insert into results values ('real', 'patient cannot write the table directly', '42501',
    pg_temp.try($q$insert into public.notification_settings (profile_id, organisation_id) select id, organisation_id from public.profiles limit 1$q$));
  insert into results values ('real', 'patient cannot read delivery events', '0', (select count(*)::text from public.notification_delivery_events));
  insert into results values ('real', 'patient cannot call the event recorder', '42501',
    pg_temp.try($q$select public.record_notification_delivery_event(gen_random_uuid(), 'delivered')$q$));
  insert into results values ('real', 'patient cannot read the term list', '0', (select count(*)::text from public.notification_forbidden_terms));
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', v_p2, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into results values ('real', 'another patient sees no settings row', '0', (select count(*)::text from public.notification_settings));
  reset role;

  set local role anon;
  insert into results values ('real', 'anon cannot call the settings RPC', '42501', pg_temp.try($q$select public.set_my_notification_settings(true, '22:00', '06:00', null)$q$));
  reset role;

  -- 5. delivery events ----------------------------------------------------------------------------
  insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
  values (v_org, v_p, 'push', 'sent', 's13_probe', '{}'::jsonb) returning id into v_n;
  insert into public.push_subscriptions (organisation_id, profile_id, endpoint, p256dh_key, auth_key, platform, expo_push_token)
  values (v_org, v_p, 's13-endpoint-' || gen_random_uuid(), 'k', 'a', 'android', 'ExponentPushToken[s13]') returning id into v_sub;

  perform public.record_notification_delivery_event(v_n, 'receipt_pending', 'expo', 'ticket-old', jsonb_build_object('subscription_id', v_sub));
  perform public.record_notification_delivery_event(v_n, 'receipt_pending', 'expo', 'ticket-done', '{}'::jsonb);
  perform public.record_notification_delivery_event(v_n, 'delivered', 'expo', 'ticket-done', '{}'::jsonb);
  insert into results values ('real', 'delivered stamps delivered_at', 'true', (select (delivered_at is not null)::text from public.notifications where id = v_n));
  perform public.record_notification_delivery_event(v_n, 'opened', 'system');
  insert into results values ('real', 'opened stamps opened_at', 'true', (select (opened_at is not null)::text from public.notifications where id = v_n));

  -- both tickets are fresh: nothing is due yet; age one of them
  insert into results values ('real', 'a fresh ticket is not claimed', '0', (select count(*)::text from public.claim_expo_receipt_checks(10, 15)));
  alter table public.notification_delivery_events disable trigger notification_delivery_events_no_change;
  update public.notification_delivery_events set occurred_at = now() - interval '20 minutes' where event = 'receipt_pending';
  alter table public.notification_delivery_events enable trigger notification_delivery_events_no_change;
  insert into results values ('real', 'an old unresolved ticket is claimed, a resolved one is not', 'ticket-old',
    (select string_agg(provider_ref, ',') from public.claim_expo_receipt_checks(10, 15)));

  perform public.record_notification_delivery_event(v_n, 'token_dead', 'expo', 'ticket-old', jsonb_build_object('subscription_id', v_sub));
  insert into results values ('real', 'a dead token disables the subscription', 'true', (select (disabled_at is not null)::text from public.push_subscriptions where id = v_sub));
  insert into results values ('real', 'and the ticket is not claimed again', '0', (select count(*)::text from public.claim_expo_receipt_checks(10, 15)));

  perform public.record_notification_delivery_event(v_n, 'bounced', 'resend', 'msg-1', jsonb_build_object('email', 'S13-Bounce@Example.invalid'));
  insert into results values ('real', 'a bounce suppresses the address (lower case)', 's13-bounce@example.invalid', (select email from public.notification_email_suppressions where email like 's13-bounce%'));
  insert into results values ('real', 'events are append only (update)', '42501', pg_temp.try($q$update public.notification_delivery_events set event = 'failed'$q$));
  insert into results values ('real', 'events are append only (delete)', '42501', pg_temp.try($q$delete from public.notification_delivery_events$q$));
  insert into results values ('real', 'an unknown notification id is refused', '22023', pg_temp.try($q$select public.record_notification_delivery_event(gen_random_uuid(), 'delivered')$q$));
  insert into results values ('real', 'an unknown event name is refused', '23514', pg_temp.try(format($q$select public.record_notification_delivery_event(%L, 'invented')$q$, v_n)));

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into results values ('real', 'admin reads delivery events', 'true', ((select count(*) from public.notification_delivery_events) > 0)::text);
  insert into results values ('real', 'admin reads the term list', 'true', ((select count(*) from public.notification_forbidden_terms) > 90)::text);
  reset role;

  -- 7. SABOTAGE: drop the trigger, the clinical row must be accepted ---------------------------------
  drop trigger notification_template_locales_neutral on public.notification_template_locales;
  insert into results values ('sabotaged', 'with the trigger dropped a clinical row is refused', '23514',
    pg_temp.try($q$insert into public.notification_template_locales (template_key, locale, channel, body, subject) values ('s13_probe', 'en', 'push', 'Your diabetes check is due', null)$q$));
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S13 proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ')
         from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught = 0 then
    raise exception 'VACUOUS TEST: dropping the locale trigger did not change the clinical-row check';
  end if;
end $$;

select phase, check_name, expected, actual,
       case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;

rollback;
