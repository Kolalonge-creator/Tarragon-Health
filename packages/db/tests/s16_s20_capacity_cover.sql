-- S16-S20 Stage 5 proof: capacity, cover, surge, fatigue and fire drills (migration *_s16_s20_capacity_cover.sql).
--
-- One rolled-back transaction. Every behaviour has a control, and the last section SABOTAGES the build (each removal must flip its check):
--   1. Rollout    the three enforcing switches ship OFF, v2 is inactive and unsigned, the pilot lead cap is a separate inactive version,
--                 only the CMO signs, tables and functions are locked down, the three cron jobs are staggered and unique.
--   2. Gate       W5.1: not enforced = open; enforced = the on_call_cover_ok guard, lead headroom, 72 hours of rota cover and the oldest
--                 open task each close NEW care pack sales; a CMO override reopens the signals but never a pause; an enrolled patient
--                 (active lead), a non-care-pack item and a test patient are never refused; headroom equals lead_capacity_status.
--   3. Modes      W5.2: only the CMO starts surge or a pause; an admin can only REQUEST a pause and it lapses unconfirmed; every mode
--                 expires by the clock even with a dead sweep; reasons and hours are bounded; everything is audited.
--   4. Queue      a pause hides routine OFFERS but never red, escalated or claimed work, nor red paging; surge widens routine offers to
--                 any eligible clinician and relaxes routine warning times; a pause closes the bookings guard only.
--   5. Rest       W5.3: with the switch on, 11 hours rest after a shift with overnight pages is a hard stop in the rota validators (swap
--                 too) and the availability door; only a CMO override with a reason gets through; cover offers after 2 overnight pages.
--   6. Drills     W5.4: off by default; picks rostered clinicians once per interval; results are informational (weight 0); the report
--                 gives p50/p95, share within target, by clinician, hour, route and device; permissioned.
--   7. SABOTAGE   the gate trigger, the rest rule, the pause term, the mode clock, the rota wrapper and the drill trigger are each
--                 removed and the matching check must flip.
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

-- real (non-test) and test users. A real patient is what the gate asks about; a test patient must always pass it.
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
-- swap the active capacity config for a one-off proof version (the signed or active rows are never edited)
create function pg_temp.use_rules(p jsonb) returns void language plpgsql as
$f$ declare v_next integer; v_base jsonb;
begin
  select rules into v_base from public.capacity_cover_config where version = 1;
  update public.capacity_cover_config set is_active = false where is_active;
  select max(version) + 1 into v_next from public.capacity_cover_config;
  insert into public.capacity_cover_config (version, is_active, effective_from, rules) values (v_next, true, current_date, v_base || p);
end $f$;
create function pg_temp.guard_on(p_key text, p_on boolean) returns void language plpgsql as
$f$ begin
  alter table public.go_live_guards disable trigger go_live_guards_guard;
  update public.go_live_guards set is_on = p_on, changed_at = case when p_on then now() end, changed_by = case when p_on then pg_temp.f('admin') end, change_note = case when p_on then 'proof fixture' end where key = p_key;
  alter table public.go_live_guards enable trigger go_live_guards_guard;
end $f$;
create function pg_temp.real_mode(p_org uuid, p_mode text, p_hours integer) returns uuid language sql as
$$ insert into public.ops_modes (organisation_id, mode, state, reason, started_at, expires_at, config_version, is_test)
   values (p_org, p_mode, 'active', 'proof fixture', now(), now() + make_interval(hours => p_hours), 1, false) returning id $$;
create function pg_temp.end_mode(p_id uuid) returns void language sql as
$$ update public.ops_modes set state = 'ended', ended_at = now(), end_kind = 'manual' where id = p_id $$;
create function pg_temp.order_try(p_org uuid, p_patient uuid, p_item uuid, p_price uuid) returns text language plpgsql as
$f$ begin
  insert into public.orders (organisation_id, buyer_profile_id, beneficiary_patient_id, catalog_item_id, price_id, amount_kobo, paystack_reference, is_test)
  values (p_org, p_patient, p_patient, p_item, p_price, 100000, 'tho_' || replace(gen_random_uuid()::text, '-', ''), (select is_test from public.profiles where id = p_patient));
  return 'ok';
exception when others then return sqlstate || ':' || coalesce(substring(sqlerrm from 1 for 40), '');
end $f$;
create function pg_temp.backdate(p_task uuid, p_set text) returns void language plpgsql as
$f$ begin
  perform set_config('tarragon.task_transition', 'on', true);
  execute format('update public.clinical_tasks set %s where id = %L', p_set, p_task);
  perform set_config('tarragon.task_transition', 'off', true);
end $f$;
-- a task whose offer window has ended is open (the same call the sweep makes); a no-op for a task that is not offered
create function pg_temp.release(p_task uuid) returns uuid language plpgsql as
$f$ begin
  if (select state::text from public.clinical_tasks where id = p_task) = 'offered_to_lead' then
    perform private.apply_task_transition(p_task, 'open', 'system', null, 'offer window ended');
  end if;
  return p_task;
end $f$;
create function pg_temp.clear_queue() returns void language plpgsql as
$f$ declare r record;
begin
  for r in select id from public.clinical_tasks where state not in ('completed', 'cancelled') loop
    perform private.apply_task_transition(r.id, 'cancelled', 'lead', null, 'proof cleanup of a fixture task');
  end loop;
end $f$;
-- the task id queue_next hands this clinician, or null when none
create function pg_temp.next_try(p_uid uuid, p_types text[]) returns uuid language plpgsql as
$f$ declare r jsonb;
begin
  perform pg_temp.act(p_uid);
  begin r := public.queue_next(p_types); exception when others then r := null; end;
  perform pg_temp.back();
  return (r -> 'task' ->> 'id')::uuid;
end $f$;
create function pg_temp.sees(p_uid uuid, p_task uuid) returns text language plpgsql as
$f$ declare r text;
begin
  select (exists (select 1 from private.queue_candidates(p_uid, false) c where c.id = p_task))::text into r;
  return r;
end $f$;
create function pg_temp.mkpage(p_org uuid, p_patient uuid, p_event uuid, p_to uuid, p_at timestamptz) returns uuid language plpgsql as
$f$ declare v uuid;
begin
  perform set_config('tarragon.paging_write', 'on', true);
  insert into public.pages (organisation_id, patient_id, triage_event_id, role, to_clinician_id, escalation_level, sent_at, config_version, is_test)
  values (p_org, p_patient, p_event, 'primary', p_to, 0, p_at, 1, true) returning id into v;
  perform set_config('tarragon.paging_write', 'off', true);
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

-- fixtures ----------------------------------------------------------------------------------------------------------------
do $$
declare v_org uuid; v_admin uuid; v_cmo uuid; v_a uuid; v_b uuid; v_c uuid; v_rs uuid; i integer; v_item uuid; v_cons uuid; v_price uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  update public.clinical_staff set active = false where is_test is not true;
  v_cmo := pg_temp.mkdoc(v_org, v_admin, 'cmo', 'chief_medical_officer', '{on_call}');
  v_a := pg_temp.mkdoc(v_org, v_admin, 'A', 'senior_medical_officer', '{lead_clinician,hypertension,adult_general,result_review,prescribing,on_call}');
  v_b := pg_temp.mkdoc(v_org, v_admin, 'B', 'senior_medical_officer', '{lead_clinician,hypertension,adult_general,result_review,prescribing,on_call}');
  v_c := pg_temp.mkdoc(v_org, v_admin, 'C', 'senior_medical_officer', '{hypertension,adult_general,on_call}');
  perform pg_temp.setf('org', v_org); perform pg_temp.setf('admin', v_admin); perform pg_temp.setf('cmo', v_cmo);
  perform pg_temp.setf('A', v_a); perform pg_temp.setf('B', v_b); perform pg_temp.setf('C', v_c);
  insert into public.triage_rule_sets (code, version, status, rules, approved_by, approved_at, note)
    values ('s20ctest', 1, 'approved', '{"code":"s20ctest","version":1}'::jsonb, v_cmo, now(), 'S20c proof fixture') returning id into v_rs;
  perform pg_temp.setf('rs', v_rs);
  for i in 1..8 loop perform pg_temp.setf('real' || i, pg_temp.mkuser(v_org, 'real-' || i, 'patient', false)); end loop;
  for i in 1..6 loop perform pg_temp.setf('tp' || i, pg_temp.mkuser(v_org, 'test-' || i, 'patient', true)); end loop;
  insert into public.catalog_items (organisation_id, code, kind, name_key, description_key, duration_days, grants_lead, active)
    values (v_org, 's20c_pack', 'membership', 's20c.name', 's20c.desc', 365, true, true) returning id into v_item;
  insert into public.catalog_items (organisation_id, code, kind, name_key, description_key, uses, grants_lead, active)
    values (v_org, 's20c_consult', 'consultation', 's20c.name', 's20c.desc', 1, false, false) returning id into v_cons;
  insert into public.prices (organisation_id, catalog_item_id, amount_kobo) values (v_org, v_item, 100000) returning id into v_price;
  perform pg_temp.setf('item', v_item); perform pg_temp.setf('cons', v_cons); perform pg_temp.setf('price', v_price);
  insert into public.prices (organisation_id, catalog_item_id, amount_kobo) values (v_org, v_cons, 100000) returning id into v_price;
  perform pg_temp.setf('cprice', v_price);
end $$;

