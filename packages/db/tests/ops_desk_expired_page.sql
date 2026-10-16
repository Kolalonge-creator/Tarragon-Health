-- Ops-desk resilience for an expired red page (OQ-441, decision S16-S20-10; migration *_ops_desk_expired_page_resilience.sql).
--
-- One rolled-back transaction. Every behaviour has a control, and the last section SABOTAGES the build (each removal must flip its check):
--   1. Rollout     the checklist gate ships OFF, v2 is inactive and unsigned, nothing is seeded, only the CMO signs, grants are select-only,
--                  nothing is callable by anon, the sweep job exists.
--   2. Roster      a contact needs an administrator account in the same organisation, a number the person has CONFIRMED on their own account
--                  that is not a placeholder, and a window of hours; a new row starts inactive; hours are read in Africa/Lagos.
--   3. Assignment  an expired page opens the sev1 incident and the primary on duty is assigned (owner set, in-app + push + email, never sms or
--                  voice); a primary off duty gives the deputy; nobody on duty opens a sev1 and tells the leadership; after the configured
--                  time an unacknowledged primary moves to the deputy exactly once; acknowledgement stops it; a nobody-reachable incident is
--                  assigned the same way; the uncovered-roster sev1 needs a real rota.
--   4. Call log    append only (update, delete, truncate refused even for the owner); the masked number only; the call sheet shows clinicians
--                  and never a patient; a clinician, a patient, anon and another organisation are refused.
--   5. Checklist   attestations are by a named person with evidence, append only, stale ones stop counting, and with the CMO's gate ON the
--                  on-call cover guard cannot be switched on until the checklist and roster are in place; with it OFF nothing is blocked.
--   6. Reading     RLS: admin and CMO of the organisation see the rows; a plain clinician, a patient, anon and another organisation do not.
--   7. SABOTAGE    the assignment trigger, the append-only trigger, the phone-confirmation rule and the gate are each removed and the
--                  matching check must flip.
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
create function pg_temp.anon_on() returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  perform set_config('request.jwt.claim.role', 'anon', true);
  set local role anon;
end $f$;
create function pg_temp.back() returns void language plpgsql as
$f$ begin reset role; perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.role', '', true); perform set_config('request.jwt.claim.sub', '', true); end $f$;
create function pg_temp.try(p_sql text) returns text language plpgsql as
$f$ begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $f$;
create function pg_temp.try_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql; r := 'ok'; exception when others then r := sqlstate; end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.try_anon(p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.anon_on();
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

-- users: real phone numbers are confirmed through auth.users.phone_confirmed_at, exactly as sign-in does
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text, p_phone text default null, p_confirm boolean default false) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, phone, phone_confirmed_at)
  values (v, 'opsd-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}', case when p_confirm then regexp_replace(p_phone, '\D', '', 'g') end, case when p_confirm then now() end);
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test, language)
  values (v, p_org, p_role::public.user_role, 'OpsDesk ' || p_label, p_phone, (current_date - interval '45 years')::date, true, 'en')
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone;
  return v;
end $f$;
create function pg_temp.confirm_phone(p_uid uuid, p_phone text) returns void language plpgsql as
$f$ begin
  update public.profiles set phone = p_phone where id = p_uid;
  update auth.users set phone = regexp_replace(p_phone, '\D', '', 'g'), phone_confirmed_at = now() where id = p_uid;
end $f$;
create function pg_temp.mkdoc(p_org uuid, p_admin uuid, p_label text, p_tier text, p_phone text) returns uuid
language plpgsql as $f$
declare v uuid := pg_temp.mkuser(p_org, p_label, 'clinician', p_phone, true);
begin
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
  values (p_org, v, 'OpsDesk ' || p_label, 'MDCN', 'OPSD-' || p_label || '-' || substr(v::text, 1, 8), true, 'active', now(), p_admin,
      p_tier::public.doctor_tier, case when p_tier = 'chief_medical_officer' then 'contracted' else 'employed' end::public.staff_employment_type, 2,
      p_tier = 'chief_medical_officer', case when p_tier = 'chief_medical_officer' then p_admin end, true);
  return v;
end $f$;
create function pg_temp.mkevent(p_patient uuid, p_set uuid) returns uuid language plpgsql as
$f$ declare v_id uuid; v_rs record;
begin
  select code, version, status into v_rs from public.triage_rule_sets where id = p_set;
  insert into public.triage_events (organisation_id, patient_id, trigger_type, trigger_id, grade, rule_id, rule_set_id, rule_set_code,
      rule_set_version, rule_set_status, actions, shadow, is_test, basis)
  select pr.organisation_id, p_patient, 'observation', gen_random_uuid(), 'red', 'R1', p_set, v_rs.code, v_rs.version, v_rs.status,
         '[{"kind":"page_on_call"}]'::jsonb, false, true, gen_random_uuid()::text
    from public.profiles pr where pr.id = p_patient
  returning id into v_id;
  return v_id;
end $f$;
create function pg_temp.mkpage(p_org uuid, p_patient uuid, p_event uuid, p_to uuid, p_test boolean default true) returns uuid language plpgsql as
$f$ declare v uuid;
begin
  perform set_config('tarragon.paging_write', 'on', true);
  insert into public.pages (organisation_id, patient_id, triage_event_id, role, to_clinician_id, escalation_level, sent_at, config_version, is_test)
  values (p_org, p_patient, p_event, 'primary', p_to, 0, now(), 1, p_test) returning id into v;
  perform set_config('tarragon.paging_write', 'off', true);
  return v;
end $f$;
-- the incident the expiry opens for a page
create function pg_temp.incident_of(p_page uuid) returns uuid language sql as
$$ select id from public.ops_incidents where external_reference = 'page_expired:' || p_page $$;
-- ISO day and time now in Lagos, as the window the person "works" (all day today, in Lagos time)
create function pg_temp.today_windows() returns jsonb language sql as
$$ select jsonb_build_array(jsonb_build_object('day', extract(isodow from now() at time zone 'Africa/Lagos')::int, 'start', '00:00', 'end', '23:59')) $$;
create function pg_temp.other_day_windows() returns jsonb language sql as
$$ select jsonb_build_array(jsonb_build_object('day', (extract(isodow from now() at time zone 'Africa/Lagos')::int % 7) + 1, 'start', '00:00', 'end', '23:59')) $$;
create function pg_temp.activate(p_uid uuid, p_contact uuid) returns text language sql as
$$ select pg_temp.try_as(p_uid, format('select public.ops_desk_set_contact_active(%L, true, %L)', p_contact, 'phoned them on the number shown and they answered')) $$;
-- swap the active ops desk config for a one-off proof version (the signed or active rows are never edited)
create function pg_temp.use_rules(p jsonb) returns void language plpgsql as
$f$ declare v_next integer; v_base jsonb;
begin
  select rules into v_base from public.ops_desk_config where version = 1;
  update public.ops_desk_config set is_active = false where is_active;
  select max(version) + 1 into v_next from public.ops_desk_config;
  insert into public.ops_desk_config (version, is_active, effective_from, rules) values (v_next, true, current_date, v_base || p);
end $f$;
create function pg_temp.guard_on(p_key text, p_on boolean) returns void language plpgsql as
$f$ begin
  alter table public.go_live_guards disable trigger go_live_guards_guard;
  update public.go_live_guards set is_on = p_on, changed_at = case when p_on then now() end, changed_by = case when p_on then pg_temp.f('admin') end, change_note = case when p_on then 'proof fixture' end where key = p_key;
  alter table public.go_live_guards enable trigger go_live_guards_guard;
end $f$;
create function pg_temp.guard_try(p_on boolean) returns text language plpgsql as
$f$ begin
  perform pg_temp.guard_on('on_call_cover_ok', p_on);
  return 'ok';
exception when others then return sqlstate;
end $f$;

create function pg_temp.backdate(p_att uuid, p_by interval) returns void language plpgsql as
$f$ begin
  alter table public.ops_desk_checklist_attestations disable trigger ops_desk_attestations_append_only;
  update public.ops_desk_checklist_attestations set attested_at = now() - p_by where id = p_att;
  alter table public.ops_desk_checklist_attestations enable trigger ops_desk_attestations_append_only;
