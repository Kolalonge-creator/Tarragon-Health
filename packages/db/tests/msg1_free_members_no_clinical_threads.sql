-- ===========================================================================
-- Proof: MSG-1, a Free member cannot open a clinical care-team conversation; the safety path stays open.
--   1. A Free patient asking start_care_thread for 'clinical' or 'medication' is refused (42501, hint membership_required).
--   2. A Free patient may still open 'general' and 'laboratory' (support) conversations.
--   3. Safety: a Free patient's clinical request whose message matches the danger-phrase screen is NOT refused. It is saved as a
--      'general' thread and the message is flagged with an emergency clinician alert, exactly as for a Member.
--   4. The table holds the rule on its own: a Free patient's direct insert of a clinical thread, and a change of their own general
--      thread to 'medication', are both refused.
--   5. A Member opens a clinical thread; a clinician opens a clinical thread for a Free patient (staff are never refused).
--   6. A supporter acting for a Free patient is refused a clinical thread, and allowed one for a Member.
--   7. SABOTAGE: with the table trigger dropped, the Free patient's direct clinical insert succeeds, so case 4 discriminates.
-- BEGIN/ROLLBACK; mints its own fixtures.
-- ===========================================================================
begin;
create temp table msg1_results (check_name text, observed text, expected text, verdict text);
grant all on msg1_results to public;

create function pg_temp.mkuser(p_role text, p_name text) returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid(); v_org uuid := (select id from public.organisations order by created_at limit 1);
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'msg1-' || replace(v::text, '-', '') || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, v_org, p_role::public.user_role, p_name, '+23480' || lpad((floor(random() * 99999999))::integer::text, 8, '0'), date '1970-01-01', true)
  on conflict (id) do update set role = excluded.role, full_name = excluded.full_name, is_test = true, organisation_id = excluded.organisation_id;
  return v;
end $$;
create function pg_temp.as_user(p_uid uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true); end $$;
-- Runs p_sql as p_uid under the authenticated role; returns 'ok', or the SQLSTATE plus the hint when one was raised.
create function pg_temp.try_as(p_uid uuid, p_sql text) returns text language plpgsql as $$
declare v_state text; v_hint text;
begin
  perform pg_temp.as_user(p_uid); execute 'set local role authenticated';
  begin execute p_sql; execute 'reset role'; return 'ok';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_hint = pg_exception_hint;
    execute 'reset role';
    return v_state || coalesce(':' || nullif(v_hint, ''), '');
  end;