-- 1. Rollout, grants, config --------------------------------------------------------------------------------------------------
do $$
declare v_cmo uuid := pg_temp.f('cmo'); v_a uuid := pg_temp.f('A'); v_admin uuid := pg_temp.f('admin'); r text;
begin
  perform pg_temp.rec('rollout: v1 is the active config with all three enforcing switches OFF', '0,0,0',
    (select (rules ->> 'gate_enforce') || ',' || (rules ->> 'hard_rest_enforce') || ',' || (rules ->> 'drill_enabled') from public.capacity_cover_config where version = 1 and is_active));
  perform pg_temp.rec('rollout: v2 is inactive, unsigned, with all three ON', 'false,false,1,1,1',
    (select is_active::text || ',' || (approved_at is not null)::text || ',' || (rules ->> 'gate_enforce') || ',' || (rules ->> 'hard_rest_enforce') || ',' || (rules ->> 'drill_enabled') from public.capacity_cover_config where version = 2));
  perform pg_temp.rec('rollout: the pilot lead cap is lead_config v2 (40, inactive, unsigned) and v1 (60) is untouched', '40,false,false,60,true',
    (select (rules ->> 'max_lead_patients') || ',' || is_active::text || ',' || (approved_at is not null)::text from public.lead_config where version = 2) || ',' ||
    (select (rules ->> 'max_lead_patients') || ',' || is_active::text from public.lead_config where version = 1));
  perform pg_temp.rec('config: a version with a zero or missing number is refused', '23514,23514',
    pg_temp.try($q$insert into public.capacity_cover_config (version, is_active, effective_from, rules) values (97, false, current_date, '{"gate_enforce":0}')$q$) || ',' ||
    pg_temp.try($q$insert into public.capacity_cover_config (version, is_active, effective_from, rules) select 98, false, current_date, jsonb_set(rules, '{rest_hours}', '0') from public.capacity_cover_config where version = 1$q$));
  perform pg_temp.rec('config: the active version cannot be edited in place', '23514',
    pg_temp.try($q$update public.capacity_cover_config set rules = jsonb_set(rules, '{rest_hours}', '9') where is_active$q$));
  perform pg_temp.rec('config: only the CMO signs (a clinician and an admin are refused)', '42501,42501',
    pg_temp.try_as(v_a, 'select public.sign_capacity_cover_config(2)') || ',' || pg_temp.try_as(v_admin, 'select public.sign_capacity_cover_config(2)'));
  perform pg_temp.rec('config: only the CMO signs the lead configuration', '42501,42501',
    pg_temp.try_as(v_a, 'select public.sign_lead_config(2)') || ',' || pg_temp.try_as(v_admin, 'select public.sign_lead_config(2)'));
  perform pg_temp.rec('tables have RLS on and anon holds nothing, authenticated only SELECT', '6,0',
    (select count(*)::text from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relrowsecurity
        and c.relname in ('capacity_cover_config', 'ops_modes', 'intake_overrides', 'rest_rule_overrides', 'fatigue_cover_offers', 'lead_config')) || ',' ||
    (select count(*)::text from information_schema.role_table_grants where table_schema = 'public'
      and table_name in ('capacity_cover_config', 'ops_modes', 'intake_overrides', 'rest_rule_overrides', 'fatigue_cover_offers')
      and (grantee in ('anon', 'PUBLIC') or (grantee = 'authenticated' and privilege_type <> 'SELECT'))));
  perform pg_temp.rec('no client can write the mode, override or offer tables', '42501,42501,42501',
    pg_temp.try_as(v_cmo, format('insert into public.ops_modes (organisation_id, mode, state, reason, config_version) values (%L, ''pause'', ''active'', ''x'', 1)', pg_temp.f('org'))) || ',' ||
    pg_temp.try_as(v_cmo, format('insert into public.intake_overrides (organisation_id, reason, expires_at, config_version) values (%L, ''x'', now() + interval ''1 hour'', 1)', pg_temp.f('org'))) || ',' ||
    pg_temp.try_as(v_cmo, format('insert into public.rest_rule_overrides (organisation_id, clinician_id, valid_from, valid_to, reason) values (%L, %L, now(), now() + interval ''1 hour'', ''x'')', pg_temp.f('org'), v_a)));
  perform pg_temp.rec('the four jobs exist, each on a schedule no other job shares', '4,0',
    (select count(*)::text from cron.job where jobname in ('ops-mode-sweep', 'fatigue-cover-sweep', 'fire-drills', 'intake-gate-watch')) || ',' ||
    (select count(*)::text from cron.job j where j.jobname in ('ops-mode-sweep', 'fatigue-cover-sweep', 'fire-drills', 'intake-gate-watch')
        and exists (select 1 from cron.job k where k.schedule = j.schedule and k.jobid <> j.jobid)));
  perform pg_temp.rec('the public RPCs are callable by signed-in users and never by anon', 'true,false',
    has_function_privilege('authenticated', 'public.fire_drill_report(integer)', 'EXECUTE')::text || ',' || has_function_privilege('anon', 'public.cmo_start_ops_mode(text,text,integer)', 'EXECUTE')::text);
  perform pg_temp.rec('the guard on_call_cover_ok now names where it is enforced', 'true',
    (select (array_to_string(enforced_in, ',') like '%intake gate%')::text from public.go_live_guards where key = 'on_call_cover_ok'));
end $$;

-- 2. The intake gate (W5.1) --------------------------------------------------------------------------------------------------
do $$
declare
  v_org uuid := pg_temp.f('org'); v_cmo uuid := pg_temp.f('cmo'); v_a uuid := pg_temp.f('A'); v_b uuid := pg_temp.f('B');
  v_item uuid := pg_temp.f('item'); v_price uuid := pg_temp.f('price'); v_cons uuid := pg_temp.f('cons'); v_cprice uuid := pg_temp.f('cprice');
  r1 uuid := pg_temp.f('real1'); r2 uuid := pg_temp.f('real2'); r3 uuid := pg_temp.f('real3'); r4 uuid := pg_temp.f('real4');
  t uuid; v_ov uuid; v_pause uuid; v_cap integer; v_free_rpc integer; i integer;
begin
  -- not enforced (v1): nothing is refused, even with no rota, no leads and the guard off
  perform pg_temp.rec('gate: NOT enforced by default: a care pack sale is accepted with no rota and no leads', 'ok', pg_temp.order_try(v_org, r1, v_item, v_price));
  perform pg_temp.rec('gate: the status is still readable and reports why it WOULD close', 'false,true',
    (private.intake_gate_status(v_org) ->> 'open') || ',' || ((private.intake_gate_status(v_org) -> 'reasons') ? 'rota_coverage')::text);

  perform pg_temp.use_rules('{"gate_enforce":1}');
  perform pg_temp.rec('gate: enforced, the on_call_cover_ok guard is off: NEW care pack sale refused', 'P0001:intake_paused', pg_temp.order_try(v_org, r2, v_item, v_price));
  perform pg_temp.guard_on('on_call_cover_ok', true);
  perform pg_temp.rec('gate: guard on, but no rota cover for 72 hours: refused', 'P0001:intake_paused', pg_temp.order_try(v_org, r2, v_item, v_price));
  perform pg_temp.rec('gate: the reason is rota coverage and lead headroom is fine', 'true,true',
    ((private.intake_gate_status(v_org) -> 'reasons') ? 'rota_coverage')::text || ',' || (not ((private.intake_gate_status(v_org) -> 'reasons') ? 'lead_headroom'))::text);

  -- cover the next 83 hours with a primary and a backup
  perform pg_temp.rota_row(v_org, now() - interval '1 hour', now() + interval '20 hours', v_a, v_b);
  perform pg_temp.rota_row(v_org, now() + interval '20 hours', now() + interval '41 hours', v_a, v_b);
  perform pg_temp.rota_row(v_org, now() + interval '41 hours', now() + interval '62 hours', v_a, v_b);
  perform pg_temp.rota_row(v_org, now() + interval '62 hours', now() + interval '83 hours', v_a, v_b);
  perform pg_temp.rec('gate: everything clear: open, and a new sale is accepted', 'true,ok',
    (private.intake_gate_status(v_org) ->> 'open') || ',' || pg_temp.order_try(v_org, r2, v_item, v_price));
  perform pg_temp.rec('gate: a gap only in the 73rd hour does not close it (the horizon is 72 hours)', 'true',
    (private.intake_gate_status(v_org) ->> 'open'));

  -- the headroom signal
  select (private.lead_headroom(v_org) ->> 'capacity')::integer into v_cap;
  perform pg_temp.rec('gate: two eligible leads give 120 places at the default cap', '120', v_cap::text);
  perform pg_temp.act(v_cmo);
  v_free_rpc := (public.lead_capacity_status(v_org) ->> 'free')::integer;
  perform pg_temp.back();
  perform pg_temp.rec('gate: headroom equals public.lead_capacity_status', v_free_rpc::text, (private.lead_headroom(v_org) ->> 'free'));
  update public.clinical_staff set max_lead_patients = 2 where profile_id = v_a;
  update public.clinical_staff set max_lead_patients = 1 where profile_id = v_b;
  perform pg_temp.rec('gate: 3 places free is exactly the minimum: not a headroom reason', 'false',
    ((private.intake_gate_status(v_org) -> 'reasons') ? 'lead_headroom')::text);
  update public.clinical_staff set max_lead_patients = 1 where profile_id = v_a;
  perform pg_temp.rec('gate: 2 places free: closed on headroom, sale refused', 'true,P0001:intake_paused',
    ((private.intake_gate_status(v_org) -> 'reasons') ? 'lead_headroom')::text || ',' || pg_temp.order_try(v_org, r3, v_item, v_price));
  -- an enrolled patient is never refused: an active lead already exists
  perform set_config('tarragon.lead_write', 'on', true);
  insert into public.lead_assignments (organisation_id, patient_id, clinician_id, state, source, config_version, is_test)
    values (v_org, r4, v_a, 'active', 'admin', 1, false);
  perform set_config('tarragon.lead_write', 'off', true);
  perform pg_temp.rec('gate: a patient who already has an active lead is NEVER refused (existing care)', 'ok', pg_temp.order_try(v_org, r4, v_item, v_price));
  perform pg_temp.rec('gate: a non care pack item (a consultation) is not asked', 'ok', pg_temp.order_try(v_org, r3, v_cons, v_cprice));
  perform pg_temp.rec('gate: a test patient is never refused by the signals', 'ok', pg_temp.order_try(v_org, pg_temp.f('tp1'), v_item, v_price));
  update public.clinical_staff set max_lead_patients = null where profile_id in (v_a, v_b);

  -- the CMO override reopens the signals (a real row; the RPC is proved below)
  insert into public.intake_overrides (organisation_id, reason, expires_at, config_version, is_test)
    values (v_org, 'proof override of the signals', now() + interval '2 hours', 1, false) returning id into v_ov;
  update public.clinical_staff set max_lead_patients = 1 where profile_id in (v_a, v_b);
  perform pg_temp.rec('gate: a CMO override reopens a closed gate', 'ok', pg_temp.order_try(v_org, r3, v_item, v_price));
  update public.intake_overrides set created_at = now() - interval '2 hours', expires_at = now() - interval '1 minute' where id = v_ov;
  perform pg_temp.rec('gate: an expired override reopens nothing (it ends by the clock)', 'P0001:intake_paused', pg_temp.order_try(v_org, pg_temp.f('real5'), v_item, v_price));
  update public.intake_overrides set expires_at = now() + interval '2 hours' where id = v_ov;
  v_pause := pg_temp.real_mode(v_org, 'pause', 2);
  perform pg_temp.rec('gate: a pause closes the gate even with an override and even when the gate is not enforced', 'P0001:intake_paused', pg_temp.order_try(v_org, pg_temp.f('real5'), v_item, v_price));
  perform pg_temp.rec('gate: a pause holds EVERY new sale, even a consultation for an enrolled patient (existing orders in payment are never undone)', 'P0001:intake_paused',
    pg_temp.order_try(v_org, r4, v_cons, v_cprice));
  perform pg_temp.end_mode(v_pause);
  perform pg_temp.rec('gate: the same consultation sale goes through once the pause has ended', 'ok', pg_temp.order_try(v_org, r4, v_cons, v_cprice));
  update public.intake_overrides set ended_at = now() where id = v_ov;
  perform pg_temp.use_rules('{"gate_enforce":0}');
  v_pause := pg_temp.real_mode(v_org, 'surge', 2);
  perform pg_temp.rec('gate: a surge closes new intake too, with the gate not enforced', 'P0001:intake_paused', pg_temp.order_try(v_org, pg_temp.f('real5'), v_item, v_price));
  perform pg_temp.end_mode(v_pause);
  perform pg_temp.rec('gate: with the mode ended and the gate not enforced it is open again', 'ok', pg_temp.order_try(v_org, pg_temp.f('real5'), v_item, v_price));
  update public.clinical_staff set max_lead_patients = null where profile_id in (v_a, v_b);

  -- the oldest-task signal
  perform pg_temp.use_rules('{"gate_enforce":1}');
  t := private.create_clinical_task(pg_temp.f('real6'), 'critical_result_review');
  perform pg_temp.backdate(t, 'created_at = now() - interval ''3 days''');
  perform pg_temp.rec('gate: the oldest open class 2 task is past its warning time: closed on oldest_task', 'true',
    ((private.intake_gate_status(v_org) -> 'reasons') ? 'oldest_task')::text);
  perform pg_temp.rec('gate: ...and a new sale is refused', 'P0001:intake_paused', pg_temp.order_try(v_org, pg_temp.f('real7'), v_item, v_price));
  -- a routine class 5 task at 800 minutes breaches (warn 720) until a surge multiplies the routine warning time
  perform pg_temp.clear_queue();
  t := pg_temp.release(private.create_clinical_task(pg_temp.f('real6'), 'symptom_review'));
  perform pg_temp.backdate(t, 'created_at = now() - interval ''800 minutes''');
  perform pg_temp.rec('surge: a routine task at 800 minutes (warning 720) is a breach without surge', 'true',
    ((private.intake_gate_status(v_org) -> 'reasons') ? 'oldest_task')::text);
  v_pause := pg_temp.real_mode(v_org, 'surge', 2);
  perform pg_temp.rec('surge: the routine warning time is doubled, so it is not read as a breach', 'false',
    ((private.intake_gate_status(v_org) -> 'reasons') ? 'oldest_task')::text);
  perform pg_temp.end_mode(v_pause);
  perform pg_temp.clear_queue();
  perform pg_temp.rec('gate: queue clear, everything fine: open again', 'true', (private.intake_gate_status(v_org) ->> 'open'));
  perform pg_temp.guard_on('on_call_cover_ok', false);
  perform pg_temp.rec('gate: guard switched off again: closed (fail closed)', 'P0001:intake_paused', pg_temp.order_try(v_org, pg_temp.f('real7'), v_item, v_price));
  insert into public.intake_overrides (organisation_id, reason, expires_at, config_version, is_test)
    values (v_org, 'proof override of the guard', now() + interval '2 hours', 1, false) returning id into v_ov;
  perform pg_temp.rec('gate: a CMO override also reopens a closed guard', 'ok', pg_temp.order_try(v_org, pg_temp.f('real7'), v_item, v_price));
  update public.intake_overrides set ended_at = now() where id = v_ov;
  perform pg_temp.guard_on('on_call_cover_ok', true);
  update public.clinical_staff set max_lead_patients = 1 where profile_id = v_a;
  update public.clinical_staff set max_lead_patients = null where profile_id = v_b;
  perform pg_temp.rec('gate: any one signal closes it (headroom restored, guard on, rota covered, queue clear: open)', 'ok', pg_temp.order_try(v_org, pg_temp.f('real7'), v_item, v_price));
  update public.clinical_staff set max_lead_patients = null where profile_id = v_a;