end $f$;
create function pg_temp.item_state(p_uid uuid, p_item text) returns text language sql as
$$ select coalesce((select e ->> 'state' from jsonb_array_elements((pg_temp.q_as(p_uid, 'select public.ops_desk_overview(30)')::jsonb) -> 'checklist') e where e ->> 'item_key' = p_item), 'missing') $$;

create function pg_temp.set_world(p_test boolean) returns void language plpgsql as
$f$ begin
  alter table public.ops_desk_checklist_attestations disable trigger ops_desk_attestations_append_only;
  update public.ops_desk_checklist_attestations set is_test = p_test;
  alter table public.ops_desk_checklist_attestations enable trigger ops_desk_attestations_append_only;
  update public.ops_desk_contacts set is_test = p_test;
end $f$;

-- fixtures ----------------------------------------------------------------------------------------------------------------
do $$
declare v_org uuid; v_org2 uuid; v_admin uuid; v_ops1 uuid; v_ops2 uuid; v_other_admin uuid; v_cmo uuid; v_a uuid; v_b uuid; v_pat uuid; v_rs uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  insert into public.organisations (name, type) values ('OpsDesk proof org two', 'clinic') returning id into v_org2;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin', '+2348036482915', true);
  v_ops1 := pg_temp.mkuser(v_org, 'ops1', 'admin');                 -- no number yet
  v_ops2 := pg_temp.mkuser(v_org, 'ops2', 'admin', '+2348059173264', true);
  v_other_admin := pg_temp.mkuser(v_org2, 'otheradmin', 'admin', '+2348021846357', true);
  update public.clinical_staff set active = false where is_test is not true;
  v_cmo := pg_temp.mkdoc(v_org, v_admin, 'cmo', 'chief_medical_officer', '+2348074629318');
  v_a := pg_temp.mkdoc(v_org, v_admin, 'A', 'senior_medical_officer', '+2348033958271');
  v_b := pg_temp.mkdoc(v_org, v_admin, 'B', 'senior_medical_officer', null);
  v_pat := pg_temp.mkuser(v_org, 'patient', 'patient');
  perform pg_temp.setf('org', v_org); perform pg_temp.setf('org2', v_org2); perform pg_temp.setf('admin', v_admin);
  perform pg_temp.setf('ops1', v_ops1); perform pg_temp.setf('ops2', v_ops2); perform pg_temp.setf('otheradmin', v_other_admin);
  perform pg_temp.setf('cmo', v_cmo); perform pg_temp.setf('A', v_a); perform pg_temp.setf('B', v_b); perform pg_temp.setf('pat', v_pat);
  insert into public.triage_rule_sets (code, version, status, rules, approved_by, approved_at, note)
    values ('opsdtest', 1, 'approved', '{"code":"opsdtest","version":1}'::jsonb, v_cmo, now(), 'ops desk proof fixture') returning id into v_rs;
  perform pg_temp.setf('rs', v_rs);
end $$;

-- 1. Rollout ----------------------------------------------------------------------------------------------------------------
do $$
declare v_cmo uuid := pg_temp.f('cmo'); v_a uuid := pg_temp.f('A'); v_admin uuid := pg_temp.f('admin'); f text; n integer := 0;
begin
  perform pg_temp.rec('rollout: v1 is active and the checklist gate is OFF', '0,true',
    (select (rules ->> 'checklist_gates_readiness') || ',' || is_active::text from public.ops_desk_config where version = 1));
  perform pg_temp.rec('rollout: v2 is inactive and unsigned with the gate ON', 'false,false,1',
    (select is_active::text || ',' || (approved_at is not null)::text || ',' || (rules ->> 'checklist_gates_readiness') from public.ops_desk_config where version = 2));
  perform pg_temp.rec('config: a version with a bad number is refused and the active one cannot be edited', '23514,23514',
    pg_temp.try($q$insert into public.ops_desk_config (version, is_active, effective_from, rules) values (97, false, current_date, '{"deputy_after_seconds":0}')$q$) || ',' ||
    pg_temp.try($q$update public.ops_desk_config set rules = jsonb_set(rules, '{deputy_after_seconds}', '120') where is_active$q$));
  perform pg_temp.rec('config: only the CMO signs (a clinician and an admin are refused)', '42501,42501',
    pg_temp.try_as(v_a, 'select public.sign_ops_desk_config(2)') || ',' || pg_temp.try_as(v_admin, 'select public.sign_ops_desk_config(2)'));
  perform pg_temp.rec('ops_desk_config carries the superseded-version guard (the other governed tables are counted in governed_config_supersede_guard.sql)', '1',
    (select count(*)::text from pg_trigger where tgname = 'refuse_superseded_activation' and not tgisinternal and tgrelid = 'public.ops_desk_config'::regclass));
  perform pg_temp.rec('the sweep job exists', '1', (select count(*)::text from cron.job where jobname = 'ops-desk-sweep'));
  perform pg_temp.rec('nothing is seeded: no contact, no attestation, no call', '0,0,0',
    (select count(*)::text from public.ops_desk_contacts) || ',' || (select count(*)::text from public.ops_desk_checklist_attestations) || ',' || (select count(*)::text from public.ops_desk_call_log));
  perform pg_temp.rec('the checklist has exactly the four items', '4',
    (select count(*)::text from public.ops_desk_checklist_items where item_key in ('backup_power', 'second_internet_link', 'tested_contact_numbers', 'deputy_cover')));
  perform pg_temp.rec('authenticated holds only SELECT and anon nothing on the six tables', '0',
    (select count(*)::text from information_schema.role_table_grants where table_schema = 'public'
      and table_name in ('ops_desk_contacts', 'ops_desk_contact_windows', 'ops_desk_assignments', 'ops_desk_call_log', 'ops_desk_checklist_attestations', 'ops_desk_config')
      and (grantee in ('anon', 'PUBLIC') or (grantee = 'authenticated' and privilege_type <> 'SELECT'))));
  foreach f in array array['public.ops_desk_save_contact(uuid,text)', 'public.ops_desk_set_windows(uuid,jsonb)', 'public.ops_desk_set_contact_active(uuid,boolean,text)',
      'public.ops_desk_acknowledge(uuid)', 'public.ops_desk_call_sheet(uuid)', 'public.log_ops_desk_call(uuid,text,uuid,text,text)', 'public.attest_ops_desk_item(text,text,text)',
      'public.ops_desk_roster()', 'public.ops_desk_overview(integer)', 'public.ops_desk_calls(uuid,integer)', 'public.sign_ops_desk_config(integer)'] loop
    if has_function_privilege('anon', f, 'EXECUTE') then n := n + 1; end if;
  end loop;
  foreach f in array array['private.ops_desk_assign(uuid,text,uuid)', 'private.sweep_ops_desk()', 'private.ops_desk_on_duty(uuid,boolean,timestamptz)', 'private.verified_profile_phone(uuid)', 'private.ops_desk_org_ready(uuid,boolean)', 'private.ops_desk_contact_usable(uuid)'] loop
    if has_function_privilege('anon', f, 'EXECUTE') or has_function_privilege('authenticated', f, 'EXECUTE') then n := n + 1; end if;
  end loop;
  perform pg_temp.rec('no new function is callable by anon, and the private ones not by authenticated', '0', n::text);
  perform pg_temp.rec('anon is refused every public function (42501)', '42501,42501,42501',
    pg_temp.try_anon('select public.ops_desk_roster()') || ',' || pg_temp.try_anon('select public.ops_desk_overview(30)') || ',' ||
    pg_temp.try_anon(format('select public.ops_desk_call_sheet(%L)', gen_random_uuid())));
end $$;

-- 2. Roster ----------------------------------------------------------------------------------------------------------------
do $$
declare v_admin uuid := pg_temp.f('admin'); v_ops1 uuid := pg_temp.f('ops1'); v_ops2 uuid := pg_temp.f('ops2'); v_a uuid := pg_temp.f('A'); v_org uuid := pg_temp.f('org');
  v_c1 uuid; v_c2 uuid;
