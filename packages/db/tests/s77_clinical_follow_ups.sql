-- S77 proof: clinical follow-ups with closure tracking (spec 23.8, CMO decision S-20).
--   1. Who may create: a clinician tied to the patient. Another clinician, a patient and anon cannot. A past due time is refused.
--   2. Nobody writes the table directly (insert, update, delete refused for the owner and for everyone else).
--   3. A follow-up closes ONLY with an outcome and a reason of 10+ characters. The rule is a CHECK, so even a flagged bare update cannot skip it.
--   4. Read matrix (INV-12): the owner and a clinician tied to the patient see it; another clinician, a patient, an admin and anon read nothing
--      from the table; the admin list function returns the rows and writes an audit row; a clinician cannot acknowledge or close what they cannot see.
--   5. The sweep always marks overdue; with NO active (signed) config it escalates nothing. Only the CMO can sign a config, and a bare update cannot.
--   6. With a signed config: a routine follow-up escalates after 24 hours (not before), an abnormal-result one after 4 hours (not before), once only;
--      the task is the S16 task type, a patient with no lead clinician goes to the open pool (never silent).
--   7. A follow-up created from an alert snooze task is linked and closes when that task is done.
--   SABOTAGE: (a) the closes-with-outcome CHECK dropped, (b) the sweep reading a hard-coded config instead of the active row, (c) the read
--   policy opened to everyone; each must flip a check.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;
create function pg_temp.f(p text) returns uuid language sql as $$ select v from fx where k = p $$;
create function pg_temp.setf(p text, p_v uuid) returns void language sql as
$$ insert into fx values (p, p_v) on conflict (k) do update set v = excluded.v $$;
create function pg_temp.act(p_uid uuid) returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
end $f$;
create function pg_temp.back() returns void language plpgsql as
$f$ begin reset role; perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.role', '', true); end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's77-' || p_label || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, is_test)
  values (v, p_org, p_role::public.user_role, 'S77 ' || p_label, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true;
  return v;
end $f$;
create function pg_temp.mkdoc(p_org uuid, p_label text, p_admin uuid, p_tier text) returns uuid
language plpgsql as $f$
declare v uuid;
begin
  v := pg_temp.mkuser(p_org, p_label, 'clinician');
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
  values (p_org, v, 'S77 ' || p_label, 'MDCN', 'S77-' || p_label || '-' || substr(v::text, 1, 8), true, 'active', now(), p_admin,
      p_tier::public.doctor_tier, 'contracted', 2, true, p_admin, true);
  return v;
end $f$;
-- run a statement as a user: 'ok' or 'ERR:sqlstate'
create function pg_temp.sql_as(p_uid uuid, p_sql text) returns text language plpgsql as $f$
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql; exception when others then perform pg_temp.back(); return 'ERR:' || sqlstate; end;
  perform pg_temp.back();
  return 'ok';
end $f$;
create function pg_temp.sql_anon(p_sql text) returns text language plpgsql as $f$
begin
  set local role anon;
  begin execute p_sql; exception when others then reset role; return 'ERR:' || sqlstate; end;
  reset role;
  return 'ok';
end $f$;
-- a count as a user, 'ERR:sqlstate' when refused
create function pg_temp.count_as(p_uid uuid, p_sql text) returns text language plpgsql as $f$
declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql into r; exception when others then perform pg_temp.back(); return 'ERR:' || sqlstate; end;
  perform pg_temp.back();
  return r;
end $f$;
-- the owner-level write a function would do (flag on), for ageing and for the CHECK proof
create function pg_temp.flagged(p_sql text) returns text language plpgsql as $f$
begin
  perform set_config('tarragon.follow_up_write', 'on', true);
  begin execute p_sql; exception when others then perform set_config('tarragon.follow_up_write', 'off', true); return 'ERR:' || sqlstate; end;
  perform set_config('tarragon.follow_up_write', 'off', true);
  return 'ok';
end $f$;

do $$
declare
  v_org uuid; v_admin uuid; v_doc uuid; v_doc2 uuid; v_doc3 uuid; v_cmo uuid; v_pat uuid; v_pat2 uuid; v_pat3 uuid;
  v_staff3 uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  v_doc := pg_temp.mkdoc(v_org, 'owner', v_admin, 'senior_medical_officer');
  v_doc2 := pg_temp.mkdoc(v_org, 'other', v_admin, 'senior_medical_officer');
  v_doc3 := pg_temp.mkdoc(v_org, 'tied', v_admin, 'senior_medical_officer');
  v_cmo := pg_temp.mkdoc(v_org, 'cmo', v_admin, 'chief_medical_officer');
  v_pat := pg_temp.mkuser(v_org, 'pat', 'patient');
  v_pat2 := pg_temp.mkuser(v_org, 'pat2', 'patient');
  v_pat3 := pg_temp.mkuser(v_org, 'pat3', 'patient');
  -- doc is tied to pat and pat2 as the care-team clinician (the lead); doc3 is tied to pat as the clinical director; pat3 has no lead at all
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id) values (v_org, v_pat, v_doc), (v_org, v_pat2, v_doc);
  update public.care_team_assignment set clinical_director_id = v_doc3 where patient_id = v_pat;
  -- doc owns pat3's follow-ups only through ownership (no tie)
  perform pg_temp.setf('org', v_org); perform pg_temp.setf('admin', v_admin); perform pg_temp.setf('doc', v_doc); perform pg_temp.setf('doc2', v_doc2);
  perform pg_temp.setf('doc3', v_doc3); perform pg_temp.setf('cmo', v_cmo); perform pg_temp.setf('pat', v_pat); perform pg_temp.setf('pat2', v_pat2); perform pg_temp.setf('pat3', v_pat3);
  select id into v_staff3 from public.clinical_staff where profile_id = v_doc;
  perform pg_temp.setf('staff_doc', v_staff3);