end $$;

-- 3. Surge and pause (W5.2) --------------------------------------------------------------------------------------------------
do $$
declare
  v_org uuid := pg_temp.f('org'); v_cmo uuid := pg_temp.f('cmo'); v_a uuid := pg_temp.f('A'); v_b uuid := pg_temp.f('B'); v_admin uuid := pg_temp.f('admin');
  v_id uuid; v_req uuid; v_n integer; v_surge uuid; v_ov uuid; v_text text;
begin
  perform pg_temp.use_rules('{"gate_enforce":0}');
  perform pg_temp.clear_rota();
  perform pg_temp.rota_row(v_org, now() - interval '1 hour', now() + interval '10 hours', v_a, v_b);

  perform pg_temp.rec('modes: a clinician cannot start a surge or a pause', '42501,42501',
    pg_temp.try_as(v_a, $q$select public.cmo_start_ops_mode('surge', 'a long enough written reason', 2)$q$) || ',' || pg_temp.try_as(v_a, $q$select public.cmo_start_ops_mode('pause', 'a long enough written reason', 2)$q$));
  perform pg_temp.rec('modes: an administrator cannot start one either (request only)', '42501',
    pg_temp.try_as(v_admin, $q$select public.cmo_start_ops_mode('pause', 'a long enough written reason', 2)$q$));
  perform pg_temp.rec('modes: the CMO needs a written reason and at most the maximum hours', '22023,22023,22023,22023',
    pg_temp.try_as(v_cmo, $q$select public.cmo_start_ops_mode('surge', 'short', 2)$q$) || ',' ||
    pg_temp.try_as(v_cmo, $q$select public.cmo_start_ops_mode('surge', 'a long enough written reason', 13)$q$) || ',' ||
    pg_temp.try_as(v_cmo, $q$select public.cmo_start_ops_mode('pause', 'a long enough written reason', 25)$q$) || ',' ||
    pg_temp.try_as(v_cmo, $q$select public.cmo_start_ops_mode('pause', 'a long enough written reason', 0)$q$));
  perform pg_temp.rec('modes: a mode name that does not exist is refused', '22023', pg_temp.try_as(v_cmo, $q$select public.cmo_start_ops_mode('freeze', 'a long enough written reason', 2)$q$));

  -- surge by the CMO
  perform pg_temp.act(v_cmo);
  v_surge := public.cmo_start_ops_mode('surge', 'Heavy week with two clinicians away on leave', 6);
  perform pg_temp.back();
  perform pg_temp.rec('modes: the CMO starts a surge; it is recorded, expires in 6 hours and is audited', 'active,6,1',
    (select state from public.ops_modes where id = v_surge) || ',' || (select round(extract(epoch from (expires_at - started_at)) / 3600)::text from public.ops_modes where id = v_surge) || ',' ||
    (select count(*)::text from public.audit_log where entity_id = v_surge and action = 'ops_mode.started'));
  perform pg_temp.rec('modes: a second surge while one is on is refused', '22023', pg_temp.try_as(v_cmo, $q$select public.cmo_start_ops_mode('surge', 'a long enough written reason', 2)$q$));
  perform pg_temp.rec('surge: the on-call BACKUP is told, in app, with neutral wording', '1,true',
    (select count(*)::text from public.notifications where recipient_id = v_b and channel = 'in_app' and payload ->> 'audience' = 'surge') || ',' ||
    (select (payload ->> 'message' !~* '(patient|blood|pressure|diagnos|emergenc)')::text from public.notifications where recipient_id = v_b and payload ->> 'audience' = 'surge' limit 1));
  perform pg_temp.rec('surge: the mode status reaches a clinician without reasons', 'true,false',
    (pg_temp.q_as(v_a, 'select (public.ops_mode_status() ->> ''surge'') is not null') ) || ',' || (pg_temp.q_as(v_a, 'select (public.ops_mode_status() ->> ''pause'') is not null')));
  -- expiry by the clock, with the sweep job dead
  update public.ops_modes set expires_at = now() - interval '1 second' where id = v_surge;
  perform pg_temp.rec('modes: a surge past its time is OFF at once, even if the sweep has not run', 'false', private.ops_mode_active('surge', v_org, true)::text);
  perform private.sweep_ops_modes();
  perform pg_temp.rec('modes: the sweep marks it lapsed (expired) and tells the reviewers', 'lapsed,expired,true',
    (select state || ',' || end_kind from public.ops_modes where id = v_surge) || ',' ||
    ((select count(*) from public.audit_log where entity_id = v_surge and action = 'ops_mode.expired') = 1)::text);

  -- an admin REQUESTS a pause
  perform pg_temp.rec('pause: a clinician cannot request one', '42501', pg_temp.try_as(v_a, $q$select public.request_ops_pause('a long enough written reason')$q$));
  perform pg_temp.rec('pause: the request needs a written reason', '22023', pg_temp.try_as(v_admin, $q$select public.request_ops_pause('short')$q$));
  perform pg_temp.act(v_admin);
  v_req := public.request_ops_pause('Payment partner outage; hold new sales until it is fixed');
  perform pg_temp.back();
  perform pg_temp.rec('pause: the admin''s request does NOT pause anything', 'requested,false,true',
    (select state from public.ops_modes where id = v_req) || ',' || private.ops_mode_active('pause', v_org, true)::text || ',' || private.intake_open(pg_temp.f('tp2'))::text);
  perform pg_temp.rec('pause: the request waits 240 minutes for the CMO', '240',
    (select round(extract(epoch from (confirm_by - requested_at)) / 60)::text from public.ops_modes where id = v_req));
  perform pg_temp.rec('pause: the CMO is told (in app) to confirm', 'true',
    ((select count(*) from public.notifications where recipient_id = v_cmo and payload ->> 'audience' = 'ops_mode' and payload ->> 'subject' = 'Pause request waiting') >= 1)::text);
  perform pg_temp.rec('pause: an administrator cannot confirm their own request', '42501', pg_temp.try_as(v_admin, format('select public.cmo_decide_ops_pause(%L, true)', v_req)));
  perform pg_temp.rec('pause: a second request while one is waiting is refused', '22023', pg_temp.try_as(v_admin, $q$select public.request_ops_pause('another long enough written reason')$q$));
  -- the request lapses unconfirmed
  update public.ops_modes set confirm_by = now() - interval '1 minute' where id = v_req;
  perform pg_temp.rec('pause: confirming AFTER the time is refused in plain words, and nothing is paused', '22023,false',
    pg_temp.try_as(v_cmo, format('select public.cmo_decide_ops_pause(%L, true, 2)', v_req)) || ',' || private.ops_mode_active('pause', v_org, true)::text);
  perform private.sweep_ops_modes();
  perform pg_temp.rec('pause: the sweep records the unconfirmed request as lapsed', 'lapsed,unconfirmed',
    (select state || ',' || end_kind from public.ops_modes where id = v_req));
  -- a request confirmed in time
  perform pg_temp.act(v_admin);
  v_req := public.request_ops_pause('Second request, confirmed in time by the clinical lead');
  perform pg_temp.back();
  perform pg_temp.act(v_cmo);
  perform public.cmo_decide_ops_pause(v_req, true, 3);
  perform pg_temp.back();
  perform pg_temp.rec('pause: the CMO confirms in time: active for 3 hours, started by the CMO, requested by the admin, audited', 'active,3,true,true',
    (select state || ',' || round(extract(epoch from (expires_at - started_at)) / 3600)::text || ',' || (started_by = v_cmo)::text || ',' || (requested_by = v_admin)::text from public.ops_modes where id = v_req));
  perform pg_temp.rec('pause: a test patient''s new sale/enrolment is now refused (test pause)', 'false', private.intake_open(pg_temp.f('tp2'))::text);
  perform pg_temp.rec('pause: but a REAL patient is untouched by a test CMO''s pause (INV-13)', 'true', private.intake_open(pg_temp.f('real8'))::text);
  perform pg_temp.act(v_cmo);
  perform public.cmo_end_ops_mode(v_req, 'resolved early');
  perform pg_temp.back();
  perform pg_temp.rec('pause: the CMO can end it early, and it is open again', 'ended,manual,true',
    (select state || ',' || end_kind from public.ops_modes where id = v_req) || ',' || private.intake_open(pg_temp.f('tp2'))::text);
  -- decline
  perform pg_temp.act(v_admin);
  v_req := public.request_ops_pause('Third request, which the lead declines as not needed');
  perform pg_temp.back();
  perform pg_temp.act(v_cmo);
  perform public.cmo_decide_ops_pause(v_req, false, null, 'Not needed');
  perform pg_temp.back();
  perform pg_temp.rec('pause: a declined request pauses nothing', 'declined,false',
    (select state from public.ops_modes where id = v_req) || ',' || private.ops_mode_active('pause', v_org, true)::text);
  perform pg_temp.act(v_admin);
  v_req := public.request_ops_pause('Fourth request, used to prove the maximum duration');
  perform pg_temp.back();
  perform pg_temp.rec('pause: the maximum duration is enforced on confirm', '22023', pg_temp.try_as(v_cmo, format('select public.cmo_decide_ops_pause(%L, true, 99)', v_req)));
  perform pg_temp.act(v_cmo); perform public.cmo_decide_ops_pause(v_req, false, null, 'proof'); perform pg_temp.back();
  -- override RPC
  perform pg_temp.rec('override: only the CMO, with a reason, at most 24 hours', '42501,22023,22023',
    pg_temp.try_as(v_a, $q$select public.cmo_set_intake_override('a long enough written reason', 2)$q$) || ',' ||
    pg_temp.try_as(v_cmo, $q$select public.cmo_set_intake_override('short', 2)$q$) || ',' ||
    pg_temp.try_as(v_cmo, $q$select public.cmo_set_intake_override('a long enough written reason', 25)$q$));
  perform pg_temp.act(v_cmo);
  v_ov := public.cmo_set_intake_override('Pilot launch week: one clinician is training a colleague', 4);
  perform pg_temp.back();
  perform pg_temp.rec('override: recorded with reason, expiry and an audit row; a second one while open is refused', 'true,1,22023',
    ((select expires_at - created_at from public.intake_overrides where id = v_ov) = interval '4 hours')::text || ',' ||
    (select count(*)::text from public.audit_log where entity_id = v_ov and action = 'intake_override.set') || ',' ||
    pg_temp.try_as(v_cmo, $q$select public.cmo_set_intake_override('another long enough written reason', 2)$q$));
  perform pg_temp.act(v_cmo); perform public.cmo_end_intake_override(v_ov); perform pg_temp.back();
  perform pg_temp.rec('override: the CMO can end it', 'true', ((select ended_at from public.intake_overrides where id = v_ov) is not null)::text);
  -- overview permissions
  perform pg_temp.rec('overview: the CMO and an admin can read it, a clinician cannot', 'ok,ok,42501',
    pg_temp.try_as(v_cmo, 'select public.intake_gate_overview()') || ',' || pg_temp.try_as(v_admin, 'select public.intake_gate_overview()') || ',' || pg_temp.try_as(v_a, 'select public.intake_gate_overview()'));
  perform pg_temp.rec('overview: a clinician sees no mode or override rows (RLS)', '0,0',
    pg_temp.q_as(v_a, 'select count(*)::text from public.ops_modes') || ',' || pg_temp.q_as(v_a, 'select count(*)::text from public.intake_overrides'));
  perform pg_temp.rec('overview: the CMO sees them', 'true', (pg_temp.q_as(v_cmo, 'select count(*)::text from public.ops_modes')::integer >= 3)::text);
