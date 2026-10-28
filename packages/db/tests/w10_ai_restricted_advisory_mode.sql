-- W-10 proof: AI-001 restricted mode, CMO risk acceptance, 30 day automatic switch-off (migration *_w10_ai_restricted_advisory_mode.sql).
-- NOT EXECUTED LOCALLY when written (Docker was down); the CI replay is its first run. Nothing is signed or restricted for real: it all rolls back.
--   1. The migration restricts nothing; ai_runtime_config keeps every prior key and adds restricted_mode.
--   2. CMO or admin may lift or re-apply; each transition is audit-logged (old, new, actor), counted and notified (in-app and email, no sms).
--   3. Acceptance: CMO only, the 90 day cap and the 30 day no-re-run cap with their own reasons, a link to a re-evaluation run or the flag.
--   4. The sweep sends the 14, 7 and 2 day notices once each, then switches off with the kill switch's effects (suspended, audit row, notices).
--   5. A valid acceptance keeps the system on; an acceptance cannot be edited.
--   6. SABOTAGE: the acceptance test in the sweep, the CMO check, the cap and the transition counter each removed; each check must flip.
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
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
  begin execute p_sql; r := 'ok'; exception when others then r := sqlstate; end;
  reset role;
  return r;
end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'w10-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'W10 ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone;
  return v;
end $f$;
create function pg_temp.mkdoc(p_org uuid, p_label text, p_tier text, p_admin uuid) returns uuid
language plpgsql as $f$
declare v uuid;
begin
  v := pg_temp.mkuser(p_org, p_label, 'clinician');
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
  values (p_org, v, 'W10 ' || p_label, 'MDCN', 'W01-' || p_label || '-' || substr(v::text, 1, 8), true, 'active', now(), p_admin,
      p_tier::public.doctor_tier, 'contracted', 2, true, p_admin, true);
  return v;
end $f$;

create function pg_temp.msg_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql into r; r := 'ok'; exception when others then r := sqlerrm; end;
  perform pg_temp.back();
  return r;
end $f$;

-- 0. Fixtures ----------------------------------------------------------------------------------------------------------
do $$
declare v_org uuid; v_admin uuid; v_doc uuid; v_cmo uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  update public.clinical_staff set active = false where is_test is not true;
  v_doc := pg_temp.mkdoc(v_org, 'doc', 'senior_medical_officer', v_admin);
  v_cmo := pg_temp.mkdoc(v_org, 'cmo', 'chief_medical_officer', v_admin);
  perform pg_temp.setf('org', v_org); perform pg_temp.setf('doc', v_doc); perform pg_temp.setf('cmo', v_cmo); perform pg_temp.setf('admin', v_admin);
end $$;

-- 1. Nothing is restricted by the migration; every prior runtime key is kept -----------------------------------------------
do $$
declare k text; v_cfg jsonb := public.ai_runtime_config('AI-001'); v_missing text := '';
begin
  insert into results values ('real', 'no system is restricted after the migration', '0', (select count(*)::text from public.ai_systems where restricted_mode <> 'none'));
  insert into results values ('real', 'ai_runtime_config reports restricted_mode none for AI-001', 'none', v_cfg->>'restricted_mode');
  foreach k in array array['registered','system_code','system_id','name','enabled','runtime_governed','lifecycle_status','risk_class','autonomy_level',
                           'clinically_meaningful','fallback_behaviour','disabled_reason','expected_model_identifier','prompt','guardrails','knowledge_sources'] loop
    if not (v_cfg ? k) then v_missing := v_missing || k || ' '; end if;
  end loop;
  insert into results values ('real', 'every key the runtime config had before is still there', '', v_missing);
  insert into results values ('real', 'the cap constants are 90 and 30', '90/30', private.ai_acceptance_max_days() || '/' || private.ai_acceptance_no_rerun_days());
end $$;