end $$;

-- 1. creating
insert into results values ('real', 'the tied clinician creates a follow-up', 'ok',
  pg_temp.sql_as(pg_temp.f('doc'), format($q$select public.create_clinical_follow_up(%L, 'lab_request', now() + interval '2 days')$q$, pg_temp.f('pat'))));
insert into results values ('real', 'a clinician with no tie cannot create one', 'ERR:42501',
  pg_temp.sql_as(pg_temp.f('doc2'), format($q$select public.create_clinical_follow_up(%L, 'order', now() + interval '2 days')$q$, pg_temp.f('pat'))));
insert into results values ('real', 'a patient cannot create one', 'ERR:42501',
  pg_temp.sql_as(pg_temp.f('pat'), format($q$select public.create_clinical_follow_up(%L, 'order', now() + interval '2 days')$q$, pg_temp.f('pat'))));
insert into results values ('real', 'anon cannot create one', 'ERR:42501',
  pg_temp.sql_anon(format($q$select public.create_clinical_follow_up(%L, 'order', now() + interval '2 days')$q$, pg_temp.f('pat'))));
insert into results values ('real', 'a due time in the past is refused', 'ERR:22023',
  pg_temp.sql_as(pg_temp.f('doc'), format($q$select public.create_clinical_follow_up(%L, 'order', now() - interval '1 hour')$q$, pg_temp.f('pat'))));
insert into results values ('real', 'an unknown kind is refused', 'ERR:22023',
  pg_temp.sql_as(pg_temp.f('doc'), format($q$select public.create_clinical_follow_up(%L, 'chat', now() + interval '1 day')$q$, pg_temp.f('pat'))));
insert into results values ('real', 'a source row that is not this patients is refused', 'ERR:22023',
  pg_temp.sql_as(pg_temp.f('doc'), format($q$select public.create_clinical_follow_up(%L, 'referral', now() + interval '1 day', 'specialist_referrals', gen_random_uuid())$q$, pg_temp.f('pat'))));
-- provenance
select pg_temp.setf('fu1', id) from public.clinical_follow_ups where patient_id = pg_temp.f('pat') and kind = 'lab_request';
insert into results values ('real', 'created_by and owner are the creator, is_test follows the patient', 'true',
  (select (created_by = owner_id and owner_id = pg_temp.f('doc') and is_test and state = 'open')::text from public.clinical_follow_ups where id = pg_temp.f('fu1')));

-- 2. nobody writes the table directly
insert into results values ('real', 'the owner cannot insert directly', 'ERR:42501',
  pg_temp.sql_as(pg_temp.f('doc'), format($q$insert into public.clinical_follow_ups (organisation_id, patient_id, kind, owner_id, due_at, created_by) values (%L, %L, 'order', %L, now() + interval '1 day', %L)$q$, pg_temp.f('org'), pg_temp.f('pat'), pg_temp.f('doc'), pg_temp.f('doc'))));