begin
  perform pg_temp.act(v_admin);
  v_c1 := public.ops_desk_save_contact(v_ops1, 'primary');
  v_c2 := public.ops_desk_save_contact(v_ops2, 'deputy');
  perform pg_temp.back();
  perform pg_temp.setf('c1', v_c1); perform pg_temp.setf('c2', v_c2);
  perform pg_temp.rec('roster: a new contact starts inactive', 'false,false',
    (select is_active::text from public.ops_desk_contacts where id = v_c1) || ',' || (select is_active::text from public.ops_desk_contacts where id = v_c2));
  perform pg_temp.rec('roster: only an administrator account can be a contact (a clinician is refused)', '23514',
    pg_temp.try_as(v_admin, format('select public.ops_desk_save_contact(%L, ''primary'')', v_a)));
  perform pg_temp.rec('roster: a clinician and a patient cannot maintain the roster', '42501,42501',
    pg_temp.try_as(v_a, format('select public.ops_desk_save_contact(%L, ''primary'')', v_ops2)) || ',' || pg_temp.try_as(pg_temp.f('pat'), format('select public.ops_desk_save_contact(%L, ''primary'')', v_ops2)));
  perform pg_temp.rec('roster: another organisation''s person cannot be added', '22023',
    pg_temp.try_as(v_admin, format('select public.ops_desk_save_contact(%L, ''primary'')', pg_temp.f('otheradmin'))));
  perform pg_temp.rec('activate: refused with no phone on the account (23514)', '23514', pg_temp.activate(v_admin, v_c1));
  perform pg_temp.rec('activate: refused with a confirmed number but no hours', '23514', pg_temp.activate(v_admin, v_c2));
  perform pg_temp.try_as(v_admin, format('select public.ops_desk_set_windows(%L, %L::jsonb)', v_c2, pg_temp.today_windows()::text));
  -- a number typed on the profile that sign-in has NOT confirmed does not count
  update public.profiles set phone = '+2348067391542' where id = v_ops1;
  perform pg_temp.try_as(v_admin, format('select public.ops_desk_set_windows(%L, %L::jsonb)', v_c1, pg_temp.today_windows()::text));
  perform pg_temp.rec('activate: a number nobody confirmed does not count', '23514', pg_temp.activate(v_admin, v_c1));
  -- a placeholder is refused even when "confirmed"
  perform pg_temp.confirm_phone(v_ops1, '+2348000000000');
  perform pg_temp.rec('activate: a placeholder number is refused even when confirmed', '23514,null', pg_temp.activate(v_admin, v_c1) || ',' || coalesce(private.verified_profile_phone(v_ops1), 'null'));
  perform pg_temp.confirm_phone(v_ops1, '+2348067391542');
  perform pg_temp.rec('activate: a confirmed real number with hours is accepted', 'ok,ok', pg_temp.activate(v_admin, v_c1) || ',' || pg_temp.activate(v_admin, v_c2));
  perform pg_temp.rec('activate: it is attributed to the administrator who did it', 'true',
    (select (activated_by = v_admin and activated_at is not null)::text from public.ops_desk_contacts where id = v_c1));
  perform pg_temp.rec('activate: a reason of a few words is required', '22023',
    pg_temp.try_as(v_admin, format('select public.ops_desk_set_contact_active(%L, true, ''ok'')', v_c1)));
  perform pg_temp.rec('hours: a bad window is refused with a message for people', '22023',
    pg_temp.try_as(v_admin, format('select public.ops_desk_set_windows(%L, ''[{"day": 9, "start": "08:00", "end": "07:00"}]''::jsonb)', v_c1)));
  perform pg_temp.rec('hours: an active contact cannot be left with no hours', '22023',
    pg_temp.try_as(v_admin, format('select public.ops_desk_set_windows(%L, ''[]''::jsonb)', v_c1)));
  perform pg_temp.rec('on duty: both are on duty now (Lagos day), primary and deputy', '2,primary,deputy',
    (select count(*)::text from private.ops_desk_on_duty(v_org, true)) || ',' ||
    (select string_agg(role, ',' order by role) from private.ops_desk_on_duty(v_org, true)));
  perform pg_temp.rec('on duty: at the same instant on a day with no window nobody is', '0',
    (select count(*)::text from private.ops_desk_on_duty(v_org, true, now() + interval '1 day')));
  perform pg_temp.rec('on duty: the real (non-test) world is untouched by test contacts', '0', (select count(*)::text from private.ops_desk_on_duty(v_org, false)));
  perform pg_temp.rec('roster: the function shows the confirmed number to an administrator and flags the state', 'confirmed,true',
    (select (e ->> 'phone_status') || ',' || (e ->> 'on_duty_now') from jsonb_array_elements(pg_temp.q_as(v_admin, 'select public.ops_desk_roster()')::jsonb) e where (e ->> 'profile_id')::uuid = v_ops2));
end $$;

-- 3. Assignment ------------------------------------------------------------------------------------------------------------
do $$
declare v_admin uuid := pg_temp.f('admin'); v_ops1 uuid := pg_temp.f('ops1'); v_ops2 uuid := pg_temp.f('ops2'); v_a uuid := pg_temp.f('A'); v_b uuid := pg_temp.f('B');
  v_org uuid := pg_temp.f('org'); v_pat uuid := pg_temp.f('pat'); v_pg uuid; v_pg2 uuid; v_pg3 uuid; v_pg4 uuid; v_pg5 uuid; v_pg6 uuid; v_pg7 uuid; v_inc uuid; v_inc2 uuid; v_c1 uuid := pg_temp.f('c1'); v_c2 uuid := pg_temp.f('c2'); v_asg uuid;
