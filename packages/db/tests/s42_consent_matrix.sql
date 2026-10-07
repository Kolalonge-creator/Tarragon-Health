-- S42 proof: the consent matrix (migration *_s42_consent_matrix.sql). One rolled-back transaction. Proves:
--   1. The matrix is 5 data types x 4 purposes; only the care purpose is required for care; no bundle holds reproductive or mental health data.
--   2. A patient sees care cells in force with no event rows at all, optional cells off by default; granting, withdrawing and a bundle work and are history.
--   3. Withdrawing a REQUIRED cell is refused (RPC and a direct insert by the table owner: the rule is in the database, OQ-53); withdrawing every optional cell leaves care cells in force.
--   4. Another patient, a clinician, an admin and anon read none of someone's consent history; no direct writes by a patient; anon cannot call the RPCs.
--   5. Care access never reads the matrix: the source of the care access functions does not mention it.
--   6. OQ-53 on patient_consents: withdrawing a required version is refused, withdrawing an optional one works (control).
--   7. Research: the roster lists a person whose research consent is in force and drops them after withdrawal (control: listed before); non-admin refused.
--   8. Care Circle: a member's weekly BP block disappears when the vitals x Care Circle cell is withdrawn; appointments stay (control: the block exists before).
--   9. SABOTAGE A: the rule trigger removed, a required withdrawal must then be accepted. SABOTAGE B: consent_in_force always true, the circle block must then reappear.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;