insert into results values ('real', 'the owner cannot update directly', 'ERR:42501',
  pg_temp.sql_as(pg_temp.f('doc'), format($q$update public.clinical_follow_ups set due_at = now() + interval '9 days' where id = %L$q$, pg_temp.f('fu1'))));
insert into results values ('real', 'the owner cannot delete directly', 'ERR:42501',
  pg_temp.sql_as(pg_temp.f('doc'), format($q$delete from public.clinical_follow_ups where id = %L$q$, pg_temp.f('fu1'))));
do $$
declare r text;
begin
  begin update public.clinical_follow_ups set due_at = now() + interval '9 days' where id = pg_temp.f('fu1'); r := 'ok'; exception when others then r := 'ERR:' || sqlstate; end;
  insert into results values ('real', 'even the table owner cannot write without the function flag', 'ERR:42501', r);
  begin delete from public.clinical_follow_ups where id = pg_temp.f('fu1'); r := 'ok'; exception when others then r := 'ERR:' || sqlstate; end;
  insert into results values ('real', 'even the table owner cannot delete', 'ERR:42501', r);
  -- and a delete is refused even WITH the function flag (a follow-up is closed, never removed)
  r := pg_temp.flagged(format($q$delete from public.clinical_follow_ups where id = %L$q$, pg_temp.f('fu1')));
  insert into results values ('real', 'a delete is refused even with the function flag', 'ERR:42501', r);
end $$;

-- 3. closes only with an outcome and a reason
insert into results values ('real', 'closing with no outcome is refused', 'ERR:22023',
  pg_temp.sql_as(pg_temp.f('doc'), format($q$select public.close_clinical_follow_up(%L, null, 'patient was seen at the lab')$q$, pg_temp.f('fu1'))));
insert into results values ('real', 'closing with an unknown outcome is refused', 'ERR:22023',
  pg_temp.sql_as(pg_temp.f('doc'), format($q$select public.close_clinical_follow_up(%L, 'finished', 'patient was seen at the lab')$q$, pg_temp.f('fu1'))));
insert into results values ('real', 'closing with a short reason is refused', 'ERR:22023',
  pg_temp.sql_as(pg_temp.f('doc'), format($q$select public.close_clinical_follow_up(%L, 'done', 'ok')$q$, pg_temp.f('fu1'))));
insert into results values ('real', 'the CHECK itself refuses a close with no outcome, with the function flag on', 'ERR:23514',
  pg_temp.flagged(format($q$update public.clinical_follow_ups set state = 'closed', closed_at = now(), closed_by = %L where id = %L$q$, pg_temp.f('doc'), pg_temp.f('fu1'))));
insert into results values ('real', 'the CHECK itself refuses a close with a short reason', 'ERR:23514',
  pg_temp.flagged(format($q$update public.clinical_follow_ups set state = 'closed', closed_at = now(), closed_by = %L, outcome = 'done', outcome_reason = 'ok' where id = %L$q$, pg_temp.f('doc'), pg_temp.f('fu1'))));
insert into results values ('real', 'the follow-up is still open after the refusals', 'open',
  (select state from public.clinical_follow_ups where id = pg_temp.f('fu1')));

-- 4. read matrix
insert into results values ('real', 'the owner reads it', '1',
  pg_temp.count_as(pg_temp.f('doc'), format($q$select count(*)::text from public.clinical_follow_ups where id = %L$q$, pg_temp.f('fu1'))));
insert into results values ('real', 'a clinician tied to the patient reads it', '1',
  pg_temp.count_as(pg_temp.f('doc3'), format($q$select count(*)::text from public.clinical_follow_ups where id = %L$q$, pg_temp.f('fu1'))));
insert into results values ('real', 'another clinician reads nothing', '0',
  pg_temp.count_as(pg_temp.f('doc2'), format($q$select count(*)::text from public.clinical_follow_ups where id = %L$q$, pg_temp.f('fu1'))));
insert into results values ('real', 'the patient reads nothing', '0',
  pg_temp.count_as(pg_temp.f('pat'), format($q$select count(*)::text from public.clinical_follow_ups where id = %L$q$, pg_temp.f('fu1'))));
insert into results values ('real', 'an admin reads nothing from the table', '0',
  pg_temp.count_as(pg_temp.f('admin'), format($q$select count(*)::text from public.clinical_follow_ups where id = %L$q$, pg_temp.f('fu1'))));