end $$;

-- 4. The queue and the paging engine under a pause or a surge -------------------------------------------------------------------
do $$
declare
  v_org uuid := pg_temp.f('org'); v_cmo uuid := pg_temp.f('cmo'); v_a uuid := pg_temp.f('A'); v_b uuid := pg_temp.f('B'); v_c uuid := pg_temp.f('C');
  tp1 uuid := pg_temp.f('tp1'); tp2 uuid := pg_temp.f('tp2'); tp3 uuid := pg_temp.f('tp3'); tp4 uuid := pg_temp.f('tp4'); tp5 uuid := pg_temp.f('tp5');
  t_red uuid; t_crit uuid; t_routine uuid; t_amber uuid; t_claimed uuid; v_pause uuid; v_surge uuid; v_page uuid; v_ev uuid; v_open boolean; v_text text; v_cid uuid;
begin
  perform pg_temp.use_rules('{"gate_enforce":0}');
  perform pg_temp.clear_queue();
  -- A leads tp3; tp1 and tp2 have no lead
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id) values (v_org, tp3, v_a);
  t_crit := private.create_clinical_task(tp1, 'critical_result_review');                 -- class 2, open
  t_routine := pg_temp.release(private.create_clinical_task(tp2, 'routine_result_review'));   -- class 8, open (its offer window ended)
  t_amber := private.create_clinical_task(tp3, 'amber_bp_review');                       -- class 4, offered to its lead A
  perform pg_temp.rec('queue: baseline: B sees the open routine and critical tasks, not the offer held for A', 'true,true,false',
    pg_temp.sees(v_b, t_routine) || ',' || pg_temp.sees(v_b, t_crit) || ',' || pg_temp.sees(v_b, t_amber));
  perform pg_temp.rec('queue: baseline: A (the lead) sees the offer', 'true', pg_temp.sees(v_a, t_amber));

  -- surge (test row, started by the test CMO through the RPC)
  perform pg_temp.act(v_cmo);
  v_surge := public.cmo_start_ops_mode('surge', 'Surge for the proof: many routine tasks waiting', 2);
  perform pg_temp.back();
  perform pg_temp.rec('surge: a routine (class 4+) offer held for its lead is now visible to another eligible clinician', 'true', pg_temp.sees(v_b, t_amber));
  perform pg_temp.rec('surge: ...and still visible to its lead', 'true', pg_temp.sees(v_a, t_amber));
  perform pg_temp.act(v_cmo); perform public.cmo_end_ops_mode(v_surge, 'proof'); perform pg_temp.back();
  perform pg_temp.rec('surge: ended, the offer goes back to its lead only', 'false', pg_temp.sees(v_b, t_amber));
  perform pg_temp.rec('surge: with no surge a non-lead cannot claim an offered routine task', 'null', coalesce(pg_temp.next_try(v_b, array['amber_bp_review'])::text, 'null'));
  perform pg_temp.act(v_cmo); v_surge := public.cmo_start_ops_mode('surge', 'Surge for the proof: second part, the claim itself', 2); perform pg_temp.back();
  v_cid := pg_temp.next_try(v_b, array['amber_bp_review']);
  perform pg_temp.rec('surge: another eligible clinician can actually CLAIM it (the claim path agrees with the list)', 'true,claimed',
    (v_cid = t_amber)::text || ',' || coalesce((select state::text from public.clinical_tasks where id = t_amber), 'none'));
  perform private.apply_task_transition(t_amber, 'cancelled', 'lead', null, 'proof: release the surge claim');
  perform pg_temp.act(v_cmo); perform public.cmo_end_ops_mode(v_surge, 'proof'); perform pg_temp.back();

  -- an already-claimed task
  t_claimed := pg_temp.release(private.create_clinical_task(pg_temp.f('tp4'), 'routine_result_review'));
  perform pg_temp.act(v_b);
  perform public.queue_next(array['routine_result_review']);
  perform pg_temp.back();
  perform pg_temp.rec('queue: B holds a claimed routine task before the pause', 'claimed', (select state::text from public.clinical_tasks where id in (t_claimed, t_routine) and state = 'claimed' limit 1));

  -- pause
  perform pg_temp.act(v_cmo);
  v_pause := public.cmo_start_ops_mode('pause', 'Pause for the proof: new intake held while we recover', 2);
  perform pg_temp.back();
  perform pg_temp.rec('pause: a routine OPEN task (class 8) is not offered while paused', 'false', pg_temp.sees(v_a, (select id from public.clinical_tasks where state = 'open' and priority_class = 8 limit 1)));
  perform pg_temp.rec('pause: a critical result (class 2) is still offered', 'true', pg_temp.sees(v_a, t_crit));
  perform pg_temp.rec('pause: work already CLAIMED stays with its owner', 'claimed', (select state::text from public.clinical_tasks where state = 'claimed' and priority_class = 8 limit 1));
  perform pg_temp.rec('pause: the claim can still be completed or worked (the claim row is live)', '1',
    (select count(*)::text from public.task_claims where clinician_id = v_b and ended_at is null));
  perform pg_temp.rec('pause: B''s next task is a critical one, not a held routine one', 'critical_result_review',
    (pg_temp.q_as(v_a, $q$select (public.queue_next(null) -> 'task' ->> 'type')$q$)));
  -- red paging is untouched
  v_ev := pg_temp.mkevent(tp5, pg_temp.f('rs'));
  perform pg_temp.clear_rota();
  perform pg_temp.rota_row(v_org, now() - interval '1 minute', now() + interval '10 hours', v_a, v_b);
  v_page := public.create_red_page(v_ev);
  perform pg_temp.rec('pause: a RED page is created and sent to the on-call clinician during a pause', 'true,1',
    (v_page is not null)::text || ',' || (select count(*)::text from public.pages where id = v_page and to_clinician_id = v_a));
  perform pg_temp.act(v_a); perform public.acknowledge_page(v_page); perform pg_temp.back();
  perform pg_temp.rec('pause: and it can be acknowledged during a pause', 'true', ((select acknowledged_at from public.pages where id = v_page) is not null)::text);
  perform pg_temp.act(v_a); perform public.close_page(v_page, 'proof: closing the settled page'); perform pg_temp.back();
  perform pg_temp.rec('pause: the page notifications went out on push, in app and email, never sms', 'false',
    (exists (select 1 from public.notifications where source_id = v_page and channel::text in ('sms', 'voice')))::text);
  -- bookings: a pause closes NEW bookings and NEW consultation requests only; care already paid or booked is not touched
  perform pg_temp.guard_on('clinical_operations_enabled', true);
  perform pg_temp.rec('pause: with a (test) pause on, a NEW booking for a test patient with a test clinician is refused', 'false',
    private.go_live_open_intake('clinical_operations_enabled', tp2, v_a)::text);
  perform pg_temp.rec('pause: ...and a NEW video visit request, and the guard itself and the existing-care check stay open', 'false,true,true',
    private.go_live_open_patient_intake('clinical_operations_enabled', tp2)::text || ',' || private.go_live_guard_on('clinical_operations_enabled')::text || ',' ||
    private.go_live_open('clinical_operations_enabled', tp2, v_a)::text);
  perform pg_temp.rec('pause: only the two entry points that start NEW work ask the intake question (the hold used by a paid, booked or already offered slot does not)', 'true,true,false,false,false,false,false',
    (pg_get_functiondef('private.create_followup_offer(uuid,uuid,timestamptz[],text,integer)'::regprocedure) like '%go_live_open_intake%')::text || ',' ||
    (pg_get_functiondef('private.video_visit_requests_go_live_guard()'::regprocedure) like '%go_live_open_patient_intake%')::text || ',' ||
    (pg_get_functiondef('public.hold_appointment_slot(uuid,uuid,appointment_type,appointment_consultation_method,timestamptz,timestamptz,text,text,text,uuid,uuid,uuid,integer)'::regprocedure) like '%_intake%')::text || ',' ||
    (pg_get_functiondef('public.accept_video_visit_request(uuid)'::regprocedure) like '%_intake%')::text || ',' ||
    (pg_get_functiondef('public.select_video_visit_alternate_slot(uuid,uuid)'::regprocedure) like '%_intake%')::text || ',' ||
    (pg_get_functiondef('public.confirm_appointment_booking(uuid)'::regprocedure) like '%_intake%')::text || ',' ||
    (pg_get_functiondef('public.service_get_encounter_room(uuid)'::regprocedure) like '%_intake%')::text);
  v_text := pg_temp.real_mode(v_org, 'pause', 1)::text;
  perform pg_temp.rec('pause: a REAL pause closes a NEW booking for a real patient', 'false', private.go_live_open_intake('clinical_operations_enabled', pg_temp.f('real8'), v_a)::text);
  perform pg_temp.rec('pause: ...and still not the guard, the existing-care check, or any other guard', 'true,true,true',
    private.go_live_guard_on('clinical_operations_enabled')::text || ',' || private.go_live_open('clinical_operations_enabled', pg_temp.f('real8'), v_a)::text || ',' || private.go_live_guard_on('on_call_cover_ok')::text);
  perform pg_temp.end_mode(v_text::uuid);
  perform pg_temp.rec('pause: ended, new bookings reopen', 'true', private.go_live_open_intake('clinical_operations_enabled', pg_temp.f('real8'), v_a)::text);
  perform pg_temp.rec('pause: any other guard key is never closed by a pause', 'true', private.go_live_open_intake('on_call_cover_ok', tp2, v_a)::text);
  perform pg_temp.guard_on('clinical_operations_enabled', false);
  perform pg_temp.act(v_cmo); perform public.cmo_end_ops_mode(v_pause, 'proof'); perform pg_temp.back();
  perform pg_temp.rec('pause: ended, the routine task is offered again', 'true', pg_temp.sees(v_a, (select id from public.clinical_tasks where state = 'open' and priority_class = 8 limit 1)));
  perform pg_temp.clear_queue();
