-- Proof: the only way to approve an AI guardrail or AI knowledge source is the Chief Medical Officer's approval function.
-- (migration *_ai_guardrail_and_knowledge_source_approval_route.sql). BEGIN/ROLLBACK, nothing left behind.
-- Proves: a row cannot be created pre-approved; an admin, a doctor, a patient, anon and a deactivated CMO are all refused;
-- the active CMO approves in bulk, stamped with their own clinical_staff row, one audit row per item, and a second call is a no-op;
-- an unknown id refuses the whole call; a direct update of the approval columns is refused even for an admin (who can otherwise
-- write the table); editing the approved text drops the approval while switching a row off does not; only an approved knowledge
-- source is readable by the runtime. SABOTAGE: the guard trigger function is replaced by a no-op and a direct admin approval
-- must then succeed (so the guard checks are not vacuous).
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
  values (v, 'aiappr-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'AiAppr ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone;
  return v;
end $f$;

do $$
declare
  v_org uuid; v_admin uuid; v_cmo uuid; v_doc uuid; v_pat uuid; v_cmo_staff uuid; v_sys uuid;
  g1 uuid; g2 uuid; g3 uuid; k1 uuid; k2 uuid; v_n integer;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  select id into v_sys from public.ai_systems order by system_code limit 1;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  v_cmo := pg_temp.mkuser(v_org, 'cmo', 'clinician');
  v_doc := pg_temp.mkuser(v_org, 'doctor', 'clinician');
  v_pat := pg_temp.mkuser(v_org, 'patient', 'patient');
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status, license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
    values (v_org, v_cmo, 'AiAppr CMO', 'MDCN', 'AIAPPR-CMO-1', true, 'active', now(), v_admin, 'chief_medical_officer', 'contracted', 2, true, v_admin, true)
    returning id into v_cmo_staff;
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status, license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, is_test)
    values (v_org, v_doc, 'AiAppr Doctor', 'MDCN', 'AIAPPR-DOC-1', true, 'active', now(), v_admin, 'senior_medical_officer', 'employed', 2, true);

  insert into public.ai_guardrails (ai_system_id, rule_code, kind, description, enforcement) values (v_sys, 'aiappr_one', 'output_constraint', 'First test rule', 'warn') returning id into g1;
  insert into public.ai_guardrails (ai_system_id, rule_code, kind, description, enforcement) values (v_sys, 'aiappr_two', 'output_constraint', 'Second test rule', 'warn') returning id into g2;
  insert into public.ai_guardrails (ai_system_id, rule_code, kind, description, enforcement) values (v_sys, 'aiappr_three', 'output_constraint', 'Third test rule', 'warn') returning id into g3;
  insert into public.ai_knowledge_sources (source_code, title, source_type, citation_label, ai_system_id) values ('aiappr_src_one', 'Test source one', 'education_material', 'Based on test material one.', v_sys) returning id into k1;
  insert into public.ai_knowledge_sources (source_code, title, source_type, citation_label, ai_system_id) values ('aiappr_src_two', 'Test source two', 'education_material', 'Based on test material two.', v_sys) returning id into k2;

  -- nothing can be created already approved
  perform pg_temp.rec('a guardrail cannot be inserted pre-approved', '42501',
    pg_temp.try(format($q$insert into public.ai_guardrails (ai_system_id, rule_code, kind, description, enforcement, approved_by, approved_at) values (%L, 'aiappr_pre', 'output_constraint', 'x', 'warn', %L, now())$q$, v_sys, v_cmo_staff)));
  perform pg_temp.rec('a knowledge source cannot be inserted pre-approved', '42501',
    pg_temp.try(format($q$insert into public.ai_knowledge_sources (source_code, title, source_type, citation_label, approved_by, approved_at) values ('aiappr_pre', 't', 'education_material', 'c', %L, now())$q$, v_cmo_staff)));

  -- who can approve
  perform pg_temp.act(v_admin);
  perform pg_temp.rec('an admin cannot approve a guardrail', '42501', pg_temp.try(format('select public.approve_ai_guardrails(array[%L]::uuid[])', g1)));
  perform pg_temp.rec('an admin cannot approve a knowledge source', '42501', pg_temp.try(format('select public.approve_ai_knowledge_sources(array[%L]::uuid[])', k1)));
  perform pg_temp.rec('an admin cannot stamp approved_at directly on a guardrail', '42501', pg_temp.try(format('update public.ai_guardrails set approved_by = %L, approved_at = now() where id = %L', v_cmo_staff, g1)));
  perform pg_temp.rec('an admin cannot stamp approved_at directly on a knowledge source', '42501', pg_temp.try(format('update public.ai_knowledge_sources set approved_by = %L, approved_at = now() where id = %L', v_cmo_staff, k1)));
  perform pg_temp.back();
  perform pg_temp.act(v_doc);
  perform pg_temp.rec('a doctor cannot approve', '42501', pg_temp.try(format('select public.approve_ai_guardrails(array[%L]::uuid[])', g1)));
  perform pg_temp.back();
  perform pg_temp.act(v_pat);
  perform pg_temp.rec('a patient cannot approve', '42501', pg_temp.try(format('select public.approve_ai_knowledge_sources(array[%L]::uuid[])', k1)));
  perform pg_temp.back();
  perform pg_temp.act_anon();
  perform pg_temp.rec('anon cannot approve', '42501', pg_temp.try(format('select public.approve_ai_guardrails(array[%L]::uuid[])', g1)));
  perform pg_temp.back();
  perform pg_temp.rec('nothing was approved by any refusal', '0',
    (select count(*)::text from public.ai_guardrails where id in (g1, g2, g3) and approved_at is not null));

  -- a deactivated CMO is refused
  update public.clinical_staff set active = false where id = v_cmo_staff;
  perform pg_temp.act(v_cmo);
  perform pg_temp.rec('a deactivated CMO cannot approve', '42501', pg_temp.try(format('select public.approve_ai_guardrails(array[%L]::uuid[])', g1)));
  perform pg_temp.back();
  update public.clinical_staff set active = true where id = v_cmo_staff;

  -- the active CMO
  perform pg_temp.act(v_cmo);
  perform pg_temp.rec('an empty list is refused', 'P0001', pg_temp.try($q$select public.approve_ai_guardrails(array[]::uuid[])$q$));
  perform pg_temp.rec('an unknown id refuses the whole call', 'P0001', pg_temp.try(format('select public.approve_ai_guardrails(array[%L, %L]::uuid[])', g1, gen_random_uuid())));
  perform pg_temp.back();
  perform pg_temp.rec('the refused call approved nothing', '0', (select count(*)::text from public.ai_guardrails where id = g1 and approved_at is not null));

  perform pg_temp.act(v_cmo);
  select public.approve_ai_guardrails(array[g1, g2]::uuid[], 'read both rules') into v_n;
  perform pg_temp.back();
  perform pg_temp.rec('the CMO approves two guardrails', '2', v_n::text);
  perform pg_temp.rec('approved_by is the CMO''s own clinical_staff row', '2',
    (select count(*)::text from public.ai_guardrails where id in (g1, g2) and approved_by = v_cmo_staff and approved_at is not null));
  perform pg_temp.rec('the third guardrail is untouched', 'null', (select coalesce(approved_at::text, 'null') from public.ai_guardrails where id = g3));
  perform pg_temp.rec('one audit row per approved guardrail, carrying the note', '2,1',
    (select count(*)::text || ',' || count(distinct event->>'note')::text from public.audit_log where action = 'ai_guardrail.approved' and entity_id in (g1, g2) and actor_id = v_cmo and event->>'note' = 'read both rules'));

  perform pg_temp.act(v_cmo);
  select public.approve_ai_guardrails(array[g1, g2]::uuid[]) into v_n;
  perform pg_temp.back();
  perform pg_temp.rec('approving again is a no-op', '0', v_n::text);
  perform pg_temp.rec('and writes no extra audit rows', '2', (select count(*)::text from public.audit_log where action = 'ai_guardrail.approved' and entity_id in (g1, g2)));

  -- editing the approved text drops the approval; switching it off does not
  update public.ai_guardrails set is_active = false where id = g1;
  perform pg_temp.rec('switching a guardrail off keeps its approval', 'true', (select (approved_at is not null)::text from public.ai_guardrails where id = g1));
  update public.ai_guardrails set description = 'Changed wording' where id = g1;
  perform pg_temp.rec('editing the description drops the approval', 'null,null', (select coalesce(approved_at::text, 'null') || ',' || coalesce(approved_by::text, 'null') from public.ai_guardrails where id = g1));
  update public.ai_guardrails set config = '{"k":1}'::jsonb where id = g2;
  perform pg_temp.rec('editing the config drops the approval', 'null', (select coalesce(approved_at::text, 'null') from public.ai_guardrails where id = g2));

  -- knowledge sources
  perform pg_temp.rec('an unapproved source is not offered to the runtime', 'false',
    (select (private.approved_ai_knowledge_sources((select system_code from public.ai_systems where id = v_sys)) @> jsonb_build_array(jsonb_build_object('source_code', 'aiappr_src_one')))::text));
  perform pg_temp.act(v_cmo);
  select public.approve_ai_knowledge_sources(array[k1, k2]::uuid[], 'read both sources') into v_n;
  perform pg_temp.back();
  perform pg_temp.rec('the CMO approves two knowledge sources', '2', v_n::text);
  perform pg_temp.rec('knowledge approvals are audited', '2', (select count(*)::text from public.audit_log where action = 'ai_knowledge_source.approved' and entity_id in (k1, k2) and actor_id = v_cmo));
  perform pg_temp.rec('an approved source is offered to the runtime', 'true',
    (select (private.approved_ai_knowledge_sources((select system_code from public.ai_systems where id = v_sys))::text like '%aiappr_src_one%')::text));
  update public.ai_knowledge_sources set citation_label = 'Based on something else.' where id = k1;
  perform pg_temp.rec('editing a citation label drops the approval', 'null', (select coalesce(approved_at::text, 'null') from public.ai_knowledge_sources where id = k1));
  perform pg_temp.rec('and the runtime stops offering it', 'false',
    (select (private.approved_ai_knowledge_sources((select system_code from public.ai_systems where id = v_sys))::text like '%aiappr_src_one%')::text));

  perform pg_temp.rec('execute grants: anon none, authenticated yes', 'false,false,true,true',
    has_function_privilege('anon', 'public.approve_ai_guardrails(uuid[], text)', 'EXECUTE')::text || ',' ||
    has_function_privilege('anon', 'public.approve_ai_knowledge_sources(uuid[], text)', 'EXECUTE')::text || ',' ||
    has_function_privilege('authenticated', 'public.approve_ai_guardrails(uuid[], text)', 'EXECUTE')::text || ',' ||
    has_function_privilege('authenticated', 'public.approve_ai_knowledge_sources(uuid[], text)', 'EXECUTE')::text);
  perform pg_temp.rec('the approval flag is not left raised', '',
    coalesce(current_setting('tarragon.ai_approval_route', true), ''));

  -- SABOTAGE: take the guard away; an admin's direct stamp must now get through
  create or replace function private.guard_ai_approval_columns() returns trigger language plpgsql set search_path = '' as $f$ begin return new; end $f$;
  perform pg_temp.act(v_admin);
  insert into results values ('sabotaged', 'an admin cannot stamp approved_at directly on a guardrail', '42501',
    pg_temp.try(format('update public.ai_guardrails set approved_by = %L, approved_at = now() where id = %L', v_cmo_staff, g3)));
  perform pg_temp.back();
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'AI approval route proof FAILED: %', (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught = 0 then raise exception 'VACUOUS TEST: removing the approval guard did not change the result'; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result from results where phase = 'real' order by check_name;
rollback;