insert into results values ('real', 'anon cannot read the table', 'ERR:42501',
  pg_temp.sql_anon($q$select count(*) from public.clinical_follow_ups$q$));
insert into results values ('real', 'the list function gives the owner the row', '1',
  pg_temp.count_as(pg_temp.f('doc'), $q$select jsonb_array_length(public.list_clinical_follow_ups(false))::text$q$));
insert into results values ('real', 'the list function gives another clinician nothing', '0',
  pg_temp.count_as(pg_temp.f('doc2'), $q$select jsonb_array_length(public.list_clinical_follow_ups(false))::text$q$));
insert into results values ('real', 'a patient cannot use the list function', 'ERR:42501',
  pg_temp.count_as(pg_temp.f('pat'), $q$select jsonb_array_length(public.list_clinical_follow_ups(false))::text$q$));
insert into results values ('real', 'anon cannot use the list function', 'ERR:42501',
  pg_temp.sql_anon($q$select public.list_clinical_follow_ups(false)$q$));
insert into results values ('real', 'the admin list returns the organisations rows', 'true',
  pg_temp.count_as(pg_temp.f('admin'), $q$select (jsonb_array_length(public.list_clinical_follow_ups(false)) >= 1)::text$q$));
insert into results values ('real', 'an admin read is audited', '1',
  (select count(*)::text from public.audit_log where action = 'clinical_follow_up.admin_read' and actor_id = pg_temp.f('admin')));
insert into results values ('real', 'another clinician cannot acknowledge it', 'ERR:42501',
  pg_temp.sql_as(pg_temp.f('doc2'), format($q$select public.acknowledge_clinical_follow_up(%L)$q$, pg_temp.f('fu1'))));
insert into results values ('real', 'another clinician cannot close it', 'ERR:42501',
  pg_temp.sql_as(pg_temp.f('doc2'), format($q$select public.close_clinical_follow_up(%L, 'done', 'trying to close what I cannot see')$q$, pg_temp.f('fu1'))));
insert into results values ('real', 'the owner acknowledges it', 'ok',
  pg_temp.sql_as(pg_temp.f('doc'), format($q$select public.acknowledge_clinical_follow_up(%L)$q$, pg_temp.f('fu1'))));
insert into results values ('real', 'acknowledgement is attributed', 'acknowledged',
  (select case when acknowledged_by = pg_temp.f('doc') then state else 'wrong' end from public.clinical_follow_ups where id = pg_temp.f('fu1')));
insert into results values ('real', 'the tied clinician closes it with an outcome and a reason', 'ok',
  pg_temp.sql_as(pg_temp.f('doc3'), format($q$select public.close_clinical_follow_up(%L, 'done', 'result reviewed with the patient and filed')$q$, pg_temp.f('fu1'))));
insert into results values ('real', 'a closed follow-up carries outcome, reason and who closed it', 'true',
  (select (state = 'closed' and outcome = 'done' and outcome_reason is not null and closed_by = pg_temp.f('doc3') and closed_at is not null)::text from public.clinical_follow_ups where id = pg_temp.f('fu1')));
insert into results values ('real', 'a closed follow-up cannot be closed twice', 'ERR:22023',
  pg_temp.sql_as(pg_temp.f('doc'), format($q$select public.close_clinical_follow_up(%L, 'other', 'closing it again for no reason')$q$, pg_temp.f('fu1'))));

