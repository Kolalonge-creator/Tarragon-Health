-- S69b proof: Care Circle presets, the quiet "waiting" state, shared jobs, the weekly digest and the gentle nudge
-- (migration *_s69b_care_circle_presets_digest_tasks_nudge.sql). One rolled-back transaction.
-- Proves: both presets are accepted as ordinary permission sets; a quietly declined invite is dead for the invitee but still reads as
-- "waiting" for the sender, with nobody notified; shared jobs (module gate, who may post / claim / complete, first claim wins, strangers
-- and viewers refused, pause hides them, a removed helper's job goes back to open, supporter reads are logged); the digest (module
-- gate, only blocks for permissions held, counts not values, logged); the nudge (module gate, opt-in per supporter, needs the medicines
-- permission, grace and window honoured, once per slot, an answered slot is silent, paused is silent, the patient-first window holds it,
-- the notice carries no payload) and that a RED EVENT still reaches supporters at once with nothing from the nudge involved.
-- SABOTAGE (each must flip a check): the opt-in test removed from the sweep; the permission test removed from the digest; the viewer made
-- a helper in the task gate.

begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;
create temp table fxt(k text primary key, v text) on commit drop;
grant all on fxt to public;

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
create function pg_temp.q_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlerrm; end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.try_anon(p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  perform set_config('request.jwt.claim.role', 'anon', true);
  set local role anon;
  begin execute p_sql; r := 'ok'; exception when others then r := sqlstate; end;
  reset role;
  perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.role', '', true);
  return r;
end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text, p_support boolean default false) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's69b-' || p_label || '-' || substr(v::text, 1, 8) || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'S69b ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone, full_name = excluded.full_name;
  update public.profiles set organisation_id = p_org where id = v;
  if p_support then update public.profiles set receives_care = false where id = v; end if;
  return v;
end $f$;
create function pg_temp.email_of(p_uid uuid) returns text language sql as $$ select email from auth.users where id = p_uid $$;
create function pg_temp.invite(p_pat uuid, p_contact text, p_perms text[], p_label text) returns text language plpgsql as
$f$ declare r text; j jsonb;
begin
  r := pg_temp.q_as(p_pat, format($q$select public.create_care_circle_invite('email', %L, 'Daughter', %L::text[])::text$q$, p_contact, p_perms::text));
  if r like 'ERR:%' then return r; end if;
  j := r::jsonb;
  insert into fxt values ('tok-' || p_label, j ->> 'token') on conflict (k) do update set v = excluded.v;
  insert into fx values ('inv-' || p_label, (j ->> 'invite_id')::uuid) on conflict (k) do update set v = excluded.v;
  return 'ok';
end $f$;
create function pg_temp.tok(p_label text) returns text language sql as $$ select v from fxt where k = 'tok-' || p_label $$;
create function pg_temp.join_with(p_pat uuid, p_sup uuid, p_perms text[], p_label text) returns text language plpgsql as
$f$ declare r text;
begin
  r := pg_temp.invite(p_pat, pg_temp.email_of(p_sup), p_perms, p_label);
  if r <> 'ok' then return r; end if;
  return pg_temp.q_as(p_sup, format($q$select public.accept_care_circle_invite(%L)::text$q$, pg_temp.tok(p_label)));
end $f$;
create function pg_temp.member(p_pat uuid, p_sup uuid) returns uuid language sql as
$$ select id from public.care_circle_members where patient_id = p_pat and supporter_id = p_sup order by (state = 'active') desc, created_at desc limit 1 $$;
create function pg_temp.cnt(p_uid uuid, p_template text, p_source uuid default null, p_channel text default null) returns text language sql as
$$ select count(*)::text from public.notifications where recipient_id = p_uid and template = p_template
     and (p_source is null or source_id = p_source) and (p_channel is null or channel::text = p_channel) $$;
create function pg_temp.module(p_key text, p_on boolean, p_admin uuid) returns void language sql as
$$ update public.platform_modules set is_enabled = p_on, enabled_at = case when p_on then now() end, enabled_by = case when p_on then p_admin end,
          activation_note = case when p_on then 'S69b proof run' end where key = p_key $$;
