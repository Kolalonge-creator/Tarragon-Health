-- S77 proof: live red-flag prompts engine (spec 23.7, CMO decision S-10, INV-01, INV-12, INV-14).
--   1. record_live_prompt needs (a) the go-live guard on, (b) the patient's granted consent that scribe_may_start accepts for the encounter,
--      (c) the caller to be the encounter's clinician. Guard off for a real patient, no consent row, an unanswered or declined consent, an ended
--      consultation, another clinician, the patient and anon are all refused. A test pair (both test accounts) passes while the guard is off.
--   2. Only a phrase on the signed danger-phrase list is accepted; nothing else is stored (no transcript text column exists).
--   3. Prompts are readable by the consulting clinician only: another clinician, the patient, an admin and anon read nothing.
--   4. Nobody writes live_prompts directly (even the table owner); a delete is refused always; every show and every dismissal is audited.
--   5. A prompt can be dismissed even after the guard is switched off, only by its clinician, once.
--   6. The guard is born off, has four unmet attestation conditions, and no attestation was seeded.
--   SABOTAGE: (a) the guard check removed, (b) the consent check removed, (c) the read policy opened; each must flip a check.
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
  values (v, 's77lp-' || p_label || '@example.invalid', 'x', now(), '{}', '{}');
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
  values (p_org, v, 'S77 ' || p_label, 'MDCN', 'S77LP-' || p_label || '-' || substr(v::text, 1, 8), true, 'active', now(), p_admin,
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
-- a scalar as a user, 'ERR:sqlstate' when refused
create function pg_temp.val_as(p_uid uuid, p_sql text) returns text language plpgsql as $f$
declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql into r; exception when others then perform pg_temp.back(); return 'ERR:' || sqlstate; end;
  perform pg_temp.back();
  return r;
end $f$;
-- the write a function would do (flag on)
create function pg_temp.flagged(p_sql text) returns text language plpgsql as $f$
begin
  perform set_config('tarragon.live_prompt_write', 'on', true);
  begin execute p_sql; exception when others then perform set_config('tarragon.live_prompt_write', 'off', true); return 'ERR:' || sqlstate; end;
  perform set_config('tarragon.live_prompt_write', 'off', true);
  return 'ok';
end $f$;

do $$
declare
  v_org uuid; v_admin uuid; v_doc uuid; v_doc2 uuid; v_pat uuid; v_tpat uuid; v_e1 uuid; v_e2 uuid; v_e3 uuid; v_e4 uuid; v_e5 uuid; v_e6 uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  v_doc := pg_temp.mkdoc(v_org, 'doc', v_admin, 'senior_medical_officer');
  v_doc2 := pg_temp.mkdoc(v_org, 'doc2', v_admin, 'senior_medical_officer');
  v_pat := pg_temp.mkuser(v_org, 'realpat', 'patient');
  update public.profiles set is_test = false, date_of_birth = date '1985-01-01' where id = v_pat;      -- a real (non-test) patient: no test-pair bypass
  v_tpat := pg_temp.mkuser(v_org, 'testpat', 'patient');
  update public.profiles set date_of_birth = date '1985-01-01' where id = v_tpat;            -- a test patient: with a test clinician the test-pair bypass applies
  insert into public.encounters (organisation_id, patient_id, clinician_id, type, status, scheduled_at, started_at, policy_version, is_test)
    values (v_org, v_pat, v_doc, 'video', 'in_progress', now(), now(), 1, false) returning id into v_e1;   -- real patient, consent granted
  insert into public.encounters (organisation_id, patient_id, clinician_id, type, status, scheduled_at, started_at, policy_version, is_test)
    values (v_org, v_pat, v_doc, 'video', 'in_progress', now(), now(), 1, false) returning id into v_e2;   -- no consent row
  insert into public.encounters (organisation_id, patient_id, clinician_id, type, status, scheduled_at, started_at, policy_version, is_test)
    values (v_org, v_pat, v_doc, 'video', 'in_progress', now(), now(), 1, false) returning id into v_e3;   -- consent asked, not answered
  insert into public.encounters (organisation_id, patient_id, clinician_id, type, status, scheduled_at, started_at, policy_version, is_test)
    values (v_org, v_pat, v_doc, 'video', 'in_progress', now(), now(), 1, false) returning id into v_e4;   -- consent declined
  insert into public.encounters (organisation_id, patient_id, clinician_id, type, status, scheduled_at, started_at, policy_version, is_test)
    values (v_org, v_tpat, v_doc, 'video', 'in_progress', now(), now(), 1, true) returning id into v_e5;   -- test pair, consent granted
  insert into public.encounters (organisation_id, patient_id, clinician_id, type, status, scheduled_at, started_at, ended_at, policy_version, is_test)
    values (v_org, v_pat, v_doc, 'video', 'completed', now() - interval '1 hour', now() - interval '1 hour', now(), 1, false) returning id into v_e6;   -- ended, consent granted
  insert into public.consultation_scribe_consents (organisation_id, encounter_id, patient_id, granted, answered_at, method, is_test) values
    (v_org, v_e1, v_pat, true, now(), 'in_app', false),
    (v_org, v_e3, v_pat, null, null, 'in_app', false),
    (v_org, v_e4, v_pat, false, now(), 'in_app', false),
    (v_org, v_e5, v_tpat, true, now(), 'in_app', true),
    (v_org, v_e6, v_pat, true, now(), 'in_app', false);
  perform pg_temp.setf('org', v_org); perform pg_temp.setf('admin', v_admin); perform pg_temp.setf('doc', v_doc); perform pg_temp.setf('doc2', v_doc2);
  perform pg_temp.setf('pat', v_pat); perform pg_temp.setf('tpat', v_tpat);
  perform pg_temp.setf('e1', v_e1); perform pg_temp.setf('e2', v_e2); perform pg_temp.setf('e3', v_e3); perform pg_temp.setf('e4', v_e4);
  perform pg_temp.setf('e5', v_e5); perform pg_temp.setf('e6', v_e6);
end $$;

-- 6. the guard: born off, conditions unmet, nothing seeded
insert into results values ('real', 'the live red-flag guard is born off', 'false',
  (select is_on::text from public.go_live_guards where key = 'live_redflag_prompts_enabled'));
insert into results values ('real', 'the guard is the CMOs to switch', 'cmo',
  (select switch_role from public.go_live_guards where key = 'live_redflag_prompts_enabled'));
insert into results values ('real', 'all four conditions are unmet', '4',
  (select count(*)::text from jsonb_array_elements(private.go_live_conditions('live_redflag_prompts_enabled', null)) c where not (c ->> 'met')::boolean));
insert into results values ('real', 'no attestation was seeded for the guard', '0',
  (select count(*)::text from public.go_live_attestations where guard_key = 'live_redflag_prompts_enabled'));
insert into results values ('real', 'the guard cannot be switched on while the conditions are unmet', 'ERR:42501',
  pg_temp.sql_as(pg_temp.f('admin'), $q$select public.set_go_live_guard('live_redflag_prompts_enabled', true, 'trying to switch it on early')$q$));
insert into results values ('real', 'the older S28c guard conditions are unchanged (prescribing still has its pharmacy conditions)', 'true',
  (select (jsonb_array_length(private.go_live_conditions('prescribing_enabled', null)) >= 6)::text));

-- 1a. guard OFF, real patient: refused. The test pair passes while the guard is off.
insert into results values ('real', 'guard off, real patient: refused (P0001)', 'ERR:P0001',
  pg_temp.sql_as(pg_temp.f('doc'), format($q$select public.record_live_prompt(%L, 'chest pain')$q$, pg_temp.f('e1'))));
insert into results values ('real', 'guard off, test patient and test clinician with consent: passes (test pair rule)', 'ok',
  pg_temp.sql_as(pg_temp.f('doc'), format($q$select public.record_live_prompt(%L, 'chest pain')$q$, pg_temp.f('e5'))));

-- switch both guards on the way the switch function would (a log row in the same transaction, then the row)
do $$
begin
  insert into public.go_live_guard_log (guard_key, action, actor_id, actor_role, note) values
    ('live_redflag_prompts_enabled', 'switched_on', pg_temp.f('admin'), 'cmo', 'proof only, rolled back'),
    ('scribe_enabled', 'switched_on', pg_temp.f('admin'), 'cmo', 'proof only, rolled back');
  update public.go_live_guards set is_on = true, changed_at = now(), changed_by = pg_temp.f('admin'), change_note = 'proof only, rolled back'
   where key in ('live_redflag_prompts_enabled', 'scribe_enabled');
end $$;

-- 1b. guard ON: consent and caller rules
insert into results values ('real', 'no consent row: refused', 'ERR:42501',
  pg_temp.sql_as(pg_temp.f('doc'), format($q$select public.record_live_prompt(%L, 'chest pain')$q$, pg_temp.f('e2'))));
insert into results values ('real', 'consent asked but not answered: refused', 'ERR:42501',
  pg_temp.sql_as(pg_temp.f('doc'), format($q$select public.record_live_prompt(%L, 'chest pain')$q$, pg_temp.f('e3'))));
insert into results values ('real', 'consent declined: refused', 'ERR:42501',
  pg_temp.sql_as(pg_temp.f('doc'), format($q$select public.record_live_prompt(%L, 'chest pain')$q$, pg_temp.f('e4'))));
insert into results values ('real', 'consultation ended (consent still on file): refused', 'ERR:42501',
  pg_temp.sql_as(pg_temp.f('doc'), format($q$select public.record_live_prompt(%L, 'chest pain')$q$, pg_temp.f('e6'))));
insert into results values ('real', 'another clinician cannot record on this consultation', 'ERR:42501',
  pg_temp.sql_as(pg_temp.f('doc2'), format($q$select public.record_live_prompt(%L, 'chest pain')$q$, pg_temp.f('e1'))));
insert into results values ('real', 'the patient cannot record', 'ERR:42501',
  pg_temp.sql_as(pg_temp.f('pat'), format($q$select public.record_live_prompt(%L, 'chest pain')$q$, pg_temp.f('e1'))));
insert into results values ('real', 'the admin cannot record', 'ERR:42501',
  pg_temp.sql_as(pg_temp.f('admin'), format($q$select public.record_live_prompt(%L, 'chest pain')$q$, pg_temp.f('e1'))));
insert into results values ('real', 'anon cannot record', 'ERR:42501',
  pg_temp.sql_anon(format($q$select public.record_live_prompt(%L, 'chest pain')$q$, pg_temp.f('e1'))));
insert into results values ('real', 'a phrase that is not on the list is refused', 'ERR:22023',
  pg_temp.sql_as(pg_temp.f('doc'), format($q$select public.record_live_prompt(%L, 'my knee is sore')$q$, pg_temp.f('e1'))));
insert into results values ('real', 'a whole sentence is not accepted as a phrase', 'ERR:22023',
  pg_temp.sql_as(pg_temp.f('doc'), format($q$select public.record_live_prompt(%L, 'I have had chest pain since this morning')$q$, pg_temp.f('e1'))));
insert into results values ('real', 'an empty phrase is refused', 'ERR:22023',
  pg_temp.sql_as(pg_temp.f('doc'), format($q$select public.record_live_prompt(%L, '   ')$q$, pg_temp.f('e1'))));
insert into results values ('real', 'an unknown rule id is refused', 'ERR:22023',
  pg_temp.sql_as(pg_temp.f('doc'), format($q$select public.record_live_prompt(%L, 'chest pain', 'invented_rule', 1)$q$, pg_temp.f('e1'))));
insert into results values ('real', 'nothing was written by any refusal', '0',
  (select count(*)::text from public.live_prompts where encounter_id in (pg_temp.f('e1'), pg_temp.f('e2'), pg_temp.f('e3'), pg_temp.f('e4'), pg_temp.f('e6'))));

-- 1c. the happy path
insert into results values ('real', 'guard on, consent granted, the encounters clinician: recorded', 'ok',
  pg_temp.sql_as(pg_temp.f('doc'), format($q$select public.record_live_prompt(%L, 'Chest Pain')$q$, pg_temp.f('e1'))));
insert into results values ('real', 'one row: the list phrase, rule id and version, not dismissed, real patient', 'true',
  (select (count(*) = 1 and bool_and(phrase_matched = 'chest pain' and rule_id = 'written_question_danger_phrases' and rule_version = 1
     and dismissed_at is null and not is_test and clinician_id = pg_temp.f('doc') and patient_id = pg_temp.f('pat')))::text
     from public.live_prompts where encounter_id = pg_temp.f('e1')));
insert into results values ('real', 'the table has no transcript or free-text column', '0',
  (select count(*)::text from information_schema.columns where table_schema = 'public' and table_name = 'live_prompts'
      and column_name in ('transcript', 'segment', 'text', 'body', 'content', 'utterance', 'note')));
insert into results values ('real', 'the same phrase again returns the same prompt and adds no row', 'true',
  (select (pg_temp.val_as(pg_temp.f('doc'), format($q$select public.record_live_prompt(%L, 'chest pain')::text$q$, pg_temp.f('e1')))
           = (select id::text from public.live_prompts where encounter_id = pg_temp.f('e1'))
           and (select count(*) from public.live_prompts where encounter_id = pg_temp.f('e1')) = 1)::text));
insert into results values ('real', 'showing it was audited exactly once', '1',
  (select count(*)::text from public.audit_log where action = 'live_prompt.shown' and actor_id = pg_temp.f('doc')
      and entity_id = (select id from public.live_prompts where encounter_id = pg_temp.f('e1'))));
insert into results values ('real', 'a second phrase is its own prompt', 'ok',
  pg_temp.sql_as(pg_temp.f('doc'), format($q$select public.record_live_prompt(%L, 'seizure')$q$, pg_temp.f('e1'))));
insert into results values ('real', 'the test-pair row is marked is_test', 'true',
  (select bool_and(is_test)::text from public.live_prompts where encounter_id = pg_temp.f('e5')));

-- 3. read matrix
insert into results values ('real', 'the consulting clinician reads their two prompts', '2',
  pg_temp.val_as(pg_temp.f('doc'), format($q$select count(*)::text from public.live_prompts where encounter_id = %L$q$, pg_temp.f('e1'))));
insert into results values ('real', 'another clinician reads nothing', '0',
  pg_temp.val_as(pg_temp.f('doc2'), format($q$select count(*)::text from public.live_prompts where encounter_id = %L$q$, pg_temp.f('e1'))));
insert into results values ('real', 'the patient reads nothing', '0',
  pg_temp.val_as(pg_temp.f('pat'), format($q$select count(*)::text from public.live_prompts where encounter_id = %L$q$, pg_temp.f('e1'))));
insert into results values ('real', 'an admin reads nothing', '0',
  pg_temp.val_as(pg_temp.f('admin'), format($q$select count(*)::text from public.live_prompts where encounter_id = %L$q$, pg_temp.f('e1'))));
insert into results values ('real', 'anon cannot read the table', 'ERR:42501',
  pg_temp.sql_anon($q$select count(*) from public.live_prompts$q$));

-- 4. nobody writes directly
insert into results values ('real', 'the clinician cannot insert directly', 'ERR:42501',
  pg_temp.sql_as(pg_temp.f('doc'), format($q$insert into public.live_prompts (organisation_id, encounter_id, patient_id, clinician_id, phrase_matched, rule_id, rule_version) values (%L, %L, %L, %L, 'stroke', 'written_question_danger_phrases', 1)$q$, pg_temp.f('org'), pg_temp.f('e1'), pg_temp.f('pat'), pg_temp.f('doc'))));
insert into results values ('real', 'the clinician cannot update directly', 'ERR:42501',
  pg_temp.sql_as(pg_temp.f('doc'), format($q$update public.live_prompts set dismissed_at = now(), dismissed_by = %L where encounter_id = %L$q$, pg_temp.f('doc'), pg_temp.f('e1'))));
insert into results values ('real', 'the clinician cannot delete directly', 'ERR:42501',
  pg_temp.sql_as(pg_temp.f('doc'), format($q$delete from public.live_prompts where encounter_id = %L$q$, pg_temp.f('e1'))));
do $$
declare r text;
begin
  begin update public.live_prompts set dismissed_at = now(), dismissed_by = pg_temp.f('doc') where encounter_id = pg_temp.f('e1'); r := 'ok'; exception when others then r := 'ERR:' || sqlstate; end;
  insert into results values ('real', 'even the table owner cannot update without the function flag', 'ERR:42501', r);
  begin delete from public.live_prompts where encounter_id = pg_temp.f('e1'); r := 'ok'; exception when others then r := 'ERR:' || sqlstate; end;
  insert into results values ('real', 'even the table owner cannot delete', 'ERR:42501', r);
  r := pg_temp.flagged(format($q$delete from public.live_prompts where encounter_id = %L$q$, pg_temp.f('e1')));
  insert into results values ('real', 'a delete is refused even with the function flag', 'ERR:42501', r);
  r := pg_temp.flagged(format($q$update public.live_prompts set phrase_matched = 'stroke' where encounter_id = %L$q$, pg_temp.f('e1')));
  insert into results values ('real', 'the phrase of a shown prompt cannot be changed even with the flag', 'ERR:42501', r);
  begin truncate public.live_prompts; r := 'ok'; exception when others then r := 'ERR:' || sqlstate; end;
  insert into results values ('real', 'truncate is refused', 'ERR:42501', r);
end $$;

-- 5. dismissing
insert into results values ('real', 'another clinician cannot dismiss it', 'ERR:42501',
  pg_temp.sql_as(pg_temp.f('doc2'), format($q$select public.dismiss_live_prompt((select id from public.live_prompts where encounter_id = %L and phrase_matched = 'chest pain'))$q$, pg_temp.f('e1'))));
insert into results values ('real', 'another clinician cannot dismiss it, and the prompt is still showing', 'true',
  (select (dismissed_at is null)::text from public.live_prompts where encounter_id = pg_temp.f('e1') and phrase_matched = 'chest pain'));
insert into results values ('real', 'the patient cannot dismiss it', 'ERR:42501',
  pg_temp.sql_as(pg_temp.f('pat'), format($q$select public.dismiss_live_prompt((select id from public.live_prompts where encounter_id = %L and phrase_matched = 'chest pain'))$q$, pg_temp.f('e1'))));
insert into results values ('real', 'anon cannot dismiss it', 'ERR:42501',
  pg_temp.sql_anon(format($q$select public.dismiss_live_prompt((select id from public.live_prompts where encounter_id = %L and phrase_matched = 'chest pain'))$q$, pg_temp.f('e1'))));
-- switch the guard OFF again: a prompt must still be dismissible
do $$
begin
  insert into public.go_live_guard_log (guard_key, action, actor_id, actor_role, note)
    values ('live_redflag_prompts_enabled', 'switched_off', pg_temp.f('admin'), 'cmo', 'proof only, rolled back');
  update public.go_live_guards set is_on = false, changed_at = now(), changed_by = pg_temp.f('admin'), change_note = 'proof only, rolled back'
   where key = 'live_redflag_prompts_enabled';
end $$;
insert into results values ('real', 'guard off again: recording is refused', 'ERR:P0001',
  pg_temp.sql_as(pg_temp.f('doc'), format($q$select public.record_live_prompt(%L, 'stroke')$q$, pg_temp.f('e1'))));
insert into results values ('real', 'guard off: the clinician can still dismiss', 'ok',
  pg_temp.sql_as(pg_temp.f('doc'), format($q$select public.dismiss_live_prompt((select id from public.live_prompts where encounter_id = %L and phrase_matched = 'chest pain'))$q$, pg_temp.f('e1'))));
insert into results values ('real', 'the dismissal is attributed and timed', 'true',
  (select (dismissed_at is not null and dismissed_by = pg_temp.f('doc'))::text from public.live_prompts where encounter_id = pg_temp.f('e1') and phrase_matched = 'chest pain'));
insert into results values ('real', 'the dismissal was audited', '1',
  (select count(*)::text from public.audit_log where action = 'live_prompt.dismissed' and actor_id = pg_temp.f('doc')));
insert into results values ('real', 'dismissing again does nothing and adds no second audit row', 'true',
  (pg_temp.sql_as(pg_temp.f('doc'), format($q$select public.dismiss_live_prompt((select id from public.live_prompts where encounter_id = %L and phrase_matched = 'chest pain'))$q$, pg_temp.f('e1'))) = 'ok'
   and (select count(*) from public.audit_log where action = 'live_prompt.dismissed' and actor_id = pg_temp.f('doc')) = 1)::text);
insert into results values ('real', 'a dismissed prompt cannot be edited back to showing, even with the flag', 'ERR:42501',
  pg_temp.flagged(format($q$update public.live_prompts set dismissed_at = null, dismissed_by = null where encounter_id = %L and phrase_matched = 'chest pain'$q$, pg_temp.f('e1'))));

-- guard back on for the sabotage phase: after a dismissal the same phrase can be shown again (the unique index covers undismissed rows only)
do $$
begin
  insert into public.go_live_guard_log (guard_key, action, actor_id, actor_role, note)
    values ('live_redflag_prompts_enabled', 'switched_on', pg_temp.f('admin'), 'cmo', 'proof only, rolled back');
  update public.go_live_guards set is_on = true, changed_at = now(), changed_by = pg_temp.f('admin'), change_note = 'proof only, rolled back'
   where key = 'live_redflag_prompts_enabled';
end $$;
insert into results values ('real', 'after a dismissal the same phrase can be shown again', 'ok',
  pg_temp.sql_as(pg_temp.f('doc'), format($q$select public.record_live_prompt(%L, 'chest pain')$q$, pg_temp.f('e1'))));
insert into results values ('real', 'it is a new row, so two rows exist for the phrase (one dismissed, one showing)', '2',
  (select count(*)::text from public.live_prompts where encounter_id = pg_temp.f('e1') and phrase_matched = 'chest pain'));
-- consent withdrawn mid-consultation stops further prompts
update public.consultation_scribe_consents set granted = false where encounter_id = pg_temp.f('e1');
insert into results values ('real', 'consent withdrawn: a further prompt is refused', 'ERR:42501',
  pg_temp.sql_as(pg_temp.f('doc'), format($q$select public.record_live_prompt(%L, 'seizure')$q$, pg_temp.f('e1'))));
update public.consultation_scribe_consents set granted = true where encounter_id = pg_temp.f('e1');

-- function privileges
insert into results values ('real', 'anon has no execute on either function', 'false',
  (has_function_privilege('anon', 'public.record_live_prompt(uuid,text,text,integer)', 'EXECUTE')
   or has_function_privilege('anon', 'public.dismiss_live_prompt(uuid)', 'EXECUTE'))::text);

-- SABOTAGE (a): the guard check removed. With the guard off a real patient's consultation now records a prompt.
do $$
declare v_orig text; v_def text; v_r text;
begin
  insert into public.go_live_guard_log (guard_key, action, actor_id, actor_role, note)
    values ('live_redflag_prompts_enabled', 'switched_off', pg_temp.f('admin'), 'cmo', 'proof only, rolled back');
  update public.go_live_guards set is_on = false, changed_at = now(), changed_by = pg_temp.f('admin'), change_note = 'proof only, rolled back'
   where key = 'live_redflag_prompts_enabled';
  v_orig := pg_get_functiondef('public.record_live_prompt(uuid,text,text,integer)'::regprocedure);
  v_def := replace(v_orig, 'if not private.go_live_open(''live_redflag_prompts_enabled'', e.patient_id, e.clinician_id) then', 'if false then');
  if v_def = v_orig then raise exception 'SABOTAGE (a) not applied'; end if;
  execute v_def;
  v_r := pg_temp.sql_as(pg_temp.f('doc'), format($q$select public.record_live_prompt(%L, 'overdose')$q$, pg_temp.f('e1')));
  insert into results values ('sabotaged', 'guard off, real patient: refused (P0001)', 'ERR:P0001', v_r);
  execute v_orig;
end $$;

-- SABOTAGE (b): the consent check removed. A consultation with no consent row now records a prompt.
do $$
declare v_orig text; v_def text; v_r text;
begin
  insert into public.go_live_guard_log (guard_key, action, actor_id, actor_role, note)
    values ('live_redflag_prompts_enabled', 'switched_on', pg_temp.f('admin'), 'cmo', 'proof only, rolled back');
  update public.go_live_guards set is_on = true, changed_at = now(), changed_by = pg_temp.f('admin'), change_note = 'proof only, rolled back'
   where key = 'live_redflag_prompts_enabled';
  v_orig := pg_get_functiondef('public.record_live_prompt(uuid,text,text,integer)'::regprocedure);
  v_def := replace(v_orig, 'if not public.scribe_may_start(p_encounter) then', 'if false then');
  if v_def = v_orig then raise exception 'SABOTAGE (b) not applied'; end if;
  execute v_def;
  v_r := pg_temp.sql_as(pg_temp.f('doc'), format($q$select public.record_live_prompt(%L, 'overdose')$q$, pg_temp.f('e2')));
  insert into results values ('sabotaged', 'no consent row: refused', 'ERR:42501', v_r);
  execute v_orig;
end $$;

-- SABOTAGE (c): the read policy opened to everyone. The patient now reads the prompts.
do $$
begin
  alter policy live_prompts_read on public.live_prompts using (true);
  insert into results values ('sabotaged', 'the patient reads nothing', '0',
    pg_temp.val_as(pg_temp.f('pat'), format($q$select count(*)::text from public.live_prompts where encounter_id = %L$q$, pg_temp.f('e1'))));
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S77 live prompts proof FAILED: %', (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected is distinct from actual;
  if v_caught < 3 then raise exception 'VACUOUS TEST: only % of 3 sabotages flipped a check', v_caught; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result from results where phase = 'real' order by check_name;
rollback;
