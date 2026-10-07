-- S42 proof: account deletion anonymiser (migration *_s42_privacy_centre_export_and_anonymiser.sql). One rolled-back transaction. Proves:
--   1. Only an admin may complete a deletion, only for an approved request, and only once.
--   2. After completion: identity gone (name, phone, contact, region, avatar), login closed (auth email replaced, phone null, banned), non-retained personal rows
--      removed (push subscriptions, notification preferences, onboarding answers, access grants, circle links), wearable tokens nulled.
--   3. The retained record stays: vitals rows still there under the same patient id; consent history kept (and optional cells now off).
--   4. The request records what was done and what was kept; one account.deleted event; the audit log has the action.
--   5. SABOTAGE A: table_is_retained says yes to everything, so the push subscription is NOT removed (check flips).
--      SABOTAGE B: the admin check removed, a patient can then complete a deletion (check flips).
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
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, phone, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's42-' || p_label || '-' || v || '@example.invalid', '+23481' || lpad((random() * 99999999)::int::text, 8, '0'), 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, state, is_test)
  values (v, p_org, p_role::public.user_role, 'S42 ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), date '1980-06-15', 'Lagos', true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, full_name = excluded.full_name, phone = excluded.phone,
    date_of_birth = excluded.date_of_birth, state = excluded.state;
  return v;
end $f$;

do $$
declare
  v_org uuid; v_a uuid; v_g uuid; v_adm uuid; v_req uuid; v_s jsonb; v_hist integer;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_a := pg_temp.mkuser(v_org, 'patA', 'patient'); v_g := pg_temp.mkuser(v_org, 'guard', 'patient'); v_adm := pg_temp.mkuser(v_org, 'adm', 'admin');
  insert into fx values ('a', v_a), ('g', v_g), ('adm', v_adm);

  insert into public.push_subscriptions (organisation_id, profile_id, platform, expo_push_token) values (v_org, v_a, 'android', 'ExponentPushToken[s42proof]');
  insert into public.patient_notification_preferences (organisation_id, patient_id, category) values (v_org, v_a, 'billing');
  insert into public.onboarding_answers (organisation_id, patient_id, question_code, answer, recorded_by) values (v_org, v_a, 'goals', '["stay_ahead"]', v_a);
  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by) values (v_a, v_g, 'view', v_a);
  insert into public.care_circle_members (organisation_id, patient_id, supporter_id, relationship, permissions, expires_at, is_test)
    values (v_org, v_a, v_g, 'sister', array['appointments'], now() + interval '30 days', true);
  insert into public.wearable_connections (organisation_id, patient_id, provider, access_token, refresh_token) values (v_org, v_a, 'fitbit', 'tok', 'ref');
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, weight_kg) values (v_org, v_a, 'weight', 70);
  perform pg_temp.act(v_a);
  perform public.set_consent_cell('vitals', 'research', true);
  perform pg_temp.back();
  select count(*) into v_hist from public.consent_matrix_events where patient_id = v_a;

  perform pg_temp.try_as(v_a, format($q$insert into public.data_deletion_requests (organisation_id, patient_id, reason) values (%L, %L, 'proof')$q$, v_org, v_a));
  select id into v_req from public.data_deletion_requests where patient_id = v_a;
  insert into fx values ('req', v_req);

  -- 1. who and when
  perform pg_temp.ck('patient cannot complete a deletion', '42501', pg_temp.try_as(v_a, format('select public.complete_account_deletion(%L)', v_req)));
  perform pg_temp.ck('admin cannot complete a pending request', '23514', pg_temp.try_as(v_adm, format('select public.complete_account_deletion(%L)', v_req)));
  perform pg_temp.ck('admin approves the request', 'ok', pg_temp.try_as(v_adm, format($q$update public.data_deletion_requests set status = 'approved_full' where id = %L$q$, v_req)));
  perform pg_temp.ck('control: nothing is touched before completion', 'true', (select (full_name = 'S42 patA')::text from public.profiles where id = v_a));
  perform pg_temp.ck('admin completes an approved request', 'ok', pg_temp.try_as(v_adm, format('select public.complete_account_deletion(%L)', v_req)));
  perform pg_temp.ck('cannot be completed twice', '23514', pg_temp.try_as(v_adm, format('select public.complete_account_deletion(%L)', v_req)));

  -- 2. identity and personal rows
  perform pg_temp.ck('name replaced', 'Deleted account', (select full_name from public.profiles where id = v_a));
  perform pg_temp.ck('phone, region and avatar cleared', 'true', (select (phone is null and state is null and avatar_url is null and not is_active)::text from public.profiles where id = v_a));
  perform pg_temp.ck('date of birth reduced to the year', '1980-01-01', (select date_of_birth::text from public.profiles where id = v_a));
  perform pg_temp.ck('login closed: email replaced', 'true', (select (email like 'deleted-%@deleted.invalid' and phone is null and banned_until > now() + interval '100 years')::text from auth.users where id = v_a));
  perform pg_temp.ck('push subscription removed', '0', (select count(*)::text from public.push_subscriptions where profile_id = v_a));
  perform pg_temp.ck('notification preferences removed', '0', (select count(*)::text from public.patient_notification_preferences where patient_id = v_a));
  perform pg_temp.ck('onboarding answers removed', '0', (select count(*)::text from public.onboarding_answers where patient_id = v_a));
  perform pg_temp.ck('access grants removed both ways', '0', (select count(*)::text from public.profile_access where profile_id = v_a or grantee_user_id = v_a));
  perform pg_temp.ck('circle links removed', '0', (select count(*)::text from public.care_circle_members where patient_id = v_a));
  perform pg_temp.ck('wearable tokens nulled', 'true', (select (access_token is null and refresh_token is null and status = 'disconnected')::text from public.wearable_connections where patient_id = v_a));

  -- 3. the retained record
  perform pg_temp.ck('vitals still there (retention category)', '1', (select count(*)::text from public.vitals_readings where patient_id = v_a));
  perform pg_temp.ck('consent history kept and extended', 'true', (select (count(*) >= v_hist)::text from public.consent_matrix_events where patient_id = v_a));
  perform pg_temp.ck('optional cell is now off', 'false', private.consent_in_force(v_a, 'vitals', 'research')::text);

  -- 4. the record of it
  select anonymisation_summary into v_s from public.data_deletion_requests where id = v_req;
  perform pg_temp.ck('request completed with a summary', 'completed|true', (select status || '|' || (anonymisation_summary ? 'retained_categories')::text from public.data_deletion_requests where id = v_req));
  perform pg_temp.ck('summary names clinical records as kept', 'true', (v_s -> 'retained_categories' ? 'clinical_records')::text);
  perform pg_temp.ck('one account.deleted event', '1', (select count(*)::text from public.domain_events where event_type = 'account.deleted' and aggregate_id = v_req));
  perform pg_temp.ck('event carries no identity', 'false', (select (payload::text ilike '%S42%')::text from public.domain_events where event_type = 'account.deleted' and aggregate_id = v_req));
  perform pg_temp.ck('audit row written', '1', (select count(*)::text from public.audit_log where action = 'account.anonymised' and entity_id = v_req));
  begin
    perform private.anonymise_patient_account(v_a);
    insert into results values ('real', 'the same account cannot be anonymised twice', '23505', 'accepted');
  exception when others then
    insert into results values ('real', 'the same account cannot be anonymised twice', '23505', sqlstate);
  end;