end $$;

-- 5. Hard rest rule and cover offers (W5.3) ------------------------------------------------------------------------------------
do $$
declare
  v_org uuid := pg_temp.f('org'); v_cmo uuid := pg_temp.f('cmo'); v_a uuid := pg_temp.f('A'); v_b uuid := pg_temp.f('B'); v_c uuid := pg_temp.f('C'); v_admin uuid := pg_temp.f('admin');
  t0 timestamptz := date_trunc('hour', now()); h integer; r_old uuid; r_next uuid; v_ov uuid; v_off uuid; v_n integer; v_def text;
  p1 uuid := pg_temp.f('tp1'); p2 uuid := pg_temp.f('tp2'); p3 uuid := pg_temp.f('tp3'); e1 uuid; e2 uuid; e3 uuid; pg1 uuid;
  s1 timestamptz; s2 timestamptz;
begin
  h := extract(hour from (t0 - interval '8 hours') at time zone 'Africa/Lagos')::integer;
  perform pg_temp.clear_rota();
  -- A worked a 12 hour shift that ended 2 hours ago; two pages at (T0-8h)+10 and +20 minutes, in the same local hour
  r_old := pg_temp.rota_row(v_org, t0 - interval '14 hours', t0 - interval '2 hours', v_a, v_b);
  r_next := pg_temp.rota_row(v_org, t0 + interval '20 hours', t0 + interval '30 hours', v_a, v_b);
  e1 := pg_temp.mkevent(p1, pg_temp.f('rs')); e2 := pg_temp.mkevent(p2, pg_temp.f('rs')); e3 := pg_temp.mkevent(p3, pg_temp.f('rs'));
  perform pg_temp.mkpage(v_org, p1, e1, v_a, t0 - interval '8 hours' + interval '10 minutes');
  perform pg_temp.mkpage(v_org, p2, e2, v_a, t0 - interval '8 hours' + interval '20 minutes');
  s1 := t0 - interval '2 hours' + interval '6 hours';     -- 6 hours after the shift ended
  s2 := t0 - interval '2 hours' + interval '11 hours';    -- exactly 11 hours after

  -- the window for these pages (their own local hour): everything else at the defaults
  perform pg_temp.use_rules(jsonb_build_object('overnight_start_hour', h, 'overnight_end_hour', (h + 1) % 24));
  perform pg_temp.rec('rest: counts the overnight pages inside the shift for A', '2,0',
    private.overnight_page_count(v_a, t0 - interval '14 hours', t0 - interval '2 hours')::text || ',' || private.overnight_page_count(v_b, t0 - interval '14 hours', t0 - interval '2 hours')::text);
  perform pg_temp.rec('rest: pages outside the overnight hour do not count', '0',
    private.overnight_page_count(v_a, t0 - interval '7 hours', t0 - interval '2 hours')::text);
  perform pg_temp.rec('rest: NOT enforced by default: a 6 hour turnaround after overnight pages is allowed', 'ok',
    pg_temp.try(format('select private.rest_rule_check(%L, %L)', v_a, s1)));
  perform pg_temp.rec('rest: ...and declaring queue time is allowed too', 'ok',
    pg_temp.try(format('insert into public.availability_blocks (organisation_id, clinician_id, starts_at, ends_at, kind, is_test) values (%L, %L, %L, %L, ''queue'', true)', v_org, v_a, s1, s1 + interval '3 hours')));

  perform pg_temp.use_rules(jsonb_build_object('overnight_start_hour', h, 'overnight_end_hour', (h + 1) % 24, 'hard_rest_enforce', 1));
  perform pg_temp.rec('rest: ENFORCED: a start 6 hours after a shift with overnight pages is a hard stop', '23514', pg_temp.try(format('select private.rest_rule_check(%L, %L)', v_a, s1)));
  perform pg_temp.rec('rest: exactly 11 hours later is allowed', 'ok', pg_temp.try(format('select private.rest_rule_check(%L, %L)', v_a, s2)));
  perform pg_temp.rec('rest: the other clinician (no pages) is not held', 'ok', pg_temp.try(format('select private.rest_rule_check(%L, %L)', v_c, s1)));
  perform pg_temp.rec('rest: the rota door refuses it (set / validator)', '23514',
    pg_temp.try(format('select private.rota_validate_clinician(%L, %L, %L, %L)', v_a, v_org, s1, s1 + interval '8 hours')));
  perform pg_temp.rec('rest: the swap door refuses it too (cover for an ill colleague is not exempt)', '23514',
    pg_temp.try(format('select private.rota_validate_clinician_swap(%L, %L, %L, %L)', v_a, v_org, s1, s1 + interval '8 hours')));
  perform pg_temp.rec('rest: the availability door refuses on-call and queue time', '23514,23514',
    pg_temp.try(format('insert into public.availability_blocks (organisation_id, clinician_id, starts_at, ends_at, kind, is_test) values (%L, %L, %L, %L, ''queue'', true)', v_org, v_a, s1 + interval '210 minutes', s1 + interval '7 hours')) || ',' ||
    pg_temp.try(format('insert into public.availability_blocks (organisation_id, clinician_id, starts_at, ends_at, kind, is_test) values (%L, %L, %L, %L, ''on_call'', true)', v_org, v_a, s1 + interval '210 minutes', s1 + interval '7 hours')));
  perform pg_temp.rec('rest: bookable consultations are not on call or queue, so they are not held', 'ok',
    pg_temp.try(format('insert into public.availability_blocks (organisation_id, clinician_id, starts_at, ends_at, kind, is_test) values (%L, %L, %L, %L, ''bookable_consultations'', true)', v_org, v_a, s1 + interval '8 hours', s1 + interval '11 hours')));
  perform pg_temp.rec('rest: the refusal names the rule and says only the chief medical officer can override', 'true,true',
    (pg_temp.msg(format('select private.rest_rule_check(%L, %L)', v_a, s1)) like 'hard_rest_rule:%')::text || ',' ||
    (pg_temp.msg(format('select private.rest_rule_check(%L, %L)', v_a, s1)) like '%only the chief medical officer can override%')::text);
  -- who can override
  perform pg_temp.rec('rest override: a clinician and an admin cannot', '42501,42501',
    pg_temp.try_as(v_b, format('select public.cmo_override_rest_rule(%L, %L, %L, ''a long enough written reason'')', v_a, s1 - interval '1 hour', s1 + interval '12 hours')) || ',' ||
    pg_temp.try_as(v_admin, format('select public.cmo_override_rest_rule(%L, %L, %L, ''a long enough written reason'')', v_a, s1 - interval '1 hour', s1 + interval '12 hours')));
  perform pg_temp.rec('rest override: the CMO needs a written reason and a window of at most 3 days', '22023,22023',
    pg_temp.try_as(v_cmo, format('select public.cmo_override_rest_rule(%L, %L, %L, ''short'')', v_a, s1 - interval '1 hour', s1 + interval '12 hours')) || ',' ||
    pg_temp.try_as(v_cmo, format('select public.cmo_override_rest_rule(%L, %L, %L, ''a long enough written reason'')', v_a, s1 - interval '1 hour', s1 + interval '5 days')));
  perform pg_temp.act(v_cmo);
  v_ov := public.cmo_override_rest_rule(v_a, s1 - interval '1 hour', s1 + interval '12 hours', 'Only qualified clinician available for the weekend rota');
  perform pg_temp.back();
  perform pg_temp.rec('rest override: with the CMO''s recorded override the start is allowed, and it is audited', 'ok,1',
    pg_temp.try(format('select private.rest_rule_check(%L, %L)', v_a, s1)) || ',' || (select count(*)::text from public.audit_log where entity_id = v_ov and action = 'rest_rule.overridden'));
  perform pg_temp.rec('rest override: it covers only its window and only that clinician', 'ok,23514',
    pg_temp.try(format('select private.rest_rule_check(%L, %L)', v_c, s1)) || ',' || pg_temp.try(format('select private.rest_rule_check(%L, %L)', v_a, s1 - interval '3 hours')));
  perform pg_temp.rec('rest override: a clinician sees their own, not another''s (RLS)', '1,0',
    pg_temp.q_as(v_a, 'select count(*)::text from public.rest_rule_overrides') || ',' || pg_temp.q_as(v_c, 'select count(*)::text from public.rest_rule_overrides'));
  select pg_get_functiondef('private.rota_validate_clinician_core(uuid,uuid,timestamptz,timestamptz,boolean)'::regprocedure) into v_def;
  perform pg_temp.rec('rest guard: the rota validator core still calls the rest rule (a later replacement cannot silently drop it)', 'true', (v_def like '%rest_rule_check%')::text);

  -- cover offers
  perform pg_temp.rec('cover: before the sweep there is no offer', '0', (select count(*)::text from public.fatigue_cover_offers)::text);
  v_n := private.fatigue_cover_sweep();   -- the write is its own statement: a subquery in the same expression can be evaluated first
  perform pg_temp.rec('cover: the sweep offers the next shift to A (2 overnight pages) and not to B (none)', '1,1,0',
    v_n::text || ',' || (select count(*)::text from public.fatigue_cover_offers where clinician_id = v_a and next_rota_id = r_next) || ',' ||
    (select count(*)::text from public.fatigue_cover_offers where clinician_id = v_b));
  perform pg_temp.rec('cover: A and the reviewers get a neutral in-app notice, no names, no clinical words', '1,true',
    (select count(*)::text from public.notifications where recipient_id = v_a and payload ->> 'audience' = 'cover_offer' and channel = 'in_app') || ',' ||
    (select bool_and(payload ->> 'message' !~* '(patient|blood|pressure|red event|diagnos|dr |doctor [a-z])') from public.notifications where payload ->> 'audience' = 'cover_offer'));
  perform pg_temp.rec('cover: the reviewers were told as well', 'true',
    ((select count(*) from public.notifications where recipient_id = v_cmo and payload ->> 'audience' = 'cover_offer') >= 1)::text);
  perform pg_temp.rec('cover: running the sweep again creates nothing more', '0', private.fatigue_cover_sweep()::text);
  perform pg_temp.rec('cover: A sees the offer and the next shift', '1', (pg_temp.q_as(v_a, $q$select jsonb_array_length(public.my_cover_offers() -> 'offers')::text$q$)));
  perform pg_temp.rec('cover: B sees no offer', '0', (pg_temp.q_as(v_b, $q$select jsonb_array_length(public.my_cover_offers() -> 'offers')::text$q$)));
  select id into v_off from public.fatigue_cover_offers where clinician_id = v_a;
  perform pg_temp.rec('cover: another clinician cannot answer A''s offer', 'P0002', pg_temp.try_as(v_b, format('select public.respond_cover_offer(%L, true)', v_off)));
  perform pg_temp.act(v_a); perform public.respond_cover_offer(v_off, false, 'I would like cover please'); perform pg_temp.back();
  perform pg_temp.rec('cover: A asks for cover: recorded, the reviewers are told, and it is audited', 'cover_requested,true,1',
    (select state from public.fatigue_cover_offers where id = v_off) || ',' ||
    ((select count(*) from public.notifications where recipient_id = v_cmo and payload ->> 'subject' = 'Cover requested') >= 1)::text || ',' ||
    (select count(*)::text from public.audit_log where entity_id = v_off and action = 'cover_offer.cover_requested'));
  perform pg_temp.rec('cover: an offer can be answered once', '22023', pg_temp.try_as(v_a, format('select public.respond_cover_offer(%L, true)', v_off)));
  perform pg_temp.rec('cover: reviewers can read the overview, a clinician cannot', 'ok,42501',
    pg_temp.try_as(v_cmo, 'select public.cover_offers_overview()') || ',' || pg_temp.try_as(v_a, 'select public.cover_offers_overview()'));
  -- one page is not enough
  perform pg_temp.clear_rota();
  perform pg_temp.rota_row(v_org, t0 - interval '14 hours', t0 - interval '2 hours', v_b, v_c);
  perform pg_temp.rota_row(v_org, t0 + interval '20 hours', t0 + interval '30 hours', v_b, v_c);
  perform pg_temp.mkpage(v_org, p1, pg_temp.mkevent(p1, pg_temp.f('rs')), v_b, t0 - interval '8 hours' + interval '10 minutes');
  perform pg_temp.rec('cover: a single overnight page makes no offer', '0', private.fatigue_cover_sweep()::text);
  -- two overnight pages but no next shift yet: no offer; once a next shift exists the next pass offers it
  perform pg_temp.mkpage(v_org, p2, pg_temp.mkevent(p2, pg_temp.f('rs')), v_b, t0 - interval '8 hours' + interval '20 minutes');
  perform pg_temp.clear_rota();
  perform pg_temp.rota_row(v_org, t0 - interval '14 hours', t0 - interval '2 hours', v_b, v_c);
  perform pg_temp.rec('cover: two overnight pages but no next shift to offer: no offer yet', '0', private.fatigue_cover_sweep()::text);
  perform pg_temp.rota_row(v_org, t0 + interval '20 hours', t0 + interval '30 hours', v_b, v_c);
  perform pg_temp.rec('cover: once a next shift exists the next pass offers it', '1', private.fatigue_cover_sweep()::text);
