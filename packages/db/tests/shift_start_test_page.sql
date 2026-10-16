-- Shift-start test page proof (migration *_shift_start_test_page.sql).
--
-- One rolled-back transaction. Every behaviour has a control; the last section SABOTAGES the build and each removal must flip its check:
--   1. Rollout     the guard ships OFF, config v1 is the seeded PROPOSED row, the new objects are locked down, no new cron job, the page_tests
--                  kind allows shift_start.
--   2. Off         with the guard off nothing is sent, and a shift with no test page is never a gap.
--   3. Send        on: primary AND backup of a shift starting soon each get ONE test page by push, in-app and email (never sms or voice), the
--                  fixed template, no patient data; a second sweep sends no more; far, past and cancelled shifts get none.
--   4. Grace       within the grace window an unacknowledged shift is NOT a gap; acknowledging needs the page to have been shown; only the
--                  addressed clinician can acknowledge; the acknowledgement records channel, device and both latencies.
--   5. Not covered after the deadline an unacknowledged shift IS a gap (rota_gaps), reviewers (admin and CMO) are told once, the backup is
--                  told when it is promoted, and there is still exactly ONE open rota gap incident (no second alert); a late acknowledgement
--                  clears the gap and resolves the incident.
--   6. Paging      page_recipient promotes a confirmed backup when the primary missed the test; when nobody is confirmed, or the guard is
--                  off, the old order stands (a red event is never made worse).
--   7. Screen      the clinician's own read shows undelivered with the right flag; reviewers see the team; a colleague sees nothing of it.
--   8. SABOTAGE    the gap kind, the promotion, the acknowledgement sync and the sweep are each removed and the matching check must flip.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;

