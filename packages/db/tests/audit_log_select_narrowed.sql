-- Proof: public.audit_log SELECT narrowed to own rows + admin (migration *_narrow_audit_log_select.sql).
-- One rolled-back transaction. Proves with simulated sessions: a patient, an unrelated patient, a tied clinician, an untied clinician,
-- an admin and anon. Rows ABOUT a patient written by a clinician are NOT readable by the patient, another patient, the other clinician
-- or (here) even the tied clinician's colleague; each user still reads their own actor rows (control); an admin reads every row
-- (control that the gate opens). No other policy, view or SECURITY INVOKER function reads audit_log. Append-only is unchanged
-- (authenticated cannot update, delete or truncate; the row triggers still refuse the owner).
-- SABOTAGE (each must flip): the old org-staff policy restored (the other clinician now reads the tied clinician's rows), and the admin
-- branch removed (the admin reads nothing).
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
  values (v, 'aud-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'Aud ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true)
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, is_test = true, is_active = true;
  if p_role = 'clinician' then
    insert into public.clinical_staff (organisation_id, profile_id, full_name, active, license_verified_at, doctor_tier)
    values (p_org, v, 'Aud ' || p_label, true, now(), 'senior_medical_officer');
  end if;
  return v;
end $f$;

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

-- fixtures: a patient, an unrelated patient, a tied and an untied clinician, an admin
do $$
declare v_org uuid; v_p uuid; v_p2 uuid; v_ct uuid; v_cu uuid; v_ad uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_p := pg_temp.mkuser(v_org, 'patient', 'patient'); v_p2 := pg_temp.mkuser(v_org, 'patient two', 'patient');
  v_ct := pg_temp.mkuser(v_org, 'tied clinician', 'clinician'); v_cu := pg_temp.mkuser(v_org, 'untied clinician', 'clinician');
  v_ad := pg_temp.mkuser(v_org, 'admin', 'admin');
  perform pg_temp.setf('org', v_org); perform pg_temp.setf('p', v_p); perform pg_temp.setf('p2', v_p2);
  perform pg_temp.setf('ct', v_ct); perform pg_temp.setf('cu', v_cu); perform pg_temp.setf('ad', v_ad);
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id, assigned_at) values (v_org, v_p, v_ct, now())
  on conflict (patient_id) do update set clinician_id = excluded.clinician_id;

  -- one row each, written by the owner (as the SECURITY DEFINER writers do). Tag them so the counts ignore any pre-existing data.
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, subject_patient_id, event)
  values (v_org, v_ct, 'aud.proof.chart_read', 'patient', v_p, v_p, '{"tag":"aud-proof"}'),
         (v_org, v_cu, 'aud.proof.chart_read', 'patient', v_p2, v_p2, '{"tag":"aud-proof"}'),
         (v_org, v_p,  'aud.proof.self_action', 'patient', v_p, v_p, '{"tag":"aud-proof"}');
end $$;

do $$
declare
  v_all text := 'select count(*) from public.audit_log where event ->> ''tag'' = ''aud-proof''';
  v_n text;