end $$;

-- 6. Fire drills (W5.4) -------------------------------------------------------------------------------------------------------
do $$
declare
  v_org uuid := pg_temp.f('org'); v_cmo uuid := pg_temp.f('cmo'); v_a uuid := pg_temp.f('A'); v_b uuid := pg_temp.f('B'); v_c uuid := pg_temp.f('C'); v_admin uuid := pg_temp.f('admin');
  t_a uuid; t_b uuid; t_c uuid; v_score_before numeric; v_score_after numeric; rep jsonb; g jsonb; v_n integer;
begin
  perform pg_temp.clear_rota();
  perform pg_temp.rota_row(v_org, now() - interval '1 hour', now() + interval '10 hours', v_a, v_b);
  perform pg_temp.use_rules('{"drill_enabled":0}');
  perform pg_temp.rec('drills: OFF by default: nothing is sent', '0,0', private.run_fire_drills()::text || ',' || (select count(*)::text from public.page_tests where kind = 'drill'));
  perform pg_temp.use_rules('{"drill_enabled":1,"drill_hour_start":0,"drill_hour_end":24}');
  v_n := private.run_fire_drills();
  perform pg_temp.rec('drills: ON: both rostered clinicians get a drill; C (not on the rota) does not', '2,1,1,0',
    v_n::text || ',' || (select count(*)::text from public.page_tests where kind = 'drill' and clinician_id = v_a) || ',' ||
    (select count(*)::text from public.page_tests where kind = 'drill' and clinician_id = v_b) || ',' || (select count(*)::text from public.page_tests where kind = 'drill' and clinician_id = v_c));
  perform pg_temp.rec('drills: a second run the same day sends no more (once per interval)', '0', private.run_fire_drills()::text);
  -- a clinician on leave, and one holding an open page, are never drilled
  declare v_d uuid; v_e uuid; v_ev uuid;
  begin
    v_d := pg_temp.mkdoc(v_org, v_admin, 'D', 'senior_medical_officer', '{on_call}');
    v_e := pg_temp.mkdoc(v_org, v_admin, 'E', 'senior_medical_officer', '{on_call}');
    perform pg_temp.rota_row(v_org, now() + interval '20 hours', now() + interval '40 hours', v_d, v_e);
    insert into public.provider_time_off (organisation_id, clinician_id, kind, starts_at, ends_at, reason) values (v_org, v_d, 'leave', now() - interval '1 hour', now() + interval '2 days', 'proof');
    v_ev := pg_temp.mkevent(pg_temp.f('tp6'), pg_temp.f('rs'));
    perform pg_temp.mkpage(v_org, pg_temp.f('tp6'), v_ev, v_e, now() - interval '3 minutes');
    v_n := private.run_fire_drills();
    perform pg_temp.rec('drills: a clinician on leave and one holding an open page are not drilled', '0,0,0',
      v_n::text || ',' || (select count(*)::text from public.page_tests where kind = 'drill' and clinician_id = v_d) || ',' ||
      (select count(*)::text from public.page_tests where kind = 'drill' and clinician_id = v_e));
  end;
  perform pg_temp.rec('drills: the drill is a test page with no sms, sent by the system, and says nothing clinical', 'true,false,null',
    (select (count(*) = 2)::text from public.notifications where template = 'on_call_test_page' and source_table = 'page_tests' and channel::text = 'push') || ',' ||
    (exists (select 1 from public.notifications where template = 'on_call_test_page' and channel::text in ('sms', 'voice')))::text || ',' ||
    coalesce((select requested_by::text from public.page_tests where kind = 'drill' limit 1), 'null'));
  select id into t_a from public.page_tests where kind = 'drill' and clinician_id = v_a;
  select id into t_b from public.page_tests where kind = 'drill' and clinician_id = v_b;
  -- C has an unanswered drill from 2 hours ago (inserted by the system path), and a recent clinician is not drilled again
  t_c := private.send_drill_page(v_c);
  perform set_config('tarragon.paging_write', 'on', true);
  update public.page_tests set sent_at = now() - interval '2 hours' where id = t_c;
  perform set_config('tarragon.paging_write', 'off', true);
  select reliability_score into v_score_before from public.clinical_staff where profile_id = v_a;
  -- A acknowledges after 120 seconds (within the 300 second target), by push, on an android device
  perform set_config('tarragon.paging_write', 'on', true);
  insert into public.on_call_device_seen (clinician_id, device_id, kind) values (v_a, 'device-s20c-0001', 'android');
  perform set_config('tarragon.paging_write', 'off', true);
  perform set_config('tarragon.paging_write', 'on', true);
  update public.page_tests set sent_at = now() - interval '120 seconds' where id = t_a;
  update public.page_tests set sent_at = now() - interval '400 seconds' where id = t_b;
  insert into public.page_delivered_acks (test_id, clinician_id, channel, device_id) values (t_a, v_a, 'push', 'device-s20c-0001'), (t_b, v_b, 'in_app', null);
  perform set_config('tarragon.paging_write', 'off', true);
  perform pg_temp.act(v_a); perform public.acknowledge_test_page(t_a); perform pg_temp.back();
  perform pg_temp.act(v_b); perform public.acknowledge_test_page(t_b); perform pg_temp.back();
  perform pg_temp.rec('drills: an acknowledged drill records an INFORMATIONAL event (weight 0): good 1 within target, good 0 beyond it', '1,0,0,0',
    (select good::text from public.clinician_reliability_events where clinician_id = v_a and kind = 'drill_result') || ',' ||
    (select good::text from public.clinician_reliability_events where clinician_id = v_b and kind = 'drill_result') || ',' ||
    (select max(weight)::text from public.clinician_reliability_events where kind = 'drill_result' and clinician_id in (v_a, v_b)) || ',' ||
    (select count(*)::text from public.clinician_reliability_events where kind = 'drill_result' and clinician_id = v_c));
  select reliability_score into v_score_after from public.clinical_staff where profile_id = v_a;
  perform pg_temp.rec('drills: the reliability SCORE does not move (never pay, never removal)', 'true', (v_score_before is not distinct from v_score_after)::text);
  perform pg_temp.try_as(v_a, format('select public.acknowledge_test_page(%L)', t_a));
  perform pg_temp.rec('drills: a second acknowledgement does not add a second event', '1',
    (select count(*)::text from public.clinician_reliability_events where clinician_id = v_a and kind = 'drill_result'));
  -- the unanswered drill is a miss after 60 minutes
  perform pg_temp.rec('drills: an unanswered drill is recorded as a miss after the window, once', '1,0',
    private.settle_drill_results()::text || ',' || private.settle_drill_results()::text);
  perform pg_temp.rec('drills: the lead''s reliability dashboard leaves drill results out of its event counts (as it does audit results)', 'true,false',
    (pg_get_functiondef('public.reliability_dashboard(integer,integer)'::regprocedure) like '%''audit_result'', ''drill_result''%')::text || ',' ||
    (pg_get_functiondef('public.reliability_dashboard(integer,integer)'::regprocedure) like '%kind <> ''audit_result''%')::text);
  -- C answers the same drill 2 hours late: the record already says missed, and the report must say the same
  perform set_config('tarragon.paging_write', 'on', true);
  update public.page_tests set drill_result_at = now() - interval '1 hour' where id = t_c;   -- settled as missed an hour ago
  insert into public.page_delivered_acks (test_id, clinician_id, channel) values (t_c, v_c, 'in_app');
  perform set_config('tarragon.paging_write', 'off', true);
  perform pg_temp.act(v_c); perform public.acknowledge_test_page(t_c); perform pg_temp.back();
  perform pg_temp.rec('drills: a drill answered after it was recorded as missed stays missed (one event, still good 0)', '1,0',
    (select count(*)::text from public.clinician_reliability_events where clinician_id = v_c and kind = 'drill_result') || ',' ||
    (select good::text from public.clinician_reliability_events where clinician_id = v_c and kind = 'drill_result'));
  perform pg_temp.rec('drills: the miss is informational too (good 0, weight 0)', '0,0',
    (select good::text from public.clinician_reliability_events where clinician_id = v_c and kind = 'drill_result') || ',' || (select weight::text from public.clinician_reliability_events where clinician_id = v_c and kind = 'drill_result'));
  -- the interval
  perform set_config('tarragon.paging_write', 'on', true);
  update public.page_tests set sent_at = now() - interval '40 days' where id in (t_a);
  perform set_config('tarragon.paging_write', 'off', true);
  perform pg_temp.rec('drills: a clinician last drilled 40 days ago is drilled again, one drilled today is not', '1,0',
    private.run_fire_drills()::text || ',' || private.run_fire_drills()::text);
  -- put the dates back for the report
  perform set_config('tarragon.paging_write', 'on', true);
  update public.page_tests set sent_at = now() - interval '120 seconds' where id = t_a;
  delete from public.page_tests where kind = 'drill' and id not in (t_a, t_b, t_c);
  perform set_config('tarragon.paging_write', 'off', true);

  -- the report
  perform pg_temp.act(v_cmo);
  rep := public.fire_drill_report(90);
  perform pg_temp.back();
  select x into g from jsonb_array_elements(rep -> 'groups') x where x ->> 'group' = 'overall';
  perform pg_temp.rec('report: overall: 3 drills, 2 answered, 1 within the 300 second target, 1 missed', '3,2,1,1',
    (g ->> 'sent') || ',' || (g ->> 'acknowledged') || ',' || (g ->> 'within_target') || ',' || (g ->> 'missed'));
  perform pg_temp.rec('report: 33.3 percent within target: the 90 percent target is NOT met', '33.3,false,90,300',
    (g ->> 'pct_within_target') || ',' || (rep ->> 'meets_target') || ',' || (rep ->> 'target_pct') || ',' || (rep ->> 'target_seconds'));
  perform pg_temp.rec('report: p50 and p95 of the answered drills (120 s and 400 s)', '260,386',
    (round((g ->> 'p50_seconds')::numeric))::text || ',' || (round((g ->> 'p95_seconds')::numeric))::text);
  select x into g from jsonb_array_elements(rep -> 'groups') x where x ->> 'group' = 'clinician' and x ->> 'key' = v_a::text;
  perform pg_temp.rec('report: by clinician: A answered 1 of 1 within target (100 percent)', '1,1,100.0', (g ->> 'sent') || ',' || (g ->> 'within_target') || ',' || (g ->> 'pct_within_target'));
  perform pg_temp.rec('report: by clinician: C missed (0 percent, no time)', '1,0,0.0,null',
    (select (x ->> 'sent') || ',' || (x ->> 'within_target') || ',' || (x ->> 'pct_within_target') || ',' || coalesce(x ->> 'p50_seconds', 'null') from jsonb_array_elements(rep -> 'groups') x where x ->> 'group' = 'clinician' and x ->> 'key' = v_c::text));
  perform pg_temp.rec('report: by route: push and in_app', '2',
    (select count(*)::text from jsonb_array_elements(rep -> 'groups') x where x ->> 'group' = 'route' and x ->> 'key' in ('push', 'in_app', 'none')));
  perform pg_temp.rec('report: by device: android for A''s push, unknown for the rest', 'true,true',
    (exists (select 1 from jsonb_array_elements(rep -> 'groups') x where x ->> 'group' = 'device' and x ->> 'key' = 'android'))::text || ',' ||
    (exists (select 1 from jsonb_array_elements(rep -> 'groups') x where x ->> 'group' = 'device' and x ->> 'key' = 'unknown'))::text);
  perform pg_temp.rec('report: by hour of day: at least one hour bucket', 'true',
    ((select count(*) from jsonb_array_elements(rep -> 'groups') x where x ->> 'group' = 'hour') >= 1)::text);
  perform pg_temp.rec('report: reviewers only (admin and CMO), not a clinician', 'ok,ok,42501',
    pg_temp.try_as(v_cmo, 'select public.fire_drill_report(30)') || ',' || pg_temp.try_as(v_admin, 'select public.fire_drill_report(30)') || ',' || pg_temp.try_as(v_a, 'select public.fire_drill_report(30)'));
  perform private.send_drill_page(v_b);
  perform pg_temp.act(v_cmo); rep := public.fire_drill_report(90); perform pg_temp.back();
  select x into g from jsonb_array_elements(rep -> 'groups') x where x ->> 'group' = 'overall';
  perform pg_temp.rec('report: a drill still waiting is shown as pending and not counted yet', '1,3', (rep ->> 'pending') || ',' || (g ->> 'sent'));