create function pg_temp.rec(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('real', p_name, p_expected, p_actual) $$;
create function pg_temp.sab(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('sabotaged', p_name, p_expected, p_actual) $$;
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
$f$ begin reset role; perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.role', '', true); perform set_config('request.jwt.claim.sub', '', true); end $f$;
create function pg_temp.try(p_sql text) returns text language plpgsql as
$f$ begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $f$;
create function pg_temp.msg(p_sql text) returns text language plpgsql as
$f$ begin execute p_sql; return 'ok'; exception when others then return sqlerrm; end $f$;
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
  return coalesce(r, 'null');
end $f$;
create function pg_temp.q(p_sql text) returns text language plpgsql as
$f$ declare r text; begin execute p_sql into r; return coalesce(r, 'null'); end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text, p_test boolean default true) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's20c-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test, language)
  values (v, p_org, p_role::public.user_role, 'S20c ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, p_test, 'en')
  on conflict (id) do update set role = excluded.role, is_test = p_test, is_active = true, phone = excluded.phone;
  if p_role = 'patient' then
    insert into public.patient_memberships (organisation_id, patient_id, source, state, is_test) values (p_org, v, 'purchase', 'active', p_test);
  end if;
  return v;
end $f$;
create function pg_temp.mkdoc(p_org uuid, p_admin uuid, p_label text, p_tier text, p_comps text[]) returns uuid
language plpgsql as $f$
declare v uuid := pg_temp.mkuser(p_org, p_label, 'clinician'); s uuid; c text;
begin
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
  values (p_org, v, 'S20c ' || p_label, 'MDCN', 'S20c-' || p_label || '-' || substr(v::text, 1, 8), true, 'active', now(), p_admin,
      p_tier::public.doctor_tier, case when p_tier = 'chief_medical_officer' then 'contracted' else 'employed' end::public.staff_employment_type, 2,
      p_tier = 'chief_medical_officer', case when p_tier = 'chief_medical_officer' then p_admin end, true)
  returning id into s;
  foreach c in array p_comps loop
    insert into public.clinician_competencies (organisation_id, clinical_staff_id, competency_code, granted_by, is_test) values (p_org, s, c, p_admin, true);
  end loop;
  insert into public.on_call_readiness (clinician_id, checklist_version, organisation_id, items, is_test) values (v, private.readiness_version(), p_org, private.readiness_items(), true);
  insert into public.availability_blocks (organisation_id, clinician_id, starts_at, ends_at, kind, is_test)
  values (p_org, v, now() - interval '1 minute', now() + interval '2 hours', 'queue', true);
  return v;
end $f$;
create function pg_temp.guard_on(p_key text, p_on boolean) returns void language plpgsql as
$f$ begin
  alter table public.go_live_guards disable trigger go_live_guards_guard;
  update public.go_live_guards set is_on = p_on, changed_at = case when p_on then now() end, changed_by = case when p_on then pg_temp.f('admin') end, change_note = case when p_on then 'proof fixture' end where key = p_key;
  alter table public.go_live_guards enable trigger go_live_guards_guard;
end $f$;
create function pg_temp.rota_row(p_org uuid, p_from timestamptz, p_to timestamptz, p_primary uuid, p_backup uuid) returns uuid language plpgsql as
$f$ declare v uuid;
begin
  perform set_config('tarragon.lead_write', 'on', true);
  insert into public.on_call_rota (organisation_id, starts_at, ends_at, primary_clinician_id, backup_clinician_id, built_by, is_test)
  values (p_org, p_from, p_to, p_primary, p_backup, pg_temp.f('admin'), true) returning id into v;
  perform set_config('tarragon.lead_write', 'off', true);
  return v;
end $f$;
create function pg_temp.clear_rota() returns void language plpgsql as
$f$ begin
  perform set_config('tarragon.lead_write', 'on', true);
  update public.on_call_rota set cancelled_at = now(), cancelled_reason = 'proof' where cancelled_at is null;
  perform set_config('tarragon.lead_write', 'off', true);
end $f$;


-- scenario helpers ------------------------------------------------------------------------------------------------------------
-- receipt (the screen showed the test page) then the acknowledgement, both as the clinician; returns the acknowledgement's outcome
create function pg_temp.ack(p_uid uuid, p_test uuid) returns text language plpgsql as
$f$ begin
  perform pg_temp.try_as(p_uid, format('select public.record_page_delivered(%L, ''in_app'', ''dev-shift-%s'')', p_test, substr(p_uid::text, 1, 8)));
  return pg_temp.try_as(p_uid, format('select public.acknowledge_test_page(%L)', p_test));
end $f$;
create function pg_temp.test_of(p_rota uuid, p_role text) returns uuid language sql as
$$ select page_test_id from public.shift_start_tests where rota_id = p_rota and role = p_role $$;
create function pg_temp.expire(p_rota uuid, p_role text) returns void language plpgsql as
$f$ begin
  perform set_config('tarragon.paging_write', 'on', true);
  update public.shift_start_tests set deadline_at = now() - interval '1 minute' where rota_id = p_rota and role = p_role;
  perform set_config('tarragon.paging_write', 'off', true);
end $f$;
create function pg_temp.age(p_rota uuid, p_role text, p_secs integer) returns void language plpgsql as
$f$ begin
  perform set_config('tarragon.paging_write', 'on', true);
  update public.shift_start_tests set sent_at = now() - make_interval(secs => p_secs) where rota_id = p_rota and role = p_role;
  perform set_config('tarragon.paging_write', 'off', true);
end $f$;
-- the unconfirmed-kind gaps of the organisation right now ('' when none)
create function pg_temp.gapk(p_org uuid) returns text language sql as
$$ select coalesce(string_agg(distinct kind, ','), '') from private.rota_gaps(p_org, now() - interval '1 hour', now() + interval '12 hours')
    where kind in ('primary_unconfirmed', 'backup_unconfirmed', 'start_test_failed') $$;
create function pg_temp.open_incidents(p_org uuid) returns integer language sql as
$$ select count(*)::integer from public.ops_incidents where external_reference = 'rota_gap:' || p_org and status not in ('resolved', 'closed') $$;
-- a CURRENT shift (started a minute ago, so the sweep still sends), swept, then acknowledged / expired as asked, then swept again
create function pg_temp.scenario(p_org uuid, p_primary uuid, p_backup uuid, p_ack_p boolean, p_ack_b boolean, p_exp_p boolean, p_exp_b boolean) returns uuid
language plpgsql as
$f$ declare v_r uuid;
begin
  perform pg_temp.clear_rota();
  v_r := pg_temp.rota_row(p_org, now() - interval '1 minute', now() + interval '10 hours', p_primary, p_backup);
  perform private.shift_start_sweep();
  if p_ack_p then perform pg_temp.ack(p_primary, pg_temp.test_of(v_r, 'primary')); end if;
  if p_ack_b then perform pg_temp.ack(p_backup, pg_temp.test_of(v_r, 'backup')); end if;
  if p_exp_p then perform pg_temp.expire(v_r, 'primary'); end if;
  if p_exp_b then perform pg_temp.expire(v_r, 'backup'); end if;
  perform private.shift_start_sweep();
  return v_r;
end $f$;

-- fixtures ----------------------------------------------------------------------------------------------------------------
do $$
declare v_org uuid; v_admin uuid; v_cmo uuid; v_a uuid; v_b uuid; v_c uuid; v_d uuid; v_e uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  update public.clinical_staff set active = false where is_test is not true;
  v_cmo := pg_temp.mkdoc(v_org, v_admin, 'cmo', 'chief_medical_officer', '{on_call}');
  v_a := pg_temp.mkdoc(v_org, v_admin, 'A', 'senior_medical_officer', '{on_call}');
  v_b := pg_temp.mkdoc(v_org, v_admin, 'B', 'senior_medical_officer', '{on_call}');
  v_c := pg_temp.mkdoc(v_org, v_admin, 'C', 'senior_medical_officer', '{on_call}');
  v_d := pg_temp.mkdoc(v_org, v_admin, 'D', 'senior_medical_officer', '{on_call}');
  v_e := pg_temp.mkdoc(v_org, v_admin, 'E', 'senior_medical_officer', '{on_call}');
  perform pg_temp.setf('org', v_org); perform pg_temp.setf('admin', v_admin); perform pg_temp.setf('cmo', v_cmo);
  perform pg_temp.setf('A', v_a); perform pg_temp.setf('B', v_b); perform pg_temp.setf('C', v_c); perform pg_temp.setf('D', v_d); perform pg_temp.setf('E', v_e);
  -- the live project may carry an open incident for the real organisation; the proof counts only what it causes
  update public.ops_incidents set status = 'resolved', resolved_at = now() where external_reference = 'rota_gap:' || v_org and status not in ('resolved', 'closed');
end $$;

-- 1. Rollout ------------------------------------------------------------------------------------------------------------------
do $$
declare v_org uuid := pg_temp.f('org');
begin
  perform pg_temp.rec('rollout: the guard exists and is born OFF', 'true,false',
    (exists (select 1 from public.go_live_guards where key = 'shift_start_test'))::text || ',' || (select is_on::text from public.go_live_guards where key = 'shift_start_test'));
  perform pg_temp.rec('rollout: config v1 is active with the seeded values', '10,15,5,3,20,30',
    (select (rules ->> 'lead_minutes') || ',' || (rules ->> 'grace_minutes') || ',' || (rules ->> 'undelivered_after_minutes') || ',' || (rules ->> 'late_send_minutes') || ',' || (rules ->> 'max_per_run') || ',' || (rules ->> 'proof_lookback_days')
       from public.shift_start_test_config where is_active and version = 1));
  perform pg_temp.rec('rollout: a config with a missing or zero value is refused by the database', '23514',
    pg_temp.try($q$ insert into public.shift_start_test_config (version, is_active, effective_from, rules) values (99, false, current_date, '{"lead_minutes":0}') $q$));
  perform pg_temp.rec('rollout: page_tests accepts the shift_start kind and still refuses an unknown one', 'ok,23514',
    (case when exists (select 1 from pg_constraint where conrelid = 'public.page_tests'::regclass and pg_get_constraintdef(oid) like '%shift_start%') then 'ok' else 'missing' end) || ',' ||
    pg_temp.try($q$ insert into public.page_tests (organisation_id, clinician_id, kind, is_test) select organisation_id, id, 'bogus', true from public.profiles limit 1 $q$));
  perform pg_temp.rec('rollout: nothing is open to anon, the sweep is private, the table cannot be written by a signed-in user', 'false,false,false,false,false',
    has_function_privilege('anon', 'public.my_shift_start_tests()', 'EXECUTE')::text || ',' || has_function_privilege('anon', 'public.shift_start_tests_overview()', 'EXECUTE')::text || ',' ||
    has_function_privilege('authenticated', 'private.shift_start_sweep()', 'EXECUTE')::text || ',' || has_table_privilege('anon', 'public.shift_start_tests', 'SELECT')::text || ',' ||
    has_table_privilege('authenticated', 'public.shift_start_tests', 'INSERT')::text);
  perform pg_temp.rec('rollout: no cron job of its own (the existing one-minute tick calls the sweep)', '0,true',
    (select count(*)::text from cron.job where command like '%shift_start_sweep%') || ',' ||
    (pg_get_functiondef('private.ops_check_rota_gap_12h(jsonb,boolean)'::regprocedure) like '%shift_start_sweep%')::text);
  perform pg_temp.rec('rollout: the go-live conditions know the new key (not the fail-closed unknown_guard)', 'false',
    (private.go_live_conditions('shift_start_test', v_org)::text like '%unknown_guard%')::text);
end $$;

-- 2. Off ------------------------------------------------------------------------------------------------------------------------
do $$
declare v_org uuid := pg_temp.f('org'); v_a uuid := pg_temp.f('A'); v_b uuid := pg_temp.f('B'); v_r uuid;
begin
  perform pg_temp.clear_rota();
  v_r := pg_temp.rota_row(v_org, now() + interval '5 minutes', now() + interval '10 hours', v_a, v_b);
  perform pg_temp.rec('off: the sweep sends nothing and writes nothing', '0,0,0',
    private.shift_start_sweep()::text || ',' || (select count(*)::text from public.shift_start_tests) || ',' || (select count(*)::text from public.page_tests where kind = 'shift_start'));
  perform pg_temp.rec('off: no shift-start gap kind, and page_recipient has no promotion', ',false',
    pg_temp.gapk(v_org) || ',' || private.shift_start_promoted(v_r)::text);
end $$;

-- 3. Send ------------------------------------------------------------------------------------------------------------------------
do $$
declare v_org uuid := pg_temp.f('org'); v_a uuid := pg_temp.f('A'); v_b uuid := pg_temp.f('B'); v_c uuid := pg_temp.f('C'); v_d uuid := pg_temp.f('D');
  v_r uuid; v_far uuid; v_past uuid; v_cancel uuid; v_n integer;
begin
  perform pg_temp.guard_on('shift_start_test', true);
  perform pg_temp.clear_rota();
  v_r := pg_temp.rota_row(v_org, now() + interval '5 minutes', now() + interval '10 hours', v_a, v_b);
  v_far := pg_temp.rota_row(v_org, now() + interval '2 hours', now() + interval '8 hours', v_c, v_d);
  v_past := pg_temp.rota_row(v_org, now() - interval '30 minutes', now() + interval '3 hours', v_c, v_d);
  v_cancel := pg_temp.rota_row(v_org, now() + interval '4 minutes', now() + interval '9 hours', v_c, v_d);
  perform set_config('tarragon.lead_write', 'on', true);
  update public.on_call_rota set cancelled_at = now(), cancelled_reason = 'proof' where id = v_cancel;
  update public.on_call_rota set cancelled_at = now(), cancelled_reason = 'proof' where id = v_past;   -- past shifts: kept out of the way of rota checks
  perform set_config('tarragon.lead_write', 'off', true);
  v_n := private.shift_start_sweep();
  perform pg_temp.setf('r1', v_r);
  perform pg_temp.rec('send: the primary and the backup of the shift starting in 5 minutes each get one test page; far and cancelled shifts get none', '2,1,1,0',
    v_n::text || ',' || (select count(*)::text from public.shift_start_tests where rota_id = v_r and role = 'primary') || ',' ||
    (select count(*)::text from public.shift_start_tests where rota_id = v_r and role = 'backup') || ',' ||
    (select count(*)::text from public.shift_start_tests where rota_id in (v_far, v_cancel)));
  perform pg_temp.rec('send: it goes by push, in-app and email, three rows each, critical, and never sms or voice', '3,3,0,critical',
    (select count(*)::text from public.notifications where source_table = 'page_tests' and recipient_id = v_a and source_id = pg_temp.test_of(v_r, 'primary') and channel::text in ('push', 'in_app', 'email')) || ',' ||
    (select count(*)::text from public.notifications where source_table = 'page_tests' and recipient_id = v_b and source_id = pg_temp.test_of(v_r, 'backup') and channel::text in ('push', 'in_app', 'email')) || ',' ||
    (select count(*)::text from public.notifications where source_table = 'page_tests' and channel::text in ('sms', 'voice')) || ',' ||
    (select distinct priority::text from public.notifications where source_table = 'page_tests' and source_id = pg_temp.test_of(v_r, 'primary')));
  perform pg_temp.rec('send: the fixed test template, with nothing but the page id in the payload (no patient, no reading)', 'on_call_test_page,page_id',
    (select distinct template from public.notifications where source_id = pg_temp.test_of(v_r, 'primary')) || ',' ||
    (select string_agg(distinct k, ',') from public.notifications n, jsonb_object_keys(n.payload) k where n.source_id = pg_temp.test_of(v_r, 'primary')));
  perform pg_temp.rec('send: sms or voice for a shift-start test page is refused by the existing trigger', '23514',
    pg_temp.try(format($q$ insert into public.notifications (recipient_id, organisation_id, channel, template, payload, status, content_class, priority, source_table, source_id)
      values (%L, %L, 'sms', 'on_call_test_page', '{}', 'pending', 'non_clinical', 'critical', 'page_tests', %L) $q$, v_a, v_org, pg_temp.test_of(v_r, 'primary'))));
  perform pg_temp.rec('send: a second sweep sends no more', '0', private.shift_start_sweep()::text);
  perform pg_temp.rec('send: the record names the page test, the shift start, the deadline (start + grace) and the config version', 'true,true,1,shift_start',
    (select (abs(extract(epoch from (deadline_at - (shift_starts_at + interval '15 minutes')))) < 2)::text from public.shift_start_tests where rota_id = v_r and role = 'primary') || ',' ||
    (select (s.page_test_id = t.id)::text from public.shift_start_tests s join public.page_tests t on t.id = s.page_test_id where s.rota_id = v_r and s.role = 'primary') || ',' ||
    (select config_version::text from public.shift_start_tests where rota_id = v_r and role = 'primary') || ',' ||
    (select t.kind from public.shift_start_tests s join public.page_tests t on t.id = s.page_test_id where s.rota_id = v_r and s.role = 'primary'));
end $$;

-- 4. Grace and acknowledgement -----------------------------------------------------------------------------------------------------
do $$
declare v_org uuid := pg_temp.f('org'); v_a uuid := pg_temp.f('A'); v_b uuid := pg_temp.f('B'); v_c uuid := pg_temp.f('C'); v_r uuid := pg_temp.f('r1');
  v_ta uuid := pg_temp.test_of(pg_temp.f('r1'), 'primary'); v_s record;
begin
  perform pg_temp.rec('grace: inside the grace window an unacknowledged shift is not yet a gap', '', pg_temp.gapk(v_org));
  perform pg_temp.rec('ack: before the page has been shown anywhere, acknowledging is refused', '22023',
    pg_temp.try_as(v_a, format('select public.acknowledge_test_page(%L)', v_ta)));
  perform pg_temp.rec('ack: a colleague cannot acknowledge it', '42501',
    pg_temp.try_as(v_c, format('select public.acknowledge_test_page(%L)', v_ta)));
  perform pg_temp.rec('ack: once shown, the addressed clinician can', 'ok', pg_temp.ack(v_a, v_ta));
  select * into v_s from public.shift_start_tests where rota_id = v_r and role = 'primary';
  perform pg_temp.rec('ack: the record carries the time, the channel, the device and both latencies', 'true,in_app,dev-shift-' || substr(v_a::text, 1, 8) || ',true,true',
    (v_s.acknowledged_at is not null)::text || ',' || coalesce(v_s.ack_channel, 'null') || ',' || coalesce(v_s.ack_device, 'null') || ',' ||
    (v_s.shown_latency_seconds is not null and v_s.shown_latency_seconds >= 0)::text || ',' || (v_s.ack_latency_seconds is not null and v_s.ack_latency_seconds >= 0)::text);
  perform pg_temp.rec('ack: the page test row itself is acknowledged too', 'true',
    (select (acknowledged_at is not null)::text from public.page_tests where id = v_ta));
end $$;

-- 5. Not covered after the deadline ----------------------------------------------------------------------------------------------------
do $$
declare v_org uuid := pg_temp.f('org'); v_a uuid := pg_temp.f('A'); v_b uuid := pg_temp.f('B'); v_admin uuid := pg_temp.f('admin'); v_cmo uuid := pg_temp.f('cmo');
  v_r uuid := pg_temp.f('r1'); v_tb uuid := pg_temp.test_of(pg_temp.f('r1'), 'backup'); n_before integer; v_s record;
begin
  perform pg_temp.expire(v_r, 'backup');
  perform pg_temp.rec('gap: the backup missed the test: the shift is a gap of kind backup_unconfirmed (before the sweep, straight from rota_gaps)', 'backup_unconfirmed', pg_temp.gapk(v_org));
  select count(*) into n_before from public.notifications where template = 'credential_notice' and payload ->> 'subject' = 'On-call start check missed';
  perform private.shift_start_sweep();
  select * into v_s from public.shift_start_tests where rota_id = v_r and role = 'backup';
  perform pg_temp.rec('gap: the sweep marks it escalated and the reviewers told, once', 'true,true', (v_s.escalated_at is not null)::text || ',' || (v_s.cmo_told_at is not null)::text);
  perform pg_temp.rec('gap: the admin and the Chief Medical Officer each got one in-app notice, with no clinical words', '1,1,0',
    (select count(*)::text from public.notifications where template = 'credential_notice' and channel::text = 'in_app' and recipient_id = v_admin and payload ->> 'subject' = 'On-call start check missed') || ',' ||
    (select count(*)::text from public.notifications where template = 'credential_notice' and channel::text = 'in_app' and recipient_id = v_cmo and payload ->> 'subject' = 'On-call start check missed') || ',' ||
    (select count(*)::text from public.notifications where payload ->> 'subject' = 'On-call start check missed' and payload ->> 'message' ~* 'blood|pressure|reading|result|glucose|patient'));
  perform private.shift_start_sweep();
  perform pg_temp.rec('gap: running the sweep again does not tell them again', 'false',
    ((select count(*) from public.notifications where template = 'credential_notice' and payload ->> 'subject' = 'On-call start check missed') > n_before + 2)::text);
  perform pg_temp.rec('gap: there is exactly ONE open rota gap incident for the organisation, and the SR5 rule raises no second alert', '1,0',
    pg_temp.open_incidents(v_org)::text || ',' || (select count(*)::text from public.ops_alerts where rule_code = 'rota_gap_12h' and state = 'open' and dedup_key like v_org::text || '%'));
  perform (select count(*) from private.ops_check_rota_gap_12h('{}'::jsonb, true));
  perform pg_temp.rec('gap: the one-minute tick (ops check) keeps it at one incident', '1', pg_temp.open_incidents(v_org)::text);
  perform pg_temp.rec('gap: the incident names the unconfirmed kind', 'true',
    (select (summary like '%backup_unconfirmed%')::text from public.ops_incidents where external_reference = 'rota_gap:' || v_org and status not in ('resolved', 'closed')));
  perform pg_temp.rec('gap: a late acknowledgement restores cover and closes the one incident', ',0',
    case when pg_temp.ack(v_b, v_tb) = 'ok' then pg_temp.gapk(v_org) || ',' || pg_temp.open_incidents(v_org)::text else 'ack failed' end);
end $$;

-- 6. Paging order ------------------------------------------------------------------------------------------------------------------
do $$
declare v_org uuid := pg_temp.f('org'); v_a uuid := pg_temp.f('A'); v_b uuid := pg_temp.f('B'); v_d uuid := pg_temp.f('D'); v_e uuid := pg_temp.f('E'); v_r uuid;
begin
  -- control: everyone confirmed, nobody missed: the primary is paged first
  v_r := pg_temp.scenario(v_org, v_a, v_b, true, true, false, false);
  perform pg_temp.rec('paging: both confirmed: the primary is first', v_a::text, private.page_recipient(v_org, true, null)::text);
  -- primary missed the test, backup confirmed: the backup is promoted, told, and the gap is primary_unconfirmed
  v_r := pg_temp.scenario(v_org, v_a, v_b, false, true, true, false);
  perform pg_temp.rec('paging: the primary missed it and the backup confirmed: the backup is paged first', v_b::text, private.page_recipient(v_org, true, null)::text);
  perform pg_temp.rec('paging: the shift is reported as primary_unconfirmed', 'primary_unconfirmed', pg_temp.gapk(v_org));
  perform pg_temp.rec('paging: the backup is told it is first on call', '1',
    (select count(*)::text from public.notifications where recipient_id = v_b and template = 'credential_notice' and payload ->> 'subject' = 'You are first on call'));
  -- nobody confirmed: the old order stands, a red event is never made worse
  v_r := pg_temp.scenario(v_org, v_d, v_e, false, false, true, true);
  perform pg_temp.rec('paging: nobody confirmed: the old order stands (primary first)', v_d::text || ',start_test_failed', private.page_recipient(v_org, true, null)::text || ',' || pg_temp.gapk(v_org));
  -- guard off: no effect on either
  perform pg_temp.guard_on('shift_start_test', false);
  perform pg_temp.rec('paging: guard off: no promotion and no gap even with unconfirmed rows', v_d::text || ',', private.page_recipient(v_org, true, null)::text || ',' || pg_temp.gapk(v_org));
  perform pg_temp.guard_on('shift_start_test', true);
end $$;

-- 7. Screen ------------------------------------------------------------------------------------------------------------------------
do $$
declare v_org uuid := pg_temp.f('org'); v_a uuid := pg_temp.f('A'); v_b uuid := pg_temp.f('B'); v_c uuid := pg_temp.f('C'); v_admin uuid := pg_temp.f('admin'); v_r uuid; j text; v_id uuid;
begin
  v_r := pg_temp.scenario(v_org, v_a, v_b, false, false, false, false);
  perform pg_temp.age(v_r, 'primary', 600);
  v_id := (select id from public.shift_start_tests where rota_id = v_r and role = 'primary');
  j := pg_temp.q_as(v_a, format('select e ->> ''role'' || '','' || (e ->> ''undelivered'') || '','' || (e ->> ''state'') from jsonb_array_elements(public.my_shift_start_tests() -> ''tests'') e where e ->> ''id'' = %L', v_id));
  perform pg_temp.rec('screen: a test page nobody saw for 10 minutes is flagged undelivered, state awaiting', 'primary,true,awaiting', j);
  perform pg_temp.try_as(v_a, format('select public.record_page_delivered(%L, ''push'', ''dev-shift-xx12345'')', pg_temp.test_of(v_r, 'primary')));
  j := pg_temp.q_as(v_a, format('select (e ->> ''undelivered'') || '','' || (e ->> ''shown'') from jsonb_array_elements(public.my_shift_start_tests() -> ''tests'') e where e ->> ''id'' = %L', v_id));
  perform pg_temp.rec('screen: once shown it is not undelivered', 'false,true', j);
  perform pg_temp.rec('screen: a reviewer sees the team (both rows), a colleague without review rights is refused', '2,42501',
    pg_temp.q_as(v_admin, format('select count(*)::text from jsonb_array_elements(public.shift_start_tests_overview()) e where e ->> ''rota_id'' = %L', v_r)) || ',' ||
    pg_temp.try_as(v_c, 'select public.shift_start_tests_overview()'));
  perform pg_temp.rec('screen: a colleague cannot read someone else''s rows (row security)', '0',
    pg_temp.q_as(v_c, format('select count(*)::text from public.shift_start_tests where rota_id = %L', v_r)));
  perform pg_temp.rec('screen: the clinician cannot write the table', '42501',
    pg_temp.try_as(v_a, format('update public.shift_start_tests set acknowledged_at = now() where rota_id = %L', v_r)));
end $$;

-- 8. SABOTAGE: each removal must flip the matching check ----------------------------------------------------------------------------
do $$
declare v_org uuid := pg_temp.f('org'); v_a uuid := pg_temp.f('A'); v_b uuid := pg_temp.f('B'); v_c uuid := pg_temp.f('C'); v_r uuid; v_n text;
begin
  -- (a) the rota gap kind removed: the unconfirmed shift stops being a gap
  create or replace function private.shift_start_gap_kind(p_rota uuid) returns text language sql stable as $s$ select null::text $s$;
  v_r := pg_temp.scenario(v_org, v_a, v_b, true, false, false, true);
  perform pg_temp.sab('sabotage: without the gap kind the unconfirmed shift is invisible', 'backup_unconfirmed', pg_temp.gapk(v_org));
  -- (b) the promotion removed: the page still goes to the unconfirmed primary
  create or replace function private.shift_start_promoted(p_rota uuid) returns boolean language sql stable as $s$ select false $s$;
  v_r := pg_temp.scenario(v_org, v_a, v_b, false, true, true, false);
  perform pg_temp.sab('sabotage: without promotion the unconfirmed primary is still paged first', v_b::text, private.page_recipient(v_org, true, null)::text);
  -- (c) the acknowledgement sync removed: the record never learns of the acknowledgement
  drop trigger page_tests_shift_start_ack on public.page_tests;
  v_r := pg_temp.scenario(v_org, v_a, v_b, false, false, false, false);
  perform pg_temp.ack(v_a, pg_temp.test_of(v_r, 'primary'));
  perform pg_temp.sab('sabotage: without the sync the record is not marked acknowledged', 'true',
    (select (acknowledged_at is not null)::text from public.shift_start_tests where rota_id = v_r and role = 'primary'));
  -- (d) the sweep removed: nothing is sent
  create or replace function private.shift_start_sweep() returns integer language sql as $s$ select 0 $s$;
  perform pg_temp.clear_rota();
  v_r := pg_temp.rota_row(v_org, now() - interval '30 seconds', now() + interval '10 hours', v_c, v_b);
  perform private.shift_start_sweep();
  perform pg_temp.sab('sabotage: without the sweep no test page is sent for a starting shift', '2', (select count(*)::text from public.shift_start_tests where rota_id = v_r));
  -- vacuity guard
  select count(*)::text into v_n from results where phase = 'sabotaged' and expected is distinct from actual;
  if v_n::integer < 4 then
    raise exception 'VACUOUS TEST: only % of 4 sabotage steps changed the matching check', v_n;
  end if;
end $$;

select phase, check_name, expected, actual,
       case when phase = 'sabotaged' then case when expected is distinct from actual then 'PASS (caught)' else 'FAIL' end
            else case when expected is not distinct from actual then 'PASS' else 'FAIL' end end as result
from results order by phase desc, check_name;

rollback;
