-- S39e proof: shared work queues keep working under the care tie (migration *_s39e_worklists_and_work_counts.sql).
-- A role simulation in one rolled-back transaction. For each of the seven queues, an open item for a patient the clinician is NOT tied to, and one for a tied
-- patient, are made by a generic fixture. Proves: before this migration a clinician sees only the tied item by direct read; clinical_worklist() shows both,
-- with only the patient's name, number, kind and date (no result, note or answer column); a care coordinator, an admin, a patient, another organisation's
-- clinician and anon are refused; org_open_work_counts() gives an admin and a clinician the organisation totals and refuses a coordinator, a patient and anon;
-- a closed item (action completed, follow-up recorded) is not listed. Queues whose fixture cannot be built are named in the result, never skipped silently.
-- SABOTAGE: the organisation filter removed from the worklist (another organisation's item appears).
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;
create function pg_temp.setf(p text, p_v uuid) returns void language sql as $$ insert into fx values (p, p_v) on conflict (k) do update set v = excluded.v $$;
create function pg_temp.f(p text) returns uuid language sql as $$ select v from fx where k = p $$;
create function pg_temp.ck(p_phase text, p_name text, p_expected text, p_actual text) returns void language sql as $$ insert into results values (p_phase, p_name, p_expected, p_actual) $$;

create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid language plpgsql as
$f$ declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's39e-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'S39e ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true)
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, is_test = true, is_active = true;
  if p_role = 'clinician' then
    insert into public.clinical_staff (organisation_id, profile_id, full_name, active, license_verified_at, doctor_tier)
    values (p_org, v, 'S39e ' || p_label, true, now(), 'medical_officer');
  end if;
  return v;
end $f$;