end $$;

-- SABOTAGE A: everything counts as retained, so a push subscription survives.
create function pg_temp.fresh_patient_with_push() returns uuid language plpgsql as $f$
declare v_org uuid; v uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v := pg_temp.mkuser(v_org, 'sabA', 'patient');
  insert into public.push_subscriptions (organisation_id, profile_id, platform, expo_push_token) values (v_org, v, 'android', 'ExponentPushToken[s42sab]');
  return v;
end $f$;
create or replace function private.table_is_retained(p_table text) returns boolean language sql stable set search_path = '' as $$ select true $$;
do $$
declare v uuid := pg_temp.fresh_patient_with_push();
begin
  perform private.anonymise_patient_account(v);
  insert into results values ('sabotaged', 'push subscription removed', '0', (select count(*)::text from public.push_subscriptions where profile_id = v));
end $$;

-- SABOTAGE B: no admin check. A patient can then complete a deletion.
create or replace function public.complete_account_deletion(p_request uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare d public.data_deletion_requests%rowtype;
begin
  select * into d from public.data_deletion_requests where id = p_request;
  return private.anonymise_patient_account(d.patient_id);
end $$;
do $$
declare v_org uuid; v uuid; v_req uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v := pg_temp.mkuser(v_org, 'sabB', 'patient');
  perform pg_temp.try_as(v, format($q$insert into public.data_deletion_requests (organisation_id, patient_id) values (%L, %L)$q$, v_org, v));
  select id into v_req from public.data_deletion_requests where patient_id = v;
  insert into results values ('sabotaged', 'patient cannot complete a deletion', '42501', pg_temp.try_as(v, format('select public.complete_account_deletion(%L)', v_req)));
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S42 anonymiser proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ')
         from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 2 then raise exception 'VACUOUS TEST: the sabotage flipped % of 2 checks', v_caught; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;

rollback;