end $$;

-- 6b. The controls survive a fault, and the watcher tells a person -----------------------------------------------------------------
do $$
declare
  v_org uuid := pg_temp.f('org'); v_cmo uuid := pg_temp.f('cmo'); v_a uuid := pg_temp.f('A');
  v_unavail text; v_page_ok text; v_inc_error integer; v_inc_guard integer; v_inc_again integer; v_inc_none integer;
begin
  -- a signal that raises: the overview still loads (it says unavailable), so the CMO can still start a pause
  begin
    create or replace function private.queue_class_breaches() returns jsonb language plpgsql stable security definer set search_path = ''
      as $f$ begin raise exception 'proof: the queue view is broken'; end $f$;
    perform pg_temp.use_rules('{"gate_enforce":1}');
    perform pg_temp.act(v_cmo);
    v_unavail := (public.intake_gate_overview() -> 'gate' ->> 'unavailable');
    v_page_ok := (public.cmo_start_ops_mode('pause', 'Pause started while the gate could not be read', 1) is not null)::text;
    perform pg_temp.back();
    -- the watcher needs an organisation with a real (non-test) active clinician; make A one for this block only
    update public.clinical_staff set is_test = false where profile_id = v_a;
    perform pg_temp.guard_on('on_call_cover_ok', true);
    perform private.raise_intake_gate_incident();
    select count(*) into v_inc_error from public.ops_incidents where external_reference = 'intake_gate_error:' || v_org;
    perform private.raise_intake_gate_incident();
    select count(*) into v_inc_again from public.ops_incidents where external_reference = 'intake_gate_error:' || v_org;
    perform pg_temp.guard_on('on_call_cover_ok', false);
    perform private.raise_intake_gate_incident();
    select count(*) into v_inc_guard from public.ops_incidents where external_reference = 'intake_gate_guard:' || v_org;
    update public.clinical_staff set is_test = true where profile_id = v_a;
    delete from public.ops_incidents where external_reference like 'intake_gate%';
    perform private.raise_intake_gate_incident();
    select count(*) into v_inc_none from public.ops_incidents where external_reference like 'intake_gate%' and external_reference like '%' || v_org;
    raise exception 'proof: undo the broken function';
  exception when others then
    if sqlerrm <> 'proof: undo the broken function' then raise; end if;
  end;
  perform pg_temp.back();
  perform pg_temp.rec('controls: with a signal broken, the CMO''s overview still loads and says the gate is unavailable', 'true', v_unavail);
  perform pg_temp.rec('controls: ...and the CMO can still start a pause', 'true', v_page_ok);
  perform pg_temp.rec('watcher: an unreadable enforced gate opens ONE incident (not one per pass)', '1,1', v_inc_error::text || ',' || v_inc_again::text);
  perform pg_temp.rec('watcher: an enforced gate with the guard off opens an incident, since every sale is being refused', '1', v_inc_guard::text);
  perform pg_temp.rec('watcher: an organisation with no real clinical staff is not watched', '0', v_inc_none::text);