begin
  -- the patient reads her own actor row only: NOT the clinician row that is about her
  perform pg_temp.ck('real', 'A1 patient reads only her own actor row', '1', pg_temp.as_user(pg_temp.f('p'), v_all));
  perform pg_temp.ck('real', 'A2 patient cannot read a clinician row about her', '0', pg_temp.as_user(pg_temp.f('p'), format('select count(*) from public.audit_log where event ->> ''tag'' = ''aud-proof'' and actor_id = %L', pg_temp.f('ct'))));
  perform pg_temp.ck('real', 'A3 patient cannot read by subject_patient_id on others rows', '0', pg_temp.as_user(pg_temp.f('p'), format('select count(*) from public.audit_log where event ->> ''tag'' = ''aud-proof'' and subject_patient_id = %L and actor_id <> %L', pg_temp.f('p'), pg_temp.f('p'))));
  -- an unrelated patient: nothing, not even the rows of the fixture patient
  perform pg_temp.ck('real', 'B1 unrelated patient reads nothing of the proof rows', '0', pg_temp.as_user(pg_temp.f('p2'), v_all));
  -- tied clinician: own row only, not the other clinician's row, not the patient's row
  perform pg_temp.ck('real', 'C1 tied clinician reads only his own row', '1', pg_temp.as_user(pg_temp.f('ct'), v_all));
  perform pg_temp.ck('real', 'C2 tied clinician cannot read the other clinician row', '0', pg_temp.as_user(pg_temp.f('ct'), format('select count(*) from public.audit_log where event ->> ''tag'' = ''aud-proof'' and actor_id = %L', pg_temp.f('cu'))));
  perform pg_temp.ck('real', 'C3 tied clinician cannot read the patient own-action row', '0', pg_temp.as_user(pg_temp.f('ct'), format('select count(*) from public.audit_log where event ->> ''tag'' = ''aud-proof'' and actor_id = %L', pg_temp.f('p'))));
  -- untied clinician: own row only
  perform pg_temp.ck('real', 'D1 untied clinician reads only his own row', '1', pg_temp.as_user(pg_temp.f('cu'), v_all));
  perform pg_temp.ck('real', 'D2 untied clinician cannot read the tied clinician row', '0', pg_temp.as_user(pg_temp.f('cu'), format('select count(*) from public.audit_log where event ->> ''tag'' = ''aud-proof'' and actor_id = %L', pg_temp.f('ct'))));
  -- admin: the gate opens (control)
  perform pg_temp.ck('real', 'E1 admin reads every proof row', '3', pg_temp.as_user(pg_temp.f('ad'), v_all));
  -- anon: refused outright
  perform pg_temp.ck('real', 'F1 anon cannot select audit_log', 'ERR 42501', pg_temp.as_anon(v_all));

  -- the definer readers that the screens use still work for an admin and still refuse a plain clinician where they self-gate
  perform pg_temp.ck('real', 'G1 admin_member_activity (definer) still returns for an admin', 'true',
    pg_temp.as_user(pg_temp.f('ad'), format('select (public.admin_member_activity(%L) ->> ''total_actions'')::int >= 1', pg_temp.f('ct'))));

  -- append-only is unchanged
  perform pg_temp.ck('real', 'H1 authenticated cannot update audit_log', 'ERR 42501', pg_temp.as_user(pg_temp.f('ct'), format('update public.audit_log set reason = ''x'' where actor_id = %L returning 1::text', pg_temp.f('ct'))));
  perform pg_temp.ck('real', 'H2 authenticated cannot delete audit_log', 'ERR 42501', pg_temp.as_user(pg_temp.f('ct'), format('delete from public.audit_log where actor_id = %L returning 1::text', pg_temp.f('ct'))));
  perform pg_temp.ck('real', 'H3 authenticated cannot truncate audit_log', 'ERR 42501', pg_temp.as_user(pg_temp.f('ct'), 'truncate public.audit_log'));
  begin
    update public.audit_log set reason = 'x' where actor_id = pg_temp.f('ct');
    v_n := 'updated';
  exception when others then v_n := 'refused';
  end;
  perform pg_temp.ck('real', 'H4 the row trigger still refuses an update by the owner', 'refused', v_n);
  -- an authenticated user can still append a row about herself (existing behaviour kept)
  perform pg_temp.ck('real', 'H5 a user can still insert her own audit row', '1',
    pg_temp.as_user(pg_temp.f('ct'), format('with i as (insert into public.audit_log (organisation_id, actor_id, action, entity_type, event) values (%L, %L, ''aud.proof.ins'', ''x'', ''{"tag":"aud-proof-ins"}'') returning 1) select count(*) from i', pg_temp.f('org'), pg_temp.f('ct'))));

  -- no other reader: policies, views, invoker functions
  perform pg_temp.ck('real', 'I1 no policy on another table mentions audit_log', '0',
    (select count(*)::text from pg_policies where not (schemaname = 'public' and tablename = 'audit_log') and (coalesce(qual, '') like '%audit_log%' or coalesce(with_check, '') like '%audit_log%')));
  perform pg_temp.ck('real', 'I2 no view reads audit_log', '0',
    (select count(*)::text from pg_views where schemaname not in ('pg_catalog', 'information_schema') and definition ilike '%audit_log%'));
  perform pg_temp.ck('real', 'I3 no SECURITY INVOKER function reads audit_log', '0',
    (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public', 'private') and not p.prosecdef and p.prosrc ~* '(from|join)[[:space:]]+(public\.)?audit_log([^a-z_]|$)'));
  perform pg_temp.ck('real', 'I4 the select policy does not name org staff', 'false',
    (select (qual like '%is_org_staff%')::text from pg_policies where schemaname = 'public' and tablename = 'audit_log' and policyname = 'audit_log_select'));
end $$;

-- SABOTAGE 1: restore the old org-staff policy; the untied clinician then reads the tied clinician's row
do $$
begin
  drop policy audit_log_select on public.audit_log;
  create policy audit_log_select on public.audit_log for select to authenticated
    using (actor_id = (select auth.uid()) or (organisation_id is not null and private.is_org_staff(organisation_id)) or private.is_admin());
  insert into results values ('sabotaged', 'SABOTAGE 1: the old org-staff policy lets the other clinician read the tied clinician row', '0',
    pg_temp.as_user(pg_temp.f('cu'), format('select count(*) from public.audit_log where event ->> ''tag'' = ''aud-proof'' and actor_id = %L', pg_temp.f('ct'))));
  -- SABOTAGE 2: the admin branch removed; the admin then reads only his own (zero) rows
  drop policy audit_log_select on public.audit_log;
  create policy audit_log_select on public.audit_log for select to authenticated using (actor_id = (select auth.uid()));
  insert into results values ('sabotaged', 'SABOTAGE 2: without the admin branch the admin reads the proof rows', '3',
    pg_temp.as_user(pg_temp.f('ad'), 'select count(*) from public.audit_log where event ->> ''tag'' = ''aud-proof'''));
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'audit_log_select proof FAILED: %', (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and check_name like 'SABOTAGE%' and expected <> actual;
  if v_caught < 2 then raise exception 'VACUOUS TEST: the sabotage flipped % of 2 checks', v_caught; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result from results where phase = 'real' order by check_name;
rollback;
