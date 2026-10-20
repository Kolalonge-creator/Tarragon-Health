-- RCPT-1 proof: consent receipts (migration 20261020232611_consent_receipt_data.sql). One rolled-back transaction. Proves:
--   1. a single change receipt names the data type, purpose, action, wording status and time; holds no clinical value; carries only whitelisted keys; one audit row (scope and ref only)
--   2. own rows only: another patient gets "not found" with no audit row and no existence oracle; the function has no patient argument
--   3. refused roles: clinician, admin, signed-out, anon, inactive patient; none writes an audit row
--   4. bad input is refused; 5. a document consent receipt carries the exact words and who/where; 6. the whole picture is the caller's own, marks wording status, and a withdrawal is a receipt
--   7. SABOTAGE: the own-rows filter, the audit call and the role gate each removed; each must flip its check.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;

create function pg_temp.f(p text) returns uuid language sql as $$ select v from fx where k = p $$;
create function pg_temp.setf(p text, p_v uuid) returns void language sql as
$$ insert into fx values (p, p_v) on conflict (k) do update set v = excluded.v $$;
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
-- run a statement as a signed-in user; returns 'ok' or the error message
create function pg_temp.try_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql; r := 'ok'; exception when others then r := sqlerrm; end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.q_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlerrm; end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.q(p_sql text) returns text language plpgsql as
$f$ declare r text; begin execute p_sql into r; return r; end $f$;
create function pg_temp.try_service(p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  set local role service_role;
  begin execute p_sql into r; r := coalesce(r, 'ok'); exception when others then r := sqlerrm; end;
  reset role;
  return r;
end $f$;
create function pg_temp.try_sql_owner(p_sql text) returns text language plpgsql as
$f$ begin execute p_sql; return 'ok'; exception when others then return sqlerrm; end $f$;
create function pg_temp.q_anon(p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  set local role anon;
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlerrm; end;
  reset role;
  return r;
end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'rcpt-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'RCPT ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone, date_of_birth = excluded.date_of_birth;
  return v;
end $f$;

do $$
declare
  v_org uuid; v_admin uuid; v_a uuid; v_b uuid; v_clin uuid;
  v_ev uuid; v_ev_b uuid; v_doc uuid; v_cv uuid; v_j jsonb; v_t text; v_n integer;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  v_a := pg_temp.mkuser(v_org, 'a', 'patient');
  v_b := pg_temp.mkuser(v_org, 'b', 'patient');
  v_clin := pg_temp.mkuser(v_org, 'clin', 'clinician');
  update public.profiles set full_name = 'RCPT Person A' where id = v_a;
  update public.profiles set full_name = 'RCPT Person B' where id = v_b;

  -- a reading that must never appear in a receipt
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, source, taken_at)
  values (v_org, v_a, 'blood_pressure', 187, 111, 'manual', now());

  -- A changes a choice; B changes one too
  perform pg_temp.q_as(v_a, $q$select public.set_consent_cell('vitals', 'research', true)$q$);
  perform pg_temp.q_as(v_b, $q$select public.set_consent_cell('mental_health', 'research', true)$q$);
  select id into v_ev from public.consent_matrix_events where patient_id = v_a and data_type = 'vitals' and purpose = 'research';
  select id into v_ev_b from public.consent_matrix_events where patient_id = v_b and data_type = 'mental_health' and purpose = 'research';

  -- ===== 1. a single change =====================================================================================================
  perform pg_temp.ck('1a the history carries the entry id', 'true',
    (pg_temp.q_as(v_a, $q$select (public.my_consent_matrix_history(5) -> 0 ->> 'id') is not null$q$))::text);
  v_t := pg_temp.q_as(v_a, format($q$select public.consent_receipt_data('matrix_event', %L)::text$q$, v_ev));
  v_j := v_t::jsonb;
  perform pg_temp.ck('1b the receipt names what, which purpose, granted, and the wording status', 'vitals:research:granted:draft_pending_counsel',
    (v_j -> 'change' ->> 'data_type') || ':' || (v_j -> 'change' ->> 'purpose') || ':' || (v_j -> 'change' ->> 'action') || ':' || (v_j -> 'change' ->> 'wording_status'));
  perform pg_temp.ck('1c it carries the person and a time', 'true',
    (coalesce(v_j ->> 'person', '') = 'RCPT Person A' and coalesce(v_j -> 'change' ->> 'at', '') <> '')::text);
  perform pg_temp.ck('1d it holds no clinical value (the 187/111 reading is nowhere in it)', 'false',
    (v_t ~ '[^0-9.]187([^0-9]|$)' or v_t ~ '[^0-9.]111([^0-9]|$)' or v_t ilike '%systolic%')::text);
  perform pg_temp.ck('1e it holds only the whitelisted change keys', 'action,at,data_type,policy_version,purpose,required_for_care,source,text_key,wording_current,wording_status',
    (select string_agg(k, ',' order by k) from jsonb_object_keys(v_j -> 'change') k));
  perform pg_temp.ck('1f one audit row, scope and ref only', '1:matrix_event',
    (select count(*)::text || ':' || min(event ->> 'scope') from public.audit_log where actor_id = v_a and action = 'consent.receipt_downloaded'));
  perform pg_temp.ck('1g the audit event holds no person data or values', 'ref,scope',
    (select string_agg(k, ',' order by k) from public.audit_log l, jsonb_object_keys(l.event) k where l.actor_id = v_a and l.action = 'consent.receipt_downloaded'));

  -- ===== 2. own rows only ==========================================================================================================
  perform pg_temp.ck('2a another patient asking for A''s entry gets not found', 'true',
    (pg_temp.try_as(v_b, format($q$select public.consent_receipt_data('matrix_event', %L)$q$, v_ev)) like '%consent_receipt_not_found%')::text);
  perform pg_temp.ck('2b ...and it wrote no audit row for B', '0',
    (select count(*)::text from public.audit_log where actor_id = v_b and action = 'consent.receipt_downloaded'));
  perform pg_temp.ck('2c a made-up id is the same answer (no oracle)', 'true',
    (pg_temp.try_as(v_b, $q$select public.consent_receipt_data('matrix_event', gen_random_uuid())$q$) like '%consent_receipt_not_found%')::text);
  perform pg_temp.ck('2d B can read B''s own', 'mental_health',
    pg_temp.q_as(v_b, format($q$select public.consent_receipt_data('matrix_event', %L) -> 'change' ->> 'data_type'$q$, v_ev_b)));
  perform pg_temp.ck('2e the function has no patient argument', '2',
    (select pronargs::text from pg_proc where proname = 'consent_receipt_data' and pronamespace = 'public'::regnamespace));

  -- ===== 3. refused roles ==========================================================================================================
  perform pg_temp.ck('3a a clinician is refused', 'true',
    (pg_temp.try_as(v_clin, $q$select public.consent_receipt_data('all')$q$) like '%consent_not_authorised%')::text);
  perform pg_temp.ck('3b an admin is refused', 'true',
    (pg_temp.try_as(v_admin, $q$select public.consent_receipt_data('all')$q$) like '%consent_not_authorised%')::text);
  perform pg_temp.ck('3c a signed-out caller is refused', 'true',
    (pg_temp.try_sql_owner($q$select public.consent_receipt_data('all')$q$) like '%consent_not_authorised%')::text);
  perform pg_temp.ck('3d anon cannot call it', 'true',
    (pg_temp.q_anon($q$select public.consent_receipt_data('all')$q$) like '%permission denied%')::text);
  update public.profiles set is_active = false where id = v_b;
  perform pg_temp.ck('3e an inactive patient is refused', 'true',
    (pg_temp.try_as(v_b, $q$select public.consent_receipt_data('all')$q$) like '%consent_not_authorised%')::text);
  update public.profiles set is_active = true where id = v_b;
  perform pg_temp.ck('3f refused roles wrote no audit rows', '0',
    (select count(*)::text from public.audit_log where actor_id in (v_clin, v_admin) and action = 'consent.receipt_downloaded'));

  -- ===== 4. input =================================================================================================================
  perform pg_temp.ck('4a an unknown scope is refused', 'true',
    (pg_temp.try_as(v_a, $q$select public.consent_receipt_data('everything')$q$) like '%consent_receipt_scope_unknown%')::text);
  perform pg_temp.ck('4b a change scope without an id is refused', 'true',
    (pg_temp.try_as(v_a, $q$select public.consent_receipt_data('matrix_event')$q$) like '%consent_receipt_ref_needed%')::text);

  -- ===== 5. a document consent (the exact words) ====================================================================================
  select id into v_cv from public.consent_versions where is_current and consent_type = 'data_processing' limit 1;
  if v_cv is null then
    insert into public.consent_versions (consent_type, version, title, body, is_current) values ('data_processing', 'rcpt-v1', 'Data processing', 'RCPT exact words', true) returning id into v_cv;
  end if;
  insert into public.patient_consents (organisation_id, patient_id, consent_type, consent_version_id, version, action, channel)
  select v_org, v_a, cv.consent_type, cv.id, cv.version, 'accepted', 'web' from public.consent_versions cv where cv.id = v_cv returning id into v_doc;
  v_j := pg_temp.q_as(v_a, format($q$select public.consent_receipt_data('document_event', %L)::text$q$, v_doc))::jsonb;
  perform pg_temp.ck('5a the receipt carries the exact words, version and who/where', 'true:true:web:legacy',
    ((v_j -> 'change' ->> 'body') is not null)::text || ':' || ((v_j -> 'change' ->> 'version') is not null)::text || ':' || (v_j -> 'change' ->> 'channel') || ':' || (v_j -> 'change' ->> 'consented_by_relation'));
  perform pg_temp.ck('5b another patient cannot open it', 'true',
    (pg_temp.try_as(v_b, format($q$select public.consent_receipt_data('document_event', %L)$q$, v_doc)) like '%consent_receipt_not_found%')::text);

  -- ===== 6. the whole picture ======================================================================================================
  v_j := pg_temp.q_as(v_a, $q$select public.consent_receipt_data('all')::text$q$)::jsonb;
  perform pg_temp.ck('6a twenty matrix cells, a document list', '20:true',
    jsonb_array_length(v_j -> 'cells')::text || ':' || (jsonb_typeof(v_j -> 'documents') = 'array')::text);
  perform pg_temp.ck('6b A''s research x vitals is granted; the care cell is in force', 'true:true',
    (select (c ->> 'granted')::text from jsonb_array_elements(v_j -> 'cells') c where c ->> 'data_type' = 'vitals' and c ->> 'purpose' = 'research') || ':' ||
    (select (c ->> 'granted')::text from jsonb_array_elements(v_j -> 'cells') c where c ->> 'data_type' = 'vitals' and c ->> 'purpose' = 'care'));
  v_j := pg_temp.q_as(v_b, $q$select public.consent_receipt_data('all')::text$q$)::jsonb;
  perform pg_temp.ck('6c B''s picture is B''s own (vitals research is off for B)', 'false',
    (select (c ->> 'granted')::text from jsonb_array_elements(v_j -> 'cells') c where c ->> 'data_type' = 'vitals' and c ->> 'purpose' = 'research'));
  perform pg_temp.ck('6d every cell says whether its wording is placeholder', 'true',
    (select bool_and((c ->> 'wording_status') in ('draft_pending_counsel', 'approved')) from jsonb_array_elements(v_j -> 'cells') c)::text);
  perform pg_temp.q_as(v_a, $q$select public.set_consent_cell('vitals', 'research', false)$q$);
  perform pg_temp.ck('6f ...the newest entry for A is the withdrawal and its receipt says so', 'withdrawn',
    pg_temp.q_as(v_a, $q$select public.consent_receipt_data('matrix_event', (public.my_consent_matrix_history(1) -> 0 ->> 'id')::uuid) -> 'change' ->> 'action'$q$));

  perform pg_temp.ck('6g the receipt says the wording is current while the version matches', 'true',
    pg_temp.q_as(v_a, format($q$select (public.consent_receipt_data('matrix_event', %L) -> 'change' ->> 'wording_current')$q$, v_ev)));
  update public.consent_matrix_cells set policy_version = policy_version + 1 where data_type = 'vitals' and purpose = 'research';
  perform pg_temp.ck('6h ...and says it is NOT once the wording version in force has moved on', 'false',
    pg_temp.q_as(v_a, format($q$select (public.consent_receipt_data('matrix_event', %L) -> 'change' ->> 'wording_current')$q$, v_ev)));
  perform pg_temp.ck('6i the whole picture shows the version now in force (2)', '2',
    pg_temp.q_as(v_a, $q$select (c ->> 'policy_version') from jsonb_array_elements(public.consent_receipt_data('all') -> 'cells') c where c ->> 'data_type' = 'vitals' and c ->> 'purpose' = 'research'$q$));

  -- ===== 7. sabotage ===============================================================================================================
  -- A. the own-rows filter removed: B must then be able to read A's entry (2a flips)
  execute replace(pg_get_functiondef('public.consent_receipt_data(text, uuid)'::regprocedure), 'where e.id = p_ref and e.patient_id = v_uid', 'where e.id = p_ref');
  insert into results values ('sabotaged', '2a another patient asking for A''s entry gets not found', 'true',
    (pg_temp.try_as(v_b, format($q$select public.consent_receipt_data('matrix_event', %L)$q$, v_ev)) like '%consent_receipt_not_found%')::text);
  -- B. the audit call removed: a download then leaves no row (1f-style count must stay at its earlier value)
  select count(*) into v_n from public.audit_log where actor_id = v_b and action = 'consent.receipt_downloaded';
  execute replace(pg_get_functiondef('public.consent_receipt_data(text, uuid)'::regprocedure), 'perform private.log_audit(', 'perform (select 1); -- ');
  perform pg_temp.q_as(v_b, $q$select public.consent_receipt_data('all')$q$);
  insert into results values ('sabotaged', 'a download writes exactly one audit row', '1',
    ((select count(*) from public.audit_log where actor_id = v_b and action = 'consent.receipt_downloaded') - v_n)::text);
  -- C. the role gate removed: a clinician must then be able to call it (3a flips)
  execute replace(pg_get_functiondef('public.consent_receipt_data(text, uuid)'::regprocedure), 'and role = ''patient'' and is_active;', ';');
  insert into results values ('sabotaged', '3a a clinician is refused', 'true',
    (pg_temp.try_as(v_clin, $q$select public.consent_receipt_data('all')$q$) like '%consent_not_authorised%')::text);
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FLIPPED' end as result
from results where phase = 'sabotaged'
union all
select 'real', count(*)::text || ' checks', 'all pass', 'all pass', 'PASS' from results where phase = 'real';

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'RCPT-1 proof FAILED: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), E'\n  ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 3 then raise exception 'VACUOUS TEST: the sabotage flipped % of 3 checks', v_caught; end if;
end $$;

rollback;