-- run one statement as a user; returns the first column as text, or the sqlstate on an error
create function pg_temp.as_user(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
  begin execute p_sql into r; exception when others then r := 'ERR ' || sqlstate; end;
  reset role;
  perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.sub', '', true); perform set_config('request.jwt.claim.role', '', true);
  return r;
end $f$;
create function pg_temp.as_anon(p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
  begin execute p_sql into r; exception when others then r := 'ERR ' || sqlstate; end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return r;
end $f$;

create function pg_temp.try_sql(p_sql text) returns text language plpgsql as
$f$ begin execute p_sql; return 'ok'; exception when others then return sqlerrm; end $f$;


create temp table built(kind text primary key, ok boolean, err text, tied_item uuid, untied_item uuid, closed_item uuid) on commit drop;
grant all on built to public;

-- generic fixture: fills every required column; foreign keys to profiles get the patient, others borrow an existing parent row
create function pg_temp.mkrow(p_table text, p_org uuid, p_patient uuid, p_over jsonb) returns uuid language plpgsql as
$f$
declare c record; cols text[] := '{}'; vals text[] := '{}'; v text; fk regclass; v_id uuid; v_enum text;
begin
  for c in select a.attname, a.attnum, t.typname, t.typtype, t.oid as toid, a.attnotnull, a.atthasdef
             from pg_attribute a join pg_type t on t.oid = a.atttypid
            where a.attrelid = ('public.' || p_table)::regclass and a.attnum > 0 and not a.attisdropped and a.attgenerated = '' loop
    v := null;
    if p_over ? c.attname then v := case when p_over -> c.attname = 'null'::jsonb then 'null' else quote_literal(p_over ->> c.attname) end;
    elsif c.attname = 'organisation_id' then v := quote_literal(p_org);
    elsif c.attname in ('patient_id', 'profile_id') then v := quote_literal(p_patient);
    elsif c.attnotnull and not c.atthasdef then
      select confrelid::regclass into fk from pg_constraint where conrelid = ('public.' || p_table)::regclass and contype = 'f' and conkey[1] = c.attnum limit 1;
      if fk is not null then
        if fk::text in ('profiles', 'public.profiles') then v := quote_literal(p_patient);
        else
          execute format('select id from %s limit 1', fk) into v_id;
          if v_id is null then raise exception 'no parent row in % for %', fk, c.attname; end if;
          v := quote_literal(v_id);
        end if;
      elsif c.typtype = 'e' then
        select e.enumlabel into v_enum from pg_enum e where e.enumtypid = c.toid order by e.enumsortorder limit 1; v := quote_literal(v_enum);
      else
        v := case c.typname
          when 'text' then quote_literal('S39e fixture') when 'varchar' then quote_literal('S39e fixture') when 'bpchar' then quote_literal('S39e')
          when 'int4' then '1' when 'int8' then '1' when 'int2' then '1' when 'numeric' then '1' when 'float8' then '1' when 'float4' then '1'
          when 'bool' then 'false' when 'date' then 'current_date' when 'timestamptz' then 'now()' when 'timestamp' then 'now()'
          when 'jsonb' then quote_literal('{}') when 'json' then quote_literal('{}') when 'uuid' then quote_literal(gen_random_uuid())
          when '_text' then quote_literal('{}') else null end;
        if v is null then raise exception 'cannot fill % (%)', c.attname, c.typname; end if;
      end if;
    else continue; end if;
    cols := cols || quote_ident(c.attname); vals := vals || v;
  end loop;
  execute format('insert into public.%I (%s) values (%s) returning id', p_table, array_to_string(cols, ','), array_to_string(vals, ',')) into v_id;
  return v_id;
end $f$;

do $$
declare
  v_org uuid; v_org2 uuid; v_a uuid; v_b uuid; v_co uuid; v_ad uuid; v_ox uuid; v_p1 uuid; v_p2 uuid; v_p3 uuid; v_p4 uuid; v_tied uuid; v_un uuid; v_cl uuid; k record; r_cfg jsonb;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  select id into v_org2 from public.organisations where id <> v_org order by created_at limit 1;
  if v_org2 is null then insert into public.organisations (name, type) values ('S39e second org', 'clinic') returning id into v_org2; end if;
  v_p1 := pg_temp.mkuser(v_org, 'tied patient', 'patient'); v_p2 := pg_temp.mkuser(v_org, 'untied patient', 'patient'); v_p3 := pg_temp.mkuser(v_org2, 'other org patient', 'patient'); v_p4 := pg_temp.mkuser(v_org, 'closed items patient', 'patient');
  v_a := pg_temp.mkuser(v_org, 'tied clinician', 'clinician'); v_b := pg_temp.mkuser(v_org, 'untied clinician', 'clinician');
  v_co := pg_temp.mkuser(v_org, 'coordinator', 'care_coordinator'); v_ad := pg_temp.mkuser(v_org, 'admin', 'admin'); v_ox := pg_temp.mkuser(v_org2, 'other org clinician', 'clinician');
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id, care_coordinator_id, assigned_at) values (v_org, v_p1, v_a, v_co, now()), (v_org, v_p2, v_a, v_co, now())
    on conflict (patient_id) do update set clinician_id = excluded.clinician_id, care_coordinator_id = excluded.care_coordinator_id, clinical_director_id = null;
  -- the untied patient has a care team as well (somebody else), so the clinician B is tied to neither
  v_a := v_a;
  perform pg_temp.setf('org', v_org); perform pg_temp.setf('a', v_a); perform pg_temp.setf('b', v_b); perform pg_temp.setf('co', v_co); perform pg_temp.setf('ad', v_ad);
  perform pg_temp.setf('ox', v_ox); perform pg_temp.setf('p1', v_p1); perform pg_temp.setf('p2', v_p2); perform pg_temp.setf('p3', v_p3); perform pg_temp.setf('org2', v_org2);

  for k in select * from (values
    ('lab_results', 'lab_result_documents', '{}'::jsonb, '{"acknowledgement_status":"action_completed"}'::jsonb),
    ('abnormal_screening', 'screening_results', '{"result_status":"abnormal","follow_up_action":null}'::jsonb, '{"result_status":"abnormal","follow_up_action":"call patient"}'::jsonb),
    ('lifestyle_flags', 'lpe_red_flag_events', '{"status":"open"}'::jsonb, '{"status":"stood_down"}'::jsonb),
    ('lifestyle_reviews', 'lpe_reviews', '{"status":"pending"}'::jsonb, '{"status":"completed"}'::jsonb),
    ('annual_check_reviews', 'annual_health_checks', '{"review_requested_at":"2026-01-01T00:00:00Z","reviewed_at":null}'::jsonb, '{"review_requested_at":"2026-01-01T00:00:00Z","reviewed_at":"2026-01-02T00:00:00Z"}'::jsonb),
    ('therapy_approvals', 'therapy_sessions', '{"status":"awaiting_clinician_approval"}'::jsonb, '{"status":"approved"}'::jsonb),
    ('vaccination_verification', 'vaccination_records', '{"verification_status":"pending_verification"}'::jsonb, null::jsonb)
  ) as t(kind, tbl, open_over, closed_over) loop
    begin
      v_tied := pg_temp.mkrow(k.tbl, v_org, v_p1, k.open_over || case when k.tbl = 'lpe_reviews' then jsonb_build_object('enrollment_id', pg_temp.mkrow('lpe_enrollments', v_org, v_p1, '{}')) else '{}' end);
      v_un := pg_temp.mkrow(k.tbl, v_org, v_p2, k.open_over || case when k.tbl = 'lpe_reviews' then jsonb_build_object('enrollment_id', pg_temp.mkrow('lpe_enrollments', v_org, v_p2, '{}')) else '{}' end);
      v_cl := case when k.closed_over is null then null else pg_temp.mkrow(k.tbl, v_org, v_p4, k.closed_over || case when k.tbl = 'lpe_reviews' then jsonb_build_object('enrollment_id', pg_temp.mkrow('lpe_enrollments', v_org, v_p4, '{}')) else '{}' end) end;
      perform pg_temp.mkrow(k.tbl, v_org2, v_p3, k.open_over || case when k.tbl = 'lpe_reviews' then jsonb_build_object('enrollment_id', pg_temp.mkrow('lpe_enrollments', v_org2, v_p3, '{}')) else '{}' end);
      insert into built values (k.kind, true, null, v_tied, v_un, v_cl);
      if k.kind = 'lab_results' then
        perform pg_temp.ck('real', 'W1 the untied clinician cannot read the untied patient''s lab document directly (the S39b behaviour this fixes)', '0', pg_temp.as_user(v_b, format('select count(*) from public.lab_result_documents where patient_id = %L', v_p2)));
      end if;
    exception when others then
      insert into built values (k.kind, false, sqlerrm, null, null, null);
    end;
  end loop;
end $$;

-- as the untied clinician: direct reads are tied, the worklist is not
select pg_temp.ck('real', 'W0 exactly these six queues are built as fixtures (therapy approvals cannot be, see W9)', 'abnormal_screening,annual_check_reviews,lab_results,lifestyle_flags,lifestyle_reviews,vaccination_verification', (select string_agg(kind, ',' order by kind) from built where ok));
select pg_temp.ck('real', 'W2 every built queue lists the untied patient''s open item for the untied clinician', '',
  (select coalesce(string_agg(b.kind, ','), '') from built b where b.ok
     and pg_temp.as_user(pg_temp.f('b'), format('select count(*) from public.clinical_worklist() w where w.kind = %L and w.item_id = %L', b.kind, b.untied_item)) <> '1'));
select pg_temp.ck('real', 'W3 ...and the tied patient''s item too', '',
  (select coalesce(string_agg(b.kind, ','), '') from built b where b.ok
     and pg_temp.as_user(pg_temp.f('b'), format('select count(*) from public.clinical_worklist() w where w.kind = %L and w.item_id = %L', b.kind, b.tied_item)) <> '1'));
select pg_temp.ck('real', 'W4 a closed item is not listed', '',
  (select coalesce(string_agg(b.kind, ','), '') from built b where b.ok and b.closed_item is not null
     and pg_temp.as_user(pg_temp.f('b'), format('select count(*) from public.clinical_worklist() w where w.item_id = %L', b.closed_item)) <> '0'));
select pg_temp.ck('real', 'W5 the answer carries only name, number, kind, label, date and the queue size', 'kind,item_id,patient_id,patient_name,patient_number,item_label,item_date,kind_total',
  (select array_to_string(p.proargnames, ',') from pg_proc p where p.proname = 'clinical_worklist' and p.pronamespace = 'public'::regnamespace));
select pg_temp.ck('real', 'W6 another organisation''s items never appear', '0',
  pg_temp.as_user(pg_temp.f('b'), format('select count(*) from public.clinical_worklist() w where w.patient_id = %L', pg_temp.f('p3'))));
select pg_temp.ck('real', 'W7 a coordinator, an admin, a patient, another organisation''s clinician and anon are refused the worklist', 'ERR 42501|ERR 42501|ERR 42501|0|ERR 42501',
  (pg_temp.as_user(pg_temp.f('co'), 'select count(*) from public.clinical_worklist()') || '|' || pg_temp.as_user(pg_temp.f('ad'), 'select count(*) from public.clinical_worklist()') || '|'
   || pg_temp.as_user(pg_temp.f('p1'), 'select count(*) from public.clinical_worklist()') || '|'
   || pg_temp.as_user(pg_temp.f('ox'), format('select count(*) from public.clinical_worklist() w where w.patient_id in (%L, %L)', pg_temp.f('p1'), pg_temp.f('p2'))) || '|'
   || pg_temp.as_anon('select count(*) from public.clinical_worklist()')));
-- counts
select pg_temp.ck('real', 'C1 an admin gets organisation totals for every built queue (open items only)', '',
  (select coalesce(string_agg(b.kind, ','), '') from built b where b.ok
     and pg_temp.as_user(pg_temp.f('ad'), format('select n from public.org_open_work_counts() where kind = %L', b.kind))::integer < 2));
select pg_temp.ck('real', 'C2 a clinician gets the same totals', 'true',
  (pg_temp.as_user(pg_temp.f('b'), 'select count(*) from public.org_open_work_counts()')::integer = 8)::text);
select pg_temp.ck('real', 'C3 a coordinator, a patient and anon are refused the counts', 'ERR 42501|ERR 42501|ERR 42501',
  (pg_temp.as_user(pg_temp.f('co'), 'select count(*) from public.org_open_work_counts()') || '|' || pg_temp.as_user(pg_temp.f('p1'), 'select count(*) from public.org_open_work_counts()') || '|' || pg_temp.as_anon('select count(*) from public.org_open_work_counts()')));
select pg_temp.ck('real', 'C4 another organisation''s clinician sees only their own organisation''s totals (one lab item, one screening item)', '1|1',
  (pg_temp.as_user(pg_temp.f('ox'), 'select n from public.org_open_work_counts() where kind = ''lab_results''') || '|' || pg_temp.as_user(pg_temp.f('ox'), 'select n from public.org_open_work_counts() where kind = ''abnormal_screening''')));
select pg_temp.ck('real', 'C5 the queue size is the true total', 'true',
  (pg_temp.as_user(pg_temp.f('b'), 'select min(kind_total) from public.clinical_worklist() where kind = ''lab_results''')::integer >= 2)::text);
-- W9: honest account of what could not be fixtured
select pg_temp.ck('real', 'W9 queues whose fixture could not be built (named, not skipped)', coalesce((select string_agg(kind || ': ' || err, '; ') from built where not ok), ''), coalesce((select string_agg(kind || ': ' || err, '; ') from built where not ok), ''));

-- SABOTAGE: the organisation filter removed from the lab queue
do $$
declare v_def text; v_n text;
begin
  if exists (select 1 from built where kind = 'lab_results' and ok) then
    select pg_get_functiondef('public.clinical_worklist()'::regprocedure) into v_def;
    v_def := replace(v_def, 'd.organisation_id = v_org and d.acknowledgement_status', 'd.acknowledgement_status');
    v_def := replace(v_def, 'join public.profiles pr on pr.id = r.pid and pr.organisation_id = v_org', 'join public.profiles pr on pr.id = r.pid');
    execute v_def;
    v_n := pg_temp.as_user(pg_temp.f('b'), format('select count(*) from public.clinical_worklist() w where w.patient_id = %L', pg_temp.f('p3')));
    insert into results values ('sabotaged', 'SABOTAGE: without the organisation filter another organisation''s item appears', '0', v_n);
  else
    insert into results values ('sabotaged', 'SABOTAGE: without the organisation filter another organisation''s item appears', '0', 'no lab fixture');
  end if;
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S39e proof FAILED: %', (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and check_name like 'SABOTAGE%' and expected <> actual;
  if v_caught < 1 then raise exception 'VACUOUS TEST: the sabotage did not flip'; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result from results where phase = 'real' order by check_name;
rollback;