-- 2. Lift and re-apply: logged, counted, notified, for the CMO and for an admin ---------------------------------------------
do $$
declare r text; v_audit0 integer; v_resets0 integer;
begin
  select restriction_resets into v_resets0 from public.ai_systems where system_code = 'AI-001';
  select count(*) into v_audit0 from public.audit_log where action = 'ai.restricted_mode_set';
  r := pg_temp.q_as(pg_temp.f('doc'), $q$select public.set_ai_restricted_mode('AI-001', 'advisory_only', 'Restricted per D-08 proof')::text$q$);
  insert into results values ('real', 'a doctor who is not the CMO or an admin cannot restrict', 'ERR:42501', r);
  r := pg_temp.q_as(pg_temp.f('cmo'), $q$select public.set_ai_restricted_mode('AI-001', 'advisory_only', 'short')::text$q$);
  insert into results values ('real', 'a reason under 10 characters is refused', 'ERR:22023', r);
  r := pg_temp.q_as(pg_temp.f('cmo'), $q$select public.set_ai_restricted_mode('AI-001', 'advisory_only', 'Restricted per D-08 proof')::text$q$);
  insert into results values ('real', 'the CMO restricts AI-001', 'true', (r !~ '^ERR')::text);
  insert into results values ('real', 'the re-evaluation date is 30 days out', '30',
    (select (reevaluation_due - current_date)::text from public.ai_systems where system_code = 'AI-001'));
  insert into results values ('real', 'ai_runtime_config now reports advisory_only', 'advisory_only', public.ai_runtime_config('AI-001')->>'restricted_mode');

  -- an admin lifts it: allowed, and every transition is logged with old and new state and the actor
  r := pg_temp.q_as(pg_temp.f('admin'), $q$select public.set_ai_restricted_mode('AI-001', 'none', 'Lifted by admin in proof')::text$q$);
  insert into results values ('real', 'an admin may lift the restriction', 'true', (r !~ '^ERR')::text);
  r := pg_temp.q_as(pg_temp.f('admin'), $q$select public.set_ai_restricted_mode('AI-001', 'none', 'Lifted again in proof')::text$q$);
  insert into results values ('real', 'lifting when already lifted is refused', 'ERR:P0002', r);
  r := pg_temp.q_as(pg_temp.f('admin'), $q$select public.set_ai_restricted_mode('AI-001', 'advisory_only', 'Re-applied by admin in proof')::text$q$);
  insert into results values ('real', 'an admin may re-apply the restriction (second set)', 'true', (r !~ '^ERR')::text);

  insert into results values ('real', 'three transitions were counted', '3', ((select restriction_resets from public.ai_systems where system_code = 'AI-001') - v_resets0)::text);
  insert into results values ('real', 'three transitions were audit-logged', '3', ((select count(*) from public.audit_log where action = 'ai.restricted_mode_set') - v_audit0)::text);
  insert into results values ('real', 'every audit row holds old and new state and the actor', 'true',
    (select bool_and(event ? 'old' and event ? 'new' and (event->>'actor') = actor_id::text)::text from public.audit_log where action = 'ai.restricted_mode_set'));
  insert into results values ('real', 'the CMO was notified in-app and by email for each transition (never sms)', '6/0',
    (select count(*) filter (where channel = 'in_app') + count(*) filter (where channel = 'email') || '/' || count(*) filter (where channel = 'sms')
       from public.notifications where template = 'ai_restriction_notice' and recipient_id = pg_temp.f('cmo') and (payload->>'kind') = 'mode_changed'));
  r := pg_temp.try_anon($q$select public.set_ai_restricted_mode('AI-001', 'none', 'anon should fail here')$q$);
  insert into results values ('real', 'anon is refused', '42501', r);
end $$;

-- 3. Acceptance: cap, link to a re-evaluation, CMO only --------------------------------------------------------------------
do $$
declare r text;
begin
  r := pg_temp.q_as(pg_temp.f('doc'), format($q$select public.sign_ai_risk_acceptance('AI-001', 'Over-triage in two required suites is accepted.', %L, null, true)::text$q$, (current_date + 20)::text));
  insert into results values ('real', 'only the CMO can sign an acceptance', 'ERR:42501', r);
  r := pg_temp.q_as(pg_temp.f('admin'), format($q$select public.sign_ai_risk_acceptance('AI-001', 'Over-triage in two required suites is accepted.', %L, null, true)::text$q$, (current_date + 20)::text));
  insert into results values ('real', 'an admin cannot sign an acceptance either', 'ERR:42501', r);
  r := pg_temp.msg_as(pg_temp.f('cmo'), format($q$select public.sign_ai_risk_acceptance('AI-001', 'Over-triage in two required suites is accepted.', %L, null, true)::text$q$, (current_date + 91)::text));
  insert into results values ('real', 'more than 90 days is refused with the cap reason', 'true', (r like 'acceptance_too_long:%90 days%')::text);
  r := pg_temp.msg_as(pg_temp.f('cmo'), format($q$select public.sign_ai_risk_acceptance('AI-001', 'Over-triage in two required suites is accepted.', %L, null, true)::text$q$, (current_date + 31)::text));
  insert into results values ('real', 'more than 30 days with no re-run is refused with its own reason', 'true', (r like 'acceptance_too_long_without_rerun:%30 days%')::text);
  r := pg_temp.msg_as(pg_temp.f('cmo'), format($q$select public.sign_ai_risk_acceptance('AI-001', 'Over-triage in two required suites is accepted.', %L, null, false)::text$q$, (current_date + 10)::text));
  insert into results values ('real', 'neither a run nor the no-re-run flag is refused', 'true', (r like 'acceptance_needs_rerun_link:%')::text);
  r := pg_temp.msg_as(pg_temp.f('cmo'), format($q$select public.sign_ai_risk_acceptance('AI-001', 'Over-triage in two required suites is accepted.', %L, gen_random_uuid(), false)::text$q$, (current_date + 10)::text));
  insert into results values ('real', 'a run that does not exist is refused', 'true', (r like 'acceptance_run_not_found:%')::text);
  r := pg_temp.msg_as(pg_temp.f('cmo'), format($q$select public.sign_ai_risk_acceptance('AI-001', 'Over-triage in two required suites is accepted.', %L, null, true)::text$q$, (current_date - 1)::text));
  insert into results values ('real', 'a date in the past is refused', 'true', (r like 'acceptance_date_not_future:%')::text);
  r := pg_temp.q_as(pg_temp.f('cmo'), format($q$select public.ai_restriction_status('AI-001')->>'can_sign'$q$));
  insert into results values ('real', 'the status tells the CMO they can sign', 'true', r);
  r := pg_temp.q_as(pg_temp.f('admin'), format($q$select public.ai_restriction_status('AI-001')->>'can_sign'$q$));
  insert into results values ('real', 'the status tells an admin they cannot sign', 'false', r);
  r := pg_temp.q_as(pg_temp.f('doc'), $q$select (public.ai_restriction_status('AI-001'))::text$q$);
  insert into results values ('real', 'a doctor cannot read the status', 'ERR:42501', r);