create function pg_temp.newte(p_patient uuid) returns uuid language plpgsql as
$f$ declare v_id uuid; v_rs record;
begin
  select id, code, version into v_rs from public.triage_rule_sets order by version desc limit 1;
  insert into public.triage_events (organisation_id, patient_id, trigger_type, trigger_id, grade, rule_id, rule_set_id, rule_set_code, rule_set_version, rule_set_status, actions, shadow, is_test, basis)
  select organisation_id, p_patient, 'observation', gen_random_uuid(), 'red', 'R1', v_rs.id, v_rs.code, v_rs.version, 'draft',
         '[{"kind":"page_on_call"}]'::jsonb, true, true, gen_random_uuid()::text from public.profiles where id = p_patient
  returning id into v_id;
  return v_id;
end $f$;
create function pg_temp.newpage(p_patient uuid, p_te uuid) returns uuid language plpgsql as
$f$ declare v_id uuid;
begin
  perform set_config('tarragon.paging_write', 'on', true);
  insert into public.pages (organisation_id, patient_id, triage_event_id, parent_page_id, role, escalation_level, config_version, is_test, no_cover)
  select organisation_id, p_patient, p_te, null, 'escalation', 2, 1, true, true from public.profiles where id = p_patient
  returning id into v_id;
  perform set_config('tarragon.paging_write', 'off', true);
  return v_id;
end $f$;