begin
  -- the page and its expiry: the existing S19c function opens the sev1 incident
  v_pg := pg_temp.mkpage(v_org, v_pat, pg_temp.mkevent(v_pat, pg_temp.f('rs')), v_a);
  perform pg_temp.setf('pg', v_pg);
  perform private.expire_page(v_pg);
  v_inc := pg_temp.incident_of(v_pg);
  perform pg_temp.setf('inc', v_inc);
  perform pg_temp.rec('expiry: the sev1 incident is open and the primary on duty owns it', 'sev1,true',
    (select severity::text from public.ops_incidents where id = v_inc) || ',' || (select (owner_id = v_ops1)::text from public.ops_incidents where id = v_inc));
  perform pg_temp.rec('expiry: one assignment, the primary, first choice', '1,primary,first_choice',
    (select count(*)::text from public.ops_desk_assignments where incident_id = v_inc) || ',' || (select role from public.ops_desk_assignments where incident_id = v_inc limit 1) || ',' ||
    (select reason from public.ops_desk_assignments where incident_id = v_inc limit 1));
  perform pg_temp.rec('expiry: the contact is told by push, in-app and email only', 'email,in_app,push',
    (select string_agg(channel::text, ',' order by channel::text) from public.notifications where recipient_id = v_ops1 and template = 'on_call_ops_desk' and source_id = v_pg));
  perform pg_temp.rec('expiry: no sms or voice row exists for any ops desk template', '0',
    (select count(*)::text from public.notifications where template like 'on_call_ops_desk%' and channel::text in ('sms', 'voice')));
  perform pg_temp.rec('expiry: an sms row for an ops desk page cannot be inserted at all', 'true',
    (pg_temp.try($q$insert into public.notifications (recipient_id, organisation_id, channel, template, payload, status, content_class, priority, source_table, source_id)
      select id, organisation_id, 'sms', 'on_call_ops_desk', '{}'::jsonb, 'pending', 'non_clinical', 'critical', 'pages', gen_random_uuid() from public.profiles where id = pg_temp.f('ops1')$q$) <> 'ok')::text);
  perform pg_temp.rec('expiry: the notice text carries no patient (payload is the page id only)', 'true',
    (select (payload - 'page_id' = '{}'::jsonb)::text from public.notifications where recipient_id = v_ops1 and template = 'on_call_ops_desk' limit 1));
  perform pg_temp.rec('expiry: it is audited', '1',
    (select count(*)::text from public.audit_log where action = 'ops_desk.assigned' and entity_id = v_inc));

  -- the deputy takes over after the configured time, once, and acknowledgement stops it
  perform pg_temp.rec('deputy: nothing moves before the time has passed', '0',
    ((private.sweep_ops_desk() ->> 'deputies')));
  update public.ops_desk_assignments set assigned_at = now() - interval '10 minutes' where incident_id = v_inc;
  perform pg_temp.rec('deputy: after the time the deputy is assigned', '1,deputy,primary_unacknowledged',
    (private.sweep_ops_desk() ->> 'deputies') || ',' || (select role from public.ops_desk_assignments where incident_id = v_inc and role = 'deputy') || ',' ||
    (select reason from public.ops_desk_assignments where incident_id = v_inc and role = 'deputy'));
  perform pg_temp.rec('deputy: the deputy now owns the incident and is told by push, in-app and email', 'true,email,in_app,push',
    (select (owner_id = v_ops2)::text from public.ops_incidents where id = v_inc) || ',' ||
    (select string_agg(channel::text, ',' order by channel::text) from public.notifications where recipient_id = v_ops2 and template = 'on_call_ops_desk' and source_id = v_pg));
  perform pg_temp.rec('deputy: a second sweep does not assign again', '0,2',
    (private.sweep_ops_desk() ->> 'deputies') || ',' || (select count(*)::text from public.ops_desk_assignments where incident_id = v_inc));
  perform pg_temp.rec('ack: someone who was not assigned is refused (42501)', '42501', pg_temp.try_as(v_admin, format('select public.ops_desk_acknowledge(%L)', v_inc)));
  perform pg_temp.rec('ack: the deputy acknowledges their own assignment and the register''s own acknowledgement is stamped', 'ok,true,true',
    pg_temp.try_as(v_ops2, format('select public.ops_desk_acknowledge(%L)', v_inc)) || ',' ||
    (select (acknowledged_by = v_ops2)::text from public.ops_desk_assignments where incident_id = v_inc and role = 'deputy') || ',' ||
    (select (acknowledged_at is not null)::text from public.ops_incidents where id = v_inc));
  perform pg_temp.rec('ack: it is audited and a second acknowledgement is refused', '1,42501',
    (select count(*)::text from public.audit_log where action = 'ops_desk.acknowledged' and entity_id = v_inc) || ',' ||
    pg_temp.try_as(v_ops2, format('select public.ops_desk_acknowledge(%L)', v_inc)));

  -- the primary is not on duty: the deputy is first choice by necessity
  perform pg_temp.try_as(v_admin, format('select public.ops_desk_set_windows(%L, %L::jsonb)', v_c1, pg_temp.other_day_windows()::text));
  -- a REAL page (the people are moved to the real world for these steps and back): the sev1s below are only for real pages
  perform pg_temp.set_world(false);
  v_pg2 := pg_temp.mkpage(v_org, v_pat, pg_temp.mkevent(v_pat, pg_temp.f('rs')), v_b, false);
  perform private.expire_page(v_pg2);
  v_inc2 := pg_temp.incident_of(v_pg2);
  perform pg_temp.rec('off duty: the primary is skipped and the deputy on duty is assigned with that reason', 'deputy,primary_not_on_duty',
    (select role || ',' || reason from public.ops_desk_assignments where incident_id = v_inc2));
  perform pg_temp.setf('inc2', v_inc2);
  -- the deputy does not answer either: one closing alarm and no endless loop
  update public.ops_desk_assignments set assigned_at = now() - interval '10 minutes' where incident_id = v_inc2;
  perform pg_temp.rec('deputy silent: the closing sev1 is raised once for a real page', '1,1',
    (private.sweep_ops_desk() ->> 'final') || ',' || (select count(*)::text from public.ops_incidents where external_reference = 'ops_desk_unacknowledged:' || v_inc2));
  perform pg_temp.rec('deputy silent: the next sweep does not raise it again', '0',
    (private.sweep_ops_desk() ->> 'final'));
  -- a primary who is on duty but silent, with no deputy on duty: one incident about the missing deputy, not a second "nobody named" one
  update public.ops_desk_contacts set is_active = false, activated_by = null, activated_at = null where id = v_c2;
  update public.ops_desk_contacts set is_active = true, activated_by = v_admin, activated_at = now() where id = v_c1;
  perform pg_temp.try_as(v_admin, format('select public.ops_desk_set_windows(%L, %L::jsonb)', v_c1, pg_temp.today_windows()::text));
  v_pg6 := pg_temp.mkpage(v_org, v_pat, pg_temp.mkevent(v_pat, pg_temp.f('rs')), v_a, false);
  perform private.expire_page(v_pg6);
  update public.ops_desk_assignments set assigned_at = now() - interval '10 minutes' where incident_id = pg_temp.incident_of(v_pg6);
  perform private.sweep_ops_desk();
  perform pg_temp.rec('no deputy: one "no deputy" incident and no "nobody named" one for a primary who was assigned', '1,0',
    (select count(*)::text from public.ops_incidents where external_reference = 'ops_desk_no_deputy:' || pg_temp.incident_of(v_pg6)) || ',' ||
    (select count(*)::text from public.ops_incidents where external_reference = 'ops_desk_uncovered:' || pg_temp.incident_of(v_pg6)));
  update public.ops_desk_contacts set is_active = true, activated_by = v_admin, activated_at = now() where id = v_c2;
  update public.ops_desk_contacts set is_active = false, activated_by = null, activated_at = null where id = v_c1;
  perform pg_temp.set_world(true);
  -- a drill (test page) with a silent deputy raises no sev1
  v_pg7 := pg_temp.mkpage(v_org, v_pat, pg_temp.mkevent(v_pat, pg_temp.f('rs')), v_b, true);
  perform private.expire_page(v_pg7);
  update public.ops_desk_assignments set assigned_at = now() - interval '10 minutes' where incident_id = pg_temp.incident_of(v_pg7);
  perform private.sweep_ops_desk();
  perform pg_temp.rec('drill: a silent deputy on a test page raises no sev1', '1,0',
    (select count(*)::text from public.ops_desk_assignments where incident_id = pg_temp.incident_of(v_pg7)) || ',' ||
    (select count(*)::text from public.ops_incidents where external_reference like 'ops\_desk\_%:' || pg_temp.incident_of(v_pg7)));

  -- nobody on duty at all: a REAL page is loud, a drill is not
  update public.ops_desk_contacts set is_active = false, activated_by = null, activated_at = null where organisation_id = v_org;
  v_pg3 := pg_temp.mkpage(v_org, v_pat, pg_temp.mkevent(v_pat, pg_temp.f('rs')), v_a, false);
  perform private.expire_page(v_pg3);
  perform pg_temp.rec('nobody: a real page gets no assignment and a sev1 says no named ops person is on duty', '0,1',
    (select count(*)::text from public.ops_desk_assignments where incident_id = pg_temp.incident_of(v_pg3)) || ',' ||
    (select count(*)::text from public.ops_incidents where external_reference = 'ops_desk_uncovered:' || pg_temp.incident_of(v_pg3) and severity = 'sev1'));
  v_pg4 := pg_temp.mkpage(v_org, v_pat, pg_temp.mkevent(v_pat, pg_temp.f('rs')), v_a, true);
  perform private.expire_page(v_pg4);
  perform pg_temp.rec('nobody: a drill (test page) raises no sev1 and no uncovered notice, only an audit row', '0,0,1',
    (select count(*)::text from public.ops_incidents where external_reference = 'ops_desk_uncovered:' || pg_temp.incident_of(v_pg4)) || ',' ||
    (select count(*)::text from public.notifications where template = 'on_call_ops_desk_uncovered' and source_id = v_pg4) || ',' ||
    (select count(*)::text from public.audit_log where action = 'ops_desk.uncovered_test' and entity_id = pg_temp.incident_of(v_pg4)));
  perform pg_temp.rec('nobody: no ops desk template is ever sent by sms or voice', '0',
    (select count(*)::text from public.notifications where template like 'on_call_ops_desk%' and channel::text in ('sms', 'voice')));

  -- a nobody-reachable incident (the health job's) is assigned the same way
  update public.ops_desk_contacts set is_active = true, activated_by = v_admin, activated_at = now() where id = v_c2;
  perform private.page_incident(v_org, 'page_nobody_reachable:' || v_org, 'Nobody reachable is on call', 'proof');
  perform pg_temp.rec('nobody reachable: the standing condition gets its own calmer notice, three channels, never the page wording', '3,0',
    (select count(*)::text from public.notifications where template = 'on_call_ops_desk_roster' and recipient_id = v_ops2) || ',' ||
    (select count(*)::text from public.notifications n where n.template = 'on_call_ops_desk' and n.recipient_id = v_ops2
        and n.source_id = (select id from public.ops_incidents where external_reference = 'page_nobody_reachable:' || v_org)));
  perform pg_temp.rec('nobody reachable: the notice points at the incident (its own source table, routine priority), not at a page that does not exist', 'ops_incidents,routine,true,0',
    (select min(source_table) || ',' || min(priority::text) || ',' ||
            (min(source_id::text) = (select id::text from public.ops_incidents where external_reference = 'page_nobody_reachable:' || v_org))::text
       from public.notifications where template = 'on_call_ops_desk_roster' and recipient_id = v_ops2) || ',' ||
    (select count(*)::text from public.notifications n where n.source_table = 'pages' and n.template like 'on_call_ops_desk%' and not exists (select 1 from public.pages pg where pg.id = n.source_id)));
  perform pg_temp.rec('nobody reachable: an sms or voice row for an ops desk notice is refused whatever table it points at', '23514,23514',
    pg_temp.try($q$insert into public.notifications (recipient_id, organisation_id, channel, template, payload, status, content_class, priority, source_table, source_id)
      select id, organisation_id, 'sms', 'on_call_ops_desk_roster', '{}'::jsonb, 'pending', 'non_clinical', 'routine', 'ops_incidents', gen_random_uuid() from public.profiles where id = pg_temp.f('ops2')$q$) || ',' ||
    pg_temp.try($q$insert into public.notifications (recipient_id, organisation_id, channel, template, payload, status, content_class, priority, source_table, source_id)
      select id, organisation_id, 'voice', 'on_call_ops_desk', '{}'::jsonb, 'pending', 'non_clinical', 'routine', 'ops_incidents', gen_random_uuid() from public.profiles where id = pg_temp.f('ops2')$q$));
  perform pg_temp.rec('nobody reachable: the same assignment happens', '1',
    (select count(*)::text from public.ops_desk_assignments a join public.ops_incidents i on i.id = a.incident_id where i.external_reference = 'page_nobody_reachable:' || v_org and a.profile_id = v_ops2));
  perform private.page_incident(v_org, 'page_notifications_stuck', 'x', 'y');
  perform pg_temp.rec('an unrelated incident is not assigned', '0',
    (select count(*)::text from public.ops_desk_assignments a join public.ops_incidents i on i.id = a.incident_id where i.external_reference = 'page_notifications_stuck'));

  -- a clinician acknowledges the expired page after all: the escalation stops and the sheet says so
  v_pg5 := pg_temp.mkpage(v_org, v_pat, pg_temp.mkevent(v_pat, pg_temp.f('rs')), v_b);
  perform private.expire_page(v_pg5);
  update public.ops_desk_assignments set assigned_at = now() - interval '10 minutes' where incident_id = pg_temp.incident_of(v_pg5);
  perform set_config('tarragon.paging_write', 'on', true);
  update public.pages set acknowledged_at = now(), acknowledged_by = v_a where id = v_pg5;
  perform set_config('tarragon.paging_write', 'off', true);
  perform pg_temp.rec('page acknowledged: the sweep neither escalates nor raises the closing sev1 for it', '0,0',
    (private.sweep_ops_desk() ->> 'final') || ',' || (select count(*)::text from public.ops_incidents where external_reference = 'ops_desk_unacknowledged:' || pg_temp.incident_of(v_pg5)));
  perform pg_temp.rec('page acknowledged: the call sheet says a clinician has acknowledged it', 'true',
    (pg_temp.q_as(v_ops2, format('select public.ops_desk_call_sheet(%L)::text', pg_temp.incident_of(v_pg5))) like '%"page_acknowledged": true%')::text);

  -- the roster form cannot silently switch an active contact off
  perform pg_temp.rec('roster: saving an active contact again is refused instead of switching them off', '22023,true',
    pg_temp.try_as(v_admin, format('select public.ops_desk_save_contact(%L, ''primary'')', v_ops2)) || ',' || (select is_active::text from public.ops_desk_contacts where id = v_c2));
  -- an account demoted after activation can always be made inactive, and does not count as cover meanwhile
  update public.profiles set role = 'clinician' where id = v_ops2;
  perform pg_temp.rec('demoted account: no longer usable cover, and it can still be made inactive', 'false,ok',
    private.ops_desk_contact_usable(v_c2)::text || ',' || pg_temp.try_as(v_admin, format('select public.ops_desk_set_contact_active(%L, false, null)', v_c2)));
  update public.profiles set role = 'admin' where id = v_ops2;
  update public.ops_desk_contacts set is_active = true, activated_by = v_admin, activated_at = now() where id = v_c2;
end $$;

-- the uncovered-roster alarm needs a REAL rota; the proof makes one for the real world and removes it with the rollback
do $$
declare v_org uuid := pg_temp.f('org'); v_a uuid := pg_temp.f('A'); v_b uuid := pg_temp.f('B'); v_rota uuid; v_n integer; v_ops4 uuid; v_c4 uuid;
begin
  perform set_config('tarragon.lead_write', 'on', true);
  insert into public.on_call_rota (organisation_id, starts_at, ends_at, primary_clinician_id, backup_clinician_id, built_by, is_test)
  values (v_org, now() - interval '1 hour', now() + interval '2 hours', v_a, v_b, pg_temp.f('admin'), false) returning id into v_rota;
  perform set_config('tarragon.lead_write', 'off', true);
  perform pg_temp.setf('rota', v_rota);
  select (private.sweep_ops_desk() ->> 'uncovered')::integer into v_n;
  perform pg_temp.rec('roster alarm: with a real rota and nobody on duty in the real world, a sev1 is opened', 'true,1',
    (v_n >= 1)::text || ',' || (select count(*)::text from public.ops_incidents where external_reference = 'ops_desk_uncovered_roster:' || v_org and severity = 'sev1' and status not in ('resolved', 'closed')));
  perform pg_temp.rec('roster alarm: a second sweep refreshes the same incident, it does not open another', '1',
    (private.sweep_ops_desk() ->> 'errors')::int * 0 + (select count(*) from public.ops_incidents where external_reference = 'ops_desk_uncovered_roster:' || v_org));
  -- cover returns in the real world (a non-test administrator on duty): the alarm closes itself
  v_ops4 := pg_temp.mkuser(v_org, 'ops4', 'admin', '+2348090314752', true);
  update public.profiles set is_test = false where id = v_ops4;
  perform pg_temp.act(pg_temp.f('admin'));
  v_c4 := public.ops_desk_save_contact(v_ops4, 'primary');
  perform public.ops_desk_set_windows(v_c4, pg_temp.today_windows());
  perform public.ops_desk_set_contact_active(v_c4, true, 'phoned them and they answered');
  perform pg_temp.back();
  perform private.sweep_ops_desk();
  perform pg_temp.rec('roster alarm: when cover returns the alarm closes itself', 'resolved',
    (select status::text from public.ops_incidents where external_reference = 'ops_desk_uncovered_roster:' || v_org order by detected_at desc limit 1));
  perform pg_temp.rec('roster alarm: the register''s own stamps and timeline agree (resolved_at, acknowledged_at, a status-change entry)', 'true,true,true',
    (select (resolved_at is not null)::text || ',' || (acknowledged_at is not null)::text || ',' ||
            (exists (select 1 from public.ops_incident_updates u where u.incident_id = i.id and u.status_to = 'resolved'))::text
       from public.ops_incidents i where i.external_reference = 'ops_desk_uncovered_roster:' || v_org order by i.detected_at desc limit 1));
  -- switched off in config, the alarm is silent
  update public.ops_desk_contacts set is_active = false, activated_by = null, activated_at = null where id = v_c4;
  perform pg_temp.use_rules('{"uncovered_roster_alarm": 0}'::jsonb);
  perform private.sweep_ops_desk();
  perform pg_temp.rec('roster alarm: with the alarm switched off in config no new incident opens', '0',
    (select count(*)::text from public.ops_incidents where external_reference = 'ops_desk_uncovered_roster:' || v_org and status not in ('resolved', 'closed')));
end $$;

-- 4. Call log and call sheet -------------------------------------------------------------------------------------------------
do $$
declare v_admin uuid := pg_temp.f('admin'); v_ops2 uuid := pg_temp.f('ops2'); v_a uuid := pg_temp.f('A'); v_b uuid := pg_temp.f('B'); v_cmo uuid := pg_temp.f('cmo'); v_inc uuid := pg_temp.f('inc');
  v_pat uuid := pg_temp.f('pat'); v_oa uuid := pg_temp.f('otheradmin'); v_id uuid; sheet text;
begin
  perform pg_temp.use_rules('{}'::jsonb);
  perform pg_temp.act(v_ops2);
  v_id := public.log_ops_desk_call(v_inc, 'on_call_primary', v_a, 'no_answer', 'rang four times');
  perform public.log_ops_desk_call(v_inc, 'chief_medical_officer', v_cmo, 'answered_acknowledged', null);
  perform pg_temp.back();
  perform pg_temp.rec('call log: two calls recorded, who called whom', '2,true',
    (select count(*)::text from public.ops_desk_call_log where incident_id = v_inc) || ',' || (select (called_by = v_ops2 and callee_profile_id = v_a)::text from public.ops_desk_call_log where id = v_id));
  perform pg_temp.rec('call log: only a masked number is kept, never the full one', 'true,true',
    (select (callee_phone_masked is not null and callee_phone_masked <> '+2348033958271' and callee_phone_masked like '+234%' and callee_phone_masked like '%*%')::text from public.ops_desk_call_log where id = v_id) || ',' ||
    (select (position('8033958271' in coalesce(string_agg(callee_phone_masked, ''), '')) = 0)::text from public.ops_desk_call_log));
  perform pg_temp.rec('call log: a person with no confirmed number is logged with no number', 'null',
    coalesce((select l.callee_phone_masked from (select public.log_ops_desk_call(v_inc, 'other', v_b, 'wrong_or_no_number', 'phoned the backup from the paper list') as id) x join public.ops_desk_call_log l on l.id = x.id), 'null'));
  perform pg_temp.rec('call log: only someone on the call sheet can be logged under a sheet role; anyone else needs "someone else" with a reason', '22023,22023,22023,ok',
    pg_temp.try_as(v_ops2, format('select public.log_ops_desk_call(%L, ''on_call_primary'', %L, ''no_answer'', null)', v_inc, v_b)) || ',' ||
    pg_temp.try_as(v_ops2, format('select public.log_ops_desk_call(%L, ''on_call_backup'', %L, ''no_answer'', null)', v_inc, v_a)) || ',' ||
    pg_temp.try_as(v_ops2, format('select public.log_ops_desk_call(%L, ''other'', %L, ''no_answer'', ''short'')', v_inc, v_b)) || ',' ||
    pg_temp.try_as(v_ops2, format('select public.log_ops_desk_call(%L, ''on_call_primary'', %L, ''no_answer'', null)', v_inc, v_a)));
  perform pg_temp.rec('call log: update, delete and truncate are refused even for the owner', '23514,23514,23514',
    pg_temp.try(format('update public.ops_desk_call_log set outcome = ''busy_or_off'' where id = %L', v_id)) || ',' ||
    pg_temp.try(format('delete from public.ops_desk_call_log where id = %L', v_id)) || ',' || pg_temp.try('truncate public.ops_desk_call_log'));
  perform pg_temp.rec('call log: a long note, an unknown outcome and a bad callee are refused', '22023,23514,22023',
    pg_temp.try_as(v_ops2, format('select public.log_ops_desk_call(%L, ''on_call_primary'', %L, ''no_answer'', %L)', v_inc, v_a, repeat('x', 501))) || ',' ||
    pg_temp.try_as(v_ops2, format('select public.log_ops_desk_call(%L, ''on_call_primary'', %L, ''shrugged'', null)', v_inc, v_a)) || ',' ||
    pg_temp.try_as(v_ops2, format('select public.log_ops_desk_call(%L, ''chief_medical_officer'', %L, ''no_answer'', null)', v_inc, v_a)));
  perform pg_temp.rec('call log: a clinician, a patient and another organisation''s administrator cannot log', '42501,42501,P0002',
    pg_temp.try_as(v_a, format('select public.log_ops_desk_call(%L, ''on_call_primary'', %L, ''no_answer'', null)', v_inc, v_a)) || ',' ||
    pg_temp.try_as(v_pat, format('select public.log_ops_desk_call(%L, ''on_call_primary'', %L, ''no_answer'', null)', v_inc, v_a)) || ',' ||
    pg_temp.try_as(v_oa, format('select public.log_ops_desk_call(%L, ''on_call_primary'', %L, ''no_answer'', null)', v_inc, v_a)));
  sheet := pg_temp.q_as(v_ops2, format('select public.ops_desk_call_sheet(%L)::text', v_inc));
  perform pg_temp.rec('call sheet: the on-call clinician and the CMO are listed with their confirmed numbers', 'true,true',
    (sheet like '%+2348033958271%')::text || ',' || (sheet like '%+2348074629318%')::text);
  perform pg_temp.rec('call sheet: a clinician with no confirmed number shows none and says so', 'true',
    (pg_temp.q_as(v_ops2, format('select public.ops_desk_call_sheet(%L)::text', pg_temp.incident_of(pg_temp.f('pg')))) like '%"kind": "on_call_primary"%')::text);
  perform pg_temp.rec('call sheet: no patient id, name or page text appears', 'true',
    (sheet not like '%' || v_pat::text || '%' and sheet not like '%OpsDesk patient%')::text);
  perform pg_temp.rec('call sheet: another organisation''s administrator and a patient are refused', 'P0002,42501',
    pg_temp.try_as(v_oa, format('select public.ops_desk_call_sheet(%L)', v_inc)) || ',' || pg_temp.try_as(v_pat, format('select public.ops_desk_call_sheet(%L)', v_inc)));
  perform pg_temp.rec('call sheet: an unrelated incident has no sheet', 'P0002',
    pg_temp.try_as(v_admin, format('select public.ops_desk_call_sheet(%L)', (select id from public.ops_incidents where external_reference = 'page_notifications_stuck' limit 1))));
end $$;

-- 5. Checklist and the gate -------------------------------------------------------------------------------------------------
do $$
declare v_admin uuid := pg_temp.f('admin'); v_a uuid := pg_temp.f('A'); v_cmo uuid := pg_temp.f('cmo'); v_org uuid := pg_temp.f('org'); v_oa uuid := pg_temp.f('otheradmin');
  v_ops1 uuid := pg_temp.f('ops1'); v_c1 uuid := pg_temp.f('c1'); it text; v_att uuid;
begin
  perform pg_temp.rec('checklist: before anyone says anything every item reads not attested and the org is not ready', 'not_attested,false',
    (select (e ->> 'state') from jsonb_array_elements((pg_temp.q_as(v_admin, 'select public.ops_desk_overview(30)')::jsonb) -> 'checklist') e where e ->> 'item_key' = 'backup_power') || ',' ||
    private.ops_desk_org_ready(v_org, true)::text);
  perform pg_temp.rec('checklist: a short note, an unknown item, a clinician and a patient are refused', '22023,P0002,42501,42501',
    pg_temp.try_as(v_admin, $q$select public.attest_ops_desk_item('backup_power', 'in_place', 'seen')$q$) || ',' ||
    pg_temp.try_as(v_admin, $q$select public.attest_ops_desk_item('free_coffee', 'in_place', 'seen it in the cupboard behind the desk')$q$) || ',' ||
    pg_temp.try_as(v_a, $q$select public.attest_ops_desk_item('backup_power', 'in_place', 'seen it in the cupboard behind the desk')$q$) || ',' ||
    pg_temp.try_as(pg_temp.f('pat'), $q$select public.attest_ops_desk_item('backup_power', 'in_place', 'seen it in the cupboard behind the desk')$q$));
  perform pg_temp.act(v_admin);
  v_att := public.attest_ops_desk_item('backup_power', 'in_place', 'Tested the inverter by pulling the mains: laptop ran 4 hours.');
  perform pg_temp.back();
  perform pg_temp.rec('checklist: a statement is kept under the named person, today, with the evidence', 'true',
    (select (attested_by = v_admin and evidence_note like 'Tested the inverter%' and attested_at > now() - interval '1 minute')::text from public.ops_desk_checklist_attestations where id = v_att));
  perform pg_temp.rec('checklist: a statement cannot be changed or removed', '23514,23514',
    pg_temp.try(format('update public.ops_desk_checklist_attestations set state = ''not_in_place'' where id = %L', v_att)) || ',' ||
    pg_temp.try(format('delete from public.ops_desk_checklist_attestations where id = %L', v_att)));
  perform pg_temp.rec('checklist: the CMO may also attest', 'ok', pg_temp.try_as(v_cmo, $q$select public.attest_ops_desk_item('second_internet_link', 'in_place', 'Loaded the console on the second carrier''s hotspot today.')$q$));
  -- the newest statement wins. The proof runs in one transaction, so the older statements are dated back by hand (the table is append only)
  perform pg_temp.backdate(v_att, interval '2 days');
  perform pg_temp.act(v_admin);
  perform public.attest_ops_desk_item('backup_power', 'not_in_place', 'The inverter battery is flat and the power banks are missing.');
  perform pg_temp.back();
  perform pg_temp.rec('checklist: the newest statement wins (not in place after in place)', 'not_in_place,false',
    pg_temp.item_state(v_admin, 'backup_power') || ',' || private.ops_desk_org_ready(v_org, true)::text);
  perform pg_temp.backdate((select id from public.ops_desk_checklist_attestations where item_key = 'backup_power' and state = 'not_in_place'), interval '1 day');
  perform pg_temp.act(v_admin);
  perform public.attest_ops_desk_item('backup_power', 'in_place', 'Replaced the battery and retested: laptop and router ran 4 hours.');
  foreach it in array array['tested_contact_numbers', 'deputy_cover'] loop
    perform public.attest_ops_desk_item(it, 'in_place', 'Checked in person today: ' || it || ' is in place.');
  end loop;
  perform pg_temp.back();
  perform pg_temp.rec('ready: three of four attested (second link is by the CMO and stands) and no primary active yet, so not ready', 'in_place,false',
    pg_temp.item_state(v_admin, 'backup_power') || ',' || private.ops_desk_org_ready(v_org, true)::text);
  update public.ops_desk_contacts set is_active = true, activated_by = v_admin, activated_at = now() where id = v_c1;
  perform pg_temp.rec('ready: with all four in place and a primary and a deputy active with confirmed numbers, ready', 'true', private.ops_desk_org_ready(v_org, true)::text);
  perform pg_temp.backdate((select id from public.ops_desk_checklist_attestations where item_key = 'deputy_cover'), interval '91 days');
  perform pg_temp.rec('stale: a statement older than the configured age stops counting and is shown as out of date', 'true,true',
    (private.ops_desk_org_ready(v_org, true) is false)::text || ',' ||
    (select (e ->> 'stale') from jsonb_array_elements((pg_temp.q_as(v_admin, 'select public.ops_desk_overview(30)')::jsonb) -> 'checklist') e where e ->> 'item_key' = 'deputy_cover'));
end $$;

-- the gate: ships OFF, and with the CMO's config ON it holds back only the switching ON of the on-call cover guard
do $$
begin
  perform pg_temp.guard_on('on_call_cover_ok', false);
  perform pg_temp.rec('gate off: with the checklist stale the guard still switches on (nothing is gated by default)', 'ok', pg_temp.guard_try(true));
  perform pg_temp.guard_on('on_call_cover_ok', false);
  perform pg_temp.use_rules('{"checklist_gates_readiness": 1}'::jsonb);
  perform pg_temp.rec('gate on: with the checklist stale the guard cannot be switched on (23514)', '23514', pg_temp.guard_try(true));
  perform pg_temp.rec('gate on: it never blocks switching the guard off', 'ok', pg_temp.guard_try(false));
  perform pg_temp.backdate((select id from public.ops_desk_checklist_attestations where item_key = 'deputy_cover'), interval '0 days');
  -- the gate looks at the real world; the proof's people are test accounts, so move them across for this one check and back
  perform pg_temp.set_world(false);
  perform pg_temp.rec('gate on: with the checklist and roster in place the guard switches on', 'ok', pg_temp.guard_try(true));
  perform pg_temp.guard_on('on_call_cover_ok', false);
  perform pg_temp.set_world(true);
end $$;

-- 24 hour cover: midnight is not a gap
do $$
declare v_admin uuid := pg_temp.f('admin'); v_org uuid := pg_temp.f('org'); v_c2 uuid := pg_temp.f('c2'); v_ts timestamptz; d integer;
begin
  perform pg_temp.rec('windows: 25:00, an end before the start and a start of 24:00 are refused (22023)', '22023,22023,22023',
    pg_temp.try_as(v_admin, format('select public.ops_desk_set_windows(%L, ''[{"day":1,"start":"08:00","end":"25:00"}]''::jsonb)', v_c2)) || ',' ||
    pg_temp.try_as(v_admin, format('select public.ops_desk_set_windows(%L, ''[{"day":1,"start":"18:00","end":"08:00"}]''::jsonb)', v_c2)) || ',' ||
    pg_temp.try_as(v_admin, format('select public.ops_desk_set_windows(%L, ''[{"day":1,"start":"24:00","end":"24:00"}]''::jsonb)', v_c2)));
  perform pg_temp.act(v_admin);
  perform public.ops_desk_set_windows(v_c2, (select jsonb_agg(jsonb_build_object('day', g, 'start', '00:00', 'end', '24:00')) from generate_series(1, 7) g));
  perform pg_temp.back();
  perform pg_temp.rec('windows: 24:00 is stored and shown back as 24:00', '24:00',
    (select e ->> 'end' from jsonb_array_elements(pg_temp.q_as(v_admin, 'select public.ops_desk_roster()')::jsonb) r, jsonb_array_elements(r -> 'windows') e where (r ->> 'contact_id')::uuid = v_c2 limit 1));
  v_ts := (date_trunc('day', now() at time zone 'Africa/Lagos') + interval '23 hours 59 minutes 30 seconds') at time zone 'Africa/Lagos';
  perform pg_temp.rec('windows: a deputy on 24 hour windows is on duty at 23:59:30 and at 00:00:00 Lagos time', '1,1',
    (select count(*)::text from private.ops_desk_on_duty(v_org, true, v_ts) where role = 'deputy' and contact_id = v_c2) || ',' ||
    (select count(*)::text from private.ops_desk_on_duty(v_org, true, v_ts + interval '30 seconds') where role = 'deputy' and contact_id = v_c2));
  select count(*) into d from generate_series(date_trunc('hour', now()), date_trunc('hour', now()) + interval '167 hours', interval '1 hour') h
   where not exists (select 1 from private.ops_desk_on_duty(v_org, true, h + interval '59 minutes 59 seconds'));
  perform pg_temp.rec('windows: with 24 hour cover there is no uncovered minute in the next 7 days, so the roster alarm cannot flap', '0', d::text);
  -- a night: 22:00 to 06:00 stored as two windows across midnight
  perform pg_temp.act(v_admin);
  perform public.ops_desk_set_windows(v_c2, '[{"day":1,"start":"22:00","end":"24:00"},{"day":2,"start":"00:00","end":"06:00"}]'::jsonb);
  perform pg_temp.back();
  perform pg_temp.rec('windows: a night shift across midnight covers both sides of midnight', 'true,true,false',
    ((select count(*) from private.ops_desk_on_duty(v_org, true, '2026-10-12 23:59:30+01'::timestamptz) where contact_id = v_c2) = 1)::text || ',' ||
    ((select count(*) from private.ops_desk_on_duty(v_org, true, '2026-10-13 00:00:30+01'::timestamptz) where contact_id = v_c2) = 1)::text || ',' ||
    ((select count(*) from private.ops_desk_on_duty(v_org, true, '2026-10-13 06:00:30+01'::timestamptz) where contact_id = v_c2) = 1)::text);
  perform pg_temp.act(v_admin);
  perform public.ops_desk_set_windows(v_c2, pg_temp.today_windows());
  perform pg_temp.back();
end $$;

-- 6. Reading (RLS) ---------------------------------------------------------------------------------------------------------
do $$
declare v_admin uuid := pg_temp.f('admin'); v_cmo uuid := pg_temp.f('cmo'); v_a uuid := pg_temp.f('A'); v_pat uuid := pg_temp.f('pat'); v_oa uuid := pg_temp.f('otheradmin'); t text; r text;
begin
  foreach t in array array['ops_desk_contacts', 'ops_desk_contact_windows', 'ops_desk_assignments', 'ops_desk_call_log', 'ops_desk_checklist_attestations'] loop
    r := pg_temp.q_as(v_admin, format('select (count(*) > 0)::text from public.%I', t)) || ',' || pg_temp.q_as(v_cmo, format('select (count(*) > 0)::text from public.%I', t)) || ',' ||
         pg_temp.q_as(v_a, format('select count(*)::text from public.%I', t)) || ',' || pg_temp.q_as(v_pat, format('select count(*)::text from public.%I', t)) || ',' ||
         pg_temp.q_as(v_oa, format('select count(*)::text from public.%I', t));
    perform pg_temp.rec('rls: ' || t || ' is read by the administrator and the CMO; a plain clinician, a patient and another organisation see nothing', 'true,true,0,0,0', r);
  end loop;
  perform pg_temp.rec('rls: anon cannot read the roster or the call log', '42501,42501',
    pg_temp.try_anon('select count(*) from public.ops_desk_contacts') || ',' || pg_temp.try_anon('select count(*) from public.ops_desk_call_log'));
  perform pg_temp.rec('rls: no client can write any of the tables directly', '42501,42501,42501',
    pg_temp.try_as(v_admin, format('insert into public.ops_desk_contacts (organisation_id, profile_id, role) values (%L, %L, ''primary'')', pg_temp.f('org'), pg_temp.f('A'))) || ',' ||
    pg_temp.try_as(v_admin, 'update public.ops_desk_contacts set is_active = true') || ',' ||
    pg_temp.try_as(v_cmo, format('insert into public.ops_desk_call_log (organisation_id, incident_id, called_by, callee_kind, callee_profile_id, outcome) values (%L, %L, %L, ''other'', %L, ''no_answer'')', pg_temp.f('org'), pg_temp.f('inc'), v_cmo, v_a)));
  perform pg_temp.rec('rls: another organisation''s administrator gets an empty roster and an empty call history from the functions', '[],[]',
    pg_temp.q_as(v_oa, 'select public.ops_desk_roster()::text') || ',' || pg_temp.q_as(v_oa, 'select public.ops_desk_calls(null, 50)::text'));
end $$;

-- 7. SABOTAGE: each protection removed, the matching check must flip -------------------------------------------------------
do $$
declare v_admin uuid := pg_temp.f('admin'); v_org uuid := pg_temp.f('org'); v_pat uuid := pg_temp.f('pat'); v_a uuid := pg_temp.f('A');
  v_pg uuid; v_ops3 uuid; v_c3 uuid;
begin
  -- controls (the real build)
  v_ops3 := pg_temp.mkuser(v_org, 'ops3', 'admin', '+2348042176593', false);   -- a number nobody confirmed
  perform pg_temp.act(v_admin);
  v_c3 := public.ops_desk_save_contact(v_ops3, 'deputy');
  perform public.ops_desk_set_windows(v_c3, pg_temp.today_windows());
  perform pg_temp.back();
  perform pg_temp.rec('control: an unconfirmed number cannot be activated (the real build)', '23514', pg_temp.activate(v_admin, v_c3));
  perform pg_temp.rec('control: the call log refuses an update (the real build)', '23514',
    pg_temp.try(format('update public.ops_desk_call_log set outcome = ''busy_or_off'' where id = %L', (select id from public.ops_desk_call_log limit 1))));

  -- (a) the assignment trigger removed: an expired page assigns nobody
  drop trigger ops_incidents_assign_ops_desk on public.ops_incidents;
  v_pg := pg_temp.mkpage(v_org, v_pat, pg_temp.mkevent(v_pat, pg_temp.f('rs')), v_a);
  perform private.expire_page(v_pg);
  perform pg_temp.sab('sabotage: without the assignment trigger an expired page is assigned to a contact on duty (real: 1)', '1',
    (select count(*)::text from public.ops_desk_assignments where incident_id = pg_temp.incident_of(v_pg)));

  -- (b) the append-only trigger removed: a logged call can be rewritten
  alter table public.ops_desk_call_log disable trigger ops_desk_call_log_append_only;
  perform pg_temp.sab('sabotage: without the append-only trigger a logged call cannot be rewritten (real: 23514)', '23514',
    pg_temp.try(format('update public.ops_desk_call_log set outcome = ''busy_or_off'' where id = %L', (select id from public.ops_desk_call_log limit 1))));
  alter table public.ops_desk_call_log enable trigger ops_desk_call_log_append_only;

  -- (c) the confirmation rule removed: any number typed on a profile counts
  create or replace function private.verified_profile_phone(p_profile uuid) returns text language sql stable security definer set search_path = ''
    as $f$ select phone from public.profiles where id = p_profile $f$;
  perform pg_temp.sab('sabotage: with the confirmation rule removed an unconfirmed number can be activated (real: 23514)', '23514', pg_temp.activate(v_admin, v_c3));

  -- (d) the gate removed: the guard switches on with a stale checklist while the CMO's config says gate
  perform pg_temp.backdate((select id from public.ops_desk_checklist_attestations where item_key = 'deputy_cover'), interval '91 days');
  create or replace function private.ops_desk_gate_on_call_cover_guard() returns trigger language plpgsql as $f$ begin return new; end $f$;
  perform pg_temp.guard_on('on_call_cover_ok', false);
  create or replace function private.ops_desk_sheet_people(p_incident uuid) returns table (kind text, pid uuid) language sql stable security definer set search_path = ''
    as $f$ select k.kind, pr.id from (values ('on_call_primary'), ('on_call_backup'), ('chief_medical_officer')) k(kind), public.profiles pr $f$;
  perform pg_temp.sab('sabotage: with the call sheet rule removed anyone can be logged as the on-call clinician (real: 22023)', '22023',
    pg_temp.try_as(pg_temp.f('ops2'), format('select public.log_ops_desk_call(%L, ''on_call_primary'', %L, ''no_answer'', null)', pg_temp.f('inc'), pg_temp.f('B'))));
  perform pg_temp.sab('sabotage: with the gate function emptied the guard switches on with a stale checklist (real: 23514)', '23514', pg_temp.guard_try(true));
end $$;

do $$
declare v_bad integer; v_caught integer; v_sab integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'Ops desk proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_sab from results where phase = 'sabotaged';
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_sab < 4 or v_caught < v_sab then
    raise exception 'VACUOUS TEST: only % of % sabotage steps changed the matching check; unchanged: %', v_caught, v_sab,
      (select string_agg(check_name || ' expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'sabotaged' and expected = actual);
  end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;

rollback;