end $$;

-- 4. The sweep: notices once each, then the switch-off with kill-switch effects ------------------------------------------------
do $$
declare v_n integer; v_c0 integer; v_a0 integer; r text;
begin
  -- 13 days left: the 14-day notice goes once, the sweep run twice does not repeat it
  update public.ai_systems set restricted_since = now() - interval '17 days' where system_code = 'AI-001';
  v_n := private.sweep_ai_restriction_expiry();
  v_n := private.sweep_ai_restriction_expiry();
  insert into results values ('real', 'the 14 day notice is sent once even if the sweep runs twice', '2',
    (select count(*)::text from public.notifications where template = 'ai_restriction_notice' and recipient_id = pg_temp.f('cmo') and payload->>'kind' = 'days_14'));
  update public.ai_systems set restricted_since = now() - interval '24 days' where system_code = 'AI-001';
  v_n := private.sweep_ai_restriction_expiry();
  insert into results values ('real', 'the 7 day notice is sent', '2',
    (select count(*)::text from public.notifications where template = 'ai_restriction_notice' and recipient_id = pg_temp.f('cmo') and payload->>'kind' = 'days_7'));
  update public.ai_systems set restricted_since = now() - interval '28 days' where system_code = 'AI-001';
  v_n := private.sweep_ai_restriction_expiry();
  insert into results values ('real', 'the 2 day notice is sent', '2',
    (select count(*)::text from public.notifications where template = 'ai_restriction_notice' and recipient_id = pg_temp.f('cmo') and payload->>'kind' = 'days_2'));
  insert into results values ('real', 'the system is still on while days remain', 'true', (select is_enabled::text from public.ai_systems where system_code = 'AI-001'));

  -- 31 days on, no acceptance: switched off with the kill switch's effects
  update public.ai_systems set restricted_since = now() - interval '31 days' where system_code = 'AI-001';
  select count(*) into v_a0 from public.audit_log where action = 'ai_system.disabled';
  v_n := private.sweep_ai_restriction_expiry();
  v_n := private.sweep_ai_restriction_expiry();
  insert into results values ('real', 'after 30 days with no acceptance the system is switched off', 'false', (select is_enabled::text from public.ai_systems where system_code = 'AI-001'));
  insert into results values ('real', 'the lifecycle is suspended, disabled_by is null (the system acted) and a reason is recorded', 'suspended/true/true',
    (select lifecycle_status::text || '/' || (disabled_by is null)::text || '/' || (disabled_reason like '%W-10%')::text from public.ai_systems where system_code = 'AI-001'));
  insert into results values ('real', 'the same audit action as the kill switch is written once', '1',
    ((select count(*) from public.audit_log where action = 'ai_system.disabled') - v_a0)::text);
  insert into results values ('real', 'a private.log_audit row for the expiry exists', '1',
    (select count(*)::text from public.audit_log where action = 'ai.restriction_expired'));
  insert into results values ('real', 'the CMO and the admin are told it was switched off, once', '1/1',
    (select count(*) filter (where recipient_id = pg_temp.f('cmo')) || '/' || count(*) filter (where recipient_id = pg_temp.f('admin'))
       from public.notifications where template = 'ai_restriction_notice' and channel = 'in_app' and payload->>'kind' = 'switched_off') );
end $$;