do $$
declare
  v_org uuid; v_admin uuid; v_pat uuid; v_see uuid; v_help uuid; v_help2 uuid; v_nope uuid; v_stranger uuid; v_late uuid;
  v_inv_see uuid; v_inv_help uuid; r text; v_mem uuid; v_task uuid; v_task2 uuid; v_med uuid; v_med2 uuid; n integer; v_day date; v_pg uuid; d text;
  v_lagos date := (now() at time zone 'Africa/Lagos')::date;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  v_pat := pg_temp.mkuser(v_org, 'patient', 'patient');
  v_see := pg_temp.mkuser(v_org, 'see', 'patient', true);       -- "Can see" preset
  v_help := pg_temp.mkuser(v_org, 'help', 'patient', true);     -- "Can see and help" preset
  v_help2 := pg_temp.mkuser(v_org, 'help2', 'patient', true);   -- "Can see and help", second
  v_nope := pg_temp.mkuser(v_org, 'nope', 'patient', true);     -- will quietly say "not now"
  v_stranger := pg_temp.mkuser(v_org, 'stranger', 'patient', true);
  v_late := pg_temp.mkuser(v_org, 'late', 'patient', true);     -- appointments only (no medicines permission)

  -- 1. the presets are ordinary permission sets the existing database accepts ------------------------------------------------
  perform pg_temp.ck('Can see joins', 'true', (pg_temp.join_with(v_pat, v_see, array['adherence_summary', 'weekly_bp_trend', 'appointments', 'red_alerts'], 'see') like '%"ok": true%')::text);
  perform pg_temp.ck('Can see and help joins', 'true', (pg_temp.join_with(v_pat, v_help, array['adherence_summary', 'weekly_bp_trend', 'appointments', 'red_alerts', 'pay_for_care'], 'help') like '%"ok": true%')::text);
  perform pg_temp.ck('second helper joins', 'true', (pg_temp.join_with(v_pat, v_help2, array['adherence_summary', 'weekly_bp_trend', 'appointments', 'red_alerts', 'pay_for_care'], 'help2') like '%"ok": true%')::text);
  perform pg_temp.ck('appointments-only member joins', 'true', (pg_temp.join_with(v_pat, v_late, array['appointments'], 'late') like '%"ok": true%')::text);

  -- 2. the quiet "waiting" state ----------------------------------------------------------------------------------------------
  perform pg_temp.ck('invite made for the one who will say not now', 'ok', pg_temp.invite(v_pat, pg_temp.email_of(v_nope), array['adherence_summary'], 'nope'));
  perform pg_temp.ck('a stranger cannot say not now for someone else (silent failure)', '{"ok": false}',
    pg_temp.q_as(v_stranger, format($q$select public.decline_care_circle_invite(%L)::text$q$, pg_temp.tok('nope'))));
  perform pg_temp.ck('and the invite is still a normal pending one', 'pending', (select state from public.care_circle_invites where token_hash = private.circle_hash(pg_temp.tok('nope'))));
  perform pg_temp.ck('the invitee says not now', '{"ok": true}', pg_temp.q_as(v_nope, format($q$select public.decline_care_circle_invite(%L)::text$q$, pg_temp.tok('nope'))));
  perform pg_temp.ck('the link is dead for the invitee: preview', '{"ok": false}', pg_temp.q_as(v_nope, format($q$select public.preview_care_circle_invite(%L)::text$q$, pg_temp.tok('nope'))));
  perform pg_temp.ck('the link is dead for the invitee: accept', '{"ok": false}', pg_temp.q_as(v_nope, format($q$select public.accept_care_circle_invite(%L)::text$q$, pg_temp.tok('nope'))));
  perform pg_temp.ck('nobody is told anything', '0', (select count(*)::text from public.notifications where created_at >= now() - interval '1 minute' and recipient_id in (v_pat, v_nope) and template like 'circle\_%' and template not in ('circle_joined')));
  perform pg_temp.ck('the sender still sees it, as waiting', '1',
    pg_temp.q_as(v_pat, $q$select count(*)::text from jsonb_array_elements(public.my_care_circle() -> 'invites') i where i ->> 'state' = 'waiting' and i ->> 'hint' is not null$q$));
  perform pg_temp.ck('and nothing in what the sender reads says declined or cancelled', 'false',
    pg_temp.q_as(v_pat, $q$select (public.my_care_circle()::text ~* 'declin|cancel|reject')::text$q$));
  perform pg_temp.ck('the sender can still cancel it', 'true', pg_temp.q_as(v_pat, format($q$select public.cancel_care_circle_invite(%L)::text$q$, (select id from public.care_circle_invites where token_hash = private.circle_hash(pg_temp.tok('nope'))))));
  perform pg_temp.ck('and then it is gone from the list', '0', pg_temp.q_as(v_pat, $q$select count(*)::text from jsonb_array_elements(public.my_care_circle() -> 'invites') i$q$));
  -- it also stops showing when it runs out on its own
  perform pg_temp.invite(v_pat, pg_temp.email_of(v_nope), array['adherence_summary'], 'nope2');
  perform pg_temp.q_as(v_nope, format($q$select public.decline_care_circle_invite(%L)::text$q$, pg_temp.tok('nope2')));
  update public.care_circle_invites set expires_at = now() - interval '1 minute' where token_hash = private.circle_hash(pg_temp.tok('nope2'));
  perform pg_temp.ck('a quietly declined invite leaves the list when it expires', '0', pg_temp.q_as(v_pat, $q$select count(*)::text from jsonb_array_elements(public.my_care_circle() -> 'invites') i$q$));

  -- 3. modules ship OFF, and every tool refuses while off ----------------------------------------------------------------------
  perform pg_temp.ck('digest module ships OFF', 'false', (select is_enabled::text from public.platform_modules where key = 'care_circle_digest'));
  perform pg_temp.ck('tasks module ships OFF', 'false', (select is_enabled::text from public.platform_modules where key = 'care_circle_tasks'));
  perform pg_temp.ck('nudge module ships OFF', 'false', (select is_enabled::text from public.platform_modules where key = 'care_circle_missed_dose_alert'));
  perform pg_temp.ck('posting a job is refused while off', 'ERR:circle_tools_unavailable', pg_temp.q_as(v_pat, format($q$select public.post_circle_task(%L, 'errand')::text$q$, v_pat)));
  perform pg_temp.ck('the digest is refused while off', 'ERR:circle_tools_unavailable', pg_temp.q_as(v_see, format($q$select public.circle_weekly_digest(%L)::text$q$, v_pat)));
  perform pg_temp.ck('the nudge switch cannot be turned on while off', 'ERR:circle_tools_unavailable',
    pg_temp.q_as(v_pat, format($q$select public.set_circle_missed_dose_alert(%L, true)::text$q$, pg_temp.member(v_pat, v_help))));
  perform pg_temp.ck('the status says all three are off', 'false,false,false',
    pg_temp.q_as(v_pat, $q$select concat_ws(',', (public.circle_tools_status() ->> 'digest'), (public.circle_tools_status() ->> 'tasks'), (public.circle_tools_status() ->> 'missed_dose'))$q$));

  perform pg_temp.module('care_circle_tasks', true, v_admin);
  perform pg_temp.module('care_circle_digest', true, v_admin);
  perform pg_temp.module('care_circle_missed_dose_alert', true, v_admin);

  -- 4. shared jobs --------------------------------------------------------------------------------------------------------------
  perform pg_temp.ck('a bad kind is refused (no free text possible)', 'ERR:task_kind_invalid', pg_temp.q_as(v_pat, format($q$select public.post_circle_task(%L, 'my blood pressure is high')::text$q$, v_pat)));
  perform pg_temp.ck('a past date is refused', 'ERR:task_date_invalid', pg_temp.q_as(v_pat, format($q$select public.post_circle_task(%L, 'errand', (current_date - 3))::text$q$, v_pat)));
  perform pg_temp.ck('the patient posts a job', 'true', (pg_temp.q_as(v_pat, format($q$select public.post_circle_task(%L, 'take_to_lab', (current_date + 2))::text$q$, v_pat)) like '%"ok": true%')::text);
  select id into v_task from public.care_circle_tasks where patient_id = v_pat order by created_at desc limit 1;
  perform pg_temp.ck('helpers are told, neutrally, with no payload', '1', pg_temp.cnt(v_help, 'circle_task_update', v_task, 'in_app'));
  perform pg_temp.ck('the viewer is not told (cannot act)', '0', pg_temp.cnt(v_see, 'circle_task_update', v_task));
  perform pg_temp.ck('the notice carries no payload', 'true', (select bool_and(payload = '{}'::jsonb) from public.notifications where template = 'circle_task_update' and source_id = v_task)::text);
  perform pg_temp.ck('a viewer ("Can see") cannot claim', 'ERR:circle_not_found', pg_temp.q_as(v_see, format($q$select public.claim_circle_task(%L)::text$q$, v_task)));
  perform pg_temp.ck('a viewer cannot post', 'ERR:circle_task_needs_help_preset', pg_temp.q_as(v_see, format($q$select public.post_circle_task(%L, 'errand')::text$q$, v_pat)));
  perform pg_temp.ck('a viewer can read the list and is a viewer', 'viewer', pg_temp.q_as(v_see, format($q$select (public.circle_tasks(%L) ->> 'role')$q$, v_pat)));
  perform pg_temp.ck('a stranger gets the same not-found', 'ERR:circle_not_found', pg_temp.q_as(v_stranger, format($q$select public.circle_tasks(%L)::text$q$, v_pat)));
  perform pg_temp.ck('a stranger cannot claim', 'ERR:circle_not_found', pg_temp.q_as(v_stranger, format($q$select public.claim_circle_task(%L)::text$q$, v_task)));
  perform pg_temp.ck('a supporter reads no row of the table directly', '0', pg_temp.q_as(v_help, $q$select count(*)::text from public.care_circle_tasks$q$));
  perform pg_temp.ck('the patient reads their own rows', '1', pg_temp.q_as(v_pat, $q$select count(*)::text from public.care_circle_tasks$q$));
  perform pg_temp.ck('the helper claims', 'true', pg_temp.q_as(v_help, format($q$select public.claim_circle_task(%L)::text$q$, v_task)));
  perform pg_temp.ck('the second helper loses the race, quietly', 'false', pg_temp.q_as(v_help2, format($q$select public.claim_circle_task(%L)::text$q$, v_task)));
  perform pg_temp.ck('the patient is told someone took it', '1', pg_temp.cnt(v_pat, 'circle_task_update', v_task));
  perform pg_temp.ck('the second helper cannot complete it', 'false', pg_temp.q_as(v_help2, format($q$select public.complete_circle_task(%L)::text$q$, v_task)));
  perform pg_temp.ck('the second helper cannot remove it', 'false', pg_temp.q_as(v_help2, format($q$select public.cancel_circle_task(%L)::text$q$, v_task)));
  perform pg_temp.ck('the claimer lets it go', 'true', pg_temp.q_as(v_help, format($q$select public.release_circle_task(%L)::text$q$, v_task)));
  perform pg_temp.ck('and it is open again', 'open', (select state from public.care_circle_tasks where id = v_task));
  perform pg_temp.q_as(v_help2, format($q$select public.claim_circle_task(%L)::text$q$, v_task));
  perform pg_temp.ck('the claimer completes it', 'true', pg_temp.q_as(v_help2, format($q$select public.complete_circle_task(%L)::text$q$, v_task)));
  perform pg_temp.ck('done is done', 'done', (select state from public.care_circle_tasks where id = v_task));
  -- a supporter's reads of the list are in the patient's own "who looked" list
  perform pg_temp.ck('a supporter reading the jobs is logged for the patient', 'true',
    (exists (select 1 from public.care_access_events e where e.patient_id = v_pat and e.actor_profile_id = v_help and e.scope = 'care_circle' and e.metadata::text like '%tasks%'))::text);
  -- a helper who is removed loses the job
  perform pg_temp.q_as(v_pat, format($q$select public.post_circle_task(%L, 'visit')::text$q$, v_pat));
  select id into v_task2 from public.care_circle_tasks where patient_id = v_pat and state = 'open' order by created_at desc limit 1;
  perform pg_temp.q_as(v_help, format($q$select public.claim_circle_task(%L)::text$q$, v_task2));
  perform pg_temp.q_as(v_pat, format($q$select public.revoke_care_circle_member(%L)::text$q$, pg_temp.member(v_pat, v_help)));
  perform pg_temp.ck('a removed helper can no longer finish it', 'ERR:circle_not_found', pg_temp.q_as(v_help, format($q$select public.claim_circle_task(%L)::text$q$, v_task2)));
  perform private.sweep_circle_tasks();
  perform pg_temp.ck('and the sweep gives the job back', 'open', (select state from public.care_circle_tasks where id = v_task2));
  -- pause hides the jobs from supporters
  perform pg_temp.q_as(v_pat, $q$select public.pause_care_circle(false)::text$q$);
  perform pg_temp.ck('while paused a helper sees nothing', 'ERR:circle_not_found', pg_temp.q_as(v_help2, format($q$select public.circle_tasks(%L)::text$q$, v_pat)));
  perform pg_temp.ck('while paused the patient still sees their jobs', 'patient', pg_temp.q_as(v_pat, format($q$select (public.circle_tasks(%L) ->> 'role')$q$, v_pat)));
  perform pg_temp.q_as(v_pat, $q$select public.resume_care_circle()::text$q$);
  -- the limit
  update public.care_circle_config set rules = rules where is_active; -- no-op, keeps the config read
  for n in 1..12 loop
    r := pg_temp.q_as(v_pat, format($q$select public.post_circle_task(%L, 'errand')::text$q$, v_pat));
    exit when r like 'ERR:%';
  end loop;
  perform pg_temp.ck('the number of open jobs is limited', 'ERR:task_limit', r);

  -- 5. the weekly digest ---------------------------------------------------------------------------------------------------------
  insert into public.medications (organisation_id, patient_id, drug_name, dose, frequency, is_active, source, schedule_times)
  values (v_org, v_pat, 'S69b Test Drug', '5mg', 'once daily', true, 'clinician', '["10:00"]'::jsonb) returning id into v_med;
  insert into public.medication_logs (organisation_id, patient_id, medication_id, status, scheduled_for_date, scheduled_time)
  values (v_org, v_pat, v_med, 'taken', v_lagos - 1, '10:00'), (v_org, v_pat, v_med, 'taken', v_lagos - 2, '10:00'), (v_org, v_pat, v_med, 'missed', v_lagos - 3, '10:00');
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, taken_at, source)
  values (v_org, v_pat, 'blood_pressure', 133, 83, now() - interval '1 day', 'manual'), (v_org, v_pat, 'blood_pressure', 141, 91, now() - interval '2 days', 'manual');
  d := pg_temp.q_as(v_see, format($q$select public.circle_weekly_digest(%L)::text$q$, v_pat));
  perform pg_temp.ck('the digest counts days on which every dose was taken (2 of 3)', '2/3', (d::jsonb -> 'doses' ->> 'days_all_taken') || '/' || (d::jsonb -> 'doses' ->> 'days_with_doses'));
  perform pg_temp.ck('the digest counts reading days (2), not values', '2', (d::jsonb -> 'readings' ->> 'days_logged'));
  perform pg_temp.ck('the digest carries no value, week or direction', 'false', (d ~* 'systolic|diastolic|direction|weeks|mmhg')::text);
  perform pg_temp.ck('the digest names no medicine', 'false', (d ~* 'S69b Test Drug|5mg')::text);
  d := pg_temp.q_as(v_late, format($q$select public.circle_weekly_digest(%L)::text$q$, v_pat));
  perform pg_temp.ck('a member with only appointments gets no doses block', 'false', (d::jsonb ? 'doses')::text);
  perform pg_temp.ck('and no readings block', 'false', (d::jsonb ? 'readings')::text);
  perform pg_temp.ck('a stranger gets not-found', 'ERR:circle_not_found', pg_temp.q_as(v_stranger, format($q$select public.circle_weekly_digest(%L)::text$q$, v_pat)));
  perform pg_temp.ck('the digest read is logged for the patient', 'true',
    (exists (select 1 from public.care_access_events e where e.patient_id = v_pat and e.actor_profile_id = v_see and e.scope = 'care_circle' and e.metadata::text like '%digest%'))::text);
  perform pg_temp.q_as(v_pat, $q$select public.pause_care_circle(false)::text$q$);
  perform pg_temp.ck('a paused circle gives no digest', 'ERR:circle_not_found', pg_temp.q_as(v_see, format($q$select public.circle_weekly_digest(%L)::text$q$, v_pat)));
  perform pg_temp.q_as(v_pat, $q$select public.resume_care_circle()::text$q$);
  -- the weekly notice is generic, once per member per week
  perform private.send_circle_digests();
  perform private.send_circle_digests();
  perform pg_temp.ck('one weekly notice for a viewer, even run twice', '1', (select count(*)::text from public.notifications where recipient_id = v_see and template = 'circle_digest' and channel = 'in_app'));
  perform pg_temp.ck('the weekly notice carries no payload', 'true', (select bool_and(payload = '{}'::jsonb) from public.notifications where template = 'circle_digest')::text);
  perform pg_temp.ck('and nobody gets one if the patient is not the subject (the patient is never sent a supporter digest)', '0', pg_temp.cnt(v_pat, 'circle_digest'));

  -- 6. the gentle nudge ----------------------------------------------------------------------------------------------------------
  -- the med runs at 10:00; grace 30, window 60 (PROPOSED config)
  perform pg_temp.ck('turning the nudge on needs the medicines permission', 'ERR:circle_nudge_needs_adherence',
    pg_temp.q_as(v_pat, format($q$select public.set_circle_missed_dose_alert(%L, true)::text$q$, pg_temp.member(v_pat, v_late))));
  -- helper was revoked in section 4; use the viewer and helper2
  perform pg_temp.ck('the patient turns the nudge on for helper2', 'true', pg_temp.q_as(v_pat, format($q$select public.set_circle_missed_dose_alert(%L, true)::text$q$, pg_temp.member(v_pat, v_help2))));
  perform pg_temp.ck('the choice is written to the patient''s own list', 'true',
    (exists (select 1 from public.care_access_events e where e.patient_id = v_pat and e.actor_profile_id = v_help2 and e.metadata::text like '%missed_dose_alert%'))::text);
  perform pg_temp.ck('before the grace period: nothing', '0', private.sweep_circle_missed_doses((v_lagos + time '10:20'))::text);
  perform pg_temp.ck('after the grace period: one nudge', '1', private.sweep_circle_missed_doses((v_lagos + time '10:35'))::text);
  perform pg_temp.ck('the supporter who opted in is nudged, in the inbox', '1', pg_temp.cnt(v_help2, 'circle_gentle_nudge', null, 'in_app'));
  perform pg_temp.ck('the supporter who did not opt in is not nudged', '0', pg_temp.cnt(v_see, 'circle_gentle_nudge'));
  perform pg_temp.ck('the patient is not nudged', '0', pg_temp.cnt(v_pat, 'circle_gentle_nudge'));
  perform pg_temp.ck('the nudge is routine priority (quiet hours may hold the push) and carries no payload', 'routine/true',
    (select min(priority::text) || '/' || bool_and(payload = '{}'::jsonb)::text from public.notifications where template = 'circle_gentle_nudge'));
  perform pg_temp.ck('running it again inside the window sends nothing more', '0', private.sweep_circle_missed_doses((v_lagos + time '10:40'))::text);
  perform pg_temp.ck('the supporter sees a first name only', 'S69b',
    pg_temp.q_as(v_help2, $q$select split_part((public.circle_recent_nudges() -> 0 ->> 'name'), ' ', 1)$q$));
  perform pg_temp.ck('and nothing about doses in what the list returns', 'false',
    (pg_temp.q_as(v_help2, $q$select public.circle_recent_nudges()::text$q$) ~* 'dose|medic|drug|10:00|missed')::text);
  perform pg_temp.ck('reading the nudge list is logged for the patient', 'true',
    (exists (select 1 from public.care_access_events e where e.patient_id = v_pat and e.actor_profile_id = v_help2 and e.metadata::text like '%nudge%'))::text);
  -- an old slot is not nudged (stale), an answered slot is silent
  delete from public.care_circle_missed_dose_alerts;
  perform pg_temp.ck('long after the window: a stale nudge is not sent', '0', private.sweep_circle_missed_doses((v_lagos + time '12:30'))::text);
  insert into public.medication_logs (organisation_id, patient_id, medication_id, status, scheduled_for_date, scheduled_time)
  values (v_org, v_pat, v_med, 'taken', v_lagos, '10:00');
  perform pg_temp.ck('a slot the patient answered is silent', '0', private.sweep_circle_missed_doses((v_lagos + time '10:35'))::text);
  delete from public.medication_logs where medication_id = v_med and scheduled_for_date = v_lagos;
  -- paused is silent
  perform pg_temp.q_as(v_pat, $q$select public.pause_care_circle(false)::text$q$);
  perform pg_temp.ck('while the patient has paused sharing: silent', '0', private.sweep_circle_missed_doses((v_lagos + time '10:35'))::text);
  perform pg_temp.q_as(v_pat, $q$select public.resume_care_circle()::text$q$);
  -- the patient-first window holds the nudge back while that module is on
  perform pg_temp.module('care_circle_checkin_window', true, v_admin);
  perform pg_temp.ck('with the patient-first window on, the nudge waits the extra minutes', '0', private.sweep_circle_missed_doses((v_lagos + time '10:33'))::text);
  perform pg_temp.ck('and goes out once the window has passed (30 + 5 minutes)', '1', private.sweep_circle_missed_doses((v_lagos + time '10:37'))::text);
  perform pg_temp.module('care_circle_checkin_window', false, v_admin);
  -- removing the medicines permission clears the switch
  perform pg_temp.q_as(v_pat, format($q$select public.update_care_circle_member(%L, array['appointments'])::text$q$, pg_temp.member(v_pat, v_help2)));
  perform pg_temp.ck('removing the medicines permission clears the nudge switch', 'false', (select missed_dose_alert::text from public.care_circle_members where id = pg_temp.member(v_pat, v_help2)));
  -- module off: the sweep does nothing at all
  perform pg_temp.module('care_circle_missed_dose_alert', false, v_admin);
  perform pg_temp.ck('module off: the sweep sends nothing', '0', private.sweep_circle_missed_doses((v_lagos + time '10:35'))::text);
  perform pg_temp.module('care_circle_missed_dose_alert', true, v_admin);

  -- 7. a RED EVENT is untouched: supporters holding red_alerts are told at once; no nudge is involved -----------------------------
  perform pg_temp.ck('(setup) a red_alerts member exists', 'true', (pg_temp.member(v_pat, v_see) is not null)::text);
  v_pg := pg_temp.newpage(v_pat, pg_temp.newte(v_pat));
  perform pg_temp.ck('a red event reaches the supporter holding red_alerts at once', '1', pg_temp.cnt(v_see, 'circle_check_in', v_pg, 'in_app'));
  perform pg_temp.ck('and sends no nudge', '0', pg_temp.cnt(v_see, 'circle_gentle_nudge', v_pg));
  perform pg_temp.ck('the red-alert function does not mention the new tools', 'false',
    (pg_get_functiondef('private.notify_circle_red_alert()'::regprocedure) ~ 'missed_dose|care_circle_tasks|care_circle_digest|care_circle_tools')::text);

  -- 8. grants -----------------------------------------------------------------------------------------------------------------
  perform pg_temp.ck('anon cannot call the digest', '42501', pg_temp.try_anon(format($q$select public.circle_weekly_digest(%L)$q$, v_pat)));
  perform pg_temp.ck('anon cannot post a job', '42501', pg_temp.try_anon(format($q$select public.post_circle_task(%L, 'errand')$q$, v_pat)));
  perform pg_temp.ck('anon cannot say not now', '42501', pg_temp.try_anon($q$select public.decline_care_circle_invite('xxxxxxxxxxxxxxxxxxxxxxxxxxxx')$q$));
  perform pg_temp.ck('anon reads nothing from the tables', '42501', pg_temp.try_anon($q$select * from public.care_circle_tasks$q$));
  perform pg_temp.ck('a signed-in user cannot read the nudge ledger directly', 'ERR:permission denied for table care_circle_missed_dose_alerts',
    pg_temp.q_as(v_help2, $q$select count(*)::text from public.care_circle_missed_dose_alerts$q$));
  perform pg_temp.ck('a signed-in user cannot write a job directly', 'ERR:permission denied for table care_circle_tasks',
    pg_temp.q_as(v_help2, format($q$insert into public.care_circle_tasks (organisation_id, patient_id, created_by, kind) values (%L, %L, %L, 'errand')$q$, v_org, v_pat, v_help2)));

  -- SABOTAGE ------------------------------------------------------------------------------------------------------------------
  -- (a) the opt-in test removed from the nudge sweep: a supporter who never opted in is nudged
  perform pg_temp.module('care_circle_missed_dose_alert', true, v_admin);
  delete from public.care_circle_missed_dose_alerts;
  delete from public.notifications where template = 'circle_gentle_nudge';
  select pg_get_functiondef('private.sweep_circle_missed_doses(timestamp)'::regprocedure) into d;
  d := replace(d, 'and m.missed_dose_alert and', 'and true and');
  if d = pg_get_functiondef('private.sweep_circle_missed_doses(timestamp)'::regprocedure) then raise exception 'sabotage (a) did not change the function'; end if;
  execute d;
  perform private.sweep_circle_missed_doses((v_lagos + time '10:35'));
  insert into results values ('sabotaged', 'a supporter who never opted in is not nudged', '0', pg_temp.cnt(v_see, 'circle_gentle_nudge', null, 'in_app'));
  -- (b) the permission test removed from the digest: a member with only appointments is given the doses block
  select pg_get_functiondef('public.circle_weekly_digest(uuid)'::regprocedure) into d;
  d := replace(d, 'if ''adherence_summary'' = any (m.permissions) then', 'if true then');
  if d = pg_get_functiondef('public.circle_weekly_digest(uuid)'::regprocedure) then raise exception 'sabotage (b) did not change the function'; end if;
  execute d;
  insert into results values ('sabotaged', 'a member without the medicines permission gets no doses block', 'false',
    ((pg_temp.q_as(v_late, format($q$select public.circle_weekly_digest(%L)::text$q$, v_pat)))::jsonb ? 'doses')::text);
  -- (c) the viewer made a helper in the task gate: a "Can see" supporter can claim
  select pg_get_functiondef('private.circle_task_role(uuid)'::regprocedure) into d;
  d := replace(d, 'case when ''pay_for_care'' = any (m.permissions) then ''helper'' else ''viewer'' end', '''helper''');
  if d = pg_get_functiondef('private.circle_task_role(uuid)'::regprocedure) then raise exception 'sabotage (c) did not change the function'; end if;
  execute d;
  update public.care_circle_tasks set state = 'open', claimed_by = null where id = v_task2;
  insert into results values ('sabotaged', 'a Can-see supporter cannot claim a job', 'ERR:circle_not_found', pg_temp.q_as(v_see, format($q$select public.claim_circle_task(%L)::text$q$, v_task2)));
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S69b proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ')
         from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 3 then raise exception 'VACUOUS TEST: the sabotage flipped % of 3 checks', v_caught; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;

rollback;