-- 5. the sweep with NO active config
do $$
declare v_a uuid; v_b uuid; v_sab uuid; v_r jsonb;
begin
  perform pg_temp.act(pg_temp.f('doc'));
  v_a := public.create_clinical_follow_up(pg_temp.f('pat'), 'order', now() + interval '3 days');            -- routine
  v_b := public.create_clinical_follow_up(pg_temp.f('pat2'), 'lab_request', now() + interval '3 days', null, null, true);  -- abnormal result
  v_sab := public.create_clinical_follow_up(pg_temp.f('pat3'), 'follow_up', now() + interval '3 days');   -- no lead, owned only
  perform pg_temp.back();
  perform pg_temp.setf('fu_routine', v_a); perform pg_temp.setf('fu_abn', v_b); perform pg_temp.setf('fu_nolead', v_sab);
  -- age them: routine due 2 days ago (past 24h), abnormal due 5 hours ago (past 4h), no-lead due 2 days ago
  perform pg_temp.flagged(format($q$update public.clinical_follow_ups set due_at = now() - interval '2 days' where id in (%L, %L)$q$, v_a, v_sab));
  perform pg_temp.flagged(format($q$update public.clinical_follow_ups set due_at = now() - interval '5 hours' where id = %L$q$, v_b));
  v_r := private.sweep_clinical_follow_ups();
  insert into results values ('real', 'no active config: the sweep says so', 'none_active', v_r ->> 'config');
  insert into results values ('real', 'no active config: the three are marked overdue', '3',
    (select count(*)::text from public.clinical_follow_ups where id in (v_a, v_b, v_sab) and overdue_at is not null));
  insert into results values ('real', 'no active config: nothing is escalated', '0',
    (select count(*)::text from public.clinical_follow_ups where id in (v_a, v_b, v_sab) and (escalated_at is not null or escalation_task_id is not null)));
  insert into results values ('real', 'no active config: no follow-up task was made', '0',
    (select count(*)::text from public.clinical_tasks where type in ('follow_up_overdue', 'follow_up_overdue_abnormal') and patient_id in (pg_temp.f('pat'), pg_temp.f('pat2'), pg_temp.f('pat3'))));
end $$;

-- the config is born unsigned and inactive, and only the CMO can sign it
insert into results values ('real', 'the seeded config is version 1, unsigned and inactive', 'true',
  (select (version = 1 and not is_active and signed_by is null and (rules ->> 'routine_escalate_after_hours')::int = 24 and (rules ->> 'abnormal_escalate_after_hours')::int = 4)::text
     from public.clinical_follow_up_config where version = 1));
do $$
declare r text;
begin
  begin update public.clinical_follow_up_config set is_active = true, signed_by = pg_temp.f('cmo'), signed_at = now() where version = 1; r := 'ok'; exception when others then r := 'ERR:' || sqlstate; end;
  insert into results values ('real', 'a bare update cannot activate a config', 'ERR:42501', r);
end $$;
insert into results values ('real', 'a plain clinician cannot sign the config', 'ERR:42501',
  pg_temp.sql_as(pg_temp.f('doc'), $q$select public.sign_clinical_follow_up_config(1, 'checked the times with the team')$q$));
insert into results values ('real', 'an admin cannot sign the config', 'ERR:42501',
  pg_temp.sql_as(pg_temp.f('admin'), $q$select public.sign_clinical_follow_up_config(1, 'checked the times with the team')$q$));
insert into results values ('real', 'anon cannot sign the config', 'ERR:42501',
  pg_temp.sql_anon($q$select public.sign_clinical_follow_up_config(1, 'checked the times with the team')$q$));

-- SABOTAGE (b): the sweep takes its times from a hard-coded value instead of the ACTIVE signed row. With no config active it now escalates.
do $$
declare v_orig text; v_def text; v_r jsonb;
begin
  v_orig := pg_get_functiondef('private.sweep_clinical_follow_ups()'::regprocedure);
  v_def := replace(v_orig, 'select rules into v_cfg from public.clinical_follow_up_config where is_active;',
                   'v_cfg := ''{"routine_escalate_after_hours": 24, "abnormal_escalate_after_hours": 4}''::jsonb;');
  if v_def = v_orig then raise exception 'SABOTAGE (b) not applied'; end if;
  execute v_def;
  v_r := private.sweep_clinical_follow_ups();
  insert into results values ('sabotaged', 'no active config: nothing is escalated', '0',
    (select count(*)::text from public.clinical_follow_ups where id in (pg_temp.f('fu_routine'), pg_temp.f('fu_abn'), pg_temp.f('fu_nolead')) and escalated_at is not null));
  -- put it all back for the real phase: restore the function and clear the marks (the tasks stay: the real sweep merges into them by dedup key)
  execute v_orig;
  perform pg_temp.flagged(format($q$update public.clinical_follow_ups set escalated_at = null, escalation_task_id = null, escalation_route = null where id in (%L, %L, %L)$q$,
    pg_temp.f('fu_routine'), pg_temp.f('fu_abn'), pg_temp.f('fu_nolead')));
end $$;

-- 6. the CMO signs, then the sweep escalates by the signed times
insert into results values ('real', 'the CMO signs the config', 'ok',
  pg_temp.sql_as(pg_temp.f('cmo'), $q$select public.sign_clinical_follow_up_config(1, 'checked the times with the team')$q$));