end $$;

-- 7. SABOTAGE: each removal must flip its check ------------------------------------------------------------------------------------
do $$
declare
  v_org uuid := pg_temp.f('org'); v_a uuid := pg_temp.f('A'); v_b uuid := pg_temp.f('B'); v_cmo uuid := pg_temp.f('cmo');
  v_item uuid := pg_temp.f('item'); v_price uuid := pg_temp.f('price');
  t0 timestamptz := date_trunc('hour', now()); s1 timestamptz := date_trunc('hour', now()) - interval '2 hours' + interval '6 hours';
  v_t uuid; v_before integer; v_pause2 uuid;
begin
  perform pg_temp.use_rules('{"gate_enforce":1,"hard_rest_enforce":1}');
  perform pg_temp.guard_on('on_call_cover_ok', true);
  perform pg_temp.clear_rota();
  update public.clinical_staff set max_lead_patients = 1 where profile_id in (v_a, v_b);
  perform pg_temp.rec('sabotage control: the closed gate refuses a sale', 'P0001:intake_paused', pg_temp.order_try(v_org, pg_temp.f('real8'), v_item, v_price));
  -- 1. the order trigger removed
  alter table public.orders disable trigger orders_intake_gate;
  perform pg_temp.sab('sabotage: with the intake trigger off the sale goes through', 'P0001:intake_paused', pg_temp.order_try(v_org, pg_temp.f('real8'), v_item, v_price));
  alter table public.orders enable trigger orders_intake_gate;
  -- 2. the mode clock removed (expires_at ignored)
  v_pause2 := pg_temp.real_mode(v_org, 'pause', 1);
  update public.ops_modes set expires_at = now() - interval '1 minute' where id = v_pause2;
  perform pg_temp.rec('sabotage control: an expired mode is not active', 'false', private.ops_mode_active('pause', v_org, false)::text);
  create or replace function private.ops_mode_active(p_mode text, p_org uuid default null, p_test boolean default false) returns boolean
    language sql stable security definer set search_path = '' as $f$ select exists (select 1 from public.ops_modes m where m.mode = p_mode and m.state = 'active' and m.is_test = coalesce(p_test, false)) $f$;
  perform pg_temp.sab('sabotage: with the clock removed an expired mode stays on', 'false', private.ops_mode_active('pause', v_org, false)::text);
  perform pg_temp.end_mode(v_pause2);
  -- 3. the rest rule neutralised
  create or replace function private.rest_rule_check(p_clinician uuid, p_start timestamptz) returns void language plpgsql stable security definer set search_path = '' as $f$ begin return; end $f$;
  perform pg_temp.sab('sabotage: with the rest rule neutralised a 6 hour turnaround is accepted', '23514',
    pg_temp.try(format('select private.rest_rule_check(%L, %L)', v_a, s1)));
  -- 4. the drill result trigger dropped
  drop trigger page_tests_drill_ack on public.page_tests;
  select count(*) into v_before from public.clinician_reliability_events where clinician_id = v_b and kind = 'drill_result';
  perform set_config('tarragon.paging_write', 'on', true);
  insert into public.page_tests (organisation_id, clinician_id, kind, sent_at, delivered_at, is_test) values (v_org, v_b, 'drill', now() - interval '30 seconds', now(), true) returning id into v_t;
  insert into public.page_delivered_acks (test_id, clinician_id, channel) values (v_t, v_b, 'push');
  update public.page_tests set acknowledged_at = now() where id = v_t;
  perform set_config('tarragon.paging_write', 'off', true);
  perform pg_temp.sab('sabotage: with the drill trigger dropped an acknowledged drill leaves no record', (v_before + 1)::text,
    (select count(*)::text from public.clinician_reliability_events where clinician_id = v_b and kind = 'drill_result'));
  -- 5. the pause term removed from the intake question
  perform pg_temp.guard_on('clinical_operations_enabled', true);
  v_pause2 := pg_temp.real_mode(v_org, 'pause', 1);
  perform pg_temp.rec('sabotage control: a real pause closes a NEW booking', 'false', private.go_live_open_intake('clinical_operations_enabled', pg_temp.f('real8'), v_a)::text);
  create or replace function private.go_live_open_intake(p_key text, p_patient uuid default null, p_clinician uuid default null) returns boolean language sql stable security definer set search_path = ''
    as $f$ select private.go_live_open(p_key, p_patient, p_clinician) $f$;
  perform pg_temp.sab('sabotage: with the pause term removed a new booking goes through during a pause', 'false', private.go_live_open_intake('clinical_operations_enabled', pg_temp.f('real8'), v_a)::text);
  -- 6. the rota wrapper replaced by the base: the validator no longer holds
  create or replace function private.rota_validate_clinician_core(p_profile uuid, p_org uuid, p_start timestamptz, p_end timestamptz, p_objective boolean)
    returns void language sql stable security definer set search_path = '' as $f$ select private.rota_validate_clinician_core_base(p_profile, p_org, p_start, p_end, p_objective) $f$;
  perform pg_temp.sab('sabotage: with the rota core not calling the rule, the guard-definition check sees it is gone', 'true',
    (pg_get_functiondef('private.rota_validate_clinician_core(uuid,uuid,timestamptz,timestamptz,boolean)'::regprocedure) like '%rest_rule_check%')::text);
end $$;

-- 8. The CMO's signatures (last: they change which version is active) --------------------------------------------------------
do $$
declare v_cmo uuid := pg_temp.f('cmo'); v_a uuid := pg_temp.f('A');
begin
  perform pg_temp.guard_on('on_call_cover_ok', false);
  perform pg_temp.rec('sign: capacity v2 turns the gate on, so it cannot be signed while the on-call cover guard is off', '23514',
    pg_temp.try_as(v_cmo, 'select public.sign_capacity_cover_config(2)'));
  perform pg_temp.guard_on('on_call_cover_ok', true);
  perform pg_temp.act(v_cmo);
  perform public.sign_lead_config(2);
  perform public.sign_capacity_cover_config(2);
  perform pg_temp.back();
  perform pg_temp.rec('sign: the CMO signs lead v2: the one active version, signed by the CMO, v1 kept on record', '2,false,true',
    (select version::text from public.lead_config where is_active) || ',' || (select is_active::text from public.lead_config where version = 1) || ',' ||
    (select (approved_by = v_cmo)::text from public.lead_config where version = 2));
  perform pg_temp.rec('sign: the CMO signs capacity v2: it is the active version with all three switches ON', '2,1,1,1',
    (select version::text from public.capacity_cover_config where is_active) || ',' || private.cap_rule('gate_enforce') || ',' || private.cap_rule('hard_rest_enforce') || ',' || private.cap_rule('drill_enabled'));
  perform pg_temp.rec('sign: a signed version cannot be signed again or edited', '23514,23514',
    pg_temp.try_as(v_cmo, 'select public.sign_lead_config(2)') || ',' || pg_temp.try($q$update public.capacity_cover_config set rules = jsonb_set(rules, '{rest_hours}', '9') where version = 2$q$));
  perform pg_temp.rec('sign: an older version can no longer be switched back on', '23514', pg_temp.try('update public.lead_config set is_active = true where version = 1'));
  perform pg_temp.rec('sign: both signatures are audited', '1,1',
    (select count(*)::text from public.audit_log where action = 'lead_config.signed' and actor_id = v_cmo) || ',' || (select count(*)::text from public.audit_log where action = 'capacity_cover_config.signed' and actor_id = v_cmo));
end $$;

do $$
declare v_bad integer; v_caught integer; v_sab integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S20c proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_sab from results where phase = 'sabotaged';
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_sab < 5 or v_caught < v_sab then
    raise exception 'VACUOUS TEST: only % of % sabotage steps changed the matching check; unchanged: %', v_caught, v_sab,
      (select string_agg(check_name || ' expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'sabotaged' and expected = actual);
  end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;

rollback;