end $$;
create function pg_temp.ck(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into msg1_results values (p_name, p_actual, p_expected, case when p_actual is not distinct from p_expected then 'PASS' else 'FAIL' end) $$;

do $$
declare
  v_org uuid := (select id from public.organisations order by created_at limit 1);
  admin uuid; free_pat uuid; member uuid; clin uuid; helper uuid; v_thread uuid; v_n integer;
begin
  admin := pg_temp.mkuser('admin', 'MSG1 Admin');
  free_pat := pg_temp.mkuser('patient', 'MSG1 Free Patient');
  member := pg_temp.mkuser('patient', 'MSG1 Member');
  clin := pg_temp.mkuser('clinician', 'MSG1 Clinician');
  helper := pg_temp.mkuser('patient', 'MSG1 Supporter');
  insert into public.patient_memberships (organisation_id, patient_id, source, state, granted_by, grant_reason, is_test)
  values (v_org, member, 'granted', 'active', admin, 'MSG1 proof: a Member', true);
  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by, clinical_access)
  values (free_pat, helper, 'manage', free_pat, false), (member, helper, 'manage', member, false);
  -- The supporter needs the 'messaging' category to act for the patient at all; MSG-1 is checked after that.
  -- Only the patient may grant a category, so each grant is made in that patient's session.
  -- clinical_access is forced false on insert and only the patient may switch it on (enforce_clinical_access_consent_owner).
  perform pg_temp.as_user(free_pat);
  update public.profile_access set clinical_access = true where grantee_user_id = helper and profile_id = free_pat;
  insert into public.profile_access_categories (profile_access_id, category)
  select id, 'messaging' from public.profile_access where grantee_user_id = helper and profile_id = free_pat
  on conflict do nothing;
  perform pg_temp.as_user(member);
  update public.profile_access set clinical_access = true where grantee_user_id = helper and profile_id = member;
  insert into public.profile_access_categories (profile_access_id, category)
  select id, 'messaging' from public.profile_access where grantee_user_id = helper and profile_id = member
  on conflict do nothing;

  if private.patient_is_member(free_pat) or not private.patient_is_member(member) then
    raise exception 'fixture FAIL: membership fixture did not take';
  end if;

  -- 1. Free patient, clinical categories refused.
  perform pg_temp.ck('1a free clinical refused', '42501:membership_required',
    pg_temp.try_as(free_pat, $q$select public.start_care_thread('My BP', 'Is 150 over 95 high?', null, null, null, 'clinical')$q$));
  perform pg_temp.ck('1b free medication refused', '42501:membership_required',
    pg_temp.try_as(free_pat, $q$select public.start_care_thread('My tablets', 'Can I take amlodipine at night?', null, null, null, 'medication')$q$));

  -- 2. Support categories open.
  perform pg_temp.ck('2a free general allowed', 'ok',
    pg_temp.try_as(free_pat, $q$select public.start_care_thread('Login help', 'I cannot see my results page', null, null, null, 'general')$q$));
  perform pg_temp.ck('2b free laboratory allowed', 'ok',
    pg_temp.try_as(free_pat, $q$select public.start_care_thread('Lab near me', 'Which lab in Ikeja can do HbA1c?', null, null, null, 'laboratory')$q$));

  -- 3. Safety path: a danger phrase in a refused category is kept, as general, and flagged.
  perform pg_temp.ck('3a free clinical with danger phrase not refused', 'ok',
    pg_temp.try_as(free_pat, $q$select public.start_care_thread('Help', 'I have chest pain right now', null, null, null, 'clinical')$q$));
  select t.id into v_thread from public.care_message_threads t where t.patient_id = free_pat and t.subject = 'Help';
  perform pg_temp.ck('3b kept as general', 'general', (select category::text from public.care_message_threads where id = v_thread));
  perform pg_temp.ck('3c message flagged', 'true',
    (select bool_or(flagged_potential_emergency)::text from public.care_messages where thread_id = v_thread));
  perform pg_temp.ck('3d emergency alert raised', 'emergency',
    (select ca.level::text from public.care_messages cm join public.clinician_alerts ca on ca.id = cm.flagged_alert_id
      where cm.thread_id = v_thread limit 1));

  -- 4. The table rule holds without the RPC.
  perform pg_temp.ck('4a free direct clinical insert refused', '42501:membership_required',
    pg_temp.try_as(free_pat, format(
      $q$insert into public.care_message_threads (organisation_id, patient_id, subject, created_by, category) values (%L, %L, 'Direct', %L, 'clinical')$q$,
      v_org, free_pat, free_pat)));
  select t.id into v_thread from public.care_message_threads t where t.patient_id = free_pat and t.subject = 'Login help';
  perform pg_temp.ck('4b free recategorise to medication refused', '42501:membership_required',
    pg_temp.try_as(free_pat, format($q$update public.care_message_threads set category = 'medication' where id = %L$q$, v_thread)));
  perform pg_temp.ck('4c category unchanged', 'general', (select category::text from public.care_message_threads where id = v_thread));

  -- 5. Members and staff.
  perform pg_temp.ck('5a member clinical allowed', 'ok',
    pg_temp.try_as(member, $q$select public.start_care_thread('My BP', 'Is 150 over 95 high?', null, null, null, 'clinical')$q$));
  perform pg_temp.ck('5b member thread is clinical', 'clinical',
    (select category::text from public.care_message_threads where patient_id = member and subject = 'My BP'));
  perform pg_temp.ck('5c clinician clinical thread for free patient allowed', 'ok',
    pg_temp.try_as(clin, format($q$select public.start_care_thread('Your result', 'Please call us about your result', %L, null, null, 'clinical')$q$, free_pat)));

  -- 6. A supporter follows the patient's Membership, not their own.
  perform pg_temp.ck('6a supporter for free patient refused', '42501:membership_required',
    pg_temp.try_as(helper, format($q$select public.start_care_thread('Mum BP', 'Her BP is 150 over 95', %L, null, null, 'clinical')$q$, free_pat)));
  perform pg_temp.ck('6b supporter for member allowed', 'ok',
    pg_temp.try_as(helper, format($q$select public.start_care_thread('Dad BP', 'His BP is 150 over 95', %L, null, null, 'clinical')$q$, member)));

  -- 7. Sabotage: without the table trigger, the direct insert gets through.
  drop trigger care_message_threads_member_clinical_gate on public.care_message_threads;
  perform pg_temp.ck('7 SABOTAGE trigger dropped: direct clinical insert succeeds', 'ok',
    pg_temp.try_as(free_pat, format(
      $q$insert into public.care_message_threads (organisation_id, patient_id, subject, created_by, category) values (%L, %L, 'Direct2', %L, 'clinical')$q$,
      v_org, free_pat, free_pat)));
end $$;

select * from msg1_results order by check_name;

do $$
declare v_fail text;
begin
  select string_agg(check_name || ' (expected ' || coalesce(expected, 'null') || ', got ' || coalesce(observed, 'null') || ')', '; ')
    into v_fail from msg1_results where verdict <> 'PASS';
  if v_fail is not null then raise exception 'MSG-1 proof FAILED: %', v_fail; end if;
end $$;

rollback;