insert into results values ('real', 'the signed config is active and attributed', 'true',
  (select (is_active and signed_by = pg_temp.f('cmo') and signed_at is not null)::text from public.clinical_follow_up_config where version = 1));
do $$
declare r text; v_r jsonb; v_late uuid;
begin
  begin update public.clinical_follow_up_config set rules = '{"routine_escalate_after_hours": 1, "abnormal_escalate_after_hours": 1}' where version = 1; r := 'ok'; exception when others then r := 'ERR:' || sqlstate; end;
  insert into results values ('real', 'a signed config cannot be edited', 'ERR:42501', r);

  -- two extra follow-ups that are overdue but NOT yet past their escalation time: routine due 5 hours ago (needs 24), abnormal due 1 hour ago (needs 4)
  perform pg_temp.act(pg_temp.f('doc'));
  v_late := public.create_clinical_follow_up(pg_temp.f('pat'), 'order', now() + interval '3 days');
  perform pg_temp.back();
  perform pg_temp.setf('fu_routine_early', v_late);
  perform pg_temp.flagged(format($q$update public.clinical_follow_ups set due_at = now() - interval '5 hours' where id = %L$q$, v_late));
  perform pg_temp.act(pg_temp.f('doc'));
  v_late := public.create_clinical_follow_up(pg_temp.f('pat2'), 'lab_request', now() + interval '3 days', null, null, true);
  perform pg_temp.back();
  perform pg_temp.setf('fu_abn_early', v_late);
  perform pg_temp.flagged(format($q$update public.clinical_follow_ups set due_at = now() - interval '1 hour' where id = %L$q$, v_late));

  v_r := private.sweep_clinical_follow_ups();
  insert into results values ('real', 'signed config: the sweep says active', 'active', v_r ->> 'config');
  insert into results values ('real', 'a routine follow-up 2 days overdue is escalated', 'follow_up_overdue',
    (select t.type from public.clinical_follow_ups f join public.clinical_tasks t on t.id = f.escalation_task_id where f.id = pg_temp.f('fu_routine')));
  insert into results values ('real', 'an abnormal-result follow-up 5 hours overdue is escalated (4 hour rule)', 'follow_up_overdue_abnormal',
    (select t.type from public.clinical_follow_ups f join public.clinical_tasks t on t.id = f.escalation_task_id where f.id = pg_temp.f('fu_abn')));
  insert into results values ('real', 'a routine follow-up only 5 hours overdue is NOT escalated (24 hour rule)', 'false',
    (select (escalated_at is not null)::text from public.clinical_follow_ups where id = pg_temp.f('fu_routine_early')));
  insert into results values ('real', 'an abnormal follow-up only 1 hour overdue is NOT escalated (4 hour rule)', 'false',
    (select (escalated_at is not null)::text from public.clinical_follow_ups where id = pg_temp.f('fu_abn_early')));
  insert into results values ('real', 'no lead clinician: a task exists and is live (pool, or pushed to an employed doctor), never dropped', 'true',
    (select (t.state::text in ('open', 'offered_to_lead') and ((f.escalation_route = 'raised') = (t.state::text = 'offered_to_lead')))::text
       from public.clinical_follow_ups f join public.clinical_tasks t on t.id = f.escalation_task_id where f.id = pg_temp.f('fu_nolead')));
  insert into results values ('real', 'no lead clinician and no employed doctor on this stack: the route is the open pool', 'true',
    (select (case when exists (select 1 from public.clinical_staff cs where cs.organisation_id = pg_temp.f('org') and cs.active and cs.employment_type = 'employed' and cs.doctor_tier is not null)
                  then true else f.escalation_route = 'to_pool' end)::text from public.clinical_follow_ups f where f.id = pg_temp.f('fu_nolead')));
  insert into results values ('real', 'a patient with a lead clinician: the route matches the task state', 'true',
    (select ((f.escalation_route = 'raised') = (t.state::text = 'offered_to_lead'))::text from public.clinical_follow_ups f join public.clinical_tasks t on t.id = f.escalation_task_id where f.id = pg_temp.f('fu_routine')));
  insert into results values ('real', 'escalation is written to the audit log, with no patient detail', 'true',
    (select (count(*) = 3 and bool_and((event ->> 'task_id') is not null and not (event::text ~* '(result|reading|diagnos)')))::text
       from public.audit_log where action = 'clinical_follow_up.escalated' and entity_id in (pg_temp.f('fu_routine'), pg_temp.f('fu_abn'), pg_temp.f('fu_nolead'))));
  -- a second sweep escalates nothing more and makes no second task
  v_r := private.sweep_clinical_follow_ups();
  insert into results values ('real', 'a second sweep escalates nothing more', '0', v_r ->> 'escalated');
  insert into results values ('real', 'exactly one follow-up task per escalated follow-up', '3',
    (select count(*)::text from public.clinical_tasks where type in ('follow_up_overdue', 'follow_up_overdue_abnormal') and patient_id in (pg_temp.f('pat'), pg_temp.f('pat2'), pg_temp.f('pat3'))));
  insert into results values ('real', 'the task row holds no clinical detail (INV-07)', 'true',
    (select (bool_and(outcome is null and cancel_reason is null))::text from public.clinical_tasks where type in ('follow_up_overdue', 'follow_up_overdue_abnormal') and patient_id = pg_temp.f('pat3')));
  insert into results values ('real', 'the sweep is scheduled every 15 minutes', '*/15 * * * *',
    (select schedule from cron.job where jobname = 'sweep-clinical-follow-ups'));
  insert into results values ('real', 'the sweep is not callable by a signed-in role', 'false',
    has_function_privilege('authenticated', 'private.sweep_clinical_follow_ups()', 'EXECUTE')::text);