create function pg_temp.f(p text) returns uuid language sql as $$ select v from fx where k = p $$;
create function pg_temp.ck(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('real', p_name, p_expected, p_actual) $$;
create function pg_temp.act(p_uid uuid) returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
end $f$;
create function pg_temp.back() returns void language plpgsql as
$f$ begin reset role; perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.role', '', true); end $f$;
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
  return r;
end $f$;
create function pg_temp.try_anon(p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
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
  values (v, 's42-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'S42 ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true;
  return v;
end $f$;

do $$
declare
  v_org uuid; v_a uuid; v_b uuid; v_c uuid; v_doc uuid; v_adm uuid; v_sup uuid; v_ver uuid; v_n integer; v_blocks jsonb;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_a := pg_temp.mkuser(v_org, 'patA', 'patient'); v_b := pg_temp.mkuser(v_org, 'patB', 'patient'); v_c := pg_temp.mkuser(v_org, 'patC', 'patient');
  v_doc := pg_temp.mkuser(v_org, 'doc', 'clinician'); v_adm := pg_temp.mkuser(v_org, 'adm', 'admin'); v_sup := pg_temp.mkuser(v_org, 'sup', 'patient');
  insert into fx values ('a', v_a), ('b', v_b), ('c', v_c), ('doc', v_doc), ('adm', v_adm), ('sup', v_sup);
  -- the research roster excludes test accounts (INV-13), so the three people it is asked about are real for this proof
  update public.profiles set is_test = false where id in (v_a, v_b, v_c);

  -- 1. shape
  perform pg_temp.ck('matrix is 5 x 4', '20', (select count(*)::text from public.consent_matrix_cells));
  -- S47: required_for_care applies ONLY to vitals and documents; reproductive, mental health and device data are optional per use
  perform pg_temp.ck('two required cells, all care: vitals and documents only', '2|care|documents,vitals',
    (select count(*)::text || '|' || min(purpose) || '|' || string_agg(data_type, ',' order by data_type) from public.consent_matrix_cells where required_for_care));
  perform pg_temp.ck('S47: reproductive, mental health and device data care cells are optional and asked on first use', '3|on_first_use',
    (select count(*)::text || '|' || min(consent_timing) from public.consent_matrix_cells where purpose = 'care' and not required_for_care));
  perform pg_temp.ck('S47: they are off until the person grants them (asked on first use)', 'false,false,false',
    private.consent_in_force(v_a, 'reproductive', 'care')::text || ',' || private.consent_in_force(v_a, 'mental_health', 'care')::text || ',' || private.consent_in_force(v_a, 'device_data', 'care')::text);
  perform pg_temp.ck('S47: the matrix payload says when each cell is asked', '3',
    pg_temp.q_as(v_a, $q$select count(*)::text from jsonb_array_elements(public.my_consent_matrix() -> 'cells') c where c ->> 'consent_timing' = 'on_first_use'$q$));
  perform pg_temp.ck('no bundle holds a sensitive type', '0', (select count(*)::text from public.consent_bundle_cells where data_type in ('reproductive', 'mental_health')));
  perform pg_temp.ck('no bundle adds a care cell', '0', (select count(*)::text from public.consent_bundle_cells where purpose = 'care'));
  perform pg_temp.ck('wording is draft until counsel approves', '20', (select count(*)::text from public.consent_matrix_cells where wording_status = 'draft_pending_counsel'));

  -- 2. defaults and changes
  perform pg_temp.ck('A: care in force with no rows', 'true|0',
    private.consent_in_force(v_a, 'vitals', 'care')::text || '|' || (select count(*)::text from public.consent_matrix_events where patient_id = v_a));
  perform pg_temp.ck('A: research off by default', 'false', private.consent_in_force(v_a, 'vitals', 'research')::text);
  perform pg_temp.ck('A: matrix RPC returns 20 cells', '20', pg_temp.q_as(v_a, $q$select jsonb_array_length(public.my_consent_matrix() -> 'cells')::text$q$));
  perform pg_temp.ck('A grants vitals research', 'ok', pg_temp.try_as(v_a, $q$select public.set_consent_cell('vitals', 'research', true)$q$));
  perform pg_temp.ck('now in force', 'true', private.consent_in_force(v_a, 'vitals', 'research')::text);
  perform pg_temp.ck('granting again is accepted', 'ok', pg_temp.try_as(v_a, $q$select public.set_consent_cell('vitals', 'research', true)$q$));
  perform pg_temp.ck('still one history row', '1', (select count(*)::text from public.consent_matrix_events where patient_id = v_a));
  perform pg_temp.ck('a bundle grants its cells', 'ok', pg_temp.try_as(v_a, $q$select public.apply_consent_bundle('family_support')$q$));
  perform pg_temp.ck('bundle cell in force', 'true', private.consent_in_force(v_a, 'device_data', 'care_circle_sharing')::text);
  perform pg_temp.ck('a bundle never reaches a sensitive type', 'false', private.consent_in_force(v_a, 'reproductive', 'care_circle_sharing')::text);
  perform pg_temp.ck('unknown cell refused', '22023', pg_temp.try_as(v_a, $q$select public.set_consent_cell('vitals', 'advertising', true)$q$));
  perform pg_temp.ck('unknown bundle refused', '22023', pg_temp.try_as(v_a, $q$select public.apply_consent_bundle('everything')$q$));
  perform pg_temp.ck('A withdraws vitals research', 'ok', pg_temp.try_as(v_a, $q$select public.set_consent_cell('vitals', 'research', false)$q$));
  perform pg_temp.ck('now off', 'false', private.consent_in_force(v_a, 'vitals', 'research')::text);
  perform pg_temp.ck('history keeps grant and withdrawal', '2', (select count(*)::text from public.consent_matrix_events where patient_id = v_a and data_type = 'vitals' and purpose = 'research'));
  perform pg_temp.ck('history RPC shows newest first', 'withdrawn', pg_temp.q_as(v_a, $q$select (public.my_consent_matrix_history(5) -> 0 ->> 'action')$q$));
  perform pg_temp.ck('two outbox events for the two changes to research plus bundle', '3',
    (select count(*)::text from public.domain_events where event_type = 'consent.changed' and patient_id = v_a));
  perform pg_temp.ck('event payload carries no data of the patient', 'false',
    (select bool_or(payload::text ilike '%hypertension%' or payload::text ilike '%diabetes%')::text from public.domain_events where event_type = 'consent.changed' and patient_id = v_a));

  -- 3. required cells
  perform pg_temp.ck('required withdrawal refused by the RPC', '23514', pg_temp.try_as(v_a, $q$select public.set_consent_cell('vitals', 'care', false)$q$));
  begin
    insert into public.consent_matrix_events (organisation_id, patient_id, data_type, purpose, action, policy_version, source, recorded_by)
    values (v_org, v_a, 'documents', 'care', 'withdrawn', 1, 'patient', v_a);
    insert into results values ('real', 'owner insert of a required withdrawal', '23514', 'accepted');
  exception when others then
    insert into results values ('real', 'owner insert of a required withdrawal', '23514', sqlstate);
  end;
  -- S47: asked on first use, withdrawable, and withdrawing stops that feature only
  perform pg_temp.ck('S47: the person is asked for reproductive health when they first use it, and grants it', 'ok', pg_temp.try_as(v_a, $q$select public.set_consent_cell('reproductive', 'care', true)$q$));
  perform pg_temp.ck('S47: feature state says on and asked before', 'true,true', pg_temp.q_as(v_a, $q$select (public.feature_consent_state('reproductive') ->> 'on') || ',' || (public.feature_consent_state('reproductive') ->> 'asked_before')$q$));
  perform pg_temp.ck('S47: a feature that is not optional-per-use is refused by the state function', '22023', pg_temp.try_as(v_a, $q$select public.feature_consent_state('vitals')$q$));
  perform pg_temp.ck('S47: they withdraw reproductive health (this used to be refused)', 'ok', pg_temp.try_as(v_a, $q$select public.set_consent_cell('reproductive', 'care', false)$q$));
  perform pg_temp.ck('S47: ...that feature is off, the rest of care is not touched', 'false,true,true',
    private.consent_in_force(v_a, 'reproductive', 'care')::text || ',' || private.consent_in_force(v_a, 'vitals', 'care')::text || ',' || private.consent_in_force(v_a, 'documents', 'care')::text);
  perform pg_temp.ck('S47: mental health and device data can be granted and withdrawn the same way', 'ok,ok,ok,ok',
    pg_temp.try_as(v_a, $q$select public.set_consent_cell('mental_health', 'care', true)$q$) || ',' || pg_temp.try_as(v_a, $q$select public.set_consent_cell('mental_health', 'care', false)$q$) || ',' ||
    pg_temp.try_as(v_a, $q$select public.set_consent_cell('device_data', 'care', true)$q$) || ',' || pg_temp.try_as(v_a, $q$select public.set_consent_cell('device_data', 'care', false)$q$));
  perform pg_temp.ck('S47: vitals and documents care withdrawal is still refused', '23514,23514',
    pg_temp.try_as(v_a, $q$select public.set_consent_cell('vitals', 'care', false)$q$) || ',' || pg_temp.try_as(v_a, $q$select public.set_consent_cell('documents', 'care', false)$q$));
  perform pg_temp.ck('A withdraws every optional cell', 'ok', pg_temp.try_as(v_a, $q$select public.withdraw_all_optional_consents()$q$));
  perform pg_temp.ck('no optional cell left in force', '0',
    (select count(*)::text from public.consent_matrix_cells c where not c.required_for_care and private.consent_in_force(v_a, c.data_type, c.purpose)));
  perform pg_temp.ck('both required care cells (vitals, documents) still in force', '2',
    (select count(*)::text from public.consent_matrix_cells c where c.required_for_care and private.consent_in_force(v_a, c.data_type, c.purpose)));

  -- 4. who can read and write
  perform pg_temp.ck('A reads their own history', 'true', pg_temp.q_as(v_a, 'select (count(*) > 0)::text from public.consent_matrix_events'));
  perform pg_temp.ck('B reads none of A', '0', pg_temp.q_as(v_b, format('select count(*)::text from public.consent_matrix_events where patient_id = %L', v_a)));
  perform pg_temp.ck('clinician reads none of A', '0', pg_temp.q_as(v_doc, format('select count(*)::text from public.consent_matrix_events where patient_id = %L', v_a)));
  perform pg_temp.ck('admin reads none of A directly', '0', pg_temp.q_as(v_adm, format('select count(*)::text from public.consent_matrix_events where patient_id = %L', v_a)));
  perform pg_temp.ck('anon reads nothing', '42501', pg_temp.try_anon('select count(*) from public.consent_matrix_events'));
  perform pg_temp.ck('patient cannot insert directly', '42501',
    pg_temp.try_as(v_a, format($q$insert into public.consent_matrix_events (organisation_id, patient_id, data_type, purpose, action, policy_version, source, recorded_by) values (%L, %L, 'vitals', 'research', 'granted', 1, 'patient', %L)$q$, v_org, v_a, v_a)));
  perform pg_temp.ck('patient cannot update history', '42501', pg_temp.try_as(v_a, $q$update public.consent_matrix_events set action = 'granted'$q$));
  begin
    update public.consent_matrix_events set action = 'granted' where patient_id = v_a;
    insert into results values ('real', 'owner cannot rewrite history', 'rejected', 'accepted');
  exception when others then
    insert into results values ('real', 'owner cannot rewrite history', 'rejected', 'rejected');
  end;
  perform pg_temp.ck('anon cannot set a consent', '42501', pg_temp.try_anon($q$select public.set_consent_cell('vitals', 'research', true)$q$));
  perform pg_temp.ck('a clinician is not a patient for consent', '42501', pg_temp.try_as(v_doc, $q$select public.set_consent_cell('vitals', 'research', true)$q$));

  -- 5. care access never reads the matrix
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'private' and p.proname in ('can_read_clinical', 'can_staff_read_clinical', 'clinician_has_patient_access', 'has_required_consents', 'has_emergency_access', 'is_org_staff')
     and (p.prosrc ilike '%consent_matrix%' or p.prosrc ilike '%consent_in_force%');
  perform pg_temp.ck('care access functions do not mention the matrix', '0', v_n::text);

  -- 6. OQ-53 on patient_consents
  select id into v_ver from public.consent_versions where consent_type = 'terms_of_service' and is_current;
  insert into public.patient_consents (organisation_id, patient_id, consent_type, consent_version_id, version, action)
    select v_org, v_b, 'terms_of_service', id, version, 'accepted' from public.consent_versions where id = v_ver;
  perform pg_temp.ck('B cannot withdraw a required consent (direct insert)', '23514',
    pg_temp.try_as(v_b, format($q$insert into public.patient_consents (organisation_id, patient_id, consent_type, consent_version_id, version, action) values (%L, %L, 'terms_of_service', %L, 'x', 'withdrawn')$q$, v_org, v_b, v_ver)));
  insert into public.consent_versions (consent_type, version, title, body, is_current, is_optional)
    values ('research', 's42-proof', 'Draft', 'Draft', true, true);
  insert into public.patient_consents (organisation_id, patient_id, consent_type, consent_version_id, version, action)
    select v_org, v_b, 'research', id, version, 'accepted' from public.consent_versions where consent_type = 'research' and is_current;
  perform pg_temp.ck('control: B can withdraw an optional consent', 'ok',
    pg_temp.try_as(v_b, format($q$insert into public.patient_consents (organisation_id, patient_id, consent_type, consent_version_id, version, action) values (%L, %L, 'research', %L, 'x', 'withdrawn')$q$, v_org, v_b,
      (select id from public.consent_versions where consent_type = 'research' and is_current))));

end $$;

do $$
declare v_a uuid := pg_temp.f('a'); v_b uuid := pg_temp.f('b'); v_c uuid := pg_temp.f('c'); v_adm uuid := pg_temp.f('adm'); v_doc uuid := pg_temp.f('doc'); v_sup uuid := pg_temp.f('sup');
        v_org uuid; v_blocks jsonb;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  perform pg_temp.ck('A grants research', 'ok', pg_temp.try_as(v_a, $q$select public.set_consent_cell('documents', 'research', true)$q$));
  perform pg_temp.ck('B grants research', 'ok', pg_temp.try_as(v_b, $q$select public.set_consent_cell('vitals', 'research', true)$q$));
  perform pg_temp.ck('B withdraws research', 'ok', pg_temp.try_as(v_b, $q$select public.set_consent_cell('vitals', 'research', false)$q$));
  perform pg_temp.ck('roster lists A (control: in before)', 'true', pg_temp.q_as(v_adm, format('select exists (select 1 from public.research_export_roster() r where r.patient_id = %L)::text', v_a)));
  perform pg_temp.ck('roster does not list B (withdrew)', 'false', pg_temp.q_as(v_adm, format('select exists (select 1 from public.research_export_roster() r where r.patient_id = %L)::text', v_b)));
  perform pg_temp.ck('roster does not list C (never asked)', 'false', pg_temp.q_as(v_adm, format('select exists (select 1 from public.research_export_roster() r where r.patient_id = %L)::text', v_c)));
  perform pg_temp.ck('roster says which data type', '{documents}', pg_temp.q_as(v_adm, format('select r.data_types::text from public.research_export_roster() r where r.patient_id = %L', v_a)));
  perform pg_temp.ck('roster refused to a clinician', '42501', pg_temp.try_as(v_doc, 'select * from public.research_export_roster()'));
  perform pg_temp.ck('roster refused to a patient', '42501', pg_temp.try_as(v_a, 'select * from public.research_export_roster()'));
  perform pg_temp.ck('roster refused to anon', '42501', pg_temp.try_anon('select * from public.research_export_roster()'));
  perform pg_temp.ck('roster read is audited', 'true', (select (count(*) > 0)::text from public.audit_log where action = 'research_export.roster_read' and actor_id = v_adm));
  perform pg_temp.ck('test account grants research', 'ok', pg_temp.try_as(v_sup, $q$select public.set_consent_cell('vitals', 'research', true)$q$));
  perform pg_temp.ck('a test account is never on the roster', 'false', pg_temp.q_as(v_adm, format('select exists (select 1 from public.research_export_roster() r where r.patient_id = %L)::text', v_sup)));
  -- A withdraws: gone from the NEXT export
  perform pg_temp.ck('A withdraws research', 'ok', pg_temp.try_as(v_a, $q$select public.set_consent_cell('documents', 'research', false)$q$));
  perform pg_temp.ck('A is off the next roster', 'false', pg_temp.q_as(v_adm, format('select exists (select 1 from public.research_export_roster() r where r.patient_id = %L)::text', v_a)));

  -- 8. Care Circle
  insert into public.care_circle_members (organisation_id, patient_id, supporter_id, relationship, permissions, expires_at, is_test)
    values (v_org, v_a, v_sup, 'sister', array['weekly_bp_trend', 'appointments'], now() + interval '30 days', true);
  perform pg_temp.ck('adding a member grants the circle cell', 'true', private.consent_in_force(v_a, 'vitals', 'care_circle_sharing')::text);
  v_blocks := private.circle_view_blocks(v_a, array['weekly_bp_trend', 'appointments']);
  perform pg_temp.ck('control: bp block present while consented', 'true|true', (v_blocks ? 'bp_trend')::text || '|' || (v_blocks ? 'appointments')::text);
  perform pg_temp.ck('A withdraws circle sharing of vitals', 'ok', pg_temp.try_as(v_a, $q$select public.set_consent_cell('vitals', 'care_circle_sharing', false)$q$));
  v_blocks := private.circle_view_blocks(v_a, array['weekly_bp_trend', 'appointments']);
  perform pg_temp.ck('bp block gone, appointments stay', 'false|true', (v_blocks ? 'bp_trend')::text || '|' || (v_blocks ? 'appointments')::text);
end $$;

-- SABOTAGE C (S47): reproductive health care made required again. Withdrawing it must then be refused (the real check, which expects ok, flips).
update public.consent_matrix_cells set required_for_care = true where data_type = 'reproductive' and purpose = 'care';
do $$
declare v_a uuid := pg_temp.f('a');
begin
  perform pg_temp.try_as(v_a, $q$select public.set_consent_cell('reproductive', 'care', true)$q$);
  insert into results values ('sabotaged', 'S47: they withdraw reproductive health (this used to be refused)', 'ok', pg_temp.try_as(v_a, $q$select public.set_consent_cell('reproductive', 'care', false)$q$));
end $$;
update public.consent_matrix_cells set required_for_care = false where data_type = 'reproductive' and purpose = 'care';

-- 9. SABOTAGE A: the rule trigger is gone. A required withdrawal must then be accepted (the real check flips).
drop trigger consent_matrix_events_rule on public.consent_matrix_events;
do $$
declare v_a uuid := pg_temp.f('a'); v_org uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  begin
    insert into public.consent_matrix_events (organisation_id, patient_id, data_type, purpose, action, policy_version, source, recorded_by)
    values (v_org, v_a, 'documents', 'care', 'withdrawn', 1, 'patient', v_a);
    insert into results values ('sabotaged', 'required withdrawal refused', '23514', 'accepted');
  exception when others then
    insert into results values ('sabotaged', 'required withdrawal refused', '23514', sqlstate);
  end;
end $$;

-- SABOTAGE B: consent_in_force says yes to everything. The circle block must then come back for a withdrawn cell.
create or replace function private.consent_in_force(p_patient uuid, p_data_type text, p_purpose text) returns boolean
language sql stable set search_path = '' as $$ select true $$;
do $$
declare v_blocks jsonb := private.circle_view_blocks(pg_temp.f('a'), array['weekly_bp_trend']);
begin
  insert into results values ('sabotaged', 'bp block stays off after withdrawal', 'false', (v_blocks ? 'bp_trend')::text);
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S42 consent matrix proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ')
         from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 3 then raise exception 'VACUOUS TEST: the sabotage flipped % of 3 checks', v_caught; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;

rollback;
