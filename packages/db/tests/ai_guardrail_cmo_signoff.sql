-- Proof: public.approve_ai_guardrails (migration *_ai_guardrail_cmo_signoff.sql).
-- In a rolled-back transaction: only the active CMO can approve; a doctor, an admin who is not the CMO and anon are refused;
-- approving stamps approved_by and approved_at on that system's unapproved active rows only (another system is untouched),
-- is audited, and a second call finds nothing left and is refused. SABOTAGE: the CMO check is removed and a doctor must then get through.
begin;
create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create function pg_temp.rec(p_name text, p_expected text, p_actual text) returns void language sql as $$ insert into results values ('real', p_name, p_expected, p_actual) $$;
create function pg_temp.try(p_sql text) returns text language plpgsql as $f$ begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $f$;
create function pg_temp.act(p_uid uuid) returns void language plpgsql as $f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
end $f$;
create function pg_temp.act_anon() returns void language plpgsql as $f$ begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
end $f$;
create function pg_temp.back() returns void language plpgsql as $f$ begin reset role; end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'aigr-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'Aigr ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone;
  return v;
end $f$;

do $$
declare
  v_org uuid; v_admin uuid; v_cmo uuid; v_doc uuid; v_sys uuid; v_other uuid; v_staff uuid; v_n integer;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  v_cmo := pg_temp.mkuser(v_org, 'cmo', 'clinician');
  v_doc := pg_temp.mkuser(v_org, 'doctor', 'clinician');
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status, license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
    values (v_org, v_cmo, 'Aigr CMO', 'MDCN', 'AIGR-CMO-1', true, 'active', now(), v_admin, 'chief_medical_officer', 'contracted', 2, true, v_admin, true) returning id into v_staff;
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status, license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, is_test)
    values (v_org, v_doc, 'Aigr Doctor', 'MDCN', 'AIGR-DOC-1', true, 'active', now(), v_admin, 'senior_medical_officer', 'employed', 2, true);

  insert into public.ai_systems (system_code, name, purpose, owner_role, risk_class, autonomy_level, clinically_meaningful, fallback_behaviour)
    values ('AI-991', 'Aigr proof system', 'proof', 'Clinical Director', 'moderate', 'inform_only', false, 'none') returning id into v_sys;
  insert into public.ai_systems (system_code, name, purpose, owner_role, risk_class, autonomy_level, clinically_meaningful, fallback_behaviour)
    values ('AI-992', 'Aigr other system', 'proof', 'Clinical Director', 'moderate', 'inform_only', false, 'none') returning id into v_other;
  insert into public.ai_guardrails (ai_system_id, rule_code, kind, description, enforcement, is_active) values
    (v_sys, 'r1', 'output_constraint', 'one', 'blocking', true),
    (v_sys, 'r2', 'output_constraint', 'two', 'blocking', true),
    (v_sys, 'r3', 'output_constraint', 'retired', 'blocking', false),
    (v_other, 'r1', 'output_constraint', 'other', 'blocking', true);

  perform pg_temp.act(v_doc);
  perform pg_temp.rec('a doctor is refused', '42501', pg_temp.try($q$select public.approve_ai_guardrails('AI-991')$q$));
  perform pg_temp.act(v_admin);
  perform pg_temp.rec('an admin who is not the CMO is refused', '42501', pg_temp.try($q$select public.approve_ai_guardrails('AI-991')$q$));
  perform pg_temp.back();
  perform pg_temp.act_anon();
  perform pg_temp.rec('anon is refused', '42501', pg_temp.try($q$select public.approve_ai_guardrails('AI-991')$q$));
  perform pg_temp.back();
  perform pg_temp.rec('nothing was approved by the refusals', '0', (select count(*)::text from public.ai_guardrails where approved_at is not null and ai_system_id in (v_sys, v_other)));

  perform pg_temp.act(v_cmo);
  perform pg_temp.rec('an unknown system code is refused', '22023', pg_temp.try($q$select public.approve_ai_guardrails('AI-NOPE')$q$));
  v_n := public.approve_ai_guardrails('AI-991', 'read every rule');
  perform pg_temp.back();
  perform pg_temp.rec('two active rules approved', '2', v_n::text);
  perform pg_temp.rec('stamped with the CMO staff id and a time', '2', (select count(*)::text from public.ai_guardrails where ai_system_id = v_sys and is_active and approved_by = v_staff and approved_at is not null));
  perform pg_temp.rec('the retired rule is untouched', 'null', (select coalesce(approved_at::text, 'null') from public.ai_guardrails where ai_system_id = v_sys and not is_active));
  perform pg_temp.rec('the other system is untouched', 'null', (select coalesce(approved_at::text, 'null') from public.ai_guardrails where ai_system_id = v_other));
  perform pg_temp.rec('one audit row with the note', '1', (select count(*)::text from public.audit_log where action = 'ai_guardrails.approved' and actor_id = v_cmo and entity_id = v_sys and event ->> 'note' = 'read every rule'));
  perform pg_temp.act(v_cmo);
  perform pg_temp.rec('a second call finds nothing left', '22023', pg_temp.try($q$select public.approve_ai_guardrails('AI-991')$q$));
  perform pg_temp.back();
  perform pg_temp.rec('execute grants: anon none, authenticated yes', 'false,true',
    has_function_privilege('anon', 'public.approve_ai_guardrails(text, text)', 'EXECUTE')::text || ',' || has_function_privilege('authenticated', 'public.approve_ai_guardrails(text, text)', 'EXECUTE')::text);

  -- SABOTAGE: drop the CMO check; a doctor must now be able to approve the other system
  create or replace function public.approve_ai_guardrails(p_system_code text, p_note text default null) returns integer language sql security definer set search_path = '' as
    $f$ update public.ai_guardrails set approved_at = now(), approved_by = (select id from public.clinical_staff where doctor_tier = 'chief_medical_officer' limit 1) where is_active and approved_at is null and ai_system_id = (select id from public.ai_systems where system_code = p_system_code); select 1 $f$;
  perform pg_temp.act(v_doc);
  insert into results values ('sabotaged', 'a doctor is refused', '42501', pg_temp.try($q$select public.approve_ai_guardrails('AI-992')$q$));
  perform pg_temp.back();
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'AI guardrail sign-off proof FAILED: %', (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught = 0 then raise exception 'VACUOUS TEST: removing the CMO check did not change the result'; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result from results where phase = 'real' order by check_name;
rollback;