end $$;

-- 7. the alert snooze link
do $$
declare v_alert uuid; v_task uuid; v_fu uuid;
begin
  insert into public.clinician_alerts (organisation_id, patient_id, level, title)
    values (pg_temp.f('org'), pg_temp.f('pat'), 'emergency', 'Lifestyle red flag (test): s77_fixture') returning id into v_alert;
  insert into public.alert_follow_up_tasks (organisation_id, clinician_alert_id, patient_id, due_at, reason, created_by)
    values (pg_temp.f('org'), v_alert, pg_temp.f('pat'), now() + interval '1 day', 'follow up tomorrow', pg_temp.f('staff_doc'))
    returning id into v_task;
  select id into v_fu from public.clinical_follow_ups where source_table = 'alert_follow_up_tasks' and source_id = v_task;
  insert into results values ('real', 'a snooze follow-up task opens a linked follow-up owned by its creator', 'true',
    (select (owner_id = pg_temp.f('doc') and kind = 'follow_up' and state = 'open')::text from public.clinical_follow_ups where id = v_fu));
  update public.alert_follow_up_tasks set status = 'done' where id = v_task;
  insert into results values ('real', 'finishing the snooze task closes the follow-up with an outcome and a reason', 'true',
    (select (state = 'closed' and outcome = 'done' and char_length(outcome_reason) >= 10)::text from public.clinical_follow_ups where id = v_fu));
  insert into results values ('real', 'the link never wrote an error row', '0',
    (select count(*)::text from public.audit_log where action = 'clinical_follow_up_link.error' and entity_id = v_task));
end $$;

-- SABOTAGE (a): the closes-with-outcome CHECK dropped; a flagged bare close with no outcome now succeeds
do $$
declare v_fu uuid; r text;
begin
  alter table public.clinical_follow_ups drop constraint clinical_follow_ups_closes_with_outcome;
  select id into v_fu from public.clinical_follow_ups where id = pg_temp.f('fu_routine_early');
  r := pg_temp.flagged(format($q$update public.clinical_follow_ups set state = 'closed', closed_at = now(), closed_by = %L where id = %L$q$, pg_temp.f('doc'), v_fu));
  insert into results values ('sabotaged', 'the CHECK itself refuses a close with no outcome, with the function flag on', 'ERR:23514', r);
end $$;

-- SABOTAGE (c): the read policy opened to everyone; another clinician now reads the row
do $$
begin
  alter policy clinical_follow_ups_read on public.clinical_follow_ups using (true);
  insert into results values ('sabotaged', 'another clinician reads nothing', '0',
    pg_temp.count_as(pg_temp.f('doc2'), format($q$select count(*)::text from public.clinical_follow_ups where id = %L$q$, pg_temp.f('fu_routine'))));
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S77 follow-ups proof FAILED: %', (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected is distinct from actual;
  if v_caught < 3 then raise exception 'VACUOUS TEST: only % of 3 sabotages flipped a check', v_caught; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result from results where phase = 'real' order by check_name;
rollback;