-- 5. A valid acceptance keeps it on ----------------------------------------------------------------------------------------
do $$
declare r text; v_n integer;
begin
  set local session_replication_role = replica;
  update public.ai_systems set is_enabled = true, lifecycle_status = 'live', disabled_at = null, disabled_reason = null, restricted_since = now() - interval '31 days' where system_code = 'AI-001';
  set local session_replication_role = origin;
  r := pg_temp.q_as(pg_temp.f('cmo'), format($q$select public.sign_ai_risk_acceptance('AI-001', 'Over-triage in two required suites is accepted.', %L, null, true)::text$q$, (current_date + 20)::text));
  insert into results values ('real', 'the CMO signs a valid acceptance', 'true', (r !~ '^ERR')::text);
  v_n := private.sweep_ai_restriction_expiry();
  insert into results values ('real', 'with a valid signed acceptance the system stays on', 'true', (select is_enabled::text from public.ai_systems where system_code = 'AI-001'));
  begin
    update public.ai_risk_acceptances set summary = 'edited after signing, should fail';
    insert into results values ('real', 'an acceptance cannot be edited', 'raised', 'no error');
  exception when others then
    insert into results values ('real', 'an acceptance cannot be edited', 'raised', 'raised');
  end;
end $$;

-- 6. SABOTAGE ------------------------------------------------------------------------------------------------------------
do $$
declare v_orig text; v_def text; v_n integer; r text;
begin
  -- (a) the acceptance test removed from the sweep: a system with a valid acceptance is wrongly switched off
  v_orig := pg_get_functiondef('private.sweep_ai_restriction_expiry()'::regprocedure);
  v_def := replace(v_orig, 'a.accepted_at >= x.restricted_since', 'false');
  if v_def = v_orig then raise exception 'SABOTAGE a not applied'; end if;
  execute v_def;
  v_n := private.sweep_ai_restriction_expiry();
  insert into results values ('sabotaged', 'with a valid signed acceptance the system stays on', 'true', (select is_enabled::text from public.ai_systems where system_code = 'AI-001'));

  -- (b) the CMO check removed from signing: a doctor can sign
  v_orig := pg_get_functiondef('public.sign_ai_risk_acceptance(text,text,date,uuid,boolean)'::regprocedure);
  v_def := replace(v_orig, 'if v_uid is null or not private.credential_is_cmo() then', 'if false then');
  if v_def = v_orig then raise exception 'SABOTAGE b not applied'; end if;
  execute v_def;
  r := pg_temp.q_as(pg_temp.f('doc'), format($q$select public.sign_ai_risk_acceptance('AI-001', 'Over-triage in two required suites is accepted.', %L, null, true)::text$q$, (current_date + 20)::text));
  insert into results values ('sabotaged', 'only the CMO can sign an acceptance', 'ERR:42501', case when r like 'ERR:%' then r else 'ERR:none' end);

  -- (c) the cap removed from signing: 120 days is wrongly accepted by the function (the table check still stops it, so look for the function's own reason)
  v_orig := pg_get_functiondef('public.sign_ai_risk_acceptance(text,text,date,uuid,boolean)'::regprocedure);
  v_def := replace(v_orig, 'if p_valid_until > current_date + v_max then', 'if false then');
  if v_def = v_orig then raise exception 'SABOTAGE c not applied'; end if;
  execute v_def;
  r := pg_temp.msg_as(pg_temp.f('cmo'), format($q$select public.sign_ai_risk_acceptance('AI-001', 'Over-triage in two required suites is accepted.', %L, null, true)::text$q$, (current_date + 91)::text));
  insert into results values ('sabotaged', 'more than 90 days is refused with the cap reason', 'true', (r like 'acceptance_too_long:%')::text);

  -- (d) the transition counter removed from set_ai_restricted_mode: resets stop counting
  v_orig := pg_get_functiondef('public.set_ai_restricted_mode(text,text,text)'::regprocedure);
  v_def := replace(v_orig, 'restriction_resets = restriction_resets + 1', 'restriction_resets = restriction_resets');
  if v_def = v_orig then raise exception 'SABOTAGE d not applied'; end if;
  execute v_def;
  r := (select restriction_resets::text from public.ai_systems where system_code = 'AI-001');
  perform pg_temp.q_as(pg_temp.f('cmo'), $q$select public.set_ai_restricted_mode('AI-001', 'none', 'Lifted in the sabotage step')::text$q$);
  insert into results values ('sabotaged', 'a transition is counted', (r::integer + 1)::text, (select restriction_resets::text from public.ai_systems where system_code = 'AI-001'));
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'W10 proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ')
         from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 4 then
    raise exception 'VACUOUS TEST: the sabotage flipped % of 4 checks (%)', v_caught,
      (select string_agg(check_name || ' => ' || actual, '; ') from results where phase = 'sabotaged');
  end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;

rollback;
